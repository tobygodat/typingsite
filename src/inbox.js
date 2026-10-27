// The envelope inbox (top right) and the challenge toast. Pending invitations and ghost challenges
// come from the race service; other entries (an opponent joined, a race result) are added by the
// online race. Entries are kept per signed-in user on this device only; guests keep nothing and see
// no inbox.
import { offerText, resultParts, resultText } from './ghost-race.js';
import { normalizeInboxEntry, raceResultOf, raceResultParts } from './race-result.js';
import { speedFigure } from './units.js';

const $ = (id) => document.getElementById(id);
const STORE = 'stilltype-inbox-v1:';
// Ghost race results already delivered, so a cleared result does not return on the next poll. Only
// ids the service still lists are kept.
const DELIVERED = 'stilltype-inbox-delivered-v1:';
// Entries kept beyond open ghost races and the week's ghost race results, which are never cut.
const MAX_ENTRIES = 30;
const POLL_MS = 10000;
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const TOAST_MS = 18000;

// Draws a list's rows again without losing keyboard focus: a focused control comes back on the new
// control with the same data attributes or, when its row has gone, on `fallback`. The online race's
// lists use it too.
export function redrawList(list, rows, fallback = null) {
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const key = focused && JSON.stringify({ ...focused.dataset });
  const focusVisible = focused?.matches(':focus-visible');
  list.replaceChildren(...rows);
  if (!focused) return;
  const same = [...list.querySelectorAll('button')].find((button) => JSON.stringify({ ...button.dataset }) === key);
  (same || fallback)?.focus({ preventScroll: true, focusVisible });
}

function ago(at, now = Date.now()) {
  const minutes = Math.round((now - Date.parse(at)) / 60000);
  if (!(minutes >= 1)) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// An entry as shown: a result's speeds are figures in the chosen unit, read from its saved scores or,
// for a ghost race or a result saved before the setting, from its sentence. Anything else reads as saved.
function copyOf(entry) {
  const race = raceResultOf(entry);
  if (race) return raceResultParts(race, speedFigure);
  return (entry.kind === 'challenge-result' && resultParts(entry.text, speedFigure)) || [entry.text];
}

export function createInbox({ getSession, listInvites, listChallenges = null, actions, announce, isRunning }) {
  let entries = [];
  let invites = [];
  let delivered = new Set();
  let polling = false;
  // Set on sign-out: nothing in flight may write this account's entries back.
  let forgotten = false;
  let pendingToast = null;
  let toastEntry = null;
  let toastLeft = 0;
  let toastStarted = 0;
  let toastTimer = 0;
  const listeners = new Set();
  // Kinds whose action waits for a request already in flight (the online race sends one at a time):
  // their buttons are aria-disabled, so they keep focus and show why nothing happens, and ignore clicks.
  let waiting = new Set();
  function markWaiting(button, kind) {
    if (waiting.has(kind)) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
  }
  // Guests keep no entries, so toasts are also remembered for this page alone.
  const toasted = new Set();
  const userId = () => getSession()?.user?.id || null;
  // The run itself, not the chrome fade: a pointer nudge mid-run reveals the chrome but is still a run.
  const running = () => isRunning();

  function load() {
    entries = [];
    delivered = new Set();
    if (!userId()) return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORE + userId()));
      if (Array.isArray(saved)) entries = saved.filter((entry) => entry?.id && entry.text).map(normalizeInboxEntry);
    } catch {}
    trim();
    try {
      const ids = JSON.parse(localStorage.getItem(DELIVERED + userId()));
      if (Array.isArray(ids)) delivered = new Set(ids.filter((id) => typeof id === 'string'));
    } catch {}
  }
  function save() {
    if (!userId()) return;
    try { localStorage.setItem(STORE + userId(), JSON.stringify(entries)); } catch {}
  }
  // The service lists every open ghost race and every result from the last week, so those stay
  // reachable however many there are; everything else keeps the newest MAX_ENTRIES.
  const freshResult = (at) => Date.now() - Date.parse(at) < WEEK_MS;
  function kept(entry) {
    if (entry.kind === 'challenge') return !isClosed(entry);
    return entry.kind === 'challenge-result' && freshResult(entry.completedAt || entry.at);
  }
  function trim() {
    let others = 0;
    entries = entries.filter((entry) => kept(entry) || ++others <= MAX_ENTRIES);
  }
  function storeDelivered() {
    if (!userId()) return;
    try { localStorage.setItem(DELIVERED + userId(), JSON.stringify([...delivered])); } catch {}
  }
  function deliver(id) {
    if (!userId() || delivered.has(id)) return;
    delivered.add(id);
    storeDelivered();
  }

  // An entry's action lapses when the service would no longer honour it (`until`), or when the
  // action says the thing it points at is gone (an opponent-joined entry for a race already left).
  function isClosed(entry) {
    if (entry.closed) return true;
    if (entry.until && Date.now() > Date.parse(entry.until)) return true;
    return actions[entry.kind]?.available?.(entry) === false;
  }

  // A toast speaks for its entry as the inbox holds it now. Once the entry has closed, been replaced by
  // another kind (a ghost race answered on another device becomes its result) or gone, the toast goes too,
  // so its button never acts on what was. Guests keep no entries, so their toast stands for itself.
  function current(shown) {
    if (!userId()) return !isClosed(shown);
    const entry = entries.find((value) => value.id === shown.id);
    return Boolean(entry) && entry.kind === shown.kind && !isClosed(entry);
  }
  // A toast that goes while it has keyboard focus hands focus to the inbox, where its entry now is, and says why.
  function retire() {
    if (pendingToast && !current(pendingToast)) pendingToast = null;
    if (!toastEntry || current(toastEntry)) return;
    const focused = $('challenge-toast').contains(document.activeElement);
    hideToast();
    if (!focused) return;
    if (!$('inbox').hidden) $('inbox-trigger').focus();
    announce('That race is no longer open.');
  }

  function render() {
    retire();
    const signedIn = Boolean(userId());
    $('inbox').hidden = !signedIn;
    if (!signedIn) return;
    const unread = entries.filter((entry) => !entry.read).length;
    $('inbox-count').hidden = unread === 0;
    $('inbox-count').textContent = unread > 9 ? '9+' : String(unread);
    $('inbox-trigger').setAttribute('aria-label', unread ? `Inbox, ${unread} unread` : 'Inbox');
    $('inbox-empty').hidden = entries.length > 0;
    $('inbox-clear').hidden = entries.length === 0;
    redrawList($('inbox-list'), entries.map((entry) => {
      const row = document.createElement('li');
      row.className = 'inbox-entry';
      row.dataset.kind = entry.kind;
      if (!entry.read) row.dataset.unread = 'true';
      const copy = document.createElement('p');
      copy.append(...copyOf(entry));
      const meta = document.createElement('span');
      meta.className = 'inbox-meta';
      const closed = isClosed(entry);
      meta.textContent = closed ? `${ago(entry.at)} · closed` : ago(entry.at);
      row.append(copy, meta);
      const action = !closed && actions[entry.kind];
      if (action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-secondary btn-sm';
        button.dataset.inboxAction = entry.kind;
        button.textContent = action.label;
        markWaiting(button, entry.kind);
        button.addEventListener('click', () => {
          if (waiting.has(entry.kind)) return;
          $('inbox').open = false;
          // The offer can lapse while the inbox sits open; re-check before acting on it.
          if (isClosed(entry)) { render(); return; }
          action.run(entry);
        });
        row.append(button);
      }
      return row;
    }), $('inbox-trigger'));
  }

  // Adds or refreshes an entry. A new entry can raise the toast; a known one never does again.
  function notify(entry, { toast = false } = {}) {
    if (forgotten) return;
    const known = entries.find((value) => value.id === entry.id);
    if (known) {
      // A poll that repeats what is shown leaves the list alone, so focus on a row's button stays put.
      const changed = Object.keys(entry).some((key) => key !== 'at' && key !== 'read' && JSON.stringify(known[key]) !== JSON.stringify(entry[key]));
      if (!changed) { toasted.add(entry.id); return; }
      Object.assign(known, { ...entry, read: known.read, at: known.at });
    } else if (userId()) {
      // An entry may carry when it happened (a ghost race sent or answered while this device was away).
      entries.unshift({ at: new Date().toISOString(), ...entry, read: false });
      trim();
    }
    save();
    render();
    if (toast && !known && !toasted.has(entry.id)) showToast(entry);
    toasted.add(entry.id);
  }

  function showToast(entry) {
    if (!current(entry)) return;
    if (running()) { pendingToast = entry; return; }
    pendingToast = null;
    toastEntry = entry;
    const action = actions[entry.kind];
    $('challenge-toast-text').replaceChildren(...copyOf(entry));
    $('challenge-toast-action').hidden = !action;
    $('challenge-toast-action').textContent = action?.label || '';
    markWaiting($('challenge-toast-action'), entry.kind);
    $('challenge-toast').hidden = false;
    announce($('challenge-toast-text').textContent);
    toastLeft = TOAST_MS;
    startToastTimer();
  }
  function startToastTimer() {
    clearTimeout(toastTimer);
    toastStarted = Date.now();
    toastTimer = setTimeout(hideToast, toastLeft);
  }
  // Hover or keyboard focus holds the toast so it can be read and answered.
  function holdToast() {
    if ($('challenge-toast').hidden || !toastTimer) return;
    clearTimeout(toastTimer);
    toastTimer = 0;
    toastLeft = Math.max(2000, toastLeft - (Date.now() - toastStarted));
  }
  function releaseToast() {
    const toast = $('challenge-toast');
    if (toast.hidden || toastTimer || toast.matches(':hover') || toast.contains(document.activeElement)) return;
    startToastTimer();
  }
  function hideToast() {
    clearTimeout(toastTimer);
    toastTimer = 0;
    toastEntry = null;
    $('challenge-toast').hidden = true;
  }

  // A ghost challenge for this account (Race), then its result; a lapsed one closes. A result arrives
  // once: the sender hears a fresh one with a toast, and clearing it keeps it gone. The service lists
  // every open challenge, then every result from the last week, then the newest fifty others, so
  // working from the end leaves the open ones at the top of the inbox.
  function applyChallenges(challenges) {
    const fresh = (at) => Date.now() - Date.parse(at) < DAY_MS;
    // One entry per challenge, from its first (most pressing) place in the list.
    const listed = new Map();
    for (const challenge of challenges) if (challenge?.id && !listed.has(challenge.id)) listed.set(challenge.id, challenge);
    // A delivered result the service no longer lists never comes back, so it need not be remembered.
    const ids = new Set([...listed.keys()].map((id) => `challenge:${id}`));
    if ([...delivered].some((id) => !ids.has(id))) {
      delivered = new Set([...delivered].filter((id) => ids.has(id)));
      storeDelivered();
    }
    let changed = false;
    for (const challenge of [...listed.values()].reverse()) {
      const id = `challenge:${challenge.id}`;
      const known = entries.find((entry) => entry.id === id);
      if (challenge.status === 'done' && challenge.result) {
        // A result older than a week only updates an entry already here: it is history, not news.
        if (!known && (delivered.has(id) || !freshResult(challenge.completedAt))) continue;
        notify({ id, kind: 'challenge-result', challengeId: challenge.id, closed: false, until: null, at: challenge.completedAt,
          completedAt: challenge.completedAt, text: resultText(challenge) }, { toast: challenge.role === 'sent' && fresh(challenge.completedAt) });
        // Only a result left on the list counts as delivered.
        if (entries.some((entry) => entry.id === id)) deliver(id);
      } else if (challenge.role === 'received' && challenge.status === 'open') {
        // A result this device already has is final: a list read before the finish was stored can't
        // offer the race again.
        if (delivered.has(id)) continue;
        notify({ id, kind: 'challenge', challengeId: challenge.id, closed: false, until: challenge.expiresAt, at: challenge.createdAt,
          text: offerText(challenge) }, { toast: true });
      } else if (known?.kind === 'challenge' && !known.closed) {
        known.closed = true;
        changed = true;
      }
    }
    if (changed) { save(); render(); }
  }

  async function refresh() {
    const session = getSession();
    if (!session || polling || forgotten) return invites;
    polling = true;
    try {
      // Invitations and ghost challenges are separate sources: either still arrives when the other can't be read.
      const [listed, challenges] = await Promise.allSettled([listInvites(session),
        listChallenges ? listChallenges(session) : null]);
      if (forgotten) return invites;
      if (Array.isArray(challenges.value)) applyChallenges(challenges.value);
      if (listed.status === 'rejected') throw listed.reason;
      invites = listed.value;
      const open = new Set(invites.map((invite) => `invite:${invite.id}`));
      for (const invite of [...invites].reverse()) {
        // Once the service lists an invitation it decides when the entry closes.
        notify({ id: `invite:${invite.id}`, kind: 'invite', roomId: invite.id, closed: false, local: false, until: invite.expiresAt,
          text: invite.rematch ? `${invite.hostName} wants a rematch.` : `${invite.hostName} challenged you to a race.` }, { toast: true });
      }
      // An invitation that left the service's list was joined, cancelled or expired.
      let changed = false;
      for (const entry of entries) {
        if (entry.kind === 'invite' && !entry.closed && !entry.local && !open.has(entry.id)) { entry.closed = true; changed = true; }
      }
      if (changed) { save(); render(); }
      // An entry's action can also lapse with time, so a toast is checked on every poll.
      retire();
      for (const listener of listeners) listener(invites, null);
    } catch (failure) {
      // Entries still lapse while invitations can't be read.
      retire();
      for (const listener of listeners) listener(invites, failure);
    } finally { polling = false; }
    return invites;
  }

  // Only one corner panel at a time, however the inbox was opened, closed as it opens (as with the account).
  new MutationObserver(() => { if ($('inbox').open) $('account').open = false; })
    .observe($('inbox'), { attributeFilter: ['open'] });
  $('inbox').addEventListener('toggle', () => {
    if (!$('inbox').open) return;
    // The open inbox holds everything the toast would say.
    hideToast();
    render();
    if (entries.some((entry) => !entry.read)) {
      for (const entry of entries) entry.read = true;
      save();
      // The rows stay marked for this opening; the badge clears at once.
      $('inbox-count').hidden = true;
      $('inbox-trigger').setAttribute('aria-label', 'Inbox');
    }
  });
  $('inbox-clear').addEventListener('click', () => { entries = []; save(); render(); });
  document.addEventListener('pointerdown', (event) => {
    if ($('inbox').open && !$('inbox').contains(event.target)) $('inbox').open = false;
  });
  $('inbox').addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !$('inbox').open) return;
    event.preventDefault();
    event.stopPropagation();
    $('inbox').open = false;
    $('inbox-trigger').focus();
  });
  $('challenge-toast-action').addEventListener('click', () => {
    if (waiting.has(toastEntry?.kind)) return;
    const entry = toastEntry;
    hideToast();
    if (entry) {
      const known = entries.find((value) => value.id === entry.id);
      if (known && !known.read) { known.read = true; save(); render(); }
      if (current(entry)) actions[entry.kind]?.run(entry);
    }
  });
  $('challenge-toast-close').addEventListener('click', hideToast);
  for (const type of ['pointerenter', 'focusin']) $('challenge-toast').addEventListener(type, holdToast);
  $('challenge-toast').addEventListener('pointerleave', releaseToast);
  $('challenge-toast').addEventListener('focusout', () => setTimeout(releaseToast));
  // Nothing new appears while a run is in progress; a held toast shows once the run ends.
  function runChanged() {
    if (!running() && pendingToast) showToast(pendingToast);
    else if (running() && !$('challenge-toast').hidden && !$('challenge-toast').contains(document.activeElement)) { pendingToast = toastEntry; hideToast(); }
  }

  setInterval(() => { if (!document.hidden && !running()) refresh(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  addEventListener('online', refresh);
  load();
  render();

  return {
    refresh,
    notify,
    runChanged,
    get invites() { return invites; },
    subscribe(listener) { listeners.add(listener); },
    // Marks these kinds' actions as waiting (none, once the request has landed).
    wait(kinds) {
      waiting = new Set(kinds);
      for (const button of $('inbox-list').querySelectorAll('[data-inbox-action]')) markWaiting(button, button.dataset.inboxAction);
      if (toastEntry) markWaiting($('challenge-toast-action'), toastEntry.kind);
    },
    // The room was opened another way: the toast for it goes and its entry counts as read. An
    // invitation only this device knew about is used up, since nothing else will close it.
    settle(id) {
      if (toastEntry?.id === id || pendingToast?.id === id) { pendingToast = null; hideToast(); }
      const known = entries.find((entry) => entry.id === id);
      if (known && (!known.read || (known.local && !known.closed))) {
        known.read = true;
        if (known.local) known.closed = true;
        save();
        render();
      }
      toasted.add(id);
    },
    // Records a result this device produced, so the next poll does not deliver it again.
    deliver,
    // A Race whose reply landed after the person moved on: the toast offers it again, with `text`, while
    // its entry is still an open ghost race. Like any toast it waits for a run to end.
    offer(id, text) {
      const entry = entries.find((value) => value.id === id);
      if (entry?.kind === 'challenge') showToast({ ...entry, text });
    },
    // A request this device discovered has lapsed: its toast goes and its entry closes.
    withdraw(id) {
      if (toastEntry?.id === id || pendingToast?.id === id) { pendingToast = null; hideToast(); }
      const known = entries.find((entry) => entry.id === id);
      if (known?.local && !known.closed) { known.closed = true; save(); render(); }
    },
    forget() {
      forgotten = true;
      pendingToast = null;
      hideToast();
      if (userId()) { try { localStorage.removeItem(STORE + userId()); localStorage.removeItem(DELIVERED + userId()); } catch {} }
      entries = [];
      invites = [];
      delivered = new Set();
    },
  };
}

// The envelope inbox (top right) and the challenge toast. Pending invitations come from the race
// service; other entries (an opponent joined, a race result) are added by the online race. Entries
// are kept per signed-in user on this device only; guests keep nothing and see no inbox.
const $ = (id) => document.getElementById(id);
const STORE = 'stilltype-inbox-v1:';
const MAX_ENTRIES = 30;
const POLL_MS = 10000;
export const TOAST_MS = 18000;

function ago(at, now = Date.now()) {
  const minutes = Math.round((now - Date.parse(at)) / 60000);
  if (!(minutes >= 1)) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// `describe` can word an entry from its saved fields (a race result in the current speed unit).
// `normalize` brings an entry saved by an older build up to the current shape as it is loaded; it
// must keep what was saved (the text above all) and return a current entry unchanged.
export function createInbox({ getSession, listInvites, actions, announce, isRunning, describe = (entry) => entry.text, normalize = (entry) => entry }) {
  let entries = [];
  let invites = [];
  let polling = false;
  // Set on sign-out: nothing in flight may write this account's entries back.
  let forgotten = false;
  let pendingToast = null;
  let toastEntry = null;
  let toastLeft = 0;
  let toastStarted = 0;
  let toastTimer = 0;
  const listeners = new Set();
  // Guests keep no entries, so toasts are also remembered for this page alone.
  const toasted = new Set();
  const userId = () => getSession()?.user?.id || null;
  // The run itself, not the chrome fade: a pointer nudge mid-run reveals the chrome but is still a run.
  const running = () => isRunning();

  function load() {
    entries = [];
    if (!userId()) return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORE + userId()));
      if (Array.isArray(saved)) entries = saved.filter((entry) => entry?.id && entry.text).slice(0, MAX_ENTRIES).map(normalize);
    } catch {}
  }
  function save() {
    if (!userId()) return;
    try { localStorage.setItem(STORE + userId(), JSON.stringify(entries.slice(0, MAX_ENTRIES))); } catch {}
  }

  // An entry's action lapses when the service would no longer honour it (`until`), or when the
  // action says the thing it points at is gone (an opponent-joined entry for a race already left).
  function isClosed(entry) {
    if (entry.closed) return true;
    if (entry.until && Date.now() > Date.parse(entry.until)) return true;
    return actions[entry.kind]?.available?.(entry) === false;
  }

  function render() {
    // A toast on screen is reworded too (a result in a newly chosen speed unit).
    if (toastEntry) $('challenge-toast-text').textContent = describe(toastEntry);
    const signedIn = Boolean(userId());
    $('inbox').hidden = !signedIn;
    if (!signedIn) return;
    const unread = entries.filter((entry) => !entry.read).length;
    $('inbox-count').hidden = unread === 0;
    $('inbox-count').textContent = unread > 9 ? '9+' : String(unread);
    $('inbox-trigger').setAttribute('aria-label', unread ? `Inbox, ${unread} unread` : 'Inbox');
    $('inbox-empty').hidden = entries.length > 0;
    $('inbox-clear').hidden = entries.length === 0;
    $('inbox-list').replaceChildren(...entries.map((entry) => {
      const row = document.createElement('li');
      row.className = 'inbox-entry';
      row.dataset.kind = entry.kind;
      if (!entry.read) row.dataset.unread = 'true';
      const copy = document.createElement('p');
      copy.textContent = describe(entry);
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
        button.addEventListener('click', () => {
          $('inbox').open = false;
          // The offer can lapse while the inbox sits open; re-check before acting on it.
          if (isClosed(entry)) { render(); return; }
          action.run(entry);
        });
        row.append(button);
      }
      return row;
    }));
  }

  // Adds or refreshes an entry. A new entry can raise the toast; a known one never does again.
  function notify(entry, { toast = false } = {}) {
    if (forgotten) return;
    const known = entries.find((value) => value.id === entry.id);
    if (known) {
      Object.assign(known, { ...entry, read: known.read, at: known.at });
    } else if (userId()) {
      entries.unshift({ ...entry, at: new Date().toISOString(), read: false });
      entries = entries.slice(0, MAX_ENTRIES);
    }
    save();
    render();
    if (toast && !known && !toasted.has(entry.id)) showToast(entry);
    toasted.add(entry.id);
  }

  function showToast(entry) {
    if (running()) { pendingToast = entry; return; }
    pendingToast = null;
    toastEntry = entry;
    const action = actions[entry.kind];
    const text = describe(entry);
    $('challenge-toast-text').textContent = text;
    $('challenge-toast-action').hidden = !action;
    $('challenge-toast-action').textContent = action?.label || '';
    $('challenge-toast').hidden = false;
    announce(text);
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

  async function refresh() {
    const session = getSession();
    if (!session || polling || forgotten) return invites;
    polling = true;
    try {
      const listed = await listInvites(session);
      if (forgotten) return invites;
      invites = listed;
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
      if (toastEntry?.kind === 'invite' && !toastEntry.local && !open.has(toastEntry.id)) hideToast();
      if (changed) { save(); render(); }
      for (const listener of listeners) listener(invites, null);
    } catch (failure) {
      for (const listener of listeners) listener(invites, failure);
    } finally { polling = false; }
    return invites;
  }

  $('inbox').addEventListener('toggle', () => {
    if (!$('inbox').open) return;
    // Only one corner panel at a time, however the inbox was opened.
    $('account').open = false;
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
    const entry = toastEntry;
    hideToast();
    if (entry) {
      const known = entries.find((value) => value.id === entry.id);
      if (known && !known.read) { known.read = true; save(); render(); }
      if (!isClosed(known || entry)) actions[entry.kind]?.run(entry);
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
    render,
    get invites() { return invites; },
    subscribe(listener) { listeners.add(listener); },
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
      if (userId()) { try { localStorage.removeItem(STORE + userId()); } catch {} }
      entries = [];
      invites = [];
    },
  };
}

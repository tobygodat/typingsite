// The envelope inbox (top right) and the challenge toast. Pending invitations and ghost challenges
// come from the race service; other entries (an opponent joined, a race result) are added by the
// online race. Entries are kept per signed-in user on this device only; guests keep nothing and see
// no inbox.
import { offerText, resultParts, resultText } from './ghost-race.js';
import { normalizeInboxEntry, raceResultOf } from './race-result.js';
import { formatSpeed } from './units.js';
import type { CopyPart } from './practice-session.js';
import { AsyncLifetime, accountLifetime, abortable } from './async-runtime.js';
import { sameSignIn } from './account.js';
import { errorDetails } from './network.js';
import type { Session } from './network.js';
import type { RaceInvite } from './multiplayer.js';
import type { GhostChallenge } from './ghost-race.js';
import type { Conditions } from './typing.js';
import { isConditions } from './domain-history.js';
import { isRecord } from './domain-values.js';
import type { RaceResult } from './race-result.js';

export interface InboxEntry {
  id: string; kind: string; text: string; at?: string; read?: boolean;
  closed?: boolean; until?: string | null; completedAt?: string | null;
  local?: boolean; roomId?: string; challengeId?: string; conditions?: Conditions; race?: RaceResult;
}

export interface InboxAction { label: string; run(entry: InboxEntry): void; available?(entry: InboxEntry): boolean }

export interface InboxOptions {
  getSession(): Session | null;
  listInvites(session: Session, signal?: AbortSignal): Promise<RaceInvite[]>;
  listChallenges?(session: Session, signal?: AbortSignal): Promise<GhostChallenge[]>;
  actions: Readonly<Partial<Record<string, InboxAction>>>;
  announce(text: string): void;
  isRunning(): boolean;
}

export type InboxCopyPart = CopyPart;

export interface InboxRow { entry: Readonly<InboxEntry>; copy: readonly InboxCopyPart[]; meta: string; action: string | null; waiting: boolean }

export interface InboxSnapshot {
  signedIn: boolean; unread: number; rows: readonly InboxRow[]; toast: InboxRow | null;
}

export interface InboxFocusHost { toastFocused(): boolean; focusTrigger(): void }

type InboxListener = (invites: RaceInvite[], error: Error | null, challenges: GhostChallenge[]) => void;

function savedEntry(value: unknown): InboxEntry | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.text !== 'string' || !value.text) return null;
  const normalized = normalizeInboxEntry(value);

  return { ...normalized, id: value.id, text: value.text, kind: typeof value.kind === 'string' ? value.kind : '',
    at: typeof value.at === 'string' ? value.at : undefined, read: Boolean(value.read), closed: Boolean(value.closed),
    until: typeof value.until === 'string' ? value.until : null,
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : null,
    local: Boolean(value.local), roomId: typeof value.roomId === 'string' ? value.roomId : undefined,
    challengeId: typeof value.challengeId === 'string' ? value.challengeId : undefined,
    conditions: isConditions(value.conditions) ? value.conditions : undefined,
    race: raceResultOf(normalized) ?? undefined };
}

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
export function redrawList(list: HTMLElement, rows: Node[], fallback: HTMLElement | null = null) {
  const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement : null;
  const key = focused && JSON.stringify({ ...focused.dataset });
  const focusVisible = focused?.matches(':focus-visible');
  list.replaceChildren(...rows);

  if (!focused) return;
  const same = [...list.querySelectorAll('button')].find((button) => JSON.stringify({ ...button.dataset }) === key);
  const options = { preventScroll: true, focusVisible };
  (same || fallback)?.focus(options);
}

export function ago(at: string, now = Date.now()) {
  const minutes = Math.round((now - Date.parse(at)) / 60000);

  if (!(minutes >= 1)) return 'just now';

  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);

  if (hours < 24) return `${hours} h ago`;

  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// An entry as shown: a result's speeds are figures in the chosen unit, read from its saved scores or,
// for a ghost race or a result saved before the setting, from its sentence. Anything else reads as saved.
function copyOf(entry: InboxEntry): InboxCopyPart[] {
  const race = raceResultOf(entry);

  if (race) return [`${race.lead} ${race.opponent}: `, { kind: 'speed', wpm: race.wpm[0] }, ' to ', { kind: 'speed', wpm: race.wpm[1], bare: true }, '.'];

  return (entry.kind === 'challenge-result' && resultParts(entry.text, (wpm): CopyPart => ({ kind: 'speed', wpm }))) || [entry.text];
}

export function createInbox(initial?: InboxOptions) {
  let options: InboxOptions = initial ?? {
    getSession: () => null, listInvites: () => Promise.resolve([]), actions: {}, announce: () => {}, isRunning: () => false,
  };

  const getSession = () => options.getSession();
  const announce = (text: string) => options.announce(text);
  let entries: InboxEntry[] = [];
  let invites: RaceInvite[] = [];
  let challengesListed: GhostChallenge[] = [];
  let delivered = new Set<string>();
  let polling = false;
  let forgotten = false;
  let disposed = false;
  let configured = false;
  let identity = getSession();
  let lifetime = new AsyncLifetime(accountLifetime());
  let pendingToast: InboxEntry | null = null;
  let toastEntry: InboxEntry | null = null;
  let toastLeft = 0;
  let toastStarted = 0;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let focusHost: InboxFocusHost | undefined;
  let hovered = false;
  const listeners = new Set<InboxListener>();
  const viewListeners = new Set<() => void>();
  let waiting = new Set<string>();
  const toasted = new Set<string>();
  const userId = () => getSession()?.user.id || null;
  const running = () => options.isRunning();
  let snapshot: InboxSnapshot = { signedIn: false, unread: 0, rows: [], toast: null };

  function publish() {
    if (disposed) return;
    snapshot = { signedIn: Boolean(userId()), unread: entries.filter((entry) => !entry.read).length,
      rows: entries.map(toRow), toast: toastEntry ? toRow(toastEntry) : null };

    for (const listener of viewListeners) listener();
  }

  function toRow(entry: InboxEntry): InboxRow {
    const closed = isClosed(entry);

    return { entry: { ...entry }, copy: copyOf(entry), meta: `${ago(entry.at ?? '')}${closed ? ' · closed' : ''}`,
      action: closed ? null : options.actions[entry.kind]?.label ?? null, waiting: waiting.has(entry.kind) };
  }

  function active(session: Session | null) {
    return !forgotten && !disposed && lifetime.active && (session === null ? getSession() === null : sameSignIn(session, getSession()));
  }

  function syncIdentity() {
    if (disposed) return;
    const current = getSession();

    if (identity === null ? current === null : sameSignIn(identity, current)) return;
    void lifetime.close();
    lifetime = new AsyncLifetime(accountLifetime());
    identity = current;
    forgotten = false;
    polling = false;
    pendingToast = null;
    hideToast();
    invites = [];
    challengesListed = [];
    toasted.clear();
    load();
    publish();
  }

  function load() {
    entries = [];
    delivered = new Set();

    if (!userId()) return;

    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORE + userId()) ?? 'null');

      if (Array.isArray(saved)) entries = saved.flatMap((value: unknown) => {
        const entry = savedEntry(value);

        return entry ? [entry] : [];
      });
    } catch {}

    trim();

    try {
      const ids: unknown = JSON.parse(localStorage.getItem(DELIVERED + userId()) ?? 'null');

      if (Array.isArray(ids)) delivered = new Set(ids.filter((id: unknown): id is string => typeof id === 'string'));
    } catch {}
  }

  function save() {
    if (!userId()) return;

    try { localStorage.setItem(STORE + userId(), JSON.stringify(entries)); } catch {}
  }

  // The service lists every open ghost race and every result from the last week, so those stay
  // reachable however many there are; everything else keeps the newest MAX_ENTRIES.
  const freshResult = (at: string | null | undefined) => Date.now() - Date.parse(at ?? '') < WEEK_MS;

  function kept(entry: InboxEntry) {
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

  function deliver(id: string) {
    if (!userId() || forgotten || disposed || delivered.has(id)) return;
    delivered.add(id);
    storeDelivered();
  }

  // An entry's action lapses when the service would no longer honour it (`until`), or when the
  // action says the thing it points at is gone (an opponent-joined entry for a race already left).
  function isClosed(entry: InboxEntry) {
    if (entry.closed) return true;

    if (entry.until && Date.now() > Date.parse(entry.until)) return true;

    return options.actions[entry.kind]?.available?.(entry) === false;
  }

  // A toast speaks for its entry as the inbox holds it now. Once the entry has closed, been replaced by
  // another kind (a ghost race answered on another device becomes its result) or gone, the toast goes too,
  // so its button never acts on what was. Guests keep no entries, so their toast stands for itself.
  function current(shown: InboxEntry) {
    if (!userId()) return !isClosed(shown);
    const entry = entries.find((value) => value.id === shown.id);

    return entry !== undefined && entry.kind === shown.kind && !isClosed(entry);
  }

  // A toast that goes while it has keyboard focus hands focus to the inbox, where its entry now is, and says why.
  function retire() {
    if (pendingToast && !current(pendingToast)) pendingToast = null;

    if (!toastEntry || current(toastEntry)) return;
    const focused = focusHost?.toastFocused();
    hideToast();

    if (!focused) return;

    if (userId()) focusHost?.focusTrigger();
    announce('That race is no longer open.');
  }

  function render() {
    retire();
    publish();
  }

  // Adds or refreshes an entry. A new entry can raise the toast; a known one never does again.
  function notify(entry: InboxEntry, { toast = false } = {}) {
    if (forgotten || disposed) return;
    const known = entries.find((value) => value.id === entry.id);

    if (known) {
      // A poll that repeats what is shown leaves the list alone, so focus on a row's button stays put.
      const previous = new Map(Object.entries(known));
      const changed = Object.entries(entry).some(([key, value]) => key !== 'at' && key !== 'read' && JSON.stringify(previous.get(key)) !== JSON.stringify(value));

      if (!changed) {
        toasted.add(entry.id);

        return;
      }

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

  function showToast(entry: InboxEntry) {
    if (!current(entry)) return;

    if (running()) {
      pendingToast = entry;

      return;
    }

    pendingToast = null;
    toastEntry = entry;
    publish();
    announce(copyOf(entry).map((part) => typeof part === 'string' ? part : formatSpeed(part.wpm, part)).join(''));
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
    if (!toastEntry || !toastTimer) return;
    clearTimeout(toastTimer);
    toastTimer = undefined;
    toastLeft = Math.max(2000, toastLeft - (Date.now() - toastStarted));
  }

  function releaseToast() {
    if (disposed) return;

    if (!toastEntry || toastTimer || hovered || focusHost?.toastFocused()) return;
    startToastTimer();
  }

  function hideToast() {
    clearTimeout(toastTimer);
    toastTimer = undefined;
    toastEntry = null;
    hovered = false;
    publish();
  }

  // A ghost challenge for this account (Race), then its result; a lapsed one closes. A result arrives
  // once: the sender hears a fresh one with a toast, and clearing it keeps it gone. The service lists
  // every open challenge, then every result from the last week, then the newest fifty others, so
  // working from the end leaves the open ones at the top of the inbox.
  function applyChallenges(challenges: GhostChallenge[]) {
    const fresh = (at: string | null) => Date.now() - Date.parse(at ?? '') < DAY_MS;
    // One entry per challenge, from its first (most pressing) place in the list.
    const listed = new Map<string, GhostChallenge>();

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
        notify({ id, kind: 'challenge-result', challengeId: challenge.id, closed: false, until: null, at: challenge.completedAt ?? undefined,
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
    syncIdentity();
    const session = getSession();

    if (!session || polling || forgotten || disposed || !lifetime.active) return invites;
    polling = true;
    const scope = lifetime;

    try {
      // Invitations and ghost challenges are separate sources: either still arrives when the other can't be read.
      const [listed, challenges] = await scope.run(abortable((signal) => Promise.allSettled([options.listInvites(session, signal),
        options.listChallenges ? options.listChallenges(session, signal) : Promise.resolve(null)]), errorDetails));

      if (!active(session) || scope !== lifetime) return invites;

      if (challenges.status === 'fulfilled' && Array.isArray(challenges.value)) {
        challengesListed = challenges.value;
        applyChallenges(challenges.value);
      }

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

      for (const listener of listeners) listener(invites, null, challengesListed);
    } catch (failure) {
      if (!active(session) || scope !== lifetime) return invites;
      // Entries still lapse while invitations can't be read.
      retire();

      for (const listener of listeners) listener(invites, errorDetails(failure), challengesListed);
    } finally { if (scope === lifetime) polling = false; }

    return invites;
  }

  function open() {
    if (disposed) return;
    hideToast();
    render();

    if (entries.some((entry) => !entry.read)) {
      for (const entry of entries) entry.read = true;
      save();
      snapshot = { ...snapshot, unread: 0 };

      for (const listener of viewListeners) listener();
    }
  }

  function act(entry: InboxEntry, toast = false) {
    if (disposed || forgotten || waiting.has(entry.kind)) return;

    if (toast) {
      hideToast();
      const known = entries.find((value) => value.id === entry.id);

      if (known && !known.read) { known.read = true; save(); render(); }

      if (current(entry)) options.actions[entry.kind]?.run(entry);
    } else {
      if (isClosed(entry)) {
        render();

        return;
      }

      options.actions[entry.kind]?.run(entry);
    }
  }

  // Nothing new appears while a run is in progress; a held toast shows once the run ends.
  function runChanged() {
    if (disposed) return;

    if (!running() && pendingToast) showToast(pendingToast);
    else if (running() && toastEntry && !focusHost?.toastFocused()) { pendingToast = toastEntry; hideToast(); }
  }

  function onVisibility() { if (!document.hidden) void refresh(); }

  function onOnline() { void refresh(); }

  function configure(next: InboxOptions) {
    if (disposed) return;
    options = next;
    syncIdentity();

    if (!configured) {
      configured = true;
      load();
      pollTimer = setInterval(() => { if (!document.hidden && !running()) void refresh(); }, POLL_MS);
      document.addEventListener('visibilitychange', onVisibility);
      addEventListener('online', onOnline);
    }

    render();
  }

  if (initial) configure(initial);

  return {
    configure,
    getSnapshot: () => snapshot,
    subscribeView(listener: () => void) {
      viewListeners.add(listener);

      return () => { viewListeners.delete(listener); };
    },
    attachFocus(host: InboxFocusHost) {
      focusHost = host;

      return () => { if (focusHost === host) focusHost = undefined; };
    },
    open,
    act,
    clear() {
      if (disposed) return;
      entries = [];
      save();
      render();
    },
    holdToast,
    releaseToast,
    hoverToast(on: boolean) {
      hovered = on;

      if (on) holdToast();
      else releaseToast();
    },
    blurToast() {
      if (disposed) return;
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(releaseToast);
    },
    hideToast,
    refresh,
    notify,
    runChanged,
    get invites() { return invites; },
    get challenges() { return challengesListed; },
    subscribe(listener: InboxListener) {
      listeners.add(listener);

      return () => { listeners.delete(listener); };
    },
    // Marks these kinds' actions as waiting (none, once the request has landed).
    wait(kinds: string[]) {
      if (disposed) return;
      waiting = new Set(kinds);
      snapshot = { ...snapshot, rows: snapshot.rows.map((row) => ({ ...row, waiting: waiting.has(row.entry.kind) })),
        toast: snapshot.toast ? { ...snapshot.toast, waiting: waiting.has(snapshot.toast.entry.kind) } : null };

      for (const listener of viewListeners) listener();
    },
    // The room was opened another way: the toast for it goes and its entry counts as read. An
    // invitation only this device knew about is used up, since nothing else will close it.
    settle(id: string) {
      if (disposed) return;

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
    offer(id: string, text: string) {
      if (disposed) return;
      const entry = entries.find((value) => value.id === id);

      if (entry?.kind === 'challenge') showToast({ ...entry, text });
    },
    // A request this device discovered has lapsed: its toast goes and its entry closes.
    withdraw(id: string) {
      if (disposed) return;

      if (toastEntry?.id === id || pendingToast?.id === id) { pendingToast = null; hideToast(); }

      const known = entries.find((entry) => entry.id === id);

      if (known?.local && !known.closed) { known.closed = true; save(); render(); }
    },
    forget() {
      forgotten = true;
      void lifetime.close();
      pendingToast = null;
      hideToast();

      if (userId()) { try { localStorage.removeItem(STORE + userId()); localStorage.removeItem(DELIVERED + userId()); } catch {} }

      entries = [];
      invites = [];
      challengesListed = [];
      delivered = new Set();
      publish();
    },
    dispose() {
      disposed = true;
      void lifetime.close();
      clearInterval(pollTimer);
      clearTimeout(toastTimer);
      clearTimeout(releaseTimer);
      toastEntry = null;
      pendingToast = null;
      document.removeEventListener('visibilitychange', onVisibility);
      removeEventListener('online', onOnline);
      listeners.clear();
      viewListeners.clear();
      focusHost = undefined;
    },
  };
}

export type InboxController = ReturnType<typeof createInbox>;

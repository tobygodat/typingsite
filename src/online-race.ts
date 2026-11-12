import type { OnlineTypingSurface, OnlineTypingLease } from './typing-host.js';
import { flushSync } from 'react-dom';
import { AsyncLifetime, accountLifetime, abortable, WorkCancelled } from './async-runtime.js';
import { sameSignIn } from './account.js';
import { errorDetails } from './network.js';
import type { Session } from './network.js';
import type { Attempt } from './typing.js';
import type { RaceRoom, RaceEntry, RacePlayer, RaceCredentials, Friend, RaceInvite, PeopleLinks } from './multiplayer.js';
import type { RaceConditions } from './network-race.js';
import type { GhostChallenge } from './ghost-race.js';
import type { RaceOptions } from './race-options.js';
import type { PassageView } from './passage-view.js';
import type { RaceResult } from './race-result.js';
import type { RankCardController } from './rank-card.js';
import type { QuickMatchController } from './quick-match-view.js';
import type { PeopleController } from './challenge-people-view.js';
import type { RaceReviewController } from './race-review.js';
import type { InboxController } from './inbox.js';
import type { FriendsBoardController } from './friends-board.js';
import { createStore } from './store.js';
import { isRecord } from './domain-values.js';
import { isConditions } from './domain-history.js';

import { createAttempt, replayAttempt } from './typing.js';
import { raceConditions, raceOptions, racePassage, raceSetupText } from './race-options.js';
import { createTypingFx } from './motion.js';
import { encodeTrace, standIn, validTrace } from './ghost-race.js';
import * as multiplayer from './multiplayer.js';
import { RACE_LEADS, raceOutcome, raceResultText, rematchControls } from './race-result.js';
import { cardOutcome, ratingResult } from './quick-match.js';
import { peopleRows } from './challenge-people.js';

export type OnlineRaceMode = 'people' | 'add' | 'setup' | 'daily' | 'local';

export interface OnlineRaceHost { input: HTMLTextAreaElement; display: HTMLDivElement; wrap: HTMLDivElement }

interface Controllers { rankCard: RankCardController; people: PeopleController; quick: QuickMatchController; review: RaceReviewController }

export interface OnlineRaceOptions extends Controllers {
  getSession(): Session | null;
  signIn(): void;
  navigate(screen: string): void;
  renderText: typeof import('./passage-view.js').renderText;
  updateCharacterStates: typeof import('./passage-view.js').updateCharacterStates;
  setRunning(running: boolean): void;
  announce(text: string): void;
  onPassageSeen?(id: string): void;
  inbox: Pick<InboxController, 'refresh' | 'notify' | 'settle' | 'wait' | 'subscribe'>;
  board?: Pick<FriendsBoardController, 'show' | 'hide'>;
  onModeChange?(): void;
  wireTyping(input: HTMLTextAreaElement, surface: OnlineTypingSurface): OnlineTypingLease;
  practice(): Parameters<typeof raceOptions>[0];
  updateGlide?(element: HTMLElement): void;
  ownBest(): boolean;
  raceOwnBest(): void;
  raceGhost?(id: string): void;
}

export interface OnlineRaceSnapshot {
  mode: OnlineRaceMode; signedIn: boolean; room: RaceRoom | null; joining: boolean;
  busy: boolean; changingFriends: boolean; restoring: boolean; friends: readonly Friend[];
  peopleStatus: string; error: string; name: string; guestName: string; email: string;
  setup: RaceOptions; resetSetup: boolean; setupText: string; shareLink: string; inviteSent: string; accountInvite: string;
  help: string; connection: string; countdown: string; timer: string; passage: string;
  reviewNote: string; reviewState: 'waiting' | 'none'; finishRequested: boolean; befriended: boolean; controllers: Controllers | null;
}

type SentProgress = Parameters<typeof multiplayer.updateRaceProgress>[2] & { sequence: number; events: number; at: number };

export function roomStatus(room: RaceRoom, finished: boolean): string {
  const me = room.players?.find((player) => player.slot === room.selfSlot);
  const opponent = room.players?.find((player) => player.slot !== room.selfSlot);

  switch (room.status) {
    case 'waiting': return (room.players?.length ?? 0) < 2 ? 'Waiting for your opponent.'
      : room.rematchOf && !opponent?.connected && !opponent?.ready ? `Rematch sent. Waiting for ${opponent?.name} to join.` : 'Both players are here.';
    case 'countdown': return room.quick ? `Matched with ${opponent?.name || 'another racer'}.` : 'Both players are ready.';
    case 'racing': return room.quick && opponent?.left ? `${opponent.name} left the race. Finish your run to win.`
      : finished || me?.finished ? 'Waiting for the other player.' : room.quick ? 'Leaving now counts as a loss.' : 'The clock keeps running if you leave the passage.';
    case 'finished': return '';
    case 'cancelled': return room.quick ? 'The race was called off before the start.' : 'This race ended because a player left.';
    case 'expired': return 'This invitation has expired.';
    default: return 'Connecting to the race…';
  }
}

const sameIdentity = (a: Session | null, b: Session | null) => (a === null && b === null) || sameSignIn(a, b);

const stamp = (value: string | number | null | undefined) => typeof value === 'number' ? value : Date.parse(value ?? '');
const RESULT_RETAINED_MS = 23 * 60 * 60 * 1000;

// A finished race's results are watched for the other racer's Rematch pick: often while they are on
// screen, slowly otherwise.
const PICK_WATCH_MS = 1000;
const CLOSED_WATCH_MS = 3000;

// A racer's trace can reach the service well after the race closed: their tab may first wait out a request the
// service had already applied (15 s, as `request` in src/account.js allows), then send the trace up to three times,
// 2 s apart (sendSettledTrace). So a result still missing a trace reads the traces again, further apart each time,
// for a minute: at these times after the first read. A result whose traces are both there at the first read reads
// them once.
const TRACE_READS_AT = [0, 2, 4, 8, 16, 26, 36, 48, 60].map((seconds) => seconds * 1000);
const TRACE_SENDS = 3;
const TRACE_RETRY_MS = 2000;
const terminal = (room: RaceRoom | null) => Boolean(room?.status && ['finished', 'cancelled', 'expired'].includes(room.status));
const PENDING_INVITE = 'stilltype-race-invite-tab-v1';

// The race setup chosen in Race setup holds for this tab, a reload included; a new tab starts from practice.
const RACE_SETUP = 'stilltype-race-setup-tab-v1';

// Invitations dismissed from the people list on this device, per account. The service has no decline, so a dismissed
// invitation only leaves this list; it still lapses on its own, and the inbox keeps its entry.
const DISMISSED = 'stilltype-dismissed-invites-v1:';

// Tabs of this browser tell each other when a friend list changed, so every open Challenge redraws without a reload.
const PEOPLE_CHANNEL = 'stilltype-people';

// The views of the Challenge screen besides a race: the people list and what its foot links open.
const VIEWS: readonly OnlineRaceMode[] = ['people', 'add', 'setup', 'daily', 'local'];
const VIEW_FOCUS: Partial<Record<OnlineRaceMode, string>> = { add: 'people-add-heading', setup: 'people-setup-heading', daily: 'daily-heading', local: 'local-heading' };
const OPENERS: Partial<Record<OnlineRaceMode, string>> = { add: 'people-add', setup: 'people-setup', daily: 'open-daily', local: 'open-local' };

function pendingInvite() {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(PENDING_INVITE) ?? 'null');

    if (isRecord(saved) && typeof saved.savedAt === 'number' && typeof saved.href === 'string' && Date.now() - saved.savedAt < 15 * 60 * 1000) return multiplayer.parseRaceLink(saved.href);
    sessionStorage.removeItem(PENDING_INVITE);
  } catch {}

  return null;
}

function forgetPendingInvite() { try { sessionStorage.removeItem(PENDING_INVITE); } catch {} }

// Online runs use the same replay and passage renderer as practice. Only the service owns the
// shared start time and results; no online attempt is added to a profile or personal best.
export function createOnlineRace(initial?: OnlineRaceOptions) {
  let options: OnlineRaceOptions | null = null;
  let disposed = false;
  let started = false;
  let host: OnlineRaceHost | null = null;
  let fx: ReturnType<typeof createTypingFx> | null = null;
  let typing: OnlineTypingLease | null = null;
  let releaseTyping: (() => void) | null = null;
  let stopInbox: (() => void) | null = null;
  let clockTimer = 0;
  let startTimer = 0;
  const listeners = new AbortController();
  let work = new AsyncLifetime(accountLifetime());
  let raceWork = new AsyncLifetime(work);
  let identity: Session | null = null;

  const store = createStore<OnlineRaceSnapshot>({ mode: 'people', signedIn: false, room: null, joining: false,
    busy: false, changingFriends: false, restoring: false, friends: [], peopleStatus: '', error: '', name: '', guestName: '', email: '',
    setup: raceOptions(), resetSetup: false, setupText: '', shareLink: '', inviteSent: '', accountInvite: '',
    help: 'Type when the countdown ends. Paste and key repeat are off.', connection: '', countdown: '', timer: '', passage: '',
    reviewNote: '', reviewState: 'waiting', finishRequested: false, befriended: false, controllers: null });

  const getSession = () => options?.getSession() ?? null;
  const navigate = (screen: string) => options?.navigate(screen);
  const setRunning = (value: boolean) => options?.setRunning(value);
  const announce = (text: string) => options?.announce(text);
  const focus = (id: string | undefined) => { if (id) document.getElementById(id)?.focus(); };
  const current = () => store.getSnapshot();

  function publish(patch: Partial<OnlineRaceSnapshot> = {}) {
    if (disposed) return;
    store.publish({ ...current(), mode: view, room, signedIn: Boolean(getSession()), joining: Boolean(joinLink) && !room,
      busy, changingFriends, restoring, friends, finishRequested, befriended, ...patch });
  }

  function paint(patch: Partial<OnlineRaceSnapshot> = {}) { flushSync(() => publish(patch)); }

  async function request<A>(send: (signal: AbortSignal) => PromiseLike<A>, scope = work, roomBound = true): Promise<A> {
    const from = generation;
    const session = getSession();
    const result = await scope.run(abortable(send, errorDetails));

    if (disposed || (roomBound && from !== generation) || !sameIdentity(getSession(), session)) throw new WorkCancelled('The race changed.');

    return result;
  }

  let room: RaceRoom | null = null;
  let credentials: RaceCredentials | null = null;
  let joinLink = multiplayer.parseRaceLink(location.href) || pendingInvite();

  if (joinLink?.roomId && joinLink.inviteToken) {
    try { sessionStorage.setItem(PENDING_INVITE, JSON.stringify({ href: multiplayer.makeGuestRaceLink(joinLink, location.href), savedAt: Date.now() })); } catch {}
  }

  let attempt: Attempt | null = null;
  let textView: PassageView | null = null;
  let startPerf: number | null = null;
  let generation = 0;
  let pollTimer = 0;
  let busy = false;
  // This tab's race is being fetched again after a reload.
  let restoring = false;
  let changingFriends = false;
  let networkBusy = false;
  let dirty = false;
  // The service refused the last progress (a 4xx, not a lost connection): the room is read before more is sent.
  let refused = false;
  let finishRequested = false;
  // Every progress packet this race sent, each with the keys it covered, and the trace sent for the keys the service
  // settled on when it finished this seat on a packet that carried none (sendSettledTrace).
  let sentProgress: SentProgress[] = [];
  let settledTrace: Promise<boolean> | null = null;
  // The timers of this race's trace sends and reads, all cleared when the tab leaves the race; how many times this
  // tab's own trace has reached the service; and the wake for a read waiting for it.
  const traceTimers = new Set<ReturnType<typeof setTimeout>>();
  let ownTraceArrivals = 0;
  let wakeReads: (() => void) | null = null;
  let baseKeystrokes = 0;
  let baseErrors = 0;
  let baseTyped = '';
  let lastClock = '';
  let lastAnnouncement = '';
  let view: OnlineRaceMode = 'people';
  let friends: Friend[] = [];
  let friendsLoaded = false;
  // What the people list is drawn from: the inbox's invitations and ghost challenges, the service's links between them
  // and friend rows (null before its migration), and the invitations dismissed here.
  let invites: RaceInvite[] = [];
  let challenges: GhostChallenge[] = [];
  let links: PeopleLinks | null = null;
  let linkedIds = '';
  let linksBusy = false;
  let linksAgain = false;
  // Set once the service says it has no race_people: it isn't asked again until the page loads again.
  let linksMissing = false;
  let dismissed = new Set<string>();
  // Why the list can't be complete: the friend list's last read, and the invitations' last poll.
  let friendsFailure: Error | null = null;
  let invitesFailure: Error | null = null;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(PEOPLE_CHANNEL) : null;
  // The rematch room this tab is moving to, and the room whose traces it has read.
  let following: string | null = null;
  let tracesRead: string | null = null;

  // Every friend-list request goes through this queue, one at a time, and each reply is the list.
  // A friend list that changed (here, from another tab, or on the service) is read against the links again, so an
  // invitation or ghost from someone just saved joins their row, with the pair's tally.
  function createFriendRequests() { return multiplayer.queueFriendRequests<Friend[]>((list) => {
    const changed = JSON.stringify(list.map((friend) => friend.id).sort()) !== JSON.stringify(friends.map((friend) => friend.id).sort());

    if (disposed) return;
    friends = list;
    friendsLoaded = true;
    friendsFailure = null;
    renderFriends();
    renderPeople();

    if (changed) refreshLinks();
  },
    { load: (signal) => request((scopeSignal) => multiplayer.listFriends(getSession(), AbortSignal.any([signal, scopeSignal])), work, false) }); }

  let friendRequests = createFriendRequests();

  let befriended = false;

  // A stranger sees the race name, so the name filled in from the account's email is never sent to one.
  function strangerName() {
    const name = current().name.trim();

    return !name || name === getSession()?.user.email?.split('@')[0]?.slice(0, 24) ? 'Racer' : name;
  }

  // The settled result the card shows, so a room update that doesn't change it never replays it.
  let shownResult = '';

  function error(message = '') { paint({ error: message }); }

  function say(message: string) {
    if (message === lastAnnouncement) return;
    lastAnnouncement = message;
    announce(message);
  }

  // A race (waiting, racing or its results) or a guest's invitation takes the people view's place. The other views
  // open from the people list's foot and come back to it; none opens while a race is under way.
  const live = () => Boolean(room && !terminal(room));

  function show(next: OnlineRaceMode, { focus: moveFocus = false } = {}) {
    if (!VIEWS.includes(next) || (next !== 'people' && live())) return;
    const from = view;
    view = next;
    setRunning(false);
    renderHome();

    if (view === 'people') { fx?.relayout(); void refreshInvites(); options?.quick.refresh(); void refreshLinks(); }

    if (view === 'setup') renderCustomize();
    options?.onModeChange?.();

    if (view === 'daily') options?.board?.show(); else options?.board?.hide();

    if (!moveFocus) return;
    focus(VIEW_FOCUS[view] ?? OPENERS[from] ?? 'compete-heading');
  }

  function renderHome() {
    if (!getSession() && (view === 'add' || view === 'setup')) view = 'people';
    const name = current().name || getSession()?.user.email?.split('@')[0]?.slice(0, 24) || '';
    paint({ name, guestName: current().guestName || name });
    options?.quick.render();
    renderPeople();
  }

  // The people list, drawn from the records as they stand now. A guest has no list.
  function renderPeople() {
    renderSetupLink();
    const rows: Parameters<PeopleController['update']>[0] = getSession() ? peopleRows({ friends, invites, challenges, links, dismissed, now: Date.now() }) : [];

    if (getSession() && !rows.length && friendsLoaded) rows.push({ key: 'link', kind: 'link', state: 'link', name: 'A friend', line: null, tally: null });
    options?.people.update(rows);
    paint({ peopleStatus: getSession() ? (friendsFailure || invitesFailure)?.message || '' : '' });
  }

  // The inbox polls invitations and ghost challenges for every view; the people list reads the same lists.
  function onInbox(invitations: RaceInvite[], failure: Error | null, listed: GhostChallenge[]) {
    invites = invitations;
    challenges = Array.isArray(listed) ? listed : challenges;
    invitesFailure = failure;
    pruneDismissed();
    renderPeople();
    const ids = [...invites.map((invite) => invite.id), ...challenges.map((challenge) => challenge.id)].sort().join();

    if (ids !== linkedIds) refreshLinks();
  }

  // The service's links, read again when the records they tie together change. One read at a time; a change while
  // one is out reads once more after it.
  async function refreshLinks() {
    const session = getSession();

    if (!session || linksMissing || document.body.dataset.view !== 'compete') return;

    if (linksBusy) {
      linksAgain = true;

      return;
    }

    linksBusy = true;
    const ids = [...invites.map((invite) => invite.id), ...challenges.map((challenge) => challenge.id)].sort().join();

    try {
      const read = await request((signal) => multiplayer.listPeopleLinks(session, signal), work, false);

      linksMissing = read === null;

      if (getSession() === session) { links = read; linkedIds = ids; renderPeople(); }
    } catch {} finally {
      if (!disposed && sameIdentity(getSession(), session)) {
        linksBusy = false;

        if (linksAgain) { linksAgain = false; refreshLinks(); }
      }
    }
  }

  const dismissedKey = () => `${DISMISSED}${getSession()?.user.id}`;

  function loadDismissed() {
    dismissed = new Set<string>();

    if (!getSession()) return;

    try {
      const saved: unknown = JSON.parse(localStorage.getItem(dismissedKey()) ?? 'null');

      if (Array.isArray(saved)) dismissed = new Set(saved.filter((id) => typeof id === 'string'));
    } catch {}
  }

  function saveDismissed() {
    try { localStorage.setItem(dismissedKey(), JSON.stringify([...dismissed])); } catch {}
  }

  // Only invitations the service still lists need remembering.
  function pruneDismissed() {
    const listed = new Set(invites.map((invite) => invite.id));

    if ([...dismissed].every((id) => listed.has(id))) return;
    dismissed = new Set([...dismissed].filter((id) => listed.has(id)));
    saveDismissed();
  }

  function dismissInvite(roomId: string) {
    dismissed.add(roomId);
    saveDismissed();
    options?.inbox.settle(`invite:${roomId}`);
    renderPeople();
  }

  async function refreshInvites() {
    if (!getSession()) return;
    await options?.inbox.refresh();
  }

  function racerName() {
    return current().name.trim() || getSession()?.user.email?.split('@')[0]?.slice(0, 24) || 'Racer';
  }

  // From this screen, a toast or the inbox. A live race has to be left first, so nobody is
  // abandoned mid-race by a notification.
  function joinInvite(roomId: string) {
    if (busy) return;
    navigate('compete');
    show('people');

    if (room && !terminal(room)) {
      if (room.id !== roomId) error('Leave your current race before joining another.');

      return;
    }

    perform(async () => {
      const result = await request((signal) => multiplayer.joinRace(getSession(), { roomId, guestToken: credentials?.guestToken, displayName: racerName() }, signal));
      enterRoom(result);
    });
  }

  // A rematch keeps the race's conditions with a fresh passage. A race from before options was a medium quote.
  function rematchPassage(conditions: RaceConditions = {}) {
    return racePassage({ mode: 'quote', quoteLength: 'medium', difficulty: 'any', ...conditions }, { seenIds: conditions.textId ? [conditions.textId] : [] });
  }

  // Same opponent, same settings, a fresh passage. Picks Rematch on a closed race, or takes the pick back;
  // once both have picked, the service opens the next race and both tabs move to it (followRematch).
  function pickRematch(from: RaceCredentials, conditions: RaceConditions = {}, want = true) {
    if (busy) return;
    navigate('compete');
    show('people');

    if (room && !terminal(room)) {
      error('Leave your current race before starting another.');

      return;
    }

    perform(async () => {
      const passage = want ? rematchPassage(conditions) : null;
      const result = await request((signal) => multiplayer.rematchRace(getSession(), from, { want, passage: passage ?? undefined, conditions: passage ? { ...conditions, textId: passage.id } : {} }, signal));

      // The same race comes back with the pick, unless this seat moved: a service from before picks opens
      // or joins the rematch at once.
      if (room && result.roomId === room.id) applyRoom(result.room);
      else enterRoom(result);
    });
  }

  // Both picked: the service opened the next race, already counting down, and this seat moves to it.
  function followRematch() {
    const me = self();

    if (!room?.rematchId || !me?.rematch || following === room.rematchId || !credentials) return;
    following = room.rematchId;
    const from = credentials;
    const roomId = room.rematchId;
    void (async () => {
      try {
        const result = await request((signal) => multiplayer.joinRace(getSession(), { roomId, guestToken: from.guestToken, displayName: me.name || 'Racer' }, signal), raceWork);

        if (credentials === from) enterRoom(result);
      } catch (failure) {
        if (credentials !== from || disposed) return;
        following = null;

        if (failure instanceof WorkCancelled) return;
        error(errorDetails(failure).message || 'The race service is unavailable. Try again.');
      }
    })();
  }

  // Add a friend's list: each friend with Remove. A friend whose row goes (just removed) hands keyboard focus to
  // the email field.
  function renderFriends() { paint(); }

  // One press on a friend's Race invites them to a race on the race setup.
  function raceFriend(friendId: string) {
    const friend = friends.find((value) => value.id === friendId);

    if (!friend) return;
    perform(async () => {
      const result = await request((signal) => multiplayer.createRace(getSession(), { ...newRace(), displayName: racerName(), friendId: friend.id }, signal));
      enterRoom(result);
      paint({ accountInvite: friend.email ? `If ${friend.email} has an account, the challenge is waiting in their inbox.` : `The challenge is waiting in ${friend.name}’s inbox.` });
    });
  }

  // One press opens a race anyone with its link can join, and copies the link.
  function raceLink() {
    perform(async () => {
      const result = await request((signal) => multiplayer.createRace(getSession(), { ...newRace(), displayName: racerName() }, signal));
      enterRoom(result);
      await copyLink();
    });
  }

  async function copyLink() {
    const from = credentials;

    try {
      await navigator.clipboard.writeText(current().shareLink);

      if (disposed || credentials !== from) return;
      paint({ inviteSent: 'Link copied. Anyone with it can join for 15 minutes.' });
    } catch {
      if (disposed || credentials !== from) return;
      const input = document.getElementById('online-guest-link');

      if (input instanceof HTMLInputElement) { input.focus(); input.select(); }

      paint({ inviteSent: 'Select and copy the link above. Anyone with it can join for 15 minutes.' });
    }
  }

  async function loadFriends() {
    const session = getSession();

    if (!session) return;

    try { await friendRequests.reload(); }
    catch (failure) {
      if (disposed || !sameIdentity(getSession(), session)) return;

      if (!friendsLoaded) { friendsFailure = errorDetails(failure); renderPeople(); }
    }
  }

  // A race takes the practice setup until Race setup changes it; the change holds for this tab's races, reloads
  // included, until Match practice puts the practice setup back. A saved setup is read back through raceOptions, so
  // only a setup a race can take returns.
  let customized = (() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(RACE_SETUP) ?? 'null');

      return isRecord(saved) && isConditions(saved) ? raceOptions({ ...saved, session: 'practice', adaptive: false }) : null;
    } catch { return null; }
  })();

  function setCustomized(value: RaceOptions | null) {
    customized = value;

    try {
      if (value) sessionStorage.setItem(RACE_SETUP, JSON.stringify(value));
      else sessionStorage.removeItem(RACE_SETUP);
    } catch {}

    renderSetupLink();
  }

  function newRace() {
    const conditions = raceConditions(customized ?? raceOptions(options?.practice() ?? {}));

    const passage = racePassage(conditions);

    if (!passage) throw new Error('No passage is available for this race.');

    return { passage, conditions };
  }

  // What the race setup shows and races start from: the setup chosen here, or else practice's.
  const raceSetup = () => customized ?? raceOptions(options?.practice() ?? {});

  // The same setup, whatever order its options were written in.
  const sameSetup = (a: RaceOptions, b: RaceOptions) => JSON.stringify(Object.entries(raceConditions(a)).sort()) === JSON.stringify(Object.entries(raceConditions(b)).sort());

  // The Race setup link names what a one-press Race (and Copy a race link, and Race once) uses, as a conditions line.
  function renderSetupLink() { paint({ setupText: raceSetupText(raceConditions(raceSetup())) }); }

  function renderCustomize() {
    paint({ setup: raceSetup(), resetSetup: Boolean(customized && !sameSetup(customized, raceOptions(options?.practice() ?? {}))) });
  }

  // One race action at a time, and apart from those, one friend-list change at a time. While one is
  // in flight, every control that starts another of its kind (for races, also in the inbox and on the
  // toast) is aria-disabled and its press is ignored: aria-disabled, not disabled, so the control just
  // pressed keeps keyboard focus, and no press is dropped unseen. A friend change waiting its turn
  // behind a slow friend-list read holds up no race.
  function renderBusy() {
    options?.people.setBusy(busy);
    options?.inbox.wait(busy ? ['invite', 'result'] : []);
    paint();
  }

  async function changeFriends(send: (signal: AbortSignal) => PromiseLike<Friend[]>) {
    if (changingFriends) return false;
    changingFriends = true;
    const session = getSession();
    renderBusy();
    error();

    try {
      await friendRequests.change((signal) => request((scopeSignal) => send(AbortSignal.any([signal, scopeSignal])), work, false));
      channel?.postMessage({ user: getSession()?.user.id, friends: true });
      refreshLinks();

      return true;
    }
    catch (failure) {
      if (!(failure instanceof WorkCancelled) && !disposed && sameIdentity(getSession(), session)) error(errorDetails(failure).message || 'The race service is unavailable. Try again.');

      return false;
    }
    finally { if (!disposed && sameIdentity(getSession(), session)) { changingFriends = false; renderBusy(); } }
  }

  async function perform(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    const session = getSession();
    renderBusy();
    error();

    try { await action(); } catch (failure) { if (!(failure instanceof WorkCancelled) && !disposed && sameIdentity(getSession(), session)) error(errorDetails(failure).message || 'The race service is unavailable. Try again.'); }
    finally {
      if (!disposed && sameIdentity(getSession(), session)) {
        busy = false;
        renderBusy();

        if (room) renderRoom();
      }
    }
  }

  function resetAttempt() {
    attempt = null; textView = null; startPerf = null;
    baseTyped = ''; baseKeystrokes = 0; baseErrors = 0;
    dirty = false; refused = false; finishRequested = false;
    sentProgress = []; settledTrace = null;

    for (const timer of traceTimers) clearTimeout(timer);
    traceTimers.clear(); wakeReads = null;
    clearTimeout(startTimer);
    lastClock = ''; lastAnnouncement = '';

    if (host) { host.input.value = ''; host.input.disabled = true; }

    options?.review.hide(); tracesRead = null; befriended = false;
    paint({ reviewNote: '', countdown: '', help: 'Type when the countdown ends. Paste and key repeat are off.', connection: '', accountInvite: '', passage: '' });
    setRunning(false);
  }

  function enterRoom(result: RaceEntry) {
    // Any other room ends a quick match search; a paired one is where the search led.
    if (!result.room?.quick) options?.quick.leave();
    const nextId = result.roomId || result.room.id;
    // Going on to another race leaves a closed one, so its other racer sees that; its own rematch doesn't.
    const left = room && credentials && terminal(room) && ![room.id, room.rematchId].includes(nextId) ? credentials : null;

    if (left) void request((signal) => multiplayer.leaveRace(getSession(), left, signal)).catch(() => {});
    generation += 1;
    networkBusy = false;
    void raceWork.close();
    raceWork = new AsyncLifetime(work);
    clearTimeout(pollTimer);
    resetAttempt();
    credentials = { roomId: result.roomId || result.room.id };

    if (result.guestToken) credentials.guestToken = result.guestToken;

    if (result.inviteToken) credentials.inviteToken = result.inviteToken;
    multiplayer.rememberRace(credentials);
    joinLink = null;
    forgetPendingInvite();
    history.replaceState(history.state, '', multiplayer.clearRaceLink(location.href));
    paint({ shareLink: result.inviteToken ? multiplayer.makeGuestRaceLink({ roomId: result.roomId, inviteToken: result.inviteToken }, location.href) : '', inviteSent: '' });
    room = result.room;

    options?.inbox.settle(`invite:${room.id}`);
    renderHome();
    applyRoom(room, { entering: true });
    pollTimer = setTimeout(poll, 150);
    navigate('compete');
    show('people');
  }

  function self() { return room?.players?.find((player) => player.slot === room?.selfSlot); }

  function prepareAttempt() {
    const passage = typeof room?.passage === 'string' ? { id: room.id, text: room.passage } : room?.passage;

    if (attempt || !passage?.text || !room || !host || !fx || !options) return;
    const me = self();
    attempt = createAttempt({ id: crypto.randomUUID(), text: passage.text, textId: passage.id, kind: 'race', conditions: room.conditions });
    attempt.startedAt = 0;
    baseTyped = me?.typed || '';
    baseKeystrokes = me?.keystrokes || 0;
    baseErrors = me?.errors || 0;

    // A resumed race keeps its authoritative counters. The synthetic prefix is only for drawing
    // and editing; it never contributes to the server's insertion or error totals.
    if (baseTyped) {
      attempt.events.push({ type: 'insert', text: baseTyped, accepted: true, offsetMs: 0 });
      attempt.status = 'running';
    }

    textView = options.renderText(host.display, attempt.text);
    textView.ensureAhead(baseTyped.length);
    options.updateCharacterStates(textView.characters, baseTyped, attempt.text, 0);
    fx.reset(textView.characters);
    fx.update(baseTyped.length, 'delete', false);
    host.input.value = baseTyped;
    paint({ passage: attempt.text });
    options.onPassageSeen?.(room.conditions?.textId || passage.id);
    finishRequested = Boolean(me?.finished);
  }

  function opponentOf(value: RaceRoom | null) { return value?.players?.find((player) => player.slot !== value.selfSlot); }

  function applyRoom(next: RaceRoom, { entering = false } = {}) {
    const previousStatus = room?.status;
    const previousOpponent = room?.id === next.id ? opponentOf(room) : null;
    room = next;
    notifyChanges(previousStatus, previousOpponent, entering);

    // The shared start on this tab's clock. The service stamps serverNow before its reply leaves, so a reply that
    // took long (a join that landed late) puts the start late by that long, and this tab would race on after the
    // service's clock ran out. Every reply bounds the start again, and the earliest is kept.
    const start = room.startAt ? performance.now() + stamp(room.startAt) - stamp(room.serverNow) : null;

    if (start !== null && (startPerf === null || start < startPerf)) {
      startPerf = start;
      clearTimeout(startTimer);
      startTimer = window.setTimeout(updateClock, startPerf - performance.now());
    }

    startIfDue();

    if (room.status === 'countdown' || room.status === 'racing') prepareAttempt();
    sendSettledTrace();
    renderRoom();
    updateClock();

    if (terminal(room)) {
      // A closed room is polled for about a day, for the other racer's Rematch pick. Only the reply that
      // closes it ends this race's run, and only on Challenge: on any other view the run in progress is
      // the person's own (leaving Challenge already ended this one, in onViewChange).
      if (previousStatus !== room.status && document.body.dataset.view === 'compete') setRunning(false);

      if (host) host.input.disabled = true;

      if (room.status === 'finished') renderResults();

      if (previousStatus !== room.status) say(room.status === 'finished' ? resultSentence() : roomStatus(room, finishRequested));

      if (room.quick && previousStatus !== room.status) options?.quick.refresh();
      followRematch();
    }
  }

  // Who won, as each result card shows it: [mine, theirs]. A quick match reads its settled rated result, the one
  // record the tally and the rating line read too, so a run that couldn't be checked is never the winner. Every
  // other race reads the speeds.
  function outcomes(me: RacePlayer, opponent: RacePlayer): [string, string] {
    return room?.quick ? [cardOutcome(me), cardOutcome(opponent)] : [raceOutcome(me, opponent), raceOutcome(opponent, me)];
  }

  // "You beat", "You tied with", or "You raced" when this racer didn't win (or nobody did).
  const leadOf = (me: RacePlayer, opponent: RacePlayer) => { const outcome = outcomes(me, opponent)[0];

 return outcome === 'won' ? RACE_LEADS.won : outcome === 'tied' ? RACE_LEADS.tied : RACE_LEADS.lost; };

  // The result as one sentence, as the inbox keeps it: "You beat Lin: 72 wpm to 65."
  function resultSentence() {
    const me = self();
    const opponent = opponentOf(room);

    if (!me || !opponent) return 'Race complete.';

    return raceResultText({ lead: leadOf(me, opponent), opponent: opponent.name || 'The other racer', wpm: [me.wpm || 0, opponent.wpm || 0] });
  }

  const away = () => document.hidden || document.body.dataset.view !== 'compete';

  // Inbox entries for this room: the opponent arriving, a rematch request and the result.
  // `entering` is a room opened or recovered after a reload: its result is recorded without a toast.
  function notifyChanges(previousStatus: RaceRoom['status'] | undefined, previousOpponent: RacePlayer | null | undefined, entering: boolean) {
    const opponent = opponentOf(room);

    if (!room) return;

    if (room.status === 'waiting' && opponent?.connected && !previousOpponent?.connected && previousStatus
      && (room.selfSlot === 1 || room.rematchOf)) {
      options?.inbox.notify({ id: `joined:${room.id}`, kind: 'joined', roomId: room.id,
        text: room.rematchOf ? `${opponent.name} is back for the rematch.` : `${opponent.name} joined your race.` }, { toast: away() });
    }

    const justFinished = previousStatus && previousStatus !== 'finished';

    if (room.status === 'finished' && opponent && (justFinished || entering)) {
      const me = self();

      if (!me) return;
      const lead = leadOf(me, opponent);
      // Finished rooms are deleted a day after they expire, so Race again lapses a little before.
      const until = new Date(Date.parse(room.expiresAt || new Date().toISOString()) + RESULT_RETAINED_MS).toISOString();
      // Saved in wpm, like every speed; the inbox words it in the unit chosen when it is shown.
      const race: RaceResult = { lead, opponent: opponent.name || 'The other racer', wpm: [me.wpm || 0, opponent.wpm || 0] };
      options?.inbox.notify({ id: `result:${room.id}`, kind: 'result', roomId: room.id, until,
        conditions: room.conditions, race, text: raceResultText(race) }, { toast: justFinished && away() });
    }
  }

  function renderAfter() { paint(); }

  function showResult(key: string, result: ReturnType<typeof ratingResult> = null) {
    if (key === shownResult) return;
    shownResult = key;

    if (key) options?.rankCard.show(result); else options?.rankCard.clear();
  }

  function renderRoom() {
    if (!room) return;
    const result = room.quick ? ratingResult(room.rating, opponentOf(room)?.name) : null;
    const carded = Boolean(result && result.kind !== 'unrated');

    if (result) options?.quick.seen(room.id);
    showResult(carded && result ? `${room.id}:${result.sentence}` : '', result);
    paint({ accountInvite: room.status === 'waiting' ? current().accountInvite : '', shareLink: room.status === 'waiting' ? current().shareLink : '' });
  }

  // The service starts a counted-down room on the first request after its start time; this tab starts
  // it on the shared clock instead, so typing opens when the countdown ends rather than a poll later.
  function startIfDue() {
    if (room?.status === 'countdown' && startPerf !== null && performance.now() >= startPerf) {
      room = { ...room, status: 'racing' };
      renderRoom();
    }
  }

  function updateClock() {
    startIfDue();

    if (!room || startPerf === null || terminal(room)) return;
    const delta = performance.now() - startPerf;
    const remaining = Math.max(0, (room.duration || 60) * 1000 - delta);
    const countdown = delta < 0 ? `Starting in ${Math.ceil(-delta / 1000)}` : '';

    if (countdown !== lastClock) { paint({ countdown }); lastClock = countdown; }

    const timer = delta < 0 ? `${room.duration || 60} s race` : `${Math.ceil(remaining / 1000)} s remaining`;

    if (current().timer !== timer) paint({ timer });
    const me = self();
    // An accent commit typed before the limit is scored first, though the key that ended it comes after.
    const pending = typing?.pending() ?? false;
    const canType = room.status === 'racing' && delta >= 0 && (remaining > 0 || pending) && !finishRequested && !me?.finished;
    const wasDisabled = host?.input.disabled ?? true;

    if (host) host.input.disabled = !canType;

    if (canType && wasDisabled && document.body.dataset.view === 'compete' && view === 'people') {
      fx?.relayout();
      host?.input.focus({ preventScroll: true });
      say('The race has started. Type the passage.');
    }

    if (delta >= 0 && remaining === 0 && !finishRequested && attempt && !pending) {
      finishRequested = true;
      attempt.endedAt = (room.duration || 60) * 1000;
      dirty = true;

      if (document.body.dataset.view === 'compete') setRunning(false);

      paint({ help: 'Time’s up. Sending your result…' });
      poll();
    }
  }

  // A closed race with two players keeps a watch, so each sees the other's Rematch pick and both move to
  // the rematch together, until the service is due to delete the room.
  const watchingRematch = () => terminal(room) && room?.players?.length === 2
    && Date.now() < Date.parse(room?.expiresAt ?? '') + RESULT_RETAINED_MS;

  const resultsInView = () => room?.status === 'finished' && !away() && view === 'people';

  async function poll() {
    if (disposed || !room || !credentials || networkBusy || (terminal(room) && !watchingRematch())) return;
    clearTimeout(pollTimer);
    const currentGeneration = generation;
    const currentCredentials = credentials;
    networkBusy = true;
    let failed = false;

    try {
      let next;

      if (dirty && attempt && startPerf !== null && room.status === 'racing' && !refused) {
        const replay = replayAttempt(attempt);
        const target = attempt.text;
        const prefixErrors = [...baseTyped].filter((char, index) => char !== target[index]).length;
        // The service takes printable ASCII, as passages are: any other letter (an accent key's é) is a
        // mistake, sent as a stand-in that differs from the letter expected there.
        const typed = replay.typed.replace(/[^ -~]/g, (char, index) => standIn(target[index] ?? ''));
        // A finished run sends its keystroke trace for the graph and replay; a race resumed after a reload
        // has no record of the keys before it, so it sends none.
        const trace = finishRequested && !baseTyped ? encodeTrace(attempt) : null;
        const payload = { typed, keystrokes: baseKeystrokes + replay.insertions - baseTyped.length, errors: baseErrors + replay.mistakes - prefixErrors, finished: finishRequested, trace };
        dirty = false;
        const keys = { events: attempt.events.length, at: performance.now() - startPerf };
        next = await request((signal) => multiplayer.updateRaceProgress(getSession(), currentCredentials, payload, (sequence) => sentProgress.push({ ...payload, ...keys, sequence }), signal), raceWork);
      } else {
        next = await request((signal) => multiplayer.getRace(getSession(), currentCredentials, signal), raceWork);
        refused = false;
      }

      if (disposed || currentGeneration !== generation) return;
      paint({ connection: '' });
      applyRoom(next);
    } catch (failure) {
      if (disposed || currentGeneration !== generation) return;
      failed = true;
      // A refusal is the service's answer about the room (cancelled, expired, out of limits), so the next
      // poll reads the room instead of sending the same progress again. A lost connection just retries.
      const details = errorDetails(failure);
      refused = (details.status ?? 0) >= 400 && (details.status ?? 0) < 500;
      dirty ||= Boolean(attempt);
      paint({ connection: refused ? '' : `Connection interrupted. Retrying… ${details.message || ''}` });
    } finally {
      if (currentGeneration === generation) {
        networkBusy = false;

        if (!disposed && credentials && !terminal(room)) pollTimer = setTimeout(poll, dirty && finishRequested && !failed ? 0 : 650);
        else if (!disposed && credentials && watchingRematch()) pollTimer = setTimeout(poll, resultsInView() ? PICK_WATCH_MS : CLOSED_WATCH_MS);
      }
    }
  }

  // You on the left, them on the right, the pair's tally between. The winner reads larger and brighter,
  // and the tally figure this race raised is the accent. Under each result, its Rematch control.
  function renderResults() {
    paint();
    void readTraces();
  }

  // The service finishes a seat on its own clock: progress that lands after it (sent just before this tab's clock ran
  // out, or from a tab whose clock ran late) finishes the run on the keys it carried, with no trace. The service keeps
  // a trace sent after that when it replays to the same result, so this tab sends one for exactly those keys: the
  // events up to the packet the service settled on. Which packet that was is the sequence number the service reports
  // for the seat, never what this tab heard back: a request can fail after the service applied it, and the tab's own
  // finish that follows holds keys the service never took, so its trace can't be kept; or that finish can fail on its
  // way, and the service settle the seat on an earlier packet. Every packet sent is kept for this, so a run of failed
  // sends can't push the settled one out. A send of the trace that fails is tried again. A
  // quick match is left alone: its seat finishes only with its own finishing packet (ADR 0014), so this never happens
  // there.
  function sendSettledTrace() {
    const me = self();

    if (!room || !credentials || room.quick || !me?.finished || settledTrace || !attempt || baseTyped) return;
    const settled = sentProgress.find((sent) => sent.sequence === me.sequence);

    // Settled on a finishing packet, which carried this run's trace itself.
    if (!settled || settled.trace) return;
    const trace = encodeTrace({ ...attempt, events: attempt.events.slice(0, settled.events), endedAt: settled.at });

    if (!trace) return;
    finishRequested = true;
    const from = credentials;
    const { typed, keystrokes, errors } = settled;

    // Resolves true once the service has the trace, false once every send has failed.
    settledTrace = (async () => {
      for (let send = 1; send <= TRACE_SENDS; send += 1) {
        try {
          await request((signal) => multiplayer.updateRaceProgress(getSession(), from, { typed, keystrokes, errors, finished: true, trace }, undefined, signal), raceWork);

          if (credentials !== from) return false;
          ownTraceArrivals += 1;
          wakeReads?.();

          return true;
        } catch {
          if (disposed || credentials !== from) return false;

          if (send < TRACE_SENDS) await tracePause(TRACE_RETRY_MS);
        }
      }

      return false;
    })();
  }

  // Leaving the race clears this wait without reviving the old trace reader.
  function tracePause(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        traceTimers.delete(timer);
        resolve();
      }, ms);

      traceTimers.add(timer);
    });
  }

  // What the results say in Graph and Replay's place, at their size, while a trace is missing, and once it won't come.
  function reviewNote(text: string, state: 'waiting' | 'none' = 'waiting') { paint({ reviewNote: text, reviewState: state }); }

  // Whose keystrokes a read found missing: 'mine', 'theirs', 'both', or 'unread' when no read has answered.
  const missingCopy = {
    waiting: { mine: 'your keystrokes arrive', theirs: (name: string) => `${name}’s keystrokes arrive`, both: 'both racers’ keystrokes arrive', unread: 'the race service answers' },
    none: { mine: 'your keystrokes didn’t arrive', theirs: (name: string) => `${name}’s keystrokes didn’t arrive`, both: 'neither racer’s keystrokes arrived', unread: 'the race service didn’t answer' },
  };

  const missingText = (state: 'waiting' | 'none', missing: 'mine' | 'theirs' | 'both' | 'unread', name: string) => {
    const part = missingCopy[state][missing];

    return typeof part === 'function' ? part(name) : part;
  };

  // Both racers' traces draw the graph and the replay. Reads go on while a trace is missing (TRACE_READS_AT), and a
  // trace this tab sent itself wakes the read waiting for it; meanwhile the results say whose keystrokes they wait
  // for, in Graph and Replay's place. When the reads run out, the results say whose never came. A race this tab
  // resumed after a reload has no record of the keys before it, so it says so at once.
  async function readTraces() {
    if (!room || !credentials || tracesRead === room.id) return;
    tracesRead = room.id;
    const from = credentials;
    const { text } = room.passage;
    const name = opponentOf(room)?.name || 'The other racer';

    if (baseTyped) {
      reviewNote('No Graph or Replay for this race: it was resumed after a reload, so your keystrokes weren’t all recorded.', 'none');

      return;
    }

    // This tab's own trace, when it went after the service finished the seat, is usually there within a moment.
    if (settledTrace) await Promise.race([settledTrace, tracePause(TRACE_READS_AT[1] ?? 2000)]);

    if (disposed || credentials !== from) return;
    let missing: 'mine' | 'theirs' | 'both' | 'unread' = 'unread';

    for (const [index, at] of TRACE_READS_AT.entries()) {
      const arrivals = ownTraceArrivals;
      let traces = null;

      try { traces = await request((signal) => multiplayer.getRaceTraces(getSession(), from, signal), raceWork); } catch {}

      if (disposed || credentials !== from) return;

      if (traces) {
        const seat = (mineToo: boolean) => {
          const trace = traces.find((entry) => (entry.slot === room?.selfSlot) === mineToo)?.trace;

          return validTrace(trace) ? trace : null;
        };

        const [mine, theirs] = [seat(true), seat(false)];

        if (mine && theirs) {
          reviewNote('');
          options?.review.show({ text, mine, theirs, name });

          return;
        }

        missing = mine ? 'theirs' : theirs ? 'mine' : 'both';
      }

      if (index === TRACE_READS_AT.length - 1) break;
      reviewNote(`Graph and Replay appear when ${missingText('waiting', missing, name)}.`);

      // A trace of this tab's own that arrived during the read is read again at once.
      if (ownTraceArrivals === arrivals) {
        await Promise.race([tracePause((TRACE_READS_AT[index + 1] ?? at) - at), new Promise<void>((resolve) => { wakeReads = resolve; })]);
        wakeReads = null;
      }

      if (disposed || credentials !== from) return;
    }

    reviewNote(`No Graph or Replay for this race: ${missingText('none', missing, name)}.`, 'none');
  }

  async function leave() {
    options?.quick.leave();
    const previous = credentials;
    const session = getSession();
    const rated = room?.quick;
    generation += 1;
    networkBusy = false;
    void raceWork.close();
    raceWork = new AsyncLifetime(work);
    clearTimeout(pollTimer);
    credentials = null;
    room = null;
    showResult('');
    multiplayer.forgetRace();
    resetAttempt();
    paint({ shareLink: '' });
    renderHome();

    if (previous) {
      try { await request((signal) => multiplayer.leaveRace(getSession(), previous, signal)); }
      catch (failure) { if (!(failure instanceof WorkCancelled) && !disposed && sameIdentity(getSession(), session)) error(`You left this tab’s race. ${errorDetails(failure).message || 'The server will close the room when it expires.'}`); }
    }

    if (rated) options?.quick.refresh();
  }

  function wireHost() {
    releaseTyping?.();
    releaseTyping = null;

    if (!host || !options || disposed) return;
    const attached = host;
    const signal = new AbortController();
    typing = options.wireTyping(attached.input, {
      get attempt() { return attempt; },
      get origin() { return startPerf; },
      get view() { return textView && fx ? { input: attached.input, characters: textView.characters, textView, fx } : null; },
      accepting: (at) => Boolean(room?.status === 'racing' && !finishRequested && !self()?.finished && startPerf !== null
        && at >= startPerf && at - startPerf < (room.duration || 60) * 1000),
      notice(message) { paint({ help: message }); },
      changed() {
        dirty = true;

        if (attempt?.status === 'running' && document.body.dataset.view === 'compete') setRunning(true);
      },
      finish() {
        if (!attempt || startPerf === null) return;
        finishRequested = true;
        attempt.endedAt = Math.max(0, performance.now() - startPerf);
        attached.input.disabled = true;
        paint({ help: 'Passage complete. Sending your result…' });
        setRunning(false);
        void poll();
      },
    });
    const lease = typing;
    attached.input.addEventListener('keydown', (event) => {
      if (event.repeat || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
        || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) event.preventDefault();
      lease.keydown(event);
    }, { signal: signal.signal });
    attached.input.addEventListener('paste', (event) => { event.preventDefault(); paint({ help: 'Paste is off. Type the passage.' }); }, { signal: signal.signal });
    attached.input.addEventListener('drop', (event) => event.preventDefault(), { signal: signal.signal });
    attached.input.addEventListener('blur', () => {
      if (room?.status === 'racing' && !finishRequested) paint({ help: 'Click the passage to continue. The race clock is still running.' });
    }, { signal: signal.signal });
    releaseTyping = () => { signal.abort(); lease.dispose();

 if (typing === lease) typing = null; };

    if (attempt) {
      textView = options.renderText(attached.display, attempt.text);
      const typed = replayAttempt(attempt).typed;
      textView.ensureAhead(typed.length);
      options.updateCharacterStates(textView.characters, typed, attempt.text, 0);
      fx?.reset(textView.characters);
      fx?.update(typed.length, 'delete', false);
      attached.input.value = typed;
    } else if (room && (room.status === 'countdown' || room.status === 'racing')) prepareAttempt();
    updateClock();
  }

  function checkIdentity() {
    const session = getSession();

    if (sameIdentity(identity, session)) { identity = session;

 return; }

    const keepGuestSeat = Boolean(credentials?.guestToken && room);
    identity = session;
    following = null;
    generation += 1;
    void work.close();
    work = new AsyncLifetime(accountLifetime());
    raceWork = new AsyncLifetime(work);
    clearTimeout(pollTimer);

    if (!keepGuestSeat) { credentials = null; room = null; resetAttempt(); }

    friends = []; friendsLoaded = false; invites = []; challenges = []; links = null;
    linkedIds = ''; linksBusy = false; linksAgain = false; linksMissing = false;
    changingFriends = false; busy = false; restoring = false; networkBusy = false;
    friendsFailure = null; invitesFailure = null;
    friendRequests = createFriendRequests();
    loadDismissed(); renderHome();
    void loadFriends();

    if (keepGuestSeat) pollTimer = window.setTimeout(poll, 0);
  }

  function start() {
    if (started || !options || !host || disposed) return;
    started = true;
    identity = getSession();
    const { quick, people } = options;
    quick.configure({ getSession, signIn: options.signIn, racerName: strangerName, enterRoom: (entry) => {
      enterRoom(entry);
    }, busyElsewhere: () => busy || live(), ownBest: () => Boolean(options?.ownBest()), raceOwnBest: () => options?.raceOwnBest() });
    people.configure((action, target) => {
      if (action === 'link') raceLink();
      else if (target !== null) {
        if (action === 'join') joinInvite(target);
        else if (action === 'dismiss') dismissInvite(target);
        else if (action === 'ghost') options?.raceGhost?.(target);
        else if (action === 'race') raceFriend(target);
      }
    });
    stopInbox = options.inbox.subscribe(onInbox);
    channel?.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (isRecord(event.data) && event.data.friends && event.data.user === getSession()?.user.id) void loadFriends();
    }, { signal: listeners.signal });
    addEventListener('storage', (event) => { if (event.key === dismissedKey()) { loadDismissed(); renderPeople(); } }, { signal: listeners.signal });
    addEventListener('online', () => { void poll(); }, { signal: listeners.signal });
    addEventListener('resize', () => fx?.relayout(), { signal: listeners.signal });
    void document.fonts?.ready.then(() => { if (!disposed) fx?.relayout(); });
    document.fonts?.addEventListener('loadingdone', () => fx?.relayout(), { signal: listeners.signal });
    clockTimer = window.setInterval(updateClock, 100);
    loadDismissed(); renderHome(); renderCustomize();

    if (joinLink) { navigate('compete'); show('people'); focus('online-guest-name'); }
    else {
      const saved = multiplayer.recallRace();

      if (saved) {
        restoring = true; paint();
        const ticket = generation;
        void (async () => {
          try {
            const restored = await request((signal) => multiplayer.getRace(getSession(), saved, signal));
            enterRoom({ room: restored, ...saved });
          } catch (failure) {
            if (disposed || ticket !== generation || failure instanceof WorkCancelled) return;
            multiplayer.forgetRace(); error(errorDetails(failure).message);
          } finally {
            if (!disposed && (ticket === generation || credentials?.roomId === saved.roomId)) { restoring = false; paint(); }
          }
        })();
      }
    }

    void loadFriends();
  }

  function configure(next: OnlineRaceOptions) {
    if (disposed) return;

    if (!started) {
      void work.close();
      work = new AsyncLifetime(accountLifetime());
      raceWork = new AsyncLifetime(work);
    }

    options = next;
    paint({ controllers: { rankCard: next.rankCard, people: next.people, quick: next.quick, review: next.review } });

    if (started) checkIdentity();
    wireHost(); start();
  }

  const controller = {
    configure,
    getSnapshot: store.getSnapshot,
    subscribeView: store.subscribe,
    attach(next: OnlineRaceHost) {
      releaseTyping?.(); fx?.dispose();
      host = next;
      fx = createTypingFx(next.wrap, next.display, { ensureCharacters: (index) => textView?.ensureForward(index) });
      wireHost(); start();

      return () => {
        if (host !== next) return;
        releaseTyping?.(); releaseTyping = null;
        fx?.dispose(); fx = null; host = null; textView = null;
      };
    },
    show,
    signIn() { options?.signIn(); },
    setName(name: string) { publish({ name }); },
    setGuestName(guestName: string) { publish({ guestName }); },
    setEmail(email: string) { publish({ email }); },
    setMode(mode: RaceOptions['mode']) {
      const shown = raceSetup();

      if (mode === shown.mode) return;
      const practice = options?.practice() ?? {};
      setCustomized(mode === 'quote' ? raceOptions({ mode, quoteLength: practice.quoteLength })
        : raceOptions({ ...practice, mode, punctuation: shown.punctuation ?? false, session: 'practice', adaptive: false }));
      renderCustomize();
    },
    setLength(length: number) {
      const shown = raceSetup();

      if (shown.mode === 'quote') return;
      setCustomized(shown.mode === 'time' ? { ...shown, duration: length } : { ...shown, count: length }); renderCustomize();
    },
    setPunctuation(punctuation: boolean) { setCustomized({ ...raceSetup(), punctuation }); renderCustomize(); },
    matchPractice() { setCustomized(null); renderCustomize(); focus('online-setup-done'); },
    async addFriend() {
      const email = current().email.trim();

      if (!email || !(await changeFriends((signal) => multiplayer.addFriend(getSession(), { email }, signal)))) return;
      paint({ email: '' }); announce(`${email} is on your friends list.`);
    },
    raceOnce() {
      const inviteEmail = current().email.trim();

      if (!inviteEmail) return;
      void perform(async () => {
        const entry = await request((signal) => multiplayer.createRace(getSession(), { ...newRace(), displayName: racerName(), inviteEmail }, signal));
        enterRoom(entry);
        paint({ email: '', accountInvite: 'If that account exists, its invitation is waiting in their inbox.' });
      });
    },
    removeFriend(id: string) { return changeFriends((signal) => multiplayer.removeFriend(getSession(), id, signal)); },
    async befriend() {
      const from = credentials;

      if (!from) return;
      const name = opponentOf(room)?.name || 'Your opponent';

      if (!(await changeFriends((signal) => multiplayer.addFriendFromRace(getSession(), from, signal)))) return;

      if (credentials?.roomId === from.roomId) { befriended = true; renderAfter(); }

      announce(`${name} is on your friends list.`);
    },
    joinGuest() {
      const link = joinLink;

      if (!link) return;
      void perform(async () => { enterRoom(await request((signal) => multiplayer.joinRace(getSession(), { ...link, displayName: current().guestName.trim() }, signal))); });
    },
    dismissGuest() {
      joinLink = null; forgetPendingInvite();
      history.replaceState(history.state, '', multiplayer.clearRaceLink(location.href)); error(); renderHome();
    },
    ready() {
      const from = credentials;

      if (!from) return;
      void perform(async () => { applyRoom(await request((signal) => multiplayer.setRaceReady(getSession(), from, !self()?.ready, signal), raceWork)); });
    },
    close() { void perform(leave); },
    rematch() {
      const me = self(); const opponent = opponentOf(room);

      if (!me || !opponent || !credentials || rematchControls(me, opponent).mine === 'inactive') return;
      pickRematch(credentials, room?.conditions, !me.rematch);
    },
    raceLink, copyLink, leave, joinInvite,
    rematchRoom(roomId: string, conditions: RaceConditions) { pickRematch(credentials?.roomId === roomId ? credentials : { roomId }, conditions); },
    get liveRoomId() { return room && !terminal(room) ? room.id : null; },
    get mode() { return view; },
    get pending() { return busy || restoring; },
    open() { navigate('compete'); show('people'); },
    openAdd() { navigate('compete'); show('add'); focus('online-invite-email'); },
    relayout() { fx?.relayout(); },
    updateGlide(element: HTMLElement) { options?.updateGlide?.(element); },
    openBoard() { navigate('compete');

 if (!live()) show('daily'); },
    onViewChange(screen: string, { keep = false } = {}) {
      checkIdentity();

      if (screen === 'compete') {
        if (!keep && view !== 'people') { view = 'people'; options?.onModeChange?.(); options?.board?.hide(); }

        renderHome();

        if (view === 'people') { void refreshInvites(); void loadFriends(); void refreshLinks(); fx?.relayout(); options?.quick.refresh(); }

        if (view === 'daily') options?.board?.show();
      } else { setRunning(false); options?.board?.hide(); }
    },
    tick() { if (document.body.dataset.view === 'compete' && view === 'people') renderPeople(); },
    dispose() {
      if (disposed) return;
      disposed = true; generation += 1;
      listeners.abort(); stopInbox?.(); channel?.close();
      clearTimeout(pollTimer); clearTimeout(startTimer); clearInterval(clockTimer);

      for (const timer of traceTimers) clearTimeout(timer);
      traceTimers.clear(); wakeReads = null;
      releaseTyping?.(); fx?.dispose(); fx = null; host = null;
      void work.close();
    },
  };

  if (initial) configure(initial);

  return controller;
}

export type OnlineRaceController = ReturnType<typeof createOnlineRace>;

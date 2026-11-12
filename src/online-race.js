import { createAttempt, replayAttempt } from './typing.js';
import { LENGTHS } from './lengths.js';
import { raceConditions, raceOptions, racePassage, raceSetupText } from './race-options.js';
import { createTypingFx } from './motion.js';
import { encodeTrace, standIn, validTrace } from './ghost-race.js';
import * as multiplayer from './multiplayer.js';
import { showSpeed } from './units.js';
import { RACE_LEADS, raceOutcome, raceResultText, rematchControls, tallyView } from './race-result.js';
import { redrawList } from './inbox.js';
import { createRaceReview } from './race-review.js';
import { cardOutcome, ratingResult } from './quick-match.js';
import { createQuickMatch } from './quick-match-view.js';
import { peopleRows } from './challenge-people.js';
import { drawPeople } from './challenge-people-view.js';

const $ = (id) => document.getElementById(id);
const stamp = (value) => typeof value === 'number' ? value : Date.parse(value);
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
const terminal = (room) => ['finished', 'cancelled', 'expired'].includes(room?.status);
const PENDING_INVITE = 'stilltype-race-invite-tab-v1';

// The race setup chosen in Race setup holds for this tab, a reload included; a new tab starts from practice.
const RACE_SETUP = 'stilltype-race-setup-tab-v1';

// Invitations dismissed from the people list on this device, per account. The service has no decline, so a dismissed
// invitation only leaves this list; it still lapses on its own, and the inbox keeps its entry.
const DISMISSED = 'stilltype-dismissed-invites-v1:';

// Tabs of this browser tell each other when a friend list changed, so every open Challenge redraws without a reload.
const PEOPLE_CHANNEL = 'stilltype-people';

// The views of the Challenge screen besides a race: the people list and what its foot links open.
const VIEWS = ['people', 'add', 'setup', 'daily', 'local'];
const VIEW_IDS = { people: 'challenge-people', add: 'people-add-view', setup: 'people-setup-view', daily: 'challenge-daily-view', local: 'challenge-local-view' };
const VIEW_FOCUS = { add: 'people-add-heading', setup: 'people-setup-heading', daily: 'daily-heading', local: 'local-heading' };
const OPENERS = { add: 'people-add', setup: 'people-setup', daily: 'open-daily', local: 'open-local' };

function pendingInvite() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PENDING_INVITE));

    if (saved && Date.now() - saved.savedAt < 15 * 60 * 1000) return multiplayer.parseRaceLink(saved.href);
    sessionStorage.removeItem(PENDING_INVITE);
  } catch {}

  return null;
}

function forgetPendingInvite() { try { sessionStorage.removeItem(PENDING_INVITE); } catch {} }

// Online runs use the same replay and passage renderer as practice. Only the service owns the
// shared start time and results; no online attempt is added to a profile or personal best.
export function createOnlineRace({ rankCard, getSession, signIn, navigate, renderText, updateCharacterStates, setRunning, announce, onPassageSeen, inbox, board, onModeChange, wireTyping, practice, updateGlide, ownBest, raceOwnBest, raceGhost }) {
  let room = null;
  let credentials = null;
  let joinLink = multiplayer.parseRaceLink(location.href) || pendingInvite();

  if (joinLink) {
    try { sessionStorage.setItem(PENDING_INVITE, JSON.stringify({ href: multiplayer.makeGuestRaceLink(joinLink, location.href), savedAt: Date.now() })); } catch {}
  }

  let attempt = null;
  let textView = null;
  let startPerf = null;
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
  let sentProgress = [];
  let settledTrace = null;
  // The timers of this race's trace sends and reads, all cleared when the tab leaves the race; how many times this
  // tab's own trace has reached the service; and the wake for a read waiting for it.
  const traceTimers = new Set();
  let ownTraceArrivals = 0;
  let wakeReads = null;
  let baseKeystrokes = 0;
  let baseErrors = 0;
  let baseTyped = '';
  let lastClock = '';
  let lastAnnouncement = '';
  let view = 'people';
  let friends = [];
  let friendsLoaded = false;
  // What the people list is drawn from: the inbox's invitations and ghost challenges, the service's links between them
  // and friend rows (null before its migration), and the invitations dismissed here.
  let invites = [];
  let challenges = [];
  let links = null;
  let linkedIds = '';
  let linksBusy = false;
  let linksAgain = false;
  // Set once the service says it has no race_people: it isn't asked again until the page loads again.
  let linksMissing = false;
  let dismissed = new Set();
  // Why the list can't be complete: the friend list's last read, and the invitations' last poll.
  let friendsFailure = null;
  let invitesFailure = null;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(PEOPLE_CHANNEL) : null;
  // The rematch room this tab is moving to, and the room whose traces it has read.
  let following = null;
  let tracesRead = null;
  const review = createRaceReview({ renderText });

  // Every friend-list request goes through this queue, one at a time, and each reply is the list.
  // A friend list that changed (here, from another tab, or on the service) is read against the links again, so an
  // invitation or ghost from someone just saved joins their row, with the pair's tally.
  const friendRequests = multiplayer.queueFriendRequests((list) => {
    const changed = JSON.stringify(list.map((friend) => friend.id).sort()) !== JSON.stringify(friends.map((friend) => friend.id).sort());
    friends = list;
    friendsLoaded = true;
    friendsFailure = null;
    renderFriends();
    renderPeople();

    if (changed) refreshLinks();
  },
    { load: (signal) => multiplayer.listFriends(getSession(), signal) });

  let befriended = false;

  // A stranger sees the race name, so the name filled in from the account's email is never sent to one.
  function strangerName() {
    const name = $('online-name').value.trim();

    return !name || name === getSession()?.user.email.split('@')[0].slice(0, 24) ? 'Racer' : name;
  }

  // The settled result the card shows, so a room update that doesn't change it never replays it.
  let shownResult = '';

  const quick = createQuickMatch({ root: $('quick-match'), getSession, signIn, racerName: strangerName,
    enterRoom: (result) => enterRoom(result), busyElsewhere: () => busy || Boolean(room && !terminal(room)), ownBest, raceOwnBest });

  const fx = createTypingFx($('online-stage').querySelector('.online-typing-wrap'), $('online-text-display'), { ensureCharacters: (index) => textView?.ensureForward(index) });

  // Keys take practice's path (src/app.js), accent keys included; this race keeps the clock, draws and sends.
  const typing = wireTyping($('online-input'), {
    get attempt() { return attempt; },
    get origin() { return startPerf; },
    get view() { return { input: $('online-input'), characters: textView.characters, textView, fx }; },
    // From the shared start to the limit, while this player is still racing.
    accepting: (at) => room?.status === 'racing' && !finishRequested && !self()?.finished
      && at >= startPerf && at - startPerf < (room.duration || 60) * 1000,
    notice(message) { $('online-help').textContent = message; },
    changed() {
      dirty = true;

      if (attempt.status === 'running' && document.body.dataset.view === 'compete') setRunning(true);
    },
    finish() {
      finishRequested = true;
      attempt.endedAt = Math.max(0, performance.now() - startPerf);
      $('online-input').disabled = true;
      $('online-help').textContent = 'Passage complete. Sending your result…';
      setRunning(false);
      poll();
    },
  });

  function error(message = '') { $('online-error').textContent = message; }

  function say(message) {
    if (message === lastAnnouncement) return;
    lastAnnouncement = message;
    announce(message);
  }

  // A race (waiting, racing or its results) or a guest's invitation takes the people view's place. The other views
  // open from the people list's foot and come back to it; none opens while a race is under way.
  const live = () => Boolean(room && !terminal(room));

  function show(next, { focus = false } = {}) {
    if (!VIEWS.includes(next) || (next !== 'people' && live())) return;
    const from = view;
    view = next;
    setRunning(false);
    renderHome();

    if (view === 'people') { fx.relayout(); refreshInvites(); quick.refresh(); refreshLinks(); }

    if (view === 'setup') renderCustomize();
    onModeChange?.();

    if (view === 'daily') board?.show(); else board?.hide();

    if (!focus) return;

    if (VIEW_FOCUS[view]) $(VIEW_FOCUS[view]).focus();
    else if (OPENERS[from] && !$(OPENERS[from]).hidden) $(OPENERS[from]).focus();
    else $('compete-heading').focus();
  }

  function renderHome() {
    const signedIn = Boolean(getSession());
    const joining = Boolean(joinLink) && !room;

    if (!signedIn && ['add', 'setup'].includes(view)) view = 'people';

    for (const [name, id] of Object.entries(VIEW_IDS)) $(id).hidden = view !== name || (name === 'people' && Boolean(room || joining));
    $('online-challenge').hidden = view !== 'people' || !(room || joining);
    $('online-guest-join').hidden = !joining;
    $('online-room').hidden = !room;
    quick.render();

    for (const node of $('challenge-people').querySelectorAll('[data-signed-in]')) node.hidden = !signedIn;

    for (const node of $('challenge-people').querySelectorAll('[data-guest]')) node.hidden = signedIn;

    if (!$('online-name').value) $('online-name').value = getSession()?.user.email.split('@')[0].slice(0, 24) || '';

    if (!$('online-guest-name').value) $('online-guest-name').value = $('online-name').value;
    renderPeople();
  }

  // The people list, drawn from the records as they stand now. A guest has no list.
  function renderPeople() {
    const signedIn = Boolean(getSession());
    renderSetupLink();
    const rows = signedIn ? peopleRows({ friends, invites, challenges, links, dismissed, now: Date.now() }) : [];

    // With nobody to list yet, the list offers the race anyone can join, and the foot leaves it out.
    if (signedIn && !rows.length && friendsLoaded) rows.push({ key: 'link', kind: 'link', state: 'link', name: 'A friend', line: null, tally: null });
    $('people-race-link').hidden = !signedIn || rows.some((row) => row.kind === 'link');
    $('people-list').hidden = !rows.length;
    // With no row left (the friend list not read yet, so no "A friend" row), focus goes to Quick match's heading,
    // not its Find a race: a second press of the key that emptied the list starts nothing.
    drawPeople($('people-list'), rows, { fallback: $('quick-match-heading'),
      decorate: (button) => { if (button.matches(RACE_CONTROLS)) markBusy(button); } });
    const message = signedIn ? (friendsFailure || invitesFailure)?.message || '' : '';

    if ($('people-status').textContent !== message) $('people-status').textContent = message;
  }

  // The inbox polls invitations and ghost challenges for every view; the people list reads the same lists.
  function onInbox(invitations, failure, listed) {
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
      const read = await multiplayer.listPeopleLinks(session);

      linksMissing = read === null;

      if (getSession() === session) { links = read; linkedIds = ids; renderPeople(); }
    } catch {} finally {
      linksBusy = false;

      if (linksAgain) { linksAgain = false; refreshLinks(); }
    }
  }

  const dismissedKey = () => `${DISMISSED}${getSession()?.user.id}`;

  function loadDismissed() {
    dismissed = new Set();

    if (!getSession()) return;

    try {
      const saved = JSON.parse(localStorage.getItem(dismissedKey()));

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

  function dismissInvite(roomId) {
    dismissed.add(roomId);
    saveDismissed();
    inbox.settle(`invite:${roomId}`);
    renderPeople();
  }

  async function refreshInvites() {
    if (!getSession()) return;
    await inbox.refresh();
  }

  function racerName() {
    return $('online-name').value.trim() || getSession()?.user.email.split('@')[0].slice(0, 24) || 'Racer';
  }

  // From this screen, a toast or the inbox. A live race has to be left first, so nobody is
  // abandoned mid-race by a notification.
  function joinInvite(roomId) {
    if (busy) return;
    navigate('compete');
    show('people');

    if (room && !terminal(room)) {
      if (room.id !== roomId) error('Leave your current race before joining another.');

      return;
    }

    perform(async () => {
      const result = await multiplayer.joinRace(getSession(), { roomId, guestToken: credentials?.guestToken, displayName: racerName() });
      enterRoom(result);
    });
  }

  // A rematch keeps the race's conditions with a fresh passage. A race from before options was a medium quote.
  function rematchPassage(conditions = {}) {
    return racePassage({ mode: 'quote', quoteLength: 'medium', difficulty: 'any', ...conditions }, { seenIds: conditions.textId ? [conditions.textId] : [] });
  }

  // Same opponent, same settings, a fresh passage. Picks Rematch on a closed race, or takes the pick back;
  // once both have picked, the service opens the next race and both tabs move to it (followRematch).
  function pickRematch(from, conditions, want = true) {
    if (busy) return;
    navigate('compete');
    show('people');

    if (room && !terminal(room)) {
      error('Leave your current race before starting another.');

      return;
    }

    perform(async () => {
      const passage = want ? rematchPassage(conditions) : null;
      const result = await multiplayer.rematchRace(getSession(), from, { want, passage, conditions: passage ? { ...conditions, textId: passage.id } : {} });

      // The same race comes back with the pick, unless this seat moved: a service from before picks opens
      // or joins the rematch at once.
      if (room && result.roomId === room.id) applyRoom(result.room);
      else enterRoom(result);
    });
  }

  // Both picked: the service opened the next race, already counting down, and this seat moves to it.
  function followRematch() {
    if (!room?.rematchId || !self()?.rematch || following === room.rematchId) return;
    following = room.rematchId;
    const from = credentials;
    multiplayer.joinRace(getSession(), { roomId: room.rematchId, guestToken: from.guestToken, displayName: self().name })
      .then((result) => { if (credentials === from) enterRoom(result); })
      .catch((failure) => {
        if (credentials !== from) return;
        following = null;
        error(failure.message || 'The race service is unavailable. Try again.');
      });
  }

  // Add a friend's list: each friend with Remove. A friend whose row goes (just removed) hands keyboard focus to
  // the email field.
  function renderFriends() {
    redrawList($('online-friend-list'), friends.map((friend) => {
      const row = document.createElement('li');
      row.className = 'online-friend-row';
      const name = document.createElement('div');
      name.className = 'online-friend-name';
      const strong = document.createElement('strong');
      strong.textContent = friend.name;
      name.append(strong);

      if (friend.email) {
        const detail = document.createElement('span');
        detail.textContent = friend.email;
        name.append(detail);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-ghost btn-sm';
      remove.dataset.removeFriend = friend.id;
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${friend.name} from friends`);
      markBusy(remove);
      remove.addEventListener('click', () => changeFriends((signal) => multiplayer.removeFriend(getSession(), friend.id, signal)));
      row.append(name, remove);

      return row;
    }), $('online-invite-email'));
  }

  // One press on a friend's Race invites them to a race on the race setup.
  function raceFriend(friendId) {
    const friend = friends.find((value) => value.id === friendId);

    if (!friend) return;
    perform(async () => {
      const result = await multiplayer.createRace(getSession(), { ...newRace(), displayName: racerName(), friendId: friend.id });
      enterRoom(result);
      $('online-account-invite-status').hidden = false;
      $('online-account-invite-status').textContent = friend.email
        ? `If ${friend.email} has an account, the challenge is waiting in their inbox.`
        : `The challenge is waiting in ${friend.name}’s inbox.`;
    });
  }

  // One press opens a race anyone with its link can join, and copies the link.
  function raceLink() {
    perform(async () => {
      const result = await multiplayer.createRace(getSession(), { ...newRace(), displayName: racerName() });
      enterRoom(result);
      await copyLink();
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText($('online-guest-link').value);
      $('online-invite-sent').textContent = 'Link copied. Anyone with it can join for 15 minutes.';
    } catch {
      $('online-guest-link').focus();
      $('online-guest-link').select();
      $('online-invite-sent').textContent = 'Select and copy the link above. Anyone with it can join for 15 minutes.';
    }
  }

  async function loadFriends() {
    if (!getSession()) return;

    try { await friendRequests.reload(); }
    catch (failure) {
      if (!friendsLoaded) { friendsFailure = failure; renderPeople(); }
    }
  }

  // A race takes the practice setup until Race setup changes it; the change holds for this tab's races, reloads
  // included, until Match practice puts the practice setup back. A saved setup is read back through raceOptions, so
  // only a setup a race can take returns.
  let customized = (() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(RACE_SETUP));

      return saved && typeof saved === 'object' ? raceOptions({ ...saved, session: 'practice', adaptive: false }) : null;
    } catch { return null; }
  })();

  function setCustomized(value) {
    customized = value;

    try {
      if (value) sessionStorage.setItem(RACE_SETUP, JSON.stringify(value));
      else sessionStorage.removeItem(RACE_SETUP);
    } catch {}

    renderSetupLink();
  }

  function newRace() {
    const conditions = raceConditions(customized ?? raceOptions(practice()));

    return { passage: racePassage(conditions), conditions };
  }

  // What the race setup shows and races start from: the setup chosen here, or else practice's.
  const raceSetup = () => customized ?? raceOptions(practice());

  // The same setup, whatever order its options were written in.
  const sameSetup = (a, b) => JSON.stringify(Object.entries(raceConditions(a)).sort()) === JSON.stringify(Object.entries(raceConditions(b)).sort());

  // The Race setup link names what a one-press Race (and Copy a race link, and Race once) uses, as a conditions line.
  function renderSetupLink() {
    const text = raceSetupText(raceConditions(raceSetup()));
    const node = $('people-setup-conditions');

    if (node.textContent !== text) node.textContent = text;
  }

  // The practice row's own controls (mode, length, punctuation), cloned from it, so Race setup looks and
  // works like practice but changes only races.
  function buildCustomize() {
    const options = $('online-options');

    if (options.childElementCount) return;
    const modes = document.querySelector('.practice-rail .mode-options').cloneNode(true);
    modes.querySelector('.mode-more')?.remove();
    modes.setAttribute('aria-label', 'Race mode');
    const lengths = $('duration-options').cloneNode(true);
    lengths.querySelectorAll('#custom-length, #custom-length-form').forEach((node) => node.remove());
    lengths.setAttribute('aria-label', 'Race length');
    const punctuation = $('punctuation-switch').cloneNode(true);

    for (const node of [modes, lengths, punctuation, ...modes.querySelectorAll('[id]'), ...lengths.querySelectorAll('[id]'), ...punctuation.querySelectorAll('[id]')]) node.removeAttribute('id');
    punctuation.removeAttribute('for');
    punctuation.querySelector('input').checked = false;
    modes.dataset.raceModes = '';
    lengths.dataset.raceLengths = '';
    punctuation.dataset.racePunctuation = '';
    options.append(modes, lengths, punctuation);
    modes.addEventListener('click', (event) => {
      const mode = event.target.closest('[data-mode]')?.dataset.mode;

      const shown = raceSetup();

      if (!mode || mode === shown.mode) return;
      const { punctuation: marks = false } = shown;
      setCustomized(mode === 'quote' ? raceOptions({ mode, quoteLength: practice().quoteLength })
        : raceOptions({ ...practice(), mode, punctuation: marks, session: 'practice', adaptive: false }));
      renderCustomize();
    });
    lengths.addEventListener('click', (event) => {
      const length = Number(event.target.closest('[data-length]')?.dataset.length);

      const shown = raceSetup();

      if (!length || length === shown[LENGTHS[shown.mode].key]) return;
      setCustomized({ ...shown, [LENGTHS[shown.mode].key]: length });
      renderCustomize();
    });
    punctuation.querySelector('input').addEventListener('change', (event) => {
      setCustomized({ ...raceSetup(), punctuation: event.target.checked });
      renderCustomize();
    });
  }

  function renderCustomize() {
    buildCustomize();
    const shown = raceSetup();
    // Match practice shows whenever the setup races would use isn't practice's.
    $('online-customize-reset').hidden = !customized || sameSetup(customized, raceOptions(practice()));
    const options = $('online-options');
    const modes = options.querySelector('[data-race-modes]');
    modes.querySelectorAll('[data-mode]').forEach((button) => {
      const on = button.dataset.mode === shown.mode;
      button.setAttribute('aria-pressed', String(on));
      button.classList.toggle('is-active', on);
    });
    const spec = LENGTHS[shown.mode];
    const lengths = options.querySelector('[data-race-lengths]');
    lengths.hidden = !spec;

    if (spec) {
      lengths.querySelectorAll('[data-length]').forEach((button, index) => {
        const value = spec.presets[index];
        const on = value === shown[spec.key];
        button.dataset.length = String(value);
        button.textContent = String(value);
        button.setAttribute('aria-label', `${value} ${spec.unit}`);
        button.setAttribute('aria-pressed', String(on));
        button.classList.toggle('is-active', on);
      });
    }

    const punctuation = options.querySelector('[data-race-punctuation]');
    punctuation.hidden = shown.mode === 'quote';
    punctuation.querySelector('input').checked = Boolean(shown.punctuation);
    updateGlide(modes);

    if (spec) updateGlide(lengths);
  }

  // One race action at a time, and apart from those, one friend-list change at a time. While one is
  // in flight, every control that starts another of its kind (for races, also in the inbox and on the
  // toast) is aria-disabled and its press is ignored: aria-disabled, not disabled, so the control just
  // pressed keeps keyboard focus, and no press is dropped unseen. A friend change waiting its turn
  // behind a slow friend-list read holds up no race.
  const RACE_CONTROLS = '#create-online-race, #join-online-race, #online-ready, #online-leave, #online-rematch, #people-race-link, [data-race-friend], [data-accept-invite], [data-race-link]';
  const FRIEND_CONTROLS = '#online-befriend, #add-friend, [data-remove-friend]';

  function markBusy(control) {
    if ((control.matches(FRIEND_CONTROLS) ? changingFriends : busy) || control.dataset.state === 'inactive') control.setAttribute('aria-disabled', 'true');
    else control.removeAttribute('aria-disabled');
  }

  function renderBusy() {
    for (const control of $('compete-screen').querySelectorAll(`${RACE_CONTROLS}, ${FRIEND_CONTROLS}`)) markBusy(control);
    inbox.wait(busy ? ['invite', 'result'] : []);
  }

  async function changeFriends(send) {
    if (changingFriends) return false;
    changingFriends = true;
    renderBusy();
    error();

    try {
      await friendRequests.change(send);
      channel?.postMessage({ user: getSession()?.user.id, friends: true });
      refreshLinks();

      return true;
    }
    catch (failure) {
      error(failure.message || 'The race service is unavailable. Try again.');

      return false;
    }
    finally { changingFriends = false; renderBusy(); }
  }

  async function perform(action) {
    if (busy) return;
    busy = true;
    renderBusy();
    error();

    try { await action(); } catch (failure) { error(failure.message || 'The race service is unavailable. Try again.'); }
    finally {
      busy = false;
      renderBusy();

      if (room) renderRoom();
    }
  }

  function resetAttempt() {
    attempt = null;
    textView = null;
    startPerf = null;
    baseTyped = '';
    baseKeystrokes = 0;
    baseErrors = 0;
    dirty = false;
    refused = false;
    finishRequested = false;
    sentProgress = [];
    settledTrace = null;

    for (const timer of traceTimers) clearTimeout(timer);
    traceTimers.clear();
    wakeReads = null;
    reviewNote('');
    lastClock = '';
    lastAnnouncement = '';
    $('online-input').value = '';
    $('online-input').disabled = true;
    $('online-countdown').textContent = '';
    $('online-help').textContent = 'Type when the countdown ends. Paste and key repeat are off.';
    $('online-connection').textContent = '';
    $('online-results').hidden = true;
    review.hide();
    tracesRead = null;
    $('online-after').hidden = true;
    $('online-account-invite-status').hidden = true;
    befriended = false;
    setRunning(false);
  }

  function enterRoom(result) {
    // Any other room ends a quick match search; a paired one is where the search led.
    if (!result.room?.quick) quick.leave();
    const nextId = result.roomId || result.room.id;
    // Going on to another race leaves a closed one, so its other racer sees that; its own rematch doesn't.
    const left = room && credentials && terminal(room) && ![room.id, room.rematchId].includes(nextId) ? credentials : null;

    if (left) multiplayer.leaveRace(getSession(), left).catch(() => {});
    generation += 1;
    clearTimeout(pollTimer);
    resetAttempt();
    credentials = { roomId: result.roomId || result.room.id };

    if (result.guestToken) credentials.guestToken = result.guestToken;

    if (result.inviteToken) credentials.inviteToken = result.inviteToken;
    multiplayer.rememberRace(credentials);
    joinLink = null;
    forgetPendingInvite();
    history.replaceState(history.state, '', multiplayer.clearRaceLink(location.href));
    $('online-share').hidden = !result.inviteToken;

    if (result.inviteToken) $('online-guest-link').value = multiplayer.makeGuestRaceLink({ roomId: credentials.roomId, inviteToken: result.inviteToken }, location.href);
    room = result.room;

    inbox.settle(`invite:${room.id}`);
    renderHome();
    applyRoom(room, { entering: true });
    pollTimer = setTimeout(poll, 150);
    navigate('compete');
    show('people');
  }

  function self() { return room?.players.find((player) => player.slot === room.selfSlot); }

  function prepareAttempt() {
    const passage = typeof room?.passage === 'string' ? { id: room.id, text: room.passage } : room?.passage;

    if (attempt || !passage?.text) return;
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

    textView = renderText($('online-text-display'), attempt.text);
    textView.ensureAhead(baseTyped.length);
    updateCharacterStates(textView.characters, baseTyped, attempt.text, 0);
    fx.reset(textView.characters);
    fx.update(baseTyped.length, 'delete', false);
    $('online-input').value = baseTyped;
    $('online-accessible-passage').textContent = attempt.text;
    onPassageSeen?.(room.conditions?.textId || passage.id);
    finishRequested = Boolean(me?.finished);
  }

  function opponentOf(value) { return value?.players.find((player) => player.slot !== value.selfSlot); }

  function applyRoom(next, { entering = false } = {}) {
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
      setTimeout(updateClock, startPerf - performance.now());
    }

    startIfDue();

    if (['countdown', 'racing'].includes(room.status)) prepareAttempt();
    sendSettledTrace();
    renderRoom();
    updateClock();

    if (terminal(room)) {
      // A closed room is polled for about a day, for the other racer's Rematch pick. Only the reply that
      // closes it ends this race's run, and only on Challenge: on any other view the run in progress is
      // the person's own (leaving Challenge already ended this one, in onViewChange).
      if (previousStatus !== room.status && document.body.dataset.view === 'compete') setRunning(false);
      $('online-input').disabled = true;

      if (room.status === 'finished') renderResults();

      if (previousStatus !== room.status) say(room.status === 'finished' ? resultSentence() : $('online-room-status').textContent);

      if (room.quick && previousStatus !== room.status) quick.refresh();
      followRematch();
    }
  }

  // Who won, as each result card shows it: [mine, theirs]. A quick match reads its settled rated result, the one
  // record the tally and the rating line read too, so a run that couldn't be checked is never the winner. Every
  // other race reads the speeds.
  function outcomes(me, opponent) {
    return room.quick ? [cardOutcome(me), cardOutcome(opponent)] : [raceOutcome(me, opponent), raceOutcome(opponent, me)];
  }

  // "You beat", "You tied with", or "You raced" when this racer didn't win (or nobody did).
  const leadOf = (me, opponent) => RACE_LEADS[outcomes(me, opponent)[0]] || RACE_LEADS.lost;

  // The result as one sentence, as the inbox keeps it: "You beat Lin: 72 wpm to 65."
  function resultSentence() {
    const me = self();
    const opponent = opponentOf(room);

    if (!me || !opponent) return 'Race complete.';

    return raceResultText({ lead: leadOf(me, opponent), opponent: opponent.name, wpm: [me.wpm || 0, opponent.wpm || 0] });
  }

  const away = () => document.hidden || document.body.dataset.view !== 'compete';

  // Inbox entries for this room: the opponent arriving, a rematch request and the result.
  // `entering` is a room opened or recovered after a reload: its result is recorded without a toast.
  function notifyChanges(previousStatus, previousOpponent, entering) {
    const opponent = opponentOf(room);

    if (room.status === 'waiting' && opponent?.connected && !previousOpponent?.connected && previousStatus
      && (room.selfSlot === 1 || room.rematchOf)) {
      inbox.notify({ id: `joined:${room.id}`, kind: 'joined', roomId: room.id,
        text: room.rematchOf ? `${opponent.name} is back for the rematch.` : `${opponent.name} joined your race.` }, { toast: away() });
    }

    const justFinished = previousStatus && previousStatus !== 'finished';

    if (room.status === 'finished' && opponent && (justFinished || entering)) {
      const me = self();
      const lead = leadOf(me, opponent);
      // Finished rooms are deleted a day after they expire, so Race again lapses a little before.
      const until = new Date(Date.parse(room.expiresAt || new Date().toISOString()) + RESULT_RETAINED_MS).toISOString();
      // Saved in wpm, like every speed; the inbox words it in the unit chosen when it is shown.
      const race = { lead, opponent: opponent.name, wpm: [me.wpm || 0, opponent.wpm || 0] };
      inbox.notify({ id: `result:${room.id}`, kind: 'result', roomId: room.id, until,
        conditions: room.conditions, race, text: raceResultText(race) }, { toast: justFinished && away() });
    }
  }

  function renderAfter() {
    const opponent = opponentOf(room);

    // A host who invited by email already has them by email; the list never links the two.
    const canAdd = terminal(room) && Boolean(opponent) && Boolean(getSession()) && opponent.account && !opponent.friend && !befriended
      && !(room.selfSlot === 1 && room.inviteKind === 'account' && !room.quick);

    $('online-after').hidden = !canAdd;
    $('online-befriend').hidden = !canAdd;

    if (canAdd) $('online-befriend').textContent = `Add ${opponent.name} to friends`;
  }

  function showResult(key, result) {
    if (key === shownResult) return;
    shownResult = key;

    if (key) rankCard.show(result); else rankCard.clear();
  }

  function renderRoom() {
    if (!room) return;
    const me = self();
    const opponent = opponentOf(room);

    const copy = {
      waiting: room.players.length < 2 ? 'Waiting for your opponent.'
        : room.rematchOf && !opponent?.connected && !opponent?.ready ? `Rematch sent. Waiting for ${opponent.name} to join.` : 'Both players are here.',
      countdown: room.quick ? `Matched with ${opponent?.name || 'another racer'}.` : 'Both players are ready.',
      racing: room.quick && opponent?.left ? `${opponent.name} left the race. Finish your run to win.`
        : finishRequested || me?.finished ? 'Waiting for the other player.'
          : room.quick ? 'Leaving now counts as a loss.' : 'The clock keeps running if you leave the passage.',
      // The results below say it.
      finished: '',
      cancelled: room.quick ? 'The race was called off before the start.' : 'This race ended because a player left.',
      expired: 'This invitation has expired.',
    };

    $('online-room-status').textContent = copy[room.status] ?? 'Connecting to the race…';
    const setup = room.conditions?.mode ? raceSetupText(room.conditions) : '';

    if ($('online-room-conditions').textContent !== setup) $('online-room-conditions').textContent = setup;
    // A settled quick match says how the rating moved, or why it didn't. A rated result shows the rank card, and
    // the sentence stays in the status region for a screen reader, the card being decoration.
    const result = room.quick ? ratingResult(room.rating, opponent?.name) : null;
    const carded = Boolean(result) && result.kind !== 'unrated';

    if (result) quick.seen(room.id);
    $('online-rating-change').hidden = !result;
    $('online-rating-change').textContent = result?.sentence || '';
    $('online-rating-change').classList.toggle('sr-only', carded);
    showResult(carded ? `${room.id}:${result.sentence}` : '', result);
    $('online-ready').hidden = room.status !== 'waiting';
    const readyLabel = me?.ready ? 'Not ready' : 'Ready to race';

    if ($('online-ready').textContent !== readyLabel) $('online-ready').textContent = readyLabel;
    $('online-stage').hidden = !['countdown', 'racing'].includes(room.status);
    $('online-players').hidden = room.status === 'finished';

    if (room.status !== 'waiting') $('online-account-invite-status').hidden = true;
    const leaveLabel = terminal(room) ? 'Close race' : 'Leave race';

    if ($('online-leave').textContent !== leaveLabel) $('online-leave').textContent = leaveLabel;
    $('online-share').hidden ||= room.status !== 'waiting';
    const container = $('online-players');

    for (const slot of [1, 2]) {
      let row = container.querySelector(`[data-player-slot="${slot}"]`);

      if (!row) {
        row = document.createElement('div');
        row.className = 'online-player-row';
        row.dataset.playerSlot = String(slot);
        const name = document.createElement('strong');
        const state = document.createElement('span');
        const track = document.createElement('div');
        track.className = 'progress-track';
        track.setAttribute('role', 'progressbar');
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.append(document.createElement('span'));
        row.append(name, state, track);
        container.append(row);
      }

      const player = room.players.find((value) => value.slot === slot);
      row.firstElementChild.textContent = player ? `${player.name}${slot === room.selfSlot ? ' (you)' : ''}` : 'Waiting for a player';
      row.children[1].textContent = !player ? 'not joined' : player.left ? 'left' : player.finished ? 'finished' : room.status === 'waiting' ? player.ready ? 'ready' : room.rematchOf && !player.connected && slot !== room.selfSlot ? 'invited' : 'not ready' : `${Math.round(player.progress || 0)}% complete`;
      const track = row.lastElementChild;
      const progress = Math.max(0, Math.min(100, player?.progress || 0));
      track.setAttribute('aria-label', `${player?.name || `Player ${slot}`} race progress`);
      track.setAttribute('aria-valuenow', String(Math.round(progress)));
      track.firstElementChild.style.setProperty('--progress', String(progress / 100));
    }

    renderAfter();
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

    if (countdown !== lastClock) { $('online-countdown').textContent = countdown; lastClock = countdown; }

    $('online-timer').textContent = delta < 0 ? `${room.duration || 60} s race` : `${Math.ceil(remaining / 1000)} s remaining`;
    const me = self();
    // An accent commit typed before the limit is scored first, though the key that ended it comes after.
    const pending = typing.pending();
    const canType = room.status === 'racing' && delta >= 0 && (remaining > 0 || pending) && !finishRequested && !me?.finished;
    const wasDisabled = $('online-input').disabled;
    $('online-input').disabled = !canType;

    if (canType && wasDisabled && document.body.dataset.view === 'compete' && view === 'people') {
      fx.relayout();
      $('online-input').focus({ preventScroll: true });
      say('The race has started. Type the passage.');
    }

    if (delta >= 0 && remaining === 0 && !finishRequested && attempt && !pending) {
      finishRequested = true;
      attempt.endedAt = (room.duration || 60) * 1000;
      dirty = true;

      if (document.body.dataset.view === 'compete') setRunning(false);

      $('online-help').textContent = 'Time’s up. Sending your result…';
      poll();
    }
  }

  // A closed race with two players keeps a watch, so each sees the other's Rematch pick and both move to
  // the rematch together, until the service is due to delete the room.
  const watchingRematch = () => terminal(room) && room.players.length === 2
    && Date.now() < Date.parse(room.expiresAt) + RESULT_RETAINED_MS;

  const resultsInView = () => room?.status === 'finished' && !away() && view === 'people';

  async function poll() {
    if (!credentials || networkBusy || (terminal(room) && !watchingRematch())) return;
    clearTimeout(pollTimer);
    const currentGeneration = generation;
    const currentCredentials = credentials;
    networkBusy = true;
    let failed = false;

    try {
      let next;

      if (dirty && attempt && room.status === 'racing' && !refused) {
        const replay = replayAttempt(attempt);
        const prefixErrors = [...baseTyped].filter((char, index) => char !== attempt.text[index]).length;
        // The service takes printable ASCII, as passages are: any other letter (an accent key's é) is a
        // mistake, sent as a stand-in that differs from the letter expected there.
        const typed = replay.typed.replace(/[^ -~]/g, (char, index) => standIn(attempt.text[index]));
        // A finished run sends its keystroke trace for the graph and replay; a race resumed after a reload
        // has no record of the keys before it, so it sends none.
        const trace = finishRequested && !baseTyped ? encodeTrace(attempt) : null;
        const payload = { typed, keystrokes: baseKeystrokes + replay.insertions - baseTyped.length, errors: baseErrors + replay.mistakes - prefixErrors, finished: finishRequested, trace };
        dirty = false;
        const keys = { events: attempt.events.length, at: performance.now() - startPerf };
        next = await multiplayer.updateRaceProgress(getSession(), currentCredentials, payload, (sequence) => sentProgress.push({ ...payload, ...keys, sequence }));
      } else {
        next = await multiplayer.getRace(getSession(), currentCredentials);
        refused = false;
      }

      if (currentGeneration !== generation) return;
      $('online-connection').textContent = '';
      applyRoom(next.room || next);
    } catch (failure) {
      if (currentGeneration !== generation) return;
      failed = true;
      // A refusal is the service's answer about the room (cancelled, expired, out of limits), so the next
      // poll reads the room instead of sending the same progress again. A lost connection just retries.
      refused = failure.status >= 400 && failure.status < 500;
      dirty ||= Boolean(attempt);
      $('online-connection').textContent = refused ? '' : `Connection interrupted. Retrying… ${failure.message || ''}`;
    } finally {
      networkBusy = false;

      if (credentials && !terminal(room)) pollTimer = setTimeout(poll, dirty && finishRequested && !failed ? 0 : 650);
      else if (credentials && watchingRematch()) pollTimer = setTimeout(poll, resultsInView() ? PICK_WATCH_MS : CLOSED_WATCH_MS);
    }
  }

  // You on the left, them on the right, the pair's tally between. The winner reads larger and brighter,
  // and the tally figure this race raised is the accent. Under each result, its Rematch control.
  function renderResults() {
    const me = self();
    const opponent = opponentOf(room);
    $('online-results').hidden = !me || !opponent;

    if (!me || !opponent) return;
    const [myResult, theirResult] = outcomes(me, opponent);

    for (const [side, player, result] of [['mine', me, myResult], ['theirs', opponent, theirResult]]) {
      const node = $(`online-duel-${side}`);
      node.dataset.outcome = result;

      if (side === 'theirs') node.querySelector('.duel-name').textContent = player.name;
      showSpeed(node.querySelector('.duel-wpm'), player.wpm || 0);
      // A run that couldn't be checked shows its speed plainly, with no accuracy to compare.
      node.querySelector('.duel-accuracy').textContent = result !== 'unchecked' ? `${player.accuracy ?? 100}%` : player.left ? 'left' : 'not checked';
    }

    // Guests have no tally. The figure raised is the winner's, and a race nobody won raises none.
    const tally = me.account && opponent.account ? tallyView(room.tally, myResult === 'won' ? 'won' : theirResult === 'won' ? 'lost' : 'tied') : null;
    $('online-tally').hidden = !tally;

    if (tally) {
      const [mine, , theirs] = $('online-tally').children;
      mine.textContent = tally.mine;
      theirs.textContent = tally.theirs;
      mine.classList.toggle('is-raised', tally.raised === 'mine');
      theirs.classList.toggle('is-raised', tally.raised === 'theirs');
      $('online-tally').setAttribute('aria-label', `You ${tally.mine}, ${opponent.name} ${tally.theirs}`);
    }

    const controls = rematchControls(me, opponent);
    const button = $('online-rematch');
    button.dataset.state = controls.mine;
    button.setAttribute('aria-pressed', String(controls.mine === 'chosen'));
    markBusy(button);
    const theirs = $('online-their-rematch');
    theirs.dataset.state = controls.theirs;
    theirs.lastElementChild.textContent = controls.theirs === 'left' ? 'left' : 'Rematch';
    theirs.setAttribute('aria-label', controls.theirs === 'left' ? `${opponent.name} left`
      : `${opponent.name} ${controls.theirs === 'chosen' ? 'picked' : 'hasn’t picked'} Rematch`);
    $('online-starting').hidden = !controls.starting;
    readTraces();
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

    if (room.quick || !me?.finished || settledTrace || !attempt || baseTyped) return;
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
          await multiplayer.updateRaceProgress(getSession(), from, { typed, keystrokes, errors, finished: true, trace });
          ownTraceArrivals += 1;
          wakeReads?.();

          return true;
        } catch {
          if (send < TRACE_SENDS) await tracePause(TRACE_RETRY_MS);
        }
      }

      return false;
    })();
  }

  // A wait that belongs to this race: leaving the race (resetAttempt) clears it, and it never resolves.
  function tracePause(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        traceTimers.delete(timer);
        resolve();
      }, ms);

      traceTimers.add(timer);
    });
  }

  // What the results say in Graph and Replay's place, at their size, while a trace is missing, and once it won't come.
  function reviewNote(text, state = 'waiting') {
    $('online-review-wait').hidden = !text;
    $('online-review-wait').dataset.state = state;
    $('online-review-note').textContent = text;
  }

  // Whose keystrokes a read found missing: 'mine', 'theirs', 'both', or 'unread' when no read has answered.
  const missingCopy = {
    waiting: { mine: 'your keystrokes arrive', theirs: (name) => `${name}’s keystrokes arrive`, both: 'both racers’ keystrokes arrive', unread: 'the race service answers' },
    none: { mine: 'your keystrokes didn’t arrive', theirs: (name) => `${name}’s keystrokes didn’t arrive`, both: 'neither racer’s keystrokes arrived', unread: 'the race service didn’t answer' },
  };

  const missingText = (state, missing, name) => {
    const part = missingCopy[state][missing];

    return typeof part === 'function' ? part(name) : part;
  };

  // Both racers' traces draw the graph and the replay. Reads go on while a trace is missing (TRACE_READS_AT), and a
  // trace this tab sent itself wakes the read waiting for it; meanwhile the results say whose keystrokes they wait
  // for, in Graph and Replay's place. When the reads run out, the results say whose never came. A race this tab
  // resumed after a reload has no record of the keys before it, so it says so at once.
  async function readTraces() {
    if (tracesRead === room.id) return;
    tracesRead = room.id;
    const from = credentials;
    const { text } = room.passage;
    const name = opponentOf(room).name;

    if (baseTyped) {
      reviewNote('No Graph or Replay for this race: it was resumed after a reload, so your keystrokes weren’t all recorded.', 'none');

      return;
    }

    // This tab's own trace, when it went after the service finished the seat, is usually there within a moment.
    if (settledTrace) await Promise.race([settledTrace, tracePause(TRACE_READS_AT[1])]);

    if (credentials !== from) return;
    let missing = 'unread';

    for (const [index, at] of TRACE_READS_AT.entries()) {
      const arrivals = ownTraceArrivals;
      let traces = null;

      try { traces = await multiplayer.getRaceTraces(getSession(), from); } catch {}

      if (credentials !== from) return;

      if (traces) {
        const seat = (mineToo) => {
          const trace = traces.find((entry) => (entry.slot === room.selfSlot) === mineToo)?.trace;

          return validTrace(trace) ? trace : null;
        };

        const [mine, theirs] = [seat(true), seat(false)];

        if (mine && theirs) {
          reviewNote('');
          review.show({ text, mine, theirs, name });

          return;
        }

        missing = mine ? 'theirs' : theirs ? 'mine' : 'both';
      }

      if (index === TRACE_READS_AT.length - 1) break;
      reviewNote(`Graph and Replay appear when ${missingText('waiting', missing, name)}.`);

      // A trace of this tab's own that arrived during the read is read again at once.
      if (ownTraceArrivals === arrivals) {
        await Promise.race([tracePause(TRACE_READS_AT[index + 1] - at), new Promise((resolve) => { wakeReads = resolve; })]);
        wakeReads = null;
      }

      if (credentials !== from) return;
    }

    reviewNote(`No Graph or Replay for this race: ${missingText('none', missing, name)}.`, 'none');
  }

  async function leave() {
    quick.leave();
    const previous = credentials;
    const rated = room?.quick;
    generation += 1;
    clearTimeout(pollTimer);
    credentials = null;
    room = null;
    showResult('');
    multiplayer.forgetRace();
    resetAttempt();
    $('online-players').replaceChildren();
    $('online-share').hidden = true;
    renderHome();

    if (previous) {
      try { await multiplayer.leaveRace(getSession(), previous); }
      catch (failure) { error(`You left this tab’s race. ${failure.message || 'The server will close the room when it expires.'}`); }
    }

    if (rated) quick.refresh();
  }

  $('online-signin').addEventListener('click', signIn);
  $('people-add').addEventListener('click', () => show('add', { focus: true }));
  $('people-setup').addEventListener('click', () => show('setup', { focus: true }));
  $('open-daily').addEventListener('click', () => show('daily', { focus: true }));
  $('open-local').addEventListener('click', () => show('local', { focus: true }));
  $('people-race-link').addEventListener('click', () => { if (!$('people-race-link').hasAttribute('aria-disabled')) raceLink(); });
  $('online-setup-done').addEventListener('click', () => show('people', { focus: true }));
  $('online-customize-reset').addEventListener('click', () => {
    setCustomized(null);
    renderCustomize();
    $('online-setup-done').focus();
  });

  for (const back of document.querySelectorAll('[data-challenge-back]')) back.addEventListener('click', () => show('people', { focus: true }));
  // A key held down repeats. After Done or Back, the repeat would press the link that opened the view, and after any
  // press it would press whatever focus moved to. So a repeat presses no button or link anywhere on Challenge. (After
  // Dismiss focus lands on a row, which nothing presses: see drawPeople.) Fields are left alone: the race's own
  // typing rules hold there, and a name field takes a held key as any field does.
  $('compete-screen').addEventListener('keydown', (event) => {
    const pressing = event.key === 'Enter' || event.key === ' ';

    if (event.repeat && pressing && event.target.closest('button, a[href], summary')) event.preventDefault();
  });
  // A row has focus in place of its action, so Space there is a press that presses nothing. The browser would take it
  // as a scroll, and carry the row (and focus) off the screen; it stays put. Space anywhere else scrolls as ever.
  $('people-list').addEventListener('keydown', (event) => {
    if (event.key === ' ' && event.target.matches('.people-row')) event.preventDefault();
  });
  $('people-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-people-action]');

    if (!button || button.getAttribute('aria-disabled') === 'true') return;
    const { peopleAction: action } = button.dataset;

    if (action === 'join') joinInvite(button.dataset.acceptInvite);
    else if (action === 'dismiss') dismissInvite(button.dataset.dismissInvite);
    else if (action === 'ghost') raceGhost?.(button.dataset.raceGhost);
    else if (action === 'race') raceFriend(button.dataset.raceFriend);
    else if (action === 'link') raceLink();
  });
  // Add a friend: saved to the list, where their row offers Race. Race once invites the same account without saving.
  $('online-setup').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('online-invite-email').value.trim();

    if (!email || !(await changeFriends((signal) => multiplayer.addFriend(getSession(), { email }, signal)))) return;
    $('online-invite-email').value = '';
    announce(`${email} is on your friends list.`);
  });
  $('create-online-race').addEventListener('click', () => {
    if (!$('online-invite-email').reportValidity()) return;
    const inviteEmail = $('online-invite-email').value.trim();
    perform(async () => {
      const result = await multiplayer.createRace(getSession(), { ...newRace(), displayName: racerName(), inviteEmail });
      enterRoom(result);
      $('online-invite-email').value = '';
      $('online-account-invite-status').hidden = false;
      $('online-account-invite-status').textContent = 'If that account exists, its invitation is waiting in their inbox.';
    });
  });
  channel?.addEventListener('message', ({ data }) => { if (data?.friends && data.user === getSession()?.user.id) loadFriends(); });
  addEventListener('storage', (event) => {
    if (event.key !== dismissedKey()) return;
    loadDismissed();
    renderPeople();
  });
  $('online-guest-join').addEventListener('submit', (event) => {
    event.preventDefault();
    perform(async () => {
      const result = await multiplayer.joinRace(getSession(), { ...joinLink, displayName: $('online-guest-name').value.trim() });
      enterRoom(result);
    });
  });
  $('dismiss-race-invite').addEventListener('click', () => {
    joinLink = null;
    forgetPendingInvite();
    history.replaceState(history.state, '', multiplayer.clearRaceLink(location.href));
    error();
    renderHome();
  });
  $('online-ready').addEventListener('click', () => perform(async () => {
    const result = await multiplayer.setRaceReady(getSession(), credentials, !self()?.ready);
    applyRoom(result.room || result);
  }));
  $('online-leave').addEventListener('click', () => perform(leave));
  // Pressed again, a pick is taken back. Against a racer who left, the button does nothing.
  $('online-rematch').addEventListener('click', () => {
    const me = self();
    const opponent = opponentOf(room);

    if (!me || !opponent || rematchControls(me, opponent).mine === 'inactive') return;
    pickRematch(credentials, room.conditions, !me.rematch);
  });
  $('online-befriend').addEventListener('click', async () => {
    const from = credentials;
    const name = opponentOf(room)?.name || 'Your opponent';

    if (!(await changeFriends((signal) => multiplayer.addFriendFromRace(getSession(), from, signal)))) return;

    // A race opened since learns it from the service.
    if (credentials?.roomId === from.roomId) { befriended = true; renderAfter(); }

    announce(`${name} is on your friends list.`);
  });
  inbox.subscribe(onInbox);
  $('copy-race-link').addEventListener('click', copyLink);
  $('online-input').addEventListener('keydown', (event) => {
    if (event.repeat || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) event.preventDefault();
    typing.keydown(event);
  });
  $('online-input').addEventListener('paste', (event) => { event.preventDefault(); $('online-help').textContent = 'Paste is off. Type the passage.'; });
  $('online-input').addEventListener('drop', (event) => event.preventDefault());
  $('online-input').addEventListener('blur', () => { if (room?.status === 'racing' && !finishRequested) $('online-help').textContent = 'Click the passage to continue. The race clock is still running.'; });
  addEventListener('online', poll);
  addEventListener('resize', () => fx.relayout());
  document.fonts?.ready.then(() => fx.relayout());
  document.fonts?.addEventListener?.('loadingdone', () => fx.relayout());
  setInterval(updateClock, 100);
  loadDismissed();
  renderHome();

  if (joinLink) { navigate('compete'); show('people'); $('online-guest-name').focus(); }
  else {
    const saved = multiplayer.recallRace();

    if (saved) {
      restoring = true;
      multiplayer.getRace(getSession(), saved).then((result) => {
        enterRoom({ room: result.room || result, ...saved });
      }).catch((failure) => { multiplayer.forgetRace(); error(failure.message); }).finally(() => { restoring = false; });
    }
  }

  loadFriends();

  return {
    leave,
    joinInvite,
    // A guest's seat capability is only in this tab's credentials, so reuse them for the same room.
    rematchRoom: (roomId, conditions) => pickRematch(credentials?.roomId === roomId ? credentials : { roomId }, conditions),
    // The race this tab is seated in and still waiting or racing, if any.
    get liveRoomId() { return room && !terminal(room) ? room.id : null; },
    // Which Challenge view shows: people, add, setup, daily or local (one keyboard).
    get mode() { return view; },
    // A request made from this screen is still in flight (a room being created, joined or rematched, or a
    // seat, friend or readiness change), or this tab's room is being restored. A room either opens moves
    // the person to it.
    get pending() { return busy || restoring; },
    open() { navigate('compete'); show('people'); },
    // Opens Add a friend with its field focused (the friends board's button for when nobody else is on it).
    openAdd() { navigate('compete'); show('add'); $('online-invite-email').focus(); },
    // A new typing font moves every letter.
    relayout: () => fx.relayout(),
    // The friends board sits with the daily passage. A live race keeps its view; the board waits until it closes.
    openBoard() {
      navigate('compete');

      if (!live()) show('daily');
    },
    // Challenge opens on the people list, unless `keep` holds the view it shows; a race shows where the list would.
    onViewChange(screen, { keep = false } = {}) {
      if (screen === 'compete') {
        if (!keep && view !== 'people') { view = 'people'; onModeChange?.(); board?.hide(); }

        renderHome();

        if (view === 'people') { refreshInvites(); loadFriends(); refreshLinks(); fx.relayout(); quick.refresh(); }

        if (view === 'daily') board?.show();
      } else { setRunning(false); board?.hide(); }
    },
    // Ages and time left move on.
    tick() { if (document.body.dataset.view === 'compete' && view === 'people') renderPeople(); },
  };
}

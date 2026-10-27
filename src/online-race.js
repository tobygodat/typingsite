import { createAttempt, replayAttempt, selectPassage, CORPUS_VERSION, METRIC_VERSION } from './typing.js';
import { createTypingFx } from './motion.js';
import { encodeTrace, standIn, validTrace } from './ghost-race.js';
import * as multiplayer from './multiplayer.js';
import { showSpeed } from './units.js';
import { RACE_LEADS, raceOutcome, raceResultText, rematchControls, tallyView } from './race-result.js';
import { redrawList } from './inbox.js';
import { createRaceReview } from './race-review.js';

const $ = (id) => document.getElementById(id);
const stamp = (value) => typeof value === 'number' ? value : Date.parse(value);
const RESULT_RETAINED_MS = 23 * 60 * 60 * 1000;
// A finished race's results are watched for the other racer's Rematch pick: often while they are on
// screen, slowly otherwise.
const PICK_WATCH_MS = 1000;
const CLOSED_WATCH_MS = 3000;
// A trace posted just after the race finished can miss the first read, so traces are read up to three times.
const TRACE_READS = 3;
const TRACE_RETRY_MS = 2000;
const terminal = (room) => ['finished', 'cancelled', 'expired'].includes(room?.status);
const PENDING_INVITE = 'stilltype-race-invite-tab-v1';

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
export function createOnlineRace({ getSession, signIn, navigate, renderText, updateCharacterStates, setRunning, announce, onPassageSeen, inbox, board, onModeChange, wireTyping }) {
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
  let finishRequested = false;
  let baseKeystrokes = 0;
  let baseErrors = 0;
  let baseTyped = '';
  let lastClock = '';
  let lastAnnouncement = '';
  let mode = 'online';
  let friends = [];
  let friendsLoaded = false;
  // The rematch room this tab is moving to, and the room whose traces it has read.
  let following = null;
  let tracesRead = null;
  const review = createRaceReview({ renderText });
  // The empty list's copy from index.html; a failed first read shows its error there until a read succeeds.
  const noFriends = $('online-friends-empty').textContent;
  // Every friend-list request goes through this queue, one at a time, and each reply is the list.
  const friendRequests = multiplayer.queueFriendRequests((list) => { friends = list; friendsLoaded = true; renderFriends(); },
    { load: (signal) => multiplayer.listFriends(getSession(), signal) });
  let befriended = false;
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
  function setMode(value) {
    mode = value;
    $('online-challenge').hidden = value !== 'online';
    $('local-challenge').hidden = value !== 'local';
    $('daily-challenge').hidden = value !== 'daily';
    $('friends-board').hidden = value !== 'friends';
    $('challenge-online').setAttribute('aria-pressed', String(value === 'online'));
    $('challenge-local').setAttribute('aria-pressed', String(value === 'local'));
    $('challenge-daily').setAttribute('aria-pressed', String(value === 'daily'));
    $('challenge-friends').setAttribute('aria-pressed', String(value === 'friends'));
    setRunning(false);
    if (value === 'online') { fx.relayout(); refreshInvites(); }
    onModeChange?.();
    if (value === 'friends') board?.show(); else board?.hide();
  }
  function renderHome() {
    const signedIn = Boolean(getSession());
    $('online-host').hidden = Boolean(room || joinLink);
    $('online-guest-join').hidden = !joinLink || Boolean(room);
    $('online-room').hidden = !room;
    $('online-account-required').hidden = signedIn;
    $('online-setup').hidden = !signedIn;
    $('online-inbox').hidden = !signedIn;
    $('online-friends').hidden = !signedIn;
    if (!$('online-name').value) $('online-name').value = getSession()?.user.email.split('@')[0].slice(0, 24) || '';
    if (!$('online-guest-name').value) $('online-guest-name').value = $('online-name').value;
  }
  // The inbox polls invitations for every view; this screen lists the same ones.
  function renderInvites(invitations, failure) {
    if (failure) {
      $('online-invites-empty').hidden = false;
      $('online-invites-empty').textContent = failure.message;
      return;
    }
    $('online-invites-empty').textContent = 'No invitations yet.';
    $('online-invites-empty').hidden = invitations.length > 0;
    redrawList($('online-invites'), invitations.map((invite) => {
      const row = document.createElement('div');
      row.className = 'online-invite-row';
      const copy = document.createElement('p');
      copy.textContent = invite.rematch ? `${invite.hostName} wants a rematch.` : `${invite.hostName} invited you to race.`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary btn-sm';
      button.dataset.acceptInvite = invite.id;
      button.textContent = 'Join race';
      markBusy(button);
      button.addEventListener('click', () => joinInvite(invite.id));
      row.append(copy, button);
      return row;
    }));
  }
  async function refreshInvites() {
    if (!getSession()) return;
    $('refresh-race-invites').disabled = true;
    try { await inbox.refresh(); } finally { $('refresh-race-invites').disabled = false; }
  }
  function racerName() {
    return $('online-name').value.trim() || getSession()?.user.email.split('@')[0].slice(0, 24) || 'Racer';
  }
  // From this screen, a toast or the inbox. A live race has to be left first, so nobody is
  // abandoned mid-race by a notification.
  function joinInvite(roomId) {
    if (busy) return;
    navigate('compete');
    setMode('online');
    if (room && !terminal(room)) {
      if (room.id !== roomId) error('Leave your current race before joining another.');
      return;
    }
    perform(async () => {
      const result = await multiplayer.joinRace(getSession(), { roomId, guestToken: credentials?.guestToken, displayName: racerName() });
      enterRoom(result);
    });
  }
  function rematchPassage(conditions = {}) {
    return selectPassage({ mode: 'quote', quoteLength: conditions.quoteLength || 'medium', difficulty: conditions.difficulty || 'any',
      seenIds: conditions.textId ? [conditions.textId] : [] });
  }
  // Same opponent, same settings, a fresh passage. Picks Rematch on a closed race, or takes the pick back;
  // once both have picked, the service opens the next race and both tabs move to it (followRematch).
  function pickRematch(from, conditions, want = true) {
    if (busy) return;
    navigate('compete');
    setMode('online');
    if (room && !terminal(room)) { error('Leave your current race before starting another.'); return; }
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

  function renderFriends(failure = null) {
    $('online-friends-empty').hidden = friends.length > 0 && !failure;
    $('online-friends-empty').textContent = failure ? failure.message : noFriends;
    // A friend whose row goes (just removed) hands keyboard focus to the name field.
    redrawList($('online-friend-list'), friends.map((friend) => {
      const row = document.createElement('li');
      row.className = 'online-friend-row';
      const name = document.createElement('div');
      name.className = 'online-friend-name';
      const strong = document.createElement('strong');
      strong.textContent = friend.name;
      const detail = document.createElement('span');
      detail.textContent = friend.email || 'raced before';
      name.append(strong, detail);
      const actions = document.createElement('div');
      actions.className = 'online-actions';
      const race = document.createElement('button');
      race.type = 'button';
      race.className = 'btn btn-secondary btn-sm';
      race.dataset.raceFriend = friend.id;
      race.textContent = 'Challenge';
      race.setAttribute('aria-label', `Challenge ${friend.name}`);
      markBusy(race);
      race.addEventListener('click', () => perform(async () => {
        const result = await multiplayer.createRace(getSession(), { ...newRace(), displayName: racerName(), friendId: friend.id });
        enterRoom(result);
        $('online-account-invite-status').hidden = false;
        $('online-account-invite-status').textContent = friend.email
          ? `If ${friend.email} has an account, the challenge is waiting in their inbox.`
          : `The challenge is waiting in ${friend.name}’s inbox.`;
      }));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-ghost btn-sm';
      remove.dataset.removeFriend = friend.id;
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${friend.name} from friends`);
      markBusy(remove);
      remove.addEventListener('click', () => changeFriends((signal) => multiplayer.removeFriend(getSession(), friend.id, signal)));
      actions.append(race, remove);
      row.append(name, actions);
      return row;
    }), $('online-name'));
  }
  async function loadFriends() {
    if (!getSession()) return;
    try { await friendRequests.reload(); }
    catch (failure) { if (!friendsLoaded) renderFriends(failure); }
  }
  function newRace() {
    const passage = selectPassage({ mode: 'quote', quoteLength: 'medium', difficulty: 'any' });
    const conditions = { mode: 'quote', quoteLength: 'medium', difficulty: 'any', duration: 60, correctionPolicy: 'mandatory', onlineRace: true, language: 'en', inputClass: 'physical-keyboard', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
    return { passage, conditions };
  }
  // One race action at a time, and apart from those, one friend-list change at a time. While one is
  // in flight, every control that starts another of its kind (for races, also in the inbox and on the
  // toast) is aria-disabled and its press is ignored: aria-disabled, not disabled, so the control just
  // pressed keeps keyboard focus, and no press is dropped unseen. A friend change waiting its turn
  // behind a slow friend-list read holds up no race.
  const RACE_CONTROLS = '#create-online-race, #join-online-race, #online-ready, #online-leave, #online-rematch, [data-race-friend], [data-accept-invite]';
  const FRIEND_CONTROLS = '#online-befriend, [data-remove-friend]';
  function markBusy(control) {
    if ((control.matches(FRIEND_CONTROLS) ? changingFriends : busy) || control.dataset.state === 'inactive') control.setAttribute('aria-disabled', 'true');
    else control.removeAttribute('aria-disabled');
  }
  function renderBusy() {
    for (const control of $('online-challenge').querySelectorAll(`${RACE_CONTROLS}, ${FRIEND_CONTROLS}`)) markBusy(control);
    inbox.wait(busy ? ['invite', 'result'] : []);
  }
  async function changeFriends(send) {
    if (changingFriends) return false;
    changingFriends = true;
    renderBusy();
    error();
    try { await friendRequests.change(send); return true; }
    catch (failure) { error(failure.message || 'The race service is unavailable. Try again.'); return false; }
    finally { changingFriends = false; renderBusy(); }
  }
  async function perform(action) {
    if (busy) return;
    busy = true;
    renderBusy();
    error();
    try { await action(); } catch (failure) { error(failure.message || 'The race service is unavailable. Try again.'); }
    finally { busy = false; renderBusy(); if (room) renderRoom(); }
  }
  function resetAttempt() {
    attempt = null;
    textView = null;
    startPerf = null;
    baseTyped = '';
    baseKeystrokes = 0;
    baseErrors = 0;
    dirty = false;
    finishRequested = false;
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
    const nextId = result.roomId || result.room.id;
    // Going on to another race leaves a closed one, so its other racer sees that; its own rematch doesn't.
    const left = room && credentials && terminal(room) && ![room.id, room.rematchId].includes(nextId) ? credentials : null;
    if (left) multiplayer.leaveRace(getSession(), left).catch(() => {});
    generation += 1;
    clearTimeout(pollTimer);
    resetAttempt();
    credentials = { roomId: result.roomId || result.room.id, ...(result.guestToken ? { guestToken: result.guestToken } : {}), ...(result.inviteToken ? { inviteToken: result.inviteToken } : {}) };
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
    setMode('online');
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
    if (room.startAt && startPerf === null) {
      startPerf = performance.now() + stamp(room.startAt) - stamp(room.serverNow);
      setTimeout(updateClock, startPerf - performance.now());
    }
    startIfDue();
    if (['countdown', 'racing'].includes(room.status)) prepareAttempt();
    renderRoom();
    updateClock();
    if (terminal(room)) {
      setRunning(false);
      $('online-input').disabled = true;
      if (room.status === 'finished') renderResults();
      if (previousStatus !== room.status) say(room.status === 'finished' ? resultSentence() : $('online-room-status').textContent);
      followRematch();
    }
  }
  // The result as one sentence, as the inbox keeps it: "You beat Lin: 72 wpm to 65."
  function resultSentence() {
    const me = self();
    const opponent = opponentOf(room);
    if (!me || !opponent) return 'Race complete.';
    return raceResultText({ lead: RACE_LEADS[raceOutcome(me, opponent)], opponent: opponent.name, wpm: [me.wpm || 0, opponent.wpm || 0] });
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
      const lead = RACE_LEADS[raceOutcome(me, opponent)];
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
      && !(room.selfSlot === 1 && room.inviteKind === 'account');
    $('online-after').hidden = !canAdd;
    $('online-befriend').hidden = !canAdd;
    if (canAdd) $('online-befriend').textContent = `Add ${opponent.name} to friends`;
  }
  function renderRoom() {
    if (!room) return;
    const me = self();
    const opponent = opponentOf(room);
    const copy = {
      waiting: room.players.length < 2 ? 'Waiting for your opponent.'
        : room.rematchOf && !opponent?.connected && !opponent?.ready ? `Rematch sent. Waiting for ${opponent.name} to join.` : 'Both players are here.',
      countdown: 'Both players are ready.',
      racing: finishRequested || me?.finished ? 'Waiting for the other player.' : 'The clock keeps running if you leave the passage.',
      // The results below say it.
      finished: '',
      cancelled: 'This race ended because a player left.',
      expired: 'This invitation has expired.',
    };
    $('online-room-status').textContent = copy[room.status] ?? 'Connecting to the race…';
    $('online-ready').hidden = room.status !== 'waiting';
    $('online-ready').textContent = me?.ready ? 'Not ready' : 'Ready to race';
    $('online-stage').hidden = !['countdown', 'racing'].includes(room.status);
    $('online-players').hidden = room.status === 'finished';
    if (room.status !== 'waiting') $('online-account-invite-status').hidden = true;
    $('online-leave').textContent = terminal(room) ? 'Close race' : 'Leave race';
    $('challenge-local').disabled = !terminal(room);
    $('challenge-daily').disabled = !terminal(room);
    $('challenge-friends').disabled = !terminal(room);
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
    $('online-timer').textContent = delta < 0 ? '60 s race' : `${Math.ceil(remaining / 1000)} s remaining`;
    const me = self();
    // An accent commit typed before the limit is scored first, though the key that ended it comes after.
    const pending = typing.pending();
    const canType = room.status === 'racing' && delta >= 0 && (remaining > 0 || pending) && !finishRequested && !me?.finished;
    const wasDisabled = $('online-input').disabled;
    $('online-input').disabled = !canType;
    if (canType && wasDisabled && document.body.dataset.view === 'compete' && mode === 'online') {
      fx.relayout();
      $('online-input').focus({ preventScroll: true });
      say('The race has started. Type the passage.');
    }
    if (delta >= 0 && remaining === 0 && !finishRequested && attempt && !pending) {
      finishRequested = true;
      attempt.endedAt = (room.duration || 60) * 1000;
      dirty = true;
      setRunning(false);
      $('online-help').textContent = 'Time’s up. Sending your result…';
      poll();
    }
  }
  // A closed race with two players keeps a watch, so each sees the other's Rematch pick and both move to
  // the rematch together, until the service is due to delete the room.
  const watchingRematch = () => terminal(room) && room.players.length === 2
    && Date.now() < Date.parse(room.expiresAt) + RESULT_RETAINED_MS;
  const resultsInView = () => room?.status === 'finished' && !away() && mode === 'online';
  async function poll() {
    if (!credentials || networkBusy || (terminal(room) && !watchingRematch())) return;
    clearTimeout(pollTimer);
    const currentGeneration = generation;
    const currentCredentials = credentials;
    networkBusy = true;
    try {
      let next;
      if (dirty && attempt && room.status === 'racing') {
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
        next = await multiplayer.updateRaceProgress(getSession(), currentCredentials, payload);
      } else next = await multiplayer.getRace(getSession(), currentCredentials);
      if (currentGeneration !== generation) return;
      $('online-connection').textContent = '';
      applyRoom(next.room || next);
    } catch (failure) {
      if (currentGeneration !== generation) return;
      dirty ||= Boolean(attempt);
      $('online-connection').textContent = `Connection interrupted. Retrying… ${failure.message || ''}`;
    } finally {
      networkBusy = false;
      if (credentials && !terminal(room)) pollTimer = setTimeout(poll, dirty && finishRequested ? 0 : 650);
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
    const outcome = raceOutcome(me, opponent);
    const sides = [['mine', me, outcome], ['theirs', opponent, raceOutcome(opponent, me)]];
    for (const [side, player, result] of sides) {
      const node = $(`online-duel-${side}`);
      node.dataset.outcome = result;
      if (side === 'theirs') node.querySelector('.duel-name').textContent = player.name;
      showSpeed(node.querySelector('.duel-wpm'), player.wpm || 0);
      node.querySelector('.duel-accuracy').textContent = `${player.accuracy ?? 100}%`;
    }
    // Guests have no tally.
    const tally = me.account && opponent.account ? tallyView(room.tally, outcome) : null;
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
  // Both racers' traces draw the graph and the replay. A race from before traces, or one either racer
  // resumed after a reload, has none, and shows neither.
  async function readTraces() {
    if (tracesRead === room.id) return;
    tracesRead = room.id;
    const from = credentials;
    const { text } = room.passage;
    const name = opponentOf(room).name;
    for (let read = 1; read <= TRACE_READS; read += 1) {
      let traces;
      try { traces = await multiplayer.getRaceTraces(getSession(), from); } catch { return; }
      if (credentials !== from) return;
      const mine = traces.find((entry) => entry.slot === room.selfSlot)?.trace;
      const theirs = traces.find((entry) => entry.slot !== room.selfSlot)?.trace;
      if (validTrace(mine) && validTrace(theirs)) { review.show({ text, mine, theirs, name }); return; }
      if (read < TRACE_READS) await new Promise((resolve) => { setTimeout(resolve, TRACE_RETRY_MS); });
      if (credentials !== from) return;
    }
  }
  async function leave() {
    const previous = credentials;
    generation += 1;
    clearTimeout(pollTimer);
    credentials = null;
    room = null;
    multiplayer.forgetRace();
    resetAttempt();
    $('online-players').replaceChildren();
    $('online-share').hidden = true;
    $('challenge-local').disabled = false;
    $('challenge-daily').disabled = false;
    $('challenge-friends').disabled = false;
    renderHome();
    if (previous) {
      try { await multiplayer.leaveRace(getSession(), previous); }
      catch (failure) { error(`You left this tab’s race. ${failure.message || 'The server will close the room when it expires.'}`); }
    }
  }

  $('challenge-online').addEventListener('click', () => setMode('online'));
  $('challenge-local').addEventListener('click', () => setMode('local'));
  $('challenge-daily').addEventListener('click', () => setMode('daily'));
  $('challenge-friends').addEventListener('click', () => setMode('friends'));
  $('online-signin').addEventListener('click', signIn);
  $('refresh-race-invites').addEventListener('click', refreshInvites);
  $('online-setup').addEventListener('submit', (event) => {
    event.preventDefault();
    perform(async () => {
      const inviteEmail = $('online-invite-email').value.trim();
      const result = await multiplayer.createRace(getSession(), { ...newRace(), displayName: $('online-name').value.trim(), inviteEmail });
      enterRoom(result);
      if (inviteEmail && $('online-save-friend').checked) {
        // Saving is a convenience; the race already exists if it fails.
        friendRequests.change((signal) => multiplayer.addFriend(getSession(), { email: inviteEmail }, signal)).catch(() => {});
      }
      $('online-account-invite-status').hidden = !inviteEmail;
      $('online-account-invite-status').textContent = inviteEmail ? 'If that account exists, its invitation is waiting in their inbox.' : '';
      $('online-invite-sent').textContent = 'Anyone with the link can join. It expires in 15 minutes.';
    });
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
  $('online-invite-email').addEventListener('input', () => { $('online-save-friend-row').hidden = !$('online-invite-email').value.trim(); });
  inbox.subscribe(renderInvites);
  $('copy-race-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('online-guest-link').value); $('online-invite-sent').textContent = 'Link copied.'; }
    catch { $('online-guest-link').focus(); $('online-guest-link').select(); $('online-invite-sent').textContent = 'Select and copy the guest link above.'; }
  });
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
  renderHome();
  if (joinLink) { navigate('compete'); setMode('online'); $('online-guest-name').focus(); }
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
    // Which Challenge tab shows: online, daily or local (one keyboard).
    get mode() { return mode; },
    // A request made from this screen is still in flight (a room being created, joined or rematched, or a
    // seat, friend or readiness change), or this tab's room is being restored. A room either opens moves
    // the person to it.
    get pending() { return busy || restoring; },
    open() { navigate('compete'); setMode('online'); },
    // A new typing font moves every letter.
    relayout: () => fx.relayout(),
    // A live race keeps the Online view; the board waits until it closes.
    openBoard() { navigate('compete'); if (!room || terminal(room)) setMode('friends'); },
    onViewChange(view) {
      if (view === 'compete') {
        renderHome();
        if (mode === 'online') { refreshInvites(); loadFriends(); fx.relayout(); }
        if (mode === 'friends') board?.show();
      } else { setRunning(false); board?.hide(); }
    },
  };
}

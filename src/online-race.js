import { createAttempt, replayAttempt, selectPassage, CORPUS_VERSION, METRIC_VERSION } from './typing.js';
import { createTypingFx } from './motion.js';
import { standIn } from './ghost-race.js';
import * as multiplayer from './multiplayer.js';
import { speedFigure } from './units.js';
import { raceResultText } from './race-result.js';
import { redrawList } from './inbox.js';

const $ = (id) => document.getElementById(id);
const stamp = (value) => typeof value === 'number' ? value : Date.parse(value);
const RESULT_RETAINED_MS = 23 * 60 * 60 * 1000;
// The opponent opened a rematch that is still waiting for this player.
const rematchAsked = (room) => Boolean(room?.rematchId && room.rematchOpen && room.rematchSlot && room.rematchSlot !== room.selfSlot);
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
  // Same opponent, same settings, a fresh passage. Whoever asks second joins the first one's room.
  function rematch(from, conditions) {
    if (busy) return;
    navigate('compete');
    setMode('online');
    if (room && !terminal(room)) { error('Leave your current race before starting another.'); return; }
    perform(async () => {
      const passage = rematchPassage(conditions);
      const result = await multiplayer.rematchRace(getSession(), from, { passage, conditions: { ...conditions, textId: passage.id } });
      enterRoom(result);
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
  const RACE_CONTROLS = '#create-online-race, #join-online-race, #online-ready, #online-leave, #online-again, #online-rematch, [data-race-friend], [data-accept-invite]';
  const FRIEND_CONTROLS = '#online-befriend, [data-remove-friend]';
  function markBusy(control) {
    if (control.matches(FRIEND_CONTROLS) ? changingFriends : busy) control.setAttribute('aria-disabled', 'true');
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
    $('online-after').hidden = true;
    $('online-account-invite-status').hidden = true;
    befriended = false;
    setRunning(false);
  }
  function enterRoom(result) {
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
      if (previousStatus !== room.status) say(room.status === 'finished' ? $('online-winner').textContent : $('online-room-status').textContent);
    }
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
    if (rematchAsked(room)) {
      // Guests have no service inbox, so the entry lapses when the rematch room stops accepting racers.
      inbox.notify({ id: `invite:${room.rematchId}`, kind: 'invite', roomId: room.rematchId, local: true,
        until: room.rematchExpiresAt,
        text: `${room.rematchBy || 'Your opponent'} wants a rematch.` }, { toast: true });
    } else if (room.rematchId && !room.rematchOpen) {
      // Cancelled, expired or already under way: a request this device found is no longer open.
      inbox.withdraw(`invite:${room.rematchId}`);
    }
    const justFinished = previousStatus && previousStatus !== 'finished';
    if (room.status === 'finished' && opponent && (justFinished || entering)) {
      const me = self();
      // Accuracy breaks a WPM tie, as on the results board.
      const ahead = (me.wpm || 0) - (opponent.wpm || 0) || (me.accuracy ?? 100) - (opponent.accuracy ?? 100);
      const lead = ahead === 0 ? 'You tied with' : ahead > 0 ? 'You beat' : 'You raced';
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
    const show = terminal(room) && Boolean(opponent);
    $('online-after').hidden = !show;
    if (!show) return;
    const asked = rematchAsked(room);
    $('online-rematch-note').hidden = !asked;
    $('online-rematch-note').textContent = asked ? `${room.rematchBy || opponent.name} wants a rematch.` : '';
    $('online-rematch').textContent = asked ? 'Join rematch' : 'Race again';
    // A host who invited by email already has them by email; the list never links the two.
    const canAdd = Boolean(getSession()) && opponent.account && !opponent.friend && !befriended
      && !(room.selfSlot === 1 && room.inviteKind === 'account');
    $('online-befriend').hidden = !canAdd;
    $('online-befriend').textContent = `Add ${opponent.name} to friends`;
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
      finished: 'Race complete.',
      cancelled: 'This race ended because a player left.',
      expired: 'This invitation has expired.',
    };
    $('online-room-status').textContent = copy[room.status] || 'Connecting to the race…';
    $('online-ready').hidden = room.status !== 'waiting';
    $('online-ready').textContent = me?.ready ? 'Not ready' : 'Ready to race';
    $('online-stage').hidden = !['countdown', 'racing'].includes(room.status);
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
      dirty = true;
      setRunning(false);
      $('online-help').textContent = 'Time’s up. Sending your result…';
      poll();
    }
  }
  // A closed race with two players keeps a slow watch, so a rematch request reaches both and an
  // unanswered one is withdrawn when it lapses, until the service is due to delete the room.
  const watchingRematch = () => terminal(room) && room.players.length === 2 && (!room.rematchId || room.rematchOpen)
    && Date.now() < Date.parse(room.expiresAt) + RESULT_RETAINED_MS;
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
        const payload = { typed, keystrokes: baseKeystrokes + replay.insertions - baseTyped.length, errors: baseErrors + replay.mistakes - prefixErrors, finished: finishRequested };
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
      else if (credentials && watchingRematch()) pollTimer = setTimeout(poll, 3000);
    }
  }
  function renderResults() {
    $('online-results').hidden = false;
    const players = [...room.players].sort((a, b) => b.wpm - a.wpm || b.accuracy - a.accuracy);
    const tied = players.length === 2 && players[0].wpm === players[1].wpm && players[0].accuracy === players[1].accuracy;
    $('online-winner').textContent = tied ? 'It’s a tie.' : players.length === 2 ? `${players[0].name} leads.` : 'Race results';
    $('online-result-rows').replaceChildren(...players.map((player) => {
      const row = document.createElement('article');
      row.className = 'race-result-row';
      const name = document.createElement('strong');
      name.textContent = player.name;
      row.append(name);
      for (const value of [speedFigure(player.wpm || 0), `${player.accuracy ?? 100}% accuracy`, `${(player.elapsed || 0).toFixed(1)} s`]) {
        const span = document.createElement('span');
        span.className = 'num';
        span.append(value);
        row.append(span);
      }
      return row;
    }));
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
  $('online-again').addEventListener('click', () => perform(async () => { await leave(); refreshInvites(); $('online-name').focus(); }));
  $('online-rematch').addEventListener('click', () => {
    if (rematchAsked(room)) joinInvite(room.rematchId);
    else rematch(credentials, room.conditions);
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
    rematchRoom: (roomId, conditions) => rematch(credentials?.roomId === roomId ? credentials : { roomId }, conditions),
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

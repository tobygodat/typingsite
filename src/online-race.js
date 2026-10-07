import { createAttempt, replayAttempt, selectPassage, CORPUS_VERSION, METRIC_VERSION } from './typing.js';
import { createTypingFx } from './motion.js';
import * as multiplayer from './multiplayer.js';

const $ = (id) => document.getElementById(id);
const stamp = (value) => typeof value === 'number' ? value : Date.parse(value);
const RESULT_RETAINED_MS = 23 * 60 * 60 * 1000;
const REMATCH_OPEN_MS = 15 * 60 * 1000;
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
export function createOnlineRace({ getSession, signIn, navigate, renderText, updateCharacterStates, setRunning, announce, onPassageSeen, inbox }) {
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
  let befriended = false;
  const fx = createTypingFx($('online-stage').querySelector('.online-typing-wrap'), $('online-text-display'), { ensureCharacters: (index) => textView?.ensureForward(index) });

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
    $('challenge-online').setAttribute('aria-pressed', String(value === 'online'));
    $('challenge-local').setAttribute('aria-pressed', String(value === 'local'));
    $('challenge-daily').setAttribute('aria-pressed', String(value === 'daily'));
    $('compete-heading').textContent = value === 'online' ? 'A passage shared. A race together.' : value === 'daily' ? 'A passage for today.' : 'Same passage. One keyboard.';
    setRunning(false);
    if (value === 'online') { fx.relayout(); refreshInvites(); }
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
    $('online-invites').replaceChildren(...invitations.map((invite) => {
      const row = document.createElement('div');
      row.className = 'online-invite-row';
      const copy = document.createElement('p');
      copy.textContent = invite.rematch ? `${invite.hostName} wants a rematch.` : `${invite.hostName} invited you to race.`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary btn-sm';
      button.dataset.acceptInvite = invite.id;
      button.textContent = 'Join race';
      button.addEventListener('click', () => joinInvite(invite.id, button));
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
  function joinInvite(roomId, button = null) {
    navigate('compete');
    setMode('online');
    if (room && !terminal(room)) {
      if (room.id !== roomId) error('Leave your current race before joining another.');
      return;
    }
    perform(button, async () => {
      const result = await multiplayer.joinRace(getSession(), { roomId, guestToken: credentials?.guestToken, displayName: racerName() });
      enterRoom(result);
    });
  }
  function rematchPassage(conditions = {}) {
    return selectPassage({ mode: 'quote', quoteLength: conditions.quoteLength || 'medium', difficulty: conditions.difficulty || 'any',
      seenIds: conditions.textId ? [conditions.textId] : [] });
  }
  // Same opponent, same settings, a fresh passage. Whoever asks second joins the first one's room.
  function rematch(from, conditions, button = null) {
    navigate('compete');
    setMode('online');
    if (room && !terminal(room)) { error('Leave your current race before starting another.'); return; }
    perform(button, async () => {
      const passage = rematchPassage(conditions);
      const result = await multiplayer.rematchRace(getSession(), from, { passage, conditions: { ...conditions, textId: passage.id } });
      enterRoom(result);
    });
  }

  function renderFriends(failure = null) {
    $('online-friends-empty').hidden = friends.length > 0 && !failure;
    if (failure) $('online-friends-empty').textContent = failure.message;
    $('online-friend-list').replaceChildren(...friends.map((friend) => {
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
      race.addEventListener('click', () => perform(race, async () => {
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
      remove.addEventListener('click', () => perform(remove, async () => {
        friends = await multiplayer.removeFriend(getSession(), friend.id);
        renderFriends();
        $('online-name').focus();
      }));
      actions.append(race, remove);
      row.append(name, actions);
      return row;
    }));
  }
  async function loadFriends() {
    if (!getSession()) return;
    try { friends = await multiplayer.listFriends(getSession()); friendsLoaded = true; renderFriends(); }
    catch (failure) { if (!friendsLoaded) renderFriends(failure); }
  }
  function newRace() {
    const passage = selectPassage({ mode: 'quote', quoteLength: 'medium', difficulty: 'any' });
    const conditions = { mode: 'quote', quoteLength: 'medium', difficulty: 'any', duration: 60, correctionPolicy: 'mandatory', onlineRace: true, language: 'en', inputClass: 'physical-keyboard', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
    return { passage, conditions };
  }
  async function perform(button, action) {
    if (busy) return;
    busy = true;
    if (button) button.disabled = true;
    error();
    try { await action(); } catch (failure) { error(failure.message || 'The race service is unavailable. Try again.'); }
    finally { busy = false; if (button) button.disabled = false; if (room) renderRoom(); }
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
    if (baseTyped) attempt.events.push({ type: 'insert', text: baseTyped, accepted: true, offsetMs: 0 });
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
    }
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
    if (room.rematchId && room.rematchSlot && room.rematchSlot !== room.selfSlot) {
      // Guests have no service inbox; a rematch room stops accepting racers after 15 minutes.
      inbox.notify({ id: `invite:${room.rematchId}`, kind: 'invite', roomId: room.rematchId, local: true,
        until: new Date(Date.now() + REMATCH_OPEN_MS).toISOString(),
        text: `${room.rematchBy || 'Your opponent'} wants a rematch.` }, { toast: true });
    }
    const justFinished = previousStatus && previousStatus !== 'finished';
    if (room.status === 'finished' && opponent && (justFinished || entering)) {
      const me = self();
      // Accuracy breaks a WPM tie, as on the results board.
      const ahead = (me.wpm || 0) - (opponent.wpm || 0) || (me.accuracy ?? 100) - (opponent.accuracy ?? 100);
      const lead = ahead === 0 ? 'You tied with' : ahead > 0 ? 'You beat' : 'You raced';
      // Finished rooms are deleted a day after they expire, so Race again lapses a little before.
      const until = new Date(Date.parse(room.expiresAt || new Date().toISOString()) + RESULT_RETAINED_MS).toISOString();
      inbox.notify({ id: `result:${room.id}`, kind: 'result', roomId: room.id, until,
        conditions: room.conditions,
        text: `${lead} ${opponent.name}: ${me.wpm || 0} wpm to ${opponent.wpm || 0}.` }, { toast: justFinished && away() });
    }
  }
  function renderAfter() {
    const opponent = opponentOf(room);
    const show = terminal(room) && Boolean(opponent);
    $('online-after').hidden = !show;
    if (!show) return;
    const asked = room.rematchId && room.rematchSlot && room.rematchSlot !== room.selfSlot;
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
      waiting: room.players.length < 2 ? 'Waiting for your opponent. Share the link or wait for them to accept the account invitation.'
        : room.rematchOf && !opponent?.connected && !opponent?.ready ? `Rematch sent. Waiting for ${opponent.name} to join.` : 'Both players are here. Ready up to start together.',
      countdown: 'Both players are ready. The race starts together after the countdown.',
      racing: finishRequested || me?.finished ? 'Your run is finished. Waiting for the other player.' : 'The race is on. The clock keeps running if you leave the typing surface.',
      finished: 'Race complete. Two observed runs, with one shared start.',
      cancelled: 'This race ended because a player left. Create a new race to try again.',
      expired: 'This invitation has expired. Create a new race to try again.',
    };
    $('online-room-status').textContent = copy[room.status] || 'Connecting to the race…';
    $('online-ready').hidden = room.status !== 'waiting';
    $('online-ready').disabled = busy;
    $('online-ready').textContent = me?.ready ? 'Not ready' : 'Ready to race';
    $('online-stage').hidden = !['countdown', 'racing'].includes(room.status);
    $('online-leave').textContent = terminal(room) ? 'Close race' : 'Leave race';
    $('challenge-local').disabled = !terminal(room);
    $('challenge-daily').disabled = !terminal(room);
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
  function updateClock() {
    if (!room || startPerf === null || terminal(room)) return;
    const delta = performance.now() - startPerf;
    const remaining = Math.max(0, (room.duration || 60) * 1000 - delta);
    const countdown = delta < 0 ? `Starting in ${Math.ceil(-delta / 1000)}` : '';
    if (countdown !== lastClock) { $('online-countdown').textContent = countdown; lastClock = countdown; }
    $('online-timer').textContent = delta < 0 ? '60 s race' : `${Math.ceil(remaining / 1000)} s remaining`;
    const me = self();
    const canType = room.status === 'racing' && delta >= 0 && remaining > 0 && !finishRequested && !me?.finished;
    const wasDisabled = $('online-input').disabled;
    $('online-input').disabled = !canType;
    if (canType && wasDisabled && document.body.dataset.view === 'compete' && mode === 'online') {
      fx.relayout();
      $('online-input').focus({ preventScroll: true });
      say('The race has started. Type the passage.');
    }
    if (delta >= 0 && remaining === 0 && !finishRequested && attempt) {
      finishRequested = true;
      dirty = true;
      setRunning(false);
      $('online-help').textContent = 'Time’s up. Sending your result…';
      poll();
    }
  }
  // A closed race with two players keeps a slow watch, so a rematch request reaches both, until
  // the service is due to delete the room.
  const watchingRematch = () => terminal(room) && room.players.length === 2 && !room.rematchId
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
        const payload = { typed: replay.typed, keystrokes: baseKeystrokes + replay.insertions - baseTyped.length, errors: baseErrors + replay.mistakes - prefixErrors, finished: finishRequested };
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
      for (const value of [`${player.wpm || 0} wpm`, `${player.accuracy ?? 100}% accuracy`, `${(player.elapsed || 0).toFixed(1)} s`]) {
        const span = document.createElement('span');
        span.className = 'num';
        span.textContent = value;
        row.append(span);
      }
      return row;
    }));
  }
  function input(event) {
    if (!attempt || $('online-input').disabled) { event.preventDefault(); return; }
    event.preventDefault();
    if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') { $('online-help').textContent = 'Paste is off. Type the passage.'; return; }
    if (event.isComposing || event.inputType?.includes('Composition')) { $('online-help').textContent = 'IME input isn’t supported in races. Use direct keyboard input.'; return; }
    updateClock();
    if ($('online-input').disabled) return;
    const replay = replayAttempt(attempt);
    const offsetMs = Math.max(0, performance.now() - startPerf);
    if (event.inputType?.startsWith('delete')) {
      if (!replay.typed.length) return;
      attempt.events.push({ type: 'delete', count: 1, offsetMs });
    } else if (event.inputType === 'insertText' && event.data && [...event.data].length === 1 && !/[\r\n]/u.test(event.data)) {
      if (replay.typed.length >= attempt.text.length) return;
      const mustCorrect = attempt.conditions.correctionPolicy !== 'relaxed' && replay.typed.length > 0 && replay.typed.at(-1) !== attempt.text[replay.typed.length - 1];
      if (mustCorrect) { $('online-help').textContent = 'Correct the mistyped letter before continuing.'; return; }
      attempt.events.push({ type: 'insert', text: event.data, position: replay.typed.length, accepted: true, offsetMs });
    } else return;
    attempt.status = 'running';
    const next = replayAttempt(attempt);
    const previousLength = replay.typed.length;
    textView.ensureAhead(next.typed.length);
    updateCharacterStates(textView.characters, next.typed, attempt.text, previousLength);
    const correct = next.typed.at(-1) === attempt.text[next.typed.length - 1];
    fx.update(next.typed.length, next.typed.length <= previousLength ? 'delete' : correct ? 'correct' : 'wrong', next.typed.length > 0 && !correct);
    textView.trimBehind(next.typed.length);
    $('online-input').value = next.typed;
    $('online-input').setSelectionRange(next.typed.length, next.typed.length);
    $('online-help').textContent = '';
    dirty = true;
    if (document.body.dataset.view === 'compete') setRunning(true);
    if (next.typed === attempt.text) {
      finishRequested = true;
      $('online-input').disabled = true;
      $('online-help').textContent = 'Passage complete. Sending your result…';
      setRunning(false);
      poll();
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
    renderHome();
    if (previous) {
      try { await multiplayer.leaveRace(getSession(), previous); }
      catch (failure) { error(`You left this tab’s race. ${failure.message || 'The server will close the room when it expires.'}`); }
    }
  }

  $('challenge-online').addEventListener('click', () => setMode('online'));
  $('challenge-local').addEventListener('click', () => setMode('local'));
  $('challenge-daily').addEventListener('click', () => setMode('daily'));
  $('online-signin').addEventListener('click', signIn);
  $('refresh-race-invites').addEventListener('click', refreshInvites);
  $('online-setup').addEventListener('submit', (event) => {
    event.preventDefault();
    perform($('create-online-race'), async () => {
      const inviteEmail = $('online-invite-email').value.trim();
      const result = await multiplayer.createRace(getSession(), { ...newRace(), displayName: $('online-name').value.trim(), inviteEmail });
      enterRoom(result);
      if (inviteEmail && $('online-save-friend').checked) {
        // Saving is a convenience; the race already exists if it fails.
        multiplayer.addFriend(getSession(), { email: inviteEmail })
          .then((list) => { friends = list; renderFriends(); }).catch(() => {});
      }
      $('online-account-invite-status').hidden = !inviteEmail;
      $('online-account-invite-status').textContent = inviteEmail ? 'If that account exists, its invitation is waiting in their inbox.' : '';
      $('online-invite-sent').textContent = 'Anyone with this link can join the second seat. This room expires in 15 minutes.';
    });
  });
  $('online-guest-join').addEventListener('submit', (event) => {
    event.preventDefault();
    perform($('join-online-race'), async () => {
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
  $('online-ready').addEventListener('click', () => perform($('online-ready'), async () => {
    const result = await multiplayer.setRaceReady(getSession(), credentials, !self()?.ready);
    applyRoom(result.room || result);
  }));
  $('online-leave').addEventListener('click', () => perform($('online-leave'), leave));
  $('online-again').addEventListener('click', () => perform($('online-again'), async () => { await leave(); refreshInvites(); $('online-name').focus(); }));
  $('online-rematch').addEventListener('click', () => {
    if (room.rematchId && room.rematchSlot !== room.selfSlot) joinInvite(room.rematchId, $('online-rematch'));
    else rematch(credentials, room.conditions, $('online-rematch'));
  });
  $('online-befriend').addEventListener('click', () => perform($('online-befriend'), async () => {
    friends = await multiplayer.addFriendFromRace(getSession(), credentials);
    befriended = true;
    renderFriends();
    announce(`${opponentOf(room)?.name || 'Your opponent'} is on your friends list.`);
  }));
  $('online-invite-email').addEventListener('input', () => { $('online-save-friend-row').hidden = !$('online-invite-email').value.trim(); });
  inbox.subscribe(renderInvites);
  $('copy-race-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('online-guest-link').value); $('online-invite-sent').textContent = 'Guest link copied. Share it with your opponent.'; }
    catch { $('online-guest-link').focus(); $('online-guest-link').select(); $('online-invite-sent').textContent = 'Select and copy the guest link above.'; }
  });
  $('online-input').addEventListener('beforeinput', input);
  $('online-input').addEventListener('input', () => { if (attempt) $('online-input').value = replayAttempt(attempt).typed; });
  $('online-input').addEventListener('keydown', (event) => {
    if (event.repeat || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) event.preventDefault();
  });
  $('online-input').addEventListener('paste', (event) => { event.preventDefault(); $('online-help').textContent = 'Paste is off. Type the passage.'; });
  $('online-input').addEventListener('drop', (event) => event.preventDefault());
  $('online-input').addEventListener('blur', () => { if (room?.status === 'racing') $('online-help').textContent = 'Click the passage to continue. The race clock is still running.'; });
  $('online-input').addEventListener('compositionstart', () => { $('online-help').textContent = 'IME input isn’t supported in races. Use direct keyboard input.'; });
  addEventListener('online', poll);
  addEventListener('resize', () => fx.relayout());
  document.fonts?.ready.then(() => fx.relayout());
  setInterval(updateClock, 100);
  renderHome();
  if (joinLink) { navigate('compete'); setMode('online'); $('online-guest-name').focus(); }
  else {
    const saved = multiplayer.recallRace();
    if (saved) multiplayer.getRace(getSession(), saved).then((result) => {
      enterRoom({ room: result.room || result, ...saved });
    }).catch((failure) => { multiplayer.forgetRace(); error(failure.message); });
  }
  loadFriends();
  return {
    leave,
    joinInvite,
    // A guest's seat capability is only in this tab's credentials, so reuse them for the same room.
    rematchRoom: (roomId, conditions) => rematch(credentials?.roomId === roomId ? credentials : { roomId }, conditions),
    // The race this tab is seated in and still waiting or racing, if any.
    get liveRoomId() { return room && !terminal(room) ? room.id : null; },
    open() { navigate('compete'); setMode('online'); },
    onViewChange(view) {
      if (view === 'compete') { renderHome(); if (mode === 'online') { refreshInvites(); loadFriends(); fx.relayout(); } }
      else setRunning(false);
    },
  };
}

// Atomic race RPCs keep the start clock, seats and results on the server. Invite capabilities and
// occupied guest-seat capabilities are independent: forwarding an invite cannot take a seat.
import { request, freshSession, loadSession, AuthError } from './account.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/i;
const RECONNECT_KEY = 'stilltype-race-tab-v1';
const sequences = new Map();

async function action(session, type, credentials = {}, data = {}, signal) {
  // A previous poll may have rotated the refresh token. Reuse the newest stored session for the
  // same account, while still honoring the caller's current signed-in/guest identity.
  const stored = session ? loadSession() : null;
  const active = session ? await freshSession(stored?.user?.id === session.user?.id ? stored : session) : null;

  try {
    const result = await request('/rest/v1/rpc/race_action', {
      method: 'POST', token: active?.access_token, signal,
      body: { p_action: type, p_room_id: credentials.roomId || null,
        p_guest_token: credentials.guestToken || null, p_data: data },
    });

    const room = result?.room || result;

    if (room?.id && typeof room.passage === 'string') room.passage = { id: room.conditions?.textId || room.id, text: room.passage };
    const self = room?.players?.find((player) => player.slot === room.selfSlot);

    if (self && room.id) {
      const key = `${room.id}:${session?.user?.id || credentials.guestToken || result.guestToken}`;
      sequences.set(key, Math.max(sequences.get(key) || 0, self.sequence || 0));
    }

    return result;
  } catch (error) {
    if (error.status === 404 || /schema cache|could not find.*function/i.test(error.message)) {
      throw new AuthError('Online races are being set up. Please try again shortly.');
    }

    if (/unknown race action/i.test(error.message)) throw new AuthError('Friends and rematches are being set up. Please try again shortly.');

    if (/account service/.test(error.message)) throw new AuthError('Can’t reach the race. Check your connection; your place is held.');
    throw error;
  }
}

export function createRace(session, { passage, conditions = {}, displayName, inviteEmail = '', friendId = '' }) {
  if (!session?.user?.id) throw new AuthError('Sign in to host an online race.');

  const race = { passage: typeof passage === 'string' ? passage : passage?.text,
    conditions: { ...conditions, textId: conditions.textId || passage?.id }, displayName,
    inviteEmail: friendId ? '' : inviteEmail.trim() };

  if (friendId) race.friendId = friendId;

  return action(session, 'create', {}, race);
}

// Picks Rematch on a closed race, or takes the pick back (want: false). When both seats have picked, the
// service opens the next room for both, already counting down, and its id comes back as `rematchId`. The
// reply's `roomId` is another room only when this seat moves into it: a service from before picks opens or
// joins the rematch at the first ask.
export function rematchRace(session, credentials, { want = true, passage, conditions = {} }) {
  const ask = { want };

  if (passage) {
    ask.passage = typeof passage === 'string' ? passage : passage.text;
    ask.conditions = { ...conditions, textId: passage.id || conditions.textId };
  }

  return action(session, 'rematch', credentials, ask);
}

// Both racers' keystroke traces once the race is finished, in seat order: [{ slot, trace }].
export const getRaceTraces = (session, credentials) => action(session, 'traces', credentials).then((result) => result?.traces || []);

// Friends are private to the signed-in owner. Rows carry an email only when the owner typed it.
// Each call takes the abort signal its queue gives it (below).
export const listFriends = (session, signal) => session ? action(session, 'friends', {}, {}, signal) : Promise.resolve([]);
export const addFriend = (session, { email, name = '' }, signal) => action(session, 'befriend', {}, { email: email.trim(), name: name.trim() }, signal);
export const addFriendFromRace = (session, credentials, signal) => action(session, 'befriend', { roomId: credentials.roomId }, {}, signal);
export const removeFriend = (session, friendId, signal) => action(session, 'unfriend', {}, { friendId }, signal);

// A friend-list request that hasn't answered by then has failed: its fetch is aborted, so one stalled
// connection can't hold up the requests queued behind it.
const FRIEND_REQUEST_MS = 15000;

function sendWithin(send, limit) {
  const controller = new AbortController();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new AuthError('The friend list is taking too long to answer. Try again.'));
    }, limit);

    Promise.resolve(controller.signal).then(send).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

// This tab's friend-list requests (list, befriend, unfriend) never overlap: each is sent only once
// the one before it has settled (answered, failed or given up), and every reply is the whole list,
// applied as it lands. So the list shown is always the newest the service has given. A failed read
// applies nothing and holds nothing up. A change that fails or gives up may still have been made (an
// aborted fetch can't take back what the service already did), so the next request sent is a read
// of the list from `load`, ahead of anything already waiting, and the list shown catches up with the
// service. A reload queued behind another that hasn't been sent yet is that same reload.
export function queueFriendRequests(apply, { load, limit = FRIEND_REQUEST_MS } = {}) {
  let last = Promise.resolve();
  let waiting = 0;
  let waitingReload = null;
  let unsure = false; // a change failed or gave up, and no list has answered since

  async function go(request, change) {
    if (unsure && change) await go(load).catch(() => {});

    try {
      const list = await sendWithin(request, limit);
      unsure = false;
      apply(list);

      return list;
    } catch (failure) {
      if (change) unsure = true;
      throw failure;
    }
  }

  function queue(request, change = false) {
    waiting += 1;

    const applied = last.then(() => {
      waiting -= 1;

      return go(request, change);
    });

    last = applied.catch(() => { if (change && !waiting) requests.reload().catch(() => {}); });

    return applied;
  }

  const requests = {
    reload() {
      if (waitingReload) return waitingReload;

      const reload = queue((signal) => {
        if (waitingReload === reload) waitingReload = null;

        return load(signal);
      });

      waitingReload = reload;

      return reload;
    },
    change(send) {
      waitingReload = null;

      return queue(send, true);
    },
  };

  return requests;
}

// Quick match (public.quick_match): 'rating', 'queue' (join, or keep a place, and pair when it can) and
// 'unqueue'. A paired reply carries the room as race_action returns one. Before its migration is applied the
// function is missing, and the error says quick match is being set up.
export async function quickMatch(session, type, data = {}) {
  if (!session?.user?.id) throw new AuthError('Sign in to race someone new.');
  const stored = loadSession();
  const active = await freshSession(stored?.user?.id === session.user.id ? stored : session);

  try {
    const result = await request('/rest/v1/rpc/quick_match', { method: 'POST', token: active?.access_token, body: { p_action: type, p_data: data } });

    if (result?.room?.id && typeof result.room.passage === 'string') result.room.passage = { id: result.room.conditions?.textId || result.room.id, text: result.room.passage };

    return result;
  } catch (error) {
    if (error.status === 404 || /schema cache|could not find.*function/i.test(error.message)) {
      const missing = new AuthError('Quick match is being set up. Please try again shortly.');
      missing.unavailable = true;
      throw missing;
    }

    throw error;
  }
}

// Challenge's people links (public.race_people): each friend row's tally, and the friend row each open invitation
// and ghost challenge belongs to. Null before its migration is applied: rows then show no tally and the records
// stay apart, as they did before it.
export async function listPeopleLinks(session) {
  if (!session?.user?.id) return null;
  const stored = loadSession();
  const active = await freshSession(stored?.user?.id === session.user.id ? stored : session);

  try {
    return await request('/rest/v1/rpc/race_people', { method: 'POST', token: active?.access_token, body: {} });
  } catch (error) {
    if (error.status === 404 || /schema cache|could not find.*function/i.test(error.message)) return null;
    throw error;
  }
}

export const listRaceInvites = (session) => session ? action(session, 'invites') : Promise.resolve([]);

export function joinRace(session, { roomId, inviteToken, displayName, guestToken }) {
  return action(session, 'join', { roomId, guestToken }, { inviteToken: inviteToken || null, displayName });
}

export const getRace = (session, credentials) => action(session, 'get', credentials);
export const setRaceReady = (session, credentials, ready = true) => action(session, 'ready', credentials, { ready });

// A finished racer's progress carries the run's keystroke trace, which draws the graph and replay.
export function updateRaceProgress(session, credentials, { typed, keystrokes, errors, finished = false, trace = null }) {
  const key = `${credentials.roomId}:${session?.user?.id || credentials.guestToken}`;
  const sequence = (sequences.get(key) || 0) + 1;
  sequences.set(key, sequence);

  const progress = { typed, keystrokes, errors, finished, sequence };

  if (trace) progress.trace = trace;

  return action(session, 'progress', credentials, progress);
}

export const leaveRace = (session, credentials) => action(session, 'leave', credentials);

export function parseRaceLink(href) {
  const hash = new URLSearchParams(new URL(href).hash.slice(1));
  const roomId = hash.get('race'); const inviteToken = hash.get('invite');

  return UUID.test(roomId || '') && TOKEN.test(inviteToken || '') ? { roomId, inviteToken } : null;
}

export function clearRaceLink(href) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  hash.delete('race');
  hash.delete('invite');
  url.hash = hash.toString();

  return url.toString();
}

export function makeGuestRaceLink({ roomId, inviteToken }, href = location.href) {
  if (!UUID.test(roomId || '') || !TOKEN.test(inviteToken || '')) throw new AuthError('This race has no guest link.');
  const url = new URL(href);

  for (const key of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(key);
  url.hash = new URLSearchParams({ race: roomId, invite: inviteToken }).toString();

  return url.toString();
}

// Only this expiring, tab-scoped reconnect capability is retained for guests, never run history.
export function rememberRace(credentials) {
  if (!UUID.test(credentials?.roomId || '')) return;

  const saved = { roomId: credentials.roomId };

  if (credentials.guestToken) saved.guestToken = credentials.guestToken;

  if (credentials.inviteToken) saved.inviteToken = credentials.inviteToken;
  saved.savedAt = Date.now();

  try { sessionStorage.setItem(RECONNECT_KEY, JSON.stringify(saved)); } catch {}
}

export function recallRace() {
  try {
    const value = JSON.parse(sessionStorage.getItem(RECONNECT_KEY));

    if (!UUID.test(value?.roomId || '') || Date.now() - value.savedAt > 20 * 60 * 1000
      || (value.guestToken && !TOKEN.test(value.guestToken))) {
        forgetRace();

        return null;
      }

    return value;
  } catch { return null; }
}

export function forgetRace() { try { sessionStorage.removeItem(RECONNECT_KEY); } catch {} }

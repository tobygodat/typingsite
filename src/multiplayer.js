// Atomic race RPCs keep the start clock, seats and results on the server. Invite capabilities and
// occupied guest-seat capabilities are independent: forwarding an invite cannot take a seat.
import { request, freshSession, loadSession, AuthError } from './account.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/i;
const RECONNECT_KEY = 'stilltype-race-tab-v1';
const sequences = new Map();

async function action(session, type, credentials = {}, data = {}) {
  // A previous poll may have rotated the refresh token. Reuse the newest stored session for the
  // same account, while still honoring the caller's current signed-in/guest identity.
  const stored = session ? loadSession() : null;
  const active = session ? await freshSession(stored?.user?.id === session.user?.id ? stored : session) : null;
  try {
    const result = await request('/rest/v1/rpc/race_action', {
      method: 'POST', token: active?.access_token,
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
    if (/account service/.test(error.message)) throw new AuthError('Can’t reach the race. Check your connection; your place is held.');
    throw error;
  }
}
export function createRace(session, { passage, conditions = {}, displayName, inviteEmail = '' }) {
  if (!session?.user?.id) throw new AuthError('Sign in to host an online race.');
  return action(session, 'create', {}, { passage: typeof passage === 'string' ? passage : passage?.text,
    conditions: { ...conditions, textId: conditions.textId || passage?.id }, displayName, inviteEmail: inviteEmail.trim() });
}
export const listRaceInvites = (session) => session ? action(session, 'invites') : Promise.resolve([]);
export function joinRace(session, { roomId, inviteToken, displayName, guestToken }) {
  return action(session, 'join', { roomId, guestToken }, { inviteToken: inviteToken || null, displayName });
}
export const getRace = (session, credentials) => action(session, 'get', credentials);
export const setRaceReady = (session, credentials, ready = true) => action(session, 'ready', credentials, { ready });
export function updateRaceProgress(session, credentials, { typed, keystrokes, errors, finished = false }) {
  const key = `${credentials.roomId}:${session?.user?.id || credentials.guestToken}`;
  const sequence = (sequences.get(key) || 0) + 1;
  sequences.set(key, sequence);
  return action(session, 'progress', credentials, { typed, keystrokes, errors, finished, sequence });
}
export const leaveRace = (session, credentials) => action(session, 'leave', credentials);
export function parseRaceLink(href) {
  const hash = new URLSearchParams(new URL(href).hash.slice(1));
  const roomId = hash.get('race'); const inviteToken = hash.get('invite');
  return UUID.test(roomId || '') && TOKEN.test(inviteToken || '') ? { roomId, inviteToken } : null;
}
export function clearRaceLink(href) {
  const url = new URL(href); const hash = new URLSearchParams(url.hash.slice(1));
  hash.delete('race'); hash.delete('invite'); url.hash = hash.toString(); return url.toString();
}
export function makeGuestRaceLink({ roomId, inviteToken }, href = location.href) {
  if (!UUID.test(roomId || '') || !TOKEN.test(inviteToken || '')) throw new AuthError('This race has no guest link.');
  const url = new URL(href);
  for (const key of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(key);
  url.hash = new URLSearchParams({ race: roomId, invite: inviteToken }).toString(); return url.toString();
}
// Only this expiring, tab-scoped reconnect capability is retained for guests, never run history.
export function rememberRace(credentials) {
  if (!UUID.test(credentials?.roomId || '')) return;
  try { sessionStorage.setItem(RECONNECT_KEY, JSON.stringify({ roomId: credentials.roomId,
    ...(credentials.guestToken ? { guestToken: credentials.guestToken } : {}),
    ...(credentials.inviteToken ? { inviteToken: credentials.inviteToken } : {}), savedAt: Date.now() })); } catch {}
}
export function recallRace() {
  try {
    const value = JSON.parse(sessionStorage.getItem(RECONNECT_KEY));
    if (!UUID.test(value?.roomId || '') || Date.now() - value.savedAt > 20 * 60 * 1000
      || (value.guestToken && !TOKEN.test(value.guestToken))) { forgetRace(); return null; }
    return value;
  } catch { return null; }
}
export function forgetRace() { try { sessionStorage.removeItem(RECONNECT_KEY); } catch {} }
export function pollRace(session, credentials, onRoom, onError, interval = 750) {
  let stopped = false; let timer;
  const tick = async () => {
    try { const room = await getRace(typeof session === 'function' ? session() : session, credentials); if (!stopped) onRoom(room); }
    catch (error) { if (!stopped) onError?.(error); }
    if (!stopped) timer = setTimeout(tick, interval);
  };
  tick(); return () => { stopped = true; clearTimeout(timer); };
}

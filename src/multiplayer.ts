// Atomic race RPCs keep the start clock, seats and results on the server. Invite capabilities and
// occupied guest-seat capabilities are independent: forwarding an invite cannot take a seat.
import { request, freshSession, loadSession, AuthError } from './account.js';
import type { HistoricalRecord } from './profile-types.js';
import type { Session } from './network.js';
import { Schema } from 'effect';
import { isRecord } from './domain-values.js';
import { decodeReply, errorDetails } from './network.js';
import { abortable, within, accountLifetime } from './async-runtime.js';
import { entryReply, roomReply, quickReply, TraceReplySchema, FriendSchema, InviteSchema, PeopleLinksSchema } from './network-race.js';
import type { RaceConditions, CompactTrace, RaceRoom, RaceEntry } from './network-race.js';

export type { RaceRoom, RaceEntry, RacePlayer, Friend, RaceInvite, PeopleLinks, QuickMatchReply } from './network-race.js';

export type RaceCredentials = { -readonly [K in 'roomId' | 'guestToken' | 'inviteToken']?: RaceEntry[K] };

type Passage = string | { id?: string; text: string };

interface RaceSetup { passage: Passage; conditions?: RaceConditions; displayName: string; inviteEmail?: string; friendId?: string }

interface RematchSetup { want?: boolean; passage?: Passage; conditions?: RaceConditions | HistoricalRecord }

interface RaceProgress { typed: string; keystrokes: number; errors: number; finished?: boolean; trace?: CompactTrace | null }

interface CreateRaceData { passage?: string; conditions: RaceConditions; displayName: string; inviteEmail: string; friendId?: string }

interface RematchData { want: boolean; passage?: string; conditions?: RaceConditions | HistoricalRecord }

type RaceActionData = CreateRaceData | RematchData | RaceProgress & { sequence: number }
  | { email: string; name: string } | { friendId: string } | { inviteToken: string | null; displayName: string } | { ready: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/i;
const RECONNECT_KEY = 'stilltype-race-tab-v1';
const sequences = new Map<string, number>();

async function action(session: Session | null, type: string, credentials: RaceCredentials = {}, data: RaceActionData | undefined = undefined, signal?: AbortSignal): Promise<unknown> {
  const lifetime = accountLifetime();
  // A previous poll may have rotated the refresh token. Reuse the newest stored session for the
  // same account, while still honoring the caller's current signed-in/guest identity.
  const stored = session ? loadSession() : null;
  const active = session ? await freshSession(stored?.user?.id === session.user?.id ? stored : session, { signal }) : null;

  try {
    const result = await request('/rest/v1/rpc/race_action', {
      method: 'POST', token: active?.access_token, signal, lifetime,
      body: { p_action: type, p_room_id: credentials.roomId || null,
        p_guest_token: credentials.guestToken || null, p_data: data ?? {} },
    });

    return result;
  } catch (cause) {
    const error = errorDetails(cause);

    if (error.status === 404 || /schema cache|could not find.*function/i.test(error.message)) {
      throw new AuthError('Online races are being set up. Please try again shortly.');
    }

    if (/unknown race action/i.test(error.message)) throw new AuthError('Friends and rematches are being set up. Please try again shortly.');

    if (/account service/.test(error.message)) throw new AuthError('Can’t reach the race. Check your connection; your place is held.');
    throw error;
  }
}

export function createRace(session: Session | null, { passage, conditions = {}, displayName, inviteEmail = '', friendId = '' }: RaceSetup, signal?: AbortSignal) {
  if (!session?.user?.id) throw new AuthError('Sign in to host an online race.');

  const race: CreateRaceData = { passage: typeof passage === 'string' ? passage : passage?.text,
    conditions: { ...conditions, textId: conditions.textId || (typeof passage === 'string' ? undefined : passage?.id) }, displayName,
    inviteEmail: friendId ? '' : inviteEmail.trim() };

  if (friendId) race.friendId = friendId;

  return action(session, 'create', {}, race, signal).then((value) => entryWithSequence(value, session));
}

// Picks Rematch on a closed race, or takes the pick back (want: false). When both seats have picked, the
// service opens the next room for both, already counting down, and its id comes back as `rematchId`. The
// reply's `roomId` is another room only when this seat moves into it: a service from before picks opens or
// joins the rematch at the first ask.
export function rematchRace(session: Session | null, credentials: RaceCredentials, { want = true, passage, conditions = {} }: RematchSetup, signal?: AbortSignal) {
  const ask: RematchData = { want };

  if (passage) {
    ask.passage = typeof passage === 'string' ? passage : passage.text;
    ask.conditions = { ...conditions, textId: (typeof passage === 'string' ? undefined : passage.id) || conditions.textId };
  }

  return action(session, 'rematch', credentials, ask, signal).then((value) => entryWithSequence(value, session, credentials));
}

// Both racers' keystroke traces once the race is finished, in seat order: [{ slot, trace }].
export const getRaceTraces = (session: Session | null, credentials: RaceCredentials, signal?: AbortSignal) => action(session, 'traces', credentials, undefined, signal).then((result) => decodeReply(TraceReplySchema, result).traces || []);

// Friends are private to the signed-in owner. Rows carry an email only when the owner typed it.
// Each call takes the abort signal its queue gives it (below).
export const listFriends = (session: Session | null, signal?: AbortSignal) => session ? action(session, 'friends', {}, undefined, signal).then(friendList) : Promise.resolve([]);
export const addFriend = (session: Session | null, { email, name = '' }: { email: string; name?: string }, signal?: AbortSignal) => action(session, 'befriend', {}, { email: email.trim(), name: name.trim() }, signal).then(friendList);
export const addFriendFromRace = (session: Session | null, credentials: RaceCredentials, signal?: AbortSignal) => action(session, 'befriend', { roomId: credentials.roomId }, undefined, signal).then(friendList);
export const removeFriend = (session: Session | null, friendId: string, signal?: AbortSignal) => action(session, 'unfriend', {}, { friendId }, signal).then(friendList);

// A friend-list request that hasn't answered by then has failed: its fetch is aborted, so one stalled
// connection can't hold up the requests queued behind it.
const FRIEND_REQUEST_MS = 15000;

// This tab's friend-list requests (list, befriend, unfriend) never overlap: each is sent only once
// the one before it has settled (answered, failed or given up), and every reply is the whole list,
// applied as it lands. So the list shown is always the newest the service has given. A failed read
// applies nothing and holds nothing up. A change that fails or gives up may still have been made (an
// aborted fetch can't take back what the service already did), so the next request sent is a read
// of the list from `load`, ahead of anything already waiting, and the list shown catches up with the
// service. A reload queued behind another that hasn't been sent yet is that same reload.
export function queueFriendRequests<T>(apply: (list: T) => void, { load, limit = FRIEND_REQUEST_MS }: { load?: (signal: AbortSignal) => PromiseLike<T>; limit?: number } = {}) {
  let last: Promise<unknown> = Promise.resolve();
  let waiting = 0;
  let waitingReload: Promise<T> | null = null;
  let unsure = false; // a change failed or gave up, and no list has answered since

  async function go(request: (signal: AbortSignal) => PromiseLike<T>, change: boolean, lifetime: ReturnType<typeof accountLifetime>): Promise<T> {
    if (unsure && change && load) await go(load, false, lifetime).catch(() => {});

    try {
      const list = await lifetime.run(within(abortable(request, errorDetails), limit,
        () => new AuthError('The friend list is taking too long to answer. Try again.')));

      unsure = false;
      apply(list);

      return list;
    } catch (failure) {
      if (change) unsure = true;
      throw failure;
    }
  }

  function queue(request: (signal: AbortSignal) => PromiseLike<T>, change = false): Promise<T> {
    waiting += 1;
    const lifetime = accountLifetime();

    const applied = last.then(() => {
      waiting -= 1;

      return go(request, change, lifetime);
    });

    last = applied.catch(() => { if (lifetime.active && change && !waiting) requests.reload().catch(() => {}); });

    return applied;
  }

  const requests = {
    reload(): Promise<T> {
      if (waitingReload) return waitingReload;

      const reload = queue((signal) => {
        if (waitingReload === reload) waitingReload = null;

        return load ? load(signal) : Promise.reject(new AuthError('The friend list is unavailable.'));
      });

      waitingReload = reload;

      return reload;
    },
    change(send: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
      waitingReload = null;

      return queue(send, true);
    },
  };

  return requests;
}

// Quick match (public.quick_match): 'rating', 'queue' (join, or keep a place, and pair when it can) and
// 'unqueue'. A paired reply carries the room as race_action returns one. Before its migration is applied the
// function is missing, and the error says quick match is being set up.
export async function quickMatch(session: Session | null, type: 'rating' | 'queue' | 'unqueue', data: { displayName?: string } = {}) {
  if (!session?.user?.id) throw new AuthError('Sign in to race someone new.');
  const lifetime = accountLifetime();
  const stored = loadSession();
  const active = await freshSession(stored?.user?.id === session.user.id ? stored : session);

  try {
    const result = await request('/rest/v1/rpc/quick_match', { method: 'POST', token: active?.access_token, lifetime, body: { p_action: type, p_data: data ?? {} } });

    const reply = quickReply(result);

    return reply;
  } catch (cause) {
    const error = errorDetails(cause);

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
export async function listPeopleLinks(session: Session | null, signal?: AbortSignal) {
  if (!session?.user?.id) return null;
  const lifetime = accountLifetime();
  const stored = loadSession();
  const active = await freshSession(stored?.user?.id === session.user.id ? stored : session, { signal });

  try {
    return decodeReply(PeopleLinksSchema, await request('/rest/v1/rpc/race_people', { method: 'POST', token: active?.access_token, lifetime, signal, body: {} }));
  } catch (cause) {
    const error = errorDetails(cause);

    if (error.status === 404 || /schema cache|could not find.*function/i.test(error.message)) return null;
    throw error;
  }
}

export const listRaceInvites = (session: Session | null, signal?: AbortSignal) => session ? action(session, 'invites', {}, undefined, signal).then((value) => decodeReply(Schema.mutable(Schema.Array(InviteSchema)), value)) : Promise.resolve([]);

export function joinRace(session: Session | null, { roomId, inviteToken, displayName, guestToken }: RaceCredentials & { displayName: string }, signal?: AbortSignal) {
  return action(session, 'join', { roomId, guestToken }, { inviteToken: inviteToken || null, displayName }, signal).then((value) => entryWithSequence(value, session, { roomId, guestToken }));
}

export const getRace = (session: Session | null, credentials: RaceCredentials, signal?: AbortSignal) => action(session, 'get', credentials, undefined, signal).then((value) => roomWithSequence(value, session, credentials));
export const setRaceReady = (session: Session | null, credentials: RaceCredentials, ready = true, signal?: AbortSignal) => action(session, 'ready', credentials, { ready }, signal).then((value) => roomWithSequence(value, session, credentials));

// A finished racer's progress carries the run's keystroke trace, which draws the graph and replay. `sent` hears the
// packet's sequence number, which the service reports back for the packet it last applied.
export function updateRaceProgress(session: Session | null, credentials: RaceCredentials, { typed, keystrokes, errors, finished = false, trace = null }: RaceProgress, sent: (sequence: number) => void = () => {}, signal?: AbortSignal) {
  const key = `${credentials.roomId}:${session?.user?.id || credentials.guestToken}`;
  const sequence = (sequences.get(key) || 0) + 1;
  sequences.set(key, sequence);
  sent(sequence);

  const progress: RaceProgress & { sequence: number } = { typed, keystrokes, errors, finished, sequence };

  if (trace) progress.trace = trace;

  return action(session, 'progress', credentials, progress, signal).then((value) => roomWithSequence(value, session, credentials));
}

export const leaveRace = (session: Session | null, credentials: RaceCredentials, signal?: AbortSignal) => action(session, 'leave', credentials, undefined, signal).then((value) => roomWithSequence(value, session, credentials));

export function parseRaceLink(href: string) {
  const hash = new URLSearchParams(new URL(href).hash.slice(1));
  const roomId = hash.get('race'); const inviteToken = hash.get('invite');

  return typeof roomId === 'string' && typeof inviteToken === 'string' && UUID.test(roomId) && TOKEN.test(inviteToken) ? { roomId, inviteToken } : null;
}

export function clearRaceLink(href: string) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  hash.delete('race');
  hash.delete('invite');
  url.hash = hash.toString();

  return url.toString();
}

export function makeGuestRaceLink({ roomId, inviteToken }: { roomId: string; inviteToken: string }, href = location.href) {
  if (!UUID.test(roomId || '') || !TOKEN.test(inviteToken || '')) throw new AuthError('This race has no guest link.');
  const url = new URL(href);

  for (const key of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(key);
  url.hash = new URLSearchParams({ race: roomId, invite: inviteToken }).toString();

  return url.toString();
}

// Only this expiring, tab-scoped reconnect capability is retained for guests, never run history.
export function rememberRace(credentials: RaceCredentials) {
  if (!UUID.test(credentials?.roomId || '')) return;

  const saved: RaceCredentials & { savedAt: number } = { roomId: credentials.roomId, savedAt: Date.now() };

  if (credentials.guestToken) saved.guestToken = credentials.guestToken;

  if (credentials.inviteToken) saved.inviteToken = credentials.inviteToken;
  saved.savedAt = Date.now();

  try { sessionStorage.setItem(RECONNECT_KEY, JSON.stringify(saved)); } catch {}
}

export function recallRace() {
  try {
    const value = decodeReply(Schema.Struct({ roomId: Schema.String, guestToken: Schema.optional(Schema.String), inviteToken: Schema.optional(Schema.String), savedAt: Schema.Number }), JSON.parse(sessionStorage.getItem(RECONNECT_KEY) || 'null'));

    if (!UUID.test(value?.roomId || '') || Date.now() - value.savedAt > 20 * 60 * 1000
      || (value.guestToken && !TOKEN.test(value.guestToken))) {
        forgetRace();

        return null;
      }

    return value;
  } catch { return null; }
}

export function forgetRace() { try { sessionStorage.removeItem(RECONNECT_KEY); } catch {} }

const friendList = (value: unknown) => decodeReply(Schema.mutable(Schema.Array(FriendSchema)), value);

function seedSequence(room: RaceRoom, session: Session | null, credentials: RaceCredentials = {}): void {
  const self = room.players?.find((player) => player.slot === room.selfSlot);

  if (self && room.id) {
    const key = `${room.id}:${session?.user.id || credentials.guestToken}`;
    sequences.set(key, Math.max(sequences.get(key) || 0, self.sequence || 0));
  }
}

function entryWithSequence(value: unknown, session: Session | null, credentials: RaceCredentials = {}): RaceEntry {
  const entry = entryReply(value);
  seedSequence(entry.room, session, { ...credentials, guestToken: credentials.guestToken || entry.guestToken });

  return entry;
}

function roomWithSequence(value: unknown, session: Session | null, credentials: RaceCredentials): RaceRoom {
  const room = roomReply(isRecord(value) && value.room ? value.room : value);
  seedSequence(room, session, credentials);

  return room;
}

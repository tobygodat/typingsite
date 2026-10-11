// Accounts: Supabase Auth and one row of profile data per user, spoken to over fetch so the app
// keeps no runtime dependencies. With no session the visitor is a guest and nothing is stored.
// The publishable key is meant for browsers; row-level security limits every row to its owner.
import { MAX_RUN_SUMMARIES, dailyChallengeId, retainRuns, settleDailyFirsts, trendRun } from './insights.js';
import { conditionKey } from './typing.js';

const SUPABASE_URL = 'https://bicbyljexprkaedakofa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-JwGKezfGmITUHTITrhsNw_Izw71gdI';
export const SESSION_KEY = 'stilltype-session-v1';
const VERIFIER_KEY = 'stilltype-pkce-verifier';
export const LEGACY_PROFILE_KEY = 'stilltype-profile-v2';

export const profileKey = (userId) => `${LEGACY_PROFILE_KEY}:${userId}`;

export class AuthError extends Error {}

function base64url(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createVerifier() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challengeFor(verifier) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

// Supabase returns to the app with ?code= (PKCE), #access_token= (email links) or an error in either.
export function parseAuthRedirect(href) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const error = url.searchParams.get('error_description') || hash.get('error_description') || url.searchParams.get('error') || hash.get('error');
  if (error) return { kind: 'error', message: error.replace(/\+/g, ' ') };
  if (url.searchParams.get('code')) return { kind: 'code', code: url.searchParams.get('code') };
  if (hash.get('access_token')) {
    return {
      kind: 'tokens',
      access_token: hash.get('access_token'),
      refresh_token: hash.get('refresh_token'),
      expires_in: Number(hash.get('expires_in')) || 3600,
    };
  }
  return null;
}

// The address without auth parameters, so a reload never replays a used code.
export function cleanRedirectUrl(href) {
  const url = new URL(href);
  for (const key of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(key);
  const hash = new URLSearchParams(url.hash.slice(1));
  if (['access_token', 'error', 'error_description'].some((key) => hash.has(key))) url.hash = '';
  return url.toString();
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

function remove(key) {
  try { localStorage.removeItem(key); } catch {}
}

export function loadSession() {
  const session = readJson(SESSION_KEY);
  return session?.user?.id && session.refresh_token ? session : null;
}

function sessionFrom(data) {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: { id: data.user.id, email: data.user.email || '' },
  };
}

function storeSession(data) {
  const session = sessionFrom(data);
  writeJson(SESSION_KEY, session);
  return session;
}

// A request that hasn't finished by then fails as unreachable, so nothing waiting behind it (the push
// queue, sign-out) can hang on a stalled connection; edits stay on the device, as offline. A keepalive
// request (a page being hidden) is left to the browser.
export const REQUEST_TIMEOUT_MS = 15000;

export async function request(path, { method = 'GET', body, token, headers = {}, keepalive = false } = {}) {
  const signal = !keepalive && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
  let response;
  let text;
  try {
    response = await fetch(`${SUPABASE_URL}${path}`, {
      method,
      keepalive,
      signal,
      headers: {
        apikey: SUPABASE_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    text = await response.text();
  } catch {
    throw new AuthError('Can’t reach the account service. Check your connection.');
  }
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const message = data?.msg || data?.error_description || data?.message || data?.error || `Request failed (${response.status}).`;
    const error = new AuthError(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function signUp(email, password, redirectTo) {
  const data = await request(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: { email, password } });
  // With email confirmation on, Supabase returns the user without a session.
  if (data?.access_token) return { session: storeSession(data) };
  return { confirm: true };
}

export async function signIn(email, password) {
  const data = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  return storeSession(data);
}

// Asks first, so a provider that is not configured yet gives a sentence rather than a raw error page.
export async function startGoogleSignIn(redirectTo) {
  const settings = await request('/auth/v1/settings');
  if (!settings?.external?.google) throw new AuthError('Google sign-in isn’t switched on yet. Use an email and password for now.');
  const verifier = createVerifier();
  writeJson(VERIFIER_KEY, verifier);
  const params = new URLSearchParams({
    provider: 'google',
    redirect_to: redirectTo,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 's256',
  });
  location.assign(`${SUPABASE_URL}/auth/v1/authorize?${params}`);
}

// Finishes a Google or email-link return. Returns the new session, or null if the URL carries none.
export async function completeRedirect(href) {
  const redirect = parseAuthRedirect(href);
  if (!redirect) return null;
  history.replaceState(history.state, '', cleanRedirectUrl(href));
  if (redirect.kind === 'error') throw new AuthError(redirect.message);
  if (redirect.kind === 'code') {
    const verifier = readJson(VERIFIER_KEY);
    remove(VERIFIER_KEY);
    if (!verifier) throw new AuthError('That sign-in link has expired. Try again.');
    const data = await request('/auth/v1/token?grant_type=pkce', { method: 'POST', body: { auth_code: redirect.code, code_verifier: verifier } });
    return storeSession(data);
  }
  const user = await request('/auth/v1/user', { token: redirect.access_token });
  return storeSession({ ...redirect, user });
}

// Returns a session with a usable access token, refreshing it if it is about to expire.
export async function freshSession(session = loadSession()) {
  if (!session) return null;
  // Background polls (race, inbox) may already have rotated this user's refresh token; a stale
  // copy would be rejected and end the session, so the newest stored one wins. Two refreshes in
  // the same second share an expiry, and storage always holds the later of them, so a tie goes to it.
  const stored = loadSession();
  if (stored?.user?.id === session.user?.id && stored.expires_at >= session.expires_at) session = stored;
  if (session.expires_at - 60 > Date.now() / 1000) return session;
  try {
    const data = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
    // Stored only while the device is still signed in as this user: another tab may have signed out, or
    // in as someone else, since this tab read the session.
    return loadSession()?.user.id === session.user?.id ? storeSession(data) : sessionFrom(data);
  } catch (error) {
    // A rejected refresh token means the session is over; a network failure keeps it for later. Only the
    // session whose token was refused is removed, never one another tab stored since (a newer token, or
    // another account).
    if (error.status >= 400 && error.status < 500 && loadSession()?.refresh_token === session.refresh_token) remove(SESSION_KEY);
    throw error;
  }
}

export async function signOut(session, { keepCache = false } = {}) {
  remove(SESSION_KEY);
  if (session && !keepCache) remove(profileKey(session.user.id));
  try { await request('/auth/v1/logout', { method: 'POST', token: session?.access_token }); } catch {}
}

export async function fetchCloudProfile(session) {
  const rows = await request(`/rest/v1/profiles?select=data,updated_at&user_id=eq.${session.user.id}`, { token: session.access_token });
  return rows?.[0] || null;
}

// An ISO time later than now and than every given stamp, so a device whose clock runs behind still
// moves a stamp forward rather than writing one that looks older than what it replaces.
export function stampAfter(...stamps) {
  const times = stamps.map((stamp) => Date.parse(stamp) + 1).filter(Number.isFinite);
  return new Date(Math.max(Date.now(), ...times)).toISOString();
}

// Writes only if the row is still the version read at `seenAt` (owners may update their own row, see
// supabase/migrations). Resolves to the new updated_at, or null when another writer got there first.
export async function updateCloudProfile(session, data, seenAt, { keepalive = false } = {}) {
  const rows = await request(`/rest/v1/profiles?user_id=eq.${session.user.id}&updated_at=eq.${encodeURIComponent(seenAt)}&select=updated_at`, {
    method: 'PATCH',
    token: session.access_token,
    keepalive,
    headers: { Prefer: 'return=representation' },
    body: { data, updated_at: stampAfter(seenAt) },
  });
  return rows?.[0]?.updated_at || null;
}

// Creates the row only if the account has none. Null means another writer created it first.
export async function insertCloudProfile(session, data) {
  const rows = await request('/rest/v1/profiles?select=updated_at', {
    method: 'POST',
    token: session.access_token,
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: { user_id: session.user.id, data, updated_at: new Date().toISOString() },
  });
  return rows?.[0]?.updated_at || null;
}

export function loadCachedProfile(userId) {
  return readJson(profileKey(userId));
}

export function cacheProfile(userId, data) {
  return writeJson(profileKey(userId), data);
}

// The device cache as text, so a tab can tell whether another tab has written it since.
export function loadCachedProfileText(userId) {
  try { return localStorage.getItem(profileKey(userId)); } catch { return null; }
}

export function cacheProfileText(userId, text) {
  try { localStorage.setItem(profileKey(userId), text); return true; } catch { return false; }
}

// ── Merging copies of one account's profile ─────────────────────────────
// Two tabs, two devices or a device and the account row can each hold edits the other lacks, so
// syncing merges rather than letting one whole copy replace another.

export const MAX_STORED_ATTEMPTS = 24;

// Every history collection in a profile: the timestamp it is ordered and cleared by, and the cap kept
// after a save or merge. Items are never edited once stored, so an id names one record everywhere.
// A new collection is added here and nowhere else.
export const HISTORY = {
  attempts: { at: 'at', keep: (items) => items.slice(-MAX_STORED_ATTEMPTS) },
  runs: { at: 'at', keep: retainRuns },
  loops: { at: 'at', keep: (items) => items },
};

const list = (value) => (Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : []);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const recordId = (item) => String(item.id ?? JSON.stringify(item));

export function capHistory(profile) {
  for (const [name, { keep }] of Object.entries(HISTORY)) profile[name] = keep(list(profile[name]));
  return profile;
}

// Whether best `a` beats `b`: the higher wpm, then the earlier record (a later run has to beat a best,
// not match it), then the attempt id. A total order, so every copy keeps the same best for a tie
// whichever side merged first, and copies settle instead of rewriting the row on every load.
export const beatsBest = (a, b) => !b || a.wpm > b.wpm || (a.wpm === b.wpm
  && (compare(a.at || '', b.at || '') || compare(String(a.attemptId ?? ''), String(b.attemptId ?? ''))) < 0);

// historyClearedIds: the records each clear named (see clearProfile), as [marker, id] pairs, so an undo
// drops exactly the ids its own clear named. Every clear that hasn't been undone keeps its pairs: two
// devices can clear independently, and the newer marker alone would let a stale copy bring back a
// record the older clear named. Earlier copies of this field hold ids alone, named by the copy's
// historyClearedAt. Only records stamped ahead of a clear are named, so there are usually few. The
// newest clear keeps all of its pairs: they can't outnumber the records it removed, even after a clock
// corrected far backward (every run and loop then named). Older clears keep their newest
// MAX_CLEARED_IDS pairs (by clear, then id) between them.
export const MAX_CLEARED_IDS = MAX_RUN_SUMMARIES;
const namedPairs = (side) => list(side.historyClearedIds).flatMap((entry) => {
  const [marker, id] = typeof entry === 'string' ? [side.historyClearedAt, entry] : Array.isArray(entry) ? entry : [];
  return marker && typeof marker === 'string' && id && typeof id === 'string' ? [[marker, id]] : [];
});
const liveNamed = (pairs, undone, newest) => {
  const live = [...new Map(pairs.filter(([marker]) => !undone.includes(marker))
    .map((pair) => [JSON.stringify(pair), pair])).values()]
    .sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]));
  const older = live.filter(([marker]) => marker !== newest);
  const dropped = new Set(older.slice(0, Math.max(0, older.length - MAX_CLEARED_IDS)));
  return live.filter((pair) => !dropped.has(pair));
};
// The ids a copy's clears named (a merged or cleared copy holds only clears not undone).
export const clearedIds = (profile) => new Set(namedPairs(profile).map(([, id]) => id));

// Clear history: every HISTORY collection, the bests and the seen passages (preferences stay). The
// marker it leaves is this clock's now, moved past any earlier marker (an undone one included, so a new
// clear never matches an old one). Copies elsewhere drop what they hold from at or before it. A record
// stamped after it, by a clock running ahead of this one, is named by id instead: taking the latest
// stamp as the marker would move the marker into the future, where it would also take runs made
// elsewhere after the clear.
export function clearProfile(profile) {
  const marker = stampAfter(profile.historyClearedAt, ...list(profile.undoneClears));
  const ahead = new Set();
  for (const [name, { at }] of Object.entries(HISTORY)) {
    for (const item of list(profile[name])) if ((item[at] || '') > marker && item.id) ahead.add(String(item.id));
  }
  for (const best of Object.values(profile.bests || {})) if ((best?.at || '') > marker && best.attemptId) ahead.add(String(best.attemptId));
  const named = liveNamed([...namedPairs(profile), ...[...ahead].map((id) => [marker, id])], list(profile.undoneClears), marker);
  const cleared = { ...profile, historyClearedAt: marker, bests: {}, seenTextIds: [] };
  for (const name of Object.keys(HISTORY)) cleared[name] = [];
  if (named.length) cleared.historyClearedIds = named;
  else delete cleared.historyClearedIds;
  return cleared;
}

const stampsOf = (side) => (side.preferencesAt && typeof side.preferencesAt === 'object' ? side.preferencesAt : {});

// Each setting comes from the side that changed it last. preferencesAt maps a setting to when it last
// changed and is stamped on every change, so a font size changed on one device survives a test shape
// picked later on another. A setting only one side has stamped comes from that side: the other has
// recorded no change to it since stamps began. A setting neither side has stamped (profiles saved
// before stamps) comes from the newer profile by updatedAt, as whole-profile sync chose, and keeps this
// device's when neither is newer. Equal stamps (edits in the same millisecond, or clocks that each
// stepped just past the same stamp from a clock running ahead, see stampAfter) go to the value that
// sorts first, so every copy picks the same one and copies settle. A setting one side lacks (an older
// build) comes from the side that has it.
const valueOrder = (value) => JSON.stringify(value) ?? '';
export function mergePreferences(local, cloud) {
  const mine = local.preferences || {};
  const theirs = cloud.preferences || {};
  const myStamps = stampsOf(local);
  const theirStamps = stampsOf(cloud);
  const cloudNewer = (cloud.updatedAt || '') > (local.updatedAt || '');
  const preferences = {};
  const preferencesAt = {};
  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const a = myStamps[key] || '';
    const b = theirStamps[key] || '';
    const fromCloud = a || b ? b > a || (b === a && valueOrder(theirs[key]) < valueOrder(mine[key])) : cloudNewer;
    preferences[key] = (fromCloud ? theirs[key] : mine[key]) ?? (fromCloud ? mine[key] : theirs[key]);
    if (a || b) preferencesAt[key] = a > b ? a : b;
  }
  return { preferences, preferencesAt };
}

// A run summary trimmed by retainRuns has lost its pattern counts; the fuller copy of a record wins.
const fuller = (held, other) => ((other.patterns?.length || 0) > (held.patterns?.length || 0) ? other : held);

// Merges another copy of this account's profile (`cloud`: the account row, or another tab's cache) into
// this device's (`local`). Field by field:
// - attempts, runs, loops (HISTORY): union by id, ordered by date, then the usual caps. Equal dates
//   (undated records from older builds) order by id, so both sides list them the same way. Only a day's
//   earliest daily attempt keeps its first-attempt label (settleDailyFirsts).
// - bests: per condition key the best by beatsBest (the higher wpm), so a merge never lowers a best.
// - seenTextIds: union, so a passage once shown is never offered as fresh again.
// - preferences and preferencesAt: setting by setting, from mergePreferences above.
// - historyClearedIds: union of both sides' pairs from clears not undone. A record any of them names is
//   dropped from either side: no copy can hold it legitimately while that clear stands.
// - historyClearedAt: the newest clear that hasn't been undone. A side that hasn't applied it yet (an
//   older marker of its own) may still hold what that clear removed: its history and bests dated at or
//   before the marker are dropped, and its seen ids are kept only where its surviving history
//   shows the passage after the clear. Seen ids carry no date, so this is the one place a seen id can
//   go: one only displayed, never run, on a device that hadn't yet heard of the clear. That side's
//   surviving practice runs then set any best the old one had blocked.
// - undoneClears: union of clears that were undone, which never apply again. Never trimmed: a copy
//   that applied an old clear and missed its undo must still find it here, and each entry takes a
//   typed confirmation and an Undo within seconds, so the list stays tiny.
// - updatedAt: the later of the two (the time of the last saved edit anywhere).
// - profileId: the smaller id, so every copy settles on the same one whichever merges first.
// - version and any field this build doesn't know: this device's copy, filled from the other side, so
//   a field written by a newer build survives a merge made by an older one.
export function mergeSynced(local, cloud) {
  const undone = [...new Set([...list(local.undoneClears), ...list(cloud.undoneClears)])].sort();
  const live = (marker) => (marker && !undone.includes(marker) ? marker : '');
  const clearedAt = [live(local.historyClearedAt), live(cloud.historyClearedAt)].sort().at(-1);
  const named = liveNamed([...namedPairs(local), ...namedPairs(cloud)], undone, clearedAt);
  const namedIds = new Set(named.map(([, id]) => id));

  const surviving = (side) => {
    const stale = (side.historyClearedAt || '') < clearedAt;
    const after = (stamp, id) => !namedIds.has(String(id ?? '')) && (!stale || (stamp || '') > clearedAt);
    const kept = {};
    for (const [name, { at }] of Object.entries(HISTORY)) kept[name] = list(side[name]).filter((item) => after(item[at], item.id));
    kept.bests = Object.fromEntries(Object.entries(side.bests || {}).filter(([, best]) => best && after(best.at, best.attemptId)));
    const shown = new Set();
    for (const name of Object.keys(HISTORY)) {
      for (const item of kept[name]) {
        if (item.textId) shown.add(item.textId);
        if (item.challengeDate) shown.add(dailyChallengeId(item.challengeDate));
      }
    }
    kept.seenTextIds = list(side.seenTextIds).filter((id) => !stale || shown.has(id));
    kept.stale = stale;
    return kept;
  };
  const mine = surviving(local);
  const theirs = surviving(cloud);

  const merged = { ...cloud, ...local };
  for (const [name, { at, keep }] of Object.entries(HISTORY)) {
    const byId = new Map();
    for (const item of [...mine[name], ...theirs[name]]) {
      const id = recordId(item);
      byId.set(id, byId.has(id) ? fuller(byId.get(id), item) : item);
    }
    // Settled before the caps, so the day's earliest attempt is found even if the cap then drops it.
    merged[name] = keep(settleDailyFirsts([...byId.values()].sort((a, b) => compare(a[at] || '', b[at] || '') || compare(recordId(a), recordId(b)))));
  }
  merged.bests = { ...theirs.bests };
  for (const [key, best] of Object.entries(mine.bests)) {
    if (beatsBest(best, merged.bests[key])) merged.bests[key] = best;
  }
  // On a side that hadn't heard of the clear, an old best may have kept a later run from becoming one.
  // With the old best gone, that run is the best it would have been: the same rule storeAttempt uses.
  for (const run of [mine, theirs].filter((kept) => kept.stale).flatMap((kept) => kept.runs)) {
    const key = conditionKey(run.conditions);
    const best = { wpm: run.score?.wpm, attemptId: run.id, at: run.at };
    if (trendRun(run) && Number.isFinite(best.wpm) && beatsBest(best, merged.bests[key])) merged.bests[key] = best;
  }
  merged.seenTextIds = [...new Set([...mine.seenTextIds, ...theirs.seenTextIds])];

  const { preferences, preferencesAt } = mergePreferences(local, cloud);
  merged.preferences = preferences;
  if (Object.keys(preferencesAt).length) merged.preferencesAt = preferencesAt;
  else delete merged.preferencesAt;
  if (clearedAt) merged.historyClearedAt = clearedAt;
  else delete merged.historyClearedAt;
  if (named.length) merged.historyClearedIds = named;
  else delete merged.historyClearedIds;
  if (undone.length) merged.undoneClears = undone;
  else delete merged.undoneClears;
  const updatedAt = [local.updatedAt, cloud.updatedAt].filter(Boolean).sort().at(-1);
  if (updatedAt) merged.updatedAt = updatedAt;
  const profileId = [local.profileId, cloud.profileId].filter(Boolean).sort()[0];
  if (profileId) merged.profileId = profileId;
  return merged;
}

// Undo after a clear: the history from before it (`before`) comes back even if the clear's `marker` has
// already reached other tabs, devices or the account row, because the marker is recorded as undone and no
// copy that heard of it applies it again. Anything added anywhere since the clear is kept.
export function revokeClear(current, before, marker) {
  const undone = [...list(before.undoneClears), ...list(current.undoneClears), ...(marker ? [marker] : [])];
  return mergeSynced({ ...before, undoneClears: undone }, current);
}

// mergeSynced for a tab that keeps what a clear removed, so an Undo restores history from every copy
// and not only from the clearing tab's own. A clear can reach a copy before its Undo does: the account
// row, another tab, or another device holding runs the clearing tab never saw. `held` is
// { marker, before } or null: every copy merged here that the newest live clear removed history from,
// as it was before that. When a copy arrives with that clear undone, what was held comes back.
// Returns { merged, held }; the caller keeps `held` in memory.
export function mergeAndHold(held, local, cloud) {
  let merged = mergeSynced(local, cloud);
  const marker = merged.historyClearedAt;
  if (marker) {
    let before = held?.marker === marker ? held.before : null;
    for (const side of [local, cloud]) {
      if (side.historyClearedAt !== marker) before = before ? mergeSynced(before, side) : side;
    }
    if (before) held = { marker, before };
  }
  if (held && list(merged.undoneClears).includes(held.marker)) {
    merged = revokeClear(merged, held.before, held.marker);
    held = null;
  }
  return { merged, held };
}

// A digest of everything a merge can change, without walking every keystroke: two profiles with the
// same signature hold the same records, bests, seen passages and settings.
export function syncSignature(profile) {
  const sorted = (object) => Object.keys(object || {}).sort().map((key) => [key, object[key]]);
  const rest = Object.keys(profile).filter((key) => profile[key] !== undefined && !(key in HISTORY)
    && !['bests', 'seenTextIds', 'preferences', 'preferencesAt'].includes(key)).sort();
  return JSON.stringify([
    Object.keys(HISTORY).map((name) => list(profile[name]).map((item) => [item.id, item.patterns?.length ?? null])),
    sorted(profile.bests).map(([key, best]) => [key, best?.wpm, best?.at, best?.attemptId]),
    [...list(profile.seenTextIds)].sort(),
    sorted(profile.preferences),
    sorted(stampsOf(profile)),
    rest.map((key) => [key, profile[key]]),
  ]);
}

export const sameProfile = (a, b) => syncSignature(a) === syncSignature(b);

// Folds a one-off import (the pre-accounts profile) into a profile: runs and loops by id, the higher best.
// The base keeps its preferences unless it has no history of its own yet.
export function mergeProfiles(base, extra) {
  const byId = (items) => [...new Map(items.map((item) => [item.id, item])).values()];
  const bests = { ...extra.bests };
  for (const [key, best] of Object.entries(base.bests)) {
    if (!bests[key] || best.wpm >= bests[key].wpm) bests[key] = best;
  }
  const baseIsNew = base.attempts.length === 0 && base.loops.length === 0 && !base.runs?.length;
  return {
    ...base,
    preferences: baseIsNew ? extra.preferences : base.preferences,
    attempts: byId([...extra.attempts, ...base.attempts]),
    runs: byId([...(extra.runs || []), ...(base.runs || [])]),
    loops: byId([...extra.loops, ...base.loops]),
    seenTextIds: [...new Set([...extra.seenTextIds, ...base.seenTextIds])],
    bests,
  };
}

// The pre-accounts profile, left from before sign-in existed. The first account on the device adopts it.
export function takeLegacyProfile() {
  const legacy = readJson(LEGACY_PROFILE_KEY);
  remove(LEGACY_PROFILE_KEY);
  return legacy;
}

// Feature suggestions: sent as the anonymous role even when signed in, so a suggestion is never tied
// to an account. The table accepts inserts only; nothing can be read back through the API.
export const MAX_SUGGESTION = 1000;
const SUGGESTION_VIEWS = new Set(['practice', 'results', 'progress', 'compete']);

// The row to store, or the sentence to show instead.
export function suggestionRow(text, view) {
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) return { error: 'Write a suggestion first.' };
  if (body.length > MAX_SUGGESTION) return { error: `Keep it under ${MAX_SUGGESTION} characters.` };
  return { row: { body, view: SUGGESTION_VIEWS.has(view) ? view : null } };
}

export async function sendSuggestion(text, view) {
  const { row, error } = suggestionRow(text, view);
  if (error) throw new AuthError(error);
  await request('/rest/v1/feature_suggestions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: row });
}

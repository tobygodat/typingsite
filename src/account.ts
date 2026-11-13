import { isRecord } from './domain-values.js';
import type { Profile, HydratedProfile, ProfileCopy, CloudProfileData, RunRecord, HistoricalRecord, Best, RunCounts } from './profile-types.js';
import type { SyncedProfile } from './profile-copy.js';

type HistoryRecord = Partial<RunRecord> | HistoricalRecord;

type MergeBest = Pick<Best, 'wpm'> & { at?: unknown; attemptId?: unknown };

type MergeLessons = Record<string, unknown>;

type MergeProfile = Omit<Partial<Profile>, 'attempts' | 'runs' | 'loops' | 'compositions' | 'bests' | 'preferences' | 'preferencesAt' | 'lessons' | 'historyClearedIds' | 'profileId'> & Partial<Omit<SyncedProfile, keyof Profile | 'historyClearedIds'>> & {
  profileId?: unknown; attempts?: HistoryRecord[]; runs?: HistoryRecord[]; loops?: HistoryRecord[]; compositions?: HistoryRecord[];
  bests?: Record<string, MergeBest>; preferences?: Record<string, unknown>; preferencesAt?: Record<string, unknown>; lessons?: MergeLessons; historyClearedIds?: unknown[];
};

type Holds = Record<string, MergeProfile[]>;

interface Surviving {
  attempts: HistoryRecord[]; runs: HistoryRecord[]; loops: HistoryRecord[]; compositions: HistoryRecord[];
  bests: Record<string, MergeBest>; rebest: boolean; lessons: MergeLessons; seenTextIds: string[];
  practiceDays: Record<string, number>; runCounts: RunCounts; stale: boolean;
}

const property = (value: MergeProfile, key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;

import { textStamp, withoutConditionSets, withConditionSets, storedCopy, rowCopy } from './profile-copy.js';

export { CONDITION_SETS_FROM, textStamp, withoutConditionSets, withConditionSets, storedCopy, exportCopy, rowCopy } from './profile-copy.js';

// Accounts: Supabase Auth and one row of profile data per user, through scoped fetch requests.
// With no session the visitor is a guest and nothing is stored.
// The publishable key is meant for browsers; row-level security limits every row to its owner.
import { retainTraces } from './insights.js';
import { retainCompositions } from './compose.js';
import { mergePracticeDays, retainHistory, validPracticeDays, dayKey, dailyChallengeId, retainRuns, settleDailyFirsts, bestRun } from './insights.js';
import { keepDays, mergeRunCounts, retainRunCounts, validRunCounts } from './run-counts.js';
import { conditionKey } from './typing.js';

import { Schema } from 'effect';
import { deadline, accountLifetime } from './async-runtime.js';
import { request, AuthError, SUPABASE_URL, decodeReply, errorDetails, SessionSchema, AuthResponseSchema, UserSchema } from './network.js';
import type { Session, AuthResponse, RequestOptions } from './network.js';

export { request, AuthError } from './network.js';

export type { Session } from './network.js';

export const SESSION_KEY = 'stilltype-session-v1';
const VERIFIER_KEY = 'stilltype-pkce-verifier';

// A sign-up waiting for its confirmation email: the address, and when. A token link signs in only the address
// this browser signed up with, and only for a day, as a ?code= needs the verifier this browser kept.
const PENDING_SIGNUP_KEY = 'stilltype-pending-signup';
const PENDING_SIGNUP_MS = 24 * 60 * 60 * 1000;

export const REDIRECT_COPY = {
  refused: 'That link can’t sign you in here. Sign in with your email and password.',
  failed: 'That sign-in link didn’t work. Try signing in again.',
};

const LEGACY_PROFILE_KEY = 'stilltype-profile-v2';

export const profileKey = (userId: string) => `${LEGACY_PROFILE_KEY}:${userId}`;

function base64url(bytes: Uint8Array) {
  let text = '';

  for (const byte of bytes) text += String.fromCharCode(byte);

  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createVerifier() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challengeFor(verifier: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

// Supabase returns to the app with ?code= (PKCE), #access_token= (email links) or an error in either.
export function parseAuthRedirect(href: string) {
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
export function cleanRedirectUrl(href: string) {
  const url = new URL(href);

  for (const key of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(key);
  const hash = new URLSearchParams(url.hash.slice(1));

  if (['access_token', 'error', 'error_description'].some((key) => hash.has(key))) url.hash = '';

  return url.toString();
}

function readJson(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));

    return true;
  } catch { return false; }
}

function remove(key: string) {
  try { localStorage.removeItem(key); } catch {}
}

export function loadSession(): Session | null {
  try {
    const session = Schema.decodeUnknownSync(SessionSchema)(readJson(SESSION_KEY));

    return session.user.id && session.refresh_token ? session : null;
  } catch { return null; }
}

// A sign-in's id is made when it signs in and kept through every refresh, so a tab can tell another tab's
// refresh of the sign-in they share from a new sign-in there (a guest tab signing in to the same account).
// Sessions stored before sign-ins had one have none, and count as one sign-in.
function sessionFrom(data: AuthResponse, signInId?: string) {
  const session: Session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: { id: data.user.id, email: data.user.email || '' },
  };

  if (signInId) session.signInId = signInId;

  return session;
}

export const sameSignIn = (a: Session | null, b: Session | null) => Boolean(a?.user?.id) && a?.user.id === b?.user.id && a?.signInId === b?.signInId;

function storeSession(session: Session) {
  writeJson(SESSION_KEY, session);

  return session;
}

const storeSignIn = (data: AuthResponse) => storeSession(sessionFrom(data, base64url(crypto.getRandomValues(new Uint8Array(9)))));

export async function signUp(email: string, password: string, redirectTo: string) {
  const data = await request(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`, { method: 'POST', body: { email, password } });

  // With email confirmation on, Supabase returns the user without a session.
  if (data && typeof data === 'object' && 'access_token' in data && data.access_token) return { session: storeSignIn(decodeReply(AuthResponseSchema, data)) };
  writeJson(PENDING_SIGNUP_KEY, { email: email.trim().toLowerCase(), at: Date.now() });

  return { confirm: true };
}

export async function signIn(email: string, password: string) {
  const data = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });

  return storeSignIn(decodeReply(AuthResponseSchema, data));
}

// Asks first, so a provider that is not configured yet gives a sentence rather than a raw error page.
export async function startGoogleSignIn(redirectTo: string) {
  const settings = decodeReply(Schema.NullOr(Schema.Struct({ external: Schema.optional(Schema.Struct({ google: Schema.optional(Schema.Boolean) })) })), await request('/auth/v1/settings'));

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
export async function completeRedirect(href: string) {
  const redirect = parseAuthRedirect(href);

  if (!redirect) return null;
  history.replaceState(history.state, '', cleanRedirectUrl(href));

  // The link's own words are never shown, since anyone can write a link.
  if (redirect.kind === 'error') throw new AuthError(REDIRECT_COPY.failed);

  if (redirect.kind === 'code') {
    const verifier = readJson(VERIFIER_KEY);
    remove(VERIFIER_KEY);

    if (typeof verifier !== 'string' || !verifier) throw new AuthError('That sign-in link has expired. Try again.');
    const data = await request('/auth/v1/token?grant_type=pkce', { method: 'POST', body: { auth_code: redirect.code, code_verifier: verifier } });

    return storeSignIn(decodeReply(AuthResponseSchema, data));
  }

  // A token link carries everything needed to sign in, so anyone can make one for their own account. It is
  // taken only as the answer to a sign-up this browser made, for that address, and only once.
  const rawPending = readJson(PENDING_SIGNUP_KEY);
  let pending: { email: string; at: number } | null = null;

  try { pending = Schema.decodeUnknownSync(Schema.Struct({ email: Schema.String, at: Schema.Number }))(rawPending); } catch {}

  remove(PENDING_SIGNUP_KEY);

  if (!pending?.email || !(Date.now() - pending.at < PENDING_SIGNUP_MS)) throw new AuthError(REDIRECT_COPY.refused);
  const user = decodeReply(UserSchema, await request('/auth/v1/user', { token: redirect.access_token || undefined }));

  if ((user?.email || '').toLowerCase() !== pending.email) throw new AuthError(REDIRECT_COPY.refused);

  return storeSignIn(decodeReply(AuthResponseSchema, { ...redirect, user }));
}

// Returns a session with a usable access token, refreshing it if it is about to expire. signal lets
// a caller with a deadline give up on the refresh.
export async function freshSession(session: Session | null = loadSession(), { signal, timeoutMs, lifetime = accountLifetime() }: Pick<RequestOptions, 'signal' | 'timeoutMs' | 'lifetime'> = {}) {
  if (!session) return null;
  // Background polls (race, inbox) may already have rotated this user's refresh token; a stale
  // copy would be rejected and end the session, so the newest stored one wins. Two refreshes in
  // the same second share an expiry, and storage always holds the later of them, so a tie goes to it.
  const stored = loadSession();

  if (stored?.user?.id === session.user?.id && stored.expires_at >= session.expires_at) session = stored;

  if (session.expires_at - 60 > Date.now() / 1000) return session;

  try {
    const data = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token }, signal, timeoutMs, lifetime });
    // Stored only over the session it refreshed: another tab may have signed out, or in as someone else
    // (the same account included, whose new session that sign-out's logout didn't end), since this tab
    // read it. Either way it is still the sign-in it refreshed.
    const refreshed = sessionFrom(decodeReply(AuthResponseSchema, data), session.signInId);

    return loadSession()?.refresh_token === session.refresh_token ? storeSession(refreshed) : refreshed;
  } catch (cause) {
    const error = errorDetails(cause);

    // A rejected refresh token means the session is over; a network failure keeps it for later. Only the
    // session whose token was refused is removed, never one another tab stored since (a newer token, or
    // another account).
    if ((error.status ?? 0) >= 400 && (error.status ?? 0) < 500 && loadSession()?.refresh_token === session.refresh_token) remove(SESSION_KEY);
    throw error;
  }
}

// Left by a sign-out that keeps unsent edits for the next sign-in, until that user signs in again: a tab
// still holding the account must stop caching runs under it, though the cache stays. (A sign-out that
// sent everything removes the cache, which stops those tabs already; its marker, { sent }, stands only
// around that removal, see signOut.) A session that only expired leaves none, so its tabs keep caching
// for the next sign-in.
export const signedOutKey = (userId: string) => `stilltype-signed-out:${userId}`;

export function signedOut(userId: string) {
  try { return localStorage.getItem(signedOutKey(userId)) !== null; } catch { return false; }
}

export const clearSignedOut = (userId: string) => remove(signedOutKey(userId));

// Touches only what is still this sign-in's: another tab may have signed out, or in as anyone (the same
// account included), while this one was sending its edits. The device's session is checked here, where
// nothing waits between the check and the writes. With none stored (this session expired), only the
// marker is left. Another sign-in to this account is left alone and not logged out either, since
// Supabase's logout ends every session of the account.
// `sentText` is the device cache as this tab's last push left it, with everything in it in the account.
// The cache goes only if it still holds exactly that; otherwise it stays, marked, for the next sign-in.
// Reads of localStorage across tabs can be milliseconds stale, so another tab's save can be in the cache
// unseen here as it is removed. The removal therefore names the copy it sent, in a marker every tab hears
// before it, and a tab that hears a different copy removed puts it back (restoreUnsent).
export async function signOut(session: Session | null, { sentText = null }: { sentText?: string | null } = {}) {
  const userId = session?.user?.id;
  const stored = loadSession();

  if (stored && stored.user.id === userId && !sameSignIn(stored, session)) return;
  const held = stored?.user.id === userId ? stored : null;

  if (userId && (!stored || held)) {
    const settled = sentText !== null && loadCachedProfileText(userId) === sentText;

    // Written before the session goes, so a tab that hears of the sign-out finds it.
    if (!settled) writeJson(signedOutKey(userId), true);

    if (held) {
      // Heard by every tab before the removal.
      if (settled) writeJson(signedOutKey(userId), { sent: textStamp(sentText) });
      remove(SESSION_KEY);

      if (settled) {
        remove(profileKey(userId));
        clearSignedOut(userId);
      }
    }
  }

  // With the device's copy of this sign-in, when it holds one: another tab may have refreshed it since.
  try { await request('/auth/v1/logout', { method: 'POST', token: (held || session)?.access_token }); } catch {}
}

const storedProfile = (text: string | null) => {
  try {
    const data: unknown = JSON.parse(text || 'null');

    return isRecord(data) && data.version === 2 ? parseMergeProfile(withoutConditionSets(data)) : null;
  } catch {
    return null;
  }
};

// What a sign-out that sent the copy stamped `sent` lost by removing `removedText`, given `savedText`, the
// copy the tab that heard the removal last saved, or took in holding all it saved. Null when the removed
// copy is the one sent and the saved copy holds nothing it lacks (a stale copy whose runs a clear in the
// removed one took out holds nothing more). Otherwise the union of both, to keep for the next sign-in.
export function unsentCopy(removedText: string | null, sent: string, savedText: string | null) {
  const removed = storedProfile(removedText);
  const saved = storedProfile(savedText);

  if (removed && textStamp(removedText || '') === sent
    && (!saved || savedText === removedText || sameProfile(mergeSynced(removed, saved), removed))) return null;

  return removed && saved ? mergeSynced(removed, saved) : (removed || saved);
}

// Puts back what a sign-out elsewhere removed unsent (unsentCopy), merged with anything stored since. No
// marker: every tab of the account has already followed the sign-out. Returns whether it wrote.
export function restoreUnsent(userId: string, removedText: string | null, sent: string, savedText: string | null) {
  const copy = unsentCopy(removedText, sent, savedText);

  if (!copy) return false;
  const stored = storedProfile(loadCachedProfileText(userId));

  return cacheProfileText(userId, JSON.stringify(storedCopy(stored ? mergeSynced(stored, copy) : copy)));
}

// Deleting an account is one server step: the delete-account Edge Function
// (supabase/functions/delete-account) checks the caller's token and deletes the auth user, and the
// profile, race rooms, race seats and friend rows go with it through ON DELETE CASCADE.
export const DELETE_ACCOUNT_PATH = '/functions/v1/delete-account';

export const DELETE_COPY = {
  session: 'Your session has ended, so nothing was deleted. Sign out, sign in again, then delete your account.',
  missing: 'Account deletion isn’t switched on yet, so nothing was deleted. Try again later.',
  unavailable: 'Account deletion isn’t available right now, so nothing was deleted. Try again later.',
  failed: 'Your account couldn’t be deleted just now, so nothing changed. Try again in a moment.',
  offline: 'Can’t reach the account service. Check your connection and try again.',
};

// One deadline for the whole deletion, long enough for a slow cold start. The session refresh, the
// function call and the check after it all share it, so past it the dialog unlocks with an error
// instead of waiting on, however the steps add up.
const DELETE_TIMEOUT_MS = 30000;

// Asks the Auth server whether the account still exists: true once it reports the user gone, false
// while it still knows them, null if it can't say (including when the deadline runs out first).
async function accountGone(current: Session, signal: AbortSignal) {
  try {
    return decodeReply(UserSchema, await request('/auth/v1/user', { token: current.access_token, signal, timeoutMs: DELETE_TIMEOUT_MS })).id === current.user.id ? false : null;
  } catch (cause) {
    const error = errorDetails(cause);

    return error.code === 'user_not_found' ? true : null;
  }
}

// Resolves once the account is gone; otherwise throws an AuthError whose message says what happened.
// Signing out and clearing this device are left to the caller, for after success only.
export function deleteAccount(session: Session | null) {
  return accountLifetime().run(deadline((signal) => deleteBefore(session, signal), DELETE_TIMEOUT_MS, errorDetails));
}

// Each step gets whatever time is left before the deadline; a step it cuts off counts as no reply.
async function deleteBefore(session: Session | null, signal: AbortSignal) {
  let current;

  try {
    current = await freshSession(session, { signal });
  } catch (cause) {
    const error = errorDetails(cause);
    // A rejected refresh token means the session is over; anything else is the service or the network.
    const ended = (error.status ?? 0) >= 400 && (error.status ?? 0) < 500;
    throw new AuthError(ended ? DELETE_COPY.session : error.status ? DELETE_COPY.failed : DELETE_COPY.offline);
  }

  if (!current) throw new AuthError(DELETE_COPY.session);
  let status = 0;

  try {
    await request(DELETE_ACCOUNT_PATH, { method: 'POST', token: current.access_token, body: {}, signal, timeoutMs: DELETE_TIMEOUT_MS });

    return;
  } catch (cause) {
    const error = errorDetails(cause);
    status = error.status || 0;
  }

  if (status === 404) throw new AuthError(DELETE_COPY.missing);
  const refused = status === 401 || status === 403;
  // Any 5xx is ambiguous: the function's 500 when deleteUser committed but its reply was lost, or a
  // gateway's 502, 503 or 504 after the function finished. Other answers are clear refusals.
  const serverError = status >= 500;

  if (status && !refused && !serverError) throw new AuthError(DELETE_COPY.failed);
  // A refused token, a server error or no reply (a function that isn't deployed can fail this way in
  // a browser, when the platform's not-found reply has no CORS headers). Each time the account may
  // already be gone: deleted by this request when its reply was lost, or from another device. The
  // Auth server settles it, within what is left of the deadline.
  const gone = await accountGone(current, signal);

  if (gone) return;

  if (refused) throw new AuthError(DELETE_COPY.session);

  if (serverError) throw new AuthError(DELETE_COPY.failed);
  // Say nothing was deleted only if the account is confirmed to still exist.
  throw new AuthError(gone === false ? DELETE_COPY.unavailable : DELETE_COPY.offline);
}

// A theme from a short vibe: the generate-theme Edge Function (supabase/functions/generate-theme) asks
// Claude for one and returns { name, mode, colors } unsaved. Throws an AuthError with one short line.
export const GENERATE_THEME_PATH = '/functions/v1/generate-theme';

export const THEME_COPY = {
  session: 'Sign in again to generate a theme.',
  failed: 'Couldn’t generate a theme. Try again.',
  offline: 'Can’t reach the theme service. Try again.',
};

const THEME_ERRORS = ['vibe', 'limit', 'refused', 'timeout', 'failed', 'config', 'session'];

export async function generateTheme(session: Session | null, vibe: string) {
  const lifetime = accountLifetime();
  let current;

  try {
    current = await freshSession(session);
  } catch {
    throw new AuthError(THEME_COPY.session);
  }

  if (!current) throw new AuthError(THEME_COPY.session);

  try {
    const data = decodeReply(Schema.Struct({ theme: Schema.optional(GeneratedThemeSchema) }), await request(GENERATE_THEME_PATH, { method: 'POST', token: current.access_token, body: { vibe }, lifetime }));

    if (!data?.theme) throw new AuthError(THEME_COPY.failed);

    return data.theme;
  } catch (cause) {
    const error = errorDetails(cause);

    // The function's own errors are already one short line; a gateway's or no reply aren't.
    if (THEME_ERRORS.some((code) => code === error.code)) throw error;
    throw new AuthError(error.status === 401 ? THEME_COPY.session : error.status ? THEME_COPY.failed : THEME_COPY.offline);
  }
}

// After a confirmed deletion: the session and this account's device cache go, nothing is sent. The
// signed-out marker goes first, so other tabs of the account stop saving for it at the first change they
// hear (a session removed without one reads as expired, and those tabs would keep caching), and last, so
// nothing about the account stays on the device.
export function forgetAccount(session: Session | null) {
  const userId = session?.user?.id;

  if (userId) writeJson(signedOutKey(userId), true);
  remove(SESSION_KEY);

  if (userId) {
    remove(profileKey(userId));
    clearSignedOut(userId);
  }
}

// The whole row: `data`, `updated_at`, and the friends board's `board` once that column exists (`*`
// never names a column the project lacks, so this works before the board's migration too).
// Keystroke recordings (attempts) stay on the device that made them: a row written before that still
// holds some, and they are left out here. A row so old it has no run summaries keeps them, as they are
// what normalizeProfile makes its summaries from.
export async function fetchCloudProfile(session: Session, { lifetime }: Pick<RequestOptions, 'lifetime'> = {}) {
  const rows = decodeReply(Schema.mutable(Schema.Array(ProfileRowSchema)), await request(`/rest/v1/profiles?select=*&user_id=eq.${session.user.id}`, { token: session.access_token, lifetime }));
  const row = rows?.[0] || null;

  return row && isRecord(row.data) && Array.isArray(row.data.runs) ? { ...row, data: rowCopy(row.data) } : row;
}

// An ISO time later than now and than every given stamp, so a device whose clock runs behind still
// moves a stamp forward rather than writing one that looks older than what it replaces. A clear marker
// counts as its time (see clearProfile).
export function stampAfter(...stamps: (string | null | undefined)[]) {
  const times = stamps.map((stamp) => Date.parse(typeof stamp === 'string' ? stamp.split('~')[0] || '' : '') + 1).filter(Number.isFinite);

  return new Date(Math.max(Date.now(), ...times)).toISOString();
}

// The friends board's summary rides each profile write in the row's own `board` column
// (src/friends-board.js), stamped with that write's `updated_at`. The board must never stop the profile
// syncing: a write refused for that column (a project without it yet, PGRST204, or a summary its check
// refuses) goes again without it, and the rest of this page load leaves it out.
let boardOff = false;
const refusesBoard = (error: AuthError) => error?.status === 400 && ['PGRST204', '23514'].some((code) => code === error.code) && /board/.test(error.message || '');

// `board(at)` gives the summary of exactly the data written, for a write stamped `at`; null clears the
// column (an opt-out on this device not yet confirmed: it shows nothing new), undefined leaves it out. A
// row written without it (by an older build, or after a refusal) keeps an older summary whose stamp no
// longer matches the row, which the board then hides (and repairBoard mends).
async function withBoard<T>(board: BoardWriter | undefined, at: string, send: (column: { board?: BoardColumn | null }) => Promise<T>): Promise<T> {
  let column: BoardColumn | null | undefined;

  try { column = board && !boardOff ? board(at) : undefined; } catch { column = undefined; }

  if (column !== undefined) {
    try {
      return await send({ board: column });
    } catch (cause) {
    const error = errorDetails(cause);

      if (!refusesBoard(error)) throw error;
      boardOff = true;
    }
  }

  return send({});
}

// Writes only if the row is still the version read at `seenAt` (owners may update their own row, see
// supabase/migrations). Resolves to the new updated_at, or null when another writer got there first.
export async function updateCloudProfile(session: Session, data: Profile | CloudProfileData | MergeProfile, seenAt: string | undefined, { board, lifetime }: { board?: BoardWriter } & Pick<RequestOptions, 'lifetime'> = {}) {
  const at = stampAfter(seenAt);

  const rows = await withBoard(board, at, (column) => request(`/rest/v1/profiles?user_id=eq.${session.user.id}&updated_at=eq.${encodeURIComponent(String(seenAt))}&select=updated_at`, {
    method: 'PATCH',
    token: session.access_token, lifetime,
    headers: { Prefer: 'return=representation' },
    body: { data: withConditionSets(rowCopy(data)), updated_at: at, ...column },
  }));

  return decodeReply(Schema.NullOr(Schema.Array(Schema.Struct({ updated_at: Schema.String }))), rows)?.[0]?.updated_at || null;
}

// Creates the row only if the account has none. Null means another writer created it first.
export async function insertCloudProfile(session: Session, data: Profile | CloudProfileData | MergeProfile, { board, lifetime }: { board?: BoardWriter } & Pick<RequestOptions, 'lifetime'> = {}) {
  const at = new Date().toISOString();

  const rows = await withBoard(board, at, (column) => request('/rest/v1/profiles?select=updated_at', {
    method: 'POST',
    token: session.access_token, lifetime,
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: { user_id: session.user.id, data: withConditionSets(rowCopy(data)), updated_at: at, ...column },
  }));

  return decodeReply(Schema.NullOr(Schema.Array(Schema.Struct({ updated_at: Schema.String }))), rows)?.[0]?.updated_at || null;
}

// Writes a summary into the row's `board` column only while the row is still the version it was counted
// from (its `updated_at` is `at`), so it can only ever describe that exact row: a row another write has
// moved since is left alone, and that write carries its own summary. True when it was sent.
export async function repairBoard(session: Session, board: BoardColumn | null, at: string | undefined) {
  if (boardOff) return false;

  try {
    await request(`/rest/v1/profiles?user_id=eq.${session.user.id}&updated_at=eq.${encodeURIComponent(String(at))}`, {
      method: 'PATCH',
      token: session.access_token,
      headers: { Prefer: 'return=minimal' },
      body: { board },
    });

    return true;
  } catch (cause) {
    const error = errorDetails(cause);

    if (!refusesBoard(error)) throw error;
    boardOff = true;

    return false;
  }
}

export function loadCachedProfile(userId: string) {
  return readJson(profileKey(userId));
}

export function cacheProfile(userId: string, data: Profile | HydratedProfile | ProfileCopy) {
  return writeJson(profileKey(userId), storedCopy(data));
}

// The device cache as text, so a tab can tell whether another tab has written it since.
export function loadCachedProfileText(userId: string) {
  try { return localStorage.getItem(profileKey(userId)); } catch { return null; }
}

export function cacheProfileText(userId: string, text: string) {
  try {
    localStorage.setItem(profileKey(userId), text);

    return true;
  } catch { return false; }
}

// ── Merging copies of one account's profile ─────────────────────────────
// Two tabs, two devices or a device and the account row can each hold edits the other lacks, so
// syncing merges rather than letting one whole copy replace another.

export const MAX_STORED_ATTEMPTS = 24;

// Every history collection in a profile: the timestamp it is ordered and cleared by, and the cap kept
// after a save or merge. Items are never edited once stored, so an id names one record everywhere.
// A new collection is added here and nowhere else.
export const HISTORY = {
  attempts: { at: 'at', keep: (items: HistoryRecord[]) => retainTraces(items) },
  runs: { at: 'at', keep: (items: HistoryRecord[]) => retainRuns(items) },
  loops: { at: 'at', keep: (items: HistoryRecord[]) => items },
  // Composing practice's numbers (src/compose.js): never runs, never text, the newest MAX_COMPOSITIONS.
  compositions: { at: 'at', keep: retainCompositions },
};

const HISTORY_NAMES = Object.keys(HISTORY).filter((name): name is keyof typeof HISTORY => Object.hasOwn(HISTORY, name));

const list = <T>(value: readonly T[] | null | undefined): NonNullable<T>[] => value ? value.filter((item): item is NonNullable<T> => item !== null && item !== undefined) : [];
const compare = <T extends string | number>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);
const recordId = (item: HistoryRecord) => String(item.id ?? JSON.stringify(item));

export function capHistory<T extends MergeProfile>(profile: T) {
  Object.assign(profile, retainHistory(list(profile.runs), validPracticeDays(profile.practiceDays)));
  profile.runCounts = retainRunCounts(profile.runCounts);

  for (const name of HISTORY_NAMES) if (name !== 'runs') profile[name] = HISTORY[name].keep(list(profile[name]));

  return profile;
}

// Whether best `a` beats `b`: the higher wpm, then the earlier record (a later run has to beat a best,
// not match it), then the attempt id. A total order, so every copy keeps the same best for a tie
// whichever side merged first, and copies settle instead of rewriting the row on every load.
const beatsBest = (a: MergeBest, b: MergeBest | undefined) => !b || a.wpm > b.wpm || (a.wpm === b.wpm
  && (compareRelational(a.at || '', b.at || '') || compare(String(a.attemptId ?? ''), String(b.attemptId ?? ''))) < 0);

// historyClearedIds: the records each clear named (see clearProfile), as [marker, id] pairs, so an undo
// drops exactly the ids its own clear named. Every clear that hasn't been undone keeps its pairs: two
// devices can clear independently, and the newer marker alone would let a stale copy bring back a
// record the older clear named. Earlier copies of this field hold ids alone, named by the copy's
// historyClearedAt. Only records stamped ahead of a clear are named, so there are usually few. Every
// clear not undone keeps all of its pairs, with no cap: a newer clear finds the records an older one
// removed already gone, so it can't name them, and a pair dropped would let a copy that heard of neither
// bring its record back (stamped ahead, it sorts after both markers). A clear names the records it
// removed and those the clears it knew of had named, so its pairs grow only with records stamped ahead
// of a clock (every run and loop, at most, after a clock corrected far backward), and its undo drops them.
const namedPairs = (side: MergeProfile): [string, string][] => list(side.historyClearedIds).flatMap((entry) => {
  const [marker, id] = typeof entry === 'string' ? [side.historyClearedAt, entry] : Array.isArray(entry) ? entry : [];

  return marker && typeof marker === 'string' && id && typeof id === 'string' ? [[marker, id]] : [];
});

const liveNamed = (pairs: [string, string][], undone: string[]) => [...new Map(pairs.flatMap((pair): [string, [string, string]][] => undone.includes(pair[0]) ? [] : [[JSON.stringify(pair), pair]])).values()]
  .sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]));

// The ids a copy's clears named (a merged or cleared copy holds only clears not undone).
export const clearedIds = (profile: MergeProfile) => new Set(namedPairs(profile).map(([, id]) => id));

// The clears not undone that a copy knows of (`heard`), and those it has applied (`applied`): its marker,
// the older clears it keeps (appliedClears, heardClears) and those its named pairs speak for. A copy
// applies a clear by dropping what it held from before it. What it holds from then on is from after that
// clear whatever its stamp (a clock running behind the clearing one stamps a later run earlier). So once
// its newest marker is undone, a copy still answers to the older clears it had applied, and to those it
// only heard of as one that never applied them; none is forgotten.
const isMarker = (marker: string | undefined): marker is string => typeof marker === 'string' && marker !== '';

function clearsOf(side: MergeProfile, undone: string[]) {
  const live = (marker: string | undefined): marker is string => isMarker(marker) && !undone.includes(marker);
  const applied = new Set([side.historyClearedAt, ...list(side.appliedClears)].filter(live));
  const heard = new Set([...applied, ...list(side.heardClears), ...namedPairs(side).map(([marker]) => marker)].filter(live));

  return { applied, heard };
}

// The clears a copy has applied, undone ones included: the training a tab offers was checked against them.
export const clearsApplied = (profile: MergeProfile) => new Set([profile.historyClearedAt, ...list(profile.appliedClears)].filter(isMarker));

// Writes a copy's clears: the newest as historyClearedAt, and the older ones it applied or only heard of.
function setClears<T extends MergeProfile>(profile: T, clearedAt: string, applied: Set<string>, heard: Set<string>) {
  const older = (marker: string) => marker < clearedAt;

  const fields = {
    historyClearedAt: clearedAt,
    appliedClears: [...applied].filter(older).sort(),
    heardClears: [...heard].filter((marker) => older(marker) && !applied.has(marker)).sort(),
  };

  for (const [field, value] of Object.entries(fields)) {
    if (value?.length) Object.assign(profile, { [field]: value });
    else Reflect.deleteProperty(profile, field);
  }

  return profile;
}

// Clear history: every HISTORY collection, the bests and the seen passages (preferences stay). The
// marker it leaves is this clock's now, moved past any earlier marker (an undone one included), then `~`
// and a random id. The marker is the clear's identity: an undo, the pairs it named and the copies held
// for it all go by it. Its time alone can't be: two devices that clear without syncing in between can
// stamp the same millisecond (both stepping just past a marker from a clock running ahead), and one's
// undo would then undo the other's clear. The id sorts it just after its time, so string comparisons
// with record stamps hold. Copies elsewhere drop what they hold from at or before it. A record stamped
// after it, by a clock running ahead of this one, is named by id instead: taking the latest stamp as the
// marker would move the marker into the future, where it would also take runs made elsewhere after the
// clear. So is every record named by a clear this copy knows of: it was made before that clear, so before
// this one, and that clear's undo, arriving later, must not bring it back past this one. The cleared copy
// holds nothing, so it has applied every clear it knows of.
export function clearProfile(profile: Profile): SyncedProfile;
export function clearProfile(profile: HydratedProfile): SyncedProfile<HydratedProfile>;
export function clearProfile(profile: MergeProfile): MergeProfile;
export function clearProfile(profile: MergeProfile): MergeProfile {
  const undone = list(profile.undoneClears);
  const { heard } = clearsOf(profile, undone);
  const marker = `${stampAfter(profile.historyClearedAt, ...undone, ...heard)}~${base64url(crypto.getRandomValues(new Uint8Array(6)))}`;
  const known = liveNamed(namedPairs(profile), undone);
  const ahead = new Set(known.map(([, id]) => id));

  for (const name of HISTORY_NAMES) {
    for (const item of list(profile[name])) if ((item.at || '') > marker && item.id) ahead.add(String(item.id));
  }

  for (const best of Object.values(profile.bests || {})) if ((best?.at || '') > marker && best.attemptId) ahead.add(String(best.attemptId));
  const named = liveNamed([...known, ...[...ahead].map((id): [string, string] => [marker, id])], undone);
  const emptied = { ...profile, bests: {}, seenTextIds: [], practiceDays: {}, runCounts: {} };

  if (profile.lessons) emptied.lessons = {};
  const cleared = setClears(emptied, marker, heard, heard);

  for (const name of HISTORY_NAMES) cleared[name] = [];

  if (named.length) cleared.historyClearedIds = named;
  else delete cleared.historyClearedIds;

  return cleared;
}

const stampsOf = (side: MergeProfile) => (side.preferencesAt && typeof side.preferencesAt === 'object' ? side.preferencesAt : {});

// Each setting comes from the side that changed it last. preferencesAt maps a setting to when it last
// changed and is stamped on every change, so a font size changed on one device survives a test shape
// picked later on another. A setting only one side has stamped comes from that side: the other has
// recorded no change to it since stamps began. A setting neither side has stamped (profiles saved
// before stamps) comes from the newer profile by updatedAt, as whole-profile sync chose. Equal stamps
// (edits in the same millisecond, or clocks that each stepped just past the same stamp from a clock
// running ahead, see stampAfter), and unstamped settings in profiles saved the same moment, go to the
// value that sorts first, so every copy picks the same one and copies settle. A setting one side lacks
// (an older build) comes from the side that has it, whichever was saved later: reading a copy
// (normalizeProfile) leaves out what it lacks rather than filling in a default that would count as a choice.
const valueOrder = (value: unknown) => JSON.stringify(value) ?? '';

// Whether `theirs` wins over `mine` given each one's stamp: the later stamp, then the value that sorts
// first, so both sides of a merge pick the same one.
const takesTheirs = (myStamp: unknown, theirStamp: unknown, mine: unknown, theirs: unknown) => compareRelational(theirStamp, myStamp) > 0
  || (theirStamp === myStamp && valueOrder(theirs) < valueOrder(mine));

function mergePreferences(local: MergeProfile, cloud: MergeProfile) {
  const mine = local.preferences || {};
  const theirs = cloud.preferences || {};
  const myStamps = stampsOf(local);
  const theirStamps = stampsOf(cloud);
  const preferences: Record<string, unknown> = {};
  const preferencesAt: Record<string, unknown> = {};

  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const a = myStamps[key] || '';
    const b = theirStamps[key] || '';

    const fromCloud = a || b ? takesTheirs(a, b, mine[key], theirs[key])
      : takesTheirs(local.updatedAt || '', cloud.updatedAt || '', mine[key], theirs[key]);

    preferences[key] = (fromCloud ? theirs[key] : mine[key]) ?? (fromCloud ? mine[key] : theirs[key]);

    if (a || b) preferencesAt[key] = compareRelational(a, b) > 0 ? a : b;
  }

  return { preferences, preferencesAt };
}

// A run summary trimmed by retainRuns has lost its pattern counts, and then its missed words; the fuller
// copy of a record wins, on either, whichever side merges (the caps trim it again where they should). A
// daily attempt either copy labels a repeat stays one: the copy that says first may be from before its
// device held the earlier try, which a clear can since have taken from every copy.
const fullness = (record: HistoryRecord): [unknown, number] => [lengthOf(record.patterns) || 0, Array.isArray(record.missedWords) ? 1 : 0];

const fuller = (held: HistoryRecord, other: HistoryRecord) => {
  const [heldPatterns, heldWords] = fullness(held);
  const [otherPatterns, otherWords] = fullness(other);
  const kept = compareRelational(otherPatterns, heldPatterns) > 0 || (otherPatterns === heldPatterns && otherWords > heldWords) ? other : held;

  return kept.firstDailyAttempt && (held.firstDailyAttempt === false || other.firstDailyAttempt === false)
    ? { ...kept, firstDailyAttempt: false } : kept;
};

// Builds from before merging synced whole copies: on load the copy saved later (by updatedAt) replaced
// the other, and every save replaced the account row. Clear History saved an empty copy, with no marker.
// Such a build stamps updatedAt on every save and passes through fields it doesn't know, so this build
// writes mergeStamp with every updatedAt it writes (here and in mergeSynced): a copy whose updatedAt
// isn't its mergeStamp was last saved by an older build, even one this build had saved before.
export function stampProfile<T extends MergeProfile>(profile: T, at = new Date().toISOString()) {
  profile.updatedAt = at;
  profile.mergeStamp = at;

  return profile;
}

const stampOf = (value: unknown) => (typeof value === 'string' ? value : '');
const savedByOlderBuild = (side: MergeProfile) => stampOf(side.updatedAt) !== '' && side.mergeStamp !== side.updatedAt;

// The date a copy's history starts: its earliest record or best (an undated one counts as earliest),
// and no later than its last save.
function historyStart(side: MergeProfile) {
  let start = stampOf(side.updatedAt);

  const dates = [...HISTORY_NAMES.flatMap((name) => list(side[name]).map((item) => item.at)),
    ...Object.values(side.bests || {}).filter(Boolean).map((best) => best.at)];

  for (const date of dates) if (stampOf(date) < start) start = stampOf(date);

  return start;
}

// Where a copy's history starts, as builds from before merging left it. Their sync let the copy saved
// later replace the other whole, and all their Clear History left was an empty copy and the runs made
// since. A copy an older build saved last starts at its earliest record or best; a copy this build saved
// starts where the copy it last took that from did (legacyClearedAt, carried by every merge).
const legacyStart = (side: MergeProfile) => (savedByOlderBuild(side) ? historyStart(side) : stampOf(side.legacyClearedAt));

// The fields mergeSynced has a rule of its own for. The rest (version, and any field this build
// doesn't know) are passed through.
const MERGED_FIELDS = new Set([...HISTORY_NAMES, 'bests', 'seenTextIds', 'lessons', 'preferences', 'preferencesAt',
  'historyClearedAt', 'appliedClears', 'heardClears', 'historyClearedIds', 'undoneClears', 'legacyClearedAt', 'updatedAt',
  'mergeStamp', 'profileId', 'practiceDays', 'runCounts']);

// Lesson progress (src/lessons.js): { [lesson id]: { tries, last, passed } }, where last and passed are
// results dated `at`. A side judged by a clear it hadn't applied keeps only what is dated after it: a lesson
// whose last try is older goes, and a pass from before it goes while later tries stay. Merged lesson by
// lesson: the most tries either side counted (tries made apart on two devices aren't summed, so this can
// undercount, never double count), the later last result and the earlier pass (the first pass is the one
// kept). Ties break on the numbers, so every copy settles on the same result whichever side merges.
function survivingLessons(lessons: MergeLessons | undefined, after: (stamp: unknown) => boolean) {
  const kept: MergeLessons = {};

  for (const [id, entry] of Object.entries(lessons && typeof lessons === 'object' ? lessons : {})) {
    if (!entry || typeof entry !== 'object' || !after(rawField(rawField(entry, 'last'), 'at'))) continue;
    const passed = rawField(entry, 'passed');
    kept[id] = { ...entry, passed: passed && after(rawField(passed, 'at')) ? passed : null };
  }

  return kept;
}

const resultOrder = (a: unknown, b: unknown) => compareRelational(rawField(a, 'at') || '', rawField(b, 'at') || '')
  || compareRelational(rawField(a, 'wpm') ?? 0, rawField(b, 'wpm') ?? 0)
  || compareRelational(rawField(a, 'accuracy') ?? 0, rawField(b, 'accuracy') ?? 0)
  || compare(String(rawField(a, 'inputClass') ?? ''), String(rawField(b, 'inputClass') ?? ''));

const laterResult = (a: unknown, b: unknown) => (!a ? b || null : !b ? a : resultOrder(a, b) >= 0 ? a : b);
const earlierResult = (a: unknown, b: unknown) => (!a ? b || null : !b ? a : resultOrder(a, b) <= 0 ? a : b);

function mergeLessons(mine: MergeLessons = {}, theirs: MergeLessons = {}) {
  const merged: MergeLessons = {};

  for (const id of [...new Set([...Object.keys(mine), ...Object.keys(theirs)])].sort()) {
    const [a, b] = [mine[id], theirs[id]];

    merged[id] = !a || !b ? a || b : {
      tries: Math.max(Number(rawField(a, 'tries') || 0), Number(rawField(b, 'tries') || 0)),
      last: laterResult(rawField(a, 'last') || null, rawField(b, 'last') || null),
      passed: earlierResult(rawField(a, 'passed') || null, rawField(b, 'passed') || null),
    };
  }

  return merged;
}

// Merges another copy of this account's profile (`cloud`: the account row, or another tab's cache) into
// this device's (`local`). Field by field:
// - attempts, runs, loops (HISTORY): union by id, ordered by date, then the usual caps. Equal dates
//   (undated records from older builds) order by id, so both sides list them the same way. Only a day's
//   earliest daily attempt keeps its first-attempt label (settleDailyFirsts), and a repeat stays one.
// - bests: per condition key the best by beatsBest (the higher wpm), so a merge never lowers a best.
// - seenTextIds: union, so a passage once shown is never offered as fresh again.
// - runCounts: each tab counter's day by day, the larger started and finished (mergeRunCounts in
//   src/run-counts.js), after a side judged by a clear it hadn't applied drops the days through the clear's
//   own, as for practiceDays. Only one tab writes a counter and its numbers only grow, so this is exact.
// - lessons: lesson by lesson (mergeLessons above), after each side drops what a clear it hadn't applied
//   removed (survivingLessons), as for bests; clearProfile empties it and Undo gives it back.
// - preferences and preferencesAt: setting by setting, from mergePreferences above.
// - historyClearedIds: union of both sides' pairs from clears not undone. A record any of them names is
//   dropped from either side: no copy can hold it legitimately while that clear stands.
// - historyClearedAt: the newest clear that hasn't been undone, of all either side knows (clearsOf). A
//   side that hasn't applied it (an older clear of its own, or only a later one undone since, or one it
//   only heard of) may still hold what that clear removed: its history and bests dated at or before the
//   marker are dropped, and its seen ids are kept only where its surviving history shows the passage
//   after the clear. Seen ids carry no date, so this is the one place a seen id can go: one only
//   displayed, never run, on a device that hadn't yet heard of the clear. Either way, a side whose best
//   a clear took (by date or by name) has its surviving practice runs set the best the old one had
//   blocked, and a passage shown only by records a clear named loses its seen mark.
// - appliedClears, heardClears: the older clears not undone that both copies answer to (a side that was
//   judged by the newest answers to every older one, as it holds nothing from before it), and the rest
//   of those either side knows of.
// - undoneClears: union of clears that were undone, which never apply again. Never trimmed: a copy
//   that applied an old clear and missed its undo must still find it here, and each entry takes a
//   typed confirmation and an Undo within seconds, so the list stays tiny.
// - legacyClearedAt: the start (legacyStart) of the copy saved later (updatedAt; for equal saves, the
//   later start). As builds from before merging let that copy replace the other, the other, if its own
//   start is earlier, drops its history and bests from at or before that start, and keeps its seen ids
//   only where its surviving history shows the passage, as for a clear it hadn't applied; the rest of it,
//   which they dropped too, stays. So a clear made on such a build stands wherever their sync kept it,
//   and stays: a copy saved before it and merged later is held to it, while a save made later without
//   hearing of it replaces it, as there. No Undo restores what it drops: the older build offered its
//   own, in the clearing tab.
// - updatedAt: the later of the two (the time of the last saved edit anywhere), with mergeStamp.
// - profileId: the smaller id, so every copy settles on the same one whichever merges first.
// - version and any field this build doesn't know: from the copy saved later (updatedAt, the only stamp
//   such a field has), then the value that sorts first, so both sides of a merge keep the same value and
//   copies settle, rather than an older build that kept a stale value writing it back over a newer one
//   on every sync. A field only one side has comes from that side, so one a newer build wrote survives
//   an older build's merge.
export function mergeSynced(local: Profile, cloud: Profile): SyncedProfile;
export function mergeSynced(local: HydratedProfile, cloud: HydratedProfile): SyncedProfile<HydratedProfile>;
export function mergeSynced(local: MergeProfile, cloud: MergeProfile): MergeProfile;
export function mergeSynced(local: MergeProfile, cloud: MergeProfile): MergeProfile {
  const undone = [...new Set([...list(local.undoneClears), ...list(cloud.undoneClears)])].sort();
  const clears: [ReturnType<typeof clearsOf>, ReturnType<typeof clearsOf>] = [clearsOf(local, undone), clearsOf(cloud, undone)];
  const heard = new Set(clears.flatMap(({ heard: markers }) => [...markers]));
  const clearedAt = [...heard].sort().at(-1) || '';
  const named = liveNamed([...namedPairs(local), ...namedPairs(cloud)], undone);
  const namedIds = new Set(named.map(([, id]) => id));

  const shownBy = (items: HistoryRecord[]) => {
    const shown = new Set<unknown>();

    for (const item of items) {
      if (item.textId) shown.add(item.textId);

      if (item.challengeDate) shown.add(dailyChallengeId(String(item.challengeDate)));
    }

    return shown;
  };

  const starts: [string, string] = [legacyStart(local), legacyStart(cloud)];
  const later = compare(stampOf(local.updatedAt), stampOf(cloud.updatedAt)) || compare(starts[0], starts[1]);
  const legacyAt = later < 0 ? starts[1] : starts[0];

  const surviving = (side: MergeProfile, { applied }: { applied: Set<string> }, saved: number, start: string): Surviving => {
    // Judged by the newest clear standing, unless this side applied it (see clearsOf), and, when saved
    // earlier, by the later start of the copy saved later (legacyClearedAt).
    const stale = Boolean(clearedAt) && !applied.has(clearedAt);
    const behind = saved < 0 && start < legacyAt;

    const after = (stamp: unknown, id: unknown) => !namedIds.has(String(id ?? '')) && (!stale || compareRelational(stamp || '', clearedAt) > 0)
      && (!behind || compareRelational(stamp || '', legacyAt) > 0);

    const kept: Surviving = { attempts: [], runs: [], loops: [], compositions: [], bests: {}, rebest: false, lessons: {}, seenTextIds: [], practiceDays: {}, runCounts: {}, stale: false };
    const taken: HistoryRecord[] = [];

    for (const name of HISTORY_NAMES) {
      kept[name] = [];

      for (const item of list(side[name])) (after(item.at, item.id) ? kept[name] : taken).push(item);
    }

    const bests = Object.entries(side.bests || {}).filter(([, best]) => best);
    kept.bests = Object.fromEntries(bests.filter(([, best]) => after(best.at, best.attemptId)));
    kept.rebest = stale || Object.keys(kept.bests).length < bests.length;
    kept.lessons = survivingLessons(side.lessons, (stamp) => after(stamp, null));
    const shown = shownBy(HISTORY_NAMES.flatMap((name) => kept[name]));
    const gone = shownBy(taken);
    kept.seenTextIds = list(side.seenTextIds).filter((id) => shown.has(id) || (!stale && !behind && !gone.has(id)));
    const cutoff = [stale ? clearedAt : null, behind ? legacyAt : null].filter(Boolean).sort().at(-1);
    const cutoffDay = cutoff ? dayKey(cutoff.slice(0, 24)) : null;
    kept.practiceDays = Object.fromEntries(Object.entries(validPracticeDays(side.practiceDays)).filter(([day]) => !cutoffDay || day > cutoffDay));
    kept.runCounts = keepDays(side.runCounts, (day) => !cutoffDay || day > cutoffDay);
    kept.stale = stale;

    return kept;
  };

  const mine = surviving(local, clears[0], later, starts[0]);
  const theirs = surviving(cloud, clears[1], -later, starts[1]);

  const merged: MergeProfile = { ...cloud, ...local };

  for (const key of Object.keys(merged)) {
    if (MERGED_FIELDS.has(key)) continue;
    const [mineValue, theirValue] = [property(local, key), property(cloud, key)];

    if (mineValue === undefined || (theirValue !== undefined
      && takesTheirs(local.updatedAt || '', cloud.updatedAt || '', mineValue, theirValue))) Object.assign(merged, { [key]: theirValue });
  }

  for (const name of HISTORY_NAMES) {
    const { keep } = HISTORY[name];
    const byId = new Map<string, HistoryRecord>();

    for (const item of [...mine[name], ...theirs[name]]) {
      const id = recordId(item);
      byId.set(id, byId.has(id) ? fuller(byId.get(id) || item, item) : item);
    }

    // Settled before the caps, so the day's earliest attempt is found even if the cap then drops it.
    const union = settleDailyFirsts([...byId.values()].sort((a, b) => compareRelational(a.at || '', b.at || '') || compare(recordId(a), recordId(b))));

    if (name === 'runs') Object.assign(merged, retainHistory(union, mergePracticeDays(mine, theirs, union)));
    else merged[name] = keep(union);
  }

  merged.bests = { ...theirs.bests };

  for (const [key, best] of Object.entries(mine.bests)) {
    if (beatsBest(best, merged.bests[key])) merged.bests[key] = best;
  }

  // On a side whose best a clear took, that best may have kept a later run from becoming one. With the old
  // best gone, that run is the best it would have been: the same rule storeAttempt uses.
  for (const run of [mine, theirs].filter((kept) => kept.rebest).flatMap((kept) => kept.runs)) {
    const conditions = run.conditions;
    const score = run.score;
    const wpm = isRecord(score) ? score.wpm : undefined;

    const key = conditionKey(isRecord(conditions) ? conditions : undefined);

    if (typeof wpm !== 'number') continue;
    const best = { wpm, attemptId: run.id, at: run.at };

    if (bestRun(run) && Number.isFinite(best.wpm) && beatsBest(best, merged.bests[key])) merged.bests[key] = best;
  }

  merged.seenTextIds = [...new Set([...mine.seenTextIds, ...theirs.seenTextIds])];
  merged.runCounts = mergeRunCounts(mine.runCounts, theirs.runCounts);

  if (local.lessons !== undefined || cloud.lessons !== undefined) merged.lessons = mergeLessons(mine.lessons, theirs.lessons);

  const { preferences, preferencesAt } = mergePreferences(local, cloud);
  merged.preferences = preferences;

  if (Object.keys(preferencesAt).length) merged.preferencesAt = preferencesAt;
  else delete merged.preferencesAt;
  const answered = new Set([...heard].filter((marker) => [mine, theirs].every((kept, n) => kept.stale || (clears[n]?.applied.has(marker) ?? false))));
  setClears(merged, clearedAt, answered, heard);

  if (named.length) merged.historyClearedIds = named;
  else delete merged.historyClearedIds;

  if (undone.length) merged.undoneClears = undone;
  else delete merged.undoneClears;

  if (legacyAt) merged.legacyClearedAt = legacyAt;
  else delete merged.legacyClearedAt;
  const updatedAt = [local.updatedAt, cloud.updatedAt].filter(Boolean).sort().at(-1);

  if (updatedAt) stampProfile(merged, updatedAt);
  else delete merged.mergeStamp;
  const profileId = [local.profileId, cloud.profileId].filter(Boolean).sort()[0];

  if (profileId) merged.profileId = profileId;

  return merged;
}

// Undo after a clear: the history from before it (`before`) comes back even if the clear's `marker` has
// already reached other tabs, devices or the account row, because the marker is recorded as undone and no
// copy that heard of it applies it again. Anything added anywhere since the clear is kept.
export function revokeClear(current: HydratedProfile, before: HydratedProfile, marker: string): SyncedProfile<HydratedProfile>;
export function revokeClear(current: Profile, before: Profile, marker: string): SyncedProfile;
export function revokeClear(current: MergeProfile, before: MergeProfile, marker: string): MergeProfile;
export function revokeClear(current: MergeProfile, before: MergeProfile, marker: string): MergeProfile {
  const undone = [...list(before.undoneClears), ...list(current.undoneClears), ...(marker ? [marker] : [])];

  return mergeSynced({ ...before, undoneClears: undone }, current);
}

// Holds: { [marker]: [copy, …] } for every clear still in force here that removed history from a copy
// merged here: those copies as they were before it. Kept side by side, never merged with each other: a
// merge would apply one copy's clear to another and drop what the hold is for. Each list is released by
// its own clear's undo only, so a newer clear never drops what an older one holds.
const holdCopy = (list_: MergeProfile[], copy: MergeProfile) => (list_.some((held) => held === copy || sameProfile(held, copy)) ? list_ : [...list_, copy]);

export function joinHolds(a: Holds, b: Holds) {
  const out = { ...a };

  for (const [marker, copies] of Object.entries(b || {})) for (const copy of copies) out[marker] = holdCopy(out[marker] || [], copy);

  return out;
}

// The ids a copy holds that a clear's named pairs can take: its records', and those its bests point to.
const heldIds = (copy: MergeProfile) => {
  const ids = new Set();

  for (const name of HISTORY_NAMES) for (const item of list(copy[name])) if (item.id !== undefined && item.id !== null) ids.add(String(item.id));

  for (const best of Object.values(copy.bests || {})) if (best?.attemptId) ids.add(String(best.attemptId));

  return ids;
};

// mergeSynced for a tab that holds what clears removed, so an Undo brings back history from every copy
// merged here and not only the clearing tab's own: a clear can reach the account row, another tab or
// another device holding runs the clearing tab never saw. Each copy merged is held under every clear
// still in force that took something from it: the newest, by date, from a copy that hadn't applied it,
// and any clear whose named pairs take one of its records. An older clear's pairs can arrive after both
// copies already share a newer marker, and the clearing device may hold less of the record than the copy
// it was taken from (only its summary, once the 24-trace cap has dropped the trace). Returns
// { merged, holds }; the caller keeps holds in memory.
export function mergeAndHold(holds: Holds, local: Profile, cloud: Profile): { merged: SyncedProfile; holds: Holds };
export function mergeAndHold(holds: Holds, local: HydratedProfile, cloud: HydratedProfile): { merged: SyncedProfile<HydratedProfile>; holds: Holds };
export function mergeAndHold(holds: Holds, local: MergeProfile, cloud: MergeProfile): { merged: MergeProfile; holds: Holds };
export function mergeAndHold(holds: Holds, local: MergeProfile, cloud: MergeProfile): { merged: MergeProfile; holds: Holds } {
  holds = { ...holds };
  let merged = mergeSynced(local, cloud);
  const sides = [local, cloud];
  // Every held clear now undone gives back what it held, as far as clears still in force allow.
  const released = Object.keys(holds).filter((marker) => list(merged.undoneClears).includes(marker));

  for (const marker of released) {
    for (const copy of holds[marker] || []) {
      merged = mergeSynced({ ...copy, undoneClears: [...new Set([...list(copy.undoneClears), ...list(merged.undoneClears)])] }, merged);
      sides.push(copy);
    }

    delete holds[marker];
  }

  const marker = merged.historyClearedAt;
  const pairs = namedPairs(merged);
  const undone = list(merged.undoneClears);
  const knowing = (side: MergeProfile) => (undone.length ? { ...side, undoneClears: undone } : side);

  for (const side of sides) {
    const ids = pairs.length ? heldIds(side) : new Set();
    const by = new Set(pairs.filter(([, id]) => ids.has(id)).map(([clear]) => clear));

    if (marker && !clearsOf(side, undone).applied.has(marker)) by.add(marker);

    for (const clear of by) holds[clear] = holdCopy(holds[clear] || [], knowing(side));
  }

  return { merged, holds };
}

// Undo here of the clear `marker`, made in this tab from `before`: released with everything held for it.
export function undoClearHere(holds: Holds, current: Profile, marker: string, before: Profile): { merged: SyncedProfile; holds: Holds };
export function undoClearHere(holds: Holds, current: HydratedProfile, marker: string, before: HydratedProfile): { merged: SyncedProfile<HydratedProfile>; holds: Holds };
export function undoClearHere(holds: Holds, current: MergeProfile, marker: string, before: MergeProfile): { merged: MergeProfile; holds: Holds };
export function undoClearHere(holds: Holds, current: MergeProfile, marker: string, before: MergeProfile): { merged: MergeProfile; holds: Holds } {
  const undone = { ...current, undoneClears: [...new Set([...list(current.undoneClears), marker])] };

  return mergeAndHold(joinHolds(holds, { [marker]: [before] }), undone, undone);
}

// A digest of everything a merge can change, without walking every keystroke: two profiles with the
// same signature hold the same records, bests, seen passages and settings.
export function syncSignature(profile: MergeProfile) {
  const sorted = <T>(object: Record<string, T> | undefined): [string, T | undefined][] => Object.keys(object || {}).sort().map((key) => [key, object?.[key]]);

  const rest = Object.keys(profile).filter((key) => property(profile, key) !== undefined && !Object.hasOwn(HISTORY, key)
    && !['bests', 'seenTextIds', 'lessons', 'preferences', 'preferencesAt', 'practiceDays', 'runCounts'].includes(key)).sort();

  return JSON.stringify([
    HISTORY_NAMES.map((name) => list(profile[name]).map((item) => [item.id, lengthOf(item.patterns) ?? null, item.firstDailyAttempt ?? null])),
    sorted(profile.bests).map(([key, best]) => [key, best?.wpm, best?.at, best?.attemptId]),
    [...list(profile.seenTextIds)].sort(),
    sorted(profile.preferences),
    sorted(stampsOf(profile)),
    sorted(profile.lessons),
    sorted(validPracticeDays(profile.practiceDays)),
    sorted(validRunCounts(profile.runCounts)).map(([counter, days]) => [counter, sorted(days)]),
    rest.map((key) => [key, property(profile, key)]),
  ]);
}

export const sameProfile = (a: MergeProfile, b: MergeProfile) => syncSignature(a) === syncSignature(b);

export const sameRow = (a: MergeProfile, b: MergeProfile) => sameProfile(rowCopy(a), rowCopy(b));

// Folds a one-off import (the pre-accounts profile) into a profile: runs and loops by id, the higher best.
// The base keeps its preferences unless it has no history of its own yet.
export function mergeProfiles(base: Profile, extra: Profile): Profile;
export function mergeProfiles(base: HydratedProfile, extra: HydratedProfile): HydratedProfile;
export function mergeProfiles(base: Profile | HydratedProfile, extra: Profile | HydratedProfile): Profile | HydratedProfile {
  const byId = <T extends { id?: unknown }>(items: T[]) => [...new Map(items.map((item) => [item.id, item])).values()];
  const bests = { ...extra.bests };

  for (const [key, best] of Object.entries(base.bests)) {
    if (!bests[key] || best.wpm >= (bests[key]?.wpm ?? 0)) bests[key] = best;
  }

  const baseIsNew = HISTORY_NAMES.every((key) => !base[key]?.length) && !Object.keys(base.practiceDays || {}).length;
  const runs = byId([...(extra.runs || []), ...(base.runs || [])]);

  return {
    ...base,
    preferences: baseIsNew ? extra.preferences : base.preferences,
    attempts: byId([...extra.attempts, ...base.attempts]),
    runs,
    practiceDays: mergePracticeDays(base, extra, runs),
    loops: byId([...extra.loops, ...base.loops]),
    seenTextIds: [...new Set([...extra.seenTextIds, ...base.seenTextIds])],
    bests,
    compositions: byId([...(extra.compositions || []), ...(base.compositions || [])]),
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

// Every value body[data-view] takes; the table's feature_suggestions_view_check holds the same list.
// Train shared the results screen when the table was made, so it is stored as "results" too.
const SUGGESTION_VIEWS = new Set(['practice', 'results', 'progress', 'compete', 'learn']);
const SUGGESTION_VIEW_NAMES = new Map([['train', 'results']]);

// The row to store, or the sentence to show instead.
export function suggestionRow(text: string, view: string) {
  const body = typeof text === 'string' ? text.trim() : '';

  if (!body) return { error: 'Write a suggestion first.' };

  if (body.length > MAX_SUGGESTION) return { error: `Keep it under ${MAX_SUGGESTION} characters.` };
  const name = SUGGESTION_VIEW_NAMES.get(view) || view;

  return { row: { body, view: SUGGESTION_VIEWS.has(name) ? name : null } };
}

export async function sendSuggestion(text: string, view: string) {
  const { row, error } = suggestionRow(text, view);

  if (error) throw new AuthError(error);
  await request('/rest/v1/feature_suggestions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: row });
}

function openSchema<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);
}

const HistoryRecordSchema = Schema.Record(Schema.String, Schema.Unknown);


const MergeProfileSchema = openSchema({
  version: Schema.optional(Schema.Literal(2)), profileId: Schema.optional(Schema.Unknown),
  preferences: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)), preferencesAt: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  attempts: Schema.optional(Schema.mutable(Schema.Array(HistoryRecordSchema))), runs: Schema.optional(Schema.mutable(Schema.Array(HistoryRecordSchema))),
  loops: Schema.optional(Schema.mutable(Schema.Array(HistoryRecordSchema))), compositions: Schema.optional(Schema.mutable(Schema.Array(HistoryRecordSchema))),
  bests: Schema.optional(Schema.Record(Schema.String, openSchema({ wpm: Schema.Number }))),
  seenTextIds: Schema.optional(Schema.mutable(Schema.Array(Schema.String))), practiceDays: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
  runCounts: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.mutable(Schema.Tuple([Schema.Number, Schema.Number]))))),
  lessons: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  historyClearedAt: Schema.optional(Schema.String), appliedClears: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  heardClears: Schema.optional(Schema.mutable(Schema.Array(Schema.String))), undoneClears: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  historyClearedIds: Schema.optional(Schema.mutable(Schema.Array(Schema.Unknown))),
  legacyClearedAt: Schema.optional(Schema.String), mergeStamp: Schema.optional(Schema.String), updatedAt: Schema.optional(Schema.String),
});

function parseMergeProfile(value: unknown): MergeProfile {
  return decodeReply(MergeProfileSchema, value);
}

const ProfileRowSchema = openSchema({ data: Schema.optional(Schema.Unknown), updated_at: Schema.optional(Schema.String), board: Schema.optional(Schema.Unknown) });

export type BoardColumn = ReturnType<typeof import('./friends-board.js').boardColumn>;

type BoardWriter = (at: string) => BoardColumn | null | undefined;

const GeneratedThemeSchema = Schema.Struct({
  name: Schema.String, mode: Schema.Literals(['dark', 'light']), colors: Schema.Record(Schema.String, Schema.String),
});

export type GeneratedTheme = typeof GeneratedThemeSchema.Type;

function relationalValue(value: unknown): string | number {
  if (typeof value === 'string' || typeof value === 'number') return value;

  if (value === undefined) return NaN;

  if (value === null || typeof value === 'boolean') return Number(value);

  return String(value);
}

function compareRelational(a: unknown, b: unknown): number {
  const first = relationalValue(a);
  const second = relationalValue(b);

  return first < second ? -1 : first > second ? 1 : 0;
}

function lengthOf(value: unknown): unknown {
  if (typeof value === 'string' || Array.isArray(value)) return value.length;

  return isRecord(value) ? value.length : undefined;
}


function rawField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

// Accounts: Supabase Auth and one row of profile data per user, spoken to over fetch so the app
// keeps no runtime dependencies. With no session the visitor is a guest and nothing is stored.
// The publishable key is meant for browsers; row-level security limits every row to its owner.

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

function storeSession(data) {
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: { id: data.user.id, email: data.user.email || '' },
  };
  writeJson(SESSION_KEY, session);
  return session;
}

// signal (an AbortSignal) gives up on a request still waiting for its reply; the error then has no status.
export async function request(path, { method = 'GET', body, token, headers = {}, keepalive = false, signal } = {}) {
  let response;
  let text;
  try {
    response = await fetch(`${SUPABASE_URL}${path}`, {
      method,
      keepalive,
      headers: {
        apikey: SUPABASE_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
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
    if (data?.error_code) error.code = data.error_code;
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

// Returns a session with a usable access token, refreshing it if it is about to expire. signal lets
// a caller with a deadline give up on the refresh.
export async function freshSession(session = loadSession(), { signal } = {}) {
  if (!session) return null;
  // Background polls (race, inbox) may already have rotated this user's refresh token; a stale
  // copy would be rejected and end the session, so the newest stored one wins. Two refreshes in
  // the same second share an expiry, and storage always holds the later of them, so a tie goes to it.
  const stored = loadSession();
  if (stored?.user?.id === session.user?.id && stored.expires_at >= session.expires_at) session = stored;
  if (session.expires_at - 60 > Date.now() / 1000) return session;
  try {
    const data = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token }, signal });
    return storeSession(data);
  } catch (error) {
    // A rejected refresh token means the session is over; a network failure keeps it for later.
    if (error.status >= 400 && error.status < 500) remove(SESSION_KEY);
    throw error;
  }
}

export async function signOut(session, { keepCache = false } = {}) {
  remove(SESSION_KEY);
  if (session && !keepCache) remove(profileKey(session.user.id));
  try { await request('/auth/v1/logout', { method: 'POST', token: session?.access_token }); } catch {}
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
async function accountGone(current, signal) {
  try {
    return (await request('/auth/v1/user', { token: current.access_token, signal }))?.id === current.user.id ? false : null;
  } catch (error) {
    return error.code === 'user_not_found' ? true : null;
  }
}

// Resolves once the account is gone; otherwise throws an AuthError whose message says what happened.
// Signing out and clearing this device are left to the caller, for after success only.
export async function deleteAccount(session) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), DELETE_TIMEOUT_MS);
  try {
    return await deleteBefore(session, deadline.signal);
  } finally {
    clearTimeout(timer);
  }
}

// Each step gets whatever time is left before the deadline; a step it cuts off counts as no reply.
async function deleteBefore(session, signal) {
  let current;
  try {
    current = await freshSession(session, { signal });
  } catch (error) {
    // A rejected refresh token means the session is over; anything else is the service or the network.
    const ended = error.status >= 400 && error.status < 500;
    throw new AuthError(ended ? DELETE_COPY.session : error.status ? DELETE_COPY.failed : DELETE_COPY.offline);
  }
  if (!current) throw new AuthError(DELETE_COPY.session);
  let status = 0;
  try {
    await request(DELETE_ACCOUNT_PATH, { method: 'POST', token: current.access_token, body: {}, signal });
    return;
  } catch (error) {
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

// After a confirmed deletion: the session and this account's device cache go, nothing is sent.
export function forgetAccount(session) {
  remove(SESSION_KEY);
  if (session?.user?.id) remove(profileKey(session.user.id));
}

export async function fetchCloudProfile(session) {
  const rows = await request(`/rest/v1/profiles?select=data,updated_at&user_id=eq.${session.user.id}`, { token: session.access_token });
  return rows?.[0] || null;
}

export async function pushCloudProfile(session, data, { keepalive = false } = {}) {
  await request('/rest/v1/profiles', {
    method: 'POST',
    token: session.access_token,
    keepalive,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { user_id: session.user.id, data, updated_at: new Date().toISOString() },
  });
}

export function loadCachedProfile(userId) {
  return readJson(profileKey(userId));
}

export function cacheProfile(userId, data) {
  return writeJson(profileKey(userId), data);
}

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

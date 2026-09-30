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

export async function request(path, { method = 'GET', body, token, headers = {}, keepalive = false } = {}) {
  let response;
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
    });
  } catch {
    throw new AuthError('Can’t reach the account service. Check your connection.');
  }
  const text = await response.text();
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
  if (session.expires_at - 60 > Date.now() / 1000) return session;
  try {
    const data = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
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
  const baseIsNew = base.attempts.length === 0 && base.loops.length === 0;
  return {
    ...base,
    preferences: baseIsNew ? extra.preferences : base.preferences,
    attempts: byId([...extra.attempts, ...base.attempts]),
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

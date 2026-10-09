// An in-memory stand-in for the Supabase endpoints src/account.js calls, installed with page.route,
// so account flows run without a network or a real project. Row access mirrors the owner-only policy:
// a token only ever sees its own profile row. Profile writes behave as PostgREST does for what the app
// uses: eq filters on PATCH, return=representation (an empty array when nothing matched) and the two
// POST conflict resolutions. updated_at comes back in Postgres's +00:00 form, as timestamptz does.
import { createHash, randomUUID } from 'node:crypto';
import { FakeRaces } from './fake-races.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'apikey, authorization, content-type, prefer',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
};

// timestamptz as PostgREST returns it, and equality as Postgres compares it (by instant, not by text).
const pgTime = (value) => new Date(value).toISOString().replace('Z', '+00:00');
const sameInstant = (a, b) => Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b);
const eqFilter = (url, column) => {
  const value = url.searchParams.get(column);
  return value?.startsWith('eq.') ? value.slice(3) : null;
};
const pick = (row, select) => (select ? Object.fromEntries(select.split(',').map((column) => [column, row[column]])) : row);

const base64url = (buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export class FakeSupabase {
  constructor() {
    this.users = new Map();
    this.tokens = new Map();
    this.refreshTokens = new Map();
    this.profiles = new Map();
    // Every profile write and how many rows it changed, so tests can see conditional writes lose.
    this.writes = [];
    this.requests = [];
    this.errors = [];
    this.googleEnabled = false;
    this.confirmSignups = false;
    this.googleCodes = new Map();
    // Routed requests bypass context.setOffline, so offline tests flip this too.
    this.offline = false;
    // How long issued access tokens last. Under a minute, every request refreshes first.
    this.sessionSeconds = 3600;
    this.races = new FakeRaces(this);
  }

  addUser(email, password = 'correct horse battery') {
    const user = { id: randomUUID(), email, password };
    this.users.set(email, user);
    return user;
  }

  profileFor(email) {
    return this.profiles.get(this.users.get(email)?.id)?.data || null;
  }

  // Tests may seed rows without updated_at; the column defaults to now(), as in the migration.
  rowFor(userId) {
    const row = this.profiles.get(userId);
    if (row && !row.updated_at) row.updated_at = pgTime(Date.now());
    return row || null;
  }

  issueSession(user) {
    const access = randomUUID();
    const refresh = randomUUID();
    this.tokens.set(access, user.id);
    this.refreshTokens.set(refresh, user);
    return {
      access_token: access,
      token_type: 'bearer',
      refresh_token: refresh,
      expires_in: this.sessionSeconds,
      expires_at: Math.floor(Date.now() / 1000) + this.sessionSeconds,
      user: { id: user.id, email: user.email },
    };
  }

  async attach(page) {
    // A throwing handler would leave the request hanging; record it and fail the test instead.
    await page.route(/^https:\/\/[a-z0-9]+\.supabase\.co\//, async (route) => {
      try {
        await this.handle(route);
      } catch (error) {
        this.errors.push(`${route.request().method()} ${route.request().url()}: ${error.message}`);
        await route.abort().catch(() => {});
      }
    });
  }

  async handle(route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    this.requests.push(`${method} ${url.pathname}${url.search}`);
    if (this.offline) return route.abort('internetdisconnected');
    const reply = (status, json) => route.fulfill({
      status,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: json === undefined ? '' : JSON.stringify(json),
    });
    const body = request.postData() ? request.postDataJSON() : {};
    const caller = this.tokens.get((request.headers().authorization || '').replace(/^Bearer /, ''));

    switch (`${method} ${url.pathname}`) {
      case 'POST /rest/v1/rpc/race_action':
        return this.races.handle(caller, body, reply);
      case 'GET /auth/v1/settings':
        return reply(200, { external: { google: this.googleEnabled, email: true } });

      case 'POST /auth/v1/signup': {
        if (this.users.has(body.email)) return reply(422, { code: 422, msg: 'User already registered' });
        const user = this.addUser(body.email, body.password);
        if (this.confirmSignups) return reply(200, { id: user.id, email: user.email, confirmation_sent_at: new Date().toISOString() });
        return reply(200, this.issueSession(user));
      }

      case 'POST /auth/v1/token': {
        const grant = url.searchParams.get('grant_type');
        if (grant === 'password') {
          const user = this.users.get(body.email);
          if (!user || user.password !== body.password) return reply(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
          return reply(200, this.issueSession(user));
        }
        if (grant === 'refresh_token') {
          const user = this.refreshTokens.get(body.refresh_token);
          if (!user) return reply(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
          return reply(200, this.issueSession(user));
        }
        if (grant === 'pkce') {
          const pending = this.googleCodes.get(body.auth_code);
          this.googleCodes.delete(body.auth_code);
          const challenge = base64url(createHash('sha256').update(body.code_verifier || '').digest());
          if (!pending || pending.challenge !== challenge) return reply(400, { error: 'invalid_grant', error_description: 'Code verifier does not match' });
          const user = this.users.get(pending.email) || this.addUser(pending.email);
          return reply(200, this.issueSession(user));
        }
        return reply(400, { error: 'unsupported_grant_type' });
      }

      // A full-page navigation: stands in for Google and sends the browser back with a PKCE code.
      case 'GET /auth/v1/authorize': {
        const code = randomUUID();
        this.lastAuthorize = Object.fromEntries(url.searchParams);
        this.googleCodes.set(code, { challenge: url.searchParams.get('code_challenge'), email: 'google.user@stilltype.test' });
        const back = new URL(url.searchParams.get('redirect_to'));
        back.searchParams.set('code', code);
        return route.fulfill({ status: 302, headers: { location: back.toString() } });
      }

      // Supabase's default (global) sign-out ends every session of the user: their refresh tokens stop working.
      case 'POST /auth/v1/logout':
        for (const [token, user] of this.refreshTokens) if (user.id === caller) this.refreshTokens.delete(token);
        return reply(204);

      case 'GET /rest/v1/profiles': {
        if (!caller) return reply(401, { message: 'JWT expired' });
        const owner = (url.searchParams.get('user_id') || '').replace(/^eq\./, '');
        const row = owner === caller ? this.rowFor(caller) : null;
        return reply(200, row ? [{ data: row.data, updated_at: row.updated_at }] : []);
      }

      // An insert; on a conflict with the existing row, merge-duplicates replaces it (an upsert) and
      // ignore-duplicates leaves it, returning no rows.
      case 'POST /rest/v1/profiles': {
        if (!caller || body.user_id !== caller) return reply(403, { message: 'new row violates row-level security policy' });
        const prefer = request.headers().prefer || '';
        const exists = Boolean(this.rowFor(caller));
        if (exists && !/resolution=(merge|ignore)-duplicates/.test(prefer)) {
          return reply(409, { code: '23505', message: 'duplicate key value violates unique constraint "profiles_pkey"' });
        }
        const rows = [];
        if (!exists || /resolution=merge-duplicates/.test(prefer)) {
          const row = { user_id: caller, data: body.data, updated_at: pgTime(body.updated_at || Date.now()) };
          this.profiles.set(caller, row);
          rows.push(row);
        }
        this.writes.push({ method: 'POST', matched: rows.length });
        return /return=representation/.test(prefer) ? reply(201, rows.map((row) => pick(row, url.searchParams.get('select')))) : reply(201);
      }

      // An update of the rows matching every eq filter. Row-level security hides other users' rows,
      // so a filter on someone else's user_id matches nothing rather than failing.
      case 'PATCH /rest/v1/profiles': {
        if (!caller) return reply(401, { message: 'JWT expired' });
        const prefer = request.headers().prefer || '';
        const row = this.rowFor(caller);
        const owner = eqFilter(url, 'user_id');
        const seen = eqFilter(url, 'updated_at');
        const matches = Boolean(row) && (owner === null || owner === caller) && (seen === null || sameInstant(seen, row.updated_at));
        if (matches) {
          if ('data' in body) row.data = body.data;
          if ('updated_at' in body) row.updated_at = pgTime(body.updated_at);
        }
        this.writes.push({ method: 'PATCH', matched: Number(matches) });
        if (!/return=representation/.test(prefer)) return reply(204);
        return reply(200, matches ? [pick(row, url.searchParams.get('select'))] : []);
      }

      // A request the fake doesn't know means it no longer mirrors src/account.js: fail the test.
      default:
        this.errors.push(`No fake for ${method} ${url.pathname}`);
        return reply(404, { message: `No fake for ${method} ${url.pathname}` });
    }
  }
}

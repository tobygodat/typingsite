// An in-memory stand-in for the Supabase endpoints src/account.js calls, installed with page.route,
// so account flows run without a network or a real project. Row access mirrors the owner-only policy:
// a token only ever sees its own profile row.
import { createHash, randomUUID } from 'node:crypto';
import { FakeRaces } from './fake-races.js';
import { FakeBoard } from './fake-board.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'apikey, authorization, content-type, prefer',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
};

const base64url = (buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export class FakeSupabase {
  constructor() {
    this.users = new Map();
    this.tokens = new Map();
    this.refreshTokens = new Map();
    this.profiles = new Map();
    this.requests = [];
    this.errors = [];
    this.googleEnabled = false;
    this.confirmSignups = false;
    this.googleCodes = new Map();
    // Routed requests bypass context.setOffline, so offline tests flip this too.
    this.offline = false;
    this.holdProfiles = null;
    // Set to a promise to hold the reply to the next profile write: it is stored on arrival, in order,
    // and answered only once that settles, while later requests go through.
    this.holdProfileWrite = null;
    // Set to stand in for a project without the friends board's `board` column on profiles yet.
    this.boardColumnMissing = false;
    // Every profile write the fake took: { caller, method, updated_at, board } (board undefined when the
    // write left it out).
    this.profileWrites = [];
    this.races = new FakeRaces(this);
    this.board = new FakeBoard(this);
  }

  addUser(email, password = 'correct horse battery') {
    const user = { id: randomUUID(), email, password };
    this.users.set(email, user);
    return user;
  }

  profileFor(email) {
    return this.profiles.get(this.users.get(email)?.id)?.data || null;
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
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
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

  // PostgREST's reply to a write naming a column its schema cache doesn't have.
  missingBoard() {
    return { code: 'PGRST204', details: null, hint: null, message: 'Could not find the \'board\' column of \'profiles\' in the schema cache' };
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
      case 'POST /rest/v1/rpc/friends_board':
        return this.board.handle(caller, body, reply);
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

      case 'POST /auth/v1/logout':
        return reply(204);

      case 'GET /rest/v1/profiles': {
        if (!caller) return reply(401, { message: 'JWT expired' });
        // A test can hold profile reads, keeping the page's account check in flight.
        if (this.holdProfiles) await this.holdProfiles;
        const owner = (url.searchParams.get('user_id') || '').replace(/^eq\./, '');
        const row = owner === caller ? this.profiles.get(caller) : null;
        if (!row) return reply(200, []);
        // select=*: every column the project has.
        return reply(200, [{ user_id: caller, data: row.data, updated_at: row.updated_at, ...(this.boardColumnMissing ? {} : { board: row.board ?? null }) }]);
      }

      // An upsert (resolution=merge-duplicates): a column the write leaves out keeps its stored value.
      case 'POST /rest/v1/profiles': {
        if (!caller || body.user_id !== caller) return reply(403, { message: 'new row violates row-level security policy' });
        if ('board' in body && this.boardColumnMissing) return reply(400, this.missingBoard());
        const old = this.profiles.get(caller);
        this.profiles.set(caller, { data: body.data, updated_at: body.updated_at, board: 'board' in body ? body.board : old?.board ?? null });
        this.profileWrites.push({ caller, method: 'POST', updated_at: body.updated_at, board: body.board });
        if (this.holdProfileWrite) {
          const held = this.holdProfileWrite;
          this.holdProfileWrite = null;
          await held;
        }
        return reply(201);
      }

      // A conditional update, as src/account.js repairs a row's summary: only the row still at that version.
      case 'PATCH /rest/v1/profiles': {
        if (!caller) return reply(401, { message: 'JWT expired' });
        if ('board' in body && this.boardColumnMissing) return reply(400, this.missingBoard());
        const owner = (url.searchParams.get('user_id') || '').replace(/^eq\./, '');
        const at = (url.searchParams.get('updated_at') || '').replace(/^eq\./, '');
        const row = owner === caller ? this.profiles.get(caller) : null;
        if (row && Date.parse(row.updated_at) === Date.parse(at)) {
          Object.assign(row, body);
          this.profileWrites.push({ caller, method: 'PATCH', updated_at: row.updated_at, board: body.board });
        }
        return reply(204);
      }

      // A request the fake doesn't know means it no longer mirrors src/account.js: fail the test.
      default:
        this.errors.push(`No fake for ${method} ${url.pathname}`);
        return reply(404, { message: `No fake for ${method} ${url.pathname}` });
    }
  }
}

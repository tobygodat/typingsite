// An in-memory stand-in for the Supabase endpoints src/account.js calls, installed with page.route,
// so account flows run without a network or a real project. Row access mirrors the owner-only policy:
// a token only ever sees its own profile row. Profile writes behave as PostgREST does for what the app
// uses: eq filters on PATCH, return=representation (an empty array when nothing matched) and the two
// POST conflict resolutions. updated_at comes back in Postgres's +00:00 form, as timestamptz does.
import { createHash, randomUUID } from 'node:crypto';
import { FakeRaces } from './fake-races.js';
import { FakeChallenges } from './fake-challenges.js';
import { FakeBoard } from './fake-board.js';
import { withoutConditionSets } from '../src/account.js';

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
    this.suggestions = [];
    // Every profile write and how many rows it changed, so tests can see conditional writes lose.
    this.writes = [];
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
    this.peopleMissing = false;
    // Every profile write the fake took: { caller, method, updated_at, board } (board undefined when the
    // write left it out).
    this.profileWrites = [];
    // How long issued access tokens last. Under a minute, every request refreshes first.
    this.sessionSeconds = 3600;
    this.races = new FakeRaces(this);
    this.challenges = new FakeChallenges(this);
    this.board = new FakeBoard(this);
    // How POST /functions/v1/delete-account answers: 'ok' deletes like the real function; 'missing'
    // is the platform's reply for a function that isn't deployed and 'blocked' the same reply without
    // CORS headers; 'fail' is deleteUser failing; 'lost' deletes and then loses the reply;
    // 'deleted-then-500' deletes and then answers 500, as when deleteUser commits but its reply is lost.
    this.deleteAccount = 'ok';
    this.deletedUsers = [];
    // Endpoints ('METHOD /path') that take a request and never answer, like a blackholed connection:
    // only the page's own deadline ends them.
    this.blackholed = new Set();
  }

  addUser(email, password = 'correct horse battery') {
    const user = { id: randomUUID(), email, password };
    this.users.set(email, user);

    return user;
  }

  // The row's data as the app reads it: from CONDITION_SETS_FROM it keeps each conditions set once
  // (src/account.js), and each run and loop gets its conditions back here.
  profileFor(email) {
    const data = this.profiles.get(this.users.get(email)?.id)?.data || null;

    return data && 'conditionSets' in data ? withoutConditionSets(data) : data;
  }

  // What auth.admin.deleteUser does to the real project: the user, their sessions and every row whose
  // foreign key cascades from auth.users (profiles; race rooms by host or invitee; race seats; friends).
  deleteUser(id) {
    const user = [...this.users.values()].find((candidate) => candidate.id === id);
    this.users.delete(user.email);

    for (const [token, owner] of this.tokens) if (owner === id) this.tokens.delete(token);

    for (const [token, owner] of this.refreshTokens) if (owner.id === id) this.refreshTokens.delete(token);
    this.profiles.delete(id);

    for (const [roomId, room] of this.races.rooms) {
      if (room.players.find((player) => player.slot === 1)?.userId === id || room.invitedUser === id) this.races.rooms.delete(roomId);
      else room.players = room.players.filter((player) => player.userId !== id);
    }

    this.races.friends.delete(id);
    this.races.quick.forget(id);

    for (const [owner, list] of this.races.friends) this.races.friends.set(owner, list.filter((friend) => friend.friendId !== id));
    this.deletedUsers.push(user.email);
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

    if (this.blackholed.has(`${method} ${url.pathname}`)) return undefined;

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
      case 'POST /rest/v1/rpc/race_people':
        // Set peopleMissing to answer as a project without the race_people migration.
        if (this.peopleMissing) return reply(404, { code: 'PGRST202', message: 'Could not find the function public.race_people without parameters in the schema cache' });

        if (!caller) return reply(400, { message: 'Sign in to see the people you race.' });

        return reply(200, this.races.people(caller, this.challenges));
      case 'POST /rest/v1/rpc/quick_match':
        return this.races.quick.handle(caller, body, reply);
      case 'POST /rest/v1/rpc/challenge_action':
        return this.challenges.handle(caller, body, reply, () => route.abort('connectionreset'));
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

      // A full-page navigation: stands in for Google and sends the browser back with a PKCE code. The
      // service answers with a redirect; Playwright can't fulfill one in WebKit, so a page replaces itself.
      case 'GET /auth/v1/authorize': {
        const code = randomUUID();
        this.lastAuthorize = Object.fromEntries(url.searchParams);
        this.googleCodes.set(code, { challenge: url.searchParams.get('code_challenge'), email: 'google.user@stilltype.test' });
        const back = new URL(url.searchParams.get('redirect_to'));
        back.searchParams.set('code', code);

        return route.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(back.toString())})</script>` });
      }

      // Supabase's default (global) sign-out ends every session of the user: their refresh tokens stop working.
      case 'POST /auth/v1/logout':
        for (const [token, user] of this.refreshTokens) if (user.id === caller) this.refreshTokens.delete(token);

        return reply(204);

      // Insert-only, like the real table.
      case 'POST /rest/v1/feature_suggestions':
        this.suggestions.push(body);

        return reply(201);
      case 'GET /auth/v1/user': {
        const user = [...this.users.values()].find((candidate) => candidate.id === caller);

        if (!user) return reply(403, { code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' });

        return reply(200, { id: user.id, email: user.email });
      }

      // Mirrors supabase/functions/delete-account: the caller's token names the user, nothing else.
      case 'POST /functions/v1/delete-account': {
        if (this.deleteAccount === 'missing') return reply(404, { code: 'NOT_FOUND', message: 'Requested function was not found' });

        // The same, seen from a browser when that reply has no CORS headers: no response at all.
        if (this.deleteAccount === 'blocked') return route.abort('failed');

        if (!caller) return reply(401, { error: 'Your session has ended. Sign in again, then delete your account.' });

        if (this.deleteAccount === 'fail') return reply(500, { error: 'Your account couldn’t be deleted just now. Nothing was removed. Try again in a moment.' });

        if (this.deleteAccount === 'lost') {
          this.deleteUser(caller);

          return route.abort('failed');
        }

        if (this.deleteAccount === 'deleted-then-500') {
          this.deleteUser(caller);

          return reply(500, { error: 'Your account couldn’t be deleted just now. Nothing was removed. Try again in a moment.' });
        }

        this.deleteUser(caller);

        return reply(200, { deleted: true });
      }

      case 'GET /rest/v1/profiles': {
        if (!caller) return reply(401, { message: 'JWT expired' });

        // A test can hold profile reads, keeping the page's account check in flight.
        if (this.holdProfiles) await this.holdProfiles;
        const owner = (url.searchParams.get('user_id') || '').replace(/^eq\./, '');
        const row = owner === caller ? this.rowFor(caller) : null;

        if (!row) return reply(200, []);
        // select=*: every column the project has (the friends board's `board` once its migration is in).
        const full = { user_id: caller, data: row.data, updated_at: row.updated_at };

        if (!this.boardColumnMissing) full.board = row.board ?? null;
        const select = url.searchParams.get('select');

        return reply(200, [select && select !== '*' ? pick(full, select) : full]);
      }

      // An insert; on a conflict with the existing row, merge-duplicates replaces it (an upsert) and
      // ignore-duplicates leaves it, returning no rows. A column the write leaves out keeps its value.
      case 'POST /rest/v1/profiles': {
        if (!caller || body.user_id !== caller) return reply(403, { message: 'new row violates row-level security policy' });

        if ('board' in body && this.boardColumnMissing) return reply(400, this.missingBoard());
        const prefer = request.headers().prefer || '';
        const old = this.rowFor(caller);

        if (old && !/resolution=(merge|ignore)-duplicates/.test(prefer)) {
          return reply(409, { code: '23505', message: 'duplicate key value violates unique constraint "profiles_pkey"' });
        }

        const rows = [];

        if (!old || /resolution=merge-duplicates/.test(prefer)) {
          const row = { user_id: caller, data: body.data, updated_at: pgTime(body.updated_at || Date.now()), board: 'board' in body ? body.board : old?.board ?? null };
          this.profiles.set(caller, row);
          rows.push(row);
          this.profileWrites.push({ caller, method: 'POST', updated_at: row.updated_at, board: body.board });
        }

        this.writes.push({ method: 'POST', matched: rows.length });

        if (this.holdProfileWrite) {
          const held = this.holdProfileWrite;
          this.holdProfileWrite = null;
          await held;
        }

        return /return=representation/.test(prefer) ? reply(201, rows.map((row) => pick(row, url.searchParams.get('select')))) : reply(201);
      }

      // An update of the rows matching every eq filter (the profile writes, and src/account.js repairing a
      // row's board summary only while the row is still at that version). Row-level security hides other
      // users' rows, so a filter on someone else's user_id matches nothing rather than failing.
      case 'PATCH /rest/v1/profiles': {
        if (!caller) return reply(401, { message: 'JWT expired' });

        if ('board' in body && this.boardColumnMissing) return reply(400, this.missingBoard());
        const prefer = request.headers().prefer || '';
        const row = this.rowFor(caller);
        const owner = eqFilter(url, 'user_id');
        const seen = eqFilter(url, 'updated_at');
        const matches = Boolean(row) && (owner === null || owner === caller) && (seen === null || sameInstant(seen, row.updated_at));

        if (matches) {
          if ('data' in body) row.data = body.data;

          if ('updated_at' in body) row.updated_at = pgTime(body.updated_at);

          if ('board' in body) row.board = body.board;
          this.profileWrites.push({ caller, method: 'PATCH', updated_at: row.updated_at, board: body.board });
        }

        this.writes.push({ method: 'PATCH', matched: Number(matches) });

        if (this.holdProfileWrite) {
          const held = this.holdProfileWrite;
          this.holdProfileWrite = null;
          await held;
        }

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

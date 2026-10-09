import test from 'node:test';
import assert from 'node:assert/strict';
import {
  challengeFor, cleanRedirectUrl, deleteAccount, DELETE_ACCOUNT_PATH, DELETE_COPY, forgetAccount, freshSession,
  MAX_SUGGESTION, mergeProfiles, parseAuthRedirect, profileKey, suggestionRow,
} from '../src/account.js';

test('PKCE challenge matches the RFC 7636 example', async () => {
  assert.equal(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('auth redirects are recognised and stripped from the address', () => {
  assert.equal(parseAuthRedirect('https://stilltype.test/'), null);
  assert.equal(parseAuthRedirect('https://stilltype.test/#practice'), null);
  assert.deepEqual(parseAuthRedirect('https://stilltype.test/?code=abc'), { kind: 'code', code: 'abc' });
  assert.deepEqual(parseAuthRedirect('https://stilltype.test/#access_token=t&refresh_token=r&expires_in=60&type=signup'), {
    kind: 'tokens', access_token: 't', refresh_token: 'r', expires_in: 60,
  });
  assert.deepEqual(parseAuthRedirect('https://stilltype.test/?error=access_denied&error_description=Email+link+is+invalid'), {
    kind: 'error', message: 'Email link is invalid',
  });
  assert.equal(cleanRedirectUrl('https://stilltype.test/?code=abc&keep=1'), 'https://stilltype.test/?keep=1');
  assert.equal(cleanRedirectUrl('https://stilltype.test/#access_token=t&refresh_token=r'), 'https://stilltype.test/');
  assert.equal(cleanRedirectUrl('https://stilltype.test/#practice'), 'https://stilltype.test/#practice');
});

test('each account keeps its own device cache', () => {
  assert.notEqual(profileKey('a'), profileKey('b'));
  assert.notEqual(profileKey('a'), 'stilltype-profile-v2');
});

test('the pre-accounts profile folds into an account without losing either side', () => {
  const profile = (over) => ({ preferences: { theme: 'system' }, attempts: [], loops: [], seenTextIds: [], bests: {}, ...over });
  const legacy = profile({
    preferences: { theme: 'light' },
    attempts: [{ id: 'a1' }, { id: 'shared' }],
    loops: [{ id: 'l1' }],
    seenTextIds: ['q1', 'q2'],
    bests: { time30: { wpm: 80 }, words25: { wpm: 60 } },
  });
  const fresh = mergeProfiles(profile(), legacy);
  assert.equal(fresh.preferences.theme, 'light', 'an empty account takes the old settings');

  const used = mergeProfiles(profile({ attempts: [{ id: 'shared' }, { id: 'b1' }], seenTextIds: ['q2', 'q3'], bests: { time30: { wpm: 70 }, words25: { wpm: 65 } } }), legacy);
  assert.equal(used.preferences.theme, 'system', 'an account with history keeps its settings');
  assert.deepEqual(used.attempts.map((attempt) => attempt.id), ['a1', 'shared', 'b1']);
  assert.deepEqual(used.loops.map((loop) => loop.id), ['l1']);
  assert.deepEqual(used.seenTextIds, ['q1', 'q2', 'q3']);
  assert.deepEqual(used.bests, { time30: { wpm: 80 }, words25: { wpm: 65 } });
});

test('a suggestion stores only trimmed text and a known view', () => {
  assert.deepEqual(suggestionRow('  dvorak layout  ', 'practice'), { row: { body: 'dvorak layout', view: 'practice' } });
  assert.deepEqual(suggestionRow('idea', '<script>'), { row: { body: 'idea', view: null } });
  assert.ok(suggestionRow('   ', 'practice').error);
  assert.ok(suggestionRow(undefined).error);
  assert.ok(suggestionRow('a'.repeat(MAX_SUGGESTION + 1)).error);
  assert.ok(suggestionRow('a'.repeat(MAX_SUGGESTION)).row);
});

test('a stale copy of the session gives way to the newest stored one instead of reusing its refresh token', async () => {
  const later = Math.floor(Date.now() / 1000) + 3600;
  const store = new Map([['stilltype-session-v1', JSON.stringify({ access_token: 'new', refresh_token: 'rotated', expires_at: later, user: { id: 'u1' } })]]);
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  globalThis.fetch = async () => { throw new Error('no refresh expected'); };
  try {
    const stale = { access_token: 'old', refresh_token: 'used', expires_at: 1, user: { id: 'u1' } };
    assert.equal((await freshSession(stale)).refresh_token, 'rotated');
    // Refreshed in the same second as the stored one: equal expiry, but storage holds the later token.
    const sameSecond = { access_token: 'earlier', refresh_token: 'superseded', expires_at: later, user: { id: 'u1' } };
    assert.equal((await freshSession(sameSecond)).refresh_token, 'rotated');
  } finally {
    globalThis.localStorage = originalStorage;
    globalThis.fetch = originalFetch;
  }
});

// Account deletion: one call to the delete-account function, and a plain sentence for every failure.
async function withAccountService(handler, run) {
  const store = new Map();
  const calls = [];
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method || 'GET', authorization: init.headers?.Authorization, signal: init.signal });
    return handler(path, init);
  };
  try {
    await run(calls, store);
  } finally {
    globalThis.localStorage = originalStorage;
    globalThis.fetch = originalFetch;
  }
}

const liveSession = () => ({ access_token: 'token', refresh_token: 'refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'ada@stilltype.test' } });
const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status });

test('deleting an account is one authenticated call to the delete-account function', async () => {
  await withAccountService(() => reply(200, { deleted: true }), async (calls) => {
    await deleteAccount(liveSession());
    assert.deepEqual(calls.map(({ signal, ...call }) => call), [{ path: DELETE_ACCOUNT_PATH, method: 'POST', authorization: 'Bearer token' }]);
    // A stalled request gives up, so the dialog always unlocks.
    assert.ok(calls[0].signal instanceof AbortSignal);
  });
});

test('a failed deletion says what happened, never the platform’s raw text', async () => {
  const cases = [[404, DELETE_COPY.missing], [401, DELETE_COPY.session], [403, DELETE_COPY.session], [500, DELETE_COPY.failed], [546, DELETE_COPY.failed]];
  for (const [status, message] of cases) {
    await withAccountService(() => reply(status, { message: 'raw platform text' }), async () => {
      await assert.rejects(deleteAccount(liveSession()), { message });
    });
  }
});

test('with no reply, deletion says nothing was deleted only once the account is confirmed to exist', async () => {
  const blocked = (userReply) => (path) => {
    if (path === DELETE_ACCOUNT_PATH) throw new TypeError('Failed to fetch');
    return userReply();
  };
  await withAccountService(blocked(() => reply(200, { id: 'u1' })), async (calls) => {
    await assert.rejects(deleteAccount(liveSession()), { message: DELETE_COPY.unavailable });
    assert.deepEqual(calls.map((call) => call.path), [DELETE_ACCOUNT_PATH, '/auth/v1/user']);
  });
  await withAccountService(blocked(() => { throw new TypeError('Failed to fetch'); }), async () => {
    await assert.rejects(deleteAccount(liveSession()), { message: DELETE_COPY.offline });
  });
  // A timed-out request is no reply too.
  const timedOut = (path) => {
    if (path === DELETE_ACCOUNT_PATH) throw new DOMException('The operation timed out.', 'TimeoutError');
    return reply(200, { id: 'u1' });
  };
  await withAccountService(timedOut, async () => {
    await assert.rejects(deleteAccount(liveSession()), { message: DELETE_COPY.unavailable });
  });
});

test('an account the Auth server no longer knows counts as deleted, whatever the function answered', async () => {
  const gone = () => reply(403, { code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' });
  // Deleted by this request, then the reply was lost.
  const lost = (path) => {
    if (path === DELETE_ACCOUNT_PATH) throw new TypeError('Failed to fetch');
    return gone();
  };
  await withAccountService(lost, async (calls) => {
    await deleteAccount(liveSession());
    assert.deepEqual(calls.map((call) => call.path), [DELETE_ACCOUNT_PATH, '/auth/v1/user']);
  });
  // Deleted earlier (another device, or a retry after a lost reply): the function refuses the token.
  const refused = (path) => (path === DELETE_ACCOUNT_PATH ? reply(401, { error: 'Your session has ended.' }) : gone());
  await withAccountService(refused, async (calls) => {
    await deleteAccount(liveSession());
    assert.deepEqual(calls.map((call) => call.path), [DELETE_ACCOUNT_PATH, '/auth/v1/user']);
  });
  // A refused token for an account that still exists is an ended session, and nothing was deleted.
  const stillThere = (path) => (path === DELETE_ACCOUNT_PATH ? reply(401, { error: 'Your session has ended.' }) : reply(200, { id: 'u1' }));
  await withAccountService(stillThere, async () => {
    await assert.rejects(deleteAccount(liveSession()), { message: DELETE_COPY.session });
  });
});

test('a server error is settled by the Auth server, since the account may already be gone', async () => {
  const gone = () => reply(403, { code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' });
  // Any 5xx: the function's own 500 (deleteUser may have committed before its reply was lost), a
  // gateway's 502, 503 or 504, or the platform's 546.
  for (const status of [500, 502, 503, 504, 546]) {
    const failing = (check) => (path) => (path === DELETE_ACCOUNT_PATH ? reply(status, { error: 'raw platform text' }) : check());
    await withAccountService(failing(gone), async (calls) => {
      await deleteAccount(liveSession());
      assert.deepEqual(calls.map((call) => call.path), [DELETE_ACCOUNT_PATH, '/auth/v1/user'], String(status));
    });
    await withAccountService(failing(() => reply(200, { id: 'u1' })), async () => {
      await assert.rejects(deleteAccount(liveSession()), { message: DELETE_COPY.failed });
    });
    // A check that can't say is never a deletion.
    await withAccountService(failing(() => { throw new TypeError('Failed to fetch'); }), async () => {
      await assert.rejects(deleteAccount(liveSession()), { message: DELETE_COPY.failed });
    });
  }
  // Clear refusals that aren't about the token are answered as they are, without asking Auth.
  for (const [status, message] of [[404, DELETE_COPY.missing], [400, DELETE_COPY.failed], [405, DELETE_COPY.failed], [429, DELETE_COPY.failed]]) {
    await withAccountService((path) => (path === DELETE_ACCOUNT_PATH ? reply(status, {}) : gone()), async (calls) => {
      await assert.rejects(deleteAccount(liveSession()), { message });
      assert.deepEqual(calls.map((call) => call.path), [DELETE_ACCOUNT_PATH], String(status));
    });
  }
});

test('an ended session is reported before anything reaches the function', async () => {
  const expired = { ...liveSession(), expires_at: 1 };
  await withAccountService(() => reply(400, { error_description: 'Invalid Refresh Token' }), async (calls) => {
    await assert.rejects(deleteAccount(expired), { message: DELETE_COPY.session });
    assert.deepEqual(calls.map((call) => call.path), ['/auth/v1/token']);
  });
  await withAccountService(() => { throw new TypeError('Failed to fetch'); }, async (calls) => {
    await assert.rejects(deleteAccount(expired), { message: DELETE_COPY.offline });
    assert.deepEqual(calls.map((call) => call.path), ['/auth/v1/token']);
  });
});

// A reply that comes after `ms` (or a request that never answers, with no ms), unless the request's
// signal gives up first, as fetch does. Time here is the mocked clock's.
function answerAfter(init, ms, answer) {
  return new Promise((resolve, reject) => {
    const { signal } = init;
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    if (ms !== undefined) setTimeout(() => { try { resolve(answer()); } catch (error) { reject(error); } }, ms);
  });
}

// Starts a deletion on a mocked clock and reports whether it has settled after each advance.
async function timedDeletion(t, handler, session) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const flush = async () => { for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };
  const outcome = { settled: false, error: null };
  const calls = [];
  const store = new Map();
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  globalThis.fetch = (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push(path);
    return handler(path, init);
  };
  t.after(() => {
    globalThis.localStorage = originalStorage;
    globalThis.fetch = originalFetch;
  });
  const current = session(Date.now());
  store.set('stilltype-session-v1', JSON.stringify(current));
  const before = [...store.entries()];
  deleteAccount(current).then(() => { outcome.settled = true; }, (error) => { outcome.settled = true; outcome.error = error; });
  await flush();
  // Advances in one-second steps, so a step that ends partway through starts the next one in time.
  const advance = async (ms) => {
    for (let left = ms; left > 0; left -= 1000) {
      t.mock.timers.tick(Math.min(1000, left));
      await flush();
    }
  };
  return { outcome, calls, advance, unchanged: () => assert.deepEqual([...store.entries()], before) };
}

const hangs = (path, init) => answerAfter(init);
const expiredAt = (now) => ({ ...liveSession(), expires_at: Math.floor(now / 1000) - 120 });
const liveAt = (now) => ({ ...liveSession(), expires_at: Math.floor(now / 1000) + 3600 });

test('a deletion where every request hangs gives up 30 seconds after it began, not later', async (t) => {
  // An expired token, so the refresh hangs first and nothing reaches the function.
  const { outcome, calls, advance, unchanged } = await timedDeletion(t, hangs, expiredAt);
  await advance(29999);
  assert.equal(outcome.settled, false, 'still waiting before the deadline');
  await advance(1);
  assert.equal(outcome.settled, true, 'settled at the deadline');
  assert.equal(outcome.error?.message, DELETE_COPY.offline);
  assert.deepEqual(calls, ['/auth/v1/token']);
  unchanged();
});

test('the refresh, the function call and the check after it share one 30-second deadline', async (t) => {
  // A slow refresh (10 s), then a function call that never answers: the check gets what is left.
  const slowRefresh = (path, init) => (path === '/auth/v1/token'
    ? answerAfter(init, 10000, () => reply(200, { access_token: 'new', refresh_token: 'next', expires_in: 3600, user: { id: 'u1', email: 'ada@stilltype.test' } }))
    : answerAfter(init));
  const { outcome, calls, advance } = await timedDeletion(t, slowRefresh, expiredAt);
  await advance(29999);
  assert.equal(outcome.settled, false);
  await advance(1);
  assert.equal(outcome.settled, true);
  assert.equal(outcome.error?.message, DELETE_COPY.offline);
  assert.deepEqual(calls.slice(0, 2), ['/auth/v1/token', DELETE_ACCOUNT_PATH]);
});

test('a check that runs out of time is never taken for a deletion', async (t) => {
  // The function's connection drops after 20 s (it may have deleted the account or not) and the
  // check hangs: past the deadline the account is unconfirmed, so this is a failure, not a success.
  const dropped = (path, init) => (path === DELETE_ACCOUNT_PATH
    ? answerAfter(init, 20000, () => { throw new TypeError('Failed to fetch'); })
    : answerAfter(init));
  const { outcome, calls, advance, unchanged } = await timedDeletion(t, dropped, liveAt);
  await advance(29999);
  assert.equal(outcome.settled, false);
  await advance(1);
  assert.equal(outcome.settled, true);
  assert.equal(outcome.error?.message, DELETE_COPY.offline);
  assert.deepEqual(calls, [DELETE_ACCOUNT_PATH, '/auth/v1/user']);
  unchanged();
});

test('a server error whose check runs out of time is never taken for a deletion', async (t) => {
  const serverError = (path, init) => (path === DELETE_ACCOUNT_PATH
    ? answerAfter(init, 5000, () => reply(500, { error: 'raw platform text' }))
    : answerAfter(init));
  const { outcome, calls, advance, unchanged } = await timedDeletion(t, serverError, liveAt);
  await advance(29999);
  assert.equal(outcome.settled, false);
  await advance(1);
  assert.equal(outcome.settled, true);
  assert.equal(outcome.error?.message, DELETE_COPY.failed);
  assert.deepEqual(calls, [DELETE_ACCOUNT_PATH, '/auth/v1/user']);
  unchanged();
});

test('a check that answers before the deadline still confirms a deletion whose reply was lost', async (t) => {
  const lostThenGone = (path, init) => (path === DELETE_ACCOUNT_PATH
    ? answerAfter(init, 20000, () => { throw new TypeError('Failed to fetch'); })
    : answerAfter(init, 5000, () => reply(403, { code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' })));
  const { outcome, advance } = await timedDeletion(t, lostThenGone, liveAt);
  await advance(25000);
  assert.equal(outcome.settled, true);
  assert.equal(outcome.error, null);
});

test('forgetting a deleted account removes its session and device cache, sends nothing and keeps other accounts', async () => {
  await withAccountService(() => reply(200), async (calls, store) => {
    store.set('stilltype-session-v1', '{}');
    store.set(profileKey('u1'), '{}');
    store.set(profileKey('u2'), '{}');
    forgetAccount(liveSession());
    assert.deepEqual([...store.keys()], [profileKey('u2')]);
    assert.deepEqual(calls, []);
  });
});

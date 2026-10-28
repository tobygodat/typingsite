// The delete-account Edge Function's handler, run under Node with a stand-in for supabase-js's auth
// client. index.ts only wires this handler to Deno.serve and a service-key client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CORS_HEADERS, MESSAGES, handleDeleteAccount } from '../supabase/functions/delete-account/handler.ts';

const USERS = { 'token-ada': 'user-ada' };

// commitsThenFails: deleteUser removes the user and then 'throws' or 'errors', as when its reply is lost.
function fakeAuth({ deleteError = null, lookupThrows = false, deleteThrows = false, commitsThenFails = null, recheckThrows = false } = {}) {
  const deleted = [];

  return {
    deleted,
    async getUser(jwt) {
      if (lookupThrows) throw new Error('auth unreachable');
      const id = USERS[jwt];

      return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } };
    },
    admin: {
      async deleteUser(id, shouldSoftDelete) {
        if (commitsThenFails) {
          deleted.push({ id, shouldSoftDelete });

          if (commitsThenFails === 'throws') throw new Error('connection reset');

          return { data: { user: null }, error: { status: 504, message: 'upstream timeout' } };
        }

        if (deleteThrows) throw new Error('auth unreachable');

        if (!deleteError) deleted.push({ id, shouldSoftDelete });

        return { data: { user: null }, error: deleteError };
      },
      async getUserById(id) {
        if (recheckThrows) throw new Error('auth unreachable');

        return deleted.some((entry) => entry.id === id)
          ? { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } }
          : { data: { user: { id } }, error: null };
      },
    },
  };
}

const call = (auth, { method = 'POST', authorization, body = '{"userId":"user-bob"}' } = {}) => handleDeleteAccount(
  new Request('https://example.supabase.co/functions/v1/delete-account', {
    method,
    headers: authorization ? { Authorization: authorization } : {},
    body: method === 'POST' ? body : undefined,
  }),
  auth,
);

test('the caller’s own token decides whose account goes, and it is a hard delete', async () => {
  const auth = fakeAuth();
  const response = await call(auth, { authorization: 'Bearer token-ada' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  // The body asked for someone else; it is never read.
  assert.deepEqual(auth.deleted, [{ id: 'user-ada', shouldSoftDelete: false }]);
});

test('a missing, malformed or rejected token deletes nothing', async () => {
  for (const authorization of [undefined, 'token-ada', 'Basic token-ada', 'Bearer ', 'Bearer token-stranger']) {
    const auth = fakeAuth();
    const response = await call(auth, { authorization });
    assert.equal(response.status, 401, String(authorization));
    assert.deepEqual(await response.json(), { error: MESSAGES.session });
    assert.deepEqual(auth.deleted, []);
  }
});

test('a failed or unreachable Auth server is a 500 that says nothing was removed', async () => {
  for (const options of [{ deleteError: { message: 'database error' } }, { deleteThrows: true }, { lookupThrows: true }]) {
    const auth = fakeAuth(options);
    const response = await call(auth, { authorization: 'Bearer token-ada' });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: MESSAGES.failed });
    assert.deepEqual(auth.deleted, []);
  }
});

test('a delete that committed before failing on the way back is reported as done', async () => {
  for (const commitsThenFails of ['throws', 'errors']) {
    const auth = fakeAuth({ commitsThenFails });
    const response = await call(auth, { authorization: 'Bearer token-ada' });
    assert.equal(response.status, 200, commitsThenFails);
    assert.deepEqual(await response.json(), { deleted: true });
  }

  // If the second look fails too, the function can't tell, and says it failed.
  const response = await call(fakeAuth({ commitsThenFails: 'throws', recheckThrows: true }), { authorization: 'Bearer token-ada' });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: MESSAGES.failed });
});

test('browsers get CORS headers on every reply, including the preflight and errors', async () => {
  const preflight = await call(fakeAuth(), { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);

  for (const response of [preflight, await call(fakeAuth()), await call(fakeAuth(), { method: 'GET' }), await call(null, { authorization: 'Bearer token-ada' })]) {
    for (const [name, value] of Object.entries(CORS_HEADERS)) assert.equal(response.headers.get(name), value);
  }

  assert.match(CORS_HEADERS['Access-Control-Allow-Headers'], /\bapikey\b/);
  assert.match(CORS_HEADERS['Access-Control-Allow-Headers'], /\bauthorization\b/);
});

test('other methods and a server without its keys are refused without deleting', async () => {
  assert.equal((await call(fakeAuth(), { method: 'GET' })).status, 405);
  const unconfigured = await call(null, { authorization: 'Bearer token-ada' });
  assert.equal(unconfigured.status, 500);
  assert.deepEqual(await unconfigured.json(), { error: MESSAGES.config });
});

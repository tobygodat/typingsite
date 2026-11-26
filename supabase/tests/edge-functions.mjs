// Calls the delete-account and generate-theme Edge Functions on the local stack, through its gateway,
// with real users from its Auth server. Start the stack first with `supabase start`, which serves every
// function in supabase/functions. Run with `node supabase/tests/edge-functions.mjs`.
//
// tests/delete-account.test.js and tests/generate-theme.test.js cover each handler's branches with stand-ins.
// This checks what they can't: that index.ts boots on the Edge Runtime, the gateway's JWT check, and that
// deleting a real account removes its auth.users row and, through the cascade, its profile.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' }));
const api = status.API_URL;
const anonKey = status.ANON_KEY;
const serviceKey = status.SERVICE_ROLE_KEY;

assert.ok(api && anonKey && serviceKey, 'supabase status names the API URL and both keys');

async function call(path, method, headers, body) {
  const response = await fetch(`${api}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();

  return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : null };
}

// A request with an API key, signed in as `token`'s user (or as the key's role when `token` is the key).
const as = (key, token = key) => ({ apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const admin = as(serviceKey);

async function signedInUser() {
  const email = `edge-test-${randomUUID()}@example.invalid`;
  const password = randomUUID();
  const created = await call('/auth/v1/admin/users', 'POST', admin, { email, password, email_confirm: true });
  assert.equal(created.status, 200, `the Auth server creates ${email}`);
  const session = await call('/auth/v1/token?grant_type=password', 'POST', as(anonKey), { email, password });
  assert.equal(session.status, 200, `${email} signs in`);

  return { id: created.json.id, token: session.json.access_token };
}

async function check(name, run) {
  await run();
  console.log(`pass ${name}`);
}

for (const fn of ['delete-account', 'generate-theme']) {
  await check(`${fn} answers a preflight without a token`, async () => {
    const preflight = await call(`/functions/v1/${fn}`, 'OPTIONS', { Origin: 'http://localhost:4173', 'Access-Control-Request-Method': 'POST' });
    assert.ok(preflight.status === 200 || preflight.status === 204, `preflight status ${preflight.status}`);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  });

  await check(`${fn} refuses a request without a user token`, async () => {
    const refused = await call(`/functions/v1/${fn}`, 'POST', { 'Content-Type': 'application/json' }, {});
    // The gateway's JWT check (verify_jwt, on by default) answers before the function runs.
    assert.equal(refused.status, 401);
  });
}

await check('delete-account deletes the caller, their profile with them, and only once', async () => {
  const user = await signedInUser();
  const bystander = await signedInUser();

  for (const owner of [user, bystander]) {
    const saved = await call('/rest/v1/profiles', 'POST', { ...as(anonKey, owner.token), Prefer: 'return=minimal' }, { user_id: owner.id, data: { version: 2 } });
    assert.equal(saved.status, 201, 'each user saves their own profile row');
  }

  const deleted = await call('/functions/v1/delete-account', 'POST', as(anonKey, user.token), {});
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.json, { deleted: true });

  assert.equal((await call(`/auth/v1/admin/users/${user.id}`, 'GET', admin)).status, 404, 'the auth.users row is gone');
  assert.deepEqual((await call(`/rest/v1/profiles?user_id=eq.${user.id}&select=user_id`, 'GET', admin)).json, [], 'the profile row went with it');
  assert.deepEqual((await call(`/rest/v1/profiles?user_id=eq.${bystander.id}&select=user_id`, 'GET', admin)).json, [{ user_id: bystander.id }], 'another account keeps its profile');
  assert.equal((await call(`/auth/v1/admin/users/${bystander.id}`, 'GET', admin)).status, 200, 'another account stays');

  // The token still verifies at the gateway, but the Auth server no longer names a user for it.
  const again = await call('/functions/v1/delete-account', 'POST', as(anonKey, user.token), {});
  assert.equal(again.status, 401);
});

await check('generate-theme reports that it is not set up without its Anthropic key', async () => {
  const user = await signedInUser();
  const answer = await call('/functions/v1/generate-theme', 'POST', as(anonKey, user.token), { vibe: 'rainy Tokyo night' });
  assert.equal(answer.status, 500);
  assert.equal(answer.json.code, 'config');
});

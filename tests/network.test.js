import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Effect } from 'effect';
import { request, requestEffect, AuthError, UNREACHABLE } from '../src/network.js';
import { AsyncLifetime, replaceAccountLifetime, disposePageWork, startPageWork } from '../src/async-runtime.js';

async function service(run) {
  const nativeFetch = globalThis.fetch;
  const calls = [];

  const server = createServer((incoming, response) => {
    calls.push(incoming.url);

    if (incoming.url === '/error' || incoming.url === '/numeric-error') {
      response.writeHead(409, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Already written.', code: incoming.url === '/numeric-error' ? 400 : '23505' }));
    } else if (incoming.url === '/body') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{"pending":');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const signals = [];
  globalThis.fetch = (url, options) => {
    signals.push(options.signal);

    return nativeFetch(origin + new URL(url).pathname, options);
  };

  try { await run({ calls, signals }); }
  finally {
    globalThis.fetch = nativeFetch;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const until = async (predicate) => {
  for (let n = 0; n < 100 && !predicate(); n += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(predicate(), 'request reached the local service');
};

test('native fetch is aborted while waiting for headers or the response body', async () => {
  await service(async ({ calls, signals }) => {
    for (const path of ['/headers', '/body']) {
      const lifetime = new AsyncLifetime();
      const pending = lifetime.run(requestEffect(path, { method: 'POST', body: {}, timeoutMs: 100 }));
      const rejection = assert.rejects(pending, (error) => error instanceof AuthError && error.message === UNREACHABLE);
      await until(() => calls.includes(path));
      await rejection;
      assert.equal(signals.at(-1).aborted, true);
      assert.equal(calls.filter((call) => call === path).length, 1, 'an uncertain mutation is never retried');
      await lifetime.close();
    }
  });
});

test('caller cancellation aborts the real body read and keeps the legacy AuthError', async () => {
  await service(async ({ calls, signals }) => {
    const caller = new AbortController();
    const pending = request('/body', { signal: caller.signal });
    const rejection = assert.rejects(pending, (error) => error instanceof AuthError && error.message === UNREACHABLE);
    await until(() => calls.length === 1);
    caller.abort();
    await rejection;
    assert.equal(signals[0].aborted, true);
  });
});

test('identity replacement and page disposal prevent stale request results from applying', async () => {
  await service(async ({ calls, signals }) => {
    let applied = 0;
    await replaceAccountLifetime('one:sign-in');
    const first = request('/body', { token: 'one' }).then(() => { applied += 1; });
    const firstRejected = assert.rejects(first, AuthError);
    await until(() => calls.length === 1);
    await replaceAccountLifetime('two:sign-in');
    await firstRejected;
    assert.equal(signals[0].aborted, true);
    const next = request('/headers', { token: 'two' }).then(() => { applied += 1; });
    const nextRejected = assert.rejects(next, AuthError);
    await until(() => calls.length === 2);
    await disposePageWork();
    await nextRejected;
    assert.equal(signals[1].aborted, true);
    assert.equal(applied, 0);
    startPageWork();
  });
});

test('typed Effect failure and Promise adapter preserve AuthError identity, status and code', async () => {
  await service(async () => {
    const failure = await Effect.runPromise(Effect.flip(requestEffect('/error')));
    assert.ok(failure instanceof AuthError);
    assert.equal(failure.message, 'Already written.');
    assert.equal(failure.status, 409);
    assert.equal(failure.code, '23505');
    const lifetime = new AsyncLifetime();
    await assert.rejects(lifetime.run(Effect.fail(failure)), (error) => error === failure);
    await assert.rejects(request('/error'), (error) => error instanceof AuthError && error.status === 409 && error.code === '23505');
    await assert.rejects(request('/numeric-error'), (error) => error instanceof AuthError && error.code === 400);
    await lifetime.close();
  });
});

test('a remotely committed friend mutation is reconciled by a read before the next write, never retried', async () => {
  const { queueFriendRequests, addFriend, removeFriend, listFriends } = await import('../src/multiplayer.js');
  const nativeFetch = globalThis.fetch;
  const actions = [];
  let friends = [];

  const server = createServer(async (incoming, response) => {
    let body = '';

    for await (const chunk of incoming) body += chunk;
    const command = JSON.parse(body);
    actions.push(command.p_action);

    if (command.p_action === 'befriend') {
      friends = [{ id: 'new-friend', name: 'Lin' }];
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'The reply was lost after the write.' }));
    } else {
      if (command.p_action === 'unfriend') friends = [];
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(friends));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = (url, options) => nativeFetch(origin + new URL(url).pathname, options);
  const session = { user: { id: 'owner' }, access_token: 'token', refresh_token: 'refresh', expires_at: 9999999999 };
  const shown = [];
  const queue = queueFriendRequests((list) => shown.push(list), { load: (signal) => listFriends(session, signal) });

  try {
    const first = queue.change((signal) => addFriend(session, { email: 'lin@example.com' }, signal));
    const rejected = assert.rejects(first, /reply was lost/);
    const second = queue.change((signal) => removeFriend(session, 'new-friend', signal));
    await rejected;
    await second;
    assert.deepEqual(actions, ['befriend', 'friends', 'unfriend']);
    assert.deepEqual(shown.map((list) => list.map((friend) => friend.id)), [['new-friend'], []]);
  } finally {
    globalThis.fetch = nativeFetch;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an identity replacement cancels queued friend changes before they send or apply', async () => {
  const { queueFriendRequests } = await import('../src/multiplayer.js');
  let sent = 0;
  let applied = 0;
  let signal;
  await replaceAccountLifetime('first:signin');
  const queue = queueFriendRequests(() => { applied += 1; });

  const first = queue.change((received) => {
    signal = received;
    sent += 1;

    return new Promise((resolve, reject) => received.addEventListener('abort', () => reject(received.reason), { once: true }));
  });

  const second = queue.change(async () => { sent += 1;

 return []; });

  const rejected = Promise.all([assert.rejects(first), assert.rejects(second)]);
  await until(() => sent === 1);
  await replaceAccountLifetime('second:signin');
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(sent, 1);
  assert.equal(applied, 0);
  await replaceAccountLifetime(null);
});

test('raw account recovery preserves historical records, future fields and condition JSON order', async () => {
  const { unsentCopy, withConditionSets, withoutConditionSets } = await import('../src/account.js');

  const raw = { futureField: { nested: ['kept'] }, version: 2, runs: [{ id: 'undated', conditions: { metricVersion: 'old', mode: 'words', corpus: 'old-en-v1', count: 10 } }],
    lessons: { first: { last: { at: '2020-01-01T00:00:00Z', wpm: 12 } } }, preferences: { unknownSetting: { value: true } } };

  const recovered = unsentCopy(JSON.stringify(raw), 'not-the-sent-copy', null);
  assert.deepEqual(recovered, raw);
  assert.equal(JSON.stringify(recovered), JSON.stringify(raw));
  const stored = withConditionSets(raw, Date.parse('2027-01-01T00:00:00Z'));
  assert.equal(JSON.stringify(withoutConditionSets(stored)), JSON.stringify(raw));
  const legacy = { version: 2, runs: [{ id: 'numeric-set', conditionSet: 0 }], conditionSets: [{ mode: 'words', count: 10 }] };
  assert.deepEqual(withoutConditionSets(legacy), { version: 2, runs: [{ id: 'numeric-set', conditions: { mode: 'words', count: 10 } }] });
});

test('best recovery after a clear keeps the historical condition key and its original truthiness', async () => {
  const { mergeSynced } = await import('../src/account.js');
  const { conditionKey } = await import('../src/typing.js');
  const conditions = { mode: 'words', count: 10, punctuation: 'legacy-truthy' };
  const key = conditionKey(conditions);

  const mine = { version: 2, runs: [{ id: 'surviving', at: '2021-01-01T00:00:00Z', conditions, kind: 'test', status: 'complete', score: { wpm: 72 } }],
    bests: { [key]: { wpm: 90, at: '2019-01-01T00:00:00Z', attemptId: 'taken' } } };

  const cleared = { version: 2, historyClearedAt: '2020-01-01T00:00:00Z' };
  const merged = mergeSynced(mine, cleared);
  assert.equal(merged.bests[key]?.attemptId, 'surviving');
  assert.equal(merged.bests[key]?.wpm, 72);
  assert.deepEqual(merged.runs[0].conditions, conditions);
});

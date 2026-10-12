import test from 'node:test';
import assert from 'node:assert/strict';
import {
  challengeFor, cleanRedirectUrl, freshSession, MAX_SUGGESTION, mergeProfiles, mergeSynced, parseAuthRedirect, profileKey, restoreUnsent,
  sameProfile, sameSignIn, SESSION_KEY, signedOutKey, signIn, signOut, suggestionRow, textStamp, unsentCopy,
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

test('refreshing a session another tab has signed out of never touches the session stored since', async () => {
  const later = Math.floor(Date.now() / 1000) + 3600;
  const other = JSON.stringify({ access_token: 'b', refresh_token: 'b-refresh', expires_at: later, user: { id: 'u2' } });
  const store = new Map([['stilltype-session-v1', other]]);
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  const old = { access_token: 'a', refresh_token: 'a-refresh', expires_at: 1, user: { id: 'u1' } };
  const reply = (status, body) => async () => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
  try {
    // The old account's refresh token was ended by its sign-out: refused, but the other account stays.
    globalThis.fetch = reply(400, { error: 'invalid_grant' });
    await assert.rejects(freshSession(old));
    assert.equal(store.get('stilltype-session-v1'), other);
    // Still accepted: the refreshed session is returned but not stored over the other account.
    globalThis.fetch = reply(200, { access_token: 'a2', refresh_token: 'a-refresh-2', expires_in: 3600, user: { id: 'u1' } });
    assert.equal((await freshSession(old)).refresh_token, 'a-refresh-2');
    assert.equal(store.get('stilltype-session-v1'), other);
    // The stored session's own refresh token refused: that session is over.
    const own = { access_token: 'c', refresh_token: 'c-refresh', expires_at: 1, user: { id: 'u3' } };
    store.set('stilltype-session-v1', JSON.stringify(own));
    globalThis.fetch = reply(400, { error: 'invalid_grant' });
    await assert.rejects(freshSession(own));
    assert.equal(store.has('stilltype-session-v1'), false);
  } finally {
    globalThis.localStorage = originalStorage;
    globalThis.fetch = originalFetch;
  }
});

test('a refresh that lands after the same account signed in again keeps the new session', async () => {
  const later = Math.floor(Date.now() / 1000) + 3600;
  const old = JSON.stringify({ access_token: 'a', refresh_token: 'a-refresh', expires_at: 1, user: { id: 'u1' } });
  const signedInAgain = JSON.stringify({ access_token: 'n', refresh_token: 'n-refresh', expires_at: later, user: { id: 'u1' } });
  const store = new Map([['stilltype-session-v1', old]]);
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  // Another tab signs out and in again while the refresh is out.
  globalThis.fetch = async () => {
    store.set('stilltype-session-v1', signedInAgain);
    return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'a2', refresh_token: 'a-refresh-2', expires_in: 3600, user: { id: 'u1' } }) };
  };
  try {
    assert.equal((await freshSession(JSON.parse(old))).refresh_token, 'a-refresh-2');
    assert.equal(store.get('stilltype-session-v1'), signedInAgain);
  } finally {
    globalThis.localStorage = originalStorage;
    globalThis.fetch = originalFetch;
  }
});

test('signing out touches only what is still that account’s', async () => {
  const later = Math.floor(Date.now() / 1000) + 3600;
  const session = (id) => ({ access_token: `${id}-access`, refresh_token: `${id}-refresh`, expires_at: later, user: { id } });
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  let store;
  const logouts = [];
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  globalThis.fetch = async (url, { headers }) => {
    logouts.push(headers.Authorization);
    return { ok: true, status: 204, text: async () => '' };
  };
  const sent = '{"version":2,"runs":[]}';
  const device = (stored) => new Map([
    ...(stored ? [['stilltype-session-v1', JSON.stringify(session(stored))]] : []),
    [profileKey('u1'), sent],
    [profileKey('u2'), '{"version":2}'],
  ]);
  try {
    // Everything sent, and the cache still holds exactly the copy sent: the session, the cache and any
    // marker go.
    store = device('u1');
    store.set(signedOutKey('u1'), 'true');
    await signOut(session('u1'), { sentText: sent });
    assert.deepEqual([...store.keys()], [profileKey('u2')]);
    // The cache holds another copy (another tab saved since), or nothing was confirmed sent: it stays,
    // marked, for the next sign-in.
    for (const sentText of ['{"version":2,"runs":[{"id":"r"}]}', null]) {
      store = device('u1');
      await signOut(session('u1'), { sentText });
      assert.deepEqual([...store.keys()].sort(), [profileKey('u1'), profileKey('u2'), signedOutKey('u1')].sort());
      assert.equal(store.get(signedOutKey('u1')), 'true');
      assert.equal(store.get(profileKey('u1')), sent);
    }
    // The session had expired (none stored): only the marker is left.
    store = device(null);
    await signOut(session('u1'));
    assert.deepEqual([...store.keys()].sort(), [profileKey('u1'), profileKey('u2'), signedOutKey('u1')].sort());
    // Another tab signed in as someone else meanwhile: that session and both caches stay, and nothing is
    // marked, whichever way this sign-out ended.
    for (const sentText of [sent, null]) {
      store = device('u2');
      const before = [...store.entries()];
      await signOut(session('u1'), { sentText });
      assert.deepEqual([...store.entries()], before);
    }
    assert.equal(logouts.length, 6);
  } finally {
    globalThis.localStorage = originalStorage;
    globalThis.fetch = originalFetch;
  }
});

test('a sign-in gets an id that its refreshes keep, stored or not', async () => {
  const store = new Map();
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  let issued = 0;
  globalThis.fetch = async () => {
    issued += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: `a${issued}`, refresh_token: `r${issued}`, expires_in: 3600, user: { id: 'u1' } }) };
  };
  try {
    const first = await signIn('ada@stilltype.test', 'pw');
    const second = await signIn('ada@stilltype.test', 'pw');
    assert.match(first.signInId, /^[\w-]{12}$/);
    assert.notEqual(second.signInId, first.signInId);
    assert.equal(sameSignIn(first, second), false);
    // Refreshed over the stored copy: the same sign-in.
    const expiring = { ...second, expires_at: 1 };
    store.set(SESSION_KEY, JSON.stringify(expiring));
    const refreshed = await freshSession(expiring);
    assert.equal(refreshed.refresh_token, 'r3');
    assert.equal(JSON.parse(store.get(SESSION_KEY)).signInId, second.signInId);
    assert.ok(sameSignIn(refreshed, second));
    // Refreshed after another sign-in was stored (left in place): still its own sign-in, not that one.
    const other = JSON.stringify({ ...first, expires_at: 0 });
    store.set(SESSION_KEY, other);
    const own = await freshSession(expiring);
    assert.equal(own.signInId, second.signInId);
    assert.equal(store.get(SESSION_KEY), other);
    // Sessions stored before sign-ins had an id count as one sign-in.
    assert.ok(sameSignIn({ user: { id: 'u1' }, refresh_token: 'x' }, { user: { id: 'u1' }, refresh_token: 'y' }));
  } finally {
    globalThis.localStorage = originalStorage;
    globalThis.fetch = originalFetch;
  }
});

test('signing out leaves a newer sign-in to the same account alone, and ends its own however refreshed', async () => {
  const later = Math.floor(Date.now() / 1000) + 3600;
  const session = (signInId, token) => ({ access_token: `${token}-access`, refresh_token: `${token}-refresh`, expires_at: later, user: { id: 'u1' }, signInId });
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  const sent = '{"version":2,"runs":[]}';
  let store;
  const logouts = [];
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  globalThis.fetch = async (url, { headers }) => {
    logouts.push(headers.Authorization);
    return { ok: true, status: 204, text: async () => '' };
  };
  try {
    // A guest tab signed in to the account since: nothing is touched or marked, and no logout goes out,
    // since it would end every session of the account, that one included.
    for (const sentText of [sent, null]) {
      store = new Map([[SESSION_KEY, JSON.stringify(session('newer', 'n'))], [profileKey('u1'), sent]]);
      const before = [...store.entries()];
      await signOut(session('mine', 'm'), { sentText });
      assert.deepEqual([...store.entries()], before);
    }
    assert.deepEqual(logouts, []);
    // Its own sign-in, refreshed since by another tab: removed, and logged out with the device's copy.
    store = new Map([[SESSION_KEY, JSON.stringify(session('mine', 'm2'))], [profileKey('u1'), sent]]);
    await signOut(session('mine', 'm'), { sentText: sent });
    assert.deepEqual([...store.keys()], []);
    assert.deepEqual(logouts, ['Bearer m2-access']);
  } finally {
    globalThis.localStorage = originalStorage;
    globalThis.fetch = originalFetch;
  }
});

test('a sign-out that sent everything names the copy it sent before removing it', async () => {
  const later = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: 'u1-access', refresh_token: 'u1-refresh', expires_at: later, user: { id: 'u1' } };
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  const sent = '{"version":2,"runs":[{"id":"a"}]}';
  const store = new Map([[SESSION_KEY, JSON.stringify(session)], [profileKey('u1'), sent]]);
  const writes = [];
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { writes.push(['set', key, value]); store.set(key, value); },
    removeItem: (key) => { writes.push(['remove', key]); store.delete(key); },
  };
  globalThis.fetch = async () => ({ ok: true, status: 204, text: async () => '' });
  try {
    await signOut(session, { sentText: sent });
    // Other tabs hear the marker first, so each knows which copy the removal after it was meant to take.
    assert.deepEqual(writes, [
      ['set', signedOutKey('u1'), JSON.stringify({ sent: textStamp(sent) })],
      ['remove', SESSION_KEY],
      ['remove', profileKey('u1')],
      ['remove', signedOutKey('u1')],
    ]);
    assert.deepEqual([...store.keys()], []);
  } finally {
    globalThis.localStorage = originalStorage;
    globalThis.fetch = originalFetch;
  }
});

test('a copy of the cache is stamped by its exact text', () => {
  const text = '{"version":2,"runs":[{"id":"a"}]}';
  assert.equal(textStamp(text), textStamp(String(text)));
  assert.notEqual(textStamp(text), textStamp(text.replace('"a"', '"b"')));
  assert.notEqual(textStamp(text), textStamp(`${text} `));
});

test('a removal heard from a sign-out gives back only what the copy sent lacks', () => {
  const at = (n) => new Date(Date.UTC(2026, 9, 1, 12, n)).toISOString();
  const copy = (over = {}) => JSON.stringify({ version: 2, profileId: 'p', preferences: {}, attempts: [], runs: [], loops: [], seenTextIds: [], bests: {}, ...over });
  const runs = (data) => data.runs.map((run) => run.id);
  const sentText = copy({ runs: [{ id: 'a', at: at(1) }] });
  const sent = textStamp(sentText);

  // The copy sent was removed, and this tab's copy is the same, held in it, or absent: nothing was lost.
  assert.equal(unsentCopy(sentText, sent, sentText), null);
  assert.equal(unsentCopy(sentText, sent, copy()), null);
  assert.equal(unsentCopy(sentText, sent, null), null);
  // Another tab's save, unseen by the signing-out tab, was removed instead: it comes back, with this tab's.
  const unseen = copy({ runs: [{ id: 'a', at: at(1) }, { id: 'b', at: at(2) }] });
  assert.deepEqual(runs(unsentCopy(unseen, sent, sentText)), ['a', 'b']);
  assert.deepEqual(runs(unsentCopy(unseen, sent, null)), ['a', 'b']);
  // The copy sent was removed, but this tab saved a run it lacks (a write-back held over a run): the union.
  assert.deepEqual(runs(unsentCopy(sentText, sent, copy({ runs: [{ id: 'c', at: at(3) }] }))), ['a', 'c']);
  // This tab's copy is stale, and a clear in the copy sent took out its runs: nothing was lost.
  const cleared = copy({ historyClearedAt: at(5), runs: [{ id: 'after', at: at(6) }] });
  assert.equal(unsentCopy(cleared, textStamp(cleared), copy({ runs: [{ id: 'old', at: at(2) }] })), null);
  // Nothing readable was removed: this tab's copy alone.
  assert.deepEqual(runs(unsentCopy(null, sent, unseen)), ['a', 'b']);
  assert.equal(unsentCopy(null, sent, null), null);
});

test('what a sign-out removed unsent goes back into the cache, merged with anything stored since', () => {
  const originalStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  const copy = (ids) => JSON.stringify({ version: 2, profileId: 'p', preferences: {}, attempts: [], runs: ids.map((id, n) => ({ id, at: `2026-10-01T12:0${n}:00.000Z` })), loops: [], seenTextIds: [], bests: {} });
  try {
    const sentText = copy(['a']);
    assert.equal(restoreUnsent('u1', sentText, textStamp(sentText), sentText), false);
    assert.deepEqual([...store.keys()], []);
    assert.equal(restoreUnsent('u1', copy(['a', 'b']), textStamp(sentText), sentText), true);
    assert.deepEqual(JSON.parse(store.get(profileKey('u1'))).runs.map((run) => run.id), ['a', 'b']);
    // Another tab put back its own copy first: both stay.
    store.set(profileKey('u1'), copy(['x']));
    restoreUnsent('u1', copy(['a', 'b']), textStamp(sentText), null);
    assert.deepEqual(JSON.parse(store.get(profileKey('u1'))).runs.map((run) => run.id).sort(), ['a', 'b', 'x']);
    assert.deepEqual([...store.keys()], [profileKey('u1')]);
  } finally {
    globalThis.localStorage = originalStorage;
  }
});

// ── Copies saved by builds from before merging ──────────────────────────
// Those builds synced whole copies (the copy saved later replaced the other, by updatedAt) and cleared
// history by saving an empty copy, with no marker. This build's copies carry mergeStamp, the updatedAt
// it wrote; an older build stamps updatedAt on every save and passes mergeStamp through unchanged.
const minute = (n) => new Date(Date.UTC(2026, 8, 20, 9, n)).toISOString();
const record = (id, n) => ({ id, at: minute(n), textId: `t-${id}` });
const olderBuild = (over = {}) => ({ version: 2, profileId: 'p', preferences: {}, attempts: [], runs: [], loops: [], seenTextIds: [], bests: {}, ...over });
const thisBuild = (over = {}) => ({ ...olderBuild(over), mergeStamp: over.updatedAt });
const recordIds = (copy) => Object.fromEntries(['attempts', 'runs', 'loops'].map((name) => [name, copy[name].map((item) => item.id)]));
const best = (id, n, wpm) => ({ k: { wpm, attemptId: id, at: minute(n) } });

test('a clear an older build saved is kept when this build merges an older copy, in either order', () => {
  // Synced before the clear: two runs, a loop, a best, and a passage shown but never typed.
  const older = olderBuild({ attempts: [record('r1', 1)], runs: [record('r1', 1), record('r2', 2)], loops: [record('l2', 2)],
    seenTextIds: ['t-r1', 't-r2', 'shown'], bests: best('r2', 2, 60), updatedAt: minute(3) });
  for (const cleared of [
    // Cleared at minute 5 with nothing since (the account row, or the clearing device's cache when its push failed).
    olderBuild({ updatedAt: minute(5) }),
    // Cleared, then a slower run at minute 6 on that build.
    olderBuild({ attempts: [record('r6', 6)], runs: [record('r6', 6)], seenTextIds: ['t-r6'], bests: best('r6', 6, 40), updatedAt: minute(6) }),
  ]) {
    for (const merged of [mergeSynced(older, cleared), mergeSynced(cleared, older)]) {
      assert.deepEqual(recordIds(merged), recordIds(cleared));
      assert.deepEqual(merged.bests, cleared.bests);
      assert.deepEqual(merged.seenTextIds, cleared.seenTextIds);
      assert.ok(sameProfile(mergeSynced(merged, older), merged), 'merging the older copy again changes nothing');
      assert.ok(sameProfile(mergeSynced(cleared, merged), merged));
    }
  }
});

test('once merged, an older build’s clear keeps out every copy saved before it, as whole-copy sync did', () => {
  const older = olderBuild({ runs: [record('r1', 1), record('r2', 2)], seenTextIds: ['t-r1', 't-r2'], bests: best('r2', 2, 60), updatedAt: minute(3) });
  const cleared = olderBuild({ runs: [record('r6', 6)], seenTextIds: ['t-r6'], updatedAt: minute(6) });
  const saved = mergeSynced(older, cleared);
  // A third device's copy, older still and holding a run of its own from before the clear.
  const oldest = olderBuild({ runs: [record('r0', 0), record('r1', 1)], seenTextIds: ['t-r0'], bests: best('r0', 0, 70), updatedAt: minute(2) });
  // A copy this build saved before the clear, with a run the clearing device never saw.
  const unsent = thisBuild({ runs: [record('r1', 1), record('r4', 4)], seenTextIds: ['t-r1', 't-r4'], bests: best('r4', 4, 80), updatedAt: minute(4) });
  for (const copy of [oldest, unsent]) {
    for (const merged of [mergeSynced(copy, saved), mergeSynced(saved, copy), mergeSynced(mergeSynced(copy, older), saved),
      mergeSynced(mergeSynced(saved, older), copy)]) {
      assert.deepEqual(recordIds(merged).runs, ['r6']);
      assert.deepEqual(merged.bests, {});
      assert.deepEqual(merged.seenTextIds, ['t-r6']);
    }
  }
  // A save made later by a copy that never heard of the clear replaced it under whole-copy sync, keeping
  // only its own runs; here it replaces it too, and the run made after the clear stays as well. (A clear
  // made on this build holds against such a save: see the last test below.)
  const stale = olderBuild({ ...older, runs: [...older.runs, record('r9', 9)], updatedAt: minute(9) });
  const offline = thisBuild({ ...older, runs: [...older.runs, record('r8', 8)], updatedAt: minute(8) });
  for (const [copy, runs] of [[stale, ['r1', 'r2', 'r6', 'r9']], [offline, ['r1', 'r2', 'r6', 'r8']]]) {
    for (const merged of [mergeSynced(copy, saved), mergeSynced(saved, copy)]) assert.deepEqual(recordIds(merged).runs, runs);
  }
});

test('copies that took the same start from an older build’s copy merge as union, seen passages included', () => {
  const row = mergeSynced(olderBuild({ runs: [record('r1', 1)], seenTextIds: ['t-r1'], updatedAt: minute(2) }),
    olderBuild({ runs: [record('r1', 1)], seenTextIds: ['t-r1'], updatedAt: minute(2) }));
  // One tab showed a passage it never typed; the other saved a run later.
  const shown = { ...row, seenTextIds: [...row.seenTextIds, 'shown'], updatedAt: minute(3), mergeStamp: minute(3) };
  const ran = { ...row, runs: [...row.runs, record('r4', 4)], seenTextIds: [...row.seenTextIds, 't-r4'], updatedAt: minute(4), mergeStamp: minute(4) };
  for (const merged of [mergeSynced(shown, ran), mergeSynced(ran, shown)]) {
    assert.deepEqual(recordIds(merged).runs, ['r1', 'r4']);
    assert.deepEqual([...merged.seenTextIds].sort(), ['shown', 't-r1', 't-r4']);
  }
});

test('a copy this build saved, then an older build cleared and saved, is that build’s clear', () => {
  const synced = thisBuild({ runs: [record('r1', 1), record('r2', 2)], bests: best('r2', 2, 60), updatedAt: minute(3) });
  // The older build kept the fields it doesn't know, mergeStamp included, and stamped its own save.
  const cleared = { ...synced, runs: [], bests: {}, seenTextIds: [], updatedAt: minute(5) };
  for (const merged of [mergeSynced(synced, cleared), mergeSynced(cleared, synced)]) {
    assert.deepEqual(merged.runs, []);
    assert.deepEqual(merged.bests, {});
  }
});

test('copies older builds saved with no clear between them keep at least what last-writer-wins kept', () => {
  // Each device ran once without the other hearing of it. Whole-copy sync kept only the later save's run.
  const row = olderBuild({ runs: [record('r1', 1), record('r2', 2), record('phone', 4)], updatedAt: minute(5) });
  const device = olderBuild({ runs: [record('r1', 1), record('r2', 2), record('laptop', 3)], updatedAt: minute(3) });
  for (const [a, b] of [[row, device], [device, row], [row, { ...device, updatedAt: minute(6) }], [{ ...device, updatedAt: minute(6) }, row]]) {
    assert.deepEqual(recordIds(mergeSynced(a, b)).runs, ['r1', 'r2', 'laptop', 'phone']);
  }
  // This build only removes history with a clear marker: its newer copy lacking a run is no clear.
  const lacking = thisBuild({ runs: [record('r2', 2), record('later', 7)], updatedAt: minute(7) });
  for (const merged of [mergeSynced(device, lacking), mergeSynced(lacking, device)]) {
    assert.deepEqual(recordIds(merged).runs, ['r1', 'r2', 'laptop', 'later']);
  }
  // A phone ran offline before the laptop's first run reached the account, and saved last. The account
  // row (the laptop's) starts later than the phone's runs, but the phone's later save outranks it, as it
  // did under whole-copy sync, which kept the phone's runs and dropped the laptop's.
  const laptop = mergeSynced(olderBuild({ runs: [record('l1', 12)], updatedAt: minute(20) }),
    olderBuild({ runs: [record('l1', 12), record('l2', 26)], updatedAt: minute(26) }));
  const phone = olderBuild({ runs: [record('p1', 2), record('p2', 5), record('p3', 30)], updatedAt: minute(30) });
  for (const merged of [mergeSynced(laptop, phone), mergeSynced(phone, laptop)]) {
    assert.deepEqual(recordIds(merged).runs, ['p1', 'p2', 'l1', 'l2', 'p3']);
  }
});

test('a clear made on this build holds against a later save from an older build that never heard of it', () => {
  const marker = `${minute(5)}~abcdefgh`;
  const cleared = thisBuild({ historyClearedAt: marker, runs: [record('r6', 6)], updatedAt: minute(6) });
  const stale = olderBuild({ runs: [record('r1', 1), record('r2', 2), record('r7', 7)], updatedAt: minute(7) });
  for (const merged of [mergeSynced(cleared, stale), mergeSynced(stale, cleared)]) {
    assert.deepEqual(recordIds(merged).runs, ['r6', 'r7']);
    assert.equal(merged.historyClearedAt, marker);
  }
});

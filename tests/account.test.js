import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeFor, cleanRedirectUrl, freshSession, MAX_SUGGESTION, mergeProfiles, parseAuthRedirect, profileKey, suggestionRow } from '../src/account.js';
import { MAX_RUN_SUMMARIES, minutesByDay, retainHistory } from '../src/insights.js';

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

// Archived practice days hold the time of runs retention dropped, so they can't be matched by run id.
const practiced = (id, back, minutes) => ({ id, at: new Date(2026, 9, 8 - back, 12).toISOString(), kind: 'test',
  status: 'complete', interrupted: false, elapsedMs: minutes * 60000 });
const stored = (runs) => ({ preferences: {}, attempts: [], loops: [], seenTextIds: [], bests: {}, ...retainHistory(runs) });

test('an empty account takes the pre-accounts archive of practice days as it is', () => {
  // Twenty more runs than the summary window: the oldest twenty, on one day, are archived by normalization.
  const history = Array.from({ length: MAX_RUN_SUMMARIES + 20 }, (_, i) => practiced(`r${i}`, i < 20 ? 40 : 1 + (i % 9), 0.5));
  const legacy = stored(history);
  assert.equal(Object.keys(legacy.practiceDays).length, 1);
  const adopted = mergeProfiles({ ...stored([]), practiceDays: {} }, legacy);
  assert.deepEqual(adopted.practiceDays, legacy.practiceDays);
  assert.deepEqual(minutesByDay(adopted.runs, adopted.practiceDays), minutesByDay(history));
});

test('two archives of one history merge by the larger day total, never the sum, and count no run twice', () => {
  // The same person's history on two copies: one has seen 30 more runs and archived 30 more of the oldest,
  // runs the other copy still keeps as summaries.
  const history = Array.from({ length: MAX_RUN_SUMMARIES + 40 }, (_, i) => practiced(`r${i}`, Math.floor((MAX_RUN_SUMMARIES + 39 - i) / 25), 0.5));
  const longer = stored(history);
  const shorter = stored(history.slice(0, MAX_RUN_SUMMARIES + 10));
  const truth = minutesByDay(history);
  for (const [base, extra] of [[longer, shorter], [shorter, longer]]) {
    const merged = mergeProfiles(base, extra);
    assert.deepEqual(minutesByDay(merged.runs, merged.practiceDays), truth);
    const kept = retainHistory(merged.runs, merged.practiceDays);
    assert.deepEqual(minutesByDay(kept.runs, kept.practiceDays), truth, 'retention after the merge moves time, never adds it');
  }

  // Different runs archived on the same day can't be told apart from the same runs twice, so the larger
  // total stands for the day rather than the sum; a day only one side archived comes across whole.
  const a = { ...stored([]), practiceDays: { '2025-03-01': 10 * 60000, '2025-03-02': 60000 } };
  const b = { ...stored([]), practiceDays: { '2025-03-01': 4 * 60000, '2025-03-05': 2 * 60000 } };
  assert.deepEqual(mergeProfiles(a, b).practiceDays, { '2025-03-01': 10 * 60000, '2025-03-02': 60000, '2025-03-05': 2 * 60000 });
  assert.deepEqual(mergeProfiles(b, a).practiceDays, mergeProfiles(a, b).practiceDays);
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

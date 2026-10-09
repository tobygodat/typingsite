import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeOutcome, challengePayload, challengeText, encodeTrace, ghostPoints, offerText, resultText,
  scoreTrace, sendChallenge, traceAttempt, traceBytes, validTrace, MAX_TRACE_KEYS } from '../src/ghost-race.js';
import { comparable, conditionKey, createAttempt, replayAttempt, summarizePatterns } from '../src/typing.js';
import { runRecord, trendRun } from '../src/insights.js';

const passage = 'The quick brown fox jumps over the lazy dog.';

// Builds a finished attempt the way the app records one: inserts at the typed length, deletes of one.
function run(keys, { text = passage, step = 150, end = null, kind = 'test', conditions = { mode: 'words', count: 9, correctionPolicy: 'mandatory' } } = {}) {
  const attempt = createAttempt({ id: 'a', text, textId: 'quote-fox', kind, conditions });
  let typed = 0;
  [...keys].forEach((key, index) => {
    const offsetMs = index * step + 0.4;
    if (key === '\b') { attempt.events.push({ type: 'delete', count: 1, offsetMs }); typed -= 1; }
    else { attempt.events.push({ type: 'insert', text: key, position: typed, accepted: true, offsetMs }); typed += 1; }
  });
  attempt.startedAt = 0;
  attempt.endedAt = end ?? (keys.length - 1) * step + 0.4;
  attempt.status = 'complete';
  return attempt;
}

test('the sample run scores the same numbers the database test pins (78 wpm, 98%)', () => {
  const keys = 'The quick bx\brown fox jumps over the lazy dog.';
  const trace = { v: 1, k: keys, t: [...keys].map((_, i) => (i ? 150 : 0)), e: 6750 };
  assert.deepEqual(scoreTrace(trace, passage), { wpm: 78, accuracy: 98, elapsedMs: 6750, correct: 44, finished: true });
  const reply = { v: 1, k: passage, t: [...passage].map((_, i) => (i ? 120 : 0)), e: 5160 };
  assert.equal(scoreTrace(reply, passage).wpm, 102);
});

test('a recorded run encodes to whole milliseconds and replays to the same text, errors and score', () => {
  const attempt = run('The quick bx\brown fox jumps over the lazy dog.');
  attempt.events.splice(5, 0, { type: 'blocked-insert', text: 'z', position: 4, offsetMs: 700 });
  const trace = encodeTrace(attempt);
  assert.equal(trace.k, 'The quick bx\brown fox jumps over the lazy dog.');
  assert.equal(trace.t.length, trace.k.length);
  assert.equal(trace.t[0], 0);
  assert.ok(validTrace(trace));
  const original = replayAttempt(attempt);
  const decoded = replayAttempt(traceAttempt(trace, passage));
  assert.equal(decoded.typed, original.typed);
  assert.equal(decoded.insertions, original.insertions);
  assert.equal(decoded.mistakes, original.mistakes);
  assert.deepEqual(decoded.score, original.score);
  assert.deepEqual(decoded.firstAttempts.map((f) => [f.position, f.correct]), original.firstAttempts.map((f) => [f.position, f.correct]));
});

test('interrupted, IME and oversized runs are not encoded', () => {
  const lost = run('The quick');
  lost.events.push({ type: 'focus-lost', offsetMs: 2000 });
  assert.equal(encodeTrace(lost), null);
  const ime = run('The quick');
  ime.unsupportedInput = true;
  assert.equal(encodeTrace(ime), null);
  const long = run('a'.repeat(MAX_TRACE_KEYS + 1), { text: 'a'.repeat(MAX_TRACE_KEYS + 1), step: 10 });
  assert.equal(encodeTrace(long), null);
  const trace = encodeTrace(run(passage));
  assert.ok(traceBytes(trace) > JSON.stringify(trace).length);
  assert.equal(validTrace({ ...trace, t: trace.t.slice(1) }), false);
  assert.equal(validTrace({ ...trace, k: 'tab\there'.padEnd(trace.k.length, 'x') }), false);
});

test('the ghost follows the typed length, back on a deletion and never past the passage', () => {
  const trace = { v: 1, k: 'abx\bcde', t: [0, 100, 100, 100, 100, 100, 100], e: 600 };
  assert.deepEqual(ghostPoints(trace, 4), [[0, 1], [100, 2], [200, 3], [300, 2], [400, 3], [500, 4], [600, 4]]);
});

test('word, quote and daily runs send their whole passage; a timed run is cut at a word past its furthest key', () => {
  const words = run(passage);
  assert.equal(challengeText(words), passage);
  const long = Array.from({ length: 1600 }, (_, i) => ['alpha', 'beta', 'gamma'][i % 3]).join(' ');
  const timed = run(long.slice(0, 120), { text: long, step: 200, end: 30000, conditions: { mode: 'time', duration: 30, correctionPolicy: 'relaxed' } });
  const text = challengeText(timed);
  assert.ok(text.length >= 1000 && text.length < 1012, `cut at ${text.length}`);
  assert.ok(long.startsWith(text));
  assert.equal(long[text.length], ' ');
  const payload = challengePayload(timed);
  assert.equal(payload.duration, 30);
  assert.equal(payload.trace.e, 30000);
  assert.deepEqual(payload.score, scoreTrace(payload.trace, text, { relaxed: true }));
  assert.equal(payload.conditions.textId, 'quote-fox');
});

test('only finished practice, retest and daily runs can be sent', () => {
  assert.ok(challengePayload(run(passage)));
  assert.equal(challengePayload(run(passage, { kind: 'drill' })), null);
  assert.equal(challengePayload(run(passage, { kind: 'challenge' })), null);
  assert.equal(challengePayload({ ...run(passage), status: 'interrupted' }), null);
  // Stop on error finishes only on the exact text; continue on error finishes at its length.
  const slip = passage.slice(0, -1) + '!';
  assert.equal(challengePayload(run(slip)), null);
  assert.ok(challengePayload(run(slip, { conditions: { mode: 'words', count: 9, correctionPolicy: 'relaxed' } })));
});

test('a passage race is led by the earlier finish, a timed race by the text kept, and both are worded once', () => {
  const sent = { role: 'sent', name: 'Lin', duration: null, conditions: { mode: 'words', count: 25 },
    sender: { wpm: 72, elapsedMs: 44000, correct: 130 }, result: { wpm: 65, elapsedMs: 41200, correct: 125 } };
  assert.equal(challengeOutcome(sent), 'recipient');
  assert.equal(resultText(sent), 'Lin raced your 25-word run: Lin finished first · you 72 wpm, Lin 65 wpm.');
  const received = { ...sent, role: 'received', name: 'Ada' };
  assert.equal(resultText(received), 'Ada’s 25-word run: you finished first · you 65 wpm, Ada 72 wpm.');
  assert.equal(offerText(received), 'Ada challenged you to beat their 25-word run.');
  const timed = { ...received, duration: 30, conditions: { mode: 'time', duration: 30 } };
  assert.equal(challengeOutcome(timed), 'sender');
  assert.equal(resultText(timed), 'Ada’s 30-second run: Ada typed further · you 65 wpm, Ada 72 wpm.');
  const tie = { ...received, result: { ...received.result, elapsedMs: 44000 } };
  assert.match(resultText(tie), /: a tie ·/);
  assert.equal(offerText({ ...received, conditions: { mode: 'quote', sourceKind: 'daily' } }), 'Ada challenged you to beat their daily run.');
  assert.equal(challengeOutcome({ ...sent, result: null }), null);
});

test('challenge runs are their own kind: no patterns, no trend, and the default condition key is unchanged', () => {
  const attempt = run(passage, { kind: 'challenge' });
  assert.equal(summarizePatterns([attempt]).attemptCount, 0);
  assert.equal(summarizePatterns([run(passage)]).attemptCount, 1);
  assert.equal(trendRun(runRecord(attempt)), false);
  const baseline = { ...run(passage), textId: 'other-text' };
  assert.equal(comparable(baseline, run(passage)), true);
  assert.equal(comparable(baseline, attempt), false);
  assert.equal(comparable({ ...attempt, textId: 'other-text' }, run(passage)), false);
  assert.equal(conditionKey({ mode: 'time', duration: 30, punctuation: false, wordList: '200', correctionPolicy: 'relaxed' }),
    'time:30::plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1');
});

test('sending posts only the friend, the name and the run', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, headers: options.headers, data: JSON.parse(options.body) });
    return new Response(JSON.stringify({ id: 'c1', status: 'open' }));
  };
  try {
    const session = { user: { id: 'ada' }, access_token: 'token', refresh_token: 'r', expires_at: 9999999999 };
    const payload = challengePayload(run(passage));
    await sendChallenge(session, { friendId: 'f1', displayName: ' Ada ', payload });
    assert.match(calls[0].url, /\/rest\/v1\/rpc\/challenge_action$/);
    assert.equal(calls[0].headers.Authorization, 'Bearer token');
    assert.deepEqual(Object.keys(calls[0].data.p_data).sort(), ['conditions', 'displayName', 'duration', 'friendId', 'passage', 'trace']);
    assert.equal(calls[0].data.p_action, 'send');
    assert.equal(calls[0].data.p_data.displayName, 'Ada');
  } finally { globalThis.fetch = original; }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeConditions, challengeOutcome, challengePayload, isChallengePayloadSource, challengeText, challengeTextId, encodeTrace, ghostPoints, offerText, outcomeRule,
  resultText, sameScore, scoreTrace, sendChallenge, traceAttempt, traceBytes, traceTrouble, validTrace, MAX_TRACE_KEYS, SENDABLE_KINDS } from '../src/ghost-race.js';
import { comparable, conditionKey, createAttempt, quoteCorpus, replayAttempt, summarizePatterns, textId, CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';
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

test('half-way scores round as the browser does, the same numbers the database test pins', () => {
  const even = (keys, step, e) => ({ v: 1, k: keys, t: [...keys].map((_, i) => (i ? step : 0)), e });
  assert.equal(scoreTrace(even('a'.repeat(101), 200, 24000), 'a'.repeat(101)).wpm, 50);
  assert.equal(scoreTrace(even('a'.repeat(105), 190, 20160), 'a'.repeat(105)).wpm, 62);
  const slips = scoreTrace(even('a'.repeat(23) + 'b'.repeat(17), 100, 4000), 'a'.repeat(40), { relaxed: true });
  assert.equal(slips.accuracy, 57);
  assert.equal(slips.wpm, 69);
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

test('a slip onto a key the passage can\u2019t contain is sent as a stand-in that replays to the same score', () => {
  const text = 'hello world again';

  for (const slip of ['ö', '\u00a0', 'é']) {
    const attempt = run(`he${slip}\bllo world again`, { text });
    const trace = encodeTrace(attempt);
    assert.ok(trace && validTrace(trace), slip);
    assert.equal(trace.k, 'he~\bllo world again');
    const original = replayAttempt(attempt);
    const decoded = replayAttempt(traceAttempt(trace, text));
    assert.equal(decoded.typed, original.typed);
    assert.deepEqual(decoded.score, original.score);
    assert.equal(scoreTrace(trace, text).finished, true);
  }

  // Left in under continue on error, it still never matches, even where the passage has a tilde.
  const tilde = 'a~b c d e f';
  const kept = encodeTrace(run('aöb c d e f', { text: tilde, conditions: { mode: 'words', count: 5, correctionPolicy: 'relaxed' } }));
  assert.equal(kept.k, 'a^b c d e f');
  assert.equal(scoreTrace(kept, tilde, { relaxed: true }).correct, 10);
  // An emoji fills two places in the replay, so that run is not encoded, and says why.
  const emoji = run('he\u{1F600}\bllo world again', { text });
  assert.equal(encodeTrace(emoji), null);
  assert.equal(traceTrouble(emoji), 'character');
  assert.equal(traceTrouble(run(text, { text })), 'length');
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
  // Custom text is never compared, so it is never a ghost to race, even if the sendable list grew to name it.
  const custom = run(passage, { kind: 'custom', conditions: { mode: 'custom', duration: null, count: null, correctionPolicy: 'mandatory', customOrder: 'as-written' } });
  assert.equal(challengePayload(custom), null);
  SENDABLE_KINDS.push('custom');

  try { assert.equal(challengePayload(custom), null); } finally { SENDABLE_KINDS.pop(); }

  // Stop on error finishes only on the exact text; continue on error finishes at its length.
  const slip = passage.slice(0, -1) + '!';
  assert.equal(challengePayload(run(slip)), null);
  assert.ok(challengePayload(run(slip, { conditions: { mode: 'words', count: 9, correctionPolicy: 'relaxed' } })));
});

// What conditions() in src/app.js gives a 10-word practice run.
const browserConditions = { mode: 'words', duration: null, count: 10, punctuation: false, numbers: false, quoteLength: null, difficulty: null,
  wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'mandatory', language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };

test('a challenge carries only conditions this app can set up again, and a received one is checked, not trusted', () => {
  // What the browser sends is accepted as it is, for word, timed, quote and daily runs.
  const words = challengePayload(run(passage, { conditions: browserConditions }));
  assert.deepEqual(words.conditions, { ...browserConditions, textId: 'quote-fox', sourceKind: 'test' });
  assert.deepEqual(challengeConditions(words.conditions, words.duration), words.conditions);
  const timed = { ...browserConditions, mode: 'time', duration: 30, count: null, inputClass: 'touch', correctionPolicy: 'relaxed', textId: 'generated-abc', sourceKind: 'retest' };
  assert.deepEqual(challengeConditions(timed, 30), timed);
  const quote = { ...browserConditions, mode: 'quote', count: null, quoteLength: 'medium', difficulty: 'any', wordList: null, textId: 'medium-gentle-01', sourceKind: 'test' };
  assert.deepEqual(challengeConditions(quote, null), quote);
  const daily = { ...quote, punctuation: true, correctionPolicy: 'relaxed', textId: 'daily-generated-9q8w7e', sourceKind: 'daily' };
  assert.deepEqual(challengeConditions(daily, null), daily);
  // No key is required: a row with fewer keys is raced with what it says.
  assert.deepEqual(challengeConditions({}, null), {});

  // A wrong type, a key this app doesn't know or a value it never sends is refused, never thrown on.
  for (const bad of [{ corpus: {} }, { mode: 'words', wordList: 200 }, { mode: 'words', colour: 'red' }, { mode: 'words', count: '10' },
    { mode: 'words', count: 2.5 }, { mode: 'words', punctuation: 'yes' }, { mode: 'words', inputClass: 'voice' }, { mode: 'sprint' },
    { mode: 'words', metricVersion: 'stilltype-metrics-v2' }, { mode: 'words', sourceKind: 'drill' }, { mode: 'words', corpus: '1k · you lost' },
    { mode: 'words', textId: 5 }, JSON.parse('{"__proto__": {"mode": "words"}}'), null, [], 'words']) {
    assert.equal(challengeConditions(bad, null), null, JSON.stringify(bad));
  }

  // A timed run says so, on the challenge's own clock; any other run has none.
  assert.equal(challengeConditions({ mode: 'time', duration: 30 }, null), null);
  assert.equal(challengeConditions({ mode: 'time', duration: 30 }, 15), null);
  assert.equal(challengeConditions({ mode: 'time' }, 30), null);
  assert.equal(challengeConditions({ mode: 'words' }, 30), null);
  assert.equal(challengeConditions({ mode: 'time', duration: 45 }, 45), null);
  // A run whose own conditions the service would refuse is never offered.
  assert.equal(challengePayload(run(passage, { conditions: { ...browserConditions, punctuation: null } })), null);

  // The inbox claims no shape for conditions it can't read.
  const received = { role: 'received', name: 'Ada', duration: null, conditions: { corpus: {} },
    sender: { wpm: 72, elapsedMs: 44000, correct: 130 }, result: { wpm: 65, elapsedMs: 41200, correct: 125 } };

  assert.equal(offerText(received), 'Ada challenged you to beat their run.');
  assert.equal(resultText(received), 'Ada’s run: you finished first · you 65 wpm, Ada 72 wpm.');
});

test('a passage race is led by the earlier finish, a timed race by the text kept, and both are worded once', () => {
  const sent = { role: 'sent', name: 'Lin', duration: null, conditions: { mode: 'words', count: 25 },
    sender: { wpm: 72, elapsedMs: 44000, correct: 130 }, result: { wpm: 65, elapsedMs: 41200, correct: 125 } };

  assert.equal(challengeOutcome(sent), 'recipient');
  assert.equal(resultText(sent), 'Lin raced your 25-word run: Lin finished first · you 72 wpm, Lin 65 wpm.');
  const received = { ...sent, role: 'received', name: 'Ada' };
  assert.equal(resultText(received), 'Ada’s 25-word run: you finished first · you 65 wpm, Ada 72 wpm.');
  assert.equal(offerText(received), 'Ada challenged you to beat their 25-word run.');

  const timed = { ...received, duration: 30, conditions: { mode: 'time', duration: 30 },
    sender: { ...received.sender, elapsedMs: 30000 }, result: { ...received.result, elapsedMs: 30000 } };

  assert.equal(challengeOutcome(timed), 'sender');
  assert.equal(resultText(timed), 'Ada’s 30-second run: Ada typed further · you 65 wpm, Ada 72 wpm.');
  assert.equal(outcomeRule(timed), 'Same 30 s clock: more correct text kept leads.');
  const tie = { ...received, result: { ...received.result, correct: 130, elapsedMs: 44000 } };
  assert.match(resultText(tie), /: a tie ·/);
  assert.equal(outcomeRule({ ...received, conditions: { mode: 'words', correctionPolicy: 'mandatory' } }), 'The earlier finish leads.');
  assert.equal(offerText({ ...received, conditions: { mode: 'quote', sourceKind: 'daily' } }), 'Ada challenged you to beat their daily run.');
  assert.equal(challengeOutcome({ ...sent, result: null }), null);
});

test('under continue on error, a quick finish full of mistakes doesn\u2019t beat a clean run', () => {
  const daily = { role: 'received', name: 'Ada', duration: null, conditions: { mode: 'quote', sourceKind: 'daily', correctionPolicy: 'relaxed' },
    sender: { wpm: 88, accuracy: 100, elapsedMs: 6300, correct: 46 }, result: { wpm: 0, accuracy: 0, elapsedMs: 2859, correct: 0 } };

  assert.equal(challengeOutcome(daily), 'sender');
  assert.equal(resultText(daily), 'Ada’s daily run: Ada typed faster · you 0 wpm, Ada 88 wpm.');
  assert.equal(outcomeRule(daily), 'More correct characters per minute leads.');
  // A clean run that also ends sooner finished first; a run with no time at all never leads.
  const clean = { ...daily, result: { wpm: 95, accuracy: 100, elapsedMs: 5800, correct: 46 } };
  assert.equal(resultText(clean), 'Ada’s daily run: you finished first · you 95 wpm, Ada 88 wpm.');
  assert.equal(challengeOutcome({ ...daily, result: { wpm: 0, accuracy: 100, elapsedMs: 0, correct: 46 } }), 'sender');
});

test('a ghost race files its passage under an id worked out from the text, never the sender\u2019s', () => {
  const quote = quoteCorpus.find((item) => /^[ -~]+$/.test(item.text));
  assert.equal(challengeTextId(quote.text, { textId: 'generated-forged', sourceKind: 'test' }), quote.id);
  assert.equal(challengeTextId('river light patient words', { textId: quote.id }), textId('river light patient words'));
  assert.equal(challengeTextId('river light patient words', { sourceKind: 'daily' }), `daily-${textId('river light patient words')}`);
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
    'time:30::plain:::200:physical-keyboard:relaxed:original-en-v6:stilltype-metrics-v1');
});

test('sending posts only the request id, the friend, the name and the run', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, headers: options.headers, data: JSON.parse(options.body) });

    return new Response(JSON.stringify({ id: 'c1', status: 'open' }));
  };

  try {
    const session = { user: { id: 'ada' }, access_token: 'token', refresh_token: 'r', expires_at: 9999999999 };
    const payload = challengePayload(run(passage));
    const requestId = '6f1c2a3e-8a7b-4c3d-9e2f-0a1b2c3d4e5f';
    await sendChallenge(session, { friendId: 'f1', displayName: ' Ada ', payload, requestId });
    assert.match(calls[0].url, /\/rest\/v1\/rpc\/challenge_action$/);
    assert.equal(calls[0].headers.Authorization, 'Bearer token');
    assert.deepEqual(Object.keys(calls[0].data.p_data).sort(), ['conditions', 'displayName', 'duration', 'friendId', 'passage', 'requestId', 'trace']);
    assert.equal(calls[0].data.p_data.requestId, requestId);
    assert.equal(calls[0].data.p_action, 'send');
    assert.equal(calls[0].data.p_data.displayName, 'Ada');
  } finally { globalThis.fetch = original; }
});

test('a stored result is told apart from this run by its numbers', () => {
  const score = { wpm: 72, accuracy: 98, elapsedMs: 6750, correct: 44 };
  assert.equal(sameScore(score, { ...score }), true);
  assert.equal(sameScore(score, { ...score, elapsedMs: 6760 }), false);
  assert.equal(sameScore(score, null), false);
});


test('retained traces ignore future events without requiring current Attempt state', () => {
  const completed = run('alpha beta', { text: 'alpha beta', end: 30000,
    conditions: { mode: 'time', duration: 30, wordList: '200', correctionPolicy: 'mandatory', inputClass: 'physical-keyboard' } });

  const expected = challengePayload(completed);
  assert.ok(expected);

  const retained = { status: completed.status, kind: completed.kind, text: completed.text, textId: completed.textId,
    conditions: completed.conditions, startedAt: completed.startedAt, endedAt: completed.endedAt,
    events: [{ type: 'future-note', future: true, offsetMs: { unused: true } }, ...completed.events] };

  const original = JSON.stringify(retained);
  assert.equal(isChallengePayloadSource(retained), true);
  assert.deepEqual(challengePayload(retained), expected);
  assert.equal(JSON.stringify(retained), original);
});


test('a retained source with no keys returns before malformed text is consumed', () => {
  const retained = { status: 'complete', kind: 'test', conditions: { mode: 'time', duration: 30, wordList: '200' }, text: 123, events: [] };
  assert.equal(isChallengePayloadSource(retained), true);
  assert.equal(challengePayload(retained), null);
});


test('retained condition copies keep every own JSON key for whitelist validation', () => {
  const completed = run('alpha beta', { text: 'alpha beta', end: 30000,
    conditions: { mode: 'time', duration: 30, wordList: '200', correctionPolicy: 'mandatory', inputClass: 'physical-keyboard' } });

  const conditions = { ...completed.conditions, ...JSON.parse('{"__proto__":{"future":true}}') };
  const original = JSON.stringify(conditions);
  assert.equal(challengePayload({ ...completed, conditions }), null);
  assert.equal(JSON.stringify(conditions), original);
});

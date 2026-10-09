import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareAttempts,
  completeAttempt,
  conditionKey,
  createAttempt,
  editStats,
  makeDrill,
  makePassage,
  metrics,
  accuracyGraceCharacters,
  MINIMUM_GRACE_CHARACTERS,
  MINIMUM_GRACE_MS,
  minimumMissed,
  passageComplete,
  recommendTarget,
  replayAttempt,
} from '../src/typing.js';
test('speed counts correct characters at five characters per word', () => {
  assert.deepEqual(metrics('hello world', 'hello worxd', 11, 1, 30000), {wpm:4, accuracy:91});
});
test('correcting a mistake does not erase historical errors', () => {
  assert.deepEqual(editStats('he', 'hex', 'hello'), {attempts:1, mistakes:1});
  assert.deepEqual(editStats('hex', 'he', 'hello'), {attempts:0, mistakes:0});
  assert.deepEqual(editStats('he', 'hel', 'hello'), {attempts:1, mistakes:0});
  assert.deepEqual(metrics('hello', 'hello', 6, 1, 6000), {wpm:10, accuracy:83});
});
test('empty run has a finite score', () => assert.deepEqual(metrics('', '', 0, 0, 0), {wpm:0, accuracy:100}));
test('word sessions contain requested number of words and punctuation is optional', () => {
  assert.equal(makePassage('words', 25, false).split(' ').length, 25);
  assert.match(makePassage('words', 10, true, () => 0), /^The the the the the, the the the the\. The$/);
});

test('event replay retains a corrected first-attempt error and insertion accuracy', () => {
  const attempt = createAttempt({ id: 'a', text: 'the', textId: 'one', conditions: {} });
  attempt.events = [
    { type: 'insert', text: 't', offsetMs: 0 },
    { type: 'insert', text: 'x', offsetMs: 100 },
    { type: 'delete', count: 1, offsetMs: 200 },
    { type: 'insert', text: 'h', offsetMs: 300 },
    { type: 'insert', text: 'e', offsetMs: 400 },
  ];
  attempt.startedAt = 0;
  attempt.endedAt = 6000;
  const replay = replayAttempt(attempt);
  assert.equal(replay.typed, 'the');
  assert.equal(replay.firstAttempts.find((entry) => entry.position === 1).correct, false);
  assert.deepEqual(replay.score, { wpm: 6, accuracy: 75 });
  assert.deepEqual(replay.pairTimings.map((entry) => entry.pair), []);
});

test('relaxed correction completes with retained errors and a distinct comparison key', () => {
  const relaxed = createAttempt({ id: 'relaxed', text: 'the', textId: 'one', conditions: { correctionPolicy: 'relaxed' } });
  relaxed.events = [
    { type: 'insert', text: 't', offsetMs: 0 },
    { type: 'insert', text: 'x', offsetMs: 100 },
    { type: 'insert', text: 'e', offsetMs: 200 },
  ];
  relaxed.startedAt = 0;
  relaxed.endedAt = 1000;
  const replay = replayAttempt(relaxed);
  assert.equal(replay.typed, 'txe');
  assert.equal(replay.firstAttempts.find((entry) => entry.position === 1).correct, false);
  assert.deepEqual(replay.score, { wpm: 24, accuracy: 67 });
  assert.equal(passageComplete(relaxed, replay.typed), true);
  assert.equal(passageComplete({ ...relaxed, conditions: { correctionPolicy: 'mandatory' } }, replay.typed), false);
  assert.notEqual(conditionKey(relaxed.conditions), conditionKey({ correctionPolicy: 'mandatory' }));
});

test('recommendations stay general below the evidence threshold', () => {
  const attempt = createAttempt({ id: 'a', text: 'the', textId: 'one', conditions: {} });
  attempt.events = [
    { type: 'insert', text: 't', offsetMs: 0 },
    { type: 'insert', text: 'x', offsetMs: 100 },
  ];
  attempt.startedAt = 0;
  attempt.endedAt = 1000;
  const complete = completeAttempt(attempt, { endedAt: 1000 });
  assert.equal(recommendTarget([complete]).kind, 'general');
});

test('fresh comparable attempts report mixed movement honestly', () => {
  const before = { status: 'complete', kind: 'test', textId: 'one', metricVersion: 'stilltype-metrics-v1', interrupted: false, conditions: { mode: 'time', duration: 30 }, summary: { score: { wpm: 50, accuracy: 98 } } };
  const after = { status: 'complete', kind: 'retest', textId: 'two', metricVersion: 'stilltype-metrics-v1', interrupted: false, fresh: true, conditions: { mode: 'time', duration: 30 }, summary: { score: { wpm: 55, accuracy: 96 } } };
  assert.equal(compareAttempts(before, after).state, 'mixed');
});

test('target drills use real corpus words and repeat the requested pair', () => {
  const drill = makeDrill('br');
  assert.ok((drill.text.match(/br/g) || []).length >= 10);
  assert.equal(drill.text.split(' ').every((word) => word.includes('br')), true);
});

test('generated passages draw from the selected common-word list', async () => {
  const { DEFAULT_WORD_LIST, wordList, wordListIds } = await import('../src/words.js');
  assert.deepEqual(wordListIds, ['200', '1k', '5k', '10k']);
  assert.equal(DEFAULT_WORD_LIST, '200');
  assert.equal(wordList('200').length, 200);
  assert.deepEqual(wordList('200').slice(0, 6), ['the', 'be', 'of', 'and', 'a', 'to']);
  assert.equal(wordList('1k').length, 1000);
  assert.ok(wordList('5k').length > 4500 && wordList('10k').length > 9000);
  assert.equal(wordList('unknown'), wordList('200'));
  for (const id of wordListIds) {
    const words = new Set(wordList(id));
    assert.equal(words.size, wordList(id).length);
    assert.ok(wordList(id).every((word) => /^[a-z]+$/.test(word)), `${id} has only lowercase letters`);
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const passage = makePassage('time', 0, false, random, id).split(' ');
    assert.ok(passage.every((word) => words.has(word)));
  }
  const bank = wordList(DEFAULT_WORD_LIST);
  assert.match(makePassage('words', 10, true, () => (bank.indexOf('i') + 0.5) / bank.length), /\bI\b/);
  assert.notEqual(conditionKey({ mode: 'time', wordList: '1k' }), conditionKey({ mode: 'time', wordList: '5k' }));
});

test('minimums wait out a five-second, twenty-character grace and judge the shown numbers', () => {
  assert.equal(MINIMUM_GRACE_MS, 5000);
  assert.equal(MINIMUM_GRACE_CHARACTERS, 20);
  const slow = { wpm: 10, accuracy: 100 };
  assert.equal(minimumMissed({ wpm: 40 }, slow, { elapsedMs: 4999, insertions: 200 }), null);
  assert.equal(minimumMissed({ wpm: 40 }, slow, { elapsedMs: 60000, insertions: 19 }), null);
  assert.equal(minimumMissed({ wpm: 40 }, slow, { elapsedMs: 5000, insertions: 20 }).metric, 'wpm');
  // Without a running replay (the end of the run) there is no grace.
  assert.equal(minimumMissed({ wpm: 40 }, slow).metric, 'wpm');

  assert.equal(minimumMissed(null, { wpm: 10, accuracy: 50 }), null);
  assert.equal(minimumMissed({ accuracy: 95 }, { wpm: 10, accuracy: 95 }), null, 'at the minimum is not below it');
  assert.deepEqual(minimumMissed({ accuracy: 95 }, { wpm: 80, accuracy: 94 }), { metric: 'accuracy', minimum: 95, value: 94 });
  assert.deepEqual(minimumMissed({ wpm: 40 }, { wpm: 39, accuracy: 100 }), { metric: 'wpm', minimum: 40, value: 39 });
  assert.equal(minimumMissed({ accuracy: 90, wpm: 40 }, { wpm: 40, accuracy: 90 }), null);
  assert.equal(minimumMissed({ accuracy: 90, wpm: 40 }, { wpm: 30, accuracy: 80 }).metric, 'accuracy', 'accuracy is reported first when both miss');
});

test('the opening can\'t fail an accuracy minimum: two misses alone never cross it after the grace', () => {
  assert.deepEqual([80, 90, 95, 98].map(accuracyGraceCharacters), [20, 20, 40, 100]);
  for (const minimum of [80, 90, 95, 98]) {
    const characters = accuracyGraceCharacters(minimum);
    const twoMisses = metrics('x'.repeat(characters), 'x'.repeat(characters), characters, 2, 60000);
    assert.ok(twoMisses.accuracy >= minimum, `${minimum}%: ${twoMisses.accuracy}% after ${characters} characters`);
  }
  // One opening typo, then perfect typing at 60 wpm: 25 characters by five seconds reads 96%.
  const typo = { wpm: 60, accuracy: 96 };
  assert.equal(minimumMissed({ accuracy: 98 }, typo, { elapsedMs: 5000, insertions: 25 }), null);
  assert.equal(minimumMissed({ accuracy: 95 }, { wpm: 60, accuracy: 92 }, { elapsedMs: 5000, insertions: 25 }), null);
  // Past the grace, a run that really is under the minimum is judged.
  assert.equal(minimumMissed({ accuracy: 98 }, { wpm: 60, accuracy: 97 }, { elapsedMs: 20000, insertions: 100 }).metric, 'accuracy');
  // A speed minimum keeps the short grace even when an accuracy minimum waits longer.
  assert.equal(minimumMissed({ accuracy: 98, wpm: 80 }, typo, { elapsedMs: 5000, insertions: 25 }).metric, 'wpm');
});

test('minimums never enter the conditions key, so bests and retests keep matching', () => {
  // conditions() in app.js for the default 30 s practice test; the key is byte-identical to before minimums.
  const practice = { mode: 'time', duration: 30, count: null, punctuation: false, quoteLength: null, difficulty: null, wordList: '200',
    inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en', corpus: 'original-en-v5', metricVersion: 'stilltype-metrics-v1' };
  const key = 'time:30::plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1';
  assert.equal(conditionKey(practice), key);
  assert.equal(conditionKey({ ...practice, minimums: { accuracy: 95, wpm: 40 } }), key);

  // A run with a minimum on replays to exactly the same score: minimums only decide when it ends.
  const attempt = createAttempt({ id: 'm', text: 'the', textId: 'one', conditions: practice });
  attempt.events = [{ type: 'insert', text: 't', offsetMs: 0 }, { type: 'insert', text: 'h', offsetMs: 100 }, { type: 'insert', text: 'e', offsetMs: 200 }];
  attempt.startedAt = 0;
  const plain = completeAttempt(attempt, { endedAt: 1000 });
  const withMinimum = completeAttempt({ ...attempt, minimums: { accuracy: 95 } }, { endedAt: 1000 });
  assert.deepEqual(withMinimum.summary.score, plain.summary.score);
});

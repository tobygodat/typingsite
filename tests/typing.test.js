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
  passageComplete,
  correctionPreference,
  CORRECTION_POLICIES,
  allowsBackspace,
  blocksOnError,
  failureFor,
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

test('correction policies map old preferences, fail on errors and keep separate keys', () => {
  assert.equal(correctionPreference({}), 'relaxed');
  assert.equal(correctionPreference({ stopOnError: true }), 'mandatory');
  assert.equal(correctionPreference({ stopOnError: false }), 'relaxed');
  assert.equal(correctionPreference({ correction: 'fail-any', stopOnError: true }), 'fail-any');
  assert.equal(correctionPreference({ correction: 'bogus', stopOnError: true }), 'mandatory');
  assert.equal(allowsBackspace('no-backspace'), false);
  assert.equal(allowsBackspace('relaxed'), true);
  assert.equal(blocksOnError('mandatory'), true);
  assert.equal(blocksOnError('fail-word'), false);
  assert.equal(failureFor('fail-any', 'the cat', 'th', 'x'), 'wrong key');
  assert.equal(failureFor('fail-any', 'the cat', 'th', 'e'), null);
  assert.equal(failureFor('fail-word', 'the cat', 'thx', 'x'), null);
  assert.equal(failureFor('fail-word', 'the cat', 'thx', ' '), 'word error');
  assert.equal(failureFor('fail-word', 'the cat', 'the', ' '), null);
  assert.equal(failureFor('fail-word', 'the cat', 'the cxt', ' '), 'word error');
  assert.equal(failureFor('relaxed', 'the cat', 'th', 'x'), null);
  const attempt = createAttempt({ id: 'nb', text: 'ab', textId: 'one', conditions: { correctionPolicy: 'no-backspace' } });
  assert.equal(passageComplete(attempt, 'ax'), true);
  const keys = new Set(CORRECTION_POLICIES.map((correctionPolicy) => conditionKey({ correctionPolicy })));
  assert.equal(keys.size, CORRECTION_POLICIES.length);
});

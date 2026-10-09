import test from 'node:test';
import assert from 'node:assert/strict';
import {
  awaitingSubmit,
  compareAttempts,
  completeAttempt,
  conditionKey,
  createAttempt,
  editStats,
  inputRules,
  makeDrill,
  makePassage,
  metrics,
  passageComplete,
  quickEndApplies,
  recommendTarget,
  refusesSpace,
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

// Strict space and quick end. Master's rules are the defaults: a space anywhere is typed into
// that position, and a continue-on-error run ends on its last letter, right or wrong.
const defaults = { mode: 'words', duration: null, count: 10, punctuation: false, quoteLength: null, difficulty: null,
  wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en' };

test('default strict space and quick end keep the condition key byte-identical', () => {
  const master = 'words::10:plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1';
  assert.equal(conditionKey(defaults), master);
  assert.equal(conditionKey({ ...defaults, strictSpace: false, quickEnd: true }), master);
  assert.equal(conditionKey({ mode: 'time', duration: 30, wordList: '200', correctionPolicy: 'relaxed', strictSpace: false, quickEnd: true }),
    'time:30::plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1');
  assert.equal(conditionKey({ ...defaults, strictSpace: true }), `${master}:strict-space`);
  assert.equal(conditionKey({ ...defaults, quickEnd: false }), `${master}:quick-end-off`);
  assert.equal(conditionKey({ ...defaults, strictSpace: true, quickEnd: false }), `${master}:strict-space:quick-end-off`);
  // Quick end can't change a timed run or a stop-on-error run, so it doesn't split their bests.
  assert.equal(conditionKey({ ...defaults, mode: 'time', duration: 30, count: null, quickEnd: false }),
    conditionKey({ ...defaults, mode: 'time', duration: 30, count: null }));
  assert.equal(conditionKey({ ...defaults, correctionPolicy: 'mandatory', quickEnd: false }),
    conditionKey({ ...defaults, correctionPolicy: 'mandatory' }));
  assert.deepEqual(inputRules({}), []);
  assert.equal(quickEndApplies({ mode: 'quote', correctionPolicy: 'relaxed' }), true);
  assert.equal(quickEndApplies({ mode: 'time', correctionPolicy: 'relaxed' }), false);
  assert.equal(quickEndApplies({ mode: 'words', correctionPolicy: 'mandatory' }), false);
});

test('quick end on finishes on the last letter; off waits on a mistake in the last word', () => {
  const run = (conditions) => ({ text: 'the cat', conditions: { ...defaults, ...conditions } });
  // Master: continue on error ends on the last letter even when it is wrong.
  assert.equal(passageComplete(run({}), 'the cax'), true);
  assert.equal(passageComplete(run({ quickEnd: true }), 'the cax'), true);
  assert.equal(passageComplete(run({}), 'the ca'), false);
  assert.equal(awaitingSubmit(run({}), 'the cax'), false);
  // Off: a wrong last word holds the run; a right last word ends it, even after earlier mistakes.
  assert.equal(passageComplete(run({ quickEnd: false }), 'the cax'), false);
  assert.equal(awaitingSubmit(run({ quickEnd: false }), 'the cax'), true);
  assert.equal(awaitingSubmit(run({ quickEnd: false }), 'the ca'), false);
  assert.equal(passageComplete(run({ quickEnd: false }), 'thx cat'), true);
  assert.equal(passageComplete(run({ quickEnd: false }), 'the cat'), true);
  // A space typed into the last word is a mistake in it too.
  assert.equal(awaitingSubmit(run({ quickEnd: false }), 'the c t'), true);
  // Stop on error already needs every letter; quick end changes nothing there or in a timed run.
  for (const conditions of [{ correctionPolicy: 'mandatory' }, { correctionPolicy: 'mandatory', quickEnd: false }]) {
    assert.equal(passageComplete(run(conditions), 'the cax'), false);
    assert.equal(awaitingSubmit(run(conditions), 'the cax'), false);
    assert.equal(passageComplete(run(conditions), 'the cat'), true);
  }
  assert.equal(passageComplete(run({ mode: 'time', quickEnd: false }), 'the cax'), true);
  assert.equal(awaitingSubmit(run({ mode: 'time', quickEnd: false }), 'the cax'), false);
});

test('strict space refuses a space only where the passage has a letter', () => {
  const strict = { strictSpace: true };
  assert.equal(refusesSpace(strict, 'the cat', 2, ' '), true);
  assert.equal(refusesSpace(strict, 'the cat', 4, ' '), true);
  assert.equal(refusesSpace(strict, 'the cat', 3, ' '), false);
  assert.equal(refusesSpace(strict, 'the cat', 2, 'x'), false);
  assert.equal(refusesSpace(strict, 'the cat', 7, ' '), false);
  assert.equal(refusesSpace({}, 'the cat', 2, ' '), false);
  assert.equal(refusesSpace({ strictSpace: false }, 'the cat', 2, ' '), false);
});

test('a refused space is scored as a wrong key at its position without shifting the word', () => {
  const keys = (spaceAccepted) => [
    { type: 'insert', text: 't', position: 0, accepted: true, offsetMs: 0 },
    { type: 'insert', text: 'h', position: 1, accepted: true, offsetMs: 100 },
    { type: 'insert', text: ' ', position: 2, accepted: spaceAccepted, offsetMs: 200 },
  ];
  // Strict space: the early space is refused, so "e cat" still lines up.
  const strict = createAttempt({ id: 's', text: 'the cat', textId: 'one', conditions: { ...defaults, strictSpace: true } });
  strict.events = [...keys(false), ...[...'e cat'].map((text, i) => ({ type: 'insert', text, position: 2 + i, accepted: true, offsetMs: 300 + i * 100 }))];
  strict.startedAt = 0;
  strict.endedAt = 6000;
  const strictReplay = replayAttempt(strict);
  assert.equal(strictReplay.typed, 'the cat');
  assert.equal(strictReplay.insertions, 8);
  assert.equal(strictReplay.mistakes, 1);
  assert.deepEqual(strictReplay.firstAttempts.find((entry) => entry.position === 2), { position: 2, expected: 'e', actual: ' ', correct: false, offsetMs: 200 });
  assert.equal(strictReplay.firstAttempts.filter((entry) => !entry.correct).length, 1);
  assert.deepEqual(strictReplay.score, { wpm: 14, accuracy: 88 });

  // Master (strict space off) types the same space into the "e" and moves on: the rest is shifted.
  const relaxed = createAttempt({ id: 'r', text: 'the cat', textId: 'two', conditions: defaults });
  relaxed.events = [...keys(true), ...[...'e cat'].map((text, i) => ({ type: 'insert', text, position: 3 + i, accepted: true, offsetMs: 300 + i * 100 }))];
  relaxed.startedAt = 0;
  relaxed.endedAt = 6000;
  const relaxedReplay = replayAttempt(relaxed);
  assert.equal(relaxedReplay.typed, 'th e ca');
  assert.equal(relaxedReplay.firstAttempts.filter((entry) => !entry.correct).length, 5);
});

test('existing event logs replay exactly as before, and a submit event scores nothing', () => {
  const attempt = createAttempt({ id: 'old', text: 'the cat', textId: 'one', conditions: { correctionPolicy: 'mandatory' } });
  attempt.events = [
    { type: 'insert', text: 't', position: 0, accepted: true, offsetMs: 0 },
    { type: 'insert', text: 'x', position: 1, accepted: true, offsetMs: 120 },
    { type: 'blocked-insert', text: 'e', position: 1, offsetMs: 200 },
    { type: 'delete', count: 1, offsetMs: 300 },
    ...[...'he cat'].map((text, i) => ({ type: 'insert', text, position: 1 + i, accepted: true, offsetMs: 400 + i * 150 })),
  ];
  attempt.startedAt = 0;
  attempt.endedAt = 1500;
  const replay = replayAttempt(attempt);
  assert.deepEqual({ typed: replay.typed, insertions: replay.insertions, mistakes: replay.mistakes, elapsedMs: replay.elapsedMs, score: replay.score },
    { typed: 'the cat', insertions: 8, mistakes: 1, elapsedMs: 1500, score: { wpm: 56, accuracy: 88 } });
  assert.deepEqual(replay.pairTimings.map((entry) => [entry.pair, entry.durationMs]), [['e ', 150], [' c', 150], ['ca', 150], ['at', 150]]);
  // Quick end off records the finishing space as a submit; replay skips it, so only endedAt counts.
  const submitted = { ...attempt, events: [...attempt.events, { type: 'submit', offsetMs: 1500 }] };
  assert.deepEqual(replayAttempt(submitted), replay);
});

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
  recommendTarget,
  replayAttempt,
  rawWpm,
  consistency,
  characterBreakdown,
  wordHistory,
} from '../src/typing.js';

function evenRun(text, msPerChar, misses = {}) {
  const attempt = createAttempt({ id: 'r', text, textId: 't', conditions: {} });
  attempt.events = [...text].map((char, i) => ({ type: 'insert', text: misses[i] ?? char, offsetMs: i * msPerChar }));
  attempt.startedAt = 0;
  attempt.endedAt = (text.length - 1) * msPerChar;
  return attempt;
}

test('raw wpm counts every key typed, errors and stop-on-error blocked keys included', () => {
  const attempt = createAttempt({ id: 'w', text: 'a'.repeat(45), textId: 't', conditions: {} });
  attempt.events = [
    ...Array.from({ length: 45 }, (_, i) => ({ type: 'insert', text: 'a', position: i, accepted: true, offsetMs: i * 1000 })),
    ...Array.from({ length: 5 }, () => ({ type: 'blocked-insert', text: 'b', position: 44, offsetMs: 44500 })),
  ];
  attempt.startedAt = 0;
  attempt.endedAt = 60000;
  // 50 keys in a minute = 10 wpm; the metric's insertions ignore the 5 blocked keys.
  assert.equal(replayAttempt(attempt).insertions, 45);
  assert.equal(rawWpm(attempt), 10);
  assert.equal(rawWpm(createAttempt({ id: 'e', text: 'a', textId: 't', conditions: {} })), 0);
});

test('consistency is 100 minus the CV of per-second speed, and empty under three seconds', () => {
  const steady = evenRun('a'.repeat(41), 100);
  assert.equal(consistency(steady), 100);
  assert.equal(consistency(evenRun('abcde', 100)), null);
  const uneven = createAttempt({ id: 'u', text: 'a'.repeat(8), textId: 't', conditions: {} });
  // 6 chars in second 0, 0 in second 1, 2 in second 2 → mean 8/3, sd ≈ 2.49, cv ≈ 93.5%.
  uneven.events = [0, 100, 200, 300, 400, 500, 2100, 2200].map((offsetMs) => ({ type: 'insert', text: 'a', offsetMs }));
  uneven.startedAt = 0;
  uneven.endedAt = 3000;
  assert.equal(consistency(uneven), 6);
  // Keys held back by stop-on-error are still typing: a steady hand stays steady.
  const stalled = evenRun('a'.repeat(41), 100);
  for (let i = 20; i < 30; i += 1) stalled.events[i].type = 'blocked-insert';
  assert.equal(consistency(stalled), 100);
});

test('character breakdown separates correct, incorrect, extra and missed', () => {
  const attempt = createAttempt({ id: 'b', text: 'the cat', textId: 't', conditions: {} });
  attempt.events = [
    { type: 'insert', text: 't', offsetMs: 0 },
    { type: 'insert', text: 'x', offsetMs: 100 },
    { type: 'insert', text: 'e', offsetMs: 200 },
    { type: 'insert', text: ' ', offsetMs: 300 },
    { type: 'insert', text: 'c', offsetMs: 400 },
  ];
  assert.deepEqual(characterBreakdown(attempt), { correct: 4, incorrect: 1, extra: 0, missed: 2 });
  const over = evenRun('ab', 100);
  over.events.push({ type: 'insert', text: 'z', offsetMs: 300 });
  assert.equal(characterBreakdown(over).extra, 1);
});

test('word history flags mistyped words and paces each word', () => {
  const words = wordHistory(evenRun('the cat sat', 200, { 5: 'x' }));
  assert.deepEqual(words.map((item) => item.word), ['the', 'cat', 'sat']);
  assert.deepEqual(words.map((item) => item.wrong), [false, true, false]);
  // 4 characters (space + word) in 800 ms = 60 wpm.
  assert.equal(words[2].wpm, 60);
  const partial = createAttempt({ id: 'p', text: 'the cat sat', textId: 't', conditions: {} });
  partial.events = [{ type: 'insert', text: 'the c', offsetMs: 0 }];
  assert.equal(wordHistory(partial).length, 2);
});

test('word pace runs to the kept last letter, so a fixed final slip slows the word', () => {
  const attempt = createAttempt({ id: 'f', text: 'the cat', textId: 't', conditions: {} });
  attempt.events = [...'the ca'].map((char, i) => ({ type: 'insert', text: char, offsetMs: i * 100 }));
  attempt.events.push(
    { type: 'insert', text: 'x', offsetMs: 600 },
    { type: 'delete', count: 1, offsetMs: 1500 },
    { type: 'insert', text: 't', offsetMs: 1600 },
  );
  const [, cat] = wordHistory(attempt);
  assert.equal(cat.wrong, true);
  // Space at 300 ms to the kept "t" at 1600 ms: 3 characters in 1.3 s ≈ 28 wpm, not 120 from the slip.
  assert.equal(cat.wpm, 28);
});

test('the new stats leave the versioned metrics untouched', () => {
  const attempt = evenRun('the cat sat', 200, { 5: 'x' });
  const before = JSON.stringify(replayAttempt(attempt).score);
  rawWpm(attempt); consistency(attempt); characterBreakdown(attempt); wordHistory(attempt);
  assert.equal(JSON.stringify(replayAttempt(attempt).score), before);
});
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

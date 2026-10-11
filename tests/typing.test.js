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
  quoteCorpus,
  recommendTarget,
  replayAttempt,
  selectPassage,
  STANDARD_SECONDS,
  STANDARD_VERSION,
  standardConditions,
  standardPassage,
  textId,
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
  // A slip left in (continue on error) shows as typed: "cxt", marked, never the target's "cat".
  assert.deepEqual(words.map((item) => item.word), ['the', 'cxt', 'sat']);
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
  // Fixed, so the kept letters read "cat"; the first-try miss still marks it.
  assert.equal(cat.word, 'cat');
  assert.equal(cat.wrong, true);
  // Space at 300 ms to the kept "t" at 1600 ms: 3 characters in 1.3 s ≈ 28 wpm, not 120 from the slip.
  assert.equal(cat.wpm, 28);
});

test('a run that stops inside a word lists only the letters typed', () => {
  const attempt = createAttempt({ id: 'm', text: 'the cat sat', textId: 't', conditions: {} });
  attempt.events = [...'the c'].map((char, i) => ({ type: 'insert', text: char, offsetMs: i * 100 }));
  const words = wordHistory(attempt);
  // "c", not "cat": the untyped "at" is counted as missed, never shown as typed.
  assert.deepEqual(words.map((item) => item.word), ['the', 'c']);
  assert.equal(words[1].wrong, false);
  // The pace covers what was typed: space at 300 ms to "c" at 400 ms, 1 letter in 100 ms = 120 wpm.
  assert.equal(words[1].wpm, 120);
  assert.equal(characterBreakdown(attempt).missed, 2);
});

test('a mistyped space marks the word before it, and shows when left in', () => {
  const view = (attempt) => wordHistory(attempt).map(({ word, wrong, wpm }) => ({ word, wrong, wpm }));
  // Control: clean spaces leave both words clean, each at 120 wpm.
  const clean = evenRun('the cat', 100);
  assert.deepEqual(view(clean), [{ word: 'the', wrong: false, wpm: 120 }, { word: 'cat', wrong: false, wpm: 120 }]);
  assert.deepEqual(characterBreakdown(clean), { correct: 7, incorrect: 0, extra: 0, missed: 0 });

  // Left in under continue on error: "thexcat" shows "thex" in the miss style; "cat" stays clean.
  const leftIn = evenRun('the cat', 100, { 3: 'x' });
  assert.deepEqual(view(leftIn), [{ word: 'thex', wrong: true, wpm: 120 }, { word: 'cat', wrong: false, wpm: 120 }]);
  assert.deepEqual(characterBreakdown(leftIn), { correct: 6, incorrect: 1, extra: 0, missed: 0 });

  // First try wrong, then fixed: "the" is marked but reads as typed; the pace is the control's.
  const fixed = createAttempt({ id: 's', text: 'the cat', textId: 't', conditions: {} });
  fixed.events = [
    ...[...'the'].map((char, i) => ({ type: 'insert', text: char, offsetMs: i * 100 })),
    { type: 'insert', text: 'x', offsetMs: 300 },
    { type: 'delete', count: 1, offsetMs: 350 },
    ...[...' cat'].map((char, i) => ({ type: 'insert', text: char, offsetMs: 400 + i * 100 })),
  ];
  assert.deepEqual(view(fixed), [{ word: 'the', wrong: true, wpm: 120 }, { word: 'cat', wrong: false, wpm: 120 }]);
  assert.deepEqual(characterBreakdown(fixed), { correct: 7, incorrect: 0, extra: 0, missed: 0 });
});

test('first-word pace starts at the first key, so a fixed first-letter slip slows the word', () => {
  const attempt = createAttempt({ id: 'g', text: 'the cat', textId: 't', conditions: {} });
  attempt.events = [
    { type: 'insert', text: 'x', position: 0, accepted: true, offsetMs: 0 },
    { type: 'delete', count: 1, offsetMs: 1000 },
    { type: 'insert', text: 't', position: 0, accepted: true, offsetMs: 1100 },
    { type: 'insert', text: 'h', position: 1, accepted: true, offsetMs: 1200 },
    { type: 'insert', text: 'e', position: 2, accepted: true, offsetMs: 1300 },
  ];
  const [the] = wordHistory(attempt);
  assert.equal(the.wrong, true);
  // Slip at 0 ms to the kept "e" at 1300 ms: 3 kept letters in 1.3 s ≈ 28 wpm, not 120 from "t".
  assert.equal(the.wpm, 28);
  // A clean first word still paces from its own first letter: 2 letters in 200 ms = 120 wpm.
  assert.equal(wordHistory(evenRun('the cat', 100))[0].wpm, 120);
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

test('numbers mix in only when on, stay seeded, and split condition keys', () => {
  const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const plain = makePassage('words', 200, false, seeded(7));
  const mixed = makePassage('words', 200, false, seeded(7), undefined, true);
  assert.doesNotMatch(plain, /\d/);
  assert.match(mixed, /\b\d{1,4}\b/);
  assert.ok(mixed.split(' ').every((word) => /^(\d{1,4}|[a-z']+)$/.test(word)));
  assert.equal(mixed, makePassage('words', 200, false, seeded(7), undefined, true));
  assert.doesNotMatch(makePassage('time', 0, true, seeded(3)), /\d/);
  // A short passage that draws no numbers still gets one.
  assert.equal(makePassage('words', 1, false, () => 0.99, undefined, true), '9910');
  for (let seed = 1; seed <= 200; seed += 1) assert.match(makePassage('words', 10, false, seeded(seed), undefined, true), /\d/);
  const base = { mode: 'words', count: 10, punctuation: false };
  assert.notEqual(conditionKey(base), conditionKey({ ...base, numbers: true }));
  assert.equal(conditionKey(base), conditionKey({ ...base, numbers: false }));
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

test('condition keys without a standard recipe stay byte-identical', () => {
  const practice = { mode: 'time', duration: 30, count: null, punctuation: false, quoteLength: null, difficulty: null,
    wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en' };
  assert.equal(conditionKey(practice), 'time:30::plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1');
  assert.equal(conditionKey({ ...practice, recipe: null }), conditionKey(practice));
  assert.equal(conditionKey({}), ':::plain::::physical-keyboard:mandatory:original-en-v5:stilltype-metrics-v1');
});

test('the standard test is its own condition, versioned by recipe', () => {
  const standard = standardConditions();
  assert.equal(STANDARD_VERSION, 'standard-v1');
  assert.equal(STANDARD_SECONDS, 60);
  assert.deepEqual({ mode: standard.mode, duration: standard.duration, punctuation: standard.punctuation, wordList: standard.wordList,
    correctionPolicy: standard.correctionPolicy, recipe: standard.recipe }, { mode: 'standard', duration: 60, punctuation: true,
    wordList: null, correctionPolicy: 'mandatory', recipe: 'standard-v1' });
  assert.equal(conditionKey(standard), 'standard:60::punctuation::::physical-keyboard:mandatory:original-en-v5:stilltype-metrics-v1:standard-v1');
  // Even a time test that happens to share its length, punctuation and policy never shares a best.
  const lookalike = { mode: 'time', duration: 60, punctuation: true, wordList: '10k', correctionPolicy: 'mandatory' };
  assert.notEqual(conditionKey(standard), conditionKey(lookalike));
  assert.notEqual(conditionKey(standard), conditionKey({ ...standard, recipe: 'standard-v2' }));
  assert.notEqual(conditionKey(standard), conditionKey(standardConditions('touch')));
});

test('standard text is fresh per seed, reproducible from it, and follows the v1 recipe', async () => {
  const { wordList } = await import('../src/words.js');
  const vocabulary = new Set([...wordList('1k'), ...wordList('5k'), ...wordList('10k')]);
  for (const seed of [0, 1, 7, 2026, 4294967295]) {
    const passage = standardPassage(seed);
    assert.equal(passage.text, standardPassage(seed).text);
    assert.equal(passage.id, `standard-v1-${seed.toString(36)}`);
    assert.equal(passage.recipe, 'standard-v1');
    // Printable ASCII only. (Where " is a dead key, browsers report composition, which isn't scored.)
    assert.match(passage.text, /^[\x20-\x7e]+$/, 'printable ASCII only');
    assert.ok(!passage.text.includes('  '));
    assert.ok(passage.text.length >= 2500, 'enough text for a full minute');
    // One quote segment: the second sentence, in double quotation marks, generated like the rest.
    assert.equal(passage.text.split('"').length, 3);
    assert.match(passage.text, /^[A-Z][^.?"]*[.?] "[A-Z][^"]*[.?]" [A-Z]/);
    const generated = passage.text.replace(/"/g, '').split(' ');
    assert.ok(generated.some((word) => /^\d+[,.?]?$/.test(word)), 'some numbers');
    assert.ok(generated.some((word) => /,$/.test(word)) && generated.some((word) => /\.$/.test(word)), 'commas and full stops');
    const words = generated.map((word) => word.replace(/[,.?]$/, '')).filter((word) => !/^\d+$/.test(word));
    // Every word, the quote's included, comes from the lists: nothing is drawn from the quote corpus.
    assert.ok(words.every((word) => word === 'I' || vocabulary.has(word.toLowerCase())), 'only list words');
    assert.ok(!quoteCorpus.some((item) => passage.text.includes(item.text.split(/[.?]/)[0])), 'no corpus quote');
    const lower = new Set([...wordList('1k'), ...wordList('5k')]);
    assert.ok(words.some((word) => !lower.has(word.toLowerCase())), 'reaches the 10k band');
    assert.ok(words.filter((word) => wordList('1k').includes(word.toLowerCase())).length > words.length / 2, 'mostly common words');
  }
  assert.notEqual(standardPassage(1).text, standardPassage(2).text);
  // Pinned output: if this changes, the recipe changed, so bump STANDARD_VERSION (or CORPUS_VERSION for list edits).
  assert.equal(textId(standardPassage(1).text), 'generated-1a2f41n');
});

test('standard passages ignore practice filters and skip seen seeds', () => {
  let calls = 0;
  const random = () => [0.1, 0.1, 0.2][Math.min(calls++, 2)];
  const first = selectPassage({ mode: 'standard', wordList: '200', punctuation: false, random: () => 0.1 });
  assert.equal(first.text, standardPassage(Math.floor(0.1 * 4294967296)).text);
  const next = selectPassage({ mode: 'standard', seenIds: [first.id], random });
  assert.equal(next.id, standardPassage(Math.floor(0.2 * 4294967296)).id);
  assert.equal(next.fresh, true);
});

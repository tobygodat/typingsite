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

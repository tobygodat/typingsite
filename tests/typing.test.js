import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOM_MAX,
  compareAttempts,
  customTextProblem,
  completeAttempt,
  conditionKey,
  createAttempt,
  editStats,
  makeDrill,
  makePassage,
  metrics,
  normalizeCustomText,
  orderCustomText,
  passageComplete,
  replayCursor,
  replaySpan,
  recommendTarget,
  replayAttempt,
  untypableCharacter,
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

test('replayCursor replays the typed text as it was and ends on the scored result', () => {
  const attempt = createAttempt({ id: 'r', text: 'the cat' });
  attempt.events.push(
    { type: 'insert', text: 't', offsetMs: 0 },
    { type: 'insert', text: 'x', offsetMs: 100 },
    { type: 'delete', count: 1, offsetMs: 200 },
    { type: 'insert', text: 'h', offsetMs: 300 },
    { type: 'insert', text: 'e', offsetMs: 400 },
    { type: 'insert', text: ' ', offsetMs: 500 },
    { type: 'insert', text: 'c', offsetMs: 600 },
    { type: 'insert', text: 'q', offsetMs: 700 },
    { type: 'insert', text: 't', offsetMs: 800 },
  );
  const completed = completeAttempt(attempt, { endedAt: 800 });
  const typedAt = replayCursor(completed);
  assert.equal(typedAt(150), 'tx');
  assert.equal(typedAt(250), 't');
  assert.equal(typedAt(replaySpan(completed).end), completed.summary.typed);
  // Going back (Restart) starts over.
  assert.equal(typedAt(0), 't');
  assert.equal(typedAt(450), 'the');
  assert.deepEqual(replaySpan(completed), { start: 0, end: 800 });
  // A timed run that idles before the timer ends replays to the scored end, not the last key.
  const timed = completeAttempt({ ...attempt, startedAt: 0 }, { endedAt: 15000 });
  assert.deepEqual(replaySpan(timed), { start: 0, end: timed.endedAt });
  assert.equal(replaySpan(timed).end - replaySpan(timed).start, timed.summary.elapsedMs);
});

test('replayCursor matches replayAttempt at every prefix of the events', () => {
  let seed = 11;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (items) => items[Math.floor(random() * items.length)];
  for (let run = 0; run < 40; run += 1) {
    const text = makePassage('words', 12, run % 2 === 0, random);
    const attempt = createAttempt({ id: `p${run}`, text });
    let offsetMs = 0;
    let length = 0;
    for (let i = 0; i < 120; i += 1) {
      offsetMs += pick([0, 1, 37, 120]);
      const roll = random();
      // Every event shape the recorder writes, plus the ones replayAttempt skips or truncates.
      const event = roll < 0.55 ? { type: 'insert', text: random() < 0.8 ? text[length] || 'z' : 'x', position: length, accepted: true }
        : roll < 0.62 ? { type: 'insert', text: pick(['ab', 'q', '\n', '', 'é']) }
        : roll < 0.67 ? { type: 'insert', text: 'k', position: pick([length, text.length, text.length + 3]), accepted: random() < 0.5 }
        : roll < 0.72 ? { type: 'blocked-insert', text: 'y', position: Math.max(0, length - 1) }
        : roll < 0.88 ? { type: 'delete', count: pick([1, 1, 2, 5, undefined, 0, -1]) }
        : { type: pick(['focus-lost', 'composition']) };
      attempt.events.push({ ...event, offsetMs });
      length = replayAttempt(attempt).typed.length;
    }
    const typedAt = replayCursor(attempt);
    attempt.events.forEach((event, index) => {
      // Events sharing an offset come due together, so compare at the last one of each offset.
      if (attempt.events[index + 1]?.offsetMs === event.offsetMs) return;
      const expected = replayAttempt({ ...attempt, events: attempt.events.slice(0, index + 1) }).typed;
      assert.equal(typedAt(event.offsetMs), expected, `run ${run}, event ${index}`);
    });
    assert.equal(typedAt(Infinity), replayAttempt(attempt).typed);
    // Seeking back and forward again lands on the same text.
    const middle = attempt.events[60].offsetMs;
    assert.equal(typedAt(middle), replayAttempt({ ...attempt, events: attempt.events.filter((event) => event.offsetMs <= middle) }).typed);
  }
});

test('custom text keeps only what an English keyboard types, one unit per letter', () => {
  const clean = (value) => normalizeCustomText(value);
  // Invisible code points go silently: CGJ (Mn), ZWSP, ZWJ/ZWNJ, variation selectors, soft hyphen, bidi marks, BOM, controls.
  assert.equal(clean('gra\u034Fph'), 'graph');
  assert.equal(clean('zero\u200Bwidth jo\u200Din no\u200Cn'), 'zerowidth join non');
  assert.equal(clean('ok\uFE0F'), 'ok');
  assert.equal(clean('\uFEFFsoft\u00ADware left\u200Eto \u2066right\u2069 b\u0007ell'), 'software leftto right bell');
  // Smart punctuation and compatibility forms become ASCII; whitespace collapses.
  assert.equal(clean('  “It’s fine” — she said…\n\tok  '), '"It\'s fine" - she said... ok');
  assert.equal(clean('ＡＢＣ\u00A0ﬁne'), 'ABC fine');
  // Accents on Latin letters fold to the plain letter, composed or not.
  assert.equal(clean('café résumé nai\u0308ve'), 'cafe resume naive');
  for (const text of ['gra\u034Fph', 'ok\uFE0F', 'café', '“quoted”']) assert.equal(untypableCharacter(clean(text)), null);
  // Visible characters outside the alphabet survive normalising so they can be named and refused.
  assert.equal(untypableCharacter(clean('go 🚀 now')), '🚀');
  assert.equal(untypableCharacter(clean('hello 世界')), '世');
  assert.equal(untypableCharacter(clean('❤\uFE0F')), '❤');
  assert.equal(untypableCharacter(clean('straße')), 'ß');
  // The cap applies after expansion, so a saved passage is stable; Infinity measures the whole text.
  assert.equal(clean('…'.repeat(1001)).length, CUSTOM_MAX);
  assert.equal(normalizeCustomText('…'.repeat(1001), Infinity).length, 3003);
  assert.equal(clean(clean('“a” — b…')), clean('“a” — b…'));
});

test('reordered custom text is never longer than the validated source', () => {
  // One 2,000-character word and 500 one-letter words: sampling with replacement could draw the long word twice.
  const long = 'a'.repeat(2000);
  const source = [long, ...Array(500).fill('b')].join(' ');
  assert.equal(source.length, 3000);
  const limit = Math.min(source.length, CUSTOM_MAX);
  let drewLong = 0;
  for (let seed = 1; seed <= 500; seed += 1) {
    let state = seed;
    const random = () => ((state = (state * 16807) % 2147483647) / 2147483647);
    const randomOrder = orderCustomText(source, 'random', random);
    // Within the budget, and filled to it: a word that doesn't fit is skipped, not the end of the passage.
    assert.ok(randomOrder.length >= limit - 1 && randomOrder.length <= limit, `seed ${seed}: ${randomOrder.length}`);
    if (randomOrder.includes(long)) drewLong += 1;
    const lopsided = orderCustomText(`${'a'.repeat(2998)} b`, 'random', random);
    assert.ok(lopsided.length >= 2999 && lopsided.length <= 3000, `seed ${seed}: ${lopsided.length}`);
    const shuffled = orderCustomText(source, 'shuffled', random);
    assert.equal(shuffled.length, source.length);
    assert.deepEqual(shuffled.split(' ').sort(), source.split(' ').sort());
  }
  assert.ok(drewLong > 0, 'the long word is still drawn sometimes');
  assert.equal(orderCustomText(source, 'as-written'), source);
  assert.equal(orderCustomText('', 'random'), '');
});

test('custom text must be typeable and long enough to time', () => {
  const problem = (value) => customTextProblem(normalizeCustomText(value, Infinity))?.kind ?? null;
  assert.equal(problem(''), 'empty');
  assert.equal(problem(' \u200B '), 'empty');
  // One letter finishes on the key that starts the clock; two short words under ten characters are still too quick.
  assert.equal(problem('a'), 'short');
  assert.equal(problem('hi there'), 'short');
  assert.equal(problem('abcdefghijklmnop'), 'short');
  assert.equal(problem('hello world'), null);
  assert.equal(problem('“Hi,” I said.'), null);
  assert.deepEqual(customTextProblem('go 🚀 now'), { kind: 'untypable', char: '🚀' });
  assert.deepEqual(customTextProblem(normalizeCustomText(Array(501).fill('ab…').join(' '), Infinity)), { kind: 'long', length: 3005 });
  assert.equal(problem(Array(500).fill('ab…').join(' ')), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOM_MAX,
  EVENT_VERSION,
  accentComposition,
  METRIC_VERSION,
  carriedKey,
  compareAttempts,
  customTextProblem,
  completeAttempt,
  composedKeys,
  conditionKey,
  createAttempt,
  editStats,
  makeAdaptive,
  makeDrill,
  makePassage,
  metrics,
  accuracyGraceCharacters,
  atRunEnd,
  MINIMUM_GRACE_CHARACTERS,
  MINIMUM_GRACE_MS,
  minimumMissed,
  minimumStop,
  normalizeCustomText,
  orderCustomText,
  passageComplete,
  correctionPreference,
  CORRECTION_POLICIES,
  allowsBackspace,
  blocksOnError,
  failureFor,
  failureAtEnd,
  awaitingSubmit,
  inputRules,
  quickEndApplies,
  refusesSpace,
  replayCursor,
  replayScoreAt,
  replaySpan,
  quoteCorpus,
  recommendTarget,
  replayAttempt,
  selectPassage,
  STANDARD_SECONDS,
  STANDARD_VERSION,
  standardConditions,
  standardPassage,
  textId,
  untypableCharacter,
  rawWpm,
  summarizePatterns,
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
  assert.equal(makePassage('words', 10, true, () => 0), 'The the. The the. The the. The the. The the.');
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
  assert.equal(makePassage('words', 1, false, () => 0.99, undefined, true), '9999');
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

test('an accent-key commit is one or two typed keys; IME text is not', () => {
  for (const [text, keys] of [
    ['"', ['"']], [' ', [' ']], ['ä', ['ä']], ['ä', ['ä']],
    ['"h', ['"', 'h']], ["'t", ["'", 't']], ['´q', ['´', 'q']], ['́q', ['́', 'q']], ['""', ['"', '"']],
    // Caron, dot above and dot below are accent marks, though Unicode also lists them for Bopomofo or kana.
    ['ˇs', ['ˇ', 's']], ['˙z', ['˙', 'z']], ['\u0323q', ['\u0323', 'q']],
    ['', []],
  ]) assert.deepEqual(composedKeys(text), keys, JSON.stringify(text));
  // Kana punctuation (ー ・ ゛ ゠) is Script=Common, but only a kana IME types it.
  for (const text of ['ab', 'ni', '"hi', '你', 'あ', 'ㅎ', '한', 'ａ', '。', 'ー', '・', '゛', '゠', '"ー', '\n', '"\n']) {
    assert.equal(composedKeys(text), null, JSON.stringify(text));
  }
});

test('an emoji committed through a composition is not an accent key', () => {
  // Emoji pickers and phone keyboards commit through composition too. An astral emoji is two UTF-16
  // units, so typing it would move the caret two letters; pictographs, presentation selectors, joined
  // sequences, flags and keycaps aren't one passage character either.
  for (const text of [
    '😀', '👍', '❤', '☺', '✌', '❤️', '☺️', '✌️', '👍🏽', '👩‍💻', '🇫🇷', '1️⃣', '#️⃣',
    '"😀', '´😀', '"❤', '~☺', '‍', '️', '"️', '⃣',
  ]) assert.equal(composedKeys(text), null, JSON.stringify(text));
});

test('an invisible code point committed through a composition is not an accent key', () => {
  // U+034F combining grapheme joiner sits among the combining accents but is default-ignorable: it shows
  // nothing, so typing it would move the caret over a letter nobody sees.
  for (const text of ['͏', '͏a', '"͏', '­', '​', '⁠', '﻿', '᠋']) {
    assert.equal(composedKeys(text), null, JSON.stringify(text));
  }
});

test('every mark and letter a real accent key commits is still typed', () => {
  // A mark on its own (the dead key, then space) on US-International, UK-Extended, German, French AZERTY
  // and BÉPO, Spanish, Portuguese, Swedish/Norwegian, Czech and Polish. ~ is a math symbol, ° an other
  // symbol and ˇ a modifier letter, so a whitelist by general category would refuse some of them.
  for (const mark of ['"', "'", '`', '~', '^', '´', '¨', '°', 'ˇ', '˙', '˛', '˘', '˝', '¸', '¯', '˚', 'ˆ', '˜']) {
    assert.deepEqual(composedKeys(mark), [mark], mark);
  }
  // A composed letter, or BÉPO's currency key (€). Its Greek key (α) types no Latin letter: see below.
  for (const letter of ['ä', 'é', 'è', 'ê', 'ë', 'ï', 'ñ', 'ã', 'õ', 'ç', 'å', 'ø', 'ů', 'ő', 'ű', 'ž', 'č', 'ř', 'ě', 'ż', 'ą', 'ę', 'ł', 'ś', 'ẽ', 'ŵ', '€']) {
    assert.deepEqual(composedKeys(letter), [letter], letter);
  }
  // The mark and the key it doesn't combine with: Windows US-International sends ~e, not ẽ. A layout's
  // own keys (AZERTY's ², £ and §) can follow a mark too.
  for (const pair of ['^q', '~e', '`x', '¨k', '´t', '°x', 'ˇx', '˙q', '˛b', '¸k', '˝a', "'1", '"#', '"é', '~~', '^ ', '¨²', '^£', '´§']) {
    assert.deepEqual(composedKeys(pair), [...pair], pair);
  }
  // Punctuation, symbols and spaces past Latin-1 that Latin layouts' own keys type, alone or after a mark
  // (a slip, but keys): Windows US-International's AltGr+0 (’), macOS Option+Shift+- (—) and Option+[ (“),
  // Linux's dead circumflex then 4 (⁴), a no-break space, an ellipsis, ≠ and the middle dot.
  for (const text of ['⁴', '’', '—', '…', '≠', ' ', ' ', '·', "'’", '"—', '"“', '^–', '"…', '^≠', '" ']) {
    assert.deepEqual(composedKeys(text), [...text], JSON.stringify(text));
  }
});

test('a one-letter commit from another script’s input method is not an accent key', () => {
  // Hindi, Korean, Hebrew, Russian, Greek, Thai and Arabic input methods commit one letter through a
  // composition too. Accent keys type Latin: a mark, a letter with a diacritic, or the mark and the next key.
  for (const text of ['अ', 'ㅎ', 'ש', 'ж', 'α', 'ก', 'ع', '"ж', '´अ', 'ˇש', '¨α']) {
    assert.equal(composedKeys(text), null, JSON.stringify(text));
  }
  // Nor another script's digits or punctuation (Devanagari, Arabic), or East Asian forms no script owns:
  // the ideographic space, CJK punctuation, vertical, small and full-width forms.
  for (const text of ['१', '٣', '।', '،', '"।', '　', '"　', '、', '〜', '︐', '﹐', '＄']) {
    assert.equal(composedKeys(text), null, JSON.stringify(text));
  }
});

test('only a composition an accent key opened is scored as one', () => {
  // Chrome and Firefox send the accent key (Dead) before its composition. Safari sends it after the mark
  // shows, and Chromium on Linux sends key Process for every key its input method takes, so there the
  // mark, shown first and on its own, says where the composition came from.
  for (const origin of [
    { key: 'Dead', preview: '"' }, { key: 'Dead', preview: '¤' }, { key: 'Dead' },
    { key: 'Process', preview: '^' }, { preview: '´' }, { preview: '¨' }, { preview: '\u0301' },
  ]) assert.equal(accentComposition(origin), true, JSON.stringify(origin));
  // An input method's composition opens on what it composes (Pinyin, Telex, Hindi, Korean, Russian, kana),
  // whatever it commits in the end: one letter from it is still not a key press.
  for (const origin of [
    {}, { key: 'Process' }, { key: 'Process', preview: 'a' }, { key: 'n', preview: 'n' }, { preview: 'अ' },
    { key: 'Process', preview: 'ж' }, { preview: 'ㅎ' }, { preview: 'ä' }, { preview: 'ă' }, { preview: '""' },
    { preview: '' }, { preview: 'あ' }, { preview: '\u034F' }, { key: 'Shift', preview: 'a' },
  ]) assert.equal(accentComposition(origin), false, JSON.stringify(origin));
});

test('a key a commit carries past the passage end is a mistake against the last letter, or nothing', () => {
  // "h committed on a passage's last letter ("): the mark is kept, and the h, pressed while the last
  // letter was still to come, is a mistake against it and not kept. A key that is that letter ("" on a
  // closing ") adds nothing, as a plain key after the passage ends isn't recorded either: it can't raise
  // accuracy after a slip.
  const run = (extra, slip = false) => {
    const attempt = createAttempt({ id: 'e', text: 'go"', textId: 'e', conditions: {} });
    attempt.events = [...'go"'].map((char, position) => ({ type: 'insert', text: char, position, accepted: true, offsetMs: position * 100 }));
    if (slip) attempt.events.unshift({ type: 'insert', text: 'x', position: 0, accepted: true, offsetMs: 0 }, { type: 'delete', count: 1, offsetMs: 0 });
    const carried = extra === null ? null : carriedKey(attempt, extra, 200);
    if (carried) attempt.events.push(carried);
    attempt.startedAt = 0;
    return completeAttempt(attempt, { endedAt: 200 });
  };
  const wrong = run('h');
  assert.equal(wrong.typed, 'go"');
  assert.deepEqual(wrong.events.at(-1), { type: 'insert', text: 'h', position: 2, accepted: false, offsetMs: 200 });
  assert.equal(wrong.summary.insertions, 4);
  assert.equal(wrong.summary.mistakes, 1);
  assert.equal(wrong.summary.score.accuracy, 75);
  assert.ok(wrong.summary.firstAttempts.every((entry) => entry.correct));
  assert.ok(passageComplete(wrong, wrong.typed));
  assert.deepEqual(characterBreakdown(wrong), { correct: 3, incorrect: 0, extra: 1, missed: 0 });
  const doubled = run('"');
  assert.equal(doubled.summary.insertions, 3);
  assert.equal(doubled.summary.score.accuracy, 100);
  assert.deepEqual(characterBreakdown(doubled), { correct: 3, incorrect: 0, extra: 0, missed: 0 });
  // After a slip, a doubled mark scores exactly as the plain closing " does (3 of 4), not 4 of 5.
  const plainAfterSlip = run(null, true);
  assert.equal(plainAfterSlip.summary.score.accuracy, 75);
  assert.deepEqual(run('"', true).summary, plainAfterSlip.summary);
  assert.equal(run('h', true).summary.score.accuracy, 60);
});

test('a refused key inside the passage is not extra in the character breakdown', () => {
  // A key recorded but not kept at a position the passage still has (as a strict space rule refuses a
  // space typed where a letter belongs) is a mistake there, not a keystroke past the passage end.
  const attempt = createAttempt({ id: 'r', text: 'go on', textId: 'r', conditions: {} });
  attempt.events = [
    ...[...'go '].map((char, position) => ({ type: 'insert', text: char, position, accepted: true, offsetMs: position * 100 })),
    { type: 'insert', text: ' ', position: 3, accepted: false, offsetMs: 300 },
    ...[...'on'].map((char, i) => ({ type: 'insert', text: char, position: 3 + i, accepted: true, offsetMs: 400 + i * 100 })),
  ];
  assert.deepEqual(characterBreakdown(attempt), { correct: 5, incorrect: 0, extra: 0, missed: 0 });
});

test('a mark and letter committed together replay like two key presses', () => {
  const run = (offsets) => {
    const attempt = createAttempt({ id: 'q', text: 'say "hi"', textId: 'q', conditions: {} });
    attempt.events = [...'say "hi"'].map((char, position) => ({ type: 'insert', text: char, position, accepted: true, offsetMs: offsets[position] }));
    attempt.startedAt = 0;
    return completeAttempt(attempt, { endedAt: 1000 });
  };
  // Typed as separate keys, then with the mark and "h" committed together at 400 ms (the "h" key).
  const keys = run([0, 80, 160, 240, 320, 400, 480, 560]);
  const commit = run([0, 80, 160, 240, 400, 400, 480, 560]);
  for (const field of ['typed', 'insertions', 'correctInsertions', 'mistakes', 'score']) assert.deepEqual(commit.summary[field], keys.summary[field], field);
  assert.deepEqual(commit.summary.firstAttempts.map((entry) => entry.correct), keys.summary.firstAttempts.map((entry) => entry.correct));
  // The shared commit time gives "h a 0 ms interval; pattern evidence (letter pairs only) never sees it.
  assert.ok(commit.summary.pairTimings.some((entry) => entry.pair === '"h' && entry.durationMs === 0));
  const patterns = summarizePatterns([commit]);
  assert.deepEqual(patterns, summarizePatterns([keys]));
  assert.deepEqual(patterns.pairs.map((entry) => entry.pair).sort(), ['ay', 'hi', 'sa']);
  assert.equal(patterns.personalMedianMs, 80);

  // A composed vowel where the mark belongs is one insertion and one mistake.
  const wrong = createAttempt({ id: 'w', text: '"a', textId: 'w', conditions: {} });
  wrong.events = [{ type: 'insert', text: 'ä', position: 0, accepted: true, offsetMs: 0 }];
  const replay = replayAttempt(wrong);
  assert.equal(replay.insertions, 1);
  assert.equal(replay.mistakes, 1);
  assert.equal(METRIC_VERSION, 'stilltype-metrics-v1');
  assert.equal(EVENT_VERSION, 'stilltype-events-v1');
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

test('every code snippet unindents to a non-empty single line the engine accepts', async () => {
  const { CODE_LANGUAGES, CODE_SNIPPETS, MAX_CODE_TOKEN, codePassage, unindent } = await import('../src/code-snippets.js');
  for (const language of CODE_LANGUAGES) {
    assert.ok(CODE_SNIPPETS[language].length >= 6, language);
    for (const snippet of CODE_SNIPPETS[language]) {
      const text = unindent(snippet);
      assert.ok(text.length > 0, snippet);
      assert.match(text, /^[\x20-\x7e]+$/u, text);
      assert.doesNotMatch(text, /^ | $| {2}/u, text);
      for (const token of text.split(' ')) assert.ok(token.length <= MAX_CODE_TOKEN, token);
    }
    assert.equal(codePassage(language).language, language);
    const seenIds = [];
    for (const _ of CODE_SNIPPETS[language]) {
      const next = codePassage(language, { seenIds });
      assert.deepEqual([next.fresh, next.exhausted], [true, false], language);
      seenIds.push(next.id);
    }
    const repeat = codePassage(language, { seenIds });
    assert.deepEqual([repeat.fresh, repeat.exhausted], [false, true], language);
  }
  assert.notEqual(conditionKey({ mode: 'code', codeLanguage: 'js' }), conditionKey({ mode: 'code', codeLanguage: 'go' }));
  assert.notEqual(conditionKey({ mode: 'code', codeLanguage: 'js' }), conditionKey({ mode: 'words', count: 25 }));

  // A code token is no word to practise: a missed code run records no missed words, a prose run does.
  const { runRecord } = await import('../src/insights.js');
  const missed = (conditions) => {
    const attempt = createAttempt({ id: 'c', text: 'const total', textId: 'c', conditions });
    attempt.startedAt = 0;
    attempt.events = [...'cxnst total'].map((char, position) => ({ type: 'insert', text: char, position, offsetMs: position * 100, accepted: true }));
    return runRecord({ ...completeAttempt(attempt, { endedAt: 1100 }), kind: 'test', fresh: true }).missedWords;
  };
  assert.equal(missed({ mode: 'code', codeLanguage: 'js', correctionPolicy: 'relaxed' }), undefined);
  assert.deepEqual(missed({ mode: 'time', duration: 30, correctionPolicy: 'relaxed' }), ['const']);
});

test('each code language has at least 24 distinct snippets of 30 to 60 seconds at 100 wpm', async () => {
  const { CODE_LANGUAGES, CODE_SNIPPETS, MIN_CODE_CHARS, MAX_CODE_CHARS, codePassage, unindent } = await import('../src/code-snippets.js');
  const charsAt100Wpm = (seconds) => (100 * 5 * seconds) / 60;
  assert.deepEqual([MIN_CODE_CHARS, MAX_CODE_CHARS], [charsAt100Wpm(30), charsAt100Wpm(60)]);
  for (const language of CODE_LANGUAGES) {
    const texts = CODE_SNIPPETS[language].map(unindent);
    assert.ok(texts.length >= 24, `${language} has ${texts.length} snippets`);
    assert.equal(new Set(texts).size, texts.length, `${language} repeats a snippet`);
    for (const text of texts) {
      assert.ok(text.length >= MIN_CODE_CHARS && text.length <= MAX_CODE_CHARS, `${language}, ${text.length} characters: ${text}`);
    }
    // Fresh snippets come first, so a run of tests repeats none until the pool is spent.
    const seenIds = [];
    for (let i = 0; i < 24; i += 1) seenIds.push(codePassage(language, { seenIds }).id);
    assert.equal(new Set(seenIds).size, 24, language);
  }
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

test('the duration is the end of a timed run: a miss there is an end-of-run failure, a second earlier a live stop', () => {
  // A 15 s run under a 60 wpm minimum, a key every 190 ms: 74 keys read 63 wpm at 14 s and 59 at 15 s.
  const text = 'the quiet light moves across the room and the world carries on for a moment';
  const typed = (keys) => {
    const attempt = createAttempt({ id: 't', text, textId: 'one', conditions: { mode: 'time', duration: 15, correctionPolicy: 'relaxed' } });
    attempt.events = [...text.slice(0, keys)].map((char, i) => ({ type: 'insert', text: char, offsetMs: i * 190 }));
    attempt.startedAt = 0;
    return (endedAt) => replayAttempt({ ...attempt, endedAt });
  };
  const minimums = { wpm: 60 };
  const run = typed(74);
  assert.equal(run(14000).score.wpm, 63);
  assert.equal(minimumStop(minimums, run(14000), { elapsedMs: 14000, durationMs: 15000 }), null);
  assert.equal(run(15000).score.wpm, 59);
  assert.deepEqual(minimumStop(minimums, run(15000), { elapsedMs: 15000, durationMs: 15000 }), { metric: 'wpm', minimum: 60, value: 59, atEnd: true });
  assert.equal(minimumStop(minimums, run(15000), { elapsedMs: 15400, durationMs: 15000 }).atEnd, true, 'past the duration too');

  // 66 keys read 57 wpm at 14 s: a live stop, before the end.
  const short = typed(66);
  assert.deepEqual(minimumStop(minimums, short(14000), { elapsedMs: 14000, durationMs: 15000 }), { metric: 'wpm', minimum: 60, value: 57 });

  // The end is the duration or a finished passage, whichever comes first.
  assert.equal(atRunEnd({ elapsedMs: 14999, durationMs: 15000 }), false);
  assert.equal(atRunEnd({ elapsedMs: 15000, durationMs: 15000 }), true);
  assert.equal(atRunEnd({ elapsedMs: 60000, durationMs: null }), false);
  assert.equal(atRunEnd({ elapsedMs: 3000, durationMs: null, finished: true }), true);

  // An untimed run ends with its passage: judged on the final score, with no grace.
  const quick = typed(12)(2500);
  assert.equal(minimumStop({ wpm: 100 }, quick, { elapsedMs: 2500 }), null, 'inside the grace the live check waits');
  assert.equal(minimumStop({ wpm: 100 }, quick, { elapsedMs: 2500, finished: true }).atEnd, true);
  assert.equal(minimumStop(null, quick, { elapsedMs: 2500, finished: true }), null);
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

test('replayScoreAt scores the run as it stood at each moment and ends on the run card', () => {
  const attempt = createAttempt({ id: 's', text: 'the cat' });
  attempt.events.push(
    { type: 'insert', text: 't', offsetMs: 0 },
    { type: 'insert', text: 'x', offsetMs: 1000 },
    { type: 'delete', count: 1, offsetMs: 1500 },
    { type: 'insert', text: 'h', offsetMs: 2000 },
    { type: 'insert', text: 'e', offsetMs: 2500 },
    { type: 'insert', text: ' ', offsetMs: 3000 },
    { type: 'insert', text: 'c', offsetMs: 3500 },
    { type: 'insert', text: 'q', offsetMs: 4000 },
    { type: 'insert', text: 't', offsetMs: 4500 },
  );
  const completed = completeAttempt(attempt, { endedAt: 4500 });
  // "th" typed in 2.2 s, from t, x (a first-try miss), h.
  assert.deepEqual(replayScoreAt(completed, 2200), { wpm: 11, accuracy: 67, errors: 1, elapsedMs: 2200 });
  // The x was corrected but still counts; the q is a second first-try miss.
  assert.deepEqual(replayScoreAt(completed, 4000), { wpm: 15, accuracy: 71, errors: 2, elapsedMs: 4000 });
  const end = replayScoreAt(completed, replaySpan(completed).end);
  assert.deepEqual(end, { wpm: 16, accuracy: 75, errors: 2, elapsedMs: 4500 });
  assert.deepEqual({ wpm: end.wpm, accuracy: end.accuracy }, completed.summary.score);
  assert.equal(end.errors, completed.summary.firstAttempts.filter((item) => !item.correct).length);

  // A timed run that idles to its timer: elapsed runs on with the clock, not from the last key.
  const timed = completeAttempt({ ...attempt, startedAt: 0 }, { endedAt: 15000 });
  assert.deepEqual(replayScoreAt(timed, 9000), { wpm: 8, accuracy: 75, errors: 2, elapsedMs: 9000 });
  const timedEnd = replayScoreAt(timed, replaySpan(timed).end);
  assert.deepEqual(timedEnd, { wpm: 5, accuracy: 75, errors: 2, elapsedMs: 15000 });
  assert.deepEqual({ wpm: timedEnd.wpm, accuracy: timedEnd.accuracy }, timed.summary.score);
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

test('condition keys without a standard recipe stay byte-identical', () => {
  const practice = { mode: 'time', duration: 30, count: null, punctuation: false, quoteLength: null, difficulty: null,
    wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en' };
  assert.equal(conditionKey(practice), 'time:30::plain:::200:physical-keyboard:relaxed:original-en-v6:stilltype-metrics-v1');
  assert.equal(conditionKey({ ...practice, recipe: null }), conditionKey(practice));
  assert.equal(conditionKey({}), ':::plain::::physical-keyboard:mandatory:original-en-v6:stilltype-metrics-v1');
});

test('the standard test is its own condition, versioned by recipe', () => {
  const standard = standardConditions();
  assert.equal(STANDARD_VERSION, 'standard-v1');
  assert.equal(STANDARD_SECONDS, 60);
  assert.deepEqual({ mode: standard.mode, duration: standard.duration, punctuation: standard.punctuation, wordList: standard.wordList,
    correctionPolicy: standard.correctionPolicy, recipe: standard.recipe }, { mode: 'standard', duration: 60, punctuation: true,
    wordList: null, correctionPolicy: 'mandatory', recipe: 'standard-v1' });
  assert.equal(conditionKey(standard), 'standard:60::punctuation::::physical-keyboard:mandatory:original-en-v6:stilltype-metrics-v1:standard-v1');
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
  assert.equal(failureFor('fail-word', 'the cat', 'the cx', 't'), 'word error');
  assert.equal(failureFor('fail-word', 'the cat', 'the ca', 'x'), 'word error');
  assert.equal(failureFor('fail-word', 'the cat', 'the ca', 't'), null);
  assert.equal(failureFor('fail-word', 'the cat sat', 'thexcat', ' '), 'word error');
  // The end of a timed run is a word boundary: an unfinished wrong word fails.
  assert.equal(failureAtEnd('fail-word', 'the cat sat', 'the cx'), 'word error');
  assert.equal(failureAtEnd('fail-word', 'the cat sat', 'the ca'), null);
  assert.equal(failureAtEnd('fail-any', 'the cat sat', 'the cx'), 'wrong key');
  assert.equal(failureAtEnd('relaxed', 'the cat sat', 'the cx'), null);
  assert.equal(failureAtEnd('no-backspace', 'the cat sat', 'the cx'), null);
  assert.equal(failureAtEnd('fail-word', 'the cat sat', ''), null);
  assert.equal(failureFor('relaxed', 'the cat', 'th', 'x'), null);
  const attempt = createAttempt({ id: 'nb', text: 'ab', textId: 'one', conditions: { correctionPolicy: 'no-backspace' } });
  assert.equal(passageComplete(attempt, 'ax'), true);
  const keys = new Set(CORRECTION_POLICIES.map((correctionPolicy) => conditionKey({ correctionPolicy })));
  assert.equal(keys.size, CORRECTION_POLICIES.length);
});

test('stored correction preferences migrate without filling unchosen settings', async () => {
  const { normalizeProfile, preferencesInUse } = await import('../src/profile.js');
  assert.equal(preferencesInUse({}).correction, 'relaxed');
  assert.equal(preferencesInUse({ stopOnError: true }).correction, 'mandatory');
  assert.equal(preferencesInUse({ correction: 'fail-word' }).stopOnError, false);
  assert.deepEqual(normalizeProfile({ version: 2, preferences: {} }).preferences, {});
  assert.deepEqual(normalizeProfile({ version: 2, preferences: { stopOnError: true } }).preferences,
    { stopOnError: true, correction: 'mandatory' });
});

test('a newer stop-on-error edit from an older client beats a stale correction preference', async () => {
  const { normalizeProfile } = await import('../src/profile.js');
  const { mergeSynced } = await import('../src/account.js');
  const first = '2026-10-14T01:00:00.000Z';
  const second = '2026-10-14T02:00:00.000Z';
  const newerBuild = normalizeProfile({ version: 2, preferences: { correction: 'fail-any', stopOnError: false },
    preferencesAt: { correction: first, stopOnError: first } });
  const olderBuild = normalizeProfile({ version: 2, preferences: { correction: 'fail-any', stopOnError: true },
    preferencesAt: { correction: first, stopOnError: second } });
  for (const merged of [mergeSynced(newerBuild, olderBuild), mergeSynced(olderBuild, newerBuild)]) {
    assert.equal(merged.preferences.correction, 'mandatory');
    assert.equal(merged.preferencesAt.correction, second);
  }
  assert.equal(newerBuild.preferences.correction, 'fail-any');
});

// Strict space and quick end. Master's rules are the defaults: a space anywhere is typed into
// that position, and a continue-on-error run ends on its last letter, right or wrong.
const defaults = { mode: 'words', duration: null, count: 10, punctuation: false, quoteLength: null, difficulty: null,
  wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en' };

test('default strict space and quick end keep the condition key byte-identical', () => {
  const master = 'words::10:plain:::200:physical-keyboard:relaxed:original-en-v6:stilltype-metrics-v1';
  assert.equal(conditionKey(defaults), master);
  assert.equal(conditionKey({ ...defaults, strictSpace: false, quickEnd: true }), master);
  assert.equal(conditionKey({ mode: 'time', duration: 30, wordList: '200', correctionPolicy: 'relaxed', strictSpace: false, quickEnd: true }),
    'time:30::plain:::200:physical-keyboard:relaxed:original-en-v6:stilltype-metrics-v1');
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

test('minimum settings are stored like any other choice: off by default, unknown values read as off', async () => {
  const { normalizeProfile, preferencesInUse } = await import('../src/profile.js');
  assert.equal(preferencesInUse({}).minAccuracy, 0);
  assert.equal(preferencesInUse({}).minWpm, 0);
  assert.deepEqual(normalizeProfile({ version: 2, preferences: {} }).preferences, {}, 'an unchosen minimum is not stored');
  assert.deepEqual(normalizeProfile({ version: 2, preferences: { minAccuracy: 95, minWpm: 40 } }).preferences, { minAccuracy: 95, minWpm: 40 });
  assert.deepEqual(normalizeProfile({ version: 2, preferences: { minAccuracy: 97, minWpm: '40' } }).preferences, { minAccuracy: 0, minWpm: 0 });
});

test('adaptive passages are real lowercase words, about half of them holding a recurring pair', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const passage = makeAdaptive(['br', 'ou'], { mode: 'words', count: 100, random });
  const words = passage.text.split(' ');
  assert.equal(words.length, 100);
  assert.equal(passage.adaptive, true);
  assert.equal(words.every((word) => /^[a-z]+$/.test(word)), true);
  const holding = words.filter((word) => word.includes('br') || word.includes('ou')).length;
  assert.ok(holding >= 35 && holding <= 80, `${holding} of 100 hold a pair`);
  assert.ok(words.some((word) => word.includes('br')) && words.some((word) => word.includes('ou')));
  assert.equal(makeAdaptive(['qx']), null);
});

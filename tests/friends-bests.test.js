import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORPUS_VERSION, CORRECTION_POLICIES, INPUT_CLASSES, METRIC_VERSION, QUOTE_DIFFICULTIES, QUOTE_LENGTHS, TEST_COUNTS, TEST_DURATIONS,
  conditionKey } from '../src/typing.js';
import { wordListIds } from '../src/words.js';
import { layoutLabel } from '../src/layouts.js';
import { BOARD_V, MAX_SHAPES, bestsOrder, boardColumn, boardCurrent, boardShapes, boardSummary, defaultShape, shapeBests, shapeDescription, shapeLabels,
  shapeOf, shareableBest } from '../src/friends-board.js';
import { boardBests } from '../e2e/fake-board.js';

const base = { mode: 'time', duration: 60, count: null, punctuation: false, numbers: false, quoteLength: null, difficulty: null, wordList: '200',
  inputClass: 'physical-keyboard', correctionPolicy: 'mandatory', language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };

const time60 = base;
const time30 = { ...base, duration: 30 };
const words25 = { ...base, mode: 'words', duration: null, count: 25, correctionPolicy: 'relaxed' };
const quote = { ...base, mode: 'quote', duration: null, wordList: null, quoteLength: 'medium', difficulty: 'any' };
const touch60 = { ...base, inputClass: 'touch' };
const key = conditionKey;

const run = (id, overrides = {}) => ({ id, at: '2026-10-09T12:00:00Z', status: 'complete', kind: 'test', interrupted: false,
  conditions: time60, score: { wpm: 70, accuracy: 97 }, elapsedMs: 60000, challengeDate: null, ...overrides });

const score = (wpm, accuracy) => ({ score: { wpm, accuracy } });

// Every test shape this build can write, as src/app.js conditions() writes them from the app's own
// option lists: each mode with its own fields, and none of the others'. Numbers apply to generated
// tests only; a quote always records them off.
function writtenShapes() {
  const shapes = [];

  for (const inputClass of INPUT_CLASSES) for (const correctionPolicy of CORRECTION_POLICIES) for (const punctuation of [false, true]) {
    const common = { punctuation, numbers: false, quoteLength: null, difficulty: null, inputClass, correctionPolicy, language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };

    for (const numbers of [false, true]) for (const wordList of wordListIds) {
      for (const duration of TEST_DURATIONS) shapes.push({ ...common, numbers, mode: 'time', duration, count: null, wordList });

      for (const count of TEST_COUNTS) shapes.push({ ...common, numbers, mode: 'words', duration: null, count, wordList });
    }

    for (const quoteLength of QUOTE_LENGTHS) {
      for (const difficulty of QUOTE_DIFFICULTIES) shapes.push({ ...common, mode: 'quote', duration: null, count: null, quoteLength, difficulty, wordList: null });
    }
  }

  return shapes;
}

test('only runs that can set a personal best are shared: completed, uninterrupted practice tests and retests', () => {
  const runs = [
    run('test', score(72, 96)),
    run('retest', { kind: 'retest', ...score(75, 94) }),
    run('drill', { kind: 'drill', ...score(120, 100) }),
    run('daily', { kind: 'daily', challengeDate: '2026-10-09', ...score(118, 99) }),
    run('race', { kind: 'race', ...score(117, 99) }),
    run('custom', { kind: 'custom', ...score(116, 99) }),
    run('practice', { kind: 'practice', ...score(115, 99) }),
    run('interrupted', { interrupted: true, ...score(114, 99) }),
    run('abandoned', { status: 'interrupted', ...score(113, 99) }),
    run('custom-mode', { conditions: { ...time60, mode: 'custom' }, ...score(112, 99) }),
    run('undated', { at: null, ...score(111, 99) }),
    run('impossible', score(401, 100)),
  ];

  assert.deepEqual(shapeBests(runs), { [key(time60)]: { wpm: 75, accuracy: 94, date: '2026-10-09' } });
});

test('a best is shared only from fresh text: a completed test on text already seen is not one, and a run saved before the field still counts', () => {
  // An exhausted quote pool hands back seen text and marks the run `fresh: false`.
  const repeated = run('repeated', { conditions: quote, fresh: false, ...score(110, 99) });
  const seenRetest = run('seen-retest', { kind: 'retest', fresh: false, ...score(105, 99) });
  const fresh = run('fresh', { fresh: true, ...score(72, 96) });
  const older = run('older', { conditions: words25, ...score(58, 92) });
  assert.equal(shareableBest(repeated), false);
  assert.equal(shareableBest(seenRetest), false);
  assert.equal(shareableBest(fresh), true);
  assert.equal(shareableBest(older), true);
  const expected = { [key(time60)]: { wpm: 72, accuracy: 96, date: '2026-10-09' }, [key(words25)]: { wpm: 58, accuracy: 92, date: '2026-10-09' } };
  assert.deepEqual(shapeBests([repeated, seenRetest, fresh, older]), expected);
  assert.deepEqual(boardSummary([repeated, seenRetest, fresh, older], 'daily-key').bests, expected);
});

test('a shape’s best is the fastest run, then the more accurate, then the earlier, dated by its run’s own UTC day', () => {
  const runs = [
    run('slow', { at: '2026-10-01T09:00:00Z', ...score(64, 99) }),
    run('first-fast', { at: '2026-10-03T09:00:00Z', ...score(81, 95) }),
    run('accurate-fast', { at: '2026-10-05T09:00:00Z', ...score(81, 97) }),
    run('same-later', { at: '2026-10-07T09:00:00Z', ...score(81, 97) }),
    run('words', { conditions: words25, at: '2026-10-08T23:30:00Z', ...score(58, 92) }),
    run('touch', { conditions: touch60, ...score(49, 90) }),
  ];

  assert.deepEqual(shapeBests(runs), {
    [key(time60)]: { wpm: 81, accuracy: 97, date: '2026-10-05' },
    [key(words25)]: { wpm: 58, accuracy: 92, date: '2026-10-08' },
    [key(touch60)]: { wpm: 49, accuracy: 90, date: '2026-10-09' },
  });

  // Whichever device writes the summary, and whatever its clock reads, the dates are the runs' own.
  for (const clock of ['2026-10-08T23:50:00Z', '2026-10-12T10:00:00Z', '2025-01-01T00:00:00Z']) {
    mock.timers.enable({ apis: ['Date'], now: Date.parse(clock) });

    try { assert.equal(shapeBests(runs)[key(words25)].date, '2026-10-08', clock); } finally { mock.timers.reset(); }
  }
});

test('at most 16 shapes are shared: the ones with the most runs, then the most recently run', () => {
  // Twenty shapes this build writes, numbered from 1: the first fourteen run three times, the rest once.
  const shape = (number) => writtenShapes()[number - 1];
  const runs = [];

  for (let number = 1; number <= 20; number += 1) {
    for (let i = 0; i < (number <= 14 ? 3 : 1); i += 1) runs.push(run(`${number}-${i}`, { conditions: shape(number), at: `2026-10-0${1 + (number % 9)}T12:00:00Z` }));
  }

  const bests = shapeBests(runs);
  assert.equal(Object.keys(bests).length, MAX_SHAPES);

  for (let number = 1; number <= 14; number += 1) assert.ok(key(shape(number)) in bests);
  // Of the six run once, the two most recent stay: the 17th (on the 9th) and the 16th (on the 8th).
  assert.ok(key(shape(17)) in bests && key(shape(16)) in bests);

  for (const number of [15, 18, 19, 20]) assert.ok(!(key(shape(number)) in bests));
  // The service shows every one of them.
  assert.deepEqual(boardBests(bests), bests);

  for (const shape of Object.keys(bests)) assert.match(shape, /^[A-Za-z0-9:._+-]{1,200}$/, 'the service accepts the key');
});

test('a best keeps the date of its own run, and the service shows it whatever that date is', () => {
  // Stored while a clock was days ahead, or years behind: each is that run's best, dated as stored. The
  // summary no longer has limits to fit a service's clock: a best is shown as the row holds it.
  const runs = [
    run('real', { at: '2026-10-08T10:00:00Z', ...score(70, 95) }),
    run('ahead', { conditions: time30, at: '2026-10-16T10:00:00Z', ...score(72, 95) }),
    run('behind', { conditions: words25, at: '2025-12-31T23:00:00Z', ...score(90, 99) }),
  ];

  const { bests } = boardSummary(runs, 'daily-key');
  assert.deepEqual(bests, { [key(time60)]: { wpm: 70, accuracy: 95, date: '2026-10-08' }, [key(time30)]: { wpm: 72, accuracy: 95, date: '2026-10-16' },
    [key(words25)]: { wpm: 90, accuracy: 99, date: '2025-12-31' } });
  assert.deepEqual(boardBests(bests), bests);

  for (let days = -400; days <= 400; days += 37) {
    const at = new Date(Date.parse('2026-10-09T15:00:00Z') + days * 86400000).toISOString();
    const withRun = boardSummary([...runs, run(`d${days}`, { at, ...score(99, 99) })], 'daily-key').bests;
    assert.deepEqual(boardBests(withRun), withRun, at);
  }
});

test('the 16 shapes shared are this build’s first, however many runs another version’s have', () => {
  const runs = [];

  for (let seconds = 1; seconds <= 16; seconds += 1) {
    for (let i = 0; i < 5; i += 1) runs.push(run(`old-${seconds}-${i}`, { conditions: { ...time60, duration: seconds, corpus: 'original-en-v4' } }));
  }

  runs.push(run('current-1', score(74, 96)), run('current-2', { conditions: words25 }));
  const bests = shapeBests(runs);
  assert.equal(Object.keys(bests).length, MAX_SHAPES);
  assert.deepEqual(bests[key(time60)], { wpm: 74, accuracy: 96, date: '2026-10-09' });
  assert.ok(key(words25) in bests);
  assert.equal(Object.keys(bests).filter((shape) => shapeOf(shape)).length, 2);
});

test('bests come from the runs in the copy saved: a clear’s empty copy has none, and its undo’s copy has them back', () => {
  const runs = [run('earlier', { at: '2026-10-09T10:00:00Z', ...score(96, 99) }), run('later', { at: '2026-10-09T12:00:00Z', ...score(71, 95) })];
  const at = '2026-10-09T15:00:00.000Z';
  assert.deepEqual(boardColumn(runs, 'daily-key', at).bests, { [key(time60)]: { wpm: 96, accuracy: 99, date: '2026-10-09' } });
  assert.deepEqual(boardColumn([], 'daily-key', at).bests, {});
  assert.deepEqual(boardColumn(runs.slice(1), 'daily-key', at).bests, { [key(time60)]: { wpm: 71, accuracy: 95, date: '2026-10-09' } });
});

test('a row saved before bests reads as out of date, so the next load writes its bests', () => {
  const at = '2026-10-09T15:00:00.000Z';
  assert.equal(BOARD_V, 2);
  assert.equal(boardColumn([], 'daily-key', at).v, 2);
  assert.equal(boardCurrent({ updated_at: at, board: { v: 1, at, days: {}, weeks: {} } }), false);
  assert.equal(boardCurrent({ updated_at: at, board: boardColumn([], 'daily-key', at) }), true);
});

test('a condition key is compared only when this build writes it the same way', () => {
  for (const conditions of [time60, time30, words25, quote, touch60, { ...time60, punctuation: true },
    { ...time60, numbers: true }, { ...words25, punctuation: true, numbers: true }]) {
    assert.deepEqual(shapeOf(key(conditions)) && key(shapeOf(key(conditions))), key(conditions));
  }

  // Numbers ride on the text part, and keys without them stay as they were before the toggle.
  assert.equal(key({ ...time60, numbers: true }), key(time60).replace(':plain:', ':plain+numbers:'));
  assert.equal(shapeOf(key({ ...time60, numbers: true })).numbers, true);
  // A quote never records numbers, and the text part takes no other addition.
  assert.equal(shapeOf(key({ ...quote, numbers: true })), null);
  assert.equal(shapeOf(key(time60).replace(':plain:', ':plain+symbols:')), null);
  assert.equal(shapeOf(key(time60).replace(':plain:', ':numbers:')), null);
  // A numbers test's best travels under its own key, which the service accepts.
  const numbersBests = shapeBests([run('numbers', { conditions: { ...time60, numbers: true } })]);
  assert.deepEqual(Object.keys(numbersBests), [key({ ...time60, numbers: true })]);
  assert.deepEqual(boardBests(numbersBests), numbersBests);
  assert.equal(shapeOf(key({ ...time60, metricVersion: 'stilltype-metrics-v0' })), null);
  assert.equal(shapeOf(key({ ...time60, corpus: 'original-en-v4' })), null);
  assert.equal(shapeOf(`${key(time60)}:extra-field`), null);
  assert.equal(shapeOf(key({ ...time60, mode: 'zen' })), null);
  assert.equal(shapeOf('time:060::plain:::200:physical-keyboard:mandatory:original-en-v6:stilltype-metrics-v1'), null);
  assert.equal(shapeOf(null), null);
});

test('every key this build can write is listed, read back as the conditions it was written from', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const wordList = html.match(/<fieldset[^>]*id="word-list"[^>]*>([^]*?)<\/fieldset>/)[1];

  const offeredWords = [...wordList.matchAll(/<input[^>]*value="([^"]*)"[^>]*>/g)]
    .filter(([input]) => !input.includes(' disabled')).map(([, value]) => value);

  assert.deepEqual(offeredWords, wordListIds);
  const shapes = writtenShapes();
  assert.equal(new Set(shapes.map((conditions) => key(conditions))).size, shapes.length);

  for (const conditions of shapes) assert.deepEqual(shapeOf(key(conditions)), conditions, key(conditions));
});

test('a key that reads back the same but holds a value this build never writes is never listed', () => {
  const words10 = { ...words25, count: 10 };

  const never = [
    // An input class, quote filter, word list, length or correction policy the app doesn't offer.
    { ...time60, inputClass: 'stylus' },
    { ...touch60, inputClass: 'touch-screen' },
    { ...quote, difficulty: 'brutal' },
    { ...quote, difficulty: 'plain' },
    { ...quote, quoteLength: 'epic' },
    { ...time60, wordList: '50k' },
    { ...time60, wordList: 'every-word-ever' },
    { ...time60, duration: 4 },
    { ...time60, duration: 3600 },
    { ...words10, count: 501 },
    { ...time60, correctionPolicy: 'lenient' },
    // A field its mode doesn't have, or one it leaves empty.
    { ...time60, count: 25 },
    { ...time60, quoteLength: 'medium' },
    { ...words10, difficulty: 'any' },
    { ...words10, duration: 60 },
    { ...quote, wordList: '200' },
    { ...quote, duration: 60 },
    { ...time60, wordList: null },
    { ...quote, difficulty: null },
  ];

  for (const conditions of never) {
    // Each key has the eleven parts, and read part by part and written again by the app's own
    // conditionKey it is the same key...
    const parts = key(conditions).split(':');
    assert.equal(parts.length, 11);
    const [mode, duration, count, punctuation, quoteLength, difficulty, wordList, inputClass, correctionPolicy, corpus, metricVersion] = parts;
    assert.equal(key({ mode, duration: Number(duration) || null, count: Number(count) || null, punctuation: punctuation === 'punctuation',
      quoteLength, difficulty, wordList, inputClass, correctionPolicy, corpus, metricVersion }), key(conditions));
    // ...but names a shape this build never writes, so the picker never offers it.
    assert.equal(shapeOf(key(conditions)), null, key(conditions));
  }

  const bests = Object.fromEntries(never.map((conditions) => [key(conditions), { wpm: 99, accuracy: 99, date: '2026-10-08' }]));
  assert.deepEqual(boardShapes([{ name: 'Lin', bests }]), []);
});

test('the picker lists comparable shapes in order and names each by what tells it apart', () => {
  const rows = [
    { self: true, bests: { [key(words25)]: { wpm: 58, accuracy: 92, date: '2026-10-08' }, [key(time60)]: { wpm: 81, accuracy: 97, date: '2026-10-05' } } },
    { name: 'Lin', bests: { [key(quote)]: { wpm: 66, accuracy: 96, date: '2026-10-02' }, [key(time30)]: { wpm: 90, accuracy: 96, date: '2026-10-02' },
      [key({ ...time60, metricVersion: 'stilltype-metrics-v0' })]: { wpm: 99, accuracy: 99, date: '2026-09-02' } } },
  ];

  const shapes = boardShapes(rows);
  assert.deepEqual(shapes.map((shape) => shape.key), [key(time30), key(time60), key(words25), key(quote)]);
  // Length and text first, then what differs: a quote's missing word list is not a difference.
  assert.deepEqual(shapeLabels(shapes), ['30 s · plain · stop on error', '60 s · plain · stop on error',
    '25 words · plain · continue on error', 'medium quote · any · stop on error']);
  const relaxedQuote = { ...quote, correctionPolicy: 'relaxed' };
  assert.deepEqual(shapeLabels(boardShapes([{ bests: { [key(time60)]: {}, [key({ ...time60, correctionPolicy: 'relaxed' })]: {}, [key(relaxedQuote)]: {} } }])),
    ['60 s · plain · stop on error', '60 s · plain · continue on error', 'medium quote · any · continue on error']);
  // Word lists are compared between the shapes that have one.
  assert.deepEqual(shapeLabels(boardShapes([{ bests: { [key(time60)]: {}, [key({ ...time60, wordList: '1k' })]: {}, [key(quote)]: {} } }])),
    ['60 s · plain · english 1k', '60 s · plain · english 200', 'medium quote · any']);
  // When the shapes differ only in length and text, that is all the picker says.
  assert.deepEqual(shapeLabels(boardShapes([{ bests: { [key(time30)]: {}, [key(time60)]: {} } }])), ['30 s · plain', '60 s · plain']);
  assert.deepEqual(shapeLabels(boardShapes([{ bests: { [key(time60)]: {}, [key(touch60)]: {} } }])), ['60 s · plain · physical keyboard', '60 s · plain · touch input']);
  // A numbers test is told apart by its text part, as the app describes it.
  const numbers60 = { ...time60, numbers: true };
  assert.deepEqual(shapeLabels(boardShapes([{ bests: { [key(time60)]: {}, [key(numbers60)]: {} } }])), ['60 s · plain', '60 s · plain · numbers']);
  assert.deepEqual(boardShapes([{ bests: {} }, { bests: undefined }]), []);
});

test('two quote shapes that differ only by the punctuation setting their keys keep are told apart', () => {
  const withSetting = { ...quote, punctuation: true };
  const shapes = boardShapes([{ bests: { [key(quote)]: {} } }, { bests: { [key(withSetting)]: {}, [key(time60)]: {} } }]);
  assert.deepEqual(shapes.map((shape) => shape.key), [key(time60), key(quote), key(withSetting)]);
  assert.deepEqual(shapeLabels(shapes), ['60 s · plain', 'medium quote · any · punctuation off', 'medium quote · any · punctuation on']);
  // The description names only what the picker's name leaves out and isn't the usual: here, the correction rule.
  assert.equal(shapeDescription(shapes, key(withSetting)), 'stop on error');
  // When the setting tells nothing apart, neither the name nor the description mentions it.
  const one = boardShapes([{ bests: { [key(withSetting)]: {}, [key(time60)]: {} } }]);
  assert.deepEqual(shapeLabels(one), ['60 s · plain', 'medium quote · any']);
  assert.equal(shapeDescription(one, key(withSetting)), 'stop on error');
  assert.equal(shapeDescription(one, key(time60)), 'stop on error');
  // At the usual word list, input and correction there is nothing to add.
  assert.equal(shapeDescription(boardShapes([{ bests: { [key({ ...time60, correctionPolicy: 'relaxed' })]: {} } }]), key({ ...time60, correctionPolicy: 'relaxed' })), '');
  const touch1k = { ...time60, wordList: '1k', inputClass: 'touch' };
  assert.equal(shapeDescription(boardShapes([{ bests: { [key(touch1k)]: {} } }]), key(touch1k)), 'english 1k · touch input · stop on error');
});

test('a Dvorak or strict-space shape is told apart by the app\'s own words for it, in the name and the description', () => {
  for (const [other, words] of [[{ ...time60, layout: 'dvorak' }, layoutLabel('dvorak')], [{ ...time60, strictSpace: true }, 'strict space']]) {
    const shapes = boardShapes([{ bests: { [key(time60)]: {}, [key(other)]: {} } }]);
    assert.deepEqual(shapes.map((shape) => shape.key), [key(time60), key(other)]);
    assert.deepEqual(shapeLabels(shapes), ['60 s · plain', `60 s · plain · ${words}`]);
    // The name already says it, so the description doesn't repeat it.
    assert.equal(shapeDescription(shapes, key(other)), 'stop on error');
    assert.ok(!shapeDescription(shapes, key(other)).includes(words));
  }
});

test('the picker opens on the shape you have the most runs on, then the one most people have a best on', () => {
  const rows = [{ self: true, bests: { [key(time60)]: {} } }, { name: 'Lin', bests: { [key(time30)]: {}, [key(time60)]: {} } }, { name: 'Mo', bests: { [key(time30)]: {} } }];
  const shapes = boardShapes(rows);
  const runs = [run('a', { conditions: time30 }), run('b'), run('c'), run('drill', { kind: 'drill', conditions: time30 }), run('d', { kind: 'daily', conditions: time30 })];
  assert.equal(defaultShape(shapes, runs, rows), key(time60));
  assert.equal(defaultShape(shapes, [...runs, run('e', { conditions: time30 }), run('f', { conditions: time30 })], rows), key(time30));
  // Runs only on a shape nobody here has a best on: the one most people have a best on.
  assert.equal(defaultShape(shapes, [run('g', { conditions: quote })], rows), key(time30));
  assert.equal(defaultShape(boardShapes([{ bests: { [key(time60)]: {}, [key(time30)]: {} } }]), [], []), key(time30));
  assert.equal(defaultShape([], runs, rows), null);
});

test('rows on a shape: fastest first, accuracy breaks a tie, another build’s best is never compared', () => {
  const best = (wpm, accuracy) => ({ wpm, accuracy, date: '2026-10-05' });

  const rows = [
    { self: true, bests: { [key(time60)]: best(78, 96) } },
    { name: 'Lin', bests: { [key(time60)]: best(78, 98), [key(time30)]: best(110, 99) } },
    { name: 'Ana', bests: { [key({ ...time60, metricVersion: 'stilltype-metrics-v2' })]: best(104, 99) } },
    { name: 'Sam', bests: {} },
    { name: 'Kai', bests: { [key(time60)]: best(91, 93) } },
  ];

  const ordered = bestsOrder(rows, key(time60));
  assert.deepEqual(ordered.map((row) => row.name || 'you'), ['Kai', 'Lin', 'you', 'Ana', 'Sam']);
  assert.deepEqual(ordered.map((row) => row.best?.wpm ?? null), [91, 78, 78, null, null]);
  assert.deepEqual(ordered.map((row) => row.otherVersion), [false, false, false, true, false]);
});

test('the fake service reads bests as the migration does: each shape on its own, at most 16', () => {
  const at = (wpm, accuracy, date) => ({ wpm, accuracy, date });
  const good = at(84, 97, '2026-10-09');
  assert.deepEqual(boardBests({ a: good, b: at(401, 97, '2026-10-09'), c: at(84, 101, '2026-10-09'), d: at(84.5, 97, '2026-10-09'),
    e: at(84, 97, '2026-10-9'), 'f g': good, h: '84', i: [84], j: { ...good, note: 'x' } }), { a: good, j: good });
  assert.deepEqual(boardBests(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, good]))), {});
  assert.equal(Object.keys(boardBests(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, good])))).length, 16);

  for (const value of [null, undefined, [], 'fast', 7]) assert.deepEqual(boardBests(value), {});
});

// The bests migration replaces board_numbers to add the summary's bests to what it returns. It must
// stay the friends board migration's function otherwise: a change made there later has to be carried
// over, or this fails.
test('the bests migration changes board_numbers only by adding the bests', () => {
  const board = readFileSync(new URL('../supabase/migrations/20261009120000_friends_board.sql', import.meta.url), 'utf8');
  const bests = readFileSync(new URL('../supabase/migrations/20261009150000_friends_bests.sql', import.meta.url), 'utf8');
  const signature = 'function race_private.board_numbers(p_board jsonb, p_at timestamptz, p_today date, p_week date)';

  const body = (text, prefix) => {
    const start = text.indexOf(`${prefix}${signature}`);
    assert.ok(start >= 0, `${prefix}${signature} is defined`);

    return text.slice(start + prefix.length, text.indexOf('\nend $$;', start) + '\nend $$;'.length);
  };

  const earlier = body(board, 'create ');
  const later = body(bests, 'create or replace ');
  const returned = "  return jsonb_build_object('daily', v_daily, 'week', v_week);";
  assert.ok(earlier.includes(returned));
  assert.equal(later, earlier.replace(returned, "  return jsonb_build_object('daily', v_daily, 'week', v_week, 'bests', race_private.board_bests(p_board->'bests'));"));
});

test('board shapes keep rule suffixes and layouts together in the canonical order', () => {
  for (const layout of ['qwerty', 'dvorak']) {
    for (const strictSpace of [false, true]) {
      for (const quickEnd of [false, true]) {
        const conditions = { ...words25, layout, strictSpace, quickEnd };
        const parsed = shapeOf(conditionKey(conditions));
        assert.ok(parsed);
        assert.equal(conditionKey(parsed), conditionKey(conditions));
      }
    }
  }
});

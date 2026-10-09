import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORPUS_VERSION, METRIC_VERSION, conditionKey } from '../src/typing.js';
import { MAX_SHAPES, bestsOrder, boardShapes, boardSummary, defaultShape, runsSince, shapeBests, shapeLabels, shapeOf } from '../src/friends-board.js';
import { bestsSince, foldBests, invalidBests } from '../e2e/fake-board.js';

const base = { mode: 'time', duration: 60, count: null, punctuation: false, quoteLength: null, difficulty: null, wordList: '200',
  inputClass: 'physical-keyboard', correctionPolicy: 'mandatory', language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
const time60 = base;
const time30 = { ...base, duration: 30 };
const words25 = { ...base, mode: 'words', duration: null, count: 25, correctionPolicy: 'relaxed' };
const quote = { ...base, mode: 'quote', duration: null, wordList: null, quoteLength: 'medium', difficulty: 'any' };
const touch60 = { ...base, inputClass: 'touch' };
const key = conditionKey;
const now = new Date('2026-10-09T15:00:00Z');
const run = (id, overrides = {}) => ({ id, at: '2026-10-09T12:00:00Z', status: 'complete', kind: 'test', interrupted: false,
  conditions: time60, score: { wpm: 70, accuracy: 97 }, elapsedMs: 60000, challengeDate: null, ...overrides });
const score = (wpm, accuracy) => ({ score: { wpm, accuracy } });
// The app's own description of conditions, in parts (as src/app.js conditionParts gives them).
const parts = (value) => ({
  language: value.wordList ? `english ${value.wordList}` : 'english',
  length: value.mode === 'time' ? `${value.duration} s` : value.mode === 'words' ? `${value.count} words` : `${value.quoteLength} quote`,
  text: value.mode === 'quote' ? value.difficulty : value.punctuation ? 'punctuation' : 'plain',
  input: value.inputClass === 'touch' ? 'touch input' : 'physical keyboard',
  correction: value.correctionPolicy === 'relaxed' ? 'continue on error' : 'stop on error',
  corpus: 'corpus v5',
  metric: 'metric v1',
});

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

test('a shape’s best is the fastest run, then the more accurate, then the earlier, dated on the service’s clock', () => {
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
  // A device whose clock reads an hour behind: 23:30 by its clock was 00:30 the next day on the service's.
  assert.equal(shapeBests(runs, 3600000)[key(words25)].date, '2026-10-09');
});

test('at most 16 shapes are shared: the ones with the most runs, then the most recently run', () => {
  const runs = [];
  for (let seconds = 1; seconds <= 20; seconds += 1) {
    const conditions = { ...time60, duration: seconds };
    for (let i = 0; i < (seconds <= 14 ? 3 : 1); i += 1) runs.push(run(`${seconds}-${i}`, { conditions, at: `2026-10-0${1 + (seconds % 9)}T12:00:00Z` }));
  }
  const bests = shapeBests(runs);
  assert.equal(Object.keys(bests).length, MAX_SHAPES);
  for (let seconds = 1; seconds <= 14; seconds += 1) assert.ok(key({ ...time60, duration: seconds }) in bests);
  // Of the four run once, the two most recent stay: 17 s (on the 9th) and 16 s (on the 8th).
  assert.ok(key({ ...time60, duration: 17 }) in bests && key({ ...time60, duration: 16 }) in bests);
  assert.ok(!(key({ ...time60, duration: 15 }) in bests) && !(key({ ...time60, duration: 20 }) in bests));
  for (const value of Object.values(bests)) assert.equal(invalidBests({ x: value }, '2026-10-09'), null);
  for (const shape of Object.keys(bests)) assert.match(shape, /^[A-Za-z0-9:._-]{1,200}$/, 'the service accepts the key');
});

test('a summary’s bests count only runs since the board’s clear, so cleared bests never travel', () => {
  const runs = [run('before', { at: '2026-10-09T10:00:00Z', ...score(96, 99) }), run('after', { at: '2026-10-09T12:00:00Z', ...score(71, 95) })];
  assert.deepEqual(boardSummary(runs, 'daily-key', now).bests, { [key(time60)]: { wpm: 96, accuracy: 99, date: '2026-10-09' } });
  assert.deepEqual(boardSummary(runsSince(runs, '2026-10-09T11:00:00Z'), 'daily-key', now).bests, { [key(time60)]: { wpm: 71, accuracy: 95, date: '2026-10-09' } });
  assert.deepEqual(boardSummary(runsSince(runs, '2026-10-09T13:00:00Z'), 'daily-key', now).bests, {});
});

test('a condition key is compared only when this build writes it the same way', () => {
  for (const conditions of [time60, time30, words25, quote, touch60, { ...time60, punctuation: true }]) {
    assert.deepEqual(shapeOf(key(conditions)) && key(shapeOf(key(conditions))), key(conditions));
  }
  assert.equal(shapeOf(key({ ...time60, metricVersion: 'stilltype-metrics-v0' })), null);
  assert.equal(shapeOf(key({ ...time60, corpus: 'original-en-v4' })), null);
  assert.equal(shapeOf(`${key(time60)}:extra-field`), null);
  assert.equal(shapeOf(key({ ...time60, mode: 'zen' })), null);
  assert.equal(shapeOf('time:060::plain:::200:physical-keyboard:mandatory:original-en-v5:stilltype-metrics-v1'), null);
  assert.equal(shapeOf(null), null);
});

test('the picker lists comparable shapes in order and names each by what tells it apart', () => {
  const rows = [
    { self: true, bests: { [key(words25)]: { wpm: 58, accuracy: 92, date: '2026-10-08' }, [key(time60)]: { wpm: 81, accuracy: 97, date: '2026-10-05' } } },
    { name: 'Lin', bests: { [key(quote)]: { wpm: 66, accuracy: 96, date: '2026-10-02' }, [key(time30)]: { wpm: 90, accuracy: 96, date: '2026-10-02' },
      [key({ ...time60, metricVersion: 'stilltype-metrics-v0' })]: { wpm: 99, accuracy: 99, date: '2026-09-02' } } },
  ];
  const shapes = boardShapes(rows);
  assert.deepEqual(shapes.map((shape) => shape.key), [key(time30), key(time60), key(words25), key(quote)]);
  assert.deepEqual(shapeLabels(shapes, parts), ['english 200 · 30 s · plain · stop on error', 'english 200 · 60 s · plain · stop on error',
    'english 200 · 25 words · plain · continue on error', 'english · medium quote · any · stop on error']);
  // When the shapes differ only in length and text, that is all the picker says.
  assert.deepEqual(shapeLabels(boardShapes([{ bests: { [key(time30)]: {}, [key(time60)]: {} } }]), parts), ['30 s · plain', '60 s · plain']);
  assert.deepEqual(shapeLabels(boardShapes([{ bests: { [key(time60)]: {}, [key(touch60)]: {} } }]), parts), ['60 s · plain · physical keyboard', '60 s · plain · touch input']);
  assert.deepEqual(boardShapes([{ bests: {} }, { bests: undefined }]), []);
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

test('the fake service folds and cuts bests as the migration does', () => {
  const at = (wpm, accuracy, date) => ({ wpm, accuracy, date });
  assert.deepEqual(foldBests({ a: at(80, 97, '2026-10-01'), b: at(70, 90, '2026-10-02') }, { a: at(80, 97, '2026-10-05'), b: at(71, 80, '2026-10-06') }),
    { a: at(80, 97, '2026-10-01'), b: at(71, 80, '2026-10-06') });
  assert.deepEqual(bestsSince({ a: at(1, 1, '2026-10-07'), b: at(1, 1, '2026-10-08'), c: at(1, 1, '2026-10-09') }, '2026-10-09T08:00:00Z'),
    { b: at(1, 1, '2026-10-08'), c: at(1, 1, '2026-10-09') });
  assert.equal(invalidBests({ a: at(84, 97, '2026-10-11') }, '2026-10-09'), 'That best is outside the board limits.');
  assert.equal(invalidBests({ 'a b': at(84, 97, '2026-10-09') }, '2026-10-09'), 'Invalid bests.');
});

// The bests migration copies the two board functions of the friends board migration and adds lines for
// bests. Every added line mentions bests, so taking those out must give back the earlier functions
// exactly: a change made to them later has to be carried over, or this fails.
test('the bests migration changes the board functions only by lines about bests', () => {
  const board = readFileSync(new URL('../supabase/migrations/20261009120000_friends_board.sql', import.meta.url), 'utf8');
  const bests = readFileSync(new URL('../supabase/migrations/20261009150000_friends_bests.sql', import.meta.url), 'utf8');
  const body = (text, signature, end) => {
    const start = text.indexOf(signature);
    assert.ok(start >= 0, `${signature} is defined`);
    return text.slice(start + signature.length, text.indexOf(end, start) + end.length);
  };
  const withoutBests = (text) => text.split('\n').filter((line) => !/best/i.test(line)).join('\n');
  for (const [signature, end] of [['function race_private.board_snapshot(p_viewer uuid)', '\n$$;'], ['function race_private.board(p_action text, p_data jsonb)', '\nend $$;']]) {
    const earlier = body(board, signature, end);
    const later = body(bests, `create or replace ${signature}`, end);
    assert.notEqual(later, earlier, 'the copy adds bests');
    assert.equal(withoutBests(later), withoutBests(earlier));
    assert.equal(withoutBests(earlier), earlier, 'the earlier function has no line about bests');
  }
});

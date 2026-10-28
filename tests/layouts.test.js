import test from 'node:test';
import assert from 'node:assert/strict';
import { CORPUS_VERSION, METRIC_VERSION, comparable, conditionKey } from '../src/typing.js';
import { filterRuns, recurringTargets } from '../src/insights.js';
import { DEFAULT_LAYOUT, fingerFor, isDefaultLayout, keyboardRows, layoutIds, layoutLabel, normalizeLayout } from '../src/layouts.js';

// conditionKey exactly as it was on master before layouts, kept here as the reference.
function masterConditionKey(conditions = {}) {
  return [
    conditions.mode,
    conditions.duration || '',
    conditions.count || '',
    conditions.punctuation ? 'punctuation' : 'plain',
    conditions.quoteLength || '',
    conditions.difficulty || '',
    conditions.wordList || '',
    conditions.inputClass || 'physical-keyboard',
    conditions.correctionPolicy || 'mandatory',
    conditions.corpus || CORPUS_VERSION,
    conditions.metricVersion || METRIC_VERSION,
  ].join(':');
}

const practice = { mode: 'time', duration: 30, count: null, punctuation: false, quoteLength: null, difficulty: null,
  wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };

test('QWERTY and legacy runs keep master’s condition key byte for byte', () => {
  assert.equal(conditionKey(practice), 'time:30::plain:::200:physical-keyboard:relaxed:original-en-v6:stilltype-metrics-v1');

  const shapes = [
    practice,
    { ...practice, mode: 'words', duration: null, count: 25, wordList: '1k', punctuation: true },
    { ...practice, mode: 'quote', duration: null, quoteLength: 'long', difficulty: 'dense', wordList: null, correctionPolicy: 'mandatory' },
    { ...practice, inputClass: 'touch' },
    {},
  ];

  for (const shape of shapes) {
    const legacy = { ...shape };
    delete legacy.layout;
    assert.equal(conditionKey(legacy), masterConditionKey(legacy));
    assert.equal(conditionKey({ ...shape, layout: 'qwerty' }), masterConditionKey(shape));
    assert.equal(conditionKey({ ...shape, layout: null }), masterConditionKey(shape));
  }
});

test('every other layout gets its own key, so bests and retests never mix layouts', () => {
  const keys = layoutIds.map((layout) => conditionKey({ ...practice, layout }));
  assert.equal(new Set(keys).size, layoutIds.length);
  assert.equal(conditionKey({ ...practice, layout: 'dvorak' }), `${masterConditionKey(practice)}:layout-dvorak`);

  const run = (id, layout, textId) => ({ id, textId, status: 'complete', kind: 'test', metricVersion: METRIC_VERSION,
    conditions: { ...practice, ...(layout ? { layout } : {}) } });

  assert.equal(comparable(run('a', 'dvorak', 'one'), run('b', 'qwerty', 'two')), false);
  assert.equal(comparable(run('a', 'dvorak', 'one'), run('b', 'dvorak', 'two')), true);
  assert.equal(comparable(run('a', null, 'one'), run('b', 'qwerty', 'two')), true);
});

test('progress filters and recurring evidence stay within one layout; legacy runs count as QWERTY', () => {
  const summary = (id, layout, at) => ({ id, at, status: 'complete', kind: 'test', fresh: true,
    conditions: { ...practice, ...(layout ? { layout } : {}) }, score: { wpm: 60, accuracy: 97 },
    patterns: [['th', 12, 2, 10, 140, 20]] });

  const runs = [summary('legacy', null, '2026-10-01T10:00:00Z'), summary('qwerty', 'qwerty', '2026-10-02T10:00:00Z'),
    summary('dvorak', 'dvorak', '2026-10-03T10:00:00Z')];

  assert.deepEqual(filterRuns(runs, conditionKey({ ...practice, layout: 'qwerty' })).map((r) => r.id), ['legacy', 'qwerty']);
  assert.deepEqual(filterRuns(runs, conditionKey({ ...practice, layout: 'dvorak' })).map((r) => r.id), ['dvorak']);
  assert.equal(recurringTargets(runs, [], { ...practice, layout: 'qwerty' })[0]?.runs, 2);
  assert.equal(recurringTargets(runs, [], { ...practice, layout: 'dvorak' }).length, 0);
});

test('each layout labels the thirty main keys with all 26 letters once', () => {
  assert.deepEqual(layoutIds, ['qwerty', 'dvorak', 'colemak', 'colemak-dh', 'workman']);

  for (const id of layoutIds) {
    const rows = keyboardRows(id);
    assert.equal(rows.length, 4, id);
    assert.deepEqual(rows.map((row) => row.length), [10, 10, 10, 1], id);
    const keys = rows.slice(0, 3).flat().map((entry) => entry.key);
    assert.equal(new Set(keys).size, 30, `${id} keys are unique`);
    assert.deepEqual(keys.filter((key) => /[a-z]/.test(key)).sort().join(''), 'abcdefghijklmnopqrstuvwxyz', id);
    assert.ok(keys.filter((key) => !/[a-z]/.test(key)).every((key) => ";,./'".includes(key)), `${id} punctuation`);
    assert.deepEqual(rows[3][0], { key: ' ', hand: 'both', finger: 'thumb', column: 0 });
  }

  assert.equal(keyboardRows('qwerty')[0].map((entry) => entry.key).join(''), 'qwertyuiop');
  assert.equal(keyboardRows('dvorak')[1].map((entry) => entry.key).join(''), 'aoeuidhtns');
  assert.equal(keyboardRows('colemak')[1].map((entry) => entry.key).join(''), 'arstdhneio');
  assert.equal(keyboardRows('colemak-dh')[2].map((entry) => entry.key).join(''), 'xcdvzkh,./');
  assert.equal(keyboardRows('workman')[0].map((entry) => entry.key).join(''), 'qdrwbjfup;');
});

test('the finger map follows touch-typing columns, with the angle mod on Colemak-DH', () => {
  const home = (id) => keyboardRows(id)[1].map((entry) => `${entry.hand[0]}${entry.finger[0]}`).join(' ');

  for (const id of layoutIds) assert.equal(home(id), 'lp lr lm li li ri ri rm rr rp', id);
  assert.deepEqual(fingerFor('qwerty', 'f'), { hand: 'left', finger: 'index' });
  assert.deepEqual(fingerFor('qwerty', 'J'), { hand: 'right', finger: 'index' });
  assert.deepEqual(fingerFor('dvorak', 's'), { hand: 'right', finger: 'pinky' });
  assert.deepEqual(fingerFor('qwerty', 'z'), { hand: 'left', finger: 'pinky' });
  assert.deepEqual(fingerFor('colemak', 'z'), { hand: 'left', finger: 'pinky' });
  // Angle mod: x on the ring finger, z stretched to the index finger.
  assert.deepEqual(fingerFor('colemak-dh', 'x'), { hand: 'left', finger: 'ring' });
  assert.deepEqual(fingerFor('colemak-dh', 'c'), { hand: 'left', finger: 'middle' });
  assert.deepEqual(fingerFor('colemak-dh', 'z'), { hand: 'left', finger: 'index' });
  assert.deepEqual(fingerFor('colemak-dh', 'k'), { hand: 'right', finger: 'index' });
  assert.deepEqual(fingerFor('workman', ' '), { hand: 'both', finger: 'thumb' });
  assert.equal(fingerFor('qwerty', '7'), null);
});

test('unknown or missing layouts normalise to QWERTY', () => {
  assert.equal(DEFAULT_LAYOUT, 'qwerty');
  assert.equal(normalizeLayout(undefined), 'qwerty');
  assert.equal(normalizeLayout('azerty'), 'qwerty');
  assert.equal(normalizeLayout('colemak-dh'), 'colemak-dh');
  assert.equal(isDefaultLayout(undefined), true);
  assert.equal(isDefaultLayout('qwerty'), true);
  assert.equal(isDefaultLayout('workman'), false);
  assert.equal(layoutLabel('colemak-dh'), 'colemak-dh');
  assert.deepEqual(keyboardRows('azerty')[0].map((entry) => entry.key).join(''), 'qwertyuiop');
});

test('friends best shapes keep alternate layouts separate', async () => {
  const { shapeOf, boardShapes } = await import('../src/friends-board.js');
  const shape = { mode: 'words', count: 25, wordList: '200', correctionPolicy: 'relaxed', corpus: CORPUS_VERSION };
  const key = conditionKey({ ...shape, layout: 'dvorak' });
  assert.equal(shapeOf(key).layout, 'dvorak');
  assert.equal(shapeOf(key.replace('layout-dvorak', 'layout-unknown')), null);
  assert.equal(boardShapes([{ bests: { [key]: { wpm: 60 } } }])[0].key, key);
});

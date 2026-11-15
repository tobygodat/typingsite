import test from 'node:test';
import assert from 'node:assert/strict';
import { dayRecords, personalBests } from '../src/progress-records.js';
import { conditionKey, CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';

const words = { mode: 'words', count: 25, punctuation: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };

const timed = { ...words, mode: 'time', count: null, duration: 15 };

let n = 0;

const run = (wpm, extra = {}) => ({ id: `r${n += 1}`, at: `2026-11-${String(10 + (n % 5)).padStart(2, '0')}T12:00:00.000Z`, kind: 'test', status: 'complete',
  interrupted: false, fresh: true, conditions: words, elapsedMs: 20_000, score: { wpm, accuracy: 96 }, ...extra });

const crowned = (runs) => runs.map((item) => personalBests(runs).has(item));

test('the first eligible run at a key is a best, then each run faster than every earlier one', () => {
  const runs = [run(60), run(58), run(64), run(63), run(70)];
  assert.deepEqual(crowned(runs), [true, false, true, false, true]);
});

test('a tie with the best so far is not a new best', () => {
  assert.deepEqual(crowned([run(60), run(60), run(61)]), [true, false, true]);
});

test('runs that may not set a best are never marked and never raise the bar', () => {
  const runs = [
    run(90, { fresh: false }),
    run(95, { kind: 'drill' }),
    run(99, { status: 'interrupted', interrupted: true }),
    run(97, { conditions: { ...words, mode: 'code', count: null } }),
    run(92, { kind: 'custom' }),
    run(50),
    run(55, { kind: 'retest' }),
  ];

  assert.deepEqual(crowned(runs), [false, false, false, false, false, true, true]);
});

test('each condition key keeps its own best', () => {
  const runs = [run(60), run(80, { conditions: timed }), run(70), run(75, { conditions: timed }), run(85, { conditions: timed })];
  assert.deepEqual(crowned(runs), [true, true, true, false, true]);
  assert.notEqual(conditionKey(words), conditionKey(timed));
});

test('nothing kept, nothing marked; a record without a score is skipped', () => {
  assert.equal(personalBests([]).size, 0);
  assert.deepEqual(crowned([{ id: 'x', kind: 'test', status: 'complete', conditions: words }, run(40)]), [false, true]);
});

test('a day counts its finished runs and keeps the fastest that may set a best', () => {
  const day = (date, wpm, extra = {}) => run(wpm, { at: `${date}T09:00:00`, ...extra });

  const records = dayRecords([
    day('2026-11-10', 60), day('2026-11-10', 72, { kind: 'retest' }), day('2026-11-10', 99, { kind: 'drill' }),
    day('2026-11-10', 98, { status: 'interrupted', interrupted: true }), day('2026-11-11', 80, { fresh: false }),
  ]);

  assert.deepEqual(records.get('2026-11-10'), { runs: 3, best: 72 });
  assert.deepEqual(records.get('2026-11-11'), { runs: 1, best: null });
  assert.equal(records.has('2026-11-12'), false);
});

test('a run keeps the day it was recorded on', () => {
  const records = dayRecords([run(64, { at: '2026-11-13T23:30:00.000Z', day: '2026-11-14' })]);

  assert.deepEqual([...records.keys()], ['2026-11-14']);
});

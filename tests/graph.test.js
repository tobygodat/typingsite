import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSeries, speedSeries } from '../src/graph.js';

test('speed graph buckets correct keystrokes per second and marks misses', () => {
  const text = 'abcdefghij';
  const events = [...text].map((char, position) => ({ type: 'insert', text: char, position, accepted: true, offsetMs: 50 + position * 200 }));
  events.splice(3, 0, { type: 'insert', text: 'x', position: 3, accepted: true, offsetMs: 590 }, { type: 'delete', count: 1, offsetMs: 595 });
  const series = speedSeries({ text, events, startedAt: 0, endedAt: 2000 });
  assert.equal(series.durationS, 2);
  // Five correct keys in the first second is 60 wpm; ten over two seconds is still 60 wpm.
  assert.deepEqual(series.points, [{ t: 1, wpm: 60, misses: 1 }, { t: 2, wpm: 60, misses: 0 }]);
  assert.match(describeSeries(series, 60), /1 mistake marked/);
});

test('long runs are capped at sixty points and an empty run has none', () => {
  const events = Array.from({ length: 300 }, (_, i) => ({ type: 'insert', text: 'a', position: i, accepted: true, offsetMs: i * 400 }));
  assert.equal(speedSeries({ text: 'a'.repeat(300), events, startedAt: 0, endedAt: 120000 }).points.length, 60);
  assert.deepEqual(speedSeries({ text: 'a', events: [] }), { points: [], durationS: 0 });
});

test('coarser points on long runs still average speed over three seconds', () => {
  // 120 s run: two-second points. One key per 200 ms until 117 s, then nothing.
  const events = Array.from({ length: 585 }, (_, i) => ({ type: 'insert', text: 'a', position: i, accepted: true, offsetMs: i * 200 }));
  const { points } = speedSeries({ text: 'a'.repeat(585), events, startedAt: 0, endedAt: 120000 });
  assert.equal(points[0].t, 2);
  // At 120 s the trailing three seconds hold keys only from 117 s, so speed has fallen to zero; a six-second window would not.
  assert.deepEqual(points.at(-1), { t: 120, wpm: 0, misses: 0 });
  assert.equal(points.at(-3).wpm, 60);
});

test('a correct character deleted and retyped counts once, like the wpm figure', () => {
  const events = [
    { type: 'insert', text: 'a', position: 0, accepted: true, offsetMs: 0 },
    { type: 'insert', text: 'b', position: 1, accepted: true, offsetMs: 100 },
    { type: 'delete', count: 1, offsetMs: 200 },
    { type: 'insert', text: 'b', position: 1, accepted: true, offsetMs: 300 },
    { type: 'insert', text: 'c', position: 2, accepted: true, offsetMs: 400 },
    { type: 'insert', text: 'd', position: 3, accepted: true, offsetMs: 500 },
    { type: 'insert', text: 'e', position: 4, accepted: true, offsetMs: 600 },
  ];

  // Five characters kept in one second is 60 wpm; counting the deleted "b" would give 72.
  assert.deepEqual(speedSeries({ text: 'abcde', events, startedAt: 0, endedAt: 1000 }).points, [{ t: 1, wpm: 60, misses: 0 }]);
});

test('a run ending between whole seconds still averages its last point over three seconds', () => {
  // One key every 200 ms from 1.2 s to 3.0 s, run ends at 4.001 s.
  const events = Array.from({ length: 10 }, (_, i) => ({ type: 'insert', text: 'a', position: i, accepted: true, offsetMs: 1200 + i * 200 }));
  const { points } = speedSeries({ text: 'a'.repeat(10), events, startedAt: 0, endedAt: 4001 });
  // The window (1001, 4001] holds all ten keys: 10 / 5 words over 3 s is 40 wpm.
  assert.deepEqual(points.at(-1), { t: 4.001, wpm: 40, misses: 0 });
});

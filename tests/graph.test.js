import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSeries, speedSeries } from '../src/graph.js';

test('speed graph buckets correct keystrokes per second and marks misses', () => {
  const text = 'abcdefghij';
  const events = [...text].map((char, position) => ({ type: 'insert', text: char, position, accepted: true, offsetMs: position * 200 }));
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

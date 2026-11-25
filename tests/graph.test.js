import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSeries, duelReadout, scrubIndexAt, scrubPointAt, scrubReadout, speedRange, speedSeries } from '../src/graph.js';

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

test('the trace\'s range is its slowest and fastest point, and nothing under three seconds', () => {
  const at = (wpm) => ({ t: 0, wpm, misses: 0 });
  assert.deepEqual(speedRange({ points: [at(118), at(164), at(140)], durationS: 3 }), { low: 118, high: 164 });
  assert.equal(speedRange({ points: [at(118), at(164), at(140)], durationS: 2.8 }), null);
  assert.equal(speedRange({ points: [], durationS: 0 }), null);
});

test('the scrubber snaps to the nearest drawn point, and reads nothing with none', () => {
  const xs = [10, 40, 70, 100];
  assert.equal(scrubIndexAt(xs, -50), 0);
  assert.equal(scrubIndexAt(xs, 24), 0);
  assert.equal(scrubIndexAt(xs, 26), 1);
  assert.equal(scrubIndexAt(xs, 70), 2);
  assert.equal(scrubIndexAt(xs, 400), 3);
  assert.equal(scrubIndexAt([55], 0), 0, 'a single point is read wherever the pointer is');
  assert.equal(scrubIndexAt([], 10), -1);
});

test('a solo point reads its moment, its trailing speed and its mistakes, in wpm or cpm', () => {
  const text = 'abcdefghij';
  const events = [...text].map((char, position) => ({ type: 'insert', text: char, position, accepted: true, offsetMs: 50 + position * 200 }));
  events.splice(3, 0, { type: 'insert', text: 'x', position: 3, accepted: true, offsetMs: 590 }, { type: 'delete', count: 1, offsetMs: 595 });
  const { points } = speedSeries({ text, events, startedAt: 0, endedAt: 2000 });
  const first = scrubPointAt(points, 0.8);
  assert.equal(scrubReadout(first, 'wpm'), '1s · 60 wpm · 1 mistake');
  assert.equal(scrubReadout(first, 'cpm'), '1s · 300 cpm · 1 mistake');
  assert.equal(scrubReadout(scrubPointAt(points, 1.9), 'wpm'), '2s · 60 wpm · 0 mistakes');
  assert.equal(scrubReadout({ t: 4.001, wpm: 40, misses: 2 }, 'wpm'), '4s · 40 wpm · 2 mistakes');
  assert.equal(scrubReadout({ t: 4.06, wpm: 40.4, misses: 0 }, 'cpm'), '4.1s · 202 cpm · 0 mistakes');
  assert.equal(scrubPointAt([], 1), null);
});

test('a duel point reads both racers at one moment, and a dash for one who has finished', () => {
  const mine = [{ t: 1, wpm: 60, misses: 0 }, { t: 2, wpm: 72, misses: 0 }, { t: 3, wpm: 66, misses: 0 }];
  const theirs = [{ t: 1, wpm: 48, misses: 1 }, { t: 2, wpm: 54, misses: 0 }];
  const at = (t, unit) => duelReadout(t, [{ name: 'You', point: scrubPointAt(mine, t, 3) }, { name: 'Lin', point: scrubPointAt(theirs, t, 2) }], unit);
  assert.equal(at(1, 'wpm'), '1s · You 60 wpm · Lin 48 wpm');
  assert.equal(at(2.2, 'wpm'), '2.2s · You 72 wpm · Lin —', 'past their finish their line has ended');
  assert.equal(at(1.6, 'cpm'), '1.6s · You 360 cpm · Lin 270 cpm');
  assert.equal(at(3, 'wpm'), '3s · You 66 wpm · Lin —');
  assert.equal(scrubPointAt(mine, 3.5, 3), null);
});

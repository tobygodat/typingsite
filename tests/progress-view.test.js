import test from 'node:test';
import assert from 'node:assert/strict';
import { dayPositions, gridlines, placeCallouts } from '../src/progress-view.js';

const bounds = { left: 0, top: 0, right: 600, bottom: 300 };
const gap = 8;
const grown = (box) => ({ left: box.left - gap, top: box.top - gap, right: box.right + gap, bottom: box.bottom + gap });
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const dotBox = (d) => ({ left: d.x - d.r, top: d.y - d.r, right: d.x + d.r, bottom: d.y + d.r });

test('a callout clears the run dots crowding the spot above its point', () => {
  const dots = [{ x: 300, y: 150, r: 4 }, { x: 300, y: 125, r: 2.5 }, { x: 290, y: 118, r: 2.5 }, { x: 312, y: 112, r: 2.5 }];
  const [box] = placeCallouts([{ x: 300, y: 150, width: 80, height: 18 }], { dots, bounds, gap });
  for (const dot of dots) assert.ok(!overlaps(grown(box), dotBox(dot)), `clears the dot at ${dot.x},${dot.y}`);
  assert.ok(box.left >= 0 && box.right <= 600 && box.top >= 0 && box.bottom <= 300, 'stays inside the chart');
});

test('a callout never sits on the line through its point', () => {
  const segments = [[[200, 100], [300, 150]], [[300, 150], [400, 60]]];
  const [box] = placeCallouts([{ x: 300, y: 150, width: 90, height: 18 }], { segments, bounds, gap });
  const g = grown(box);
  // Sample each segment finely: no sample falls inside the grown box.
  for (const [[x1, y1], [x2, y2]] of segments) {
    for (let t = 0; t <= 1; t += 0.01) {
      const [x, y] = [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
      assert.ok(!(x > g.left && x < g.right && y > g.top && y < g.bottom), `clear of the line at ${x.toFixed(0)},${y.toFixed(0)}`);
    }
  }
});

test('two callouts at neighbouring points keep apart', () => {
  const callouts = [{ x: 560, y: 80, width: 70, height: 18 }, { x: 540, y: 82, width: 90, height: 18 }];
  const [a, b] = placeCallouts(callouts, { dots: callouts.map(({ x, y }) => ({ x, y, r: 4 })), bounds, gap });
  assert.ok(!overlaps(grown(a), b), 'the second clears the first by the gap');
  assert.ok(a.right <= 600 && b.right <= 600, 'both inside the right edge');
});

test('a point at the top edge puts its callout below', () => {
  const [box] = placeCallouts([{ x: 300, y: 4, width: 60, height: 18 }], { dots: [{ x: 300, y: 4, r: 4 }], bounds, gap });
  assert.ok(box.top > 4, 'below the point');
});

test('gridlines leave out values that are not numbers, and always return', () => {
  assert.deepEqual(gridlines([42, NaN, 58], 5, Infinity), [40, 50, 60]);
  assert.deepEqual(gridlines([NaN], 5, Infinity), [0, 5, 10]);
  assert.equal(gridlines([0, Infinity], 5, Infinity).length, 3);
  assert.deepEqual(gridlines([97.5, 99], 1, 100), [97, 98, 99]);
});

test('chart days sit by calendar offset across the window, and each hit area reaches halfway to its neighbours', () => {
  const { xs, gaps } = dayPositions(['2026-10-01', '2026-10-02', '2026-10-17'], ['2026-09-18', '2026-10-17'], 8, 290);
  assert.deepEqual(xs, [8 + 130, 8 + 140, 8 + 290]);
  assert.ok(xs[2] - xs[1] > 10 * (xs[1] - xs[0]), 'a 15-day gap is fifteen times a 1-day gap');
  assert.deepEqual(gaps, [10, 10, 150]);
  const across = dayPositions(['2026-03-28', '2026-03-29', '2026-03-30'], ['2026-03-28', '2026-03-30'], 0, 100);
  assert.deepEqual(across.xs, [0, 50, 100], 'a clock change inside the window moves nothing');
  assert.deepEqual(dayPositions(['2026-10-17'], ['2026-10-17', '2026-10-17'], 8, 300), { xs: [158], gaps: [300] });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { bigramChips, dayPositions, gridlines, placeCallouts } from '../src/progress-view.js';

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

// A pair's evidence as summarizePatterns gives it: first tries and misses, and timings against the person's median.
const pair = (name, { observations = 20, errors = 0, timings = 20, medianMs = 150, personal = 150 } = {}) => ({
  pair: name, observations, errors, timings: Array(timings).fill(medianMs), errorRate: observations ? errors / observations : 0,
  medianMs: timings ? medianMs : null, slowdownMs: timings ? medianMs - personal : null,
});

const summary = (...pairs) => ({ attemptCount: 5, personalMedianMs: 150, pairs });
const names = (chips) => chips.map((chip) => chip.pair);

test('friction names the most missed pairs, then the slowest; flow the fastest clean ones', () => {
  const { friction, flow } = bigramChips(summary(
    pair('th', { errors: 4 }), pair('he', { errors: 1 }), pair('in', { medianMs: 210 }), pair('er', { medianMs: 180 }),
    pair('an', { medianMs: 95 }), pair('re', { medianMs: 120 }), pair('on', { medianMs: 140 }), pair('at', { medianMs: 110 }),
  ));

  assert.deepEqual(names(friction), ['th', 'he', 'in']);
  assert.deepEqual(names(flow), ['an', 'at', 're']);
  assert.equal(friction[0].note, '20% missed');
  assert.equal(friction[2].note, '+60 ms');
  assert.equal(flow[0].note, '−55 ms');
  assert.match(friction[0].label, /^Practice “th”: 4 first-try errors in 20 tries$/);
});

test('no pair is ever both friction and flow, however the evidence falls', () => {
  const cases = [
    // A fast pair that is sometimes missed is friction, never flow.
    summary(pair('th', { errors: 1, medianMs: 90 }), pair('he', { medianMs: 90 })),
    // Ties in error rate and speed.
    summary(pair('ab', { errors: 2 }), pair('cd', { errors: 2 }), pair('ef', { medianMs: 100 }), pair('gh', { medianMs: 100 })),
    // Every pair at the median: none is either.
    summary(pair('ab'), pair('cd'), pair('ef')),
    // More friction than fits: the missed pairs left out never fall into flow.
    summary(...['ab', 'cd', 'ef', 'gh', 'ij'].map((name) => pair(name, { errors: 1, medianMs: 100 })), pair('kl', { medianMs: 100 })),
    // Too few tries to name, and timings without first tries.
    summary(pair('ab', { observations: 9, errors: 3, timings: 9, medianMs: 300 }), pair('cd', { observations: 0, timings: 12, medianMs: 90 }), pair('ef', { observations: 12, errors: 1, timings: 0 })),
  ];

  for (const evidence of cases) {
    const { friction, flow } = bigramChips(evidence);
    const both = names(friction).filter((name) => names(flow).includes(name));
    assert.deepEqual(both, [], `shared: ${both}`);
    assert.equal(new Set(names(friction)).size, friction.length, 'friction repeats a pair');
    assert.equal(new Set(names(flow)).size, flow.length, 'flow repeats a pair');
  }

  assert.deepEqual(names(bigramChips(cases[0]).flow), ['he']);
  assert.deepEqual(names(bigramChips(cases[2]).friction), []);
  assert.deepEqual(names(bigramChips(cases[3]).flow), ['kl']);
  const near = bigramChips(summary(pair('ab', { medianMs: 136 }), pair('cd', { medianMs: 135 }), pair('ef', { medianMs: 164 }), pair('gh', { medianMs: 165 })));
  assert.deepEqual(names(near.flow), ['cd'], 'flow needs a tenth under the median');
  assert.deepEqual(names(near.friction), ['gh'], 'slow friction needs a tenth over it');
  assert.deepEqual(bigramChips(cases[4]), { friction: [{ pair: 'ef', note: '8% missed', label: 'Practice “ef”: 1 first-try error in 12 tries' }], flow: [{ pair: 'cd', note: '−60 ms', label: '“cd”: −60 ms against your median, never missed' }] });
});

test('no evidence names no pairs', () => {
  assert.deepEqual(bigramChips(summary()), { friction: [], flow: [] });
  assert.deepEqual(bigramChips({ attemptCount: 0, personalMedianMs: null, pairs: [] }), { friction: [], flow: [] });
});

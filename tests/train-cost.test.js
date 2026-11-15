import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, FOCUSES, LEARNER_VARIANTS, englishFrequency, fitLearner, keyboardOf, learnerEvidence, learnerRecommendation } from '../src/learner.js';
import { trainPath } from '../src/train-path.js';
import { PACE_RUNS, costText, paceOf, perMinuteText, plotAt, timingsOf, trainFigures, wonText, wpmCost } from '../src/train-cost.js';
import { CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';
import { seeded } from '../scripts/evaluate-learner.mjs';
import { referenceFigures } from './train-cost-reference.js';

const conditions = { mode: 'words', count: 25, punctuation: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

const KEYBOARD = keyboardOf(conditions);
const NOW = Date.parse('2026-11-10T12:00:00Z');
const day = (n) => new Date(Date.parse('2026-10-01T12:00:00Z') + n * 3_600_000).toISOString();
const close = (actual, expected, tolerance = 1e-4) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);

// A stored run summary at `wpm` with pattern rows: [pair, tries, errors, timed intervals, median ms, ms over the run's median].
const summary = (id, at, patterns, wpm = 60, extra = {}) => ({ id, at, kind: 'test', status: 'complete', interrupted: false, fresh: true, conditions, score: { wpm, accuracy: 96 },
  patterns, keys: [], keysVersion: 0, ...extra });

const BACKGROUND = [...englishFrequency().pairs].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([pair]) => pair);
const withBackground = (rows) => [...BACKGROUND.filter((pair) => !rows.some((row) => row[0] === pair)).map((pair) => [pair, 3, 0, 3, 200, 0]), ...rows];

// A model built by hand, so every figure can be worked out on paper: a miss costs 2 intervals, the typical first try
// misses 3% of the time.
const model = (units) => ({ policy: DEFAULT_POLICY, focus: 'balanced', runs: 1, errorRate: 0.03, missCost: 2,
  units: units.map((unit) => ({ kind: unit.unit.length === 1 ? 'key' : 'pair', error: { mean: 0, sd: 0 }, slowdown: null, basis: 'errors',
    observed: { seen: 0, errors: 0, runs: 0, errorRuns: 0, timed: 0, timedRuns: 0, slowRuns: 0, slowMs: null }, ...unit })) });

const general = { kind: 'general', unit: null, title: 'General drill', was: null, since: null };
const at60 = [summary('p1', day(1), [], 60)];

test('cost is the prototype’s formula: the wpm gained if every letter took `lost` ms less', () => {
  // The prototype's "ou": 82 ms a letter, 0.46 ms lost a letter. 12000 / 81.54 − 12000 / 82 = 147.1670 − 146.3415.
  const pace = { wpm: 12000 / 82, ms: 82 };
  close(wpmCost(0.46, pace), 0.8255);
  assert.equal(wpmCost(0, pace), 0);
  // A loss of a whole letter's time or more has no finite answer, and a loss below nothing is none.
  assert.equal(wpmCost(82, pace), null);
  assert.equal(wpmCost(500, pace), null);
  assert.equal(wpmCost(-1, pace), null);
  assert.equal(wpmCost(Number.NaN, pace), null);
  assert.equal(wpmCost(0.46, null), null);
});

test('the pace is the median speed of the newest measured runs on this keyboard, and none without them', () => {
  assert.equal(paceOf([], KEYBOARD), null);
  // One run is a tiny sample, but it is the person's speed: 60 wpm is 200 ms a letter.
  assert.deepEqual(paceOf(at60, KEYBOARD), { wpm: 60, ms: 200 });
  // Only the newest PACE_RUNS count: twelve runs, the two oldest very slow, the rest at 50 and 70 in turn.
  const runs = Array.from({ length: 12 }, (_, i) => summary(`r${i}`, day(i), [], i < 2 ? 5 : i % 2 ? 70 : 50));
  assert.equal(PACE_RUNS, 10);
  assert.equal(paceOf(runs, KEYBOARD).wpm, 60);

  // Drills, unfinished runs, repeated text and other keyboards are not measured runs.
  const others = [summary('d', day(20), [], 200, { kind: 'drill' }), summary('i', day(21), [], 200, { interrupted: true }), summary('f', day(22), [], 200, { fresh: false }),
    summary('t', day(23), [], 200, { conditions: { ...conditions, inputClass: 'touch' } })];

  assert.deepEqual(paceOf([...at60, ...others], KEYBOARD), { wpm: 60, ms: 200 });
  assert.equal(paceOf(others, KEYBOARD), null);
});

test('a step to do costs its gain × the miss cost × the pace, and says how often it comes up', () => {
  // gain 0.002 misses a letter, 2 intervals a miss, 200 ms an interval: 0.8 ms a letter. 12000 / 199.2 − 60 = 0.24096.
  const path = { behind: [], just: null, current: { kind: 'targeted', unit: 'an', title: 'Practice “an”', was: { errors: 5, observations: 40, runs: 6, slowRuns: 0 }, since: null }, ahead: [] };
  const figures = trainFigures({ model: model([{ unit: 'an', gain: 0.002, frequency: 0.0131 }]), path, runs: at60, keyboard: KEYBOARD });
  close(figures.current.cost, 0.24096);
  assert.deepEqual(figures.current.missed, { errors: 5, tries: 40, runs: 6 });
  assert.equal(figures.current.slower, null);
  // 1.31% of letters at 300 letters a minute: 3.93 a minute, one in 76.
  assert.equal(figures.current.frequency.every, 76);
  close(figures.current.frequency.perMinute, 3.93);
  assert.equal(perMinuteText(figures.current.frequency.perMinute), '3.9');
  assert.equal(perMinuteText(9.6), '9.6');
  assert.equal(perMinuteText(9.96), '10');
  // An untimed pair has no plot, and neither has a key, which has no timing of its own.
  assert.equal(figures.current.timings, null);
  const key = trainFigures({ model: model([{ unit: 'e', gain: 0.001, frequency: 0.12 }]), path: { ...path, current: { ...path.current, unit: 'e' } }, runs: at60, keyboard: KEYBOARD });
  assert.equal(key.current.kind, 'key');
  assert.equal(key.current.timings, null);
});

test('without measured runs nothing has a cost or a rate, and a general drill has no figures at all', () => {
  const path = { behind: [], just: null, current: { kind: 'targeted', unit: 'an', title: 'Practice “an”', was: { errors: 5, observations: 40 }, since: null }, ahead: [] };
  const figures = trainFigures({ model: model([{ unit: 'an', gain: 0.002, frequency: 0.0131 }]), path, runs: [], keyboard: KEYBOARD });
  assert.equal(figures.pace, null);
  assert.equal(figures.current.cost, null);
  assert.equal(figures.current.frequency.perMinute, null);
  assert.equal(figures.current.frequency.every, 76);
  assert.equal(trainFigures({ model: model([]), path: { behind: [], just: null, current: general, ahead: [] }, runs: at60, keyboard: KEYBOARD }).current, null);
  // A loss as large as the pace itself: no number rather than an infinite or negative one.
  const huge = trainFigures({ model: model([{ unit: 'an', gain: 0.6, frequency: 0.0131 }]), path, runs: at60, keyboard: KEYBOARD });
  assert.equal(huge.current.cost, null);
  // A pace so slow the person types a word a minute still gives a small, finite cost.
  const slow = trainFigures({ model: model([{ unit: 'an', gain: 0.002, frequency: 0.0131 }]), path, runs: [summary('s', day(1), [], 1)], keyboard: KEYBOARD });
  close(slow.current.cost, 12000 / (12000 - 0.004 * 12000) - 1);
});

test('a slow pair says how much slower than the pace, and its plot has one dot per timed run', () => {
  // Three runs time "ou": 10 intervals at 117 against 82, 6 at 130 against 90, and 4 at 110 against 80.
  const runs = [summary('a', day(1), [['ou', 10, 0, 10, 117, 35]]), summary('b', day(2), [['ou', 6, 0, 6, 130, 40]]), summary('c', day(3), [['ou', 4, 0, 4, 110, 30]]),
    summary('x', day(4), [['ou', 5, 0, 0, null, null]])];

  const was = { errors: 0, observations: 25, runs: 4, slowRuns: 3, basis: 'slow', slowMs: 35.5, timed: 20, timedRuns: 3 };
  const path = { behind: [], just: null, current: { kind: 'targeted', unit: 'ou', title: 'Practice “ou”', was, since: null }, ahead: [] };
  const observed = { seen: 25, errors: 0, runs: 4, errorRuns: 0, timed: 20, timedRuns: 3, slowRuns: 3, slowMs: 35.5 };
  const figures = trainFigures({ model: model([{ unit: 'ou', gain: 0.002, frequency: 0.0131, observed, basis: 'slow' }]), path, runs, keyboard: KEYBOARD });
  const { slower, timings } = figures.current;
  // The pace over the runs that timed it: (10 × 82 + 6 × 90 + 4 × 80) / 20 = 84. The pair: 84 + 36 = 120, "120 vs 84".
  assert.deepEqual(slower, { ms: 36, own: 120, pace: 84 });
  assert.equal(figures.current.missed, null);
  assert.equal(timings.runs, 3);
  assert.equal(timings.intervals, 20);
  assert.deepEqual([timings.pace, timings.own], [84, 120]);
  assert.deepEqual(timings.dots.map((dot) => dot.ms), [117, 130, 110]);
  // The axis runs from a step below the fastest to at least a hundred ms on: 60 to 160.
  assert.deepEqual([timings.low, timings.high], [60, 160]);
  close(plotAt(timings, 84), 24);
  assert.ok(timings.dots.every((dot) => dot.left >= 0 && dot.left <= 100 && dot.stack === 0));
});

test('dots in one slot stack, and a stall far past the pace is drawn at the edge', () => {
  const rows = [...Array.from({ length: 5 }, () => ({ pairMs: 100, runMs: 80, timed: 4 })), { pairMs: 2000, runMs: 80, timed: 4 }];
  const timings = timingsOf('th', rows, 20);
  assert.deepEqual(timings.dots.slice(0, 5).map((dot) => dot.stack), [0, 1, 2, 3, 4]);
  assert.equal(timings.tall, 5);
  // Four times the pace at most: 320, rounded up past the margin to 340.
  assert.equal(timings.high, 340);
  assert.equal(timings.dots[5].left, 100);
  assert.equal(timingsOf('th', [], 20), null);
});

test('a drilled step won back its cost before the drill less its cost on the retest', () => {
  // "qu", 1% of letters, missed 6 of 22 before and 0 of 12 on the retest, at 60 wpm: 3% is the typical rate, so before it
  // lost (6 / 22 − 0.03) × 2 × 200 × 0.01 = 0.97091 ms a letter, 12000 / 199.02909 − 60 = 0.29270 wpm, and now nothing.
  const step = { unit: 'qu', state: 'fixed', loopId: 'l1', basis: 'errors', retest: { was: { errors: 6, observations: 22 }, now: { errors: 0, observations: 12 } },
    since: { basis: 'errors', before: { runs: 2, tries: 22, errors: 6 }, after: { runs: 3, tries: 36, errors: 0 } } };

  const path = { behind: [step], just: null, current: general, ahead: [] };
  const figures = trainFigures({ model: model([{ unit: 'qu', gain: 0, frequency: 0.01 }]), path, runs: at60, keyboard: KEYBOARD });
  const [qu] = figures.behind;
  close(qu.won, 0.29270);
  close(figures.won, 0.29270);
  assert.equal(qu.state, 'fixed');
  // More than the retest holds it since the drill, so "now" reads those runs; "before" is what the drill was chosen on.
  assert.deepEqual(qu.now, { read: { basis: 'errors', errors: 0, tries: 36 }, since: true });
  assert.deepEqual(qu.before, { basis: 'errors', errors: 6, tries: 22 });
  // With only the retest since, "now" is the retest's own read-back.
  const retestOnly = trainFigures({ model: model([{ unit: 'qu', gain: 0, frequency: 0.01 }]), path: { ...path, behind: [{ ...step, since: { ...step.since, after: { runs: 1, tries: 12, errors: 0 } } }] }, runs: at60, keyboard: KEYBOARD });
  assert.deepEqual(retestOnly.behind[0].now, { read: { basis: 'errors', errors: 0, tries: 12 }, since: false });
});

test('a drilled step whose cost rose won back less than nothing, and the total says so', () => {
  // "th", 1% of letters, 30 ms slower before and 70 ms after: 0.3 → 0.7 ms a letter at 200 ms a letter.
  const step = { unit: 'th', state: 'drilled', loopId: 'l2', basis: 'slow', retest: { was: 30, now: 70 }, since: { basis: 'slow', before: null, after: null } };
  const figures = trainFigures({ model: model([{ unit: 'th', gain: 0, frequency: 0.01 }]), path: { behind: [step], just: null, current: general, ahead: [] }, runs: at60, keyboard: KEYBOARD });
  const expected = (12000 / 199.7 - 60) - (12000 / 199.3 - 60);
  close(figures.behind[0].won, expected);
  assert.ok(figures.behind[0].won < 0);
  assert.equal(wonText(figures.behind[0].won, 'wpm'), '−0.1');
  assert.deepEqual(figures.behind[0].now, { read: { basis: 'slow', ms: 70 }, since: false });
  // A pair faster than the pace on the retest costs nothing, not less than nothing.
  const faster = trainFigures({ model: model([{ unit: 'th', gain: 0, frequency: 0.01 }]), path: { behind: [{ ...step, retest: { was: 30, now: -15 } }], just: null, current: general, ahead: [] }, runs: at60, keyboard: KEYBOARD });
  close(faster.behind[0].won, 12000 / 199.7 - 60);
});

test('a loop too thin to read back has no number won back, and adds nothing to the total', () => {
  const old = { unit: 'ck', state: 'drilled', loopId: 'l3', basis: 'errors', retest: null, since: { basis: 'errors', before: { runs: 1, tries: 10, errors: 4 }, after: { runs: 1, tries: 8, errors: 0 } } };
  const empty = { ...old, unit: 'ol', retest: { was: { errors: 0, observations: 0 }, now: { errors: 0, observations: 0 } } };
  const figures = trainFigures({ model: model([{ unit: 'ck', gain: 0, frequency: 0.01 }, { unit: 'ol', gain: 0, frequency: 0.01 }]), path: { behind: [old, empty], just: null, current: general, ahead: [] }, runs: at60, keyboard: KEYBOARD });
  assert.deepEqual(figures.behind.map((step) => step.won), [null, null]);
  assert.equal(figures.won, null);
  // Without a read-back, "now" and "before" are the runs on either side of the drill.
  assert.deepEqual(figures.behind[0].now, { read: { basis: 'errors', errors: 0, tries: 8 }, since: true });
  assert.deepEqual(figures.behind[0].before, { basis: 'errors', errors: 4, tries: 10 });
});

test('costs print in the unit on screen: cpm is five times wpm, and a cost too small to print says so', () => {
  assert.equal(costText(0.8255, 'wpm'), '0.8');
  assert.equal(costText(0.8255, 'cpm'), '4.1');
  assert.equal(costText(0.004, 'wpm'), '<0.1');
  assert.equal(costText(0.004, 'cpm'), '<0.1');
  assert.equal(costText(0.012, 'cpm'), '0.1');
  assert.equal(costText(null, 'cpm'), '—');
  assert.equal(wonText(1.44, 'wpm'), '+1.4');
  assert.equal(wonText(1.44, 'cpm'), '+7.2');
  assert.equal(wonText(-0.22, 'cpm'), '−1.1');
  assert.equal(wonText(0.004, 'wpm'), '0');
});

// Random histories: runs at random speeds and paces with six pairs missed and slowed at random, and loops on those
// pairs and two others, read back with random figures.
function randomHistory(random, round) {
  const pairs = ['th', 'he', 'in', 'er', 'an', 'ou', 'qu', 'ck'];

  const runs = Array.from({ length: 2 + Math.floor(random() * 12) }, (_, i) => {
    const pace = 40 + Math.floor(random() * 460);

    return summary(`m${round}-${i}`, day(i), withBackground(pairs.map((pair) => {
      const n = Math.floor(random() * 12);
      const ms = Math.max(1, Math.round(pace * Math.exp(random() * 1.4 - 0.6)));

      return [pair, n + Math.floor(random() * 3), random() < 0.2 ? Math.floor(random() * 3) : 0, n, n ? ms : null, n ? ms - pace : null];
    })).map((row) => (pairs.includes(row[0]) ? row : [row[0], 3, 0, 3, pace, 0])), 20 + Math.floor(random() * 120));
  });

  const loops = Array.from({ length: Math.floor(random() * 6) }, (_, i) => {
    const target = pairs[Math.floor(random() * pairs.length)];
    const after = runs[Math.floor(random() * runs.length)];
    const basis = random() < 0.5 ? 'slow' : 'errors';

    return { id: `l${round}-${i}`, at: after.at, afterAttemptId: after.id, beforeAttemptId: null, target, targetBasis: basis, conditions, comparison: { state: 'improved', comparable: true },
      targetMisses: basis === 'errors' ? { target, was: { errors: Math.floor(random() * 6), observations: Math.floor(random() * 20) }, now: { errors: Math.floor(random() * 4), observations: 1 + Math.floor(random() * 12) } } : null,
      targetPace: basis === 'slow' ? { target, was: { slowMs: Math.round(random() * 200 - 50), timed: 12 }, now: { slowMs: Math.round(random() * 200 - 100), timed: 8 } } : null };
  });

  return { runs, loops };
}

test('across random histories in every focus, the costs are the prototype’s and never reorder the learner’s queue', () => {
  const random = seeded(470);
  let costed = 0;
  let won = 0;

  for (let round = 0; round < 150; round += 1) {
    const { runs, loops } = randomHistory(random, round);

    for (const focus of FOCUSES) {
      const fit = fitLearner(learnerEvidence(runs, KEYBOARD), NOW, LEARNER_VARIANTS[DEFAULT_POLICY], focus);
      const path = trainPath({ recommendation: learnerRecommendation(fit), loops, runs, keyboard: KEYBOARD });
      const figures = trainFigures({ model: fit, path, runs, keyboard: KEYBOARD });
      const reference = referenceFigures({ model: fit, path, runs, keyboard: KEYBOARD });
      const queue = [figures.current, ...figures.ahead].flatMap((step) => (step ? [step.cost] : []));

      for (const [ours, theirs] of [[figures.current?.cost ?? null, reference.current], ...figures.ahead.map((step, i) => [step.cost, reference.ahead[i]]), ...figures.behind.map((step, i) => [step.won, reference.behind[i]])]) {
        if (theirs === null) assert.equal(ours, null);
        else close(ours, theirs, 1e-9);
      }

      // The queue is ranked by gain, and cost rises with gain alone, so the costs never rise down the queue.
      for (let i = 1; i < queue.length; i += 1) assert.ok(queue[i] <= queue[i - 1] + 1e-12, `${focus}: ${queue.join(', ')}`);
      // Each step to do is costed on the basis its row was ranked on, and a positive gain is a positive cost.
      assert.ok(queue.every((cost) => cost > 0));
      costed += queue.length;
      won += figures.behind.filter((step) => step.won !== null).length;
    }
  }

  assert.ok(costed > 300, `only ${costed} steps costed`);
  assert.ok(won > 50, `only ${won} drilled steps read back`);
});

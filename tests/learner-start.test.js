import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, LEARNER_VARIANTS, START_MISSES_POLICY, START_PACE_POLICY, START_POLICY, START_RATE_POLICY, fitLearner, learnerRecommendation } from '../src/learner.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const RATE = { pair: 0.03, key: 0.02 };
const shipped = LEARNER_VARIANTS[DEFAULT_POLICY];
const withView = (view) => ({ ...shipped, policy: 'learner-start@3', start: { rate: RATE, rateTries: 100, missTries: 40, paceTries: 5, units: {}, ...view } });
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);
const logit = (p) => Math.log(p / (1 - p));

// `runs` records, each typing every listed pair `seen` times with `errors` misses and `timed` clean intervals at `ratio`.
function evidence(runs, pairs) {
  return Array.from({ length: runs }, (_, index) => ({ id: `run-${index}`, at: NOW - (runs - index) * 60_000, correction: null,
    units: Object.entries(pairs).map(([unit, { seen = 10, errors = 0, timed = 0, ratio = null }]) => ({ unit, seen, errors, timed, slow: ratio === null ? null : ratio > 0, ratio, slowMs: ratio === null ? null : 20 })) }));
}

const unitOf = (model, unit) => model.units.find((estimate) => estimate.unit === unit);

test('with no starting view a version computes what it did', () => {
  const records = evidence(3, { th: { errors: 2 }, he: {} });

  assert.deepEqual(fitLearner(records, NOW, { ...shipped }), fitLearner(records, NOW, shipped));
});

test('before any run, a version with a view expects the fitted rate of every pair and key', () => {
  const model = fitLearner([], NOW, withView({}));

  close(unitOf(model, 'th').error.mean, RATE.pair);
  close(unitOf(model, 't').error.mean, RATE.key);
});

test('one clean run leaves the shipped learner expecting no miss at all, and a version with a view still expecting some', () => {
  const records = evidence(1, { th: {}, he: {}, in: {} });

  assert.equal(unitOf(fitLearner(records, NOW, shipped), 'er').error.mean, 0);
  const viewed = unitOf(fitLearner(records, NOW, withView({})), 'er').error.mean;

  assert.ok(viewed > 0.02 && viewed < RATE.pair, `${viewed}`);
});

test('a pair the view marks as hard is expected missed more often before the evidence, by the log odds it adds', () => {
  const model = fitLearner([], NOW, withView({ units: { th: { miss: [0.8] } } }));

  close(logit(unitOf(model, 'th').error.mean) - logit(unitOf(model, 'he').error.mean), 0.8);
});

test('the person’s own tries outweigh the view', () => {
  const view = withView({ units: { th: { miss: [1.5] } } });
  const few = unitOf(fitLearner(evidence(1, { th: {}, he: {} }), NOW, view), 'th').error.mean;
  const many = fitLearner(evidence(40, { th: {}, he: { errors: 1 } }), NOW, view);

  assert.ok(unitOf(many, 'th').error.mean < few / 3, `${unitOf(many, 'th').error.mean} against ${few}`);
  assert.ok(unitOf(many, 'th').error.mean < unitOf(many, 'he').error.mean);
});

test('a view can depend on the person: a second coefficient scales with how far their pooled rate sits from the fitted one', () => {
  const view = withView({ rateTries: 1, units: { th: { miss: [0, 1] } } });
  const careless = fitLearner(evidence(5, { he: { errors: 3 }, in: { errors: 3 } }), NOW, view);
  const careful = fitLearner(evidence(5, { he: {}, in: {} }), NOW, view);
  const lift = (model) => logit(unitOf(model, 'th').error.mean) - logit(unitOf(model, 'er').error.mean);

  assert.ok(lift(careless) > 0 && lift(careful) < 0, `${lift(careless)} and ${lift(careful)}`);
});

test('a pair the view marks as slow starts at that slowdown and moves to the person’s own as intervals arrive', () => {
  const view = withView({ units: { th: { pace: [0.2] } } });

  close(unitOf(fitLearner([], NOW, view), 'th').slowdown, 0.2);
  close(unitOf(fitLearner([], NOW, view), 'he').slowdown, 0);
  const typed = unitOf(fitLearner(evidence(20, { th: { timed: 5, ratio: 0 } }), NOW, { ...view, decay: false }), 'th').slowdown;

  close(typed, (5 * 0.2) / (100 + 5));
});

test('the view ranks a hard pair first but names nothing: a target still needs the person’s own evidence', () => {
  const recommendation = learnerRecommendation(fitLearner([], NOW, withView({ units: { qz: { miss: [2] }, th: { miss: [2] } } })));

  assert.equal(recommendation.target, null);
  assert.equal(recommendation.kind, 'general');
  assert.deepEqual(recommendation.queue, []);
  assert.equal(recommendation.lean[0].unit, 'th');
});

test('the shipped starting views differ only in which half of the fitted table they read', () => {
  const views = Object.fromEntries([START_POLICY, START_RATE_POLICY, START_MISSES_POLICY, START_PACE_POLICY].map((policy) => [policy, LEARNER_VARIANTS[policy].start]));
  const halves = (policy) => [Object.values(views[policy].units).some((unit) => unit.miss), Object.values(views[policy].units).some((unit) => unit.pace)];

  assert.deepEqual(halves(START_POLICY), [true, true]);
  assert.deepEqual(halves(START_RATE_POLICY), [false, false]);
  assert.deepEqual(halves(START_MISSES_POLICY), [true, false]);
  assert.deepEqual(halves(START_PACE_POLICY), [false, true]);
  assert.deepEqual(new Set(Object.values(views).map((view) => JSON.stringify([view.rate, view.rateTries]))).size, 1);
  assert.equal(views[START_RATE_POLICY].missTries, shipped.pooledTries);
  assert.equal(views[START_PACE_POLICY].missTries, shipped.pooledTries);
});

test('before any run, the shipped view expects a common pair missed less and typed faster than a rare one', () => {
  const model = fitLearner([], NOW, LEARNER_VARIANTS[START_POLICY]);

  assert.ok(unitOf(model, 'th').error.mean < unitOf(model, 'bv').error.mean);
  assert.ok(unitOf(model, 'th').slowdown < 0 && unitOf(model, 'bv').slowdown > 0);
  assert.equal(learnerRecommendation(model).target, null);
});

test('the default is still the version with no starting view', () => {
  assert.equal(LEARNER_VARIANTS[DEFAULT_POLICY].start, undefined);
});

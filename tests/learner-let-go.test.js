import test from 'node:test';
import assert from 'node:assert/strict';
import { DECAY_TIMING_POLICY, FIXED_OBSERVATIONS, FIXED_RUNS, FOCUSES, basisOf, LEARNER_VARIANTS, LET_GO, LET_GO_MISSES_POLICY, LET_GO_POLICY, drillSplit, drilledTargets, englishFrequency,
  fitLearner, keyboardOf, learnerEvidence, letGo, letGoIndex, recommendFor } from '../src/learner.js';
import * as trainPathModule from '../src/train-path.js';
import { CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';
import { mergeSynced } from '../src/account.js';
import { seeded } from '../scripts/evaluate-learner.mjs';
import { seasonTask } from '../scripts/evaluate-let-go.mjs';

const conditions = { mode: 'words', count: 25, punctuation: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

const KEYBOARD = keyboardOf(conditions);
const NOW = Date.parse('2026-11-10T12:00:00Z');
const day = (n) => new Date(Date.parse('2026-10-01T12:00:00Z') + n * 3_600_000).toISOString();
const summary = (id, at, patterns) => ({ id, at, kind: 'test', status: 'complete', interrupted: false, fresh: true, conditions, patterns, keys: [], keysVersion: 0 });

// Sixty frequent pairs, three tries a run each, one try in thirty missed: a typical rate near 1.1%.
const BACKGROUND = [...englishFrequency().pairs].sort((a, b) => b[1] - a[1]).slice(0, 61).map(([pair]) => pair).filter((pair) => pair !== 'th').slice(0, 60);
const withBackground = (n, rows) => [...BACKGROUND.filter((pair) => !rows.some((row) => row[0] === pair)).map((pair, i) => [pair, 3, (i + n) % 30 ? 0 : 1, 3, 200, 0]), ...rows];
const run = (n, rows) => summary(`r${n}`, day(n), withBackground(n, rows));

const loop = (id, target, after, basis = 'errors', extra = {}) => ({ id, at: after.at, afterAttemptId: after.id, target, targetBasis: basis, conditions,
  comparison: { state: 'improved' }, recommendationKind: 'targeted', ...extra });

const recommend = (policy, runs, loops, focus = 'balanced') => recommendFor(policy, { runs, loops, traces: [], source: conditions, now: NOW, focus });
const queued = (recommendation, unit) => recommendation.queue.some((item) => item.unit === unit);

// "th" missed 2 of 9 in `missed` runs, then drilled and typed `clean` runs of 9 clean tries.
function drilledHistory(missed, clean, after = () => ['th', 9, 0, 9, 200, 0]) {
  const runs = [...Array.from({ length: missed }, (_, n) => run(n, [['th', 9, 2, 9, 200, 0]])), ...Array.from({ length: clean }, (_, k) => run(missed + k, [after(k)]))];

  return { runs, loops: clean ? [loop('l', 'th', runs[missed])] : [] };
}

const weakStep = () => Math.log(LET_GO.weakRatio);

test('a drilled target is let go on clean evidence since its drill, once the walk and both floors are met', () => {
  const index = (runs) => letGoIndex(learnerEvidence(runs, KEYBOARD));
  let first = null;

  for (let clean = 1; clean <= 30 && first === null; clean += 1) {
    const { runs, loops } = drilledHistory(20, clean);

    if (letGo(index(runs), 'th', 'errors', drillSplit(loops[0], index(runs)))) first = clean;
  }

  // The walk: each clean try adds ln((1 − p) / (1 − Rp)); it must reach ln LET_GO_ODDS, with 2 runs and 20 tries since.
  const p = index(drilledHistory(20, first).runs).typical;
  const step = Math.log((1 - p) / (1 - LET_GO.weakRatio * p));
  const needed = Math.max(FIXED_RUNS, Math.ceil(FIXED_OBSERVATIONS / 9), Math.ceil(Math.log(LET_GO.letGoOdds) / step / 9));
  assert.equal(first, needed, `let go after ${first} clean runs, the walk needs ${needed}`);

  // The shipped learner still names it; the let-go learner does not, and Train reads it fixed, in balanced and accuracy.
  const { runs, loops } = drilledHistory(20, first);

  for (const focus of ['balanced', 'accuracy']) {
    assert.ok(queued(recommend(DECAY_TIMING_POLICY, runs, loops, focus), 'th'), focus);
    const recommendation = recommend(LET_GO_POLICY, runs, loops, focus);
    assert.ok(!queued(recommendation, 'th'), focus);
    assert.ok(!recommendation.lean.some((item) => item.unit === 'th'), `${focus}: the drill no longer leans on it`);
    const index = letGoIndex(learnerEvidence(runs, KEYBOARD));
    assert.ok(letGo(index, 'th', 'errors', drillSplit(loops[0], index)), focus);
  }

  // One clean run short of it: drilled, and still named.
  const short = drilledHistory(20, first - 1);
  assert.ok(queued(recommend(LET_GO_POLICY, short.runs, short.loops), 'th'));
});

test('one typo after the let-go never brings it back; misses past the return walk do, and it is named again', () => {
  const base = drilledHistory(20, 40);
  const atLeast = Math.ceil(Math.log(LET_GO.returnOdds) / weakStep());
  assert.ok(!queued(recommend(LET_GO_POLICY, base.runs, base.loops), 'th'));

  // A miss in each of the next runs, one at a time: never back on fewer than ⌈ln RETURN_ODDS / ln R⌉ misses.
  const runs = [...base.runs];
  let misses = 0;

  for (let n = 0; n < 20 && !queued(recommend(LET_GO_POLICY, runs, base.loops), 'th'); n += 1) {
    runs.push(run(runs.length, [['th', 9, 3, 9, 200, 0]]));
    misses += 3;
  }

  assert.ok(misses >= atLeast, `back after ${misses} misses, at least ${atLeast}`);
  assert.ok(queued(recommend(LET_GO_POLICY, runs, base.loops), 'th'), 'named again once missed again');

  // A single typo, then clean again: still let go.
  const typo = [...base.runs, run(base.runs.length, [['th', 9, 1, 9, 200, 0]]), run(base.runs.length + 1, [['th', 9, 0, 9, 200, 0]])];
  assert.ok(!queued(recommend(LET_GO_POLICY, typo, base.loops), 'th'));
});

test('loops missing, duplicated, out of order, on another keyboard or pointing at a run no longer kept', () => {
  const { runs, loops } = drilledHistory(20, 12);
  const expected = recommend(LET_GO_POLICY, runs, loops);
  const twice = [loops[0], { ...loops[0] }, loop('older', 'th', runs[3])];
  assert.deepEqual(recommend(LET_GO_POLICY, runs, twice), expected, 'duplicates and an older loop change nothing');
  assert.deepEqual(recommend(LET_GO_POLICY, runs, [...twice].reverse()), expected, 'nor their order');
  assert.deepEqual(drilledTargets([...twice].reverse(), KEYBOARD).get('th'), drilledTargets(twice, KEYBOARD).get('th'));

  // A loop without a target, or on another keyboard, lets nothing go.
  assert.ok(queued(recommend(LET_GO_POLICY, runs, [{ ...loops[0], target: null }]), 'th'));
  assert.ok(queued(recommend(LET_GO_POLICY, runs, [{ ...loops[0], conditions: { ...conditions, layout: 'dvorak' } }]), 'th'));

  // Its retest no longer kept: it splits at its own date, which is the retest's here, so nothing changes.
  assert.deepEqual(recommend(LET_GO_POLICY, runs, [{ ...loops[0], afterAttemptId: 'gone' }]), expected);
  // No retest and no readable date: it splits nothing and lets nothing go.
  assert.ok(queued(recommend(LET_GO_POLICY, runs, [{ ...loops[0], afterAttemptId: 'gone', at: 'never' }]), 'th'));

  // A newer loop, drilled again later, starts a new walk from its own retest.
  const again = [...loops, loop('again', 'th', runs.at(-1))];
  assert.ok(queued(recommend(LET_GO_POLICY, runs, again), 'th'));
});

test('pace: a pair drilled for its pace is let go on runs that are rarely slower than the person’s pace, read as a sign, never a spread', () => {
  const slow = (n, ms) => run(n, [['ck', 12, 0, 12, 200 + ms, ms]]);
  const named = Array.from({ length: 12 }, (_, n) => slow(n, 90));
  const retest = slow(12, -10);
  const loops = [loop('l', 'ck', retest, 'slow')];
  const runs = [...named, retest];

  // Faster than the run's median in every run since: let go at the first run the walk and the floors allow.
  const faster = Math.log(0.5 / (1 - LET_GO.slowShare));
  const needed = Math.max(FIXED_RUNS, Math.ceil(FIXED_OBSERVATIONS / 12), Math.ceil(Math.log(LET_GO.letGoOdds) / faster));
  let at = null;

  for (let n = 13; n < 40 && at === null; n += 1) {
    if (!queued(recommend(LET_GO_POLICY, runs, loops, 'speed'), 'ck')) at = runs.length - 12;
    else runs.push(slow(n, -10));
  }

  assert.equal(at, needed);
  assert.ok(queued(recommend(DECAY_TIMING_POLICY, runs, loops, 'speed'), 'ck'), 'the shipped learner still names it');
  // How much slower never enters: as slow as ever in ms, only rarely slower than the pace, is let go the same.
  const index = letGoIndex(learnerEvidence(runs, KEYBOARD));
  assert.equal(letGo(index, 'ck', 'slow', drillSplit(loops[0], index)), true);
  // The misses learner never lets a pace target go.
  assert.ok(queued(recommend(LET_GO_MISSES_POLICY, runs, loops, 'speed'), 'ck'));
});

test('a let-go drops only the kind drilled: a pair let go for its misses still ranks on its pace, and units never drilled rank as before', () => {
  const { runs, loops } = drilledHistory(20, 40, () => ['th', 9, 0, 9, 330, 130]);
  const evidence = learnerEvidence(runs, KEYBOARD);
  const drills = [...drilledTargets(loops, KEYBOARD).values()];

  for (const focus of FOCUSES) {
    const shipped = fitLearner(evidence, NOW, LEARNER_VARIANTS[DECAY_TIMING_POLICY], focus, drills);
    const model = fitLearner(evidence, NOW, LEARNER_VARIANTS[LET_GO_POLICY], focus, drills);
    const th = model.units.find((e) => e.unit === 'th');
    assert.deepEqual(th.letGo, ['errors'], focus);
    assert.ok(focus === 'accuracy' ? th.gain === 0 : th.basis === 'slow' && th.gain > 0, `${focus}: ${th.basis} ${th.gain}`);
    // Every other unit: the same gain and basis as the shipped learner gives it.
    const others = (m) => m.units.filter((e) => e.unit !== 'th').map((e) => [e.unit, e.gain, e.basis]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    assert.deepEqual(others(model), others(shipped), focus);
    // Nothing it predicts changes.
    assert.deepEqual(model.units.map((e) => [e.unit, e.error, e.slowdown]).sort(), shipped.units.map((e) => [e.unit, e.error, e.slowdown]).sort(), focus);
  }

  // With no loops it is the shipped learner under another name.
  const without = fitLearner(evidence, NOW, LEARNER_VARIANTS[LET_GO_POLICY]);
  assert.deepEqual({ ...without, policy: DECAY_TIMING_POLICY }, fitLearner(evidence, NOW, LEARNER_VARIANTS[DECAY_TIMING_POLICY]));
});

// Random histories: six pairs missed and slowed at random over 4 to 30 runs, and loops on them retested by random runs,
// some followed by long clean stretches so that targets are let go.
function randomHistory(random, round) {
  const pairs = ['th', 'he', 'in', 'er', 'an', 'ou'];
  const length = 4 + Math.floor(random() * 27);
  const cleanFrom = Object.fromEntries(pairs.map((pair) => [pair, Math.floor(random() * length)]));

  const runs = Array.from({ length }, (_, i) => {
    const pace = 120 + Math.floor(random() * 200);

    return summary(`m${round}-${i}`, random() < 0.05 ? null : day(i), withBackground(i, pairs.map((pair) => {
      const n = Math.floor(random() * 12);
      const weak = i < cleanFrom[pair];
      const ms = Math.max(1, Math.round(pace * Math.exp((weak ? 0.3 : 0) + random() * 0.4 - 0.2)));

      return [pair, n + Math.floor(random() * 3), weak && random() < 0.6 ? 1 + Math.floor(random() * 3) : 0, n, n ? ms : null, n ? ms - pace : null];
    })));
  });

  const loops = Array.from({ length: Math.floor(random() * 5) }, (_, i) => {
    const target = pairs[Math.floor(random() * pairs.length)];
    const after = runs[Math.min(length - 1, cleanFrom[target] + Math.floor(random() * 3))];

    return loop(`l${round}-${i}`, target, after.at ? after : runs[0], random() < 0.5 ? 'slow' : 'errors', random() < 0.1 ? { afterAttemptId: 'gone' } : {});
  });

  return { runs, loops };
}

test('across random histories in every focus, the let-go learner and the shared rule never disagree about a drilled unit', () => {
  const random = seeded(4170);
  let letGoSeen = 0;

  for (let round = 0; round < 300; round += 1) {
    const { runs, loops } = randomHistory(random, round);
    const records = learnerEvidence(runs, KEYBOARD);
    const index = letGoIndex(records);
    const drills = drilledTargets(loops, KEYBOARD);

    for (const focus of FOCUSES) {
      const recommendation = recommend(LET_GO_POLICY, runs, loops, focus);
      const model = fitLearner(records, NOW, LEARNER_VARIANTS[LET_GO_POLICY], focus, [...drills.values()]);
      const inQueue = new Map(recommendation.queue.map((item) => [item.unit, item.was.basis === 'slow' ? 'slow' : 'errors']));
      const where = `round ${round}, ${focus}`;

      for (const [unit, drilled] of drills) {
        const kind = drilled.targetBasis;
        const released = letGo(index, unit, kind, drillSplit(drilled, index));
        const estimate = model.units.find((e) => e.unit === unit);

        if (released) letGoSeen += 1;
        // The learner's fold and the shared rule agree, and the learner never queues or leans on it for the kind let go.
        assert.equal(Boolean(estimate?.letGo?.includes(kind)), released, `${where}: “${unit}” let go by one reader only`);
        assert.ok(!released || inQueue.get(unit) !== kind, `${where}: “${unit}” let go for ${kind} and queued for it`);
        assert.ok(!released || !(kind === 'errors' ? focus === 'accuracy' : focus === 'speed') || !recommendation.lean.some((item) => item.unit === unit), where);
      }
    }
  }

  assert.ok(letGoSeen > 50, `the generator lets targets go (${letGoSeen})`);
});

test('the rule reads loops and floors exactly as Train’s path does', () => {
  assert.equal(FIXED_RUNS, trainPathModule.FIXED_RUNS);
  assert.equal(FIXED_OBSERVATIONS, trainPathModule.FIXED_OBSERVATIONS);

  for (const item of [{ targetBasis: 'slow' }, { targetBasis: 'errors' }, { targetPace: { was: {} } }, {}]) assert.equal(basisOf(item), trainPathModule.basisOf(item));
  const random = seeded(4172);

  for (let round = 0; round < 40; round += 1) {
    const { runs, loops } = randomHistory(random, round);
    const path = trainPathModule.trainPath({ recommendation: { queue: [], target: null }, loops, runs, keyboard: KEYBOARD });
    const newest = drilledTargets(loops, KEYBOARD);
    assert.deepEqual(path.behind.map((step) => [step.unit, step.loopId]).sort(), [...newest.values()].map((item) => [item.target, item.id]).sort(), `round ${round}`);
  }
});

test('the let-go learner is the same whatever order runs and loops arrive in, and after either merge of two devices’ copies', () => {
  const random = seeded(4171);

  const shuffled = (items) => {
    const copy = [...items];

    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
  };

  for (let round = 0; round < 60; round += 1) {
    const { runs, loops } = randomHistory(random, round);

    for (const focus of FOCUSES) {
      const expected = recommend(LET_GO_POLICY, runs, loops, focus);
      assert.deepEqual(recommend(LET_GO_POLICY, shuffled(runs), shuffled(loops), focus), expected, `round ${round}: shuffled`);

      const base = { version: 2, profileId: 'p', preferences: {}, attempts: [], seenTextIds: [], bests: {} };
      const local = { ...base, runs: runs.slice(0, Math.ceil(runs.length / 2) + 1), loops: loops.slice(0, 2) };
      const cloud = { ...base, runs: runs.slice(Math.floor(runs.length / 2)), loops: loops.slice(1) };
      const [one, other] = [mergeSynced(local, cloud), mergeSynced(cloud, local)];
      assert.deepEqual(recommend(LET_GO_POLICY, one.runs, one.loops, focus), expected, `round ${round}: merged local into cloud`);
      assert.deepEqual(recommend(LET_GO_POLICY, other.runs, other.loops, focus), expected, `round ${round}: merged cloud into local`);
    }
  }
});

// ADR 0017 records that a let-go can flicker for a run as the typical rate moves or old runs leave the kept window, so
// this holds only the part that held: a target the drill left weak is never let go here, and most fixed ones are.
test('over a simulated season, a target the drill left weak is never let go, and most fixed targets are', () => {
  const policies = [{ name: 'let-go', policy: LET_GO_POLICY, constants: {} }];
  // 25 words a run, five a day, with and without bad days, average and careless typists; a validation seed.
  const rows = [25, 26, 28, 29].flatMap((cell) => seasonTask({ seed: 9001, cell, worlds: ['fixed', 'unchanged'], policies, detail: true }));
  const targets = rows.flatMap((row) => row.targets);
  const fixedWorld = targets.filter((t) => t.world === 'fixed');
  assert.ok(fixedWorld.length >= 8, `targets counted (${fixedWorld.length})`);

  const released = fixedWorld.filter((target) => target.results['let-go'].letGo.includes(true));
  assert.ok(released.length >= fixedWorld.length / 2, `${released.length} of ${fixedWorld.length} let go in the season`);

  assert.ok(targets.filter((t) => t.world === 'unchanged').every((t) => !t.results['let-go'].letGo.includes(true)), 'a still-weak target let go');
});

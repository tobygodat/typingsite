import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASELINE_POLICY, DECAY_POLICY, DECAY_TIMING_POLICY, DEFAULT_POLICY, HALF_LIFE_DAYS, HALF_LIFE_RUNS, LEARNER_POLICY, LEARNER_VARIANTS, POOLED_TRIES,
  TIMING_POLICY, countingRecommendation, englishFrequency, fitLearner, keyboardOf, learnerEvidence, learnerRecommendation, recommendFor, stated,
} from '../src/learner.js';
import { KEY_COUNTS_VERSION } from '../src/insights.js';
import { CORPUS_VERSION, METRIC_VERSION, makeAdaptive, makeDrill } from '../src/typing.js';
import { mergeSynced } from '../src/account.js';
import { normalizeProfile } from '../src/profile.js';
import { readFileSync } from 'node:fs';
import { MEASURES, TEST_SEEDS, decide, makeTypist, paired, seeded, SKILLS, typeRun } from '../scripts/evaluate-learner.mjs';

const conditions = { mode: 'words', count: 25, punctuation: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'mandatory',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

const KEYBOARD = keyboardOf(conditions);
const NOW = Date.parse('2026-11-10T12:00:00Z');
const day = (n) => new Date(Date.parse('2026-10-01T12:00:00Z') + n * 3_600_000).toISOString();

// A stored run summary with the given pattern rows: [pair, tries, errors, timed intervals, median ms, ms over the run's median].
const summary = (id, at, patterns, extra = {}) => ({ id, at, kind: 'test', status: 'complete', interrupted: false, fresh: true, conditions,
  patterns, keys: [], keysVersion: 0, ...extra });

// What a real run also holds: the 60 most frequent pairs, each typed cleanly a few times at the run's median pace.
const BACKGROUND = [...englishFrequency().pairs].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([pair]) => pair);
const withBackground = (rows) => [...BACKGROUND.filter((pair) => !rows.some((row) => row[0] === pair)).map((pair) => [pair, 3, 0, 3, 200, 0]), ...rows];

const fit = (runs, now = NOW, policy = DEFAULT_POLICY) => fitLearner(learnerEvidence(runs, KEYBOARD), now, LEARNER_VARIANTS[policy]);
const estimate = (model, unit) => model.units.find((e) => e.unit === unit);

function simulatedRuns(seed, count) {
  const random = seeded(seed);
  const typist = makeTypist(random, seed % 2 ? 'mechanics' : 'unrelated', SKILLS[seed % 3]);

  return Array.from({ length: count }, (_, r) => typeRun(typist, random, r, `s${seed}-${r}`).run);
}

function shuffled(items, random) {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

test('the model is the same whatever order the evidence arrives in, and however two halves merge', () => {
  for (let seed = 1; seed <= 6; seed += 1) {
    const runs = simulatedRuns(seed, 18);
    const evidence = learnerEvidence(runs, KEYBOARD);
    const random = seeded(seed * 97);

    // Both variants: the decay variant weighs runs by their order, so it is the one order could upset.
    for (const variant of Object.values(LEARNER_VARIANTS)) {
      const expected = fitLearner(evidence, NOW, variant);

      for (let round = 0; round < 4; round += 1) {
        const order = shuffled(evidence, random);
        const cut = Math.floor(random() * order.length);
        const [a, b] = [order.slice(0, cut), order.slice(cut)];
        assert.deepEqual(fitLearner(order, NOW, variant), expected, `seed ${seed}: shuffled`);
        assert.deepEqual(fitLearner([...a, ...b], NOW, variant), fitLearner([...b, ...a], NOW, variant), `seed ${seed}: halves either way`);
        // Two devices that each hold some of the same runs: overlap counts once.
        assert.deepEqual(fitLearner([...a, ...order, ...b], NOW, variant), expected, `seed ${seed}: overlapping copies`);
      }

      // Through the real sync merge: each device's copy holds a shuffled share of the runs.
      const order = shuffled(runs, random);
      const local = { version: 2, profileId: 'p', preferences: {}, attempts: [], loops: [], seenTextIds: [], bests: {}, runs: order.slice(0, 11) };
      const cloud = { ...local, runs: order.slice(7) };
      assert.deepEqual(fit(mergeSynced(local, cloud).runs, NOW, variant.policy), fit(runs, NOW, variant.policy));
      assert.deepEqual(fit(mergeSynced(cloud, local).runs, NOW, variant.policy), fit(runs, NOW, variant.policy));
    }
  }
});

test('with no history nothing ranks, and Train offers a plain general drill', () => {
  const model = fit([]);
  assert.equal(model.runs, 0);
  assert.ok(model.units.every((e) => e.gain === 0));
  const recommendation = learnerRecommendation(model);
  assert.equal(recommendation.kind, 'general');
  assert.equal(recommendation.target, null);
  assert.equal(recommendation.title, 'General drill');
  assert.equal(recommendation.reason, 'Not enough clean data to name a weakness yet.');
  assert.equal(recommendation.policy, DEFAULT_POLICY);
  assert.deepEqual(recommendation.lean, []);
  assert.deepEqual(recommendation.queue, []);
});

test('the estimate is the counts-only rate, (errors + K × pooled) / (tries + K), over runs weighted by age', () => {
  const runs = Array.from({ length: 4 }, (_, i) => summary(`r${i}`, day(i), [['th', 5, 1, 0, null, null], ['he', 10, 0, 0, null, null], ['an', 5, 1, 0, null, null]]));
  assert.equal(POOLED_TRIES, 40);

  // learner@1 weighs every run alike.
  const plain = fit(runs, NOW, LEARNER_POLICY);
  assert.ok(Math.abs(estimate(plain, 'th').error.mean - (4 + 40 * (8 / 80)) / (20 + 40)) < 1e-12);
  assert.ok(Math.abs(estimate(plain, 'ju').error.mean - 8 / 80) < 1e-12, 'a pair never typed is predicted at the pooled rate');

  // The default weighs a run 0.5^(later runs / 60) × 0.5^(age in days / 60).
  const w = runs.map((run, i) => 0.5 ** ((3 - i) / HALF_LIFE_RUNS) * 0.5 ** ((NOW - Date.parse(run.at)) / 86_400_000 / HALF_LIFE_DAYS));
  const sum = (per) => w.reduce((total, wi) => total + wi * per, 0);
  const pooled = sum(2) / sum(20);
  assert.ok(Math.abs(estimate(fit(runs), 'th').error.mean - (sum(1) + 40 * pooled) / (sum(5) + 40)) < 1e-12);
});

test('with decay, a fixed pair stops leading and a slipping pair comes back; without it, the old misses still count', () => {
  const clean = (pair) => [pair, 12, 0, 0, null, null];
  const weak = (pair) => [pair, 12, 4, 0, null, null];
  // "th" missed in 20 runs, then fixed for 60; "he" slips in the last 15.
  const early = Array.from({ length: 20 }, (_, i) => summary(`e${i}`, day(i), withBackground([weak('th'), clean('he')])));
  const late = Array.from({ length: 60 }, (_, i) => summary(`l${i}`, day(20 + i), withBackground([clean('th'), i >= 45 ? weak('he') : clean('he')])));
  const runs = [...early, ...late];
  const model = fit(runs, Date.parse(day(80)));
  assert.equal(learnerRecommendation(model).target, 'he');
  assert.equal(estimate(model, 'th').observed.errors, 80, 'what is shown stays the raw count');
  // The same history read after a long break counts for less, so the prior has more say.
  const later = fit(runs, Date.parse(day(80)) + 240 * 86_400_000);
  assert.ok(estimate(later, 'he').error.sd > estimate(model, 'he').error.sd);

  // learner@1 weighs every run alike, so "th" still holds all 80 of its old misses and still leads.
  assert.equal(learnerRecommendation(fit(runs, Date.parse(day(80)), LEARNER_POLICY)).target, 'th');

  // The same for slowness: "an" slow in 20 runs, then at pace for 80, while "ou" turns slow in the last 20. The
  // default ranks "ou" first, so its drills lean there, but names it only once it is slower in most of the runs
  // that timed it.
  const timed = (pair, ms) => [pair, 4, 0, 4, ms, ms - 200];

  const slow = [...Array.from({ length: 20 }, (_, i) => summary(`s${i}`, day(i), withBackground([timed('an', 320), timed('ou', 200)]))),
    ...Array.from({ length: 80 }, (_, i) => summary(`p${i}`, day(20 + i), withBackground([timed('an', 200), timed('ou', i >= 60 ? 320 : 200)])))];

  const top = (policy) => fit(slow, Date.parse(day(100)), policy).units[0].unit;
  assert.deepEqual([top(DEFAULT_POLICY), top(TIMING_POLICY)], ['ou', 'an']);
  assert.equal(learnerRecommendation(fit(slow, Date.parse(day(100)))).kind, 'general');
});

test('a target is named only on observed evidence, and its counts are the real ones', () => {
  // Three tries, two misses: the model suspects "wh", but three tries can't be stated.
  const thin = fit([summary('a', day(0), withBackground([['wh', 3, 2, 0, null, null]]))]);
  const general = learnerRecommendation(thin);
  assert.equal(estimate(thin, 'wh').gain > 0, true);
  assert.equal(general.kind, 'general');
  // The reason names the top-ranked unit with an observed miss, with its real counts ("h" holds wh's tries too).
  const missed = thin.units.find((e) => e.gain > 0 && e.observed.errors > 0);
  assert.ok(['wh', 'h'].includes(missed.unit));
  assert.equal(general.reason, `Too little data to target a pattern yet (“${missed.unit}”: 2 first-try errors in ${missed.observed.seen} tries).`);
  // The general drill leans toward the model's top units, and two misses in three tries move "wh" up them.
  assert.deepEqual(general.lean.map((item) => item.unit), thin.units.filter((e) => e.gain > 0).slice(0, 4).map((e) => e.unit));
  const rank = (model) => model.units.findIndex((e) => e.unit === 'wh');
  assert.ok(rank(thin) < rank(fit([])) / 2, `wh ranked ${rank(fit([]))} → ${rank(thin)}`);

  // With real letter counts: a run's h is typed some 30 times, and only wh's slip is on it.
  const runs = Array.from({ length: 4 }, (_, i) => summary(`r${i}`, day(i), withBackground([['wh', 4, 1, 0, null, null]]),
    { keys: [['h', 30, 1]], keysVersion: KEY_COUNTS_VERSION }));

  const targeted = learnerRecommendation(fit(runs));
  assert.equal(targeted.kind, 'targeted');
  assert.equal(targeted.target, 'wh');
  assert.equal(targeted.title, 'Practice “wh”');
  assert.equal(targeted.reason, '“wh”: 4 first-try errors in 16 tries over 4 runs.');
  assert.deepEqual(targeted.was, { errors: 4, observations: 16, runs: 4, slowRuns: 0 });
  assert.deepEqual(targeted.queue[0], { unit: 'wh', was: targeted.was });
  assert.equal(targeted.runs, 4);
});

test('a key is named only on misses outside the pairs ending in it that are named themselves', () => {
  // Every miss on "h" is inside "th", which is named on its own: "h" is no weakness of its own.
  const th = Array.from({ length: 3 }, (_, i) => summary(`t${i}`, day(i), withBackground([['th', 12, 12, 0, null, null]]),
    { keys: [['h', 40, 12], ['t', 50, 0]], keysVersion: KEY_COUNTS_VERSION }));

  const inside = fit(th);
  const h = estimate(inside, 'h');
  assert.deepEqual(h.own, { seen: 84, errors: 0 });
  assert.deepEqual([h.observed.seen, h.observed.errors], [120, 36], 'what is shown stays the key’s full count');
  assert.equal(stated(h), false);
  assert.equal(h.gain, 0);
  const recommendation = learnerRecommendation(inside);
  assert.equal(recommendation.target, 'th');
  assert.deepEqual(recommendation.queue.map(({ unit }) => unit), ['th']);
  assert.ok(!recommendation.lean.some(({ unit }) => unit === 'h'));

  // "e" missed across ten pairs, none with the tries to be named alone: the key is the weakness, and is named.
  const spread = ['he', 're', 'te', 'me', 'de', 'ne', 've', 'le', 'se', 'we'];

  const everywhere = fit(Array.from({ length: 3 }, (_, i) => summary(`e${i}`, day(i), withBackground(spread.map((pair) => [pair, 3, 1, 0, null, null])),
    { keys: [['e', 40, 10]], keysVersion: KEY_COUNTS_VERSION })));

  // Its own misses leave out its most-missed pair (3), so they are misses beyond any one pair.
  assert.deepEqual(estimate(everywhere, 'e').own, { seen: 120, errors: 27 });
  const named = learnerRecommendation(everywhere);
  assert.equal(named.target, 'e');
  assert.equal(named.reason, '“e”: 30 first-try errors in 120 tries over 3 runs.');
  assert.deepEqual(named.was, { errors: 30, observations: 120, runs: 3, slowRuns: 0 });
  assert.deepEqual(named.queue.map(({ unit }) => unit), ['e']);

  // One slip on a "th" too thin to name: the miss is still th's, so neither is named, queued or offered.
  const thin = fit([summary('one', day(0), withBackground([['th', 4, 1, 0, null, null]]), { keys: [['h', 30, 1], ['t', 30, 0]], keysVersion: KEY_COUNTS_VERSION })]);
  assert.deepEqual(estimate(thin, 'h').own, { seen: 30, errors: 0 });
  assert.equal(learnerRecommendation(thin).kind, 'general');
  assert.deepEqual(learnerRecommendation(thin).queue, []);
});

test('a pair ranked on its slowness is named only on its observed timing, and reads it back', () => {
  assert.equal(stated({ observed: { seen: 10, errors: 1 } }), true);
  assert.equal(stated({ observed: { seen: 9, errors: 3 } }), false);
  assert.equal(stated({ observed: { seen: 40, errors: 0 } }), false);
  // "ou" never missed, three intervals a run at 300 ms against a 200 ms median.
  const slowRun = (id, i, ms = 300) => summary(id, day(i), [['ou', 3, 0, 3, ms, ms - 200], ['th', 30, 0, 20, 200, 0]]);
  const runs = Array.from({ length: 4 }, (_, i) => slowRun(`r${i}`, i));

  // Without the timing term nothing ranks it.
  assert.equal(estimate(fit(runs, NOW, LEARNER_POLICY), 'ou').gain, 0);

  // The default ranks it on its slowness, and four runs give twelve clean intervals, slower in all four.
  const model = fit(runs);
  const ou = estimate(model, 'ou');
  assert.equal(ou.basis, 'slow');
  assert.ok(ou.slowdown > 0 && ou.slowdown < Math.log(1.5), 'the pooled slowdown shrinks toward none');
  const named = learnerRecommendation(model);
  assert.equal(named.target, 'ou');
  assert.equal(named.reason, '“ou”: 100 ms slower than your pace, in 4 of 4 runs that timed it (12 clean intervals).');
  assert.deepEqual(named.was, { errors: 0, observations: 12, runs: 4, slowRuns: 4, basis: 'slow', slowMs: 100, timed: 12, timedRuns: 4 });

  // Nine intervals are under the floor: it ranks, and leans the drill, but is not named.
  const thin = learnerRecommendation(fit(runs.slice(0, 3)));
  assert.equal(thin.kind, 'general');
  assert.deepEqual(thin.queue, []);
  assert.equal(thin.lean[0].unit, 'ou');

  // Slower in only half the runs that timed it: not named, however slow on average.
  const mixed = learnerRecommendation(fit([slowRun('a', 0, 500), slowRun('b', 1, 500), slowRun('c', 2, 190), slowRun('d', 3, 190)]));
  assert.equal(mixed.kind, 'general');
});

test('only measured runs on the same keyboard are evidence; drills, adaptive runs and touch never are', () => {
  const row = [['th', 10, 3, 0, null, null]];

  const runs = [
    summary('test', day(0), row),
    summary('drill', day(1), row, { kind: 'drill', target: 'th' }),
    summary('adaptive', day(2), row, { kind: 'drill', adaptive: true }),
    summary('repeat', day(3), row, { fresh: false }),
    summary('touch', day(4), row, { conditions: { ...conditions, inputClass: 'touch' } }),
    summary('dvorak', day(5), row, { conditions: { ...conditions, layout: 'dvorak' } }),
    summary('lesson', day(6), row, { kind: 'lesson' }),
    summary('race', day(7), row, { kind: 'challenge' }),
    summary('daily', day(8), row, { kind: 'daily' }),
    summary('other length', day(9), row, { conditions: { ...conditions, count: 50 } }),
  ];

  assert.deepEqual(learnerEvidence(runs, KEYBOARD).map((record) => record.id), ['test', 'daily', 'other length']);
});

test('old stored profiles load and feed the learner; a profile from this build merges with one from the previous build', () => {
  // A summary from before letter counts: keys fall back to the pairs' second letters.
  const old = { id: 'old', at: day(0), kind: 'test', status: 'complete', interrupted: false, fresh: true, conditions, patterns: [['th', 12, 2, 4, 210, 10]] };
  const loaded = normalizeProfile({ version: 2, profileId: 'p', preferences: {}, runs: [old] });
  const [record] = learnerEvidence(loaded.runs, KEYBOARD);
  assert.deepEqual(record.units.map((u) => [u.unit, u.seen, u.errors]), [['h', 12, 2], ['th', 12, 2]]);

  const current = summary('new', day(1), [['th', 12, 1, 4, 210, 10]], { keys: [['h', 20, 1], ['t', 20, 0]], keysVersion: KEY_COUNTS_VERSION });
  const previousBuild = { version: 2, profileId: 'p', preferences: {}, attempts: [], loops: [], seenTextIds: [], bests: {}, runs: [old] };
  const thisBuild = { ...previousBuild, runs: [old, current] };

  for (const merged of [mergeSynced(previousBuild, thisBuild), mergeSynced(thisBuild, previousBuild)]) {
    assert.deepEqual(merged.runs.map((run) => run.id), ['old', 'new']);
    assert.deepEqual(fit(merged.runs), fit([old, current]));
  }
});

test('each policy records itself; the counting rule stays as the labelled baseline', () => {
  const runs = Array.from({ length: 3 }, (_, i) => summary(`r${i}`, day(i), [['th', 6, 1, 0, null, null]]));
  const counting = recommendFor(BASELINE_POLICY, { runs, loops: [], traces: [], source: conditions, now: NOW });
  assert.equal(counting.policy, BASELINE_POLICY);
  assert.equal(counting.target, 'th');
  assert.deepEqual(countingRecommendation(runs, [], [], conditions).was, { errors: 3, observations: 18, runs: 3, slowRuns: 0 });

  for (const policy of Object.keys(LEARNER_VARIANTS)) assert.equal(recommendFor(policy, { runs, loops: [], traces: [], source: conditions, now: NOW }).policy, policy);
  assert.equal(DEFAULT_POLICY, DECAY_TIMING_POLICY);
  assert.deepEqual([LEARNER_VARIANTS[DEFAULT_POLICY].decay, LEARNER_VARIANTS[DEFAULT_POLICY].timing], [true, true]);
  assert.deepEqual([LEARNER_VARIANTS[DECAY_POLICY].timing, LEARNER_VARIANTS[TIMING_POLICY].decay], [false, false]);
});

test('adaptive text and a leaning drill draw real words across several units by weight', () => {
  let seed = 3;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const passage = makeAdaptive([{ unit: 'ou', weight: 3 }, { unit: 'br', weight: 1 }], { mode: 'words', count: 200, random });
  assert.equal(passage.textVersion, 'adaptive@2');
  assert.deepEqual(passage.pairs, ['ou', 'br']);
  const words = passage.text.split(' ');
  const ou = words.filter((word) => word.includes('ou')).length;
  const br = words.filter((word) => word.includes('br')).length;
  assert.ok(ou > br * 1.5 && br > 0, `ou ${ou}, br ${br}`);

  const lean = [{ unit: 'wh', weight: 2 }, { unit: 'q', weight: 1 }];
  const drill = makeDrill(null, '200', lean);
  assert.equal(drill.textVersion, 'drill-general-lean@1');
  assert.equal(drill.target, '');
  assert.equal(drill.text, makeDrill(null, '200', lean).text, 'same lean, same text');
  assert.ok(drill.text.split(' ').filter((word) => word.includes('wh')).length > 200);
  assert.equal(makeDrill(null).textVersion, 'drill-general@2', 'a drill with nothing to lean on is the general drill as before');
});

// Thirty seeds of per-seed results for rule v2's five policies. Each measure is `base` plus a policy's offset
// (`shift`), and every learner policy jitters by ±`jitter` × its index on alternate seeds, so an offset of zero
// is a tie whose interval holds zero and any other offset is a real difference.
const POLICIES = ['counting@1', 'counts-gain', '+decay', '+timing', '+decay +timing'];
const BASE = { logLoss: 0.2, calibration: 0.004, captured10: 0.4, captured40: 0.5, planted10: 0.25, pickUp: 15, letGo: 15, slowPickUp: 21, slowLetGo: 5 };

const synthetic = (shift = {}) => ({
  seeds: TEST_SEEDS,
  policies: POLICIES.map((name) => ({ name })),
  perSeed: TEST_SEEDS.map((seed, s) => Object.fromEntries(POLICIES.map((name, p) => [name, Object.fromEntries(Object.keys(MEASURES).map((m) => [m,
    name === 'counting@1' && ['logLoss', 'calibration'].includes(m) ? null : BASE[m] + (shift[name]?.[m] || 0) + (s % 2 ? 1 : -1) * 1e-4 * p]))]))),
});

test('ADR 0013’s rule v2: paired differences over thirty seeds decide timing, then decay, then the baseline', () => {
  const tie = paired(synthetic(), '+timing', 'counts-gain', 'logLoss');
  assert.ok(tie.low < 0 && tie.high > 0, 'alternating jitter is a tie');
  assert.ok(paired(synthetic({ '+decay': { letGo: -2 } }), '+decay', 'counts-gain', 'letGo').high < 0);
  assert.throws(() => paired({ perSeed: synthetic().perSeed.slice(0, 5) }, '+decay', 'counts-gain', 'letGo'), /30 seeds/);

  // Ties everywhere: neither component is really worse, but decay must really help to come in.
  assert.equal(decide(synthetic()).default, '+timing');

  // Decay lets go sooner and loses nothing: both are in.
  const helps = { letGo: -2 };
  assert.equal(decide(synthetic({ '+decay': helps, '+decay +timing': helps })).default, '+decay +timing');

  // Decay lets go sooner but predicts worse: the default has no decay, and says why.
  const harms = { letGo: -2, logLoss: 0.001 };
  const unmet = decide(synthetic({ '+decay': harms, '+decay +timing': harms }));
  assert.deepEqual([unmet.default, unmet.decay, unmet.decayHarm], ['+timing', false, ['logLoss']]);

  // Timing that captures less time lost is out, with or without decay.
  const costly = { captured10: -0.05 };
  assert.deepEqual([decide(synthetic({ '+timing': costly, '+decay +timing': costly })).default, decide(synthetic({ '+decay +timing': costly })).timing], ['counts-gain', false]);

  // A learner that captures less than counting@1 leaves counting@1 the default.
  assert.equal(decide(synthetic({ 'counting@1': { captured40: 0.1 } })).default, 'counting@1');
});

test('the recorded v2 evaluation (docs/adr/0013-evaluation-v2.json) picks decay and timing, and says only this', () => {
  const recorded = JSON.parse(readFileSync(new URL('../docs/adr/0013-evaluation-v2.json', import.meta.url), 'utf8'));
  const verdict = decide(recorded);
  assert.deepEqual(recorded.seeds, TEST_SEEDS);
  assert.deepEqual(TEST_SEEDS, Array.from({ length: 30 }, (_, i) => 101 + i));
  assert.deepEqual([recorded.validation.pooledTries, recorded.validation.halfLifeRuns, recorded.validation.timingTries], [40, 60, 5]);
  assert.deepEqual([LEARNER_VARIANTS[DEFAULT_POLICY].pooledTries, LEARNER_VARIANTS[DEFAULT_POLICY].halfLifeRuns, LEARNER_VARIANTS[DEFAULT_POLICY].timingTries], [40, 60, 5]);
  assert.equal(verdict.default, '+decay +timing');
  assert.deepEqual(recorded.decision, verdict);

  const d = (a, b, m) => paired(recorded, a, b, m);
  const better = (a, b, m) => (MEASURES[m] ? d(a, b, m).high < 0 : d(a, b, m).low > 0);
  const tie = (a, b, m) => d(a, b, m).low <= 0 && d(a, b, m).high >= 0;

  // Timing changes no prediction, and is in by the rule; it also captures more of the time lost and finds more planted
  // error pairs at 10 runs, but is really slower to pick up a slipping error pair.
  assert.deepEqual([d('+timing', 'counts-gain', 'logLoss'), d('+timing', 'counts-gain', 'calibration')].map(({ mean }) => mean), [0, 0]);

  for (const m of ['captured10', 'captured40', 'planted10']) assert.ok(better('+timing', 'counts-gain', m), m);

  assert.ok(d('+timing', 'counts-gain', 'pickUp').low > 0);

  // Decay: really better at picking up and letting go, and at letting go of a slow pair; a tie on calibration and
  // captured gain at 10 runs.
  assert.deepEqual(verdict.decayHelps, ['pickUp', 'letGo', 'slowLetGo']);

  for (const m of ['calibration', 'captured10', 'slowPickUp']) assert.ok(tie('+decay +timing', '+timing', m), m);

  // The default captures more of the time lost than counting@1, at 10 and at 40 runs.
  for (const m of ['captured10', 'captured40']) assert.ok(better('+decay +timing', 'counting@1', m), m);
});

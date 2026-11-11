import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASELINE_POLICY, DECAY_POLICY, DEFAULT_POLICY, LEARNER_POLICY, LEARNER_VARIANTS, POOLED_TRIES, countingRecommendation, englishFrequency, fitLearner,
  keyboardOf, learnerEvidence, learnerRecommendation, recommendFor, stated,
} from '../src/learner.js';
import { KEY_COUNTS_VERSION } from '../src/insights.js';
import { CORPUS_VERSION, METRIC_VERSION, makeAdaptive, makeDrill } from '../src/typing.js';
import { mergeSynced } from '../src/account.js';
import { normalizeProfile } from '../src/profile.js';
import { readFileSync } from 'node:fs';
import { decide, makeTypist, seeded, SKILLS, spread, typeRun } from '../scripts/evaluate-learner.mjs';

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
  assert.equal(recommendation.policy, LEARNER_POLICY);
  assert.deepEqual(recommendation.lean, []);
  assert.deepEqual(recommendation.queue, []);
});

test('the estimate is the counts-only rate: (errors + K × pooled) / (tries + K)', () => {
  const runs = Array.from({ length: 4 }, (_, i) => summary(`r${i}`, day(i), [['th', 5, 1, 0, null, null], ['he', 10, 0, 0, null, null], ['an', 5, 1, 0, null, null]]));
  const model = fit(runs);
  const pooled = 8 / 80;
  assert.equal(POOLED_TRIES, 40);
  assert.ok(Math.abs(estimate(model, 'th').error.mean - (4 + 40 * pooled) / (20 + 40)) < 1e-12);
  assert.ok(Math.abs(estimate(model, 'ju').error.mean - pooled) < 1e-12, 'a pair never typed is predicted at the pooled rate');
});

test('with decay, a fixed pair stops leading and a slipping pair comes back; without it, the old misses still count', () => {
  const clean = (pair) => [pair, 12, 0, 0, null, null];
  const weak = (pair) => [pair, 12, 4, 0, null, null];
  const early = Array.from({ length: 20 }, (_, i) => summary(`e${i}`, day(i), withBackground([weak('th'), clean('he'), clean('in')])));
  const late = Array.from({ length: 40 }, (_, i) => summary(`l${i}`, day(20 + i), withBackground([clean('th'), i >= 30 ? weak('he') : clean('he'), clean('in')])));
  const model = fit([...early, ...late], Date.parse(day(60)), DECAY_POLICY);
  const th = estimate(model, 'th');
  const he = estimate(model, 'he');
  // Undecayed, th reads 80 errors in 720 tries (11%). With a 10-run half-life the 20 weak runs, 40 to 59 runs
  // back, weigh under a tenth of a run against the clean 40's 14.
  assert.ok(th.error.mean < 0.02, `th ${th.error.mean.toFixed(3)}`);
  assert.ok(he.error.mean > 0.08, `he ${he.error.mean.toFixed(3)}`);
  assert.equal(learnerRecommendation(model).target, 'he');
  assert.equal(th.observed.errors, 80, 'what is shown stays the raw count');
  // The same history read after a long break counts for less, so the prior has more say.
  const later = fit([...early, ...late], Date.parse(day(60)) + 240 * 86_400_000, DECAY_POLICY);
  assert.ok(estimate(later, 'he').error.sd > he.error.sd);

  // The default weighs every run alike, so "th" still holds all 80 of its old misses.
  const kept = fit([...early, ...late], Date.parse(day(60)));
  assert.ok(estimate(kept, 'th').error.mean > 0.08, `th ${estimate(kept, 'th').error.mean.toFixed(3)}`);
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

test('a unit is named only with the floor of first tries and a miss among them; slowness alone names nothing', () => {
  assert.equal(stated({ observed: { seen: 10, errors: 1 } }), true);
  assert.equal(stated({ observed: { seen: 9, errors: 3 } }), false);
  assert.equal(stated({ observed: { seen: 40, errors: 0 } }), false);
  // "ou" never missed, three intervals a run at 300 ms against a 200 ms median: nothing ranks it.
  const runs = Array.from({ length: 4 }, (_, i) => summary(`r${i}`, day(i), [['ou', 3, 0, 3, 300, 100], ['th', 30, 0, 20, 200, 0]]));
  assert.equal(estimate(fit(runs), 'ou').gain, 0);
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

  for (const policy of [LEARNER_POLICY, DECAY_POLICY]) assert.equal(recommendFor(policy, { runs, loops: [], traces: [], source: conditions, now: NOW }).policy, policy);
  assert.equal(DEFAULT_POLICY, LEARNER_POLICY);
  assert.equal(LEARNER_VARIANTS[DEFAULT_POLICY].decay, false);
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

// Per-seed results for three policies, from [planted@10, pick-up, log loss] on each of two seeds.
const synthetic = (rows) => ({
  policies: [{ name: 'counting@1', components: null }, { name: 'counts-gain', components: [] }, { name: 'full', components: ['features', 'decay', 'hesitation'] }],
  perSeed: [0, 1].map((seed) => Object.fromEntries(Object.entries(rows).map(([name, values]) => [name,
    { planted10: values[seed][0], pickUp: values[seed][1], logLoss: values[seed][2] }]))),
});

test('ADR 0013’s rule: the simplest eligible policy that nothing eligible beats on ranking', () => {
  // Overlapping ranges are matches, so the simplest policy stays.
  const tie = synthetic({ 'counting@1': [[0.2, 15, null], [0.3, 12, null]], 'counts-gain': [[0.25, 14, 0.2], [0.35, 11, 0.21]], full: [[0.28, 13, 0.2], [0.33, 10, 0.21]] });
  assert.equal(decide(tie).default, 'counting@1');

  // A variant whose whole range is better wins, unless a simpler one matches it.
  const better = synthetic({ 'counting@1': [[0.1, 21, null], [0.15, 21, null]], 'counts-gain': [[0.12, 20, 0.2], [0.16, 21, 0.21]], full: [[0.3, 21, 0.2], [0.35, 21, 0.21]] });
  assert.equal(decide(better).default, 'full');
  assert.equal(decide(better).beats('full', 'counts-gain'), true);

  // A variant that predicts worse than the counts-only rate beyond the spread is not eligible.
  const worse = synthetic({ 'counting@1': [[0.1, 21, null], [0.15, 21, null]], 'counts-gain': [[0.12, 20, 0.2], [0.16, 21, 0.21]], full: [[0.3, 21, 0.25], [0.35, 21, 0.26]] });
  assert.deepEqual(decide(worse).eligible, ['counting@1', 'counts-gain']);
  assert.equal(decide(worse).default, 'counting@1');
});

test('the recorded evaluation (docs/adr/0013-evaluation.json) picks counts-gain, and says only this', () => {
  const recorded = JSON.parse(readFileSync(new URL('../docs/adr/0013-evaluation.json', import.meta.url), 'utf8'));
  const verdict = decide(recorded);
  assert.deepEqual(recorded.seeds, [1, 2, 3, 4, 5]);
  assert.deepEqual([recorded.validation.pooledTries, recorded.validation.halfLifeRuns], [40, 10]);
  assert.equal(verdict.default, 'counts-gain');
  assert.equal(recorded.default, 'counts-gain');

  const range = (name, read) => spread(recorded, name, read);
  const overlap = (a, b) => a.low <= b.high && b.low <= a.high;
  // Prediction: the full model and the counts-only rate tie on log loss, and the full model is worse calibrated.
  assert.ok(overlap(range('full', (s) => s.logLoss), range('counts-gain', (s) => s.logLoss)));
  assert.ok(range('full', (s) => s.calibration).low > range('counts-gain', (s) => s.calibration).high);

  // Ranking: six variants beat counting@1, nothing beats counts-gain, and counts-gain doesn't beat counting@1 either.
  assert.deepEqual(recorded.policies.map((p) => p.name).filter((name) => verdict.beats(name, 'counting@1')).sort(),
    ['+decay', '+decay +hesitation', '+features +decay', '+features +hesitation', '+hesitation', 'full'].sort());
  assert.equal(recorded.policies.some(({ name }) => verdict.beats(name, 'counts-gain')), false);
  assert.equal(verdict.beats('counts-gain', 'counting@1'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASELINE_POLICY, DEFAULT_POLICY, FEATURES, LEARNER_POLICY, START_WEIGHTS, countingRecommendation, englishFrequency, fitLearner, keyboardOf, learnerEvidence,
  learnerRecommendation, recommendFor, stated,
} from '../src/learner.js';
import { KEY_COUNTS_VERSION, correctionTimes, runRecord } from '../src/insights.js';
import { CORPUS_VERSION, METRIC_VERSION, makeAdaptive, makeDrill } from '../src/typing.js';
import { mergeSynced } from '../src/account.js';
import { normalizeProfile } from '../src/profile.js';
import { evaluate, makeTypist, seeded, SKILLS, typeRun } from '../scripts/evaluate-learner.mjs';

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

const fit = (runs, now = NOW) => fitLearner(learnerEvidence(runs, KEYBOARD), now, 'qwerty');
const estimate = (model, unit) => model.units.find((e) => e.unit === unit);

function simulatedRuns(seed, count) {
  const random = seeded(seed);
  const typist = makeTypist(random, seed % 2 ? 'mechanics' : 'unrelated', SKILLS[seed % 3]);

  return Array.from({ length: count }, (_, r) => typeRun(typist, random, r, `s${seed}-${r}`));
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
    const expected = fitLearner(evidence, NOW, 'qwerty');
    const random = seeded(seed * 97);

    for (let round = 0; round < 4; round += 1) {
      const order = shuffled(evidence, random);
      const cut = Math.floor(random() * order.length);
      const [a, b] = [order.slice(0, cut), order.slice(cut)];
      assert.deepEqual(fitLearner(order, NOW, 'qwerty'), expected, `seed ${seed}: shuffled`);
      assert.deepEqual(fitLearner([...a, ...b], NOW, 'qwerty'), fitLearner([...b, ...a], NOW, 'qwerty'), `seed ${seed}: halves either way`);
      // Two devices that each hold some of the same runs: overlap counts once.
      assert.deepEqual(fitLearner([...a, ...order, ...b], NOW, 'qwerty'), expected, `seed ${seed}: overlapping copies`);
    }

    // Through the real sync merge: each device's copy holds a shuffled share of the runs.
    const order = shuffled(runs, random);
    const local = { version: 2, profileId: 'p', preferences: {}, attempts: [], loops: [], seenTextIds: [], bests: {}, runs: order.slice(0, 11) };
    const cloud = { ...local, runs: order.slice(7) };
    assert.deepEqual(fit(mergeSynced(local, cloud).runs), fit(runs));
    assert.deepEqual(fit(mergeSynced(cloud, local).runs), fit(runs));
  }
});

test('with no history the weights are the hand-set prior, and Train offers a general drill that leans', () => {
  const model = fit([]);
  assert.deepEqual(model.weights.error, START_WEIGHTS.error);
  assert.equal(model.weights.error.length, FEATURES.length);
  assert.equal(model.runs, 0);
  const recommendation = learnerRecommendation(model);
  assert.equal(recommendation.kind, 'general');
  assert.equal(recommendation.target, null);
  assert.equal(recommendation.title, 'General drill');
  assert.equal(recommendation.reason, 'Not enough clean data to name a weakness yet.');
  assert.equal(recommendation.policy, LEARNER_POLICY);
  assert.ok(recommendation.lean.length > 0 && recommendation.lean.every((item) => item.weight > 0));
});

test('evidence about some pairs moves the estimate for an unseen pair with the same mechanics', () => {
  // Same-finger pairs on qwerty (de, ed, ce, ki) missed often; "ju" (same finger) never typed.
  const sameFinger = ['de', 'ed', 'ce', 'ki', 'lo', 'fr'];

  const runs = Array.from({ length: 12 }, (_, i) => summary(`r${i}`, day(i), [...sameFinger.map((pair) => [pair, 6, 2, 0, null, null]),
    ['th', 20, 0, 0, null, null], ['he', 20, 0, 0, null, null], ['an', 20, 0, 0, null, null], ['in', 20, 0, 0, null, null]]));

  const before = estimate(fit([]), 'ju').error.mean;
  const after = estimate(fit(runs), 'ju').error.mean;
  assert.ok(after > before * 1.2, `unseen same-finger pair: ${before.toFixed(3)} → ${after.toFixed(3)}`);
  assert.ok(fit(runs).weights.error[FEATURES.indexOf('sameFinger')] > START_WEIGHTS.error[FEATURES.indexOf('sameFinger')]);

  // A pair seen twice, missed once, already has a view above the typical pair.
  const twice = fit([summary('a', day(0), [['qu', 1, 1, 0, null, null]]), summary('b', day(1), [['qu', 1, 0, 0, null, null]])]);
  assert.ok(estimate(twice, 'qu').error.mean > twice.errorRate);
});

test('old evidence fades: a fixed pair stops leading and a slipping pair comes back', () => {
  const clean = (pair) => [pair, 12, 0, 0, null, null];
  const weak = (pair) => [pair, 12, 4, 0, null, null];
  const early = Array.from({ length: 20 }, (_, i) => summary(`e${i}`, day(i), withBackground([weak('th'), clean('he'), clean('in')])));
  const late = Array.from({ length: 40 }, (_, i) => summary(`l${i}`, day(20 + i), withBackground([clean('th'), i >= 30 ? weak('he') : clean('he'), clean('in')])));
  const model = fit([...early, ...late], Date.parse(day(60)));
  const th = estimate(model, 'th');
  const he = estimate(model, 'he');
  // Undecayed, th would read 80 errors in 720 tries (11%). Decayed, the 20 weak runs, 40 to 59 runs back,
  // weigh about 6 runs against the clean 40's 25.
  assert.ok(th.error.mean < 0.07, `th ${th.error.mean.toFixed(3)}`);
  assert.ok(he.error.mean > 0.08 && he.error.mean > th.error.mean, `he ${he.error.mean.toFixed(3)}`);
  assert.equal(learnerRecommendation(model).target, 'he');
  assert.equal(th.observed.errors, 80, 'what is shown stays the raw count');
  // The same history read after a long break counts for less, so the prior has more say.
  const later = fit([...early, ...late], Date.parse(day(60)) + 240 * 86_400_000);
  assert.ok(estimate(later, 'he').error.sd > he.error.sd);
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
  assert.deepEqual(general.lean.map((item) => item.unit), thin.units.slice(0, 4).map((e) => e.unit));
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
  assert.deepEqual(targeted.queue.slice(0, 1), ['wh']);
});

test('slowness is stated from pooled clean intervals, slower in most of the runs that timed them', () => {
  // "ou" never missed, three intervals a run at 300 ms against a 200 ms median.
  const runs = Array.from({ length: 4 }, (_, i) => summary(`r${i}`, day(i), [['ou', 3, 0, 3, 300, 100], ['th', 30, 0, 20, 200, 0]]));
  const model = fit(runs);
  const ou = estimate(model, 'ou');
  assert.ok(ou.hesitation.mean > 0.2);
  assert.deepEqual([ou.observed.timed, ou.observed.timedRuns, ou.observed.slowRuns], [12, 4, 4]);
  assert.equal(stated(ou), true);
  assert.equal(Math.round(model.medianMs), 200);
  assert.equal(stated({ observed: { ...ou.observed, timed: 9 } }), false);
  assert.equal(stated({ observed: { ...ou.observed, slowRuns: 2 } }), false);
});

test('the measured cost of a correction prices errors, with a stated default before there is one', () => {
  const patterns = [['th', 20, 2, 10, 200, 0]];
  assert.equal(Math.round(fit([summary('a', day(0), patterns)]).costMs), 400, 'two clean keystrokes by default');
  assert.equal(Math.round(fit([summary('a', day(0), patterns, { corrections: [3, 800] })]).costMs), 600);
});

test('correction times run from the keystroke before the miss to the right letter kept', () => {
  const text = 'the cat';

  // Stop on error: the wrong key is refused, the right one follows 300 ms later.
  const refused = [...text].flatMap((char, i) => (i === 5
    ? [{ type: 'insert', text: 'x', position: i, accepted: false, offsetMs: i * 100 + 100 }, { type: 'insert', text: char, position: i, offsetMs: i * 100 + 400 }]
    : [{ type: 'insert', text: char, position: i, offsetMs: i * 100 + (i > 5 ? 400 : 100) }]));

  assert.deepEqual(correctionTimes({ text, events: refused }), [1, 400]);

  // Continue on error: a wrong letter, one more past it, two backspaces, then the right ones.
  const relaxed = [
    ...[...'the c'].map((char, i) => ({ type: 'insert', text: char, position: i, offsetMs: (i + 1) * 100 })),
    { type: 'insert', text: 'x', position: 5, offsetMs: 600 }, { type: 'insert', text: 't', position: 6, offsetMs: 700 },
    { type: 'delete', count: 2, offsetMs: 900 }, { type: 'insert', text: 'a', position: 5, offsetMs: 1000 }, { type: 'insert', text: 't', position: 6, offsetMs: 1100 },
  ];

  assert.deepEqual(correctionTimes({ text, events: relaxed }), [1, 500]);
  // An error never put right is not timed; nor is a clean run.
  assert.deepEqual(correctionTimes({ text: 'ab', events: [{ type: 'insert', text: 'a', position: 0, offsetMs: 100 }, { type: 'insert', text: 'x', position: 1, offsetMs: 200 }] }), [0, null]);
  const record = runRecord({ id: 'r', kind: 'test', status: 'complete', conditions, textId: 'r', fresh: true, text, events: refused });
  assert.deepEqual(record.corrections, [1, 400]);
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
  // A summary from before letter counts and correction times: keys fall back to the pairs' second letters.
  const old = { id: 'old', at: day(0), kind: 'test', status: 'complete', interrupted: false, fresh: true, conditions, patterns: [['th', 12, 2, 4, 210, 10]] };
  const loaded = normalizeProfile({ version: 2, profileId: 'p', preferences: {}, runs: [old] });
  const [record] = learnerEvidence(loaded.runs, KEYBOARD);
  assert.equal(record.correction, null);
  assert.deepEqual(record.units.map((u) => [u.unit, u.seen, u.errors]), [['h', 12, 2], ['th', 12, 2]]);
  assert.equal(record.medianMs, 200);

  const current = summary('new', day(1), [['th', 12, 1, 4, 210, 10]], { corrections: [1, 500] });
  const previousBuild = { version: 2, profileId: 'p', preferences: {}, attempts: [], loops: [], seenTextIds: [], bests: {}, runs: [old] };
  const thisBuild = { ...previousBuild, runs: [old, current] };

  for (const merged of [mergeSynced(previousBuild, thisBuild), mergeSynced(thisBuild, previousBuild)]) {
    assert.deepEqual(merged.runs.map((run) => run.id), ['old', 'new']);
    assert.deepEqual(merged.runs[1].corrections, [1, 500]);
    assert.deepEqual(fit(merged.runs), fit([old, current]));
  }
});

test('each policy records itself; the counting rule stays as the labelled baseline', () => {
  const runs = Array.from({ length: 3 }, (_, i) => summary(`r${i}`, day(i), [['th', 6, 1, 0, null, null]]));
  const counting = recommendFor(BASELINE_POLICY, { runs, loops: [], traces: [], source: conditions, now: NOW });
  assert.equal(counting.policy, BASELINE_POLICY);
  assert.equal(counting.target, 'th');
  assert.deepEqual(countingRecommendation(runs, [], [], conditions).was, { errors: 3, observations: 18, runs: 3, slowRuns: 0 });
  const learner = recommendFor(LEARNER_POLICY, { runs, loops: [], traces: [], source: conditions, now: NOW });
  assert.equal(learner.policy, LEARNER_POLICY);
  assert.equal(DEFAULT_POLICY, LEARNER_POLICY);
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

test('on simulated typists the learner beats the counting rule (pinned at seed 419)', () => {
  const { groups } = evaluate({ seed: 419, typists: 2, runs: 20 });

  for (const [group, { counting, learner }] of Object.entries(groups)) {
    assert.ok(learner.logLoss < counting.logLoss, `${group}: next-run log loss ${learner.logLoss} vs ${counting.logLoss}`);
    assert.ok(learner.calibration < counting.calibration, `${group}: calibration ${learner.calibration} vs ${counting.calibration}`);
    assert.ok(learner.runsToFind < counting.runsToFind, `${group}: runs to find ${learner.runsToFind} vs ${counting.runsToFind}`);
    assert.ok(learner.foundBy10 > counting.foundBy10, `${group}: found by run 10`);
  }
});

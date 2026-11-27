import test from 'node:test';
import assert from 'node:assert/strict';
import { DECAY_TIMING_POLICY, LEARNER_VARIANTS, LET_GO_3, LET_GO_3_POLICY, LET_GO_MISSES_3_POLICY, LET_GO_MISSES_POLICY, LET_GO_POLICY, OWN_COST_POLICY, adaptiveEvidence, adaptiveLean,
  drilledTargets, englishFrequency, fitLearner, keyboardOf, learnerEvidence, learnerRecommendation, letGoIndex, letGoIndexV3, letGoV3, queuedFor, recommendFor, typicalAt } from '../src/learner.js';
import { ADAPTIVE_MIN_TRIES, KEPT_RETESTS, MAX_DRILL_WINDOW, MAX_PATTERN_RUNS, TYPICAL_RUNS, retainRuns, runRecord } from '../src/insights.js';
import { mergeSynced } from '../src/account.js';
import { weekMovers, weekSlips } from '../src/week-change.js';
import { CORPUS_VERSION, METRIC_VERSION, makeAdaptive } from '../src/typing.js';
import { seeded } from '../scripts/evaluate-learner.mjs';

const conditions = { mode: 'words', count: 25, punctuation: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };
const KEYBOARD = keyboardOf(conditions);
const NOW = Date.parse('2026-12-20T12:00:00Z');
const at = (n) => new Date(Date.parse('2026-10-01T12:00:00Z') + n * 3_600_000).toISOString();
const BACKGROUND = [...englishFrequency().pairs].sort((a, b) => b[1] - a[1]).slice(0, 61).map(([pair]) => pair).filter((pair) => pair !== 'th').slice(0, 60);
const withBackground = (n, rows, miss = 30) => [...BACKGROUND.filter((pair) => !rows.some((row) => row[0] === pair)).map((pair, i) => [pair, 3, (i + n) % miss ? 0 : 1, 3, 200, 0]), ...rows];
const run = (n, rows, extra = {}) => ({ id: `r${n}`, at: at(n), kind: 'test', status: 'complete', interrupted: false, fresh: true, conditions, patterns: withBackground(n, rows), keys: [], keysVersion: 0, ...extra });
const adaptiveRun = (n, rows) => ({ id: `a${n}`, at: at(n), kind: 'drill', adaptive: true, status: 'complete', interrupted: false, fresh: true, conditions, patterns: [], keys: [], keysVersion: 0, adaptivePatterns: rows });
const loop = (id, target, after, basis = 'errors') => ({ id, at: after.at, afterAttemptId: after.id, target, targetBasis: basis, conditions });
const queued = (recommendation, unit) => recommendation.queue.some((item) => item.unit === unit);
const recommend = (policy, runs, loops, extra = {}) => recommendFor(policy, { runs, loops, traces: [], source: conditions, now: NOW, ...extra });

// "th" missed 2 of 9 in `missed` runs, drilled, retested on run `missed`, then `clean` runs of 9 clean tries.
function drilled(missed, clean, makeRun = (n) => run(n, [['th', 9, 0, 9, 200, 0]])) {
  const runs = [...Array.from({ length: missed }, (_, n) => run(n, [['th', 9, 2, 9, 200, 0]])), ...Array.from({ length: clean }, (_, k) => makeRun(missed + k))];

  return { runs, loops: [loop('l', 'th', runs[missed])] };
}

test('the typical rate is fixed at the drill: runs since it never move it, and a crossing', () => {
  const { runs } = drilled(50, 30);
  const index = letGoIndexV3(learnerEvidence(runs, KEYBOARD));
  const split = Date.parse(runs[50].at);
  const atDrill = typicalAt(index, split);

  // Make every later run miss a lot: the typical rate at the drill is the same to the last bit.
  const noisy = runs.map((r, n) => (n > 50 ? { ...r, patterns: withBackground(n, [['th', 9, 0, 9, 200, 0]], 2) } : r));
  assert.equal(typicalAt(letGoIndexV3(learnerEvidence(noisy, KEYBOARD)), split), atDrill);
  // And it reads only the TYPICAL_RUNS records before the split: older ones leave it alone.
  const distant = [{ ...run(0, [['th', 9, 9, 9, 200, 0]]), id: 'ancient', at: at(-500) }, ...runs];
  assert.equal(typicalAt(letGoIndexV3(learnerEvidence(distant, KEYBOARD)), split), atDrill, 'a run older than the newest 40 before the drill is not read once 40 are held');
  assert.ok(atDrill > 0.01 && atDrill < 0.05);
});

test('a let-go crossing does not move when a later run changes the person’s overall rate (v2 can)', () => {
  const { runs, loops } = drilled(20, 30);
  const [target] = [...drilledTargets(loops, KEYBOARD).values()];
  const index = (list) => letGoIndexV3(learnerEvidence(list, KEYBOARD));
  const split = Date.parse(runs[20].at);
  const crossing = (list) => letGoV3(index(list), 'th', 'errors', split);
  const before = crossing(runs);
  const careless = runs.map((r, n) => (n >= 20 ? { ...r, patterns: r.patterns.map((row) => (row[0] === 'th' ? row : [row[0], 3, 1, 3, 200, 0])) } : r));
  assert.equal(before, true);
  assert.equal(crossing(careless), true, 'a careless stretch after the drill leaves the let-go where it was');
  // The v2 test reads the pooled rate of every record it holds, so the same stretch moves it.
  const pooled = (list) => letGoIndex(learnerEvidence(list, KEYBOARD)).typical;
  assert.ok(pooled(careless) > pooled(runs) * 3);
  assert.ok(target);
});

test('retention keeps pattern evidence on the runs since each kept drill, beyond the newest 120', () => {
  const runs = Array.from({ length: 260 }, (_, n) => run(n, [['th', 9, 0, 9, 200, 0]], n === 30 ? { kind: 'retest' } : {}));
  const patterned = (list) => list.filter((r) => r.patterns.length).length;
  const kept = retainRuns(runs, { drills: true });
  assert.equal(patterned(retainRuns(runs, { drills: false })), MAX_PATTERN_RUNS);
  assert.deepEqual(retainRuns(runs), retainRuns(runs, { drills: false }), 'the app keeps the newest 120');
  assert.equal(patterned(kept), MAX_DRILL_WINDOW, 'the drill window is bounded');
  assert.equal(kept.length, 260, 'no summary is lost');
  assert.equal(kept.at(-1).patterns.length > 0, true);

  // A retest inside the newest 120 asks for nothing more; the window begins TYPICAL_RUNS runs before it, at most.
  const recent = Array.from({ length: 260 }, (_, n) => run(n, [['th', 9, 0, 9, 200, 0]], n === 200 ? { kind: 'retest' } : {}));
  assert.equal(patterned(retainRuns(recent, { drills: true })), 260 - 200 + TYPICAL_RUNS > MAX_PATTERN_RUNS ? 260 - 200 + TYPICAL_RUNS : MAX_PATTERN_RUNS);

  // Without any retest it keeps what it kept before; only the KEPT_RETESTS newest retests anchor the window.
  const noRetest = Array.from({ length: 200 }, (_, n) => run(n, []));
  assert.equal(patterned(retainRuns(noRetest, { drills: true })), MAX_PATTERN_RUNS);
  const many = Array.from({ length: 260 }, (_, n) => run(n, [], n % 20 === 5 ? { kind: 'retest' } : {}));
  const eighth = many.map((r, n) => (r.kind === 'retest' ? n : -1)).filter((n) => n >= 0).at(-KEPT_RETESTS);
  assert.equal(patterned(retainRuns(many, { drills: true })), Math.min(MAX_DRILL_WINDOW, 260 - Math.max(0, eighth - TYPICAL_RUNS)));

  // Merge-safe and idempotent: it reads only the runs, so the order two copies arrive in changes nothing.
  assert.deepEqual(retainRuns(kept, { drills: true }), kept);
  assert.deepEqual(retainRuns([...runs].reverse().sort((a, b) => (a.at < b.at ? -1 : 1)), { drills: true }), kept);
});

test('a walk survives its retest leaving the newest 120 runs', () => {
  // 20 missed runs, the retest, then 130 clean runs: the retest is 130 runs old, outside the newest 120.
  const runs = Array.from({ length: 151 }, (_, n) => (n < 20 ? run(n, [['th', 9, 2, 9, 200, 0]]) : run(n, [['th', 9, 0, 9, 200, 0]], n === 20 ? { kind: 'retest' } : {})));
  const loops = [loop('l', 'th', runs[20])];
  const kept = retainRuns(runs, { drills: true });
  assert.ok(kept.find((r) => r.id === 'r20').patterns.length, 'the retest still holds its counts');
  assert.ok(!queued(recommend(LET_GO_3_POLICY, kept, loops), 'th'), 'let go, and still let go');
  // Under the old window the same profile loses the retest and reads from the next run: only the shipped 120 are read.
  const short = retainRuns(runs, { drills: false });
  assert.ok(!short.find((r) => r.id === 'r20').patterns.length);
});

test('a target let go for its misses and named for its pace is a new step, and a return is read for the kind drilled only', () => {
  const queue = [{ unit: 'th', was: { errors: 0, observations: 0, basis: 'slow' } }, { unit: 'he', was: { errors: 2, observations: 20 } }];
  assert.equal(queuedFor(queue, 'th', 'errors'), false);
  assert.equal(queuedFor(queue, 'th', 'slow'), true);
  assert.equal(queuedFor(queue, 'he', 'errors'), true);
  assert.equal(queuedFor(queue, 'he', 'slow'), false);
  assert.equal(queuedFor(queue, 'xx', 'errors'), false);

  // The let-go drops only the part drilled: "th" is let go for its misses, so its misses part of the gain is zero.
  const { runs, loops } = drilled(20, 30);
  const model = fitLearner(learnerEvidence(runs, KEYBOARD), NOW, { ...LEARNER_VARIANTS[LET_GO_3_POLICY] }, 'balanced', [...drilledTargets(loops, KEYBOARD).values()]);
  const th = model.units.find((e) => e.unit === 'th');
  assert.deepEqual(th.letGo, ['errors']);
  assert.equal(th.gain, 0, 'nothing else about "th" names it here');
});

test('adaptive runs count toward letting go, and never as normal evidence', () => {
  const { runs: base } = drilled(20, 1);
  const adaptive = Array.from({ length: 20 }, (_, k) => adaptiveRun(21 + k, [['th', 12, 0, 12, 200, 0]]));
  const runs = [...base, ...adaptive];
  const loops = [loop('l', 'th', runs[20])];
  assert.deepEqual(learnerEvidence(runs, KEYBOARD).map((r) => r.id), learnerEvidence(base, KEYBOARD).map((r) => r.id), 'the fit reads no adaptive run');
  assert.equal(adaptiveEvidence(runs, KEYBOARD).length, 20);
  assert.deepEqual(adaptiveEvidence([{ ...adaptive[0], status: 'incomplete' }, { ...adaptive[1], interrupted: true }, { ...adaptive[2], conditions: { ...conditions, layout: 'dvorak' } }, { ...adaptive[3], adaptivePatterns: [] }], KEYBOARD), []);
  assert.ok(!queued(recommend(LET_GO_3_POLICY, runs, loops), 'th'), '240 clean adaptive tries let it go');
  assert.ok(queued(recommend(LET_GO_3_POLICY, [...base, ...adaptive.slice(0, 2)], loops), 'th'), 'two adaptive runs do not');
  assert.ok(queued(recommend(DECAY_TIMING_POLICY, runs, loops), 'th'), 'the shipped default is unmoved');
  assert.deepEqual(recommend(DECAY_TIMING_POLICY, runs, loops), recommend(DECAY_TIMING_POLICY, base, loops), 'it ignores adaptive runs entirely');
});

test('an adaptive run records rows for the pairs it leaned on, from its own attempt', () => {
  const random = seeded(7);
  const passage = makeAdaptive([{ unit: 'th', weight: 1 }], { mode: 'words', count: 25, wordList: '200', random });
  const events = [];
  let t = 0;

  for (let i = 0; i < passage.text.length; i += 1) {
    t += 200;
    events.push({ type: 'insert', text: passage.text[i], position: i, offsetMs: t });
  }

  const attempt = { id: 'x', kind: 'drill', status: 'complete', conditions, textId: passage.id, fresh: true, text: passage.text, events, adaptive: true, typed: passage.text, startedAt: 200, endedAt: t, interrupted: false, unsupportedInput: false, eventVersion: 'v', metricVersion: METRIC_VERSION };
  const record = runRecord({ ...attempt, summary: undefined }, at(1));
  assert.equal(record.adaptive, true);
  assert.ok(record.patterns.length === 0, 'no normal pattern evidence');
  assert.ok(record.adaptivePatterns.length > 0 && record.adaptivePatterns.length <= 8);
  assert.ok(record.adaptivePatterns.every((row) => row[1] >= ADAPTIVE_MIN_TRIES));
  assert.ok(record.adaptivePatterns.some((row) => row[0] === 'th'));
  // A normal run keeps none, and an adaptive run's rows go with the pattern window.
  assert.equal(runRecord({ ...attempt, kind: 'test', adaptive: false, summary: undefined }, at(1)).adaptivePatterns, undefined);
  const trimmed = retainRuns([adaptiveRun(0, [['th', 9, 0, 9, 200, 0]]), ...Array.from({ length: 130 }, (_, n) => run(n + 1, []))]);
  assert.equal(trimmed[0].adaptivePatterns, undefined);
});

test('adaptive text leans harder toward recently drilled pairs, in adaptive text only', () => {
  const two = (n, th) => run(n, [['th', 9, th, 9, 200, 0], ['he', 9, 3, 9, 200, 0]]);
  const runs = Array.from({ length: 24 }, (_, n) => two(n, n < 20 ? 2 : 0));
  const loops = [loop('l', 'th', runs[20])];
  const plain = recommend(LET_GO_3_POLICY, runs, loops);
  const adaptive = recommend(LET_GO_3_POLICY, runs, loops, { adaptive: true });
  const weight = (list, unit) => (list.find((item) => item.unit === unit)?.weight ?? 0) / list.reduce((s, item) => s + item.weight, 0);
  const share = LEARNER_VARIANTS[LET_GO_3_POLICY].drillLeanShare;
  assert.ok(weight(adaptive.lean, 'th') >= share - 1e-9, 'a drilled target not yet let go holds the share');
  assert.ok(weight(plain.lean, 'th') < share, 'the ordinary lean is the learner’s own');
  assert.deepEqual({ ...adaptive, lean: 0 }, { ...plain, lean: 0 }, 'only the lean changes: the queue and the target are the same');

  // Non-adaptive paths and every other policy: exactly what they were.
  for (const policy of [DECAY_TIMING_POLICY, LET_GO_POLICY, LET_GO_MISSES_POLICY, OWN_COST_POLICY]) {
    assert.deepEqual(recommend(policy, runs, loops, { adaptive: true }), recommend(policy, runs, loops), policy);
  }

  // Let go for its kind: it leaves the lean again, and the drill-less lean is untouched.
  const done = Array.from({ length: 60 }, (_, n) => two(n, n < 20 ? 2 : 0));
  const doneLoops = [loop('l', 'th', done[20])];
  assert.ok(!recommend(LET_GO_3_POLICY, done, doneLoops, { adaptive: true }).lean.some((item) => item.unit === 'th'));
  assert.deepEqual(recommend(LET_GO_3_POLICY, runs, [], { adaptive: true }).lean, recommend(LET_GO_3_POLICY, runs, []).lean);
  const model = fitLearner(learnerEvidence(runs, KEYBOARD), NOW, LEARNER_VARIANTS[LET_GO_3_POLICY], 'balanced', []);
  const lean = learnerRecommendation(model).lean;
  assert.deepEqual(adaptiveLean(model, lean, []), lean);

  // Text: the same lean, the same seed, the same passage, whatever the policy; only the lean's weights decide the words.
  const passage = (lean2) => makeAdaptive(lean2, { mode: 'words', count: 25, wordList: '200', random: seeded(3) }).text;
  assert.equal(passage(adaptive.lean), passage(adaptive.lean));
});

test('every earlier variant is unchanged: it reads the newest 120 pattern runs of a longer profile exactly as before', () => {
  const runs = Array.from({ length: 200 }, (_, n) => run(n, [['th', 9, n % 7 ? 0 : 2, 9, 200, 0]], n === 30 ? { kind: 'retest' } : {}));
  const newest = runs.slice(-MAX_PATTERN_RUNS);

  for (const policy of [LET_GO_POLICY, LET_GO_MISSES_POLICY, DECAY_TIMING_POLICY, OWN_COST_POLICY, 'learner@1', 'learner-decay@1', 'learner-timing@1']) {
    assert.deepEqual(recommend(policy, runs, []), recommend(policy, newest, []), policy);
  }

  // The v3 variants read the longer window, and their v2 constants and tests are untouched.
  assert.equal(LEARNER_VARIANTS[LET_GO_POLICY].weakRatio, 3);
  assert.equal(LEARNER_VARIANTS[LET_GO_POLICY].letGoVersion, undefined);
  assert.equal(LEARNER_VARIANTS[LET_GO_3_POLICY].letGoVersion, 3);
  assert.deepEqual(LEARNER_VARIANTS[LET_GO_MISSES_3_POLICY].letGo, ['errors']);
  assert.equal(LEARNER_VARIANTS[LET_GO_3_POLICY].weakRatio, LET_GO_3.weakRatio);
});

test('property: over random histories, in every focus, a target let go for its kind is never queued for that kind, so Train’s fixed and the learner agree', () => {
  const random = seeded(2711);
  const pairs = BACKGROUND.slice(0, 12);
  let letGoSeen = 0;

  for (let trial = 0; trial < 60; trial += 1) {
    const length = 25 + Math.floor(random() * 80);
    const retest = 5 + Math.floor(random() * 15);
    const clean = random() < 0.5;
    const rows = () => pairs.slice(0, 4).map((pair) => [pair, 2 + Math.floor(random() * 6), !clean && random() < 0.2 ? 1 : 0, 3, 200 + (!clean && random() < 0.3 ? 80 : 0), 0]);
    const runs = Array.from({ length }, (_, n) => run(n, rows(), n === retest ? { kind: 'retest' } : {}));
    const targets = pairs.slice(0, 4).filter(() => random() < 0.7);
    const loops = targets.map((target, k) => loop(`l${k}`, target, runs[retest], random() < 0.5 ? 'errors' : 'slow'));

    for (const focus of ['balanced', 'accuracy', 'speed']) {
      const recommendation = recommend(LET_GO_3_POLICY, runs, loops, { focus });
      const index = letGoIndexV3(learnerEvidence(runs, KEYBOARD));

      for (const target of loops) {
        const basis = target.targetBasis;

        if (!letGoV3(index, target.target, basis, Date.parse(runs[retest].at), LET_GO_3)) continue;
        letGoSeen += 1;
        assert.ok(!queuedFor(recommendation.queue, target.target, basis), `${target.target} let go for ${basis} and queued for it, focus ${focus}, trial ${trial}`);
      }
    }
  }

  assert.ok(letGoSeen > 0, 'the histories let some targets go, so the property is exercised');
});

test('profile merges keep the same window on both sides', () => {
  const runs = Array.from({ length: 200 }, (_, n) => run(n, [['th', 9, 0, 9, 200, 0]], n === 30 ? { kind: 'retest' } : {}));
  const half = (from, to) => ({ runs: runs.slice(from, to), loops: [], attempts: [], compositions: [], practiceDays: {} });
  const merged = mergeSynced(half(0, 120), half(80, 200));
  const other = mergeSynced(half(80, 200), half(0, 120));
  assert.deepEqual(merged.runs, other.runs);
  assert.deepEqual(merged.runs, retainRuns(runs));

  // An adaptive run's fuller copy (with adaptivePatterns) wins over a trimmed copy regardless of merge order.
  const fullAdaptive = adaptiveRun(201, [['th', 10, 0, 10, 200, 0]]);
  const { adaptivePatterns: _, ...trimmedAdaptive } = fullAdaptive;
  const aWins = mergeSynced({ runs: [runs[199], fullAdaptive], loops: [], attempts: [], compositions: [], practiceDays: {} }, { runs: [runs[199], trimmedAdaptive], loops: [], attempts: [], compositions: [], practiceDays: {} });
  const bWins = mergeSynced({ runs: [runs[199], trimmedAdaptive], loops: [], attempts: [], compositions: [], practiceDays: {} }, { runs: [runs[199], fullAdaptive], loops: [], attempts: [], compositions: [], practiceDays: {} });
  assert.deepEqual(aWins.runs, bWins.runs);
  assert.deepEqual(aWins.runs.find((r) => r.id === fullAdaptive.id)?.adaptivePatterns, fullAdaptive.adaptivePatterns);
});

test('weekMovers reads the same 120-run pattern window as DEFAULT_POLICY even when retainRuns keeps post-drill runs beyond 120', () => {
  // 200 chronological runs ending near NOW, with a retest at run 30 so retainRuns keeps all 200 pattern-carrying runs.
  // Runs 0..79 (outside the newest 120) have misses on "qu"; runs 80..199 (the newest 120) have misses on "th" before
  // `began` and clean runs after `began`. Both weekMovers and DEFAULT_POLICY must agree with the 120-run window.
  const dayMs = 86_400_000;
  const began = NOW - 6 * dayMs;

  const history = Array.from({ length: 200 }, (_, n) => {
    const stamp = new Date(began - (190 - n) * 6 * 3_600_000).toISOString();
    const rows = n < 80 ? [['qu', 12, 4, 12, 200, 0]] : n < 185 ? [['th', 10, 2, 10, 200, 0]] : [['th', 12, 0, 12, 200, 0]];

    return run(n, rows, n === 30 ? { at: stamp, kind: 'retest' } : { at: stamp });
  });

  const kept = retainRuns(history, { drills: true });
  const trimmed120 = retainRuns(history, { drills: false });
  assert.ok(kept.filter((r) => r.patterns.length).length > MAX_PATTERN_RUNS, 'post-drill retention keeps >120 runs');
  assert.equal(trimmed120.filter((r) => r.patterns.length).length, MAX_PATTERN_RUNS);

  const moversKept = weekMovers({ runs: kept, loops: [], keyboard: KEYBOARD, focus: 'balanced', now: NOW, began });
  const movers120 = weekMovers({ runs: trimmed120, loops: [], keyboard: KEYBOARD, focus: 'balanced', now: NOW, began });
  assert.deepEqual(moversKept, movers120);
  assert.ok(!moversKept.some((m) => m.unit === 'qu'), 'runs older than the 120-run window do not leak into weekMovers');
  assert.deepEqual(recommend(DECAY_TIMING_POLICY, kept, []), recommend(DECAY_TIMING_POLICY, trimmed120, []));
});

test('weekMovers and weekSlips read the 120-run window when retainRuns keeps post-drill runs beyond it', () => {
  const began = NOW - 6 * 86_400_000;
  const differing = { movers: 0, slips: 0 };

  for (let seed = 1; seed <= 20; seed++) {
    const random = seeded(seed);

    const history = Array.from({ length: 220 }, (_, n) => {
      const th = n < 205 ? (random() < 0.5 ? 2 : 1) : random() < 0.2 ? 1 : 0;
      const qu = n > 200 ? (random() < 0.6 ? 3 : 1) : random() < 0.1 ? 1 : 0;

      return run(n, [['th', 10, th, 10, 200, 0], ['qu', 10, qu, 10, 200, 0]], { at: new Date(began - (200 - n) * 5 * 3_600_000).toISOString(), kind: n % 37 === 30 ? 'retest' : 'test' });
    });

    const kept = retainRuns(history, { drills: true });
    const short = retainRuns(history, { drills: false });
    const view = { keyboard: KEYBOARD, focus: 'balanced', now: NOW, began };

    assert.ok(kept.filter((r) => r.patterns.length).length > MAX_PATTERN_RUNS, 'post-drill retention keeps more than 120 runs');
    differing.movers += Number(JSON.stringify(weekMovers({ ...view, runs: kept })) !== JSON.stringify(weekMovers({ ...view, runs: short })));
    differing.slips += Number(JSON.stringify(weekSlips({ ...view, runs: kept })) !== JSON.stringify(weekSlips({ ...view, runs: short })));
  }

  assert.deepEqual(differing, { movers: 0, slips: 0 });
});

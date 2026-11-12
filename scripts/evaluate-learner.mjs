// Evaluates the recommendation policies on simulated typists, and applies ADR 0013's decision rule v2 to pick
// the default. Deterministic from its seeds. See docs/adr/0013-learning-core.md.
//
//   npm run evaluate:learner -- [--typists 8] [--runs 40] [--json out.json] [--naming out.json] [--profile path/to/profile.json]
//   npm run evaluate:learner -- --errors-at-pace --json out.json      (sensitivity: planted error pairs at the typist's pace)
//   npm run evaluate:learner -- --miss-cost 4 --json out.json         (sensitivity: a miss costs 4 intervals, not 2)
//   npm run evaluate:learner -- --rule 0015 --json out.json           (ADR 0015's rule: learner@2)
//   npm run evaluate:learner -- --rule 0019 --json out.json           (ADR 0019's rule: learner-let-go@2, scripts/evaluate-let-go.mjs)
//
// The two sensitivity runs repeat rule v2's protocol on the same seeds in a changed simulator. They decide
// nothing: rule v2's run on the shipped simulator is the record.
//
// What it shows, and what it does not: how well each policy predicts the next run's first-try errors, how much
// of the time a typist loses its top units hold, and how soon it finds, picks up and lets go of planted weak and
// slow pairs, on simulated typists. It says nothing about whether anyone learns faster: a simulated typist
// improves after a drill only as the simulator says it does.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CORPUS_VERSION, METRIC_VERSION, completeAttempt, makePassage } from '../src/typing.js';
import { MIN_PATTERN_SAMPLES, evidenceRun, runRecord } from '../src/insights.js';
import { DECAY_POLICY, DECAY_TIMING_POLICY, DEFAULT_POLICY, LEAN_UNITS, LEARNER_POLICY, LEARNER_VARIANTS, OWN_COST_POLICY, SLOW_FLOOR_MS, TIMING_POLICY, countingRecommendation,
  drilledTargets, englishFrequency, fitLearner, keyboardOf, learnerEvidence, learnerRecommendation } from '../src/learner.js';
import { normalizeProfile } from '../src/profile.js';
import { keyboardRows } from '../src/layouts.js';

export const CONDITIONS = { mode: 'words', count: 25, punctuation: false, numbers: false, wordList: '200', inputClass: 'physical-keyboard',
  correctionPolicy: 'mandatory', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

export const KEYBOARD = keyboardOf(CONDITIONS);
export const START = Date.parse('2026-09-01T09:00:00Z');
export const RUN_MS = 6 * 3600_000;

// The app keeps this many full traces, which the counting rule's fallback reads.
const TRACES = 24;

// Drifting typists change after this many runs.
const CHANGE = 20;

export const VALIDATION_SEEDS = [9001, 9002];
export const TEST_SEEDS = Array.from({ length: 30 }, (_, i) => 101 + i);
export const POOLED_TRIES_GRID = [2, 5, 10, 20, 40, 80];
export const HALF_LIFE_GRID = [10, 15, 20, 30, 60];
export const TIMING_TRIES_GRID = [5, 10, 20, 40, 80];
export const GROUPS = ['mechanics', 'unrelated', 'drifting'];
export const STRATA = [['common', 1, 30], ['middle', 31, 90], ['rare', 91, Infinity]];

// The planted slow-only pairs are their own stratum.
export const PLANTED = [...STRATA.map(([name]) => name), 'slow'];

export function seeded(seed) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const gaussian = (random) => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
export const sigmoid = (v) => 1 / (1 + Math.exp(-v));
export const logit = (p) => Math.log(p / (1 - p));

// Mechanics the simulator computes on its own: finger, hand and row from the qwerty map, and a travel
// distance. A "mechanics" typist's errors and timing follow them with weights of its own; an "unrelated"
// typist's do not at all, which is the case a model built on these features must not be flattered by.
function mechanics() {
  const keys = new Map();
  keyboardRows('qwerty').slice(0, 3).forEach((row, r) => row.forEach((entry) => keys.set(entry.key, { ...entry, r, x: entry.column + [0, 0.25, 0.75][r] })));

  return (pair) => {
    const a = keys.get(pair[0]);
    const b = keys.get(pair[1]);
    const repeated = pair[0] === pair[1];
    const sameFinger = !repeated && a.hand === b.hand && a.finger === b.finger;

    return { sameFinger: sameFinger ? 1 : 0, sameHand: !repeated && !sameFinger && a.hand === b.hand ? 1 : 0, travel: Math.hypot(a.x - b.x, a.r - b.r),
      pinky: b.finger === 'pinky' ? 1 : 0, offHome: (a.r !== 1) + (b.r !== 1) };
  };
}

// What the app's 25-word passages hold, from a fixed sample of its own generator: each pair's and each
// word-initial letter's share of the letters typed, and the pairs most frequent first.
let passage = null;

export function passageShares() {
  if (passage) return passage;
  const random = seeded(1);
  const counts = new Map();
  let letters = 0;

  for (let i = 0; i < 2000; i += 1) {
    const text = makePassage('words', CONDITIONS.count, false, random, CONDITIONS.wordList);

    for (let j = 0; j < text.length; j += 1) {
      if (!/[a-z]/.test(text[j])) continue;
      const unit = j > 0 && /[a-z]/.test(text[j - 1]) ? text.slice(j - 1, j + 1) : text[j];
      counts.set(unit, (counts.get(unit) || 0) + 1);
      letters += 1;
    }
  }

  const pairs = [...counts].filter(([unit]) => unit.length === 2).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  passage = { shares: new Map([...counts].map(([unit, n]) => [unit, n / letters])), pairs: pairs.map(([pair]) => pair) };

  return passage;
}

export const pairsByFrequency = () => passageShares().pairs;

const stratum = (name) => {
  const [, from, to] = STRATA.find(([n]) => n === name);

  return pairsByFrequency().slice(from - 1, Number.isFinite(to) ? to : undefined);
};

export const SKILLS = [
  { name: 'careful', errorRate: 0.015, medianMs: 150, correctionKeys: 2.5 },
  { name: 'average', errorRate: 0.035, medianMs: 210, correctionKeys: 3 },
  { name: 'learning', errorRate: 0.07, medianMs: 300, correctionKeys: 3.5 },
];

const pick = (random, list, taken) => {
  for (;;) {
    const item = list[Math.floor(random() * list.length)];

    if (!taken.includes(item)) return item;
  }
};

// A typist: hidden first-try error probabilities and timings for every pair and letter, by run. Mechanics and
// unrelated typists have one planted weak pair per stratum, and one slow-only pair (common or middle) that is
// missed at the typist's base rate and typed 1.5 to 2 times slower than their pace. A drifting typist has a
// common weak pair that is fixed at run CHANGE and another that starts slipping then, and a common slow pair
// that becomes fast at CHANGE and another that becomes slow then.
//
// `world` changes the simulator, drawing the same random numbers: `errorPairsAtPace` types planted weak pairs
// at the typist's pace, `missCost` scales every skill's correction so the average typist's miss costs that many
// intervals (2 is the shipped 1.5, 2 and 2.5 by skill), and `missIntervals` is this typist's own miss cost
// (ADR 0015).
export function makeTypist(random, group, rawSkill, index = 0, world = {}) {
  const skill = world.missIntervals ? { ...rawSkill, correctionKeys: 1 + world.missIntervals }
    : world.missCost ? { ...rawSkill, correctionKeys: 1 + ((rawSkill.correctionKeys - 1) * world.missCost) / 2 } : rawSkill;

  const pairs = [...englishFrequency().pairs.keys()].sort();
  const mech = mechanics();
  const base = logit(skill.errorRate);
  const followsMechanics = group === 'mechanics' || (group === 'drifting' && index % 2 === 0);

  const weights = followsMechanics
    ? { sameFinger: 0.4 + random() * 0.8, sameHand: random() * 0.3, travel: 0.05 + random() * 0.2, pinky: random() * 0.5, offHome: random() * 0.3 }
    : null;

  const errorLogit = new Map();
  const slowness = new Map();

  for (const pair of pairs) {
    const m = mech(pair);
    const pull = weights ? weights.sameFinger * m.sameFinger + weights.sameHand * m.sameHand + weights.travel * (m.travel - 2) + weights.pinky * m.pinky + weights.offHome * (m.offHome - 1) : 0;
    errorLogit.set(pair, base + pull + 0.4 * gaussian(random));
    slowness.set(pair, (weights ? 0.6 * pull : 0) + 0.1 * gaussian(random));
  }

  const weakness = () => {
    const error = 1.6 + random() * 0.8;
    const slow = 0.3 + random() * 0.3;

    return { error, slow: world.errorPairsAtPace ? 0 : slow };
  };

  const planted = [];

  const slowOnly = () => ({ error: 0, slow: 0.4 + random() * 0.3 });
  const taken = () => planted.map((p) => p.pair);

  if (group === 'drifting') {
    planted.push({ pair: pick(random, stratum('common'), taken()), stratum: 'common', until: CHANGE, ...weakness() });
    planted.push({ pair: pick(random, stratum('common'), taken()), stratum: 'common', from: CHANGE, ...weakness() });
    planted.push({ pair: pick(random, stratum('common'), taken()), stratum: 'slow', until: CHANGE, ...slowOnly() });
    planted.push({ pair: pick(random, stratum('common'), taken()), stratum: 'slow', from: CHANGE, ...slowOnly() });
  } else {
    for (const [name] of STRATA) planted.push({ pair: pick(random, stratum(name), taken()), stratum: name, ...weakness() });
    planted.push({ pair: pick(random, stratum(random() < 0.5 ? 'common' : 'middle'), taken()), stratum: 'slow', ...slowOnly() });
  }

  // A slow-only pair is at the base rate and the typist's pace apart from its planted slowness.
  for (const p of planted.filter((item) => item.stratum === 'slow')) {
    errorLogit.set(p.pair, base);
    slowness.set(p.pair, 0);
  }

  const active = (pair, run) => planted.find((p) => p.pair === pair && run >= (p.from ?? 0) && run < (p.until ?? Infinity));
  const keyLogit = new Map([...englishFrequency().keys.keys()].map((key) => [key, base + 0.3 * gaussian(random)]));

  return {
    group, skill, planted, missCost: world.missIntervals ?? null,
    fixed: group === 'drifting' ? planted[0].pair : null,
    slipping: group === 'drifting' ? planted[1].pair : null,
    fixedSlow: group === 'drifting' ? planted[2].pair : null,
    slippingSlow: group === 'drifting' ? planted[3].pair : null,
    pairError: (pair, run) => sigmoid((errorLogit.get(pair) ?? base) + (active(pair, run)?.error || 0)),
    slowness: (pair, run) => (slowness.get(pair) ?? 0) + (active(pair, run)?.slow || 0),
    keyError: (key) => sigmoid(keyLogit.get(key) ?? base),
  };
}

// One run: the app's own passage generator, typed under stop on error (a wrong key is refused, then the
// right one follows), scored and summarized by the app's own code. Returns the summary and the full trace.
// ADR 0019's season sets the words a run, the date, and `shift`, the log odds a bad day adds to every letter's miss.
export function typeRun(typist, random, index, id, { count = CONDITIONS.count, at: date = START + index * RUN_MS, shift = 0 } = {}) {
  const conditions = count === CONDITIONS.count ? CONDITIONS : { ...CONDITIONS, count };
  const text = makePassage('words', count, false, random, CONDITIONS.wordList);
  const events = [];
  let t = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const pair = i > 0 && /^[a-z]{2}$/.test(text.slice(i - 1, i + 1)) ? text.slice(i - 1, i + 1) : null;
    const letter = pair ? typist.pairError(pair, index) : /[a-z]/.test(char) ? typist.keyError(char) : null;
    const p = letter === null ? typist.skill.errorRate / 2 : shift ? sigmoid(logit(letter) + shift) : letter;
    const step = typist.skill.medianMs * Math.exp((pair ? typist.slowness(pair, index) : 0) + 0.3 * gaussian(random));
    t += Math.max(30, step);

    if (random() < p) {
      events.push({ type: 'insert', text: char === 'x' ? 'z' : 'x', position: i, accepted: false, offsetMs: Math.round(t) });
      t += typist.skill.medianMs * (typist.skill.correctionKeys - 1) * Math.exp(0.2 * gaussian(random));
    }

    events.push({ type: 'insert', text: char, position: i, offsetMs: Math.round(t) });
  }

  const at = new Date(date).toISOString();

  const attempt = completeAttempt({ id, kind: 'test', status: 'complete', conditions, textId: id, fresh: true, text, events, startedAt: events[0].offsetMs },
    { endedAt: Math.round(t) });

  return { run: runRecord(attempt, at), trace: attempt };
}

// The candidates of ADR 0013's rule v2, simplest first.
export const VARIANTS = [
  { name: 'counts-gain', policy: LEARNER_POLICY, components: [] },
  { name: '+decay', policy: DECAY_POLICY, components: ['decay'] },
  { name: '+timing', policy: TIMING_POLICY, components: ['timing'] },
  { name: '+decay +timing', policy: DECAY_TIMING_POLICY, components: ['decay', 'timing'] },
];

// A run's timing for a pair: the log of its median clean interval over the run's median, and the intervals behind it.
function timingRows(run) {
  return (run.patterns || []).flatMap(([pair, , , timed, pairMs, slowdownMs]) => {
    const runMs = pairMs !== null && slowdownMs !== null ? pairMs - slowdownMs : null;

    return timed > 0 && runMs > 0 && pairMs > 0 ? [[pair, timed, Math.log(pairMs / runMs)]] : [];
  });
}

// A policy fitted on a typist's first runs: what it predicts for each pair's first try and timing, and the
// units it acts on. `loops` are the drills saved by then, which only the let-go variants read (ADR 0019).
export function learnerPolicy(policy, constants, focus) {
  const variant = { ...LEARNER_VARIANTS[policy], ...constants };

  return (runs, traces, now, loops = []) => {
    const model = fitLearner(learnerEvidence(runs, KEYBOARD), now, variant, focus, [...drilledTargets(loops, KEYBOARD).values()]);
    const byUnit = new Map(model.units.map((e) => [e.unit, e]));

    return { predict: (pair) => byUnit.get(pair)?.error.mean ?? model.errorRate, slowdown: (pair) => byUnit.get(pair)?.slowdown ?? 0,
      lean: learnerRecommendation(model).lean.map((item) => item.unit), missCost: model.missCost };
  };
}

// The counting rule as the app runs it, fallback to the newest traces included. It predicts nothing.
const countingPolicy = (runs, traces) => ({ predict: null, slowdown: null, lean: countingRecommendation(runs, [], traces, CONDITIONS).lean.map((item) => item.unit) });

// One typist's history, replayed for one policy: fit on the first t runs, predict run t, read the ranking. A loop
// counts from the fit after its retest (`run`, the retest's index).
function replay(history, policy, loops = []) {
  const losses = [];
  const predictions = [];
  const lean = [];
  const costs = [];
  let timingError = 0;
  let timingWeight = 0;

  for (let t = 0; t <= history.length; t += 1) {
    const prefix = history.slice(0, t);
    const model = policy(prefix.map((h) => h.run), prefix.slice(-TRACES).map((h) => h.trace), START + t * RUN_MS, loops.filter((loop) => loop.run < t));
    lean.push(model.lean.slice(0, LEAN_UNITS));
    costs.push(model.missCost ?? null);

    if (t === history.length || !model.predict) continue;
    let loss = 0;
    let tries = 0;

    for (const [pair, n, e] of history[t].run.patterns || []) {
      const p = Math.min(1 - 1e-6, Math.max(1e-6, model.predict(pair)));
      loss -= e * Math.log(p) + (n - e) * Math.log(1 - p);
      tries += n;
      predictions.push({ p, n, e });
    }

    if (tries) losses.push(loss / tries);

    for (const [pair, n, r] of timingRows(history[t].run)) {
      timingError += n * (model.slowdown(pair) - r) ** 2;
      timingWeight += n;
    }
  }

  return { losses, predictions, lean, costs, timingError: timingWeight ? timingError / timingWeight : null };
}

// Expected calibration error over ten equal-count bins of predicted probability, weighted by tries.
function calibration(predictions) {
  const sorted = [...predictions].sort((a, b) => a.p - b.p);
  const total = sorted.reduce((s, item) => s + item.n, 0);
  let error = 0;
  let index = 0;

  for (let bin = 0; bin < 10; bin += 1) {
    let n = 0;
    let e = 0;
    let p = 0;

    for (; index < sorted.length && n < total / 10; index += 1) {
      n += sorted[index].n;
      e += sorted[index].e;
      p += sorted[index].p * sorted[index].n;
    }

    if (n) error += (n / total) * Math.abs(p / n - e / n);
  }

  return error;
}

export const mean = (values) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;

  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Runs after the change until `held(t)` is true at every later point, CHANGE + k through the last run.
function runsUntilSteady(lean, held) {
  const last = lean.length - 1;

  for (let k = 0; CHANGE + k <= last; k += 1) {
    if (lean.slice(CHANGE + k).every(held)) return k;
  }

  return last - CHANGE + 1;
}

// True time lost per letter typed, in ms, for every pair and key at one run, from the simulator's hidden state
// (rule v2). The same formula for every policy.
export function trueLoss(typist, run) {
  const { shares } = passageShares();
  const { medianMs, correctionKeys } = typist.skill;
  const missMs = medianMs * (correctionKeys - 1);
  const errorOf = (unit) => (unit.length === 2 ? typist.pairError(unit, run) : typist.keyError(unit));
  const typical = [...shares].reduce((sum, [unit, share]) => sum + share * errorOf(unit), 0);

  const intervals = [...shares].flatMap(([unit, share]) => (unit.length === 2 ? [[medianMs * Math.exp(typist.slowness(unit, run)), share]] : []))
    .sort((a, b) => a[0] - b[0]);

  const half = intervals.reduce((sum, [, share]) => sum + share, 0) / 2;
  let below = 0;
  const pace = intervals.find(([, share]) => (below += share) >= half)[0];

  return new Map([...shares].map(([unit, share]) => [unit, share * (Math.max(0, errorOf(unit) - typical) * missMs
    + (unit.length === 2 ? Math.max(0, medianMs * Math.exp(typist.slowness(unit, run)) - pace) : 0))]));
}

// The share of the best possible four units' true time lost that a policy's top four hold.
function captured(top, loss) {
  const best = [...loss.values()].sort((a, b) => b - a).slice(0, LEAN_UNITS).reduce((sum, v) => sum + v, 0);

  return [...new Set(top)].reduce((sum, unit) => sum + (loss.get(unit) || 0), 0) / best;
}

// The typists of one seed: 8 per skill level per group, 40 runs each, typed once and scored by every policy,
// with their true time lost after 10 runs and after all of them.
// With `world.ownCost`, each typist's own miss cost (ADR 0015) is drawn log-uniformly from 1 to 8 intervals
// from a stream of its own, so every other draw is the shipped simulator's.
export const OWN_COST_STREAM = 15_000_000;

export function simulate(seed, { typists = 8, runs = 40, world = {} } = {}) {
  const random = seeded(seed);
  const costs = seeded(seed + OWN_COST_STREAM);

  return GROUPS.flatMap((group) => SKILLS.flatMap((skill) => Array.from({ length: typists }, (_, i) => {
    const typist = makeTypist(random, group, skill, i, world.ownCost ? { ...world, missIntervals: 8 ** costs() } : world);
    const history = Array.from({ length: runs }, (_, r) => typeRun(typist, random, r, `${seed}-${group}-${skill.name}-${i}-${r}`));

    return { typist, history, truth: { 10: trueLoss(typist, 10), [runs]: trueLoss(typist, runs) } };
  })));
}

// One policy's measures over one seed's typists.
export function score(population, policy) {
  const replays = population.map(({ typist, history, truth, loops }) => ({ typist, truth, ...replay(history, policy, loops) }));
  const stationary = replays.filter((r) => r.typist.group !== 'drifting');
  const drifting = replays.filter((r) => r.typist.group === 'drifting');
  const predicts = replays[0].losses.length > 0;
  const end = population[0].history.length;

  const planted = (at, names) => mean(stationary.flatMap((r) => r.typist.planted.filter((p) => names.includes(p.stratum))
    .map((p) => (r.lean[at].includes(p.pair) ? 1 : 0))));

  const steady = (read) => median(drifting.map((r) => runsUntilSteady(r.lean, (top) => read(r.typist, top))));
  const errors = STRATA.map(([name]) => name);

  const scores = {
    logLoss: predicts ? mean(replays.map((r) => mean(r.losses))) : null,
    byGroup: Object.fromEntries(GROUPS.map((g) => [g, predicts ? mean(replays.filter((r) => r.typist.group === g).map((r) => mean(r.losses))) : null])),
    calibration: predicts ? calibration(replays.flatMap((r) => r.predictions)) : null,
    timingError: predicts ? mean(replays.map((r) => r.timingError)) : null,
    captured10: mean(replays.map((r) => captured(r.lean[10], r.truth[10]))),
    captured40: mean(replays.map((r) => captured(r.lean[end], r.truth[end]))),
    planted10: planted(10, errors),
    planted40: planted(end, errors),
    strata: Object.fromEntries(PLANTED.map((name) => [name, { at10: planted(10, [name]), at40: planted(end, [name]) }])),
    pickUp: steady((typist, top) => top.includes(typist.slipping)),
    letGo: steady((typist, top) => !top.includes(typist.fixed)),
    slowPickUp: steady((typist, top) => top.includes(typist.slippingSlow)),
    slowLetGo: steady((typist, top) => !top.includes(typist.fixedSlow)),
  };

  // ADR 0015's simulator only: how far the cost of a miss the policy uses is from the typist's own.
  if (population[0].typist.missCost !== null) {
    scores.costError = mean(replays.map((r) => mean([10, end].map((t) => Math.abs(Math.log((r.costs[t] ?? 2) / r.typist.missCost))))));
  }

  return scores;
}

// The constants ADR 0013's rule v2 chooses on validation typists: K by counts-gain's next-run log loss, the
// half-life by the decay variant's, and the timing shrinkage by the timing variant's next-run timing error.
export function validate(options = {}) {
  const populations = VALIDATION_SEEDS.map((seed) => simulate(seed, options));
  const measure = (policy, constants, read) => mean(populations.map((population) => read(score(population, learnerPolicy(policy, constants)))));
  const best = (rows, key) => rows.reduce((a, b) => (b[key] < a[key] ? b : a));
  const pooled = POOLED_TRIES_GRID.map((pooledTries) => ({ pooledTries, logLoss: measure(LEARNER_POLICY, { pooledTries }, (s) => s.logLoss) }));
  const pooledTries = best(pooled, 'logLoss').pooledTries;
  const halfLife = HALF_LIFE_GRID.map((halfLifeRuns) => ({ halfLifeRuns, logLoss: measure(DECAY_POLICY, { pooledTries, halfLifeRuns }, (s) => s.logLoss) }));
  const timing = TIMING_TRIES_GRID.map((timingTries) => ({ timingTries, timingError: measure(TIMING_POLICY, { pooledTries, timingTries }, (s) => s.timingError) }));

  return { pooledTries, halfLifeRuns: best(halfLife, 'logLoss').halfLifeRuns, timingTries: best(timing, 'timingError').timingTries, pooled, halfLife, timing };
}

// Every policy on every test seed, at the validated constants.
export function evaluate({ constants, seeds = TEST_SEEDS, ...options }) {
  const policies = [{ name: 'counting@1', components: null, policy: countingPolicy },
    ...VARIANTS.map((v) => ({ name: v.name, components: v.components, policy: learnerPolicy(v.policy, constants) }))];

  const perSeed = seeds.map((seed) => {
    const population = simulate(seed, options);

    return Object.fromEntries(policies.map(({ name, policy }) => [name, score(population, policy)]));
  });

  return { seeds, constants, policies: policies.map(({ name, components }) => ({ name, components })), perSeed };
}

// Each measure, and whether lower is better.
export const MEASURES = { logLoss: true, calibration: true, captured10: false, captured40: false, planted10: false, pickUp: true, letGo: true, slowPickUp: true, slowLetGo: true };

// The 95% t value for 29 degrees of freedom: rule v2 judges on thirty seeds.
const T_29 = 2.045;
const T_29_SEEDS = 30;

// The mean of A − B over the seeds on one measure, with its 95% t interval (rule v2), or null for a measure a
// policy lacks.
export function paired(result, a, b, measure) {
  const d = result.perSeed.map((seed) => (seed[a][measure] === null || seed[b][measure] === null ? null : seed[a][measure] - seed[b][measure]));

  if (d.includes(null)) return null;

  if (d.length !== T_29_SEEDS) throw new Error(`rule v2 judges on ${T_29_SEEDS} seeds, not ${d.length}`);
  const m = mean(d);
  const half = (T_29 * Math.sqrt(d.reduce((sum, v) => sum + (v - m) ** 2, 0) / (d.length - 1))) / Math.sqrt(d.length);

  return { mean: m, low: m - half, high: m + half };
}

// Really better or worse: the interval excludes zero on that side.
const really = (result, a, b, measure, side) => {
  const d = paired(result, a, b, measure);
  const lowerIsBetter = MEASURES[measure];

  if (!d) return false;

  return side === 'better' ? (lowerIsBetter ? d.high < 0 : d.low > 0) : (lowerIsBetter ? d.low > 0 : d.high < 0);
};

// ADR 0013's decision rule v2.
export function decide(result) {
  const worse = (a, b, measures) => measures.filter((m) => really(result, a, b, m, 'worse'));
  const guard = ['logLoss', 'calibration', 'captured10', 'captured40'];

  // 1. Timing, unless it is really worse than the same policy without it, with and without decay.
  const timingHarm = [...worse('+timing', 'counts-gain', [...guard, 'planted10']).map((m) => `+timing ${m}`),
    ...worse('+decay +timing', '+decay', [...guard, 'planted10']).map((m) => `+decay +timing ${m}`)];

  const timing = timingHarm.length === 0;

  // 2. Decay, when it really tracks change better and is really worse on nothing it must not lose.
  const without = timing ? '+timing' : 'counts-gain';
  const withDecay = timing ? '+decay +timing' : '+decay';
  const tracking = ['pickUp', 'letGo', ...(timing ? ['slowPickUp', 'slowLetGo'] : [])];
  const decayHelps = tracking.filter((m) => really(result, withDecay, without, m, 'better'));
  const decayHarm = worse(withDecay, without, guard);
  const decay = decayHelps.length > 0 && decayHarm.length === 0;
  const learner = decay ? withDecay : without;

  // 3. The learner replaces counting@1 unless it is really worse on captured gain.
  const baselineHarm = worse(learner, 'counting@1', ['captured10', 'captured40']);

  return { default: baselineHarm.length ? 'counting@1' : learner, learner, timing, timingHarm, decay, decayHelps, decayHarm, baselineHarm };
}

// The comparisons rule v2 reads, and every learner policy against counting@1.
export const COMPARISONS = [['+timing', 'counts-gain'], ['+decay +timing', '+decay'], ['+decay', 'counts-gain'], ['+decay +timing', '+timing'],
  ...VARIANTS.map((v) => [v.name, 'counting@1'])];

export function differences(result) {
  return COMPARISONS.map(([a, b]) => ({ a, b, ...Object.fromEntries(Object.keys(MEASURES).map((m) => [m, paired(result, a, b, m)])) }));
}

// ADR 0015's rule: learner@2. Each typist has a miss cost of its own, in two simulator variants.
export const RULE_0015 = {
  testSeeds: Array.from({ length: 30 }, (_, i) => 201 + i),
  costGrid: [1, 5, 10, 20, 40, 80],
  halfLifeGrid: [10, 20, 30, 60],
  worlds: { slow: { ownCost: true }, 'at pace': { ownCost: true, errorPairsAtPace: true } },
  guards: ['logLoss', 'calibration', 'captured10', 'captured40', 'planted10', 'pickUp', 'letGo'],
};

const RULE_0015_WORLDS = Object.keys(RULE_0015.worlds);

// Every named policy ({ name, policy, constants, focus }) on every seed, in both simulator variants.
export function evaluate0015(policies, seeds, options = {}) {
  return Object.fromEntries(Object.entries(RULE_0015.worlds).map(([variant, world]) => [variant, {
    seeds,
    perSeed: seeds.map((seed) => {
      const population = simulate(seed, { ...options, world });

      return Object.fromEntries(policies.map((p) => [p.name, score(population, learnerPolicy(p.policy, p.constants, p.focus))]));
    }),
  }]));
}

const meanOver = (byVariant, name, read) => mean(Object.values(byVariant).flatMap((result) => result.perSeed.map((seed) => read(seed[name]))));

// A against B under rule 0015: really better on any of `gains` in at least one variant, and really worse on none of
// the guards in either.
export function decide0015(byVariant, a, b, gains) {
  const helps = RULE_0015_WORLDS.flatMap((v) => gains.filter((m) => really(byVariant[v], a, b, m, 'better')).map((m) => `${v} ${m}`));
  const harm = RULE_0015_WORLDS.flatMap((v) => RULE_0015.guards.filter((m) => really(byVariant[v], a, b, m, 'worse')).map((m) => `${v} ${m}`));

  return { wins: helps.length > 0 && harm.length === 0, helps, harm };
}

export const SHIPPED = { pooledTries: LEARNER_VARIANTS[DECAY_TIMING_POLICY].pooledTries, halfLifeRuns: LEARNER_VARIANTS[DECAY_TIMING_POLICY].halfLifeRuns,
  timingTries: LEARNER_VARIANTS[DECAY_TIMING_POLICY].timingTries };

const FOCUS_MEASURES = ['captured10', 'captured40', 'planted10', 'planted40'];

export function rule0015(options = {}) {
  const shipped = { name: 'shipped', policy: DECAY_TIMING_POLICY, constants: SHIPPED };

  // A's constant: C by the cost error on validation seeds, both variants.
  const costValidation = evaluate0015(RULE_0015.costGrid.map((c) => ({ name: String(c), policy: OWN_COST_POLICY, constants: { ...SHIPPED, costCorrections: c } })),
    VALIDATION_SEEDS, options);

  const cost = RULE_0015.costGrid.map((c) => ({ costCorrections: c, costError: meanOver(costValidation, String(c), (s) => s.costError) }));
  const costCorrections = cost.reduce((a, b) => (b.costError < a.costError ? b : a)).costCorrections;
  const candidate = { name: 'candidate', policy: OWN_COST_POLICY, constants: { ...SHIPPED, costCorrections } };

  // A, on the test seeds.
  const testA = evaluate0015([shipped, candidate], RULE_0015.testSeeds, options);
  const a = decide0015(testA, 'candidate', 'shipped', ['captured10', 'captured40']);
  const chosenA = a.wins ? candidate : shipped;

  // B's constant at A's choice: the half-lives within a point of the best on captured gain, then the lowest let-go + pick-up.
  const lifeValidation = evaluate0015(RULE_0015.halfLifeGrid.map((h) => ({ name: String(h), policy: chosenA.policy, constants: { ...chosenA.constants, halfLifeRuns: h } })),
    VALIDATION_SEEDS, options);

  const halfLife = RULE_0015.halfLifeGrid.map((h) => ({ halfLifeRuns: h, ...Object.fromEntries(['captured10', 'captured40', 'letGo', 'pickUp']
    .map((m) => [m, meanOver(lifeValidation, String(h), (s) => s[m])])) }));

  const best = (m) => Math.max(...halfLife.map((row) => row[m]));
  const eligible = halfLife.filter((row) => row.captured10 >= best('captured10') - 0.01 && row.captured40 >= best('captured40') - 0.01);
  const halfLifeRuns = eligible.reduce((x, y) => (y.letGo + y.pickUp < x.letGo + x.pickUp || (y.letGo + y.pickUp === x.letGo + x.pickUp && y.halfLifeRuns > x.halfLifeRuns) ? y : x)).halfLifeRuns;

  // B, on the test seeds, only when validation moved the half-life.
  const forgetting = { ...chosenA, name: 'forgetting', constants: { ...chosenA.constants, halfLifeRuns } };
  const testB = halfLifeRuns === chosenA.constants.halfLifeRuns ? null : evaluate0015([{ ...chosenA, name: 'chosen' }, forgetting], RULE_0015.testSeeds, options);
  const b = testB ? decide0015(testB, 'forgetting', 'chosen', ['letGo', 'pickUp']) : { wins: false, helps: [], harm: [], validationKept: true };
  const final = b.wins ? forgetting : chosenA;
  const name = a.wins || b.wins ? `learner${a.wins ? '-own-cost' : ''}${b.wins ? `-forget-${halfLifeRuns}` : ''}@2` : DECAY_TIMING_POLICY;

  // Reported, deciding nothing: what the accuracy and speed focuses trade, for the default after A and B.
  const focus = evaluate0015(['balanced', 'accuracy', 'speed'].map((f) => ({ ...final, name: f, focus: f })), RULE_0015.testSeeds, options);

  const focusMeans = Object.fromEntries(Object.entries(focus).map(([variant, result]) => [variant, Object.fromEntries(['balanced', 'accuracy', 'speed'].map((f) => [f, {
    ...Object.fromEntries(FOCUS_MEASURES.map((m) => [m, mean(result.perSeed.map((seed) => seed[f][m]))])),
    strata: Object.fromEntries(PLANTED.map((st) => [st, { at10: mean(result.perSeed.map((seed) => seed[f].strata[st].at10)), at40: mean(result.perSeed.map((seed) => seed[f].strata[st].at40)) }])),
  }]))]));

  return { rule: '0015', validation: { cost, costCorrections, halfLife, eligible: eligible.map((row) => row.halfLifeRuns), halfLifeRuns },
    a: { candidate: candidate.constants, result: testA, decision: a }, b: { constants: forgetting.constants, result: testB, decision: b },
    default: { name, policy: final.policy, constants: final.constants }, focus: focusMeans };
}

const MEASURES_0015 = [...RULE_0015.guards, 'slowPickUp', 'slowLetGo', 'costError'];

export function report0015(record) {
  const { validation, a, b } = record;
  const perTenThousand = (v) => `${v >= 0 ? '+' : ''}${(v * 1e4).toFixed(2)}`;
  const formats = { ...FORMATS, logLoss: perTenThousand, calibration: perTenThousand, costError: signed(3) };
  const lower = { ...MEASURES, costError: true };
  const meanFormat = (m) => (['logLoss', 'calibration'].includes(m) ? fixed(4) : m.startsWith('captured') || m === 'planted10' ? percent : m === 'costError' ? fixed(3) : fixed(1));

  const means = (result, names) => RULE_0015_WORLDS.flatMap((v) => names.map((name) => [v, name, ...MEASURES_0015.map((m) => {
    const values = result[v].perSeed.map((seed) => seed[name][m]);

    return values.includes(null) || values.includes(undefined) ? '–' : meanFormat(m)(mean(values));
  })]));

  const diffs = (result, x, y) => RULE_0015_WORLDS.map((v) => [`${v}: ${x} − ${y}`, ...MEASURES_0015.map((m) => {
    const d = result[v].perSeed.some((seed) => seed[x][m] === undefined) ? null : paired(result[v], x, y, m);

    return d ? `${formats[m](d.mean)} [${formats[m](d.low)}, ${formats[m](d.high)}]${(lower[m] ? d.high < 0 : d.low > 0) ? ' better' : (lower[m] ? d.low > 0 : d.high < 0) ? ' worse' : ''}` : '–';
  })]);

  const verdict = (d) => (d.wins ? `wins, really better on ${d.helps.join(', ')}` : d.validationKept ? 'validation kept 60 runs, so nothing changes'
    : `stays out${d.helps.length ? `, really better on ${d.helps.join(', ')}` : ', really better on nothing it must win'}${d.harm.length ? `, really worse on ${d.harm.join(', ')}` : ''}`);

  return [
    `ADR 0015. Validation (seeds ${VALIDATION_SEEDS.join(', ')}, both variants). C by cost error: ${validation.cost.map((r) => `${r.costCorrections} ${fixed(4)(r.costError)}`).join(', ')}: C = ${validation.costCorrections}.`,
    '',
    `A. Test seeds ${RULE_0015.testSeeds[0]} to ${RULE_0015.testSeeds.at(-1)}: the shipped default and the candidate (own cost, C = ${validation.costCorrections}), means over the seeds.`,
    table(['variant', 'policy', ...MEASURES_0015], means(a.result, ['shipped', 'candidate'])),
    'Paired differences over the thirty seeds, mean [95% t interval]: log loss and calibration in 10⁻⁴, captured and planted in points, the rest in runs.',
    table(['A − B', ...MEASURES_0015], diffs(a.result, 'candidate', 'shipped')),
    `A: the candidate ${verdict(a.decision)}.`,
    '',
    `B. Validation at A's choice: ${validation.halfLife.map((r) => `${r.halfLifeRuns} runs: captured@10 ${percent(r.captured10)}, captured@40 ${percent(r.captured40)}, let-go ${fixed(2)(r.letGo)}, pick-up ${fixed(2)(r.pickUp)}`).join('; ')}.`,
    `Eligible: ${validation.eligible.join(', ')}. Chosen: ${validation.halfLifeRuns} runs.`,
    ...(b.result ? [table(['variant', 'policy', ...MEASURES_0015], means(b.result, ['chosen', 'forgetting'])), table(['A − B', ...MEASURES_0015], diffs(b.result, 'forgetting', 'chosen'))] : []),
    `B: a ${validation.halfLifeRuns}-run half-life ${verdict(b.decision)}.`,
    '',
    `Default by ADR 0015: ${record.default.name} (${JSON.stringify(record.default.constants)}). The app's DEFAULT_POLICY: ${DEFAULT_POLICY}.`,
    '',
    'Descriptive, deciding nothing: the default by focus, means over the test seeds.',
    table(['variant', 'focus', ...FOCUS_MEASURES, ...PLANTED.map((st) => `${st}@10`), ...PLANTED.map((st) => `${st}@40`)],
      Object.entries(record.focus).flatMap(([variant, byFocus]) => Object.entries(byFocus).map(([f, m]) => [variant, f, ...FOCUS_MEASURES.map((k) => percent(m[k])),
        ...PLANTED.map((st) => percent(m.strata[st].at10)), ...PLANTED.map((st) => percent(m.strata[st].at40))]))),
  ].join('\n');
}

// A stored profile, replayed the same way on its own measured runs (the keyboard with the most of them).
export function evaluateProfile(stored, constants) {
  const profile = normalizeProfile(stored);
  const counts = new Map();

  for (const run of profile.runs.filter(evidenceRun)) counts.set(keyboardOf(run.conditions), (counts.get(keyboardOf(run.conditions)) || 0) + 1);
  const keyboard = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const runs = profile.runs.filter((run) => evidenceRun(run) && keyboardOf(run.conditions) === keyboard && run.patterns?.length && run.at);

  const scored = (policy) => {
    const losses = [];
    const predictions = [];

    for (let t = 1; t < runs.length; t += 1) {
      const model = fitLearner(learnerEvidence(runs.slice(0, t), keyboard), Date.parse(runs[t].at), { ...LEARNER_VARIANTS[policy], ...constants });
      const byUnit = new Map(model.units.map((e) => [e.unit, e.error.mean]));
      let loss = 0;
      let tries = 0;

      for (const [pair, n, e] of runs[t].patterns) {
        const p = Math.min(1 - 1e-6, Math.max(1e-6, byUnit.get(pair) ?? model.errorRate));
        loss -= e * Math.log(p) + (n - e) * Math.log(1 - p);
        tries += n;
        predictions.push({ p, n, e });
      }

      if (tries) losses.push(loss / tries);
    }

    return { logLoss: mean(losses), calibration: calibration(predictions) };
  };

  return { keyboard, runs: runs.length, policies: Object.fromEntries(VARIANTS.map((v) => [v.policy, scored(v.policy)])) };
}

// A 120-run history (the most pattern evidence a profile keeps), fitted repeatedly with the default.
export function fitTime(seed = 419) {
  const random = seeded(seed);
  const typist = makeTypist(random, 'mechanics', SKILLS[1]);
  const history = Array.from({ length: 120 }, (_, r) => typeRun(typist, random, r, `timing-${r}`).run);
  const now = Date.parse(history.at(-1).at);
  fitLearner(learnerEvidence(history, KEYBOARD), now);

  const times = Array.from({ length: 30 }, () => {
    const started = performance.now();
    fitLearner(learnerEvidence(history, KEYBOARD), now);

    return performance.now() - started;
  });

  return { median: median(times), max: Math.max(...times) };
}

// Descriptive, outside rule v2: how often Train names a target by each run, under the earlier naming rule and
// the current one, and how often a named target is among the typist's true top four units by time lost.
export const NAMING_RUNS = [5, 10, 20, 40];

// The earlier rule: only the top-ranked unit could be named, and a slow pair on its intervals and runs alone,
// with no floor on its slowdown in ms.
function earlierRuleTarget(model) {
  const top = model.units.find((e) => e.gain > 0);
  const slowEnough = ({ timed = 0, slowRuns = 0, timedRuns = 0 }) => timed >= MIN_PATTERN_SAMPLES && slowRuns * 2 > timedRuns;

  if (!top) return null;
  const own = top.own || top.observed;
  const named = top.basis === 'slow' ? slowEnough(top.observed) : own.seen >= MIN_PATTERN_SAMPLES && (own.errors > 0 || slowEnough(own));

  return named ? { unit: top.unit, basis: top.basis } : null;
}

export function naming({ constants, seeds = TEST_SEEDS, ...options }) {
  const variant = { ...LEARNER_VARIANTS[DEFAULT_POLICY], ...constants };
  const tally = Object.fromEntries(['earlier', 'current'].map((rule) => [rule, Object.fromEntries(NAMING_RUNS.map((t) => [t, { fits: 0, named: 0, topFour: 0, slow: 0 }]))]));

  for (const seed of seeds) {
    for (const { typist, history } of simulate(seed, options)) {
      for (const t of NAMING_RUNS) {
        const model = fitLearner(learnerEvidence(history.slice(0, t).map((h) => h.run), KEYBOARD), START + t * RUN_MS, variant);
        const recommendation = learnerRecommendation(model);
        const loss = [...trueLoss(typist, t)].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, LEAN_UNITS).map(([unit]) => unit);
        const current = recommendation.target ? { unit: recommendation.target, basis: recommendation.was.basis || 'errors' } : null;

        for (const [rule, target] of [['earlier', earlierRuleTarget(model)], ['current', current]]) {
          const cell = tally[rule][t];
          cell.fits += 1;

          if (!target) continue;
          cell.named += 1;
          cell.topFour += loss.includes(target.unit) ? 1 : 0;
          cell.slow += target.basis === 'slow' ? 1 : 0;
        }
      }
    }
  }

  return Object.fromEntries(Object.entries(tally).map(([rule, byRun]) => [rule, Object.fromEntries(Object.entries(byRun).map(([t, c]) => [t,
    { fits: c.fits, named: c.named / c.fits, topFour: c.named ? c.topFour / c.named : null, slow: c.named ? c.slow / c.named : null }]))]));
}

export const fixed = (digits) => (v) => v.toFixed(digits);
export const percent = (v) => `${(v * 100).toFixed(1)}%`;
const points = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`;
export const signed = (digits) => (v) => `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;

export function table(header, rows) {
  const widths = header.map((_, i) => Math.max(...[header, ...rows].map((row) => row[i].length)));

  return [header, ...rows].map((row) => row.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

export const FORMATS = { logLoss: signed(4), calibration: signed(4), captured10: points, captured40: points, planted10: points, pickUp: signed(1), letGo: signed(1),
  slowPickUp: signed(1), slowLetGo: signed(1) };

export function report(validation, result) {
  const names = result.policies.map((p) => p.name);

  const avg = (name, read, format) => {
    const values = result.perSeed.map((seed) => read(seed[name]));

    return values.includes(null) ? '–' : format(mean(values));
  };

  const verdict = decide(result);
  const loss = fixed(4);
  const runs = fixed(1);
  const diff = (d, m) => (d ? `${FORMATS[m](d.mean)} [${FORMATS[m](d.low)}, ${FORMATS[m](d.high)}]` : '–');

  return [
    ...(result.world ? [`Sensitivity run, which decides nothing: ${JSON.stringify(result.world)}.`, ''] : []),
    `Validation (seeds ${VALIDATION_SEEDS.join(', ')}). K by counts-gain's log loss: ${validation.pooled.map((r) => `${r.pooledTries} ${loss(r.logLoss)}`).join(', ')}: K = ${validation.pooledTries}.`,
    `Half-life by +decay's log loss: ${validation.halfLife.map((r) => `${r.halfLifeRuns} ${loss(r.logLoss)}`).join(', ')}: ${validation.halfLifeRuns} runs.`,
    `Timing shrinkage by +timing's next-run timing error: ${validation.timing.map((r) => `${r.timingTries} ${fixed(5)(r.timingError)}`).join(', ')}: S = ${validation.timingTries}.`,
    '',
    `Test seeds ${result.seeds[0]} to ${result.seeds.at(-1)}, means over the seeds. Log loss and calibration: next run's first tries. Captured: true time lost in the top ${LEAN_UNITS}, as a share of the best ${LEAN_UNITS}.`,
    table(['policy', 'log loss', 'calibration', 'captured@10', 'captured@40', 'planted@10', ...PLANTED.map((n) => `${n}@10`), 'planted@40', ...PLANTED.map((n) => `${n}@40`),
      'pick-up', 'let-go', 'slow pick-up', 'slow let-go'],
    names.map((name) => [name, avg(name, (s) => s.logLoss, loss), avg(name, (s) => s.calibration, loss), avg(name, (s) => s.captured10, percent), avg(name, (s) => s.captured40, percent),
      avg(name, (s) => s.planted10, percent), ...PLANTED.map((n) => avg(name, (s) => s.strata[n].at10, percent)), avg(name, (s) => s.planted40, percent),
      ...PLANTED.map((n) => avg(name, (s) => s.strata[n].at40, percent)), avg(name, (s) => s.pickUp, runs), avg(name, (s) => s.letGo, runs),
      avg(name, (s) => s.slowPickUp, runs), avg(name, (s) => s.slowLetGo, runs)])),
    '',
    'Paired differences A − B over the thirty seeds: mean [95% t interval]. Captured and planted in percentage points, pick-up and let-go in runs.',
    table(['A − B', ...Object.keys(MEASURES)], differences(result).map((row) => [`${row.a} − ${row.b}`, ...Object.keys(MEASURES).map((m) => diff(row[m], m))])),
    '',
    `1. Timing: ${verdict.timing ? 'in, really worse on none of its guards' : `out, really worse on ${verdict.timingHarm.join(', ')}`}.`,
    `2. Decay: ${verdict.decay ? `in, really better on ${verdict.decayHelps.join(', ')}` : verdict.decayHarm.length ? `out, really worse on ${verdict.decayHarm.join(', ')}` : 'out, really better on no tracking measure'}.`,
    `3. ${verdict.learner} against counting@1 on captured gain: ${verdict.baselineHarm.length ? `really worse on ${verdict.baselineHarm.join(', ')}, so counting@1 stays` : 'not really worse, so it replaces counting@1'}.`,
    `Default by rule v2: ${verdict.default} (${VARIANTS.find((v) => v.name === verdict.default)?.policy ?? verdict.default}). The app's DEFAULT_POLICY: ${DEFAULT_POLICY}.`,
  ].join('\n');
}

export function namingReport(rates) {
  const share = (v) => (v === null ? '–' : percent(v));
  const rows = Object.entries(rates).flatMap(([rule, byRun]) => Object.entries(byRun).map(([t, c]) => [rule, t, share(c.named), share(c.topFour), share(c.slow)]));

  return ['Descriptive, outside rule v2: Train under the earlier naming rule (top-ranked unit only, no slowness floor) and the current one (the',
    `highest-ranked unit that can be named, slowness past ${SLOW_FLOOR_MS} ms). Named: share of typist fits with a target. Top four: share of named`,
    'targets among the typist\'s true top four units by time lost. Slow: share of named targets named for slowness.',
    table(['rule', 'runs', 'named', 'top four', 'slow'], rows)].join('\n');
}

// What a sensitivity run keeps: no per-seed rows, which the rule's record holds for the shipped simulator.
function sensitivityRecord(world, validation, result, rates) {
  const means = Object.fromEntries(result.policies.map(({ name }) => [name, Object.fromEntries(Object.keys(MEASURES)
    .map((m) => [m, result.perSeed.some((seed) => seed[name][m] === null) ? null : mean(result.perSeed.map((seed) => seed[name][m]))]))]));

  return { rule: 'v2', sensitivity: world, decides: 'nothing', seeds: result.seeds, constants: result.constants, validation, means,
    differences: differences(result), decision: decide(result), naming: rates };
}

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);

  return at > 0 ? process.argv[at + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const world = {};

  if (process.argv.includes('--errors-at-pace')) world.errorPairsAtPace = true;

  if (option('miss-cost', null)) world.missCost = Number(option('miss-cost', null));

  // ADR 0019's rule runs in its own process, on worker threads, because it imports this module.
  if (option('rule', null) === '0019') {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./evaluate-let-go.mjs', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(child.status ?? 1);
  }

  if (option('rule', null) === '0015') {
    const record = rule0015({ typists: Number(option('typists', 8)), runs: Number(option('runs', 40)) });
    console.log(report0015(record));
    const json = option('json', null);

    if (json) writeFileSync(json, `${JSON.stringify(record, null, 1)}\n`);
    const timing = fitTime();
    console.log(`\n${DEFAULT_POLICY}, fit on a 120-run history: median ${timing.median.toFixed(1)} ms, slowest ${timing.max.toFixed(1)} ms (of 30)`);
    process.exit(0);
  }

  const sensitivity = Object.keys(world).length > 0;
  const options = { typists: Number(option('typists', 8)), runs: Number(option('runs', 40)) };

  if (sensitivity) options.world = world;
  const validation = validate(options);
  const constants = { pooledTries: validation.pooledTries, halfLifeRuns: validation.halfLifeRuns, timingTries: validation.timingTries };
  console.log(`constants chosen on validation: ${JSON.stringify(constants)}`);

  if (process.argv.includes('--validation-only')) {
    console.log(JSON.stringify(validation));
    process.exit(0);
  }

  const result = evaluate({ constants, ...options });
  console.log(report(validation, sensitivity ? { ...result, world } : result));
  const rates = naming({ constants, ...options });
  console.log(`\n${namingReport(rates)}`);
  const json = option('json', null);

  if (json) {
    const record = sensitivity ? sensitivityRecord(world, validation, result, rates) : { rule: 'v2', validation, ...result, differences: differences(result), decision: decide(result) };
    writeFileSync(json, `${JSON.stringify(record, null, 1)}\n`);
  }

  const namingJson = option('naming', null);

  if (namingJson) writeFileSync(namingJson, `${JSON.stringify({ descriptive: true, constants, seeds: TEST_SEEDS, naming: rates }, null, 1)}\n`);
  const timing = fitTime();
  console.log(`\n${DEFAULT_POLICY}, fit on a 120-run history: median ${timing.median.toFixed(1)} ms, slowest ${timing.max.toFixed(1)} ms (of 30)`);
  const shipped = LEARNER_VARIANTS[DEFAULT_POLICY];
  console.log(`constants as shipped: pooledTries ${shipped.pooledTries}, halfLifeRuns ${shipped.halfLifeRuns}, timingTries ${shipped.timingTries}`);
  const path = option('profile', null);

  if (path) {
    const profile = evaluateProfile(JSON.parse(readFileSync(path, 'utf8')), constants);
    console.log(`\nprofile ${path}: ${profile.runs} runs on ${profile.keyboard}`);

    for (const [policy, scores] of Object.entries(profile.policies)) console.log(`  ${policy.padEnd(24)} log loss ${fixed(4)(scores.logLoss)}  calibration ${fixed(4)(scores.calibration)}`);
  }
}

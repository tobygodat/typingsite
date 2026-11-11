// Evaluates the recommendation policies on simulated typists, and applies ADR 0013's decision rule to pick
// the default. Deterministic from its seeds. See docs/adr/0013-learning-core.md.
//
//   npm run evaluate:learner -- [--typists 8] [--runs 40] [--json out.json] [--profile path/to/profile.json]
//
// What it shows, and what it does not: how well each policy predicts the next run's first-try errors and how
// soon it finds planted and slipping weak pairs, on simulated typists. It says nothing about whether anyone
// learns faster: a simulated typist improves after a drill only as the simulator says it does.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CORPUS_VERSION, METRIC_VERSION, completeAttempt, makePassage } from '../src/typing.js';
import { evidenceRun, runRecord } from '../src/insights.js';
import { DECAY_POLICY, DEFAULT_POLICY, HALF_LIFE_RUNS, LEAN_UNITS, LEARNER_POLICY, LEARNER_VARIANTS, countingRecommendation, englishFrequency, fitLearner, keyboardOf,
  learnerEvidence, learnerRecommendation } from '../src/learner.js';
import { normalizeProfile } from '../src/profile.js';
import { keyboardRows } from '../src/layouts.js';

const CONDITIONS = { mode: 'words', count: 25, punctuation: false, numbers: false, wordList: '200', inputClass: 'physical-keyboard',
  correctionPolicy: 'mandatory', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

const KEYBOARD = keyboardOf(CONDITIONS);
const START = Date.parse('2026-09-01T09:00:00Z');
const RUN_MS = 6 * 3600_000;

// The app keeps this many full traces, which the counting rule's fallback reads.
const TRACES = 24;

// Drifting typists change after this many runs.
const CHANGE = 20;

export const VALIDATION_SEEDS = [9001, 9002];
export const TEST_SEEDS = [1, 2, 3, 4, 5];
export const POOLED_TRIES_GRID = [2, 5, 10, 20, 40, 80];
export const GROUPS = ['mechanics', 'unrelated', 'drifting'];
export const STRATA = [['common', 1, 30], ['middle', 31, 90], ['rare', 91, Infinity]];

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

const gaussian = (random) => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
const sigmoid = (v) => 1 / (1 + Math.exp(-v));
const logit = (p) => Math.log(p / (1 - p));

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

// The pairs the app's 25-word passages hold, most frequent first, from a fixed sample of its own generator.
let passagePairs = null;

export function pairsByFrequency() {
  if (passagePairs) return passagePairs;
  const random = seeded(1);
  const counts = new Map();

  for (let i = 0; i < 2000; i += 1) {
    const text = makePassage('words', CONDITIONS.count, false, random, CONDITIONS.wordList);

    for (let j = 1; j < text.length; j += 1) {
      const pair = text.slice(j - 1, j + 1);

      if (/^[a-z]{2}$/.test(pair)) counts.set(pair, (counts.get(pair) || 0) + 1);
    }
  }

  passagePairs = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([pair]) => pair);

  return passagePairs;
}

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
// unrelated typists have one planted weak pair per stratum; a drifting typist has a common weak pair that is
// fixed at run CHANGE and another that starts slipping then.
export function makeTypist(random, group, skill, index = 0) {
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

  const weakness = () => ({ error: 1.6 + random() * 0.8, slow: 0.3 + random() * 0.3 });
  const planted = [];

  if (group === 'drifting') {
    const fixed = pick(random, stratum('common'), []);
    planted.push({ pair: fixed, stratum: 'common', until: CHANGE, ...weakness() });
    planted.push({ pair: pick(random, stratum('common'), [fixed]), stratum: 'common', from: CHANGE, ...weakness() });
  } else {
    for (const [name] of STRATA) planted.push({ pair: pick(random, stratum(name), planted.map((p) => p.pair)), stratum: name, ...weakness() });
  }

  const active = (pair, run) => planted.find((p) => p.pair === pair && run >= (p.from ?? 0) && run < (p.until ?? Infinity));
  const keyLogit = new Map([...englishFrequency().keys.keys()].map((key) => [key, base + 0.3 * gaussian(random)]));

  return {
    group, skill, planted,
    fixed: group === 'drifting' ? planted[0].pair : null,
    slipping: group === 'drifting' ? planted[1].pair : null,
    pairError: (pair, run) => sigmoid((errorLogit.get(pair) ?? base) + (active(pair, run)?.error || 0)),
    slowness: (pair, run) => (slowness.get(pair) ?? 0) + (active(pair, run)?.slow || 0),
    keyError: (key) => sigmoid(keyLogit.get(key) ?? base),
  };
}

// One run: the app's own passage generator, typed under stop on error (a wrong key is refused, then the
// right one follows), scored and summarized by the app's own code. Returns the summary and the full trace.
export function typeRun(typist, random, index, id) {
  const text = makePassage('words', CONDITIONS.count, false, random, CONDITIONS.wordList);
  const events = [];
  let t = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const pair = i > 0 && /^[a-z]{2}$/.test(text.slice(i - 1, i + 1)) ? text.slice(i - 1, i + 1) : null;
    const p = pair ? typist.pairError(pair, index) : /[a-z]/.test(char) ? typist.keyError(char) : typist.skill.errorRate / 2;
    const step = typist.skill.medianMs * Math.exp((pair ? typist.slowness(pair, index) : 0) + 0.3 * gaussian(random));
    t += Math.max(30, step);

    if (random() < p) {
      events.push({ type: 'insert', text: char === 'x' ? 'z' : 'x', position: i, accepted: false, offsetMs: Math.round(t) });
      t += typist.skill.medianMs * (typist.skill.correctionKeys - 1) * Math.exp(0.2 * gaussian(random));
    }

    events.push({ type: 'insert', text: char, position: i, offsetMs: Math.round(t) });
  }

  const at = new Date(START + index * RUN_MS).toISOString();

  const attempt = completeAttempt({ id, kind: 'test', status: 'complete', conditions: CONDITIONS, textId: id, fresh: true, text, events, startedAt: events[0].offsetMs },
    { endedAt: Math.round(t) });

  return { run: runRecord(attempt, at), trace: attempt };
}

// The learner's variants still in the code, simplest first (ADR 0013 records the ones deleted: the feature
// regression and the hesitation term).
export const VARIANTS = [{ name: 'counts-gain', policy: LEARNER_POLICY, components: [] }, { name: '+decay', policy: DECAY_POLICY, components: ['decay'] }];

// A policy fitted on a typist's first runs: what it predicts for each pair, and the units it acts on.
function learnerPolicy(policy, constants) {
  const variant = { ...LEARNER_VARIANTS[policy], ...constants };

  return (runs, traces, now) => {
    const model = fitLearner(learnerEvidence(runs, KEYBOARD), now, variant);
    const byUnit = new Map(model.units.map((e) => [e.unit, e.error.mean]));

    return { predict: (pair) => byUnit.get(pair) ?? model.errorRate, lean: learnerRecommendation(model).lean.map((item) => item.unit) };
  };
}

// The counting rule as the app runs it, fallback to the newest traces included. It predicts nothing.
const countingPolicy = (runs, traces) => ({ predict: null, lean: countingRecommendation(runs, [], traces, CONDITIONS).lean.map((item) => item.unit) });

// One typist's history, replayed for one policy: fit on the first t runs, predict run t, read the ranking.
function replay(history, policy) {
  const losses = [];
  const predictions = [];
  const lean = [];

  for (let t = 0; t <= history.length; t += 1) {
    const prefix = history.slice(0, t);
    const model = policy(prefix.map((h) => h.run), prefix.slice(-TRACES).map((h) => h.trace), START + t * RUN_MS);
    lean.push(model.lean.slice(0, LEAN_UNITS));

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
  }

  return { losses, predictions, lean };
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

const mean = (values) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);

function median(values) {
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

// The typists of one seed: 8 per skill level per group, 40 runs each, typed once and scored by every policy.
export function simulate(seed, { typists = 8, runs = 40 } = {}) {
  const random = seeded(seed);

  return GROUPS.flatMap((group) => SKILLS.flatMap((skill) => Array.from({ length: typists }, (_, i) => {
    const typist = makeTypist(random, group, skill, i);
    const history = Array.from({ length: runs }, (_, r) => typeRun(typist, random, r, `${seed}-${group}-${skill.name}-${i}-${r}`));

    return { typist, history };
  })));
}

// One policy's measures over one seed's typists.
export function score(population, policy) {
  const replays = population.map(({ typist, history }) => ({ typist, ...replay(history, policy) }));
  const stationary = replays.filter((r) => r.typist.group !== 'drifting');
  const drifting = replays.filter((r) => r.typist.group === 'drifting');
  const predicts = replays[0].losses.length > 0;

  const planted = (at, name = null) => mean(stationary.flatMap((r) => r.typist.planted.filter((p) => !name || p.stratum === name)
    .map((p) => (r.lean[at].includes(p.pair) ? 1 : 0))));

  return {
    logLoss: predicts ? mean(replays.map((r) => mean(r.losses))) : null,
    byGroup: Object.fromEntries(GROUPS.map((g) => [g, predicts ? mean(replays.filter((r) => r.typist.group === g).map((r) => mean(r.losses))) : null])),
    calibration: predicts ? calibration(replays.flatMap((r) => r.predictions)) : null,
    planted10: planted(10),
    planted40: planted(population[0].history.length),
    strata: Object.fromEntries(STRATA.map(([name]) => [name, { at10: planted(10, name), at40: planted(population[0].history.length, name) }])),
    pickUp: median(drifting.map((r) => runsUntilSteady(r.lean, (top) => top.includes(r.typist.slipping)))),
    letGo: median(drifting.map((r) => runsUntilSteady(r.lean, (top) => !top.includes(r.typist.fixed)))),
  };
}

// The constant ADR 0013 chooses on validation typists: K for the counts-only rate, by mean next-run log loss.
// The decay variant keeps the half-life the deciding run chose with the full model, since deleted: 10 runs.
export function validate(options = {}) {
  const populations = VALIDATION_SEEDS.map((seed) => simulate(seed, options));
  const loss = (constants) => mean(populations.map((population) => score(population, learnerPolicy(LEARNER_POLICY, constants)).logLoss));
  const pooled = POOLED_TRIES_GRID.map((pooledTries) => ({ pooledTries, logLoss: loss({ pooledTries }) }));

  return { pooledTries: pooled.reduce((best, row) => (row.logLoss < best.logLoss ? row : best)).pooledTries, pooled };
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

// A measure's mean and range over the seeds.
export function spread(result, name, read) {
  const values = result.perSeed.map((seed) => read(seed[name]));

  return values.includes(null) ? null : { mean: mean(values), low: Math.min(...values), high: Math.max(...values) };
}

// ADR 0013: A beats B on a measure when their ranges over the seeds don't overlap and A's is the better.
const better = (a, b, lowerIsBetter) => Boolean(a && b) && (lowerIsBetter ? a.high < b.low : a.low > b.high);

export function decide(result) {
  const planted = (name) => spread(result, name, (s) => s.planted10);
  const pickUp = (name) => spread(result, name, (s) => s.pickUp);
  const loss = (name) => spread(result, name, (s) => s.logLoss);

  const beats = (a, b) => (better(planted(a), planted(b), false) || better(pickUp(a), pickUp(b), true))
    && !better(planted(b), planted(a), false) && !better(pickUp(b), pickUp(a), true);

  const eligible = result.policies.filter(({ name }) => name === 'counting@1' || !better(loss('counts-gain'), loss(name), true));

  const simplicity = (policy) => (policy.components === null ? -1 : policy.components.length);
  const unbeaten = eligible.filter((a) => !eligible.some((b) => b.name !== a.name && beats(b.name, a.name)));

  const ordered = [...unbeaten].sort((a, b) => simplicity(a) - simplicity(b) || planted(b.name).mean - planted(a.name).mean);

  return { default: ordered[0]?.name ?? null, eligible: eligible.map((p) => p.name), unbeaten: unbeaten.map((p) => p.name), beats };
}

// A stored profile, replayed the same way on its own measured runs (the keyboard with the most of them).
export function evaluateProfile(stored, constants) {
  const profile = normalizeProfile(stored);
  const counts = new Map();

  for (const run of profile.runs.filter(evidenceRun)) counts.set(keyboardOf(run.conditions), (counts.get(keyboardOf(run.conditions)) || 0) + 1);
  const keyboard = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const runs = profile.runs.filter((run) => evidenceRun(run) && keyboardOf(run.conditions) === keyboard && run.patterns?.length && run.at);

  const fitWith = (policy) => (prefix, now) => {
    const model = fitLearner(learnerEvidence(prefix, keyboard), now, { ...LEARNER_VARIANTS[policy], ...constants });
    const byUnit = new Map(model.units.map((e) => [e.unit, e.error.mean]));

    return (pair) => byUnit.get(pair) ?? model.errorRate;
  };

  const scored = (fit) => {
    const losses = [];
    const predictions = [];

    for (let t = 1; t < runs.length; t += 1) {
      const predict = fit(runs.slice(0, t), Date.parse(runs[t].at));
      let loss = 0;
      let tries = 0;

      for (const [pair, n, e] of runs[t].patterns) {
        const p = Math.min(1 - 1e-6, Math.max(1e-6, predict(pair)));
        loss -= e * Math.log(p) + (n - e) * Math.log(1 - p);
        tries += n;
        predictions.push({ p, n, e });
      }

      if (tries) losses.push(loss / tries);
    }

    return { logLoss: mean(losses), calibration: calibration(predictions) };
  };

  return { keyboard, runs: runs.length, learner: scored(fitWith(LEARNER_POLICY)), decay: scored(fitWith(DECAY_POLICY)) };
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

const fixed = (digits) => (v) => v.toFixed(digits);
const percent = (v) => `${Math.round(v * 100)}%`;
const cell = (s, format) => (s === null ? '–' : `${format(s.mean)} [${format(s.low)}–${format(s.high)}]`);

function table(header, rows) {
  const widths = header.map((_, i) => Math.max(...[header, ...rows].map((row) => row[i].length)));

  return [header, ...rows].map((row) => row.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

export function report(validation, result) {
  const names = result.policies.map((p) => p.name);
  const at = (name, read, format) => cell(spread(result, name, read), format);
  const verdict = decide(result);
  const loss = fixed(4);

  return [
    `Validation (seeds ${VALIDATION_SEEDS.join(', ')}): log loss by K for the counts-only rate, ${validation.pooled.map((r) => `${r.pooledTries} ${loss(r.logLoss)}`).join(', ')}: K = ${validation.pooledTries}.`,
    `The decay variant's half-life: ${HALF_LIFE_RUNS} runs, chosen with the full model in the run that decided (ADR 0013).`,
    '',
    `Test seeds ${result.seeds.join(', ')}: mean [lowest–highest seed]. Log loss: next run's first tries, mean per typist. ECE: calibration over ten bins.`,
    table(['policy', 'log loss', ...GROUPS, 'ECE'], names.map((name) => [name, at(name, (s) => s.logLoss, loss),
      ...GROUPS.map((g) => at(name, (s) => s.byGroup[g], loss)), at(name, (s) => s.calibration, fixed(4))])),
    '',
    `Ranking: the top ${LEAN_UNITS}. Planted: share of planted pairs in it after 10 and 40 runs. Pick-up, let-go: runs after the change, median.`,
    table(['policy', 'planted@10', ...STRATA.map(([n]) => `${n}@10`), 'planted@40', ...STRATA.map(([n]) => `${n}@40`), 'pick-up', 'let-go'],
      names.map((name) => [name, at(name, (s) => s.planted10, percent), ...STRATA.map(([n]) => at(name, (s) => s.strata[n].at10, percent)),
        at(name, (s) => s.planted40, percent), ...STRATA.map(([n]) => at(name, (s) => s.strata[n].at40, percent)),
        at(name, (s) => s.pickUp, fixed(1)), at(name, (s) => s.letGo, fixed(1))])),
    '',
    `Eligible (log loss not worse than the counts-only rate's beyond the spread): ${verdict.eligible.join(', ')}.`,
    `Not beaten on ranking by an eligible policy: ${verdict.unbeaten.join(', ')}.`,
    `Default by the rule: ${verdict.default} (${VARIANTS.find((v) => v.name === verdict.default)?.policy ?? verdict.default}). The app's DEFAULT_POLICY: ${DEFAULT_POLICY}.`,
  ].join('\n');
}

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);

  return at > 0 ? process.argv[at + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = { typists: Number(option('typists', 8)), runs: Number(option('runs', 40)) };
  const validation = validate(options);
  const constants = { pooledTries: validation.pooledTries, halfLifeRuns: HALF_LIFE_RUNS };
  const result = evaluate({ constants, ...options });
  console.log(report(validation, result));
  const json = option('json', null);

  if (json) writeFileSync(json, `${JSON.stringify({ validation, ...result, default: decide(result).default }, null, 1)}\n`);
  const timing = fitTime();
  console.log(`\n${DEFAULT_POLICY}, fit on a 120-run history: median ${timing.median.toFixed(1)} ms, slowest ${timing.max.toFixed(1)} ms (of 30)`);
  const shipped = LEARNER_VARIANTS[DEFAULT_POLICY];
  console.log(`constants as shipped: pooledTries ${shipped.pooledTries}, halfLifeRuns ${shipped.halfLifeRuns}`);
  const path = option('profile', null);

  if (path) {
    const profile = evaluateProfile(JSON.parse(readFileSync(path, 'utf8')), constants);
    console.log(`\nprofile ${path}: ${profile.runs} runs on ${profile.keyboard}`);
    console.log(`  ${LEARNER_POLICY}        log loss ${fixed(4)(profile.learner.logLoss)}  calibration ${fixed(4)(profile.learner.calibration)}`);
    console.log(`  ${DECAY_POLICY}  log loss ${fixed(4)(profile.decay.logLoss)}  calibration ${fixed(4)(profile.decay.calibration)}`);
  }
}

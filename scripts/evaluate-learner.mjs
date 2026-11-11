// Evaluates the learner (src/learner.js) against the counting rule it replaces, on simulated typists and,
// optionally, on a stored profile. Deterministic from --seed. See docs/adr/0013-learning-core.md.
//
//   npm run evaluate:learner -- [--seed 419] [--typists 8] [--runs 40] [--profile path/to/profile.json]
//
// What it shows, and what it does not: whether a policy predicts the next run's first-try errors and finds
// hidden weak pairs on simulated typists. It says nothing about whether anyone learns faster.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CORPUS_VERSION, METRIC_VERSION, completeAttempt, makePassage } from '../src/typing.js';
import { evidenceRun, recurringTargets, runRecord } from '../src/insights.js';
import { englishFrequency, fitLearner, keyboardOf, learnerEvidence, learnerRecommendation } from '../src/learner.js';
import { normalizeProfile } from '../src/profile.js';
import { keyboardRows } from '../src/layouts.js';

const CONDITIONS = { mode: 'words', count: 25, punctuation: false, numbers: false, wordList: '200', inputClass: 'physical-keyboard',
  correctionPolicy: 'mandatory', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

const START = Date.parse('2026-09-01T09:00:00Z');
const PLANTED = 3;
const TOP = 5;

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

export const SKILLS = [
  { name: 'careful', errorRate: 0.015, medianMs: 150, correctionKeys: 2.5 },
  { name: 'average', errorRate: 0.035, medianMs: 210, correctionKeys: 3 },
  { name: 'learning', errorRate: 0.07, medianMs: 300, correctionKeys: 3.5 },
];

// A typist: hidden first-try error probabilities and timings for every pair and letter.
export function makeTypist(random, group, skill) {
  const table = englishFrequency();
  const pairs = [...table.pairs.keys()].sort();
  const mech = mechanics();
  const base = logit(skill.errorRate);

  const weights = group === 'mechanics'
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

  // Weak pairs unrelated to mechanics, drawn from the 150 most frequent so they turn up in passages.
  const common = [...table.pairs].sort((a, b) => b[1] - a[1]).slice(0, 150).map(([pair]) => pair).sort();
  const weak = [];

  while (weak.length < PLANTED) {
    const pair = common[Math.floor(random() * common.length)];

    if (!weak.includes(pair)) weak.push(pair);
  }

  for (const pair of weak) {
    errorLogit.set(pair, errorLogit.get(pair) + 1.6 + random() * 0.8);
    slowness.set(pair, slowness.get(pair) + 0.3 + random() * 0.3);
  }

  const keyLogit = new Map([...table.keys.keys()].map((key) => [key, base + 0.3 * gaussian(random)]));

  // The true top pairs: the highest true expected gain, as the learner defines it (errors above the typist's
  // typical pair times the true cost of a correction, plus hesitation above its typical pace, times how often
  // the pair turns up). This is the objective the product states, so it is reported beside the planted pairs.
  const share = (pair) => table.pairs.get(pair);
  const total = pairs.reduce((sum, pair) => sum + share(pair), 0);
  const typical = pairs.reduce((sum, pair) => sum + share(pair) * sigmoid(errorLogit.get(pair)), 0) / total;
  const pace = pairs.reduce((sum, pair) => sum + share(pair) * slowness.get(pair), 0) / total;
  const cost = skill.medianMs * (skill.correctionKeys - 1);
  const gain = (pair) => share(pair) * (Math.max(0, sigmoid(errorLogit.get(pair)) - typical) * cost + skill.medianMs * Math.max(0, Math.exp(slowness.get(pair) - pace) - 1));
  const top = [...pairs].sort((a, b) => gain(b) - gain(a) || (a < b ? -1 : 1)).slice(0, PLANTED);

  return { group, skill, weak, top, pairError: (pair) => sigmoid(errorLogit.get(pair) ?? base), slowness: (pair) => slowness.get(pair) ?? 0,
    keyError: (key) => sigmoid(keyLogit.get(key) ?? base) };
}

// One run: the app's own passage generator, typed under stop on error (a wrong key is refused, then the
// right one follows), scored and summarized by the app's own code.
export function typeRun(typist, random, index, id) {
  const text = makePassage('words', CONDITIONS.count, false, random, CONDITIONS.wordList);
  const events = [];
  let t = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const pair = i > 0 && /^[a-z]{2}$/.test(text.slice(i - 1, i + 1)) ? text.slice(i - 1, i + 1) : null;
    const p = pair ? typist.pairError(pair) : /[a-z]/.test(char) ? typist.keyError(char) : typist.skill.errorRate / 2;
    const step = typist.skill.medianMs * Math.exp((pair ? typist.slowness(pair) : 0) + 0.3 * gaussian(random));
    t += Math.max(30, step);

    if (random() < p) {
      events.push({ type: 'insert', text: char === 'x' ? 'z' : 'x', position: i, accepted: false, offsetMs: Math.round(t) });
      t += typist.skill.medianMs * (typist.skill.correctionKeys - 1) * Math.exp(0.2 * gaussian(random));
    }

    events.push({ type: 'insert', text: char, position: i, offsetMs: Math.round(t) });
  }

  const attempt = completeAttempt({ id, kind: 'test', status: 'complete', conditions: CONDITIONS, textId: id, fresh: true, text, events, startedAt: events[0].offsetMs },
    { endedAt: Math.round(t) });

  return runRecord(attempt, new Date(START + index * 6 * 3600_000).toISOString());
}

// The counting rule's own statistic: a pair's pooled first-try miss rate at these conditions, with half a try
// of smoothing either way so a pair never seen to miss isn't predicted never to miss.
function countingModel(runs) {
  const totals = new Map();
  let seen = 0;
  let errors = 0;

  for (const run of runs.filter(evidenceRun)) {
    for (const [pair, n, e] of run.patterns || []) {
      const t = totals.get(pair) || [0, 0];
      totals.set(pair, [t[0] + n, t[1] + e]);
      seen += n;
      errors += e;
    }
  }

  const pooled = (errors + 0.5) / (seen + 1);

  return {
    predict: (pair) => (totals.has(pair) ? (totals.get(pair)[1] + 0.5) / (totals.get(pair)[0] + 1) : pooled),
    ranking: recurringTargets(runs, [], CONDITIONS).map((target) => target.pair),
    target: recurringTargets(runs, [], CONDITIONS)[0]?.pair ?? null,
  };
}

function learnerModel(runs, now, layout) {
  const model = fitLearner(learnerEvidence(runs, keyboardOf(CONDITIONS)), now, layout);
  const byUnit = new Map(model.units.map((e) => [e.unit, e]));

  return {
    predict: (pair) => byUnit.get(pair)?.error.mean ?? model.errorRate,
    ranking: model.units.filter((e) => e.kind === 'pair' && e.gain > 0).map((e) => e.unit),
    target: learnerRecommendation(model).target,
  };
}

// Scores one policy over one typist's history, run by run: fit on every earlier run, predict the next whole
// run. Never split inside a run.
function replay(runs, fit, truth) {
  const predictions = [];
  const losses = [];
  const found = { top: null, planted: null };
  let namedAt = null;

  for (let t = 1; t < runs.length; t += 1) {
    const model = fit(runs.slice(0, t), Date.parse(runs[t].at));
    let loss = 0;
    let tries = 0;

    for (const [pair, n, e] of runs[t].patterns || []) {
      const p = Math.min(1 - 1e-6, Math.max(1e-6, model.predict(pair)));
      loss -= e * Math.log(p) + (n - e) * Math.log(1 - p);
      tries += n;
      predictions.push({ p, n, e });
    }

    if (tries) losses.push({ t, loss: loss / tries });

    for (const [name, pairs] of Object.entries(truth || {})) {
      if (found[name] === null && model.ranking.slice(0, TOP).filter((pair) => pairs.includes(pair)).length >= 2) found[name] = t;
    }

    if (truth && namedAt === null && truth.top.includes(model.target)) namedAt = t;
  }

  return { predictions, losses, found, namedAt };
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

function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted.length ? sorted[sorted.length >> 1] : null;
}

const BUCKETS = [['runs 1–3', 1, 3], ['runs 4–10', 4, 10], ['runs 11+', 11, Infinity]];

function summarize(results, runs) {
  const perTypist = (from, to) => mean(results.map((r) => mean(r.losses.filter((l) => l.t >= from && l.t <= to).map((l) => l.loss))).filter((v) => v !== null));
  const by10 = (name) => results.filter((r) => r.found[name] !== null && r.found[name] <= 10).length / results.length;

  return {
    logLoss: perTypist(1, Infinity),
    buckets: BUCKETS.map(([, from, to]) => perTypist(from, to)),
    runsToFind: medianOf(results.map((r) => r.found.top ?? runs)),
    foundBy10: by10('top'),
    plantedBy10: by10('planted'),
    namedBy10: results.filter((r) => r.namedAt !== null && r.namedAt <= 10).length / results.length,
    calibration: calibration(results.flatMap((r) => r.predictions)),
  };
}

// Simulates `typists` typists per skill level and group, each with `runs` runs, and scores both policies.
export function evaluate({ seed = 419, typists = 8, runs = 40 } = {}) {
  const random = seeded(seed);
  const groups = {};
  const fitTimes = [];

  for (const group of ['mechanics', 'unrelated']) {
    const results = { counting: [], learner: [] };

    for (const skill of SKILLS) {
      for (let i = 0; i < typists; i += 1) {
        const typist = makeTypist(random, group, skill);
        const history = Array.from({ length: runs }, (_, r) => typeRun(typist, random, r, `${group}-${skill.name}-${i}-${r}`));
        results.counting.push(replay(history, countingModel, { top: typist.top, planted: typist.weak }));
        const started = performance.now();
        results.learner.push(replay(history, (prefix, now) => learnerModel(prefix, now, 'qwerty'), { top: typist.top, planted: typist.weak }));
        fitTimes.push((performance.now() - started) / (runs - 1));
      }
    }

    groups[group] = { counting: summarize(results.counting, runs), learner: summarize(results.learner, runs), typists: results.counting.length };
  }

  return { seed, runs, groups, fitMs: medianOf(fitTimes) };
}

// A stored profile, replayed the same way on its own measured runs (the keyboard with the most of them).
export function evaluateProfile(stored) {
  const profile = normalizeProfile(stored);
  const counts = new Map();

  for (const run of profile.runs.filter(evidenceRun)) counts.set(keyboardOf(run.conditions), (counts.get(keyboardOf(run.conditions)) || 0) + 1);
  const keyboard = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const runs = profile.runs.filter((run) => evidenceRun(run) && keyboardOf(run.conditions) === keyboard && run.patterns?.length && run.at);
  const layout = runs[0]?.conditions?.layout;

  const scored = { counting: replay(runs, countingModel, null), learner: replay(runs, (prefix, now) => learnerModel(prefix, now, layout), null) };

  return { keyboard, runs: runs.length,
    counting: { logLoss: mean(scored.counting.losses.map((l) => l.loss)), calibration: calibration(scored.counting.predictions) },
    learner: { logLoss: mean(scored.learner.losses.map((l) => l.loss)), calibration: calibration(scored.learner.predictions) } };
}

// A 120-run history (the most pattern evidence a profile keeps), fitted repeatedly.
export function fitTime(seed = 419) {
  const random = seeded(seed);
  const typist = makeTypist(random, 'mechanics', SKILLS[1]);
  const history = Array.from({ length: 120 }, (_, r) => typeRun(typist, random, r, `timing-${r}`));
  const now = Date.parse(history.at(-1).at);
  const evidence = learnerEvidence(history, keyboardOf(CONDITIONS));
  fitLearner(evidence, now, 'qwerty');

  const times = Array.from({ length: 30 }, () => {
    const started = performance.now();
    fitLearner(learnerEvidence(history, keyboardOf(CONDITIONS)), now, 'qwerty');

    return performance.now() - started;
  });

  return { median: medianOf(times), max: Math.max(...times) };
}

const pct = (v) => `${Math.round(v * 100)}%`;
const num = (v) => (v === null ? '–' : v.toFixed(4));

function table(result) {
  const lines = [`seed ${result.seed}, ${result.runs} runs of 25 words per typist. Log loss: next whole run's first tries, mean per typist.`,
    'ECE: calibration error over ten bins. Runs to find (median): runs until 2 of the true top 3 pairs by gain are in the top 5.',
    'Found / named by 10: share of typists whose top 5 holds 2 of the true top 3, or whose recommended target is one of them, by run 10.',
    'Planted by 10: share whose top 5 holds 2 of the 3 planted weak pairs by run 10.', ''];

  const header = ['group', 'policy', 'log loss', ...BUCKETS.map(([name]) => name), 'ECE', 'runs to find', 'found by 10', 'named by 10', 'planted by 10'];
  const rows = [header];

  for (const [group, { typists, ...policies }] of Object.entries(result.groups)) {
    for (const [policy, s] of Object.entries(policies)) {
      rows.push([`${group} (${typists})`, policy, num(s.logLoss), ...s.buckets.map(num), num(s.calibration), String(s.runsToFind), pct(s.foundBy10), pct(s.namedBy10), pct(s.plantedBy10)]);
    }
  }

  const widths = header.map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  lines.push(...rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ')));

  return lines.join('\n');
}

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);

  return at > 0 ? process.argv[at + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = evaluate({ seed: Number(option('seed', 419)), typists: Number(option('typists', 8)), runs: Number(option('runs', 40)) });
  console.log(table(result));
  const timing = fitTime();
  console.log(`\nfit on a 120-run history: median ${timing.median.toFixed(1)} ms, slowest ${timing.max.toFixed(1)} ms (of 30)`);
  const path = option('profile', null);

  if (path) {
    const profile = evaluateProfile(JSON.parse(readFileSync(path, 'utf8')));
    console.log(`\nprofile ${path}: ${profile.runs} runs on ${profile.keyboard}`);
    console.log(`  counting  log loss ${num(profile.counting.logLoss)}  calibration ${num(profile.counting.calibration)}`);
    console.log(`  learner   log loss ${num(profile.learner.logLoss)}  calibration ${num(profile.learner.calibration)}`);
  }
}

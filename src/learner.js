// The learning core (ADR 0013): a per-person model of letter pairs and keys, derived from the run summaries
// the profile already keeps. It is a pure fold over evidence records: no DOM, no storage, no clock (callers
// pass `now`), no randomness. The same set of records gives the same model in any order, so two devices that
// merge their history agree (ADR 0005), and nothing in it needs a keystroke recording (ADR 0006).
//
// The model ranks. What a person reads is observed evidence: real counts, real timing, real run counts.

import { keyboardRows, normalizeLayout } from './layouts.js';
import { wordList } from './words.js';
import { KEY_COUNTS_VERSION, MIN_PATTERN_SAMPLES, evidenceRun, recurringTargets } from './insights.js';
import { recommendTarget } from './typing.js';

export const LEARNER_POLICY = 'learner@1';
export const BASELINE_POLICY = 'counting@1';

// The policy that picks targets. The counting rule stays in the code as the labelled baseline; the learner
// is the default because, on simulated typists (`npm run evaluate:learner`), it beat that baseline on next-run
// log loss, calibration and how soon it found the true top pairs (ADR 0013).
export const DEFAULT_POLICY = LEARNER_POLICY;

// Evidence fades by run and by day. 30 runs: the profile keeps pattern counts on its newest 120 runs, so the
// oldest kept run weighs 1/16, and the newest 30 runs (about 3,000 letter pairs at 25 words) still outweigh
// everything before them, so a pair that was fixed stops leading within a few sessions. 60 days: skill keeps
// for weeks without practice, so a long break only halves old evidence and gives the prior more say.
export const HALF_LIFE_RUNS = 30;
export const HALF_LIFE_DAYS = 60;

// The feature prior counts as this many first tries: the floor below which the counting rule says nothing.
const PRIOR_TRIES = MIN_PATTERN_SAMPLES;

// The components the evaluation turns off one by one (ADR 0013), and the constants it chooses on validation
// typists: the feature regression (off: the prior is the person's pooled rate, worth `pooledTries`), decay
// (off: every run weighs 1) and the hesitation term (off: the gain counts errors only).
export const FULL_MODEL = { features: true, decay: true, hesitation: true, halfLifeRuns: HALF_LIFE_RUNS, pooledTries: PRIOR_TRIES };

// How far a unit's own hesitation sits from what its mechanics predict, and the spread of one clean interval,
// both as log ratios to the person's median. A run keeps one median per pair, whose variance is about π/2
// times a single interval's divided by the intervals behind it.
const UNIT_SPREAD = 0.15;
const INTERVAL_SPREAD = 0.3;
const MEDIAN_VARIANCE = Math.PI / 2;

// Gains are computed half a standard deviation below each posterior mean, so thin evidence ranks lower.
const UNCERTAINTY_Z = 0.5;
const FIT_ITERATIONS = 12;

// Without measured corrections, one costs two clean keystrokes beyond the one it replaces (a wrong key, then
// the right one, or a backspace and the right one). Without measured timing, a clean keystroke is 200 ms.
const DEFAULT_EXTRA_KEYS = 2;
const DEFAULT_INTERVAL_MS = 200;

// Adaptive and leaning drill text draw on this many of the top units.
export const LEAN_UNITS = 4;

const DAY_MS = 86_400_000;

// Unit features, from the layout's finger map and the frequency table. Index 0 is the intercept.
export const FEATURES = ['bias', 'sameFinger', 'sameHand', 'rowDistance', 'keyDistance', 'repeatedKey', 'frequency', 'offHome', 'weakFinger', 'singleKey'];

// Starting weights for a person with no history. These are a hand-set prior, chosen from typing folklore
// (same-finger and off-home reaches are harder, common pairs are easier), and not trained on anyone: there
// is no data from other people to train on. Error weights are on the log-odds of a first-try error, with an
// intercept near 3%; hesitation weights are on the log ratio of a pair's interval to the person's median.
export const START_WEIGHTS = {
  error: [-3.4, 0.5, 0.1, 0.15, 0.1, 0.2, -0.2, 0.15, 0.2, 0],
  hesitation: [0, 0.3, 0.05, 0.06, 0.04, -0.05, -0.08, 0.04, 0.05, 0],
};

// How freely each weight moves from its start: precisions of a normal prior around START_WEIGHTS. The
// intercepts move freely (people's base rates differ several-fold). A mechanics weight has a standard
// deviation of 0.2, about ×1.2 on the odds per unit of its feature, so a few observed pairs can't swing the
// estimate for every pair that shares their mechanics; many pairs can.
const ERROR_PRECISION = [0.25, 25, 25, 25, 25, 25, 25, 25, 25, 25];
const HESITATION_PRECISION = [11, 100, 100, 100, 100, 100, 100, 100, 100, 100];

const LETTER = /^[a-z]$/;
const PAIR = /^[a-z]{2}$/;

// The keyboard a run was typed on: touch and each layout are their own mechanics, never pooled.
export const keyboardOf = (conditions = {}) => `${conditions.inputClass || 'physical-keyboard'}:${normalizeLayout(conditions.layout)}`;

// How often each pair and letter turns up in running English: the 5k list, most frequent first, weighted by
// 1 / rank (Zipf), counting letters inside words only. Shares of all pairs and of all letters.
let frequencyTable = null;

export function englishFrequency() {
  if (frequencyTable) return frequencyTable;
  const pairs = new Map();
  const keys = new Map();
  let pairTotal = 0;
  let keyTotal = 0;

  wordList('5k').forEach((word, rank) => {
    const weight = 1 / (rank + 1);
    const letters = word.toLowerCase();

    for (let i = 0; i < letters.length; i += 1) {
      if (!LETTER.test(letters[i])) continue;
      keys.set(letters[i], (keys.get(letters[i]) || 0) + weight);
      keyTotal += weight;

      if (i > 0 && LETTER.test(letters[i - 1])) {
        const pair = letters.slice(i - 1, i + 1);
        pairs.set(pair, (pairs.get(pair) || 0) + weight);
        pairTotal += weight;
      }
    }
  });

  frequencyTable = {
    pairs: new Map([...pairs].map(([pair, w]) => [pair, w / pairTotal])),
    keys: new Map([...keys].map(([key, w]) => [key, w / keyTotal])),
  };

  return frequencyTable;
}

// Evidence: one record per measured run on this keyboard, from the run summaries. Which runs count is
// evidenceRun's rule (complete, uninterrupted, measured kind, fresh text); drills and adaptive runs never do.
//   { id, at: ms | null, medianMs: number | null, correction: { count, ms } | null,
//     units: [{ unit, seen, errors, timed, logRatio: number | null }] }
// A pair's timing is the log of its median clean interval over the run's median; a key has no timing.
export function learnerEvidence(runs, keyboard) {
  return runs.flatMap((run) => {
    if (!evidenceRun(run) || keyboardOf(run.conditions) !== keyboard) return [];
    const record = evidenceRecord(run);

    return record.units.length ? [record] : [];
  });
}

function evidenceRecord(run) {
  const units = [];
  let medianMs = null;

  for (const [pair, seen, errors, timed, pairMs, slowdownMs] of run.patterns || []) {
    if (!PAIR.test(pair) || !(seen >= 0)) continue;
    const runMs = pairMs !== null && slowdownMs !== null ? pairMs - slowdownMs : null;
    const logRatio = timed > 0 && runMs > 0 && pairMs > 0 ? Math.log(pairMs / runMs) : null;

    if (runMs > 0) medianMs = runMs;
    units.push({ unit: pair, seen, errors: Math.min(errors, seen), timed: logRatio === null ? 0 : timed, logRatio });
  }

  // Older summaries have no letter counts; a pair's first try is a try at its second letter.
  const keys = new Map();

  if (run.keysVersion === KEY_COUNTS_VERSION && Array.isArray(run.keys)) {
    for (const [key, seen, errors] of run.keys) if (LETTER.test(key)) keys.set(key, [seen, Math.min(errors, seen)]);
  } else {
    for (const { unit, seen, errors } of units) {
      const k = keys.get(unit[1]) || [0, 0];
      keys.set(unit[1], [k[0] + seen, k[1] + errors]);
    }
  }

  for (const [key, [seen, errors]] of keys) units.push({ unit: key, seen, errors, timed: 0, logRatio: null });
  units.sort((a, b) => compare(a.unit, b.unit));
  const [count, ms] = Array.isArray(run.corrections) ? run.corrections : [0, null];
  const at = run.at ? Date.parse(run.at) : NaN;

  return { id: String(run.id), at: Number.isFinite(at) ? at : null, medianMs, correction: count > 0 && ms > 0 ? { count, ms } : null, units };
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Oldest first, by date then id, with undated records first. A record seen twice keeps its fuller copy, and
// between equally full copies the one whose JSON sorts first, so the choice never depends on arrival order.
function orderedEvidence(evidence) {
  const byId = new Map();

  for (const record of evidence) {
    const held = byId.get(record.id);

    if (!held || record.units.length > held.units.length
      || (record.units.length === held.units.length && compare(JSON.stringify(record), JSON.stringify(held)) < 0)) byId.set(record.id, record);
  }

  return [...byId.values()].sort((a, b) => compare(a.at ?? -Infinity, b.at ?? -Infinity) || compare(a.id, b.id));
}

// Key positions on a row-staggered board, in key widths, with the finger that types each.
function keyPositions(layout) {
  const stagger = [0, 0.25, 0.75];
  const positions = new Map();

  keyboardRows(layout).slice(0, 3).forEach((row, r) => row.forEach((entry) => {
    positions.set(entry.key, { x: entry.column + stagger[r], row: r, column: entry.column, hand: entry.hand, finger: entry.finger });
  }));

  return positions;
}

const WEAK_FINGERS = new Set(['ring', 'pinky']);

function unitFeatures(unit, positions, frequency) {
  const kind = unit.length === 1 ? 'key' : 'pair';
  const b = positions.get(unit.at(-1));

  if (kind === 'key') {
    const stretch = b && (b.column === 4 || b.column === 5) ? 1 : 0;
    const row = b ? Math.abs(b.row - 1) : 0;

    return [1, 0, 0, row, Math.hypot(stretch, row), 0, frequency.z(unit), b && b.row !== 1 ? 1 : 0, b && WEAK_FINGERS.has(b.finger) ? 1 : 0, 1];
  }

  const a = positions.get(unit[0]);

  if (!a || !b) return [1, 0, 0, 0, 0, unit[0] === unit[1] ? 1 : 0, frequency.z(unit), 0, 0, 0];
  const repeated = unit[0] === unit[1];
  const sameFinger = !repeated && a.hand === b.hand && a.finger === b.finger;

  return [1, sameFinger ? 1 : 0, !repeated && !sameFinger && a.hand === b.hand ? 1 : 0, Math.abs(a.row - b.row),
    Math.hypot(a.x - b.x, a.row - b.row), repeated ? 1 : 0, frequency.z(unit), (a.row !== 1) + (b.row !== 1), WEAK_FINGERS.has(b.finger) ? 1 : 0, 0];
}

// Standardized log frequency, separately for pairs and for keys; a pair never seen in the list counts as
// half the rarest one.
function frequencyScale() {
  const table = englishFrequency();

  const scale = (map) => {
    const logs = [...map.values()].map(Math.log);
    const mean = logs.reduce((s, v) => s + v, 0) / logs.length;
    const sd = Math.sqrt(logs.reduce((s, v) => s + (v - mean) ** 2, 0) / logs.length) || 1;

    return { floor: Math.min(...map.values()) / 2, mean, sd };
  };

  const pairs = scale(table.pairs);
  const keys = scale(table.keys);

  const share = (unit) => (unit.length === 1 ? table.keys.get(unit) ?? keys.floor : table.pairs.get(unit) ?? pairs.floor);

  return {
    share,
    z: (unit) => {
      const s = unit.length === 1 ? keys : pairs;

      return (Math.log(share(unit)) - s.mean) / s.sd;
    },
  };
}

// Features less their frequency-weighted mean over units of the same kind, so an intercept is the estimate
// for a typical pair (or key) and a hesitation of 0 is the person's median pace.
function centered(units, frequency) {
  const means = new Map();

  for (const kind of [1, 2]) {
    const same = units.filter(({ unit }) => unit.length === kind);
    const total = same.reduce((s, { unit }) => s + frequency.share(unit), 0);
    means.set(kind, same[0].x.map((_, i) => (i === 0 || i === FEATURES.length - 1 ? 0
      : same.reduce((s, { unit, x }) => s + frequency.share(unit) * x[i], 0) / total)));
  }

  return units.map((u) => ({ ...u, x: u.x.map((v, i) => v - means.get(u.unit.length)[i]) }));
}

const dot = (x, w) => x.reduce((s, v, i) => s + v * w[i], 0);
const sigmoid = (v) => 1 / (1 + Math.exp(-v));

// Solves A x = b for a small symmetric positive definite A, by Gaussian elimination with partial pivoting.
function solve(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;

    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];

    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row][col] / a[col][col];

      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k];
    }
  }

  const x = new Array(n).fill(0);

  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = a[row][n];

    for (let k = row + 1; k < n; k += 1) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }

  return x;
}

// A regularized logistic fit of each unit's decayed miss rate on its features, pulled toward START_WEIGHTS.
// A unit counts at most PRIOR_TRIES (its share of a beta-binomial likelihood), so frequent pairs inform the
// mechanics without drowning the rest. Newton steps, a fixed number of them: deterministic and cheap.
function fitErrorWeights(rows) {
  const start = START_WEIGHTS.error;
  let w = [...start];

  // The penalized negative log likelihood. Each Newton step is halved until it lowers this, so a step taken
  // where the curve is nearly flat (rates near 0) can't overshoot.
  const loss = (weights) => rows.reduce((sum, { x, rate, weight }) => {
    const z = dot(x, weights);
    const softplus = Math.max(z, 0) + Math.log1p(Math.exp(-Math.abs(z)));

    return sum + weight * (softplus - rate * z);
  }, weights.reduce((sum, v, i) => sum + (ERROR_PRECISION[i] * (v - start[i]) ** 2) / 2, 0));

  for (let step = 0; step < FIT_ITERATIONS; step += 1) {
    const hessian = start.map((_, i) => start.map((__, j) => (i === j ? ERROR_PRECISION[i] : 0)));
    const gradient = start.map((s, i) => ERROR_PRECISION[i] * (w[i] - s));

    for (const { x, rate, weight } of rows) {
      const p = sigmoid(dot(x, w));
      const curve = weight * p * (1 - p);

      for (let i = 0; i < x.length; i += 1) {
        gradient[i] += weight * (p - rate) * x[i];

        for (let j = 0; j < x.length; j += 1) hessian[i][j] += curve * x[i] * x[j];
      }
    }

    const delta = solve(hessian, gradient);
    const current = loss(w);
    let scale = 1;

    for (let halving = 0; halving < 20 && !(loss(w.map((v, i) => v - scale * delta[i])) <= current); halving += 1) scale /= 2;
    w = w.map((v, i) => v - scale * delta[i]);
  }

  return w;
}

// Ridge regression of each pair's decayed log ratio on its features, toward START_WEIGHTS, each pair weighted
// by the precision of its mean plus the spread pairs have around what their mechanics predict.
function fitHesitationWeights(rows) {
  const start = START_WEIGHTS.hesitation;
  const matrix = start.map((_, i) => start.map((__, j) => (i === j ? HESITATION_PRECISION[i] : 0)));
  const vector = start.map((s, i) => HESITATION_PRECISION[i] * s);

  for (const { x, mean, precision } of rows) {
    const weight = 1 / (UNIT_SPREAD ** 2 + 1 / precision);

    for (let i = 0; i < x.length; i += 1) {
      vector[i] += weight * mean * x[i];

      for (let j = 0; j < x.length; j += 1) matrix[i][j] += weight * x[i] * x[j];
    }
  }

  return solve(matrix, vector);
}

// The model: a fold over evidence records at time `now` (ms) on one layout.
//   { policy, runs, medianMs, costMs, errorRate, weights: { error, hesitation }, units: Estimate[] }
//   Estimate = { unit, kind: 'pair' | 'key', frequency, gain, error: { mean, sd },
//     hesitation: { mean, sd } | null, observed: { seen, errors, runs, errorRuns, timed, timedRuns, slowRuns },
//     own?: { seen, errors } (keys: the observations naming reads, see stated) }
// units is ranked by gain, highest first: the queue. `observed` holds raw, undecayed counts, the only
// numbers a person is shown.
export function fitLearner(evidence, now, layout, variant = FULL_MODEL) {
  const { features, decay, hesitation: hesitates, halfLifeRuns, pooledTries } = { ...FULL_MODEL, ...variant };
  const records = orderedEvidence(evidence);
  const positions = keyPositions(normalizeLayout(layout));
  const frequency = frequencyScale();
  const table = englishFrequency();
  const tally = new Map();
  let paceWeight = 0;
  let paceLog = 0;
  let correctionWeight = 0;
  let correctionLog = 0;

  records.forEach((record, index) => {
    const age = record.at === null ? 0 : Math.max(0, now - record.at) / DAY_MS;
    const w = decay ? 0.5 ** ((records.length - 1 - index) / halfLifeRuns) * 0.5 ** (age / HALF_LIFE_DAYS) : 1;

    if (record.medianMs > 0) {
      paceWeight += w;
      paceLog += w * Math.log(record.medianMs);
    }

    if (record.correction) {
      correctionWeight += w * record.correction.count;
      correctionLog += w * record.correction.count * Math.log(record.correction.ms);
    }

    for (const { unit, seen, errors, timed, logRatio } of record.units) {
      const t = tally.get(unit) || { seen: 0, errors: 0, runs: 0, errorRuns: 0, timed: 0, timedRuns: 0, slowRuns: 0, n: 0, e: 0, precision: 0, timing: 0 };
      t.seen += seen;
      t.errors += errors;
      t.runs += 1;
      t.n += w * seen;
      t.e += w * errors;

      if (errors) t.errorRuns += 1;

      if (logRatio !== null) {
        t.timed += timed;
        t.timedRuns += 1;
        const precision = (w * timed) / (MEDIAN_VARIANCE * INTERVAL_SPREAD ** 2);
        t.precision += precision;
        t.timing += precision * logRatio;

        if (logRatio > 0) t.slowRuns += 1;
      }

      tally.set(unit, t);
    }
  });

  // A key's own evidence: its tries and misses outside the pairs ending in it that can be named themselves
  // (stated). A miss inside "th" is th's, so "h" ranks and is named only on misses elsewhere.
  for (const [unit, t] of tally) {
    if (unit.length === 1) t.own = { seen: t.seen, errors: t.errors, n: t.n, e: t.e };
  }

  for (const [unit, t] of tally) {
    const key = tally.get(unit[1]);

    if (unit.length !== 2 || !key || !stated({ observed: t })) continue;
    key.own.seen = Math.max(0, key.own.seen - t.seen);
    key.own.errors = Math.max(0, Math.min(key.own.seen, key.own.errors - t.errors));
    key.own.n = Math.max(0, key.own.n - t.n);
    key.own.e = Math.max(0, Math.min(key.own.n, key.own.e - t.e));
  }

  const names = [...new Set([...table.pairs.keys(), ...table.keys.keys(), ...tally.keys()])].sort(compare);
  const units = centered(names.map((unit) => ({ unit, x: unitFeatures(unit, positions, frequency), t: tally.get(unit) || null })), frequency);

  const own = (t) => t?.own || t || { n: 0, e: 0 };

  const errorWeights = features ? fitErrorWeights(units.flatMap(({ x, t }) => {
    const { n, e } = own(t);

    return n > 0 ? [{ x, rate: e / n, weight: (n * PRIOR_TRIES) / (n + PRIOR_TRIES) }] : [];
  })) : null;

  // Without the regression, each kind's prior is the person's pooled rate over that kind (the hand-set
  // intercept before any evidence).
  const pooled = new Map([1, 2].map((kind) => {
    const counted = units.filter(({ unit }) => unit.length === kind).map(({ t }) => own(t));
    const n = counted.reduce((sum, c) => sum + c.n, 0);

    return [kind, n > 0 ? counted.reduce((sum, c) => sum + c.e, 0) / n : sigmoid(START_WEIGHTS.error[0])];
  }));

  const hesitationWeights = hesitates ? fitHesitationWeights(units.flatMap(({ unit, x, t }) => (unit.length === 2 && t?.precision > 0
    ? [{ x, mean: t.timing / t.precision, precision: t.precision }] : []))) : null;

  const medianMs = paceWeight ? Math.exp(paceLog / paceWeight) : null;
  const intervalMs = medianMs ?? DEFAULT_INTERVAL_MS;
  const correctionMs = correctionWeight ? Math.exp(correctionLog / correctionWeight) : null;
  // A wrong first try costs at least the wrong keystroke, so a correction never prices below one clean interval.
  const costMs = correctionMs === null ? DEFAULT_EXTRA_KEYS * intervalMs : Math.max(intervalMs, correctionMs - intervalMs);

  const estimates = units.map(({ unit, x, t }) => {
    const prior = features ? sigmoid(dot(x, errorWeights)) : pooled.get(unit.length);
    const tries = features ? PRIOR_TRIES : pooledTries;
    const { n, e } = own(t);
    const a = tries * prior + e;
    const b = tries * (1 - prior) + n - e;
    const mean = a / (a + b);
    const error = { mean, sd: Math.sqrt((mean * (1 - mean)) / (a + b + 1)) };
    let hesitation = null;

    if (hesitates && unit.length === 2) {
      const priorPrecision = 1 / UNIT_SPREAD ** 2;
      const precision = priorPrecision + (t?.precision || 0);
      hesitation = { mean: (priorPrecision * dot(x, hesitationWeights) + (t?.timing || 0)) / precision, sd: Math.sqrt(1 / precision) };
    }

    const observed = t ? { seen: t.seen, errors: t.errors, runs: t.runs, errorRuns: t.errorRuns, timed: t.timed, timedRuns: t.timedRuns, slowRuns: t.slowRuns }
      : { seen: 0, errors: 0, runs: 0, errorRuns: 0, timed: 0, timedRuns: 0, slowRuns: 0 };

    const estimate = { unit, kind: unit.length === 1 ? 'key' : 'pair', frequency: frequency.share(unit), error, hesitation, observed };

    if (unit.length === 1) estimate.own = t ? { seen: t.own.seen, errors: t.own.errors } : { seen: 0, errors: 0 };

    return estimate;
  });

  // The person's typical pair: the frequency-weighted mean of the pairs' error estimates. Practice can bring a
  // weak unit toward it, so the gain counts errors above it.
  const pairs = estimates.filter((e) => e.kind === 'pair');
  const errorRate = pairs.reduce((s, e) => s + e.frequency * e.error.mean, 0) / pairs.reduce((s, e) => s + e.frequency, 0);

  for (const e of estimates) {
    const missed = Math.max(0, e.error.mean - UNCERTAINTY_Z * e.error.sd - errorRate) * costMs;
    const slow = e.hesitation ? intervalMs * Math.max(0, Math.exp(e.hesitation.mean - UNCERTAINTY_Z * e.hesitation.sd) - 1) : 0;
    e.gain = e.frequency * (missed + slow);
  }

  estimates.sort((a, b) => b.gain - a.gain || compare(a.unit, b.unit));

  return { policy: LEARNER_POLICY, runs: records.length, medianMs, costMs, errorRate, weights: { error: errorWeights, hesitation: hesitationWeights }, units: estimates };
}

// The one rule for naming a unit (ADR 0013): its own observations must say so. That is at least the floor
// of first tries, and either a first-try error or the floor of clean intervals with the pair slower than that
// run's median in most of the runs that timed it. Intervals pool across runs: a 25-word run rarely holds ten
// of one pair. A key's own observations are those outside the pairs ending in it that pass this rule
// themselves (`own`), so a key is named only when it is missed beyond its named pairs. Keys have no timing.
export function stated({ observed, own = observed }) {
  return own.seen >= MIN_PATTERN_SAMPLES
    && (own.errors > 0 || (own.timed >= MIN_PATTERN_SAMPLES && own.slowRuns * 2 > own.timedRuns));
}

const errorCount = ({ errors, seen }) => `${errors} first-try ${errors === 1 ? 'error' : 'errors'} in ${seen} ${seen === 1 ? 'try' : 'tries'}`;

// What Train, the results card and adaptive text act on. The top unit is named only when its observations
// can be stated; otherwise it is a general drill that says so, whose text still leans toward the units the
// model ranks highest (`lean`). `was` carries the observed counts the comparison later reads back. `queue`
// is every unit that can be named, best first, each with its counts; `runs` is the evidence runs behind it.
//   { kind: 'targeted' | 'general', target, title, reason, was, lean: [{ unit, weight }],
//     queue: [{ unit, was }], runs, policy }
const wasOf = ({ observed }) => ({ errors: observed.errors, observations: observed.seen, runs: observed.runs, slowRuns: observed.slowRuns });

export function learnerRecommendation(model) {
  const ranked = model.units.filter((e) => e.gain > 0);
  const lean = ranked.slice(0, LEAN_UNITS).map((e) => ({ unit: e.unit, weight: e.gain }));
  const queue = ranked.filter(stated).map((e) => ({ unit: e.unit, was: wasOf(e) }));
  const top = ranked[0];
  const common = { lean, queue, runs: model.runs, policy: model.policy };

  if (top && stated(top)) {
    const { observed } = top;

    return { kind: 'targeted', target: top.unit, title: `Practice “${top.unit}”`, reason: `“${top.unit}”: ${errorCount(observed)} over ${observed.runs} ${observed.runs === 1 ? 'run' : 'runs'}.`,
      was: wasOf(top), ...common };
  }

  const missed = ranked.find((e) => e.observed.errors > 0);

  return { kind: 'general', target: null, title: 'General drill',
    reason: missed ? `Too little data to target a pattern yet (“${missed.unit}”: ${errorCount(missed.observed)}).` : 'Not enough clean data to name a weakness yet.',
    was: null, ...common };
}

// The baseline policy, the counting rule this replaced: the recurring pair with the highest first-try error
// rate across recent matching runs (10 tries, errors or slowness in two runs), else the newest traces' target,
// else a general drill.
export function countingRecommendation(runs, loops, traces, source) {
  const recommendation = recommendTarget(traces, source);
  const recurring = recurringTargets(runs, loops, source)[0];

  if (!recurring) {
    const pattern = recommendation.target && recommendation.evidence.pairs.find((item) => item.pair === recommendation.target);
    const was = pattern ? { errors: pattern.errors, observations: pattern.observations, runs: recommendation.evidence.attemptCount } : null;

    return { ...recommendation, was, lean: recommendation.target ? [{ unit: recommendation.target, weight: 1 }] : [], queue: [],
      runs: recommendation.evidence.attemptCount, policy: BASELINE_POLICY };
  }

  const targets = recurringTargets(runs, loops, source);

  return { ...recommendation, kind: 'targeted', target: recurring.pair, was: countingEvidence(runs, loops, recurring.pair, source),
    title: `${recurring.review ? 'Revisit' : 'Practice'} “${recurring.pair}”`,
    lean: targets.slice(0, LEAN_UNITS).map((target) => ({ unit: target.pair, weight: 1 })),
    queue: targets.map((target) => ({ unit: target.pair, was: countingEvidence(runs, loops, target.pair, source) })), runs: recurring.runs, policy: BASELINE_POLICY };
}

// A recurring pair's counts, as the counting rule shows them and the comparison reads them back.
export function countingEvidence(runs, loops, pair, source) {
  const recurring = recurringTargets(runs, loops, source).find((item) => item.pair === pair);

  return recurring ? { errors: recurring.errors, observations: recurring.observations, runs: recurring.runs, slowRuns: recurring.slowRuns } : null;
}

// The recommendation for `source` conditions under a policy. The learner reads every measured run on the
// keyboard `source` is typed on; the counting rule reads only runs at its exact conditions.
export function recommendFor(policy, { runs, loops, traces, source, now }) {
  if (policy === BASELINE_POLICY) return countingRecommendation(runs, loops, traces, source);

  return learnerRecommendation(fitLearner(learnerEvidence(runs, keyboardOf(source)), now, source?.layout));
}


// The learning core (ADR 0013): a per-person estimate of how often each letter pair and key is missed on the
// first try and how much slower than the person's pace each pair is typed, from the run summaries the profile
// already keeps, ranked by the time practice could save. It is a pure fold over evidence records: no DOM, no
// storage, no clock (callers pass `now`), no randomness. The same set of records gives the same model in any
// order, so two devices that merge their history agree (ADR 0005), and nothing in it needs a keystroke
// recording (ADR 0006).
//
// The model ranks. What a person reads is observed evidence: real counts and real run counts.

import { normalizeLayout } from './layouts.js';
import { wordList } from './words.js';
import { KEY_COUNTS_VERSION, MIN_PATTERN_SAMPLES, evidenceRun, recurringTargets } from './insights.js';
import { recommendTarget } from './typing.js';

export const LEARNER_POLICY = 'learner@1';
export const DECAY_POLICY = 'learner-decay@1';
export const TIMING_POLICY = 'learner-timing@1';
export const DECAY_TIMING_POLICY = 'learner-decay-timing@1';
export const BASELINE_POLICY = 'counting@1';

// The policy that picks targets, by ADR 0013's rule v2 on thirty test seeds of simulated typists
// (`npm run evaluate:learner`): counts-gain with decay and the timing term. Timing is in because it was really
// worse on nothing it must not lose (it was also really better on captured time lost). Decay is in because it
// really let go of fixed pairs and picked up slipping ones sooner, and was really worse on nothing it must not
// lose. It replaced counting@1 because it was not really worse on captured time lost. It is provisional until
// a learning study can run, and says nothing about learning.
export const DEFAULT_POLICY = DECAY_TIMING_POLICY;

// A unit's prior is the person's pooled rate over its kind, worth this many first tries. Chosen from
// {2, 5, 10, 20, 40, 80} by next-run log loss on validation typists (ADR 0013).
export const POOLED_TRIES = 40;

// The decay variants only: evidence halves every 60 runs (chosen from {10, 15, 20, 30, 60} by log loss on
// validation typists) and every 60 days (untested).
export const HALF_LIFE_RUNS = 60;
export const HALF_LIFE_DAYS = 60;

// The timing variants only: a pair's slowdown pools across runs and shrinks toward none as if this many clean
// intervals at the person's pace stood beside it. Chosen from {5, 10, 20, 40, 80} by next-run timing error on
// validation typists.
export const TIMING_TRIES = 5;

// A miss costs about two clean intervals (a wrong key, then the right one), so slowness counts in misses at this
// many intervals each. Not fitted (ADR 0013).
const MISS_INTERVALS = 2;

// The learner's policies, one line each: with or without decay (old runs fade) and the timing term (slow pairs
// rank on the time they lose). ADR 0013 keeps the three the default does not use as named variants.
const constants = { halfLifeRuns: HALF_LIFE_RUNS, pooledTries: POOLED_TRIES, timingTries: TIMING_TRIES };

export const LEARNER_VARIANTS = {
  [LEARNER_POLICY]: { policy: LEARNER_POLICY, decay: false, timing: false, ...constants },
  [DECAY_POLICY]: { policy: DECAY_POLICY, decay: true, timing: false, ...constants },
  [TIMING_POLICY]: { policy: TIMING_POLICY, decay: false, timing: true, ...constants },
  [DECAY_TIMING_POLICY]: { policy: DECAY_TIMING_POLICY, decay: true, timing: true, ...constants },
};

// Before any evidence, a first try is taken to miss this often (about 3%), the rate the evaluation ran with.
// It ranks nothing: every unit starts level.
const FIRST_RATE = 1 / (1 + Math.exp(3.4));

// Gains are computed half a standard deviation below each posterior mean, so thin evidence ranks lower.
const UNCERTAINTY_Z = 0.5;

// Adaptive and leaning drill text draw on this many of the top units.
export const LEAN_UNITS = 4;

const DAY_MS = 86_400_000;

// A run typed faster than this per key (400 wpm) is not timed: no person keeps that pace, and the clock's
// millisecond steps would swamp a pair's slowdown.
const MIN_PACE_MS = 30;
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
//   { id, at: ms | null, units: [{ unit, seen, errors, timed, slow: boolean | null, ratio: number | null, slowMs: number | null }] }
// A pair's `slow` says whether its median clean interval was slower than the run's median, `ratio` is the log of
// one over the other and `slowMs` the difference (all null: untimed).
export function learnerEvidence(runs, keyboard) {
  return runs.flatMap((run) => {
    if (!evidenceRun(run) || keyboardOf(run.conditions) !== keyboard) return [];
    const record = evidenceRecord(run);

    return record.units.length ? [record] : [];
  });
}

function evidenceRecord(run) {
  const units = [];

  for (const [pair, seen, errors, timed, pairMs, slowdownMs] of run.patterns || []) {
    if (!PAIR.test(pair) || !(seen >= 0)) continue;
    const runMs = pairMs !== null && slowdownMs !== null ? pairMs - slowdownMs : null;
    const measured = timed > 0 && runMs >= MIN_PACE_MS && pairMs > 0;
    units.push({ unit: pair, seen, errors: Math.min(errors, seen), timed: measured ? timed : 0, slow: measured ? pairMs > runMs : null,
      ratio: measured ? Math.log(pairMs / runMs) : null, slowMs: measured ? pairMs - runMs : null });
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

  for (const [key, [seen, errors]] of keys) units.push({ unit: key, seen, errors, timed: 0, slow: null, ratio: null, slowMs: null });
  units.sort((a, b) => compare(a.unit, b.unit));
  const at = run.at ? Date.parse(run.at) : NaN;

  return { id: String(run.id), at: Number.isFinite(at) ? at : null, units };
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

// The model: a fold over evidence records at time `now` (ms), under one of LEARNER_VARIANTS (the evaluation
// also passes its own pooledTries and halfLifeRuns).
//   { policy, runs, errorRate, units: Estimate[] }
//   Estimate = { unit, kind: 'pair' | 'key', frequency, gain, basis: 'errors' | 'slow', error: { mean, sd },
//     slowdown: number | null (timing variants, pairs: the pooled log ratio to the person's pace),
//     observed: { seen, errors, runs, errorRuns, timed, timedRuns, slowRuns, slowMs },
//     own?: { seen, errors } (keys: the observations naming reads, see stated) }
// units is ranked by gain, highest first, and `basis` says which part of the gain is larger. `observed` holds
// raw, undecayed counts, the only numbers a person is shown; `slowMs` is the mean of the runs' slowdowns over
// the person's pace, weighted by clean intervals.
export function fitLearner(evidence, now, variant = LEARNER_VARIANTS[DEFAULT_POLICY]) {
  const { policy, decay, timing, halfLifeRuns, pooledTries, timingTries } = { ...LEARNER_VARIANTS[DEFAULT_POLICY], ...variant };
  const records = orderedEvidence(evidence);
  const table = englishFrequency();
  const tally = new Map();

  records.forEach((record, index) => {
    const age = record.at === null ? 0 : Math.max(0, now - record.at) / DAY_MS;
    const w = decay ? 0.5 ** ((records.length - 1 - index) / halfLifeRuns) * 0.5 ** (age / HALF_LIFE_DAYS) : 1;

    for (const { unit, seen, errors, timed, slow, ratio, slowMs } of record.units) {
      const t = tally.get(unit) || { seen: 0, errors: 0, runs: 0, errorRuns: 0, timed: 0, timedRuns: 0, slowRuns: 0, slowMs: 0, n: 0, e: 0, tn: 0, tr: 0 };
      t.seen += seen;
      t.errors += errors;
      t.runs += 1;
      t.n += w * seen;
      t.e += w * errors;

      if (errors) t.errorRuns += 1;

      if (slow !== null) {
        t.timed += timed;
        t.timedRuns += 1;
        t.slowMs += timed * slowMs;
        t.tn += w * timed;
        t.tr += w * timed * ratio;

        if (slow) t.slowRuns += 1;
      }

      tally.set(unit, t);
    }
  });

  // A key's own evidence: its tries and misses outside the pairs ending in it that can be named themselves
  // (stated). A miss inside "th" is th's, so "h" ranks only on misses elsewhere. `worst` is the most misses in
  // any one other pair ending in the key, which naming also leaves out (see stated).
  for (const [unit, t] of tally) {
    if (unit.length === 1) t.own = { seen: t.seen, errors: t.errors, n: t.n, e: t.e, worst: 0 };
  }

  for (const [unit, t] of tally) {
    const key = tally.get(unit[1]);

    if (unit.length !== 2 || !key) continue;

    if (!stated({ observed: t })) {
      key.own.worst = Math.max(key.own.worst, t.errors);
      continue;
    }

    key.own.seen = Math.max(0, key.own.seen - t.seen);
    key.own.errors = Math.max(0, Math.min(key.own.seen, key.own.errors - t.errors));
    key.own.n = Math.max(0, key.own.n - t.n);
    key.own.e = Math.max(0, Math.min(key.own.n, key.own.e - t.e));
  }

  const own = (t) => t?.own || t || { n: 0, e: 0 };
  // A pair or key never seen in the list counts as half the rarest one.
  const floor = (map) => Math.min(...map.values()) / 2;
  const shares = new Map([[1, [table.keys, floor(table.keys)]], [2, [table.pairs, floor(table.pairs)]]]);
  const names = [...new Set([...table.pairs.keys(), ...table.keys.keys(), ...tally.keys()])].sort(compare);

  // Each kind's prior: the person's pooled rate over its pairs, or over its keys' own tries.
  const pooled = new Map([1, 2].map((kind) => {
    const counted = names.filter((unit) => unit.length === kind).map((unit) => own(tally.get(unit)));
    const n = counted.reduce((sum, c) => sum + c.n, 0);

    return [kind, n > 0 ? counted.reduce((sum, c) => sum + c.e, 0) / n : FIRST_RATE];
  }));

  const estimates = names.map((unit) => {
    const t = tally.get(unit);
    const { n, e } = own(t);
    const a = pooledTries * pooled.get(unit.length) + e;
    const b = pooledTries * (1 - pooled.get(unit.length)) + n - e;
    const mean = a / (a + b);
    const [map, rarest] = shares.get(unit.length);

    const observed = t ? { seen: t.seen, errors: t.errors, runs: t.runs, errorRuns: t.errorRuns, timed: t.timed, timedRuns: t.timedRuns, slowRuns: t.slowRuns,
      slowMs: t.timed ? t.slowMs / t.timed : null } : { seen: 0, errors: 0, runs: 0, errorRuns: 0, timed: 0, timedRuns: 0, slowRuns: 0, slowMs: null };

    const slowdown = timing && unit.length === 2 ? (t?.tr || 0) / ((t?.tn || 0) + timingTries) : null;

    const estimate = { unit, kind: unit.length === 1 ? 'key' : 'pair', frequency: map.get(unit) ?? rarest, error: { mean, sd: Math.sqrt((mean * (1 - mean)) / (a + b + 1)) },
      slowdown, observed };

    if (unit.length === 1) estimate.own = t ? { seen: t.own.seen, errors: Math.max(0, t.own.errors - t.own.worst) } : { seen: 0, errors: 0 };

    return estimate;
  });

  // The person's typical pair: the frequency-weighted mean of the pairs' estimates. Practice can bring a weak
  // unit toward it, so the gain is the misses above it a unit costs per letter typed. The timing variants add
  // the time a slow pair loses over the person's pace, counted in misses.
  const pairs = estimates.filter((e) => e.kind === 'pair');
  const errorRate = pairs.reduce((s, e) => s + e.frequency * e.error.mean, 0) / pairs.reduce((s, e) => s + e.frequency, 0);

  for (const e of estimates) {
    const missed = Math.max(0, e.error.mean - UNCERTAINTY_Z * e.error.sd - errorRate);
    const slow = e.slowdown === null ? 0 : Math.max(0, Math.exp(e.slowdown) - 1) / MISS_INTERVALS;
    e.gain = e.frequency * (missed + slow);
    e.basis = slow > missed ? 'slow' : 'errors';
  }

  estimates.sort((a, b) => b.gain - a.gain || compare(a.unit, b.unit));

  return { policy, runs: records.length, errorRate, units: estimates };
}

// The one rule for naming a unit (ADR 0013): its own observations must say so. That is at least the floor
// of first tries, and either a first-try error or the floor of clean intervals with the pair slower than that
// run's median in most of the runs that timed it. A key's own observations (`own`) are its tries outside the
// pairs ending in it that pass this rule themselves, and its misses outside those and outside its most-missed
// other pair. So a key is named only when it is missed beyond any one pair: misses that all sit in "th" are
// th's, whether "th" has the tries to be named yet or not. Keys have no timing.
export function stated({ observed, own = observed }) {
  return own.seen >= MIN_PATTERN_SAMPLES && (own.errors > 0 || slowStated(own));
}

// A pair ranked on its slowness is named only on its observed timing: the floor of clean intervals, pooled
// across runs, and slower than the run's median in most of the runs that timed it.
const slowStated = ({ timed = 0, slowRuns = 0, timedRuns = 0 }) => timed >= MIN_PATTERN_SAMPLES && slowRuns * 2 > timedRuns;

const nameable = (e) => (e.basis === 'slow' ? slowStated(e.observed) : stated(e));

const errorCount = ({ errors, seen }) => `${errors} first-try ${errors === 1 ? 'error' : 'errors'} in ${seen} ${seen === 1 ? 'try' : 'tries'}`;

// "45 ms slower than your pace, in 4 of 5 runs that timed it (31 clean intervals)": observed timing only.
export const paceCopy = ({ slowMs, slowRuns, timedRuns, timed }) => `${Math.round(slowMs)} ms slower than your pace, in ${slowRuns} of ${timedRuns} ${timedRuns === 1 ? 'run' : 'runs'} that timed it (${timed} clean ${timed === 1 ? 'interval' : 'intervals'})`;

// What Train, the results card and adaptive text act on. The top unit is named only when its observations
// can be stated; otherwise it is a general drill that says so, whose text still leans toward the units the
// model ranks highest (`lean`). `was` carries the observed counts the comparison later reads back, and for a
// pair ranked on slowness its observed timing. `queue` is every unit that can be named, best first, each with
// its counts; `runs` is the evidence runs behind it.
//   { kind: 'targeted' | 'general', target, title, reason, was, lean: [{ unit, weight }],
//     queue: [{ unit, was }], runs, policy }
function wasOf({ observed, basis }) {
  const was = { errors: observed.errors, observations: observed.seen, runs: observed.runs, slowRuns: observed.slowRuns };

  if (basis === 'slow') Object.assign(was, { basis, slowMs: observed.slowMs, timed: observed.timed, timedRuns: observed.timedRuns });

  return was;
}

export function learnerRecommendation(model) {
  const ranked = model.units.filter((e) => e.gain > 0);
  const lean = ranked.slice(0, LEAN_UNITS).map((e) => ({ unit: e.unit, weight: e.gain }));
  const queue = ranked.filter(nameable).map((e) => ({ unit: e.unit, was: wasOf(e) }));
  const top = ranked[0];
  const common = { lean, queue, runs: model.runs, policy: model.policy };

  if (top && nameable(top)) {
    const { observed } = top;

    const reason = top.basis === 'slow' ? `“${top.unit}”: ${paceCopy(observed)}.`
      : `“${top.unit}”: ${errorCount(observed)} over ${observed.runs} ${observed.runs === 1 ? 'run' : 'runs'}.`;

    return { kind: 'targeted', target: top.unit, title: `Practice “${top.unit}”`, reason, was: wasOf(top), ...common };
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

  return learnerRecommendation(fitLearner(learnerEvidence(runs, keyboardOf(source)), now, LEARNER_VARIANTS[policy]));
}


export const SLOW_FLOOR_MS = 20;

export function paceShift(ms) {
  const rounded = Math.round(ms);

  return rounded > 0 ? `${rounded} ms slower` : rounded < 0 ? `${-rounded} ms faster` : 'at your pace';
}

export const paceAgainst = (ms) => (Math.round(ms) ? `${paceShift(ms)} than your pace` : 'at your pace');

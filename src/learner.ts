import { at as indexed, entry } from './domain-values.js';
import type { Attempt, Conditions, WeightedUnit } from './typing.js';
import type { RunRecord, TrainingLoop, TargetCounts } from './profile-types.js';

export type Basis = 'errors' | 'slow';

export interface EvidenceUnit { unit: string; seen: number; errors: number; timed: number; slow: boolean | null; ratio: number | null; slowMs: number | null }

export interface LearnerEvidence { id: string; at: number | null; correction: { count: number; ratio: number } | null; units: EvidenceUnit[] }

interface Frequency { pairs: Map<string, number>; keys: Map<string, number> }

interface OwnTally { seen: number; errors: number; n: number; e: number; worst: number }

interface Tally { seen: number; errors: number; runs: number; errorRuns: number; timed: number; timedRuns: number; slowRuns: number; slowMs: number; n: number; e: number; tn: number; tr: number; own?: OwnTally }

export interface Observed { seen: number; errors: number; runs: number; errorRuns: number; timed: number; timedRuns: number; slowRuns: number; slowMs: number | null }

export interface Estimate { unit: string; kind: 'key' | 'pair'; frequency: number; error: { mean: number; sd: number }; slowdown: number | null; observed: Observed; own?: { seen: number; errors: number }; letGo?: Basis[]; gain: number; basis: Basis }

export interface LearnerModel { policy: string; focus: string; runs: number; errorRate: number; missCost: number; units: Estimate[] }

export interface TargetEvidence extends TargetCounts { runs?: number; slowRuns?: number; basis?: Basis; slowMs?: number | null; timed?: number; timedRuns?: number }

export interface Recommendation { kind: string; target: string | null; title: string; reason: string; was: TargetEvidence | null; lean: WeightedUnit[]; queue: { unit: string; was: TargetEvidence | null }[]; runs: number; policy: string; focus?: string }

interface ReleaseRow { at: number; seen: number; errors: number; timed: number; slow: boolean | null }

export interface ReleaseIndex { typical: number; dates: Map<string, number | null>; rows: Map<string, ReleaseRow[]> }
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
export const OWN_COST_POLICY = 'learner-own-cost@2';
export const LET_GO_POLICY = 'learner-let-go@2';
export const LET_GO_MISSES_POLICY = 'learner-let-go-misses@2';
export const BASELINE_POLICY = 'counting@1';

// The policy that picks targets (ADR 0013): counts-gain with decay and the timing term, a miss priced at two
// intervals. Timing is in by product call, not by evidence: it passed rule v2's guards only because the simulator
// types its missed pairs slowly too, and with them at the typist's pace it pushes missed pairs out of the top
// four and fails them. Decay is in by rule v2 on thirty test seeds of simulated typists (`npm run
// evaluate:learner`) whose miss costs 2 intervals on average: it let go of fixed pairs and picked up slipping
// ones sooner, and was really worse on nothing it must not lose. At a miss cost of 8 intervals it was really
// worse on captured gain at 10 runs, by 0.3 points, and rule v2 would leave it out. It replaced counting@1
// because it was not really worse on captured time lost. ADR 0015 kept it on typists whose miss costs 1 to 8
// intervals: the person's own measured miss cost (OWN_COST_POLICY) and a 20-run half-life were each really
// worse on a guard. ADR 0019 kept it again: letting a drilled target go on the evidence since its drill
// (LET_GO_POLICY) harmed nothing, but on simulated seasons took a median of 100 runs at 25 words to let a fixed target
// go, and let 2.3% of still-weak targets go. It is provisional until a learning study can run, and says nothing
// about learning.
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
// many intervals each. Not fitted (ADR 0013). The own-cost variant uses it until it has measured enough of the
// person's own corrections.
export const MISS_INTERVALS = 2;

// The own-cost variant only: the person's corrections are their cost of a miss once this many are timed. Chosen
// from {1, 5, 10, 20, 40, 80} by cost error on validation typists, where 1, 5 and 10 tied (ADR 0015).
export const COST_CORRECTIONS = 1;

// Letting go of a drilled target (ADR 0019). Since its drill, a walk adds each run's log likelihood ratio between
// "fixed" and "still weak" and lets go once it reaches ln LET_GO_ODDS, so a target still weak is let go by luck
// about once in LET_GO_ODDS over its whole future, however many runs are read. Fixed by that ceiling, not tuned.
// For misses, "fixed" is the person's typical miss rate and "still weak" WEAK_RATIO times it. For pace, whose
// spread is not recorded, the walk reads only whether each run had the pair slower than the person's pace:
// "fixed" is slower in half the runs, "still slow" in SLOW_SHARE of them. Once let go, a target comes back when a
// second walk, of the opposite ratio and never below zero, reaches ln RETURN_ODDS. The three were chosen on
// validation typists (ADR 0019).
export const LET_GO_ODDS = 100;
export const WEAK_RATIO = 3;
export const SLOW_SHARE = 0.75;
export const RETURN_ODDS = 100_000;

// A let-go claim needs at least this much evidence since the drill, of the kind drilled: the floors of Train's "fixed"
// (FIXED_RUNS and FIXED_OBSERVATIONS in train-path.js, which a test holds equal).
export const FIXED_RUNS = 2;
export const FIXED_OBSERVATIONS = 2 * MIN_PATTERN_SAMPLES;

// Below one miss in a hundred, the walk takes the typical rate to be this, so a very careful typist's "still weak"
// stays a rate a few runs can tell apart.
const TYPICAL_FLOOR = 0.01;

// The learner's policies, one line each: with or without decay (old runs fade), the timing term (slow pairs
// rank on the time they lose), the person's own cost of a miss, and letting go of drilled targets on the evidence
// since their drill (both kinds, or misses only). ADRs 0013, 0015 and 0019 keep the variants the default does not use
// as named variants.
const constants = { halfLifeRuns: HALF_LIFE_RUNS, pooledTries: POOLED_TRIES, timingTries: TIMING_TRIES, costCorrections: COST_CORRECTIONS };
export const LET_GO = { letGoOdds: LET_GO_ODDS, weakRatio: WEAK_RATIO, slowShare: SLOW_SHARE, returnOdds: RETURN_ODDS };

export type LearnerVariant = typeof constants & { policy: string; decay: boolean; timing: boolean; ownCost: boolean; letGo?: Basis[] } & Partial<typeof LET_GO>;

interface LearnerVariants { [policy: string]: LearnerVariant; [DECAY_TIMING_POLICY]: LearnerVariant }

export const LEARNER_VARIANTS: LearnerVariants = {
  [LEARNER_POLICY]: { policy: LEARNER_POLICY, decay: false, timing: false, ownCost: false, ...constants },
  [DECAY_POLICY]: { policy: DECAY_POLICY, decay: true, timing: false, ownCost: false, ...constants },
  [TIMING_POLICY]: { policy: TIMING_POLICY, decay: false, timing: true, ownCost: false, ...constants },
  [DECAY_TIMING_POLICY]: { policy: DECAY_TIMING_POLICY, decay: true, timing: true, ownCost: false, ...constants },
  [OWN_COST_POLICY]: { policy: OWN_COST_POLICY, decay: true, timing: true, ownCost: true, ...constants },
  [LET_GO_POLICY]: { policy: LET_GO_POLICY, decay: true, timing: true, ownCost: false, letGo: ['errors', 'slow'], ...constants, ...LET_GO },
  [LET_GO_MISSES_POLICY]: { policy: LET_GO_MISSES_POLICY, decay: true, timing: true, ownCost: false, letGo: ['errors'], ...constants, ...LET_GO },
};

// How a person trains (a preference, never a test condition): balanced ranks by all the time a unit loses,
// accuracy by the time lost to first-try misses only, speed by slowness only. They are views of one model.
export const FOCUSES = ['balanced', 'accuracy', 'speed'];
export const DEFAULT_FOCUS = 'balanced';

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
export const keyboardOf = (conditions: Conditions = {}) => `${conditions.inputClass || 'physical-keyboard'}:${normalizeLayout(conditions.layout)}`;

// How often each pair and letter turns up in running English: the 5k list, most frequent first, weighted by
// 1 / rank (Zipf), counting letters inside words only. Shares of all pairs and of all letters.
let frequencyTable: Frequency | null = null;

export function englishFrequency() {
  if (frequencyTable) return frequencyTable;
  const pairs = new Map<string, number>();
  const keys = new Map<string, number>();
  let pairTotal = 0;
  let keyTotal = 0;

  wordList('5k').forEach((word, rank) => {
    const weight = 1 / (rank + 1);
    const letters = word.toLowerCase();

    for (let i = 0; i < letters.length; i += 1) {
      if (!LETTER.test(letters.charAt(i))) continue;
      keys.set(letters.charAt(i), (keys.get(letters.charAt(i)) || 0) + weight);
      keyTotal += weight;

      if (i > 0 && LETTER.test(letters.charAt(i - 1))) {
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
//   { id, at: ms | null, correction: { count, ratio } | null,
//     units: [{ unit, seen, errors, timed, slow: boolean | null, ratio: number | null, slowMs: number | null }] }
// A pair's `slow` says whether its median clean interval was slower than the run's median, `ratio` is the log of
// one over the other and `slowMs` the difference (all null: untimed). `correction` is the run's timed
// corrections and the log of their median over the run's median interval (null: none timed, or an untimed run).
export function learnerEvidence(runs: RunRecord[], keyboard: string) {
  return runs.flatMap((run) => {
    if (!evidenceRun(run) || keyboardOf(run.conditions) !== keyboard) return [];
    const record = evidenceRecord(run);

    return record.units.length ? [record] : [];
  });
}

function evidenceRecord(run: RunRecord) {
  const units: EvidenceUnit[] = [];
  let pace: number | null = null;

  for (const [pair, seen, errors, timed, pairMs, slowdownMs] of run.patterns || []) {
    if (!PAIR.test(pair) || !(seen >= 0)) continue;
    const runMs = pairMs !== null && slowdownMs !== null ? pairMs - slowdownMs : null;
    const measured = timed > 0 && runMs !== null && pairMs !== null && runMs >= MIN_PACE_MS && pairMs > 0;

    if (measured) pace ??= runMs;
    units.push({ unit: pair, seen, errors: Math.min(errors, seen), timed: measured ? timed : 0, slow: measured ? pairMs > runMs : null,
      ratio: measured ? Math.log(pairMs / runMs) : null, slowMs: measured ? pairMs - runMs : null });
  }

  // Older summaries have no letter counts; a pair's first try is a try at its second letter.
  const keys = new Map<string, [number, number]>();

  if (run.keysVersion === KEY_COUNTS_VERSION && Array.isArray(run.keys)) {
    for (const [key, seen, errors] of run.keys) if (LETTER.test(key)) keys.set(key, [seen, Math.min(errors, seen)]);
  } else {
    for (const { unit, seen, errors } of units) {
      const k = keys.get(unit.charAt(1)) || [0, 0];
      keys.set(unit.charAt(1), [k[0] + seen, k[1] + errors]);
    }
  }

  for (const [key, [seen, errors]] of keys) units.push({ unit: key, seen, errors, timed: 0, slow: null, ratio: null, slowMs: null });
  units.sort((a, b) => compare(a.unit, b.unit));
  const at = run.at ? Date.parse(run.at) : NaN;

  const [count, ms] = Array.isArray(run.corrections) ? run.corrections : [0, null];
  const correction = pace && Number.isInteger(count) && count > 0 && typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? { count, ratio: Math.log(ms / pace) } : null;

  return { id: String(run.id), at: Number.isFinite(at) ? at : null, correction, units };
}

const compare = <T extends string | number>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);

// Oldest first, by date then id, with undated records first. A record seen twice keeps its fuller copy, and
// between equally full copies the one whose JSON sorts first, so the choice never depends on arrival order.
export function orderedEvidence(evidence: LearnerEvidence[]) {
  const byId = new Map<string, LearnerEvidence>();

  for (const record of evidence) {
    const held = byId.get(record.id);

    if (!held || record.units.length > held.units.length
      || (record.units.length === held.units.length && compare(JSON.stringify(record), JSON.stringify(held)) < 0)) byId.set(record.id, record);
  }

  return [...byId.values()].sort((a, b) => compare(a.at ?? -Infinity, b.at ?? -Infinity) || compare(a.id, b.id));
}

// What a loop's target was drilled for, as Train reads it (basisOf in train-path.js). Loops saved before `targetBasis`
// read a saved pace as slowness.
export const basisOf = (loop: TrainingLoop): Basis => (loop.targetBasis ? loop.targetBasis : loop.targetPace ? 'slow' : 'errors');

const loopOrder = (a: TrainingLoop, b: TrainingLoop) => compare(Date.parse(a.at) || 0, Date.parse(b.at) || 0) || compare(a.id, b.id) || compare(JSON.stringify(a), JSON.stringify(b));

// Each drilled target on a keyboard and its newest loop, by date, then id, as Train's path picks it: so duplicated loops
// and the order loops arrive in change nothing.
export function drilledTargets(loops: TrainingLoop[], keyboard: string) {
  const newest = new Map<string | null, TrainingLoop>();

  for (const loop of loops.filter((item) => item.target && keyboardOf(item.conditions) === keyboard).sort(loopOrder)) newest.set(loop.target, loop);

  return newest;
}

// What the let-go test reads from the evidence: the person's typical first-try miss rate over every pair (raw), each
// record's date by id, and each unit's dated rows, oldest first.
export function letGoIndex(evidence: LearnerEvidence[]) {
  const records = orderedEvidence(evidence);
  const rows = new Map<string, ReleaseRow[]>();
  const dates = new Map(records.map((record) => [record.id, record.at]));
  let seen = 0;
  let errors = 0;

  for (const record of records) {
    for (const unit of record.units) {
      if (unit.unit.length === 2) {
        seen += unit.seen;
        errors += unit.errors;
      }

      if (record.at === null) continue;

      if (!rows.has(unit.unit)) rows.set(unit.unit, []);
      entry(rows, unit.unit).push({ at: record.at, seen: unit.seen, errors: unit.errors, timed: unit.timed, slow: unit.slow });
    }
  }

  return { typical: Math.max(TYPICAL_FLOOR, seen ? errors / seen : 0), dates, rows };
}

// Where a drill splits the evidence: its retest's date, else the loop's own. NaN splits nothing.
export const drillSplit = (loop: TrainingLoop, index: ReleaseIndex) => index.dates.get(String(loop.afterAttemptId)) ?? Date.parse(loop.at);

// The one rule for letting go of a drilled target (ADR 0019), of one kind, at one split: the let-go variants drop that
// part of the target's gain. It failed ADR 0019's rule, so no default reads it and Train keeps its own "fixed"; a
// variant that passes would have Train read it too, as "let go and not queued". Every run since the split that
// holds an observation of the kind steps the walk; see LET_GO_ODDS. True when it is let go after the newest run.
export function letGo(index: ReleaseIndex, unit: string | null, basis: Basis, split: number, k = LET_GO) {
  if (!Number.isFinite(split)) return false;
  const [p, ceiling, back] = [index.typical, Math.log(k.letGoOdds), Math.log(k.returnOdds)];
  const weak = Math.min(0.5, k.weakRatio * p);
  const [miss, clean, slower, faster] = [Math.log(p / weak), Math.log((1 - p) / (1 - weak)), Math.log(0.5 / k.slowShare), Math.log(0.5 / (1 - k.slowShare))];
  let [walk, against, runs, observed, released] = [0, 0, 0, 0, false];

  for (const row of index.rows.get(unit ?? '') || []) {
    const held = basis === 'slow' ? row.slow !== null : row.seen > 0;

    if (row.at < split || !held) continue;
    const step = basis === 'slow' ? (row.slow ? slower : faster) : row.errors * miss + (row.seen - row.errors) * clean;
    runs += 1;
    observed += basis === 'slow' ? row.timed : row.seen;

    if (released) {
      against = Math.max(0, against - step);

      if (against >= back) [released, walk] = [false, 0];
    } else {
      walk = Math.min(ceiling, Math.max(-ceiling, walk + step));

      if (walk >= ceiling && runs >= FIXED_RUNS && observed >= FIXED_OBSERVATIONS) [released, against] = [true, 0];
    }
  }

  return released;
}

// The model: a fold over evidence records at time `now` (ms), under one of LEARNER_VARIANTS (the evaluation
// also passes its own constants), ranked for one of FOCUSES.
// `drills` is drilledTargets' loops for the keyboard; only the let-go variants read them.
//   { policy, focus, runs, errorRate, missCost, units: Estimate[] }
//   Estimate = { unit, kind: 'pair' | 'key', frequency, gain, basis: 'errors' | 'slow', error: { mean, sd },
//     slowdown: number | null (timing variants, pairs: the pooled log ratio to the person's pace),
//     observed: { seen, errors, runs, errorRuns, timed, timedRuns, slowRuns, slowMs },
//     own?: { seen, errors } (keys: the observations naming reads, see stated),
//     letGo?: ['errors' | 'slow'] (let-go variants: the kinds let go since the unit's drill, whose gain is dropped) }
// units is ranked by gain for the focus, highest first, and `basis` says what it is ranked on: the larger part
// of its gain when balanced, its misses for accuracy, its slowness for speed. `missCost` is what a miss costs in
// clean intervals. `observed` holds raw, undecayed counts, the only numbers a person is shown; `slowMs` is the
// mean of the runs' slowdowns over the person's pace, weighted by clean intervals.
export function fitLearner(evidence: LearnerEvidence[], now: number, variant = LEARNER_VARIANTS[DEFAULT_POLICY], focus = DEFAULT_FOCUS, drills: TrainingLoop[] = []) {
  const settings = { ...LEARNER_VARIANTS[DEFAULT_POLICY], ...variant };
  const { policy, decay, timing, ownCost, halfLifeRuns, pooledTries, timingTries, costCorrections } = settings;
  const records = orderedEvidence(evidence);
  const table = englishFrequency();
  const tally = new Map<string, Tally>();
  const corrections = { count: 0, weight: 0, ratio: 0 };

  records.forEach((record, index) => {
    const age = record.at === null ? 0 : Math.max(0, now - record.at) / DAY_MS;
    const w = decay ? 0.5 ** ((records.length - 1 - index) / halfLifeRuns) * 0.5 ** (age / HALF_LIFE_DAYS) : 1;

    if (record.correction) {
      corrections.count += record.correction.count;
      corrections.weight += w * record.correction.count;
      corrections.ratio += w * record.correction.count * record.correction.ratio;
    }

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
        t.slowMs += timed * (slowMs ?? 0);
        t.tn += w * timed;
        t.tr += w * timed * (ratio ?? 0);

        if (slow) t.slowRuns += 1;
      }

      tally.set(unit, t);
    }
  });

  // A key's own evidence: its tries and misses outside the pairs ending in it that hold the evidence to be named
  // themselves (owned). A miss inside "th" is th's, so "h" ranks only on misses elsewhere. `worst` is the most
  // misses in any one other pair ending in the key, which naming also leaves out (see stated).
  for (const [unit, t] of tally) {
    if (unit.length === 1) t.own = { seen: t.seen, errors: t.errors, n: t.n, e: t.e, worst: 0 };
  }

  for (const [unit, t] of tally) {
    const key = tally.get(unit.charAt(1));

    if (unit.length !== 2 || !key?.own) continue;

    if (!owned(t)) {
      key.own.worst = Math.max(key.own.worst, t.errors);
      continue;
    }

    key.own.seen = Math.max(0, key.own.seen - t.seen);
    key.own.errors = Math.max(0, Math.min(key.own.seen, key.own.errors - t.errors));
    key.own.n = Math.max(0, key.own.n - t.n);
    key.own.e = Math.max(0, Math.min(key.own.n, key.own.e - t.e));
  }

  const own = (t: Tally | undefined) => t?.own || t || { n: 0, e: 0 };
  // A pair or key never seen in the list counts as half the rarest one.
  const floor = (map: Map<string, number>) => Math.min(...map.values()) / 2;
  const shares = new Map<number, [Map<string, number>, number]>([[1, [table.keys, floor(table.keys)]], [2, [table.pairs, floor(table.pairs)]]]);
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
    const a = pooledTries * (pooled.get(unit.length) ?? NaN) + e;
    const b = pooledTries * (1 - (pooled.get(unit.length) ?? NaN)) + n - e;
    const mean = a / (a + b);
    const [map, rarest] = shares.get(unit.length) ?? [new Map<string, number>(), NaN];

    const observed = t ? { seen: t.seen, errors: t.errors, runs: t.runs, errorRuns: t.errorRuns, timed: t.timed, timedRuns: t.timedRuns, slowRuns: t.slowRuns,
      slowMs: t.timed ? t.slowMs / t.timed : null } : { seen: 0, errors: 0, runs: 0, errorRuns: 0, timed: 0, timedRuns: 0, slowRuns: 0, slowMs: null };

    const slowdown = timing && unit.length === 2 ? (t?.tr || 0) / ((t?.tn || 0) + timingTries) : null;

    const estimate: Omit<Estimate, 'gain' | 'basis'> = { unit, kind: unit.length === 1 ? 'key' : 'pair', frequency: map.get(unit) ?? rarest, error: { mean, sd: Math.sqrt((mean * (1 - mean)) / (a + b + 1)) },
      slowdown, observed };

    if (unit.length === 1) estimate.own = t ? { seen: (t.own?.seen ?? 0), errors: Math.max(0, (t.own?.errors ?? 0) - (t.own?.worst ?? 0)) } : { seen: 0, errors: 0 };

    return estimate;
  });

  // The person's typical pair: the frequency-weighted mean of the pairs' estimates. Practice can bring a weak
  // unit toward it, so the gain is the misses above it a unit costs per letter typed. The timing variants add
  // the time a slow pair loses over the person's pace, counted in misses at missCost intervals each.
  const pairs = estimates.filter((e) => e.kind === 'pair');
  const errorRate = pairs.reduce((s, e) => s + e.frequency * e.error.mean, 0) / pairs.reduce((s, e) => s + e.frequency, 0);
  const missCost = ownCost && corrections.count >= costCorrections ? Math.max(1, Math.exp(corrections.ratio / corrections.weight) - 1) : MISS_INTERVALS;

  // A drilled target let go on the evidence since its drill loses that part of its gain (ADR 0019).
  const released = new Map<string | null, Basis[]>();

  if (settings.letGo && drills.length) {
    const index = letGoIndex(records);

    for (const loop of drills) {
      const basis = basisOf(loop);

      if (settings.letGo.includes(basis) && letGo(index, loop.target, basis, drillSplit(loop, index), { ...LET_GO, ...settings })) released.set(loop.target, [basis]);
    }
  }

  const scored = estimates.map((e): Estimate => {
    const gone = released.get(e.unit) || [];
    const missed = gone.includes('errors') ? 0 : Math.max(0, e.error.mean - UNCERTAINTY_Z * e.error.sd - errorRate);
    const slow = e.slowdown === null || gone.includes('slow') ? 0 : Math.max(0, Math.exp(e.slowdown) - 1) / missCost;

    if (gone.length) e.letGo = gone;
    return { ...e,
      gain: e.frequency * (focus === 'speed' ? slow : focus === 'accuracy' ? missed : missed + slow),
      basis: focus === 'speed' || (focus !== 'accuracy' && slow > missed) ? 'slow' : 'errors',
    };
  });

  scored.sort((a, b) => b.gain - a.gain || compare(a.unit, b.unit));

  return { policy, focus, runs: records.length, errorRate, missCost, units: scored };
}

// Whether a pair's tally holds the evidence to be named, leaving out the slowness floor: the floor of first tries,
// and a miss or the floor of clean intervals slower than the run's median in most runs that timed it. Only the
// ranking reads it, to give a key its own evidence, so the floor below never moves the ranking.
const owned = (t: Tally) => t.seen >= MIN_PATTERN_SAMPLES && (t.errors > 0 || (t.timed >= MIN_PATTERN_SAMPLES && t.slowRuns * 2 > t.timedRuns));

// A pair is named for its slowness only when the figure the page prints, its mean clean interval over the
// person's pace in ms, rounded, is more than this. 20 ms is a tenth of a key at 60 wpm (200 ms a key), about
// the smallest change in a gap of 100 to 300 ms that people reliably tell apart (5 to 10% of the gap), and
// twenty of the clock's millisecond steps. Below it a pair may still rank, and lean the drill, unnamed.
export const SLOW_FLOOR_MS = 20;

// The one rule for naming a unit (ADR 0013): its own observations must say what it is ranked on. A unit ranked
// on its misses needs at least the floor of first tries and a first-try error. A pair ranked on its slowness
// needs the floor of clean intervals pooled across runs, slower than the run's median in most of the runs that
// timed it, and a printed slowdown past SLOW_FLOOR_MS. A key's own observations (`own`) are its tries outside
// the pairs ending in it that hold the evidence to be named (owned), and its misses outside those and outside
// its most-missed other pair. So a key is named only when it is missed beyond any one pair: misses that all sit
// in "th" are th's, whether "th" has the tries to be named yet or not. Keys have no timing.
export function stated({ basis, observed, own = observed }: Pick<Estimate, 'basis' | 'observed' | 'own'>) {
  if (basis === 'slow') return observed.timed >= MIN_PATTERN_SAMPLES && observed.slowRuns * 2 > observed.timedRuns && Math.round(observed.slowMs ?? 0) > SLOW_FLOOR_MS;

  return own.seen >= MIN_PATTERN_SAMPLES && own.errors > 0;
}

const errorCount = ({ errors, seen }: Pick<Observed, 'errors' | 'seen'>) => `${errors} first-try ${errors === 1 ? 'error' : 'errors'} in ${seen} ${seen === 1 ? 'try' : 'tries'}`;

// "38 ms slower", "12 ms faster", "at your pace": a pair's clean intervals against the person's pace, rounded
// as the page prints them.
export function paceShift(ms: number | null) {
  const rounded = Math.round(ms ?? 0);

  return rounded > 0 ? `${rounded} ms slower` : rounded < 0 ? `${-rounded} ms faster` : 'at your pace';
}

export const paceAgainst = (ms: number | null) => (Math.round(ms ?? 0) ? `${paceShift(ms)} than your pace` : 'at your pace');

// "45 ms slower than your pace, in 4 of 5 runs that timed it (31 clean intervals)": observed timing only.
export const paceCopy = ({ slowMs, slowRuns, timedRuns, timed }: Pick<Observed, 'slowMs' | 'slowRuns' | 'timedRuns' | 'timed'>) => `${paceAgainst(slowMs)}, in ${slowRuns} of ${timedRuns} ${timedRuns === 1 ? 'run' : 'runs'} that timed it (${timed} clean ${timed === 1 ? 'interval' : 'intervals'})`;

// What Train, the results card and adaptive text act on. The target is the highest-ranked unit whose
// observations can be stated, the head of `queue`; with none it is a general drill that says so. Either way
// the drill and adaptive text lean toward the units the model ranks highest (`lean`), named or not. `was`
// carries the observed counts the comparison later reads back, and for a pair ranked on slowness its observed
// timing. `queue` is every unit that can be named, best first, each with its counts; `runs` is the evidence
// runs behind it.
//   { kind: 'targeted' | 'general', target, title, reason, was, lean: [{ unit, weight }],
//     queue: [{ unit, was }], runs, policy }
function wasOf({ observed, basis }: Pick<Estimate, 'observed' | 'basis'>) {
  const was: TargetEvidence = { errors: observed.errors, observations: observed.seen, runs: observed.runs, slowRuns: observed.slowRuns };

  if (basis === 'slow') Object.assign(was, { basis, slowMs: observed.slowMs, timed: observed.timed, timedRuns: observed.timedRuns });

  return was;
}

export function learnerRecommendation(model: LearnerModel): Recommendation {
  const ranked = model.units.filter((e) => e.gain > 0);
  const lean = ranked.slice(0, LEAN_UNITS).map((e) => ({ unit: e.unit, weight: e.gain }));
  const named = ranked.filter(stated);
  const queue = named.map((e) => ({ unit: e.unit, was: wasOf(e) }));
  const top = named[0];
  const common = { lean, queue, runs: model.runs, policy: model.policy, focus: model.focus };

  if (top) {
    const { observed } = top;

    const reason = top.basis === 'slow' ? `“${top.unit}”: ${paceCopy(observed)}.`
      : `“${top.unit}”: ${errorCount(observed)} over ${observed.runs} ${observed.runs === 1 ? 'run' : 'runs'}.`;

    return { kind: 'targeted', target: top.unit, title: `Practice “${top.unit}”`, reason, was: wasOf(top), ...common };
  }

  const missed = model.focus !== 'speed' && ranked.find((e) => e.observed.errors > 0);

  return { kind: 'general', target: null, title: 'General drill',
    reason: missed ? `Too little data to target a pattern yet (“${missed.unit}”: ${errorCount(missed.observed)}).` : 'Not enough clean data to name a weakness yet.',
    was: null, ...common };
}

// The baseline policy, the counting rule this replaced: the recurring pair with the highest first-try error
// rate across recent matching runs (10 tries, errors or slowness in two runs), else the newest traces' target,
// else a general drill.
export function countingRecommendation(runs: RunRecord[], loops: TrainingLoop[], traces: Attempt[], source: Conditions): Recommendation {
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
export function countingEvidence(runs: RunRecord[], loops: TrainingLoop[], pair: string, source: Conditions) {
  const recurring = recurringTargets(runs, loops, source).find((item) => item.pair === pair);

  return recurring ? { errors: recurring.errors, observations: recurring.observations, runs: recurring.runs, slowRuns: recurring.slowRuns } : null;
}

// The recommendation for `source` conditions under a policy. The learner reads every measured run on the
// keyboard `source` is typed on, and the let-go variants its drilled targets there; the counting rule reads only runs
// at its exact conditions.
export function recommendFor(policy: string, { runs, loops = [], traces, source, now, focus = DEFAULT_FOCUS }: { runs: RunRecord[]; loops?: TrainingLoop[]; traces: Attempt[]; source: Conditions; now: number; focus?: string }) {
  if (policy === BASELINE_POLICY) return countingRecommendation(runs, loops, traces, source);

  const keyboard = keyboardOf(source);
  const variant = LEARNER_VARIANTS[policy];
  // Only a let-go variant reads loops, so no other policy can be changed, or broken, by what a stored loop holds.
  const drills = variant?.letGo ? [...drilledTargets(loops, keyboard).values()] : [];

  return learnerRecommendation(fitLearner(learnerEvidence(runs, keyboard), now, variant, focus, drills));
}


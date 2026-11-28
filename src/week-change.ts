import { analysisRuns, analysisLoops, drilledLoop } from './domain-history.js';
import type { AnalysisLoop, AnalysisRun, ScoredRun, HistoricalRecord } from './profile-types.js';
import { at as indexed } from './domain-values.js';
import type { Conditions } from './typing.js';

import type { Basis, LearnerEvidence, LearnerModel, TargetEvidence } from './learner.js';
import type { Since, ErrorTally, SlowTally } from './train-path.js';

export type Mover = { unit: string; split: 'drill' | 'week'; weight: number } & ({ basis: 'errors'; before: ErrorTally; after: ErrorTally } | { basis: 'slow'; before: SlowTally; after: SlowTally });
// Progress's overview (TOB-420, "What changed"): what changed since last week, and what moved it, as one value
// built from the profile's runs and loops, the train focus and `now`. Pure: no DOM, storage or randomness, and no
// clock but `now`, so the same history and settings give the same overview on any device and after any merge.
//
//   WeekChange = { lead: Lead, movers: Mover[], practice: Practice | null, charts: { runs, window } }
//   Lead     = { state, current: Week, previous: Week, latest: run | null }
//     state  = 'change'    both weeks hold a median: the change is current.median - previous.median
//            | 'this-week' only this week does
//            | 'last-week' only the week before does
//            | 'thin'      runs in the fortnight, but neither week holds a median: `latest` is the newest of them
//            | 'none'      no runs at these conditions in the fortnight
//     Week   = { median: wpm | null, count, accuracy: % | null }
//   Mover    = { unit, basis: 'errors' | 'slow', before: Tally, after: Tally, split, weight }: a unit fixed since the
//              week began, the one kind of change the list shows
//     split  = 'drill' (before its drill, from its retest on) | 'week' (before this week, this week)
//     Tally  = { runs, tries, errors } (errors) | { runs, intervals, ms } (slow), observed counts only
//   Practice = { status: 'more' | 'less' | 'same', current: minutes, previous: minutes, streak, goal }
//
// The lead compares fresh-text runs at one condition key, a week against the week before (weeklyChange). The movers
// read every measured run on that key's keyboard, as Train does, in the train focus.

import { MAX_PATTERN_RUNS, comparableKind, dayKey, evidenceRun, filterRuns, minutesByDay, periodDays, periodWindow, practiceStreak, retainRuns, runDay, trendRun, weeklyChange } from './insights.js';
import { DEFAULT_POLICY, HALF_LIFE_DAYS, LEARNER_VARIANTS, SLOW_FLOOR_MS, UNCERTAINTY_Z, fitLearner, keyboardOf, learnerEvidence, learnerRecommendation, paceShift } from './learner.js';
import { FIXED_OBSERVATIONS, evidenceSince, isFixed, sinceDrilled } from './train-path.js';

const DAY_MS = 86_400_000;

// A week holds a median from this many runs: below it, one or two runs would stand in for a week.
export const WEEK_MIN_RUNS = 3;

// The overview lists this many units, so the lead and the list fit one screen at 1280 × 800. The rest wait behind
// one quiet "more" control on the same list.
export const SHOWN_MOVERS = 3;

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 ? indexed(sorted, mid) : (indexed(sorted, mid - 1) + indexed(sorted, mid)) / 2;
};

const weekOf = (runs: ScoredRun[]) => {
  const settled = runs.length >= WEEK_MIN_RUNS;

  return { count: runs.length, median: settled ? median(runs.map((run) => run.score.wpm)) : null, accuracy: settled ? median(runs.map((run) => run.score.accuracy)) : null };
};

// The lead: this week against the week before, at one condition key, by weeklyChange's weeks (today and the six
// days before, then the seven before those). A week without WEEK_MIN_RUNS runs has no median, so no change is
// stated from it.
export function weekLead(runs: readonly unknown[], key: string, date: Date) {
  const { current, previous } = key ? weeklyChange(runs, key, date) : { current: [], previous: [] };
  const [now, before] = [weekOf(current), weekOf(previous)];

  const state = now.median !== null && before.median !== null ? 'change' : now.median !== null ? 'this-week' : before.median !== null ? 'last-week'
    : current.length || previous.length ? 'thin' : 'none';

  const latest = [...current, ...previous].reduce<ScoredRun | null>((last, run) => (!last || (run.at || '') > (last.at || '') ? run : last), null);

  return { state, current: now, previous: before, latest };
}

// When this week began: midnight at the start of the lead's week, the moment "a week ago" is read at.
export const weekStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() - 6).getTime();

const byDate = (a: AnalysisLoop, b: AnalysisLoop) => (Date.parse(a.at ?? '') || 0) - (Date.parse(b.at ?? '') || 0) || ((a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0);
const basisNamed = (item: { was: TargetEvidence | null } | undefined): Basis => (item?.was?.basis === 'slow' ? 'slow' : 'errors');
const carriesCounts = (run: AnalysisRun) => Boolean(run.patterns?.length || run.keys?.length || 'corrections' in run);

// Evidence runs on `keyboard` whose counts were stripped by retainRuns before `began`. Empty whenever the stored
// history has not reached MAX_PATTERN_RUNS count-carrying comparable runs, so untrimmed histories stay untouched.
// Sorted newest first by date then id, deduplicated by id, so arrival order and merge order never change the result.
function trimmedBefore(runs: AnalysisRun[], keyboard: string, began: number) {
  const comparableWithCounts = runs.filter((run) => comparableKind(run.kind) && carriesCounts(run));

  if (comparableWithCounts.length < MAX_PATTERN_RUNS) return [];

  const oldestKept = comparableWithCounts.reduce((min, run) => {
    const at = run.at ? Date.parse(run.at) : NaN;

    return Number.isFinite(at) && at < min ? at : min;
  }, Infinity);

  const byId = new Map<string, { id: string; at: number | null }>();

  for (const run of runs) {
    if (!evidenceRun(run) || keyboardOf(run.conditions) !== keyboard) continue;

    if (run.patterns?.length || run.keys?.length) continue;
    const parsed = run.at ? Date.parse(run.at) : NaN;
    const at = Number.isFinite(parsed) ? parsed : null;

    if (at !== null && !(at < began && at <= oldestKept)) continue;
    const id = String(run.id);

    if (!byId.has(id)) byId.set(id, { id, at });
  }

  return [...byId.values()].sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Total decay weight of the surviving pre-week evidence records (matching fitLearner's orderedEvidence) and of the
// newest trimmed pre-week runs that would have sat inside the 120-run pattern window at `began`.
function preWeekWeights(earlier: LearnerEvidence[], trimmed: { id: string; at: number | null }[], began: number, halfLifeRuns: number) {
  const byId = new Map<string, LearnerEvidence>();

  for (const record of earlier) {
    const kept = byId.get(record.id);

    if (!kept || record.units.length > kept.units.length) byId.set(record.id, record);
  }

  const ordered = [...byId.values()].sort((a, b) => (a.at === null ? -1 : 0) - (b.at === null ? -1 : 0) || (a.at ?? 0) - (b.at ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let keptWeight = 0;

  ordered.forEach((record, index) => {
    const age = record.at === null ? 0 : Math.max(0, began - record.at) / DAY_MS;
    keptWeight += 0.5 ** ((ordered.length - 1 - index) / halfLifeRuns) * 0.5 ** (age / HALF_LIFE_DAYS);
  });

  const missing = trimmed.slice(0, Math.max(0, MAX_PATTERN_RUNS - ordered.length));
  let missingWeight = 0;

  missing.forEach((run, index) => {
    const age = run.at === null ? 0 : Math.max(0, began - run.at) / DAY_MS;
    missingWeight += 0.5 ** ((ordered.length + index) / halfLifeRuns) * 0.5 ** (age / HALF_LIFE_DAYS);
  });

  return { keptWeight, missingWeight };
}

// The units fixed between `began` and now, on one keyboard, in one focus: Train's isFixed now and not then. A drilled
// unit is judged as Train judges it, since its drill; a unit never drilled, named a week ago and not now, is judged
// since `began`. "A week ago" is the learner built on the history as it stood then (the same fold, given only the
// earlier evidence and `began`), never a second set of rules. When older pattern counts were trimmed before `began`,
// two per-unit checks prevent broken "a week ago" artifacts without hiding true movers:
//  - A unit drilled before `began` whose post-drill pre-week runs were trimmed is suppressed only when its surviving
//    pre-week runs do not disprove `fixedThen` and its surviving `before` evidence is already clean / at pace.
//  - An undrilled error mover is kept only when its pre-week posterior still exceeds `modelThen.errorRate` after
//    adding missing pre-week weight (capped at the surviving pre-week weight) at `modelThen.errorRate`.
// Ranked by what each saved in the learner's terms: the change in its gain, the time it loses per letter typed,
// between the two fits. Largest first, then by unit.
export function weekMovers({ runs, loops: rawLoops = [], keyboard, focus, now, began }: { runs: readonly unknown[]; loops?: readonly unknown[]; keyboard: string; focus: string; now: number; began: number }) {
  const loops = analysisLoops(rawLoops);
  const variant = LEARNER_VARIANTS[DEFAULT_POLICY];
  // Match recommendFor: DEFAULT_POLICY reads the newest 120 pattern-carrying runs, even when retainRuns keeps older
  // post-drill runs for learner-let-go@3 (ADR 0029). trimmedBefore reads the same view, so it sees what the fit lost.
  const parsedRuns = variant.letGoVersion === 3 ? analysisRuns(runs) : retainRuns(analysisRuns(runs), { drills: false });
  const records = learnerEvidence(parsedRuns, keyboard);
  const earlier = records.filter((record) => record.at === null || record.at < began);
  const [modelNow, modelThen] = [fitLearner(records, now, variant, focus), fitLearner(earlier, began, variant, focus)];
  const queuedNow = new Set(learnerRecommendation(modelNow).queue.map((item) => item.unit));
  const queuedThen = new Map(learnerRecommendation(modelThen).queue.map((item) => [item.unit, item]));
  const thenUnits = new Map(modelThen.units.map((unit) => [unit.unit, unit]));
  const gains = (model: LearnerModel) => new Map(model.units.map((unit) => [unit.unit, unit.gain]));
  const [gainNow, gainThen] = [gains(modelNow), gains(modelThen)];
  const drilledNow = new Map<string, AnalysisLoop>();
  const drilledThen = new Map<string, AnalysisLoop>();

  for (const loop of loops.filter((item) => item.target && drilledLoop(item) && keyboardOf(item.conditions) === keyboard).sort(byDate)) {
    drilledNow.set(loop.target ?? '', loop);

    if (Date.parse(loop.at ?? '') < began) drilledThen.set(loop.target ?? '', loop);
  }

  const trimmed = trimmedBefore(parsedRuns, keyboard, began);
  const { keptWeight, missingWeight } = trimmed.length ? preWeekWeights(earlier, trimmed, began, variant.halfLifeRuns) : { keptWeight: 0, missingWeight: 0 };
  const retestSplit = (loop: AnalysisLoop) => Date.parse(parsedRuns.find((run) => run.id === loop.afterAttemptId)?.at || loop.at || '');

  // A mover is a before → after, so it needs observations on both sides; without them the list says nothing of it.
  const movers: Mover[] = [];

  const add = (unit: string, since: Since, split: 'drill' | 'week') => {
    const common = { unit, split, weight: Math.abs((gainNow.get(unit) || 0) - (gainThen.get(unit) || 0)) };

    if (since.basis === 'slow' && since.before && since.after) movers.push({ ...common, basis: since.basis, before: since.before, after: since.after });

    if (since.basis === 'errors' && since.before && since.after) movers.push({ ...common, basis: since.basis, before: since.before, after: since.after });
  };

  for (const unit of [...new Set([...queuedThen.keys(), ...drilledNow.keys()])].sort()) {
    const loop = drilledNow.get(unit);
    const previousDrill = drilledThen.get(unit);
    const previousSince = previousDrill ? sinceDrilled(previousDrill, runs, earlier) : null;
    const fixedThen = Boolean(previousDrill && isFixed(previousSince, queuedThen.has(unit)));

    if (loop) {
      const since = sinceDrilled(loop, runs, records);

      if (!isFixed(since, queuedNow.has(unit)) || fixedThen || !since.before || !since.after) continue;

      if (previousDrill && trimmed.length) {
        const prevSplit = retestSplit(previousDrill);
        const trimmedAfterPrev = Number.isFinite(prevSplit) && trimmed.some((run) => run.at !== null && run.at >= prevSplit);

        if (trimmedAfterPrev) {
          const prevDisprovesFixed = previousSince?.basis === 'slow' ? Math.round(previousSince.after?.ms ?? 0) > SLOW_FLOOR_MS : (previousSince?.after?.errors ?? 0) > 0;
          const beforeClean = since.basis === 'errors' ? since.before.errors === 0 : Math.round(since.before.ms) <= SLOW_FLOOR_MS;

          if (!prevDisprovesFixed && beforeClean) continue;
        }
      }

      add(unit, since, 'drill');
    } else if (queuedThen.has(unit) && !queuedNow.has(unit)) {
      const basis = basisNamed(queuedThen.get(unit));
      const since = evidenceSince(unit, basis, began, records);

      if (!isFixed(since, false) || !since.before || !since.after) continue;

      if (basis === 'errors' && missingWeight > 0 && keptWeight > 0) {
        const estimate = thenUnits.get(unit);

        if (estimate && estimate.error.sd > 0) {
          const ab = (estimate.error.mean * (1 - estimate.error.mean)) / (estimate.error.sd * estimate.error.sd) - 1;
          const observedWeight = Math.max(0, ab - variant.pooledTries);
          const addedTries = (observedWeight / keptWeight) * Math.min(missingWeight, keptWeight);
          const total = ab + addedTries;
          const mean = (estimate.error.mean * ab + addedTries * modelThen.errorRate) / total;
          const sd = Math.sqrt((mean * (1 - mean)) / (total + 1));

          if (!(mean - UNCERTAINTY_Z * sd > modelThen.errorRate)) continue;
        }
      }

      add(unit, since, 'week');
    }
  }

  return movers.sort((a, b) => b.weight - a.weight || (a.unit < b.unit ? -1 : 1));
}

// Minutes practised this week and the week before (every kind of practice, as the calendar counts it), and the
// streak ending today. Null when neither week has any.
export function weekPractice(runs: readonly unknown[], practiceDays: Record<string, number>, goal: number, date: Date) {
  const byDay = minutesByDay(runs, practiceDays);
  const fortnight = periodDays(14, date);
  // Each day's minutes are a division, so the week's sum is rounded to a microminute before it is read for print.
  const sum = (days: string[]) => Math.round(days.reduce((total, day) => total + (byDay[day] || 0), 0) * 1e6) / 1e6;
  const [previous, current] = [sum(fortnight.slice(0, 7)), sum(fortnight.slice(7))];

  if (!(previous > 0) && !(current > 0)) return null;
  // The status follows the figures the row prints (goalMinutes): none, under a minute, then whole minutes. So a
  // first half-minute after an empty week is more, not the same.
  const printed = (minutes: number) => (minutes > 0 && minutes < 1 ? 0.5 : Math.floor(minutes));
  const [now, was] = [printed(current), printed(previous)];

  return { status: now > was ? 'more' : now < was ? 'less' : 'same', current, previous, streak: practiceStreak(byDay, goal, date), goal };
}

export function weekChange({ runs = [], loops = [], practiceDays = {}, key = '', conditions = null, focus, goal = 0, period = '30', now }: { runs?: readonly unknown[]; loops?: readonly unknown[]; practiceDays?: Record<string, number>; key?: string; conditions?: Conditions | HistoricalRecord | null; focus: string; goal?: number; period?: string; now: number }) {
  const date = new Date(now);
  const trend = analysisRuns(runs).filter(trendRun);
  const charted = key ? filterRuns(trend, key, periodWindow(period, date)) : [];
  const first = charted.map(runDay).filter(Boolean).sort()[0] || null;

  return {
    lead: weekLead(runs, key, date),
    movers: conditions ? weekMovers({ runs, loops, keyboard: keyboardOf(conditions), focus, now, began: weekStart(date) }) : [],
    practice: weekPractice(runs, practiceDays, goal, date),
    charts: { runs: charted, window: periodWindow(period, date, first) },
  };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// A mover's before and after, as the list prints them: counts for misses ("6 of 22", "1 of 25", "missed"), the
// pace against the person's own for slowness ("180 ms slower", "at your pace"). Never a zero or negative amount
// as slower.
export function moverCopy({ basis, before, after }: Mover) {
  if (basis === 'slow') return { before: paceShift(before.ms), after: paceShift(after.ms), tail: '' };

  return { before: `${before.errors} of ${before.tries}`, after: `${after.errors} of ${after.tries}`, tail: 'missed' };
}

// What a mover's figures are counted over: "before your drill, then 31 tries in 3 runs since", or the same split at
// the start of this week.
export function moverSample({ before, after, split }: Mover) {
  const counted = (side: ErrorTally | SlowTally) => ('intervals' in side ? plural(side.intervals, 'clean interval') : `${side.tries} ${side.tries === 1 ? 'try' : 'tries'}`);
  const [was, since] = split === 'drill' ? ['before your drill', 'since'] : ['before this week', 'this week'];

  return `${counted(before)} in ${plural(before.runs, 'run')} ${was}, ${counted(after)} in ${plural(after.runs, 'run')} ${since}`;
}

// --- Slipping from day-level variation (ADR 0031, TOB-511) ---
// Chosen on validation seeds 9101–9102 and verified on held-out seeds 601–630 before shipping.
export const SLIP_RULE = { alpha: 0.02, priorDf: 16, lodoZ: 1.8, minDays: 2 } as const;

export interface Slip {
  unit: string;
  basis: 'errors';
  before: ErrorTally & { days: number };
  after: ErrorTally & { days: number };
  weight: number;
}

const clampRate = (p: number) => Math.min(0.99, Math.max(0.002, p));
const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));
const logit = (p: number) => Math.log(p / (1 - p));

function erfc(x: number) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);

  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806
    + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));

  return x >= 0 ? r : 2 - r;
}

const normalUpperTail = (z: number) => (z <= 0 ? 1 : 0.5 * erfc(z / Math.SQRT2));

function logGamma(z: number): number {
  const g = 7;

  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  let x = indexed(c, 0);
  const zm = z - 1;

  for (let i = 1; i < g + 2; i += 1) x += indexed(c, i) / (zm + i);
  const t = zm + g + 0.5;

  return 0.5 * Math.log(2 * Math.PI) + (zm + 0.5) * Math.log(t) - t + Math.log(x);
}

function betacf(a: number, b: number, x: number) {
  const fpmin = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);

  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= 200; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;

    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;

    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;
    aa = -((a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;

    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;

    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1) < 3e-12) break;
  }

  return h;
}

function tUpperTail(t: number, df: number) {
  if (!(t > 0)) return 1;

  if (!Number.isFinite(df) || df > 1e5) return normalUpperTail(t);
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  const ib = x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;

  return 0.5 * ib;
}

function solveProfileTheta(days: { seen: number; delta: number }[], totalErrors: number) {
  const totalTries = days.reduce((s, d) => s + d.seen, 0);

  if (totalErrors <= 0) return -12;

  if (totalErrors >= totalTries) return 12;
  let lo = -12;
  let hi = 12;
  let theta = logit(clampRate(totalErrors / totalTries));

  for (let iter = 0; iter < 16; iter += 1) {
    let f = -totalErrors;
    let df = 0;

    for (const d of days) {
      const p = sigmoid(theta + d.delta);
      f += d.seen * p;
      df += d.seen * p * (1 - p);
    }

    if (Math.abs(f) < 1e-9) break;

    if (f > 0) hi = theta;
    else lo = theta;
    const next = df > 1e-12 ? theta - f / df : (lo + hi) / 2;
    theta = next > lo && next < hi ? next : (lo + hi) / 2;
  }

  return theta;
}

interface DayBucket {
  key: string;
  side: 'before' | 'after';
  pairTries: number;
  pairErrors: number;
  units: Map<string, { seen: number; errors: number; runs: number }>;
}

interface UnitDaySeries {
  beforeTries: number;
  beforeErrors: number;
  beforeRuns: number;
  beforeDays: number;
  afterTries: number;
  afterErrors: number;
  afterRuns: number;
  afterDays: number;
  days: { day: DayBucket; side: 'before' | 'after'; seen: number; errors: number }[];
}

export interface DetectedSlip {
  unit: string;
  before: ErrorTally & { days: number };
  after: ErrorTally & { days: number };
}

export interface SlipDetectionResult {
  slipped: DetectedSlip[];
  family: number;
}

// Pure day-level variation slip detector (ADR 0031). Deduplicates records by id as fitLearner does, groups dated
// records by local calendar day, cancels uneven bad days via within-day leave-one-out background log-odds shifts
// (clamped so a good week never makes a slip easier to call), estimates pre-week day-level overdispersion (keyboard
// prior moderated per unit), applies Bonferroni control over all readable units, and guards against single-day spikes
// with a leave-one-day-out check.
export function detectSlips(records: LearnerEvidence[], began: number, queuedNow: ReadonlySet<string> | null = null, params = SLIP_RULE): SlipDetectionResult {
  const { alpha, priorDf, lodoZ, minDays } = { ...SLIP_RULE, ...params };
  const byId = new Map<string, LearnerEvidence>();

  for (const record of records) {
    const kept = byId.get(record.id);

    if (!kept || record.units.length > kept.units.length) byId.set(record.id, record);
  }

  const dayMap = new Map<string, DayBucket>();

  for (const record of [...byId.values()].sort((a, b) => (a.at ?? -1) - (b.at ?? -1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (record.at === null) continue;
    const side = record.at < began ? 'before' : 'after';
    const key = `${side}:${dayKey(new Date(record.at))}`;
    let day = dayMap.get(key);

    if (!day) {
      day = { key, side, pairTries: 0, pairErrors: 0, units: new Map() };
      dayMap.set(key, day);
    }

    for (const { unit, seen, errors } of record.units) {
      if (!(seen > 0)) continue;
      const cur = day.units.get(unit) || { seen: 0, errors: 0, runs: 0 };
      cur.seen += seen;
      cur.errors += errors;
      cur.runs += 1;
      day.units.set(unit, cur);

      if (unit.length === 2) {
        day.pairTries += seen;
        day.pairErrors += errors;
      }
    }
  }

  const allDays = [...dayMap.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  if (!allDays.length) return { slipped: [], family: 0 };

  const unitDays = new Map<string, UnitDaySeries>();
  let totalPairTries = 0;
  let totalPairErrors = 0;

  for (const day of allDays) {
    totalPairTries += day.pairTries;
    totalPairErrors += day.pairErrors;

    for (const [unit, counts] of day.units) {
      let entry = unitDays.get(unit);

      if (!entry) {
        entry = { beforeTries: 0, beforeErrors: 0, beforeRuns: 0, beforeDays: 0, afterTries: 0, afterErrors: 0, afterRuns: 0, afterDays: 0, days: [] };
        unitDays.set(unit, entry);
      }

      if (day.side === 'before') {
        entry.beforeTries += counts.seen;
        entry.beforeErrors += counts.errors;
        entry.beforeRuns += counts.runs;
        entry.beforeDays += 1;
      } else {
        entry.afterTries += counts.seen;
        entry.afterErrors += counts.errors;
        entry.afterRuns += counts.runs;
        entry.afterDays += 1;
      }

      entry.days.push({ day, side: day.side, seen: counts.seen, errors: counts.errors });
    }
  }

  const isReadable = (e: UnitDaySeries) => e.beforeTries >= FIXED_OBSERVATIONS && e.afterTries >= FIXED_OBSERVATIONS && e.beforeDays >= minDays && e.afterDays >= minDays;
  const readableUnits = [...unitDays.entries()].filter(([, e]) => isReadable(e)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const family = readableUnits.length;

  if (!family) return { slipped: [], family: 0 };

  const dayShiftsFor = (unit: string, entry: UnitDaySeries) => {
    const restTotalTries = unit.length === 2 ? totalPairTries - (entry.beforeTries + entry.afterTries) : totalPairTries;
    const restTotalErrors = unit.length === 2 ? totalPairErrors - (entry.beforeErrors + entry.afterErrors) : totalPairErrors;
    const b0 = clampRate(restTotalErrors / Math.max(1, restTotalTries));
    const logitB0 = logit(b0);

    const raw = entry.days.map((d) => {
      const ownT = unit.length === 2 ? d.seen : 0;
      const ownE = unit.length === 2 ? d.errors : 0;
      const rT = Math.max(0, d.day.pairTries - ownT);
      const rE = Math.max(0, d.day.pairErrors - ownE);
      const bd = clampRate((rE + FIXED_OBSERVATIONS * b0) / (rT + FIXED_OBSERVATIONS));

      return { ...d, delta: logit(bd) - logitB0 };
    });

    const wMean = (side: 'before' | 'after') => {
      const part = raw.filter((d) => d.side === side);
      const w = part.reduce((s, d) => s + d.seen, 0);

      return w > 0 ? part.reduce((s, d) => s + d.seen * d.delta, 0) / w : 0;
    };

    const bump = Math.max(0, wMean('before') - wMean('after'));

    return bump > 0 ? raw.map((d) => (d.side === 'after' ? { ...d, delta: d.delta + bump } : d)) : raw;
  };

  let num = 0;
  let den = 0;

  for (const [unit, entry] of readableUnits) {
    if (unit.length !== 2 || entry.beforeDays < 3) continue;
    const shifts = dayShiftsFor(unit, entry).filter((d) => d.side === 'before');
    const theta = solveProfileTheta(shifts, entry.beforeErrors);
    const dfCorr = shifts.length / Math.max(1, shifts.length - 1);

    for (const d of shifts) {
      const p = sigmoid(theta + d.delta);
      const v = d.seen * p * (1 - p);
      const x = d.errors - d.seen * p;
      num += dfCorr * x * x - v;
      den += v * v;
    }
  }

  const tau2 = den > 0 ? Math.max(0, num / den) : 0;
  const threshold = alpha / family;
  const slipped: DetectedSlip[] = [];

  for (const [unit, entry] of readableUnits) {
    if (queuedNow && !queuedNow.has(unit)) continue;

    if (!(entry.afterErrors / entry.afterTries > entry.beforeErrors / entry.beforeTries)) continue;
    const shifts = dayShiftsFor(unit, entry);
    const theta = solveProfileTheta(shifts, entry.beforeErrors + entry.afterErrors);

    const afterDays: ((typeof shifts)[number] & { x: number; v: number })[] = [];
    const beforeDays: ((typeof shifts)[number] & { x: number; v: number })[] = [];
    let S = 0;
    let VA = 0;
    let VB = 0;

    for (const d of shifts) {
      const p = sigmoid(theta + d.delta);
      const v = d.seen * p * (1 - p);
      const x = d.errors - d.seen * p;

      if (d.side === 'after') {
        S += x;
        VA += v;
        afterDays.push({ ...d, x, v });
      } else {
        VB += v;
        beforeDays.push({ ...d, x, v });
      }
    }

    if (!(S > 0) || !(VA > 0) || !(VB > 0)) continue;

    if (afterDays.filter((d) => d.x > 0).length < 2) continue;

    const dB = beforeDays.length;
    const dfU = Math.max(0, dB - 1);
    let tau2Mod = tau2;

    if (dfU >= 1) {
      const thetaB = solveProfileTheta(beforeDays, entry.beforeErrors);
      const corrB = dB / dfU;
      let numU = 0;
      let denU = 0;

      for (const d of beforeDays) {
        const p = sigmoid(thetaB + d.delta);
        const v = d.seen * p * (1 - p);
        const x = d.errors - d.seen * p;
        numU += corrB * x * x - v;
        denU += v * v;
      }

      const tau2U = denU > 0 ? Math.max(0, numU / denU) : 0;
      tau2Mod = Math.max(tau2, (priorDf * tau2 + dfU * tau2U) / (priorDf + dfU));
    }

    const Vtot = VA + VB;
    const wA = VB / Vtot;
    const wB = VA / Vtot;
    const Vbinom = (VA * VB) / Vtot;
    const VAmod = afterDays.reduce((s, d) => s + d.v + tau2Mod * d.v * d.v, 0);
    const VBmod = beforeDays.reduce((s, d) => s + d.v + tau2Mod * d.v * d.v, 0);
    const Vmod = Math.max(Vbinom, wA * wA * VAmod + wB * wB * VBmod);

    if (!(tUpperTail(S / Math.sqrt(Vmod), priorDf + dfU) < threshold)) continue;

    if (lodoZ > 0) {
      let worstIdx = 0;

      for (let i = 1; i < afterDays.length; i += 1) {
        if (indexed(afterDays, i).x > indexed(afterDays, worstIdx).x) worstIdx = i;
      }

      const keepDays = [...beforeDays, ...afterDays.filter((_, i) => i !== worstIdx)];
      const keepErrors = keepDays.reduce((s, d) => s + d.errors, 0);
      const thL = solveProfileTheta(keepDays, keepErrors);
      let SL = 0;
      let VAL = 0;
      let VBL = 0;
      let VALm = 0;
      let VBLm = 0;

      for (const d of keepDays) {
        const p = sigmoid(thL + d.delta);
        const v = d.seen * p * (1 - p);
        const x = d.errors - d.seen * p;
        const vm = v + tau2Mod * v * v;

        if (d.side === 'after') {
          SL += x;
          VAL += v;
          VALm += vm;
        } else {
          VBL += v;
          VBLm += vm;
        }
      }

      if (!(SL > 0) || !(VAL > 0) || !(VBL > 0)) continue;
      const VtL = VAL + VBL;
      const wAL = VBL / VtL;
      const wBL = VAL / VtL;
      const VmL = Math.max((VAL * VBL) / VtL, wAL * wAL * VALm + wBL * wBL * VBLm);

      if (SL / Math.sqrt(VmL) < lodoZ) continue;
    }

    slipped.push({
      unit,
      before: { runs: entry.beforeRuns, tries: entry.beforeTries, errors: entry.beforeErrors, days: entry.beforeDays },
      after: { runs: entry.afterRuns, tries: entry.afterTries, errors: entry.afterErrors, days: entry.afterDays },
    });
  }

  return { slipped, family };
}

// Units slipping since `began` on one keyboard in one focus, ranked by the rise in learner gain since `began`
// (ADR 0031). Pure engine exported for UI hookup once Progress's visible presentation is reviewed (DESIGN.md).
export function weekSlips({ runs, keyboard, focus, now, began }: { runs: readonly unknown[]; keyboard: string; focus: string; now: number; began: number }): Slip[] {
  const variant = LEARNER_VARIANTS[DEFAULT_POLICY];
  const read = variant.letGoVersion === 3 ? runs : retainRuns(analysisRuns(runs), { drills: false });
  const records = learnerEvidence(read, keyboard);
  const earlier = records.filter((record) => record.at === null || record.at < began);
  const [modelNow, modelThen] = [fitLearner(records, now, variant, focus), fitLearner(earlier, began, variant, focus)];
  const queuedNow = new Set(learnerRecommendation(modelNow).queue.map((item) => item.unit));
  const gains = (model: LearnerModel) => new Map(model.units.map((unit) => [unit.unit, unit.gain]));
  const [gainNow, gainThen] = [gains(modelNow), gains(modelThen)];
  const { slipped } = detectSlips(records, began, queuedNow);

  return slipped
    .map(({ unit, before, after }): Slip => ({ unit, basis: 'errors', before, after, weight: Math.abs((gainNow.get(unit) || 0) - (gainThen.get(unit) || 0)) }))
    .sort((a, b) => b.weight - a.weight || (a.unit < b.unit ? -1 : 1));
}

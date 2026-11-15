import { analysisRuns } from './domain-history.js';
import { evidenceRun } from './insights.js';
import { keyboardOf, measuredInterval } from './learner.js';
import type { Basis, Estimate, LearnerModel, TargetEvidence } from './learner.js';
import type { TargetCounts } from './profile-types.js';
import type { BehindStep, trainPath } from './train-path.js';
import { CHARS_PER_WORD } from './typing.js';
import { speedValue } from './units.js';

// Train's figures (TOB-470): what each step still to do costs in speed, and what each drilled step won back. Pure: no
// DOM, clock, storage or randomness. It labels the learner's queue and never reorders it.
//
//   TrainFigures = { pace, current: Todo | null, ahead: Todo[], behind: Drilled[], won }
//   Todo    = { unit, kind, basis, cost, missed, slower, frequency, timings }, for the open step and each step ahead
//   Drilled = { unit, state, basis, won, now, before }, for each step behind you, in trainPath's order
//
// Cost is speed: the wpm a unit takes from the person, the wpm they would gain if it took no longer than any other
// letter. `pace` is their ms a character at their recent median speed and `lost` the ms the unit costs on every letter
// they type, so cost = wpm at (pace − lost) − wpm at pace. A step to do loses what the learner ranks it by: its gain
// (misses a letter typed, above the person's typical rate, with slowness counted in misses) times the intervals a miss
// costs, times the pace. The cost rises with the gain alone, so it keeps the learner's order, and it reads the basis
// the focus ranked on. A drilled step won back its cost before the drill less its cost on the retest, by the same
// formula, from the loop's own read-back: misses above the typical rate, or ms slower than the pace.

export const PACE_RUNS = 10;

export interface Pace { wpm: number; ms: number }

export interface Frequency { every: number; perMinute: number | null }

export interface Slower { ms: number; own: number | null; pace: number | null }

export interface Dot { ms: number; left: number; stack: number }

export interface Timings { unit: string; runs: number; intervals: number; pace: number; own: number; low: number; high: number; dots: Dot[]; tall: number }

export interface Todo { unit: string; kind: 'key' | 'pair'; basis: Basis; cost: number | null; missed: { errors: number; tries: number; runs: number } | null; slower: Slower | null; frequency: Frequency; timings: Timings | null }

export type Read = { basis: 'errors'; errors: number; tries: number } | { basis: 'slow'; ms: number };

export interface Drilled { unit: string; state: string; basis: Basis; won: number | null; now: { read: Read; since: boolean } | null; before: Read | null }

export interface TrainFigures { pace: Pace | null; current: Todo | null; ahead: Todo[]; behind: Drilled[]; won: number | null }

interface Interval { pairMs: number; runMs: number; timed: number }

const MS_PER_MINUTE = 60_000;
const wpmAt = (ms: number) => MS_PER_MINUTE / CHARS_PER_WORD / ms;

// The dot plot: its axis steps, the room past the outermost mark as a share of the span (so a mark's label stays
// inside), the narrowest span it draws, how far past the pace a run's median may sit before it is drawn at the edge,
// and how wide a stack of dots is, as a share of the axis.
const PLOT_STEP = 20;
const PLOT_ROOM = 0.15;
const PLOT_SPAN = 100;
const PLOT_REACH = 4;
const DOT_SLOT = 1.6;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 ? sorted[mid] ?? NaN : ((sorted[mid - 1] ?? NaN) + (sorted[mid] ?? NaN)) / 2;
};

const byDate = <T extends { at?: string | null; id?: string }>(a: T, b: T) => (Date.parse(a.at ?? '') || 0) - (Date.parse(b.at ?? '') || 0) || ((a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0);

// The runs the learner reads on this keyboard (evidenceRun's rule), oldest first, each id once.
function measuredRuns(runs: readonly unknown[], keyboard: string) {
  const seen = new Set<string>();

  return analysisRuns(runs).filter((run) => evidenceRun(run) && keyboardOf(run.conditions) === keyboard).sort(byDate).filter((run) => {
    const id = String(run.id);

    if (seen.has(id)) return false;
    seen.add(id);

    return true;
  });
}

// The person's speed: the median wpm of their newest PACE_RUNS measured runs on this keyboard, and its ms a character.
export function paceOf(runs: readonly unknown[], keyboard: string): Pace | null {
  const speeds = measuredRuns(runs, keyboard).slice(-PACE_RUNS).map((run) => run.score?.wpm ?? NaN).filter((wpm) => Number.isFinite(wpm) && wpm > 0);

  if (!speeds.length) return null;
  const wpm = median(speeds);

  return { wpm, ms: MS_PER_MINUTE / CHARS_PER_WORD / wpm };
}

// The wpm a unit takes when it loses `lost` ms on every letter typed. Null without a pace, or when the loss is a whole
// letter's time or more, where the formula has no finite answer.
export function wpmCost(lost: number, pace: Pace | null) {
  if (!pace || !(lost >= 0) || lost >= pace.ms) return null;

  return wpmAt(pace.ms - lost) - wpmAt(pace.ms);
}

// Each pair's timed runs, oldest first: its median clean interval and the run's, as the learner measures them.
export function pairIntervals(runs: readonly unknown[], keyboard: string) {
  const byPair = new Map<string, Interval[]>();

  for (const run of measuredRuns(runs, keyboard)) {
    for (const [pair, , , timed, pairMs, slowdownMs] of run.patterns ?? []) {
      const measured = /^[a-z]{2}$/.test(pair) ? measuredInterval(timed, pairMs, slowdownMs) : null;

      if (!measured) continue;
      const list = byPair.get(pair) ?? [];
      list.push({ ...measured, timed });
      byPair.set(pair, list);
    }
  }

  return byPair;
}

// One dot per timed run at the pair's median interval in it, against the person's pace over those runs. The pair's own
// mark sits `slowerMs` past the pace, the figure the page prints, so the two always agree. Dots that share a slot stack.
export function timingsOf(unit: string, intervals: Interval[] | undefined, slowerMs: number | null): Timings | null {
  if (!intervals?.length) return null;
  const timed = intervals.reduce((sum, row) => sum + row.timed, 0);
  const pace = Math.round(intervals.reduce((sum, row) => sum + row.timed * row.runMs, 0) / timed);
  const own = pace + Math.round(slowerMs ?? intervals.reduce((sum, row) => sum + row.timed * (row.pairMs - row.runMs), 0) / timed);
  const medians = intervals.map((row) => row.pairMs);
  const bottom = Math.min(pace, own, ...medians);
  const top = Math.max(pace, own, Math.min(pace * PLOT_REACH, Math.max(...medians)));
  const room = Math.max(PLOT_STEP / 2, (top - bottom) * PLOT_ROOM);
  const low = Math.max(0, Math.floor((bottom - room) / PLOT_STEP) * PLOT_STEP);
  const high = Math.max(low + PLOT_SPAN, Math.ceil((top + room) / PLOT_STEP) * PLOT_STEP);
  const stacks = new Map<number, number>();

  const dots = medians.map((ms) => {
    const slot = Math.round(((Math.min(high, Math.max(low, ms)) - low) / (high - low)) * 100 / DOT_SLOT);
    const stack = stacks.get(slot) ?? 0;
    stacks.set(slot, stack + 1);

    return { ms, left: Math.min(100, slot * DOT_SLOT), stack };
  });

  return { unit, runs: intervals.length, intervals: timed, pace, own, low, high, dots, tall: Math.max(...stacks.values()) };
}

// Where on the plot's axis a time sits, as a share of it.
export const plotAt = (timings: Pick<Timings, 'low' | 'high'>, ms: number) => ((Math.min(timings.high, Math.max(timings.low, ms)) - timings.low) / (timings.high - timings.low)) * 100;

export function trainFigures({ model, path, runs, keyboard }: { model: LearnerModel; path: ReturnType<typeof trainPath>; runs: readonly unknown[]; keyboard: string }): TrainFigures {
  const pace = paceOf(runs, keyboard);
  const estimates = new Map<string, Estimate>(model.units.map((estimate) => [estimate.unit, estimate]));
  const intervals = pairIntervals(runs, keyboard);
  const shareOf = (unit: string) => estimates.get(unit)?.frequency ?? null;

  const todo = (unit: string, was: TargetEvidence | null): Todo => {
    const estimate = estimates.get(unit);
    const basis: Basis = was?.basis === 'slow' ? 'slow' : 'errors';
    const share = shareOf(unit) ?? 0;
    const timings = unit.length === 2 ? timingsOf(unit, intervals.get(unit), estimate?.observed.slowMs ?? null) : null;
    const slowMs = Math.round(was?.slowMs ?? 0);

    return {
      unit, kind: unit.length === 1 ? 'key' : 'pair', basis,
      cost: estimate && pace ? wpmCost(estimate.gain * model.missCost * pace.ms, pace) : null,
      missed: basis === 'errors' && was ? { errors: was.errors, tries: was.observations, runs: was.runs ?? 0 } : null,
      slower: basis === 'slow' ? { ms: slowMs, own: timings ? timings.pace + slowMs : null, pace: timings?.pace ?? null } : null,
      frequency: { every: share > 0 ? Math.round(1 / share) : 0, perMinute: pace && share > 0 ? share * pace.wpm * CHARS_PER_WORD : null },
      timings,
    };
  };

  // What one occurrence of a unit loses, in ms: misses above the person's typical rate at missCost intervals each, or
  // its time past the pace. Never less than nothing.
  const occurrence = (read: Read) => {
    if (!pace) return null;

    if (read.basis === 'slow') return Number.isFinite(read.ms) ? Math.max(0, read.ms) : null;

    return read.tries > 0 ? Math.max(0, read.errors / read.tries - model.errorRate) * model.missCost * pace.ms : null;
  };

  const costOf = (unit: string, read: Read) => {
    const ms = occurrence(read);
    const share = shareOf(unit);

    return ms === null || share === null ? null : wpmCost(share * ms, pace);
  };

  const drilled = (step: BehindStep): Drilled => {
    const unit = step.unit ?? '';
    const { retest, before, after } = readsOf(step);
    const [was, now] = retest ? [costOf(unit, retest.was), costOf(unit, retest.now)] : [null, null];

    // The runs since the drill once more than its retest holds the unit, else the retest's own read-back.
    const latest = after && (after.runs > 1 || !retest) ? { read: after.read, since: true } : retest ? { read: retest.now, since: false } : null;

    return { unit, state: step.state, basis: step.basis, won: was !== null && now !== null ? was - now : null, now: latest, before: retest?.was ?? before ?? null };
  };

  const current = path.current.unit ? todo(path.current.unit, path.current.was) : null;
  const behind = path.behind.map(drilled);
  const counts = behind.flatMap((step) => (step.won === null ? [] : [step.won]));

  return { pace, current, ahead: path.ahead.map((step) => todo(step.unit, step.was)), behind, won: counts.length ? counts.reduce((sum, won) => sum + won, 0) : null };
}

// A step behind you as reads of the kind it was drilled for: its retest's read-back, and the runs before its drill and since.
function readsOf(step: BehindStep) {
  if (step.basis === 'slow') {
    const slow = (ms: number): Read => ({ basis: 'slow', ms });
    const { before, after } = step.since;

    return { retest: step.retest && { was: slow(step.retest.was), now: slow(step.retest.now) }, before: before && slow(before.ms), after: after && { runs: after.runs, read: slow(after.ms) } };
  }

  const missed = (errors: number, tries: number): Read => ({ basis: 'errors', errors, tries });
  const counted = (count: TargetCounts) => missed(count.errors, count.observations);
  const { before, after } = step.since;

  return { retest: step.retest && { was: counted(step.retest.was), now: counted(step.retest.now) }, before: before && missed(before.errors, before.tries),
    after: after && { runs: after.runs, read: missed(after.errors, after.tries) } };
}

// A cost in the unit on screen, to one decimal: "0.8", "4.2", "<0.1" for a cost too small to print, "—" for none.
export function costText(wpm: number | null, unit: string) {
  if (wpm === null) return '—';
  const value = speedValue(wpm, unit);

  return value > 0 && value < 0.05 ? '<0.1' : String(Number(value.toFixed(1)));
}

// Speed won back, signed, in the unit on screen: "+1.4", "−0.2", "<0.1" for an amount too small to print either way.
export function wonText(wpm: number, unit: string) {
  const rounded = Number(speedValue(wpm, unit).toFixed(1));

  if (!rounded) return wpm ? '<0.1' : '0';

  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}`;
}

// How often a unit comes up, per minute at the person's speed: whole from ten, else to one decimal.
export const perMinuteText = (perMinute: number) => (perMinute >= 9.95 ? String(Math.round(perMinute)) : String(Number(perMinute.toFixed(1))));

// A read-back as the page prints it: "4/52" or "35 ms".
export const readText = (read: Read) => (read.basis === 'slow' ? `${Math.round(read.ms)}` : `${read.errors}/${read.tries}`);

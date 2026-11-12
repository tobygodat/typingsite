import { at as indexed, entry } from './domain-values.js';
import type { RunRecord, TrainingLoop, TargetCounts } from './profile-types.js';
import type { Basis, EvidenceUnit, LearnerEvidence, Recommendation, TargetEvidence } from './learner.js';

export interface ErrorTally { runs: number; tries: number; errors: number }

export interface SlowTally { runs: number; intervals: number; ms: number }

export type Since = { basis: 'errors'; before: ErrorTally | null; after: ErrorTally | null } | { basis: 'slow'; before: SlowTally | null; after: SlowTally | null };

type Entries = [number, EvidenceUnit][];

export type BehindStep = { unit: string | null; state: string; loopId: string } & ({ basis: 'slow'; retest: { was: number; now: number } | null; since: Extract<Since, { basis: 'slow' }> } | { basis: 'errors'; retest: { was: TargetCounts; now: TargetCounts } | null; since: Extract<Since, { basis: 'errors' }> });

interface CurrentStep { kind: string; unit: string | null; title: string; was: TargetEvidence | null; since: Since | null }
// Train's path (TOB-420): the targets you have drilled behind you, the one to drill now, and the next ones the
// learner queues, as one view of the learner's recommendation and the profile's saved loops. Pure: no DOM, clock,
// storage or randomness, so the same profile and settings give the same path on any device and after any merge.
//
//   Path = { behind: Behind[], just: { unit } | null, current: Current, ahead: Ahead[] }
//   Behind  = { unit, state: 'drilled' | 'fixed', basis: 'errors' | 'slow', retest, since, loopId }, oldest first
//   Current = { kind: 'targeted' | 'general', unit: string | null, title, was, since }
//   Ahead   = { unit, was }, at most AHEAD_STEPS, in the learner's order
//
// `just` is the step whose retest the comparison shows, the newest step behind you, drawn from the comparison
// itself rather than a loop (a retest that wasn't compared saves none).

import { MIN_PATTERN_SAMPLES } from './insights.js';
import { SLOW_FLOOR_MS, keyboardOf, learnerEvidence, paceAgainst, paceCopy, paceShift } from './learner.js';

export const AHEAD_STEPS = 3;

// The rule for "fixed", as the UI contract states it. A target behind you is fixed when the learner no
// longer queues it and at least two runs since its drill hold observations of the kind it was drilled for (first
// tries for a target drilled for its misses, clean intervals for a pair drilled for its pace), at least 20 of them
// between those runs, with no first-try miss among them, or a mean slowdown of 20 ms or less. Otherwise it is drilled.
export const FIXED_RUNS = 2;
export const FIXED_OBSERVATIONS = 2 * MIN_PATTERN_SAMPLES;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const byDate = (a: TrainingLoop, b: TrainingLoop) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// What a loop's target was drilled for. Loops saved before `targetBasis` read a saved pace as slowness.
export const basisOf = (loop: TrainingLoop): Basis => (loop.targetBasis ? loop.targetBasis : loop.targetPace ? 'slow' : 'errors');

// A unit's observed evidence on measured runs on the keyboard, before `split` (ms) and from it on, of one kind: tries
// and misses, or clean intervals and their mean slowdown over the person's pace. `runs` counts only the runs that
// hold an observation of that kind, so a run that typed the pair but timed none of it is no run of pace evidence. A
// side with no observations is null. Undated records belong to neither side.
export function evidenceSince(unit: string | null, basis: Basis, split: number, records: LearnerEvidence[]) {
  const entries: Entries = [];

  for (const record of records) {
    const item = record.at === null ? null : record.units.find((row) => row.unit === unit);

    if (item) entries.push([record.at ?? NaN, item]);
  }

  return tallySince(entries, basis, split);
}

// Every unit's observations in one pass over the records: for each dated record, in order, its first row for the
// unit, as evidenceSince reads it. A path of many loops then reads each record once, not once per loop.
export function evidenceIndex(records: LearnerEvidence[]) {
  const byUnit = new Map<string, Entries>();

  for (const record of records) {
    if (record.at === null) continue;
    const seen = new Set();

    for (const item of record.units) {
      if (seen.has(item.unit)) continue;
      seen.add(item.unit);

      if (!byUnit.has(item.unit)) byUnit.set(item.unit, []);
      entry(byUnit, item.unit).push([record.at, item]);
    }
  }

  return byUnit;
}

// A unit's [at, row] entries, oldest record first, split at `split` and summed of one kind, in one walk. Each side
// adds in record order, so its sums are the same to the last bit as summing that side's rows on their own.
function tallySince(entries: Entries = [], basis: Basis, split: number): Since {
  const slow = basis === 'slow';
  const sides: [{ runs: number; a: number; b: number }, { runs: number; a: number; b: number }] = [{ runs: 0, a: 0, b: 0 }, { runs: 0, a: 0, b: 0 }];

  for (const [at, item] of entries) {
    if (!(slow ? item.timed > 0 : item.seen > 0)) continue;
    const side = at < split ? sides[0] : at >= split ? sides[1] : null;

    if (!side) continue;
    side.runs += 1;
    side.a += slow ? item.timed : item.seen;
    side.b += slow ? item.timed * (item.slowMs ?? 0) : item.errors;
  }

  const errors = ({ runs, a, b }: typeof sides[number]) => (!runs ? null : { runs, tries: a, errors: b });
  const timing = ({ runs, a, b }: typeof sides[number]) => (!runs ? null : { runs, intervals: a, ms: b / a });

  return basis === 'slow' ? { basis, before: timing(sides[0]), after: timing(sides[1]) } : { basis, before: errors(sides[0]), after: errors(sides[1]) };
}

// Where a loop's evidence splits: its retest's date, else the loop's own.
const splitOf = (loop: TrainingLoop, retestAt: string | null | undefined) => Date.parse(retestAt || loop.at);

// A drilled target's evidence, split at its retest: before its drill and from its retest on, of one kind (by default
// the kind it was drilled for).
export function sinceDrilled(loop: TrainingLoop, runs: RunRecord[], records = learnerEvidence(runs, keyboardOf(loop.conditions)), basis = basisOf(loop)) {
  return evidenceSince(loop.target, basis, retestSplit(loop, runs), records);
}

// Where a loop's evidence splits, found among the runs: its retest's date (ms), else the loop's own.
const retestSplit = (loop: TrainingLoop, runs: RunRecord[]) => splitOf(loop, runs.find((run) => run.id === loop.afterAttemptId)?.at);

// The one rule for "fixed" (see FIXED_RUNS). `since` is sinceDrilled's, of the kind the target was drilled for. Train
// asks it of a drilled target, split at its retest; Progress also asks it of a unit never drilled, split where its week
// began (week-change.js), so the two pages share one rule.
export function isFixed(since: Since | null, queued: boolean) {
  if (queued || !since?.after || since.after.runs < FIXED_RUNS) return false;

  return since.basis === 'slow' ? since.after.intervals >= FIXED_OBSERVATIONS && Math.round(since.after.ms) <= SLOW_FLOOR_MS
    : since.after.tries >= FIXED_OBSERVATIONS && since.after.errors === 0;
}

// The loop's own read-back: the retest's misses or pace beside the evidence the drill was chosen on.
function retestOf(loop: TrainingLoop, basis: Basis) {
  if (basis === 'slow') return loop.targetPace ? { was: loop.targetPace.was.slowMs, now: loop.targetPace.now.slowMs } : null;

  return loop.targetMisses ? { was: loop.targetMisses.was, now: loop.targetMisses.now } : null;
}

// The path for a recommendation (recommendFor's, at the conditions Train shows) over the profile's loops and runs.
// `after` is set while the comparison shows: `trained` is the unit just retested (null for a general, adaptive or
// missed-word drill), and the open step is the first queued unit other than it, as the comparison's Next drills.
export function trainPath({ recommendation, loops = [], runs = [], keyboard, after = null }: { recommendation: Recommendation; loops?: TrainingLoop[]; runs?: RunRecord[]; keyboard: string; after?: { trained: string | null } | null }) {
  const queue = recommendation.queue || [];
  const trained = after ? after.trained : null;
  const open = after ? queue.filter((item) => item.unit !== trained) : queue;
  const head = after ? open[0] : recommendation.target ? queue.find((item) => item.unit === recommendation.target) : null;

  const current: CurrentStep = head ? { kind: 'targeted', unit: head.unit, title: `Practice “${head.unit}”`, was: head.was, since: null }
    : { kind: 'general', unit: null, title: 'General drill', was: null, since: null };

  // A general drill names nothing, so nothing waits ahead of it.
  const ahead = head ? open.filter((item) => item.unit !== head.unit).slice(0, AHEAD_STEPS) : [];
  const shown = new Set([current.unit, ...ahead.map((item) => item.unit), trained].filter(Boolean));
  const queued = new Set(queue.map((item) => item.unit));
  // One pass over the runs and one over the evidence, whatever the number of loops (TOB-448). The first run with
  // an id is its retest, as runs.find would pick.
  const index = evidenceIndex(learnerEvidence(runs, keyboard));
  const retestAt = new Map<string, string | null>();

  for (const run of runs) if (!retestAt.has(run.id)) retestAt.set(run.id, run.at);
  const since = (loop: TrainingLoop, basis: Basis) => tallySince(index.get(loop.target ?? ''), basis, splitOf(loop, retestAt.get(loop.afterAttemptId)));

  // Each drilled target once, by its newest loop on this keyboard, newest nearest the open step.
  const newest = new Map<string | null, TrainingLoop>();

  for (const loop of loops.filter((item) => item.target && keyboardOf(item.conditions) === keyboard).sort(byDate)) newest.set(loop.target, loop);

  // The open step's "since you drilled it" line reads the kind of evidence the step is drawn for, whatever its drill was for.
  if (current.unit && newest.has(current.unit)) current.since = since(newest.get(current.unit) ?? indexed(loops, 0), current.was?.basis === 'slow' ? 'slow' : 'errors');

  const behind: BehindStep[] = [...newest.values()].sort(byDate).filter((loop) => !shown.has(loop.target)).map((loop) => {
    const basis = basisOf(loop);
    const evidence = since(loop, basis);
    const common = { unit: loop.target, state: isFixed(evidence, queued.has(loop.target ?? '')) ? 'fixed' : 'drilled', loopId: loop.id };

    return evidence.basis === 'slow'
      ? { ...common, basis: evidence.basis, since: evidence, retest: loop.targetPace ? { was: loop.targetPace.was.slowMs, now: loop.targetPace.now.slowMs } : null }
      : { ...common, basis: evidence.basis, since: evidence, retest: loop.targetMisses ? { was: loop.targetMisses.was, now: loop.targetMisses.now } : null };
  });

  return { behind, just: after ? { unit: trained } : null, current, ahead };
}

export const missedCopy = (count: TargetCounts) => `${count.errors} of ${count.observations}`;

// A named unit's observed evidence, as Train's open step and Patterns across runs print it: its pace for a pair
// named for slowness, else its misses. `all` says the figure reads every run, before a drill and since.
export function evidenceCopy(was: TargetEvidence | null, { all = false } = {}) {
  if (was?.basis === 'slow') {
    return all && (was.timedRuns ?? 0) > 1
      ? `${paceAgainst(was.slowMs ?? null)} across all ${was.timedRuns} runs that timed it, slower in ${was.slowRuns} (${plural(was.timed ?? 0, 'clean interval')})` : paceCopy({ slowMs: was.slowMs ?? null, slowRuns: was.slowRuns ?? 0, timedRuns: was.timedRuns ?? 0, timed: was.timed ?? 0 });
  }

  if (!was?.errors) return '';

  return `${missedCopy(was)} missed${was.runs ? ` ${all && was.runs > 1 ? 'across all' : 'in'} ${plural(was.runs, 'run')}` : ''}`;
}

// A step ahead, quietly: "5 of 40 missed", or "120 ms slower".
export const aheadCopy = (was: TargetEvidence) => (was.basis === 'slow' ? paceShift(was.slowMs ?? null) : `${missedCopy(was)} missed`);

// The open step's "since you drilled it" line: its figure over the runs before the drill and from the retest on. It
// states counts, never a rate (TOB-448): "2 of 6" since a drill reads as the two misses it is, where "33%" read as a
// trend. A pace says how many clean intervals it is read over since, as a step behind you does.
export function sinceCopy(since: Since | null) {
  if (!since) return '';
  const { basis, before, after } = since;

  if (!before || !after) return '';

  if (basis === 'slow') return `${paceShift(before.ms)} → ${paceAgainst(after.ms)} since you drilled it, over ${plural(after.intervals, 'interval')}`;

  return `${before.errors} of ${before.tries} → ${after.errors} of ${after.tries} missed since you drilled it`;
}

// A step behind you: the retest's own read-back, then, once runs after the retest hold it, what they show.
// Without a read-back (loops saved before it existed) the before and since figures stand in for it.
export function behindCopy(step: BehindStep) {
  if (step.basis === 'slow') {
    const { before, after } = step.since;
    const sinceLine = () => after ? `${paceShift(after.ms)} since the drill, over ${plural(after.intervals, 'interval')}` : '';

    if (step.retest) {
      const line = `${paceShift(step.retest.was)} → ${paceShift(step.retest.now)}`;

      return after && after.runs > 1 ? [line, sinceLine()] : [line];
    }

    if (before && after) return [`${paceShift(before.ms)} → ${paceShift(after.ms)} since the drill`];

    return after ? [sinceLine()] : [];
  }

  const errors = step.since;
  const sinceLine = () => errors.after ? `${errors.after.errors} of ${errors.after.tries} missed since the drill` : '';

  if (step.retest) {
    const line = `${missedCopy(step.retest.was)} → ${missedCopy(step.retest.now)} missed`;

    return errors.after && errors.after.runs > 1 ? [line, sinceLine()] : [line];
  }

  const rate = (side: ErrorTally) => `${Math.round((side.errors / side.tries) * 100)}%`;

  if (errors.before && errors.after) return [`${rate(errors.before)} → ${rate(errors.after)} missed since the drill`];

  return errors.after ? [sinceLine()] : [];
}

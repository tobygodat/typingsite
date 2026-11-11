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

// The rule for "fixed", as the UI contract and DESIGN.md state it. A target behind you is fixed when the learner no
// longer queues it and at least two runs since its drill hold observations of the kind it was drilled for (first
// tries for a target drilled for its misses, clean intervals for a pair drilled for its pace), at least 20 of them
// between those runs, with no first-try miss among them, or a mean slowdown of 20 ms or less. Otherwise it is drilled.
export const FIXED_RUNS = 2;
export const FIXED_OBSERVATIONS = 2 * MIN_PATTERN_SAMPLES;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const byDate = (a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// What a loop's target was drilled for. Loops saved before `targetBasis` read a saved pace as slowness.
export const basisOf = (loop) => (loop.targetBasis ? loop.targetBasis : loop.targetPace ? 'slow' : 'errors');

// A unit's observed evidence on measured runs on the keyboard, before `split` (ms) and from it on, of one kind: tries
// and misses, or clean intervals and their mean slowdown over the person's pace. `runs` counts only the runs that
// hold an observation of that kind, so a run that typed the pair but timed none of it is no run of pace evidence. A
// side with no observations is null. Undated records belong to neither side.
export function evidenceSince(unit, basis, split, records) {
  const tally = (side) => {
    const held = side.map((record) => record.units.find((item) => item.unit === unit))
      .filter((item) => item && (basis === 'slow' ? item.timed > 0 : item.seen > 0));

    if (!held.length) return null;
    const sum = (count) => held.reduce((total, item) => total + count(item), 0);

    if (basis === 'slow') {
      const intervals = sum((item) => item.timed);

      return { runs: held.length, intervals, ms: sum((item) => item.timed * item.slowMs) / intervals };
    }

    return { runs: held.length, tries: sum((item) => item.seen), errors: sum((item) => item.errors) };
  };

  const dated = records.filter((record) => record.at !== null);

  return { basis, before: tally(dated.filter((record) => record.at < split)), after: tally(dated.filter((record) => record.at >= split)) };
}

// A drilled target's evidence, split at its retest: before its drill and from its retest on, of one kind (by default
// the kind it was drilled for).
export function sinceDrilled(loop, runs, records = learnerEvidence(runs, keyboardOf(loop.conditions)), basis = basisOf(loop)) {
  const split = Date.parse(runs.find((run) => run.id === loop.afterAttemptId)?.at || loop.at);

  return evidenceSince(loop.target, basis, split, records);
}

// The one rule for "fixed" (see FIXED_RUNS). `since` is sinceDrilled's, of the kind the target was drilled for. Train
// asks it of a drilled target, split at its retest; Progress also asks it of a unit never drilled, split where its week
// began (week-change.js), so the two pages share one rule.
export function isFixed(since, queued) {
  const after = since?.after;

  if (queued || !after || after.runs < FIXED_RUNS) return false;

  return since.basis === 'slow' ? after.intervals >= FIXED_OBSERVATIONS && Math.round(after.ms) <= SLOW_FLOOR_MS
    : after.tries >= FIXED_OBSERVATIONS && after.errors === 0;
}

// The loop's own read-back: the retest's misses or pace beside the evidence the drill was chosen on.
function retestOf(loop, basis) {
  if (basis === 'slow') return loop.targetPace ? { was: loop.targetPace.was.slowMs, now: loop.targetPace.now.slowMs } : null;

  return loop.targetMisses ? { was: loop.targetMisses.was, now: loop.targetMisses.now } : null;
}

// The path for a recommendation (recommendFor's, at the conditions Train shows) over the profile's loops and runs.
// `after` is set while the comparison shows: `trained` is the unit just retested (null for a general, adaptive or
// missed-word drill), and the open step is the first queued unit other than it, as the comparison's Next drills.
export function trainPath({ recommendation, loops = [], runs = [], keyboard, after = null }) {
  const queue = recommendation.queue || [];
  const trained = after ? after.trained : null;
  const open = after ? queue.filter((item) => item.unit !== trained) : queue;
  const head = after ? open[0] : recommendation.target ? queue.find((item) => item.unit === recommendation.target) : null;

  const current = head ? { kind: 'targeted', unit: head.unit, title: `Practice “${head.unit}”`, was: head.was, since: null }
    : { kind: 'general', unit: null, title: 'General drill', was: null, since: null };

  // A general drill names nothing, so nothing waits ahead of it.
  const ahead = head ? open.filter((item) => item.unit !== head.unit).slice(0, AHEAD_STEPS) : [];
  const shown = new Set([current.unit, ...ahead.map((item) => item.unit), trained].filter(Boolean));
  const queued = new Set(queue.map((item) => item.unit));
  const records = learnerEvidence(runs, keyboard);

  // Each drilled target once, by its newest loop on this keyboard, newest nearest the open step.
  const newest = new Map();

  for (const loop of loops.filter((item) => item.target && keyboardOf(item.conditions) === keyboard).sort(byDate)) newest.set(loop.target, loop);

  // The open step's "since you drilled it" line reads the kind of evidence the step is drawn for, whatever its drill was for.
  if (current.unit && newest.has(current.unit)) current.since = sinceDrilled(newest.get(current.unit), runs, records, current.was.basis === 'slow' ? 'slow' : 'errors');

  const behind = [...newest.values()].sort(byDate).filter((loop) => !shown.has(loop.target)).map((loop) => {
    const basis = basisOf(loop);
    const since = sinceDrilled(loop, runs, records);

    return { unit: loop.target, state: isFixed(since, queued.has(loop.target)) ? 'fixed' : 'drilled', basis, retest: retestOf(loop, basis), since, loopId: loop.id };
  });

  return { behind, just: after ? { unit: trained } : null, current, ahead };
}

export const missedCopy = (count) => `${count.errors} of ${count.observations}`;

// A named unit's observed evidence, as Train's open step and Patterns across runs print it: its pace for a pair
// named for slowness, else its misses. `all` says the figure reads every run, before a drill and since.
export function evidenceCopy(was, { all = false } = {}) {
  if (was?.basis === 'slow') {
    return all && was.timedRuns > 1
      ? `${paceAgainst(was.slowMs)} across all ${was.timedRuns} runs that timed it, slower in ${was.slowRuns} (${plural(was.timed, 'clean interval')})` : paceCopy(was);
  }

  if (!was?.errors) return '';

  return `${missedCopy(was)} missed${was.runs ? ` ${all && was.runs > 1 ? 'across all' : 'in'} ${plural(was.runs, 'run')}` : ''}`;
}

// A step ahead, quietly: "5 of 40 missed", or "120 ms slower".
export const aheadCopy = (was) => (was.basis === 'slow' ? paceShift(was.slowMs) : `${missedCopy(was)} missed`);

// The open step's "since you drilled it" line: its figure over the runs before the drill and from the retest on.
export function sinceCopy(since) {
  const { basis, before, after } = since || {};

  if (!before || !after) return '';

  if (basis === 'slow') return `${paceShift(before.ms)} → ${paceAgainst(after.ms)} since you drilled it`;
  const rate = (side) => Math.round((side.errors / side.tries) * 100);

  return `${rate(before)}% → ${rate(after)}% missed since you drilled it`;
}

// A step behind you: the retest's own read-back, then, once runs after the retest hold it, what they show.
// Without a read-back (loops saved before it existed) the before and since figures stand in for it.
export function behindCopy(step) {
  const { basis, retest, since: { before, after } } = step;
  const rate = (side) => `${Math.round((side.errors / side.tries) * 100)}%`;
  const sinceLine = () => (basis === 'slow' ? `${paceShift(after.ms)} since the drill, over ${plural(after.intervals, 'interval')}` : `${after.errors} of ${after.tries} missed since the drill`);

  if (retest) {
    const line = basis === 'slow' ? `${paceShift(retest.was)} → ${paceShift(retest.now)}` : `${missedCopy(retest.was)} → ${missedCopy(retest.now)} missed`;

    return after?.runs > 1 ? [line, sinceLine()] : [line];
  }

  if (before && after) return [basis === 'slow' ? `${paceShift(before.ms)} → ${paceShift(after.ms)} since the drill` : `${rate(before)} → ${rate(after)} missed since the drill`];

  return after ? [sinceLine()] : [];
}

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

// A target drilled behind you is "fixed" only when the learner no longer queues it and the runs since its drill,
// at least two (the retest and one more), hold twice the naming floor of observations of the kind it was drilled
// for that on their own could not name it: no first-try miss in 20 tries, or a mean slowdown at or under the
// 20 ms naming floor over 20 clean intervals. Anything short of that is "drilled".
export const FIXED_RUNS = 2;
export const FIXED_OBSERVATIONS = 2 * MIN_PATTERN_SAMPLES;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const byDate = (a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// What a loop's target was drilled for. Loops saved before `targetBasis` read a saved pace as slowness.
export const basisOf = (loop) => (loop.targetBasis ? loop.targetBasis : loop.targetPace ? 'slow' : 'errors');

// The target's observed evidence on measured runs on the keyboard, before its drill and from its retest on, of the
// kind it was drilled for: tries and misses, or clean intervals and their mean slowdown over the person's pace.
// A side with no observations is null.
export function sinceDrilled(loop, runs, records = learnerEvidence(runs, keyboardOf(loop.conditions))) {
  const split = Date.parse(runs.find((run) => run.id === loop.afterAttemptId)?.at || loop.at);
  const basis = basisOf(loop);

  const tally = (side) => {
    let held = 0;
    let tries = 0;
    let errors = 0;
    let intervals = 0;
    let ms = 0;

    for (const record of side) {
      const unit = record.units.find((item) => item.unit === loop.target);

      if (!unit) continue;
      held += 1;
      tries += unit.seen;
      errors += unit.errors;

      if (unit.slowMs !== null && unit.timed) { intervals += unit.timed; ms += unit.timed * unit.slowMs; }
    }

    if (basis === 'slow') return intervals ? { runs: held, intervals, ms: ms / intervals } : null;

    return tries ? { runs: held, tries, errors } : null;
  };

  const dated = records.filter((record) => record.at !== null);

  return { basis, before: tally(dated.filter((record) => record.at < split)), after: tally(dated.filter((record) => record.at >= split)) };
}

// The one rule for "fixed" (see FIXED_RUNS).
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

  if (current.unit && newest.has(current.unit)) current.since = sinceDrilled(newest.get(current.unit), runs, records);

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
  const sinceLine = () => (basis === 'slow' ? `${paceShift(after.ms)} since, over ${plural(after.intervals, 'interval')}` : `${after.errors} of ${after.tries} missed since`);

  if (retest) {
    const line = basis === 'slow' ? `${paceShift(retest.was)} → ${paceShift(retest.now)}` : `${missedCopy(retest.was)} → ${missedCopy(retest.now)} missed`;

    return after?.runs > 1 ? [line, sinceLine()] : [line];
  }

  if (before && after) return [basis === 'slow' ? `${paceShift(before.ms)} → ${paceShift(after.ms)} since` : `${rate(before)} → ${rate(after)} missed since`];

  return after ? [sinceLine()] : [];
}

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

import { FIXED_OBSERVATIONS, FIXED_RUNS, basisOf, drillSplit, drilledTargets, keyboardOf, learnerEvidence, letGo, letGoIndex, paceAgainst, paceCopy, paceShift } from './learner.js';

// The rule for "fixed" lives with the learner, which lets go by it (ADR 0017); these are its floors and its reading of
// what a loop was drilled for, as Train has always exported them.
export { FIXED_OBSERVATIONS, FIXED_RUNS, basisOf };

export const AHEAD_STEPS = 3;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const byDate = (a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The target's observed evidence on measured runs on the keyboard, before its drill and from its retest on, of one
// kind (by default the kind it was drilled for): tries and misses, or clean intervals and their mean slowdown over the
// person's pace. `runs` counts only the runs that hold an observation of that kind, so a run that typed the pair but
// timed none of it is no run of pace evidence. A side with no observations is null. `letGo` is the learner's rule
// (ADR 0017) for this target, kind and split.
export function sinceDrilled(loop, runs, records = learnerEvidence(runs, keyboardOf(loop.conditions)), basis = basisOf(loop), index = letGoIndex(records)) {
  const split = drillSplit(loop, index);

  const tally = (side) => {
    const held = side.map((record) => record.units.find((item) => item.unit === loop.target))
      .filter((unit) => unit && (basis === 'slow' ? unit.timed > 0 : unit.seen > 0));

    if (!held.length) return null;
    const sum = (count) => held.reduce((total, unit) => total + count(unit), 0);

    if (basis === 'slow') {
      const intervals = sum((unit) => unit.timed);

      return { runs: held.length, intervals, ms: sum((unit) => unit.timed * unit.slowMs) / intervals };
    }

    return { runs: held.length, tries: sum((unit) => unit.seen), errors: sum((unit) => unit.errors) };
  };

  const dated = records.filter((record) => record.at !== null);

  return { basis, before: tally(dated.filter((record) => record.at < split)), after: tally(dated.filter((record) => record.at >= split)),
    letGo: letGo(index, loop.target, basis, split) };
}

// "Fixed", as the UI contract and DESIGN.md state it: the learner's let-go rule (ADR 0017) lets the target go on the
// evidence since its drill, of the kind it was drilled for, and the learner no longer queues it. Otherwise it is
// drilled. `since` is sinceDrilled's, of the kind the target was drilled for.
export const isFixed = (since, queued) => !queued && Boolean(since?.letGo);

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
  const index = letGoIndex(records);

  // Each drilled target once, by its newest loop on this keyboard (the loops the learner lets go by), newest nearest the
  // open step.
  const newest = drilledTargets(loops, keyboard);

  // The open step's "since you drilled it" line reads the kind of evidence the step is drawn for, whatever its drill was for.
  if (current.unit && newest.has(current.unit)) current.since = sinceDrilled(newest.get(current.unit), runs, records, current.was.basis === 'slow' ? 'slow' : 'errors', index);

  const behind = [...newest.values()].sort(byDate).filter((loop) => !shown.has(loop.target)).map((loop) => {
    const basis = basisOf(loop);
    const since = sinceDrilled(loop, runs, records, basis, index);

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

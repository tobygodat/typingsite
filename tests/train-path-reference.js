// trainPath as it stood before it read the evidence in one pass (TOB-448): each loop's "since" rescanned every
// record, and each loop's retest was found by scanning every run. Kept only as the reference that
// train-path.test.js's differential test compares the one-pass version with. Not served, not used by the app.
import { learnerEvidence, keyboardOf } from '../src/learner.js';
import { AHEAD_STEPS, basisOf, isFixed } from '../src/train-path.js';

const byDate = (a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

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

export function sinceDrilled(loop, runs, records = learnerEvidence(runs, keyboardOf(loop.conditions)), basis = basisOf(loop)) {
  const split = Date.parse(runs.find((run) => run.id === loop.afterAttemptId)?.at || loop.at);

  return evidenceSince(loop.target, basis, split, records);
}

function retestOf(loop, basis) {
  if (basis === 'slow') return loop.targetPace ? { was: loop.targetPace.was.slowMs, now: loop.targetPace.now.slowMs } : null;

  return loop.targetMisses ? { was: loop.targetMisses.was, now: loop.targetMisses.now } : null;
}

export function trainPath({ recommendation, loops = [], runs = [], keyboard, after = null }) {
  const queue = recommendation.queue || [];
  const trained = after ? after.trained : null;
  const open = after ? queue.filter((item) => item.unit !== trained) : queue;
  const head = after ? open[0] : recommendation.target ? queue.find((item) => item.unit === recommendation.target) : null;

  const current = head ? { kind: 'targeted', unit: head.unit, title: `Practice “${head.unit}”`, was: head.was, since: null }
    : { kind: 'general', unit: null, title: 'General drill', was: null, since: null };

  const ahead = head ? open.filter((item) => item.unit !== head.unit).slice(0, AHEAD_STEPS) : [];
  const shown = new Set([current.unit, ...ahead.map((item) => item.unit), trained].filter(Boolean));
  const queued = new Set(queue.map((item) => item.unit));
  const records = learnerEvidence(runs, keyboard);
  const newest = new Map();

  for (const loop of loops.filter((item) => item.target && keyboardOf(item.conditions) === keyboard).sort(byDate)) newest.set(loop.target, loop);

  if (current.unit && newest.has(current.unit)) current.since = sinceDrilled(newest.get(current.unit), runs, records, current.was.basis === 'slow' ? 'slow' : 'errors');

  const behind = [...newest.values()].sort(byDate).filter((loop) => !shown.has(loop.target)).map((loop) => {
    const basis = basisOf(loop);
    const since = sinceDrilled(loop, runs, records);

    return { unit: loop.target, state: isFixed(since, queued.has(loop.target)) ? 'fixed' : 'drilled', basis, retest: retestOf(loop, basis), since, loopId: loop.id };
  });

  return { behind, just: after ? { unit: trained } : null, current, ahead };
}

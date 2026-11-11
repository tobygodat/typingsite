// Progress's overview (TOB-420, "What changed"): what changed since last week, and what moved it, as one value
// built from the profile's runs and loops, the train focus and `now`. Pure: no DOM, storage or randomness, and no
// clock but `now`, so the same history and settings give the same overview on any device and after any merge.
//
//   WeekChange = { lead: Lead, movers: Mover[], practice: Practice | null, charts: { runs, window }, recommendation }
//   Lead     = { state, current: Week, previous: Week, latest: run | null }
//     state  = 'change'    both weeks hold a median: the change is current.median - previous.median
//            | 'this-week' only this week does
//            | 'last-week' only the week before does
//            | 'thin'      runs in the fortnight, but neither week holds a median: `latest` is the newest of them
//            | 'none'      no runs at these conditions in the fortnight
//     Week   = { median: wpm | null, count, accuracy: % | null }
//   Mover    = { unit, status: 'fixed' | 'slipping', basis: 'errors' | 'slow', before: Tally, after: Tally, split, weight }
//     split  = 'drill' (before its drill, from its retest on) | 'week' (before this week, this week)
//     Tally  = { runs, tries, errors } (errors) | { runs, intervals, ms } (slow), observed counts only
//   Practice = { status: 'more' | 'less' | 'same', current: minutes, previous: minutes, streak, goal }
//
// The lead compares fresh-text runs at one condition key, a week against the week before (weeklyChange). The movers
// read every measured run on that key's keyboard, as Train does, in the train focus.

import { filterRuns, minutesByDay, periodDays, periodWindow, practiceStreak, runDay, trendRun, weeklyChange } from './insights.js';
import { DEFAULT_POLICY, LEARNER_VARIANTS, SLOW_FLOOR_MS, fitLearner, keyboardOf, learnerEvidence, learnerRecommendation, paceShift } from './learner.js';
import { FIXED_OBSERVATIONS, FIXED_RUNS, evidenceSince, isFixed, sinceDrilled } from './train-path.js';

// A week holds a median from this many runs, the floor the standard score's median uses: below it one or two runs
// would stand in for a week.
export const WEEK_MIN_RUNS = 3;

// The overview lists this many units, so the lead and the list fit one screen at 1280 × 800. The rest wait behind
// one quiet "more" control on the same list.
export const SHOWN_MOVERS = 3;

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const weekOf = (runs) => {
  const settled = runs.length >= WEEK_MIN_RUNS;

  return { count: runs.length, median: settled ? median(runs.map((run) => run.score.wpm)) : null, accuracy: settled ? median(runs.map((run) => run.score.accuracy)) : null };
};

// The lead: this week against the week before, at one condition key, by weeklyChange's weeks (today and the six
// days before, then the seven before those). A week without WEEK_MIN_RUNS runs has no median, so no change is
// stated from it.
export function weekLead(runs, key, date) {
  const { current, previous } = key ? weeklyChange(runs, key, date) : { current: [], previous: [] };
  const [now, before] = [weekOf(current), weekOf(previous)];

  const state = now.median !== null && before.median !== null ? 'change' : now.median !== null ? 'this-week' : before.median !== null ? 'last-week'
    : current.length || previous.length ? 'thin' : 'none';

  const latest = [...current, ...previous].reduce((last, run) => (!last || (run.at || '') > (last.at || '') ? run : last), null);

  return { state, current: now, previous: before, latest };
}

// When this week began: midnight at the start of the lead's week, the moment "a week ago" is read at.
export const weekStart = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() - 6).getTime();

const enough = (side, basis) => Boolean(side) && (basis === 'slow' ? side.intervals : side.tries) >= FIXED_OBSERVATIONS;

// A slip is more than noise. For misses: SLIP_MISSES first tries missed since, and a miss rate above the one before
// by more than chance gives two samples of these sizes (the two-proportion z statistic, pooled, at SLIP_Z or more:
// one side, 95%). For pace: a printed slowdown past SLOW_FLOOR_MS, the floor fixed reads, and SLOW_FLOOR_MS or more
// slower than before.
export const SLIP_MISSES = 3;
export const SLIP_Z = 1.645;

function risen(before, after) {
  const pooled = (before.errors + after.errors) / (before.tries + after.tries);
  const rise = after.errors / after.tries - before.errors / before.tries;

  return rise > 0 && rise >= SLIP_Z * Math.sqrt(pooled * (1 - pooled) * (1 / before.tries + 1 / after.tries));
}

const worse = ({ basis, before, after }) => (basis === 'slow'
  ? Math.round(after.ms) > SLOW_FLOOR_MS && after.ms - before.ms >= SLOW_FLOOR_MS
  : after.errors >= SLIP_MISSES && risen(before, after));

// Slipping is held to the bar fixed is: FIXED_OBSERVATIONS of its kind since, over FIXED_RUNS runs or more, and
// worse than before by more than noise. One typo this week, a 2 ms change, or a unit that only moved up the
// queue, is not a slip.
const slipped = (since) => enough(since.after, since.basis) && since.after.runs >= FIXED_RUNS && Boolean(since.before) && worse(since);

const byDate = (a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const basisNamed = (item) => (item?.was?.basis === 'slow' ? 'slow' : 'errors');

// The units whose state changed between `began` and now, on one keyboard, in one focus. "A week ago" is the learner
// built on the history as it stood then (the same fold, given only the earlier evidence and `began`), never a second
// set of rules.
//  - fixed: Train's isFixed now and not then. A drilled unit is judged as Train judges it, since its drill; a unit
//    never drilled, named then and not now, is judged since `began`.
//  - slipping: named now, after it could not be named then on FIXED_OBSERVATIONS of its kind; or Train called it
//    fixed then and it is named again. Either way only on FIXED_OBSERVATIONS of its kind since `began`, over
//    FIXED_RUNS runs or more, that are worse than the evidence before by more than noise (see `worse`).
// Ranked by what each cost or saved in the learner's terms: the change in its gain, the time it loses per letter
// typed, between the two fits. Largest first, then by unit.
export function weekMovers({ runs, loops = [], keyboard, focus, now, began }) {
  const variant = LEARNER_VARIANTS[DEFAULT_POLICY];
  const records = learnerEvidence(runs, keyboard);
  const earlier = records.filter((record) => record.at === null || record.at < began);
  const [modelNow, modelThen] = [fitLearner(records, now, variant, focus), fitLearner(earlier, began, variant, focus)];
  const [recommendation, before] = [learnerRecommendation(modelNow), learnerRecommendation(modelThen)];
  const queuedNow = new Map(recommendation.queue.map((item) => [item.unit, item]));
  const queuedThen = new Map(before.queue.map((item) => [item.unit, item]));
  const gains = (model) => new Map(model.units.map((unit) => [unit.unit, unit.gain]));
  const [gainNow, gainThen] = [gains(modelNow), gains(modelThen)];
  const drilledNow = new Map();
  const drilledThen = new Map();

  for (const loop of loops.filter((item) => item.target && keyboardOf(item.conditions) === keyboard).sort(byDate)) {
    drilledNow.set(loop.target, loop);

    if (Date.parse(loop.at) < began) drilledThen.set(loop.target, loop);
  }

  // A mover is a before → after, so it needs observations on both sides; without them the list says nothing of it.
  const movers = [];

  const add = (unit, status, since, split) => since.before && since.after && movers.push({ unit, status, basis: since.basis, before: since.before, after: since.after, split,
    weight: Math.abs((gainNow.get(unit) || 0) - (gainThen.get(unit) || 0)) });

  for (const unit of [...new Set([...queuedNow.keys(), ...queuedThen.keys(), ...drilledNow.keys()])].sort()) {
    const loop = drilledNow.get(unit);
    const fixedThen = drilledThen.has(unit) && isFixed(sinceDrilled(drilledThen.get(unit), runs, earlier), queuedThen.has(unit));

    if (loop) {
      const since = sinceDrilled(loop, runs, records);

      if (isFixed(since, queuedNow.has(unit))) {
        if (!fixedThen) add(unit, 'fixed', since, 'drill');
        continue;
      }
    } else if (queuedThen.has(unit) && !queuedNow.has(unit)) {
      const since = evidenceSince(unit, basisNamed(queuedThen.get(unit)), began, records);

      if (isFixed(since, false)) add(unit, 'fixed', since, 'week');
      continue;
    }

    if (!queuedNow.has(unit)) continue;
    const since = evidenceSince(unit, basisNamed(queuedNow.get(unit)), began, records);

    if (slipped(since) && (fixedThen || (!queuedThen.has(unit) && enough(since.before, since.basis)))) add(unit, 'slipping', since, 'week');
  }

  movers.sort((a, b) => b.weight - a.weight || (a.unit < b.unit ? -1 : 1));

  return { movers, recommendation };
}

// Minutes practised this week and the week before (every kind of practice, as the calendar counts it), and the
// streak ending today. Null when neither week has any.
export function weekPractice(runs, practiceDays, goal, date) {
  const byDay = minutesByDay(runs, practiceDays);
  const fortnight = periodDays(14, date);
  // Each day's minutes are a division, so the week's sum is rounded to a microminute before it is floored for print.
  const sum = (days) => Math.round(days.reduce((total, day) => total + (byDay[day] || 0), 0) * 1e6) / 1e6;
  const [previous, current] = [sum(fortnight.slice(0, 7)), sum(fortnight.slice(7))];

  if (!(previous > 0) && !(current > 0)) return null;
  const [now, was] = [Math.floor(current), Math.floor(previous)];

  return { status: now > was ? 'more' : now < was ? 'less' : 'same', current, previous, streak: practiceStreak(byDay, goal, date), goal };
}

export function weekChange({ runs = [], loops = [], practiceDays = {}, key = '', conditions = null, focus, goal = 0, period = '30', now }) {
  const date = new Date(now);
  const trend = runs.filter(trendRun);
  const charted = key ? filterRuns(trend, key, periodWindow(period, date)) : [];
  const first = charted.map(runDay).filter(Boolean).sort()[0] || null;

  const { movers, recommendation } = conditions
    ? weekMovers({ runs, loops, keyboard: keyboardOf(conditions), focus, now, began: weekStart(date) })
    : { movers: [], recommendation: null };

  return {
    lead: weekLead(runs, key, date),
    movers,
    practice: weekPractice(runs, practiceDays, goal, date),
    charts: { runs: charted, window: periodWindow(period, date, first) },
    recommendation,
  };
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// A mover's before and after, as the list prints them: counts for misses ("6 of 22", "1 of 25", "missed"), the
// pace against the person's own for slowness ("180 ms slower", "at your pace"). Never a zero or negative amount
// as slower.
export function moverCopy({ basis, before, after }) {
  if (basis === 'slow') return { before: paceShift(before.ms), after: paceShift(after.ms), tail: '' };

  return { before: `${before.errors} of ${before.tries}`, after: `${after.errors} of ${after.tries}`, tail: 'missed' };
}

// What a mover's figures are counted over: "before your drill, then 31 tries in 3 runs since", or the same split at
// the start of this week.
export function moverSample({ basis, before, after, split }) {
  const counted = (side) => (basis === 'slow' ? plural(side.intervals, 'clean interval') : `${side.tries} ${side.tries === 1 ? 'try' : 'tries'}`);
  const [was, since] = split === 'drill' ? ['before your drill', 'since'] : ['before this week', 'this week'];

  return `${counted(before)} in ${plural(before.runs, 'run')} ${was}, ${counted(after)} in ${plural(after.runs, 'run')} ${since}`;
}

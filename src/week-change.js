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

import { filterRuns, minutesByDay, periodDays, periodWindow, practiceStreak, runDay, trendRun, trimmedSince, weeklyChange } from './insights.js';
import { DEFAULT_POLICY, LEARNER_VARIANTS, fitLearner, keyboardOf, learnerEvidence, learnerRecommendation, paceShift } from './learner.js';
import { retestSplit, evidenceSince, isFixed, sinceDrilled } from './train-path.js';

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

const byDate = (a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const basisNamed = (item) => (item?.was?.basis === 'slow' ? 'slow' : 'errors');

// The units fixed between `began` and now, on one keyboard, in one focus: Train's isFixed now and not then. A drilled
// unit is judged as Train judges it, since its drill; a unit never drilled, named a week ago and not now, is judged
// since `began`. "A week ago" is the learner built on the history as it stood then (the same fold, given only the
// earlier evidence and `began`), never a second set of rules. Ranked by what each saved in the learner's terms: the
// change in its gain, the time it loses per letter typed, between the two fits. Largest first, then by unit.
//
// A profile past MAX_PATTERN_RUNS keeps counts on its newest runs only, so runs that fed the learner a week ago can
// have lost theirs since (trimmedSince), and the learner a week ago can't be rebuilt (TOB-448). Then only what needs
// no learner a week ago is listed: a unit drilled this week, or one whose evidence from its drill to the week's start
// is all still held and already fell short of the rule then. A unit judged since `began` needs the learner a week ago
// to have named it, so none is listed.
export function weekMovers({ runs, loops = [], keyboard, focus, now, began }) {
  const variant = LEARNER_VARIANTS[DEFAULT_POLICY];
  const lost = trimmedSince(runs, began).filter((run) => keyboardOf(run.conditions) === keyboard);
  const records = learnerEvidence(runs, keyboard);
  const earlier = records.filter((record) => record.at === null || record.at < began);
  const [modelNow, modelThen] = [fitLearner(records, now, variant, focus), fitLearner(earlier, began, variant, focus)];
  const queuedNow = new Set(learnerRecommendation(modelNow).queue.map((item) => item.unit));
  const queuedThen = new Map(learnerRecommendation(modelThen).queue.map((item) => [item.unit, item]));
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

  const add = (unit, since, split) => since.before && since.after && movers.push({ unit, basis: since.basis, before: since.before, after: since.after, split,
    weight: Math.abs((gainNow.get(unit) || 0) - (gainThen.get(unit) || 0)) });

  for (const unit of [...new Set([...queuedThen.keys(), ...drilledNow.keys()])].sort()) {
    const loop = drilledNow.get(unit);
    const then = drilledThen.get(unit);
    const sinceThen = then ? sinceDrilled(then, runs, earlier) : null;
    const fixedThen = Boolean(then) && isFixed(sinceThen, queuedThen.has(unit));

    // Not fixed a week ago, as far as the stored history can say: drilled since, or short of the rule on evidence alone.
    const notFixedThen = !then || (!lost.some((run) => Date.parse(run.at) >= retestSplit(then, runs)) && !isFixed(sinceThen, false));

    if (loop) {
      const since = sinceDrilled(loop, runs, records);

      if (isFixed(since, queuedNow.has(unit)) && !fixedThen && (!lost.length || notFixedThen)) add(unit, since, 'drill');
    } else if (!lost.length && queuedThen.has(unit) && !queuedNow.has(unit)) {
      const since = evidenceSince(unit, basisNamed(queuedThen.get(unit)), began, records);

      if (isFixed(since, false)) add(unit, since, 'week');
    }
  }

  return movers.sort((a, b) => b.weight - a.weight || (a.unit < b.unit ? -1 : 1));
}

// Minutes practised this week and the week before (every kind of practice, as the calendar counts it), and the
// streak ending today. Null when neither week has any.
export function weekPractice(runs, practiceDays, goal, date) {
  const byDay = minutesByDay(runs, practiceDays);
  const fortnight = periodDays(14, date);
  // Each day's minutes are a division, so the week's sum is rounded to a microminute before it is read for print.
  const sum = (days) => Math.round(days.reduce((total, day) => total + (byDay[day] || 0), 0) * 1e6) / 1e6;
  const [previous, current] = [sum(fortnight.slice(0, 7)), sum(fortnight.slice(7))];

  if (!(previous > 0) && !(current > 0)) return null;
  // The status follows the figures the row prints (goalMinutes): none, under a minute, then whole minutes. So a
  // first half-minute after an empty week is more, not the same.
  const printed = (minutes) => (minutes > 0 && minutes < 1 ? 0.5 : Math.floor(minutes));
  const [now, was] = [printed(current), printed(previous)];

  return { status: now > was ? 'more' : now < was ? 'less' : 'same', current, previous, streak: practiceStreak(byDay, goal, date), goal };
}

export function weekChange({ runs = [], loops = [], practiceDays = {}, key = '', conditions = null, focus, goal = 0, period = '30', now }) {
  const date = new Date(now);
  const trend = runs.filter(trendRun);
  const charted = key ? filterRuns(trend, key, periodWindow(period, date)) : [];
  const first = charted.map(runDay).filter(Boolean).sort()[0] || null;

  return {
    lead: weekLead(runs, key, date),
    movers: conditions ? weekMovers({ runs, loops, keyboard: keyboardOf(conditions), focus, now, began: weekStart(date) }) : [],
    practice: weekPractice(runs, practiceDays, goal, date),
    charts: { runs: charted, window: periodWindow(period, date, first) },
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

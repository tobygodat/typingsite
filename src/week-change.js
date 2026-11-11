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
import { DEFAULT_POLICY, LEARNER_VARIANTS, fitLearner, keyboardOf, learnerEvidence, learnerRecommendation, paceShift } from './learner.js';
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

// A slip is a claim, so it has to be more than noise, however much someone types. It is made of misses only: pace
// has no spread recorded to test against, so the list says nothing of a pair for getting slower.
//
// The test: had this unit's odds of a miss changed since `began` only as the rest of the week's typing did, how
// often would this many of its misses fall since? (Fisher's exact test, one side, against the week's own odds
// ratio.) A bad week raises every pair together, and that is no slip of any one of them, so a unit has to be worse
// than its week.
// Every unit read on both sides is such a question, and the more someone types the more of them there are, so each
// is held to SLIP_CHANCE divided by how many there are (Bonferroni). Being named by the learner only narrows the
// list further; it never makes a slip. What it does to people is measured in tests/week-change.test.js.
export const SLIP_CHANCE = 0.02;

// The chance that `after.errors` or more of a unit's misses land since the split, were its odds of a miss to have
// changed by `odds` and no more: the upper tail of Fisher's noncentral hypergeometric distribution (at odds 1, his
// exact test). Each count's weight comes from its neighbour's, in logs, so long histories neither overflow nor
// take long.
export function chanceOfRise(before, after, odds = 1) {
  const [misses, clean] = [before.errors + after.errors, before.tries + after.tries - before.errors - after.errors];
  const [low, high] = [Math.max(0, after.tries - clean), Math.min(misses, after.tries)];
  const logs = [0];

  for (let k = low; k < high; k += 1) logs.push(logs.at(-1) + Math.log(((misses - k) * (after.tries - k) * odds) / ((k + 1) * (clean - after.tries + k + 1))));
  const top = logs.reduce((most, log) => Math.max(most, log), -Infinity);
  const weights = logs.map((log) => Math.exp(log - top));
  const sum = (list) => list.reduce((total, weight) => total + weight, 0);

  return Math.min(1, sum(weights.slice(Math.max(0, after.errors - low))) / sum(weights));
}

// The evidence a slip is read on, the bar fixed is held to: FIXED_OBSERVATIONS tries on each side of `began`, the
// ones since over FIXED_RUNS runs or more.
const readable = (before, after) => enough(before, 'errors') && enough(after, 'errors') && after.runs >= FIXED_RUNS;

// What a week's slips are judged against. `family` is how many units can be asked whether they slipped: the ones
// with that evidence, whatever their misses, so the count never depends on how the week went. `pairs` is every try
// and miss of every pair on each side of `began`, from which the week's own change is read. Keys are left out of
// it: they hold their pairs' misses a second time.
export function slipWeek(records, began) {
  const tallies = new Map();
  const pairs = { before: { tries: 0, errors: 0 }, after: { tries: 0, errors: 0 } };

  for (const record of records.filter((item) => item.at !== null)) {
    for (const { unit, seen, errors } of record.units.filter((item) => item.seen > 0)) {
      const tally = tallies.get(unit) || { before: { tries: 0, runs: 0 }, after: { tries: 0, runs: 0 } };
      const side = record.at < began ? 'before' : 'after';
      tally[side].tries += seen;
      tally[side].runs += 1;
      tallies.set(unit, tally);

      if (unit.length === 2) {
        pairs[side].tries += seen;
        pairs[side].errors += errors;
      }
    }
  }

  return { family: [...tallies.values()].filter(({ before, after }) => readable(before, after)).length, pairs };
}

export const slipFamily = (records, began) => slipWeek(records, began).family;

// How the odds of a miss changed since `began` for the rest of the week's typing: every pair but this one. Each
// side's rate leans on the two sides' pooled rate with the weight of FIXED_OBSERVATIONS tries, so thin evidence
// reads as no change. It is never read as an improvement: a good week does not make a slip easier to call.
export function weekOdds({ pairs }, unit, before, after) {
  const own = unit.length === 2 ? { before, after } : { before: { tries: 0, errors: 0 }, after: { tries: 0, errors: 0 } };
  const rest = (side) => ({ tries: pairs[side].tries - own[side].tries, errors: pairs[side].errors - own[side].errors });
  const [was, now] = [rest('before'), rest('after')];
  const pooled = (was.errors + now.errors) / Math.max(1, was.tries + now.tries);
  const rate = (side) => (side.errors + FIXED_OBSERVATIONS * pooled) / (side.tries + FIXED_OBSERVATIONS);
  const odds = (side) => rate(side) / (1 - rate(side));

  return pooled > 0 ? Math.max(1, odds(now) / odds(was)) : 1;
}

const slipped = (unit, { before, after }, week) => readable(before, after) && after.errors / after.tries > before.errors / before.tries
  && chanceOfRise(before, after, weekOdds(week, unit, before, after)) < SLIP_CHANCE / week.family;

const byDate = (a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const basisNamed = (item) => (item?.was?.basis === 'slow' ? 'slow' : 'errors');

// The units whose state changed between `began` and now, on one keyboard, in one focus. "A week ago" is the learner
// built on the history as it stood then (the same fold, given only the earlier evidence and `began`), never a second
// set of rules.
//  - fixed: Train's isFixed now and not then. A drilled unit is judged as Train judges it, since its drill; a unit
//    never drilled, named then and not now, is judged since `began`.
//  - slipping: named now, whatever for, and missed more since `began` than before, by more than noise and by more
//    than the week as a whole (`slipped`). Its row is always of misses.
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
  const week = slipWeek(records, began);

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
    const since = evidenceSince(unit, 'errors', began, records);

    if (slipped(unit, since, week)) add(unit, 'slipping', since, 'week');
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

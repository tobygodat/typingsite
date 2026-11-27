import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, FOCUSES, SLOW_FLOOR_MS, englishFrequency, keyboardOf, recommendFor } from '../src/learner.js';
import { FIXED_OBSERVATIONS, FIXED_RUNS, trainPath } from '../src/train-path.js';
import { SHOWN_MOVERS, SLIP_RULE, WEEK_MIN_RUNS, detectSlips, moverCopy, moverSample, weekChange, weekLead, weekMovers, weekPractice, weekSlips, weekStart } from '../src/week-change.js';
import { conditionKey, CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';
import { MAX_PATTERN_RUNS, dayKey, retainRuns } from '../src/insights.js';
import { weekChange as weekChangeBefore } from './week-change-reference.js';
import { mergeSynced } from '../src/account.js';
import { seeded } from '../scripts/evaluate-learner.mjs';
import { ADR_0031_PARAMS, detectSlipsDayLevel } from '../scripts/evaluate-slipping.mjs';

const conditions = { mode: 'words', count: 25, punctuation: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

const KEY = conditionKey(conditions);
const KEYBOARD = keyboardOf(conditions);

// Local dates throughout, so the weeks fall the same in any time zone the tests run in. "Now" is a Wednesday noon.
const NOW_DATE = new Date(2026, 10, 11, 12, 0, 0);
const NOW = NOW_DATE.getTime();
const THEN = weekStart(NOW_DATE);
const daysAgo = (days, hour = 12, minute = 0) => new Date(2026, 10, 11 - days, hour, minute);

const run = (id, when, { wpm = 70, accuracy = 96, patterns = [], keys = [], cond = conditions, kind = 'test', day = dayKey(when) } = {}) => ({
  id, at: when.toISOString(), day, kind, status: 'complete', interrupted: false, fresh: true, conditions: cond, elapsedMs: 30_000,
  score: { wpm, accuracy }, patterns, keys, keysVersion: 1,
});

const BACKGROUND = [...englishFrequency().pairs].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([pair]) => pair);

// Common pairs typed at the run's pace, one in three missed once in ten tries: a pooled miss rate near 3%.
const withBackground = (rows, pace = 200) => [...BACKGROUND.filter((pair) => !rows.some((row) => row[0] === pair))
  .map((pair, i) => [pair, 10, i % 3 ? 0 : 1, 10, pace, 0]), ...rows];

function loop(id, target, after, basis = 'errors') {
  return { id, at: after.at, afterAttemptId: after.id, beforeAttemptId: null, target, targetBasis: basis, conditions, comparison: { state: 'improved', comparable: true },
    targetMisses: basis === 'errors' ? { target, was: { errors: 3, observations: 12 }, now: { errors: 0, observations: 9 } } : null,
    targetPace: basis === 'slow' ? { target, was: { slowMs: 90, timed: 12 }, now: { slowMs: 10, timed: 8 } } : null, recommendationKind: 'targeted' };
}

const recommend = (runs, loops, focus, now = NOW) => recommendFor(DEFAULT_POLICY, { runs, loops, traces: [], source: conditions, now, focus });
const overview = (runs, loops = [], { focus = 'balanced', practiceDays = {}, goal = 0 } = {}) => weekChange({ runs, loops, practiceDays, key: KEY, conditions, focus, goal, now: NOW });

test('the lead is this week’s median against the week before’s, each from at least three runs', () => {
  const runs = [
    ...[70, 72, 74].map((wpm, i) => run(`p${i}`, daysAgo(9 + i), { wpm })),
    ...[76, 78, 75, 80].map((wpm, i) => run(`c${i}`, daysAgo(i), { wpm })),
  ];

  const lead = weekLead(runs, KEY, NOW_DATE);
  assert.equal(lead.state, 'change');
  assert.deepEqual([lead.current.median, lead.current.count, lead.previous.median, lead.previous.count], [77, 4, 72, 3]);

  // Two runs the week before: no median, so no change, and none is ever stated from it.
  const thin = weekLead(runs.filter((r) => r.id !== 'p0'), KEY, NOW_DATE);
  assert.equal(thin.state, 'this-week');
  assert.equal(thin.previous.median, null);
  assert.equal(thin.previous.count, 2);

  assert.equal(weekLead(runs.filter((r) => r.id.startsWith('p') || r.id === 'c0'), KEY, NOW_DATE).state, 'last-week');
  assert.equal(weekLead(runs.filter((r) => ['p0', 'c0'].includes(r.id)), KEY, NOW_DATE).state, 'thin');
  assert.equal(weekLead([run('old', daysAgo(30))], KEY, NOW_DATE).state, 'none');
  assert.equal(weekLead([], '', NOW_DATE).state, 'none');
  assert.equal(WEEK_MIN_RUNS, 3);
});

test('the lead compares only one condition key and only fresh-text practice', () => {
  const other = { ...conditions, count: 50 };

  const runs = [
    ...[70, 72, 74].map((wpm, i) => run(`p${i}`, daysAgo(9 + i), { wpm })),
    ...[90, 90, 90].map((wpm, i) => run(`o${i}`, daysAgo(i), { wpm, cond: other })),
    ...[90, 90, 90].map((wpm, i) => ({ ...run(`r${i}`, daysAgo(i), { wpm }), fresh: false })),
    ...[90, 90, 90].map((wpm, i) => run(`d${i}`, daysAgo(i), { wpm, kind: 'drill' })),
  ];

  const lead = weekLead(runs, KEY, NOW_DATE);
  assert.equal(lead.state, 'last-week');
  assert.equal(lead.current.count, 0);
});

test('a run lands in the week of the day it was typed on, whatever time zone wrote it, and the boundary is midnight', () => {
  // Typed late on the seventh day back, local time: last week. Typed just after midnight on the sixth: this week.
  const runs = [
    run('a', daysAgo(7, 23, 59)), run('b', daysAgo(6, 0, 1)),
    // Written by a device ahead of this one: its clock says the next day here, but it was typed on day 7 there.
    run('c', daysAgo(6, 3, 0), { day: dayKey(daysAgo(7)) }),
    // An evening run written by a device behind this one: tomorrow here, typed today there.
    run('d', daysAgo(0, 23, 0), { day: dayKey(daysAgo(0)) }),
    run('e', daysAgo(13, 0, 0)), run('f', daysAgo(14, 23, 59)),
  ];

  const lead = weekLead(runs, KEY, NOW_DATE);
  assert.equal(lead.current.count, 2, 'b and d this week');
  assert.equal(lead.previous.count, 3, 'a, c and e the week before; f is older');
});

test('practice compares minutes this week with the week before, as a plain fact, with the streak', () => {
  const runs = [run('a', daysAgo(1)), run('b', daysAgo(0)), run('c', daysAgo(8))].map((r, i) => ({ ...r, elapsedMs: [120_000, 60_000, 600_000][i] }));
  const practice = weekPractice(runs, {}, 0, NOW_DATE);
  assert.deepEqual({ ...practice, current: Math.round(practice.current), previous: Math.round(practice.previous) },
    { status: 'less', current: 3, previous: 10, streak: 2, goal: 0 });
  assert.equal(weekPractice([], {}, 0, NOW_DATE), null);
  // Six 20-second runs are two minutes, not 1.999…
  const six = Array.from({ length: 6 }, (_, i) => ({ ...run(`s${i}`, daysAgo(i % 3)), elapsedMs: 20_000 }));
  assert.equal(weekPractice(six, {}, 0, NOW_DATE).current, 2);
  assert.equal(weekPractice(runs.slice(0, 2), {}, 0, NOW_DATE).status, 'more');
  // The archive of days whose runs aged out counts too, as the calendar counts it.
  assert.equal(weekPractice(runs.slice(0, 2), { [dayKey(daysAgo(9))]: 180_000 }, 0, NOW_DATE).status, 'same');
});

// The row prints "0", "<1" and whole minutes, and its status word follows what it prints: a first half-minute after
// an empty week reads "0 → <1 min", which is more, not the same.
test('practice’s status follows the figures the row prints, under a minute included', () => {
  const seconds = (id, days, amount) => ({ ...run(id, daysAgo(days)), elapsedMs: amount * 1000 });
  const status = (...list) => weekPractice(list, {}, 0, NOW_DATE).status;
  assert.equal(status(seconds('a', 0, 20)), 'more');
  assert.equal(status(seconds('a', 8, 20)), 'less');
  assert.equal(status(seconds('a', 0, 20), seconds('b', 8, 40)), 'same');
  assert.equal(status(seconds('a', 0, 70), seconds('b', 8, 40)), 'more');
  assert.equal(status(seconds('a', 0, 40), seconds('b', 8, 70)), 'less');
  assert.equal(status(seconds('a', 0, 100), seconds('b', 8, 70)), 'same');
});

// A pair missed before this week and clean since it began, on enough tries, and never drilled: fixed since the week
// began. A pair that got worse is not on the list: the list names what was fixed.
test('a pair the learner named a week ago and no longer can is fixed, and a pair that got worse is not listed', () => {
  const before = Array.from({ length: 5 }, (_, i) => run(`b${i}`, daysAgo(12 - i), { patterns: withBackground([['qu', 8, 1, 8, 200, 0], ['ex', 8, 0, 8, 200, 0]]) }));
  const after = Array.from({ length: 6 }, (_, i) => run(`a${i}`, daysAgo(5 - i), { patterns: withBackground([['qu', 15, 0, 15, 200, 0], ['ex', 8, 3, 8, 200, 0]]) }));
  const { movers } = overview([...before, ...after]);
  const byUnit = Object.fromEntries(movers.map((mover) => [mover.unit, mover]));
  assert.deepEqual([byUnit.qu.before, byUnit.qu.after, byUnit.qu.split], [{ runs: 5, tries: 40, errors: 5 }, { runs: 6, tries: 90, errors: 0 }, 'week']);
  assert.deepEqual(moverCopy(byUnit.qu), { before: '5 of 40', after: '0 of 90', tail: 'missed' });
  assert.equal(moverSample(byUnit.qu), '40 tries in 5 runs before this week, 90 tries in 6 runs this week');
  assert.equal(byUnit.ex, undefined);
  assert.deepEqual(Object.keys(byUnit), ['qu']);
});

test('a pair drilled for its pace and now at it is fixed by pace, read since its drill, as Train reads it', () => {
  const slow = Array.from({ length: 5 }, (_, i) => run(`s${i}`, daysAgo(12 - i), { patterns: withBackground([['ol', 12, 0, 12, 300, 100]]) }));
  const retest = run('t', daysAgo(5), { patterns: withBackground([['ol', 12, 0, 12, 200, 0]]) });
  const since = Array.from({ length: 4 }, (_, i) => run(`u${i}`, daysAgo(4 - i), { patterns: withBackground([['ol', 12, 0, 12, 195, -5]]) }));
  const runs = [...slow, retest, ...since];
  const loops = [loop('l', 'ol', retest, 'slow')];
  const mover = overview(runs, loops).movers.find((item) => item.unit === 'ol');
  assert.equal(mover.split, 'drill');
  assert.deepEqual(moverCopy(mover), { before: '100 ms slower', after: '4 ms faster', tail: '' });
  const path = trainPath({ recommendation: recommend(runs, loops, 'balanced'), loops, runs, keyboard: KEYBOARD });
  assert.equal(path.behind.find((step) => step.unit === 'ol').state, 'fixed');
});

test('a loop whose drill was skipped is no drill, so Progress never reads its target as fixed since a drill', () => {
  const slow = Array.from({ length: 5 }, (_, i) => run(`s${i}`, daysAgo(12 - i), { patterns: withBackground([['ol', 12, 0, 12, 300, 100]]) }));
  const retest = run('t', daysAgo(5), { patterns: withBackground([['ol', 12, 0, 12, 200, 0]]) });
  const since = Array.from({ length: 4 }, (_, i) => run(`u${i}`, daysAgo(4 - i), { patterns: withBackground([['ol', 12, 0, 12, 195, -5]]) }));
  const skipped = { ...loop('l', 'ol', retest, 'slow'), drillCompleted: false };
  assert.notEqual(overview([...slow, retest, ...since], [skipped]).movers.find((item) => item.unit === 'ol')?.split, 'drill');
});

test('a unit fixed since a drill it had no evidence before is left out: there is no before to show', () => {
  const retest = run('t', daysAgo(5), { patterns: withBackground([['zq', 12, 0, 12, 200, 0]]) });
  const since = Array.from({ length: 3 }, (_, i) => run(`u${i}`, daysAgo(4 - i), { patterns: withBackground([['zq', 12, 0, 12, 200, 0]]) }));
  const runs = [retest, ...since];
  const loops = [loop('l', 'zq', retest)];
  const path = trainPath({ recommendation: recommend(runs, loops, 'balanced'), loops, runs, keyboard: KEYBOARD });
  assert.equal(path.behind.find((step) => step.unit === 'zq')?.state, 'fixed');
  assert.equal(overview(runs, loops).movers.find((mover) => mover.unit === 'zq'), undefined);
});

// Each focus names its own kind of unit, so each fixes its own: "th" got back to the person's pace and "an" stopped
// being missed. The speed focus never named "an", and the accuracy focus never named "th".
test('movers follow the train focus, as Train does', () => {
  const runs = [
    ...Array.from({ length: 5 }, (_, i) => run(`b${i}`, daysAgo(12 - i), { patterns: withBackground([['th', 12, 0, 12, 300, 100], ['an', 8, 1, 8, 200, 0]]) })),
    ...Array.from({ length: 6 }, (_, i) => run(`a${i}`, daysAgo(5 - i), { patterns: withBackground([['th', 12, 0, 12, 195, -5], ['an', 15, 0, 15, 200, 0]]) })),
  ];

  const named = (focus) => overview(runs, [], { focus }).movers.map((mover) => `${mover.unit}:${mover.basis}`);
  assert.deepEqual(named('speed'), ['th:slow']);
  assert.deepEqual(named('accuracy'), ['an:errors']);
  assert.deepEqual([...named('balanced')].sort(), ['an:errors', 'th:slow']);
});

// Random histories over three weeks: each pair improves, worsens or stays put at a random day, so some units get
// fixed; loops on random pairs at random runs, some retested this week, some before it.
function randomHistory(random, round) {
  const pairs = ['th', 'he', 'in', 'er', 'an', 'ou', 'qu', 'ck'];
  const plans = pairs.map(() => ({ turn: Math.floor(random() * 21), early: random() * 0.5, late: random() * 0.5, slowEarly: random() * 120 - 20, slowLate: random() * 120 - 20 }));

  const runs = Array.from({ length: 3 + Math.floor(random() * 18) }, (_, i) => {
    const back = Math.floor(random() * 21);
    const pace = 120 + Math.floor(random() * 200);

    const rows = pairs.map((pair, p) => {
      const late = back <= plans[p].turn;
      const n = Math.floor(random() * 12);
      const errors = Array.from({ length: n }, () => random() < (late ? plans[p].late : plans[p].early)).filter(Boolean).length;
      const shift = Math.round(late ? plans[p].slowLate : plans[p].slowEarly);

      return [pair, n, errors, n, n ? pace + shift : null, n ? shift : null];
    });

    const keys = ['e', 'x', 'q'].map((key) => { const n = 5 + Math.floor(random() * 10);

 return [key, n, random() < 0.3 ? Math.floor(random() * 3) : 0]; });

    return run(`m${round}-${i}`, daysAgo(back, 8 + Math.floor(random() * 12), Math.floor(random() * 60)), { wpm: 50 + random() * 40, patterns: withBackground(rows, pace), keys });
  });

  const loops = Array.from({ length: Math.floor(random() * 5) }, (_, i) => loop(`l${round}-${i}`, pairs[Math.floor(random() * pairs.length)],
    runs[Math.floor(random() * runs.length)], random() < 0.5 ? 'slow' : 'errors'));

  return { runs, loops };
}

// Observed counts straight from the run summaries: no learner, no records.
function tallyRaw(runs, unit, basis, from, to) {
  const rows = runs.filter((r) => Date.parse(r.at) >= from && Date.parse(r.at) < to)
    .map((r) => (unit.length === 1 ? (r.keys.find((row) => row[0] === unit) || null) : (r.patterns.find((row) => row[0] === unit) || null))).filter(Boolean);

  if (basis === 'slow') {
    const timed = rows.filter((row) => row[3] > 0 && row[4] > 0 && row[4] - row[5] >= 30);
    const intervals = timed.reduce((sum, row) => sum + row[3], 0);

    return intervals ? { runs: timed.length, intervals, ms: timed.reduce((sum, row) => sum + row[3] * row[5], 0) / intervals } : null;
  }

  // A run counts only when it holds an observation of the kind.
  const tried = rows.filter((row) => row[1] > 0);
  const tries = tried.reduce((sum, row) => sum + row[1], 0);

  return tries ? { runs: tried.length, tries, errors: tried.reduce((sum, row) => sum + Math.min(row[1], row[2]), 0) } : null;
}

const newestLoop = (loops, unit, before = Infinity) => loops.filter((l) => l.target === unit && Date.parse(l.at) < before)
  .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : 1)).at(-1);

function fixedRaw(runs, loop, queued) {
  const split = Date.parse(runs.find((r) => r.id === loop.afterAttemptId).at);
  const after = tallyRaw(runs, loop.target, loop.targetBasis, split, Infinity);

  if (queued || !after || after.runs < FIXED_RUNS) return false;

  return loop.targetBasis === 'slow' ? after.intervals >= FIXED_OBSERVATIONS && Math.round(after.ms) <= SLOW_FLOOR_MS : after.tries >= FIXED_OBSERVATIONS && after.errors === 0;
}

const close = (a, b) => (a === null || b === null ? a === b : Object.keys(b).every((k) => Math.abs(a[k] - b[k]) < 1e-9) && Object.keys(a).length === Object.keys(b).length);

test('across random histories in every focus, every mover follows the stated rules, recomputed from the raw runs, and Train agrees', () => {
  const random = seeded(4204);
  const seen = { fixed: 0, drill: 0, week: 0, slow: 0 };

  for (let round = 0; round < 160; round += 1) {
    const { runs, loops } = randomHistory(random, round);

    for (const focus of FOCUSES) {
      const where = `round ${round}, ${focus}`;
      const movers = weekMovers({ runs, loops, keyboard: KEYBOARD, focus, now: NOW, began: THEN });
      const queuedNow = new Set(recommend(runs, loops, focus).queue.map((item) => item.unit));
      const earlier = runs.filter((r) => Date.parse(r.at) < THEN);
      const queuedThen = new Set(recommend(earlier, loops, focus, THEN).queue.map((item) => item.unit));
      const path = trainPath({ recommendation: recommend(runs, loops, focus), loops, runs, keyboard: KEYBOARD });
      const shown = new Set([path.current.unit, ...path.ahead.map((step) => step.unit)].filter(Boolean));

      assert.equal(new Set(movers.map((m) => m.unit)).size, movers.length, `${where}: a unit twice`);
      assert.deepEqual(movers.map((m) => m.weight), [...movers.map((m) => m.weight)].sort((a, b) => b - a), `${where}: not ranked`);

      for (const mover of movers) {
        seen.fixed += 1;
        seen[mover.split] += 1;

        if (mover.basis === 'slow') seen.slow += 1;
        const at = `${where}: “${mover.unit}”`;
        const drilled = newestLoop(loops, mover.unit);
        const split = mover.split === 'drill' ? Date.parse(runs.find((r) => r.id === drilled.afterAttemptId).at) : THEN;

        // One kind of evidence on each side, equal to the raw counts on each side of its split.
        assert.ok(close(mover.before, tallyRaw(runs, mover.unit, mover.basis, -Infinity, split)), `${at}: before ${JSON.stringify(mover.before)}`);
        assert.ok(close(mover.after, tallyRaw(runs, mover.unit, mover.basis, split, Infinity)), `${at}: after ${JSON.stringify(mover.after)}`);
        const copy = moverCopy(mover);
        assert.ok(![copy.before, copy.after].some((line) => /-\d|\b0 ms slower/.test(line)), `${at}: ${JSON.stringify(copy)}`);
        assert.ok(mover.basis === 'slow' ? !copy.tail : copy.tail === 'missed', `${at}: copy of another kind`);
        const trainStep = path.behind.find((step) => step.unit === mover.unit);

        // Fixed by Train's rule, and nowhere Train still shows it as open, ahead or merely drilled.
        assert.ok(!queuedNow.has(mover.unit) && !shown.has(mover.unit), `${at}: still queued`);

        if (drilled) {
          assert.equal(mover.split, 'drill', `${at}: a drilled unit read from the week`);
          assert.ok(fixedRaw(runs, drilled, false), `${at}: not fixed by the rule`);
          assert.equal(trainStep?.state, 'fixed', `${at}: Train shows it ${trainStep?.state}`);
          const was = newestLoop(loops, mover.unit, THEN);
          assert.ok(!was || !fixedRaw(earlier, was, queuedThen.has(mover.unit)), `${at}: fixed a week ago too`);
        } else {
          assert.ok(queuedThen.has(mover.unit), `${at}: never named`);
          assert.ok(mover.after.runs >= FIXED_RUNS, `${at}: on one run`);
          assert.ok(mover.basis === 'slow' ? mover.after.intervals >= FIXED_OBSERVATIONS && Math.round(mover.after.ms) <= SLOW_FLOOR_MS
            : mover.after.tries >= FIXED_OBSERVATIONS && mover.after.errors === 0, `${at}: not fixed by the rule`);
          assert.equal(trainStep, undefined, `${at}: Train has it behind`);
        }
      }

      // The other way round: every unit Train calls fixed now and not a week ago is on the list.
      for (const step of path.behind.filter((item) => item.state === 'fixed')) {
        const was = newestLoop(loops, step.unit, THEN);

        if (was && fixedRaw(earlier, was, queuedThen.has(step.unit))) continue;

        // A drill on a unit never typed before it has no before to read back, so the list leaves it out.
        if (!step.since.before) continue;
        assert.ok(movers.some((m) => m.unit === step.unit), `${where}: Train fixed “${step.unit}” this week`);
      }
    }
  }

  for (const [kind, count] of Object.entries(seen)) assert.ok(count > 10, `the generator makes ${kind} movers (${count})`);
});

test('the overview is the same whatever order the history arrives in, and after either merge of two devices’ copies', () => {
  const random = seeded(91);

  const shuffled = (items) => {
    const copy = [...items];

    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
  };

  const strip = (value) => ({ ...value, charts: { ...value.charts, runs: value.charts.runs.map((r) => r.id).sort() } });

  for (let round = 0; round < 30; round += 1) {
    const { runs, loops } = randomHistory(random, round);
    const ordered = [...runs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const expected = strip(overview(ordered, loops));
    assert.deepEqual(strip(overview(shuffled(ordered), shuffled(loops))), expected, `round ${round}: shuffled`);

    const base = { version: 2, profileId: 'p', preferences: {}, attempts: [], seenTextIds: [], bests: {} };
    const local = { ...base, runs: ordered.slice(0, Math.ceil(runs.length / 2) + 1), loops: loops.slice(0, 2) };
    const cloud = { ...base, runs: ordered.slice(Math.floor(runs.length / 2)), loops: loops.slice(1) };

    for (const merged of [mergeSynced(local, cloud), mergeSynced(cloud, local)]) {
      assert.deepEqual(strip(overview(merged.runs, merged.loops)), expected, `round ${round}: merged`);
    }
  }
});

test('the list shows a few units, ranked, and keeps the rest', () => {
  assert.equal(SHOWN_MOVERS, 3);
});

// The learner "a week ago" is fitted at the moment the week began, not now (TOB-448). Its decay reads each record's
// age, so the moment matters: two undated clean runs keep their full weight while the dated ones fade, and "qu",
// missed in two of five runs a month ago, is named by the learner at the week's start and not by one fitted now.
// Clean this week, it is fixed since the week began only by the learner of the week's start.
test('the learner a week ago is fitted at the start of the week', () => {
  const undated = [0, 1].map((i) => ({ ...run(`u${i}`, daysAgo(60), { patterns: withBackground([['qu', 10, 0, 10, 200, 0]]) }), at: null, day: null }));
  const month = Array.from({ length: 5 }, (_, i) => run(`b${i}`, daysAgo(30 + i), { patterns: withBackground([['qu', 10, i < 2 ? 2 : 0, 10, 200, 0]]) }));
  const week = Array.from({ length: 3 }, (_, i) => run(`a${i}`, daysAgo(3 - i), { patterns: withBackground([['qu', 10, 0, 10, 200, 0]]) }));
  const runs = [...undated, ...month, ...week];
  const named = (at) => recommend([...undated, ...month], [], 'balanced', at).queue.some((item) => item.unit === 'qu');
  assert.equal(named(THEN), true);
  assert.equal(named(NOW), false);
  assert.deepEqual(weekMovers({ runs, keyboard: KEYBOARD, focus: 'balanced', now: NOW, began: THEN }).map((mover) => `${mover.unit}:${mover.split}`), ['qu:week']);
});

// A loop on another keyboard is no drill of this keyboard's unit (TOB-448): "ck", named here a week ago and clean here
// since, is fixed since the week began, judged at the week's start, whatever was drilled on the Dvorak layout yesterday.
test('loops on another keyboard leave this keyboard’s movers alone', () => {
  const dvorak = { ...conditions, layout: 'dvorak' };
  const before = Array.from({ length: 5 }, (_, i) => run(`b${i}`, daysAgo(12 - i), { patterns: withBackground([['ck', 8, 1, 8, 200, 0]]) }));
  const after = Array.from({ length: 6 }, (_, i) => run(`a${i}`, daysAgo(5 - i), { patterns: withBackground([['ck', 15, 0, 15, 200, 0]]) }));
  const elsewhere = run('d', daysAgo(1), { cond: dvorak, patterns: withBackground([['ck', 12, 0, 12, 200, 0]]) });
  const runs = [...before, ...after, elsewhere];
  const movers = (loops) => weekMovers({ runs, loops, keyboard: KEYBOARD, focus: 'balanced', now: NOW, began: THEN }).map((mover) => `${mover.unit}:${mover.split}`);
  assert.deepEqual(movers([]), ['ck:week']);
  assert.deepEqual(movers([{ ...loop('ld', 'ck', elsewhere), conditions: dvorak }]), ['ck:week']);
});

// A loop counts as a week ago when it was saved before midnight at the start of the week, and from that midnight on
// it is this week's (TOB-448). "qu" was drilled long ago and fixed well before the week; drilled again just before
// midnight, it is judged since that drill, a week ago one run of evidence, so its fix since is this week's. Drilled
// again on the stroke of midnight or just after, the week ago is the old drill's, already fixed then, so it isn't listed.
test('a loop counts as a week ago only when it was saved before the week began', () => {
  const weak = Array.from({ length: 5 }, (_, i) => run(`w${i}`, daysAgo(40 - i), { patterns: withBackground([['qu', 10, 3, 10, 200, 0]]) }));
  const first = run('t1', daysAgo(35), { patterns: withBackground([['qu', 10, 0, 10, 200, 0]]) });
  const clean = Array.from({ length: 60 }, (_, i) => run(`c${i}`, new Date(daysAgo(34 - Math.floor(i / 2)).getTime() + (i % 2) * 3_600_000), { patterns: withBackground([['qu', 10, 0, 10, 200, 0]]) }));
  const week = Array.from({ length: 3 }, (_, i) => run(`n${i}`, daysAgo(3 - i), { patterns: withBackground([['qu', 10, 0, 10, 200, 0]]) }));

  const movers = (at) => {
    const again = run('t2', new Date(at - 60_000), { patterns: withBackground([['qu', 10, 0, 10, 200, 0]]) });
    const second = { ...loop('l2', 'qu', again), at: new Date(at).toISOString() };
    const runs = [...weak, first, ...clean, again, ...week].sort((a, b) => (a.at < b.at ? -1 : 1));

    return weekMovers({ runs, loops: [loop('l1', 'qu', first), second], keyboard: KEYBOARD, focus: 'balanced', now: NOW, began: THEN }).map((mover) => `${mover.unit}:${mover.split}`);
  };

  // The week began at midnight six days back: Thursday 5 November, for a Wednesday noon.
  assert.equal(THEN, new Date(2026, 10, 5, 0, 0, 0).getTime());
  assert.deepEqual(movers(THEN - 60_000), ['qu:drill']);
  assert.deepEqual(movers(THEN), []);
  assert.deepEqual(movers(THEN + 60_000), []);
});

// The practice row's week is today and the six days before; the week before is the seven before those (TOB-448).
test('the practice row splits its weeks at the start of the sixth day back', () => {
  const minutes = (id, days, amount) => ({ ...run(id, daysAgo(days)), elapsedMs: amount * 60_000 });
  const practice = weekPractice([minutes('a', 13, 1), minutes('b', 7, 2), minutes('c', 6, 4), minutes('d', 0, 8), minutes('e', 14, 16)], {}, 0, NOW_DATE);
  assert.deepEqual([practice.previous, practice.current], [3, 12]);
});

// Progress's overview is master's on every history (TOB-448): the same as the version built on master's evidenceSince
// and sinceDrilled (tests/week-change-reference.js), over random profiles under and over MAX_PATTERN_RUNS count-carrying
// runs, stored as retainRuns stores them (so the older runs of a long profile have lost their counts), with undated
// runs and runs on another keyboard, loops drilled before the week and in it, and every focus.
test('the overview is the same as master’s on random histories, short and trimmed', () => {
  const random = seeded(4480);
  const pairs = ['qu', 'ex', 'ck', 'ol', 'th', 'an'];
  const dvorak = { ...conditions, layout: 'dvorak' };
  let trimmed = 0;
  let movers = 0;

  for (let round = 0; round < 48; round += 1) {
    const count = round % 2 ? MAX_PATTERN_RUNS + 20 + Math.floor(random() * 80) : 10 + Math.floor(random() * 90);
    const turn = Math.floor(random() * 30);

    const all = Array.from({ length: count }, (_, i) => {
      const back = Math.floor(((count - i) / count) * 40);

      const rows = pairs.map((pair, p) => {
        const late = back < (turn + p * 3) % 20;
        const n = 4 + Math.floor(random() * 10);
        const errors = Array.from({ length: n }, () => random() < (late ? 0.02 : 0.25)).filter(Boolean).length;
        const slow = late ? 0 : Math.round(random() * 80);

        return [pair, n, errors, n, 200 + slow, slow];
      });

      const made = run(`r${round}-${i}`, daysAgo(back, 8 + (i % 12), i % 60), { wpm: 50 + random() * 40, patterns: withBackground(rows),
        cond: random() < 0.1 ? dvorak : conditions });

      return random() < 0.03 ? { ...made, at: null, day: null } : made;
    });

    const runs = retainRuns(all);
    trimmed += runs.some((item) => item.at && !item.patterns.length) ? 1 : 0;
    const dated = runs.filter((item) => item.at && item.conditions === conditions);

    const loops = Array.from({ length: Math.floor(random() * 6) }, (_, i) => loop(`l${round}-${i}`, pairs[Math.floor(random() * pairs.length)],
      dated[Math.floor(random() * dated.length)], random() < 0.4 ? 'slow' : 'errors'));

    for (const focus of FOCUSES) {
      const args = { runs, loops, practiceDays: {}, key: KEY, conditions, focus, goal: 0, period: '30', now: NOW };
      const week = weekChange(args);
      assert.deepEqual(week, weekChangeBefore(args), `round ${round}, ${focus}`);
      movers += week.movers.length;
    }
  }

  assert.ok(trimmed >= 10, `the generator trims long profiles (${trimmed})`);
  assert.ok(movers > 20, `the generator moves units (${movers})`);
});

// TOB-511: when older pattern counts were trimmed before `began`, a unit already fixed by a pre-week drill and
// re-drilled this week must not be falsely listed with clean-before → clean-after counts, while units drilled for
// the first time this week or still weak before a re-drill stay listed (per-unit, never a whole-list gate).
test('trimmed pre-week counts suppress broken pre-week re-drill artifacts per unit without hiding real movers', () => {
  const preWeak = Array.from({ length: 10 }, (_, i) => run(`pw${i}`, daysAgo(35 - Math.floor(i / 2), 8 + (i % 2)), {
    patterns: withBackground([['ol', 12, 0, 12, 300, 100], ['qu', 12, 4, 12, 200, 0]]),
  }));

  const oldRetestOl = run('rt-ol-old', daysAgo(29, 12), { patterns: withBackground([['ol', 12, 0, 12, 200, 0], ['qu', 12, 4, 12, 200, 0]]) });
  const oldRetestQu = run('rt-qu-old', daysAgo(29, 13), { patterns: withBackground([['ol', 12, 0, 12, 200, 0], ['qu', 12, 4, 12, 200, 0]]) });

  // Between day 28 and day 7: "ol" is already fixed (clean pace for 20 runs), while "qu" stays weak.
  const preClean = Array.from({ length: 20 }, (_, i) => run(`pc${i}`, daysAgo(28 - i, 12), {
    patterns: withBackground([['ol', 12, 0, 12, 200, 0], ['qu', 12, 4, 12, 200, 0]]),
  }));

  // This week: 125 runs push every pre-week run out of the 120-run pattern cap.
  // Before day 3: "qu" and "ck" (never drilled before) are still weak; "ol" is already at pace.
  const weekBeforeRedrill = Array.from({ length: 25 }, (_, i) => run(`wb${i}`, daysAgo(6 - Math.floor(i / 8), 8 + (i % 8)), {
    patterns: withBackground([['ol', 12, 0, 12, 200, 0], ['qu', 12, 4, 12, 200, 0], ['ck', 12, 4, 12, 200, 0]]),
  }));

  const newRetest = run('rt-new', daysAgo(3, 12), { patterns: withBackground([['ol', 12, 0, 12, 200, 0], ['qu', 12, 0, 12, 200, 0], ['ck', 12, 0, 12, 200, 0]]) });

  // 100 clean runs after the retest: all three leave the learner queue and pass isFixed.
  const weekAfterRedrill = Array.from({ length: 100 }, (_, i) => run(`wa${i}`, daysAgo(2 - Math.floor(i / 40), 8 + Math.floor((i % 40) / 4), (i % 4) * 15), {
    patterns: withBackground([['ol', 12, 0, 12, 200, 0], ['qu', 12, 0, 12, 200, 0], ['ck', 12, 0, 12, 200, 0]]),
  }));

  const all = [...preWeak, oldRetestOl, oldRetestQu, ...preClean, ...weekBeforeRedrill, newRetest, ...weekAfterRedrill];
  const runs = retainRuns(all);

  const loops = [
    loop('l-ol-old', 'ol', oldRetestOl, 'slow'),
    loop('l-ol-new', 'ol', newRetest, 'slow'),
    loop('l-qu-old', 'qu', oldRetestQu, 'errors'),
    loop('l-qu-new', 'qu', newRetest, 'errors'),
    loop('l-ck-new', 'ck', newRetest, 'errors'),
  ];

  // Master (weekChangeBefore) falsely lists "ol" ("at your pace → at your pace") because trimming erased its pre-week fix.
  const masterUnits = weekChangeBefore({ runs, loops, practiceDays: {}, key: KEY, conditions, focus: 'balanced', goal: 0, period: '30', now: NOW }).movers.map((m) => m.unit).sort();
  assert.deepEqual(masterUnits, ['ck', 'ol', 'qu']);

  // The per-unit fix suppresses only "ol", keeping both genuine this-week fixes ("ck" and "qu") and staying order-independent.
  const fixedUnits = weekMovers({ runs, loops, keyboard: KEYBOARD, focus: 'balanced', now: NOW, began: THEN }).map((m) => m.unit).sort();
  assert.deepEqual(fixedUnits, ['ck', 'qu']);
  assert.deepEqual(weekMovers({ runs: [...runs].reverse(), loops: [...loops].reverse(), keyboard: KEYBOARD, focus: 'balanced', now: NOW, began: THEN }).map((m) => m.unit).sort(), ['ck', 'qu']);
});

// TOB-511: a pace drill before the week left the pair slow in its surviving pre-week runs, so it wasn't fixed then.
// A drill this week that brought it to pace is a real mover, even when older counts were trimmed.
test('surviving pre-week runs that are still slow keep a real pace fix listed after trimming', () => {
  const hour = 3_600_000;
  const day = 24 * hour;
  const pairs = BACKGROUND.filter((pair) => pair !== 'th').slice(0, 25);

  const series = (count, start, step, label, ms, kind = 'test') => Array.from({ length: count }, (_, i) => run(`${label}${i}`, new Date(THEN + start + i * step),
    { kind, patterns: [...pairs.map((pair, j) => [pair, 4, j % 5 ? 0 : 1, 4, 200, 0]), ['th', 10, 0, 10, 200 + ms, ms]] }));

  const [oldRetest] = series(1, -8 * day, hour, 'old-r', 75, 'retest');
  const [newRetest] = series(1, 2.5 * day, hour, 'new-r', 0, 'retest');

  const history = [...series(14, -9 * day, hour, 'old-b', 105), oldRetest, ...series(20, -7 * day, hour, 'old-a', 75), ...series(3, -12 * hour, hour, 'carry-a', 65),
    ...series(24, day, hour, 'new-b', 0), newRetest, ...series(92, 3 * day, hour / 2, 'new-a', 0)];

  const runs = retainRuns(history);
  const loops = [loop('old', 'th', oldRetest, 'slow'), loop('new', 'th', newRetest, 'slow')];

  assert.ok(runs.some((item) => !item.patterns?.length), 'older pattern counts were trimmed');
  assert.deepEqual(weekMovers({ runs, loops, keyboard: KEYBOARD, focus: 'speed', now: NOW, began: THEN }).map((mover) => `${mover.unit}:${mover.split}`), ['th:drill']);
});

// TOB-511: across light (untrimmed), medium, heavy and burst-week histories, the per-unit fix matches master on
// untrimmed histories, hides no more true movers than master, and removes false trimming artifacts.
test('the per-unit trimming fix hides no more true movers than master while cutting false trimming artifacts', () => {
  const random = seeded(5110);

  const shapes = [
    { name: 'light', perDay: 1, days: 35, burst: 1 },
    { name: 'medium', perDay: 4, days: 40, burst: 1 },
    { name: 'heavy', perDay: 12, days: 30, burst: 1 },
    { name: 'burst', perDay: 3, days: 35, burst: 7 },
  ];

  let masterTrue = 0;
  let fixTrue = 0;
  let masterFalse = 0;
  let fixFalse = 0;

  for (const shape of shapes) {
    for (let round = 0; round < 6; round += 1) {
      const all = [];
      const loops = [];
      let oldSlowRetest = null;
      let newRetest = null;

      for (let back = shape.days; back >= 0; back -= 1) {
        const nRuns = back <= 6 ? shape.perDay * shape.burst : shape.perDay;

        for (let i = 0; i < nRuns; i += 1) {
          const when = daysAgo(back, 8 + Math.floor((i / Math.max(1, nRuns)) * 11), (i * 5) % 60);

          if (when.getTime() > NOW) continue;

          // "ol": slow only before day 25 (already fixed before this week), re-drilled on day 3.
          // "ck": slow before day 6, drilled on day 5 and genuinely fixed this week.
          // "qu": normal ~3% pair throughout (occasional noise errors only).
          const quErr = random() < 0.03 * 10 ? 1 : 0;

          const rows = [
            ['ol', 12, 0, 12, back >= 25 ? 290 : 200, back >= 25 ? 90 : 0],
            ['ck', 12, 0, 12, back >= 6 ? 290 : 200, back >= 6 ? 90 : 0],
            ['qu', 10, quErr, 10, 200, 0],
          ];

          const rec = run(`${shape.name}-${round}-${all.length}`, when, { patterns: withBackground(rows) });
          all.push(rec);

          if (!oldSlowRetest && back < 25) oldSlowRetest = rec;

          if (!newRetest && back <= 5) newRetest = rec;
        }
      }

      if (oldSlowRetest && newRetest) {
        loops.push(loop(`lo-${shape.name}-${round}`, 'ol', oldSlowRetest, 'slow'));
        loops.push(loop(`ln-${shape.name}-${round}`, 'ol', newRetest, 'slow'));
        loops.push(loop(`lc-${shape.name}-${round}`, 'ck', newRetest, 'slow'));
      }

      const runs = retainRuns(all);
      const args = { runs, loops, practiceDays: {}, key: KEY, conditions, focus: 'balanced', goal: 0, period: '30', now: NOW };
      const masterMovers = weekChangeBefore(args).movers;
      const fixMovers = weekMovers({ runs, loops, keyboard: KEYBOARD, focus: 'balanced', now: NOW, began: THEN });

      if (shape.name === 'light') assert.deepEqual(fixMovers, masterMovers, `untrimmed round ${round} matches master`);

      for (const m of masterMovers) { if (m.unit === 'ck') masterTrue += 1; else masterFalse += 1; }

      for (const m of fixMovers) { if (m.unit === 'ck') fixTrue += 1; else fixFalse += 1; }
    }
  }

  assert.ok(masterTrue >= 6, `benchmark produces true movers (${masterTrue})`);
  assert.ok(fixTrue >= masterTrue, `fix must not hide true movers vs master (${fixTrue} < ${masterTrue})`);
  assert.ok(fixFalse < masterFalse, `fix must cut false trimming artifacts (${fixFalse} vs ${masterFalse})`);
});

// ADR 0031 (TOB-511): day-level variation slip detection catches real multi-day slips (including co-slipping pairs),
// while rejecting single-day spikes, global bad weeks, good weeks, and pace-only slowdowns, and matching the evaluator.
test('weekSlips catches real multi-day slips and co-slipping pairs while ignoring single-day spikes, global bad weeks, good weeks and pace', () => {
  const bg = (rate, rows = []) => {
    const taken = new Set(rows.map((r) => r[0]));
    const n = 20;
    const err = Math.round(n * rate);

    return [...BACKGROUND.filter((p) => !taken.has(p)).map((p) => [p, n, err, n, 200, 0]), ...rows];
  };

  // 1) Multi-day real slip on "qu" (clean before, 35% missed across 5 days this week), plus pace-only slow "ol".
  const before = Array.from({ length: 10 }, (_, i) => run(`sb${i}`, daysAgo(16 - i), {
    patterns: bg(0.05, [['qu', 20, 0, 20, 200, 0], ['ol', 20, 0, 20, 200, 0]]),
  }));

  const afterMulti = Array.from({ length: 5 }, (_, i) => run(`sa${i}`, daysAgo(5 - i), {
    patterns: bg(0.05, [['qu', 20, 7, 20, 200, 0], ['ol', 20, 0, 20, 320, 120]]),
  }));

  const multiRuns = [...before, ...afterMulti];
  const multi = weekSlips({ runs: multiRuns, keyboard: KEYBOARD, focus: 'balanced', now: NOW, began: THEN });
  assert.deepEqual(multi.map((s) => s.unit), ['qu']);
  assert.deepEqual([multi[0].before.days, multi[0].after.days, multi[0].after.errors], [10, 5, 35]);

  // Order invariance and merge commutativity.
  assert.deepEqual(weekSlips({ runs: [...multiRuns].reverse(), keyboard: KEYBOARD, focus: 'balanced', now: NOW, began: THEN }), multi);

  // Parity with the ADR 0031 evaluator implementation.
  const recs = multiRuns.map((r) => ({
    id: r.id, at: Date.parse(r.at), correction: null,
    units: r.patterns.map(([unit, seen, errors]) => ({ unit, seen, errors, timed: 0, slow: null, ratio: null, slowMs: null })),
  }));

  const queued = new Set(recommend(multiRuns, [], 'balanced').queue.map((item) => item.unit));
  assert.deepEqual(SLIP_RULE, ADR_0031_PARAMS);
  assert.deepEqual(detectSlips(recs, THEN, queued).slipped.map((s) => s.unit), detectSlipsDayLevel(recs, THEN, queued, ADR_0031_PARAMS).slipped);

  // 2) Single-day spike (35 misses concentrated on ONE day, 0 on the other 4 days): never a slip (LODO guard).
  const afterOneDaySpike = Array.from({ length: 5 }, (_, i) => run(`sp${i}`, daysAgo(5 - i), {
    patterns: bg(0.05, [['qu', i === 0 ? 50 : 20, i === 0 ? 35 : 0, 20, 200, 0]]),
  }));

  assert.deepEqual(weekSlips({ runs: [...before, ...afterOneDaySpike], keyboard: KEYBOARD, focus: 'balanced', now: NOW, began: THEN }), []);

  // 3) Global bad week (every pair jumps from 5% to 20% together): never a slip.
  const afterGlobalBad = Array.from({ length: 5 }, (_, i) => run(`gb${i}`, daysAgo(5 - i), {
    patterns: bg(0.20, [['qu', 20, 4, 20, 200, 0]]),
  }));

  assert.deepEqual(weekSlips({ runs: [...before, ...afterGlobalBad], keyboard: KEYBOARD, focus: 'balanced', now: NOW, began: THEN }), []);

  // 4) Good week (rest drops from 10% to 2%, while "qu" stays at 10%): never a slip.
  const beforeHigh = Array.from({ length: 10 }, (_, i) => run(`ghb${i}`, daysAgo(16 - i), {
    patterns: bg(0.10, [['qu', 20, 2, 20, 200, 0]]),
  }));

  const afterGoodWeek = Array.from({ length: 5 }, (_, i) => run(`gha${i}`, daysAgo(5 - i), {
    patterns: bg(0.02, [['qu', 20, 2, 20, 200, 0]]),
  }));

  assert.deepEqual(weekSlips({ runs: [...beforeHigh, ...afterGoodWeek], keyboard: KEYBOARD, focus: 'balanced', now: NOW, began: THEN }), []);

  // 5) Three pairs co-slipping together over multiple days: all three detected.
  const beforeCo = Array.from({ length: 10 }, (_, i) => run(`cb${i}`, daysAgo(16 - i), {
    patterns: bg(0.05, [['qu', 20, 0, 20, 200, 0], ['ex', 20, 0, 20, 200, 0], ['ck', 20, 0, 20, 200, 0]]),
  }));

  const afterCo = Array.from({ length: 5 }, (_, i) => run(`ca${i}`, daysAgo(5 - i), {
    patterns: bg(0.05, [['qu', 20, 7, 20, 200, 0], ['ex', 20, 7, 20, 200, 0], ['ck', 20, 7, 20, 200, 0]]),
  }));

  assert.deepEqual(weekSlips({ runs: [...beforeCo, ...afterCo], keyboard: KEYBOARD, focus: 'balanced', now: NOW, began: THEN }).map((s) => s.unit).sort(), ['ck', 'ex', 'qu']);
});

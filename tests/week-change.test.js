import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, FOCUSES, SLOW_FLOOR_MS, englishFrequency, keyboardOf, recommendFor } from '../src/learner.js';
import { FIXED_OBSERVATIONS, FIXED_RUNS, trainPath } from '../src/train-path.js';
import { SHOWN_MOVERS, WEEK_MIN_RUNS, moverCopy, moverSample, weekChange, weekLead, weekMovers, weekPractice, weekStart } from '../src/week-change.js';
import { conditionKey, CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';
import { dayKey } from '../src/insights.js';
import { mergeSynced } from '../src/account.js';
import { seeded } from '../scripts/evaluate-learner.mjs';

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

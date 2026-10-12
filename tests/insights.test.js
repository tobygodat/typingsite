import test from 'node:test';
import assert from 'node:assert/strict';
import { CORPUS_VERSION, completeAttempt, conditionKey, createAttempt, quoteCorpus, selectPassage } from '../src/typing.js';
import { MAX_NON_COMPARABLE_RUNS, dailyPassage, dayKey, filterRuns, goalMinutes, MAX_RUN_SUMMARIES, minutesByDay, practiceLevel, practiceStreak, recurringTargets, retainHistory, retainRuns, runDay, runRecord, trendRun, weeklyChange } from '../src/insights.js';

const conditions = { mode: 'words', count: 25, wordList: '1k', corpus: CORPUS_VERSION };
const run = (id, overrides = {}) => ({ id, at: '2026-09-29T12:00:00Z', status: 'complete', kind: 'test',
  conditions, score: { wpm: 60, accuracy: 98 }, patterns: [['th', 12, 2, 10, 140, 20]], ...overrides });

test('trends never mix correction rules, word lists, drills, interruptions, or daily scores', () => {
  const runs = [run('a'), run('b', { conditions: { ...conditions, wordList: '5k' } }),
    run('c', { conditions: { ...conditions, correctionPolicy: 'relaxed' } }),
    run('d', { kind: 'drill' }), run('e', { kind: 'daily' }), run('f', { interrupted: true })];
  assert.deepEqual(filterRuns(runs.filter(trendRun), conditionKey(conditions)).map((r) => r.id), ['a']);
});

test('weekly medians require evidence in both weeks, and do not invent dates for old runs', () => {
  const date = new Date('2026-09-30T12:00:00Z');
  const recent = run('now', { score: { wpm: 70, accuracy: 97 } });
  const previous = run('then', { at: '2026-09-20T12:00:00Z', score: { wpm: 60, accuracy: 99 } });
  const old = run('undated', { at: null });
  assert.equal(weeklyChange([recent], conditionKey(conditions), date).wpm, null);
  const change = weeklyChange([recent, previous, old], conditionKey(conditions), date);
  assert.equal(change.wpm, 10);
  assert.equal(change.accuracy, -2);
  assert.equal(filterRuns([old], conditionKey(conditions), 30, date).length, 0);
  assert.equal(filterRuns([old], conditionKey(conditions), 'all', date).length, 1);
});

test('recurring targets need multiple runs, and revisit evidence starts after the immediate retest', () => {
  assert.deepEqual(recurringTargets([run('a')], [], conditions), []);
  const runs = [run('a'), run('b'), run('drill', { kind: 'drill', target: 'th', at: '2026-09-29T13:00:00Z' }),
    run('retest', { kind: 'retest', at: '2026-09-29T13:01:00Z' })];
  const loops = [{ target: 'th', conditions, at: '2026-09-29T13:01:00Z', drillCompleted: true }];
  const immediate = recurringTargets(runs, loops, conditions)[0];
  assert.equal(immediate.review, false);
  assert.equal(immediate.laterObservations, 0);
  const revisit = recurringTargets([...runs, run('next-day', { at: '2026-09-30T12:00:00Z' })], loops, conditions)[0];
  assert.equal(revisit.review, true);
  assert.equal(revisit.laterObservations, 12);
  assert.deepEqual(recurringTargets([run('daily-1', { kind: 'daily', fresh: false }), run('daily-2', { kind: 'daily', fresh: false })], [], conditions), []);
  const slow = (id, samples) => run(id, { patterns: [['th', 12, 0, samples, 140, 20]] });
  assert.deepEqual(recurringTargets([slow('s1', 9), slow('s2', 9)], [], conditions), []);
  assert.equal(recurringTargets([slow('s1', 10), slow('s2', 10)], [], conditions)[0].slowRuns, 2);
});

test('run summaries outlive trace retention, while pattern memory stays bounded', () => {
  const kept = retainRuns(Array.from({ length: 1100 }, (_, i) => run(String(i))));
  assert.equal(kept.length, 1000);
  assert.equal(kept[0].id, '100');
  assert.equal(kept.filter((r) => r.patterns.length).length, 120);
  assert.equal(kept[0].score.wpm, 60);
});

test('daily passage is stable within a UTC day, changes at midnight, and states its reset', () => {
  const morning = dailyPassage(new Date('2026-09-30T00:00:00Z'));
  const night = dailyPassage(new Date('2026-09-30T23:59:59Z'));
  const tomorrow = dailyPassage(new Date('2026-10-01T00:00:00Z'));
  assert.deepEqual(morning, night);
  assert.notEqual(morning.id, tomorrow.id);
  assert.notEqual(morning.text, tomorrow.text);
  const cycle = dailyPassage(new Date('2026-10-14T00:00:00Z'));
  assert.notEqual(cycle.id, morning.id);
  assert.equal(cycle.sourceTextId, morning.sourceTextId, 'the same passage keeps its identity on a later date');
  assert.equal(morning.resetAt, '2026-10-01T00:00:00.000Z');
  assert.equal(dailyPassage(new Date('2026-10-01T01:00:00+02:00')).day, '2026-09-30');
});

test('original quote pool has fresh choices in every length and difficulty bucket', () => {
  assert.equal(new Set(quoteCorpus.map((q) => q.id)).size, quoteCorpus.length);
  assert.equal(new Set(quoteCorpus.map((q) => q.text)).size, quoteCorpus.length);
  for (const quoteLength of ['short', 'medium', 'long']) {
    for (const difficulty of ['gentle', 'steady', 'precise']) {
      const seenIds = [];
      for (let i = 0; i < 3; i++) {
        const passage = selectPassage({ mode: 'quote', quoteLength, difficulty, seenIds, random: () => 0 });
        assert.ok(passage?.fresh, `${quoteLength}/${difficulty} needs at least three fresh passages`);
        const words = passage.text.split(/\s+/).length;
        assert.ok(quoteLength === 'short' ? words <= 30 : quoteLength === 'medium' ? words > 30 && words <= 60 : words > 60);
        seenIds.push(passage.id);
      }
    }
  }
});

test('daily minutes sum every run on the local day, and the streak counts days meeting the goal', () => {
  const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
  const runs = [
    run('a', { at: at(2026, 10, 8, 9), elapsedMs: 4 * 60000 }),
    run('b', { at: at(2026, 10, 8, 21), elapsedMs: 2 * 60000, kind: 'drill' }),
    run('c', { at: at(2026, 10, 7), elapsedMs: 6 * 60000, kind: 'daily' }),
    run('d', { at: at(2026, 10, 6), elapsedMs: 3 * 60000 }),
    run('e', { at: at(2026, 10, 5), elapsedMs: 0 }),
    run('f', { at: null, elapsedMs: 60000 }),
    run('g', { at: at(2026, 10, 7, 15), elapsedMs: 20 * 60000, status: 'interrupted', interrupted: true }),
  ];
  const byDay = minutesByDay(runs);
  assert.equal(byDay[dayKey(at(2026, 10, 8))], 6);
  assert.equal(byDay[dayKey(at(2026, 10, 5))], undefined);
  const today = new Date(2026, 9, 8, 22);
  assert.equal(practiceStreak(byDay, 5, today), 2);
  assert.equal(practiceStreak(byDay, 0, today), 3);
  assert.equal(practiceStreak(byDay, 10, today), 0);
  // Today not yet practised: yesterday's streak still stands until the day is over.
  assert.equal(practiceStreak(byDay, 0, new Date(2026, 9, 9, 8)), 3);
  assert.equal(practiceStreak(byDay, 0, new Date(2026, 9, 10, 8)), 0);
  assert.deepEqual([0, 1, 4, 6, 25].map((m) => practiceLevel(m, 5)), [0, 1, 2, 3, 4]);
  assert.equal(byDay[dayKey(at(2026, 10, 7))], 6, 'an interrupted run keeps no idle time');
  assert.deepEqual([0, undefined, 0.2, 4.99, 5, 12.7].map(goalMinutes), ['0', '0', '<1', '4', '5', '12']);
});

test('practice minutes outlive the run summaries that retention drops', () => {
  const at = (back) => new Date(2026, 9, 8 - back, 12).toISOString();
  const runs = Array.from({ length: MAX_RUN_SUMMARIES + 40 }, (_, i) => run(`r${i}`, { at: at(Math.floor((MAX_RUN_SUMMARIES + 39 - i) / 20)), elapsedMs: 30000 }));
  const before = minutesByDay(runs);
  const kept = retainHistory(runs, { '2025-01-01': 60000 });
  assert.equal(kept.runs.length, MAX_RUN_SUMMARIES);
  assert.deepEqual(minutesByDay(kept.runs, kept.practiceDays), { ...before, '2025-01-01': 1 });
  assert.deepEqual(retainHistory(kept.runs, kept.practiceDays), kept, 'retaining again moves nothing twice');
});

test('custom runs count as practice time, and their time outlives their own retention budget', () => {
  const at = (back) => new Date(2026, 9, 8 - back, 12).toISOString();
  // Ten older custom runs fall outside the 50-run custom budget; comparable runs fill exactly their own budget.
  const custom = Array.from({ length: MAX_NON_COMPARABLE_RUNS + 10 }, (_, i) => run(`c${i}`, { kind: 'custom', patterns: undefined, at: at(i < 10 ? 3 : 1), elapsedMs: 60000 }));
  const tests = Array.from({ length: MAX_RUN_SUMMARIES }, (_, i) => run(`t${i}`, { at: at(0), elapsedMs: 30000 }));
  const runs = [...custom, ...tests];
  const before = minutesByDay(runs);
  assert.equal(before[dayKey(at(3))], 10, 'custom minutes count toward the day');
  const kept = retainHistory(runs);
  assert.equal(kept.runs.filter((r) => r.kind === 'custom').length, MAX_NON_COMPARABLE_RUNS);
  assert.equal(kept.runs.filter((r) => r.kind === 'test').length, MAX_RUN_SUMMARIES, 'custom runs push no comparable run out');
  assert.deepEqual(kept.practiceDays, { [dayKey(at(3))]: 600000 });
  assert.deepEqual(minutesByDay(kept.runs, kept.practiceDays), before);
  assert.deepEqual(retainHistory(kept.runs, kept.practiceDays), kept, 'retaining again moves nothing twice');
});

test('a run keeps the day it was practised on, whichever time zone reads it later', () => {
  const zone = process.env.TZ;
  try {
    // 23:30 on 8 October in Los Angeles is already 9 October in Tokyo.
    process.env.TZ = 'America/Los_Angeles';
    const attempt = completeAttempt(createAttempt({ id: 'late', text: 'the', textId: 'one', conditions }), { endedAt: 0 });
    const late = { ...runRecord({ ...attempt, status: 'complete' }, '2026-10-09T06:30:00Z'), elapsedMs: 10 * 60000 };
    assert.equal(late.day, '2026-10-08');
    const newer = Array.from({ length: MAX_RUN_SUMMARIES }, (_, i) => run(`n${i}`, { at: '2026-10-11T18:00:00Z', day: '2026-10-11', elapsedMs: 1000 }));
    const readings = ['America/Los_Angeles', 'Asia/Tokyo'].map((tz) => {
      process.env.TZ = tz;
      const kept = retainHistory([late, ...newer]);
      return [kept.practiceDays, minutesByDay([late]), minutesByDay(kept.runs, kept.practiceDays)['2026-10-08']];
    });
    assert.deepEqual(readings[0], [{ '2026-10-08': 600000 }, { '2026-10-08': 10 }, 10]);
    assert.deepEqual(readings[1], readings[0], 'retained and archived runs land on the same day in both zones');
    // A summary from before days were recorded falls back to its timestamp in the reading zone.
    assert.equal(runDay({ ...late, day: undefined }), '2026-10-09');
    assert.equal(runDay({ at: null }), null);
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});

test('custom run records keep the score but no per-pair patterns', () => {
  const typed = (kind) => {
    const attempt = createAttempt({ id: kind, text: 'the then', kind, conditions });
    [...'the then'].forEach((char, i) => attempt.events.push({ type: 'insert', text: char, position: i, accepted: true, offsetMs: i * 120 }));
    return completeAttempt(attempt, { endedAt: 1000 });
  };
  const custom = runRecord(typed('custom'));
  assert.equal('patterns' in custom, false);
  assert.equal(custom.kind, 'custom');
  assert.ok(custom.score.wpm > 0);
  assert.ok(runRecord(typed('test')).patterns.length > 0);
  // Retention never adds an empty pattern list back to a record that had none.
  assert.equal('patterns' in retainRuns([custom, ...Array.from({ length: 130 }, (_, i) => run(String(i)))])[0], false);
});

test('custom runs keep their own budget and never displace practice history', () => {
  const practice = Array.from({ length: 10 }, (_, i) => run(`p${i}`));
  const custom = (count) => Array.from({ length: count }, (_, i) => run(`c${i}`, { kind: 'custom', patterns: undefined }));
  // 130 custom runs after 10 practice runs: the practice runs are still inside the pattern window.
  const afterSome = retainRuns([...practice, ...custom(130)]);
  assert.deepEqual(afterSome.filter((r) => r.kind === 'test').map((r) => r.patterns.length), Array(10).fill(1));
  // 1,100 custom runs evict no practice summary, and custom keeps only its newest 50.
  const afterMany = retainRuns([...practice, ...custom(1100)]);
  assert.equal(afterMany.filter((r) => r.kind === 'test').length, 10);
  assert.equal(afterMany.filter((r) => r.kind === 'custom').length, MAX_NON_COMPARABLE_RUNS);
  assert.equal(afterMany.at(-1).id, 'c1099');
  assert.equal(afterMany.find((r) => r.kind === 'custom').id, 'c1050');
  assert.equal(afterMany.some((r) => r.kind === 'custom' && 'patterns' in r && r.patterns !== undefined), false);
  // Interleaved runs stay in the order they happened.
  const mixed = Array.from({ length: 200 }, (_, i) => (i % 3 ? run(`m${i}`, { kind: 'custom', patterns: undefined }) : run(`m${i}`)));
  const order = retainRuns(mixed).map((r) => Number(r.id.slice(1)));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('a profile with only comparable runs is retained exactly as before', () => {
  // The retention rule as it stood before custom text existed.
  const previous = (runs) => {
    const kept = runs.slice(-1000);
    return kept.map((r, i) => (i < kept.length - 120 ? { ...r, patterns: [] } : r));
  };
  const kinds = ['test', 'retest', 'drill', 'daily'];
  const legacy = Array.from({ length: 1100 }, (_, i) => run(String(i), { kind: kinds[i % kinds.length] }));
  legacy[1050] = { ...legacy[1050], patterns: undefined };
  legacy[500] = { ...legacy[500], patterns: undefined };
  assert.equal(JSON.stringify(retainRuns(legacy)), JSON.stringify(previous(legacy)));
  const short = legacy.slice(0, 40);
  assert.equal(JSON.stringify(retainRuns(short)), JSON.stringify(previous(short)));
});

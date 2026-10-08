import test from 'node:test';
import assert from 'node:assert/strict';
import { CORPUS_VERSION, conditionKey, quoteCorpus, selectPassage } from '../src/typing.js';
import { dailyPassage, dayKey, filterRuns, goalMinutes, MAX_RUN_SUMMARIES, minutesByDay, practiceLevel, practiceStreak, recurringTargets, retainHistory, retainRuns, trendRun, weeklyChange } from '../src/insights.js';

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

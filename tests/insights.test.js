import test from 'node:test';
import assert from 'node:assert/strict';
import { CORPUS_VERSION, compareAttempts, completeAttempt, conditionKey, createAttempt, quoteCorpus, recommendTarget, selectPassage, summarizePatterns } from '../src/typing.js';
import { dailyPassage, filterRuns, recurringTargets, retainRuns, runRecord, trendRun, validRun, weeklyChange } from '../src/insights.js';

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

test('a run stopped by a minimum is interrupted everywhere; a completed run keeps its minimums as a label', () => {
  const attempt = createAttempt({ id: 'min', text: 'the cat', textId: 'one', kind: 'test', conditions });
  attempt.events = [...'thx cat'].map((text, i) => ({ type: 'insert', text, offsetMs: i * 200 }));
  attempt.startedAt = 0;
  attempt.minimums = { accuracy: 95 };
  const stopped = { ...completeAttempt(attempt, { endedAt: 6000 }), status: 'interrupted', stopped: { metric: 'accuracy', minimum: 95, value: 86 } };
  const record = runRecord(stopped, '2026-10-08T12:00:00Z');
  assert.equal(record.interrupted, true);
  assert.equal(validRun(record), false);
  assert.equal(trendRun(record), false);
  assert.deepEqual(record.stopped, { metric: 'accuracy', minimum: 95, value: 86 });
  // The stop alone keeps a run out of trends and practice time, whatever its stored status says.
  assert.equal(validRun(runRecord({ ...stopped, status: 'complete' })), false);

  const kept = runRecord(completeAttempt({ ...attempt, minimums: { wpm: 20 } }, { endedAt: 6000 }), '2026-10-08T12:00:00Z');
  assert.equal(trendRun(kept), true);
  assert.deepEqual(kept.minimums, { wpm: 20 });
  assert.equal(conditionKey(kept.conditions), conditionKey(conditions));
  assert.equal('stopped' in kept, false);
  assert.equal('minimums' in runRecord(completeAttempt({ ...attempt, minimums: undefined }, { endedAt: 6000 })), false);
});

test('a retest stopped by its baseline\'s minimum is never compared, and its pairs feed no evidence', () => {
  const typed = (id, text, keys) => {
    const attempt = createAttempt({ id, text, textId: id, kind: id === 'before' ? 'test' : 'retest', conditions });
    attempt.events = [...keys].map((key, i) => ({ type: 'insert', text: key, offsetMs: i * 150 }));
    attempt.startedAt = 0;
    attempt.minimums = { wpm: 20 };
    return completeAttempt(attempt, { endedAt: keys.length * 150 });
  };
  const text = 'the other three think that the';
  const before = typed('before', text, text);
  // As the app stores it: interrupted, with the stop that ended it.
  const after = { ...typed('after', text, 'thx other three think that the'), status: 'interrupted', stopped: { metric: 'wpm', minimum: 20, value: 12 } };
  const comparison = compareAttempts(before, after);
  assert.equal(comparison.comparable, false);
  assert.equal(comparison.reason, 'The retest fell under the baseline’s minimums, so no comparison is made.');
  assert.equal('wpmDelta' in comparison, false);
  assert.equal(summarizePatterns([after]).attemptCount, 0);
  assert.equal(summarizePatterns([before, after]).pairs.find((p) => p.pair === 'th').observations, summarizePatterns([before]).pairs.find((p) => p.pair === 'th').observations);
  assert.equal(recommendTarget([after]).evidence.attemptCount, 0);
  assert.deepEqual(runRecord(after, '2026-10-08T12:00:00Z').patterns, []);
  assert.deepEqual(recurringTargets([runRecord(after, '2026-10-08T12:00:00Z'), runRecord({ ...after, id: 'again' }, '2026-10-08T12:01:00Z')], [], conditions), []);
});

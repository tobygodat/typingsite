import test from 'node:test';
import assert from 'node:assert/strict';
import { CORPUS_VERSION, completeAttempt, conditionKey, createAttempt, quoteCorpus, selectPassage } from '../src/typing.js';
import { KEY_COUNTS_VERSION, dailyPassage, filterRuns, keyAnalysis, recurringTargets, retainRuns, runRecord, trendRun, weeklyChange } from '../src/insights.js';

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
  assert.equal(kept.filter((r) => r.keys?.length).length, 0);
  const withKeys = retainRuns(Array.from({ length: 200 }, (_, i) => run(String(i), { keys: [['t', 3, 0]], keysVersion: KEY_COUNTS_VERSION })));
  assert.equal(withKeys.filter((r) => r.keys.length).length, 120);
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

test('key analysis sums first attempts per key and ranks pairs only with enough samples', () => {
  const runs = [run('a', { patterns: [['th', 12, 2, 10, 140, 20], ['ah', 4, 1, 0, null, null], ['an', 5, 0, 0, null, null]] }),
    run('b', { patterns: [['th', 8, 0, 4, 120, -5], ['an', 3, 1, 0, null, null]] }),
    run('c', { interrupted: true, patterns: [['th', 50, 50, 0, null, null]] })];
  const result = keyAnalysis(runs);
  assert.equal(result.runs, 2);
  assert.deepEqual(result.keys.h, { key: 'h', samples: 24, errors: 3, missRate: 3 / 24, enough: true });
  assert.equal(result.keys.n.enough, false);
  assert.equal(result.keys.n.samples, 8);
  assert.deepEqual(result.pairs.map((p) => [p.pair, p.samples, p.errors, p.slowRuns]), [['th', 20, 2, 1]]);
  assert.equal(result.pairDerivedRuns, 2);
});

test('run summaries count every letter directly, including word-initial presses', () => {
  const text = 'quiet quay';
  const attempt = createAttempt({ id: 'q', text, textId: 'q', conditions });
  attempt.startedAt = 0;
  // Mistype the first "q" (word-initial) and the "i" after "u" (mid-word).
  attempt.events = [...text].map((char, position) => ({ type: 'insert', position, offsetMs: (position + 1) * 100, accepted: true,
    text: position === 0 ? 'w' : position === 2 ? 'o' : char }));
  const record = runRecord({ ...completeAttempt(attempt, { endedAt: 1100 }), fresh: true });
  assert.equal(record.keysVersion, KEY_COUNTS_VERSION);
  const keys = Object.fromEntries(record.keys.map(([key, samples, errors]) => [key, { samples, errors }]));
  assert.deepEqual(keys.q, { samples: 2, errors: 1 });
  assert.deepEqual(keys.i, { samples: 1, errors: 1 });
  assert.equal(keys[' '], undefined);
  assert.equal(record.keys.reduce((n, k) => n + k[1], 0), 9);
  // Pair memory alone would see no "q" at all: both are word-initial.
  assert.equal(record.patterns.some(([pair]) => pair[1] === 'q'), false);

  // Direct counts win over pairs; an older summary without them still contributes its pairs.
  const direct = run('new', { keysVersion: KEY_COUNTS_VERSION, keys: [['q', 12, 3], ['h', 4, 0]] });
  const legacy = run('old');
  const result = keyAnalysis([legacy, direct]);
  assert.equal(result.runs, 2);
  assert.equal(result.pairDerivedRuns, 1);
  assert.deepEqual(result.keys.q, { key: 'q', samples: 12, errors: 3, missRate: 0.25, enough: true });
  assert.deepEqual(result.keys.h, { key: 'h', samples: 16, errors: 2, missRate: 2 / 16, enough: true });
  assert.equal(keyAnalysis([run('drill', { kind: 'drill', patterns: [], keys: [], keysVersion: KEY_COUNTS_VERSION })]).runs, 0);
});

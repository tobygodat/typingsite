import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfile } from '../src/profile.js';
import { CORPUS_VERSION, compareAttempts, completeAttempt, conditionKey, createAttempt, quoteCorpus, selectPassage, summarizePatterns } from '../src/typing.js';
import { KEY_COUNTS_VERSION, NON_COMPARABLE_KINDS, evidenceRun, filterRuns, keyAnalysis, passageBest, practiceRun, recurringMissedWords, recurringTargets, standardScore, trendRun, weeklyChange } from '../src/insights.js';

const bucket = quoteCorpus.filter((q) => q.difficulty === 'gentle' && q.text.split(/\s+/).length <= 30).map((q) => q.id);
const quote = (overrides) => selectPassage({ mode: 'quote', quoteLength: 'short', difficulty: 'gentle', ...overrides });

test('by default a seen quote waits until every matching quote has been shown', () => {
  assert.equal(bucket.length, 3);
  const [seen, ...unseen] = bucket;
  for (const random of [() => 0, () => 0.5, () => 0.99]) {
    const passage = quote({ seenIds: [seen], random });
    assert.ok(unseen.includes(passage.id));
    assert.equal(passage.fresh, true);
    assert.equal(passage.exhausted, false);
    assert.deepEqual(quote({ seenIds: [seen], random, allowRepeats: false }), passage, 'off is the default');
  }
  // Every matching quote seen: the old fallback still repeats, labelled and exhausted.
  const exhausted = quote({ seenIds: bucket, random: () => 0 });
  assert.equal(exhausted.id, bucket[0]);
  assert.equal(exhausted.fresh, false);
  assert.equal(exhausted.exhausted, true);
});

test('with repeats on, seen quotes can come back, and only they are labelled repeated', () => {
  const [seen, next] = bucket;
  const repeated = quote({ seenIds: [seen], allowRepeats: true, random: () => 0 });
  assert.equal(repeated.id, seen);
  assert.equal(repeated.fresh, false, 'a seen quote is never fresh');
  assert.equal(repeated.exhausted, false, 'unseen quotes remain for a retest');
  const unseen = quote({ seenIds: [seen], allowRepeats: true, random: () => 0.5 });
  assert.equal(unseen.id, next);
  assert.equal(unseen.fresh, true);
  // The whole pool is a candidate, so over many draws every quote appears.
  const drawn = new Set(Array.from({ length: 3 }, (_, i) => quote({ seenIds: bucket, allowRepeats: true, random: () => (i + 0.5) / 3 }).id));
  assert.deepEqual([...drawn].sort(), [...bucket].sort());
  assert.ok(Array.from({ length: 3 }, (_, i) => quote({ seenIds: bucket, allowRepeats: true, random: () => (i + 0.5) / 3 })).every((p) => p.fresh === false && p.exhausted));
});

test('repeats apply to quotes only; generated text is still chosen fresh', () => {
  const passage = selectPassage({ mode: 'words', count: 10, allowRepeats: true, seenIds: [] });
  assert.equal(passage.fresh, true);
});

test('repeated text is never either side of a comparable retest', () => {
  const conditions = { mode: 'quote', quoteLength: 'short', difficulty: 'gentle', corpus: CORPUS_VERSION };
  const run = (textId, kind, fresh, wpm) => ({ status: 'complete', kind, textId, fresh, interrupted: false, metricVersion: 'stilltype-metrics-v1',
    conditions, summary: { score: { wpm, accuracy: 98 } } });
  assert.equal(compareAttempts(run('a', 'test', true, 60), run('b', 'retest', true, 62)).comparable, true);
  assert.equal(compareAttempts(run('a', 'test', false, 80), run('b', 'retest', true, 62)).comparable, false, 'a familiar baseline would flatter it');
  assert.equal(compareAttempts(run('a', 'test', true, 60), run('b', 'retest', false, 70)).comparable, false);
  // A daily repeat attempt, or a first attempt on a returning daily passage, is repeated text too.
  assert.equal(compareAttempts(run('a', 'daily', true, 60), run('b', 'retest', true, 62)).comparable, true);
  assert.equal(compareAttempts(run('a', 'daily', false, 80), run('b', 'retest', true, 62)).comparable, false);
});

function trace(id, fresh) {
  const text = Array(12).fill('the').join(' ');
  const attempt = createAttempt({ id, text, textId: 'quote-1', kind: 'test', conditions: { mode: 'quote' } });
  attempt.startedAt = 0;
  attempt.events = [...text].map((char, position) => ({ type: 'insert', text: position % 4 === 1 ? 'x' : char, position, offsetMs: position * 100, accepted: true }));
  return { ...completeAttempt(attempt, { endedAt: text.length * 100 }), fresh };
}

test('repeated text adds no pattern evidence, so one quote cannot flood the recommendation', () => {
  assert.equal(summarizePatterns([trace('fresh', true)]).attemptCount, 1);
  assert.equal(summarizePatterns([trace('legacy', undefined)]).attemptCount, 1, 'runs saved before the flag still count');
  assert.equal(summarizePatterns([trace('again', false), trace('again-2', false)]).attemptCount, 0);
});

const conditions = { mode: 'quote', quoteLength: 'short', difficulty: 'gentle', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', corpus: CORPUS_VERSION };
const summary = (id, overrides = {}) => ({ id, at: '2026-10-08T12:00:00Z', status: 'complete', kind: 'test', textId: 'short-gentle-01', fresh: true,
  conditions, score: { wpm: 70, accuracy: 98 }, patterns: [['th', 12, 2, 10, 140, 20]], ...overrides });

test('repeated runs are listed in Progress but stay out of bests, trends and weekly medians', () => {
  const fresh = summary('fresh');
  const repeated = summary('repeat', { fresh: false, score: { wpm: 95, accuracy: 100 } });
  assert.equal(practiceRun(repeated), true);
  // trendRun is also the personal-best gate in storeAttempt.
  assert.equal(trendRun(repeated), false);
  assert.equal(trendRun(fresh), true);
  assert.equal(trendRun(summary('legacy', { fresh: undefined })), true);
  assert.deepEqual([fresh, repeated].filter(trendRun).map((r) => r.id), ['fresh']);
  const date = new Date('2026-10-09T12:00:00Z');
  const lastWeek = summary('last-week', { at: '2026-09-30T12:00:00Z', textId: 'short-gentle-02', score: { wpm: 60, accuracy: 98 } });
  assert.equal(weeklyChange([lastWeek, fresh, repeated], conditionKey(conditions), date).wpm, 10, 'the 95 on repeated text is ignored');
  assert.equal(filterRuns([fresh, repeated].filter(practiceRun), conditionKey(conditions)).length, 2);
});

test('repeated runs never become recurring targets or revisit evidence', () => {
  assert.equal(recurringTargets([summary('a'), summary('b')], [], conditions).length, 1);
  assert.deepEqual(recurringTargets([summary('a', { fresh: false }), summary('b', { fresh: false })], [], conditions), []);
  assert.deepEqual(recurringTargets([summary('a'), summary('b', { fresh: false })], [], conditions), []);
});

test('a repeat chases the best earlier run on the same passage and conditions', () => {
  const current = summary('now', { fresh: false, score: { wpm: 90, accuracy: 99 } });
  assert.equal(passageBest([], current), null);
  const runs = [
    summary('first', { score: { wpm: 72, accuracy: 97 } }),
    summary('second', { fresh: false, score: { wpm: 81, accuracy: 98 } }),
    summary('other-text', { textId: 'short-gentle-02', score: { wpm: 99, accuracy: 99 } }),
    summary('other-rule', { conditions: { ...conditions, correctionPolicy: 'mandatory' }, score: { wpm: 99, accuracy: 99 } }),
    summary('interrupted', { interrupted: true, score: { wpm: 99, accuracy: 99 } }),
    summary('drill', { kind: 'drill', score: { wpm: 99, accuracy: 99 } }),
    current,
  ];
  assert.equal(passageBest(runs, current).id, 'second');
});

test('a best stored before repeat quotes is kept as saved on load, even one an exhausted pool set', () => {
  const key = conditionKey(conditions);
  const fresh = summary('fresh', { score: { wpm: 70, accuracy: 98 } });
  const exhausted = summary('exhausted', { fresh: false, score: { wpm: 95, accuracy: 100 } });
  const stored = { [key]: { wpm: 95, attemptId: 'exhausted', at: exhausted.at }, other: { wpm: 80, attemptId: 'not-retained', at: '2026-01-01T00:00:00Z' } };
  const loaded = normalizeProfile({ version: 2, runs: [fresh, exhausted], bests: structuredClone(stored) });
  assert.deepEqual(loaded.bests, stored, 'nothing re-checks an old best against its run');
  assert.equal(loaded.runs.find((r) => r.id === 'exhausted').fresh, false, 'its run stays repeated text, out of trends');
});

test('custom text is excluded by kind as well as by freshness: never listed, trended, chased or a best', () => {
  const customConditions = { ...conditions, mode: 'custom', quoteLength: null, difficulty: null, customOrder: 'as-written' };
  const custom = (id, wpm) => summary(id, { kind: 'custom', textId: null, fresh: false, conditions: customConditions, score: { wpm, accuracy: 99 }, patterns: undefined });
  const earlier = custom('custom-1', 120);
  const now = custom('custom-2', 90);
  assert.equal(practiceRun(now), false);
  assert.equal(trendRun(now), false);
  assert.equal(passageBest([earlier, now], now), null, 'a custom run has no passage best to chase');

  // The gate reads comparableKind, so any kind added to NON_COMPARABLE_KINDS drops out of all three at once.
  const fresh = summary('fresh-retest', { kind: 'retest' });
  const later = summary('later-retest', { kind: 'retest', fresh: false });
  assert.equal(trendRun(fresh), true);
  NON_COMPARABLE_KINDS.add('retest');
  try {
    assert.equal(practiceRun(fresh), false);
    assert.equal(trendRun(fresh), false);
    assert.equal(passageBest([fresh, later], later), null);
  } finally {
    NON_COMPARABLE_KINDS.delete('retest');
  }
  assert.equal(trendRun(fresh), true);
});

test('repeated text adds nothing to the key heatmap, missed words or the standard score', () => {
  const keys = (id, fresh) => summary(id, { fresh, keys: [['t', 12, 3]], keysVersion: KEY_COUNTS_VERSION, missedWords: ['the'] });
  // Runs an exhausted pool saved before repeat quotes may still carry counts; they are not read.
  assert.equal(keyAnalysis([keys('fresh', true), keys('repeat', false)]).runs, 1);
  assert.equal(keyAnalysis([keys('repeat', false), keys('repeat-2', false)]).runs, 0);
  assert.equal(evidenceRun(keys('repeat', false)), false);
  assert.equal(evidenceRun(keys('legacy', undefined)), true, 'runs saved before the flag still count');
  assert.deepEqual(recurringMissedWords([keys('a', false), keys('b', false)]).words, []);
  assert.equal(recurringMissedWords([keys('a', true), keys('b', true)]).words.length, 1);
  const repeated = Array.from({ length: 3 }, (_, i) => summary(`r-${i}`, { fresh: false, score: { wpm: 99, accuracy: 100 } }));
  assert.equal(standardScore(repeated, conditionKey(conditions)).total, 0);
});

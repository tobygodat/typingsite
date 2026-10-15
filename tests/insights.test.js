import test from 'node:test';
import assert from 'node:assert/strict';
import { CORPUS_VERSION, completeAttempt, conditionKey, createAttempt, quoteCorpus, selectPassage, standardConditions } from '../src/typing.js';
import { MAX_NON_COMPARABLE_RUNS, dailyPassage, filterRuns, recurringTargets, retainRuns, runRecord, standardInputClass, standardScore, trendRun, weeklyChange } from '../src/insights.js';

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

test('the standard score keeps its best and a median of recent runs, and waits for three runs', () => {
  const standard = standardConditions();
  const key = conditionKey(standard);
  const at = (wpm, overrides = {}) => run(`s${wpm}`, { conditions: standard, score: { wpm, accuracy: 97 }, ...overrides });
  assert.deepEqual(standardScore([], key), { total: 0, recent: 0, best: null, median: null, settled: false });
  // Two runs: a best, but no median yet.
  const two = [at(60), at(70)];
  assert.deepEqual(standardScore(two, key), { total: 2, recent: 2, best: 70, median: null, settled: false });
  // Other conditions, drills, daily, interrupted and a different recipe or input never count.
  const noise = [run('time'), at(99, { kind: 'drill' }), at(98, { kind: 'daily' }), at(97, { interrupted: true }),
    at(96, { status: 'interrupted' }), at(95, { conditions: { ...standard, recipe: 'standard-v2' } }),
    at(94, { conditions: standardConditions('touch') }), at(93, { conditions: { ...standard, mode: 'time', recipe: undefined } })];
  const three = [...two, ...noise, at(64, { kind: 'retest' })];
  assert.deepEqual(standardScore(three, key), { total: 3, recent: 3, best: 70, median: 64, settled: true });
  // The median covers only the newest ten; the best is the one passed in (the stored best) when there is one.
  const twelve = [at(100), at(90), ...Array.from({ length: 10 }, (_, i) => at(50 + i))];
  assert.deepEqual(standardScore(twelve, key), { total: 12, recent: 10, best: 100, median: 54.5, settled: true });
  assert.equal(standardScore(twelve, key, 101).best, 101);
});

test('the standard headline stays on the keyboard unless touch has the only score or a settled, busier one', () => {
  // Shaped like standardScore: `total` counts only runs still in the kept summaries; a best can outlive them.
  const score = (total, best = total ? 60 : null) => ({ total, recent: Math.min(total, 10), best, median: null, settled: total >= 3 });
  const pick = (keyboard, touch) => standardInputClass(keyboard, touch);
  assert.equal(pick(score(0), score(0)), 'physical-keyboard');
  // Kept counts aren't lifetime counts: a keyboard best whose runs aged out holds against one or two touch runs.
  assert.equal(pick(score(0, 82), score(1)), 'physical-keyboard');
  assert.equal(pick(score(0, 82), score(2)), 'physical-keyboard');
  assert.equal(pick(score(1), score(2)), 'physical-keyboard');
  // Touch heads once it has a median from more kept runs than the keyboard (a tie stays on the keyboard)...
  assert.equal(pick(score(0, 82), score(3)), 'touch');
  assert.equal(pick(score(1), score(3)), 'touch');
  assert.equal(pick(score(3), score(3)), 'physical-keyboard');
  assert.equal(pick(score(3), score(4)), 'touch');
  // ...or when the keyboard has nothing at all, even if touch has only a kept best.
  assert.equal(pick(score(0), score(1)), 'touch');
  assert.equal(pick(score(0), score(0, 47)), 'touch');
});

test('a custom run never reaches the standard score, even under standard conditions', () => {
  const standard = standardConditions();
  const key = conditionKey(standard);
  const at = (wpm, overrides = {}) => run(`s${wpm}`, { conditions: standard, score: { wpm, accuracy: 97 }, ...overrides });
  const runs = [at(60), at(62), at(64), at(150, { kind: 'custom' }), at(140, { kind: 'custom' }), at(130, { kind: 'custom' })];
  assert.deepEqual(standardScore(runs, key), { total: 3, recent: 3, best: 64, median: 62, settled: true });
  assert.deepEqual(standardScore(runs.slice(3), key), { total: 0, recent: 0, best: null, median: null, settled: false });
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

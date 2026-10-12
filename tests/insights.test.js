import test from 'node:test';
import assert from 'node:assert/strict';
import { CORPUS_VERSION, completeAttempt, conditionKey, createAttempt, quoteCorpus, selectPassage, wordHistory } from '../src/typing.js';
import { MAX_MISSED_WORDS, MAX_NON_COMPARABLE_RUNS, MAX_PATTERN_RUNS, comparableKind, dailyPassage, evidenceRun, filterRuns, measuredKind, missedAndSlowWords, practiceTextConditions, practiceWordsPassage, recurringMissedWords, recurringTargets, retainRuns, runRecord, trendRun, weeklyChange } from '../src/insights.js';

test('missed and slowest words come from first tries and per-word speed', () => {
  const text = 'the cat sat on mat';
  // One keystroke every 100 ms, except "on" is slow and "cat" has a wrong first try.
  const events = [];
  let t = 0;
  for (let i = 0; i < text.length; i += 1) {
    t += i >= 12 && i <= 13 ? 600 : 100;
    if (i === 5) events.push({ type: 'insert', text: 'x', position: i, offsetMs: t - 50 }, { type: 'delete', count: 1, offsetMs: t - 25 });
    events.push({ type: 'insert', text: text[i], position: i, offsetMs: t });
  }
  const { missed, slow, timedCount, medianWpm } = missedAndSlowWords({ text, events }, 2);
  assert.deepEqual(missed, ['cat']);
  // "on" took 1200 ms for two letters plus its space: 2 / 5 words in 1.2 s is 20 wpm.
  assert.deepEqual(slow[0], { word: 'on', wpm: 20 });
  assert.equal(slow.length, 2);
  assert.ok(!slow.some((item) => item.word === 'cat'));
  // Four clean words were timed; the median sits between the two middle speeds.
  assert.equal(timedCount, 4);
  assert.ok(medianWpm > slow[0].wpm);
  const passage = practiceWordsPassage(['cat', 'on'], 40);
  assert.equal(passage, practiceWordsPassage(['cat', 'on'], 40));
  assert.equal(passage.split(' ').length, 40);
  assert.ok(!/\b(\w+) \1\b/.test(passage));
  assert.equal(practiceWordsPassage([]), '');
  // More words than the passage length: the passage grows so none is dropped.
  const many = Array.from({ length: 45 }, (_, i) => `w${i}`);
  const long = practiceWordsPassage(many, 40).split(' ');
  assert.equal(long.length, 45);
  assert.deepEqual([...long].sort(), [...many].sort());
});

test('a corrected space does not charge its correction to the next word', () => {
  const text = 'the cat sat';
  const at = (char, position, offsetMs) => ({ type: 'insert', text: char, position, offsetMs });
  const events = [...'the cat'].map((char, i) => at(char, i, (i + 1) * 100));
  // The space after "cat" is mistyped at 800 ms, deleted, and only typed 2 s later; "sat" then
  // follows quickly. Timed from the deleted keystroke, "sat" would read as 15 wpm and slowest.
  events.push(at('x', 7, 800), { type: 'delete', count: 1, offsetMs: 900 }, at(' ', 7, 2900));
  events.push(at('s', 8, 2980), at('a', 9, 3060), at('t', 10, 3140));
  const { missed, slow, timedCount, medianWpm } = missedAndSlowWords({ text, events }, 3);
  // The mistyped space is "cat"'s miss, so "cat" isn't clean: not timed, not in the median.
  assert.deepEqual(missed, ['cat']);
  assert.equal(timedCount, 2);
  // "sat" is timed from the kept space: 3 letters in 240 ms is 150 wpm. "the" counts h-e only.
  assert.deepEqual(Object.fromEntries(slow.map((item) => [item.word, item.wpm])), { the: 120, sat: 150 });
  assert.equal(medianWpm, 135);
});

test('per-word pace counts one interval per character, since the previous kept keystroke', () => {
  const text = 'to table, a cat sat';
  const at = (char, position, offsetMs) => ({ type: 'insert', text: char, position, offsetMs });
  // [character, ms since the previous keystroke]; the space before "cat" is mistyped, deleted and
  // retyped, so "cat" starts from the kept space at 5600 ms, and "a" is missed for its space.
  const keys = [['t', 1000], ['o', 100], [' ', 100], ['t', 200], ['a', 200], ['b', 200], ['l', 200], ['e', 200],
    [',', 1000], [' ', 100], ['a', 300]];
  const events = [];
  let t = 0;
  keys.forEach(([char, gap], position) => events.push(at(char, position, (t += gap))));
  events.push(at('x', 11, 3700), { type: 'delete', count: 1, offsetMs: 3800 }, at(' ', 11, 5600));
  t = 5600;
  [...'cat sat'].forEach((char, i) => events.push(at(char, 12 + i, (t += char === ' ' ? 100 : i < 3 ? 150 : 100))));
  const result = missedAndSlowWords({ text, events }, 10);
  const pace = Object.fromEntries(result.slow.map((item) => [item.word, item.wpm]));
  for (const [word, wpm, why] of [
    ['to', 120, 'first word: its first key has no interval, so only "o" counts (1 char in 100 ms)'],
    ['table', 60, 'trailing comma left out: t-a-b-l-e, 5 chars in 1000 ms, not 6 in 2000 ms'],
    ['cat', 80, 'after a corrected space: 3 chars in 450 ms from the kept space'],
    ['sat', 120, 'plain mid word: 3 chars in 300 ms'],
  ]) assert.equal(pace[word], wpm, why);
  assert.deepEqual(result.missed, ['a']);
  assert.equal(result.timedCount, 4);
  assert.equal(result.medianWpm, 100, 'clean words only: 60, 80, 120, 120');
  // A one-letter first word has no interval at all, so it isn't timed; one mid-run is timed from its
  // space (1 char in 300 ms).
  const short = missedAndSlowWords({ text: 'a go a', events: [at('a', 0, 0), at(' ', 1, 100), at('g', 2, 200),
    at('o', 3, 300), at(' ', 4, 400), at('a', 5, 700)] });
  assert.deepEqual(short.slow, [{ word: 'a', wpm: 40 }, { word: 'go', wpm: 120 }]);
  assert.equal(short.timedCount, 2);
});

test('a dropped leading quote takes its interval with it: "the is timed on h-e', () => {
  const at = (char, position, offsetMs) => ({ type: 'insert', text: char, position, offsetMs });
  // 100 ms a key, with a 1 s pause before the key at `pause`.
  const typed = (text, pause) => {
    let t = 0;
    return { text, events: [...text].map((char, i) => at(char, i, (t += i === pause ? 1000 : 100))) };
  };
  const pace = (result) => Object.fromEntries(result.slow.map((item) => [item.word, item.wpm]));
  // A pause between the quote and "t" is a transition the drilled "the" never types: 2 / 5 in 200 ms.
  const quoted = missedAndSlowWords(typed('say "the cat', 5), 10);
  assert.deepEqual(pace(quoted), { say: 120, the: 120, cat: 120 });
  assert.equal(quoted.medianWpm, 120);
  // Control: a pause before a plain word's first letter still counts, 3 / 5 in 1.2 s.
  assert.deepEqual(pace(missedAndSlowWords(typed('say the cat', 4), 10)), { the: 30, say: 120, cat: 120 });
});

test('a mistyped space marks the word before it, as the run card does', () => {
  const text = 'the cat sat';
  const missedSpace = typedWithMisses(text, [7]); // the space after "cat"; the last word has none
  const result = missedAndSlowWords(missedSpace, 10);
  assert.deepEqual(result.missed, ['cat']);
  assert.deepEqual(wordHistory(missedSpace).filter((word) => word.wrong).map((word) => word.word), ['cat']);
  // Missed, so not clean: not listed as slow and not in the median's sample.
  assert.deepEqual(result.slow.map((item) => item.word), ['the', 'sat']);
  assert.equal(result.timedCount, 2);
  // Practised as the bare word unless the space followed punctuation it drops.
  assert.deepEqual(missedAndSlowWords(typedWithMisses('The table, is set', [3])).missed, ['the']);
  assert.deepEqual(missedAndSlowWords(typedWithMisses('The table, is set', [10])).missed, ['table,']);
});

test('a right letter deleted and replaced by a wrong one leaves the word out of the timing', () => {
  const at = (char, position, offsetMs) => ({ type: 'insert', text: char, position, offsetMs });
  const text = 'the cat sat';
  // Continue on error: "cat"'s "t" is typed right, deleted, and replaced by an "x" two seconds later.
  // Its first try stays right, so it isn't a first-try miss; timed from the kept "x", "cat" would read
  // as 16 wpm and the slowest clean word.
  const events = [...'the ca'].map((char, i) => at(char, i, (i + 1) * 100));
  events.push(at('t', 6, 700), { type: 'delete', count: 1, offsetMs: 800 }, at('x', 6, 2700));
  [...' sat'].forEach((char, i) => events.push(at(char, 7 + i, 2800 + i * 100)));
  const replaced = { text, conditions: { correctionPolicy: 'relaxed' }, events };
  const result = missedAndSlowWords(replaced, 10);
  assert.deepEqual(result.missed, []);
  assert.deepEqual(result.slow, [{ word: 'the', wpm: 120 }, { word: 'sat', wpm: 120 }]);
  assert.equal(result.timedCount, 2);
  assert.equal(result.medianWpm, 120);
  // The run card's word list reads the same finish: "cax" is mistyped.
  assert.deepEqual(wordHistory(replaced).filter((word) => word.wrong).map((word) => word.word), ['cax']);

  // The same for the space after a word: "the" ends as "thex", so it isn't clean or timed either.
  const spaceEvents = [...'the'].map((char, i) => at(char, i, (i + 1) * 100));
  spaceEvents.push(at(' ', 3, 400), { type: 'delete', count: 1, offsetMs: 500 }, at('x', 3, 600));
  [...'cat sat'].forEach((char, i) => spaceEvents.push(at(char, 4 + i, 700 + i * 100)));
  const space = { text, conditions: { correctionPolicy: 'relaxed' }, events: spaceEvents };
  const spaced = missedAndSlowWords(space, 10);
  assert.deepEqual(spaced.missed, []);
  assert.deepEqual(spaced.slow.map((item) => item.word), ['cat', 'sat']);
  assert.equal(spaced.timedCount, 2);
  assert.deepEqual(wordHistory(space).filter((word) => word.wrong).map((word) => word.word), ['thex']);
});

test('missed-word run records leave out pattern counts nothing reads', () => {
  const typed = { id: 'm', kind: 'missed', status: 'complete', conditions: {}, text: 'the cat', events: [...'the cat'].map((char, i) => ({ type: 'insert', text: char, position: i, offsetMs: i * 100 })) };
  const record = runRecord(typed);
  assert.equal('patterns' in record, false);
  assert.deepEqual(Object.keys(record).sort(), ['at', 'challengeDate', 'conditions', 'elapsedMs', 'errors', 'firstDailyAttempt', 'fresh', 'id', 'interrupted', 'kind', 'score', 'status', 'target', 'textId']);
  assert.ok(Array.isArray(runRecord({ ...typed, kind: 'test' }).patterns));
  // Trimming old pattern memory doesn't add the field back.
  const kept = retainRuns([record, ...Array.from({ length: 120 }, (_, i) => runRecord({ ...typed, id: String(i), kind: 'test' }))]);
  assert.equal('patterns' in kept[0], false);
});

// Types `text` at 100 ms a key, with a wrong first try (then fixed) at each position in `misses`.
function typedWithMisses(text, misses) {
  const events = [];
  let t = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (misses.includes(i)) events.push({ type: 'insert', text: '~', position: i, offsetMs: (t += 100) }, { type: 'delete', count: 1, offsetMs: (t += 100) });
    events.push({ type: 'insert', text: text[i], position: i, offsetMs: (t += 100) });
  }
  return { text, events };
}

test('a missed comma or capital is practised as written; a missed letter as the bare word', () => {
  const text = 'The table, is set';
  const missedAt = (...positions) => missedAndSlowWords(typedWithMisses(text, positions)).missed;
  assert.deepEqual(missedAt(9), ['table,']); // only the comma
  assert.deepEqual(missedAt(6), ['table']); // the "b"
  assert.deepEqual(missedAt(6, 9), ['table,']); // both: the comma still needs practice
  assert.deepEqual(missedAt(0), ['The']); // the capital
  assert.deepEqual(missedAt(1), ['the']); // the "h"
  // A clean punctuated word is timed as the bare word.
  assert.ok(missedAndSlowWords(typedWithMisses(text, [])).slow.some((item) => item.word === 'table'));
});

test('punctuation inside a token is kept, never merged into a made-up token', () => {
  const text = 'At 9:30 the 0.8 mark, 11:40.';
  const { missed, slow } = missedAndSlowWords(typedWithMisses(text, [5, 13]), 10);
  assert.deepEqual(missed, ['9:30', '0.8']); // the "3" and the "."
  assert.ok(slow.some((item) => item.word === '11:40'));
  for (const word of [...missed, ...slow.map((item) => item.word)]) assert.ok(!['930', '08', '1140'].includes(word), word);
  assert.deepEqual(missedAndSlowWords(typedWithMisses(text, [12])).missed, ['0.8']); // the "0"
});

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

// A run summary built from real keystrokes, with a wrong first try (then fixed) at each of `misses`.
const typedRun = (id, text, misses, overrides = {}) => runRecord({ id, kind: 'test', status: 'complete', conditions,
  textId: id, fresh: true, ...typedWithMisses(text, misses), ...overrides }, '2026-10-01T12:00:00Z');

test('a counted run records its first-try missed words as practice uses them, capped per run', () => {
  // "the" twice (one miss), the comma after "table", and the capital of "Still".
  const text = 'the table, the Still cat';
  const record = typedRun('a', text, [1, 9, 11, 15]);
  assert.deepEqual(record.missedWords, ['the', 'table,', 'Still']);
  // Nothing else in the summary changes: the same keys as before, plus the list.
  assert.deepEqual(Object.keys(record).sort(), ['at', 'challengeDate', 'conditions', 'elapsedMs', 'errors', 'firstDailyAttempt', 'fresh', 'id', 'interrupted', 'kind', 'missedWords', 'patterns', 'score', 'status', 'target', 'textId']);
  assert.equal(record.errors, 4);
  // A clean counted run records an empty list: evidence that nothing was missed.
  assert.deepEqual(typedRun('clean', text, []).missedWords, []);
  // Daily runs on fresh text and retests count too.
  assert.deepEqual(typedRun('d', text, [1], { kind: 'daily' }).missedWords, ['the']);
  assert.deepEqual(typedRun('r', text, [1], { kind: 'retest' }).missedWords, ['the']);
  // At most 12 words per run, in the order they were typed.
  const many = Array.from({ length: 15 }, (_, i) => `w${String.fromCharCode(97 + i)}`).join(' ');
  const capped = typedRun('many', many, Array.from({ length: 15 }, (_, i) => i * 3 + 1));
  assert.equal(MAX_MISSED_WORDS, 12);
  assert.deepEqual(capped.missedWords, many.split(' ').slice(0, MAX_MISSED_WORDS));
});

test('runs pattern memory leaves out record no missed words', () => {
  const text = 'the cat sat';
  const missing = (overrides) => assert.equal('missedWords' in typedRun('x', text, [1], overrides), false, JSON.stringify(overrides));
  missing({ kind: 'missed' }); // missed-word practice itself
  missing({ kind: 'custom' }); // custom text is never compared
  missing({ kind: 'drill', target: 'th' });
  missing({ kind: 'race' });
  missing({ status: 'interrupted' });
  missing({ interrupted: true });
  missing({ unsupportedInput: true });
  missing({ kind: 'daily', fresh: false }); // a daily passage shown before
});

test('missed words stay only on the newest 120 counted summaries, and trimmed ones are no evidence', () => {
  const runs = Array.from({ length: 130 }, (_, i) => run(String(i), { missedWords: ['the'] }));
  // A practice run never counts, so it neither keeps the field nor takes a counted run's place.
  const practice = run('practice', { kind: 'missed', missedWords: ['the'] });
  delete practice.patterns;
  const kept = retainRuns([...runs, practice]);
  assert.equal(kept.filter((r) => 'missedWords' in r).length, 120);
  // Dropped, not emptied: an empty list would read as a clean run.
  assert.equal('missedWords' in kept[0], false);
  assert.equal('missedWords' in kept[9], false);
  assert.deepEqual(kept[10].missedWords, ['the']);
  // Pattern counts go by position among the comparable summaries: word practice takes no place.
  assert.deepEqual(kept[0].patterns, []);
  assert.deepEqual(kept[9].patterns, []);
  assert.deepEqual(kept[10].patterns, runs[10].patterns);
  assert.equal('patterns' in kept.at(-1), false);
  assert.equal('missedWords' in kept.at(-1), false);
  assert.deepEqual(kept.at(-2).missedWords, ['the']);
  assert.deepEqual(retainRuns(kept), kept);
});

test('drills and word practice between counted runs never push them out of the stored window', () => {
  // 100 counted tests, then 100 drills and practice runs: all 100 tests keep their missed words.
  const tests = Array.from({ length: 100 }, (_, i) => run(`t${i}`, { missedWords: [i % 2 ? 'odd' : 'even'] }));
  const uncounted = Array.from({ length: 100 }, (_, i) => run(`u${i}`, { kind: i % 2 ? 'drill' : 'missed', interrupted: i % 5 === 0 }));
  const kept = retainRuns([...tests, ...uncounted]);
  assert.equal(kept.filter((r) => 'missedWords' in r).length, 100);
  assert.equal(recurringMissedWords(kept).runs, 100);
  assert.deepEqual(recurringMissedWords(kept).words.map((w) => [w.word, w.runs]), [['odd', 50], ['even', 50]]);
});

test('custom runs never push counted runs out of the list, and never keep missed words of their own', () => {
  const tests = Array.from({ length: 30 }, (_, i) => run(`t${i}`, { missedWords: ['the'] }));
  const custom = Array.from({ length: 1100 }, (_, i) => run(`c${i}`, { kind: 'custom', patterns: undefined, missedWords: ['the'] }));
  const kept = retainRuns([...tests, ...custom]);
  assert.equal(kept.filter((r) => r.kind === 'test' && 'missedWords' in r).length, 30);
  assert.equal(kept.some((r) => r.kind === 'custom' && 'missedWords' in r), false);
  assert.equal(kept.filter((r) => r.kind === 'custom').length, MAX_NON_COMPARABLE_RUNS);
  assert.deepEqual(recurringMissedWords(kept).words.map((w) => [w.word, w.runs]), [['the', 30]]);
});

const missedRun = (id, missedWords, overrides = {}) => run(id, { missedWords, ...overrides });

test('words you keep missing need two runs and rank by runs missed in, then the latest miss', () => {
  // Legacy summaries without the field normalise to no evidence: not counted at all.
  const legacy = run('legacy');
  assert.deepEqual(recurringMissedWords([legacy, legacy]), { runs: 0, inputClass: 'physical-keyboard', recurring: 0, words: [] });
  // One run is never enough, however often the word was missed in it.
  assert.deepEqual(recurringMissedWords([legacy, missedRun('a', ['the', 'the', 'and'])]), { runs: 1, inputClass: 'physical-keyboard', recurring: 0, words: [] });

  const runs = [
    missedRun('a', ['they', 'there']),
    missedRun('b', ['there', 'which']),
    missedRun('c', ['their', 'they']),
    missedRun('d', ['which', 'about']),
    missedRun('e', ['about', 'their', 'there']),
    missedRun('f', []),
    legacy,
  ];
  const result = recurringMissedWords(runs);
  assert.equal(result.runs, 6);
  // "there" (3 runs) first; then the words in 2 runs, latest miss first: about and their (run e,
  // so alphabetical between them), which (d), they (c).
  assert.deepEqual(result.words.map((w) => [w.word, w.runs]), [['there', 3], ['about', 2], ['their', 2], ['which', 2], ['they', 2]]);
  assert.equal(result.recurring, 5);
  assert.deepEqual(recurringMissedWords(runs, 2).words.map((w) => w.word), ['there', 'about']);
  assert.equal(recurringMissedWords(runs, 2).recurring, 5);
  // A missed capital or comma stays its own word, as practice types it.
  assert.deepEqual(recurringMissedWords([missedRun('x', ['The', 'the']), missedRun('y', ['the', 'the,'])]).words.map((w) => w.word), ['the']);
});

test('word practice, custom text, drills, interruptions and repeat daily text never feed the list', () => {
  const both = (id, overrides = {}) => missedRun(id, ['the', 'and'], overrides);
  const excluded = [both('m', { kind: 'missed' }), both('c', { kind: 'custom' }), both('d', { kind: 'drill' }), both('i', { interrupted: true }),
    both('s', { status: 'interrupted' }), both('r', { kind: 'race' }), both('p', { kind: 'daily', fresh: false })];
  assert.deepEqual(recurringMissedWords([...excluded, both('only')]), { runs: 1, inputClass: 'physical-keyboard', recurring: 0, words: [] });
  const counted = recurringMissedWords([both('fresh-daily', { kind: 'daily' }), both('retest', { kind: 'retest' })]);
  assert.deepEqual(counted.words.map((w) => [w.word, w.runs]), [['and', 2], ['the', 2]]);
});

test('the list counts only the newest 120 counted runs, across all other test conditions', () => {
  const quote = { ...conditions, mode: 'quote', count: null, wordList: null, correctionPolicy: 'relaxed' };
  const runs = [
    missedRun('old-1', ['gone']), missedRun('old-2', ['gone']),
    ...Array.from({ length: 120 }, (_, i) => missedRun(`new-${i}`, [i % 2 ? 'odd' : 'even'], { conditions: i % 3 ? conditions : quote })),
    // Uncounted runs after them don't push counted runs out of the window, as stored either.
    ...Array.from({ length: 5 }, (_, i) => missedRun(`drill-${i}`, ['gone'], { kind: 'drill' })),
  ];
  for (const result of [recurringMissedWords(runs), recurringMissedWords(retainRuns(runs))]) {
    assert.equal(result.runs, 120);
    assert.deepEqual(result.words.map((w) => [w.word, w.runs]), [['odd', 60], ['even', 60]]);
  }
  // At most eight rows by default; `recurring` still says how many qualified.
  const wide = [missedRun('w1', [...'abcdefghij']), missedRun('w2', [...'abcdefghij'])];
  assert.equal(recurringMissedWords(wide).words.length, 8);
  assert.equal(recurringMissedWords(wide).recurring, 10);
});

test('touch runs are never pooled with physical-keyboard runs: the newest run picks the input', () => {
  const touch = { ...conditions, inputClass: 'touch' };
  const keyboard = { ...conditions, inputClass: 'physical-keyboard' };
  const keys = [missedRun('k1', ['the'], { conditions: keyboard }), missedRun('k2', ['the', 'and'], { conditions: keyboard }), missedRun('k3', ['and'])];
  const tally = (runs) => { const result = recurringMissedWords(runs); return [result.inputClass, result.runs, result.words.map((w) => [w.word, w.runs])]; };
  // A run without the field counts as a physical keyboard, the default.
  assert.deepEqual(tally(keys), ['physical-keyboard', 3, [['and', 2], ['the', 2]]]);
  // One touch miss of "the" after them doesn't make a third, and touch stands alone.
  assert.deepEqual(tally([...keys, missedRun('t1', ['the'], { conditions: touch })]), ['touch', 1, []]);
  assert.deepEqual(tally([...keys, missedRun('t1', ['the'], { conditions: touch }), missedRun('t2', ['the', 'of'], { conditions: touch })]), ['touch', 2, [['the', 2]]]);
  // Back on a keyboard, the keyboard runs count again, without the touch misses.
  assert.deepEqual(tally([...keys, missedRun('t1', ['the'], { conditions: touch }), missedRun('k4', ['of'], { conditions: keyboard })]), ['physical-keyboard', 4, [['and', 2], ['the', 2]]]);
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

test('missed-word practice is not comparable, so it never pushes practice runs out of the pattern window', () => {
  assert.equal(comparableKind('missed'), false);
  assert.equal(comparableKind('custom'), false);
  assert.equal(comparableKind('test'), true);
  // 120 practice runs, then 30 word-practice runs and 30 custom runs: every practice run keeps its patterns.
  const practice = Array.from({ length: MAX_PATTERN_RUNS }, (_, i) => run(`p${i}`));
  const missed = Array.from({ length: 30 }, (_, i) => run(`w${i}`, { kind: 'missed', patterns: undefined }));
  const custom = Array.from({ length: 30 }, (_, i) => run(`c${i}`, { kind: 'custom', patterns: undefined }));
  const kept = retainRuns([...practice, ...missed, ...custom]);
  assert.deepEqual(kept.filter((r) => r.kind === 'test').map((r) => r.patterns.length), Array(MAX_PATTERN_RUNS).fill(1));
  // The two uncounted kinds share one budget of the newest 50.
  assert.equal(kept.filter((r) => !comparableKind(r.kind)).length, MAX_NON_COMPARABLE_RUNS);
  assert.equal(kept.find((r) => r.kind === 'missed').id, 'w10');
});

test('only tests, retests and daily runs are measured; a drill is comparable for retention but never measured', () => {
  for (const kind of ['test', 'retest', 'daily']) assert.equal(measuredKind(kind), true, kind);
  for (const kind of ['drill', 'missed', 'custom']) assert.equal(measuredKind(kind), false, kind);
  // comparableKind only splits retention budgets, so a drill's synthetic text still counts there.
  assert.equal(comparableKind('drill'), true);
  // Recurring targets read the same measured kinds: a drill's target-heavy patterns never become evidence.
  const drills = Array.from({ length: 3 }, (_, i) => run(`d${i}`, { kind: 'drill', target: 'th' }));
  assert.deepEqual(recurringTargets(drills, [], conditions), []);
  const measured = ['test', 'retest', 'daily'].map((kind, i) => run(`m${i}`, { kind }));
  assert.deepEqual(recurringTargets(measured, [], conditions).map((p) => [p.pair, p.runs]), [['th', 3]]);
});

test('evidence runs are complete measured runs, never a daily passage shown before', () => {
  for (const kind of ['test', 'retest', 'daily']) assert.equal(evidenceRun(run(kind, { kind })), true, kind);
  for (const kind of ['drill', 'missed', 'custom']) assert.equal(evidenceRun(run(kind, { kind })), false, kind);
  assert.equal(evidenceRun(run('repeat', { kind: 'daily', fresh: false })), false);
  assert.equal(evidenceRun(run('cut', { interrupted: true })), false);
  assert.equal(evidenceRun(run('idle', { status: 'interrupted' })), false);
  // Recurring targets read the same rule: repeat daily attempts add no evidence.
  const repeats = Array.from({ length: 3 }, (_, i) => run(`r${i}`, { kind: 'daily', fresh: false }));
  assert.deepEqual(recurringTargets(repeats, [], conditions), []);
});

test('word-practice text needs punctuation only for a character that is not a letter, digit or space', () => {
  // A capital is a letter, so a missed "The" alone isn't punctuation; a digit sets numbers, never punctuation.
  assert.deepEqual(practiceTextConditions('The cat sat'), { punctuation: false, numbers: false });
  assert.deepEqual(practiceTextConditions('table, cat'), { punctuation: true, numbers: false });
  assert.deepEqual(practiceTextConditions('cat 42 The'), { punctuation: false, numbers: true });
  assert.deepEqual(practiceTextConditions('9:30 cat'), { punctuation: true, numbers: true });
});

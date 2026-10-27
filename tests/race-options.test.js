import test from 'node:test';
import assert from 'node:assert/strict';
import { RACE_FALLBACK, raceConditions, raceOptions, racePassage } from '../src/race-options.js';
import { CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';

const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

test('plain Challenge takes mode, length, punctuation, and for generated text numbers and the word set from practice', () => {
  assert.deepEqual(raceOptions({ mode: 'time', duration: 30, count: 50, punctuation: true, numbers: true, wordList: 'english-1k', quoteLength: 'long' }),
    { mode: 'time', duration: 30, punctuation: true, numbers: true, wordList: 'english-1k' });
  assert.deepEqual(raceOptions({ mode: 'words', duration: 30, count: 50, punctuation: false, numbers: false }),
    { mode: 'words', count: 50, punctuation: false, numbers: false });
  // A quote is its own text: its length and difficulty filters carry over, punctuation and numbers don't.
  assert.deepEqual(raceOptions({ mode: 'quote', quoteLength: 'short', difficulty: 'steady', punctuation: true, numbers: true }),
    { mode: 'quote', quoteLength: 'short', difficulty: 'steady' });
  // A custom time or word count carries over as it is.
  assert.equal(raceOptions({ mode: 'time', duration: 45 }).duration, 45);
  assert.equal(raceOptions({ mode: 'words', count: 75 }).count, 75);
  // Fewer than ten words might not reach the 40 characters the service takes.
  assert.equal(raceOptions({ mode: 'words', count: 5 }).count, 10);
});

test('a practice-only setup falls back to today\'s race: a medium quote on a 60-second clock', () => {
  for (const practice of [{ mode: 'code' }, { mode: 'book' }, { mode: 'standard' }, { mode: 'time', duration: 30, adaptive: true },
    { mode: 'words', count: 25, adaptive: true }, { mode: 'time', duration: 30, session: 'custom' }, { mode: 'time', duration: 30, session: 'compose' },
    { mode: 'words', count: 25, session: 'drill' }, {}, undefined]) {
    assert.deepEqual(raceOptions(practice), RACE_FALLBACK, JSON.stringify(practice));
  }
  // Adaptive only shapes generated text, so a quote race keeps the quote setup.
  assert.equal(raceOptions({ mode: 'quote', quoteLength: 'long', adaptive: true }).mode, 'quote');
  const fallback = raceConditions(raceOptions({ mode: 'code' }));
  assert.deepEqual(fallback, { mode: 'quote', quoteLength: 'medium', difficulty: 'any', duration: 60, correctionPolicy: 'mandatory',
    onlineRace: true, language: 'en', inputClass: 'physical-keyboard', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION });
});

test('the race clock is a timed race\'s own length, and two minutes for a race to the end of its passage', () => {
  assert.equal(raceConditions(raceOptions({ mode: 'time', duration: 15 })).duration, 15);
  assert.equal(raceConditions(raceOptions({ mode: 'words', count: 100 })).duration, 120);
  assert.equal(raceConditions(raceOptions({ mode: 'quote', quoteLength: 'long' })).duration, 120);
  assert.equal(raceConditions(raceOptions({ mode: 'time', duration: 30 })).correctionPolicy, 'mandatory');
});

test('a race passage is printable ASCII the service takes, and a timed one holds 400 wpm for its clock', () => {
  for (const options of [{ mode: 'time', duration: 15, punctuation: true, numbers: true }, { mode: 'time', duration: 120 },
    { mode: 'time', duration: 600, punctuation: true }, { mode: 'words', count: 10 }, { mode: 'words', count: 500, punctuation: true, numbers: true },
    { mode: 'quote', quoteLength: 'short' }, { mode: 'quote', quoteLength: 'long' }, RACE_FALLBACK]) {
    const conditions = raceConditions(options);
    const { text } = racePassage(conditions, { random: seeded(7) });
    assert.match(text, /^[ -~]{40,8000}$/, JSON.stringify(options));
    assert.ok(!text.endsWith(' '));
    if (options.mode === 'time') assert.ok(text.length >= Math.min(7900, conditions.duration * 400 * 5 / 60 - 20), `${options.duration}s: ${text.length}`);
    if (options.mode === 'words') assert.equal(text.split(' ').length, options.count);
  }
  // The same conditions and seed make the same text; the host sends it, so both racers type exactly that.
  const conditions = raceConditions({ mode: 'time', duration: 30, punctuation: true });
  assert.equal(racePassage(conditions, { random: seeded(3) }).text, racePassage(conditions, { random: seeded(3) }).text);
});

test('a rematch passage keeps the race\'s conditions and avoids the text just raced', () => {
  const conditions = raceConditions({ mode: 'quote', quoteLength: 'short', difficulty: 'any' });
  const first = racePassage(conditions, { random: seeded(5) });
  for (let seed = 1; seed < 20; seed += 1) assert.notEqual(racePassage(conditions, { seenIds: [first.id], random: seeded(seed) }).id, first.id);
});

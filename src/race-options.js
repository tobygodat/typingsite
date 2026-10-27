// What an online race is set up as: the race options (mode, length, punctuation, numbers, word set),
// the conditions both players race under, and the one passage the host makes for both. The passage goes to
// the service with the room and both browsers race that stored text, so generated words and time text are
// the same on both sides without a shared seed.
import { CORPUS_VERSION, METRIC_VERSION, selectPassage } from './typing.js';
import { LENGTHS } from './lengths.js';

// Today's race, and what a practice-only setup falls back to: a medium quote on a 60-second clock.
export const RACE_FALLBACK = Object.freeze({ mode: 'quote', quoteLength: 'medium', difficulty: 'any', duration: 60 });
// A word or quote race ends at the end of its passage, with this clock as its limit.
const PASSAGE_CLOCK = 120;
const MIN_WORDS = 10;
// The service keeps a passage of 40 to 8000 characters. A timed race keeps enough text for 400 wpm on its clock.
const MAX_TEXT = 8000;
const CHARS_PER_SECOND = 400 * 5 / 60;

// The race options plain Challenge takes from practice: time, words or quote, its length, punctuation, and
// for generated text the numbers and word set. Adaptive, drill, compose, custom text, book, code and the
// standard test are practice's own, so with any of them set the race is today's default.
export function raceOptions(practice = {}) {
  const { mode, duration, count, punctuation, numbers, wordList, quoteLength, difficulty, adaptive, session } = practice;
  if (!['time', 'words', 'quote'].includes(mode) || (adaptive && mode !== 'quote') || (session && session !== 'practice')) return { ...RACE_FALLBACK };
  if (mode === 'quote') return { mode, quoteLength: quoteLength || 'any', difficulty: difficulty || 'any' };
  const spec = LENGTHS[mode];
  const length = mode === 'time' ? duration : count;
  // The service takes at least 40 characters, which fewer than ten words may not reach.
  const least = mode === 'words' ? MIN_WORDS : spec.min;
  return { mode, [spec.key]: Number.isInteger(length) && length <= spec.max ? Math.max(least, length) : spec.fallback,
    punctuation: Boolean(punctuation), numbers: Boolean(numbers), ...(wordList ? { wordList } : {}) };
}

// The room's conditions: the options, the race clock (`duration`) and the rules every online race keeps.
export function raceConditions(options) {
  return { ...options, duration: options.duration ?? PASSAGE_CLOCK, correctionPolicy: 'mandatory', onlineRace: true, language: 'en',
    inputClass: 'physical-keyboard', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
}

// A fresh passage for these conditions, never one in seenIds where another can be had. A timed passage is
// cut at a word boundary to what 400 wpm types on its clock.
export function racePassage(conditions, { seenIds = [], random = Math.random } = {}) {
  const { mode, count, punctuation = false, numbers = false, wordList, quoteLength = 'any', difficulty = 'any', duration } = conditions;
  const passage = selectPassage({ mode, count, duration: mode === 'time' ? duration : 0, punctuation, numbers,
    quoteLength, difficulty, seenIds, random, ...(wordList ? { wordList } : {}) });
  const limit = Math.min(MAX_TEXT, mode === 'time' ? Math.ceil(duration * CHARS_PER_SECOND) : MAX_TEXT);
  if (passage.text.length <= limit) return passage;
  const end = passage.text.lastIndexOf(' ', limit);
  return { ...passage, text: passage.text.slice(0, end > 0 ? end : limit) };
}

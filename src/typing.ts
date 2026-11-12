import type { HistoricalRecord } from './profile-types.js';
import { at } from './domain-values.js';

export type TestMode = 'time' | 'words' | 'quote' | 'standard' | 'code' | 'book' | 'custom' | 'lesson';

export type AttemptKind = 'test' | 'drill' | 'missed' | 'race' | 'lesson' | 'challenge' | 'retest' | 'daily' | 'custom';

export type InputClass = 'physical-keyboard' | 'touch';

export type CorrectionPolicy = 'relaxed' | 'mandatory' | 'no-backspace' | 'fail-word' | 'fail-any';

export interface Conditions {
  mode?: TestMode; duration?: number | null; count?: number | null; punctuation?: boolean; numbers?: boolean;
  quoteLength?: string | null; difficulty?: string | null; wordList?: string | null;
  inputClass?: InputClass; correctionPolicy?: CorrectionPolicy; language?: string; corpus?: string;
  metricVersion?: string; recipe?: string; layout?: string; codeLanguage?: string; book?: string;
  strictSpace?: boolean; quickEnd?: boolean; customOrder?: string; lesson?: string; onlineRace?: boolean;
}

export type AttemptEvent =
  | { type: 'insert' | 'blocked-insert'; text: string; offsetMs: number; position?: number; accepted?: boolean }
  | { type: 'delete'; count?: number; offsetMs: number }
  | { type: 'focus-lost' | 'composition' | 'focus' | 'focus-returned' | 'submit'; offsetMs: number };

export interface FirstAttempt { position: number; expected: string | undefined; actual: string; correct: boolean; offsetMs: number }

export interface PairTiming { pair: string; durationMs: number; position: number }

export interface Score { wpm: number; accuracy: number }

export interface Replay { typed: string; insertions: number; correctInsertions: number; mistakes: number; elapsedMs: number; score: Score; firstAttempts: FirstAttempt[]; pairTimings: PairTiming[] }

export interface Attempt {
  id: string; eventVersion: string; metricVersion: string; kind: AttemptKind; text: string; textId: string;
  conditions: Conditions; status: 'ready' | 'running' | 'complete' | 'interrupted'; events: AttemptEvent[];
  typed: string; startedAt: number | null; endedAt: number | null; interrupted: boolean; unsupportedInput: boolean;
  summary?: Replay; fresh?: boolean; at?: string | null; stopped?: NonNullable<ReturnType<typeof minimumStop>>; failed?: string | null; lesson?: { id: string; index: number; pairs: number; words: number }; challengeId?: string; trainFocus?: string; dailyDate?: string; dailyFirst?: boolean;
  textVersion?: string; target?: string | null; minimums?: Minimums | null; challengeDate?: string | null; firstDailyAttempt?: boolean; adaptive?: boolean; drillSeconds?: number;
}

export interface CompletedAttempt extends Attempt { status: 'complete'; summary: Replay }

export interface CurrentConditions extends Conditions { mode: TestMode; inputClass: InputClass; correctionPolicy: CorrectionPolicy; corpus: string; metricVersion: string }

export type HistoricalAttempt = Partial<Omit<Attempt, 'text' | 'events'>> & Pick<Attempt, 'text' | 'events'>;

export interface WeightedUnit { unit: string; weight: number }

export interface Minimums { accuracy?: number; wpm?: number }

export interface RunPosition { elapsedMs: number; durationMs?: number | null; finished?: boolean }

export interface PassageOptions { mode?: TestMode; count?: number; duration?: number; punctuation?: boolean; numbers?: boolean; quoteLength?: string; difficulty?: string; seenIds?: string[]; allowRepeats?: boolean; random?: () => number; wordList?: string }

interface PatternPair { pair: string; observations: number; errors: number; timings: number[] }

interface WeightedWords { words: string[]; weight: number }

import { DEFAULT_WORD_LIST, wordList } from './words.js';
import { additionalQuotes, drillWords } from './corpus.js';
import { isDefaultLayout } from './layouts.js';

export const METRIC_VERSION = 'stilltype-metrics-v1';
export const EVENT_VERSION = 'stilltype-events-v1';
export const CORPUS_VERSION = 'original-en-v6';
const MAX_PAIR_PAUSE_MS = 2000;

// The standard word for speed: five characters, spaces and punctuation included.
export const CHARS_PER_WORD = 5;

export function metrics(target: string, typed: string, attempts: number, mistakes: number, elapsedMs: number) {
  const correct = [...typed].reduce((sum, char, i) => sum + (char === target[i] ? 1 : 0), 0);

  return {
    wpm: elapsedMs > 0 ? Math.round(correct / CHARS_PER_WORD / (elapsedMs / 60000)) : 0,
    accuracy: attempts ? Math.round(((attempts - mistakes) / attempts) * 100) : 100,
  };
}

export function editStats(previous: string, next: string, target: string) {
  let prefix = 0;

  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
  const added = next.slice(prefix);

  return {
    attempts: added.length,
    mistakes: [...added].filter((char, i) => char !== target[prefix + i]).length,
  };
}

export const quoteCorpus = [
  ...additionalQuotes,
  { id: 'still-quiet-01', difficulty: 'gentle', text: 'There is a certain kind of quiet that arrives when you stop trying to be somewhere else. The light moves across the room, the world carries on, and for a moment, you have everything you need.' },
  { id: 'river-home-01', difficulty: 'gentle', text: 'A small path winds between the trees and follows the river home. Nothing here is in a hurry. Even the afternoon light takes its time, resting on each leaf before moving on.' },
  { id: 'beginning-01', difficulty: 'gentle', text: 'Every new beginning is made of little things. A window opened, a page turned, a word written. Give yourself the time to learn, and let the next small step be enough.' },
  { id: 'patient-work-01', difficulty: 'steady', text: 'Patient work rarely announces itself. It gathers in the repeated motion of the hands, in the choice to begin again, and in the quiet confidence that the next attempt can teach you something.' },
  { id: 'weather-01', difficulty: 'steady', text: 'By evening the weather had changed twice, leaving bright rain along the windows and a restless wind in the garden. We stayed near the table, trading stories until the room grew warm.' },
  { id: 'workshop-01', difficulty: 'steady', text: 'The workshop looked ordinary from the road, but inside, every shelf held evidence of curiosity: careful notes, worn tools, failed sketches, and the patient beginnings of useful things.' },
  { id: 'attention-01', difficulty: 'precise', text: 'Attention is not a fixed resource; it is a practice of returning. The mind wanders, the sentence blurs, and then you notice. That small return is where deliberate work begins.' },
  { id: 'night-train-01', difficulty: 'precise', text: 'At 11:40, the last train crossed the iron bridge. Its windows flashed between the beams, briefly illuminating the wet platforms, the signal box, and three bicycles chained beside the station.' },
  { id: 'map-room-01', difficulty: 'precise', text: 'Maps simplify the world so that a traveler can act, but every useful line leaves something out. Good judgment begins when you can read the map and still notice the ground beneath you.' },
  { id: 'long-craft-01', difficulty: 'steady', text: 'Craft grows through a sequence of small, honest decisions. You notice what the material allows, test an idea, and look closely at the result. Some attempts become part of the finished work; others simply reveal the next question. Neither is wasted. Over time, the eye becomes more exact, the hand becomes more confident, and choices that once demanded effort begin to feel natural. The change is gradual enough to miss from day to day, yet clear when you compare the work across a season.' },
  { id: 'long-city-01', difficulty: 'gentle', text: 'Before sunrise, the city belongs to the people who prepare it for everyone else. Bakers lift warm trays from their ovens, drivers check quiet streets, and market stalls unfold beneath yellow lamps. A few windows glow high above the pavement. Somewhere, a radio reads the weather to an empty room. Then the first trains arrive, doors open, footsteps gather, and all that private preparation becomes an ordinary morning shared by thousands of strangers.' },
  { id: 'long-library-01', difficulty: 'precise', text: 'The oldest room in the library was easy to overlook. Its narrow door opened onto a tall window, a long oak table, and shelves marked by decades of careful use. Readers left penciled notes on scraps of paper, questions for people they would never meet. Some were answered in the margins of later pages. The room held no grand secret, only a patient conversation carried forward through attention, disagreement, and the habit of leaving a useful thought for whoever came next.' },
];

// Generated tests follow Monkeytype's English generator (getNextWord and punctuateWord in
// frontend/src/ts/test/words-generator.ts, and frontend/src/ts/test/english-punctuation.ts, at
// monkeytypegame/monkeytype@895dc9a), word by word and on the passed random source, so a seed gives one passage.
const CONTRACTIONS = new Map(Object.entries({
  are: ["aren't"], can: ["can't"], could: ["couldn't"], did: ["didn't"], does: ["doesn't"], do: ["don't"],
  had: ["hadn't"], has: ["hasn't"], have: ["haven't"], is: ["isn't"], it: ["it's", "it'll"], i: ["i'm", "i'll", "i've", "i'd"],
  you: ["you'll", "you're", "you've", "you'd"], that: ["that's", "that'll", "that'd"], must: ["mustn't", "must've"],
  there: ["there's", "there'll", "there'd"], he: ["he's", "he'll", "he'd"], she: ["she's", "she'll", "she'd"],
  we: ["we're", "we'll", "we'd"], they: ["they're", "they'll", "they'd"], should: ["shouldn't", "should've"],
  was: ["wasn't"], were: ["weren't"], will: ["won't"], would: ["wouldn't", "would've"], going: ["goin'"],
}));

// A sentence starts with a capital; otherwise each mark in turn gets its chance, at Monkeytype's rates.
// `end` is a word test's length, so its last word ends a sentence and the one before never does.
function punctuateWord(word: string, previous: string | undefined, index: number, end: number, random: () => number) {
  const lastChar = previous?.at(-1);

  if (index === 0 || /[.?!]/.test(lastChar ?? '')) return word.charAt(0).toUpperCase() + word.slice(1);

  if ((random() < 0.1 && lastChar !== ',' && index !== end - 2) || index === end - 1) {
    const mark = random();

    return word + (mark <= 0.8 ? '.' : mark < 0.9 ? '?' : '!');
  }

  if (random() < 0.01 && lastChar !== ',') return `"${word}"`;

  if (random() < 0.011 && lastChar !== ',') return `'${word}'`;

  if (random() < 0.012 && lastChar !== ',') return `(${word})`;

  if (random() < 0.013 && ![',', ';', ':'].includes(lastChar ?? '')) return `${word}:`;

  if (random() < 0.014 && lastChar !== ',' && previous !== '-') return '-';

  if (random() < 0.015 && ![',', ';'].includes(lastChar ?? '')) return `${word};`;

  if (random() < 0.2 && lastChar !== ',') return `${word},`;
  const contractions = CONTRACTIONS.get(word.toLowerCase());

  if (random() < 0.5 && contractions) {
    const contraction = at(contractions, Math.floor(random() * contractions.length));

    return word === 'I' ? `I${contraction.slice(1)}` : contraction;
  }

  return word;
}

// 1 to 4 digits, never a leading zero.
function number(random: () => number) {
  let result = String(1 + Math.floor(random() * 9));

  for (let digits = 1 + Math.floor(random() * 4); result.length < digits;) result += Math.floor(random() * 10);

  return result;
}

// A timed passage holds enough text for a 300 WPM typist until the clock runs out: 300 five-character
// words a minute, or 25 characters a second.
export function timedCharacterSupply(seconds = 0) {
  return Math.ceil(((Number(seconds) || 0) * 300 * 5) / 60);
}

export function makePassage(mode: TestMode, count: number, punctuation: boolean, random = Math.random, list = DEFAULT_WORD_LIST, numbers = false, seconds = 0) {
  if (mode === 'quote') return at(quoteCorpus, Math.floor(random() * quoteCorpus.length)).text;
  const bank = wordList(list);

  return drawnPassage(() => at(bank, Math.floor(random() * bank.length)), mode, count, punctuation, random, numbers, seconds);
}

// A word equal to either of the two drawn before it is drawn again, up to 100 times; so is "i" without
// punctuation, which only appears as "I". Monkeytype compares against the finished words; comparing the
// drawn ones means a contraction or a number can't hide a repeat. Then punctuation, then 1 word in 10
// becomes a number.
function drawnPassage(draw: () => string, mode: TestMode, count: number, punctuation: boolean, random: () => number, numbers: boolean, seconds: number) {
  const end = mode === 'time' ? Infinity : count;
  const drawn: string[] = [];
  const words: string[] = [];

  const add = (length: number) => {
    for (let i = 0; i < length; i += 1) {
      const recent = drawn.slice(-2);
      let word = draw();

      for (let tries = 0; tries < 100 && (recent.includes(word) || (!punctuation && word === 'i')); tries += 1) word = draw();
      drawn.push(word);

      if (punctuation) word = punctuateWord(word === 'i' ? 'I' : word, words.at(-1), words.length, end, random);
      words.push(numbers && random() < 0.1 ? number(random) : word);
    }
  };

  // Every timed test starts from 1,600 words: at least 3,199 characters, more than 120 s at 300 WPM needs,
  // so a preset passage is never topped up and stays exactly what it was.
  add(mode === 'time' ? 1600 : count);

  // A passage that drew no number still gets one, so short tests with numbers on always contain a number.
  if (numbers && words.length && !words.some((word) => /^\d+$/.test(word))) words[Math.floor(random() * words.length)] = number(random);
  let text = words.join(' ');
  // Numbers are often shorter than the words they replace, so the supply is measured on the finished text
  // and a longer time is topped up until it holds enough. Each round adds about the words the shortfall
  // needs at the passage's own average length, generated after all the others, so a seed still gives
  // one passage.
  const supply = mode === 'time' ? timedCharacterSupply(seconds) : 0;

  while (text.length < supply) {
    add(Math.ceil(((supply - text.length) * words.length) / text.length));
    text = words.join(' ');
  }

  return text;
}

// The standard test: one fixed, versioned recipe, so its scores stay comparable over time. Every
// attempt gets fresh text from its own seed; the recipe is what stays fixed. Any change to the
// recipe below (vocabulary weights, numbers, punctuation, the quote, length) is a new version:
// bump STANDARD_VERSION. Word-list edits already bump CORPUS_VERSION, which is in the key.
export const STANDARD_VERSION = 'standard-v1';
export const STANDARD_SECONDS = 60;
const STANDARD_WORDS = 400;

// mulberry32: a small, fast, well-mixed 32-bit generator. Same seed, same text.
function seededRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let standardTiers: [number, string[]][] | null = null;

// Three disjoint bands: the top 1k, the rest of the top 5k, and the rest of the top 10k.
function standardVocabulary() {
  if (!standardTiers) {
    const common = wordList('1k');
    const seen = new Set(common);
    const middle = wordList('5k').filter((word) => !seen.has(word));
    middle.forEach((word) => seen.add(word));
    const rare = wordList('10k').filter((word) => !seen.has(word));
    standardTiers = [[0.6, common], [0.25, middle], [0.15, rare]];
  }

  return standardTiers;
}

function standardWord(random: () => number) {
  const draw = random();
  let total = 0;

  for (const [weight, band] of standardVocabulary()) {
    total += weight;

    if (draw < total) return at(band, Math.floor(random() * band.length));
  }

  const band = at(standardVocabulary(), standardVocabulary().length - 1)[1];

  return at(band, Math.floor(random() * band.length));
}

function standardNumber(random: () => number) {
  const form = random();

  if (form < 0.5) return String(2 + Math.floor(random() * 98));

  if (form < 0.8) return String(1950 + Math.floor(random() * 80));

  return String(100 + Math.floor(random() * 900));
}

function standardSentence(random: () => number) {
  const length = 5 + Math.floor(random() * 10);
  const words: string[] = [];

  for (let i = 0; i < length; i += 1) {
    // About one word in twenty is a number, never the first word, so every sentence opens with a capital.
    let word = i > 0 && random() < 0.05 ? standardNumber(random) : standardWord(random);

    if (word === 'i') word = 'I';

    if (i === 0) word = word.charAt(0).toUpperCase() + word.slice(1);

    if (i > 1 && i < length - 2 && random() < 0.1) word += ',';
    words.push(word);
  }

  words[length - 1] += random() < 0.1 ? '?' : '.';

  return words;
}

// Standard v1: 60 seconds of sentences mixing the 1k (60%), 5k (25%) and 10k (15%) bands, with
// capitals, commas, full stops, some question marks and numbers. The second sentence is the quote
// segment, in double quotation marks, so every typist reaches it. It is generated like the rest
// (not drawn from the quote corpus), so no part of an attempt repeats text the person has seen.
function makeStandardText(seed: number) {
  const random = seededRandom(seed);
  const words = standardSentence(random);
  const quoted = standardSentence(random);
  quoted[0] = `"${quoted[0]}`;
  quoted[quoted.length - 1] += '"';
  words.push(...quoted);

  while (words.length < STANDARD_WORDS) words.push(...standardSentence(random));

  return words.join(' ');
}

export function standardPassage(seed: number) {
  const value = seed >>> 0;
  const id = `${STANDARD_VERSION}-${value.toString(36)}`;

  return { id, textVersion: `${id}@1`, text: makeStandardText(value), seed: value, recipe: STANDARD_VERSION, corpus: CORPUS_VERSION, difficulty: 'standard', fresh: true, exhausted: false };
}

// The recipe's conditions are fixed: only the input class is observed per run.
export function standardConditions(inputClass: InputClass = 'physical-keyboard'): Conditions {
  return {
    mode: 'standard',
    duration: STANDARD_SECONDS,
    count: null,
    punctuation: true,
    quoteLength: null,
    difficulty: null,
    wordList: null,
    inputClass,
    correctionPolicy: 'mandatory',
    language: 'en',
    corpus: CORPUS_VERSION,
    metricVersion: METRIC_VERSION,
    recipe: STANDARD_VERSION,
  };
}

export function textId(text: string) {
  let hash = 2166136261;

  for (const char of text) {
    hash ^= (char.codePointAt(0) ?? 0);
    hash = Math.imul(hash, 16777619);
  }

  return `generated-${(hash >>> 0).toString(36)}`;
}

// Unseen quotes come first. With allowRepeats (the "repeat quotes" setting) every matching quote is a
// candidate; one the profile has seen comes back as fresh: false, so it is labelled and never counted.
export function selectPassage({ mode = 'time', count = 25, duration = 0, punctuation = false, numbers = false, quoteLength = 'any', difficulty = 'any', seenIds = [], allowRepeats = false, random = Math.random, wordList: list = DEFAULT_WORD_LIST }: PassageOptions = {}) {
  const seen = new Set(seenIds);

  if (mode === 'standard') {
    // A fresh seed per attempt; the word-list, punctuation and quote filters never apply.
    let passage = null;

    for (let i = 0; i < 12 && (!passage || seen.has(passage.id)); i += 1) passage = standardPassage(Math.floor(random() * 4294967296));

    if (!passage) return null;

    return seen.has(passage.id) ? { ...passage, fresh: false, exhausted: true } : passage;
  }

  if (mode === 'quote') {
    const candidates = quoteCorpus.filter((item) => {
      const wordCount = item.text.split(/\s+/).length;

      const lengthMatch = quoteLength === 'any'
        || (quoteLength === 'short' && wordCount <= 30)
        || (quoteLength === 'medium' && wordCount > 30 && wordCount <= 60)
        || (quoteLength === 'long' && wordCount > 60);

      const difficultyMatch = difficulty === 'any'
        || (difficulty === 'plain' && item.difficulty === 'gentle')
        || (difficulty === 'punctuation' && ['steady', 'precise', 'long'].includes(item.difficulty))
        || item.difficulty === difficulty;

      return lengthMatch && difficultyMatch;
    });

    const fresh = candidates.filter((item) => !seen.has(item.id));
    const pool = fresh.length && !allowRepeats ? fresh : candidates;

    if (!pool.length) return null;
    const item = at(pool, Math.floor(random() * pool.length));

    return { ...item, textVersion: `${item.id}@1`, corpus: CORPUS_VERSION, fresh: !seen.has(item.id), exhausted: fresh.length === 0 };
  }

  for (let i = 0; i < 12; i += 1) {
    const text = makePassage(mode, count, punctuation, random, list, numbers, duration);
    const id = textId(text);

    if (!seen.has(id)) return { id, textVersion: `${id}@1`, text, corpus: CORPUS_VERSION, difficulty: 'generated', fresh: true, exhausted: false };
  }

  const text = makePassage(mode, count, punctuation, random, list, numbers, duration);
  const id = textId(text);

  return { id, textVersion: `${id}@1`, text, corpus: CORPUS_VERSION, difficulty: 'generated', fresh: !seen.has(id), exhausted: seen.has(id) };
}

export function createAttempt({ id, text, textId: sourceTextId, kind = 'test', conditions = {} }: Pick<Attempt, 'id' | 'text' | 'textId'> & Partial<Pick<Attempt, 'kind' | 'conditions'>>): Attempt {
  return {
    id,
    eventVersion: EVENT_VERSION,
    metricVersion: METRIC_VERSION,
    kind,
    text,
    textId: sourceTextId,
    conditions,
    status: 'ready',
    events: [],
    typed: '',
    startedAt: null,
    endedAt: null,
    interrupted: false,
    unsupportedInput: false,
  };
}

// Minimum accuracy and speed to continue (practice runs and their retests). They decide whether a
// run may go on, never how it is scored, so they are not test conditions. The opening can't fail a
// run on its own: the running check waits five seconds and twenty characters, and accuracy waits
// until two misses alone can't take the rounded figure under the minimum (40 characters at 95%,
// 100 at 98%). A run that reaches its end is judged on its final score.
export const MINIMUM_GRACE_MS = 5000;
export const MINIMUM_GRACE_CHARACTERS = 20;

export function accuracyGraceCharacters(minimum: number) {
  return Math.max(MINIMUM_GRACE_CHARACTERS, Math.ceil(200 / (100 - minimum)));
}

// The first minimum the score is under, against the same rounded numbers the run shows. Pass the
// live replay while the run is going, so each minimum waits out its grace.
export function minimumMissed(minimums: Minimums | null, score: Score | null, running: Pick<Replay, 'elapsedMs' | 'insertions'> | null = null) {
  if (!minimums || !score) return null;
  const judged = (characters: number) => !running || (running.elapsedMs >= MINIMUM_GRACE_MS && running.insertions >= characters);

  if (minimums.accuracy && score.accuracy < minimums.accuracy && judged(accuracyGraceCharacters(minimums.accuracy))) {
    return { metric: 'accuracy', minimum: minimums.accuracy, value: score.accuracy };
  }

  if (minimums.wpm && score.wpm < minimums.wpm && judged(MINIMUM_GRACE_CHARACTERS)) return { metric: 'wpm', minimum: minimums.wpm, value: score.wpm };

  return null;
}

// A run is at its end once its duration is reached or its passage is finished.
export function atRunEnd({ elapsedMs, durationMs = null, finished = false }: RunPosition) {
  return finished || (durationMs !== null && elapsedMs >= durationMs);
}

// The one judgement behind both checks, so they can't drift apart. A run at its end is judged on its
// final score with no grace, and a miss there is an end-of-run failure (atEnd). Before the end it is
// the live check, with the grace.
export function minimumStop(minimums: Minimums | null, replay: Replay, position: RunPosition) {
  const atEnd = atRunEnd(position);
  const missed = minimumMissed(minimums, replay.score, atEnd ? null : replay);

  return missed && atEnd ? { ...missed, atEnd: true } : missed;
}

// Correction policies. 'relaxed' (free) and 'mandatory' (stop on error) predate
// the others; each value is its own comparison key so bests never mix.
export function isCorrectionPolicy(value: unknown): value is CorrectionPolicy { return value === 'relaxed' || value === 'mandatory' || value === 'no-backspace' || value === 'fail-word' || value === 'fail-any'; }

export const CORRECTION_POLICIES = ['relaxed', 'mandatory', 'no-backspace', 'fail-word', 'fail-any'];

// Older profiles stored a boolean stopOnError; map it to free/stop.
export function correctionPreference(preferences: { correction?: unknown; stopOnError?: unknown } = {}): CorrectionPolicy {
  if (typeof preferences.correction === 'string' && isCorrectionPolicy(preferences.correction)) return preferences.correction;

  return preferences.stopOnError ? 'mandatory' : 'relaxed';
}

export const blocksOnError = (policy: CorrectionPolicy | undefined) => (policy || 'mandatory') === 'mandatory';
export const allowsBackspace = (policy: CorrectionPolicy | undefined) => policy !== 'no-backspace';

// Why inserting `char` at the end of `typed` fails the run, or null. A space or the
// passage's last letter closes a word; the whole prefix is checked so a letter typed
// in place of a space can't slip through.
export function failureFor(policy: CorrectionPolicy, text: string, typed: string, char: string) {
  if (policy === 'fail-any' && char !== text[typed.length]) return 'wrong key';

  if (policy === 'fail-word' && (char === ' ' || typed.length === text.length - 1)) return failureAtEnd(policy, text, typed + char);

  return null;
}

// Why a run that stops at `typed` fails, or null. The end of a run (the timer, the
// passage end) is a word boundary, so an unfinished word with a wrong letter fails.
export function failureAtEnd(policy: CorrectionPolicy, text: string, typed: string) {
  if (typed === text.slice(0, typed.length)) return null;

  if (policy === 'fail-any') return 'wrong key';

  if (policy === 'fail-word') return 'word error';

  return null;
}

// Quick end decides how a word or quote run ends when its last word has a mistake. It only
// matters where a mistake can stand: stop on error already needs every letter right, and a timed
// run ends on the clock.
export function quickEndApplies(conditions: Conditions | HistoricalRecord = {}) {
  return conditions.mode !== 'time' && conditions.correctionPolicy === 'relaxed';
}

function lastWordCorrect(text: string, typed: string) {
  const start = text.lastIndexOf(' ') + 1;

  return typed.slice(start, text.length) === text.slice(start);
}

// Quick end (the default, and the only rule before the setting existed) finishes on the last
// letter, right or wrong. With it off, a mistake in the last word holds the run for a fix or a
// space (see awaitingSubmit).

// Quick end off, the whole passage typed and a mistake in the last word: space submits it as it stands.
export function awaitingSubmit(attempt: Attempt, typed: string) {
  return typed.length >= attempt.text.length && quickEndApplies(attempt.conditions) && !passageComplete(attempt, typed);
}

// Strict space: a space is taken only where the passage has one. Anywhere else it is recorded
// as a wrong key at that position (an insert with accepted: false, which replay has always
// scored without moving the caret), so the rest of the word stays in place.
export function refusesSpace(conditions: Conditions = {}, text: string, position: number, char: string) {
  return conditions.strictSpace === true && char === ' ' && position < text.length && text[position] !== ' ';
}

// Input rules away from the defaults, in the order conditionKey appends them. Defaults add
// nothing, so runs saved before these settings existed keep their keys.
export function inputRules(conditions: Conditions | HistoricalRecord = {}) {
  const rules = [];

  if (conditions.strictSpace === true) rules.push('strict-space');

  if (conditions.quickEnd === false && quickEndApplies(conditions)) rules.push('quick-end-off');

  return rules;
}

export function passageComplete(attempt: Attempt, typed: string) {
  if (typed.length < attempt.text.length) return false;

  if (typed === attempt.text) return true;

  if (blocksOnError(attempt.conditions.correctionPolicy)) return false;

  return attempt.conditions.quickEnd !== false || !quickEndApplies(attempt.conditions) || lastWordCorrect(attempt.text, typed);
}

export function printable(text: unknown): text is string {
  return typeof text === 'string' && text.length > 0 && !/[\r\n]/u.test(text);
}

// Accent (dead) keys reach the page as a short composition: the mark shows, then the next key commits
// one character (ä, or " after space) or, where the pair has no composed form, the mark and that key ("h).
// Which compositions are an accent key's is decided by where they came from (accentComposition); what one
// commits must then be what a Latin keyboard's keys type, or it is IME text, which isn't keyboard input.
const DEAD_MARKS = new Set([...'\'"`~^´¨ˆ˜ˇ˘˚°¸˛˝˙¯']);

// A combining accent is a mark too, except the invisible grapheme joiner (U+034F) among them.
export const deadMark = (char: string) => DEAD_MARKS.has(char) || (/^[̀-ͯ]$/u.test(char) && !/\p{Default_Ignorable_Code_Point}/u.test(char));

// What a key on a Latin keyboard types: printable ASCII or Latin-1 (AZERTY's ² £ § µ), a Latin letter
// (é ø ł ẽ), or a digit, punctuation mark, symbol or space no other script owns (’ — … ≠ ⁴ €, a narrow
// no-break space), which a layout's own keys type and an accent key can commit after its mark. Not another
// script's letter, digit or punctuation (अ ж १ ।), an East Asian form (the ideographic space, CJK
// punctuation, vertical, small and full-width forms), anything invisible (soft hyphen) or a pictograph
// (© ❤), which emoji pickers commit through compositions too. An astral character is two UTF-16 units, so
// it would move the caret two letters.
const LATIN_KEY = /^(?:[\x20-\x7E\u00A0-\u00FF]|\p{Script=Latin}|(?=[\p{N}\p{P}\p{S}\p{Zs}])[\p{scx=Common}\p{scx=Inherited}\p{scx=Latin}])$/u;
const NOT_A_KEY = /[\p{Default_Ignorable_Code_Point}\p{Extended_Pictographic}\u3000-\u303F\uFE10-\uFE6F\uFF00-\uFFEF]/u;
const keyChar = (char: string) => char.length === 1 && (deadMark(char) || LATIN_KEY.test(char)) && !NOT_A_KEY.test(char);

// Where a composition came from. An accent key's opens with that key's keydown (key Dead) in Chrome and
// Firefox. Safari sends the keydown after the mark shows, and Chromium on Linux sends key Process for every
// key its input method takes, so there the mark itself, shown first and on its own, says so. Any other
// composition is an input method's (Pinyin, Telex, Hindi, Korean), whatever it commits: even one letter
// from it is not a key press.
export const accentComposition = ({ key = null, preview = null }: { key?: string | null; preview?: string | null } = {}) => key === 'Dead'
  || (typeof preview === 'string' && preview.length === 1 && deadMark(preview));

// What an accent key's composition types: the one or two keys it committed, or null for anything else.
export function composedKeys(text: string | null | undefined) {
  const chars = [...(text ?? '').normalize('NFC')];

  if (chars.length > 2 || !chars.every(keyChar)) return null;

  if (chars.length === 2 && !deadMark(at(chars, 0))) return null;

  return chars;
}

// A later key of an accent commit (the h of "h) that the passage has no place left for: it was pressed while
// the last letter was still to come, so it is a mistake against that letter and is not kept. A key that is
// that letter ("" on a closing ") records nothing, as a plain key after the passage ends isn't recorded.
export function carriedKey(attempt: Attempt, char: string, offsetMs: number): AttemptEvent | null {
  const position = attempt.text.length - 1;

  return char === attempt.text[position] ? null : { type: 'insert', text: char, position, accepted: false, offsetMs };
}

// Custom text is held to the passage alphabet: printable ASCII, which every corpus passage uses and an
// English keyboard types one key at a time without an input method. Each letter is then one UTF-16 unit,
// which is how replay indexes the passage. About ten minutes of typing: each keystroke replays the whole
// run, so a longer passage makes late keys lag (measured: ~2 ms per key at 3,000 characters, ~9 ms at 9,000).
export const CUSTOM_MAX = 3000;
const TYPABLE = /^[\x20-\x7E]$/;

// Smart punctuation becomes ASCII; NFKC folds compatibility forms (full-width letters, ligatures, no-break
// spaces); invisible code points go (every default-ignorable, such as ZWSP, ZWJ, CGJ, variation selectors,
// bidi marks, soft hyphens and BOM, plus control characters); accents on Latin letters fold away (é → e);
// whitespace collapses. Anything left outside the alphabet is for untypableCharacter to refuse. The cap
// applies last, so a saved passage is stable across reloads; pass max = Infinity to measure the full text.
export function normalizeCustomText(value: unknown, max = CUSTOM_MAX) {
  return String(value || '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .normalize('NFKC')
    .replace(/[\t\n\v\f\r\u0085\u2028\u2029]/g, ' ')
    .replace(/[\p{Default_Ignorable_Code_Point}\p{Cc}]/gu, '')
    .normalize('NFD')
    .replace(/([\x20-\x7E])[\u0300-\u036F]+/g, '$1')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

// Shuffled order uses every word once, so it is exactly as long as the source. Random order samples with
// replacement, so it draws only from words that still fit the source length (and the cap) and stops when
// none do: a long word drawn twice can't push the run past what was validated, and an unlucky draw can't
// end the passage early.
export function orderCustomText(text: string, order = 'as-written', random = Math.random) {
  if (!text) return text;
  const words = text.split(' ');

  if (order === 'shuffled') {
    for (let i = words.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [words[i], words[j]] = [at(words, j), at(words, i)];
    }

    return words.join(' ');
  }

  if (order !== 'random') return text;
  const limit = Math.min(text.length, CUSTOM_MAX);
  const picked = [];
  let length = -1;
  let fitting = words;

  for (;;) {
    const budget = limit - length - 1;
    let word = at(fitting, Math.floor(random() * fitting.length));

    // The budget only shrinks, so words are dropped from the pool once and the draw stays uniform over what fits.
    if (word.length > budget) {
      fitting = fitting.filter((candidate) => candidate.length <= budget);

      if (!fitting.length) break;
      word = at(fitting, Math.floor(random() * fitting.length));
    }

    picked.push(word);
    length += 1 + word.length;
  }

  return picked.join(' ');
}

// The first character outside the passage alphabet, or null when every letter can be typed.
export function untypableCharacter(text: string) {
  for (const char of text) if (!TYPABLE.test(char)) return char;

  return null;
}

// A passage needs enough typing to time: the clock starts on the first key, so one letter finishes at the
// instant it starts. Built-in passages are at least 10 words because they are counted and compared; custom
// text never is, so a short phrase is enough.
export const CUSTOM_MIN_WORDS = 2;
export const CUSTOM_MIN_CHARS = 10;

// Why a normalised custom text can't be used yet, or null. Pass normalizeCustomText(value, Infinity), so an
// over-long text is reported rather than cut.
export function customTextProblem(text: string) {
  if (!text) return { kind: 'empty' };
  const char = untypableCharacter(text);

  if (char) return { kind: 'untypable', char };

  if (text.length < CUSTOM_MIN_CHARS || text.split(' ').length < CUSTOM_MIN_WORDS) return { kind: 'short' };

  if (text.length > CUSTOM_MAX) return { kind: 'long', length: text.length };

  return null;
}

export function replayAttempt(attempt: Pick<Attempt, 'text' | 'events' | 'startedAt' | 'endedAt'>): Replay {
  let typed = '';
  let insertions = 0;
  let correctInsertions = 0;
  let interruptionSinceCorrect = false;
  let previousCorrect: { position: number; offsetMs: number } | null = null;
  let startedAt: number | null = null;
  let endedAt: number | null = null;
  const firstAttempts = new Map<number, FirstAttempt>();
  const pairTimings: PairTiming[] = [];

  for (const event of attempt.events || []) {
    if (event.type === 'focus-lost' || event.type === 'composition') {
      interruptionSinceCorrect = true;
      continue;
    }

    if (event.type === 'delete') {
      typed = typed.slice(0, Math.max(0, typed.length - Math.max(1, event.count || 1)));
      interruptionSinceCorrect = true;
      continue;
    }

    if (event.type !== 'insert' || !printable(event.text)) continue;

    if (startedAt === null) startedAt = event.offsetMs;

    for (const char of event.text) {
      const position = typeof event.position === 'number' && Number.isInteger(event.position) ? event.position : typed.length;

      if (position >= attempt.text.length) break;
      const expected = attempt.text[position];
      const correct = char === expected;
      insertions += 1;

      if (correct) correctInsertions += 1;
      const isFirstAttempt = !firstAttempts.has(position);

      if (!firstAttempts.has(position)) {
        firstAttempts.set(position, { position, expected, actual: char, correct, offsetMs: event.offsetMs });

        if (correct && previousCorrect && previousCorrect.position === position - 1 && !interruptionSinceCorrect) {
          const durationMs = event.offsetMs - previousCorrect.offsetMs;

          if (durationMs >= 0 && durationMs <= MAX_PAIR_PAUSE_MS) pairTimings.push({ pair: attempt.text.slice(position - 1, position + 1), durationMs, position });
        }
      }

      if (event.accepted !== false) typed += char;

      if (correct && isFirstAttempt && event.accepted !== false) {
        previousCorrect = { position, offsetMs: event.offsetMs };
        interruptionSinceCorrect = false;
      } else {
        previousCorrect = null;
        interruptionSinceCorrect = true;
      }

      endedAt = event.offsetMs;
    }
  }

  const elapsedMs = Math.max(0, (attempt.endedAt ?? endedAt ?? 0) - (attempt.startedAt ?? startedAt ?? 0));
  const mistakes = insertions - correctInsertions;

  return {
    typed,
    insertions,
    correctInsertions,
    mistakes,
    elapsedMs,
    score: metrics(attempt.text, typed, insertions, mistakes, elapsedMs),
    firstAttempts: [...firstAttempts.values()],
    pairTimings,
  };
}

// What one event does to the typed text: the same rules replayAttempt applies, typed text only.
function typedAfter(typed: string, event: AttemptEvent, text: string) {
  if (event.type === 'delete') return typed.slice(0, Math.max(0, typed.length - Math.max(1, event.count || 1)));

  if (event.type !== 'insert' || !printable(event.text) || event.accepted === false) return typed;
  let next = typed;

  for (const char of event.text) {
    const position = typeof event.position === 'number' && Number.isInteger(event.position) ? event.position : next.length;

    if (position >= text.length) break;
    next += char;
  }

  return next;
}

// The typed text at offset t (ms on the attempt clock), for the watch-replay view. Events are
// recorded in time order, so each call steps forward only through the events that came due since
// the last one, and starts over only when t goes back (Restart). At every prefix of the events
// it equals replayAttempt's typed text; scoring never calls this.
export function replayCursor(attempt: Attempt) {
  const events = attempt.events || [];
  let applied = 0;
  let typed = '';
  let last = -Infinity;

  return (t: number) => {
    if (t < last) {
      applied = 0;
      typed = '';
    }

    last = t;

    while (applied < events.length && !(at(events, applied).offsetMs > t)) {
      typed = typedAfter(typed, at(events, applied), attempt.text);
      applied += 1;
    }

    return typed;
  };
}

// The scored bounds (startedAt/endedAt) widened to cover every event, so a timed run's idle tail
// plays out and the replay clock ends on the elapsed time the result used.
export function replaySpan(attempt: Attempt) {
  const offsets = (attempt.events || []).map((event) => event.offsetMs).filter(Number.isFinite);

  if (!offsets.length) return { start: 0, end: 0 };
  const bound = (value: number | null) => (typeof value === 'number' && Number.isFinite(value) ? [value] : []);

  return { start: Math.min(...offsets, ...bound(attempt.startedAt)), end: Math.max(...offsets, ...bound(attempt.endedAt)) };
}

// Live readouts, practice's and the replay's, show no rate before this much of the run: over the first
// second a rate is mostly noise.
export const RATE_FLOOR_MS = 1000;

// The live numbers at offset t (ms on the attempt clock): the run scored as if it had ended at t. At
// replaySpan(attempt).end it equals the completed run's score and first-try errors.
export function replayScoreAt(attempt: Attempt, t: number) {
  const events = (attempt.events || []).filter((event) => event.offsetMs <= t);
  const replay = replayAttempt({ ...attempt, events, endedAt: Math.min(t, attempt.endedAt ?? t) });

  return {
    ...replay.score,
    errors: replay.firstAttempts.filter((item) => !item.correct).length,
    elapsedMs: replay.elapsedMs,
  };
}

export function completeAttempt(attempt: Attempt, { endedAt, status = 'complete' }: { endedAt?: number; status?: Attempt['status'] } = {}): Attempt {
  const replay = replayAttempt({ ...attempt, endedAt: endedAt ?? null });

  return {
    ...attempt,
    typed: replay.typed,
    startedAt: attempt.startedAt ?? attempt.events.find((event) => event.type === 'insert')?.offsetMs ?? null,
    endedAt: endedAt ?? attempt.endedAt,
    status,
    summary: replay,
  };
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return Math.round(sorted.length % 2 ? at(sorted, middle) : (at(sorted, middle - 1) + at(sorted, middle)) / 2);
}

export function summarizePatterns(attempts: Attempt[], limit = 20, compatibleConditions: Conditions | null = null) {
  const key = compatibleConditions ? conditionKey(compatibleConditions) : null;

  const recent = attempts.filter((attempt) => attempt.status === 'complete'
    && !attempt.interrupted
    && attempt.kind !== 'drill'
    && attempt.kind !== 'missed'
    && attempt.kind !== 'race'
    && attempt.kind !== 'lesson'
    // A ghost race is someone else's text against their recorded run: its own kind, not training evidence.
    && attempt.kind !== 'challenge'
    // Repeated text (a returning daily passage or a repeated quote) is never training evidence.
    && attempt.fresh !== false
    && (!key || conditionKey(attempt.conditions) === key)).slice(-limit);

  const pairs = new Map<string, PatternPair>();
  const allTimings: number[] = [];

  for (const attempt of recent) {
    const replay = attempt.summary || replayAttempt(attempt);

    for (const first of replay.firstAttempts) {
      if (first.position < 1) continue;
      const pair = attempt.text.slice(first.position - 1, first.position + 1).toLowerCase();

      if (!/^[a-z]{2}$/.test(pair)) continue;
      const entry = pairs.get(pair) || { pair, observations: 0, errors: 0, timings: [] };
      entry.observations += 1;

      if (!first.correct) entry.errors += 1;
      pairs.set(pair, entry);
    }

    for (const timing of replay.pairTimings) {
      const pair = timing.pair.toLowerCase();

      if (!/^[a-z]{2}$/.test(pair)) continue;
      const entry = pairs.get(pair) || { pair, observations: 0, errors: 0, timings: [] };
      entry.timings.push(timing.durationMs);
      pairs.set(pair, entry);
      allTimings.push(timing.durationMs);
    }
  }

  const personalMedianMs = median(allTimings);

  return {
    attemptCount: recent.length,
    personalMedianMs,
    pairs: [...pairs.values()].map((entry) => ({
      ...entry,
      errorRate: entry.observations ? entry.errors / entry.observations : 0,
      medianMs: median(entry.timings),
      slowdownMs: personalMedianMs === null || !entry.timings.length ? null : (median(entry.timings) ?? 0) - personalMedianMs,
    })),
  };
}

// "3 first-try errors in 24 tries": the counts behind every recommendation.
function errorCount({ errors, observations }: { errors: number; observations: number }) {
  return `${errors} first-try ${errors === 1 ? 'error' : 'errors'} in ${observations} ${observations === 1 ? 'try' : 'tries'}`;
}

export function recommendTarget(attempts: Attempt[], compatibleConditions: Conditions | null = null) {
  const evidence = summarizePatterns(attempts, 20, compatibleConditions);
  const errorCandidates = evidence.pairs.filter((pair) => pair.observations >= 10 && pair.errors > 0).sort((a, b) => b.errorRate - a.errorRate || b.observations - a.observations || a.pair.localeCompare(b.pair));
  const timingCandidates = evidence.pairs.filter((pair) => pair.timings.length >= 10 && (pair.slowdownMs ?? 0) > 0).sort((a, b) => (b.slowdownMs ?? 0) - (a.slowdownMs ?? 0) || b.timings.length - a.timings.length || a.pair.localeCompare(b.pair));
  const target = errorCandidates[0] || timingCandidates[0];

  if (target) {
    const reason = target.errors > 0
      ? `“${target.pair}”: ${errorCount(target)}.`
      : `“${target.pair}”: median ${target.medianMs} ms over ${target.timings.length} clean intervals, ${target.slowdownMs} ms slower than your ${evidence.personalMedianMs} ms median.`;

    return { kind: 'targeted', target: target.pair, title: `Practice “${target.pair}”`, reason, evidence };
  }

  const early = evidence.pairs.filter((pair) => pair.errors > 0).sort((a, b) => b.errors - a.errors || b.observations - a.observations || a.pair.localeCompare(b.pair))[0];

  return {
    kind: 'general',
    target: null,
    title: 'General drill',
    reason: early
      ? `Too little data to target a pattern yet (“${early.pair}”: ${errorCount(early)}).`
      : 'Not enough clean data to name a weakness yet.',
    evidence,
  };
}

export function normalizeManualTarget(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '').slice(0, 8);
}

// Every real word a drill can draw on: the word list, the drill words and the quotes' words.
const drillVocabulary = (bank: string[]) => [...new Set([
  ...bank,
  ...drillWords,
  ...quoteCorpus.flatMap((item) => item.text.toLowerCase().match(/[a-z]+/g) || []),
])];

export const DRILL_SECONDS = 30;

// Words from the vocabulary holding each unit, weighted: [{ words, weight }], empty groups left out. A unit
// given as a bare string weighs 1.
const leanOf = (lean: (string | WeightedUnit)[]) => lean.map((item) => (typeof item === 'string' ? { unit: item, weight: 1 } : item));

function weightedGroups(lean: (string | WeightedUnit)[], vocabulary: string[]) {
  return leanOf(lean).flatMap(({ unit, weight }) => {
    const words = vocabulary.filter((word) => /^[a-z]+$/.test(word) && word.includes(unit));

    return words.length && weight > 0 ? [{ words, weight }] : [];
  });
}

function weightedWord(groups: WeightedWords[], random: () => number) {
  let draw = random() * groups.reduce((sum, group) => sum + group.weight, 0);
  const group = groups.find((item) => (draw -= item.weight) < 0) || at(groups, groups.length - 1);

  return at(group.words, Math.floor(random() * group.words.length));
}

// Same weights, same seed: a leaning drill's text depends only on what it leans on.
function leanSeed(lean: WeightedUnit[]) {
  let seed = 2166136261;

  for (const char of lean.map(({ unit, weight }) => `${unit}:${weight.toFixed(6)}`).join(' ')) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;

  return seed;
}

// A drill on one target, or a general drill. A general drill given `lean` ([{ unit, weight }], the units the
// learner ranks highest) draws half its words from words holding them, by weight, and the rest from the list.
export function makeDrill(target: string | null = null, list = DEFAULT_WORD_LIST, lean: WeightedUnit[] = []) {
  const safeTarget = normalizeManualTarget(target);
  const bank = wordList(list);
  const corpusWords = drillVocabulary(bank);
  const groups = safeTarget ? [] : weightedGroups(lean, corpusWords);

  if (groups.length) {
    const random = seededRandom(leanSeed(lean));
    const text = Array.from({ length: 1600 }, () => (random() < 0.5 ? weightedWord(groups, random) : at(bank, Math.floor(random() * bank.length)))).join(' ');

    return { id: `drill-general-${textId(text)}`, textVersion: 'drill-general-lean@1', text, target: '', lean: lean.map(({ unit }) => unit), corpus: CORPUS_VERSION };
  }

  const candidates = safeTarget ? corpusWords.filter((word) => word.includes(safeTarget)) : bank;
  // A manual target may itself be a valid word that the small local corpus does
  // not contain. Repeat that exact user choice; never fabricate word forms.
  const words = candidates.length ? candidates : [safeTarget];
  const sequence = Array.from({ length: 1600 }, (_, index) => words[(index * 7 + Math.floor(index / Math.max(1, words.length))) % words.length]);
  const text = sequence.join(' ');
  const label = safeTarget || 'general';

  return { id: `drill-${label}-${textId(text)}`, textVersion: `drill-${label}@2`, text, target: safeTarget, corpus: CORPUS_VERSION };
}

// Adaptive practice: a word or timed passage of real words in which about half are words holding one of the
// units it leans on ([{ unit, weight }]), each drawn in proportion to its weight (the learner's expected gain).
// Nothing in the text is marked, and it is drill-kind text: never a best, a trend point or a retest baseline.
// Null when no word holds any of the units.
export function makeAdaptive(lean: (string | WeightedUnit)[], { mode = 'time', count = 25, duration = 0, punctuation = false, numbers = false, wordList: list = DEFAULT_WORD_LIST, random = Math.random }: PassageOptions = {}) {
  const bank = wordList(list);
  const groups = weightedGroups(lean, drillVocabulary(bank));

  if (!groups.length) return null;
  const draw = () => (random() >= 0.5 ? at(bank, Math.floor(random() * bank.length)) : weightedWord(groups, random));
  const text = drawnPassage(draw, mode, count, punctuation, random, numbers, duration);

  return { id: `adaptive-${textId(text)}`, textVersion: 'adaptive@2', text, pairs: leanOf(lean).map(({ unit }) => unit), adaptive: true, corpus: CORPUS_VERSION };
}

// The test conditions this build offers, and so the only ones it writes: the timed lengths (seconds) and
// word counts src/app.js offers, the quote filters index.html offers, and the inputs and correction
// policies it records. Word lists are src/words.js's wordListIds.
export const TEST_DURATIONS = [15, 30, 60, 120];
export const TEST_COUNTS = [10, 25, 50, 100];
export const QUOTE_LENGTHS = ['any', 'short', 'medium', 'long'];
export const QUOTE_DIFFICULTIES = ['any', 'gentle', 'steady', 'precise'];
export const INPUT_CLASSES = ['physical-keyboard', 'touch'];

// The standard recipe version is appended only when present, so every other key stays as it was.
export function conditionKey(conditions: Conditions | HistoricalRecord = {}) {
  const key = [
    // Code runs key by language and book pages by book; other modes keep their existing keys.
    conditions.mode === 'code' ? `code-${conditions.codeLanguage || 'js'}` : conditions.mode === 'book' ? `book-${conditions.book}` : conditions.mode,
    conditions.duration || '',
    conditions.count || '',
    // Numbers ride on the same segment so keys saved before the toggle existed stay unchanged.
    `${conditions.punctuation ? 'punctuation' : 'plain'}${conditions.numbers ? '+numbers' : ''}`,
    conditions.quoteLength || '',
    conditions.difficulty || '',
    conditions.wordList || '',
    conditions.inputClass || 'physical-keyboard',
    conditions.correctionPolicy || 'mandatory',
    conditions.corpus || CORPUS_VERSION,
    conditions.metricVersion || METRIC_VERSION,
    ...inputRules(conditions),
  ].join(':');

  const recipeKey = conditions.recipe ? `${key}:${conditions.recipe}` : key;

  return isDefaultLayout(conditions.layout) ? recipeKey : `${recipeKey}:layout-${conditions.layout}`;
}

export function comparable(before: Attempt | null | undefined, after: Attempt | null | undefined) {
  if (!before || !after) return false;

  return before.status === 'complete'
    && after.status === 'complete'
    && conditionKey(before.conditions) === conditionKey(after.conditions)
    && before.metricVersion === after.metricVersion
    && before.textId !== after.textId
    // Familiar text flatters a score, so neither side of a comparison may be repeated text.
    && before.fresh !== false
    && after.fresh !== false
    && before.kind !== 'drill'
    && after.kind !== 'drill'
    && before.kind !== 'lesson'
    && after.kind !== 'lesson'
    && before.kind !== 'challenge'
    && after.kind !== 'challenge'
    && !before.interrupted
    && !after.interrupted;
}

export type AttemptComparison = ReturnType<typeof compareAttempts>;

export function compareAttempts(before: Attempt, after: Attempt) {
  // A retest stopped under its baseline's minimums is stored as interrupted; say why it isn't compared.
  if (after?.stopped) return { comparable: false, state: 'not-comparable', reason: 'The retest fell under the baseline’s minimums, so no comparison is made.' };

  if (!comparable(before, after)) return { comparable: false, state: 'not-comparable', reason: 'Different conditions or repeated text, so no comparison is made.' };
  const beforeScore = before.summary?.score || replayAttempt(before).score;
  const afterScore = after.summary?.score || replayAttempt(after).score;
  const wpmDelta = afterScore.wpm - beforeScore.wpm;
  const accuracyDelta = afterScore.accuracy - beforeScore.accuracy;
  const directions = [Math.sign(wpmDelta), Math.sign(accuracyDelta)].filter(Boolean);

  const state = directions.includes(1) && directions.includes(-1)
    ? 'mixed'
    : directions.includes(1)
      ? 'improved'
      : directions.includes(-1)
        ? 'regressed'
        : 'steady';

  return {
    comparable: true,
    state,
    wpmDelta,
    accuracyDelta,
    before: beforeScore,
    after: afterScore,
    // The heading already states the direction; the reason is only the caveat.
    reason: state === 'improved'
      ? 'One retest is feedback, not proof.'
      : state === 'mixed'
        ? 'Speed and accuracy moved apart.'
        : state === 'regressed'
          ? 'One attempt can vary. Your best is untouched.'
          : 'Held steady on fresh text.',
  };
}

// Secondary run-card stats, derived from the event log only. Presentational: they never feed
// the versioned wpm/accuracy contract, bests, comparisons or pattern memory.

// Every printable key pressed, including keys held back while stop-on-error waits for a fix.
function keystrokes(attempt: Attempt) {
  return (attempt.events || []).filter((event): event is Extract<AttemptEvent, { text: string }> => (event.type === 'insert' || event.type === 'blocked-insert') && printable(event.text));
}

export function rawWpm(attempt: Attempt, replay = replayAttempt(attempt)) {
  const typed = keystrokes(attempt).reduce((sum, event) => sum + [...event.text].length, 0);

  return replay.elapsedMs > 0 ? Math.round(typed / CHARS_PER_WORD / (replay.elapsedMs / 60000)) : 0;
}

// 100 − coefficient of variation of per-second raw speed, over whole seconds; null under 3 s.
export function consistency(attempt: Attempt, replay = replayAttempt(attempt)) {
  const keys = keystrokes(attempt);

  if (!keys.length) return null;
  const start = attempt.startedAt ?? at(keys, 0).offsetMs;
  const seconds = Math.floor(replay.elapsedMs / 1000);

  if (seconds < 3) return null;
  const counts: number[] = new Array<number>(seconds).fill(0);

  for (const event of keys) {
    const second = Math.floor((event.offsetMs - start) / 1000);

    if (second >= 0 && second < seconds) counts[second] = at(counts, second) + [...event.text].length;
  }

  const mean = counts.reduce((sum, value) => sum + value, 0) / seconds;

  if (!mean) return 0;
  const sd = Math.sqrt(counts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / seconds);

  return Math.round(Math.min(100, Math.max(0, 100 - (sd / mean) * 100)));
}

// The finished text, letter by letter: correct and incorrect (still wrong at the finish) in the
// kept text; extra = keystrokes past the passage end, including a key an accent commit carried past
// it (recorded against the last letter once the passage is full, not kept; a key refused inside the
// passage is not extra); missed = letters left untyped inside the
// last word the run reached. Slips fixed along the way are first-try errors, not incorrect.
export function characterBreakdown(attempt: Attempt, replay = replayAttempt(attempt)) {
  const target = attempt.text;
  const { typed } = replay;
  let correct = 0;

  for (let i = 0; i < typed.length; i += 1) if (typed[i] === target[i]) correct += 1;
  let extra = 0;
  let length = 0;

  for (const event of attempt.events || []) {
    if (event.type === 'delete') length = Math.max(0, length - Math.max(1, event.count || 1));

    if (event.type !== 'insert' || !printable(event.text)) continue;

    for (let n = [...event.text].length; n > 0; n -= 1) {
      const position = typeof event.position === 'number' && Number.isInteger(event.position) ? event.position : length;

      if (position >= target.length || (event.accepted === false && length >= target.length)) extra += 1;
      else if (event.accepted !== false) length += 1;
    }
  }

  let reached = typed.length;

  if (reached > 0 && reached < target.length && target[reached - 1] !== ' ') {
    const space = target.indexOf(' ', reached);
    reached = space === -1 ? target.length : space;
  }

  return { correct, incorrect: typed.length - correct, extra, missed: Math.max(0, reached - typed.length) };
}

// When each letter still there at the finish was typed, mirroring replayAttempt's kept text.
function keptTimes(attempt: Attempt) {
  const times: number[] = [];

  for (const event of attempt.events || []) {
    if (event.type === 'delete') {
      times.splice(Math.max(0, times.length - Math.max(1, event.count || 1)));
      continue;
    }

    if (event.type !== 'insert' || !printable(event.text)) continue;

    for (const _char of event.text) {
      const position = typeof event.position === 'number' && Number.isInteger(event.position) ? event.position : times.length;

      if (position >= attempt.text.length) break;

      if (event.accepted !== false) times.push(event.offsetMs);
    }
  }

  return times;
}

// The passage words the run reached, flagged if any first try or kept letter in them missed, with
// the pace from the previous word's space (or the run's first keystroke) to the word's last letter,
// timed by the keystrokes kept at the finish so corrections count against the pace. The passage sets
// each word's bounds; the word shown is the letters kept there, slips left in included. A word the
// run stopped inside shows only the letters typed; the rest are counted as missed, not shown.
export function wordHistory(attempt: Attempt, replay = replayAttempt(attempt)) {
  const target = attempt.text;
  const firsts = new Map(replay.firstAttempts.map((item) => [item.position, item]));
  const times = keptTimes(attempt);
  // The first word has no space to start from: it runs from the first key pressed, even one later
  // fixed, and then every kept letter typed after that key counts.
  const firstKey = (attempt.events || []).find((event) => event.type === 'insert' && printable(event.text))?.offsetMs;
  const words: { word: string; wrong: boolean; wpm: number | null }[] = [];
  const pattern = /\S+/gu;
  let match;

  while ((match = pattern.exec(target)) && match.index < replay.typed.length) {
    const start = match.index;
    const end = Math.min(start + match[0].length, replay.typed.length) - 1;
    let wrong = false;

    for (let i = start; i <= end; i += 1) {
      if (firsts.get(i)?.correct === false || replay.typed[i] !== target[i]) wrong = true;
    }

    // The space after a word is part of typing it: a first-try miss there marks the word, and a
    // character still wrong there at the finish shows on the word ("thex"). Pace stays on the letters.
    const stop = start + match[0].length;
    const gap = target.slice(stop).search(/\S/u);
    const kept = replay.typed.slice(stop, gap === -1 ? target.length : stop + gap);
    let shown = replay.typed.slice(start, end + 1);

    for (let i = stop; i < stop + kept.length; i += 1) if (firsts.get(i)?.correct === false) wrong = true;

    if (kept !== target.slice(stop, stop + kept.length)) {
      wrong = true;
      shown += kept;
    }

    const from = start > 0 ? times[start - 1] : firstKey;
    const letters = start > 0 || (times[start] ?? NaN) > (from ?? NaN) ? end - start + 1 : end - start;
    const durationMs = from !== undefined && times[end] !== undefined ? at(times, end) - from : 0;
    words.push({
      word: shown,
      wrong,
      wpm: durationMs > 0 ? Math.round(letters / CHARS_PER_WORD / (durationMs / 60000)) : null,
    });
  }

  return words;
}

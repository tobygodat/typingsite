import { DEFAULT_WORD_LIST, wordList } from './words.js';
import { additionalQuotes, drillWords } from './corpus.js';

export const METRIC_VERSION = 'stilltype-metrics-v1';
export const EVENT_VERSION = 'stilltype-events-v1';
export const CORPUS_VERSION = 'original-en-v5';
export const MAX_PAIR_PAUSE_MS = 2000;

export function metrics(target, typed, attempts, mistakes, elapsedMs) {
  const correct = [...typed].reduce((sum, char, i) => sum + (char === target[i] ? 1 : 0), 0);
  return {
    wpm: elapsedMs > 0 ? Math.round(correct / 5 / (elapsedMs / 60000)) : 0,
    accuracy: attempts ? Math.round(((attempts - mistakes) / attempts) * 100) : 100,
  };
}

export function editStats(previous, next, target) {
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

function punctuate(words) {
  return words.map((word, i) => {
    // Lists are all lowercase so plain tests never need Shift; capitals come only from here.
    let result = word === 'i' ? 'I' : word;
    if (i % 9 === 0) result = result[0].toUpperCase() + result.slice(1);
    if (i % 9 === 8) result += '.';
    else if (i % 9 === 4) result += ',';
    return result;
  });
}

export function makePassage(mode, count, punctuation, random = Math.random, list = DEFAULT_WORD_LIST) {
  if (mode === 'quote') return quoteCorpus[Math.floor(random() * quoteCorpus.length)].text;
  const bank = wordList(list);
  // 1,600 words keeps even a 300 WPM typist supplied for the longest 120 s mode.
  const words = Array.from({ length: mode === 'time' ? 1600 : count }, () => bank[Math.floor(random() * bank.length)]);
  return (punctuation ? punctuate(words) : words).join(' ');
}

// The standard test: one fixed, versioned recipe, so its scores stay comparable over time. Every
// attempt gets fresh text from its own seed; the recipe is what stays fixed. Any change to the
// recipe below (vocabulary weights, numbers, punctuation, the quote, length) is a new version:
// bump STANDARD_VERSION. Word-list or quote edits already bump CORPUS_VERSION, which is in the key.
export const STANDARD_VERSION = 'standard-v1';
export const STANDARD_SECONDS = 60;
const STANDARD_WORDS = 400;
const STANDARD_QUOTE_MAX_WORDS = 30;

// mulberry32: a small, fast, well-mixed 32-bit generator. Same seed, same text.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let standardTiers = null;
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

function standardWord(random) {
  const draw = random();
  let total = 0;
  for (const [weight, band] of standardVocabulary()) {
    total += weight;
    if (draw < total) return band[Math.floor(random() * band.length)];
  }
  const band = standardVocabulary().at(-1)[1];
  return band[Math.floor(random() * band.length)];
}

function standardNumber(random) {
  const form = random();
  if (form < 0.5) return String(2 + Math.floor(random() * 98));
  if (form < 0.8) return String(1950 + Math.floor(random() * 80));
  return String(100 + Math.floor(random() * 900));
}

function standardSentence(random) {
  const length = 5 + Math.floor(random() * 10);
  const words = [];
  for (let i = 0; i < length; i += 1) {
    // About one word in twenty is a number, never the first word, so every sentence opens with a capital.
    let word = i > 0 && random() < 0.05 ? standardNumber(random) : standardWord(random);
    if (word === 'i') word = 'I';
    if (i === 0) word = word[0].toUpperCase() + word.slice(1);
    if (i > 1 && i < length - 2 && random() < 0.1) word += ',';
    words.push(word);
  }
  words[length - 1] += random() < 0.1 ? '?' : '.';
  return words;
}

// Standard v1: 60 seconds of sentences mixing the 1k (60%), 5k (25%) and 10k (15%) bands, with
// capitals, commas, full stops, some question marks and numbers, and one short original quote in
// double quotation marks after the first sentence, so every typist reaches it.
export function makeStandardText(seed) {
  const random = seededRandom(seed);
  const quotes = quoteCorpus.filter((item) => item.text.split(/\s+/).length <= STANDARD_QUOTE_MAX_WORDS && !item.text.includes('"'));
  const quote = quotes[Math.floor(random() * quotes.length)];
  const quoted = `"${quote.text}"`.split(' ');
  const words = [...standardSentence(random), ...quoted];
  let generated = words.length - quoted.length;
  while (generated < STANDARD_WORDS) {
    const sentence = standardSentence(random);
    words.push(...sentence);
    generated += sentence.length;
  }
  return { text: words.join(' '), quoteId: quote.id };
}

export function standardPassage(seed) {
  const value = seed >>> 0;
  const { text, quoteId } = makeStandardText(value);
  const id = `${STANDARD_VERSION}-${value.toString(36)}`;
  return { id, textVersion: `${id}@1`, text, seed: value, quoteId, recipe: STANDARD_VERSION, corpus: CORPUS_VERSION, difficulty: 'standard', fresh: true, exhausted: false };
}

// The recipe's conditions are fixed: only the input class is observed per run.
export function standardConditions(inputClass = 'physical-keyboard') {
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

export function textId(text) {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `generated-${(hash >>> 0).toString(36)}`;
}

export function selectPassage({ mode = 'time', count = 25, punctuation = false, quoteLength = 'any', difficulty = 'any', seenIds = [], random = Math.random, wordList: list = DEFAULT_WORD_LIST } = {}) {
  const seen = new Set(seenIds);
  if (mode === 'standard') {
    // A fresh seed per attempt; the word-list, punctuation and quote filters never apply.
    let passage = null;
    for (let i = 0; i < 12 && (!passage || seen.has(passage.id)); i += 1) passage = standardPassage(Math.floor(random() * 4294967296));
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
    const pool = fresh.length ? fresh : candidates;
    if (!pool.length) return null;
    const item = pool[Math.floor(random() * pool.length)];
    return { ...item, textVersion: `${item.id}@1`, corpus: CORPUS_VERSION, fresh: fresh.length > 0, exhausted: fresh.length === 0 };
  }

  for (let i = 0; i < 12; i += 1) {
    const text = makePassage(mode, count, punctuation, random, list);
    const id = textId(text);
    if (!seen.has(id)) return { id, textVersion: `${id}@1`, text, corpus: CORPUS_VERSION, difficulty: 'generated', fresh: true, exhausted: false };
  }
  const text = makePassage(mode, count, punctuation, random, list);
  const id = textId(text);
  return { id, textVersion: `${id}@1`, text, corpus: CORPUS_VERSION, difficulty: 'generated', fresh: !seen.has(id), exhausted: seen.has(id) };
}

export function createAttempt({ id, text, textId: sourceTextId, kind = 'test', conditions = {} }) {
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

export function passageComplete(attempt, typed) {
  return typed.length >= attempt.text.length
    && (attempt.conditions.correctionPolicy === 'relaxed' || typed === attempt.text);
}

function printable(text) {
  return typeof text === 'string' && text.length > 0 && !/[\r\n]/u.test(text);
}

export function replayAttempt(attempt) {
  let typed = '';
  let insertions = 0;
  let correctInsertions = 0;
  let interruptionSinceCorrect = false;
  let previousCorrect = null;
  let startedAt = null;
  let endedAt = null;
  const firstAttempts = new Map();
  const pairTimings = [];

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
      const position = Number.isInteger(event.position) ? event.position : typed.length;
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

export function completeAttempt(attempt, { endedAt, status = 'complete' } = {}) {
  const replay = replayAttempt({ ...attempt, endedAt });
  return {
    ...attempt,
    typed: replay.typed,
    startedAt: attempt.startedAt ?? attempt.events.find((event) => event.type === 'insert')?.offsetMs ?? null,
    endedAt: endedAt ?? attempt.endedAt,
    status,
    summary: replay,
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

export function summarizePatterns(attempts, limit = 20, compatibleConditions = null) {
  const key = compatibleConditions ? conditionKey(compatibleConditions) : null;
  const recent = attempts.filter((attempt) => attempt.status === 'complete'
    && !attempt.interrupted
    && attempt.kind !== 'drill'
    && attempt.kind !== 'race'
    && (attempt.kind !== 'daily' || attempt.fresh !== false)
    && (!key || conditionKey(attempt.conditions) === key)).slice(-limit);
  const pairs = new Map();
  const allTimings = [];
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
      slowdownMs: personalMedianMs === null || !entry.timings.length ? null : median(entry.timings) - personalMedianMs,
    })),
  };
}

// "3 first-try errors in 24 tries": the counts behind every recommendation.
function errorCount({ errors, observations }) {
  return `${errors} first-try ${errors === 1 ? 'error' : 'errors'} in ${observations} ${observations === 1 ? 'try' : 'tries'}`;
}

export function recommendTarget(attempts, compatibleConditions = null) {
  const evidence = summarizePatterns(attempts, 20, compatibleConditions);
  const errorCandidates = evidence.pairs.filter((pair) => pair.observations >= 10 && pair.errors > 0).sort((a, b) => b.errorRate - a.errorRate || b.observations - a.observations || a.pair.localeCompare(b.pair));
  const timingCandidates = evidence.pairs.filter((pair) => pair.timings.length >= 10 && pair.slowdownMs > 0).sort((a, b) => b.slowdownMs - a.slowdownMs || b.timings.length - a.timings.length || a.pair.localeCompare(b.pair));
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

export function normalizeManualTarget(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '').slice(0, 8);
}

export function makeDrill(target = null, list = DEFAULT_WORD_LIST) {
  const safeTarget = normalizeManualTarget(target);
  const bank = wordList(list);
  const corpusWords = [...new Set([
    ...bank,
    ...drillWords,
    ...quoteCorpus.flatMap((item) => item.text.toLowerCase().match(/[a-z]+/g) || []),
  ])];
  const candidates = safeTarget ? corpusWords.filter((word) => word.includes(safeTarget)) : bank;
  // A manual target may itself be a valid word that the small local corpus does
  // not contain. Repeat that exact user choice; never fabricate word forms.
  const words = candidates.length ? candidates : [safeTarget];
  const sequence = Array.from({ length: 1600 }, (_, index) => words[(index * 7 + Math.floor(index / Math.max(1, words.length))) % words.length]);
  const text = sequence.join(' ');
  const label = safeTarget || 'general';
  return { id: `drill-${label}-${textId(text)}`, textVersion: `drill-${label}@2`, text, target: safeTarget, corpus: CORPUS_VERSION };
}

// The standard recipe version is appended only when present, so every other key stays as it was.
export function conditionKey(conditions = {}) {
  const key = [
    conditions.mode,
    conditions.duration || '',
    conditions.count || '',
    conditions.punctuation ? 'punctuation' : 'plain',
    conditions.quoteLength || '',
    conditions.difficulty || '',
    conditions.wordList || '',
    conditions.inputClass || 'physical-keyboard',
    conditions.correctionPolicy || 'mandatory',
    conditions.corpus || CORPUS_VERSION,
    conditions.metricVersion || METRIC_VERSION,
  ].join(':');
  return conditions.recipe ? `${key}:${conditions.recipe}` : key;
}

export function comparable(before, after) {
  if (!before || !after) return false;
  return before.status === 'complete'
    && after.status === 'complete'
    && conditionKey(before.conditions) === conditionKey(after.conditions)
    && before.metricVersion === after.metricVersion
    && before.textId !== after.textId
    && after.fresh !== false
    && before.kind !== 'drill'
    && after.kind !== 'drill'
    && !before.interrupted
    && !after.interrupted;
}

export function compareAttempts(before, after) {
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

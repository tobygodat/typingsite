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

// Minimum accuracy and speed to continue (practice runs and their retests). They decide whether a
// run may go on, never how it is scored, so they are not test conditions. The opening can't fail a
// run on its own: the running check waits five seconds and twenty characters, and accuracy waits
// until two misses alone can't take the rounded figure under the minimum (40 characters at 95%,
// 100 at 98%). A run that reaches its end is judged on its final score.
export const MINIMUM_GRACE_MS = 5000;
export const MINIMUM_GRACE_CHARACTERS = 20;

export function accuracyGraceCharacters(minimum) {
  return Math.max(MINIMUM_GRACE_CHARACTERS, Math.ceil(200 / (100 - minimum)));
}

// The first minimum the score is under, against the same rounded numbers the run shows. Pass the
// live replay while the run is going, so each minimum waits out its grace.
export function minimumMissed(minimums, score, running = null) {
  if (!minimums || !score) return null;
  const judged = (characters) => !running || (running.elapsedMs >= MINIMUM_GRACE_MS && running.insertions >= characters);
  if (minimums.accuracy && score.accuracy < minimums.accuracy && judged(accuracyGraceCharacters(minimums.accuracy))) {
    return { metric: 'accuracy', minimum: minimums.accuracy, value: score.accuracy };
  }
  if (minimums.wpm && score.wpm < minimums.wpm && judged(MINIMUM_GRACE_CHARACTERS)) return { metric: 'wpm', minimum: minimums.wpm, value: score.wpm };
  return null;
}

// A run is at its end once its duration is reached or its passage is finished.
export function atRunEnd({ elapsedMs, durationMs = null, finished = false }) {
  return finished || (durationMs !== null && elapsedMs >= durationMs);
}

// The one judgement behind both checks, so they can't drift apart. A run at its end is judged on its
// final score with no grace, and a miss there is an end-of-run failure (atEnd). Before the end it is
// the live check, with the grace.
export function minimumStop(minimums, replay, position) {
  const atEnd = atRunEnd(position);
  const missed = minimumMissed(minimums, replay.score, atEnd ? null : replay);
  return missed && atEnd ? { ...missed, atEnd: true } : missed;
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

export function conditionKey(conditions = {}) {
  return [
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
function keystrokes(attempt) {
  return (attempt.events || []).filter((event) => (event.type === 'insert' || event.type === 'blocked-insert') && printable(event.text));
}

export function rawWpm(attempt, replay = replayAttempt(attempt)) {
  const typed = keystrokes(attempt).reduce((sum, event) => sum + [...event.text].length, 0);
  return replay.elapsedMs > 0 ? Math.round(typed / 5 / (replay.elapsedMs / 60000)) : 0;
}

// 100 − coefficient of variation of per-second raw speed, over whole seconds; null under 3 s.
export function consistency(attempt, replay = replayAttempt(attempt)) {
  const keys = keystrokes(attempt);
  if (!keys.length) return null;
  const start = attempt.startedAt ?? keys[0].offsetMs;
  const seconds = Math.floor(replay.elapsedMs / 1000);
  if (seconds < 3) return null;
  const counts = new Array(seconds).fill(0);
  for (const event of keys) {
    const second = Math.floor((event.offsetMs - start) / 1000);
    if (second >= 0 && second < seconds) counts[second] += [...event.text].length;
  }
  const mean = counts.reduce((sum, value) => sum + value, 0) / seconds;
  if (!mean) return 0;
  const sd = Math.sqrt(counts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / seconds);
  return Math.round(Math.min(100, Math.max(0, 100 - (sd / mean) * 100)));
}

// The finished text, letter by letter: correct and incorrect (still wrong at the finish) in the
// kept text; extra = keystrokes past the passage end; missed = letters left untyped inside the
// last word the run reached. Slips fixed along the way are first-try errors, not incorrect.
export function characterBreakdown(attempt, replay = replayAttempt(attempt)) {
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
      const position = Number.isInteger(event.position) ? event.position : length;
      if (position >= target.length) extra += 1;
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
function keptTimes(attempt) {
  const times = [];
  for (const event of attempt.events || []) {
    if (event.type === 'delete') {
      times.splice(Math.max(0, times.length - Math.max(1, event.count || 1)));
      continue;
    }
    if (event.type !== 'insert' || !printable(event.text)) continue;
    for (const _char of event.text) {
      const position = Number.isInteger(event.position) ? event.position : times.length;
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
export function wordHistory(attempt, replay = replayAttempt(attempt)) {
  const target = attempt.text;
  const firsts = new Map(replay.firstAttempts.map((item) => [item.position, item]));
  const times = keptTimes(attempt);
  // The first word has no space to start from: it runs from the first key pressed, even one later
  // fixed, and then every kept letter typed after that key counts.
  const firstKey = (attempt.events || []).find((event) => event.type === 'insert' && printable(event.text))?.offsetMs;
  const words = [];
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
    const letters = start > 0 || times[start] > from ? end - start + 1 : end - start;
    const durationMs = from !== undefined && times[end] !== undefined ? times[end] - from : 0;
    words.push({
      word: shown,
      wrong,
      wpm: durationMs > 0 ? Math.round(letters / 5 / (durationMs / 60000)) : null,
    });
  }
  return words;
}

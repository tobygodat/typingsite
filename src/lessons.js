// The beginner path: guided lessons that add a few keys at a time, then hand off to the training loop.
// Lessons are their own kind of run. They never become bests, trends, retests or pattern evidence;
// their progress lives in profile.lessons, keyed by lesson id. They teach finger positions on a physical
// keyboard, so only a physical-keyboard run can pass one; a touch run is kept as a labelled try.
// Passages are real words from the common-word lists in src/words.js, made only of keys already
// learned. Where too few such words exist (the first home-row lessons), the passage is topped up with
// key pairs, which the UI labels.
import { wordList, wordListIds } from './words.js';
import { CORPUS_VERSION, textId } from './typing.js';

export const LESSON_VERSION = 'lessons-v1';
// One completed run at or above both numbers unlocks the next lesson. Accuracy is the same rounded
// input accuracy the app shows, so a run displayed as 95% passes.
export const LESSON_ACCURACY = 95;
// About a minute of typing at the speed targets below.
export const LESSON_LENGTH = 60;
// A smaller pool of real words is topped up with key pairs, so a lesson never repeats a handful of words.
const MIN_WORDS = 20;
// Short, common words only: beginners are learning reaches, not spelling.
const MAX_WORD_LENGTH = 7;
const POOL_SIZE = 40;

// Each column of a QWERTY keyboard belongs to one finger; the thumbs share the space bar.
export const FINGER_ZONES = [
  { hand: 'left', finger: 'pinky', keys: ['q', 'a', 'z'] },
  { hand: 'left', finger: 'ring', keys: ['w', 's', 'x'] },
  { hand: 'left', finger: 'middle', keys: ['e', 'd', 'c'] },
  { hand: 'left', finger: 'index', keys: ['r', 'f', 'v', 't', 'g', 'b'] },
  { hand: 'right', finger: 'index', keys: ['y', 'h', 'n', 'u', 'j', 'm'] },
  { hand: 'right', finger: 'middle', keys: ['i', 'k'] },
  { hand: 'right', finger: 'ring', keys: ['o', 'l'] },
  { hand: 'right', finger: 'pinky', keys: ['p', ';'] },
];

export function fingerFor(key) {
  if (key === ' ') return 'thumbs';
  const zone = FINGER_ZONES.find((item) => item.keys.includes(key));
  return zone ? `${zone.hand} ${zone.finger}` : null;
}

// Home row first, then the reaches up, in and down. Speed targets stay gentle and rise slowly.
export const LESSONS = [
  { id: 'fj', keys: ['f', 'j'], wpm: 10, focus: 'Index fingers on the home row. Most keyboards have a small bump on f and j to find them by touch.' },
  { id: 'dk', keys: ['d', 'k'], wpm: 10, focus: 'Middle fingers on the home row.' },
  { id: 'sl', keys: ['s', 'l'], wpm: 10, focus: 'Ring fingers on the home row.' },
  { id: 'a-semicolon', keys: ['a', ';'], wpm: 10, focus: 'Pinkies on the home row. Every finger now has a home key.' },
  { id: 'ei', keys: ['e', 'i'], wpm: 12, focus: 'Middle fingers reach up, then return home.' },
  { id: 'ru', keys: ['r', 'u'], wpm: 12, focus: 'Index fingers reach up.' },
  { id: 'gh', keys: ['g', 'h'], wpm: 12, focus: 'Index fingers reach in toward the middle.' },
  { id: 'ty', keys: ['t', 'y'], wpm: 12, focus: 'Index fingers reach up and in.' },
  { id: 'wo', keys: ['w', 'o'], wpm: 14, focus: 'Ring fingers reach up.' },
  { id: 'qp', keys: ['q', 'p'], wpm: 14, focus: 'Pinkies reach up.' },
  { id: 'vm', keys: ['v', 'm'], wpm: 14, focus: 'Index fingers reach down.' },
  { id: 'bn', keys: ['b', 'n'], wpm: 14, focus: 'Index fingers reach down and in.' },
  { id: 'cx', keys: ['c', 'x'], wpm: 15, focus: 'Left middle and ring fingers reach down.' },
  { id: 'z', keys: ['z'], wpm: 15, focus: 'Left pinky reaches down. This is the last letter.' },
];

export const keysLabel = (keys) => (keys.length > 1 ? `${keys.slice(0, -1).join(', ')} and ${keys.at(-1)}` : keys[0]);

// Every key learned up to and including this lesson; index -1 is none.
export function lessonKeys(index) {
  return LESSONS.slice(0, Math.max(0, index + 1)).flatMap((lesson) => lesson.keys);
}

let ranked = null;
// All list words in frequency order: the 200 list first, then words new in 1k, 5k and 10k.
function rankedWords() {
  if (!ranked) ranked = [...new Set(wordListIds.flatMap((id) => wordList(id)))];
  return ranked;
}

// Real words from the lists that use only the letters learned so far, most common first.
export function lessonWords(index) {
  const letters = new Set(lessonKeys(index).filter((key) => /^[a-z]$/.test(key)));
  return rankedWords().filter((word) => word.length <= MAX_WORD_LENGTH && [...word].every((char) => letters.has(char)));
}

// Repetitions of the new keys alone, with each other, and with the most recently learned keys.
function keyPairs(keys, others) {
  const pairs = keys.map((key) => key + key);
  for (const a of keys) for (const b of keys) if (a !== b) pairs.push(a + b);
  for (const a of keys) for (const b of others.slice(-4)) pairs.push(a + b, b + a);
  return pairs;
}

function pick(items, random, previous) {
  let index = Math.floor(random() * items.length) % items.length;
  if (items[index] === previous && items.length > 1) index = (index + 1) % items.length;
  return items[index];
}

function lessonPlan(index) {
  const lesson = LESSONS[index];
  const pool = lessonWords(index);
  // The most common words for each new key, so a rarer letter such as x still gets its share.
  const byKey = lesson.keys.map((key) => pool.filter((word) => word.includes(key)).slice(0, Math.ceil(POOL_SIZE / lesson.keys.length)));
  const focus = [...new Set(byKey.flat())];
  const review = pool.filter((word) => !lesson.keys.some((key) => word.includes(key))).slice(0, POOL_SIZE);
  // Keys that real words can't practise yet, such as ; or a letter only one or two words contain.
  const thin = lesson.keys.filter((_, i) => byKey[i].length < 3);
  return { lesson, byKey, focus, review, pairKeys: pool.length < MIN_WORDS ? lesson.keys : thin };
}

// What a lesson is made of: key pairs only, key pairs then words, or words only.
export function lessonMakeup(index) {
  const { focus, pairKeys } = lessonPlan(index);
  if (!focus.length) return 'pairs';
  return pairKeys.length ? 'mixed' : 'words';
}

export function lessonPassage(index, random = Math.random) {
  const { lesson, byKey, focus, review, pairKeys } = lessonPlan(index);
  const items = [];
  const length = () => items.join(' ').length;
  if (pairKeys.length) {
    const learned = lessonKeys(index).filter((key) => !pairKeys.includes(key));
    const pairs = keyPairs(pairKeys, learned);
    const budget = focus.length ? LESSON_LENGTH / 2 : LESSON_LENGTH;
    // Each new key on its own first, then a random mix.
    items.push(...pairs.slice(0, pairKeys.length));
    while (length() < budget) items.push(pick(pairs, random, items.at(-1)));
  }
  const pairCount = items.length;
  // A word for each new key first, so none is left out, then roughly two such words per review word.
  for (const list of byKey) if (list.length) items.push(pick(list, random, items.at(-1)));
  while (focus.length && length() < LESSON_LENGTH) {
    const source = review.length && (items.length - pairCount) % 3 === 2 ? review : focus;
    items.push(pick(source, random, items.at(-1)));
  }
  const text = items.join(' ');
  return {
    id: `lesson-${lesson.id}-${textId(text)}`,
    textVersion: `lesson-${lesson.id}@${LESSON_VERSION}`,
    text,
    lessonId: lesson.id,
    index,
    pairs: pairCount,
    words: items.length - pairCount,
    corpus: CORPUS_VERSION,
    difficulty: 'lesson',
    fresh: true,
  };
}

// The label for a lesson's text, before it is drawn (index) or for a drawn passage (with counts).
// Beside a drawn passage the label stays short, so the finger map under it stays in view.
export function makeupCopy(index, passage = null) {
  const makeup = lessonMakeup(index);
  const words = passage?.words ? `${passage.words} real words` : 'real words';
  if (makeup === 'pairs') return `Key pairs only (repetitions, not words)${passage ? '.' : ': no word in the common-word lists uses just these keys yet.'}`;
  if (makeup === 'mixed') return `Key pairs first (repetitions, not words), then ${words}${passage ? '.' : ' from the common-word lists.'}`;
  return `${words[0].toUpperCase()}${words.slice(1)} from the common-word lists, using only keys you’ve learned.`;
}

export function makeupShort(index, passage = null) {
  const makeup = lessonMakeup(index);
  const words = passage?.words ? `${passage.words} real words` : 'real words';
  return makeup === 'pairs' ? 'key pairs' : makeup === 'mixed' ? `key pairs + ${words}` : words;
}

export function lessonOutcome(index, score) {
  const wpmTarget = LESSONS[index].wpm;
  const accuracyMet = score.accuracy >= LESSON_ACCURACY;
  const speedMet = score.wpm >= wpmTarget;
  return { accuracyMet, speedMet, passed: accuracyMet && speedMet, accuracyTarget: LESSON_ACCURACY, wpmTarget };
}

// The first lesson not yet passed; LESSONS.length once every letter is in.
export function nextLessonIndex(progress = {}) {
  const index = LESSONS.findIndex((lesson) => !progress[lesson.id]?.passed);
  return index < 0 ? LESSONS.length : index;
}

export const lessonsComplete = (progress) => nextLessonIndex(progress) >= LESSONS.length;
export const lessonsStarted = (progress = {}) => Object.keys(progress).length > 0;
export const lessonUnlocked = (progress, index) => index >= 0 && index < LESSONS.length && index <= nextLessonIndex(progress);

const PHYSICAL = 'physical-keyboard';

// Records from before input classes were stored are physical-keyboard runs.
function scoreRecord(value) {
  if (!value || typeof value !== 'object' || !Number.isFinite(value.wpm) || !Number.isFinite(value.accuracy)) return null;
  return { wpm: value.wpm, accuracy: value.accuracy, at: typeof value.at === 'string' ? value.at : null, inputClass: value.inputClass === 'touch' ? 'touch' : PHYSICAL };
}

const physicalOnly = (record) => (record?.inputClass === PHYSICAL ? record : null);

// Old profiles have no lesson field; anything unrecognised is dropped rather than trusted.
export function normalizeLessonProgress(value) {
  const progress = {};
  if (!value || typeof value !== 'object') return progress;
  for (const lesson of LESSONS) {
    const entry = value[lesson.id];
    if (!entry || typeof entry !== 'object') continue;
    progress[lesson.id] = {
      tries: Number.isInteger(entry.tries) && entry.tries > 0 ? entry.tries : 0,
      last: scoreRecord(entry.last),
      passed: physicalOnly(scoreRecord(entry.passed)),
    };
  }
  return progress;
}

// Records one completed, uninterrupted run of an unlocked lesson; a locked one is not recorded. The first
// physical-keyboard run that passes is kept as the pass. A touch run counts as a try, labelled, and never
// passes or unlocks, whatever its numbers.
export function recordLessonRun(progress, index, score, at = new Date().toISOString(), inputClass = PHYSICAL) {
  if (!lessonUnlocked(progress, index)) return { progress, outcome: null, firstPass: false, recorded: false };
  const lesson = LESSONS[index];
  const outcome = lessonOutcome(index, score);
  const previous = progress[lesson.id] || { tries: 0, last: null, passed: null };
  const record = { wpm: score.wpm, accuracy: score.accuracy, at, inputClass: inputClass === 'touch' ? 'touch' : PHYSICAL };
  const passes = outcome.passed && record.inputClass === PHYSICAL;
  const entry = { tries: previous.tries + 1, last: record, passed: previous.passed || (passes ? record : null) };
  return { progress: { ...progress, [lesson.id]: entry }, outcome, firstPass: passes && !previous.passed, recorded: true };
}

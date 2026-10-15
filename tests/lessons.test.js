import test from 'node:test';
import assert from 'node:assert/strict';
import { CORPUS_VERSION, METRIC_VERSION, comparable, completeAttempt, conditionKey, createAttempt, metrics, summarizePatterns } from '../src/typing.js';
import { recurringTargets, trendRun } from '../src/insights.js';
import { wordList, wordListIds } from '../src/words.js';
import {
  FINGER_ZONES, LESSONS, LESSON_ACCURACY, LESSON_LENGTH, fingerFor, lessonKeys, lessonMakeup, lessonOutcome, lessonPassage,
  lessonUnlocked, lessonWords, lessonsComplete, makeupCopy, nextLessonIndex, normalizeLessonProgress, recordLessonRun,
} from '../src/lessons.js';

const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const listWords = new Set(wordListIds.flatMap((id) => wordList(id)));
const words = (passage) => passage.text.split(' ');

test('lessons introduce keys a few at a time, home row first, until every letter is in', () => {
  assert.deepEqual(LESSONS.slice(0, 8).map((lesson) => lesson.keys.join(' ')), ['f j', 'd k', 's l', 'a ;', 'e i', 'r u', 'g h', 't y']);
  const letters = LESSONS.flatMap((lesson) => lesson.keys).filter((key) => /[a-z]/.test(key));
  assert.equal(new Set(letters).size, letters.length, 'each letter is introduced once');
  assert.deepEqual([...letters].sort().join(''), 'abcdefghijklmnopqrstuvwxyz');
  for (const lesson of LESSONS) assert.ok(lesson.keys.length <= 2 && lesson.wpm >= 10 && lesson.wpm <= 15, lesson.id);
  assert.equal(new Set(LESSONS.map((lesson) => lesson.id)).size, LESSONS.length);
});

test('the finger map gives every lesson key exactly one finger', () => {
  const mapped = FINGER_ZONES.flatMap((zone) => zone.keys);
  assert.equal(new Set(mapped).size, mapped.length);
  for (const key of LESSONS.flatMap((lesson) => lesson.keys)) assert.ok(mapped.includes(key), key);
  assert.equal(fingerFor('f'), 'left index');
  assert.equal(fingerFor('j'), 'right index');
  assert.equal(fingerFor(';'), 'right pinky');
  assert.equal(fingerFor(' '), 'thumbs');
});

test('lesson words are real list words made only of learned letters', () => {
  for (let index = 0; index < LESSONS.length; index += 1) {
    const allowed = new Set(lessonKeys(index));
    for (const word of lessonWords(index)) {
      assert.ok(listWords.has(word), `${word} is in a word list`);
      assert.ok([...word].every((char) => allowed.has(char)), `${word} uses only lesson ${index + 1} keys`);
    }
  }
  // Nothing real is spelled with the first home-row keys alone, so those lessons are pairs only.
  assert.deepEqual([0, 1, 2].map((index) => lessonWords(index).length), [0, 0, 0]);
  assert.ok(lessonWords(3).includes('salad'));
});

test('early lessons are labelled key pairs, then a mix, then real words only', () => {
  assert.deepEqual(LESSONS.map((_, index) => lessonMakeup(index)).slice(0, 5), ['pairs', 'pairs', 'pairs', 'mixed', 'words']);
  assert.match(makeupCopy(0), /^Key pairs only \(repetitions, not words\)/);
  assert.match(makeupCopy(3), /^Key pairs first \(repetitions, not words\), then real words/);
  assert.match(makeupCopy(4), /^Real words from the common-word lists/);

  const first = lessonPassage(0, seeded());
  // Beside a drawn passage the label stays short but still says what the passage is.
  assert.equal(makeupCopy(0, first), 'Key pairs only (repetitions, not words).');
  assert.match(makeupCopy(3, lessonPassage(3, seeded())), /^Key pairs first \(repetitions, not words\), then \d+ real words\.$/);
  assert.equal(first.words, 0);
  assert.ok(first.pairs > 0);
  assert.ok(words(first).every((item) => /^[fj]{2}$/.test(item)), first.text);

  const mixed = lessonPassage(3, seeded());
  assert.ok(mixed.pairs > 0 && mixed.words > 0);
  const tokens = words(mixed);
  const allowed = new Set(lessonKeys(3));
  tokens.slice(0, mixed.pairs).forEach((pair) => {
    assert.equal(pair.length, 2);
    assert.ok([...pair].every((char) => allowed.has(char)) && /[a;]/.test(pair), pair);
  });
  tokens.slice(mixed.pairs).forEach((word) => assert.ok(listWords.has(word), word));
  assert.ok(mixed.text.includes(';'));
});

test('every lesson passage is about a minute long, uses only learned keys and practises the new ones', () => {
  for (let index = 0; index < LESSONS.length; index += 1) {
    const passage = lessonPassage(index, seeded(index + 3));
    const allowed = new Set([...lessonKeys(index), ' ']);
    assert.ok(passage.text.length >= LESSON_LENGTH && passage.text.length < LESSON_LENGTH + 12, `${index}: ${passage.text}`);
    assert.ok([...passage.text].every((char) => allowed.has(char)), `${index}: ${passage.text}`);
    for (const key of LESSONS[index].keys) assert.ok(passage.text.includes(key), `${index} practises ${key}`);
    assert.equal(passage.words + passage.pairs, words(passage).length);
    words(passage).slice(passage.pairs).forEach((word) => assert.ok(listWords.has(word), `${index}: ${word}`));
    assert.equal(passage.corpus, CORPUS_VERSION);
  }
  assert.equal(lessonPassage(5, seeded(1)).text, lessonPassage(5, seeded(1)).text, 'seeded passages are deterministic');
});

test('one run at 95% accuracy and the speed target unlocks the next lesson', () => {
  assert.equal(LESSON_ACCURACY, 95);
  assert.deepEqual(lessonOutcome(0, { wpm: 10, accuracy: 95 }), { accuracyMet: true, speedMet: true, passed: true, accuracyTarget: 95, wpmTarget: 10 });
  assert.equal(lessonOutcome(0, { wpm: 40, accuracy: 94 }).passed, false);
  assert.equal(lessonOutcome(0, { wpm: 9, accuracy: 100 }).passed, false);
  // A lesson passes on the numbers it shows: 69 of 73 insertions (94.5%) shows and passes as 95%;
  // 68 of 72 (94.4%) shows 94% and does not.
  const shown = (attempts, mistakes) => metrics('x', 'x', attempts, mistakes, 60000);
  assert.equal(shown(73, 4).accuracy, 95);
  assert.equal(lessonOutcome(0, { ...shown(73, 4), wpm: 10 }).accuracyMet, true);
  assert.equal(shown(72, 4).accuracy, 94);
  assert.equal(lessonOutcome(0, { ...shown(72, 4), wpm: 10 }).accuracyMet, false);

  let progress = {};
  assert.equal(nextLessonIndex(progress), 0);
  assert.equal(lessonUnlocked(progress, 1), false);
  // A locked lesson can't be recorded, let alone passed.
  assert.equal(recordLessonRun(progress, 1, { wpm: 50, accuracy: 100 }).outcome, null);

  let result = recordLessonRun(progress, 0, { wpm: 30, accuracy: 90 }, 'a');
  progress = result.progress;
  assert.equal(result.outcome.passed, false);
  assert.deepEqual(progress.fj, { tries: 1, last: { wpm: 30, accuracy: 90, at: 'a', inputClass: 'physical-keyboard' }, passed: null });
  assert.equal(nextLessonIndex(progress), 0);

  result = recordLessonRun(progress, 0, { wpm: 12, accuracy: 96 }, 'b');
  progress = result.progress;
  assert.equal(result.firstPass, true);
  assert.deepEqual(progress.fj.passed, { wpm: 12, accuracy: 96, at: 'b', inputClass: 'physical-keyboard' });
  assert.equal(nextLessonIndex(progress), 1);
  assert.equal(lessonUnlocked(progress, 1), true);

  // Repeating a passed lesson badly keeps the pass.
  result = recordLessonRun(progress, 0, { wpm: 5, accuracy: 70 }, 'c');
  assert.equal(result.firstPass, false);
  assert.deepEqual(result.progress.fj.passed, { wpm: 12, accuracy: 96, at: 'b', inputClass: 'physical-keyboard' });
  assert.equal(result.progress.fj.tries, 3);
});

test('a touch run is a labelled try that never passes or unlocks a lesson', () => {
  // Numbers that pass on a physical keyboard.
  let result = recordLessonRun({}, 0, { wpm: 30, accuracy: 100 }, 'a', 'touch');
  assert.equal(result.recorded, true);
  assert.equal(result.outcome.passed, true);
  assert.equal(result.firstPass, false);
  assert.deepEqual(result.progress.fj, { tries: 1, last: { wpm: 30, accuracy: 100, at: 'a', inputClass: 'touch' }, passed: null });
  assert.equal(nextLessonIndex(result.progress), 0);
  assert.equal(lessonUnlocked(result.progress, 1), false);

  // The same numbers on a physical keyboard pass; a later touch try is labelled and leaves the pass alone.
  result = recordLessonRun(result.progress, 0, { wpm: 30, accuracy: 100 }, 'b');
  assert.equal(result.firstPass, true);
  assert.equal(nextLessonIndex(result.progress), 1);
  result = recordLessonRun(result.progress, 0, { wpm: 40, accuracy: 100 }, 'c', 'touch');
  assert.deepEqual(result.progress.fj, {
    tries: 3, last: { wpm: 40, accuracy: 100, at: 'c', inputClass: 'touch' }, passed: { wpm: 30, accuracy: 100, at: 'b', inputClass: 'physical-keyboard' },
  });
  // Touch never reaches past the physical progress either.
  assert.equal(recordLessonRun(result.progress, 2, { wpm: 40, accuracy: 100 }, 'd', 'touch').recorded, false);
});

test('progress is complete once every lesson is passed, and old or damaged profiles normalise safely', () => {
  const all = Object.fromEntries(LESSONS.map((lesson) => [lesson.id, { tries: 1, last: { wpm: 20, accuracy: 99, at: null }, passed: { wpm: 20, accuracy: 99, at: null } }]));
  assert.equal(lessonsComplete(all), true);
  assert.equal(nextLessonIndex(all), LESSONS.length);
  assert.deepEqual(normalizeLessonProgress(undefined), {});
  assert.deepEqual(normalizeLessonProgress('junk'), {});
  assert.deepEqual(normalizeLessonProgress({ fj: { tries: -2, last: { wpm: 'fast' }, passed: { wpm: 11, accuracy: 97 } }, nope: { tries: 3 } }),
    { fj: { tries: 0, last: null, passed: { wpm: 11, accuracy: 97, at: null, inputClass: 'physical-keyboard' } } });
  // Records saved before input classes were stored are physical-keyboard runs; a touch pass is never trusted.
  assert.deepEqual(normalizeLessonProgress({
    fj: { tries: 2, last: { wpm: 14, accuracy: 98, at: 'x' }, passed: { wpm: 12, accuracy: 96, at: 'w' } },
    dk: { tries: 1, last: { wpm: 20, accuracy: 99, at: 'y', inputClass: 'touch' }, passed: { wpm: 20, accuracy: 99, at: 'y', inputClass: 'touch' } },
  }), {
    fj: { tries: 2, last: { wpm: 14, accuracy: 98, at: 'x', inputClass: 'physical-keyboard' }, passed: { wpm: 12, accuracy: 96, at: 'w', inputClass: 'physical-keyboard' } },
    dk: { tries: 1, last: { wpm: 20, accuracy: 99, at: 'y', inputClass: 'touch' }, passed: null },
  });
});

test('lesson runs never become pattern evidence, comparisons, trends or recurring targets', () => {
  const lessonConditions = { mode: 'lesson', lesson: 'ei', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
  const typed = (id, kind) => {
    const text = 'like life feel side';
    const attempt = createAttempt({ id, text, textId: `t-${id}`, kind, conditions: lessonConditions });
    attempt.events = [...text].map((char, i) => ({ type: 'insert', text: char === 'f' ? 'x' : char, position: i, accepted: true, offsetMs: i * 150 }));
    return completeAttempt(attempt, { endedAt: text.length * 150 });
  };
  const lesson = typed('l1', 'lesson');
  assert.equal(summarizePatterns([lesson]).attemptCount, 0);
  assert.equal(summarizePatterns([typed('t1', 'test')]).attemptCount, 1);
  assert.equal(comparable(lesson, typed('l2', 'lesson')), false);
  assert.equal(trendRun({ status: 'complete', kind: 'lesson' }), false);
  const runs = ['a', 'b'].map((id) => ({ id, kind: 'lesson', status: 'complete', conditions: lessonConditions, patterns: [['fe', 20, 5, 10, 200, 40]] }));
  assert.deepEqual(recurringTargets(runs, [], lessonConditions), []);
});

test('practice condition keys are unchanged by the lesson kind', () => {
  // The default practice key, byte for byte as on master, so existing bests and retests still match.
  const practice = { mode: 'time', duration: 30, count: null, punctuation: false, quoteLength: null, difficulty: null, wordList: '200',
    inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
  assert.equal(conditionKey(practice), `time:30::plain:::200:physical-keyboard:relaxed:${CORPUS_VERSION}:${METRIC_VERSION}`);
  assert.notEqual(conditionKey({ ...practice, mode: 'lesson', duration: null, wordList: null, lesson: 'fj' }), conditionKey(practice));
});

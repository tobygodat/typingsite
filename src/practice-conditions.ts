import type { LearningStore } from './learning-store.js';
import type { Conditions, InputClass, Minimums } from './typing.js';
import { CORPUS_VERSION, METRIC_VERSION, standardConditions } from './typing.js';
import { BOOK_VERSION } from './books.js';
import { DEFAULT_LAYOUT } from './layouts.js';
import { LESSONS } from './lessons.js';

export function createPracticeConditions(learning: LearningStore, lessonIndex: () => number) {
  function currentLesson() {
    const lesson = LESSONS[lessonIndex()];

    if (!lesson) throw new Error('No current lesson');

    return lesson;
  }

function settingsConditions(inputClass: InputClass = 'physical-keyboard'): Conditions {
  const value: Conditions = {
    mode: learning.preferences.mode,
    duration: learning.preferences.mode === 'time' ? learning.preferences.duration : null,
    count: learning.preferences.mode === 'words' ? learning.preferences.count : null,
    punctuation: learning.preferences.mode === 'code' || learning.preferences.mode === 'book' || learning.preferences.punctuation,
    numbers: ['quote', 'code', 'book'].some((mode) => mode === learning.preferences.mode) ? false : Boolean(learning.preferences.numbers),
    quoteLength: learning.preferences.mode === 'quote' ? learning.preferences.quoteLength : null,
    difficulty: learning.preferences.mode === 'quote' ? learning.preferences.difficulty : null,
    wordList: ['quote', 'code', 'book'].some((mode) => mode === learning.preferences.mode) ? null : learning.preferences.wordList,
  };

  if (learning.preferences.mode === 'code') value.codeLanguage = learning.preferences.codeLanguage;

  if (learning.preferences.mode === 'book') value.book = learning.preferences.book;

  return Object.assign(value, {
    inputClass,
    layout: inputLayout(inputClass),
    correctionPolicy: learning.preferences.correction,
    strictSpace: learning.preferences.strictSpace,
    quickEnd: learning.preferences.quickEnd,
    language: 'en',
    corpus: learning.preferences.mode === 'book' ? BOOK_VERSION : CORPUS_VERSION,
    metricVersion: METRIC_VERSION,
  });
}

function conditions(inputClass: InputClass = 'physical-keyboard'): Conditions {
  return learning.preferences.mode === 'standard' ? { ...standardConditions(inputClass), layout: inputLayout(inputClass) } : settingsConditions(inputClass);
}

function customConditions() {
  const { codeLanguage, book, ...base } = settingsConditions();

  return { ...base, mode: 'custom', duration: null, count: null, punctuation: false, numbers: false, corpus: CORPUS_VERSION,
    quoteLength: null, difficulty: null, wordList: null, layout: DEFAULT_LAYOUT, strictSpace: false, quickEnd: true, customOrder: learning.preferences.customOrder };
}

function practiceMinimums() {
  if (learning.preferences.mode === 'standard' || learning.preferences.mode === 'code') return null;
  const minimums: Minimums = {};

  if (learning.preferences.minAccuracy) minimums.accuracy = learning.preferences.minAccuracy;

  if (learning.preferences.minWpm) minimums.wpm = learning.preferences.minWpm;

  return Object.keys(minimums).length ? minimums : null;
}

function inputLayout(inputClass: string) {
  return inputClass === 'touch' ? DEFAULT_LAYOUT : learning.preferences.layout;
}

function lessonConditions(): Conditions {
  return {
    mode: 'lesson', lesson: currentLesson().id, duration: null, count: null, punctuation: false, numbers: false,
    quoteLength: null, difficulty: null, wordList: null, inputClass: 'physical-keyboard',
    correctionPolicy: conditions().correctionPolicy, language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION,
  };
}

function dailyConditions(): Conditions {
  return { ...settingsConditions(), mode: 'quote', duration: null, count: null, punctuation: true, numbers: false,
    quoteLength: 'medium', difficulty: 'any', wordList: null, correctionPolicy: 'relaxed', strictSpace: false, quickEnd: true, corpus: CORPUS_VERSION };
}

return { dailyConditions, settingsConditions, conditions, customConditions, practiceMinimums, inputLayout, lessonConditions };
}

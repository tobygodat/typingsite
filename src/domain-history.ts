import { isRecord } from './domain-values.js';
import type { Attempt, AttemptEvent, Conditions, Replay, Score } from './typing.js';
import type { RunRecord, TrainingLoop } from './profile-types.js';

export function isScore(value: unknown): value is Score {
  return isRecord(value) && typeof value.wpm === 'number' && typeof value.accuracy === 'number';
}

export function isConditions(value: unknown): value is Conditions {
  if (!isRecord(value)) return false;
  const strings = ['mode', 'quoteLength', 'difficulty', 'wordList', 'inputClass', 'correctionPolicy', 'language', 'corpus', 'metricVersion', 'recipe', 'layout', 'codeLanguage', 'book', 'customOrder', 'lesson'];
  const numbers = ['duration', 'count'];
  const booleans = ['punctuation', 'numbers', 'strictSpace', 'quickEnd', 'onlineRace'];

  return strings.every((key) => value[key] === undefined || value[key] === null || typeof value[key] === 'string')
    && numbers.every((key) => value[key] === undefined || value[key] === null || typeof value[key] === 'number')
    && booleans.every((key) => value[key] === undefined || typeof value[key] === 'boolean');
}

export function isAttemptEvent(value: unknown): value is AttemptEvent {
  if (!isRecord(value) || typeof value.offsetMs !== 'number') return false;

  if (value.type === 'insert' || value.type === 'blocked-insert') return typeof value.text === 'string'
    && (value.position === undefined || typeof value.position === 'number') && (value.accepted === undefined || typeof value.accepted === 'boolean');

  if (value.type === 'delete') return value.count === undefined || typeof value.count === 'number';

  return value.type === 'focus-lost' || value.type === 'focus' || value.type === 'focus-returned' || value.type === 'composition' || value.type === 'submit';
}

export function replaySource(value: unknown) {
  const record = isRecord(value) ? value : {};

  return {
    text: typeof record.text === 'string' ? record.text : '',
    events: Array.isArray(record.events) ? record.events.filter(isAttemptEvent) : [],
    startedAt: typeof record.startedAt === 'number' ? record.startedAt : null,
    endedAt: typeof record.endedAt === 'number' ? record.endedAt : null,
  };
}

function isReplay(value: unknown): value is Replay {
  if (!isRecord(value) || typeof value.typed !== 'string' || !isScore(value.score)
    || !['insertions', 'correctInsertions', 'mistakes', 'elapsedMs'].every((key) => typeof value[key] === 'number')) return false;

  return Array.isArray(value.firstAttempts) && value.firstAttempts.every((item: unknown) => isRecord(item)
    && typeof item.position === 'number' && (typeof item.expected === 'string' || item.expected === undefined)
    && typeof item.actual === 'string' && typeof item.correct === 'boolean' && typeof item.offsetMs === 'number')
    && Array.isArray(value.pairTimings) && value.pairTimings.every((item: unknown) => isRecord(item)
      && typeof item.pair === 'string' && typeof item.durationMs === 'number' && typeof item.position === 'number');
}

export function isAttempt(value: unknown): value is Attempt {
  return isRecord(value) && typeof value.id === 'string' && typeof value.eventVersion === 'string' && typeof value.metricVersion === 'string'
    && typeof value.kind === 'string' && typeof value.text === 'string' && typeof value.textId === 'string' && isConditions(value.conditions)
    && typeof value.status === 'string' && Array.isArray(value.events) && value.events.every(isAttemptEvent) && typeof value.typed === 'string'
    && (value.startedAt === null || typeof value.startedAt === 'number') && (value.endedAt === null || typeof value.endedAt === 'number')
    && typeof value.interrupted === 'boolean' && typeof value.unsupportedInput === 'boolean' && (value.summary === undefined || isReplay(value.summary));
}

export function isRunRecord(value: unknown): value is RunRecord {
  return isRecord(value) && typeof value.id === 'string' && (value.at === null || typeof value.at === 'string')
    && typeof value.kind === 'string' && typeof value.status === 'string' && isConditions(value.conditions) && typeof value.textId === 'string'
    && typeof value.interrupted === 'boolean' && isScore(value.score) && typeof value.elapsedMs === 'number' && typeof value.errors === 'number'
    && (value.target === null || typeof value.target === 'string');
}

export function isTrainingLoop(value: unknown): value is TrainingLoop {
  return isRecord(value) && typeof value.id === 'string' && typeof value.at === 'string' && isConditions(value.conditions)
    && (value.target === null || typeof value.target === 'string') && typeof value.beforeAttemptId === 'string' && typeof value.afterAttemptId === 'string';
}

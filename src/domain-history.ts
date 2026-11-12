import { isRecord } from './domain-values.js';
import type { Attempt, AttemptEvent, Conditions, Replay, Score } from './typing.js';
import type { RunRecord, TrainingLoop, HistoricalRecord } from './profile-types.js';

export function isScore(value: unknown): value is Score {
  return isRecord(value) && typeof value.wpm === 'number' && typeof value.accuracy === 'number';
}

export function isConditions(value: unknown): value is Conditions {
  if (!isRecord(value)) return false;

  return optional(value, ['mode'], (mode) => typeof mode === 'string' && ['time', 'words', 'quote', 'standard', 'code', 'book', 'custom', 'lesson'].includes(mode))
    && optional(value, ['inputClass'], (input) => input === 'physical-keyboard' || input === 'touch')
    && optional(value, ['correctionPolicy'], (policy) => typeof policy === 'string' && ['relaxed', 'mandatory', 'no-backspace', 'fail-word', 'fail-any'].includes(policy))
    && optional(value, ['quoteLength', 'difficulty', 'wordList'], nullableString)
    && optional(value, ['language', 'corpus', 'metricVersion', 'recipe', 'layout', 'codeLanguage', 'book', 'customOrder', 'lesson'], string)
    && optional(value, ['duration', 'count'], nullableNumber)
    && optional(value, ['punctuation', 'numbers', 'strictSpace', 'quickEnd', 'onlineRace'], boolean);
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

function isKind(value: unknown) {
  return typeof value === 'string' && ['test', 'drill', 'missed', 'race', 'lesson', 'challenge', 'retest', 'daily', 'custom'].includes(value);
}

function isStatus(value: unknown) {
  return value === 'ready' || value === 'running' || value === 'complete' || value === 'interrupted';
}

function isMinimums(value: unknown) {
  return isRecord(value) && optional(value, ['accuracy', 'wpm'], number);
}

function isStop(value: unknown) {
  return isRecord(value) && (value.metric === 'accuracy' || value.metric === 'wpm') && typeof value.minimum === 'number'
    && typeof value.value === 'number' && (value.atEnd === undefined || value.atEnd === true);
}

function runtimeMetadata(value: HistoricalRecord) {
  return optional(value, ['minimums'], (minimums) => minimums === null || isMinimums(minimums)) && optional(value, ['stopped'], isStop);
}

export function isAttempt(value: unknown): value is Attempt {
  return isRecord(value) && typeof value.id === 'string' && typeof value.eventVersion === 'string' && typeof value.metricVersion === 'string'
    && isKind(value.kind) && typeof value.text === 'string' && typeof value.textId === 'string' && isConditions(value.conditions)
    && isStatus(value.status) && Array.isArray(value.events) && value.events.every(isAttemptEvent) && typeof value.typed === 'string'
    && (value.startedAt === null || typeof value.startedAt === 'number') && (value.endedAt === null || typeof value.endedAt === 'number')
    && typeof value.interrupted === 'boolean' && typeof value.unsupportedInput === 'boolean' && optional(value, ['summary'], isReplay)
    && optional(value, ['fresh', 'dailyFirst', 'firstDailyAttempt', 'adaptive'], boolean)
    && optional(value, ['at', 'failed', 'target', 'challengeDate'], nullableString)
    && optional(value, ['challengeId', 'trainFocus', 'dailyDate', 'textVersion'], string) && optional(value, ['drillSeconds'], number)
    && optional(value, ['lesson'], (lesson) => isRecord(lesson) && typeof lesson.id === 'string' && typeof lesson.index === 'number' && typeof lesson.pairs === 'number' && typeof lesson.words === 'number')
    && runtimeMetadata(value);
}

export function isRunRecord(value: unknown): value is RunRecord {
  return isRecord(value) && isAnalysisRun(value) && typeof value.id === 'string' && (value.at === null || typeof value.at === 'string')
    && isKind(value.kind) && isStatus(value.status) && isConditions(value.conditions) && typeof value.textId === 'string'
    && typeof value.interrupted === 'boolean' && isScore(value.score) && typeof value.elapsedMs === 'number' && typeof value.errors === 'number'
    && (value.target === null || typeof value.target === 'string') && runtimeMetadata(value);
}

export function isTrainingLoop(value: unknown): value is TrainingLoop {
  return isRecord(value) && isAnalysisLoop(value) && typeof value.id === 'string' && typeof value.at === 'string' && isConditions(value.conditions)
    && (value.target === null || typeof value.target === 'string') && typeof value.beforeAttemptId === 'string' && typeof value.afterAttemptId === 'string'
    && optional(value, ['inputClass'], (input) => input === 'physical-keyboard' || input === 'touch')
    && optional(value, ['minimums'], isMinimums) && optional(value, ['comparison'], isComparison);
}

function isComparison(value: unknown) {
  if (!isRecord(value) || typeof value.reason !== 'string') return false;

  return value.comparable === false ? value.state === 'not-comparable' : value.comparable === true && typeof value.state === 'string'
    && ['mixed', 'improved', 'regressed', 'steady'].includes(value.state) && typeof value.wpmDelta === 'number' && typeof value.accuracyDelta === 'number'
    && isScore(value.before) && isScore(value.after);
}

function optional(value: Record<string, unknown>, keys: string[], accepts: (value: unknown) => boolean) {
  return keys.every((key) => value[key] === undefined || accepts(value[key]));
}

const string = (value: unknown): value is string => typeof value === 'string';
const number = (value: unknown): value is number => typeof value === 'number';
const boolean = (value: unknown): value is boolean => typeof value === 'boolean';
const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';
const nullableNumber = (value: unknown): value is number | null => value === null || typeof value === 'number';

export function isAnalysisRun(value: unknown): value is import('./profile-types.js').AnalysisRun {
  if (!isRecord(value)) return false;

  return optional(value, ['id', 'kind', 'status', 'textId'], string)
    && optional(value, ['at', 'day', 'target', 'challengeDate'], nullableString)
    && optional(value, ['fresh', 'interrupted', 'firstDailyAttempt', 'adaptive'], boolean)
    && optional(value, ['elapsedMs', 'errors', 'drillSeconds', 'keysVersion'], number)
    && optional(value, ['conditions'], isRecord) && optional(value, ['score'], isScore)
    && optional(value, ['keys'], (keys) => Array.isArray(keys) && keys.every((key: unknown) => Array.isArray(key) && key.length === 3 && typeof key[0] === 'string' && typeof key[1] === 'number' && typeof key[2] === 'number'))
    && optional(value, ['patterns'], (patterns) => Array.isArray(patterns) && patterns.every((row: unknown) => Array.isArray(row) && row.length === 6 && typeof row[0] === 'string'
      && typeof row[1] === 'number' && typeof row[2] === 'number' && typeof row[3] === 'number' && nullableNumber(row[4]) && nullableNumber(row[5])))
    && optional(value, ['corrections'], (corrections) => Array.isArray(corrections) && corrections.length === 2 && typeof corrections[0] === 'number' && nullableNumber(corrections[1]))
    && optional(value, ['missedWords'], (words) => Array.isArray(words) && words.every(string));
}

export function isScoredRun(value: unknown): value is import('./profile-types.js').ScoredRun {
  return isAnalysisRun(value) && isScore(value.score);
}

export function analysisRuns(values: readonly unknown[]) {
  return values.filter(isAnalysisRun);
}

export function isAnalysisLoop(value: unknown): value is import('./profile-types.js').AnalysisLoop {
  if (!isRecord(value)) return false;

  return optional(value, ['id', 'at', 'afterAttemptId', 'drillAttemptId'], string)
    && optional(value, ['beforeAttemptId', 'target'], nullableString)
    && optional(value, ['conditions'], isRecord)
    && optional(value, ['targetBasis'], (basis) => basis === 'slow' || basis === 'errors')
    && optional(value, ['drillCompleted'], boolean)
    && optional(value, ['targetMisses'], (counts) => counts === null || (isRecord(counts) && isTargetCounts(counts.was) && isTargetCounts(counts.now)))
    && optional(value, ['targetPace'], (pace) => pace === null || (isRecord(pace) && isTargetPace(pace.was) && isTargetPace(pace.now)));
}

function isTargetPace(value: unknown) {
  return isRecord(value) && typeof value.slowMs === 'number' && optional(value, ['timed', 'timedRuns', 'slowRuns'], number);
}

function isTargetCounts(value: unknown): value is { errors: number; observations: number } {
  return isRecord(value) && typeof value.errors === 'number' && typeof value.observations === 'number';
}

export function analysisLoops(values: readonly unknown[]) {
  return values.filter(isAnalysisLoop);
}

export interface PatternAttempt {
  text: string; events?: AttemptEvent[]; startedAt?: number | null; endedAt?: number | null;
  status?: string; kind?: string; interrupted?: boolean; fresh?: boolean; conditions?: Conditions | HistoricalRecord; summary?: Replay;
}

export function isPatternAttempt(value: unknown): value is PatternAttempt {
  return isRecord(value) && typeof value.text === 'string'
    && optional(value, ['status', 'kind'], string) && optional(value, ['interrupted', 'fresh'], boolean)
    && optional(value, ['startedAt', 'endedAt'], nullableNumber) && optional(value, ['conditions'], isRecord)
    && optional(value, ['summary'], isReplay) && optional(value, ['events'], (events) => Array.isArray(events) && events.every(isAttemptEvent));
}

import * as account from './account.js';
import { CORPUS_VERSION, STANDARD_VERSION, conditionKey } from './typing.js';
import { DEFAULT_POLICY, recommendFor } from './learner.js';
import type { ConditionLabelSource } from './insights.js';
import type { HistoricalRecord, HistoricalTrace } from './profile-types.js';
import type { LearningStore } from './learning-store.js';
import type { PracticeSession } from './practice-session.js';
import type { TrainingMemory } from './training-memory.js';

interface HistoryPorts { running(): boolean; forgetTraining(): void }

function hasFields(value: unknown): value is HistoricalRecord {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function fields(value: unknown) {
  if (value === null || value === undefined) throw new TypeError('Historical conditions are absent');
  const boxed: unknown = Object(value);

  if (!hasFields(boxed)) throw new TypeError('A historical value requires its fields');

  return boxed;
}

const optionalFields = (value: unknown) => value === null || value === undefined ? undefined : fields(value);
const keyOf = (value: unknown) => conditionKey(value === undefined ? undefined : fields(value));

function before(value: unknown, stamp: string) {
  const at = value || '';
  const primitive = hasFields(at) ? String(at) : at;

  return typeof primitive === 'string' ? primitive <= stamp : Number(primitive) <= Number(stamp);
}

export function createHistorySelection(learning: LearningStore, practice: PracticeSession, training: TrainingMemory, ports: HistoryPorts) {
  let trainingClears = account.clearsApplied(learning.profile);
  let trainingLegacyAt = learning.profile.legacyClearedAt || '';

  function retainedBaseline(source: ConditionLabelSource | null = null) {
    return [...learning.profile.attempts].reverse().find((attempt) => {
      const wanted = source || attempt.conditions;

      return attempt.status === 'complete' && !attempt.interrupted && ['test', 'retest', 'daily'].some((kind) => kind === attempt.kind) && attempt.fresh !== false
        && optionalFields(attempt.conditions)?.mode !== 'code'
        && (!source || keyOf(attempt.conditions) === conditionKey(source)) && fields(wanted).corpus === CORPUS_VERSION
        && (fields(wanted).mode !== 'standard' || fields(wanted).recipe === STANDARD_VERSION);
    }) || null;
  }

  function recommendation(source: ConditionLabelSource | undefined, current: HistoricalTrace | null = null) {
    const traces = current && !learning.profile.attempts.includes(current) ? [...learning.profile.attempts, current] : learning.profile.attempts;

    return recommendFor(DEFAULT_POLICY, { runs: learning.profile.runs, loops: learning.profile.loops, traces, source, now: Date.now(), focus: learning.preferences.trainFocus });
  }

  function forgetCleared() {
    if (ports.running()) return false;
    const marker = learning.profile.historyClearedAt || null;
    const arrived = marker && !trainingClears.has(marker) ? marker : null;
    trainingClears = account.clearsApplied(learning.profile);
    const legacyStart = learning.profile.legacyClearedAt || '';
    const legacyAt = legacyStart !== trainingLegacyAt ? legacyStart : '';
    trainingLegacyAt = legacyStart;

    if (!training.baseline && !practice.shownResult) return false;
    const named = account.clearedIds(learning.profile);

    const takenByLegacy = (record: HistoricalTrace) => Boolean(legacyAt) && before(record.at, legacyAt)
      && !learning.profile.runs.some((run) => run.id === record.id);

    const cleared = (record: HistoricalTrace | null) => record !== null && ((arrived && before(record.at, arrived))
      || (typeof record.id === 'string' && named.has(record.id)) || takenByLegacy(record));

    if (!cleared(training.baseline) && !cleared(practice.shownResult)) return false;
    ports.forgetTraining();

    return true;
  }

  return { retainedBaseline, recommendation, forgetCleared,
    appliedClears() { trainingClears = account.clearsApplied(learning.profile); },
  };
}

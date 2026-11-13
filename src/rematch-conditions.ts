import { isRecord } from './domain-values.js';
import { recordedField } from './recorded-text.js';
import { racePassage } from './race-options.js';
import type { HistoricalRecord } from './profile-types.js';

export function rematchFields(value: unknown): HistoricalRecord {
  if (value === null || value === undefined) return {};
  const boxed: unknown = Object(value);

  if (!isRecord(boxed) && !Array.isArray(boxed)) throw new TypeError('Rematch conditions have no fields');

  return Object.fromEntries(Object.keys(boxed).map((key): [string, unknown] => [key, recordedField(boxed, key)]));
}

export function rematchPassage(conditions: unknown = {}) {
  const previous = recordedField(conditions, 'textId');

  return racePassage({ mode: 'quote', quoteLength: 'medium', difficulty: 'any', ...rematchFields(conditions) }, { seenIds: previous ? [previous] : [] });
}

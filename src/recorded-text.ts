import { isRecord } from './domain-values.js';

export function recordedField(value: unknown, key: string): unknown {
  if (value === null || value === undefined) throw new TypeError('A recorded value is missing');

  if (isRecord(value)) return value[key];

  if (typeof value === 'string' || Array.isArray(value)) {
    if (key === 'length') return value.length;
    const index = Number(key);

    return String(index) === key ? value[index] : undefined;
  }

  return undefined;
}

export function recordedSlice(value: unknown, start: number, end: number): string | readonly unknown[] {
  if (typeof value === 'string' || Array.isArray(value)) return value.slice(start, end);
  throw new TypeError('Recorded text has no slice method');
}

import { lookup } from './domain-values.js';
import type { Preferences } from './profile-types.js';
// Test lengths: the preset pills, and the bounds for a custom time or word count.
// A custom length is stored as an ordinary duration or count, so it enters the test conditions
// (and conditionKey) exactly as a preset does: 45 s gets its own bests and retests, and the keys
// for the presets stay byte for byte what they were.

interface LengthSpec { presets: number[]; min: number; max: number; fallback: number; key: 'duration' | 'count'; customKey: 'customDuration' | 'customCount'; unit: string; noun: string }

export const LENGTHS = {
  time: { presets: [15, 30, 60, 120], min: 5, max: 600, fallback: 30, key: 'duration', customKey: 'customDuration', unit: 'seconds', noun: 'time' },
  words: { presets: [10, 25, 50, 100], min: 5, max: 500, fallback: 25, key: 'count', customKey: 'customCount', unit: 'words', noun: 'word count' },
} satisfies Record<string, LengthSpec>;

export function isPresetLength(mode: string, value: unknown) {
  return Boolean(typeof value === 'number' && lookup(LENGTHS, mode)?.presets.includes(value));
}

export function isValidLength(mode: string, value: unknown): value is number {
  const spec = lookup(LENGTHS, mode);

  return Boolean(spec) && typeof value === 'number' && Number.isInteger(value) && value >= (spec?.min ?? Infinity) && value <= (spec?.max ?? -Infinity);
}

// What someone typed into the custom field: { ok: true, value } or { ok: false, message }.
// Whole numbers only; a trailing unit ("45 s", "75 words") is forgiven.
export type CustomLengthResult = { ok: false; message: string } | { ok: true; value: number };

export function parseCustomLength(mode: string, raw: unknown): CustomLengthResult {
  const spec = lookup(LENGTHS, mode);

  if (!spec) return { ok: false, message: 'Quotes have no custom length.' };
  const unit = mode === 'time' ? /^(\d+)\s*(?:s|secs?|seconds?)?$/i : /^(\d+)\s*(?:w|words?)?$/i;
  const match = unit.exec(String(raw ?? '').trim());

  if (!match) {
    return { ok: false, message: mode === 'time' ? `Enter whole seconds, ${spec.min} to ${spec.max}.` : `Enter a whole number of words, ${spec.min} to ${spec.max}.` };
  }

  const value = Number(match[1]);

  if (value < spec.min) return { ok: false, message: mode === 'time' ? `Too short: use at least ${spec.min} seconds.` : `Too few: use at least ${spec.min} words.` };

  if (value > spec.max) return { ok: false, message: mode === 'time' ? `Too long: use at most ${spec.max} seconds.` : `Too many: use at most ${spec.max} words.` };

  return { ok: true, value };
}

// Old profiles have no custom fields, and anything out of bounds falls back to the default
// length. The remembered custom value is never a preset, and always matches a current custom one.
export function normalizeLengthPreferences<T extends Pick<Preferences, 'duration' | 'count' | 'customDuration' | 'customCount'>>(preferences: T): T {
  const next = { ...preferences };

  for (const mode of Object.keys(LENGTHS)) {
    const spec = lookup(LENGTHS, mode);

    if (!spec) continue;
    const { key, customKey, fallback } = spec;

    if (!isValidLength(mode, next[key])) next[key] = fallback;

    if (!isValidLength(mode, next[customKey]) || isPresetLength(mode, next[customKey])) next[customKey] = null;

    if (!isPresetLength(mode, next[key])) next[customKey] = next[key];
  }

  return next;
}

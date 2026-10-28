// Test lengths: the preset pills, and the bounds for a custom time or word count.
// A custom length is stored as an ordinary duration or count, so it enters the test conditions
// (and conditionKey) exactly as a preset does: 45 s gets its own bests and retests, and the keys
// for the presets stay byte for byte what they were.

export const LENGTHS = {
  time: { presets: [15, 30, 60, 120], min: 5, max: 600, fallback: 30, key: 'duration', customKey: 'customDuration', unit: 'seconds', noun: 'time' },
  words: { presets: [10, 25, 50, 100], min: 5, max: 500, fallback: 25, key: 'count', customKey: 'customCount', unit: 'words', noun: 'word count' },
};

export function isPresetLength(mode, value) {
  return Boolean(LENGTHS[mode]?.presets.includes(value));
}

export function isValidLength(mode, value) {
  const spec = LENGTHS[mode];

  return Boolean(spec) && Number.isInteger(value) && value >= spec.min && value <= spec.max;
}

// What someone typed into the custom field: { ok: true, value } or { ok: false, message }.
// Whole numbers only; a trailing unit ("45 s", "75 words") is forgiven.
export function parseCustomLength(mode, raw) {
  const spec = LENGTHS[mode];

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
export function normalizeLengthPreferences(preferences) {
  const next = { ...preferences };

  for (const mode of Object.keys(LENGTHS)) {
    const { key, customKey, fallback } = LENGTHS[mode];

    if (!isValidLength(mode, next[key])) next[key] = fallback;

    if (!isValidLength(mode, next[customKey]) || isPresetLength(mode, next[customKey])) next[customKey] = null;

    if (!isPresetLength(mode, next[key])) next[customKey] = next[key];
  }

  return next;
}

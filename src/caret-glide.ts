// How long the Smooth caret takes to glide to the next letter, in whole milliseconds. Display only,
// never a test condition. Shorter is faster. Profiles saved before the setting existed get the default.
export const CARET_GLIDE = { min: 40, max: 160, step: 10, default: 80 } as const;

export function normalizeCaretGlide(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CARET_GLIDE.default;
  const stepped = Math.round(value / CARET_GLIDE.step) * CARET_GLIDE.step;

  return Math.min(CARET_GLIDE.max, Math.max(CARET_GLIDE.min, stepped));
}

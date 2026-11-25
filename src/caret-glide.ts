// How the caret moves between letters. Display only, never a test condition. Spring carries its
// momentum from key to key (src/motion.ts), Smooth glides over CARET_GLIDE, Instant jumps. A profile
// that chose Smooth or Instant keeps it; one that never chose gets Spring.
export type TypingMotion = 'spring' | 'smooth' | 'instant';

export const TYPING_MOTIONS: readonly TypingMotion[] = ['spring', 'smooth', 'instant'];

export function normalizeTypingMotion(value: unknown): TypingMotion {
  return value === 'smooth' || value === 'instant' ? value : 'spring';
}

// How long the Smooth caret takes to glide to the next letter, in whole milliseconds. Shorter is
// faster. Profiles saved before the setting existed get the default.
export const CARET_GLIDE = { min: 40, max: 160, step: 10, default: 80 } as const;

export function normalizeCaretGlide(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CARET_GLIDE.default;
  const stepped = Math.round(value / CARET_GLIDE.step) * CARET_GLIDE.step;

  return Math.min(CARET_GLIDE.max, Math.max(CARET_GLIDE.min, stepped));
}

// The Spring caret: a spring a little under critical damping, so a burst of keys carries one motion
// from letter to letter with no visible overshoot. Per second, in px.
export const CARET_SPRING = { stiffness: 780, damping: 48, settle: 0.1, maxStepS: 1 / 30 } as const;

export interface SpringState { x: number; v: number }

// One semi-implicit Euler step toward `target`, over at most maxStepS so a dropped frame stays stable.
export function springStep({ x, v }: SpringState, target: number, dtS: number): SpringState {
  const dt = Math.min(CARET_SPRING.maxStepS, Math.max(0, dtS));
  const next = v + ((target - x) * CARET_SPRING.stiffness - v * CARET_SPRING.damping) * dt;

  return { x: x + next * dt, v: next };
}

export const springSettled = ({ x, v }: SpringState, target: number) => Math.abs(target - x) < CARET_SPRING.settle && Math.abs(v) < CARET_SPRING.settle;

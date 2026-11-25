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

// The Spring caret: a critically damped spring, so a burst of keys carries one motion from letter to
// letter with no overshoot. omega is its natural frequency, per second; a key's step comes within
// `settle` px of its letter in about 0.25 s. A spring still moving after maxSettleMs since its target
// last changed is placed on the letter, so it never runs on.
export const CARET_SPRING = { omega: 38, settle: 0.1, settleSpeed: 2, maxSettleMs: 300 } as const;

export interface SpringState { x: number; v: number }

// The exact solution of the critically damped spring over dtS seconds, not a numerical step, so any
// frame rate and any dropped frame land on the same curve and can never diverge.
export function springStep({ x, v }: SpringState, target: number, dtS: number): SpringState {
  const t = Number.isFinite(dtS) ? Math.max(0, dtS) : 0;
  const { omega } = CARET_SPRING;
  const offset = x - target;
  const slope = v + omega * offset;
  const decay = Math.exp(-omega * t);

  return { x: target + (offset + slope * t) * decay, v: (v - omega * slope * t) * decay };
}

export const springSettled = ({ x, v }: SpringState, target: number) => Math.abs(target - x) < CARET_SPRING.settle && Math.abs(v) < CARET_SPRING.settleSpeed;

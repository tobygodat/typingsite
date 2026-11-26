import test from 'node:test';
import assert from 'node:assert/strict';
import { CARET_GLIDE, CARET_SPRING, normalizeCaretGlide, normalizeTypingMotion, springSettled, springStep } from '../src/caret-glide.js';
import { normalizeProfile, preferencesInUse } from '../src/profile.js';

test('caret glide is whole 10 ms steps from 40 to 160', () => {
  assert.deepEqual(CARET_GLIDE, { min: 40, max: 160, step: 10, default: 80 });

  for (const ms of [40, 80, 120, 160]) assert.equal(normalizeCaretGlide(ms), ms);
  assert.equal(normalizeCaretGlide(84), 80);
  assert.equal(normalizeCaretGlide(85), 90);
  assert.equal(normalizeCaretGlide(39), 40);
  assert.equal(normalizeCaretGlide(0), 40);
  assert.equal(normalizeCaretGlide(161), 160);
  assert.equal(normalizeCaretGlide(10_000), 160);

  for (const value of [undefined, null, '120', Number.NaN, Infinity, true, {}]) assert.equal(normalizeCaretGlide(value), 80);
});

test('profiles saved before the caret glide existed glide at 80 ms', () => {
  assert.equal(preferencesInUse({}).caretGlide, 80);
  assert.equal(preferencesInUse({ typingMotion: 'instant' }).caretGlide, 80);
  assert.equal(Object.hasOwn(normalizeProfile({ version: 2, preferences: { typingMotion: 'smooth' } }).preferences, 'caretGlide'), false);
});

test('a stored caret glide is kept, stepped and clamped, and survives Instant', () => {
  assert.equal(normalizeProfile({ version: 2, preferences: { caretGlide: 120 } }).preferences.caretGlide, 120);
  assert.equal(normalizeProfile({ version: 2, preferences: { caretGlide: 33 } }).preferences.caretGlide, 40);
  assert.equal(normalizeProfile({ version: 2, preferences: { caretGlide: 'fast' } }).preferences.caretGlide, 80);
  assert.equal(preferencesInUse({ typingMotion: 'instant', caretGlide: 150 }).caretGlide, 150);
});

test('typing motion is spring, smooth or instant, and a stored pick is kept', () => {
  assert.equal(preferencesInUse({}).typingMotion, 'spring');
  assert.equal(preferencesInUse({ typingMotion: 'smooth' }).typingMotion, 'smooth');
  assert.equal(preferencesInUse({ typingMotion: 'instant' }).typingMotion, 'instant');
  assert.equal(normalizeProfile({ version: 2, preferences: { typingMotion: 'smooth' } }).preferences.typingMotion, 'smooth');
  assert.equal(Object.hasOwn(normalizeProfile({ version: 2, preferences: {} }).preferences, 'typingMotion'), false);

  for (const value of [undefined, null, 'glide', 'SPRING', 3, {}]) assert.equal(normalizeTypingMotion(value), 'spring');
});

// Steps a spring from rest at `from` to `to` on frames of `dt` seconds until it settles; returns the
// time it took and every position on the way.
function settle(dt, from = 0, to = 40, state = { x: from, v: 0 }) {
  const path = [];
  let elapsed = 0;

  while (!springSettled(state, to) && elapsed < 5) {
    state = springStep(state, to, dt);
    elapsed += dt;
    path.push(state.x);
  }

  return { elapsed, path, state };
}

test('the spring caret settles a step within 300 ms at any frame rate, never overshooting or diverging', () => {
  assert.equal(CARET_SPRING.maxSettleMs, 300);

  for (const hz of [15, 30, 60, 120, 240]) {
    for (const distance of [8, 40, 200]) {
      const { elapsed, path } = settle(1 / hz, 0, distance);
      assert.ok(elapsed < 0.3 + 1 / hz && elapsed < 0.35, `${distance}px at ${hz} Hz settles in ${Math.round(elapsed * 1000)} ms`);
      // From rest, a critically damped spring closes the gap monotonically: never past its letter, never back.
      path.forEach((x, index) => {
        assert.ok(x <= distance + 1e-9, `${distance}px at ${hz} Hz overshoots to ${x}`);
        assert.ok(x >= (path[index - 1] ?? 0) - 1e-9, `${distance}px at ${hz} Hz moves back at frame ${index}`);
      });
    }
  }

  // Leftwards, as Backspace moves it, the same.
  assert.ok(settle(1 / 30, 40, 0).elapsed < 0.35);
});

test('the spring caret is the exact curve: frame rate and dropped frames change nothing', () => {
  const start = { x: 0, v: 300 };
  const whole = springStep(start, 40, 0.1);
  const halves = springStep(springStep(start, 40, 0.05), 40, 0.05);
  const frames = Array.from({ length: 12 }).reduce((state) => springStep(state, 40, 0.1 / 12), start);

  for (const other of [halves, frames]) {
    assert.ok(Math.abs(other.x - whole.x) < 1e-9 && Math.abs(other.v - whole.v) < 1e-6);
  }

  // A half-second or a full-second stall lands on the letter, not past it.
  for (const spike of [0.5, 1, 30]) {
    const after = springStep({ x: 0, v: 2000 }, 40, spike);
    assert.ok(springSettled(after, 40), `a ${spike} s frame settles`);
  }

  // A frame with no time, or a bad clock, moves nothing.
  assert.deepEqual(springStep({ x: 3, v: 7 }, 40, 0), { x: 3, v: 7 });
  assert.deepEqual(springStep({ x: 3, v: 7 }, 40, -1), { x: 3, v: 7 });
  assert.deepEqual(springStep({ x: 3, v: 7 }, 40, Number.NaN), { x: 3, v: 7 });
});

test('the spring caret carries its speed into the next key, with no visible overshoot through a burst', () => {
  const frame = 1 / 30;
  let state = { x: 0, v: 0 };
  let target = 0;
  let furthest = 0;

  // Sixty-four keys, a letter (14 px) every 50 ms, at 30 Hz.
  for (let key = 0; key < 64; key += 1) {
    target += 14;

    for (let t = 0; t < 0.05; t += frame) {
      state = springStep(state, target, frame);
      furthest = Math.max(furthest, state.x - target);
    }
  }

  assert.ok(furthest < 0.5, `overshoot ${furthest}px`);
  assert.ok(settle(frame, 0, target, state).elapsed < 0.35, 'and it settles once the keys stop');

  // A second key mid-glide keeps the motion going rather than starting from rest.
  const mid = [1, 2, 3, 4].reduce((value) => springStep(value, 20, 1 / 60), { x: 0, v: 0 });
  assert.ok(mid.v > 0);
  assert.ok(springStep(mid, 40, 1 / 60).x > springStep({ x: mid.x, v: 0 }, 40, 1 / 60).x);
});

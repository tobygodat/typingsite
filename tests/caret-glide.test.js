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

test('the spring caret carries its speed into the next key, never overshoots visibly, and settles', () => {
  assert.deepEqual({ stiffness: CARET_SPRING.stiffness, damping: CARET_SPRING.damping }, { stiffness: 780, damping: 48 });
  const frame = 1 / 60;
  let state = { x: 0, v: 0 };
  let frames = 0;
  let furthest = 0;

  while (!springSettled(state, 20) && frames < 600) {
    state = springStep(state, 20, frame);
    furthest = Math.max(furthest, state.x);
    frames += 1;
  }

  assert.ok(frames < 40, `settles in ${frames} frames`);
  assert.ok(furthest - 20 < 0.5, `overshoot ${furthest - 20}px`);

  // A second key mid-glide keeps the motion going rather than starting from rest.
  const mid = [1, 2, 3, 4].reduce((value) => springStep(value, 20, frame), { x: 0, v: 0 });
  assert.ok(mid.v > 0);
  assert.ok(springStep(mid, 40, frame).v > springStep({ x: mid.x, v: 0 }, 40, frame).v);

  // A long frame is taken as at most a thirtieth of a second, so a stall can't fling the caret.
  assert.deepEqual(springStep({ x: 0, v: 0 }, 20, 5), springStep({ x: 0, v: 0 }, 20, CARET_SPRING.maxStepS));
});

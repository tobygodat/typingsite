import test from 'node:test';
import assert from 'node:assert/strict';
import { CARET_GLIDE, normalizeCaretGlide } from '../src/caret-glide.js';
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { LENGTHS, isPresetLength, isValidLength, normalizeLengthPreferences, parseCustomLength } from '../src/lengths.js';
import { CORPUS_VERSION, METRIC_VERSION, conditionKey, makePassage, selectPassage, timedWordSupply } from '../src/typing.js';

// The conditions object exactly as app.js builds it for a time or word test.
const shape = (mode, length) => ({
  mode,
  duration: mode === 'time' ? length : null,
  count: mode === 'words' ? length : null,
  punctuation: false,
  quoteLength: null,
  difficulty: null,
  wordList: '200',
  inputClass: 'physical-keyboard',
  correctionPolicy: 'relaxed',
  language: 'en',
  corpus: CORPUS_VERSION,
  metricVersion: METRIC_VERSION,
});

// A small deterministic generator, so word supply checks never depend on luck.
function seeded(seed = 7) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test('preset condition keys are byte-identical to master, so existing bests and retests still match', () => {
  assert.equal(conditionKey(shape('time', 30)), 'time:30::plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1');
  assert.equal(conditionKey(shape('time', 120)), 'time:120::plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1');
  assert.equal(conditionKey(shape('words', 25)), 'words::25:plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1');
  assert.equal(conditionKey(shape('words', 100)), 'words::100:plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1');
});

test('a custom length is its own condition, and a custom value equal to a preset is that preset', () => {
  assert.equal(conditionKey(shape('time', 45)), 'time:45::plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1');
  assert.equal(conditionKey(shape('words', 75)), 'words::75:plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1');
  const presetKeys = [...LENGTHS.time.presets.map((n) => conditionKey(shape('time', n))), ...LENGTHS.words.presets.map((n) => conditionKey(shape('words', n)))];
  assert.equal(presetKeys.includes(conditionKey(shape('time', 45))), false);
  assert.equal(presetKeys.includes(conditionKey(shape('words', 75))), false);
  assert.notEqual(conditionKey(shape('time', 45)), conditionKey(shape('time', 450)));
  const custom = parseCustomLength('time', '60');
  assert.equal(conditionKey(shape('time', custom.value)), conditionKey(shape('time', 60)));
});

test('custom input accepts whole numbers within 5–600 s and 5–500 words', () => {
  assert.deepEqual(parseCustomLength('time', '45'), { ok: true, value: 45 });
  assert.deepEqual(parseCustomLength('time', ' 45 s '), { ok: true, value: 45 });
  assert.deepEqual(parseCustomLength('time', '90 seconds'), { ok: true, value: 90 });
  assert.deepEqual(parseCustomLength('time', '5'), { ok: true, value: 5 });
  assert.deepEqual(parseCustomLength('time', '600'), { ok: true, value: 600 });
  assert.deepEqual(parseCustomLength('time', '045'), { ok: true, value: 45 });
  assert.deepEqual(parseCustomLength('words', '75'), { ok: true, value: 75 });
  assert.deepEqual(parseCustomLength('words', '75 words'), { ok: true, value: 75 });
  assert.deepEqual(parseCustomLength('words', '500'), { ok: true, value: 500 });
});

test('invalid custom input says plainly what is allowed', () => {
  assert.deepEqual(parseCustomLength('time', ''), { ok: false, message: 'Enter whole seconds, 5 to 600.' });
  for (const raw of ['abc', '4.5', '-10', '1e3', '45 words', '3:00']) {
    assert.deepEqual(parseCustomLength('time', raw), { ok: false, message: 'Enter whole seconds, 5 to 600.' }, raw);
  }
  assert.deepEqual(parseCustomLength('time', '4'), { ok: false, message: 'Too short: use at least 5 seconds.' });
  assert.deepEqual(parseCustomLength('time', '0'), { ok: false, message: 'Too short: use at least 5 seconds.' });
  assert.deepEqual(parseCustomLength('time', '601'), { ok: false, message: 'Too long: use at most 600 seconds.' });
  assert.deepEqual(parseCustomLength('words', 'ten'), { ok: false, message: 'Enter a whole number of words, 5 to 500.' });
  assert.deepEqual(parseCustomLength('words', '45 s'), { ok: false, message: 'Enter a whole number of words, 5 to 500.' });
  assert.deepEqual(parseCustomLength('words', '4'), { ok: false, message: 'Too few: use at least 5 words.' });
  assert.deepEqual(parseCustomLength('words', '501'), { ok: false, message: 'Too many: use at most 500 words.' });
  assert.equal(parseCustomLength('quote', '45').ok, false);
});

test('bounds and presets are explicit', () => {
  assert.equal(isValidLength('time', 5), true);
  assert.equal(isValidLength('time', 600), true);
  assert.equal(isValidLength('time', 601), false);
  assert.equal(isValidLength('time', 4), false);
  assert.equal(isValidLength('time', 45.5), false);
  assert.equal(isValidLength('time', '45'), false);
  assert.equal(isValidLength('words', 500), true);
  assert.equal(isValidLength('words', 501), false);
  assert.equal(isValidLength('quote', 30), false);
  assert.equal(isPresetLength('time', 30), true);
  assert.equal(isPresetLength('time', 45), false);
  assert.equal(isPresetLength('words', 25), true);
  assert.equal(isPresetLength('words', 30), false);
});

test('old preferences keep their lengths and gain empty custom slots', () => {
  const legacy = { mode: 'words', duration: 60, count: 50, wordList: '200' };
  assert.deepEqual(normalizeLengthPreferences(legacy), { ...legacy, customDuration: null, customCount: null });
  assert.deepEqual(legacy, { mode: 'words', duration: 60, count: 50, wordList: '200' }, 'input is not mutated');
});

test('custom lengths are remembered, and broken values fall back to the defaults', () => {
  assert.deepEqual(normalizeLengthPreferences({ duration: 45, count: 25 }), { duration: 45, count: 25, customDuration: 45, customCount: null });
  assert.deepEqual(normalizeLengthPreferences({ duration: 30, count: 75, customDuration: 90 }), { duration: 30, count: 75, customDuration: 90, customCount: 75 });
  // A current custom value always wins the memory slot.
  assert.deepEqual(normalizeLengthPreferences({ duration: 75, count: 25, customDuration: 45 }).customDuration, 75);
  // A preset is never stored as the custom value.
  assert.deepEqual(normalizeLengthPreferences({ duration: 30, count: 25, customDuration: 60, customCount: 10 }), { duration: 30, count: 25, customDuration: null, customCount: null });
  assert.deepEqual(normalizeLengthPreferences({ duration: 9999, count: 0, customDuration: 2, customCount: '75' }), { duration: 30, count: 25, customDuration: null, customCount: null });
  assert.deepEqual(normalizeLengthPreferences({ duration: '30', count: null }), { duration: 30, count: 25, customDuration: null, customCount: null });
});

test('presets keep the same 1,600-word timed passage; long custom times get enough words for 300 wpm', () => {
  for (const seconds of [0, 15, 30, 45, 60, 120, 320]) assert.equal(timedWordSupply(seconds), 1600, String(seconds));
  assert.equal(timedWordSupply(321), 1605);
  assert.equal(timedWordSupply(600), 3000);
  // Same random draws, same text: nothing changes for a preset.
  assert.equal(makePassage('time', 0, false, seeded(), '200', 120), makePassage('time', 0, false, seeded(), '200'));
  const long = makePassage('time', 0, false, seeded(), '200', 600);
  assert.equal(long.split(' ').length, 3000);
  // 300 wpm for ten minutes is 3,000 five-character words.
  assert.ok(long.length >= 300 * 5 * 10, `${long.length} characters`);
  assert.equal(selectPassage({ mode: 'time', duration: 600, random: seeded() }).text.split(' ').length, 3000);
  assert.equal(selectPassage({ mode: 'words', count: 500, random: seeded() }).text.split(' ').length, 500);
});

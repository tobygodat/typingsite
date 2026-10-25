import test from 'node:test';
import assert from 'node:assert/strict';
import { LENGTHS, isPresetLength, isValidLength, normalizeLengthPreferences, parseCustomLength } from '../src/lengths.js';
import { CORPUS_VERSION, METRIC_VERSION, completeAttempt, conditionKey, createAttempt, makePassage, selectPassage, timedCharacterSupply } from '../src/typing.js';
import { MAX_TRACES, TRACE_BUDGET, retainTraces } from '../src/insights.js';
import { wordListIds } from '../src/words.js';

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
  assert.equal(conditionKey(shape('time', 30)), 'time:30::plain:::200:physical-keyboard:relaxed:original-en-v6:stilltype-metrics-v1');
  assert.equal(conditionKey(shape('time', 120)), 'time:120::plain:::200:physical-keyboard:relaxed:original-en-v6:stilltype-metrics-v1');
  assert.equal(conditionKey(shape('words', 25)), 'words::25:plain:::200:physical-keyboard:relaxed:original-en-v6:stilltype-metrics-v1');
  assert.equal(conditionKey(shape('words', 100)), 'words::100:plain:::200:physical-keyboard:relaxed:original-en-v6:stilltype-metrics-v1');
});

test('a custom length is its own condition, and a custom value equal to a preset is that preset', () => {
  assert.equal(conditionKey(shape('time', 45)), 'time:45::plain:::200:physical-keyboard:relaxed:original-en-v6:stilltype-metrics-v1');
  assert.equal(conditionKey(shape('words', 75)), 'words::75:plain:::200:physical-keyboard:relaxed:original-en-v6:stilltype-metrics-v1');
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

test('presets keep one 1,600-word timed passage byte for byte; longer times are topped up to the supply', () => {
  assert.equal(timedCharacterSupply(0), 0);
  assert.equal(timedCharacterSupply(120), 3000);
  assert.equal(timedCharacterSupply(600), 15000);
  // The text ids makePassage('time', 0, punctuation, seeded(), list, numbers) gives for every list and setting.
  const ids = {
    '200:plain': 'generated-1wd62n5', '200:punctuation': 'generated-1rbaa57', '200:plain+numbers': 'generated-1tb836k', '200:punctuation+numbers': 'generated-swyvyo',
    '1k:plain': 'generated-1l1j522', '1k:punctuation': 'generated-loxuhd', '1k:plain+numbers': 'generated-ijuefq', '1k:punctuation+numbers': 'generated-jv8exc',
    '5k:plain': 'generated-1dkhwmp', '5k:punctuation': 'generated-c3ml60', '5k:plain+numbers': 'generated-12tgt60', '5k:punctuation+numbers': 'generated-mecc8f',
    '10k:plain': 'generated-aot3wf', '10k:punctuation': 'generated-fmw7vo', '10k:plain+numbers': 'generated-1esjo7l', '10k:punctuation+numbers': 'generated-gxqlvc',
  };
  for (const [key, id] of Object.entries(ids)) {
    const [list, setting] = key.split(':');
    for (const seconds of [0, ...LENGTHS.time.presets]) {
      const passage = selectPassage({ mode: 'time', duration: seconds, punctuation: setting.startsWith('punctuation'), numbers: setting.endsWith('+numbers'), wordList: list, random: seeded() });
      assert.equal(passage.id, id, `${key} at ${seconds} s`);
      assert.equal(passage.text.split(' ').length, 1600);
    }
  }
  // Ten minutes on the shortest list with numbers on: 1,600 words are not enough, so more are drawn after them,
  // the same ones for the same seed, until the finished text holds 15,000 characters and little more.
  const long = makePassage('time', 0, false, seeded(), '200', true, 600);
  assert.equal(long, makePassage('time', 0, false, seeded(), '200', true, 600));
  assert.ok(long.startsWith(makePassage('time', 0, false, seeded(), '200', true)));
  assert.ok(long.length >= 15000 && long.length < 15000 * 1.02, `${long.length} characters`);
  assert.ok(long.split(' ').slice(1600).some((word) => /^\d+$/.test(word)));
  assert.equal(selectPassage({ mode: 'words', count: 500, random: seeded() }).text.split(' ').length, 500);
});

// 300 wpm is 300 five-character words a minute: 25 characters for every second on the clock.
const supplyFor = (seconds) => (seconds * 300 * 5) / 60;

test('every timed passage holds enough text for 300 wpm until the clock runs out, with numbers and punctuation', () => {
  const short = [];
  let combo = 0;
  for (const list of wordListIds) for (const numbers of [false, true]) for (const punctuation of [false, true]) {
    combo += 1;
    // Every allowed duration, each on its own seed, then many seeds at 320 s and 600 s, where the 200 list
    // with numbers on used to run a couple of hundred characters short.
    const cases = [];
    for (let seconds = LENGTHS.time.min; seconds <= LENGTHS.time.max; seconds += 1) cases.push([seconds, seconds * 16 + combo]);
    for (let seed = 1; seed <= 40; seed += 1) cases.push([320, seed], [LENGTHS.time.max, seed]);
    for (const [seconds, seed] of cases) {
      const text = makePassage('time', 0, punctuation, seeded(seed), list, numbers, seconds);
      if (text.length < supplyFor(seconds)) short.push(`${list} ${punctuation ? 'punctuation' : 'plain'}${numbers ? '+numbers' : ''} ${seconds} s, seed ${seed}: ${text.length} of ${supplyFor(seconds)}`);
    }
    // The app's own path passes the duration through to the same passage.
    const { text } = selectPassage({ mode: 'time', duration: LENGTHS.time.max, punctuation, numbers, wordList: list, random: seeded(combo) });
    if (text.length < supplyFor(LENGTHS.time.max)) short.push(`selectPassage ${list} ${punctuation ? 'punctuation' : 'plain'}${numbers ? '+numbers' : ''}: ${text.length}`);
  }
  assert.equal(short.length, 0, `${short.length} passages run out before the clock, e.g.\n${short.slice(0, 8).join('\n')}`);
});

// A finished trace as the app stores it: every keystroke an event, one error in 33 corrected.
function storedTrace(id, mode, length, wpm) {
  const passage = selectPassage({ mode, duration: mode === 'time' ? length : 0, count: mode === 'words' ? length : 25, random: seeded() });
  const attempt = createAttempt({ id, text: passage.text, textId: passage.id, conditions: shape(mode, length) });
  const keys = mode === 'time' ? Math.min(passage.text.length, Math.round((wpm * 5 * length) / 60)) : passage.text.length;
  let offsetMs = 0;
  for (let position = 0; position < keys; position += 1) {
    offsetMs += 60_000 / (wpm * 5);
    if (position % 33 === 7) {
      attempt.events.push({ type: 'insert', text: 'q', position, accepted: true, offsetMs });
      attempt.events.push({ type: 'delete', count: 1, offsetMs: offsetMs + 60 });
    }
    attempt.events.push({ type: 'insert', text: passage.text[position], position, accepted: true, offsetMs: offsetMs + 120 });
  }
  attempt.startedAt = 0;
  return completeAttempt(attempt, { endedAt: offsetMs + 120 });
}

test('long custom runs keep fewer full traces, so the device cache stays inside the storage quota', () => {
  // Runs of the default 30 s, even fast ones, keep all 24 traces.
  const preset = storedTrace('preset', 'time', 30, 130);
  const presets = Array.from({ length: 30 }, (_, i) => ({ ...preset, id: `p${i}` }));
  assert.deepEqual(retainTraces(presets).map((t) => t.id), presets.slice(-MAX_TRACES).map((t) => t.id));

  // 24 maximum-length custom runs (600 s at 130 wpm, 500 words) do not.
  const longest = [storedTrace('time', 'time', 600, 130), storedTrace('words', 'words', 500, 130)];
  assert.ok(JSON.stringify(longest[0]).length > 1_000_000);
  const traces = Array.from({ length: MAX_TRACES }, (_, i) => ({ ...longest[i % 2], id: `long${i}` }));
  const kept = retainTraces([...presets, ...traces]);
  assert.ok(kept.length >= 2 && kept.length < MAX_TRACES, `${kept.length} kept`);
  assert.ok(JSON.stringify(kept).length <= TRACE_BUDGET);
  assert.deepEqual(kept.map((t) => t.id), traces.slice(-kept.length).map((t) => t.id));

  // A trace over the whole budget is never kept, not even the newest (tests/insights.test.js has the details).
  assert.deepEqual(retainTraces(traces, { budget: 10 }), []);
  assert.deepEqual(retainTraces([]), []);
});

test('friends board understands custom test length condition keys', async () => {
  const { shapeOf } = await import('../src/friends-board.js');
  const time = { mode: 'time', duration: 45, wordList: '200', correctionPolicy: 'relaxed' };
  const words = { mode: 'words', count: 35, wordList: '200', correctionPolicy: 'relaxed' };
  assert.equal(shapeOf(conditionKey(time)).duration, 45);
  assert.equal(shapeOf(conditionKey(words)).count, 35);
  assert.equal(shapeOf(conditionKey({ ...time, duration: 601 })), null);
});

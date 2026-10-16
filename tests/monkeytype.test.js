import test from 'node:test';
import assert from 'node:assert/strict';
import { mapMonkeytypeConfig, parseMonkeytypeExport, readMonkeytypeSettings } from '../src/monkeytype.js';
import { preferencesInUse } from '../src/profile.js';

// The fields that matter from a current Monkeytype export, plus a few it has and Stilltype doesn't.
const current = {
  theme: 'serika_dark', themeLight: 'serika', themeDark: 'serika_dark', autoSwitchTheme: false, customTheme: false,
  customThemeColors: ['#323437', '#e2b714'], punctuation: true, numbers: false, words: 50, time: 60, mode: 'words',
  quoteLength: [2], language: 'english_1k', fontSize: 3, stopOnError: 'letter', paceCaret: 'pb', paceCaretCustomSpeed: 100,
  liveSpeedStyle: 'mini', liveAccStyle: 'off', keymapMode: 'react', caretStyle: 'line', funbox: [], blindMode: false,
  difficulty: 'normal', confidenceMode: 'off', strictSpace: false, quickEnd: false, minAcc: 'off', minAccCustom: 90,
  minWpm: 'off', minWpmCustomSpeed: 100, repeatQuotes: 'off', layout: 'default', keymapLayout: 'overrideSync', tapeMode: 'off',
};

test('a current export maps each setting that has a Stilltype counterpart', () => {
  const { preferences, mapped, skipped, error } = readMonkeytypeSettings(JSON.stringify(current));
  assert.equal(error, undefined);
  assert.deepEqual(preferences, {
    mode: 'words', duration: 60, count: 50, punctuation: true, numbers: false, wordList: '1k', quoteLength: 'long',
    correction: 'mandatory', strictSpace: false, quickEnd: false, minAccuracy: 0, minWpm: 0, repeatQuotes: false,
    paceCaret: 'best', paceWpm: 100, liveMetrics: true, keyboard: true, fontSize: '36', tape: false, theme: 'dark',
  });
  assert.deepEqual(skipped, []);
  assert.ok(mapped.find((row) => row.setting === 'word list' && row.value === 'top 1k' && row.from === 'language: english_1k'));
  // Monkeytype-only keys (caret style, funbox, blind mode) are ignored, not reported; so is a keymap that
  // follows Monkeytype's layout, and a correction setting left off when another one sets the rule.
  assert.ok(!mapped.concat(skipped).some((row) => /caretStyle|funbox|blindMode|keymapLayout|layout|difficulty|confidenceMode/.test(row.from)));
  assert.ok(mapped.find((row) => row.setting === 'correction' && row.value === 'stop on error' && row.from === 'stopOnError: letter'));
  // Every mapped value is one Stilltype keeps as it is.
  const inUse = preferencesInUse(preferences);
  for (const [key, value] of Object.entries(preferences)) assert.equal(inUse[key], value, key);
});

test('an older export (string font size and speed, number quote length, showLiveWpm) still maps', () => {
  const { preferences } = mapMonkeytypeConfig({
    mode: 'time', time: 30, quoteLength: 0, fontSize: '125', paceCaret: 'custom', paceCaretCustomSpeed: '70',
    showLiveWpm: false, showLiveAcc: true, theme: 'serika',
  });
  assert.deepEqual(preferences, {
    mode: 'time', duration: 30, quoteLength: 'short', fontSize: '22', paceCaret: 'custom', paceWpm: 70, liveMetrics: true, theme: 'light',
  });
});

test('values with no Stilltype counterpart are skipped with a reason and change nothing', () => {
  const { preferences, skipped } = mapMonkeytypeConfig({
    mode: 'zen', time: 700, words: 0, language: 'german', quoteLength: [0, 2], paceCaret: 'daily', repeatQuotes: 'always',
    keymapLayout: 'azerty', layout: 'dvorak',
  });
  assert.deepEqual(preferences, {});
  assert.deepEqual(skipped.map((row) => row.setting), [
    'test mode', 'time length', 'word count', 'word list', 'quote length', 'repeat quotes', 'keyboard layout', 'keyboard layout', 'pace caret',
  ]);
  assert.ok(skipped.every((row) => row.reason && row.from));
});

test('either tape mode turns the one-line tape on; Stilltype steps by words either way', () => {
  assert.equal(mapMonkeytypeConfig({ tapeMode: 'word' }).preferences.tape, true);
  const letter = mapMonkeytypeConfig({ tapeMode: 'letter' });
  assert.equal(letter.preferences.tape, true);
  assert.match(letter.mapped[0].value, /whole words/);
  assert.equal(mapMonkeytypeConfig({ tapeMode: 'off' }).preferences.tape, false);
  assert.deepEqual(mapMonkeytypeConfig({ tapeMode: 'sideways' }).skipped.map((row) => row.setting), ['one-line tape']);
});

test('theme follows the system, a custom theme by its background, a light preset as light', () => {
  assert.equal(mapMonkeytypeConfig({ autoSwitchTheme: true, theme: 'serika' }).preferences.theme, 'system');
  assert.equal(mapMonkeytypeConfig({ customTheme: true, customThemeColors: ['#fafafa'], theme: 'serika_dark' }).preferences.theme, 'light');
  assert.equal(mapMonkeytypeConfig({ customTheme: true, customThemeColors: ['#111'], theme: 'serika' }).preferences.theme, 'dark');
  assert.equal(mapMonkeytypeConfig({ theme: 'nord_light' }).preferences.theme, 'light');
  assert.equal(mapMonkeytypeConfig({ theme: 'dracula' }).preferences.theme, 'dark');
});

test('all quote lengths map to any, thicc to long, and a pace beyond the range is clamped', () => {
  assert.equal(mapMonkeytypeConfig({ quoteLength: [0, 1, 2, 3] }).preferences.quoteLength, 'any');
  assert.equal(mapMonkeytypeConfig({ quoteLength: [3] }).preferences.quoteLength, 'long');
  const { preferences, mapped } = mapMonkeytypeConfig({ paceCaretCustomSpeed: 400 });
  assert.equal(preferences.paceWpm, 300);
  assert.match(mapped[0].value, /10–300/);
});

test('anything that is not a Monkeytype export is refused with an explanation', () => {
  assert.match(parseMonkeytypeExport('').error, /Paste/);
  assert.match(parseMonkeytypeExport('{ mode: time').error, /valid JSON/);
  assert.match(parseMonkeytypeExport('[1, 2]').error, /doesn’t look like/);
  assert.match(parseMonkeytypeExport('{"hello": "world"}').error, /doesn’t look like/);
  assert.match(readMonkeytypeSettings('{"caretStyle": "line"}').error, /nothing changed/);
  // An export saved as a JSON string of itself still reads.
  assert.equal(readMonkeytypeSettings(JSON.stringify(JSON.stringify({ mode: 'quote' }))).preferences.mode, 'quote');
});

test('a length off the presets imports as a custom one within Stilltype’s bounds', () => {
  const { preferences, mapped } = mapMonkeytypeConfig({ time: 45, words: 500 });
  assert.deepEqual(preferences, { duration: 45, count: 500 });
  assert.deepEqual(mapped.map((row) => row.value), ['45 s (custom)', '500 words (custom)']);
  // Stored as an ordinary duration or count, it is also remembered as the custom value.
  assert.equal(preferencesInUse(preferences).customDuration, 45);
  assert.equal(mapMonkeytypeConfig({ time: 60 }).mapped[0].value, '60 s');

  const out = mapMonkeytypeConfig({ time: 4, words: 501 });
  assert.deepEqual(out.preferences, {});
  assert.match(out.skipped[0].reason, /5 to 600/);
  assert.match(out.skipped[1].reason, /5 to 500/);
  assert.match(mapMonkeytypeConfig({ time: 0 }).skipped[0].reason, /always end/);
  assert.equal(mapMonkeytypeConfig({ time: 30.5 }).skipped.length, 1);
});

test('the correction rule comes from the strongest Monkeytype setting that asks for one', () => {
  const correction = (config) => mapMonkeytypeConfig(config).preferences.correction;
  assert.equal(correction({ difficulty: 'normal', stopOnError: 'off', confidenceMode: 'off' }), 'relaxed');
  assert.equal(correction({ stopOnError: 'letter' }), 'mandatory');
  assert.equal(correction({ confidenceMode: 'max' }), 'no-backspace');
  assert.equal(correction({ difficulty: 'expert' }), 'fail-word');
  assert.equal(correction({ difficulty: 'master' }), 'fail-any');

  // Monkeytype's word stop lets wrong letters stand until space; Stilltype's refuses each, and says so.
  const word = mapMonkeytypeConfig({ stopOnError: 'word', confidenceMode: 'off' });
  assert.equal(word.preferences.correction, 'mandatory');
  assert.match(word.mapped[0].value, /stops at the letter, not the word/);

  // Failing the run beats holding the caret, which beats no backspace; the others are reported, not lost.
  const several = mapMonkeytypeConfig({ difficulty: 'expert', stopOnError: 'letter', confidenceMode: 'max' });
  assert.equal(several.preferences.correction, 'fail-word');
  assert.deepEqual(several.mapped, [{ setting: 'correction', value: 'fail on word error', from: 'difficulty: expert' }]);
  assert.deepEqual(several.skipped.map((row) => row.from), ['stopOnError: letter', 'confidenceMode: max']);
  assert.ok(several.skipped.every((row) => /difficulty: expert came first/.test(row.reason)));
  assert.equal(correction({ stopOnError: 'word', confidenceMode: 'max' }), 'mandatory');

  // Confidence mode on still allows backspace within a word, so it has no counterpart; off elsewhere stays free.
  const confident = mapMonkeytypeConfig({ stopOnError: 'off', confidenceMode: 'on' });
  assert.equal(confident.preferences.correction, 'relaxed');
  assert.match(confident.skipped[0].reason, /within a word/);
  assert.deepEqual(mapMonkeytypeConfig({ confidenceMode: 'on' }).preferences, {});
});

test('strict space, quick end, minimums, repeat quotes and the keymap layout carry over', () => {
  const { preferences, mapped, skipped } = mapMonkeytypeConfig({
    strictSpace: true, quickEnd: false, minAcc: 'custom', minAccCustom: 95, minWpm: 'custom', minWpmCustomSpeed: 75,
    repeatQuotes: 'typing', keymapLayout: 'colemak_dh', layout: 'default',
  });
  assert.deepEqual(preferences, { strictSpace: true, quickEnd: false, minAccuracy: 95, minWpm: 60, repeatQuotes: true, layout: 'colemak-dh' });
  assert.deepEqual(skipped, []);
  // A minimum between Stilltype's values rounds down, so it never stops a run Monkeytype would have let continue.
  assert.equal(mapped.find((row) => row.setting === 'minimum speed').value, '60 wpm (rounded down from 75 wpm)');
  assert.equal(mapMonkeytypeConfig({ minAcc: 'custom', minAccCustom: 100 }).preferences.minAccuracy, 98);
  assert.equal(mapMonkeytypeConfig({ minAcc: 'off', minAccCustom: 90 }).preferences.minAccuracy, 0);
  assert.match(mapMonkeytypeConfig({ minWpm: 'custom', minWpmCustomSpeed: 15 }).skipped[0].reason, /lowest minimum is 20 wpm/);
  assert.equal(mapMonkeytypeConfig({ repeatQuotes: 'off' }).preferences.repeatQuotes, false);

  // Monkeytype's layout remaps the keys typed, which Stilltype never does, so only the keymap's is taken.
  const remapped = mapMonkeytypeConfig({ layout: 'dvorak', keymapLayout: 'overrideSync' });
  assert.deepEqual(remapped.preferences, {});
  assert.match(remapped.skipped[0].reason, /doesn’t remap keys/);
  assert.equal(mapMonkeytypeConfig({ keymapLayout: 'workman', layout: 'qwerty' }).skipped.length, 0);

  const inUse = preferencesInUse(preferences);
  for (const [key, value] of Object.entries(preferences)) assert.equal(inUse[key], value, key);
});

test('the speed unit carries over as wpm or cpm, and speeds stay the wpm Monkeytype saved', () => {
  const { preferences, mapped } = mapMonkeytypeConfig({ typingSpeedUnit: 'cpm', minWpm: 'custom', minWpmCustomSpeed: 60, paceCaretCustomSpeed: 90 });
  assert.deepEqual(preferences, { speedUnit: 'cpm', minWpm: 60, paceWpm: 90 });
  assert.ok(mapped.find((row) => row.setting === 'speed unit' && row.value === 'cpm' && row.from === 'typingSpeedUnit: cpm'));
  assert.equal(preferencesInUse(preferences).speedUnit, 'cpm');
  assert.equal(mapMonkeytypeConfig({ typingSpeedUnit: 'wpm' }).preferences.speedUnit, 'wpm');
  for (const unit of ['wps', 'cps', 'wph']) {
    const { preferences: none, skipped } = mapMonkeytypeConfig({ typingSpeedUnit: unit });
    assert.deepEqual(none, {});
    assert.deepEqual(skipped, [{ setting: 'speed unit', from: `typingSpeedUnit: ${unit}`, reason: 'Stilltype shows wpm or cpm.' }]);
  }
});

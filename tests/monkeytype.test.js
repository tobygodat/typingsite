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
};

test('a current export maps each setting that has a Stilltype counterpart', () => {
  const { preferences, mapped, skipped, error } = readMonkeytypeSettings(JSON.stringify(current));
  assert.equal(error, undefined);
  assert.deepEqual(preferences, {
    mode: 'words', duration: 60, count: 50, punctuation: true, numbers: false, wordList: '1k', quoteLength: 'long',
    correction: 'mandatory', paceCaret: 'best', paceWpm: 100, liveMetrics: true, keyboard: true, fontSize: '36', theme: 'dark',
  });
  assert.deepEqual(skipped, []);
  assert.ok(mapped.find((row) => row.setting === 'word list' && row.value === 'top 1k' && row.from === 'language: english_1k'));
  // Monkeytype-only keys (caret style, funbox, blind mode) are ignored, not reported.
  assert.ok(!mapped.concat(skipped).some((row) => /caretStyle|funbox|blindMode/.test(row.from)));
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
    mode: 'zen', time: 45, words: 200, language: 'german', quoteLength: [0, 2], paceCaret: 'daily',
  });
  assert.deepEqual(preferences, {});
  assert.deepEqual(skipped.map((row) => row.setting), ['test mode', 'time length', 'word count', 'word list', 'quote length', 'pace caret']);
  assert.ok(skipped.every((row) => row.reason && row.from));
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

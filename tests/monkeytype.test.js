import test from 'node:test';
import assert from 'node:assert/strict';
import { fromMonkeytype, parseMonkeytype } from '../src/monkeytype.js';

// A trimmed copy of what Monkeytype's settings export copies.
const exported = {
  punctuation: true, numbers: false, words: 50, time: 60, mode: 'time', quoteLength: [1], language: 'english_1k',
  difficulty: 'normal', funbox: [], layout: 'default', stopOnError: 'letter', smoothCaret: 'medium', caretStyle: 'default',
  paceCaret: 'pb', paceCaretCustomSpeed: 100, liveSpeedStyle: 'mini', liveAccStyle: 'off', keymapMode: 'react',
  fontSize: 2, fontFamily: 'Roboto_Mono', theme: 'serika_dark', autoSwitchTheme: false, customTheme: false,
  customThemeColors: ['#323437', '#e2b714'], blindMode: false,
};

test('a Monkeytype export maps onto the settings Stilltype also has', () => {
  const { preferences, applied, skipped } = fromMonkeytype(exported);
  assert.deepEqual(preferences, {
    mode: 'time', duration: 60, count: 50, punctuation: true, numbers: false, quoteLength: 'medium', wordList: '1k',
    stopOnError: true, liveMetrics: true, keyboard: true, paceCaret: 'best', paceWpm: 100, fontSize: '28',
  });
  assert.equal(applied.length, Object.keys(preferences).length);
  // A named theme has no match; settings left at Monkeytype's defaults aren't listed as missing.
  assert.deepEqual(skipped, ['theme “serika_dark” (Stilltype keeps its own dark and light themes)']);
});

test('values Stilltype lacks are reported rather than forced', () => {
  const { preferences, skipped } = fromMonkeytype({ mode: 'zen', time: 45, words: 30, language: 'german', paceCaret: 'daily', funbox: ['mirror'], layout: 'colemak' });
  assert.deepEqual(preferences, {});
  assert.equal(skipped.length, 7);
  assert.match(skipped.join('\n'), /mode “zen”/);
  assert.match(skipped.join('\n'), /layout emulation/);
});

test('themes, quote lengths, font sizes and older keys are read where they can be', () => {
  assert.equal(fromMonkeytype({ autoSwitchTheme: true }).preferences.theme, 'system');
  assert.equal(fromMonkeytype({ customTheme: true, customThemeColors: ['#f4f1eb'] }).preferences.theme, 'light');
  assert.equal(fromMonkeytype({ customTheme: true, customThemeColors: ['#111'] }).preferences.theme, 'dark');
  assert.equal(fromMonkeytype({ quoteLength: [0, 2] }).preferences.quoteLength, 'any');
  assert.equal(fromMonkeytype({ quoteLength: [3] }).preferences.quoteLength, 'long');
  assert.equal(fromMonkeytype({ fontSize: 1.5 }).preferences.fontSize, '22');
  assert.equal(fromMonkeytype({ fontSize: '300' }).preferences.fontSize, '36');
  assert.equal(fromMonkeytype({ showLiveWpm: true }).preferences.liveMetrics, true);
  assert.equal(fromMonkeytype({ stopOnError: 'off' }).preferences.stopOnError, false);
  assert.equal(fromMonkeytype({ paceCaretCustomSpeed: 900 }).preferences.paceWpm, 300);
});

test('a paste that isn’t a settings object is refused with a way forward', () => {
  assert.match(parseMonkeytype('not json').error, /import\/export settings/);
  assert.match(parseMonkeytype('[1, 2]').error, /no settings/);
  assert.deepEqual(parseMonkeytype(' {"config": {"mode": "words"}} ').config, { mode: 'words' });
  assert.deepEqual(parseMonkeytype('{"mode": "words"}').config, { mode: 'words' });
});

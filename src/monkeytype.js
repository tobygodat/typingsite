// Reads the settings JSON Monkeytype exports (Settings → danger zone → import/export settings → export)
// and maps what has a Stilltype counterpart onto Stilltype's settings. Keys Monkeytype has and Stilltype
// doesn't are left alone, unnamed; a counterpart whose value can't be carried over is reported as skipped.
// Pure: app.js applies the result as a pick of each setting it holds (saveChoice), so it syncs like one.
import { TEST_COUNTS, TEST_DURATIONS } from './typing.js';
import { clampPace } from './profile.js';

export const MAX_IMPORT_LENGTH = 1_000_000;

// Monkeytype themes whose background is light (relative luminance above 0.4), from its theme list.
// Any other theme name is taken as dark, Monkeytype's default and the larger set.
const LIGHT_THEMES = new Set(['9009', 'beach', 'bingsu', 'blueberry_light', 'breeze', 'cafe', 'camping', 'cheesecake', 'creamsicle', 'darling', 'desert_oasis', 'dino', 'dmg', 'dollar', 'fleuriste', 'froyo', 'frozen_llama', 'fruit_chew', 'godspeed', 'gruvbox_light', 'hanok', 'honey', 'iceberg_light', 'lavender', 'lil_dragon', 'lilac_mist', 'macroblank', 'magic_girl', 'menthol', 'mexican', 'milkshake', 'mizu', 'modern_dolch_light', 'modern_ink', 'mr_sleeves', 'ms_cupcakes', 'nord_light', 'olive', 'paper', 'pastel', 'peaches', 'pink_lemonade', 'rainbow_trail', 'repose_light', 'retro', 'rose_pine_dawn', 'serika', 'sewing_tin_light', 'shoko', 'slambook', 'snes', 'soaring_skies', 'solarized_light', 'tangerine', 'taro', 'terrazzo', 'tiramisu', 'vaporwave', 'vesper_light', 'witch_girl']);

const WORD_LISTS = { english: ['200', 'top 200'], english_1k: ['1k', 'top 1k'], english_5k: ['5k', 'top 5k'], english_10k: ['10k', 'top 10k'] };
const PACE = { off: 'off', pb: 'best', tagPb: 'best', average: 'average', last: 'last', custom: 'custom' };
const PACE_LABELS = { off: 'off', best: 'personal best', average: 'average', last: 'last run', custom: 'custom' };
const QUOTE_LENGTHS = { 0: 'short', 1: 'medium', 2: 'long', 3: 'long' };
const FONT_SIZES = [['22', 'small'], ['28', 'medium'], ['36', 'large']];

// Keys every Monkeytype config export carries, used to tell an export from any other JSON.
const MONKEYTYPE_KEYS = ['mode', 'time', 'words', 'punctuation', 'numbers', 'language', 'theme', 'quoteLength', 'paceCaret', 'stopOnError', 'keymapMode', 'fontSize', 'caretStyle', 'difficulty', 'funbox', 'layout'];

const shown = (value) => (Array.isArray(value) ? value.join(', ') : String(value));

function luminance(hex) {
  let digits = String(hex).replace(/^#/, '');
  if (digits.length === 3 || digits.length === 4) digits = [...digits.slice(0, 3)].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}/i.test(digits)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Monkeytype's font size is in rem (2 by default); older exports wrote "1", "125", "15", "2", "3", "4".
function remSize(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) return null;
  if (/^1\d{1,2}$/.test(value)) return Number(`1.${value.slice(1)}`);
  return Number(value);
}

// Turns pasted text or a file's contents into the export's settings object, or explains why it can't.
export function parseMonkeytypeExport(text) {
  if (typeof text !== 'string' || !text.trim()) return { error: 'Paste your Monkeytype settings, or choose the file you saved them in.' };
  if (text.length > MAX_IMPORT_LENGTH) return { error: 'That’s too long to be a Monkeytype settings export.' };
  let value;
  try {
    value = JSON.parse(text.trim());
    // A copy that was saved as a JSON string of the export.
    if (typeof value === 'string') value = JSON.parse(value);
  } catch {
    return { error: 'That isn’t valid JSON. In Monkeytype, use Settings → import/export settings → export, then paste all of it.' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !MONKEYTYPE_KEYS.some((key) => key in value)) {
    return { error: 'That doesn’t look like Monkeytype settings. Export them from Monkeytype’s settings page and paste all of it.' };
  }
  return { config: value };
}

// Maps a Monkeytype config onto Stilltype settings. Returns the settings to apply, a row for each one
// mapped ({ setting, value, from }) and a row for each counterpart that couldn't be ({ setting, from, reason }).
export function mapMonkeytypeConfig(config) {
  const preferences = {};
  const mapped = [];
  const skipped = [];
  const has = (key) => Object.hasOwn(config, key) && config[key] !== null && config[key] !== undefined;
  const map = (setting, values, value, from) => {
    Object.assign(preferences, values);
    mapped.push({ setting, value, from });
  };
  const skip = (setting, from, reason) => skipped.push({ setting, from, reason });

  if (has('mode')) {
    const from = `mode: ${shown(config.mode)}`;
    if (['time', 'words', 'quote'].includes(config.mode)) map('test mode', { mode: config.mode }, config.mode, from);
    else if (config.mode === 'zen') skip('test mode', from, 'Stilltype has no zen mode.');
    else if (config.mode === 'custom') skip('test mode', from, 'Monkeytype’s export doesn’t include your custom text. Paste it into Custom instead.');
    else skip('test mode', from, 'No matching mode.');
  }

  if (has('time')) {
    const seconds = Number(config.time);
    const from = `time: ${shown(config.time)}`;
    if (TEST_DURATIONS.includes(seconds)) map('time length', { duration: seconds }, `${seconds} s`, from);
    else skip('time length', from, `Stilltype times are ${TEST_DURATIONS.join(', ')} seconds.`);
  }

  if (has('words')) {
    const count = Number(config.words);
    const from = `words: ${shown(config.words)}`;
    if (TEST_COUNTS.includes(count)) map('word count', { count }, `${count} words`, from);
    else skip('word count', from, `Stilltype word counts are ${TEST_COUNTS.join(', ')}.`);
  }

  for (const key of ['punctuation', 'numbers']) {
    if (typeof config[key] === 'boolean') map(key, { [key]: config[key] }, config[key] ? 'on' : 'off', `${key}: ${config[key]}`);
  }

  if (has('language')) {
    const list = WORD_LISTS[config.language];
    const from = `language: ${shown(config.language)}`;
    if (list) map('word list', { wordList: list[0] }, list[1], from);
    else skip('word list', from, 'Stilltype has the English top 200, 1k, 5k and 10k lists.');
  }

  if (has('quoteLength')) {
    // An array in current exports ([1] by default); a single number in older ones.
    const lengths = [...new Set([config.quoteLength].flat())];
    const from = `quoteLength: ${shown(config.quoteLength)}`;
    const named = [...new Set(lengths.map((length) => QUOTE_LENGTHS[length]))];
    if ([0, 1, 2].every((length) => lengths.includes(length)) || lengths.includes(-1)) map('quote length', { quoteLength: 'any' }, 'any', from);
    else if (named.length === 1 && named[0]) map('quote length', { quoteLength: named[0] }, lengths.includes(3) ? 'long (Stilltype’s longest)' : named[0], from);
    else skip('quote length', from, 'Stilltype picks one quote length, or any.');
  }

  if (has('stopOnError')) {
    const from = `stopOnError: ${shown(config.stopOnError)}`;
    if (config.stopOnError === 'off') map('stop on error', { stopOnError: false }, 'off', from);
    else if (['word', 'letter'].includes(config.stopOnError)) map('stop on error', { stopOnError: true }, 'on', from);
    else skip('stop on error', from, 'No matching value.');
  }

  if (has('paceCaret')) {
    const pace = PACE[config.paceCaret];
    const from = `paceCaret: ${shown(config.paceCaret)}`;
    if (pace) map('pace caret', { paceCaret: pace }, PACE_LABELS[pace], from);
    else skip('pace caret', from, 'Stilltype paces against your best, average, last run or a set speed.');
  }

  if (has('paceCaretCustomSpeed')) {
    const speed = Number(config.paceCaretCustomSpeed);
    const from = `paceCaretCustomSpeed: ${shown(config.paceCaretCustomSpeed)}`;
    if (Number.isFinite(speed) && speed > 0) {
      const wpm = clampPace(speed);
      map('custom pace', { paceWpm: wpm }, wpm === Math.round(speed) ? `${wpm} wpm` : `${wpm} wpm (Stilltype allows 10–300)`, from);
    } else skip('custom pace', from, 'Not a speed.');
  }

  // Live speed and accuracy are one setting here; Monkeytype has one for each.
  const live = [['liveSpeedStyle', (v) => v !== 'off'], ['liveAccStyle', (v) => v !== 'off'], ['showLiveWpm', (v) => v === true], ['showLiveAcc', (v) => v === true]]
    .filter(([key]) => has(key));
  if (live.length) {
    const on = live.some(([key, isOn]) => isOn(config[key]));
    map('live wpm and accuracy', { liveMetrics: on }, on ? 'on' : 'off', live.map(([key]) => `${key}: ${shown(config[key])}`).join(', '));
  }

  if (has('keymapMode')) {
    const on = config.keymapMode !== 'off';
    map('keyboard', { keyboard: on }, on ? 'on' : 'off', `keymapMode: ${shown(config.keymapMode)}`);
  }

  if (has('fontSize')) {
    const rem = remSize(config.fontSize);
    const from = `fontSize: ${shown(config.fontSize)}`;
    if (rem && rem > 0) {
      const [size, name] = rem < 1.75 ? FONT_SIZES[0] : rem < 2.5 ? FONT_SIZES[1] : FONT_SIZES[2];
      map('text size', { fontSize: size }, name, from);
    } else skip('text size', from, 'Not a size.');
  }

  if (config.autoSwitchTheme === true) {
    map('theme', { theme: 'system' }, 'system', 'autoSwitchTheme: true');
  } else if (config.customTheme === true && Array.isArray(config.customThemeColors) && luminance(config.customThemeColors[0]) !== null) {
    const theme = luminance(config.customThemeColors[0]) > 0.4 ? 'light' : 'dark';
    map('theme', { theme }, theme, `custom theme, background ${config.customThemeColors[0]}`);
  } else if (typeof config.theme === 'string' && config.theme) {
    const theme = LIGHT_THEMES.has(config.theme) ? 'light' : 'dark';
    map('theme', { theme }, theme, `theme: ${config.theme}`);
  }

  return { preferences, mapped, skipped };
}

export function readMonkeytypeSettings(text) {
  const parsed = parseMonkeytypeExport(text);
  if (parsed.error) return parsed;
  const result = mapMonkeytypeConfig(parsed.config);
  if (!result.mapped.length) return { ...result, error: 'None of these Monkeytype settings have a Stilltype counterpart, so nothing changed.' };
  return result;
}

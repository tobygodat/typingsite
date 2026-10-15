// Monkeytype settings import: reads the JSON Monkeytype's settings export copies (Settings →
// import/export settings → export) and maps what Stilltype has an equivalent for onto its own
// preferences. Nothing else is read or kept. Pure, so it can be checked in Node.
import { QUOTE_LENGTHS, TEST_COUNTS, TEST_DURATIONS } from './typing.js';
import { PACE_MODES, clampPace } from './profile.js';

const LANGUAGES = { english: '200', english_1k: '1k', english_5k: '5k', english_10k: '10k' };
const PACE = { off: 'off', pb: 'best', average: 'average', last: 'last', custom: 'custom' };
// Monkeytype's quote lengths: 0 short, 1 medium, 2 long, 3 thicc (Stilltype's longest is long).
const QUOTES = { 0: 'short', 1: 'medium', 2: 'long', 3: 'long' };

// A pasted export: the config object itself, or wrapped as { config } by some tools.
export function parseMonkeytype(text) {
  let value;
  try {
    value = JSON.parse(String(text ?? '').trim());
  } catch {
    return { error: 'That isn’t Monkeytype’s settings export. In Monkeytype, open Settings, then import/export settings, choose export and paste what it copies.' };
  }
  const config = value && typeof value === 'object' && !Array.isArray(value) && value.config && typeof value.config === 'object' ? value.config : value;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { error: 'That export holds no settings.' };
  return { config };
}

// Light or dark from a hex background colour, by its relative luminance.
function themeOf(hex) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join('') : match[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? 'light' : 'dark';
}

// Monkeytype's font size is in rem (2 by default); older exports kept it as a string such as "125".
function fontSizeOf(value) {
  let size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return null;
  if (typeof value === 'string' && size >= 10) size /= 100;
  return size < 1.75 ? '22' : size <= 2.5 ? '28' : '36';
}

// Returns { preferences, applied, skipped }: the Stilltype settings to save, a line for each one
// taken, and a line for each Monkeytype setting it holds that has no equivalent here.
export function fromMonkeytype(config) {
  const preferences = {};
  const applied = [];
  const skipped = [];
  const has = (key) => Object.hasOwn(config, key) && config[key] !== null && config[key] !== undefined;
  const take = (key, value, line) => { preferences[key] = value; applied.push(line); };

  if (has('mode')) {
    if (['time', 'words', 'quote'].includes(config.mode)) take('mode', config.mode, `mode: ${config.mode}`);
    else skipped.push(`mode “${config.mode}” (Stilltype has time, words and quote)`);
  }
  if (has('time')) {
    if (TEST_DURATIONS.includes(config.time)) take('duration', config.time, `time: ${config.time} seconds`);
    else skipped.push(`time ${config.time}s (Stilltype offers ${TEST_DURATIONS.join(', ')})`);
  }
  if (has('words')) {
    if (TEST_COUNTS.includes(config.words)) take('count', config.words, `words: ${config.words}`);
    else skipped.push(`${config.words} words (Stilltype offers ${TEST_COUNTS.join(', ')})`);
  }
  for (const key of ['punctuation', 'numbers']) {
    if (has(key) && typeof config[key] === 'boolean') take(key, config[key], `${key}: ${config[key] ? 'on' : 'off'}`);
  }
  if (has('quoteLength')) {
    const lengths = [...new Set((Array.isArray(config.quoteLength) ? config.quoteLength : [config.quoteLength])
      .map((length) => QUOTES[length]).filter(Boolean))];
    const length = lengths.length === 1 ? lengths[0] : 'any';
    if (QUOTE_LENGTHS.includes(length)) take('quoteLength', length, `quote length: ${length}`);
  }
  if (has('language')) {
    if (LANGUAGES[config.language]) take('wordList', LANGUAGES[config.language], `word list: top ${LANGUAGES[config.language]}`);
    else skipped.push(`language “${config.language}” (Stilltype has English top 200, 1k, 5k and 10k)`);
  }
  if (has('stopOnError')) {
    const on = config.stopOnError !== 'off' && config.stopOnError !== false;
    take('stopOnError', on, `stop on error: ${on ? 'on' : 'off'}`);
  }
  // Newer exports split live speed and accuracy; older ones had one showLiveWpm switch.
  const liveKeys = ['liveSpeedStyle', 'liveAccStyle'].filter(has);
  if (liveKeys.length) {
    const on = liveKeys.some((key) => config[key] !== 'off');
    take('liveMetrics', on, `live wpm and accuracy: ${on ? 'on' : 'off'}`);
  } else if (has('showLiveWpm') && typeof config.showLiveWpm === 'boolean') {
    take('liveMetrics', config.showLiveWpm, `live wpm and accuracy: ${config.showLiveWpm ? 'on' : 'off'}`);
  }
  if (has('keymapMode')) {
    const on = config.keymapMode !== 'off';
    take('keyboard', on, `keyboard: ${on ? 'on' : 'off'}`);
  }
  if (has('paceCaret')) {
    const mode = PACE[config.paceCaret];
    if (mode && PACE_MODES.includes(mode)) take('paceCaret', mode, `pace caret: ${mode === 'best' ? 'personal best' : mode}`);
    else skipped.push(`pace caret “${config.paceCaret}”`);
  }
  if (has('paceCaretCustomSpeed') && Number(config.paceCaretCustomSpeed) > 0) {
    const wpm = clampPace(config.paceCaretCustomSpeed);
    take('paceWpm', wpm, `custom pace: ${wpm} wpm`);
  }
  if (has('fontSize')) {
    const size = fontSizeOf(config.fontSize);
    if (size) take('fontSize', size, `text size: ${{ 22: 'small', 28: 'medium', 36: 'large' }[size]}`);
  }
  // Monkeytype's named themes have no match here; the light/dark side of one can be read.
  const theme = config.autoSwitchTheme === true ? 'system'
    : config.randomTheme === 'light' || config.randomTheme === 'dark' ? config.randomTheme
      : config.customTheme === true && Array.isArray(config.customThemeColors) ? themeOf(config.customThemeColors[0]) : null;
  if (theme) take('theme', theme, `theme: ${theme}`);
  else if (has('theme')) skipped.push(`theme “${config.theme}” (Stilltype keeps its own dark and light themes)`);

  // Settings with no counterpart here, named only when the export turns them on.
  const unset = new Set(['off', 'none', 'normal', 'default', 'Roboto_Mono', '']);
  for (const [key, label] of [['funbox', 'funbox'], ['layout', 'layout emulation'], ['blindMode', 'blind mode'], ['difficulty', 'expert and master difficulty'],
    ['caretStyle', 'caret style'], ['fontFamily', 'font'], ['customBackground', 'custom background'], ['playSoundOnClick', 'sounds'],
    ['tapeMode', 'tape mode'], ['minWpm', 'minimum speed'], ['minAcc', 'minimum accuracy']]) {
    const value = config[key];
    if (has(key) && value !== false && !unset.has(value) && !(Array.isArray(value) && !value.length)) skipped.push(label);
  }
  return { preferences, applied, skipped };
}

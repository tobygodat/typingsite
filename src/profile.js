// The stored profile's shape: the settings' defaults, and how a stored copy (this device's cache, another
// tab's, the account row) is read before anything uses or merges it (normalizeProfile).
import { DEFAULT_SOUND_MODE, DEFAULT_SOUND_VOLUME, normalizeSoundMode, normalizeSoundVolume } from './sound.js';
import { DEFAULT_SPEED_UNIT, normalizeSpeedUnit } from './units.js';
import { normalizeLengthPreferences } from './lengths.js';
import { correctionPreference, customTextProblem, normalizeCustomText, replayAttempt } from './typing.js';
import { normalizeKeybindings } from './keybindings.js';
import { DEFAULT_LAYOUT, normalizeLayout } from './layouts.js';
import { DEFAULT_WORD_LIST, wordListIds } from './words.js';
import { CODE_LANGUAGES, DEFAULT_CODE_LANGUAGE } from './code-snippets.js';
import { DEFAULT_WORD_HIGHLIGHT, normalizeWordHighlight } from './word-highlight.js';
import { DEFAULT_BOOK, bookIds } from './books.js';
import { DAILY_GOALS, retainTraces, retainHistory, validPracticeDays, runRecord, settleDailyFirsts } from './insights.js';
import { retainRunCounts } from './run-counts.js';
import { normalizeLessonProgress } from './lessons.js';
import { normalizeCompositions } from './compose.js';

export const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const defaultPreferences = {
  mode: 'time',
  duration: 30,
  count: 25,
  customDuration: null,
  customCount: null,
  punctuation: false,
  numbers: false,
  quoteLength: 'medium',
  difficulty: 'any',
  wordList: DEFAULT_WORD_LIST,
  speedUnit: DEFAULT_SPEED_UNIT,
  codeLanguage: DEFAULT_CODE_LANGUAGE,
  book: DEFAULT_BOOK,
  // Off: quotes the profile has seen wait until every matching quote has been shown.
  repeatQuotes: false,
  layout: DEFAULT_LAYOUT,
  fingerMap: false,
  fontSize: '28',
  // Display only, like the text size: never a test condition.
  wordHighlight: DEFAULT_WORD_HIGHLIGHT,
  tape: false,
  liveMetrics: false,
  keyboard: false,
  stopOnError: false,
  correction: 'relaxed',
  strictSpace: false,
  quickEnd: true,
  focusMode: false,
  sound: DEFAULT_SOUND_MODE,
  soundVolume: DEFAULT_SOUND_VOLUME,
  // Minimum accuracy (%) and speed (wpm) to continue a practice run; 0 is off.
  minAccuracy: 0,
  minWpm: 0,
  keybindings: normalizeKeybindings(),
  theme: 'system',
  dailyGoal: 0,
  customText: '',
  customOrder: 'as-written',
  paceCaret: 'off',
  paceWpm: 80,
};

export const CUSTOM_ORDERS = ['as-written', 'shuffled', 'random'];
export const MIN_ACCURACY_OPTIONS = [0, 80, 90, 95, 98];
export const MIN_WPM_OPTIONS = [0, 20, 30, 40, 60, 80, 100];
export const PACE_MODES = ['off', 'best', 'average', 'last', 'custom'];
export const PACE_MIN_WPM = 10;
export const PACE_MAX_WPM = 300;
export const clampPace = (value) => Math.min(PACE_MAX_WPM, Math.max(PACE_MIN_WPM, Math.round(Number(value) || 80)));

// A new profile has chosen no settings, so it stores none (see storedPreferences).
export function emptyProfile() {
  return {
    version: 2,
    profileId: uid(),
    preferences: {},
    attempts: [],
    runs: [],
    practiceDays: {},
    // Runs started and finished, per tab counter and day (src/run-counts.js).
    runCounts: {},
    loops: [],
    seenTextIds: [],
    bests: {},
    lessons: {},
    // Composing practice keeps summary numbers only, never the text (src/compose.js).
    compositions: [],
  };
}

export function validPreferences(value) {
  value.strictSpace = value.strictSpace === true;
  value.quickEnd = value.quickEnd !== false;
  value.correction = correctionPreference(value);
  value.stopOnError = value.correction === 'mandatory';
  if (!DAILY_GOALS.includes(value.dailyGoal)) value.dailyGoal = 0;
  if (!MIN_ACCURACY_OPTIONS.includes(value.minAccuracy)) value.minAccuracy = 0;
  if (!MIN_WPM_OPTIONS.includes(value.minWpm)) value.minWpm = 0;
  if (!wordListIds.includes(value.wordList)) value.wordList = DEFAULT_WORD_LIST;
  value.sound = normalizeSoundMode(value.sound);
  value.soundVolume = normalizeSoundVolume(value.soundVolume);
  value.speedUnit = normalizeSpeedUnit(value.speedUnit);
  if (!CODE_LANGUAGES.includes(value.codeLanguage)) value.codeLanguage = DEFAULT_CODE_LANGUAGE;
  if (!bookIds.includes(value.book)) value.book = DEFAULT_BOOK;
  value.wordHighlight = normalizeWordHighlight(value.wordHighlight);
  value.tape = value.tape === true;
  value.repeatQuotes = value.repeatQuotes === true;
  value.layout = normalizeLayout(value.layout);
  value.fingerMap = value.fingerMap === true;
  value.keybindings = normalizeKeybindings(value.keybindings, value.restartKey);
  delete value.restartKey;
  const customText = typeof value.customText === 'string' ? normalizeCustomText(value.customText) : '';
  value.customText = customTextProblem(customText) ? '' : customText;
  if (!CUSTOM_ORDERS.includes(value.customOrder)) value.customOrder = 'as-written';
  if (!PACE_MODES.includes(value.paceCaret)) value.paceCaret = 'off';
  value.paceWpm = clampPace(value.paceWpm);
  // Whether the friends board shares is kept by the board alone (src/friends-board.js), never in the
  // synced profile, so a copy saved by an earlier build is dropped rather than synced back.
  delete value.shareBoard;
  return normalizeLengthPreferences(value);
}

// Every setting as used: the stored ones, and the default for each one the profile doesn't store.
export const preferencesInUse = (stored) => validPreferences({ ...defaultPreferences, ...stored, correction: correctionPreference(stored) });

// The settings a stored copy holds, each made one this build can use, and no others. A setting the copy
// lacks (its build didn't have it, or it was never chosen) stays absent rather than filled in with its
// default: a merge then takes it from a copy that has it (account.mergePreferences), whichever copy was
// saved later, and nothing stored or sent from here holds a default that later reads as a choice.
function storedPreferences(raw) {
  const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const valid = preferencesInUse(stored);
  const normalized = Object.fromEntries(Object.keys(stored).filter((key) => key !== 'restartKey').map((key) => [key, valid[key]]));
  if (!Object.hasOwn(stored, 'keybindings') && Object.hasOwn(stored, 'restartKey')) normalized.keybindings = normalizeKeybindings(null, stored.restartKey);
  if (Object.hasOwn(stored, 'stopOnError') && !Object.hasOwn(stored, 'correction')) normalized.correction = valid.correction;
  return normalized;
}

// Stored traces leave out their summary (account.storedCopy); it is rebuilt from the events, as it was made.
const withSummary = (trace) => (trace && !trace.summary && Array.isArray(trace.events) && typeof trace.text === 'string'
  ? { ...trace, summary: replayAttempt(trace) } : trace);

export function normalizeProfile(parsed) {
  if (parsed?.version !== 2) return emptyProfile();
  const rawPreferences = { ...(parsed.preferences || {}) };
  const preferencesAt = { ...(parsed.preferencesAt || {}) };
  const oldChoice = preferencesAt.stopOnError || '';
  const newChoice = preferencesAt.correction || '';
  if (Object.hasOwn(rawPreferences, 'stopOnError') && (!Object.hasOwn(rawPreferences, 'correction') || oldChoice > newChoice)) {
    rawPreferences.correction = correctionPreference({ stopOnError: rawPreferences.stopOnError });
    if (oldChoice) preferencesAt.correction = oldChoice;
  }
  const traces = Array.isArray(parsed.attempts) ? parsed.attempts.map(withSummary) : [];
  const records = Array.isArray(parsed.runs) ? parsed.runs : traces.map((trace) => {
    // Older traces did not have wall-clock dates. Preserve unknown dates rather than invent them.
    const loop = parsed.loops?.find((l) => l.afterAttemptId === trace.id);
    const best = Object.values(parsed.bests || {}).find((b) => b.attemptId === trace.id);
    return runRecord(trace, trace.at || loop?.at || best?.at || null);
  });
  return {
    ...emptyProfile(),
    ...parsed,
    preferences: storedPreferences(rawPreferences),
    ...(Object.keys(preferencesAt).length ? { preferencesAt } : {}),
    attempts: retainTraces(settleDailyFirsts(traces)),
    ...retainHistory(settleDailyFirsts(records), validPracticeDays(parsed.practiceDays)),
    runCounts: retainRunCounts(parsed.runCounts),
    loops: Array.isArray(parsed.loops) ? parsed.loops : [],
    seenTextIds: Array.isArray(parsed.seenTextIds) ? parsed.seenTextIds : [],
    // Stored bests are kept exactly as saved, including any an exhausted quote pool set before repeat quotes:
    // only a run from now on needs fresh text to set one (storeAttempt).
    bests: parsed.bests && typeof parsed.bests === 'object' ? parsed.bests : {},
    lessons: normalizeLessonProgress(parsed.lessons),
    compositions: normalizeCompositions(parsed.compositions),
  };
}

import { isRecord } from './domain-values.js';
import { isAttempt, isRunRecord, isTrainingLoop, replaySource, isConditions } from './domain-history.js';
import type { HydratedProfile, HistoricalRecord } from './profile-types.js';

export { isAttempt, isRunRecord, isTrainingLoop };

export type { HydratedProfile } from './profile-types.js';

function includes<T>(values: readonly T[], value: unknown): value is T { return values.some((known) => known === value); }

import type { Preferences, Profile } from './profile-types.js';

export type { Preferences, Profile, TrainingLoop, Best } from './profile-types.js';

// The stored profile's shape: the settings' defaults, and how a stored copy (this device's cache, another
// tab's, the account row) is read before anything uses or merges it (normalizeProfile).
import { DEFAULT_SOUND_MODE, DEFAULT_SOUND_VOLUME, normalizeSoundMode, normalizeSoundVolume } from './sound.js';
import { DEFAULT_SPEED_UNIT, normalizeSpeedUnit } from './units.js';
import { normalizeLengthPreferences } from './lengths.js';
import { DRILL_SECONDS, createAttempt, correctionPreference, customTextProblem, normalizeCustomText, replayAttempt } from './typing.js';
import { normalizeKeybindings } from './keybindings.js';
import { DEFAULT_LAYOUT, normalizeLayout } from './layouts.js';
import { DEFAULT_WORD_LIST, wordListIds } from './words.js';
import { CODE_LANGUAGES, DEFAULT_CODE_LANGUAGE } from './code-snippets.js';
import { DEFAULT_WORD_HIGHLIGHT, normalizeWordHighlight } from './word-highlight.js';
import { DEFAULT_BOOK, bookIds } from './books.js';
import { APP_FONTS, DEFAULT_FONT, TYPING_FONTS, normalizeFont } from './fonts.js';
import { DAILY_GOALS, dayKey, retainTraces, retainHistory, validPracticeDays, runRecord, settleDailyFirsts } from './insights.js';
import { retainRunCounts } from './run-counts.js';
import { normalizeLessonProgress } from './lessons.js';
import { normalizeCompositions } from './compose.js';
import { withoutConditionSets } from './profile-copy.js';
import { isCustomId, normalizeCustomThemes } from './custom-themes.js';
import { DEFAULT_FOCUS, FOCUSES } from './learner.js';

export const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const defaultPreferences: Preferences = {
  mode: 'time',
  duration: 30,
  count: 25,
  customDuration: null,
  customCount: null,
  punctuation: false,
  numbers: false,
  // Practice text weighted toward recurring pairs; its runs are drill-kind.
  adaptive: false,
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
  typingFont: DEFAULT_FONT,
  appFont: DEFAULT_FONT,
  // Display only, like the text size: never a test condition.
  wordHighlight: DEFAULT_WORD_HIGHLIGHT,
  wordHighlightSlide: false,
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
  // 'system', or the theme shown in dark or light mode, which is then that mode's pick. System mode shows
  // darkTheme or lightTheme; old builds read theme alone.
  theme: 'system',
  darkTheme: 'dark',
  lightTheme: 'light',
  // Saved custom themes (src/custom-themes.js): theme, darkTheme or lightTheme name one by its id.
  customThemes: '[]',
  dailyGoal: 0,
  customText: '',
  customOrder: 'as-written',
  paceCaret: 'off',
  paceWpm: 80,
  // How Train trains: preferences, never test conditions. The focus picks what the learner ranks on, the drill
  // runs this many seconds, and the retest after it can be left out.
  trainFocus: DEFAULT_FOCUS,
  drillSeconds: DRILL_SECONDS,
  retest: true,
};

// Each theme by its ground's luminance (src/styles.css): dark grounds sit below 0.05, light above 0.85.
export const DARK_THEMES = ['dark', 'terminal', 'midnight', 'nord'];
export const LIGHT_THEMES = ['light', 'paper', 'shadcn', 'soft', 'swiss', 'e-ink'];

export const CUSTOM_ORDERS = ['as-written', 'shuffled', 'random'];
export const MIN_ACCURACY_OPTIONS = [0, 80, 90, 95, 98];
export const MIN_WPM_OPTIONS = [0, 20, 30, 40, 60, 80, 100];
const PACE_MODES = ['off', 'best', 'average', 'last', 'custom'];
export const DRILL_LENGTHS = [15, 30, 60, 120];
export const PACE_MIN_WPM = 10;
export const PACE_MAX_WPM = 300;
export const clampPace = (value: unknown) => Math.min(PACE_MAX_WPM, Math.max(PACE_MIN_WPM, Math.round(Number(value) || 80)));

// A new profile has chosen no settings, so it stores none (see storedPreferences).
export function emptyProfile(): Profile {
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

export function validPreferences(value: HistoricalRecord): HistoricalRecord {
  value.strictSpace = value.strictSpace === true;
  value.quickEnd = value.quickEnd !== false;
  value.correction = correctionPreference(value);
  value.stopOnError = value.correction === 'mandatory';

  if (!includes(DAILY_GOALS, value.dailyGoal)) value.dailyGoal = 0;

  if (!includes(MIN_ACCURACY_OPTIONS, value.minAccuracy)) value.minAccuracy = 0;

  if (!includes(MIN_WPM_OPTIONS, value.minWpm)) value.minWpm = 0;

  if (!includes(wordListIds, value.wordList)) value.wordList = DEFAULT_WORD_LIST;
  value.sound = normalizeSoundMode(value.sound);
  value.soundVolume = normalizeSoundVolume(value.soundVolume);
  value.speedUnit = normalizeSpeedUnit(value.speedUnit);

  if (!includes(CODE_LANGUAGES, value.codeLanguage)) value.codeLanguage = DEFAULT_CODE_LANGUAGE;

  if (!includes(bookIds, value.book)) value.book = DEFAULT_BOOK;
  value.wordHighlight = normalizeWordHighlight(value.wordHighlight);
  value.wordHighlightSlide = value.wordHighlightSlide === true;
  value.typingFont = normalizeFont(value.typingFont, TYPING_FONTS);
  value.appFont = normalizeFont(value.appFont, APP_FONTS);
  value.tape = value.tape === true;
  value.adaptive = value.adaptive === true;
  value.repeatQuotes = value.repeatQuotes === true;
  value.layout = normalizeLayout(value.layout);
  value.fingerMap = value.fingerMap === true;
  value.keybindings = normalizeKeybindings(value.keybindings, value.restartKey);
  delete value.restartKey;
  const customText = typeof value.customText === 'string' ? normalizeCustomText(value.customText) : '';
  value.customText = customTextProblem(customText) ? '' : customText;

  if (!includes(CUSTOM_ORDERS, value.customOrder)) value.customOrder = 'as-written';

  if (!includes(FOCUSES, value.trainFocus)) value.trainFocus = DEFAULT_FOCUS;

  if (!includes(DRILL_LENGTHS, value.drillSeconds)) value.drillSeconds = defaultPreferences.drillSeconds;
  value.retest = value.retest !== false;

  if (!includes(PACE_MODES, value.paceCaret)) value.paceCaret = 'off';
  value.paceWpm = clampPace(value.paceWpm);

  // A custom theme's id is kept even when the list lacks it (it may arrive from another copy); the app
  // shows the mode's default until it does.
  if (!includes(DARK_THEMES, value.darkTheme) && !isCustomId(value.darkTheme)) value.darkTheme = 'dark';

  if (!includes(LIGHT_THEMES, value.lightTheme) && !isCustomId(value.lightTheme)) value.lightTheme = 'light';
  value.customThemes = normalizeCustomThemes(value.customThemes);
  // Whether the friends board shares is kept by the board alone (src/friends-board.js), never in the
  // synced profile, so a copy saved by an earlier build is dropped rather than synced back.
  delete value.shareBoard;

  const lengths = normalizeLengthPreferences({ duration: typeof value.duration === 'number' ? value.duration : NaN, count: typeof value.count === 'number' ? value.count : NaN, customDuration: typeof value.customDuration === 'number' ? value.customDuration : null, customCount: typeof value.customCount === 'number' ? value.customCount : null });

  return { ...value, ...lengths };
}

// Every setting as used: the stored ones, and the default for each one the profile doesn't store.
export const preferencesInUse = (stored: Partial<Preferences> | HistoricalRecord = {}) => validPreferences({ ...defaultPreferences, ...stored, correction: correctionPreference(stored) });

// The settings a stored copy holds, each made one this build can use, and no others. A setting the copy
// lacks (its build didn't have it, or it was never chosen) stays absent rather than filled in with its
// default: a merge then takes it from a copy that has it (account.mergePreferences), whichever copy was
// saved later, and nothing stored or sent from here holds a default that later reads as a choice.
function storedPreferences(raw: unknown) {
  const stored = isRecord(raw) ? raw : {};
  const valid = preferencesInUse(stored);
  const normalized = Object.fromEntries(Object.keys(stored).filter((key) => key !== 'restartKey').map((key) => [key, valid[key]]));

  if (!Object.hasOwn(stored, 'keybindings') && Object.hasOwn(stored, 'restartKey')) normalized.keybindings = normalizeKeybindings(null, stored.restartKey);

  if (Object.hasOwn(stored, 'stopOnError') && !Object.hasOwn(stored, 'correction')) normalized.correction = valid.correction;

  return normalized;
}

function historicalRunRecord(trace: HistoricalRecord, at: unknown): HistoricalRecord {
  const source = replaySource(trace);
  const attempt = createAttempt({ id: typeof trace.id === 'string' ? trace.id : '', text: source.text, textId: typeof trace.textId === 'string' ? trace.textId : '' });
  Object.assign(attempt, source);

  if (trace.status === 'complete' || trace.status === 'running' || trace.status === 'interrupted') attempt.status = trace.status;

  if (trace.kind === 'drill' || trace.kind === 'missed' || trace.kind === 'race' || trace.kind === 'lesson' || trace.kind === 'challenge' || trace.kind === 'retest' || trace.kind === 'daily' || trace.kind === 'custom') attempt.kind = trace.kind;

  if (isConditions(trace.conditions)) attempt.conditions = trace.conditions;

  if (typeof trace.target === 'string') attempt.target = trace.target;

  if (typeof trace.fresh === 'boolean') attempt.fresh = trace.fresh;
  attempt.interrupted = Boolean(trace.interrupted || trace.unsupportedInput || trace.stopped);
  const generated = runRecord(attempt, typeof at === 'string' ? at : null);

  const result: HistoricalRecord = { ...generated, id: trace.id, at, kind: trace.kind, status: trace.status,
    day: at ? dayKey(typeof at === 'string' || typeof at === 'number' || at instanceof Date ? at : String(at)) : null,
    conditions: trace.conditions, textId: trace.textId, fresh: trace.fresh,
    interrupted: Boolean(trace.interrupted || trace.unsupportedInput || trace.stopped), target: trace.target || null,
    challengeDate: trace.challengeDate || null, firstDailyAttempt: trace.firstDailyAttempt };

  if (trace.minimums) result.minimums = trace.minimums;

  if (trace.stopped) result.stopped = trace.stopped;

  if (trace.adaptive) result.adaptive = true;

  if (trace.drillSeconds) result.drillSeconds = trace.drillSeconds;

  return result;
}

// Stored traces leave out their summary (account.storedCopy); it is rebuilt from the events, as it was made.
const withSummary = (trace: HistoricalRecord) => (trace && !trace.summary && Array.isArray(trace.events) && typeof trace.text === 'string'
  ? { ...trace, summary: replayAttempt(replaySource(trace)) } : trace);

// A stored list keeps only its records. One null or stray value (a corrupt cache, a hand-edited row) would
// otherwise throw below, and the caller would read the whole copy as empty. Nothing inside a record is checked:
// older builds saved records with fewer fields, and they stay.
const recordsOf = (list: unknown): HistoricalRecord[] => (Array.isArray(list) ? list.filter(isRecord) : []);

export function normalizeProfile(stored: unknown): HydratedProfile {
  if (!isRecord(stored) || stored.version !== 2) return { ...emptyProfile() };
  const decoded: unknown = withoutConditionSets(stored);
  const parsed = isRecord(decoded) ? decoded : {};
  const rawPreferences: HistoricalRecord = {};

  if (isRecord(parsed.preferences)) Object.assign(rawPreferences, parsed.preferences);
  const preferencesAt: HistoricalRecord = {};

  if (isRecord(parsed.preferencesAt)) Object.assign(preferencesAt, parsed.preferencesAt);
  const oldChoice = preferencesAt.stopOnError || '';
  const newChoice = preferencesAt.correction || '';

  if (Object.hasOwn(rawPreferences, 'stopOnError') && (!Object.hasOwn(rawPreferences, 'correction') || String(oldChoice) > String(newChoice))) {
    rawPreferences.correction = correctionPreference({ stopOnError: rawPreferences.stopOnError });

    if (oldChoice) preferencesAt.correction = oldChoice;
  }

  const traces = recordsOf(parsed.attempts).map(withSummary);

  const records = Array.isArray(parsed.runs) ? recordsOf(parsed.runs) : traces.map((trace) => {
    // Older traces did not have wall-clock dates. Preserve unknown dates rather than invent them.
    const loop = recordsOf(parsed.loops).find((l) => l.afterAttemptId === trace.id);
    const best = Object.values(isRecord(parsed.bests) ? parsed.bests : {}).filter(isRecord).find((b) => b.attemptId === trace.id);

    return historicalRunRecord(trace, trace.at || loop?.at || best?.at || null);
  });

  const profile: HydratedProfile = {
    ...emptyProfile(),
    ...parsed,
    version: 2,
    preferences: storedPreferences(rawPreferences),
  };

  if (Object.keys(preferencesAt).length) profile.preferencesAt = preferencesAt;

  return Object.assign(profile, {
    attempts: retainTraces(settleDailyFirsts(traces)),
    ...retainHistory(settleDailyFirsts(records), validPracticeDays(parsed.practiceDays)),
    runCounts: retainRunCounts(parsed.runCounts),
    loops: recordsOf(parsed.loops),
    seenTextIds: Array.isArray(parsed.seenTextIds) ? parsed.seenTextIds.filter((id: unknown): id is string => typeof id === 'string') : [],
    // Stored bests are kept exactly as saved, including any an exhausted quote pool set before repeat quotes:
    // only a run from now on needs fresh text to set one (storeAttempt).
    bests: isRecord(parsed.bests)
      ? Object.fromEntries(Object.entries(parsed.bests).filter((entry): entry is [string, HistoricalRecord & { wpm: number }] => isRecord(entry[1]) && typeof entry[1].wpm === 'number' && Number.isFinite(entry[1].wpm)))
      : {},
    lessons: normalizeLessonProgress(parsed.lessons),
    compositions: normalizeCompositions(parsed.compositions),
  });
}

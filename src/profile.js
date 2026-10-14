// The stored profile's shape: the settings' defaults, and how a stored copy (this device's cache, another
// tab's, the account row) is read before anything uses or merges it (normalizeProfile).
import { customTextProblem, normalizeCustomText } from './typing.js';
import { DEFAULT_WORD_LIST, wordListIds } from './words.js';
import { retainRuns, runRecord, settleDailyFirsts } from './insights.js';

export const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const defaultPreferences = {
  mode: 'time',
  duration: 30,
  count: 25,
  punctuation: false,
  numbers: false,
  quoteLength: 'medium',
  difficulty: 'any',
  wordList: DEFAULT_WORD_LIST,
  fontSize: '28',
  liveMetrics: false,
  keyboard: false,
  stopOnError: false,
  focusMode: false,
  theme: 'system',
  customText: '',
  customOrder: 'as-written',
  paceCaret: 'off',
  paceWpm: 80,
};

export const CUSTOM_ORDERS = ['as-written', 'shuffled', 'random'];
export const PACE_MODES = ['off', 'best', 'average', 'last', 'custom'];
export const clampPace = (value) => Math.min(300, Math.max(10, Math.round(Number(value) || 80)));

// A new profile has chosen no settings, so it stores none (see storedPreferences).
export function emptyProfile() {
  return {
    version: 2,
    profileId: uid(),
    preferences: {},
    attempts: [],
    runs: [],
    loops: [],
    seenTextIds: [],
    bests: {},
  };
}

export function validPreferences(value) {
  if (!wordListIds.includes(value.wordList)) value.wordList = DEFAULT_WORD_LIST;
  const customText = typeof value.customText === 'string' ? normalizeCustomText(value.customText) : '';
  value.customText = customTextProblem(customText) ? '' : customText;
  if (!CUSTOM_ORDERS.includes(value.customOrder)) value.customOrder = 'as-written';
  if (!PACE_MODES.includes(value.paceCaret)) value.paceCaret = 'off';
  value.paceWpm = clampPace(value.paceWpm);
  return value;
}

// Every setting as used: the stored ones, and the default for each one the profile doesn't store.
export const preferencesInUse = (stored) => validPreferences({ ...defaultPreferences, ...stored });

// The settings a stored copy holds, each made one this build can use, and no others. A setting the copy
// lacks (its build didn't have it, or it was never chosen) stays absent rather than filled in with its
// default: a merge then takes it from a copy that has it (account.mergePreferences), whichever copy was
// saved later, and nothing stored or sent from here holds a default that later reads as a choice.
function storedPreferences(raw) {
  const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const valid = preferencesInUse(stored);
  return Object.fromEntries(Object.keys(stored).map((key) => [key, valid[key]]));
}

export function normalizeProfile(parsed) {
  if (parsed?.version !== 2) return emptyProfile();
  const traces = Array.isArray(parsed.attempts) ? parsed.attempts : [];
  const records = Array.isArray(parsed.runs) ? parsed.runs : traces.map((trace) => {
    // Older traces did not have wall-clock dates. Preserve unknown dates rather than invent them.
    const loop = parsed.loops?.find((l) => l.afterAttemptId === trace.id);
    const best = Object.values(parsed.bests || {}).find((b) => b.attemptId === trace.id);
    return runRecord(trace, trace.at || loop?.at || best?.at || null);
  });
  return {
    ...emptyProfile(),
    ...parsed,
    preferences: storedPreferences(parsed.preferences),
    attempts: settleDailyFirsts(traces),
    runs: retainRuns(settleDailyFirsts(records)),
    loops: Array.isArray(parsed.loops) ? parsed.loops : [],
    seenTextIds: Array.isArray(parsed.seenTextIds) ? parsed.seenTextIds : [],
    bests: parsed.bests && typeof parsed.bests === 'object' ? parsed.bests : {},
  };
}

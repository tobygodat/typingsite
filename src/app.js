import {
  CORPUS_VERSION,
  CUSTOM_MAX,
  CUSTOM_MIN_CHARS,
  CUSTOM_MIN_WORDS,
  METRIC_VERSION,
  atRunEnd,
  awaitingSubmit,
  RATE_FLOOR_MS,
  STANDARD_SECONDS,
  STANDARD_VERSION,
  accentComposition,
  carriedKey,
  TEST_COUNTS,
  TEST_DURATIONS,
  compareAttempts,
  completeAttempt,
  composedKeys,
  conditionKey,
  createAttempt,
  customTextProblem,
  inputRules,
  deadMark,
  makeDrill,
  minimumStop,
  normalizeCustomText,
  normalizeManualTarget,
  orderCustomText,
  passageComplete,
  correctionPreference,
  blocksOnError,
  allowsBackspace,
  failureFor,
  failureAtEnd,
  recommendTarget,
  refusesSpace,
  replayAttempt,
  selectPassage,
  standardConditions,
  summarizePatterns,
  textId,
  rawWpm,
  consistency,
  characterBreakdown,
  wordHistory,
} from './typing.js';
import { wordListIds } from './words.js';
import { DEFAULT_CODE_LANGUAGE, codePassage } from './code-snippets.js';
import { LENGTHS, isPresetLength, normalizeLengthPreferences, parseCustomLength } from './lengths.js';
import { DEFAULT_LAYOUT, FINGERS, isDefaultLayout, keyboardRows, layoutIds, layoutLabel, normalizeLayout } from './layouts.js';
import { createTypingFx } from './motion.js';
import { renderSpeedGraph } from './graph.js';
import { createPalette } from './palette.js';
import { normalizeKeybindings, matchesBinding, bindingLabel, ariaShortcuts, createKeybindingEditor } from './keybindings.js';
import { listenForSequence } from './egg.js';
import * as account from './account.js';
import { createOnlineRace } from './online-race.js';
import { createInbox } from './inbox.js';
import { boardColumn, boardCurrent, createFriendsBoard, optOutPending } from './friends-board.js';
import { forgetRace, listFriends, listRaceInvites } from './multiplayer.js';
import { CHALLENGE_DAYS, challengeConditions, challengeOutcome, challengePayload, challengeTextId, encodeTrace, finishChallenge, getChallenge,
  ghostPoints, leadVerb, listChallenges, outcomeRule, resultText, sameScore, scoreTrace, sendChallenge, traceTrouble, validTrace } from './ghost-race.js';
import { DAILY_GOALS, dayKey, goalMinutes, minutesByDay, practiceLevel, practiceStreak, recordPracticeTime, retainHistory, validPracticeDays, MAX_MISSED_WORDS, MAX_RUN_SUMMARIES, MIN_PATTERN_SAMPLES, STANDARD_MIN_RUNS, comparableKind, dailyChallengeId, dailyPassage, evidenceRun, filterRuns, keyAnalysis, missedAndSlowWords, passageBest, practiceRun, practiceTextConditions, practiceWordsPassage, recurringMissedWords, recurringTargets, runRecord, settleDailyFirsts, standardInputClass, standardScore, trendRun, validRun, weeklyChange } from './insights.js';
import { renderTrend } from './progress-view.js';
import { createReplayView } from './replay-view.js';
import { promptText } from './compose.js';
import { createCompose } from './compose-view.js';
import {
  FINGER_ZONES, LESSONS, LESSON_ACCURACY, fingerFor, keysLabel, lessonKeys, lessonOutcome, lessonPassage, lessonUnlocked, lessonsComplete,
  lessonsStarted, makeupCopy, makeupShort, nextLessonIndex, normalizeLessonProgress, recordLessonRun,
} from './lessons.js';
import { CUSTOM_ORDERS, MIN_ACCURACY_OPTIONS, MIN_WPM_OPTIONS, clampPace, defaultPreferences, emptyProfile, normalizeProfile, preferencesInUse, uid, validPreferences } from './profile.js';

const $ = (id) => document.getElementById(id);
const now = () => performance.now();

let customOpen = false;

function customPassage() {
  const text = normalizeCustomText(prefs.customText);
  if (!text) return null;
  return { id: null, text: orderCustomText(text, prefs.customOrder), fresh: false };
}

const customOrderLabel = (order) => ({ shuffled: 'shuffled words', random: 'random words' }[order] || 'as written');

let storageAvailable = true;
// No session means guest mode: default settings, and nothing leaves this tab.
let session = account.loadSession();
let syncTimer = 0;
// Saves only count as edits once the account row has been compared with the device cache;
// otherwise a boot-time save (marking the first passage seen) would make a stale cache look newer.
let cloudChecked = false;
let unsynced = false;
// Counts saves, so a push can tell whether anything changed while it was waiting on the network.
let localEdits = 0;
// The account row's updated_at as last merged here: the version a conditional write expects to replace.
let lastCloudAt = null;
// The device cache as this tab last wrote it, or took it in holding everything this tab had written;
// different text means another tab wrote since.
let cacheText = null;
let lastPull = 0;
let cacheWaiting = false;
// Another tab signed this account out, or the device is now signed in as someone else
// (followSessionElsewhere): this tab saves and sends nothing more for it, and starts again as the device
// now is once no run is in progress.
let signedOutElsewhere = false;
// A sign-out in another tab that sent everything names the copy of the device cache it sent before
// removing it (account.signOut). Its stamp is kept here until that removal is heard, so a copy removed
// that wasn't the one sent goes back for the next sign-in (finishFollow).
let pendingSignOut = null;
// The device cache as the last push that left nothing unsent stored it: what a sign-out here has sent.
// absorbCache moves cacheText, never this, so another tab's save taken in since never looks sent.
let sentText = null;
const PULL_INTERVAL_MS = 15000;

function loadProfile() {
  if (!session) return emptyProfile();
  cacheText = account.loadCachedProfileText(session.user.id);
  try { return normalizeProfile(JSON.parse(cacheText)); } catch { return emptyProfile(); }
}

let profile = loadProfile();
// The preferences in use. profile.preferences is what is stored and synced (only the settings chosen,
// never a default filled in: see normalizeProfile); merges change only that, and these follow it where
// that can't disturb a run (followStoredPreferences).
let prefs = preferencesInUse(profile.preferences);
// prefs as last committed or followed. A difference is an edit made in this tab.
let livePreferences = JSON.stringify(prefs);
let preferencesWaiting = false;
let sessionKind = 'practice';
let passage = null;
let attempt = null;
let startTime = null;
let ticker = null;
let primaryCharacters = [];
let primaryTextView = null;
let primaryNotice = '';
let liveSecond = -1;
// The time of the last key since a minimum stopped the run; see the Run again key guard.
let stopHold = null;
const STOP_HOLD_MS = 600;
// The open composition (an accent key's mark, or IME text): { type, attempt, refused, replaces, keyed,
// leaving, repeated, heldMark, key (Dead if an accent key's keydown opened it), mark (the first thing it
// showed) }, then once it ends, the { commit, at } still to be scored.
let composition = null;
// An input method's composition (no accent key opened it) that was let go while still open: its
// compositionend never came, or focus left first. The browser may yet send its commit as plain text.
let lostComposition = null;
// The last key press was a held accent key repeating, and it is still down: { mark } it shows (null if
// unknown). A composition that repeat opens is key repeat too (repeated), and so is plain text it sends
// (Windows). Forgotten when the field can no longer hear the key let go (blur, finish, restart).
let heldDeadKey = null;
// Windows has no composition: the key pressed after an accent key types the mark and, where they don't
// combine, itself, which can come as two inputs ("h). The mark waits for the key's own input, so the two
// are scored together: { type, attempt, key (that key), mark (its first input, once it came), at,
// repeated (the accent key was held: what the key types to commit its pending mark is repeat too) }.
let accentPair = null;
const primaryFx = createTypingFx($('typing-wrap'), $('text-display'), { ensureCharacters: (index) => primaryTextView?.ensureForward(index) });
const raceFx = createTypingFx(document.querySelector('.race-typing-wrap'), $('race-text-display'), { ensureCharacters: (index) => race.textView?.ensureForward(index) });
const prefersLight = matchMedia('(prefers-color-scheme: light)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// The completed run the results view shows: its numbers, run card graph and Watch replay. Only
// showResult sets it. `attempt` moves on without it (a drill whose retest is unavailable, the
// next run), so nothing on the results view reads `attempt`.
let shownResult = null;
let wordsPassage = null;
// The words the Train list last drew, so its button can tell when the runs changed underneath.
let missedListWords = [];
const ghostOn = () => prefs.paceCaret !== 'off';
let palette = null;
let keybindingEditor = null;
let onlineRace = null;
let inbox = null;
let friendsBoard = null;
let baselineAttempt = null;
let activeRecommendation = null;
let selectedTarget = null;
let trainingContext = null;
let resultBestBefore = null;
let resultPassageBefore = null;
let displayedIds = null;
let clearSnapshot = null;
// The label of the practice passage waiting when history was cleared, which undo gives back.
let clearedPassage = null;
let clearedAt = null;
let clearTimer = null;
let keyboardBuilt = '';
let keyboardTarget = null;
// Composing practice takes the passage's place on the practice screen; see openCompose.
let composeOpen = false;
let compose = null;
// The lesson being typed and the last lesson result in this tab (shown on the learn screen).
let lessonIndex = 0;
let lessonResult = null;
// The friend's recorded run being raced (sessionKind 'challenge'), and the run offered to friends.
let ghostRace = null;
// The Race still waiting for its challenge, and the offer's friend list still loading (see startGhostRace).
// A Race carries where it was clicked (raceContext); a later Race replaces it.
// The friend list belongs to the offer on screen: renderGhostOffer drops it when another run replaces it.
let ghostRequest = null;
let friendsRequest = null;
// Counts the sessions set up on the practice surface, and everything typed anywhere (a passage or a form
// field), so a Race can tell whether the person has set up something new or gone on typing since the click.
let sessionCount = 0;
let typedCount = 0;
// A Race's error that lands beside a run the person went on typing waits for the run to end (see runChanged).
let heldRaceError = '';
let offerRun = null;
let offerSentTo = new Set();
// One request id per friend for the offered run, repeated on a retry so the service stores it once.
let offerRequests = new Map();
// The offered run whose send is in flight. Only that request may release the Send button.
let offerSending = null;
const offerBusy = () => Boolean(offerRun) && offerSending === offerRun;
// For each clear still in force here, the copies merged here that it removed history from, as they were
// before it, so its Undo from any tab brings all of it back (account.mergeAndHold): { [marker]: [copy, …] }.
// A list goes back only with its own clear's undo. In memory only.
let heldClears = {};
// The history clears this tab had applied when its training state (baseline, results on show) was last
// checked against them, and where an older build's clear left history starting (legacyClearedAt).
let trainingClears = account.clearsApplied(profile);
let trainingLegacyAt = profile.legacyClearedAt || '';

let race = {
  passage: null,
  conditions: null,
  names: [],
  player: 0,
  attempt: null,
  startTime: null,
  results: [],
  characters: [],
  textView: null,
  notice: '',
};

// Signed in, the profile is cached on this device and synced to the account shortly after.
// A guest's profile lives only in memory, so there is nothing to fail.
function saveProfile() {
  commitPreferences();
  account.capHistory(profile);
  if (!session || signedOutElsewhere) return true;
  unsynced = true;
  localEdits += 1;
  if (cloudChecked) {
    account.stampProfile(profile);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushWhenIdle, 1500);
  }
  storageAvailable = storeLocally();
  return storageAvailable;
}

// The device cache is shared by every tab signed in to this account. Whatever another tab wrote since
// this one last read it is merged in first, so no tab overwrites another's runs or settings.
function storeLocally() {
  const userId = session.user.id;
  const stored = account.loadCachedProfileText(userId);
  // Signed out here (the sign-out removed the copy this tab had read, or kept it and left its marker), or
  // someone else signed in: this tab's copy must not come back. A session that only ended (its refresh
  // was refused) keeps caching, as before, so the next sign-in on this device merges these runs into the
  // account.
  const current = account.loadSession()?.user.id;
  if ((current && current !== userId) || (stored === null && cacheText !== null)) return false;
  if (signedOutElsewhere || account.signedOut(userId)) return false;
  if (stored && stored !== cacheText) {
    try {
      absorb(JSON.parse(stored));
      // Shown once the current step (often preparing a passage) has finished.
      setTimeout(showMerged);
    } catch {}
  }
  const text = JSON.stringify(profile);
  const saved = account.cacheProfileText(userId, text);
  if (saved) cacheText = text;
  return saved;
}

// Records preference edits made in this tab (only the settings that changed, on top of the stored ones,
// which may already hold a newer change from elsewhere) and stamps each for syncing. `chosen` names
// settings the person just picked: stamped even when the pick matches what is shown, so it outranks a
// different value from another tab or device that was waiting to apply.
function commitPreferences(chosen = []) {
  const json = JSON.stringify(prefs);
  if (json === livePreferences && !chosen.length) return;
  const before = JSON.parse(livePreferences);
  const edited = Object.keys(prefs).filter((key) => (key === 'keybindings' ? JSON.stringify(prefs[key]) !== JSON.stringify(before[key]) : prefs[key] !== before[key]) || chosen.includes(key));
  const stamps = profile.preferencesAt || {};
  profile.preferences = { ...profile.preferences, ...Object.fromEntries(edited.map((key) => [key, prefs[key]])) };
  profile.preferencesAt = { ...stamps, ...Object.fromEntries(edited.map((key) => [key, account.stampAfter(stamps[key])])) };
  livePreferences = json;
}

// Saves after the person picks settings, stamping the ones picked (see commitPreferences).
function saveChoice(...keys) {
  commitPreferences(keys);
  return saveProfile();
}

// Settings that only change how things look. Everything else is a test condition.
const DISPLAY_PREFERENCES = ['theme', 'fontSize', 'liveMetrics', 'keyboard', 'fingerMap', 'focusMode', 'keybindings', 'dailyGoal'];

const runInProgress = () => runActive || localRaceRunning();
const attemptPrepared = () => Boolean(attempt) && !['complete', 'interrupted'].includes(attempt.status);
// A practice passage nobody has started typing. Newer test conditions from elsewhere replace it, as a
// change of conditions here would; retests, drills and the daily keep the conditions they started with.
const untouchedPractice = () => sessionKind === 'practice' && attempt?.status === 'ready' && !attempt.events.length;

// Brings the preferences in use up to the stored ones once that can't disturb a run: nothing changes
// mid-run, and test conditions wait while a passage is prepared, so the passage on screen always
// matches the controls around it. resetSession passes conditions: true as it prepares the next one.
function followStoredPreferences({ conditions = !attemptPrepared() } = {}) {
  commitPreferences();
  if (runInProgress()) {
    preferencesWaiting = true;
    return;
  }
  const stored = { ...defaultPreferences, ...profile.preferences };
  const next = { ...prefs };
  let changedConditions = false;
  preferencesWaiting = false;
  for (const key of new Set([...Object.keys(stored), ...Object.keys(prefs)])) {
    if (key === 'keybindings' ? JSON.stringify(next[key]) === JSON.stringify(stored[key]) : next[key] === stored[key]) continue;
    if (!conditions && !DISPLAY_PREFERENCES.includes(key)) {
      preferencesWaiting = true;
      continue;
    }
    next[key] = stored[key];
    if (!DISPLAY_PREFERENCES.includes(key)) changedConditions = true;
  }
  const json = JSON.stringify(next);
  if (json === livePreferences) return;
  prefs = validPreferences(next);
  livePreferences = JSON.stringify(prefs);
  applyPreferences();
  if (changedConditions) setModeControls();
}

// Caps Lock warning: read from the modifier state on each key event in the typing field.
function setCapsWarning(on) {
  const warning = $('caps-warning');
  if ((warning.dataset.on === 'true') === on) return;
  warning.dataset.on = String(on);
  if (on) announce('Caps Lock is on');
}

function syncCapsLock(event) {
  if (typeof event.getModifierState !== 'function') return;
  setCapsWarning(event.getModifierState('CapsLock'));
}

// Messages announced in the same moment are read together (a toast held until a run ends, then the run's
// result), so a later one never replaces an earlier one before it is heard.
let announcing = [];
function announce(message) {
  if (!announcing.length) {
    $('announcement').textContent = '';
    requestAnimationFrame(() => { $('announcement').textContent = announcing.join(' '); announcing = []; });
  }
  if (!announcing.includes(message)) announcing.push(message);
}

// The person's own test settings. The standard test ignores them, but a race or the daily
// challenge started while standard is selected still uses them (minus the recipe).
function settingsConditions(inputClass = 'physical-keyboard') {
  return {
    mode: prefs.mode,
    duration: prefs.mode === 'time' ? prefs.duration : null,
    count: prefs.mode === 'words' ? prefs.count : null,
    punctuation: prefs.punctuation,
    numbers: ['quote', 'code'].includes(prefs.mode) ? false : Boolean(prefs.numbers),
    quoteLength: prefs.mode === 'quote' ? prefs.quoteLength : null,
    difficulty: prefs.mode === 'quote' ? prefs.difficulty : null,
    wordList: ['quote', 'code'].includes(prefs.mode) ? null : prefs.wordList,
    ...(prefs.mode === 'code' ? { codeLanguage: prefs.codeLanguage, punctuation: true } : {}),
    inputClass,
    layout: inputLayout(inputClass),
    correctionPolicy: prefs.correction,
    strictSpace: prefs.strictSpace,
    quickEnd: prefs.quickEnd,
    language: 'en',
    corpus: CORPUS_VERSION,
    metricVersion: METRIC_VERSION,
  };
}

function conditions(inputClass = 'physical-keyboard') {
  return prefs.mode === 'standard' ? { ...standardConditions(inputClass), layout: inputLayout(inputClass) } : settingsConditions(inputClass);
}

const CORRECTION_LABELS = { relaxed: 'continue on error', mandatory: 'stop on error', 'no-backspace': 'no backspace', 'fail-word': 'fail on word error', 'fail-any': 'fail on any error' };
function correctionLabel(policy) {
  return CORRECTION_LABELS[policy || 'mandatory'] || 'stop on error';
}

// "standard v1": the recipe name as people read it, then what the recipe fixes.
const recipeLabel = (recipe = STANDARD_VERSION) => recipe.replace('-', ' ');
const recipeSummary = (value = standardConditions()) => `${recipeLabel(value.recipe)} · ${value.duration} s · english 1k–10k mix · punctuation, numbers, one quote`;

// What every condition line ends with: input, correction rule and versions.
function conditionTail(value) {
  const input = inputLabel(value);
  return `${input} · ${correctionLabel(value.correctionPolicy)} · corpus ${(value.corpus || CORPUS_VERSION).replace(/^.*-(v\d+)$/, '$1')} · metric v1`;
}

// The parts of a conditions description, named and in the order it reads. The friends board's shape
// picker names a shape by the parts that tell it apart from the others.
function conditionParts(value = conditions()) {
  return {
    language: value.wordList ? `english ${value.wordList}` : 'english',
    length: value.mode === 'time' ? `${value.duration} s` : value.mode === 'words' ? `${value.count} words` : `${value.quoteLength || 'any'} quote`,
    text: value.mode === 'quote' ? value.difficulty || 'any difficulty' : `${value.punctuation ? 'punctuation' : 'plain'}${value.numbers ? ' · numbers' : ''}`,
    input: inputLabel(value),
    correction: `${correctionLabel(value.correctionPolicy)}${describeRules(value)}`,
    corpus: `corpus ${(value.corpus || CORPUS_VERSION).replace(/^.*-(v\d+)$/, '$1')}`,
    metric: 'metric v1',
  };
}
const inputName = (value) => inputLabel(value);

// Custom text has its own condition key, so it can never share a best, trend or retest with a test.
// It builds on the person's own settings, never the standard recipe: with standard selected underneath,
// a custom run keeps its own correction rule and gets no recipe, so its key is the same as in any mode.
// Settings add a language only in code mode, so it is dropped too.
function customConditions() {
  const { codeLanguage, ...base } = settingsConditions();
  return { ...base, mode: 'custom', duration: null, count: null, punctuation: false, numbers: false,
    quoteLength: null, difficulty: null, wordList: null, layout: DEFAULT_LAYOUT, strictSpace: false, quickEnd: true, customOrder: prefs.customOrder };
}

function describeConditions(value = conditions()) {
  // The recipe name stands for its punctuation, numbers and quote, keeping the run card's line short.
  if (value.mode === 'standard') return `${recipeLabel(value.recipe)} · ${value.duration} s · 1k–10k mix · ${conditionTail(value)}`;
  if (value.mode === 'code') {
    const { input, correction, corpus, metric } = conditionParts(value);
    return [`code · ${value.codeLanguage || DEFAULT_CODE_LANGUAGE}`, input, correction, corpus, metric, 'not counted toward bests'].join(' · ');
  }
  return Object.values(conditionParts(value)).join(' · ');
}

// Minimums ride along on the conditions line without joining the conditions key. The standard test
// has none: it is one fixed measurement, and a personal filter on which of its runs count would lift
// its score. Code runs have none either: they are never counted, so there is nothing for a minimum to guard.
function practiceMinimums() {
  if (prefs.mode === 'standard' || prefs.mode === 'code') return null;
  const minimums = {};
  if (prefs.minAccuracy) minimums.accuracy = prefs.minAccuracy;
  if (prefs.minWpm) minimums.wpm = prefs.minWpm;
  return Object.keys(minimums).length ? minimums : null;
}

function describeMinimums(minimums) {
  return [minimums?.accuracy ? `min ${minimums.accuracy}% accuracy` : '', minimums?.wpm ? `min ${minimums.wpm} wpm` : ''].filter(Boolean).join(' · ');
}

// "Stopped: accuracy fell below 95%" for a run ended on the tick; "Finished under your 98% minimum
// accuracy" for one that reached its end below it.
function stopReason(stop) {
  if (stop.atEnd) return `Finished under your ${stop.metric === 'accuracy' ? `${stop.minimum}% minimum accuracy` : `${stop.minimum} wpm minimum speed`}`;
  return `Stopped: ${stop.metric === 'accuracy' ? `accuracy fell below ${stop.minimum}%` : `speed fell below ${stop.minimum} wpm`}`;
}

// Strict space and quick end appear only when they differ from the defaults, as in conditionKey.
const RULE_LABELS = { 'strict-space': 'strict space', 'quick-end-off': 'quick end off' };
function describeRules(value) {
  return inputRules(value).map((rule) => ` · ${RULE_LABELS[rule]}`).join('');
}

// A drill is always one minute of generated text, whatever the baseline was. Its conditions record
// quick end at the default (sessionConditions), so only rules that applied are listed.
// The layout setting describes a physical keyboard, so touch runs always keep the default key.
function inputLayout(inputClass) {
  return inputClass === 'touch' ? DEFAULT_LAYOUT : prefs.layout;
}

// The layout is named only when it isn't QWERTY; runs saved before layouts existed read as QWERTY.
function inputLabel(value) {
  const input = value.inputClass === 'touch' ? 'touch input' : 'physical keyboard';
  return isDefaultLayout(value.layout) ? input : `${input} · ${layoutLabel(value.layout)}`;
}

function describeRun(run) {
  if (run.kind === 'lesson') return describeLesson(run);
  if (run.kind === 'challenge') return `ghost race · ${describeConditions(run.conditions)}`;
  if (run.kind === 'daily') return `daily · ${run.challengeDate} · ${run.firstDailyAttempt ? 'first attempt' : 'repeat attempt'}${run.firstDailyAttempt && !run.fresh ? ' · previously displayed passage' : ''} · ${describeConditions(run.conditions)}`;
  if (run.kind === 'missed') return `missed words · not counted · ${run.text?.split(' ').length || 40} words${run.conditions.punctuation ? ' · punctuation' : ''}${run.conditions.numbers ? ' · numbers' : ''} · ${run.conditions.inputClass === 'touch' ? 'touch input' : 'physical keyboard'} · ${correctionLabel(run.conditions.correctionPolicy)}`;
  if (run.kind === 'custom') return `custom text · ${customOrderLabel(run.conditions.customOrder)} · ${run.conditions.inputClass === 'touch' ? 'touch input' : 'physical keyboard'} · ${correctionLabel(run.conditions.correctionPolicy)} · not counted`;
  if (run.kind !== 'drill') return `${run.fresh === false ? 'repeated text · ' : ''}${[describeConditions(run.conditions), describeMinimums(run.minimums)].filter(Boolean).join(' · ')}`;
  return `drill · 60 s · english · ${inputLabel(run.conditions)} · ${correctionLabel(run.conditions.correctionPolicy)}${describeRules(run.conditions)}`;
}

function describeLesson(run) {
  const index = LESSONS.findIndex((lesson) => lesson.id === run.conditions.lesson);
  return `lesson ${index + 1} of ${LESSONS.length} · keys ${lessonKeys(index).join(' ')} · ${makeupShort(index, run.lesson)} · pass at ${LESSON_ACCURACY}% accuracy and ${LESSONS[index].wpm} wpm · ${inputName(run.conditions)} · ${correctionLabel(run.conditions.correctionPolicy)}`;
}

// Lesson runs carry their own conditions: never comparable with a practice key, never a best.
function lessonConditions() {
  return {
    mode: 'lesson', lesson: LESSONS[lessonIndex].id, duration: null, count: null, punctuation: false, numbers: false,
    quoteLength: null, difficulty: null, wordList: null, inputClass: 'physical-keyboard',
    correctionPolicy: conditions().correctionPolicy, language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION,
  };
}

// A tap that starts a session focuses the input and opens the soft keyboard, so no pointerdown reaches
// the input: the activating press says touch instead. A pen opens the soft keyboard (or a handwriting panel)
// just as a finger does, so every pointer but a mouse is touch. Mouse clicks, and clicks made with a key
// (no pointer type), are a physical keyboard.
const startedBy = (event) => (event?.pointerType && event.pointerType !== 'mouse' ? 'touch' : 'physical-keyboard');
// The input class of the latest press (see bindEvents). resetSession gives it to every new run, so a run is
// classed by whatever started it: a button, the palette, Esc, Run again or a hand-off, with no path left over.
let activationInput = 'physical-keyboard';
const TEXT_FIELDS = 'textarea, input:not([type="checkbox"])';

function signed(value, unit) {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value)} ${unit}`;
}

// The live numbers tick ten times a second; only touch the DOM when the text changes.
function setText(element, value) {
  const text = String(value);
  if (element.textContent !== text) element.textContent = text;
}

// Whether an attempt or race is in progress. body[data-running] follows it so the CSS can fade
// the chrome mid-run, but a pointer nudge only reveals the chrome; the run itself goes on.
let runActive = false;
function setRunning(running) {
  if (runActive !== running) {
    runActive = running;
    runChanged();
  }
  if (!running) flushDeferredSync();
  showChrome(!running);
}
// A run began or ended: what waited for its end appears now.
function runChanged() {
  inbox?.runChanged();
  if (!heldRaceError || runInProgress()) return;
  showAccountToast(heldRaceError);
  heldRaceError = '';
}

// Changes from other tabs and devices held back while a run was in progress, taken in as soon as none
// is: when a run, race turn or race ends, is interrupted or restarts, or the view changes. The data merges
// at once, so the run that just ended is labelled and stored against it and the next passage is drawn
// from it; the screen catches up just after.
function flushDeferredSync() {
  if (runInProgress()) return;
  if (signedOutElsewhere) {
    // A sign-out that sent everything reloads once its removal of the cache is heard (finishFollow).
    if (pendingSignOut === null) location.reload();
    return;
  }
  if (cacheWaiting && absorbCache()) setTimeout(showMerged);
  if (preferencesWaiting) followStoredPreferences();
  forgetClearedTraining();
}

// A one-keyboard race never sets runActive; its turns start, end and restart here.
function raceRunChanged() {
  runChanged();
  flushDeferredSync();
}

// Skip no-op writes on every keystroke.
function showChrome(shown) {
  const value = String(!shown);
  if (document.body.dataset.running !== value) document.body.dataset.running = value;
}

// The footer best belongs to the session on screen. A custom session (any non-comparable kind) has no best,
// so it says it isn't counted rather than showing the best for the time or word settings underneath it.
// The run's input class picks the best, so a touch run never shows the physical-keyboard one, or the reverse.
function currentBestKey() {
  return comparableKind(sessionKind) ? conditionKey(attempt?.conditions || conditions()) : null;
}

function showBest() {
  const key = currentBestKey();
  // Code runs have their own key but never set a best. (A custom session over code says it isn't counted.)
  if (key && (attempt?.conditions || conditions()).mode === 'code') { $('best').textContent = 'Code runs aren’t ranked'; return; }
  const best = key && profile.bests[key];
  $('best').textContent = !key ? 'Not counted' : best ? `Best · ${best.wpm} wpm` : 'No best yet';
}

function resolvedTheme() {
  if (prefs.theme === 'light' || prefs.theme === 'dark') return prefs.theme;
  return prefersLight.matches ? 'light' : 'dark';
}

function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = theme === 'light' ? '#f4f1eb' : '#0f0f0e';
  $('theme-select').value = prefs.theme;
}

// Slides a group's pill under its selected control; used by the dock and the segmented controls.
function updateGlide(container, { instant = false } = {}) {
  let pill = container.querySelector(':scope > .glide-pill');
  if (!pill) {
    pill = document.createElement('span');
    pill.className = 'glide-pill';
    pill.setAttribute('aria-hidden', 'true');
    container.prepend(pill);
  }
  const target = container.querySelector(container.dataset.glide === 'current' ? ':scope > [aria-current="page"]' : ':scope > [aria-pressed="true"]');
  if (!target || !target.offsetWidth) {
    pill.style.setProperty('--pill-o', '0');
    return;
  }
  if (instant) container.classList.add('no-anim');
  pill.style.setProperty('--pill-x', `${target.offsetLeft}px`);
  pill.style.setProperty('--pill-y', `${target.offsetTop}px`);
  pill.style.setProperty('--pill-w', `${target.offsetWidth}px`);
  pill.style.setProperty('--pill-h', `${target.offsetHeight}px`);
  pill.style.setProperty('--pill-o', '1');
  if (instant) requestAnimationFrame(() => requestAnimationFrame(() => container.classList.remove('no-anim')));
}

function updateGlides(options) {
  document.querySelectorAll('.glide').forEach((container) => updateGlide(container, options));
}

function applyPreferences() {
  document.body.dataset.fontSize = prefs.fontSize;
  primaryFx.relayout();
  document.body.dataset.liveMetrics = String(prefs.liveMetrics);
  document.body.dataset.keyboard = String(prefs.keyboard);
  document.body.dataset.focusMode = String(prefs.focusMode);
  $('font-size').value = prefs.fontSize;
  $('live-toggle').checked = prefs.liveMetrics;
  $('keyboard-toggle').checked = prefs.keyboard;
  syncRules();
  $('finger-toggle').checked = prefs.fingerMap;
  $('finger-row').hidden = !prefs.keyboard;
  $('correction-select').value = prefs.correction;
  $('focus-toggle').checked = prefs.focusMode;
  $('keyboard').hidden = !prefs.keyboard && sessionKind !== 'lesson';
  renderKeyboard();
  applyTheme();
  $('punctuation-toggle').checked = prefs.punctuation;
  $('numbers-toggle').checked = Boolean(prefs.numbers);
  $('quote-length').value = prefs.quoteLength;
  $('quote-difficulty').value = prefs.difficulty;
  $('word-list').value = prefs.wordList;
  $('repeat-quotes-toggle').checked = prefs.repeatQuotes;
  keybindingEditor?.refresh();
  document.querySelectorAll('.restart-key-hint').forEach((key) => { key.textContent = bindingLabel(prefs.keybindings.restart); });
  $('restart-button').title = prefs.keybindings.restart ? `Restart test (${bindingLabel(prefs.keybindings.restart)})` : 'Restart test';
  $('exit-focus-hint').textContent = bindingLabel(prefs.keybindings.exitFocus);
  for (const [id, action] of [['restart-button', 'restart'], ['palette-trigger', 'commands'], ['exit-focus', 'exitFocus']]) {
    const shortcuts = ariaShortcuts(prefs.keybindings[action]);
    if (shortcuts) $(id).setAttribute('aria-keyshortcuts', shortcuts);
    else $(id).removeAttribute('aria-keyshortcuts');
  }
  document.querySelectorAll('.command-key').forEach((key) => { key.textContent = bindingLabel(prefs.keybindings.commands); });
  $('layout-select').value = prefs.layout;
  $('daily-goal').value = String(prefs.dailyGoal);
  syncLockedSettings();
  $('min-accuracy').value = String(prefs.minAccuracy);
  $('min-wpm').value = String(prefs.minWpm);
  showMinimumNote();
  armPace();
  showBest();
}

// Minimums decide which practice runs count, and custom text never counts, so a custom run has none and
// runs to the end like a drill: the note stands aside while Custom or composing is on, as the test
// controls do, and while the standard test is selected (practiceMinimums).
function showMinimumNote() {
  const minimums = describeMinimums(practiceMinimums());
  $('minimum-note').textContent = minimums;
  $('minimum-note').hidden = !minimums || customOpen || composeOpen || sessionKind === 'custom';
}

// Why a rule switch can't change the session on hand, shown under it and read as its description.
const RULE_NOTES = {
  drill: 'drills end on the clock',
  timed: 'timed runs end on the clock',
  stopOnError: 'quick end applies only to free correction',
  daily: 'the daily keeps its own rules',
  retest: 'a retest keeps its baseline’s rules',
  custom: 'custom text keeps the default rules',
  race: 'a race keeps the same rules for both players',
  lesson: 'a lesson keeps its own rules',
  missed: 'word practice keeps the default rules',
  challenge: 'a ghost race keeps its sender’s rules',
  standard: 'the standard test keeps its own rules',
};

// Quick end only changes word and quote runs that let a mistake stand. Where the session can't take
// it the switch is disabled but keeps its value, like punctuation in a quote test; #rules-note says
// when the session keeps the rules it started with. Synced on every preference, view and Challenge
// tab change, and when a one-keyboard race starts or ends.
function syncRules() {
  const limits = ruleLimits(ruleSession());
  $('strict-space-toggle').checked = prefs.strictSpace;
  $('quick-end-toggle').checked = prefs.quickEnd;
  $('quick-end-toggle').disabled = Boolean(limits.quickEnd);
  for (const [id, reason] of [['quick-end-note', limits.quickEnd], ['rules-note', limits.fixed]]) {
    $(id).textContent = RULE_NOTES[reason] || '';
    $(id).hidden = !reason;
  }
}

// The standard test fixes word list, punctuation, numbers and correction. Their controls show the
// recipe's values and stay locked while it is selected; the person's own settings are kept for other modes.
// A custom passage loaded over it uses the person's own settings (customConditions), so they unlock for it.
const standardLocked = () => prefs.mode === 'standard' && sessionKind !== 'custom';

function syncLockedSettings() {
  const standard = standardLocked();
  // Quotes and code snippets are fixed text, so these settings don't apply to them.
  const fixed = ['quote', 'code'].includes(prefs.mode);
  $('punctuation-toggle').disabled = fixed || standard;
  $('punctuation-toggle').checked = standard || prefs.punctuation;
  $('numbers-toggle').disabled = fixed || standard;
  $('numbers-toggle').checked = standard || Boolean(prefs.numbers);
  $('word-list').disabled = fixed || standard;
  // The recipe's value exists only while standard is selected, so type-ahead can never pick it.
  const recipeOption = $('word-list').querySelector('option[value="standard"]');
  if (standard && !recipeOption) $('word-list').append(new Option('1k–10k', 'standard'));
  if (!standard) recipeOption?.remove();
  $('word-list').value = standard ? 'standard' : prefs.wordList;
  $('repeat-quotes-toggle').disabled = prefs.mode !== 'quote';
  $('correction-select').disabled = standard;
  $('correction-select').value = standard ? 'mandatory' : prefs.correction;
  document.querySelectorAll('.preference-lock').forEach((note) => { note.hidden = !standard; });
}

function setModeControls() {
  // Composing takes the passage's place, so Custom is never marked over it.
  const custom = !composeOpen && (customOpen || sessionKind === 'custom');
  $('mode-custom').classList.toggle('is-active', custom);
  $('mode-custom').setAttribute('aria-pressed', String(custom));
  $('mode-custom').setAttribute('aria-expanded', String(customOpen));
  $('custom-options').hidden = !customOpen;
  document.querySelectorAll('[data-mode]').forEach((button) => {
    const selected = !custom && !composeOpen && button.dataset.mode === prefs.mode;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('mode-compose').classList.toggle('is-active', composeOpen);
  $('mode-compose').setAttribute('aria-pressed', String(composeOpen));
  $('quote-options').hidden = custom || composeOpen || prefs.mode !== 'quote';
  $('standard-options').hidden = custom || composeOpen || prefs.mode !== 'standard';
  $('standard-recipe').textContent = `${recipeSummary()} · ${correctionLabel(standardConditions().correctionPolicy)}`;
  syncLockedSettings();
  $('duration-options').hidden = custom || composeOpen || ['quote', 'standard', 'code'].includes(prefs.mode);
  // Custom text and composing hide the code language row, as they do the lengths.
  $('code-options').hidden = custom || composeOpen || prefs.mode !== 'code';
  $('code-options').querySelectorAll('[data-language]').forEach((button) => {
    const selected = button.dataset.language === prefs.codeLanguage;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelector('.compact-switch').hidden = custom || composeOpen;
  showMinimumNote();
  if (custom || composeOpen || prefs.mode === "standard") closeCustomLength();
  renderLengthOptions();
  showBest();
  requestAnimationFrame(() => updateGlides());
}

// The four presets and the custom pill are relabelled in place, never rebuilt, so a click that
// lands just as the custom field commits on blur still reaches the button under the pointer.
function renderLengthOptions() {
  setCustomLengthError('');
  const spec = LENGTHS[prefs.mode];
  if (!spec) {
    closeCustomLength();
    return;
  }
  const current = prefs[spec.key];
  $('duration-options').querySelectorAll('[data-length]').forEach((button, index) => {
    const value = spec.presets[index];
    const selected = value === current;
    button.textContent = String(value);
    button.dataset.length = String(value);
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', `${value} ${spec.unit}`);
  });
  const custom = !isPresetLength(prefs.mode, current);
  const button = $('custom-length');
  button.textContent = custom ? String(current) : 'custom';
  button.classList.toggle('is-active', custom);
  button.setAttribute('aria-pressed', String(custom));
  button.setAttribute('aria-label', custom ? `custom ${spec.noun}, ${current} ${spec.unit}` : `custom ${spec.noun}`);
  if ($('custom-length-form').dataset.lengthMode !== prefs.mode) closeCustomLength();
}

// The custom pill turns into a short field in place. Enter, or leaving the field with a valid
// number, sets the length; Escape puts the pill back. Guests keep the value for the tab only.
let dropCustomLength = false;

// Set even when unchanged, so a second bad entry is announced again.
function setCustomLengthError(message) {
  const node = $('custom-length-error');
  if (message || node.textContent) node.textContent = message;
}

function openCustomLength(mode = prefs.mode) {
  const spec = LENGTHS[mode];
  if (!spec) return;
  // A new length restarts the run anyway; a timed run must not end under the open field.
  if (attempt?.status === 'running') resetSession('practice');
  const form = $('custom-length-form');
  const input = $('custom-length-input');
  form.dataset.lengthMode = mode;
  dropCustomLength = false;
  input.value = prefs[spec.customKey] ? String(prefs[spec.customKey]) : '';
  input.dataset.offered = input.value;
  input.placeholder = `${spec.min}–${spec.max}`;
  input.setAttribute('aria-label', `${mode === 'time' ? 'custom time in seconds' : 'custom number of words'}, ${spec.min} to ${spec.max}`);
  input.setAttribute('aria-invalid', 'false');
  setCustomLengthError('');
  $('custom-length').hidden = true;
  form.hidden = false;
  document.querySelector('.practice-controls').dataset.editing = 'true';
  updateGlide($('duration-options'), { instant: true });
  input.focus({ preventScroll: true });
  input.select();
}

function closeCustomLength({ focus = false } = {}) {
  const form = $('custom-length-form');
  if (form.hidden) return;
  // Hidden before focus moves, so the field's own focusout sees it closed and does nothing.
  form.hidden = true;
  $('custom-length').hidden = false;
  delete document.querySelector('.practice-controls').dataset.editing;
  $('custom-length-input').setAttribute('aria-invalid', 'false');
  updateGlide($('duration-options'), { instant: true });
  // Focus mode hides the row again, pill included, so focus goes back to the passage.
  if (focus) (prefs.focusMode ? $('typing-input') : $('custom-length')).focus({ preventScroll: true });
}

function commitCustomLength({ leaving = false } = {}) {
  const mode = $('custom-length-form').dataset.lengthMode;
  const spec = LENGTHS[mode];
  const input = $('custom-length-input');
  const raw = input.value.trim();
  // Leaving an empty or untouched field is not a request to change anything; the remembered value
  // offered in the field is applied only with Enter.
  if (leaving && (!raw || raw === input.dataset.offered)) {
    closeCustomLength();
    return;
  }
  const result = parseCustomLength(mode, raw);
  if (!result.ok) {
    if (leaving) closeCustomLength();
    else {
      input.setAttribute('aria-invalid', 'true');
      input.select();
    }
    setCustomLengthError(result.message);
    return;
  }
  closeCustomLength();
  if (prefs.mode === mode && prefs[spec.key] === result.value) {
    saveChoice('mode', spec.key, ...(!isPresetLength(mode, result.value) ? [spec.customKey] : []));
    if (!leaving) $('typing-input').focus({ preventScroll: true });
    return;
  }
  prefs.mode = mode;
  prefs[spec.key] = result.value;
  if (!isPresetLength(mode, result.value)) prefs[spec.customKey] = result.value;
  setModeControls();
  saveChoice('mode', spec.key, ...(!isPresetLength(mode, result.value) ? [spec.customKey] : []));
  // Focus stays wherever the person went when they left the field.
  resetSession('practice', { focus: !leaving });
}

function bindCustomLength() {
  const form = $('custom-length-form');
  const input = $('custom-length-input');
  $('custom-length').addEventListener('click', () => openCustomLength(prefs.mode));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    commitCustomLength();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // Escape belongs to the field here, not to restart or focus mode.
    event.preventDefault();
    event.stopPropagation();
    setCustomLengthError('');
    closeCustomLength({ focus: true });
  });
  // Pressing another length, mode or switch in the row means that control wins; the edit is dropped.
  const controls = document.querySelector('.practice-controls');
  controls.addEventListener('pointerdown', (event) => {
    if (!form.hidden && !form.contains(event.target)) dropCustomLength = true;
  });
  controls.addEventListener('pointercancel', () => { dropCustomLength = false; });
  form.addEventListener('focusout', (event) => {
    // Switching windows keeps the field open; the browser hands focus back on return.
    if (form.hidden || form.contains(event.relatedTarget) || !document.hasFocus()) return;
    // In focus mode the row hides again as the field closes, so focus bound for it would be lost.
    const stranded = prefs.focusMode && (!event.relatedTarget || controls.contains(event.relatedTarget));
    if (dropCustomLength) {
      dropCustomLength = false;
      closeCustomLength();
    } else commitCustomLength({ leaving: true });
    if (stranded) $('typing-input').focus({ preventScroll: true });
  });
}

// A mode change resets once, in the new mode, so a quote is never drawn (and marked seen) only to be replaced.
// Custom text hides the length row, so from its editor or session this goes through setTestShape too, which
// closes the editor and starts a test in this mode, as the length buttons do.
function setCustomLengthFromPalette(mode) {
  if (prefs.mode !== mode || customOpen || sessionKind === 'custom') setTestShape(mode);
  else navigate('practice');
  openCustomLength(mode);
}

function renderText(display, text) {
  const words = text.split(' ');
  const characters = [];
  const characterWords = [];
  const groups = [];
  let renderedWords = 0;
  let firstRenderedWord = 0;
  let lastTrimPosition = 0;

  words.forEach((word, wordIndex) => {
    const group = document.createElement('span');
    group.className = 'word';
    group.dataset.wordIndex = String(wordIndex);
    for (const letter of word) {
      const span = document.createElement('span');
      span.className = 'char';
      span.textContent = letter;
      group.append(span);
      characters.push(span);
      characterWords.push(wordIndex);
    }
    if (wordIndex < words.length - 1) {
      const space = document.createElement('span');
      space.className = 'char';
      space.textContent = ' ';
      groups.push([group, space]);
      characters.push(space);
      characterWords.push(wordIndex + 1);
    } else groups.push([group]);
  });

  function appendWords(wordCount) {
    const fragment = document.createDocumentFragment();
    const end = Math.min(groups.length, renderedWords + wordCount);
    while (renderedWords < end) {
      fragment.append(...groups[renderedWords]);
      renderedWords += 1;
    }
    display.insertBefore(fragment, display.querySelector('.caret'));
  }

  function ensureForward(position) {
    const targetWord = characterWords[Math.min(position + 160, characters.length - 1)] || 0;
    if (targetWord >= renderedWords) appendWords(Math.max(80, targetWord - renderedWords + 1));
  }

  display.replaceChildren();
  appendWords(100);
  characters[0]?.classList.add('current');
  return {
    characters,
    ensureAhead(position) {
      const currentWord = characterWords[Math.min(position, characters.length - 1)] || 0;
      // A separator before the first mounted word maps to that word, but is
      // itself detached. Remount it when backspacing reaches the boundary.
      if (currentWord < firstRenderedWord || (currentWord === firstRenderedWord && !characters[position]?.isConnected)) {
        const fragment = document.createDocumentFragment();
        for (let index = 0; index < firstRenderedWord; index += 1) fragment.append(...groups[index]);
        display.querySelector('.passage-spacer')?.remove();
        display.insertBefore(fragment, display.querySelector('.word'));
        firstRenderedWord = 0;
        lastTrimPosition = position;
      }
      ensureForward(position);
    },
    ensureForward,
    trimBehind(position) {
      if (position - lastTrimPosition < 160) return;
      lastTrimPosition = position;
      const current = characters[position];
      if (!current?.isConnected) return;
      const lineHeight = parseFloat(getComputedStyle(display).lineHeight) || 48;
      const currentTop = (current.closest('.word') || current).offsetTop;
      const keepTop = currentTop - lineHeight * 3;
      if (keepTop <= 0) return;
      let firstKept = null;
      for (const word of display.querySelectorAll('.word')) {
        if (word.offsetLeft <= 1 && word.offsetTop <= keepTop) firstKept = word;
        else if (word.offsetTop > keepTop) break;
      }
      if (!firstKept || firstKept === display.querySelector('.word')) return;
      const height = firstKept.offsetTop;
      const spacer = document.createElement('span');
      spacer.className = 'passage-spacer';
      spacer.style.height = `${height}px`;
      for (const child of [...display.childNodes]) {
        if (child === firstKept) break;
        if (child.classList?.contains('caret') || child.classList?.contains('ghost-caret')) continue;
        child.remove();
      }
      display.insertBefore(spacer, firstKept);
      firstRenderedWord = Number(firstKept.dataset.wordIndex);
    },
  };
}

function updateCharacterStates(characters, typed, target, start = 0) {
  const from = Math.max(0, start - 1);
  const to = Math.min(characters.length, Math.max(typed.length + 2, start + 2));
  for (let index = from; index < to; index += 1) {
    let state = 'char';
    if (index < typed.length) state = typed[index] === target[index] ? 'char correct' : 'char wrong';
    else if (index === typed.length) state = 'char current';
    // Only touch changed characters so settled letters keep their finished animation.
    if (characters[index].className !== state) characters[index].className = state;
  }
}

// Repeats are for open practice only: a retest always needs text the profile hasn't seen. Code snippets
// come round again once each has been shown, marked not fresh, whatever the repeat setting.
function choosePassage(extraSeen = [], { allowRepeats = false } = {}) {
  if (prefs.mode === 'code') return { ...codePassage(prefs.codeLanguage, { seenIds: [...profile.seenTextIds, ...extraSeen] }), corpus: CORPUS_VERSION };
  return selectPassage({
    mode: prefs.mode,
    count: prefs.count,
    duration: prefs.duration,
    punctuation: prefs.punctuation,
    numbers: Boolean(prefs.numbers),
    quoteLength: prefs.quoteLength,
    difficulty: prefs.difficulty,
    wordList: prefs.wordList,
    seenIds: [...profile.seenTextIds, ...extraSeen],
    allowRepeats,
  });
}

// Custom text is never fresh, but it is its own session, not a repeat: it gets no repeated-text notice.
function repeatedTextNotice() {
  if (sessionKind !== 'practice' || passage?.fresh !== false) return '';
  return passage.exhausted && !prefs.repeatQuotes && prefs.mode === 'quote'
    ? 'You’ve seen every matching quote. Repeated text doesn’t count toward your best.'
    : 'Repeated text · doesn’t count toward your best.';
}

// The passage's own notice. Its hidden twin holds the footer at the notice's height, so a shorter hint
// that replaces it mid-run (a blocked letter) never moves restart or the passage.
function setPassageNotice(text) {
  primaryNotice = text;
  $('input-help').textContent = text;
  $('input-help-reserve').textContent = text;
}

// Restarting or changing a setting keeps a custom passage; every other session restarts as practice.
const restartKind = () => (sessionKind === 'custom' && prefs.customText ? 'custom' : 'practice');

// Daily and missed-word passages run to the end of their text, whatever the practice shape is.
function sessionDurationMs(kind = sessionKind) {
  if (kind === 'challenge') return ghostRace?.duration ? ghostRace.duration * 1000 : null;
  if (['daily', 'lesson', 'missed', 'race'].includes(kind)) return null;
  if (kind === 'drill') return 60000;
  if (kind === 'custom') return null;
  if (prefs.mode === 'time') return prefs.duration * 1000;
  if (prefs.mode === 'standard') return STANDARD_SECONDS * 1000;
  return null;
}

// Why strict space and quick end can't change a session's run, read from the session itself (its
// kind, its timing and the conditions its run was built with), never from the test-shape
// preferences: a drill started from a words baseline is still a timed minute. quickEnd names why
// quick end does nothing there ('' when it applies); fixed names a session that keeps the rules it
// started with (the daily's are set, a retest has to match its baseline, custom text keeps the
// defaults, and a race under way keeps its own for both players).
const FIXED_RULE_KINDS = ['daily', 'retest', 'custom', 'lesson', 'missed', 'challenge'];
function ruleLimits({ kind, run, fixed = FIXED_RULE_KINDS.includes(kind) }) {
  return {
    fixed: run.mode === 'standard' ? 'standard' : fixed ? kind : '',
    quickEnd: sessionDurationMs(kind) !== null ? (kind === 'drill' ? 'drill' : 'timed')
      : run.correctionPolicy === 'relaxed' ? '' : 'stopOnError',
  };
}

// The session the rule switches act on. On the Challenge screen's one-keyboard tab it is the race:
// the one under way, whose rules startRace fixed for both players, or else the next one. Elsewhere
// it is the run waiting or in progress or, once it's over, the next one, which Run again makes the
// daily again, the same custom text or a practice run.
function ruleSession() {
  if (document.body.dataset.view === 'compete' && onlineRace?.mode === 'local') {
    return raceUnderWay() ? { kind: 'race', run: race.conditions, fixed: true } : { kind: 'race', run: raceConditions() };
  }
  if (attempt && ['ready', 'running'].includes(attempt.status)) return { kind: sessionKind, run: attempt.conditions };
  const kind = sessionKind === 'daily' ? 'daily' : restartKind();
  return { kind, run: sessionConditions(kind) };
}

// The conditions a new run of this kind is built with. The daily's rules are fixed and a retest
// takes its baseline's, whatever the switches say now. A rule that can't change the run is recorded
// at its default, so a drill's conditions and key never carry quick end.
function sessionConditions(kind, run = conditions()) {
  if (kind === 'daily') return dailyConditions();
  if (kind === 'custom') return customConditions();
  if (kind === 'lesson') return lessonConditions();
  if (kind === 'challenge') return ghostConditions();
  if (kind === 'missed') return { ...run, strictSpace: false, quickEnd: true };
  if (kind === 'retest' && baselineAttempt) {
    run.strictSpace = baselineAttempt.conditions.strictSpace === true;
    run.quickEnd = baselineAttempt.conditions.quickEnd !== false;
  }
  if (ruleLimits({ kind, run }).quickEnd) run.quickEnd = true;
  return run;
}

function configureSessionCopy() {
  const copy = {
    practice: ['practice', 'Practice', ''],
    drill: ['drill · 1 min', selectedTarget ? `Practice “${selectedTarget}”` : 'General drill', 'Doesn’t count toward your best.'],
    custom: ['custom text', 'Your text', 'Doesn’t count toward your best.'],
    retest: ['fresh-text retest', 'Measure the change', passage?.fresh === false ? 'You’ve seen every matching quote, so this can’t be a fresh comparison.' : 'Fresh text, same conditions.'],
    missed: ['missed words', wordsPassage?.recurring ? 'Practice words you keep missing' : 'Practice missed and slowest words', 'Doesn’t count toward your best.'],
    daily: ['daily challenge', 'Today’s passage', `${passage?.day} · resets at midnight UTC · ${passage?.firstDailyAttempt ? 'first attempt' : 'repeat attempt'}${passage?.firstDailyAttempt && !passage?.fresh ? ' · previously displayed passage' : ''}`],
    lesson: ['lesson', `Lesson ${lessonIndex + 1} · ${keysLabel(LESSONS[lessonIndex].keys)}`, lessonCopy(lessonIndex, passage)],
    challenge: ['ghost race', `Race ${ghostRace?.name}’s run`, `The ghost caret replays ${ghostRace?.name}’s keystrokes from your first key. Your first finish without a break is sent. Not counted toward your best.`],
  }[sessionKind];
  $('session-kicker').textContent = copy[0];
  $('session-title').textContent = copy[1];
  $('session-description').textContent = copy[2];
  $('typing-screen').dataset.session = sessionKind;
  document.body.dataset.session = sessionKind;
  const setup = document.querySelector('.practice-controls');
  if (setup) setup.hidden = sessionKind !== 'practice' && sessionKind !== 'custom';
  $('quote-options').hidden = sessionKind !== 'practice' || prefs.mode !== 'quote' || composeOpen;
  $('standard-options').hidden = sessionKind !== 'practice' || prefs.mode !== 'standard' || composeOpen;
  // Every new run (resetSession) brings its own settings and input class to the footer best.
  showBest();
}

// `show: false` replaces the session without leaving the current view.
function resetSession(kind = sessionKind, { focus = false, selectedPassage = null, show = true, keepRace = false, leaveCompose = false } = {}) {
  // While composing, a refresh of the practice passage (a setting, sync, the dock) waits until
  // composing ends, so no hidden passage is marked seen. Choosing a test, drill, retest or daily ends it.
  if (composeOpen) {
    if (kind === 'practice' && !leaveCompose) {
      switchView('practice');
      if (focus) compose.focus();
      return false;
    }
    closeCompose();
  }
  // Setting the field ends a composition without compositionend, so forget it first, and a held accent key
  // (let go while the field couldn't hear it).
  if (composition?.type === 'primary') composition = null;
  if (accentPair?.type === 'primary') accentPair = null;
  heldDeadKey = null;
  clearInterval(ticker);
  ticker = null;
  setRunning(false);
  // The next passage is prepared with the newest stored preferences, including any from elsewhere. A
  // retest or drill keeps its baseline's conditions (restoreConditions), through a restart too; newer
  // ones from elsewhere wait until it is over.
  followStoredPreferences({ conditions: kind !== 'retest' && kind !== 'drill' });
  setPassageNotice('');
  setCustomLengthError('');
  // Each session set up counts, so a Race still loading can tell its session was replaced (see raceContext);
  // a redraw for a synced profile doesn't count.
  if (!keepRace) sessionCount += 1;
  if (kind === 'challenge' && !ghostRace) kind = 'practice';
  // Word practice whose words were cleared with history falls back to a normal test.
  if (kind === 'missed' && !wordsPassage) kind = 'practice';
  const kindChanged = sessionKind !== kind;
  sessionKind = kind;
  // The mode bar marks Custom while a custom session is loaded, so it is redrawn whenever the kind changes.
  // Changing to any session but custom (a lesson or a ghost race too) also closes the custom editor, or Custom would stay marked over it.
  if (kindChanged && kind !== 'custom') customOpen = false;
  if (kindChanged) setModeControls();
  // Every lesson restart (Esc, the palette, a settings change) lands here: a lesson that is locked again,
  // after history was cleared, gives way to the next open lesson.
  if (kind === 'lesson' && !lessonUnlocked(profile.lessons, lessonIndex)) lessonIndex = nextLessonIndex(profile.lessons);
  passage = selectedPassage || (kind === 'missed' ? wordsPassage : kind === 'daily' ? todayPassage() : kind === 'drill' ? makeDrill(selectedTarget, prefs.wordList)
    : kind === 'lesson' ? lessonPassage(lessonIndex) : kind === 'challenge' ? ghostPassage() : kind === 'custom' ? customPassage()
      : choosePassage(kind === 'retest' && baselineAttempt ? [baselineAttempt.textId] : [], { allowRepeats: kind === 'practice' && prefs.repeatQuotes }));
  if (kind === 'retest' && passage?.fresh === false) {
    showUnavailableRetest('You’ve seen every matching quote. Pick another quote filter or a word test, then run a new baseline.');
    return false;
  }
  if (!passage) {
    if (kind === 'retest') showUnavailableRetest('No passage matches the original conditions. Change the quote filters, then run a new baseline.');
    else {
      attempt = null;
      startTime = null;
      $('typing-input').value = '';
      $('typing-input').disabled = true;
      $('text-display').style.transform = '';
      primaryCharacters = [];
      primaryTextView = null;
      $('text-display').textContent = 'No passage matches these filters.';
      $('accessible-passage').textContent = 'No passage matches these filters.';
      $('typing-status').textContent = 'No matching text';
      $('typing-status').className = 'badge badge-warning';
      $('condition-line').textContent = describeConditions();
      $('input-help').textContent = 'Try another quote length or difficulty.';
      for (const id of ['live-wpm', 'live-accuracy', 'timer']) $(id).textContent = '—';
      $('progress-bar').style.setProperty('--progress', '0');
      $('progress-track').setAttribute('aria-valuenow', '0');
      configureSessionCopy();
      switchView('practice');
    }
    return false;
  }
  // Drills, word practice and lessons are generated practice text, never a passage to keep fresh for a retest.
  // Generated text records nothing, but still replaces a passage set up earlier in the same task.
  recordSeenOnDisplay(['drill', 'missed', 'lesson'].includes(kind) ? [] : [passage.id, kind === 'daily' ? passage.challengeId : null]);
  // The one place a run gets its input class: from the press that started it, never a default or the last run's.
  const runConditions = kind === 'daily' ? dailyConditions() : kind === 'lesson' ? lessonConditions() : kind === 'missed' ? { ...conditions(), mode: 'missed', duration: null, count: null, ...practiceTextConditions(passage.text), quoteLength: null, difficulty: null, wordList: null } : kind === 'challenge' ? ghostConditions() : kind === 'custom' ? customConditions() : conditions();
  attempt = createAttempt({
    id: uid(),
    text: passage.text,
    textId: passage.id,
    kind: kind === 'practice' ? 'test' : kind,
    conditions: { ...sessionConditions(kind, runConditions), inputClass: activationInput },
  });
  if (kind === 'challenge') attempt.challengeId = ghostRace.id;
  if (kind === 'daily') {
    attempt.challengeDate = passage.day;
    attempt.firstDailyAttempt = passage.firstDailyAttempt;
  }
  if (kind === 'drill') attempt.target = selectedTarget;
  if (kind === 'lesson') attempt.lesson = { id: passage.lessonId, index: lessonIndex, pairs: passage.pairs, words: passage.words };
  // Open practice stops at the current minimums. A retest carries its baseline's, so both sides of a
  // comparison pass the same filter; drills and the daily challenge always run to the end.
  if (kind === 'practice') attempt.minimums = practiceMinimums();
  if (kind === 'retest') attempt.minimums = baselineAttempt?.minimums || null;
  attempt.fresh = passage.fresh !== false;
  startTime = null;
  $('typing-input').value = '';
  $('typing-input').disabled = false;
  $('accessible-passage').textContent = passage.text;
  primaryTextView = renderText($('text-display'), passage.text);
  primaryCharacters = primaryTextView.characters;
  primaryFx.reset(primaryCharacters);
  // In a ghost race the ghost caret replays the friend's run; armPace leaves it to that.
  if (kind === 'challenge') primaryFx.ghost.replay(ghostRace.points);
  armPace();
  renderKeyboard();
  if (kind !== 'lesson') markKeyboardTargets(kind === 'drill' ? selectedTarget : null);
  $('typing-status').className = 'badge badge-info';
  $('typing-status').innerHTML = '<span class="status-dot" aria-hidden="true"></span>Ready';
  // Open practice hides the condition line, so a repeated passage says so in the footer, before and during the run.
  setPassageNotice(repeatedTextNotice());
  $('condition-line').textContent = describeRun(attempt);
  configureSessionCopy();
  updateLive(true);
  if (show) switchView('practice');
  if (focus) $('typing-input').focus({ preventScroll: true });
  return true;
}

// Seen IDs are recorded when a passage is displayed: once the task that rendered it ends, before any
// paint or keystroke. A reset replaced by another in the same task (navigate's own, then a command's)
// never reaches the screen, so it can't use up an unseen quote; only the passage left showing counts.
function recordSeenOnDisplay(ids) {
  if (!displayedIds) {
    queueMicrotask(() => {
      const unseen = displayedIds.filter((id) => id && !profile.seenTextIds.includes(id));
      displayedIds = null;
      if (!unseen.length) return;
      profile.seenTextIds.push(...unseen);
      saveProfile();
    });
  }
  displayedIds = ids;
}

function showUnavailableRetest(reason, sample = 'no matching fresh text') {
  switchView('results');
  $('comparison-panel').hidden = false;
  $('comparison-panel').dataset.outcome = 'unavailable';
  $('comparison-status').textContent = 'No fair retest available.';
  $('comparison-accuracy').textContent = '—';
  $('comparison-timing').textContent = '—';
  $('comparison-wpm').textContent = '—';
  $('comparison-sample').textContent = sample;
  $('comparison-caveat').textContent = reason;
  announce(reason);
}

// Composing has no passage: the practice screen swaps its typing form for the composing form.
// A run in progress is dropped, as a restart would drop it; it was never stored.
function openCompose() {
  if (!composeOpen) {
    clearInterval(ticker);
    ticker = null;
    if (attempt?.status === 'running') {
      primaryFx.finish();
      attempt = null;
    }
    sessionKind = 'practice';
    composeOpen = true;
    // Composing replaces any custom passage or open custom editor, as a mode button does.
    customOpen = false;
    document.body.dataset.compose = 'true';
    $('typing-form').hidden = true;
    $('compose-form').hidden = false;
    configureSessionCopy();
    setModeControls();
    switchView('practice');
    compose.open({ focus: true });
    return;
  }
  switchView('practice');
  compose.focus();
}

// Leaving drops anything typed. The caller then resets the practice passage.
function closeCompose() {
  composeOpen = false;
  compose.close();
  document.body.dataset.compose = 'false';
  $('typing-form').hidden = false;
  $('compose-form').hidden = true;
  setModeControls();
}

function focusPractice() {
  if (composeOpen) compose.focus();
  else $('typing-input').focus({ preventScroll: true });
}

function startAttempt(targetAttempt, type = 'primary', stamp = now()) {
  if (type === 'primary') {
    if (startTime !== null) return;
    startTime = stamp;
    attempt.status = 'running';
    attempt.startedAt = 0;
    ticker = setInterval(() => updateLive(), 100);
    primaryFx.ghost.run(stamp);
    setRunning(true);
    // A message left by an abandoned custom length belongs to the row, not to the run.
    setCustomLengthError('');
    $('typing-status').innerHTML = '<span class="status-dot" aria-hidden="true"></span>In progress';
  } else {
    if (race.startTime !== null) return;
    race.startTime = stamp;
    race.attempt.status = 'running';
    race.attempt.startedAt = 0;
    raceRunChanged();
  }
}

function offsetFor(type = 'primary', at = now()) {
  const origin = type === 'primary' ? startTime : race.startTime;
  return origin === null ? 0 : Math.max(0, at - origin);
}

function currentReplay(type = 'primary') {
  return replayAttempt(type === 'primary' ? attempt : race.attempt);
}

// carried: a later key of an accent commit (the h of "h). One the passage has no place left for was pressed
// while its last letter was still to come, so it is a mistake against that letter, or nothing if it is that
// letter (carriedKey).
function pushInsert(char, type = 'primary', at = now(), carried = false) {
  const targetAttempt = type === 'primary' ? attempt : race.attempt;
  startAttempt(targetAttempt, type, at);
  const replay = replayAttempt(targetAttempt);
  const offsetMs = offsetFor(type, at);
  const position = replay.typed.length;
  const unresolved = blocksOnError(targetAttempt.conditions.correctionPolicy)
    && replay.typed.length > 0
    && replay.typed.at(-1) !== targetAttempt.text[replay.typed.length - 1];
  if (unresolved) {
    targetAttempt.events.push({ type: 'blocked-insert', text: char, position: position - 1, offsetMs: offsetMs });
    return { previousLength: position, blocked: 'unresolved' };
  }
  // The passage is typed but its last word has a mistake: space finishes the run as it stands.
  // Other keys have no position left to land on, so they are not recorded.
  if (awaitingSubmit(targetAttempt, replay.typed)) {
    if (char !== ' ') return { previousLength: position, blocked: 'submit' };
    targetAttempt.events.push({ type: 'submit', offsetMs: offsetMs });
    return { previousLength: position, blocked: false, submit: true };
  }
  if (refusesSpace(targetAttempt.conditions, targetAttempt.text, position, char)) {
    targetAttempt.events.push({ type: 'insert', text: char, position, accepted: false, offsetMs: offsetMs });
    return { previousLength: position, blocked: 'space', failed: failureFor(targetAttempt.conditions.correctionPolicy, targetAttempt.text, replay.typed, char) };
  }
  let event = { type: 'insert', text: char, position, accepted: true, offsetMs };
  if (carried && position >= targetAttempt.text.length) event = carriedKey(targetAttempt, char, offsetMs);
  if (event) targetAttempt.events.push(event);
  return { previousLength: position, blocked: false, failed: failureFor(targetAttempt.conditions.correctionPolicy, targetAttempt.text, replay.typed, char) };
}

function pushDelete(type = 'primary') {
  const targetAttempt = type === 'primary' ? attempt : race.attempt;
  const replay = replayAttempt(targetAttempt);
  if (!replay.typed.length) return replay.typed.length;
  targetAttempt.events.push({ type: 'delete', count: 1, offsetMs: offsetFor(type) });
  return replay.typed.length;
}

const inputAttempt = (type) => (type === 'primary' ? attempt : race.attempt);

// A timed run's clock has run out by this time (by default, now).
const timeUp = (at = now()) => startTime !== null && Boolean(sessionDurationMs()) && at - startTime >= sessionDurationMs();
// An accent commit made before the limit and still waiting for the key that ended it, or (Windows) a mark
// typed before the limit and waiting for its key's input.
const commitInTime = () => (composition?.type === 'primary' && composition.commit !== null
  && composition.attempt === attempt && !timeUp(composition.at))
  || (accentPair?.type === 'primary' && accentPair.mark !== null && accentPair.attempt === attempt && !timeUp(accentPair.at));

// A timed run ends at its limit, once nothing typed before the limit is still to be scored.
function finishIfTimeUp(at = now()) {
  if (attempt?.status === 'running' && timeUp(at) && !commitInTime()) finishPrimary(sessionDurationMs());
}

// The checks every typed key passes first; false means the input is ignored (it may finish a timed run).
// at is when the key was typed: a commit made before the limit counts, though it is scored after it.
function acceptingInput(type, at = now()) {
  const target = inputAttempt(type);
  if (!target || ['complete', 'interrupted'].includes(target.status)) return false;
  if (type === 'primary' && timeUp(at)) {
    finishPrimary(sessionDurationMs());
    return false;
  }
  return true;
}

// IME text isn't keyboard input: the run stops counting, as before.
function refuseComposition(type) {
  const target = inputAttempt(type);
  if (type === 'primary' && target.status === 'ready') startAttempt(target);
  target.unsupportedInput = true;
  target.interrupted = true;
  target.events.push({ type: 'composition', offsetMs: offsetFor(type) });
  showInputNotice(type, NOTICES.composition, { sticky: true });
}

// Each key takes the same path as a key press, so replay can't tell them apart. A mark and letter
// committed together arrive with the second key press, and share its time. Every key of a commit is
// recorded before the passage can finish: on the last letter, "h counts the h too (see pushInsert).
function typeKeys(keys, type, at = now()) {
  if (!keys.length || !acceptingInput(type, at)) return;
  const room = inputAttempt(type).text.length - currentReplay(type).typed.length;
  const target = inputAttempt(type);
  const changes = keys.map((key, index) => pushInsert(key, type, at, room > 0 && index >= room));
  const failure = changes.find((change) => change.failed)?.failed;
  if (changes.some((change) => change.submit)) {
    if (type === 'primary') finishPrimary();
    else finishRacePlayer();
    return;
  }
  if (failure) { target.interrupted = true; target.failed = failure; }
  refreshAfterInput(type, changes[0].previousLength, changes.at(-1).blocked, at);
  if (failure && target.status === 'running') {
    if (type === 'primary') finishPrimary();
    else finishRacePlayer();
  }
}

// What a composition committed, scored once the key that ended it is known. A mark pending when focus
// leaves is dropped, and browsers commit it on the way out: Chrome and Firefox send that key (Tab)
// before compositionend, Safari after it, and Chrome on macOS commits as a click begins, a task before
// focus moves. So a commit no key came before waits for one, or for the blur. The next key, input or
// composition on the field scores it first, so keys keep their order.
const COMMIT_KEY_WAIT_MS = 100;
// Keys pressed while composing that don't end it: the accent key itself (Safari sends its keydown after
// the mark shows) and modifiers held for the next letter.
const COMPOSING_KEYS = new Set(['Dead', 'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Fn']);
// Keys whose auto-repeat is a held accent key: Dead, and Process, which Chromium on Linux sends for every
// key its input method takes (the accent key among them), with the repeat flag kept.
const ACCENT_REPEAT_KEYS = new Set(['Dead', 'Process']);

function scoreCommit(type) {
  const session = composition?.type === type && composition.commit !== null ? composition : null;
  if (!session) return;
  composition = null;
  if (session.attempt !== inputAttempt(type) || !acceptingInput(type, session.at)) return;
  const keys = composedKeys(session.commit);
  // A held accent key commits its mark again and again (^^): ignore it, like any held key, and the
  // letter that commits the last repeated mark (â) with it. Committing the same letters back (typing on
  // past the accent menu) changes nothing; any other change to letters already scored is an input
  // method's edit, not keys. A composition no accent key opened is an input method's, even when it
  // commits one Latin letter; a cancelled one (nothing committed) types nothing.
  if (session.repeated) showInputNotice(type, NOTICES.repeat, { speak: false });
  else if (session.replaces !== null) { if (session.commit !== session.replaces) refuseComposition(type); }
  else if (keys === null || (keys.length && !accentComposition({ key: session.key, preview: session.mark }))) refuseComposition(type);
  else typeKeys(keys, type, session.at);
  // The clock may have run out while the commit waited: the run ends now, at its limit.
  if (type === 'primary') finishIfTimeUp();
}

// A composition's end: what it committed is scored once the key that ended it is known, unless it was
// refused already or left with Tab. The field goes back to the passage.
function endComposition(session, commit, type, input) {
  if (session.refused || session.leaving || session.attempt !== inputAttempt(type)) composition = null;
  else {
    composition = Object.assign(session, { commit: commit ?? '', at: now() });
    setTimeout(() => { if (composition === session) scoreCommit(type); }, session.keyed ? 0 : COMMIT_KEY_WAIT_MS);
  }
  const current = inputAttempt(type);
  if (current) input.value = replayAttempt(current).typed;
}

// Stops following a composition before its compositionend. An accent key's pending mark is just dropped;
// an input method's that is still open is kept (lostComposition), so the plain text it may commit later
// is still that input method's.
function forgetComposition(type) {
  if (composition?.type !== type) return;
  if (composition.commit === null && !accentComposition({ key: composition.key, preview: composition.mark })) lostComposition = composition;
  composition = null;
}

// A Windows accent mark scored without the key it waited for (keys, given when that key's input came), as
// a commit is: together, at the mark's time, so on the last letter the passage can't end between them.
function scoreAccentPair(type, keys = null) {
  const pair = accentPair?.type === type && accentPair.mark !== null ? accentPair : null;
  if (!pair) return;
  accentPair = null;
  if (pair.attempt === inputAttempt(type)) typeKeys(keys ?? [pair.mark], type, pair.at);
  if (type === 'primary') finishIfTimeUp();
}

function beforeTypingInput(event, type = 'primary') {
  const compositionInput = event.inputType?.includes('Composition');
  // Safari can insert a commit's text after compositionend; that is the commit itself, not a next key.
  if (!compositionInput) scoreCommit(type);
  // Windows: the input of the key a typed mark waits for is scored with it; anything else scores the mark first.
  if (accentPair?.type === type && accentPair.mark !== null && event.inputType === 'insertText' && event.data === accentPair.key) {
    event.preventDefault();
    scoreAccentPair(type, [accentPair.mark, accentPair.key]);
    return;
  }
  scoreAccentPair(type);
  if (!acceptingInput(type)) {
    event.preventDefault();
    return;
  }
  if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') {
    event.preventDefault();
    refusePaste(type);
    return;
  }
  // A plain key with isComposing false means the composition ended without compositionend
  // (the field changed under it, or the browser dropped the event): let this key through, unless the
  // composition was an input method's (its commit, below).
  if (composition?.type === type && !event.isComposing && !compositionInput
    && (event.inputType === 'insertText' || event.inputType?.startsWith('delete'))) forgetComposition(type);
  // Composition text is scored once, after compositionend; until then the field is the browser's.
  if (compositionInput || event.isComposing || composition?.type === type) return;
  if (event.inputType?.startsWith('delete')) {
    event.preventDefault();
    if (!allowsBackspace(inputAttempt(type).conditions.correctionPolicy)) return;
    const previousLength = pushDelete(type);
    refreshAfterInput(type, previousLength);
    return;
  }
  if (event.inputType === 'insertLineBreak') {
    event.preventDefault();
    return;
  }
  if (event.inputType !== 'insertText' || !event.data || /[\r\n]/u.test(event.data)) return;
  event.preventDefault();
  // The first text after an input method's composition that ended unseen is what it committed (Pinyin's
  // 你 after n), scored as that commit: refused, as after compositionend, and never typed as a key.
  const lost = lostComposition?.type === type ? lostComposition : null;
  if (lost) {
    lostComposition = null;
    if (lost.attempt === inputAttempt(type)) {
      endComposition(lost, event.data, type, event.target);
      return;
    }
  }
  // One key, or an accent mark and the letter it couldn't combine with (Windows sends both).
  const keys = [...event.data].length === 1 ? [event.data] : composedKeys(event.data);
  if (!keys) {
    const targetAttempt = inputAttempt(type);
    targetAttempt.unsupportedInput = true;
    targetAttempt.interrupted = true;
    showInputNotice(type, NOTICES.multiCharacter, { sticky: true });
    return;
  }
  // Windows: the key pressed after an accent key may type the mark first, with its own input to follow.
  const pair = accentPair?.type === type ? accentPair : null;
  // Windows: a held accent key's repeats arrive as plain text (^^), and so does the next key's commit of a
  // mark they left pending (â, ^h, or ^ then h): all that key types, unless it types just itself.
  if (heldDeadKey || (pair?.repeated && (pair.key === null || event.data !== pair.key))) {
    if (pair?.repeated) pair.key = null;
    showInputNotice(type, NOTICES.repeat, { speak: false });
    return;
  }
  accentPair = null;
  if (pair && keys.length === 1 && keys[0] !== pair.key && deadMark(keys[0]) && pair.attempt === inputAttempt(type)) {
    accentPair = Object.assign(pair, { mark: keys[0], at: now() });
    setTimeout(() => { if (accentPair === pair) scoreAccentPair(type); }, COMMIT_KEY_WAIT_MS);
    return;
  }
  typeKeys(keys, type);
}

// An accent key's composition is typed characters, scored after compositionend. Any other composition
// (no accent key opened it), or a preview or commit no accent key could produce, is IME text and stops
// the run counting.
function wireComposition(input, type) {
  // The last key pressed in the field: Chrome and Firefox send an accent key (Dead) before its composition.
  let lastKey = null;
  // An accent key was the last key but modifiers, and opened no composition: Windows, where the next key
  // types its mark as plain text. 'held' if it was repeating: no composition marks a mark it leaves pending.
  let afterAccent = false;
  // Tab commits a pending mark on its way to the next control: dropped, like any mark as focus leaves.
  const drop = () => {
    composition = null;
    const current = inputAttempt(type);
    if (current) input.value = replayAttempt(current).typed;
  };
  input.addEventListener('keydown', (event) => {
    const session = composition?.type === type ? composition : null;
    const repeat = event.repeat && ACCENT_REPEAT_KEYS.has(event.key);
    if (session?.commit === null) {
      // Chrome (keyCode 229 on macOS) and Firefox send the key that will end the composition first.
      if (!COMPOSING_KEYS.has(event.key)) Object.assign(session, { keyed: true, leaving: event.key === 'Tab' });
      // Safari sends the accent key's own keydown after its mark shows.
      if (event.key === 'Dead') session.key = 'Dead';
      // A held accent key's repeat adds its mark to this composition, or (Safari) is the key that opened it.
      if (repeat) Object.assign(session, { repeated: true, heldMark: null });
    } else if (session) {
      // Safari sends the key that ended a composition after compositionend.
      if (repeat && !session.keyed) session.repeated = true;
      if (event.key === 'Tab') drop();
    }
    scoreCommit(type);
    scoreAccentPair(type);
    heldDeadKey = repeat ? { mark: session?.mark ?? heldDeadKey?.mark ?? null } : null;
    lastKey = event.key;
    // Windows: the key after an accent key types the mark, then itself if they don't combine ("h; a space
    // types the mark alone). After a held one, that key (a space, or the accent key again, too) commits any
    // mark the repeats left pending, so what it types is repeat (repeated) until the next key.
    const held = afterAccent === 'held' && !repeat;
    if (!COMPOSING_KEYS.has(event.key) || event.key === 'Dead') {
      accentPair = afterAccent && composition?.type !== type
        && (held ? [...event.key].length === 1 || event.key === 'Dead' : [...event.key].length === 1 && event.key !== ' ')
        ? { type, attempt: inputAttempt(type), key: event.key, mark: null, at: 0, repeated: held } : null;
    }
    afterAccent = event.key === 'Dead' ? (repeat ? 'held' : true) : COMPOSING_KEYS.has(event.key) && afterAccent;
  });
  // Letting go of a held accent key ends its repeats; what it left pending stays repeated.
  input.addEventListener('keyup', (event) => { if (event.key === 'Dead') heldDeadKey = null; });
  input.addEventListener('compositionstart', (event) => {
    // A key opens one composition at most, and an accent key that opens one types nothing as plain text.
    const key = lastKey;
    lastKey = null;
    afterAccent = false;
    scoreCommit(type);
    scoreAccentPair(type);
    // A new composition: the one that ended unseen sent no commit as plain text.
    if (lostComposition?.type === type) lostComposition = null;
    if (!acceptingInput(type)) { composition = null; return; }
    // An accent key's mark starts as a caret after the typed text. A composition over letters already
    // typed (the macOS press-and-hold accent menu, a keyboard re-composing a word) is not new keys.
    const over = event.data || input.value.slice(input.selectionStart, input.selectionEnd);
    // Chrome and Firefox send the key that opens a composition first: a held accent key's repeat opens a
    // repeated one, and the letter that later commits its mark (â) is ignored with it.
    composition = { type, attempt: inputAttempt(type), refused: false, replaces: over || null, keyed: false, leaving: false, repeated: Boolean(heldDeadKey), heldMark: heldDeadKey?.mark ?? null, key, mark: null, commit: null, at: 0 };
  });
  input.addEventListener('compositionupdate', (event) => {
    if (composition?.type !== type || composition.refused || composition.attempt !== inputAttempt(type)) return;
    // Safari sends a key's composition before its keydown, so one opened while an accent key is held may be
    // another accent key's: it is the held key's repeat only if it first shows that key's mark.
    if (composition.mark === null) {
      if (composition.heldMark !== null && event.data !== composition.heldMark) composition.repeated = false;
      composition.mark = event.data;
    }
    if (!acceptingInput(type)) return;
    if (composedKeys(event.data) === null) {
      composition.refused = true;
      refuseComposition(type);
    }
  });
  input.addEventListener('compositionend', (event) => {
    // Safari sends the accent key's keydown inside its composition.
    afterAccent = false;
    // One let go first ends here after all: what it commits now is dropped, as when focus leaves.
    if (lostComposition?.type === type) lostComposition = null;
    // Hand the field back to the passage once the composition is over (finishing commits a pending mark).
    if (composition?.type === type) endComposition(composition, event.data, type, input);
    else if (inputAttempt(type)) input.value = replayAttempt(inputAttempt(type)).typed;
  });
  // Focus moving anywhere drops a mark still pending, or committed on the way out, whichever comes first.
  // A held accent key is let go out of the field's hearing; if it is still down when focus returns, its
  // repeats say so again.
  input.addEventListener('blur', () => {
    heldDeadKey = null;
    lastKey = null;
    afterAccent = false;
    forgetComposition(type);
    if (accentPair?.type === type) accentPair = null;
  });
}

// Everything the typing surface says, kept short. The focus-lost and composition
// notices stay until restart because the run no longer counts. Accent (dead) keys are
// typed characters; only IME text (any composition no accent key opened) is refused.
const NOTICES = {
  blocked: 'Fix the underlined letter.',
  strictSpace: 'Strict space is on. Type the next letter.',
  submit: 'The last word has a mistake. Fix it, or press space to finish.',
  paste: 'Paste is off. Type the passage.',
  composition: 'IME input isn’t scored. Esc to restart.',
  multiCharacter: 'One key at a time. Esc to restart.',
  repeat: 'Key repeat ignored.',
  focusLost: 'Focus lost. This run won’t count. Esc to restart.',
  leftSurface: 'You left mid-run, so it won’t count.',
  paletteOpened: 'Commands opened mid-run, so it won’t count.',
  suggestOpened: 'Suggestions opened mid-run, so it won’t count.',
  composeFocusLost: 'Focus lost, so this one won’t be saved. Esc to start over.',
  composeLeft: 'You left mid-way, so this one wasn’t saved.',
  composePalette: 'Commands opened mid-way, so this one won’t be saved.',
  composeSuggest: 'Suggestions opened mid-way, so this one won’t be saved.',
  deleteOpened: 'Account deletion opened mid-run, so it won’t count.',
  raceFocusLost: 'Focus lost. Esc to restart this turn.',
};

function showInputNotice(type, message, { sticky = false, speak = true } = {}) {
  if (prefs.keybindings.restart !== 'Escape') {
    const hint = prefs.keybindings.restart ? `${bindingLabel(prefs.keybindings.restart)} to restart` : 'Restart shortcut is disabled';
    message = message.replace('Esc to restart', hint);
  }
  if (type === 'primary') {
    $('input-help').textContent = message;
    if (sticky) primaryNotice = message;
  } else {
    $('race-help').textContent = message;
    if (sticky) race.notice = message;
  }
  if (speak) announce(message);
}

// A strict space or quick end notice never hides why a run won't count; it follows that notice.
function withRule(sticky, rule) {
  return sticky ? `${sticky} ${rule}` : rule;
}

function refusePaste(type) {
  showInputNotice(type, NOTICES.paste);
}

// at is when the key was typed, so a commit scored after a timed run's limit can't end the run between
// its mark and its letter (scoreCommit ends it once both are in).
function refreshAfterInput(type, previousLength, blocked = false, at = now()) {
  const isPrimary = type === 'primary';
  const targetAttempt = isPrimary ? attempt : race.attempt;
  const replay = replayAttempt(targetAttempt);
  const input = isPrimary ? $('typing-input') : $('race-input');
  const characters = isPrimary ? primaryCharacters : race.characters;
  const textView = isPrimary ? primaryTextView : race.textView;
  input.value = replay.typed;
  input.setSelectionRange(replay.typed.length, replay.typed.length);
  textView.ensureAhead(replay.typed.length);
  updateCharacterStates(characters, replay.typed, targetAttempt.text, previousLength);
  const length = replay.typed.length;
  const lastCorrect = length > 0 && replay.typed[length - 1] === targetAttempt.text[length - 1];
  let outcome = 'delete';
  if (blocked) outcome = 'blocked';
  else if (length > previousLength) outcome = lastCorrect ? 'correct' : 'wrong';
  // A refused space is a miss at the letter it skipped: that letter is tinted until the next key,
  // so the coral caret always sits beside a tinted letter.
  if (blocked === 'space') characters[length].className = 'char wrong';
  (isPrimary ? primaryFx : raceFx).update(length, outcome, (length > 0 && !lastCorrect) || blocked === 'space');
  textView.trimBehind(length);
  const waiting = awaitingSubmit(targetAttempt, replay.typed);
  const rule = blocked === 'space' ? NOTICES.strictSpace : waiting ? NOTICES.submit : '';
  // Said once when the space is refused or the run starts waiting, and again if a key is ignored.
  if (blocked === 'space' || (waiting && (length > previousLength || blocked === 'submit'))) announce(rule);
  if (isPrimary) {
    setRunning(true);
    $('input-help').textContent = rule ? withRule(primaryNotice, rule) : blocked ? NOTICES.blocked : primaryNotice;
    updateLive(false, at);
    if (sessionDurationMs() === null && passageComplete(targetAttempt, replay.typed)) finishPrimary();
  } else {
    const help = $('race-help');
    if (rule) help.textContent = withRule(race.notice, rule);
    else if ([NOTICES.strictSpace, NOTICES.submit].some((notice) => help.textContent.endsWith(notice))) help.textContent = race.notice || (prefs.keybindings.restart ? `${bindingLabel(prefs.keybindings.restart)} restarts.` : 'Restart shortcut is disabled.');
    updateRaceProgress(replay);
    if (passageComplete(targetAttempt, replay.typed)) finishRacePlayer();
  }
}

// The pace caret is presentational and never scored. It runs at the personal best, the average of
// the last 10 comparable runs, the last comparable run, or a custom pace; with no runs, a gentle 60 wpm.
function ghostPace(mode = prefs.paceCaret) {
  // In a lesson the pace line runs at the lesson's speed target, whatever the pace setting.
  if (attempt?.kind === 'lesson') {
    const wpm = LESSONS[lessonIndex].wpm;
    return { wpm, cps: (wpm * 5) / 60, fromBest: false, fallback: false };
  }
  // The active attempt knows its real input class (from the press that started it, or a later touch).
  const key = conditionKey(attempt?.conditions || conditions());
  let wpm = null;
  if (mode === 'custom') wpm = prefs.paceWpm;
  else if (mode === 'best') wpm = profile.bests[key]?.wpm || null;
  else if (mode === 'average' || mode === 'last') {
    // Only test and retest runs are comparable, as for trends and bests: drills would skew the pace.
    const runs = filterRuns(profile.runs.filter(trendRun), key).filter((run) => run.score?.wpm);
    const recent = runs.slice(mode === 'last' ? -1 : -10);
    if (recent.length) wpm = Math.round(recent.reduce((sum, run) => sum + run.score.wpm, 0) / recent.length);
  }
  const fromBest = mode === 'best' && Boolean(wpm);
  const fallback = !wpm;
  wpm = wpm || 60;
  return { wpm, cps: (wpm * 5) / 60, fromBest, fallback };
}

function showPace() {
  const on = ghostOn();
  const pace = ghostPace();
  // A ghost race's caret is the friend's run, not the pacer, so the pace isn't labelled there.
  const shown = on && sessionKind !== 'challenge';
  $('pace-label').hidden = !shown;
  $('pace-label').textContent = shown ? `pace ${pace.wpm} wpm` : '';
  $('pace-select').value = prefs.paceCaret;
  // A speed being typed in stays as typed when this redraws (another tab's save taken in, say): setting
  // the field would drop the edit without a change event. Leaving the field saves it and redraws.
  if (document.activeElement !== $('pace-wpm')) $('pace-wpm').value = prefs.paceWpm;
  $('pace-custom').hidden = prefs.paceCaret !== 'custom';
  $('pace-note').textContent = on && prefs.paceCaret !== 'custom' ? (pace.fallback ? 'no runs yet — 60 wpm' : `${pace.wpm} wpm`) : '';
  document.body.dataset.ghost = on ? 'on' : 'off';
}

// Arms the caret on the current attempt in place: a ready run keeps its passage, and a run in
// progress joins the caret to its own clock. Called whenever the mode or the history behind it changes.
function armPace() {
  const running = attempt?.status === 'running' && startTime !== null;
  const live = running || attempt?.status === 'ready';
  // A ghost race keeps its replayed run: the pacer never replaces or hides it.
  if (sessionKind !== 'challenge') primaryFx.ghost.arm(ghostOn() && live ? ghostPace().cps : 0, running ? startTime : 0);
  showPace();
}

// A pick, even of the pace shown, is stamped (saveChoice), so a different one waiting from elsewhere
// doesn't replace it when a drill or retest ends. The custom speed is stamped only when it was on show:
// typed in (`speed`), or kept by picking custom again. Picking custom from another pace shows a speed
// nobody chose here, so a speed chosen elsewhere outranks it.
function setPaceCaret(mode, { speed = false } = {}) {
  const speedShown = speed || (mode === 'custom' && prefs.paceCaret === 'custom');
  prefs.paceCaret = mode;
  saveChoice('paceCaret', ...(speedShown ? ['paceWpm'] : []));
  armPace();
}

function markKeyboardTargets(target) {
  keyboardTarget = target;
  const letters = new Set((target || '').toLowerCase());
  $('keyboard').querySelectorAll('.key').forEach((key) => key.classList.toggle('target', letters.has(key.dataset.key)));
}

// The live readout shows no rate until RATE_FLOOR_MS has passed. Custom text (any non-comparable kind) can
// be short enough to finish inside that second, so its run card follows the same floor. Built-in passages
// take far longer than a second to type, so their card is unchanged.
const rateShown = (completed) => comparableKind(completed.kind) || completed.summary.elapsedMs >= RATE_FLOOR_MS;

// Where the primary run stands: worked out from the run itself on every call (its duration, and
// whether its passage is finished or, with quick end off, its last word submitted by space), so no
// caller states the end conditions by hand.
function runPosition(replay, elapsedMs) {
  const submitted = attempt.events.some((event) => event.type === 'submit');
  return { elapsedMs, durationMs: sessionDurationMs(), finished: submitted || passageComplete(attempt, replay.typed) };
}

function updateLive(reset = false, at = now()) {
  if (!attempt) return;
  const replay = replayAttempt(attempt);
  const elapsed = startTime === null ? 0 : now() - startTime;
  const duration = sessionDurationMs();
  const boundedElapsed = duration ? Math.min(elapsed, duration) : elapsed;
  // A rate over the first second is mostly noise (one key in 5 ms reads as thousands of wpm),
  // and a number that changes every keystroke pulls the eye off the text: update once a second.
  const second = startTime === null ? -1 : Math.floor(boundedElapsed / 1000);
  if (reset || second !== liveSecond) {
    liveSecond = second;
    const live = second >= 0 && boundedElapsed >= RATE_FLOOR_MS ? replayAttempt({ ...attempt, endedAt: boundedElapsed }) : null;
    const score = live?.score;
    setText($('live-wpm'), score ? score.wpm : '—');
    setText($('live-accuracy'), score ? score.accuracy : '—');
    // Minimums are judged on this once-a-second tick, after the grace period, never per keystroke.
    // At the run's end (its duration, or its last character) this live check stands aside: the
    // end-of-run check in finishPrimary judges it.
    if (!reset && live && attempt.minimums && attempt.status === 'running' && !attempt.interrupted && !attempt.unsupportedInput) {
      const position = runPosition(live, boundedElapsed);
      const stop = atRunEnd(position) ? null : minimumStop(attempt.minimums, live, position);
      if (stop) {
        finishPrimary(boundedElapsed, { stop });
        return;
      }
    }
  }
  let progress;
  if (duration) {
    const remaining = Math.max(0, Math.ceil((duration - boundedElapsed) / 1000));
    setText($('timer'), remaining);
    setText($('timer-unit'), 's');
    setText($('timer-label'), 'remaining');
    progress = boundedElapsed / duration;
  } else {
    const wordTotal = attempt.text.split(' ').length;
    const wordCount = replay.typed.length === attempt.text.length ? wordTotal : (replay.typed.match(/ /g) || []).length;
    setText($('timer'), wordCount);
    setText($('timer-unit'), `/${wordTotal}`);
    setText($('timer-label'), 'words');
    progress = replay.typed.length / attempt.text.length;
  }
  const percent = Math.max(0, Math.min(100, progress * 100));
  $('progress-bar').style.setProperty('--progress', String(percent / 100));
  $('progress-track').setAttribute('aria-valuenow', String(Math.round(percent)));
  $('progress-track').setAttribute('aria-valuetext', reset ? 'Not started' : `${Math.round(percent)} percent complete`);
  finishIfTimeUp(at);
}

function storeAttempt(completed) {
  completed.at = new Date().toISOString();
  // Shown as the day's first attempt, it is a repeat if another device's earlier attempt arrived since.
  if (completed.kind === 'daily') completed.firstDailyAttempt = settleDailyFirsts([...profile.runs, completed]).at(-1).firstDailyAttempt;
  const key = conditionKey(completed.conditions);
  const score = completed.summary.score;
  // Repeated text is saved and listed, but only fresh text can set a best. Bests stored before repeat quotes
  // are left as they are, whatever text set them. Code runs are their own condition and never set a best.
  const eligibleBest = trendRun(completed) && completed.conditions?.mode !== 'code';
  resultBestBefore = profile.bests[key] || null;
  // A custom passage is never fresh either, but it is never compared, so it has no passage best to chase.
  resultPassageBefore = completed.fresh === false && comparableKind(completed.kind) ? passageBest(profile.runs, completed) : null;
  // Traces serve baselines and patterns. A custom passage is neither and can run to thousands of characters,
  // so only its summary record is kept; so is a ghost race's, whose trace is sent from the run in memory.
  if (comparableKind(completed.kind)) profile.attempts.push(completed);
  profile.runs.push(runRecord(completed));
  if (eligibleBest && (!profile.bests[key] || score.wpm > profile.bests[key].wpm)) {
    profile.bests[key] = { wpm: score.wpm, attemptId: completed.id, at: new Date().toISOString() };
  }
  // The passage was marked seen when shown (resetSession). A merge with a copy that had cleared history
  // can drop marks it can't date, as it does for a passage only shown; one that was then typed, even
  // in an interrupted run or a daily attempt, is marked again.
  if (completed.kind !== 'drill') {
    for (const id of [completed.textId, completed.kind === 'daily' ? dailyChallengeId(completed.challengeDate) : null]) {
      if (id && !profile.seenTextIds.includes(id)) profile.seenTextIds.push(id);
    }
  }
  const saved = saveProfile();
  showBest();
  return saved;
}

// The end of a run (the timer, the passage end) is a word boundary for the failure
// policies, so a wrong letter typed just before the timer runs out still fails the run.
function markEndFailure(target) {
  if (target.interrupted) return;
  const failed = failureAtEnd(target.conditions.correctionPolicy, target.text, replayAttempt(target).typed);
  if (!failed) return;
  target.interrupted = true;
  target.failed = failed;
}

const failedDrill = (completed) => completed.kind === 'drill' && Boolean(completed.failed);

// `replacing`: another session or view takes over at once, so a drill draws no retest passage to throw away.
// `stop`: the live tick found the run under a minimum (minimumStop).
function finishPrimary(forcedElapsed = null, { replacing = false, stop = null } = {}) {
  if (!attempt || attempt.status !== 'running') return;
  // A pending accent mark isn't a keystroke; disabling the field commits it, and that is ignored. Nor can
  // the disabled field hear a held accent key let go.
  if (composition?.type === 'primary') composition = null;
  if (accentPair?.type === 'primary') accentPair = null;
  heldDeadKey = null;
  clearInterval(ticker);
  ticker = null;
  const endedAt = forcedElapsed ?? offsetFor();
  markEndFailure(attempt);
  const clean = !attempt.interrupted && !attempt.unsupportedInput;
  const final = completeAttempt(attempt, { endedAt });
  // A run that reaches its end (its duration or its passage) under a minimum isn't counted either,
  // so every counted run met them. The tick passes a live stop from the same judgement. A run the
  // correction policy failed is already interrupted, and says so rather than naming a minimum.
  const stopped = clean ? stop || minimumStop(attempt.minimums, final.summary, runPosition(final.summary, endedAt)) : null;
  const valid = clean && !stopped;
  const completed = { ...final, status: valid ? 'complete' : 'interrupted' };
  if (stopped) completed.stopped = stopped;
  completed.interrupted = attempt.interrupted;
  completed.unsupportedInput = attempt.unsupportedInput;
  completed.fresh = attempt.fresh;
  if (attempt.failed) completed.failed = attempt.failed;
  attempt = completed;
  $('typing-input').disabled = true;
  primaryFx.finish();
  setRunning(false);
  $('typing-status').className = `badge ${valid ? 'badge-success' : 'badge-warning'}`;
  $('typing-status').textContent = valid ? 'Complete' : completed.failed ? 'Failed' : 'Interrupted';
  // Lessons keep their own progress and never enter runs, traces or bests.
  if (sessionKind === 'lesson') {
    finishLesson(completed, valid);
    return;
  }
  const saved = storeAttempt(completed);

  // A drill the correction setting failed shows its result like any failed run, so it can be tried
  // again or skipped to the retest; a finished or interrupted drill goes straight on to the retest.
  if (sessionKind === 'drill' && baselineAttempt && !completed.failed) {
    if (trainingContext) trainingContext.drillCompleted = valid;
    // Train already offers this retest: startDrill() rendered its actions.
    if (replacing) return;
    announce(valid ? 'Drill complete. Retest ready.' : 'Drill interrupted. Retest ready.');
    startRetest();
    return;
  }

  if (sessionKind === 'practice' || sessionKind === 'daily') {
    // A code run is never a baseline, so it drops the earlier one rather than retest against it.
    if (completed.conditions?.mode === 'code') {
      baselineAttempt = null;
      trainingContext = null;
    } else if (valid) {
      // Familiar text flatters the score, so a repeated passage can't be the baseline for a fresh retest.
      baselineAttempt = completed.fresh === false ? null : completed;
      trainingContext = null;
    }
  }
  renderResults(completed, saved);
  if (sessionKind === 'retest') renderComparison(baselineAttempt, completed, saved);
  if (sessionKind === 'challenge') {
    // Touch and physical-keyboard runs are never compared, so only the sender's kind of input is sent.
    const sameInput = inputOf(completed.conditions) === inputOf(ghostRace.conditions);
    ghostRace.run = completed;
    ghostRace.trace = valid && sameInput ? encodeTrace(completed) : null;
    ghostRace.state = !valid ? 'interrupted' : !sameInput ? 'other-input' : ghostRace.trace ? 'sending'
      : traceTrouble(completed) === 'character' ? 'unreplayable' : 'unsendable';
    renderGhostResult();
    if (ghostRace.trace) submitGhostRun();
    else announce(`${$('ghost-result-heading').textContent} ${$('ghost-result-status').textContent}`);
  }
  switchView('results');
  renderCard(completed);
  $(failedDrill(completed) ? 'start-drill' : 'run-again').focus({ preventScroll: true });
  // Every run a minimum ends gets the hold, wherever it was caught: the tick, the last character or
  // the timer.
  stopHold = completed.stopped ? now() : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Draw after the results view is shown so the graph has its size.
function renderCard(completed) {
  const kind = completed.kind === 'challenge' ? 'ghost race' : completed.kind !== 'test' ? completed.kind : completed.conditions.mode === 'standard' ? 'standard' : 'practice';
  const at = new Date();
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  $('run-card-stamp').textContent = `${MONTHS[at.getMonth()]} ${at.getDate()} · ${time} · ${kind}${completed.failed ? ` · failed · ${completed.failed}` : ''}`;
  $('run-card').hidden = false;
  const graph = $('speed-graph').closest('figure');
  graph.hidden = !rateShown(completed);
  if (!graph.hidden) renderSpeedGraph($('speed-graph'), completed, { animate: true });
  renderPracticeWords(completed);
}

// Offer the words this run tripped on or was slowest through as their own uncounted run. The
// slowest are one timing each, so they show their speed beside the run's median, not a weakness.
// Only an evidence run is mined for words, by the same rule as recurring patterns: a complete test,
// retest or daily run on fresh text. Not a drill (synthetic, target-heavy text), repeated text (a daily
// passage shown before, a repeated quote), custom text or word practice itself. Run again repeats a word-practice passage.
function renderPracticeWords(completed) {
  const mined = evidenceRun(completed);
  const { missed, slow, timedCount, medianWpm } = mined ? missedAndSlowWords(completed) : { missed: [], slow: [] };
  const words = [...missed, ...slow.map((item) => item.word)];
  const button = $('practice-words');
  const evidence = $('practice-words-evidence');
  button.hidden = evidence.hidden = !words.length;
  if (!words.length) return;
  // Sentences about this run's words, set in Literata like the word pace line, and each number is a
  // book-face figure (.num), never the mono of the conditions line.
  const figure = (value) => element('span', String(value), 'num');
  const lines = [
    missed.length && [`missed first try: ${missed.map(wordCopy).join(', ')}`],
    slow.length && ['slowest in this run: ', ...slow.flatMap((item, index) => [`${index ? ', ' : ''}${item.word} `, figure(item.wpm), ' wpm']),
      ' · median ', figure(medianWpm), ' wpm over ', figure(timedCount), ' clean words'],
  ].filter(Boolean);
  evidence.replaceChildren(...lines.flatMap((parts, index) => (index ? ['\n', ...parts] : parts)));
  button.textContent = words.length === 1 ? 'Practice this word' : `Practice these ${words.length} words`;
  // The run whose words are practised (an evidence run, or there'd be no button) is the baseline for
  // the fresh retest offered afterward, as a finished practice or daily run is. A retest doesn't set it
  // on finishing, so set it here.
  button.onclick = () => {
    baselineAttempt = completed;
    startWordPractice(words);
  };
}

// Quote a token that carries punctuation, so "table," reads as the word typed.
function wordCopy(word) {
  return /[^\p{L}\p{N}]/u.test(word) ? `“${word}”` : word;
}

// An uncounted `missed` run of these words. It is not a drill, so a drill's context and target from
// earlier don't carry over into the next retest's record; startDrill sets a target again.
function startWordPractice(words, { recurring = false } = {}) {
  const text = practiceWordsPassage(words);
  wordsPassage = { id: `missed-${textId(text)}`, text, fresh: false, words, recurring };
  trainingContext = null;
  selectedTarget = null;
  resetSession('missed', { focus: true });
}

// The words you keep missing across runs. Without a baseline in this tab, the newest retained
// counted run becomes one (as for a recurring pattern), so a fresh-text retest can follow.
function practiseRecurringWords() {
  const { words } = recurringMissedWords(profile.runs);
  if (words.length < 2) return;
  baselineAttempt ||= retainedBaseline();
  startWordPractice(words.map((item) => item.word), { recurring: true });
}

// The Train list's button. A sync or a clear elsewhere can change the runs under a list drawn
// earlier, so a list that no longer matches is redrawn; with fewer than two words left nothing
// starts, the change is announced and focus stays on the section instead of the hidden button.
function practiseMissedList() {
  const live = recurringMissedWords(profile.runs).words.map((item) => item.word);
  if (live.length !== missedListWords.length || live.some((word, index) => word !== missedListWords[index])) renderMissedWords();
  if (live.length >= 2) {
    practiseRecurringWords();
    return;
  }
  announce('Fewer than two words to practice now. The list has been updated.');
  $('missed-words-heading').focus();
}

function resultHeadline(completed) {
  if (completed.failed) return `failed · ${completed.failed}`;
  if (completed.status !== 'complete') return completed.stopped?.atEnd ? 'Under your minimum · not counted' : 'Interrupted · not counted';
  if (completed.kind === 'drill') return 'Drill complete · not counted toward your best';
  if (completed.kind === 'challenge') return 'Ghost race complete · not counted toward your best';
  if (completed.kind === 'missed') return 'Word practice complete · not counted toward your best';
  if (completed.kind === 'custom') return 'Custom text complete · not counted toward your best';
  if (completed.conditions?.mode === 'code') return 'Code run complete · not counted toward your best';
  if (completed.kind === 'daily') return completed.firstDailyAttempt ? 'Daily challenge complete' : 'Daily challenge complete · repeat attempt';
  if (completed.fresh === false) {
    // A repeat chases its own passage, never the personal best.
    if (!resultPassageBefore) return 'Repeated text · not counted toward your best';
    const before = resultPassageBefore.score.wpm;
    const change = completed.summary.score.wpm - before;
    return change === 0 ? `Repeated text · matched your best of ${before} on this passage` : `Repeated text · ${change > 0 ? '+' : '−'}${Math.abs(change)} vs your best of ${before} on this passage`;
  }
  if (!resultBestBefore) return 'First run at these settings';
  const delta = completed.summary.score.wpm - resultBestBefore.wpm;
  if (delta === 0) return `Matched your best of ${resultBestBefore.wpm}`;
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} vs your best of ${resultBestBefore.wpm}`;
}

function retestLength(value) {
  if (value.mode === 'standard') return 'standard';
  if (value.mode === 'time') return `${value.duration} s`;
  if (value.mode === 'words') return `${value.count}-word`;
  return value.quoteLength && value.quoteLength !== 'any' ? `${value.quoteLength} quote` : 'quote';
}

// Code runs never become retest baselines, so a drill at code settings always stands alone.
const CODE_DRILL_NOTE = 'A standalone drill. Code runs have no fresh-text retest.';

// Records the run the results view now shows; Watch replay appears only when it has a trace. A custom run
// (any non-comparable kind) keeps no trace, so, as with its best, it offers no replay.
function showResult(completed) {
  shownResult = completed;
  $('watch-replay').hidden = !completed?.events?.length || !comparableKind(completed.kind);
}

function renderResults(completed, saved) {
  activeRecommendation ||= recommendTarget([], completed.conditions);
  const replay = completed.summary;
  const counted = completed.status === 'complete';
  const firstErrors = replay.firstAttempts.filter((item) => !item.correct).length;
  showResult(completed);
  const speed = rateShown(completed) ? `${replay.score.wpm} wpm` : 'Too quick to time';
  $('result-wpm').textContent = rateShown(completed) ? replay.score.wpm : '—';
  $('result-accuracy').textContent = replay.score.accuracy;
  $('result-errors').textContent = firstErrors;
  $('result-time').textContent = `${(replay.elapsedMs / 1000).toFixed(1)} s`;
  renderSecondaryStats(completed);
  $('result-conditions').textContent = describeRun(completed);
  $('result-delta').textContent = resultHeadline(completed);
  const repeated = repeatedResult(completed);
  const stopped = completed.stopped ? stopReason(completed.stopped) : '';
  // A retest reports a failed save once, in the comparison caveat.
  $('result-comparison-note').textContent = [
    counted ? '' : completed.failed ? 'The correction setting ended this run, so it isn’t counted.' : stopped ? `${stopped}, so it isn’t counted.` : 'Focus or input changed during the run, so it isn’t counted.',
    saved || sessionKind === 'retest' ? '' : 'Couldn’t save on this device.',
  ].filter(Boolean).join(' ');

  if (sessionKind === 'practice' || sessionKind === 'daily') {
    activeRecommendation = trainingRecommendation(completed.conditions, completed);
    selectedTarget = activeRecommendation.target;
  }
  // Custom text and ghost races are never mined for targets or kept as a baseline, so their results offer no drill or retest:
  // the recommendation would come from other runs and the retest would measure a different text. Word
  // practice isn't compared either, but like a drill it leads on to a retest of the run its words came from.
  renderRecommendation(counted || failedDrill(completed), comparableKind(completed.kind) || completed.kind === 'missed', completed);
  $('run-again').textContent = sessionKind === 'daily' ? 'Try daily again' : 'Run again';
  renderTraining();
  renderDaily();
  $('comparison-panel').hidden = true;
  const failure = completed.failed ? `${completed.kind === 'drill' ? 'Drill' : 'Run'} failed, ${completed.failed}. ` : stopped ? `${stopped}. ` : '';
  $('ghost-result').hidden = completed.kind !== 'challenge';
  renderGhostOffer(completed);
  announce([`${failure}${speed}, ${replay.score.accuracy}% accuracy.`,
    repeated ? 'Repeated text, not counted toward your best.' : '',
    saved ? '' : 'Couldn’t save on this device.'].filter(Boolean).join(' '));
}

// A counted practice run on repeated text: saved and listed, never a best, trend or retest baseline.
const repeatedResult = (completed) => completed?.status === 'complete' && completed.kind === 'test' && completed.fresh === false;

// Train's drill and retest actions, from the current recommendation and baseline. Runs after each result
// and as each drill starts, so a drill left before its end still offers its retest even when its baseline
// came from saved history (practiceTarget) and no result has been shown in this tab.
// `compared` is false after a custom text result (any non-comparable kind): that text is never mined for
// targets or kept as a baseline, so Train offers no drill or retest for it. A drill started later shows them again.
function renderRecommendation(counted = true, compared = true, completed = null) {
  // After startDaily() there is no recommendation: show the general drill Start drill falls back to.
  activeRecommendation ||= recommendTarget([], baselineAttempt?.conditions);
  $('recommendation-title').textContent = counted ? activeRecommendation.title : 'Restart for a counted run';
  $('recommendation-evidence').textContent = counted ? activeRecommendation.reason : completed?.failed ? 'This run failed under the correction setting.'
    : completed?.stopped ? 'Runs under your minimums aren’t counted. Change them in settings.' : 'This run lost focus or used unsupported input.';
  $('recommendation-meta').textContent = baselineAttempt
    ? `About 1 min, then a fresh ${retestLength(baselineAttempt.conditions)} retest.`
    : completed?.conditions?.mode === 'code' ? CODE_DRILL_NOTE
    : repeatedResult(completed)
      ? 'A standalone drill. Repeated text stays out of your best, trends and retests; finish a run on fresh text for a comparable retest.'
      : 'A standalone drill. Finish a practice run to establish a fresh-text retest baseline.';
  $('start-drill').disabled = !counted;
  $('start-drill').textContent = completed && failedDrill(completed) ? 'Try drill again' : 'Start drill';
  $('skip-to-retest').disabled = !counted || baselineAttempt?.status !== 'complete';
  for (const id of ['recommendation-title', 'recommendation-evidence', 'recommendation-list', 'recommendation-meta', 'start-drill', 'skip-to-retest']) $(id).hidden = !compared;
  renderEvidenceList(activeRecommendation.evidence);
}

function renderEvidenceList(evidence) {
  const strongest = [...evidence.pairs]
    .filter((item) => item.errors > 0 || (item.timings.length >= 10 && item.slowdownMs > 0))
    .sort((a, b) => b.errors - a.errors || (b.slowdownMs || 0) - (a.slowdownMs || 0))
    .slice(0, 2);
  $('recommendation-list').replaceChildren(...strongest.map((item) => {
    const row = document.createElement('div');
    row.className = 'evidence-row';
    const pair = document.createElement('strong');
    pair.textContent = item.pair;
    const counts = document.createElement('span');
    const timing = item.medianMs === null ? 'timing needs more samples' : `${item.medianMs} ms median over ${item.timings.length} ${item.timings.length === 1 ? 'interval' : 'intervals'}`;
    counts.textContent = `${item.errors}/${item.observations} first-try errors · ${timing}`;
    row.append(pair, counts);
    return row;
  }));
}

const COMPARISON_HEADINGS = {
  improved: 'The retest was stronger.',
  mixed: 'A mixed result.',
  regressed: 'The retest was lower.',
  steady: 'Level with your baseline.',
};

function renderComparison(before, after, saved) {
  const comparison = compareAttempts(before, after);
  const panel = $('comparison-panel');
  panel.hidden = false;
  const outcome = comparison.comparable ? comparison.state : 'unavailable';
  panel.dataset.outcome = outcome;
  $('comparison-status').textContent = comparison.comparable ? COMPARISON_HEADINGS[comparison.state] : 'Retest complete.';
  $('comparison-accuracy').textContent = comparison.comparable ? signed(comparison.accuracyDelta, 'pp') : '—';
  $('comparison-wpm').textContent = comparison.comparable ? signed(comparison.wpmDelta, 'wpm') : '—';

  const trainedTarget = trainingContext?.target || selectedTarget;
  // No comparison means no timing comparison either: a retest that isn't compared (stopped under a
  // minimum, interrupted, other conditions or repeated text) puts none of its numbers on this panel.
  // No baseline: a clear from another tab or device removed it while this retest was under way.
  if (!comparison.comparable) {
    const reason = before ? comparison.reason : 'Your history was cleared, so there is no baseline to compare with.';
    $('comparison-timing').textContent = '—';
    $('comparison-sample').textContent = !before ? 'no baseline' : trainedTarget ? `${trainedTarget} · timing not compared` : 'timing not compared';
    $('comparison-caveat').textContent = `${reason}${saved ? '' : ' Couldn’t save on this device.'}`;
    renderHistory();
    return;
  }
  const beforePattern = summarizePatterns([before]).pairs.find((item) => item.pair === trainedTarget);
  const afterPattern = summarizePatterns([after]).pairs.find((item) => item.pair === trainedTarget);
  const enoughTiming = beforePattern?.timings.length >= 10 && afterPattern?.timings.length >= 10;
  const timingSummary = { target: trainedTarget, beforeCount: beforePattern?.timings.length || 0, afterCount: afterPattern?.timings.length || 0, deltaMs: null };
  if (enoughTiming) {
    const delta = afterPattern.medianMs - beforePattern.medianMs;
    timingSummary.deltaMs = delta;
    $('comparison-timing').textContent = signed(delta, 'ms');
    $('comparison-sample').textContent = `${trainedTarget} · ${beforePattern.timings.length} before · ${afterPattern.timings.length} after`;
  } else {
    $('comparison-timing').textContent = '—';
    $('comparison-sample').textContent = trainedTarget
      ? `${trainedTarget} · ${timingSummary.beforeCount} before · ${timingSummary.afterCount} after · too few to call`
      : `keystrokes · ${before.summary?.insertions || 0} before · ${after.summary.insertions} after · no target pattern`;
  }
  let comparisonSaved = saved;
  if (saved) {
    profile.loops.push({
      id: uid(),
      at: new Date().toISOString(),
      beforeAttemptId: before.id,
      afterAttemptId: after.id,
      target: selectedTarget,
      recommendationKind: trainingContext?.recommendationKind || activeRecommendation?.kind || 'manual',
      drillCompleted: Boolean(trainingContext?.drillCompleted),
      conditions: after.conditions,
      comparison,
      targetTiming: timingSummary,
      drill: trainingContext?.drill || null,
    });
    comparisonSaved = saveProfile();
  }
  $('comparison-caveat').textContent = `${comparison.reason}${comparisonSaved ? '' : ' Couldn’t save on this device.'}`;
  renderHistory();
}

function startDrill() {
  // startDaily() drops the recommendation, so a stale Start drill falls back to a general drill.
  activeRecommendation ||= recommendTarget([], baselineAttempt?.conditions);
  selectedTarget = activeRecommendation.target || null;
  const mismatch = baselineAttempt ? layoutMismatch(baselineAttempt.conditions) : "";
  if (mismatch) baselineAttempt = null;
  const source = baselineAttempt?.conditions;
  if (source) restoreConditions(source);
  trainingContext = { target: selectedTarget, recommendationKind: activeRecommendation?.kind || 'general', baselineAttemptId: baselineAttempt?.id || null, drillCompleted: false };
  trainingContext.drill = { target: selectedTarget, duration: 60, wordList: prefs.wordList, textVersion: makeDrill(selectedTarget, prefs.wordList).textVersion };
  renderRecommendation();
  resetSession('drill', { focus: true });
  if (mismatch) $('session-description').textContent = `Standalone drill. ${mismatch}`;
}

function startRetest() {
  if (!baselineAttempt || baselineAttempt.status !== 'complete') return;
  const source = baselineAttempt.conditions;
  const mismatch = layoutMismatch(source);
  if (mismatch) {
    showUnavailableRetest(mismatch, 'different keyboard layout');
    return;
  }
  restoreConditions(source);
  resetSession('retest', { focus: true });
}

// The layout is set in the operating system, not here, so restoring conditions never switches it.
// A baseline typed on another layout (a missing layout means QWERTY) can't be retested on this one.
// A touch baseline never used the setting, so the setting can't block it.
function layoutMismatch(source) {
  const layout = normalizeLayout(source?.layout);
  if (source?.inputClass === 'touch' || layout === prefs.layout) return '';
  return `The baseline was typed on ${layoutLabel(layout)}. Switch the keyboard layout back to ${layoutLabel(layout)} to retest it.`;
}

// A drill or retest runs at its baseline's conditions without recording them as a settings edit: the
// saved settings, including a pick from another tab or device made meanwhile, apply again once it ends
// (resetSession leaves them waiting), and a restore never outranks a choice someone made.
// Only what the source's mode varies is restored: fields a mode fixes in conditions() (code's punctuation,
// numbers and word list; quote's numbers) keep the person's own prose settings.
function restoreConditions(source) {
  commitPreferences();
  const code = source.mode === 'code';
  const prose = !['quote', 'code'].includes(source.mode);
  // The standard recipe carries its own settings; restoring it must not overwrite the person's.
  if (source.mode === 'standard') prefs = { ...prefs, mode: 'standard' };
  else prefs = {
    ...prefs,
    mode: source.mode,
    duration: source.duration || prefs.duration,
    count: source.count || prefs.count,
    punctuation: code ? prefs.punctuation : Boolean(source.punctuation),
    numbers: prose ? Boolean(source.numbers) : prefs.numbers,
    quoteLength: source.quoteLength || prefs.quoteLength,
    difficulty: source.difficulty || prefs.difficulty,
    wordList: source.wordList || prefs.wordList,
    codeLanguage: source.codeLanguage || prefs.codeLanguage,
    correction: correctionPreference({ correction: source.correctionPolicy, stopOnError: source.correctionPolicy !== 'relaxed' }),
    stopOnError: source.correctionPolicy === 'mandatory',
  };
  livePreferences = JSON.stringify(prefs);
  applyPreferences();
  setModeControls();
}

function switchView(view) {
  document.body.dataset.view = view;
  document.querySelectorAll('[data-screen]').forEach((screen) => { screen.hidden = screen.dataset.screen !== view; });
  document.querySelectorAll('[data-nav]').forEach((control) => {
    const active = control.dataset.nav === view;
    control.classList.toggle('is-active', active);
    if (active) control.setAttribute('aria-current', 'page');
    else control.removeAttribute('aria-current');
  });
  setRunning(false);
  syncRules();
  // Pills in a hidden screen measured zero width; remeasure every group now it is visible.
  updateGlides();
  if (view === 'progress') renderHistory();
  onlineRace?.onViewChange(view);
  if (view === 'results') renderTraining();
  if (view === 'compete') renderDaily();
  if (view === 'learn') renderLessons();
  renderFirstRun();
}

function navigate(view) {
  if (view === 'practice') {
    // A custom passage that is ready or under way is practice too, so going to Practice keeps it. An unstarted
    // repeat that repeats-off would replace is redrawn.
    const current = attempt && (sessionKind === 'practice' || sessionKind === 'custom') && !['complete', 'interrupted'].includes(attempt.status);
    // A waiting passage is rebuilt, as the same kind, if strict space or quick end changed while another screen showed.
    const staleRules = current && inputRules(attempt.conditions).join() !== inputRules(sessionConditions(sessionKind)).join();
    if (!current || staleRepeat() || (preferencesWaiting && untouchedPractice())) resetSession('practice');
    else if (staleRules) resetSession(sessionKind);
    switchView('practice');
    return;
  }
  // Leaving mid-drill draws no retest passage to throw away; Train's retest button draws one when asked.
  if (attempt?.status === 'running' && view !== 'practice') {
    markInterrupted(NOTICES.leftSurface);
    finishPrimary(null, { replacing: true });
  }
  if (compose.isRunning()) compose.interrupt(NOTICES.composeLeft, { end: true });
  if (race.attempt?.status === 'running' && view !== 'compete') markRaceInterrupted();
  switchView(view);
}

// A mark still pending when focus leaves is dropped, as at the finish: the browser can commit it after
// this check (macOS Chrome blurs the window first; opening commands moves focus), which would start a
// ready run in the background.
function markInterrupted(message) {
  forgetComposition('primary');
  // A timed run past its limit (its finish can wait for a commit made in time) is over, not interrupted.
  finishIfTimeUp();
  if (attempt?.status !== 'running' || attempt.interrupted) return;
  attempt.interrupted = true;
  attempt.events.push({ type: 'focus-lost', offsetMs: offsetFor() });
  $('typing-status').className = 'badge badge-warning';
  $('typing-status').textContent = 'Interrupted';
  showInputNotice('primary', message, { sticky: true });
}

function markRaceInterrupted() {
  forgetComposition('race');
  if (race.attempt?.status !== 'running' || race.attempt.interrupted) return;
  race.attempt.interrupted = true;
  race.attempt.events.push({ type: 'focus-lost', offsetMs: offsetFor('race') });
  showInputNotice('race', NOTICES.raceFocusLost, { sticky: true, speak: false });
  raceRunChanged();
}

// A one-keyboard race keeps the chrome, but its passage is still being typed.
function localRaceRunning() {
  return race.attempt?.status === 'running' && !race.attempt.interrupted && document.body.dataset.view === 'compete';
}

function conditionOptions(select, sources, fallback = null) {
  const prior = select.value;
  const groups = new Map();
  for (const source of [...sources].reverse()) groups.set(conditionKey(source.conditions), source.conditions);
  if (!groups.size && fallback) groups.set(conditionKey(fallback), fallback);
  select.replaceChildren(...[...groups].map(([key, value]) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = describeConditions(value);
    return option;
  }));
  if (groups.has(prior)) select.value = prior;
  select.disabled = !groups.size;
  return groups.get(select.value);
}

// Raw speed, consistency, the character breakdown and the static words list. Display only.
function renderSecondaryStats(completed) {
  const replay = completed.summary;
  const steady = consistency(completed, replay);
  const chars = characterBreakdown(completed, replay);
  // Raw speed is a rate too, so a custom run that ends inside a second shows none, as for net wpm.
  $('result-raw').textContent = rateShown(completed) ? rawWpm(completed, replay) : '—';
  $('result-consistency').textContent = steady ?? '—';
  // A break opportunity after each slash, so a long breakdown wraps instead of widening the card.
  $('result-chars').replaceChildren(...[chars.correct, chars.incorrect, chars.extra, chars.missed]
    .flatMap((value, i) => (i ? ['/', document.createElement('wbr'), String(value)] : [String(value)])));
  renderWords(completed, replay);
}

// Words reached: one tab stop. Arrow keys, Home and End move between words, and focus or a tap
// shows that word's pace in the line below, so the numbers never depend on a hover tooltip.
let wordItems = [];
let wordIndex = null;
const wordPace = (item) => (item.wpm === null ? 'no pace' : `${item.wpm} wpm`);

function renderWords(completed, replay) {
  wordItems = wordHistory(completed, replay);
  // A run too quick to time shows no rate, so no word shows a pace from the same sub-second timestamps.
  if (!rateShown(completed)) wordItems = wordItems.map((item) => ({ ...item, wpm: null }));
  $('result-words').replaceChildren(...wordItems.flatMap((item, i) => {
    const word = element('span', item.word, item.wrong ? 'word-miss' : '');
    word.setAttribute('role', 'option');
    word.setAttribute('aria-label', `${item.word}, ${wordPace(item)}${item.wrong ? ', mistyped' : ''}`);
    word.dataset.index = String(i);
    word.title = wordPace(item);
    return i ? [' ', word] : [word];
  }));
  selectWord(null);
}

// Before any choice the first word is the tab stop and the line names the fastest and slowest words.
function wordSummary() {
  const paced = wordItems.filter((item) => item.wpm !== null);
  if (paced.length < 2) return wordItems.length ? 'select a word for its pace' : '';
  const fastest = paced.reduce((best, item) => (item.wpm > best.wpm ? item : best));
  const slowest = paced.reduce((low, item) => (item.wpm < low.wpm ? item : low));
  return `fastest “${fastest.word}” ${fastest.wpm} wpm · slowest “${slowest.word}” ${slowest.wpm} wpm · select a word for its pace`;
}

function selectWord(index, { focus = false } = {}) {
  const words = [...$('result-words').querySelectorAll('[role="option"]')];
  wordIndex = index === null || !words.length ? null : Math.max(0, Math.min(index, words.length - 1));
  words.forEach((word, i) => {
    word.tabIndex = i === (wordIndex ?? 0) ? 0 : -1;
    word.setAttribute('aria-selected', String(i === wordIndex));
  });
  const item = wordItems[wordIndex];
  $('result-word-detail').textContent = item ? `“${item.word}” · ${wordPace(item)}${item.wrong ? ' · mistyped' : ''}` : wordSummary();
  if (focus && item) words[wordIndex].focus();
}

function moveWordFocus(event) {
  const word = event.target.closest?.('[role="option"]');
  if (!word) return;
  const at = Number(word.dataset.index);
  const next = { ArrowLeft: at - 1, ArrowUp: at - 1, ArrowRight: at + 1, ArrowDown: at + 1, Home: 0, End: wordItems.length - 1 }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  selectWord(next, { focus: true });
}

function element(tag, text, className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

function dateCopy(at) {
  return at ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Earlier run · date unavailable';
}

function scoreFacts(items) {
  const dl = document.createElement('dl');
  for (const [label, value] of items) {
    const group = document.createElement('div');
    group.append(element('dt', label), element('dd', value, 'num'));
    dl.append(group);
  }
  return dl;
}

function openHistoryRun(id) {
  const row = [...$('run-history').children].find((item) => item.dataset.runId === id);
  if (row) { row.open = true; row.scrollIntoView({ block: 'center', behavior: 'instant' }); row.querySelector('summary').focus(); }
}

function targetButton(target, source) {
  const button = element('button', `Practice “${target}” again`, 'btn btn-secondary');
  button.type = 'button';
  button.addEventListener('click', () => practiceTarget(target, source));
  return button;
}

// The newest retained run that can anchor a fresh-text retest, at `source` conditions when given.
// Older corpus or standard recipe versions need a new baseline; a code run is never one.
function retainedBaseline(source = null) {
  return [...profile.attempts].reverse().find((a) => {
    const wanted = source || a.conditions;
    return a.status === 'complete' && !a.interrupted && ['test', 'retest', 'daily'].includes(a.kind) && a.fresh !== false
      && a.conditions?.mode !== 'code'
      && (!source || conditionKey(a.conditions) === conditionKey(source)) && wanted.corpus === CORPUS_VERSION
      && (wanted.mode !== 'standard' || wanted.recipe === STANDARD_VERSION);
  }) || null;
}

function practiceTarget(target, source) {
  baselineAttempt = retainedBaseline({ ...source, layout: inputLayout(source.inputClass) });
  restoreConditions({ ...source, corpus: CORPUS_VERSION });
  selectedTarget = target;
  const code = source.mode === 'code';
  activeRecommendation = { kind: 'manual', target, title: `Practice “${target}”`,
    reason: baselineAttempt ? `You chose “${target}”. A retained run at these conditions is your baseline.`
      : code ? `You chose “${target}”. Code runs have no fresh-text retest.`
        : `You chose “${target}”. Finish a new practice run afterward to establish a retest baseline.`,
    evidence: summarizePatterns(profile.attempts, 20, source) };
  startDrill();
  if (!baselineAttempt) $('session-description').textContent = code ? CODE_DRILL_NOTE : 'Standalone drill. Finish a new practice run afterward for a comparable retest.';
}

// The run just finished always counts toward its own recommendation, even when its trace was too large to keep.
function trainingRecommendation(source, current = null) {
  const traces = current && !profile.attempts.includes(current) ? [...profile.attempts, current] : profile.attempts;
  const recommendation = recommendTarget(traces, source);
  const recurring = recurringTargets(profile.runs, profile.loops, source)[0];
  if (!recurring) return recommendation;
  const counts = recurring.errors
    ? `${recurring.errors} first-try errors in ${recurring.observations} tries across ${recurring.runs} matching runs`
    : `slower than your own run median in ${recurring.slowRuns} matching runs, with at least 10 clean intervals in each`;
  return { ...recommendation, kind: 'targeted', target: recurring.pair,
    title: `${recurring.review ? 'Revisit' : 'Practice'} “${recurring.pair}”`,
    reason: `“${recurring.pair}”: ${counts}. ${recurring.review ? 'Fresh runs have enough new observations to revisit this target.' : 'This pattern recurred in more than one run.'}` };
}

function renderTraining() {
  const source = conditionOptions($('training-conditions'), profile.runs.filter((r) => validRun(r)
    && ['test', 'retest', 'daily'].includes(r.kind)), conditions());
  const targets = recurringTargets(profile.runs, profile.loops, source);
  $('training-memory-note').textContent = targets.length
    ? 'Counts come from up to 120 recent matching runs. Revisit checks use fresh text; one retest does not establish lasting improvement.'
    : 'No recurring pattern has enough evidence yet. Finish more runs at these conditions, or choose a manual drill above.';
  $('training-targets').replaceChildren(...targets.slice(0, 8).map((target) => {
    const row = element('article', '', 'training-target');
    const copy = document.createElement('div');
    copy.append(element('h3', `${target.review ? 'Revisit' : 'Practice'} “${target.pair}”`));
    copy.append(element('p', `${target.errors} first-try errors / ${target.observations} tries · observed in ${target.runs} runs · errors in ${target.errorRuns} · slower than your median in ${target.slowRuns}`));
    if (target.lastPracticed) copy.append(element('p', `Last practiced ${dateCopy(target.lastPracticed)}. ${target.laterObservations} observations on fresh runs since then.${target.lastCheck ? ` Last retest: ${target.lastCheck.comparison.state}.` : ''}`));
    row.append(copy, targetButton(target.pair, source));
    return row;
  }));
  renderMissedWords();
}

// Words missed on the first try in two or more recent counted runs, with what was counted.
function renderMissedWords() {
  const { runs, inputClass, recurring, words } = recurringMissedWords(profile.runs);
  const enough = words.length >= 2;
  // A redraw that hides the button while it has focus (a clear from another device, say) leaves focus on
  // the section, not lost to the page.
  const hadFocus = document.activeElement === $('practice-missed-list');
  const input = inputClass === 'touch' ? 'touch input' : 'a physical keyboard';
  $('missed-words-note').textContent = enough
    ? `First-try misses in your last ${runs} complete tests, retests and new daily passages on ${input}, all other test conditions together, up to ${MAX_MISSED_WORDS} words a run. Word practice, custom text and drills aren’t counted.`
    : runs < 2
      ? `Not enough evidence yet: ${runs ? `one run on ${input}` : 'no runs'} counted so far. A word shows here once you miss it on the first try in two complete tests, retests or new daily passages.`
      : `Not enough evidence yet: ${recurring ? `only ${wordCopy(words[0].word)} was missed on the first try in more than one of your last ${runs} runs on ${input} (in ${words[0].runs})` : `no word was missed on the first try in more than one of your last ${runs} runs on ${input}`}. The list starts at two such words.`;
  $('missed-words-list').replaceChildren(...(enough ? words : []).map((item) => {
    const row = element('li', '', 'missed-word');
    row.append(element('span', wordCopy(item.word), 'missed-word-text'), element('span', `missed in ${item.runs} of the last ${runs} runs`, 'num'));
    return row;
  }));
  $('missed-words-list').hidden = !enough;
  missedListWords = enough ? words.map((item) => item.word) : [];
  $('practice-missed-list').hidden = !enough;
  if (hadFocus && !enough) $('missed-words-heading').focus();
  $('practice-missed-list').textContent = `Practice these ${words.length} words`;
  // The run card can offer "Practice these N words" too, so the name says which words these are.
  $('practice-missed-list').setAttribute('aria-label', `Practice these ${words.length} words you keep missing`);
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// Progress headline: the current standard recipe at one input class (standardInputClass decides), so
// one touch run can't replace a keyboard score. The other class's best is named in the note.
function renderStandardScore() {
  const scoreFor = (inputClass) => {
    const key = conditionKey({ ...standardConditions(inputClass), layout: inputLayout(inputClass) });
    return standardScore(profile.runs, key, profile.bests[key]?.wpm ?? null);
  };
  const keyboard = scoreFor('physical-keyboard');
  const touch = scoreFor('touch');
  const onTouch = standardInputClass(keyboard, touch) === 'touch';
  const sourceInput = onTouch ? 'touch' : 'physical-keyboard';
  const source = { ...standardConditions(sourceInput), layout: inputLayout(sourceInput) };
  const score = onTouch ? touch : keyboard;
  const other = onTouch ? keyboard : touch;
  setText($('standard-best'), score.best ?? '—');
  setText($('standard-median'), score.median === null ? '—' : Number(score.median.toFixed(1)));
  // A dash stands alone: "— wpm" would read as a measurement.
  $('standard-best').nextElementSibling.hidden = score.best === null;
  $('standard-median').nextElementSibling.hidden = score.median === null;
  setText($('standard-median-label'), score.settled ? `median of last ${plural(score.recent, 'run')}` : 'median');
  setText($('standard-score-conditions'), `${recipeSummary(source)} · ${conditionTail(source)}`);
  // Bests outlive run summaries, so counts are of kept runs, never lifetime counts, and a best above every
  // kept run came from one that has aged out of the kept history. With none left, nothing is counted.
  const kept = MAX_RUN_SUMMARIES.toLocaleString('en-US');
  const keptBest = standardScore(profile.runs, conditionKey(source)).best;
  const olderBest = score.total && score.best > keptBest ? ` Your best comes from a run older than the newest ${kept} runs that Progress keeps.` : '';
  let note = `${plural(score.total, 'completed standard run')} kept.${olderBest} Interrupted runs don’t count.`;
  if (!score.total && score.best !== null) note = `Your best is kept, but your standard runs are older than the newest ${kept} runs that Progress keeps, so the median waits for ${STANDARD_MIN_RUNS} new ones.`;
  else if (!score.total) note = 'No standard runs yet. Every one is fresh text from the same fixed recipe, so the scores stay comparable.';
  else if (!score.settled) note = `${plural(score.total, 'standard run')} kept.${olderBest} The median appears after ${STANDARD_MIN_RUNS}, so a single fast or slow run can’t set your score.`;
  if (other.best !== null) note += ` Your ${onTouch ? 'physical keyboard' : 'touch'} best is ${other.best} wpm.`;
  setText($('standard-score-note'), note);
}

// Static heatmap: coral steps by first-attempt miss rate; thin evidence stays neutral.
// One tab stop: arrow keys move between keys as drawn, and focus or a click shows that key's numbers
// in the line below, so the values never depend on a hover tooltip. Ten keys in a phone-width row
// cannot each be a 44px touch target, so on coarse pointers the heatmap is a picture and a native
// "Key" select drives the same line.
const HEAT_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
// Lowest first. Key cells and the legend both read this table, so thresholds and labels move
// together. Number.MIN_VALUE makes step 1 "any miss at all".
const HEAT_STEPS = [
  { step: '0', min: 0, label: 'no misses' },
  { step: '1', min: Number.MIN_VALUE, label: 'under 4%' },
  { step: '2', min: 0.04, label: '4–8%' },
  { step: '3', min: 0.08, label: '8% or more' },
];
const HEAT_NONE = { step: 'none', label: `under ${MIN_PATTERN_SAMPLES} samples` };
const heatStep = (stat) => (stat?.enough ? HEAT_STEPS.findLast((s) => stat.missRate >= s.min) : HEAT_NONE);
const coarsePointer = window.matchMedia('(pointer: coarse)');
let heatKey = null;
let heatDetails = {};
let heatRuns = [];
function renderKeys(runs) {
  heatRuns = runs;
  const picture = coarsePointer.matches;
  const analysis = keyAnalysis(runs);
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const older = analysis.pairDerivedRuns;
  $('key-note').textContent = `First-try misses per key from ${analysis.runs} saved ${analysis.runs === 1 ? 'run' : 'runs'} at these conditions. Keys with fewer than ${MIN_PATTERN_SAMPLES} samples stay neutral.${older
    ? ` ${older} older ${older === 1 ? 'run counts' : 'runs count'} only letters typed after another letter, not the first letter of a word.` : ''}`;
  heatDetails = {};
  const grid = $('key-heatmap');
  const hadFocus = grid.contains(document.activeElement);
  if (picture) {
    grid.removeAttribute('role');
    grid.setAttribute('aria-hidden', 'true');
  } else {
    grid.setAttribute('role', 'grid');
    grid.removeAttribute('aria-hidden');
  }
  $('key-select-field').hidden = !picture;
  grid.replaceChildren(...HEAT_ROWS.map((letters) => {
    const row = element('div', '', 'key-row');
    if (!picture) row.setAttribute('role', 'row');
    for (const letter of letters) {
      const stat = analysis.keys[letter];
      const cell = element('span', letter, 'key');
      cell.dataset.letter = letter;
      const { step } = heatStep(stat);
      cell.dataset.heat = step;
      if (step !== 'none' && step !== '0') {
        const rate = element('span', stat.missRate >= 0.1 ? `${Math.round(stat.missRate * 100)}%` : pct(stat.missRate), 'key-rate');
        rate.setAttribute('aria-hidden', 'true');
        cell.append(rate);
      }
      if (!picture) {
        cell.setAttribute('role', 'gridcell');
        cell.tabIndex = -1;
      }
      cell.title = stat?.enough ? `${letter}: ${pct(stat.missRate)} miss · ${stat.samples} samples`
        : `${letter}: not enough samples (${stat?.samples || 0})`;
      if (!picture) cell.setAttribute('aria-label', cell.title);
      heatDetails[letter] = stat?.enough
        ? `“${letter}”: ${pct(stat.missRate)} first-try misses (${stat.errors} of ${stat.samples} samples).`
        : `“${letter}”: ${stat?.samples || 0} ${stat?.samples === 1 ? 'sample' : 'samples'}, fewer than ${MIN_PATTERN_SAMPLES}, so no miss rate yet.`;
      row.append(cell);
    }
    return row;
  }));
  selectHeatKey(heatKey, { focus: hadFocus && !picture });
  const topRate = Math.max(...analysis.pairs.map((p) => p.missRate));
  const rows = analysis.pairs.map((p) => {
    const tr = document.createElement('tr');
    // Denominator: runs with at least MIN_PATTERN_SAMPLES clean intervals for this pair.
    const slow = element('td', p.timedRuns ? `${p.slowRuns} of ${p.timedRuns}` : '—', 'num');
    slow.title = p.timedRuns
      ? `Slower than your median in ${p.slowRuns} of ${p.timedRuns} ${p.timedRuns === 1 ? 'run' : 'runs'} with at least ${MIN_PATTERN_SAMPLES} clean intervals`
      : `No run has ${MIN_PATTERN_SAMPLES} clean intervals for this pair yet`;
    if (!p.timedRuns) slow.append(element('span', ` ${slow.title}`, 'sr-only'));
    const rate = element('td', `${pct(p.missRate)} (${p.errors})`, 'num');
    const bar = element('span', '', 'pair-bar');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.width = `${topRate ? (p.missRate / topRate) * 100 : 0}%`;
    rate.append(bar);
    tr.append(element('td', `“${p.pair}”`), rate, slow, element('td', String(p.samples), 'num'));
    return tr;
  });
  $('pairs-table').querySelector('tbody').replaceChildren(...rows);
  $('pairs-table').hidden = !rows.length;
  $('pairs-empty').hidden = Boolean(rows.length);
}

// Marks one key as chosen (and, in the grid, the tab stop) and shows its numbers; with no key
// chosen yet, "q" is the stop.
function selectHeatKey(letter, { focus = false } = {}) {
  const grid = $('key-heatmap');
  const picture = grid.hasAttribute('aria-hidden');
  const cells = [...grid.querySelectorAll('.key')];
  const target = cells.find((cell) => cell.dataset.letter === letter) || cells[0];
  if (!target) return;
  for (const cell of cells) {
    if (!picture) cell.tabIndex = cell === target ? 0 : -1;
    if (cell === target && letter) cell.dataset.selected = 'true';
    else delete cell.dataset.selected;
  }
  heatKey = letter ? target.dataset.letter : null;
  $('key-select').value = heatKey || '';
  $('key-detail').textContent = heatKey ? heatDetails[heatKey] : 'Select a key to see its miss rate and sample count.';
  if (focus && !picture) target.focus();
}

function moveHeatFocus(event) {
  const cell = event.target.closest?.('.key');
  if (!cell) return;
  const row = HEAT_ROWS.findIndex((letters) => letters.includes(cell.dataset.letter));
  const col = HEAT_ROWS[row].indexOf(cell.dataset.letter);
  const at = (r, c) => HEAT_ROWS[r][Math.max(0, Math.min(c, HEAT_ROWS[r].length - 1))];
  const next = {
    ArrowLeft: () => col > 0 && at(row, col - 1),
    ArrowRight: () => col < HEAT_ROWS[row].length - 1 && at(row, col + 1),
    // Up and down keep the column, clamped to the shorter row.
    ArrowUp: () => row > 0 && at(row - 1, col),
    ArrowDown: () => row < HEAT_ROWS.length - 1 && at(row + 1, col),
    Home: () => at(event.ctrlKey ? 0 : row, 0),
    End: () => event.ctrlKey ? HEAT_ROWS.at(-1).at(-1) : at(row, HEAT_ROWS[row].length - 1),
  }[event.key];
  if (!next) return;
  event.preventDefault();
  const letter = next();
  if (letter) selectHeatKey(letter, { focus: true });
}

// Daily goal line and an 18-week practice calendar (Sunday-first columns), static by design.
// The calendar is one tab stop: each day is a labelled cell, and the arrow keys move between them as drawn.
// Goal-met days carry a dot as well as the green step, and the caption under the calendar repeats the
// focused or hovered day's label for sighted users (it is aria-hidden; the cell's own label is announced).
let goalDay = '';
function captionGoalDay(cell) { $('goal-caption').textContent = cell?.dataset?.caption || ''; }
const focusedGoalDay = () => ($('goal-calendar').contains(document.activeElement) ? document.activeElement : null);
function renderGoal(date = new Date()) {
  goalDay = dayKey(date);
  const byDay = minutesByDay(profile.runs, profile.practiceDays);
  const coarse = matchMedia('(any-pointer: coarse)').matches;
  const picker = $('goal-day-select');
  const selectedDay = picker.value || goalDay;
  $('practice-goal').hidden = Object.keys(byDay).length === 0;
  const goal = prefs.dailyGoal;
  const streak = practiceStreak(byDay, goal, date);
  $('goal-line').replaceChildren(element('span', 'Today', 'goal-label'), ` ${goalMinutes(byDay[goalDay])}${goal ? ` / ${goal}` : ''} min · ${streak}-day streak`);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 17 * 7 - date.getDay());
  const cells = [];
  for (const day = new Date(start); day <= date; day.setDate(day.getDate() + 1)) {
    const minutes = byDay[dayKey(day)] || 0;
    const met = goal > 0 && minutes >= goal;
    const cell = element('span', '', 'goal-day');
    cell.dataset.level = String(practiceLevel(minutes, goal));
    if (met) cell.dataset.goal = 'met';
    cell.setAttribute('role', 'img');
    if (!coarse) cell.tabIndex = -1;
    cell.dataset.day = dayKey(day);
    cell.setAttribute('aria-label', `${day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}: ${goalMinutes(minutes)} min${met ? ', goal met' : ''}`);
    cell.dataset.caption = [day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), `${goalMinutes(minutes)} min`, met && 'goal met'].filter(Boolean).join(' · ');
    cells.push(cell);
  }
  if (!coarse) cells.at(-1).tabIndex = 0;
  // On touch and hybrids the native 44px picker owns selection; the dense cells are only a picture.
  if (coarse) $('goal-calendar').setAttribute('aria-hidden', 'true');
  else $('goal-calendar').removeAttribute('aria-hidden');
  picker.replaceChildren(...cells.map((cell) => new Option(cell.getAttribute('aria-label'), cell.dataset.day)));
  picker.value = cells.some((cell) => cell.dataset.day === selectedDay) ? selectedDay : goalDay;
  const practised = cells.filter((cell) => cell.dataset.level !== '0').length;
  const hadFocus = Boolean(focusedGoalDay());
  $('goal-calendar').setAttribute('aria-label', `Practice minutes per day, last 18 weeks: ${practised} days with practice. Arrow keys move between days.`);
  captionGoalDay(null);
  $('goal-calendar').replaceChildren(...cells);
  if (hadFocus && !coarse) cells.at(-1).focus();
  if (document.activeElement === picker) captionGoalDay(cells.find((cell) => cell.dataset.day === picker.value));
}

function moveGoalFocus(event) {
  const cells = [...$('goal-calendar').children];
  const from = cells.indexOf(event.target);
  const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7, Home: -from, End: cells.length - 1 - from }[event.key];
  if (from < 0 || step === undefined) return;
  event.preventDefault();
  // Columns run Sunday to Saturday from the first cell, so up and down stop at the ends of a week.
  if ((event.key === 'ArrowUp' && from % 7 === 0) || (event.key === 'ArrowDown' && from % 7 === 6)) return;
  const to = cells[from + step];
  if (!to) return;
  cells[from].tabIndex = -1;
  to.tabIndex = 0;
  to.focus();
}

function renderHistory() {
  renderStandardScore();
  const listed = profile.runs.filter(practiceRun);
  const eligible = listed.filter(trendRun);
  const hasProgress = listed.length > 0 || profile.loops.length > 0;
  renderGoal();
  $('progress-empty').hidden = hasProgress;
  // Drills, daily and custom runs count toward the goal but not the trend, so the empty copy names what is missing.
  const goalOnly = !hasProgress && !$('practice-goal').hidden;
  $('progress-empty-title').textContent = goalOnly ? 'No speed trend yet.' : 'No practice runs yet.';
  $('progress-empty-copy').textContent = goalOnly
    ? 'Drills, daily and custom runs count toward your daily practice. Recorded lessons and composing active time count too. Finish a practice run to chart speed and accuracy. Daily results are in Challenge.'
    : 'Finish a practice run to begin your history. Drill and retest to save a comparison. Daily results are in Challenge.';
  $('progress-content').hidden = !hasProgress;
  const hasHistory = hasAnyHistory();
  $('clear-history').hidden = !hasHistory;
  $('clear-history').disabled = !hasHistory;
  const source = conditionOptions($('progress-conditions'), [...listed, ...profile.loops]);
  const key = source ? conditionKey(source) : '';
  const period = $('progress-period').value;
  const matching = source ? filterRuns(eligible, key, period) : [];
  const runRows = source ? filterRuns(listed, key, period) : [];
  const repeats = runRows.length - matching.length;
  const repeatCopy = repeats ? ` ${repeats} repeated-text ${repeats === 1 ? 'run is' : 'runs are'} listed below but left out of the chart and weekly medians.` : '';
  const week = weeklyChange(eligible, key);
  $('progress-week').textContent = week.wpm === null
    ? `This week: ${week.current.length} matching runs. A week-to-week change needs runs in both this week and the preceding week.`
    : `Weekly median: ${signed(week.wpm, 'wpm')} · ${signed(week.accuracy, 'pp accuracy')} · ${week.current.length} runs this week / ${week.previous.length} last week. This describes your runs, not a proven learning effect.`;
  renderTrend($('progress-trend'), matching, openHistoryRun);
  $('progress-trend-note').textContent = matching.length
    ? `${matching.length} completed practice runs and retests on fresh text, oldest to newest. Select a point or open a run below. Daily scores are in Challenge.${matching.some((r) => !r.at) ? ' Earlier undated runs appear only in All saved runs.' : ''}${repeatCopy}`
    : runRows.length
      ? `No fresh-text practice runs at these conditions in this period, so there is no chart.${repeatCopy}`
      : 'No completed practice runs at these conditions in this period. Try a longer period or different conditions.';
  renderKeys(source ? filterRuns(profile.runs, key, period) : []);
  $('run-history').replaceChildren(...[...runRows].reverse().map((run) => {
    const row = element('details', '', 'run-row');
    row.dataset.runId = run.id;
    const summary = element('summary', '', 'run-summary');
    summary.append(element('strong', `${run.score.wpm} wpm · ${run.score.accuracy}%`, 'num'),
      element('span', `${dateCopy(run.at)} · ${run.kind === 'retest' ? 'retest' : run.conditions?.mode === 'standard' ? 'standard' : 'practice'}${run.fresh === false ? ' · repeated text' : ''} · view details`));
    const detail = element('div', '', 'run-detail');
    detail.append(scoreFacts([['first-try errors', run.errors], ['time', `${(run.elapsedMs / 1000).toFixed(1)} s`]]),
      element('p', describeRun(run)), element('p', `Text: ${run.textId} · ${run.fresh === false ? 'previously displayed' : 'fresh when displayed'}`));
    const trace = profile.attempts.find((a) => a.id === run.id);
    if (trace) {
      const passageDetails = document.createElement('details');
      passageDetails.append(element('summary', 'View passage'), element('p', trace.text));
      detail.append(passageDetails);
    }
    row.append(summary, detail);
    return row;
  }));
  const loops = source ? filterRuns(profile.loops, key, period).reverse() : [];
  $('history-list').hidden = !loops.length;
  $('history-empty').hidden = Boolean(loops.length);
  const template = $('history-row-template');
  const rows = loops.map((loop, index) => {
    const row = template.content.firstElementChild.cloneNode(true);
    row.style.setProperty('--i', String(index));
    row.querySelector('.history-date').textContent = new Date(loop.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    row.querySelector('.history-target').textContent = loop.drillCompleted
      ? loop.target ? `“${loop.target}” drill and retest` : 'General drill and retest'
      : 'Fresh-text check';
    row.querySelector('.history-conditions').textContent = describeConditions(loop.conditions);
    if (loop.targetTiming?.target) {
      row.querySelector('.history-conditions').textContent += ` · ${loop.targetTiming.target} · ${loop.targetTiming.beforeCount} before · ${loop.targetTiming.afterCount} after`;
    }
    row.querySelector('.history-accuracy').textContent = signed(loop.comparison.accuracyDelta, 'pp');
    const measures = row.querySelectorAll('.history-measure span');
    if (measures[1]) measures[1].textContent = 'Corrected wpm';
    row.querySelector('.history-timing').textContent = signed(loop.comparison.wpmDelta, 'wpm');
    const status = row.querySelector('.history-status');
    status.textContent = loop.comparison.state;
    status.className = `history-status badge ${loop.comparison.state === 'improved' ? 'badge-success' : loop.comparison.state === 'regressed' ? 'badge-danger' : 'badge-neutral'}`;
    const detail = row.querySelector('.history-detail');
    detail.append(scoreFacts([
      ['before', loop.comparison.before ? `${loop.comparison.before.wpm} wpm · ${loop.comparison.before.accuracy}%` : 'Not retained in this older comparison'],
      ['after', loop.comparison.after ? `${loop.comparison.after.wpm} wpm · ${loop.comparison.after.accuracy}%` : 'Not retained in this older comparison'],
      ['drill', loop.drillCompleted ? `${loop.drill?.duration || 60} s · ${loop.target || 'general'}` : 'Skipped'],
    ]));
    const timing = loop.targetTiming;
    if (timing?.target) detail.append(element('p', `“${timing.target}” clean intervals: ${timing.beforeCount} before / ${timing.afterCount} after. ${timing.deltaMs === null ? 'Too few samples to call a timing change.' : `${signed(timing.deltaMs, 'ms')} median timing change.`}`));
    detail.append(element('p', loop.comparison.reason || 'One retest is feedback, not proof.'));
    if (loop.beforeAttemptId && loop.afterAttemptId) detail.append(element('p', `Baseline ${loop.beforeAttemptId} · retest ${loop.afterAttemptId}. Open their run entries above for saved details.`));
    if (loop.target) detail.append(targetButton(loop.target, loop.conditions));
    return row;
  });
  $('history-list').replaceChildren(...rows);
  renderComposeHistory();
}

function hasAnyHistory() {
  return profile.runs.length > 0 || profile.attempts.length > 0 || profile.loops.length > 0 || profile.compositions.length > 0
    || lessonsStarted(profile.lessons) || Object.keys(profile.practiceDays).length > 0;
}

// Composing numbers get their own list: no chart, no trend, no best, nothing shared with copy tests.
function renderComposeHistory() {
  const list = profile.compositions;
  $('compose-history').hidden = !list.length;
  if (!list.length) return;
  const shown = [...list].reverse().slice(0, 10);
  $('compose-history-note').textContent = 'Free-typing wpm is characters in your text ÷ 5 per minute of active typing, a pause over 2\u00a0s counting as your average gap. '
    + `Kept apart from copy-test charts and never a best. ${list.length} ${list.length === 1 ? 'session' : 'sessions'} saved`
    + `${list.length > shown.length ? `; the newest ${shown.length} are shown` : ''}. Only these numbers are kept, never your words.`;
  $('compose-history-list').replaceChildren(...shown.map((item) => {
    const row = element('article', '', 'compose-row');
    const main = element('div', '', 'compose-row-main');
    main.append(element('strong', `${item.wpm} wpm`, 'num'), element('span', `${item.backspaceRate}% backspace rate`, 'num'));
    const prompt = promptText(item.promptId);
    row.append(main, element('p', prompt ? `“${prompt}”` : 'A prompt no longer offered'),
      element('p', `${dateCopy(item.at)} · ${item.characters} characters · ${item.backspaces} ${item.backspaces === 1 ? 'backspace' : 'backspaces'} in ${item.keystrokes} keystrokes · ${(item.activeMs / 1000).toFixed(1)} s active of ${(item.elapsedMs / 1000).toFixed(1)} s · ${item.inputClass === 'touch' ? 'touch input' : 'physical keyboard'}`, 'condition-copy'));
    return row;
  }));
}

// Everyone types the daily passage under the same rules, whatever their practice settings.
function dailyConditions() {
  return { ...settingsConditions(), mode: 'quote', duration: null, count: null, punctuation: true, numbers: false,
    quoteLength: 'medium', difficulty: 'any', wordList: null, correctionPolicy: 'relaxed', strictSpace: false, quickEnd: true, corpus: CORPUS_VERSION };
}

function todayPassage() {
  const daily = dailyPassage();
  return { ...daily, id: daily.sourceTextId, challengeId: daily.id, corpus: CORPUS_VERSION,
    firstDailyAttempt: !profile.seenTextIds.includes(daily.id), fresh: !profile.seenTextIds.includes(daily.sourceTextId) };
}

function startDaily() {
  if (attempt?.status === 'running') { markInterrupted(NOTICES.leftSurface); finishPrimary(null, { replacing: true }); }
  if (race.attempt?.status === 'running') markRaceInterrupted();
  baselineAttempt = null;
  trainingContext = null;
  activeRecommendation = null;
  // The baseline is gone, so Train no longer offers the drill's retest.
  renderRecommendation();
  resetSession('daily', { focus: true });
}

function renderDaily() {
  const daily = dailyPassage();
  $('daily-date').textContent = `${daily.day} · english · resets 00:00 UTC`;
  const completed = profile.runs.filter((r) => r.kind === 'daily' && validRun(r));
  const today = completed.filter((r) => r.challengeDate === daily.day && conditionKey(r.conditions) === conditionKey(dailyConditions()));
  const best = [...today].sort((a, b) => b.score.wpm - a.score.wpm || b.score.accuracy - a.score.accuracy)[0];
  const layout = isDefaultLayout(prefs.layout) ? '' : ` in ${layoutLabel(prefs.layout)}`;
  $('daily-status').textContent = best
    ? `Today’s best: ${best.score.wpm} wpm · ${best.score.accuracy}% accuracy · ${today.length} ${today.length === 1 ? 'attempt' : 'attempts'} on a physical keyboard${layout}.${session ? '' : ' Sign in to save future results beyond this tab.'}`
    : `No completed physical-keyboard attempt${layout} today.${session ? ' Your results save to your account.' : ' Results last in this tab; sign in to save future attempts.'}`;
  $('daily-history-panel').hidden = !completed.length;
  $('daily-history').replaceChildren(...[...completed].reverse().slice(0, 30).map((run) => {
    const row = element('div', '', 'daily-result');
    row.append(element('strong', `${run.score.wpm} wpm · ${run.score.accuracy}%`, 'num'),
      element('span', `${run.challengeDate} · ${(run.firstDailyAttempt ?? run.fresh) ? 'first attempt' : 'repeat attempt'}${run.firstDailyAttempt && !run.fresh ? ' · previously displayed passage' : ''} · ${inputLabel(run.conditions)}`));
    return row;
  }));
}

// ── Lessons ───────────────────────────────────────────────────────────────

const HANDOFF_COPY = 'That’s the whole keyboard. From here the training loop takes over: take a practice run, and Train suggests a one-minute drill from your own mistakes once there’s enough evidence, then retests you on fresh text.';
let lessonActions = { primary: null, secondary: null };

function lessonCopy(index, current = null) {
  return `${LESSONS[index].focus} ${makeupCopy(index, current?.lessonId === LESSONS[index].id ? current : null)}`;
}

const lessonFingers = (lesson) => lesson.keys.map((key) => `${key} ${fingerFor(key)}`).join(' · ');

// "left and right index" for a mirrored pair, otherwise each finger in key order.
function fingerNames(lesson) {
  const fingers = lesson.keys.map((key) => fingerFor(key));
  const [a, b] = fingers.map((name) => name.split(' '));
  return b && a[0] !== b[0] && a[1] === b[1] ? `${a[0]} and ${b[0]} ${a[1]}` : fingers.join(' and ');
}

function lessonMeta(index) {
  const lesson = LESSONS[index];
  const tries = profile.lessons[lesson.id]?.tries;
  return `${lessonFingers(lesson)} · pass at ${LESSON_ACCURACY}% accuracy and ${lesson.wpm} wpm in one run${tries ? ` · ${tries} ${tries === 1 ? 'try' : 'tries'} so far` : ''}`;
}

// Like every run, a lesson is classed by the press that started it (resetSession reads activationInput).
function startLesson(index) {
  if (!lessonUnlocked(profile.lessons, index)) return;
  if (attempt?.status === 'running') { markInterrupted(NOTICES.leftSurface); finishPrimary(null, { replacing: true }); }
  if (race.attempt?.status === 'running') markRaceInterrupted();
  lessonIndex = index;
  resetSession('lesson', { focus: true });
  // From a scrolled learn screen too, a lesson starts with its title, label and finger map in view.
  scrollTo({ top: 0, behavior: 'instant' });
}

// The in-page links sit in a screen that is about to hide, so focus moves to the learn screen's action.
function openLessons() {
  navigate('learn');
  $('lesson-primary').focus({ preventScroll: true });
}

// Every letter is in: the training loop (practice → recommendation → drill → retest) takes over.
function startTrainingLoop() {
  lessonResult = null;
  resetSession('practice', { focus: true });
}

function finishLesson(completed, valid) {
  const { score, elapsedMs, firstAttempts } = completed.summary;
  const touch = completed.conditions.inputClass === 'touch';
  let outcome = null;
  let firstPass = false;
  let recorded = false;
  let saved = true;
  const at = new Date().toISOString();
  if (valid) {
    const run = recordLessonRun(profile.lessons, lessonIndex, score, at, completed.conditions.inputClass);
    // A lesson that was locked when it finished saves nothing, but still shows its numbers.
    outcome = run.outcome || lessonOutcome(lessonIndex, score);
    firstPass = run.firstPass;
    recorded = run.recorded;
    if (recorded) {
      profile.lessons = run.progress;
      profile.practiceDays = recordPracticeTime(profile.practiceDays, at, elapsedMs);
      saved = saveProfile();
    }
  }
  lessonResult = { failed: completed.failed, index: lessonIndex, score, elapsedMs, errors: firstAttempts.filter((item) => !item.correct).length, outcome, firstPass, recorded, at, touch, saved, valid };
  switchView('learn');
  announce(`${lessonHeadline(lessonResult)} ${score.accuracy}% accuracy, ${score.wpm} wpm.`);
  // Show the result from the top of the page, or from the result itself when the page is too short.
  scrollTo({ top: 0, behavior: 'instant' });
  if ($('lesson-current').getBoundingClientRect().bottom > innerHeight) $('lesson-current').scrollIntoView({ block: 'start', behavior: 'instant' });
  $('lesson-primary').focus({ preventScroll: true });
}

// Whether progress still holds what a lesson result shows: its lesson open and, if the run was saved, that very
// try. A newer account row adopted at load replaces tries made here before the check, whatever it unlocks.
function lessonResultHeld(result, progress) {
  if (!lessonUnlocked(progress, result.index)) return false;
  const entry = progress[LESSONS[result.index].id];
  return !result.recorded || [entry?.last?.at, entry?.passed?.at].includes(result.at);
}

function lessonHeadline(result) {
  const n = result.index + 1;
  if (!result.valid) return result.failed ? `Lesson ${n} failed · ${result.failed} · not counted` : `Lesson ${n} interrupted · not counted`;
  if (!result.recorded) return `Lesson ${n} is locked · not counted`;
  if (result.touch) return `Lesson ${n} on touch input · doesn’t unlock`;
  const next = nextLessonIndex(profile.lessons);
  if (result.outcome?.passed) {
    if (!result.firstPass) return `Lesson ${n} passed again.`;
    if (next >= LESSONS.length) return `Lesson ${n} passed. Every letter is in.`;
    const keys = LESSONS[next].keys;
    return `Lesson ${n} passed. ${keysLabel(keys)} ${keys.length > 1 ? 'are' : 'is'} next.`;
  }
  const { accuracyMet, speedMet, accuracyTarget, wpmTarget } = result.outcome;
  const needs = [accuracyMet ? '' : `${accuracyTarget}% accuracy`, speedMet ? '' : `${wpmTarget} wpm`].filter(Boolean).join(' and ');
  return `Not yet. Lesson ${n} needs ${needs} in one run.`;
}

function lessonFacts(result) {
  const { outcome, score } = result;
  const group = (label, value, need) => {
    const item = document.createElement('div');
    item.append(element('dt', label), element('dd', value, 'num'));
    if (need) item.append(element('dd', need, 'lesson-need num'));
    return item;
  };
  // Each target says whether it was met in words, beside the number it qualifies.
  const met = (item, ok) => {
    const word = element('dd', '', `status badge ${ok ? 'badge-success' : 'badge-neutral'}`);
    const dot = element('span', '', 'status-dot');
    dot.setAttribute('aria-hidden', 'true');
    word.append(dot, ok ? 'met' : 'not met');
    item.append(word);
    return item;
  };
  return [
    met(group('accuracy', `${score.accuracy}%`, `${outcome.accuracyTarget}% needed`), outcome.accuracyMet),
    met(group('wpm', String(score.wpm), `${outcome.wpmTarget} needed`), outcome.speedMet),
    group('first-try errors', String(result.errors)),
    group('time', `${(result.elapsedMs / 1000).toFixed(1)} s`),
  ];
}

function renderLessons() {
  const progress = profile.lessons;
  const next = nextLessonIndex(progress);
  const complete = next >= LESSONS.length;
  const result = lessonResult;
  let status = null;
  let heading;
  let copy;
  let meta = '';
  let primary;
  let secondary = null;
  const start = (index) => () => startLesson(index);
  if (result) {
    const n = result.index + 1;
    const repeat = [`Repeat lesson ${n}`, start(result.index)];
    heading = lessonHeadline(result);
    if (!result.valid) {
      status = [result.failed ? 'failed' : 'interrupted', 'badge-warning'];
      copy = result.failed ? 'The correction setting ended this lesson, so it doesn’t count toward unlocking.' : 'Focus or input changed during the run, so it doesn’t count toward unlocking.';
      primary = [`Try lesson ${n} again`, start(result.index)];
    } else if (!result.recorded) {
      status = ['not counted', 'badge-neutral'];
      copy = 'Your lesson progress changed during this run (history was cleared here or on another device), so this lesson is locked and nothing was saved.';
      primary = complete ? ['Take a practice run', startTrainingLoop] : [`Start lesson ${next + 1}`, start(next)];
    } else if (result.touch) {
      status = ['touch input', 'badge-neutral'];
      copy = 'Lessons teach finger positions on a physical keyboard, so only a physical-keyboard run unlocks the next keys. This run is kept as a touch try.';
      primary = [`Try lesson ${n} again`, start(result.index)];
      if (complete) secondary = ['Take a practice run', startTrainingLoop];
      else if (next !== result.index) secondary = [`Start lesson ${next + 1}`, start(next)];
    } else if (result.outcome?.passed) {
      status = ['passed', 'badge-success'];
      copy = complete ? HANDOFF_COPY : lessonCopy(next);
      if (!complete) meta = lessonMeta(next);
      primary = complete ? ['Take a practice run', startTrainingLoop] : [`Start lesson ${next + 1}`, start(next)];
      secondary = repeat;
    } else {
      status = ['not yet', 'badge-neutral'];
      const lesson = LESSONS[result.index];
      const after = LESSONS[result.index + 1]?.keys;
      if (progress[lesson.id]?.passed) copy = 'You passed this lesson before; this try doesn’t change that.';
      else if (after) copy = `${keysLabel(after)} ${after.length > 1 ? 'stay' : 'stays'} locked until one run meets both numbers.`;
      else copy = 'Every letter is in once one run meets both numbers.';
      primary = [`Try lesson ${n} again`, start(result.index)];
      if (complete) secondary = ['Take a practice run', startTrainingLoop];
      else if (next !== result.index) secondary = [`Start lesson ${next + 1}`, start(next)];
    }
    if (!result.saved) meta = [meta, 'Couldn’t save on this device.'].filter(Boolean).join(' · ');
  } else if (complete) {
    status = ['all letters in', 'badge-success'];
    heading = 'Every letter is in.';
    copy = HANDOFF_COPY;
    primary = ['Take a practice run', startTrainingLoop];
  } else {
    heading = `Lesson ${next + 1} · ${keysLabel(LESSONS[next].keys)}`;
    copy = lessonCopy(next);
    meta = lessonMeta(next);
    primary = [`Start lesson ${next + 1}`, start(next)];
  }
  $('lesson-status').hidden = !status;
  if (status) {
    $('lesson-status').className = `status badge ${status[1]}`;
    $('lesson-status-word').textContent = status[0];
  }
  $('lesson-current-heading').textContent = heading;
  $('lesson-current-copy').textContent = copy;
  $('lesson-current-meta').textContent = meta;
  $('lesson-facts').hidden = !result?.valid;
  $('lesson-facts').replaceChildren(...(result?.valid ? lessonFacts(result) : []));
  $('lesson-primary').textContent = primary[0];
  $('lesson-secondary').hidden = !secondary;
  $('lesson-secondary').textContent = secondary?.[0] || '';
  lessonActions = { primary: primary[1], secondary: secondary?.[1] || null };

  const fresh = complete ? [] : LESSONS[next].keys;
  renderFingerMap($('lesson-keyboard'), { known: lessonKeys(complete ? LESSONS.length - 1 : next - 1), fresh });
  $('finger-caption-keys').textContent = complete ? 'every key learned' : `green edge: lesson ${next + 1}’s keys`;
  $('lesson-save-note').textContent = `${isDefaultLayout(prefs.layout) ? '' : 'Lessons teach QWERTY finger positions. Use QWERTY in your operating system for these lessons; your practice layout setting is kept. '}${session ? 'Lesson progress saves to your account.' : 'Lesson progress lasts for this tab; sign in to save future lessons.'} Lessons stay out of your bests, progress charts and retests.`;

  $('lesson-list').replaceChildren(...LESSONS.map((lesson, index) => {
    const entry = progress[lesson.id];
    const passed = Boolean(entry?.passed);
    const open = !passed && index <= next;
    const row = element('li', '', 'lesson-row');
    row.dataset.state = passed ? 'passed' : open ? 'next' : 'locked';
    const keys = element('span', '', 'lesson-keys');
    keys.append(...lesson.keys.map((key) => element('kbd', key)));
    const main = element('div', '', 'lesson-row-main');
    main.append(keys, element('span', fingerNames(lesson), 'lesson-row-note'));
    const state = element('span', '', `lesson-row-state status badge ${passed ? 'badge-success' : open ? 'badge-info' : 'badge-neutral'}`);
    const dot = element('span', '', 'status-dot');
    dot.setAttribute('aria-hidden', 'true');
    state.append(dot, passed ? 'passed' : open ? 'next' : 'locked');
    const numbers = passed ? `${entry.passed.wpm} wpm · ${entry.passed.accuracy}%`
      : entry?.last ? `${entry.tries} ${entry.tries === 1 ? 'try' : 'tries'} · last ${entry.last.wpm} wpm · ${entry.last.accuracy}%${entry.last.inputClass === 'touch' ? ' · touch input' : ''}` : '';
    const detail = element('div', '', 'lesson-row-detail');
    detail.append(state, element('span', numbers, 'lesson-row-numbers num'));
    row.append(element('span', String(index + 1), 'lesson-number num'), main, detail);
    if (passed || open) {
      const button = element('button', passed ? 'Repeat' : 'Start', 'btn btn-ghost btn-sm');
      button.type = 'button';
      button.setAttribute('aria-label', `${passed ? 'Repeat' : 'Start'} lesson ${index + 1}, ${keysLabel(lesson.keys)}`);
      button.addEventListener('click', start(index));
      row.append(button);
    }
    return row;
  }));
}

function renderFirstRun() {
  $('train-learn').hidden = Boolean(shownResult || profile.runs.length || profile.attempts.length);
}

// ── Ghost races ───────────────────────────────────────────────────────────
// A friend's recorded run, raced on the practice surface against a ghost caret that replays their
// keystrokes (src/ghost-race.js). The run is kind 'challenge', non-comparable like custom text: only its
// summary is kept, and it is never a best.

const GHOST_CONDITION_KEYS = ['mode', 'duration', 'count', 'punctuation', 'numbers', 'quoteLength', 'difficulty', 'wordList',
  'correctionPolicy', 'language', 'corpus', 'metricVersion'];

const inputOf = (value = {}) => value.inputClass === 'touch' ? 'touch' : 'physical-keyboard';
// A run that wasn't sent for these reasons can be raced again; a failed send is retried as is.
const RACE_AGAIN = ['interrupted', 'unsendable', 'unreplayable', 'other-input'];
const ghostInputLabel = (value) => inputOf(value) === 'touch' ? 'touch input' : 'a physical keyboard';

// The sender's test conditions, so the same finish rule applies; the input class is this device's.
function ghostConditions() {
  const source = ghostRace.conditions || {};
  return { ...Object.fromEntries(GHOST_CONDITION_KEYS.filter((key) => key in source).map((key) => [key, source[key]])),
    inputClass: 'physical-keyboard' };
}

// A quote or daily passage keeps its own text id, worked out from the text, so a quote raced here
// can't later count as fresh. Word and timed text gets the id of exactly that text.
function ghostPassage() {
  const id = challengeTextId(ghostRace.passage, ghostRace.conditions);
  return { id, text: ghostRace.passage, fresh: !profile.seenTextIds.includes(id) };
}

// An open online room keeps the surface: a ghost race never starts over it.
function onlineRoomFirst() {
  if (!onlineRace?.liveRoomId) return false;
  showAccountToast('Leave your online race before starting a ghost race.');
  return true;
}

// Where the person is, as a Race sees it: the view, the session set up on the practice surface and its run's
// status, anything typed since (in the passage or any field), the custom editor, a local race player, an
// online room open or on its way, and any dialog.
function raceContext() {
  return JSON.stringify([document.body.dataset.view, sessionCount, attempt?.status, typedCount, customOpen, race.attempt?.id,
    race.attempt?.status, onlineRace?.liveRoomId || null, Boolean(onlineRace?.pending), Boolean(document.querySelector('dialog[open]'))]);
}

// Every ghost race reply checks, once it lands, that what it was asked for is still current: the Race
// (ghostRequest), the finished run still on screen (submitGhostRun), the offered run (sendGhost) or the
// friend list (friendsRequest). A late one changes nothing here; what the service did stands, and its
// result still reaches the inbox.
async function startGhostRace(id) {
  if (onlineRoomFirst()) return;
  heldRaceError = '';
  const request = ghostRequest = { id, context: raceContext() };
  let view = null;
  let failure = null;
  try { view = await getChallenge(session, id); } catch (error) { failure = error; }
  // A later Race replaces this one.
  if (ghostRequest !== request) return;
  ghostRequest = null;
  // The race opens only where it was asked for. Whatever the person has done since (another view, a new
  // session, a run begun or ended, typing in the passage or a field, the custom editor, a local race, an
  // online room, a dialog) stays theirs, and the race is offered instead; nor does it open while a room is
  // on its way, which would open over it.
  const here = raceContext() === request.context && !onlineRace?.pending;
  let conditions;
  try {
    if (failure) throw failure;
    if (view.role !== 'received' || view.status !== 'open' || typeof view.passage !== 'string' || !validTrace(view.trace)) {
      throw new Error(view.status === 'done' ? 'You have already raced this run.'
        : view.status === 'expired' ? 'This ghost race has expired.' : 'That ghost race is unavailable.');
    }
    // The conditions come from the sender's browser and are copied into this run, so they are never
    // taken on trust: a run this app can't set up the same way would not be a fair race.
    conditions = challengeConditions(view.conditions, view.duration ?? null);
    if (!conditions) throw new Error('This ghost race was recorded with settings this app can’t reproduce, so it can’t be raced fairly.');
  } catch (error) {
    // Saying why changes nothing on screen. Said away from where Race was clicked, it names the race; beside
    // a run the person went on typing, it waits for the run to end.
    if (here) showAccountToast(error.message);
    else {
      const message = `${view?.name ? `${view.name}’s race` : 'The ghost race'} didn’t start. ${error.message}`;
      if (runInProgress()) heldRaceError = message;
      else showAccountToast(message);
    }
    return;
  }
  // The offer is the inbox toast, held until a run ends; taking it asks again from where the person is then.
  if (!here) {
    inbox?.offer(`challenge:${id}`, `${view.name}’s race is ready.`);
    return;
  }
  if (attempt?.status === 'running') { markInterrupted(NOTICES.leftSurface); finishPrimary(); }
  if (race.attempt?.status === 'running') markRaceInterrupted();
  ghostRace = { id, name: view.name, passage: view.passage, conditions, duration: view.duration ?? null,
    points: ghostPoints(view.trace, view.passage.length), sender: view.sender, result: null, run: null, state: 'ready' };
  // As with the daily: someone else's text ends any drill-and-retest cycle in progress.
  baselineAttempt = null;
  trainingContext = null;
  activeRecommendation = null;
  inbox?.settle(`challenge:${id}`);
  resetSession('challenge', { focus: true });
}

function renderGhostResult() {
  const ghost = ghostRace;
  const panel = $('ghost-result');
  panel.hidden = !ghost?.run;
  if (!ghost?.run) return;
  // Until the service replies, the result is the same replay of the same trace, done here.
  const mine = ghost.result || (ghost.trace ? scoreTrace(ghost.trace, ghost.passage, { relaxed: ghost.run.conditions.correctionPolicy === 'relaxed' }) : null);
  const match = { duration: ghost.duration, sender: ghost.sender, result: mine };
  const leader = mine ? challengeOutcome(match) : null;
  $('ghost-result-heading').textContent = ghost.state === 'interrupted' ? 'Interrupted, so not sent.'
    : ghost.state === 'other-input' ? 'A different kind of input, so not sent.'
      : ghost.state === 'unreplayable' ? 'A character a ghost race can’t replay, so not sent.' : !mine ? 'Too long to send.'
        : leader === 'tie' ? 'A tie.' : `${leader === 'recipient' ? 'You' : ghost.name} ${leadVerb(match, leader)}.`;
  const rows = [...(mine ? [{ name: 'You', score: mine }] : []), { name: ghost.name, score: ghost.sender }];
  if (leader === 'sender') rows.reverse();
  $('ghost-result-rows').replaceChildren(...rows.map(({ name, score }) => {
    const row = element('article', '', 'race-result-row');
    row.append(element('strong', name));
    for (const value of [`${score.wpm} wpm`, `${score.accuracy}% accuracy`, `${(score.elapsedMs / 1000).toFixed(1)} s`]) row.append(element('span', value, 'num'));
    return row;
  }));
  $('ghost-result-rule').textContent = `${outcomeRule(ghost)} wpm counts correct characters kept.`;
  const retry = ghost.state === 'failed' && (!ghost.error?.status || ghost.error.status >= 500);
  $('ghost-result-status').textContent = {
    sending: `Sending your run to ${ghost.name}…`,
    sent: `Sent. ${ghost.name} sees this result in their inbox too.`,
    kept: `Your first finish was already sent and stands, so this run wasn’t. ${ghost.name} sees the result shown here.`,
    failed: `Not sent. ${ghost.error?.message || ''}`,
    interrupted: 'Focus or input changed during the run. Race again to send a finished run.',
    unsendable: 'A run of more than 6,000 keys can’t be sent. Race again with fewer corrections.',
    unreplayable: 'This run included an emoji or a similar character, which a ghost race can’t replay. Race again to send a run.',
    'other-input': `${ghost.name} typed on ${ghostInputLabel(ghost.conditions)} and this run used ${ghostInputLabel(ghost.run.conditions)}; the two are never compared. Race again on ${ghostInputLabel(ghost.conditions)} to send a run.`,
  }[ghost.state] || '';
  const again = RACE_AGAIN.includes(ghost.state);
  const action = $('ghost-result-action');
  action.hidden = !(again || retry);
  action.textContent = again ? 'Race again' : 'Send again';
}

async function submitGhostRun() {
  const ghost = ghostRace;
  if (!ghost?.trace || !session) return;
  // The run this request finishes. The service records it either way, and its result reaches the inbox.
  const { run, trace } = ghost;
  ghost.state = 'sending';
  renderGhostResult();
  let view = null;
  let failure = null;
  try {
    view = await finishChallenge(session, ghost.id, trace);
    const id = `challenge:${ghost.id}`;
    inbox?.notify({ id, kind: 'challenge-result', challengeId: ghost.id, closed: false, until: null, completedAt: view.completedAt, text: resultText(view) });
    inbox?.deliver(id);
  } catch (error) {
    failure = error;
  }
  // The panel shows the reply only while the results on screen are still this run's: once a later run
  // has finished (after Run again, a restart or another race), its result never gains this panel.
  if (ghostRace !== ghost || ghost.run !== run || shownResult !== run) return;
  if (failure) {
    ghost.state = 'failed';
    ghost.error = failure;
  } else {
    // The service's stored result is the one that counts. A retry after a lost reply gets this run's
    // back; a finish already sent from another try or device stands instead of this one.
    const local = scoreTrace(trace, ghost.passage, { relaxed: run.conditions.correctionPolicy === 'relaxed' });
    ghost.result = view.result;
    ghost.sender = view.sender || ghost.sender;
    ghost.state = sameScore(view.result, local) ? 'sent' : 'kept';
  }
  renderGhostResult();
  // Spoken only on the results view: a run started meanwhile is not interrupted.
  if (document.body.dataset.view === 'results') announce(`${$('ghost-result-heading').textContent} ${$('ghost-result-status').textContent}`);
}

let offerFriends = [];

const racerName = () => $('online-name').value.trim() || session?.user.email.split('@')[0].slice(0, 24) || '';

// "Challenge a friend with this run": shown under a finished practice, retest or daily run.
function renderGhostOffer(completed = offerRun) {
  if (completed !== offerRun) {
    offerRun = completed;
    offerSentTo = new Set();
    offerRequests = new Map();
    friendsRequest = null;
    $('ghost-offer').open = false;
    $('ghost-offer-status').textContent = '';
    $('ghost-offer-error').textContent = '';
  }
  $('ghost-offer').hidden = !session || !challengePayload(offerRun);
}

async function loadGhostFriends() {
  const select = $('ghost-friend');
  if (!$('ghost-name').value) $('ghost-name').value = racerName();
  if (!offerFriends.length) select.replaceChildren(new Option('Loading friends…', ''));
  select.disabled = true;
  $('send-ghost').disabled = true;
  const request = friendsRequest = {};
  let friends = offerFriends;
  let failure = '';
  try { friends = await listFriends(session); } catch (error) { failure = error.message; }
  // Only the newest list for this offer is drawn.
  if (friendsRequest !== request) return;
  offerFriends = friends;
  $('ghost-offer-error').textContent = failure;
  const empty = !offerFriends.length;
  $('ghost-offer-empty').hidden = !empty || Boolean(failure);
  $('ghost-offer-form').hidden = empty;
  const prior = select.value;
  select.replaceChildren(...offerFriends.map((friend) => new Option(friend.email ? `${friend.name} (${friend.email})` : friend.name, friend.id)));
  if (offerFriends.some((friend) => friend.id === prior)) select.value = prior;
  select.disabled = empty;
  $('send-ghost').disabled = empty || offerBusy();
}

async function sendGhost(event) {
  event.preventDefault();
  const payload = challengePayload(offerRun);
  const friend = offerFriends.find((value) => value.id === $('ghost-friend').value);
  const name = $('ghost-name').value.trim();
  $('ghost-offer-error').textContent = '';
  if (!payload || !friend || !session || offerBusy()) return;
  if (!name) { $('ghost-offer-error').textContent = 'Enter the name your friend will see.'; $('ghost-name').focus(); return; }
  if (offerSentTo.has(friend.id)) { $('ghost-offer-status').textContent = `Already sent to ${friend.name}.`; return; }
  const run = offerRun;
  if (!offerRequests.has(friend.id)) offerRequests.set(friend.id, crypto.randomUUID());
  const requestId = offerRequests.get(friend.id);
  offerSending = run;
  $('send-ghost').disabled = true;
  $('ghost-offer-status').textContent = `Sending to ${friend.name}…`;
  try {
    await sendChallenge(session, { friendId: friend.id, displayName: name, payload, requestId });
    if (run !== offerRun) return;
    offerSentTo.add(friend.id);
    // As with race invitations, the reply never says whether a saved email has an account.
    $('ghost-offer-status').textContent = `Sent to ${friend.name}. ${friend.email ? `If ${friend.email} has an account, they` : 'They'} have ${CHALLENGE_DAYS} days to race it, and the result arrives in your inbox.`;
  } catch (error) {
    if (run !== offerRun) return;
    $('ghost-offer-status').textContent = '';
    $('ghost-offer-error').textContent = error.message;
  } finally {
    // A reply for an earlier run leaves the button to the offer now on screen.
    if (offerSending === run) offerSending = null;
    if (run === offerRun) $('send-ghost').disabled = false;
  }
}

// The legend follows the chosen layout; typed characters are never remapped. The optional finger
// map shades each key by the finger that types it (data-hand, data-finger) and splits the hands.
function buildKeyboard() {
  const signature = `${prefs.layout}:${prefs.fingerMap}`;
  if (signature === keyboardBuilt) return;
  keyboardBuilt = signature;
  const keyboard = $('keyboard');
  keyboard.dataset.layout = prefs.layout;
  keyboard.dataset.fingers = String(prefs.fingerMap);
  keyboard.classList.remove("finger-map");
  keyboard.removeAttribute("role");
  keyboard.setAttribute("aria-label", "On-screen keyboard");
  const fragment = document.createDocumentFragment();
  for (const keys of keyboardRows(prefs.layout)) {
    const row = document.createElement('div');
    row.className = 'key-row';
    for (const { key: letter, hand, finger, column } of keys) {
      const key = document.createElement('span');
      key.className = `key${letter === ' ' ? ' space' : ''}`;
      key.dataset.key = letter;
      key.dataset.hand = hand;
      key.dataset.finger = finger;
      key.dataset.column = String(column);
      const label = letter === ' ' ? 'space' : letter;
      if (prefs.fingerMap) {
        // The initial and band are hidden from screen readers, so each key says its finger in words,
        // as one phrase ("f, left index"); the printed cap is unchanged.
        const cap = element('span', label);
        cap.setAttribute('aria-hidden', 'true');
        key.append(cap, element('span', `${label}, ${hand === 'both' ? 'thumbs' : `${hand} ${finger}`}`, 'sr-only'));
      } else key.textContent = label;
      row.append(key);
    }
    fragment.append(row);
  }
  if (prefs.fingerMap) {
    const legend = document.createElement('p');
    legend.className = 'finger-legend';
    legend.append(...FINGERS.map((finger) => {
      const item = element('span', finger);
      item.dataset.finger = finger;
      return item;
    }), element('span', 'space · thumbs'));
    fragment.append(legend);
  }
  keyboard.replaceChildren(fragment);
  markKeyboardTargets(keyboardTarget);
}

// A split keyboard where each column belongs to one finger, labelled underneath; thumbs take the space bar.
// Keys learned before this lesson read in the text colour, this lesson's keys get the full green edge.
const FINGER_ROWS = { left: ['qwert', 'asdfg', 'zxcvb'], right: ['yuiop', 'hjkl;', 'nm'] };
const FINGER_COLUMNS = { left: [['pinky', 1, 1], ['ring', 2, 1], ['middle', 3, 1], ['index', 4, 2]], right: [['index', 1, 2], ['middle', 3, 1], ['ring', 4, 1], ['pinky', 5, 1]] };

function fingerMapLabel(fresh) {
  const zones = FINGER_ZONES.map((zone) => `${zone.hand} ${zone.finger}: ${zone.keys.join(' ')}`);
  return `Finger map. ${zones.join('. ')}. Thumbs: space.${fresh.length ? ` New keys: ${fresh.join(' ')}, ${fresh.map((key) => fingerFor(key)).join(' and ')}.` : ''}`;
}

function renderFingerMap(container, { known = [], fresh = [] } = {}) {
  const key = (letter) => {
    const node = element('span', letter === ' ' ? 'space' : letter, `key${letter === ' ' ? ' space' : ''}`);
    node.dataset.key = letter;
    node.classList.toggle('target', fresh.includes(letter));
    node.classList.toggle('is-known', letter === ' ' || known.includes(letter));
    return node;
  };
  const hands = ['left', 'right'].map((hand) => {
    const grid = element('div', '', `finger-hand finger-hand-${hand}`);
    FINGER_ROWS[hand].forEach((row, rowIndex) => [...row].forEach((letter, column) => {
      const node = key(letter);
      node.style.gridArea = `${rowIndex + 1} / ${column + 1}`;
      grid.append(node);
    }));
    for (const [finger, column, span] of FINGER_COLUMNS[hand]) {
      const label = element('span', '', 'finger-label');
      label.style.gridArea = `4 / ${column} / 5 / ${column + span}`;
      label.append(element('span', finger, 'finger-label-full'), element('span', finger[0], 'finger-label-short'));
      grid.append(label);
    }
    return grid;
  });
  const thumbs = element('div', '', 'finger-thumbs');
  thumbs.append(key(' '), element('span', 'thumbs', 'finger-label'));
  // Narrow screens shorten the finger names to a letter; the legend says what each letter means.
  const legend = element('span', 'p pinky · r ring · m middle · i index', 'finger-legend');
  container.classList.add('finger-map');
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', fingerMapLabel(fresh));
  container.replaceChildren(...hands, thumbs, legend);
}

// The typing keyboard shows the finger map for the whole of a lesson, whatever the keyboard setting.
function renderKeyboard() {
  const lesson = sessionKind === 'lesson';
  if (lesson) renderFingerMap($('keyboard'), { known: lessonKeys(lessonIndex - 1), fresh: LESSONS[lessonIndex].keys });
  else { if ($('keyboard').classList.contains('finger-map')) keyboardBuilt = ''; buildKeyboard(); }
  $('keyboard').hidden = !prefs.keyboard && !lesson;
}

// A one-keyboard race is a quote under the current settings, whatever the practice test shape.
function raceConditions() {
  return { ...conditions(), mode: 'quote', wordList: null, localRace: true };
}

// From its start until the second player finishes. Both turns are built from race.conditions.
function raceUnderWay() {
  return Boolean(race.conditions) && race.results.length < 2;
}

function startRace() {
  race = {
    passage: selectPassage({ mode: 'quote', quoteLength: 'medium', difficulty: 'any', seenIds: [] }),
    conditions: raceConditions(),
    names: [$('player-one-name').value.trim() || 'Player one', $('player-two-name').value.trim() || 'Player two'],
    player: 0,
    attempt: null,
    startTime: null,
    results: [],
    characters: [],
    textView: null,
    notice: '',
  };
  if (race.passage?.id && !profile.seenTextIds.includes(race.passage.id)) {
    profile.seenTextIds.push(race.passage.id);
    saveProfile();
  }
  $('compete-setup').hidden = true;
  $('race-leaderboard').hidden = true;
  $('race-handoff').hidden = true;
  syncRules();
  setupRacePlayer();
}

function setupRacePlayer() {
  if (composition?.type === 'race') composition = null;
  if (accentPair?.type === 'race') accentPair = null;
  heldDeadKey = null;
  race.attempt = createAttempt({ id: uid(), text: race.passage.text, textId: race.passage.id, kind: 'race', conditions: { ...race.conditions } });
  race.startTime = null;
  race.notice = '';
  raceRunChanged();
  $('race-stage').hidden = false;
  $('race-player').textContent = race.names[race.player];
  $('race-status').textContent = `Player ${race.player + 1} of 2`;
  $('race-input').value = '';
  $('race-input').disabled = false;
  race.textView = renderText($('race-text-display'), race.passage.text);
  race.characters = race.textView.characters;
  raceFx.reset(race.characters);
  $('race-accessible-passage').textContent = race.passage.text;
  updateRaceProgress(replayAttempt(race.attempt));
  $('race-help').textContent = prefs.keybindings.restart ? `${bindingLabel(prefs.keybindings.restart)} restarts.` : 'Restart shortcut is disabled.';
  $('race-input').focus({ preventScroll: true });
}

function updateRaceProgress(replay) {
  const percent = Math.round((replay.typed.length / race.attempt.text.length) * 100);
  $('race-progress').firstElementChild.style.setProperty('--progress', String(percent / 100));
  $('race-progress').setAttribute('aria-valuenow', String(percent));
}

function finishRacePlayer() {
  markEndFailure(race.attempt);
  if (composition?.type === 'race') composition = null;
  if (accentPair?.type === 'race') accentPair = null;
  heldDeadKey = null;
  const valid = !race.attempt.interrupted && !race.attempt.unsupportedInput;
  const completed = completeAttempt(race.attempt, { endedAt: offsetFor('race'), status: valid ? 'complete' : 'interrupted' });
  completed.interrupted = race.attempt.interrupted;
  if (race.attempt.failed) completed.failed = race.attempt.failed;
  race.attempt = completed;
  raceRunChanged();
  race.results.push({ name: race.names[race.player], attempt: completed });
  $('race-input').disabled = true;
  $('race-stage').hidden = true;
  if (race.player === 0) {
    race.player = 1;
    $('handoff-name').textContent = race.names[1];
    $('handoff-veil').textContent = race.passage.text;
    $('race-handoff').classList.remove('is-revealing');
    $('race-handoff').hidden = false;
    announce(`${race.names[0]} finished. Pass the keyboard to ${race.names[1]}.`);
  } else {
    syncRules();
    renderRaceResults();
  }
}

function renderRaceResults() {
  $('race-leaderboard').hidden = false;
  const valid = race.results.filter((result) => result.attempt.status === 'complete');
  const ordered = [...valid].sort((a, b) => b.attempt.summary.score.wpm - a.attempt.summary.score.wpm || b.attempt.summary.score.accuracy - a.attempt.summary.score.accuracy);
  const tied = ordered.length === 2
    && ordered[0].attempt.summary.score.wpm === ordered[1].attempt.summary.score.wpm
    && ordered[0].attempt.summary.score.accuracy === ordered[1].attempt.summary.score.accuracy;
  $('race-winner').textContent = ordered.length !== 2
    ? 'A fair result needs two uninterrupted runs.'
    : tied ? 'It’s a tie.' : `${ordered[0].name} leads.`;
  const ranked = [...race.results].sort((a, b) => {
    if (a.attempt.status !== b.attempt.status) return a.attempt.status === 'complete' ? -1 : 1;
    return b.attempt.summary.score.wpm - a.attempt.summary.score.wpm || b.attempt.summary.score.accuracy - a.attempt.summary.score.accuracy;
  });
  $('race-results').replaceChildren(...ranked.map((result) => {
    const row = document.createElement('article');
    const score = result.attempt.summary.score;
    row.className = 'race-result-row';
    const name = document.createElement('strong');
    name.textContent = result.name;
    const speed = document.createElement('span');
    speed.className = 'num';
    speed.textContent = result.attempt.status === 'complete' ? `${score.wpm} wpm` : result.attempt.failed ? `failed · ${result.attempt.failed}` : 'interrupted';
    const accuracy = document.createElement('span');
    accuracy.className = 'num';
    accuracy.textContent = `${score.accuracy}% accuracy`;
    const elapsed = document.createElement('span');
    elapsed.className = 'num';
    elapsed.textContent = `${(result.attempt.summary.elapsedMs / 1000).toFixed(1)} s`;
    row.append(name, speed, accuracy, elapsed);
    return row;
  }));
  announce('Challenge complete.');
}

// What this tab holds in memory about the runs a clear removes: the baseline, the drill and retest it
// offers, and the results on show.
function forgetTraining() {
  baselineAttempt = null;
  trainingContext = null;
  selectedTarget = null;
  activeRecommendation = null;
  // The practised words came from the cleared runs, so Run again starts a normal test.
  wordsPassage = null;
  for (const id of ['result-wpm', 'result-accuracy', 'result-errors', 'result-time', 'result-raw', 'result-consistency', 'result-chars']) $(id).textContent = '—';
  $('result-words').replaceChildren();
  wordItems = [];
  selectWord(null);
  $('result-delta').textContent = 'No run yet.';
  $('result-comparison-note').textContent = '';
  $('run-card-stamp').textContent = 'no run yet';
  $('run-card').hidden = true;
  showResult(null);
  $('speed-graph').replaceChildren();
  $('recommendation-title').textContent = 'Finish a run to get a drill.';
  $('recommendation-evidence').textContent = '';
  $('recommendation-list').replaceChildren();
  $('comparison-panel').hidden = true;
  $('ghost-result').hidden = true;
  renderGhostOffer(null);
  $('start-drill').disabled = true;
  $('start-drill').textContent = 'Start drill';
  $('skip-to-retest').disabled = true;
}

// Empties history in memory and on the results screen once the account is deleted, when there is
// nothing left to save to (clear history keeps its marker and Undo; see clearHistory).
function wipeHistory() {
  profile = emptyProfile();
  forgetTraining();
}

// A clear made in another tab or on another device arrives as stored data only. When it covers the
// baseline or the run on show, as a merge into a copy that hadn't heard of it decides, this tab forgets
// them as the clearing tab did. Dates are checked against a marker this tab hadn't applied only, so a run
// made here after this tab knew of a clear is never taken for a cleared one, an older clear back in force
// after a newer one's undo included. Named records are checked on every merge: no copy keeps one, and an
// older clear's names can arrive while the newest marker stays the same. An older build's clear that
// arrives (a new legacyClearedAt) took a run dated at or before it only if the merged history lacks it.
// Never mid-run: flushDeferredSync checks again when the run ends, so a drill then stands alone and a
// retest makes no comparison with the cleared run.
function forgetClearedTraining() {
  if (runInProgress()) return;
  const marker = profile.historyClearedAt || null;
  const arrived = marker && !trainingClears.has(marker) ? marker : null;
  trainingClears = account.clearsApplied(profile);
  const legacyStart = profile.legacyClearedAt || '';
  const legacyAt = legacyStart !== trainingLegacyAt ? legacyStart : '';
  trainingLegacyAt = legacyStart;
  if (!baselineAttempt && !shownResult) return;
  const named = account.clearedIds(profile);
  const takenByLegacy = (record) => Boolean(legacyAt) && (record.at || '') <= legacyAt
    && !profile.runs.some((run) => run.id === record.id);
  const cleared = (record) => Boolean(record) && ((arrived && (record.at || '') <= arrived) || named.has(record.id)
    || takenByLegacy(record));
  if (!cleared(baselineAttempt) && !cleared(shownResult)) return;
  forgetTraining();
  renderTraining();
}

function clearHistory() {
  clearSnapshot = JSON.stringify(profile);
  // An unstarted practice passage outlives the clear (Practice keeps it), so it is the first text the cleared
  // history shows: fresh, and recorded as seen, however it was labelled before. Clearing happens on Progress,
  // so no run is under way.
  const queued = sessionKind === 'practice' && attempt?.status === 'ready' ? attempt : null;
  clearedPassage = queued && { attemptId: queued.id, fresh: passage.fresh, exhausted: passage.exhausted };
  // Copies elsewhere drop what they hold from before this moment when they merge with this one. What
  // they held is kept here as this tab merges them (account.mergeAndHold), for Undo.
  profile = account.clearProfile(profile);
  if (queued?.textId) profile.seenTextIds = [queued.textId];
  if (queued && passage.fresh === false) labelPassage(true, false);
  clearedAt = profile.historyClearedAt;
  heldClears = account.joinHolds(heldClears, { [clearedAt]: [normalizeProfile(JSON.parse(clearSnapshot))] });
  trainingClears = account.clearsApplied(profile);
  forgetTraining();
  const saved = saveProfile();
  $('clear-dialog').close();
  $('history-toast').hidden = false;
  $('history-feedback').textContent = saved ? 'History cleared.' : 'Cleared in this tab, but storage is unavailable.';
  $('undo-clear').hidden = false;
  $('undo-clear').focus();
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => { $('history-toast').hidden = true; clearSnapshot = null; clearedPassage = null; }, 5000);
  renderHistory();
  renderTraining();
  renderDaily();
  followLessonProgress();
  showBest();
  armPace();
}

function undoClear() {
  if (!clearSnapshot) return;
  let snapshot;
  try { snapshot = normalizeProfile(JSON.parse(clearSnapshot)); } catch { return; }
  // Restores the history even if the clear has already synced, keeping anything added since: this tab's
  // own copy from just before it, and whatever the clear removed from the account row or another tab as
  // they merged here (held for it), as far as clears still in force allow.
  ({ merged: profile, holds: heldClears } = account.undoClearHere(heldClears, profile, clearedAt, snapshot));
  // The passage that waited through the clear gets its old label back while it is still unstarted. A run on it
  // already under way is left alone (still run): it started as fresh text, and stays that way.
  const queued = clearedPassage;
  if (queued && attempt?.id === queued.attemptId && attempt.status === 'ready') labelPassage(queued.fresh, queued.exhausted);
  clearedPassage = null;
  saveProfile();
  clearSnapshot = null;
  clearTimeout(clearTimer);
  $('history-feedback').textContent = 'History restored.';
  $('undo-clear').hidden = true;
  followStoredPreferences();
  showBest();
  armPace();
  renderHistory();
  renderTraining();
  renderDaily();
  followLessonProgress();
  clearTimer = setTimeout(() => { $('history-toast').hidden = true; }, 1600);
}

// ── Accounts ──────────────────────────────────────────────────────────────

const SYNC_COPY = {
  guest: 'Guest · nothing is saved',
  syncing: 'Syncing…',
  synced: 'Saved to your account',
  offline: 'Saved here · syncs when online',
  expired: 'Session ended · sign in to sync',
};

function setSyncState(state) {
  $('account').dataset.sync = state;
  $('account-sync').textContent = SYNC_COPY[state];
}

function renderAccount() {
  const signedIn = Boolean(session);
  $('account').dataset.state = signedIn ? 'member' : 'guest';
  $('account-guest').hidden = signedIn;
  $('account-member').hidden = !signedIn;
  $('account-email').textContent = session?.user.email || '';
  $('account-trigger').setAttribute('aria-label', signedIn ? `Account, signed in as ${session.user.email}` : 'Account, guest mode');
  $('guest-note').hidden = signedIn;
  setSyncState(signedIn ? 'syncing' : 'guest');
}

const authRedirectTarget = () => `${location.origin}/`;

const dailyKey = () => conditionKey(dailyConditions());
// The friends board's summary of exactly the copy being written, stamped with that write
// (src/friends-board.js). While an opt-out on this device is unconfirmed its writes clear the column
// (null), so this device shows nothing new on the board; turning sharing on repairs it (repairBoardNow).
const boardFor = (data) => (at) => (optOutPending(session) ? null : boardColumn(data.runs, dailyKey(), at));

// Whether this tab still belongs to the user a sync started for. Another tab can sign out, or in as
// someone else, while a request is out; the sync then stops and writes nothing here. A tab that heard of
// a sign-out elsewhere stays out even if the same account has signed in again since: it reloads first.
function signedInAs(userId) {
  return !signedOutElsewhere && session?.user.id === userId && account.loadSession()?.user.id === userId;
}

// Folds another copy of this account's profile (the account row, or another tab's cache) into memory.
// Only stored data changes here; showMerged() brings the screen up to date. Returns whether it changed.
function absorb(data) {
  if (data?.version !== 2) return false;
  const before = account.syncSignature(profile);
  ({ merged: profile, holds: heldClears } = account.mergeAndHold(heldClears, profile, normalizeProfile(data)));
  return account.syncSignature(profile) !== before;
}

// After a merge: preferences follow where they can't disturb a run, and only the visible history view
// re-renders, and not while someone is using it. Nothing takes focus or announces anything, and
// nothing changes mid-run; Progress, Train and Challenge re-render whenever they are next shown.
function showMerged() {
  followStoredPreferences();
  // Lesson progress follows at once: the learn screen is hidden while a run is typed.
  followLessonProgress();
  if (runInProgress()) return;
  forgetClearedTraining();
  // Newer test conditions wait while a passage is prepared; one nobody has started is prepared again
  // with them, as a page load did before merging (the practice screen only; navigate does it on the
  // way back). Focus stays where it is.
  if (preferencesWaiting && untouchedPractice() && document.body.dataset.view === 'practice') resetSession('practice');
  showBest();
  // A best, average or last-run pace follows the merged history, as it follows a clear here.
  armPace();
  const view = document.body.dataset.view;
  const screen = document.querySelector(`[data-screen="${view}"]`);
  const inUse = screen?.contains(document.activeElement) || screen?.querySelector('details[open]');
  if (view === 'progress' && !inUse) renderHistory();
  if (view === 'compete') renderDaily();
}

// Merges the device cache if another tab has written it since this tab last read it. Only the data:
// returns whether it changed, and the caller shows it (showMerged). Writes only to put back what the
// cache lacks: tabs read and write it separately, so two saves at the same moment can each write a copy
// read before the other's, leaving out a run that may exist nowhere else yet. A tab holding nothing
// more than the cache writes nothing, so tabs settle instead of echoing each other. If that write is
// refused (a sign-out elsewhere is under way), cacheText stays this tab's own last write: the copy taken
// in lacks it, and a repair of the sign-out's removal must still put it back (finishFollow).
function absorbCache() {
  cacheWaiting = false;
  if (!session || !signedInAs(session.user.id)) return false;
  const text = account.loadCachedProfileText(session.user.id);
  if (!text || text === cacheText) return false;
  try {
    const data = JSON.parse(text);
    const changed = absorb(data);
    const own = cacheText;
    cacheText = text;
    if (data?.version === 2 && !account.sameProfile(profile, normalizeProfile(data)) && !storeLocally()) cacheText = own;
    return changed;
  } catch {
    return false;
  }
}

function noteCloudAt(updatedAt) {
  if (updatedAt && !(Date.parse(lastCloudAt) >= Date.parse(updatedAt))) lastCloudAt = updatedAt;
}

// Pushes wait for the run in progress to end, so network and merge work never lands mid-run.
function pushWhenIdle() {
  if (runInProgress()) {
    syncTimer = setTimeout(pushWhenIdle, 1500);
    return;
  }
  pushProfile();
}

// One push at a time, each reading the account row afresh. Resolves true once the row holds this tab's edits.
let pushQueue = Promise.resolve();
function pushProfile(options = {}) {
  clearTimeout(syncTimer);
  syncTimer = 0;
  const run = pushQueue.then(() => pushOnce(options));
  pushQueue = run.catch(() => {});
  return run;
}

// Read the row, merge, then write only if the row is still the version read. If another writer got in
// between, the write matches nothing: read again and merge again, three times at most. The merged copy
// is kept here and in the device cache.
async function pushOnce({ cloud: known } = {}) {
  if (!session) return false;
  if (!unsynced) {
    setSyncState('synced');
    friendsBoard?.pushed();
    return true;
  }
  const userId = session.user.id;
  // Checked before refreshing too: a tab still holding an account another tab has signed out of must
  // not refresh it, nor end whichever session the device holds now.
  if (!signedInAs(userId)) return false;
  try {
    session = await account.freshSession(session);
    if (!signedInAs(userId)) return false;
    let cloud = known;
    for (let tries = 0; tries < 3; tries += 1) {
      if (cloud === undefined) {
        cloud = await account.fetchCloudProfile(session);
        if (!signedInAs(userId)) return false;
      }
      const edits = localEdits;
      const theirs = cloud?.data?.version === 2 ? normalizeProfile(cloud.data) : null;
      const { merged, holds: pushHolds } = theirs ? account.mergeAndHold(heldClears, profile, theirs) : { merged: profile, holds: heldClears };
      let written;
      if (theirs && account.sameProfile(merged, theirs)) written = cloud.updated_at;
      else if (cloud) written = await account.updateCloudProfile(session, merged, cloud.updated_at, { board: boardFor(merged) });
      else written = await account.insertCloudProfile(session, merged, { board: boardFor(merged) });
      if (!signedInAs(userId)) return false;
      if (written) {
        // What this merge held joins what is held now. Holds are only added to, and a list goes back only
        // with its clear's undo (twice changes nothing), so an Undo or a clear made here while the write
        // was out still holds and releases everything.
        heldClears = account.joinHolds(heldClears, pushHolds);
        noteCloudAt(written);
        friendsBoard?.pushed();
        absorb(merged);
        const kept = storeLocally();
        // Done unless this tab saved again, or took in another tab's save, while the write was out:
        // that goes up with the next push.
        if (edits === localEdits && account.sameProfile(profile, merged)) {
          unsynced = false;
          sentText = kept ? cacheText : null;
        } else if (!syncTimer) syncTimer = setTimeout(pushWhenIdle, 1500);
        showMerged();
        setSyncState(unsynced ? 'syncing' : 'synced');
        return !unsynced;
      }
      cloud = undefined;
    }
    // Lost every race: the edits stay here, and the next save, return to this tab or load merges them.
    setSyncState('offline');
    return false;
  } catch {
    setSyncState(account.loadSession() ? 'offline' : 'expired');
    return false;
  }
}

// A hidden page may never run again, so it gets one conditional write of what this tab holds, made only
// if the account row is still the version last merged here (which this tab's copy contains). If that
// loses, the edits wait in the device cache for the pending push, the next return or the next load.
async function pushOnHide() {
  if (!session || !syncTimer || !lastCloudAt) return;
  const userId = session.user.id;
  const edits = localEdits;
  if (!signedInAs(userId)) return;
  try {
    session = await account.freshSession(session);
    if (!signedInAs(userId)) return;
    const written = await account.updateCloudProfile(session, profile, lastCloudAt, { keepalive: true, board: boardFor(profile) });
    if (!written || !signedInAs(userId)) return;
    noteCloudAt(written);
    if (edits === localEdits) {
      unsynced = false;
      setSyncState('synced');
    }
  } catch {}
}

// Brings in what other devices saved: when the tab comes back into view (at most every 15 s) and when
// the connection returns. With edits pending here it pushes instead, which reads and merges first.
async function pullProfile({ force = false } = {}) {
  if (!session || !cloudChecked || runInProgress()) return;
  if (!force && Date.now() - lastPull < PULL_INTERVAL_MS) return;
  lastPull = Date.now();
  if (unsynced) {
    await pushProfile();
    return;
  }
  const userId = session.user.id;
  if (!signedInAs(userId)) return;
  try {
    session = await account.freshSession(session);
    if (!signedInAs(userId)) return;
    const cloud = await account.fetchCloudProfile(session);
    if (!cloud || !signedInAs(userId)) return;
    if (absorb(cloud.data)) {
      storeLocally();
      showMerged();
    }
    noteCloudAt(cloud.updated_at);
    // A tab can hold what the row lacks without saving anything itself: another tab's save taken in from
    // the device cache, whose own push failed or never ran. It goes up from here, as on load.
    if (unsynced || !account.sameProfile(profile, normalizeProfile(cloud.data))) {
      unsynced = true;
      await pushProfile({ cloud });
    } else setSyncState('synced');
  } catch {
    setSyncState(account.loadSession() ? 'offline' : 'expired');
  }
}

function adoptProfile(data) {
  profile = normalizeProfile(data);
  prefs = preferencesInUse(profile.preferences);
  livePreferences = JSON.stringify(prefs);
  storeLocally();
  applyPreferences();
  setModeControls();
  renderHistory();
  if (sessionKind === 'practice' && attempt?.status !== 'running') resetSession('practice', { keepRace: true });
  followLessonProgress();
}

// Lesson progress changed under this tab (a copy merged from elsewhere, a clear or its undo here): a result
// the progress no longer holds is dropped, a lesson waiting that is now locked gives way to the next open
// one (one being typed finishes as not counted), and the learn screen and the first-run prompt follow. The
// learn screen is redrawn even while in use, so it never shows a pass the progress no longer holds; focus
// on a lesson row comes back to that row (or to the lesson button, if the row has no button now).
function followLessonProgress() {
  if (lessonResult && !lessonResultHeld(lessonResult, profile.lessons)) lessonResult = null;
  if (sessionKind === 'lesson' && attempt?.status !== 'running' && !lessonUnlocked(profile.lessons, lessonIndex)) resetSession('lesson', { show: false });
  const list = $('lesson-list');
  const row = list.contains(document.activeElement) ? [...list.children].indexOf(document.activeElement.closest('.lesson-row')) : -1;
  renderLessons();
  if (row >= 0) (list.children[row]?.querySelector('button') || $('lesson-primary')).focus({ preventScroll: true });
  renderFirstRun();
}

// The device's copy and the account row are merged, and whatever the row lacks goes up.
async function syncOnLoad() {
  if (!session) return;
  const userId = session.user.id;
  try {
    session = await account.freshSession(session);
    const cloud = await account.fetchCloudProfile(session);
    if (cloudChecked || !signedInAs(userId)) return;
    cloudChecked = true;
    lastPull = Date.now();
    if (!cloud) {
      // History from before accounts existed goes to the first account that has none of its own.
      // Taken only once the account is known to be empty, so a failed fetch leaves it in place.
      const legacy = account.takeLegacyProfile();
      if (legacy?.version === 2) {
        profile = account.mergeProfiles(profile, normalizeProfile(legacy));
        prefs = preferencesInUse(profile.preferences);
      }
      // Stored and sent before anything re-renders, so the import can't be left half done.
      saveProfile();
      await pushProfile();
      if (legacy?.version === 2) adoptProfile(profile);
    } else {
      absorb(cloud.data);
      noteCloudAt(cloud.updated_at);
      storeLocally();
      showMerged();
      // Edits made here before the check (usually the passage marked seen), or kept on this device
      // since an earlier visit, go up; otherwise the row already holds everything.
      if (unsynced || !account.sameProfile(profile, normalizeProfile(cloud.data))) {
        unsynced = true;
        await pushProfile({ cloud });
      } else {
        setSyncState('synced');
        repairBoard(cloud);
      }
    }
    // An opt-out kept on this device goes out now, and a device new to the account learns whether it shares.
    friendsBoard?.resume();
  } catch {
    // Offline or unreachable: edits stay on the device, unstamped, until a check succeeds.
    setSyncState(account.loadSession() ? 'offline' : 'expired');
  }
}

// A row whose board summary doesn't describe it (written before the board column existed, by an older
// cached build, or without a part this build adds) is given one counted from that row's own data, when
// this load writes nothing itself. The write is conditional on the row's version, so a row another save
// has moved since is left alone. Not while an opt-out here is unconfirmed: this device shows nothing new.
function repairBoard(cloud) {
  if (syncTimer || boardCurrent(cloud) || optOutPending(session)) return;
  account.repairBoard(session, boardColumn(normalizeProfile(cloud.data).runs, dailyKey(), cloud.updated_at), cloud.updated_at)
    .then((sent) => { if (sent) friendsBoard?.pushed(); }, () => {});
}

// Sharing turned on: saves made while an opt-out was still unconfirmed wrote no summary, so the row as
// it stands now is read and, if its summary doesn't describe it, repaired as on load.
async function repairBoardNow() {
  if (!session) return;
  try {
    session = await account.freshSession(session);
    const cloud = await account.fetchCloudProfile(session);
    if (cloud) repairBoard(cloud);
  } catch {}
}

// Puts the account's profile in the device cache, then starts over as that user. A device copy kept
// at sign-out (edits that hadn't synced) is merged with the row rather than replaced.
async function enterAccount(newSession) {
  account.clearSignedOut(newSession.user.id);
  try {
    const cloud = await account.fetchCloudProfile(newSession);
    const cached = account.loadCachedProfile(newSession.user.id);
    if (cloud?.data?.version === 2) {
      account.cacheProfile(newSession.user.id, cached?.version === 2
        ? account.mergeSynced(normalizeProfile(cached), normalizeProfile(cloud.data))
        : cloud.data);
    }
  } catch {}
  location.reload();
}

async function signOutAccount() {
  closeAccountMenu();
  const userId = session.user.id;
  // What this ends is the account's sign-in on the device as it stands now. That may be newer than this
  // tab's: a guest tab may have signed in to the account since, with no sign-out between. Every tab of the
  // account then signs out, as tabs that share one sign-in do.
  const stored = account.loadSession();
  if (!signedOutElsewhere && stored?.user.id === userId) session = stored;
  const ending = session;
  // Another tab signed out, or in as someone else, before this sign-out (this tab has followed:
  // followSessionElsewhere), or signed out or in as anyone (the same account included) while it waits on
  // the network: this sign-out stops here, and the tab starts again as the device now is. Whatever the
  // device holds (another session included) stays.
  // Checked again after every wait; account.signOut checks the stored session once more.
  const overtaken = () => {
    const now = account.loadSession();
    if (!signedOutElsewhere && (!now || account.sameSignIn(now, ending))) return false;
    // Followed: after hearing the cache removed, for a sign-out elsewhere that sent everything (finishFollow).
    if (pendingSignOut === null) location.reload();
    return true;
  };
  if (overtaken()) return;
  await onlineRace?.leave();
  if (overtaken()) return;
  inbox?.forget();
  friendsBoard?.signOut();
  // Every tab signed in here shares the device cache, and another tab's latest save may not have reached
  // the account yet (its push still waiting, or failing). So the cache is merged and pushed before it
  // goes; the push reads the row and writes only what the row lacks. A second round covers a save that
  // lands during the first. If the account can't be reached, or the cache changes again, the cache stays
  // and goes up the next time this account signs in here.
  let synced = false;
  for (let round = 0; round < 2 && !synced; round += 1) {
    absorbCache();
    unsynced = true;
    synced = await pushProfile();
    if (overtaken()) return;
    // Unreachable (requests time out, see account.request) or refused: another round would only wait again.
    if (!synced && $('account').dataset.sync !== 'syncing') break;
  }
  // The cache goes only if it still holds what the last push sent, checked as it is removed.
  await account.signOut(session, { sentText: synced ? sentText : null });
  location.reload();
}

function closeAccountMenu() {
  $('account').open = false;
}

// Account deletion. The server deletes first (account.deleteAccount); only a confirmed deletion
// signs this device out and clears it. Any failure leaves the session, cache and history untouched.
const DELETE_WORD = 'delete';
const DELETED_NOTICE = 'stilltype-account-deleted';
let deletingAccount = false;

function openDeleteAccount() {
  if (!session) return;
  // The dialog gives focus back to whatever had it, and the menu's own button is about to be hidden.
  if ($('account').contains(document.activeElement)) $('account-trigger').focus();
  closeAccountMenu();
  // Typing the confirmation word must never land in, or time, a run.
  markInterrupted(NOTICES.deleteOpened);
  markRaceInterrupted();
  $('confirm-delete-input').value = '';
  $('confirm-delete-account').disabled = true;
  $('delete-account-error').textContent = '';
  $('delete-account-dialog').showModal();
  $('confirm-delete-input').focus();
}

function setDeleting(pending) {
  deletingAccount = pending;
  // Focus waits on the read-only input, so disabling the button doesn't drop it to the page.
  if (pending) $('confirm-delete-input').focus();
  $('delete-account-form').setAttribute('aria-busy', String(pending));
  $('delete-account-status').textContent = pending ? 'Deleting your account…' : '';
  $('confirm-delete-account').textContent = pending ? 'Deleting…' : 'Delete account';
  $('confirm-delete-account').disabled = pending || $('confirm-delete-input').value !== DELETE_WORD;
  $('confirm-delete-input').readOnly = pending;
  $('cancel-delete-account').disabled = pending;
}

async function deleteAccountNow() {
  if (!session || deletingAccount || $('confirm-delete-input').value !== DELETE_WORD) return;
  $('delete-account-error').textContent = '';
  setDeleting(true);
  try {
    await account.deleteAccount(session);
  } catch (error) {
    setDeleting(false);
    $('delete-account-error').textContent = error.message;
    if (!account.loadSession()) setSyncState('expired');
    $('confirm-delete-input').focus();
    return;
  }
  // The account is gone, so nothing may be saved or sent for it again. The inbox finds its device
  // entries through the session, so it forgets before the session goes.
  clearTimeout(syncTimer);
  syncTimer = 0;
  unsynced = false;
  inbox?.forget();
  forgetRace();
  friendsBoard?.forget();
  const deleted = session;
  session = null;
  account.forgetAccount(deleted);
  wipeHistory();
  try { sessionStorage.setItem(DELETED_NOTICE, '1'); } catch {}
  location.reload();
}

// Shown once, after the reload that follows a deletion. Nothing else about the account remains.
function noticeDeletedAccount() {
  let deleted = false;
  try {
    deleted = sessionStorage.getItem(DELETED_NOTICE) === '1';
    sessionStorage.removeItem(DELETED_NOTICE);
  } catch {}
  if (deleted && !session) showAccountToast('Account deleted. You’re in guest mode.', 'done');
}

let accountMode = 'create';

function openAccountDialog(mode) {
  accountMode = mode;
  closeAccountMenu();
  const creating = mode === 'create';
  $('account-dialog-title').textContent = creating ? 'Create an account' : 'Sign in';
  $('account-dialog-copy').textContent = creating
    ? 'Your settings, runs and progress are kept and follow you to any device.'
    : 'Pick up your settings, runs and progress where you left them.';
  $('account-password').autocomplete = creating ? 'new-password' : 'current-password';
  $('account-submit').textContent = creating ? 'Create account' : 'Sign in';
  $('account-switch').textContent = creating ? 'Sign in instead' : 'Create one instead';
  $('account-error').textContent = '';
  $('account-form').hidden = false;
  $('account-confirm').hidden = true;
  if (!$('account-dialog').open) $('account-dialog').showModal();
  $('account-email-input').focus();
}

async function submitAccount(event) {
  event.preventDefault();
  const email = $('account-email-input').value.trim();
  const password = $('account-password').value;
  if (!email || !password) {
    $('account-error').textContent = 'Enter an email and a password.';
    return;
  }
  $('account-submit').disabled = true;
  $('account-error').textContent = '';
  try {
    if (accountMode === 'create') {
      const result = await account.signUp(email, password, authRedirectTarget());
      if (result.confirm) {
        $('account-confirm-email').textContent = email;
        $('account-form').hidden = true;
        $('account-confirm').hidden = false;
        $('account-confirm-done').focus();
        return;
      }
      await enterAccount(result.session);
    } else {
      await enterAccount(await account.signIn(email, password));
    }
  } catch (error) {
    $('account-error').textContent = error.message;
  } finally {
    $('account-submit').disabled = false;
  }
}

// tone 'done' marks a completed action; the default marks a problem.
function showAccountToast(message, tone = 'problem') {
  $('account-toast').dataset.tone = tone;
  $('account-feedback').textContent = message;
  $('account-toast').hidden = false;
  clearTimeout(showAccountToast.timer);
  showAccountToast.timer = setTimeout(() => { $('account-toast').hidden = true; }, 5000);
  announce(message);
}

async function continueWithGoogle() {
  closeAccountMenu();
  $('account-google').disabled = true;
  try {
    await account.startGoogleSignIn(authRedirectTarget());
  } catch (error) {
    $('account-google').disabled = false;
    if ($('account-dialog').open) $('account-error').textContent = error.message;
    else showAccountToast(error.message);
  }
}

function bindAccount() {
  const menu = $('account');
  $('account-create').addEventListener('click', () => openAccountDialog('create'));
  $('account-signin').addEventListener('click', () => openAccountDialog('signin'));
  $('account-google').addEventListener('click', continueWithGoogle);
  $('account-dialog-google').addEventListener('click', continueWithGoogle);
  $('account-signout').addEventListener('click', signOutAccount);
  $('account-delete').addEventListener('click', openDeleteAccount);
  $('confirm-delete-input').addEventListener('input', (event) => {
    if (!deletingAccount) $('confirm-delete-account').disabled = event.target.value !== DELETE_WORD;
  });
  $('delete-account-form').addEventListener('submit', (event) => { event.preventDefault(); deleteAccountNow(); });
  $('cancel-delete-account').addEventListener('click', () => $('delete-account-dialog').close());
  // While the request is out, the dialog stays: its answer decides what happens next.
  $('delete-account-dialog').addEventListener('cancel', (event) => { if (deletingAccount) event.preventDefault(); });
  $('account-form').addEventListener('submit', submitAccount);
  $('account-switch').addEventListener('click', () => openAccountDialog(accountMode === 'create' ? 'signin' : 'create'));
  $('account-cancel').addEventListener('click', () => $('account-dialog').close());
  $('account-confirm-done').addEventListener('click', () => $('account-dialog').close());
  document.addEventListener('pointerdown', (event) => {
    if (menu.open && !menu.contains(event.target)) closeAccountMenu();
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !menu.open) return;
    event.preventDefault();
    event.stopPropagation();
    closeAccountMenu();
    menu.querySelector('summary').focus();
  });
  menu.addEventListener('toggle', () => {
    // Only one corner panel at a time; a keyboard open sends no pointerdown to close the other.
    if (menu.open) { document.querySelector('.preferences')?.removeAttribute('open'); $('inbox').open = false; }
  });
  // Unsynced changes go out when the tab is hidden (anything too large for that waits for the next
  // push or load); other devices' changes come in when it is shown again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pushOnHide();
    else pullProfile();
  });
  addEventListener('online', () => {
    if (!session) return;
    if (!cloudChecked) syncOnLoad();
    else pullProfile({ force: true });
    if (cloudChecked) friendsBoard?.resume();
  });
  // Another tab signed in to this account saved: merge its copy. Only what the copy lacks is written back
  // (absorbCache), so tabs settle rather than echo each other. Mid-run the merge waits; the save at the
  // end of the run merges it then. While this tab follows a sign-out that sent everything, only that
  // sign-out's removal of the cache matters (finishFollow).
  addEventListener('storage', (event) => {
    if (!session) return;
    if (pendingSignOut !== null) {
      finishFollow(event);
      return;
    }
    if (signedOutElsewhere || followSessionElsewhere(event)) return;
    if (event.key !== account.profileKey(session.user.id)) return;
    if (runInProgress()) cacheWaiting = true;
    else if (absorbCache()) showMerged();
  });
}

// Another tab signed this account out (or deleted it: account.forgetAccount leaves the marker first),
// either way: keeping unsent edits leaves its marker
// (account.signedOutKey), and sending everything first removes the device cache, after a marker naming
// the copy it sent, which this tab hears first (finishFollow then hears the removal). Any other removal
// of the cache, such as cleared site data, counts the same. Or the device now holds another account's
// session. This tab then starts again as the device now is, once any run in progress ends
// (flushDeferredSync): as a guest, or as whoever has signed in since, the same account included. The run
// is kept in memory only. A session that only expired (a refused refresh removes the session and nothing
// else) is not followed: this tab keeps caching for the next sign-in. Nor is a new sign-in to this account
// with no sign-out between (a guest tab signing in): the account and its cache are the same, and this tab
// takes up the newer sign-in before its next request (account.freshSession) and as it signs out
// (signOutAccount). Returns whether it followed.
function followSessionElsewhere(event) {
  const userId = session.user.id;
  const current = account.loadSession()?.user.id;
  const signedOut = event.key === null
    || (event.key === account.signedOutKey(userId) && event.newValue !== null)
    || (event.key === account.profileKey(userId) && event.newValue === null)
    || (event.key === account.SESSION_KEY && (current ? current !== userId : account.signedOut(userId)));
  if (!signedOut) return false;
  signedOutElsewhere = true;
  // What this device knew of the account's board sharing goes with the sign-out, as in the tab that signed out.
  friendsBoard?.signOut();
  clearTimeout(syncTimer);
  syncTimer = 0;
  // A sign-out that sent everything removes the cache next: this tab waits to hear it (finishFollow).
  const sent = event.key === account.signedOutKey(userId) ? sentStamp(event.newValue) : null;
  if (sent !== null) pendingSignOut = sent;
  else if (!runInProgress()) location.reload();
  return true;
}

function sentStamp(markerText) {
  try {
    const sent = JSON.parse(markerText)?.sent;
    return typeof sent === 'string' ? sent : null;
  } catch {
    return null;
  }
}

// The rest of following a sign-out that sent everything (pendingSignOut). The signing-out tab can't yet
// see a save made here, or in another tab, just before it removed the cache: the removal names the copy
// it removed (oldValue), and one that isn't the copy sent goes back for the next sign-in
// (account.restoreUnsent), together with what this tab last saved, or took in holding all it saved
// (cacheText; see absorbCache). Never this tab's memory: a run finished after hearing of the sign-out,
// or still in progress, stays out. Only storage changes, so this happens mid-run too; the tab then starts
// again as the device now is once no run is in progress. A cleared storage, or the marker removed
// without the cache, finishes with nothing to put back.
function finishFollow(event) {
  const userId = session.user.id;
  const cacheRemoved = event.key === account.profileKey(userId) && event.newValue === null;
  const finished = cacheRemoved || event.key === null || (event.key === account.signedOutKey(userId) && event.newValue === null);
  if (!finished) return;
  if (cacheRemoved) account.restoreUnsent(userId, event.oldValue, pendingSignOut, cacheText);
  pendingSignOut = null;
  if (!runInProgress()) location.reload();
}

// Finishes a Google or email-confirmation return; the page reloads as the signed-in user.
async function completeAuthRedirect() {
  try {
    const newSession = await account.completeRedirect(location.href);
    if (newSession) await enterAccount(newSession);
  } catch (error) {
    showAccountToast(error.message);
  }
}

// Feature suggestions go straight to Supabase (account.sendSuggestion), never linked to an account.
let suggestToastTimer;

function openSuggest() {
  document.querySelector('.preferences')?.removeAttribute('open');
  markInterrupted(NOTICES.suggestOpened);
  compose.interrupt(NOTICES.composeSuggest);
  markRaceInterrupted();
  $('suggest-error').textContent = '';
  updateSuggestCount();
  $('suggest-dialog').showModal();
  $('suggest-text').focus();
}

function updateSuggestCount() {
  const length = $('suggest-text').value.length;
  setText($('suggest-count'), `${length} / ${account.MAX_SUGGESTION}`);
  $('send-suggest').disabled = !$('suggest-text').value.trim();
}

async function sendSuggestion(event) {
  event.preventDefault();
  const text = $('suggest-text').value;
  const invalid = account.suggestionRow(text).error;
  if (invalid) { $('suggest-error').textContent = invalid; return; }
  const button = $('send-suggest');
  button.disabled = true;
  button.textContent = 'Sending…';
  $('suggest-error').textContent = '';
  try {
    // Anything that fills the hidden field is a bot: act as if it worked and send nothing.
    if (!$('suggest-website').value) await account.sendSuggestion(text, document.body.dataset.view);
    $('suggest-text').value = '';
    $('suggest-dialog').close();
    $('suggest-toast').hidden = false;
    clearTimeout(suggestToastTimer);
    suggestToastTimer = setTimeout(() => { $('suggest-toast').hidden = true; }, 4000);
  } catch (error) {
    $('suggest-error').textContent = error.status
      ? 'The suggestion couldn’t be saved. Your text is still here; try again later.'
      : 'Can’t reach the server. Your text is still here; try again when you’re connected.';
  } finally {
    button.textContent = 'Send suggestion';
    updateSuggestCount();
  }
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const skip = event.target.closest('.skip-link');
    if (skip) {
      event.preventDefault();
      if (composeOpen) {
        switchView('practice');
        compose.focus();
        return;
      }
      if (!attempt || attempt.status === 'complete' || $('typing-input').disabled || staleRepeat()) resetSession('practice');
      else switchView('practice');
      $('typing-input').focus({ preventScroll: false });
      return;
    }
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      event.preventDefault();
      navigate(nav.dataset.nav);
      return;
    }
    // "Start practicing" begins a normal test, so it closes the custom editor as a mode button does.
    const practice = event.target.closest('[data-action="go-practice"]');
    if (practice) {
      customOpen = false;
      setModeControls();
      resetSession('practice', { focus: true, leaveCompose: true });
    }
    if (event.target.closest('[data-action="open-lessons"]')) openLessons();
  });
  $('mode-compose').addEventListener('click', openCompose);
  $('lesson-primary').addEventListener('click', () => lessonActions.primary?.());
  $('lesson-secondary').addEventListener('click', () => lessonActions.secondary?.());
  $('mode-custom').addEventListener('click', () => openCustom(!customOpen));
  $('custom-text').addEventListener('input', updateCustomState);
  $('custom-use').addEventListener('click', useCustomText);
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
    customOpen = false;
    prefs.mode = button.dataset.mode;
    setModeControls();
    saveChoice('mode');
    resetSession('practice', { focus: true, leaveCompose: true });
  }));
  $('code-options').addEventListener('click', (event) => {
    const button = event.target.closest('[data-language]');
    if (!button) return;
    prefs.codeLanguage = button.dataset.language;
    setModeControls();
    saveChoice('mode', 'codeLanguage');
    resetSession('practice', { focus: true });
  });
  $('duration-options').addEventListener('click', (event) => {
    const button = event.target.closest('[data-length]');
    if (!button) return;
    if (prefs.mode === 'time') prefs.duration = Number(button.dataset.length);
    else prefs.count = Number(button.dataset.length);
    setModeControls();
    saveChoice('mode', prefs.mode === 'time' ? 'duration' : 'count');
    resetSession('practice', { focus: true });
  });
  $('punctuation-toggle').addEventListener('change', (event) => {
    prefs.punctuation = event.target.checked;
    saveProfile();
    resetSession('practice', { focus: true });
  });
  // Numbers sits beside the word list in settings and, like it, keeps a custom passage.
  $('numbers-toggle').addEventListener('change', (event) => {
    prefs.numbers = event.target.checked;
    showBest();
    saveProfile();
    resetSession(restartKind(), { focus: true });
  });
  $('quote-length').addEventListener('change', (event) => { prefs.quoteLength = event.target.value; saveProfile(); resetSession('practice', { focus: true }); });
  $('quote-difficulty').addEventListener('change', (event) => { prefs.difficulty = event.target.value; saveProfile(); resetSession('practice', { focus: true }); });
  $('word-list').addEventListener('change', (event) => setWordList(event.target.value));
  $('repeat-quotes-toggle').addEventListener('change', (event) => setRepeatQuotes(event.target.checked));
  $('daily-goal').addEventListener('change', (event) => { prefs.dailyGoal = Number(event.target.value); saveChoice('dailyGoal'); renderGoal(); });
  $('goal-day-select').addEventListener('change', (event) => captionGoalDay([...$('goal-calendar').children].find((cell) => cell.dataset.day === event.target.value)));
  $('goal-day-select').addEventListener('focus', (event) => captionGoalDay([...$('goal-calendar').children].find((cell) => cell.dataset.day === event.target.value)));
  $('goal-calendar').addEventListener('keydown', moveGoalFocus);
  $('goal-calendar').addEventListener('focusin', (event) => captionGoalDay(event.target));
  $('goal-calendar').addEventListener('focusout', (event) => { if (!$('goal-calendar').contains(event.relatedTarget)) captionGoalDay(null); });
  $('goal-calendar').addEventListener('pointerover', (event) => captionGoalDay(event.target.closest('.goal-day') || focusedGoalDay()));
  $('goal-calendar').addEventListener('pointerleave', () => captionGoalDay(focusedGoalDay()));
  $('font-size').addEventListener('change', (event) => { prefs.fontSize = event.target.value; applyPreferences(); saveProfile(); });
  keybindingEditor = createKeybindingEditor({
    form: $('keybindings-form'), status: $('keybindings-status'), getBindings: () => prefs.keybindings,
    onSave: (bindings) => { prefs.keybindings = bindings; applyPreferences(); saveChoice('keybindings'); },
  });
  keybindingEditor.refresh();
  $('live-toggle').addEventListener('change', (event) => { prefs.liveMetrics = event.target.checked; applyPreferences(); saveProfile(); });
  $('keyboard-toggle').addEventListener('change', (event) => { prefs.keyboard = event.target.checked; applyPreferences(); saveProfile(); });
  $('finger-toggle').addEventListener('change', (event) => { prefs.fingerMap = event.target.checked; applyPreferences(); saveChoice('fingerMap'); });
  $('layout-select').addEventListener('change', (event) => setLayout(event.target.value));
  $('correction-select').addEventListener('change', (event) => setCorrection(event.target.value));
  $('strict-space-toggle').addEventListener('change', (event) => setInputRule('strictSpace', event.target.checked));
  $('quick-end-toggle').addEventListener('change', (event) => setInputRule('quickEnd', event.target.checked));
  $('min-accuracy').addEventListener('change', (event) => setMinimum('minAccuracy', Number(event.target.value)));
  $('min-wpm').addEventListener('change', (event) => setMinimum('minWpm', Number(event.target.value)));
  $('theme-select').addEventListener('change', (event) => { prefs.theme = event.target.value; applyTheme(); saveProfile(); });
  prefersLight.addEventListener('change', () => { if (prefs.theme === 'system') applyTheme(); });
  $('pace-select').addEventListener('change', (event) => setPaceCaret(event.target.value));
  $('pace-wpm').addEventListener('change', (event) => { prefs.paceWpm = clampPace(event.target.value); setPaceCaret('custom', { speed: true }); });
  // Left unedited, it shows any speed that arrived while it had focus (see showPace).
  $('pace-wpm').addEventListener('blur', showPace);
  $('focus-toggle').addEventListener('change', (event) => { prefs.focusMode = event.target.checked; applyPreferences(); saveProfile(); });
  $('exit-focus').addEventListener('click', () => {
    prefs.focusMode = false;
    applyPreferences();
    saveProfile();
    focusPractice();
  });

  $('typing-input').addEventListener('beforeinput', (event) => beforeTypingInput(event));
  // Setting the field mid-composition would end it silently, so wait for compositionend.
  $('typing-input').addEventListener('input', (event) => {
    if (event.isComposing || composition?.type === 'primary') return;
    $('typing-input').value = replayAttempt(attempt).typed;
  });
  wireComposition($('typing-input'), 'primary');
  $('typing-input').addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) event.preventDefault();
  });
  for (const type of ['keydown', 'keyup']) $('typing-input').addEventListener(type, syncCapsLock);
  $('typing-input').addEventListener('blur', () => setCapsWarning(false));
  $('typing-input').addEventListener('paste', (event) => { event.preventDefault(); refusePaste('primary'); });
  $('typing-input').addEventListener('drop', (event) => event.preventDefault());
  // Every press is recorded before anything handles it, so the run it starts (resetSession) has its class. A tap
  // or a pen press is touch; a mouse click, or a key pressed outside a text field, is a physical keyboard. Any key
  // in a text field (the passage, the palette's search) may come from a soft keyboard, so it leaves the class as
  // it was: Esc too, since some soft keyboards have one (and Ctrl and Alt, so a chord is no proof either). After
  // that, any touch while a run is prepared or running makes it touch input, wherever the tap lands: a palette
  // command, a setting or the skip link can focus the input and open the soft keyboard without starting a run.
  // The cost is deliberate: on a touchscreen laptop, a tap and then hardware-keyboard typing (Esc included) gives
  // a touch run (a lesson try that doesn't unlock, never a physical-keyboard best).
  document.addEventListener('pointerdown', (event) => {
    activationInput = startedBy(event);
    if (activationInput !== 'touch' || !['ready', 'running'].includes(attempt?.status) || attempt.conditions.inputClass === 'touch') return;
    attempt.conditions.inputClass = 'touch';
    attempt.conditions.layout = inputLayout('touch');
    $('condition-line').textContent = describeRun(attempt);
    showBest();
    if (attempt.status === 'ready') armPace();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (!event.target.matches?.(TEXT_FIELDS)) activationInput = 'physical-keyboard';
  }, true);
  // Anything typed, in the passage or a field, counts for a Race still loading (see raceContext).
  document.addEventListener('beforeinput', () => { typedCount += 1; }, true);
  $('typing-input').addEventListener('click', () => { const value = $('typing-input').value; $('typing-input').setSelectionRange(value.length, value.length); });
  $('restart-button').addEventListener('click', () => resetSession(sessionKind, { focus: true }));
  const replayView = createReplayView($('replay-dialog'));
  $('watch-replay').addEventListener('click', () => replayView.open(shownResult));
  $('run-again').addEventListener('click', runAgain);
  // When a minimum ends a run (on the tick, its last character or its timer), the typist is mid-stride
  // and focus lands here. Until they pause, Space and Enter do nothing, so the keys already on their
  // way can't discard the result and start a new run.
  $('run-again').addEventListener('keydown', (event) => {
    if (stopHold === null) return;
    const stamp = now();
    if (stamp - stopHold >= STOP_HOLD_MS) { stopHold = null; return; }
    stopHold = stamp;
    if (event.key === ' ' || event.key === 'Enter') event.preventDefault();
  });
  $('run-again').addEventListener('keyup', (event) => { if (stopHold !== null && event.key === ' ') event.preventDefault(); });
  $('result-words').addEventListener('keydown', moveWordFocus);
  $('result-words').addEventListener('focusin', (event) => {
    const word = event.target.closest('[role="option"]');
    if (word && Number(word.dataset.index) !== wordIndex) selectWord(Number(word.dataset.index));
  });
  // A tap selects the word too, so touch shows the same line as the keyboard.
  $('result-words').addEventListener('click', (event) => {
    const word = event.target.closest('[role="option"]');
    if (word) selectWord(Number(word.dataset.index), { focus: true });
  });
  $('progress-conditions').addEventListener('change', renderHistory);
  $('take-standard').addEventListener('click', () => setTestShape('standard'));
  $('progress-period').addEventListener('change', renderHistory);
  $('key-heatmap').addEventListener('keydown', moveHeatFocus);
  $('key-heatmap').addEventListener('focusin', (event) => {
    const cell = event.target.closest('.key');
    if (cell && cell.dataset.letter !== heatKey) selectHeatKey(cell.dataset.letter);
  });
  $('key-heatmap').addEventListener('click', (event) => {
    const cell = event.target.closest('.key');
    if (cell && !$('key-heatmap').hasAttribute('aria-hidden')) selectHeatKey(cell.dataset.letter, { focus: true });
  });
  $('heat-legend').replaceChildren(...[...HEAT_STEPS, HEAT_NONE].map(({ step, label }) => {
    const item = element('li', label);
    item.dataset.heat = step;
    return item;
  }));
  $('key-select').append(new Option('Choose a key', ''), ...[...'abcdefghijklmnopqrstuvwxyz'].map((letter) => new Option(letter, letter)));
  $('key-select').addEventListener('change', (event) => selectHeatKey(event.target.value || null));
  coarsePointer.addEventListener('change', () => renderKeys(heatRuns));
  $('training-conditions').addEventListener('change', renderTraining);
  $('practice-missed-list').addEventListener('click', practiseMissedList);
  $('start-daily').addEventListener('click', startDaily);
  $('start-drill').addEventListener('click', startDrill);
  $('skip-to-retest').addEventListener('click', startRetest);
  $('manual-target').addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = $('manual-target-input').value.trim();
    const valid = /^[a-z]{1,8}$/i.test(raw);
    $('manual-target-input').setAttribute('aria-invalid', String(!valid));
    $('manual-target-error').textContent = valid ? '' : 'Use 1–8 letters, no spaces or punctuation.';
    if (!valid) return;
    selectedTarget = normalizeManualTarget(raw);
    activeRecommendation = {
      kind: 'manual',
      target: selectedTarget,
      title: `Practice “${selectedTarget}”`,
      reason: `You picked “${selectedTarget}”. It’s kept separate from the automatic recommendation.`,
      evidence: activeRecommendation?.evidence || summarizePatterns(profile.attempts, 20, baselineAttempt?.conditions),
    };
    startDrill();
  });

  $('ghost-offer').addEventListener('toggle', () => { if ($('ghost-offer').open && session) loadGhostFriends(); });
  $('ghost-offer-form').addEventListener('submit', sendGhost);
  $('ghost-offer-friends').addEventListener('click', () => onlineRace?.open());
  $('ghost-result-action').addEventListener('click', () => {
    if (ghostRace?.state === 'failed') submitGhostRun();
    else if (RACE_AGAIN.includes(ghostRace?.state)) { ghostRace.run = null; resetSession('challenge', { focus: true }); }
  });

  $('compete-setup').addEventListener('submit', (event) => { event.preventDefault(); startRace(); });
  $('race-input').addEventListener('beforeinput', (event) => beforeTypingInput(event, 'race'));
  $('race-input').addEventListener('input', (event) => {
    if (!race.attempt || event.isComposing || composition?.type === 'race') return;
    $('race-input').value = replayAttempt(race.attempt).typed;
  });
  wireComposition($('race-input'), 'race');
  $('race-input').addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) event.preventDefault();
  });
  $('race-input').addEventListener('paste', (event) => { event.preventDefault(); refusePaste('race'); });
  $('race-input').addEventListener('blur', markRaceInterrupted);
  $('start-next-player').addEventListener('click', () => {
    // A short unblur of the passage, then the typing stage takes over.
    const reveal = () => { $('race-handoff').hidden = true; $('race-handoff').classList.remove('is-revealing'); setupRacePlayer(); };
    if (reducedMotion.matches) { reveal(); return; }
    $('race-handoff').classList.add('is-revealing');
    setTimeout(reveal, 200);
  });
  $('race-again').addEventListener('click', () => { $('race-leaderboard').hidden = true; $('compete-setup').hidden = false; $('player-one-name').focus(); });

  $('clear-history').addEventListener('click', () => { $('confirm-clear-input').value = ''; $('confirm-clear').disabled = true; $('clear-dialog').showModal(); $('confirm-clear-input').focus(); });
  $('confirm-clear-input').addEventListener('input', (event) => { $('confirm-clear').disabled = event.target.value !== 'clear'; });
  $('confirm-clear').addEventListener('click', clearHistory);
  $('cancel-clear').addEventListener('click', () => $('clear-dialog').close());
  $('undo-clear').addEventListener('click', undoClear);

  $('suggest-trigger').addEventListener('click', openSuggest);
  $('suggest-text').addEventListener('input', updateSuggestCount);
  $('suggest-form').addEventListener('submit', sendSuggestion);
  $('cancel-suggest').addEventListener('click', () => $('suggest-dialog').close());
  $('suggest-dialog').addEventListener('click', (event) => { if (event.target === $('suggest-dialog')) $('suggest-dialog').close(); });

  const preferences = document.querySelector('.preferences');
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    // A held space that submitted a run (quick end off) must not also press Run again.
    if (event.repeat && event.key === ' ' && document.activeElement === $('run-again')) {
      event.preventDefault();
      return;
    }
    const typing = document.activeElement === $('typing-input') || document.activeElement === $('race-input');
    if (typing && event.repeat && (event.key.length === 1 || ACCENT_REPEAT_KEYS.has(event.key))) {
      event.preventDefault();
      showInputNotice(document.activeElement === $('typing-input') ? 'primary' : 'race', NOTICES.repeat, { speak: false });
      return;
    }
    if (((event.isComposing || event.keyCode === 229) && !activeAccentComposition()) || event.getModifierState?.('AltGraph')) return;
    if (document.querySelector('dialog[open]')) {
      if (palette?.isOpen() && matchesAppBinding(event, prefs.keybindings.commands)) {
        event.preventDefault();
        if (!event.repeat) palette.close();
      }
      return;
    }
    const menuOpen = preferences.open || $('account').open || $('inbox').open;
    if (menuOpen && event.key === 'Escape') {
      if (preferences.open && !keybindingEditor.isRecording()) {
        event.preventDefault();
        keybindingEditor.stopRecording();
        preferences.open = false;
        preferences.querySelector(':scope > summary').focus();
      }
      return;
    }
    const active = document.activeElement;
    const onTypingSurface = ['typing-input', 'race-input', 'online-input', 'compose-input'].includes(active?.id);
    const editable = active?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    if (!keybindingEditor.isRecording() && (!editable || onTypingSurface) && matchesAppBinding(event, prefs.keybindings.commands)) {
      event.preventDefault();
      if (!event.repeat) palette.open();
      return;
    }
    if (menuOpen) return;
    if (prefs.focusMode && (!editable || onTypingSurface) && matchesAppBinding(event, prefs.keybindings.exitFocus)) {
      event.preventDefault();
      if (!event.repeat) {
        prefs.focusMode = false;
        applyPreferences();
        saveProfile();
        focusPractice();
      }
      return;
    }
    if (composeOpen && active === $('compose-input') && matchesAppBinding(event, prefs.keybindings.restart)
      && !(event.key === 'Enter' && compose.isRunning())) {
      event.preventDefault();
      if (!event.repeat) compose.restart();
      return;
    }
    if (quickRestart(event)) return;
    document.querySelectorAll('.key').forEach((key) => key.classList.toggle('active', key.dataset.key === event.key.toLowerCase()));
  }, true);
  document.addEventListener('keyup', () => document.querySelectorAll('.key.active').forEach((key) => key.classList.remove('active')));
  window.addEventListener('blur', () => {
    document.querySelectorAll('.key.active').forEach((key) => key.classList.remove('active'));
    markInterrupted(NOTICES.focusLost);
    compose.interrupt(NOTICES.composeFocusLost);
    markRaceInterrupted();
  });
  document.addEventListener('pointerdown', (event) => {
    if (preferences.open && !preferences.contains(event.target)) { preferences.open = false; keybindingEditor.stopRecording(); }
  });

  // The chrome fades while typing; a real mouse nudge (not layout-induced jitter) brings it back.
  let pointer = null;
  document.addEventListener('pointermove', (event) => {
    const moved = pointer ? Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) : 0;
    if (!pointer || document.body.dataset.running !== 'true' || moved > 4) pointer = { x: event.clientX, y: event.clientY };
    if (moved > 4) showChrome(true);
  });
}

function updateCustomCount() {
  $('custom-count').textContent = `${$('custom-text').value.length.toLocaleString('en')} / ${CUSTOM_MAX.toLocaleString('en')}`;
}

function setCustomError(message = '') {
  if ($('custom-error').textContent !== message) $('custom-error').textContent = message;
  $('custom-text').setAttribute('aria-invalid', String(Boolean(message)));
}

function customErrorMessage(problem) {
  if (!problem) return '';
  if (problem.kind === 'empty') return 'Add some text first.';
  if (problem.kind === 'short') return `Use at least ${CUSTOM_MIN_WORDS} words and ${CUSTOM_MIN_CHARS} characters, so the run is long enough to time.`;
  if (problem.kind === 'untypable') return `“${problem.char}” (U+${problem.char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}) can’t be typed here. Custom text uses the letters, digits, spaces and punctuation of an English keyboard.`;
  return `Keep it to ${CUSTOM_MAX.toLocaleString('en')} characters, about ten minutes of typing. This text has ${problem.length.toLocaleString('en')}.`;
}

// While the text is too short to time, "Use this text" is off and the line under it says why. Other problems
// are reported when the button is pressed, and editing clears them.
function updateCustomState() {
  updateCustomCount();
  const problem = customTextProblem(normalizeCustomText($('custom-text').value, Infinity));
  $('custom-use').disabled = problem?.kind === 'empty' || problem?.kind === 'short';
  setCustomError(problem?.kind === 'short' ? customErrorMessage(problem) : '');
}

// The panel never opens or closes beside a live run: like the other mode buttons, it restarts the run first.
function openCustom(open = true) {
  // The editor opens over a passage, so Custom first leaves composing (dropping what was written, as any mode does).
  if (composeOpen) resetSession(restartKind(), { leaveCompose: true });
  else if (attempt?.status === 'running') resetSession(restartKind());
  customOpen = open;
  if (open) {
    if (!$('custom-text').value) $('custom-text').value = prefs.customText || '';
    $('custom-order').value = prefs.customOrder;
    updateCustomState();
  }
  setModeControls();
  if (open) $('custom-text').focus();
}

// Signed in, the text is kept with the other preferences; a guest's preferences live only in memory.
// Using it is a pick of the text and order shown, stamped even when they match what is stored, so a text
// waiting from another tab doesn't replace it as the passage is prepared.
function useCustomText() {
  const text = normalizeCustomText($('custom-text').value, Infinity);
  const error = customErrorMessage(customTextProblem(text));
  setCustomError(error);
  if (error) {
    $('custom-text').focus();
    return;
  }
  prefs.customText = text;
  prefs.customOrder = CUSTOM_ORDERS.includes($('custom-order').value) ? $('custom-order').value : 'as-written';
  saveChoice('customText', 'customOrder');
  customOpen = false;
  resetSession('custom', { focus: true });
  setModeControls();
}

function setTestShape(mode, length) {
  customOpen = false;
  prefs.mode = mode;
  if (mode === 'time' && length) prefs.duration = length;
  if (mode === 'words' && length) prefs.count = length;
  setModeControls();
  saveChoice('mode', ...(length && mode !== 'quote' ? [mode === 'time' ? 'duration' : 'count'] : []));
  resetSession('practice', { focus: true, leaveCompose: true });
}

function togglePreference(key) {
  prefs[key] = !prefs[key];
  applyPreferences();
  saveProfile();
  if (document.body.dataset.view === 'practice') focusPractice();
}

function setCorrection(policy) {
  if (standardLocked()) return;
  prefs.correction = correctionPreference({ correction: policy });
  prefs.stopOnError = prefs.correction === 'mandatory';
  applyPreferences();
  saveChoice('correction', 'stopOnError');
  // A lesson stays a lesson and custom text stays custom; any other session restarts as practice.
  if (document.body.dataset.view === 'practice') resetSession(sessionKind === 'lesson' ? 'lesson' : restartKind());
}

// Strict space and quick end change how a run is scored, so a change on the practice screen starts
// the session again as the same kind: a drill stays a drill. A session that can't take it (quick
// end in a timed run, the daily, a retest, custom text) carries on and the preference waits for a run it applies
// to; the switch's note says why. Other screens stay put, and a practice passage left waiting there
// is rebuilt when practice is shown again (navigate).
function setInputRule(key, enabled) {
  const changed = prefs[key] !== enabled;
  prefs[key] = enabled;
  applyPreferences();
  saveChoice(key);
  if (!changed) return;
  const limits = ruleLimits(ruleSession());
  if (limits.fixed || (key === 'quickEnd' && limits.quickEnd)) return;
  if (document.body.dataset.view === 'practice') resetSession(sessionKind);
}

function activeAccentComposition() {
  return Boolean(composition && !composition.refused
    && accentComposition({ key: composition.key, preview: composition.mark }));
}

function matchesAppBinding(event, binding) {
  return matchesBinding(event, binding, { allowAccentComposition: activeAccentComposition() });
}

// Restart only owns the typing surfaces, bare practice/results page, and run-again.
// Controls retain their native activation and Tab navigation; online rooms cannot restart.
function quickRestart(event) {
  if (!matchesAppBinding(event, prefs.keybindings.restart)) return false;
  const view = document.body.dataset.view;
  const active = document.activeElement;
  const onInput = active === $('typing-input');
  const onLocalRace = active === $('race-input');
  const onPage = !active || active === document.body || active === document.documentElement;
  const onRunAgain = event.key !== 'Tab' && view === 'results' && active === $('run-again');
  if (!onInput && !onLocalRace && !onRunAgain && !(onPage && (view === 'practice' || view === 'results'))) return false;
  if (event.key === 'Enter' && (onLocalRace ? race.attempt : attempt)?.status === 'running') return false;
  event.preventDefault();
  if (!event.repeat) {
    if (onLocalRace) setupRacePlayer();
    else restartTest();
  }
  return true;
}

// One restart, one new passage: the result card runs again as its button does; anywhere
// else the current test restarts as esc does.
function restartTest() {
  if (document.body.dataset.view === 'results') runAgain();
  else if (composeOpen) compose.restart();
  else resetSession(sessionKind, { focus: true });
}

function runAgain() {
  if (sessionKind === 'daily') startDaily();
  else resetSession(sessionKind === 'missed' ? 'missed' : restartKind(), { focus: true, leaveCompose: true });
}

// The key that restarts from where focus sits. On the result card that is the focused run-again
// button (the palette hands focus back to it), which tab moves past and enter activates.
function restartHint() {
  return document.body.dataset.view === 'results' && prefs.keybindings.restart === 'Tab' ? 'enter' : bindingLabel(prefs.keybindings.restart);
}

// Repeat quotes changes only open practice's next quote, so a custom passage (or any other session) is kept.
function setRepeatQuotes(enabled) {
  if (prefs.repeatQuotes === enabled) return;
  prefs.repeatQuotes = enabled;
  applyPreferences();
  saveChoice('repeatQuotes');
  if (sessionKind !== 'practice' || passage?.fresh !== false || attempt?.status !== 'ready') return;
  // A repeated passage that hasn't been started. Off swaps it for unseen text if any remains: here on Practice,
  // otherwise when Practice next opens (staleRepeat), so the setting never changes the view. Else reword its notice.
  if (staleRepeat() && document.body.dataset.view === 'practice') resetSession('practice');
  else setPassageNotice(repeatedTextNotice());
}

// Relabels the unstarted passage when the history that judged it changes: a clear, or undoing one.
function labelPassage(fresh, exhausted) {
  passage.fresh = fresh;
  passage.exhausted = exhausted;
  attempt.fresh = fresh;
  setPassageNotice(repeatedTextNotice());
  $('condition-line').textContent = describeRun(attempt);
}

// An unstarted repeated passage that repeats-off would have replaced with unseen text.
function staleRepeat() {
  return !prefs.repeatQuotes && sessionKind === 'practice' && attempt?.status === 'ready' && passage?.fresh === false && !passage.exhausted;
}

// A ready practice run takes a new minimum in place; one already under way restarts with it.
function setMinimum(key, value) {
  if (prefs[key] === value) return;
  prefs[key] = value;
  applyPreferences();
  saveChoice(key);
  if (sessionKind !== 'practice' || !attempt) return;
  if (attempt.status === 'ready') {
    attempt.minimums = practiceMinimums();
    $('condition-line').textContent = describeRun(attempt);
  } else if (attempt.status === 'running') resetSession('practice');
}

function setWordList(id, kind = restartKind()) {
  if (!wordListIds.includes(id)) return;
  prefs.wordList = id;
  applyPreferences();
  saveChoice('wordList');
  resetSession(kind, { focus: true });
}

// A palette command that changes a practice setting restarts the session the user was in, as the settings
// popover does, even when going to Practice first has ended a finished custom run.
function inPractice(change) {
  const kind = restartKind();
  navigate('practice');
  change(kind);
}

// "custom time…" / "custom words…": the hint shows the custom value in use, or the one remembered.
function customLengthCommand(mode) {
  const spec = LENGTHS[mode];
  // As for the presets, no length is current during a custom text session.
  const current = comparableKind(sessionKind) && prefs.mode === mode && !isPresetLength(mode, prefs[spec.key]);
  const value = current ? prefs[spec.key] : prefs[spec.customKey];
  return {
    group: 'test',
    label: `custom ${mode}…`,
    keywords: `${mode === 'time' ? 'timed seconds duration' : 'count number'} length any ${spec.min} to ${spec.max}`,
    hint: value ? `${value} ${mode === 'time' ? 's' : 'words'}` : '',
    on: current,
    run: () => setCustomLengthFromPalette(mode),
  };
}

// The layout is a test condition, like the word list, so changing it starts a new run. Like the word list,
// it keeps a custom passage: custom runs are never compared, so their key never names a layout.
function setLayout(id, kind = restartKind()) {
  const next = normalizeLayout(id);
  const changed = prefs.layout !== next;
  prefs.layout = next;
  applyPreferences();
  saveChoice('layout');
  if (changed) resetSession(kind, { focus: true });
}

// The finger map is drawn on the on-screen keyboard, so turning it on shows the keyboard too.
function toggleFingerMap() {
  const show = !(prefs.keyboard && prefs.fingerMap);
  prefs.fingerMap = show;
  if (show) prefs.keyboard = true;
  applyPreferences();
  saveChoice('fingerMap', ...(show ? ['keyboard'] : []));
  if (document.body.dataset.view === 'practice') $('typing-input').focus({ preventScroll: true });
}

function paletteCommands(query) {
  const onOff = (value) => (value ? 'on' : 'off');
  const missedWords = recurringMissedWords(profile.runs).words.length;
  // The friends board's switch: on, off, or null (no hint) before this device has read the board.
  const shared = friendsBoard?.sharing ?? null;
  // During a custom session, a ghost race or composing no test shape is current (a custom session marks "custom text").
  const shape = (mode, length) => !composeOpen && comparableKind(sessionKind) && prefs.mode === mode && (mode === 'quote' || mode === 'standard' || (mode === 'time' ? prefs.duration : prefs.count) === length);
  // The standard recipe fixes these; like quote mode, the palette leaves out what can't change.
  const fixedText = ['quote', 'code'].includes(prefs.mode) || standardLocked();
  const commands = [
    ...[['practice', 'practice'], ['results', 'train'], ['progress', 'progress'], ['compete', 'challenge']].map(([view, label]) => ({
      group: 'go to', label, keywords: `${view} open view page`, hint: document.body.dataset.view === view ? 'here' : '', on: document.body.dataset.view === view, run: () => navigate(view),
    })),
    { group: 'go to', label: 'friends board', keywords: 'leaderboard compare daily week practice minutes friends bests personal best', disabled: Boolean(onlineRace?.liveRoomId), run: () => onlineRace.openBoard() },
    { group: 'account', label: 'share on friends board', keywords: 'friends board leaderboard privacy opt in out publish stop sharing', hint: session ? (shared === null ? '' : onOff(shared)) : 'sign in', on: Boolean(session && shared), disabled: !session || Boolean(onlineRace?.liveRoomId), run: () => { onlineRace.openBoard(); friendsBoard.setShare(!friendsBoard.sharing); } },
    { group: 'go to', label: 'learn to type', keywords: 'lessons beginner keys fingers home row', hint: document.body.dataset.view === 'learn' ? 'here' : '', on: document.body.dataset.view === 'learn', run: openLessons },
    { group: 'test', label: 'restart test', keywords: 'reset again new passage', hint: restartHint(), run: restartTest },
    { group: 'test', label: 'daily challenge', keywords: 'today shared passage daily quote', run: startDaily },
    ...(lessonsComplete(profile.lessons) ? [] : [{ group: 'test', label: `next lesson · ${LESSONS[nextLessonIndex(profile.lessons)].keys.join(' ')}`, keywords: 'learn to type beginner keys fingers', run: () => startLesson(nextLessonIndex(profile.lessons)) }]),
    { group: 'test', label: 'practice words you keep missing', keywords: 'missed words mistakes errors practise recurring list', hint: `${missedWords} words`, disabled: missedWords < 2, run: practiseRecurringWords },
    ...LENGTHS.time.presets.map((length) => ({ group: 'test', label: `time · ${length} seconds`, keywords: `timed ${length}s`, hint: shape('time', length) ? 'current' : '', on: shape('time', length), run: () => setTestShape('time', length) })),
    customLengthCommand('time'),
    ...LENGTHS.words.presets.map((length) => ({ group: 'test', label: `words · ${length} words`, keywords: `count ${length}`, hint: shape('words', length) ? 'current' : '', on: shape('words', length), run: () => setTestShape('words', length) })),
    customLengthCommand('words'),
    { group: 'test', label: 'custom text', keywords: 'own text paste bring your passage', hint: sessionKind === 'custom' ? 'current' : '', on: sessionKind === 'custom', run: () => { navigate('practice'); openCustom(true); } },
    { group: 'test', label: 'quote', keywords: 'passage original text', hint: shape('quote') ? 'current' : '', on: shape('quote'), run: () => setTestShape('quote') },
    { group: 'test', label: 'composing practice', keywords: 'compose write writing free typing prompt own words', hint: composeOpen ? 'current' : '', on: composeOpen, run: openCompose },
    { group: 'test', label: 'another prompt', keywords: 'compose composing writing new different prompt skip', disabled: !composeOpen, run: () => { switchView('practice'); compose.another(); } },
    { group: 'test', label: 'standard test · 60 seconds', keywords: `standard score real world fixed recipe benchmark ${recipeLabel()}`, hint: shape('standard') ? 'current' : recipeLabel(), on: shape('standard'), run: () => setTestShape('standard') },
    { group: 'test', label: 'punctuation', keywords: 'capitals commas periods', hint: onOff(prefs.punctuation), on: prefs.punctuation, disabled: fixedText, run: () => { prefs.punctuation = !prefs.punctuation; applyPreferences(); saveProfile(); resetSession(restartKind(), { focus: true }); } },
    { group: 'test', label: 'numbers', keywords: 'digits figures', hint: onOff(prefs.numbers), on: Boolean(prefs.numbers), disabled: fixedText, run: () => { prefs.numbers = !prefs.numbers; applyPreferences(); saveProfile(); resetSession(restartKind(), { focus: true }); } },
    ...wordListIds.map((id) => ({ group: 'test', label: `word list · top ${id}`, keywords: 'common words vocabulary 200 1000 5000 10000 monkeytype easier harder', hint: prefs.wordList === id ? 'current' : '', on: prefs.wordList === id, disabled: fixedText, run: () => inPractice((kind) => setWordList(id, kind)) })),
    ...layoutIds.map((id) => ({ group: 'test', label: `layout · ${layoutLabel(id)}`, keywords: 'keyboard alternative remap', hint: prefs.layout === id ? 'current' : '', on: prefs.layout === id, run: () => setLayout(id) })),
    ...[['off', 'off'], ['best', 'personal best'], ['average', 'average'], ['last', 'last run'], ['custom', 'custom']].map(([mode, name]) => (
      { group: 'test', label: `pace caret: ${name}`, keywords: 'ghost pacer pace caret', hint: prefs.paceCaret === mode ? 'on' : '', on: prefs.paceCaret === mode, run: () => setPaceCaret(mode) })),
    ...Object.entries(CORRECTION_LABELS).map(([policy, name]) => ({ group: 'test', label: `correction · ${policy === 'relaxed' ? 'free' : name}`, keywords: 'mistakes correction continue stop error backspace fail expert master confidence', hint: prefs.correction === policy ? 'current' : '', on: prefs.correction === policy, disabled: standardLocked(), run: () => setCorrection(policy) })),
    { group: 'test', label: 'repeat quotes', keywords: 'seen again same quote passage score chase replay', hint: onOff(prefs.repeatQuotes), on: prefs.repeatQuotes, disabled: prefs.mode !== 'quote', run: () => setRepeatQuotes(!prefs.repeatQuotes) },
    { group: 'test', label: 'strict space', keywords: 'space bar early skip word mistakes input', hint: onOff(prefs.strictSpace), on: prefs.strictSpace, run: () => setInputRule('strictSpace', !prefs.strictSpace) },
    { group: 'test', label: 'quick end', keywords: 'finish last word end mistakes submit confirm', hint: onOff(prefs.quickEnd), on: prefs.quickEnd, disabled: Boolean(ruleLimits(ruleSession()).quickEnd), run: () => setInputRule('quickEnd', !prefs.quickEnd) },
    ...MIN_ACCURACY_OPTIONS.map((value) => ({ group: 'test', label: `minimum accuracy · ${value ? `${value}%` : 'off'}`, keywords: 'min acc threshold fail stop below continue', hint: prefs.minAccuracy === value ? 'current' : '', on: prefs.minAccuracy === value, run: () => setMinimum('minAccuracy', value) })),
    ...MIN_WPM_OPTIONS.map((value) => ({ group: 'test', label: `minimum speed · ${value ? `${value} wpm` : 'off'}`, keywords: 'min wpm pace threshold fail stop below continue', hint: prefs.minWpm === value ? 'current' : '', on: prefs.minWpm === value, run: () => setMinimum('minWpm', value) })),
    ...['dark', 'light', 'system'].map((theme) => ({ group: 'display', label: `theme · ${theme}`, keywords: 'colour color mode appearance', hint: prefs.theme === theme ? 'current' : '', on: prefs.theme === theme, run: () => { prefs.theme = theme; applyTheme(); saveChoice('theme'); } })),
    ...[['22', 'small'], ['28', 'medium'], ['36', 'large']].map(([size, name]) => ({ group: 'display', label: `text size · ${name}`, keywords: 'font passage bigger smaller', hint: prefs.fontSize === size ? 'current' : '', on: prefs.fontSize === size, run: () => { prefs.fontSize = size; applyPreferences(); saveChoice('fontSize'); } })),
    { group: 'display', label: 'live metrics', keywords: 'wpm accuracy while typing', hint: onOff(prefs.liveMetrics), on: prefs.liveMetrics, run: () => togglePreference('liveMetrics') },
    { group: 'display', label: 'keyboard', keywords: 'keys layout', hint: onOff(prefs.keyboard), on: prefs.keyboard, run: () => togglePreference('keyboard') },
    { group: 'display', label: 'finger map', keywords: 'keyboard fingers touch typing hands which finger', hint: onOff(prefs.keyboard && prefs.fingerMap), on: prefs.keyboard && prefs.fingerMap, run: toggleFingerMap },
    { group: 'display', label: 'focus mode', keywords: 'zen hide distraction', hint: onOff(prefs.focusMode), on: prefs.focusMode, run: () => { navigate('practice'); togglePreference('focusMode'); } },
    ...(session
      ? [
        { group: 'account', label: 'sign out', keywords: `log out logout ${session.user.email}`, hint: session.user.email, run: signOutAccount },
        { group: 'account', label: 'delete account…', keywords: 'remove erase close account data privacy', run: openDeleteAccount },
      ]
      : [
        { group: 'account', label: 'create account…', keywords: 'sign up register save login', run: () => openAccountDialog('create') },
        { group: 'account', label: 'sign in…', keywords: 'log in login account', run: () => openAccountDialog('signin') },
        { group: 'account', label: 'continue with Google', keywords: 'sign in log in login google', run: continueWithGoogle },
      ]),
    { group: 'help', label: 'keybindings…', keywords: 'settings shortcuts restart keyboard', run: () => { const settings = document.querySelector('.preferences'); settings.open = true; document.querySelector('.keybindings-category').open = true; $('keybinding-restart').focus(); } },
    { group: 'help', label: 'suggest a feature…', keywords: 'feedback idea request feature', run: openSuggest },
    { group: 'local data', label: 'clear local history…', keywords: 'delete reset erase', disabled: !hasAnyHistory(), run: () => { navigate('progress'); $('clear-history').click(); } },
  ];
  // Only an exact word finds this one.
  if (query === 'ghost') commands.unshift({ group: 'secret', secret: true, label: 'ghost pacer', hint: onOff(ghostOn()), on: ghostOn(), run: toggleGhost });
  return commands;
}

function bindPalette() {
  palette = createPalette({
    dialog: $('palette'),
    input: $('palette-input'),
    list: $('palette-list'),
    empty: $('palette-empty'),
    highlight: document.querySelector('.palette-highlight'),
    trigger: $('palette-trigger'),
    getCommands: paletteCommands,
    onOpen: () => {
      document.querySelector('.preferences')?.removeAttribute('open');
      closeAccountMenu();
      $('inbox').open = false;
      markInterrupted(NOTICES.paletteOpened);
      compose.interrupt(NOTICES.composePalette);
      markRaceInterrupted();
    },
  });
}

// ↑ ↑ ↓ ↓ ← → ← → b a, or "ghost" in the palette: a pacer caret at your best pace for these conditions.
function toggleGhost() {
  const on = !ghostOn();
  const pace = ghostPace('best');
  const message = on ? `Ghost pacer · ${pace.wpm} wpm${pace.fromBest ? ' (your best)' : ''}` : 'Ghost off';
  $('egg-feedback').textContent = message;
  $('egg-toast').hidden = false;
  $('egg-toast').classList.toggle('is-solo', $('history-toast').hidden);
  clearTimeout(toggleGhost.timer);
  toggleGhost.timer = setTimeout(() => { $('egg-toast').hidden = true; }, 3000);
  announce(message);
  setPaceCaret(on ? 'best' : 'off');
}

// A focused input takes the sequence's "b" and starts the run; restart the same passage clean.
listenForSequence(() => {
  toggleGhost();
  if (attempt?.status === 'running' && document.body.dataset.view === 'practice') resetSession(sessionKind, { focus: true, selectedPassage: passage });
});

let resizeFrame = 0;
addEventListener('resize', () => {
  primaryFx.relayout();
  raceFx.relayout();
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => updateGlides({ instant: true }));
});
// The graph is drawn at its pixel size, so redraw whenever that changes, including when results
// comes back into view after a resize on another screen.
new ResizeObserver(() => {
  const graph = $('speed-graph');
  const width = Math.round(graph.clientWidth);
  // Sub-pixel layout settling is ignored so it cannot cut the first draw short.
  if (!shownResult || !width || Math.abs(Number(graph.querySelector('svg')?.getAttribute('width')) - width) <= 1) return;
  renderSpeedGraph(graph, shownResult, { animate: false });
}).observe($('speed-graph'));
let trendWidth = 0;
new ResizeObserver(() => {
  const container = $('progress-trend');
  if (!container.clientWidth || trendWidth === container.clientWidth) return;
  trendWidth = container.clientWidth;
  renderTrend(container, filterRuns(profile.runs.filter(trendRun), $('progress-conditions').value, $('progress-period').value), openHistoryRun);
}).observe($('progress-trend'));
const isMac = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform || '');
document.querySelectorAll('.mod-key').forEach((key) => { key.textContent = isMac ? '⌘' : 'ctrl'; });
compose = createCompose({
  setRunning, announce, uid,
  signedIn: () => Boolean(session),
  save(record) {
    profile.compositions.push(record);
    profile.practiceDays = recordPracticeTime(profile.practiceDays, record.at, record.activeMs);
    return saveProfile();
  },
});
buildKeyboard();
applyPreferences();
setModeControls();
bindEvents();
bindCustomLength();
bindAccount();
bindPalette();
renderAccount();
setRunning(false);
renderHistory();
renderTraining();
renderDaily();
renderFirstRun();
resetSession('practice', { focus: matchMedia('(hover: hover) and (pointer: fine)').matches });
inbox = createInbox({
  isRunning: runInProgress,
  getSession: () => session,
  listInvites: listRaceInvites,
  listChallenges,
  announce,
  actions: {
    challenge: { label: 'Race', run: (entry) => startGhostRace(entry.challengeId) },
    invite: { label: 'Join', run: (entry) => onlineRace.joinInvite(entry.roomId) },
    joined: { label: 'Open', available: (entry) => onlineRace?.liveRoomId === entry.roomId, run: () => onlineRace.open() },
    result: { label: 'Race again', run: (entry) => onlineRace.rematchRoom(entry.roomId, entry.conditions) },
  },
});
// The board only reads: each account's numbers ride its own profile saves (pushProfile, repairBoard).
// Whether the account shares is the board's own to know, from the service, not a synced preference.
friendsBoard = createFriendsBoard({
  getSession: () => session,
  dailyKey,
  // Which shape the bests picker opens on: the one you have run most (src/friends-board.js defaultShape).
  runs: () => profile.runs,
  conditionParts,
  signIn: () => openAccountDialog('signin'),
  // The button that asks for this disappears with the board, so focus lands on the Online selector.
  openOnline: () => { onlineRace.open(); $('challenge-online').focus(); },
  onShared: repairBoardNow,
});
onlineRace = createOnlineRace({
  getSession: () => session,
  inbox,
  board: friendsBoard,
  signIn: () => openAccountDialog('signin'),
  navigate, renderText, updateCharacterStates, setRunning, announce,
  // The one-keyboard tab makes the race the session the rule switches act on.
  onModeChange: syncRules,
  onPassageSeen(id) {
    if (!id || profile.seenTextIds.includes(id)) return;
    profile.seenTextIds.push(id);
    saveProfile();
  },
});
updateGlides({ instant: true });
// Literata arrives after first paint; remeasure everything that depends on glyph widths.
document.fonts?.ready.then(() => { primaryFx.relayout(); updateGlides({ instant: true }); });
console.info('stilltype · ↑ ↑ ↓ ↓ ← → ← → b a');

if (!storageAvailable) announce('Storage is unavailable. Results last only in this tab.');
noticeDeletedAccount();
completeAuthRedirect();
syncOnLoad();
inbox.refresh();
// Refresh the day label and the practice calendar when a tab returns, and across midnight without reloading.
const refreshGoalDay = () => { if (dayKey(new Date()) !== goalDay) renderGoal(); };
setInterval(() => {
  if (document.body.dataset.view === 'compete') { renderDaily(); friendsBoard.rollover(); }
  if (document.body.dataset.view === 'progress') refreshGoalDay();
}, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { renderDaily(); friendsBoard.rollover(); refreshGoalDay(); }
});

// Offline shell (sw.js): installable and playable without a connection. Skipped on localhost so local
// edits are never served stale; Supabase and other origins are never cached.
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  Promise.resolve(navigator.serviceWorker.register('/sw.js')).catch(() => {});
}

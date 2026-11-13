import { createPracticeConditions } from './practice-conditions.js';
import { copyParts, setParts, plain, setText, element } from './native-copy.js';
import { markEndFailure } from './practice-run.js';
import { createApplicationLifetime } from './application-lifetime.js';
import { startPageWork, disposePageWork } from './async-runtime.js';
import { flushSync } from 'react-dom';
import { createInputController } from './input.js';
import { NOTICES } from './input-notices.js';
import { renderText, updateCharacterStates } from './passage-view.js';
import {
  CHARS_PER_WORD,
  CORPUS_VERSION,
  CUSTOM_MAX,
  CUSTOM_MIN_CHARS,
  CUSTOM_MIN_WORDS,
  atRunEnd,
  awaitingSubmit,
  RATE_FLOOR_MS,
  STANDARD_SECONDS,
  STANDARD_VERSION,
  compareAttempts,
  completeAttempt,
  conditionKey,
  createAttempt,
  customTextProblem,
  inputRules,
  makeAdaptive,
  DRILL_SECONDS,
  makeDrill,
  minimumStop,
  normalizeCustomText,
  normalizeManualTarget,
  orderCustomText,
  passageComplete,
  correctionPreference,
  replayAttempt,
  selectPassage,
  standardConditions,
  summarizePatterns,
  textId,
  consistency,
  characterBreakdown,
  wordHistory,
} from './typing.js';
import { DEFAULT_WORD_LIST, wordListIds } from './words.js';
import { codePassage } from './code-snippets.js';
import { BOOKS, BOOK_VERSION, bookName, bookPage, bookPlace, openBook } from './books.js';
import { LENGTHS, isPresetLength, parseCustomLength } from './lengths.js';
import { isDefaultLayout, layoutIds, layoutLabel, normalizeLayout } from './layouts.js';
import { normalizeWordHighlight } from './word-highlight.js';
import { APP_FONTS, TYPING_FONTS, fontName } from './fonts.js';
import { createTypingFx, createWordGlide } from './motion.js';
import { SOUND_LABELS, SOUND_MODES, createSounds, normalizeSoundMode, normalizeSoundVolume } from './sound.js';
import { renderSpeedGraph } from './graph.js';
import { showThemeOptions, wearColors } from './theme-editor.js';
import { normalizeCustomThemes, readCustomThemes, themeMode as colorsMode } from './custom-themes.js';
import { matchesBinding, bindingLabel, ariaShortcuts } from './keybindings.js';
import { listenForSequence } from './egg.js';
import * as account from './account.js';
import { boardColumn, boardCurrent, optOutPending } from './friends-board.js';
import { forgetRace, listFriends, listRaceInvites } from './multiplayer.js';
import { CHALLENGE_DAYS, challengeConditions, challengeOutcome, challengePayload, challengeTextId, encodeTrace, finishChallenge, getChallenge,
  ghostPoints, leadVerb, listChallenges, outcomeRule, resultText, sameScore, scoreTrace, sendChallenge, traceTrouble, validTrace } from './ghost-race.js';
import { DEFAULT_POLICY, FOCUSES, keyboardOf, paceShift, recommendFor } from './learner.js';
import { evidenceCopy, missedCopy, sinceCopy, trainPath } from './train-path.js';
import { CORRECTION_LABELS, conditionLabels, conditionParts, correctionLabel, dayKey, goalMinutes, minutesByDay, practiceLevel, practiceStreak, recordPracticeTime, MAX_RUN_SUMMARIES, STANDARD_MIN_RUNS, comparableKind, firstTriesAt, dailyPassage, evidenceRun, filterRuns, missedAndSlowWords, periodDays, periodStats, periodWindow, practiceRun, practiceStats, shapeOf, testShapes, practiceTextConditions, practiceWordsPassage, recurringMissedWords, runDay, standardInputClass, standardScore, trendRun, validRun } from './insights.js';
import { monthLabels, renderRunsPerDay, renderSpread, renderTrend, renderWeekChart } from './progress-view.js';
import { SHOWN_MOVERS, WEEK_MIN_RUNS, moverCopy, moverSample, weekChange } from './week-change.js';
import { formatSpeed, showSpeed, showSpeedUnit, signedNumber, speedFigure, speedValue, unitLabel, unitText, wpmFromSpeed } from './units.js';
import { promptText } from './compose.js';
import {
  LESSONS, LESSON_ACCURACY, fingerFor, keysLabel, lessonKeys, lessonOutcome, lessonPassage, lessonUnlocked, lessonsComplete,
  lessonsStarted, makeupCopy, makeupShort, nextLessonIndex, recordLessonRun,
} from './lessons.js';
import { runCountTotals } from './run-counts.js';
import { CUSTOM_ORDERS, DARK_THEMES, DRILL_LENGTHS, LIGHT_THEMES, MIN_ACCURACY_OPTIONS, MIN_WPM_OPTIONS, PACE_MAX_WPM, PACE_MIN_WPM, clampPace, defaultPreferences, emptyProfile, normalizeProfile, preferencesInUse, uid, validPreferences } from './profile.js';



export async function attachApplication({ practice, learning, palette, settings: settingsView, compose, quoteFilters, challenge, themeEditor, wallpaper, accounts, sync, deletion, inbox, friendsBoard, suggestion, importing, release, historyClear, recording, practiceRun: runSession, onlineRace }) {
startPageWork();
const lifetime = createApplicationLifetime();
const setTimeout = lifetime.timeout;
const clearTimeout = lifetime.clearTimeout;
const setInterval = lifetime.interval;
const requestAnimationFrame = lifetime.frame;
const cancelAnimationFrame = lifetime.cancelFrame;
const selectSetting = settingsView.select;
const disableSetting = settingsView.disable;
const onSetting = settingsView.onSetting;

function updateComparison(patch) {
  flushSync(() => learning.comparison.publish({ ...learning.comparison.getSnapshot(), ...patch }));
}

const $ = (id) => document.getElementById(id);
const now = () => performance.now();

function markKeyboardTargets(target) { practice.keyboard.target(target); }

function renderKeyboard() {
  const lesson = practice.sessionKind === 'lesson';
  practice.keyboard.show({ layout: learning.preferences.layout, fingers: learning.preferences.fingerMap,
    visible: Boolean(learning.preferences.keyboard) || lesson,
    lesson: lesson ? { known: lessonKeys(lessonIndex - 1), fresh: LESSONS[lessonIndex].keys } : null });
}


let customOpen = false;

function customPassage() {
  const text = normalizeCustomText(learning.preferences.customText);

  if (!text) return null;

  return { id: null, text: orderCustomText(text, learning.preferences.customOrder), fresh: false };
}

const customOrderLabel = (order) => ({ shuffled: 'shuffled words', random: 'random words' }[order] || 'as written');

// No session means guest mode: default settings, and nothing leaves this tab.

await accounts.replaceIdentity(accounts.session);
const { loadProfile, saveProfile, storeLocally, commitPreferences, saveChoice, absorbCache, pushProfile, pullProfile, syncOnLoad } = sync;
sync.configure({ running: () => runInProgress(), showMerged, resetListedRuns() { progressState.allRuns = false; }, boardFor: (data) => boardFor(data),
  boardPushed() { friendsBoard?.pushed(); }, boardResume() { friendsBoard?.resume(); }, repairBoard, adoptProfile,
  legacyPreferences() { learning.preferences = preferencesInUse(learning.profile.preferences); }, clearCountsUnsaved() { runSession.markCountsSaved(); } });


// Saves only count as edits once the account row has been compared with the device cache;
// otherwise a boot-time save (marking the first passage seen) would make a stale cache look newer.

// Counts saves, so a push can tell whether anything changed while it was waiting on the network.


// The account row's updated_at as last merged here: the version a conditional write expects to replace.


// The device cache as this tab last wrote it, or took it in holding everything this tab had written;
// different text means another tab wrote since.

// A change to the history that arrived mid-run, which the training surfaces show once the run ends (followHistory).
let historyWaiting = false;

// Another tab signed this account out, or the device is now signed in as someone else
// (followSessionElsewhere): this tab saves and sends nothing more for it, and starts again as the device
// now is once no run is in progress.


// A sign-out in another tab that sent everything names the copy of the device cache it sent before
// removing it (account.signOut). Its stamp is kept here until that removal is heard, so a copy removed
// that wasn't the one sent goes back for the next sign-in (finishFollow).


// The device cache as the last push that left nothing unsent stored it: what a sign-out here has sent.
// absorbCache moves cacheText, never this, so another tab's save taken in since never looks sent.

const saveRunCounts = runSession.saveCounts;
const runPosition = runSession.position;
const initialProfile = loadProfile();
learning.initialize(initialProfile, preferencesInUse(initialProfile.preferences));

// The preferences in use. profile.preferences is what is stored and synced (only the settings chosen,
// never a default filled in: see normalizeProfile); merges change only that, and these follow it where
// that can't disturb a run (followStoredPreferences).


// prefs as last committed or followed. A difference is an edit made in this tab.

let preferencesWaiting = false;
let passage = null;

let primaryCharacters = [];
let primaryTextView = null;
let primaryNotice = '';
let liveSecond = -1;

// The time of the last key since a minimum stopped the run; see the Run again key guard.
let stopHold = null;
const STOP_HOLD_MS = 600;

// An online race's typing surface (src/online-race.js), which takes keys through this same path as type
// 'online': { attempt, origin (the shared start), view, accepting(at), notice(message), changed(), finish() }.


// Whether the practice passage is on one line. Read from the body, as the stylesheet does, so trimming and
// measuring always follow the layout on screen (see tapeLayout).
const onTape = () => document.body.dataset.tape === 'true';
const primaryFx = createTypingFx($('typing-wrap'), $('text-display'), { ensureCharacters: (index) => primaryTextView?.ensureForward(index), tape: onTape });
const raceFx = createTypingFx(document.querySelector('.race-typing-wrap'), $('race-text-display'), { ensureCharacters: (index) => race.textView?.ensureForward(index) });

// The settings preview's sliding highlight: on "little" for this word, "room" for next word. It is placed
// while the preview is on screen: as it appears or resizes, and as the highlight settings change.
const previewGlide = createWordGlide();

$('settings-preview-passage').append(previewGlide.element);

lifetime.observeResize(() => placePreviewGlide({ instant: true }), $('settings-preview-passage'));

// from: a word offset to slide in from, to show the slide being turned on.
function placePreviewGlide({ instant = false, from = 0 } = {}) {
  const passage = $('settings-preview-passage');

  if (!learning.preferences.wordHighlightSlide || learning.preferences.wordHighlight === 'off' || !$('settings-dialog').open || !passage.offsetWidth) return;
  const word = (offset) => passage.children[(learning.preferences.wordHighlight === 'next' ? 3 : 2) + offset];

  if (from) previewGlide.follow(word(from), { instant: true });
  previewGlide.follow(word(0), { instant });
}

// Key sounds read the current preferences on each key; the AudioContext waits for an audible choice or key.
const sounds = createSounds({ settings: () => ({ mode: learning.preferences.sound, volume: learning.preferences.soundVolume }), running: () => runInProgress() });
const prefersLight = matchMedia('(prefers-color-scheme: light)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// The completed run the results view shows: its numbers, run card graph and Watch replay. Only
// showResult sets it. `attempt` moves on without it (a drill whose retest is unavailable, the
// next run), so nothing on the results view reads `attempt`.
let wordsPassage = null;

// The words the Train list last drew, so its button can tell when the runs changed underneath.
const ghostOn = () => learning.preferences.paceCaret !== 'off';
let keybindingEditor = null;
let detachWallpaper = null;
let baselineAttempt = null;
let selectedTarget = null;
let trainingContext = null;


let displayedIds = null;


// The label of the practice passage waiting when history was cleared, which undo gives back.



// Composing practice takes the passage's place on the practice screen; see openCompose.
let composeOpen = false;

// The lesson being typed and the last lesson result in this tab (shown on the learn screen).
let lessonIndex = 0;
const { settingsConditions, conditions, customConditions, practiceMinimums, inputLayout, lessonConditions } = createPracticeConditions(learning, () => lessonIndex);
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


// The history clears this tab had applied when its training state (baseline, results on show) was last
// checked against them, and where an older build's clear left history starting (legacyClearedAt).
let trainingClears = account.clearsApplied(learning.profile);
let trainingLegacyAt = learning.profile.legacyClearedAt || '';

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

// Runs started and finished (src/run-counts.js). A start is counted at the first key but written with the
// next save (the run's end, a restart, leaving the page), never on the keystroke itself.

// Signed in, the profile is cached on this device and synced to the account shortly after.
// A guest's profile lives only in memory, so there is nothing to fail.


// The device cache is shared by every tab signed in to this account. Whatever another tab wrote since
// this one last read it is merged in first, so no tab overwrites another's runs or settings.


// Records preference edits made in this tab (only the settings that changed, on top of the stored ones,
// which may already hold a newer change from elsewhere) and stamps each for syncing. `chosen` names
// settings the person just picked: stamped even when the pick matches what is shown, so it outranks a
// different value from another tab or device that was waiting to apply.


// Saves after the person picks settings, stamping the ones picked (see commitPreferences).


// How Train trains: what it ranks on, the drill's length and whether a retest follows.
const TRAINING_PREFERENCES = ['trainFocus', 'drillSeconds', 'retest'];

// Palette words for each focus command. A command never carries another focus's name, so a typed label matches only its own.
const FOCUS_KEYWORDS = { balanced: 'both mix', accuracy: 'mistakes errors misses', speed: 'slow pace timing' };

// Settings that never enter a run's conditions: how things look, and how Train trains. Everything else is a test
// condition.
const DISPLAY_PREFERENCES = ['theme', 'darkTheme', 'lightTheme', 'customThemes', 'fontSize', 'typingFont', 'appFont', 'wordHighlight', 'wordHighlightSlide', 'tape', 'liveMetrics', 'keyboard', 'fingerMap', 'focusMode', 'speedUnit', 'sound', 'soundVolume', 'keybindings', 'dailyGoal',
  ...TRAINING_PREFERENCES];

const runInProgress = () => runActive || localRaceRunning();
const attemptPrepared = () => Boolean(practice.attempt) && !['complete', 'interrupted'].includes(practice.attempt.status);

// A practice passage nobody has started typing. Newer test conditions from elsewhere replace it, as a
// change of conditions here would; retests, drills and the daily keep the conditions they started with.
const untouchedPractice = () => practice.sessionKind === 'practice' && practice.attempt?.status === 'ready' && !practice.attempt.events.length;

// Brings the preferences in use up to the stored ones once that can't disturb a run: nothing changes
// mid-run, and test conditions wait while a passage is prepared, so the passage on screen always
// matches the controls around it. resetSession passes conditions: true as it prepares the next one.
function followStoredPreferences({ conditions = !attemptPrepared() } = {}) {
  commitPreferences();

  if (runInProgress()) {
    preferencesWaiting = true;

    return;
  }

  const stored = { ...defaultPreferences, ...learning.profile.preferences };
  const next = { ...learning.preferences };
  let changedConditions = false;
  preferencesWaiting = false;

  for (const key of new Set([...Object.keys(stored), ...Object.keys(learning.preferences)])) {
    if (key === 'keybindings' ? JSON.stringify(next[key]) === JSON.stringify(stored[key]) : next[key] === stored[key]) continue;

    if (!conditions && !DISPLAY_PREFERENCES.includes(key)) {
      preferencesWaiting = true;
      continue;
    }

    next[key] = stored[key];

    if (!DISPLAY_PREFERENCES.includes(key)) changedConditions = true;
  }

  const json = JSON.stringify(next);

  if (json === learning.livePreferences) return;
  const before = learning.preferences;
  learning.preferences = validPreferences(next);
  learning.livePreferences = JSON.stringify(learning.preferences);
  applyPreferences();

  if (changedConditions) setModeControls();

  if (TRAINING_PREFERENCES.some((key) => learning.preferences[key] !== before[key])) showTraining();
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





// "standard v1": the recipe name as people read it, then what the recipe fixes.
const recipeLabel = (recipe = STANDARD_VERSION) => recipe.replace('-', ' ');
const recipeSummary = (value = standardConditions()) => `${recipeLabel(value.recipe)} · ${value.duration} s · english 1k–10k mix · punctuation, numbers, one quote`;

// What every condition line ends with: input and layout, correction and rules, and versions.
function conditionTail(value) {
  const { language, length, text, ...tail } = conditionParts(value);

  return Object.values(tail).join(' · ');
}

const inputName = (value) => inputLabel(value);

// Custom text has its own condition key, so it can never share a best, trend or retest with a test.
// It builds on the person's own settings, never the standard recipe: with standard selected underneath,
// a custom run keeps its own correction rule and gets no recipe, so its key is the same as in any mode.
// Settings add a language only in code mode and a book and its text version only in book mode, so they are dropped too.


function describeConditions(value = conditions(), sets = []) {
  const { language, length, text, ...tail } = conditionParts(value, sets);

  // The recipe name stands for its punctuation, numbers and quote, keeping the run card's line short.
  if (value.mode === 'standard') return [length, '1k–10k mix', ...Object.values(tail)].join(' · ');

  if (value.mode === 'code') return [length, ...Object.values(tail), 'not counted toward bests'].join(' · ');

  if (value.mode === 'book') return [length, ...Object.values(tail)].join(' · ');

  return [language, length, text, ...Object.values(tail)].join(' · ');
}

// Minimums ride along on the conditions line without joining the conditions key. The standard test
// has none: it is one fixed measurement, and a personal filter on which of its runs count would lift
// its score. Code runs have none either: they are never counted, so there is nothing for a minimum to guard.


function describeMinimums(minimums) {
  const accuracy = minimums?.accuracy ? [`min ${minimums.accuracy}% accuracy`] : [];

  return minimums?.wpm ? [...accuracy, accuracy.length ? ' · min ' : 'min ', speedFigure(minimums.wpm)] : accuracy;
}

// "Stopped: accuracy fell below 95%" for a run ended on the tick; "Finished under your 98% minimum
// accuracy" for one that reached its end below it.
function stopReason(stop) {
  if (stop.atEnd) return ['Finished under your ', ...(stop.metric === 'accuracy' ? [`${stop.minimum}% minimum accuracy`] : [speedFigure(stop.minimum), ' minimum speed'])];

  return ['Stopped: ', ...(stop.metric === 'accuracy' ? [`accuracy fell below ${stop.minimum}%`] : ['speed fell below ', speedFigure(stop.minimum)])];
}

// Strict space and quick end appear only when they differ from the defaults, as in conditionKey.
function describeRules(value) {
  const { strictSpace, quickEnd } = conditionParts(value);

  return [strictSpace, quickEnd].flatMap((rule) => (rule ? [` · ${rule}`] : [])).join('');
}

// A drill is always DRILL_SECONDS of generated text, whatever the baseline was. Its conditions record
// quick end at the default (sessionConditions), so only rules that applied are listed.
// The layout setting describes a physical keyboard, so touch runs always keep the default key.


// The layout is named only when it isn't QWERTY; runs saved before layouts existed read as QWERTY.
function inputLabel(value) {
  const { input, layout } = conditionParts(value);

  return layout ? `${input} · ${layout}` : input;
}

function describeRun(run) {
  if (run.kind === 'lesson') return describeLesson(run);

  if (run.kind === 'challenge') return `ghost race · ${describeConditions(run.conditions)}`;

  if (run.kind === 'daily') return `daily · ${run.challengeDate} · ${run.firstDailyAttempt ? 'first attempt' : 'repeat attempt'}${run.firstDailyAttempt && !run.fresh ? ' · previously displayed passage' : ''} · ${describeConditions(run.conditions)}`;

  if (run.kind === 'missed') return `missed words · not counted · ${run.text?.split(' ').length || 40} words${run.conditions.punctuation ? ' · punctuation' : ''}${run.conditions.numbers ? ' · numbers' : ''} · ${run.conditions.inputClass === 'touch' ? 'touch input' : 'physical keyboard'} · ${correctionLabel(run.conditions.correctionPolicy)}`;

  if (run.kind === 'custom') return `custom text · ${customOrderLabel(run.conditions.customOrder)} · ${run.conditions.inputClass === 'touch' ? 'touch input' : 'physical keyboard'} · ${correctionLabel(run.conditions.correctionPolicy)} · not counted`;

  if (run.adaptive) return `adaptive · ${describeConditions(run.conditions)}`;

  if (run.kind !== 'drill') {
    const minimums = describeMinimums(run.minimums);
    const page = run.conditions?.mode === 'book' && bookPage(run.textId);

    return [`${run.fresh === false ? 'repeated text · ' : ''}${page ? `page ${page} · ` : ''}${describeConditions(run.conditions)}`, ...(minimums.length ? [' · ', ...minimums] : [])];
  }

  return `drill · ${run.drillSeconds || DRILL_SECONDS} s · english · ${inputLabel(run.conditions)} · ${correctionLabel(run.conditions.correctionPolicy)}${describeRules(run.conditions)}`;
}

function describeLesson(run) {
  const index = LESSONS.findIndex((lesson) => lesson.id === run.conditions.lesson);

  return [`lesson ${index + 1} of ${LESSONS.length} · keys ${lessonKeys(index).join(' ')} · ${makeupShort(index, run.lesson)} · pass at ${LESSON_ACCURACY}% accuracy and `,
    speedFigure(LESSONS[index].wpm), ` · ${inputName(run.conditions)} · ${correctionLabel(run.conditions.correctionPolicy)}`];
}

// Lesson runs carry their own conditions: never comparable with a practice key, never a best.


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
  return `${signedNumber(value)} ${unit}`;
}

// Copy that holds a speed is a list of parts, each speed a figure that re-texts with the unit (src/units.js).
// Empty strings, missing values and false are left out: an element with nothing to say stays :empty, a run
// without an error count shows none rather than "undefined", and a part written `when && part` can drop out.




// The live numbers tick ten times a second; only touch the DOM when the text changes.


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

// A run began or ended: what waited for its end appears now, and the sound rests.
function runChanged() {
  inbox?.runChanged();

  if (!runInProgress()) sounds.rest();

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

  if (sync.state.signedOutElsewhere) {
    // A sign-out that sent everything reloads once its removal of the cache is heard (finishFollow).
    if (sync.state.pendingSignOut === null) location.reload();

    return;
  }

  if (sync.state.cacheWaiting && absorbCache()) setTimeout(showMerged);

  if (preferencesWaiting) followStoredPreferences();

  if (forgetClearedTraining() || historyWaiting) followHistory();
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
  return comparableKind(practice.sessionKind) ? conditionKey(practice.attempt?.conditions || conditions()) : null;
}

function showBest() {
  const key = currentBestKey();

  // Code runs have their own key but never set a best. (A custom session over code says it isn't counted.)
  if (key && (practice.attempt?.conditions || conditions()).mode === 'code') {
    $('best').textContent = 'Code runs aren’t ranked';

    return;
  }

  const best = key && learning.profile.bests[key];
  setParts($('best'), !key ? 'Not counted' : best ? ['Best · ', speedFigure(best.wpm)] : 'No best yet');
}

// The mode a theme belongs to, a custom one's by its background; null for 'system' or a theme not saved.
function modeOf(theme) {
  if (DARK_THEMES.includes(theme)) return 'dark';

  if (LIGHT_THEMES.includes(theme)) return 'light';
  const custom = readCustomThemes(learning.preferences.customThemes).find((entry) => entry.id === theme);

  return custom ? colorsMode(custom.colors) : null;
}

function themeMode() {
  return modeOf(learning.preferences.theme) ?? 'system';
}

// A mode's pick: the theme shown, in that mode, else the one saved for it, else the mode's default.
function themeFor(mode) {
  if (themeMode() === mode) return learning.preferences.theme;

  return modeOf(learning.preferences[`${mode}Theme`]) === mode ? learning.preferences[`${mode}Theme`] : mode;
}

function shownTheme() {
  const mode = themeMode();

  return mode === 'system' ? themeFor(prefersLight.matches ? 'light' : 'dark') : learning.preferences.theme;
}

// A custom theme (src/custom-themes.js) is worn over dark or light by its colours; without them the theme is built in.
function wearTheme(colors, theme) {
  const root = document.documentElement;
  root.dataset.theme = wearColors(root, colors) ?? theme;
  const ground = getComputedStyle(root).getPropertyValue('--ground').trim();

  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = ground;
}

function applyTheme() {
  // While the editor is open its draft stays on show.
  const themes = readCustomThemes(learning.preferences.customThemes);
  const theme = shownTheme();
  wearTheme(themeEditor?.draftColors() ?? themes.find((entry) => entry.id === theme)?.colors, theme);
  showThemeOptions(themes, theme);
  selectSetting('theme-select', themeMode());
  selectSetting('dark-theme', themeFor('dark'));
  selectSetting('light-theme', themeFor('light'));
}

// The theme left for another becomes its mode's pick.
function keepPick() {
  const left = themeMode();

  if (left !== 'system') learning.preferences[`${left}Theme`] = learning.preferences.theme;
}

// Shows a theme, or 'system'.
function showTheme(theme) {
  themeEditor?.close({ focus: false });
  keepPick();
  learning.preferences.theme = theme;
  applyTheme();
  saveChoice('theme');
}

function setThemeMode(mode) {
  showTheme(mode === 'system' ? 'system' : themeFor(mode));
}

// Outside system mode, a pick is shown at once, in its own mode.
function pickTheme(mode, theme) {
  if (themeMode() !== 'system') return showTheme(theme);
  themeEditor?.close({ focus: false });
  learning.preferences[`${mode}Theme`] = theme;
  applyTheme();
  saveChoice(`${mode}Theme`);
}

// After the editor saves or deletes a custom theme: a saved one is picked as pickTheme does; a pick whose
// theme was deleted, or moved to the other mode, goes back to its mode's default.
function saveCustomThemes(customThemes, saved) {
  const mode = themeMode();
  keepPick();
  learning.preferences.customThemes = normalizeCustomThemes(customThemes);

  if (learning.preferences.theme !== 'system' && !modeOf(learning.preferences.theme)) learning.preferences.theme = mode;

  for (const pick of ['dark', 'light']) if (modeOf(learning.preferences[`${pick}Theme`]) !== pick) learning.preferences[`${pick}Theme`] = pick;

  if (saved) {
    if (themeMode() === 'system') learning.preferences[`${modeOf(saved)}Theme`] = saved;
    else {
      keepPick();
      learning.preferences.theme = saved;
    }
  }

  applyTheme();
  saveChoice('customThemes', 'theme', 'darkTheme', 'lightTheme');
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

  // A mode chosen inside "more" leaves its summary marked, so the pill rests there.
  const target = container.querySelector(container.dataset.glide === 'current' ? ':scope > [aria-current="page"]' : ':scope > [aria-pressed="true"]')
    ?? container.querySelector(':scope > [data-active]');

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

// The tape is for solo practice. A ghost race keeps three lines, as the other races do, so the
// friend's caret stays in view however far ahead or behind it is.
const tapeLayout = () => String(learning.preferences.tape && practice.sessionKind !== 'challenge');

// The one writer of the passage layout: the text size, and three lines or the tape.
function syncLayout() {
  if (document.body.dataset.tape !== tapeLayout() || document.body.dataset.fontSize !== String(learning.preferences.fontSize)) {
    // Trimmed words leave a spacer shaped for one layout and text size; put them back first.
    primaryTextView?.restore();
  }

  document.body.dataset.fontSize = learning.preferences.fontSize;
  document.body.dataset.tape = tapeLayout();
  primaryFx.relayout();
}

function setSessionKind(kind) {
  practice.sessionKind = kind;
  syncLayout();
}

// The typing font's baseline below the middle of its line, from the font's own metrics, so every caret
// stands on the baseline exactly as it does on Literata's (--typing-baseline in src/styles.css).
function measureTypingBaseline() {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `1000px ${getComputedStyle(document.documentElement).getPropertyValue('--font-typing')}`;
  const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = probe.measureText('H');

  if (ascent) document.documentElement.style.setProperty('--typing-baseline', `${(ascent - descent) / 2000}em`);
}

// A new font changes letter widths, as a resize does, and again once its file arrives.
function applyFonts() {
  const root = document.documentElement.dataset;
  selectSetting('typing-font', learning.preferences.typingFont);
  selectSetting('app-font', learning.preferences.appFont);

  if (root.typingFont === learning.preferences.typingFont && root.appFont === learning.preferences.appFont) return;
  root.typingFont = learning.preferences.typingFont;
  root.appFont = learning.preferences.appFont;
  measureTypingBaseline();
  relayoutText();
  onlineRace?.relayout();
}

function applyPreferences() {
  syncLayout();
  applyFonts();
  document.body.dataset.wordHighlight = learning.preferences.wordHighlight;
  document.body.dataset.wordHighlightSlide = String(learning.preferences.wordHighlightSlide);
  document.body.dataset.tapePreference = String(learning.preferences.tape);
  document.body.dataset.liveMetrics = String(learning.preferences.liveMetrics);
  document.body.dataset.keyboard = String(learning.preferences.keyboard);
  document.body.dataset.focusMode = String(learning.preferences.focusMode);
  selectSetting('font-size', learning.preferences.fontSize);
  selectSetting('word-highlight', learning.preferences.wordHighlight);
  selectSetting('word-highlight-slide', learning.preferences.wordHighlightSlide);
  $('word-highlight-slide').closest('.preference-row').hidden = learning.preferences.wordHighlight === 'off';
  placePreviewGlide();
  selectSetting('live-toggle', learning.preferences.liveMetrics);
  selectSetting('keyboard-toggle', learning.preferences.keyboard);
  syncRules();
  selectSetting('finger-toggle', learning.preferences.fingerMap);
  disableSetting('finger-toggle', !learning.preferences.keyboard);
  selectSetting('correction-select', learning.preferences.correction);
  selectSetting('focus-toggle', learning.preferences.focusMode);
  selectSetting('tape-toggle', learning.preferences.tape);
  $('keyboard').hidden = !learning.preferences.keyboard && practice.sessionKind !== 'lesson';
  renderKeyboard();
  applySoundPreferences();
  applyTheme();
  selectSetting('numbers-toggle', Boolean(learning.preferences.numbers));
  quoteFilters.refresh();
  selectSetting('word-list', learning.preferences.wordList);
  applySpeedUnit();
  selectSetting('repeat-quotes-toggle', learning.preferences.repeatQuotes);
  keybindingEditor?.refresh();
  document.querySelectorAll('.restart-key-hint').forEach((key) => { key.textContent = bindingLabel(learning.preferences.keybindings.restart); });
  $('restart-button').title = learning.preferences.keybindings.restart ? `Restart test (${bindingLabel(learning.preferences.keybindings.restart)})` : 'Restart test';
  $('exit-focus-hint').textContent = bindingLabel(learning.preferences.keybindings.exitFocus);

  for (const [id, action] of [['restart-button', 'restart'], ['palette-trigger', 'commands'], ['exit-focus', 'exitFocus']]) {
    const shortcuts = ariaShortcuts(learning.preferences.keybindings[action]);

    if (shortcuts) $(id).setAttribute('aria-keyshortcuts', shortcuts);
    else $(id).removeAttribute('aria-keyshortcuts');
  }

  document.querySelectorAll('.command-key').forEach((key) => { key.textContent = bindingLabel(learning.preferences.keybindings.commands); });
  selectSetting('layout-select', learning.preferences.layout);
  selectSetting('daily-goal', String(learning.preferences.dailyGoal));
  selectSetting('train-focus', learning.preferences.trainFocus);
  selectSetting('drill-length', String(learning.preferences.drillSeconds));
  selectSetting('retest-toggle', String(learning.preferences.retest));
  syncLockedSettings();
  selectSetting('min-accuracy', String(learning.preferences.minAccuracy));
  selectSetting('min-wpm', String(learning.preferences.minWpm));
  showMinimumNote();
  armPace();
  showBest();
}

function applySoundPreferences() {
  sounds.sync();
  const volume = $('sound-volume');
  selectSetting('sound-select', learning.preferences.sound);
  volume.value = String(learning.preferences.soundVolume);
  volume.disabled = learning.preferences.sound === 'off';
  volume.setAttribute('aria-valuetext', `${learning.preferences.soundVolume}%`);
  volume.style.setProperty('--fill', `${learning.preferences.soundVolume}%`);
  $('sound-volume-value').textContent = `${learning.preferences.soundVolume}%`;
}

// Display only: every speed and unit word on screen re-texts in place (src/units.js), so nothing restarts
// and open rows and focus stay as they are. Only text re-texts: a speed placed in an attribute or drawn in
// SVG has to be redrawn here, as the words' spoken paces and the two charts are
// (the pace field follows in showPace).
function applySpeedUnit() {
  selectSetting('speed-unit', learning.preferences.speedUnit);
  const changed = showSpeedUnit(learning.preferences.speedUnit);

  if (!changed) return;
  labelWords();

  if (practice.shownResult && rateShown(practice.shownResult)) renderSpeedGraph($('speed-graph'), practice.shownResult, { animate: false });

  if (document.body.dataset.view === 'progress') {
    drawProgressView();

    if (progressWeek) renderLead(progressWeek.lead);
  }
}

// Minimums decide which practice runs count, and custom text never counts, so a custom run has none and
// runs to the end like a drill: the note stands aside while Custom or composing is on, as the test
// controls do, and while the standard test is selected (practiceMinimums).
function showMinimumNote() {
  const minimums = describeMinimums(practiceMinimums());
  setParts($('minimum-note'), minimums);
  $('minimum-note').hidden = !minimums.length || customOpen || composeOpen || practice.sessionKind === 'custom';
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
  selectSetting('strict-space-toggle', learning.preferences.strictSpace);
  selectSetting('quick-end-toggle', learning.preferences.quickEnd);
  disableSetting('quick-end-toggle', Boolean(limits.quickEnd));

  for (const [id, reason] of [['quick-end-note', limits.quickEnd], ['rules-note', limits.fixed]]) {
    $(id).textContent = RULE_NOTES[reason] || '';
    $(id).hidden = !reason;
  }
}

// The standard test fixes word list, punctuation, numbers and correction. Their controls show the
// recipe's values and stay locked while it is selected; the person's own settings are kept for other modes.
// A custom passage loaded over it uses the person's own settings (customConditions), so they unlock for it.
const standardLocked = () => learning.preferences.mode === 'standard' && practice.sessionKind !== 'custom';

function syncLockedSettings() {
  const standard = standardLocked();
  // Quotes, code snippets and book pages are fixed text, so these settings don't apply to them.
  const fixed = ['quote', 'code', 'book'].includes(learning.preferences.mode);
  disableSetting('numbers-toggle', fixed || standard);
  selectSetting('numbers-toggle', standard || Boolean(learning.preferences.numbers));
  disableSetting('word-list', fixed || standard);
  $('word-list').querySelector('[value="standard"]').closest('label').hidden = !standard;
  selectSetting('word-list', standard ? 'standard' : learning.preferences.wordList);
  disableSetting('repeat-quotes-toggle', learning.preferences.mode !== 'quote');
  disableSetting('correction-select', standard);
  selectSetting('correction-select', standard ? 'mandatory' : learning.preferences.correction);
  document.querySelectorAll('.preference-lock').forEach((note) => {
    note.textContent = standard ? 'fixed for standard' : '';
    note.hidden = !standard;
  });
}

function setModeControls() {
  quoteFilters.dismiss();
  // Composing takes the passage's place, so Custom is never marked over it.
  const custom = !composeOpen && (customOpen || practice.sessionKind === 'custom');
  $('custom-options').hidden = !customOpen;
  syncLockedSettings();
  showMinimumNote();

  if (custom || composeOpen || learning.preferences.mode === "standard") closeCustomLength();
  renderLengthOptions();
  flushSync(() => practice.controls.publish({
    visible: practice.sessionKind === 'practice' || practice.sessionKind === 'custom', bookPage: bookPlace(learning.profile.runs, learning.preferences.book) + 1,
    mode: learning.preferences.mode, duration: learning.preferences.duration, count: learning.preferences.count,
    lengthMode: ['time', 'words'].includes(learning.preferences.mode) ? learning.preferences.mode : practice.controls.getSnapshot().lengthMode,
    lengthValue: learning.preferences.mode === 'time' ? learning.preferences.duration : learning.preferences.mode === 'words' ? learning.preferences.count : practice.controls.getSnapshot().lengthValue,
    punctuation: Boolean(learning.preferences.punctuation), adaptive: learning.preferences.adaptive,
    custom, customOpen, composing: composeOpen, codeLanguage: learning.preferences.codeLanguage,
    standardRecipe: recipeSummary() + ' · ' + correctionLabel(standardConditions().correctionPolicy),
  }));
  showBest();
  requestAnimationFrame(() => updateGlides());
}

// The four presets and the custom pill are relabelled in place, never rebuilt, so a click that
// lands just as the custom field commits on blur still reaches the button under the pointer.
function renderLengthOptions() {
  setCustomLengthError('');
  const spec = LENGTHS[learning.preferences.mode];

  if (!spec) {
    closeCustomLength();

    return;
  }

  const current = learning.preferences[spec.key];
  $('duration-options').querySelectorAll('[data-length]').forEach((button, index) => {
    const value = spec.presets[index];
    const selected = value === current;
    button.textContent = String(value);
    button.dataset.length = String(value);
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', `${value} ${spec.unit}`);
  });
  const custom = !isPresetLength(learning.preferences.mode, current);
  const button = $('custom-length');
  button.textContent = custom ? String(current) : 'custom';
  button.classList.toggle('is-active', custom);
  button.setAttribute('aria-pressed', String(custom));
  button.setAttribute('aria-label', custom ? `custom ${spec.noun}, ${current} ${spec.unit}` : `custom ${spec.noun}`);

  if ($('custom-length-form').dataset.lengthMode !== learning.preferences.mode) closeCustomLength();
}

// The custom pill turns into a short field in place. Enter, or leaving the field with a valid
// number, sets the length; Escape puts the pill back. Guests keep the value for the tab only.
let dropCustomLength = false;

// Set even when unchanged, so a second bad entry is announced again.
function setCustomLengthError(message) {
  const node = $('custom-length-error');

  if (message || node.textContent) node.textContent = message;
}

function openCustomLength(mode = learning.preferences.mode) {
  const spec = LENGTHS[mode];

  if (!spec) return;

  // A new length restarts the run anyway; a timed run must not end under the open field.
  if (practice.attempt?.status === 'running') resetSession('practice');
  const form = $('custom-length-form');
  const input = $('custom-length-input');
  form.dataset.lengthMode = mode;
  dropCustomLength = false;
  input.value = learning.preferences[spec.customKey] ? String(learning.preferences[spec.customKey]) : '';
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
  if (focus) (learning.preferences.focusMode ? $('typing-input') : $('custom-length')).focus({ preventScroll: true });
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

  if (learning.preferences.mode === mode && learning.preferences[spec.key] === result.value) {
    saveChoice('mode', spec.key, ...(!isPresetLength(mode, result.value) ? [spec.customKey] : []));

    if (!leaving) $('typing-input').focus({ preventScroll: true });

    return;
  }

  learning.preferences.mode = mode;
  learning.preferences[spec.key] = result.value;

  if (!isPresetLength(mode, result.value)) learning.preferences[spec.customKey] = result.value;
  setModeControls();
  saveChoice('mode', spec.key, ...(!isPresetLength(mode, result.value) ? [spec.customKey] : []));
  // Focus stays wherever the person went when they left the field.
  resetSession('practice', { focus: !leaving });
}

function bindCustomLength() {
  const form = $('custom-length-form');
  const input = $('custom-length-input');
  $('custom-length').addEventListener('click', () => openCustomLength(learning.preferences.mode), { signal: lifetime.signal });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    commitCustomLength();
  }, { signal: lifetime.signal });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // Escape belongs to the field here, not to restart or focus mode.
    event.preventDefault();
    event.stopPropagation();
    setCustomLengthError('');
    closeCustomLength({ focus: true });
  }, { signal: lifetime.signal });
  // Pressing another length, mode or switch in the row means that control wins; the edit is dropped.
  const controls = document.querySelector('.practice-controls');
  controls.addEventListener('pointerdown', (event) => {
    if (!form.hidden && !form.contains(event.target)) dropCustomLength = true;
  }, { signal: lifetime.signal });
  controls.addEventListener('pointercancel', () => { dropCustomLength = false; }, { signal: lifetime.signal });
  form.addEventListener('focusout', (event) => {
    // Switching windows keeps the field open; the browser hands focus back on return.
    if (form.hidden || form.contains(event.relatedTarget) || !document.hasFocus()) return;
    // In focus mode the row hides again as the field closes, so focus bound for it would be lost.
    const stranded = learning.preferences.focusMode && (!event.relatedTarget || controls.contains(event.relatedTarget));

    if (dropCustomLength) {
      dropCustomLength = false;
      closeCustomLength();
    } else commitCustomLength({ leaving: true });

    if (stranded) $('typing-input').focus({ preventScroll: true });
  }, { signal: lifetime.signal });
}

// A mode change resets once, in the new mode, so a quote is never drawn (and marked seen) only to be replaced.
// Custom text hides the length row, so from its editor or session this goes through setTestShape too, which
// closes the editor and starts a test in this mode, as the length buttons do.
function setCustomLengthFromPalette(mode) {
  if (learning.preferences.mode !== mode || customOpen || practice.sessionKind === 'custom') setTestShape(mode);
  else navigate('practice');
  openCustomLength(mode);
}

// Word groups per rendered passage, so the word highlight can follow the caret. Every view marks
// its current and next word; body[data-word-highlight] picks which one (if any) is tinted, so the
// setting applies at once to every passage on screen. Presentational: scoring never reads it.
// Repeats are for open practice only: a retest always needs text the profile hasn't seen. Code snippets
// come round again once each has been shown, marked not fresh, whatever the repeat setting.
// Adaptive practice weights a word or timed passage toward the units the recommender ranks highest for these
// conditions (the learner's top few by the time each loses). With no measured run on this keyboard yet, or once
// after an adaptive run's plain retest was asked for, the passage is the usual one and the run a normal test.
let plainNext = false;

function adaptivePassage() {
  if (plainNext) {
    plainNext = false;

    return null;
  }

  if (!learning.preferences.adaptive || !['time', 'words'].includes(learning.preferences.mode)) return null;
  const { lean, runs } = trainingRecommendation(conditions());

  return runs && lean.length ? { ...makeAdaptive(lean, { mode: learning.preferences.mode, count: learning.preferences.count, duration: learning.preferences.duration, punctuation: learning.preferences.punctuation,
    numbers: Boolean(learning.preferences.numbers), wordList: learning.preferences.wordList }), trainFocus: learning.preferences.trainFocus } : null;
}

function choosePassage(extraSeen = [], { allowRepeats = false } = {}) {
  if (learning.preferences.mode === 'code') return { ...codePassage(learning.preferences.codeLanguage, { seenIds: [...learning.profile.seenTextIds, ...extraSeen] }), corpus: CORPUS_VERSION };

  if (learning.preferences.mode === 'book') return bookPassage(extraSeen);

  return selectPassage({
    mode: learning.preferences.mode,
    count: learning.preferences.count,
    duration: learning.preferences.duration,
    punctuation: learning.preferences.punctuation,
    numbers: Boolean(learning.preferences.numbers),
    quoteLength: learning.preferences.quoteLength,
    difficulty: learning.preferences.difficulty,
    wordList: learning.preferences.wordList,
    seenIds: [...learning.profile.seenTextIds, ...extraSeen],
    allowRepeats,
  });
}

// The page after the last one typed in the chosen book. It is fresh until it has been typed: a book
// page is marked seen when a run on it ends (storeAttempt), not when shown, because showing it again
// is the only way on. A typed page is the only one there is, so it is never swapped for unseen text.
function bookPassage(extraSeen = []) {
  const page = openBook(learning.preferences.book)[bookPlace(learning.profile.runs, learning.preferences.book)];
  const seen = [...learning.profile.seenTextIds, ...extraSeen].includes(page.id);

  return { ...page, textVersion: `${page.id}@1`, corpus: BOOK_VERSION, difficulty: 'book', fresh: !seen, exhausted: seen };
}

// Custom text is never fresh, but it is its own session, not a repeat: it gets no repeated-text notice.
function repeatedTextNotice() {
  if (practice.sessionKind !== 'practice' || passage?.fresh !== false) return '';

  return passage.exhausted && !learning.preferences.repeatQuotes && learning.preferences.mode === 'quote'
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
const restartKind = () => (practice.sessionKind === 'custom' && learning.preferences.customText ? 'custom' : 'practice');

// A drill runs the length it started with. That is its context's, or its own once another device's clear
// has taken the context from under a drill that is waiting or under way. A drill not yet drawn takes the setting.
const drillLength = () => trainingContext?.drill?.duration
  || (['ready', 'running'].includes(practice.attempt?.status) && practice.attempt.drillSeconds)
  || learning.preferences.drillSeconds;

// Daily and missed-word passages run to the end of their text, whatever the practice shape is.
function sessionDurationMs(kind = practice.sessionKind) {
  if (kind === 'challenge') return ghostRace?.duration ? ghostRace.duration * 1000 : null;

  if (['daily', 'lesson', 'missed', 'race'].includes(kind)) return null;

  if (kind === 'drill') return drillLength() * 1000;

  if (kind === 'custom') return null;

  if (learning.preferences.mode === 'time') return learning.preferences.duration * 1000;

  if (learning.preferences.mode === 'standard') return STANDARD_SECONDS * 1000;

  return null;
}

// Why strict space and quick end can't change a session's run, read from the session itself (its
// kind, its timing and the conditions its run was built with), never from the test-shape
// preferences: a drill started from a words baseline is still timed. quickEnd names why
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

  if (practice.attempt && ['ready', 'running'].includes(practice.attempt.status)) return { kind: practice.sessionKind, run: practice.attempt.conditions };
  const kind = practice.sessionKind === 'daily' ? 'daily' : restartKind();

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
    drill: [`drill · ${drillLength()} s`, selectedTarget ? `Practice “${selectedTarget}”` : 'General drill', 'Doesn’t count toward your best.'],
    custom: ['custom text', 'Your text', 'Doesn’t count toward your best.'],
    retest: ['fresh-text retest', 'Measure the change', passage?.fresh === false ? 'You’ve seen every matching quote, so this can’t be a fresh comparison.' : 'Fresh text, same conditions.'],
    missed: ['missed words', wordsPassage?.recurring ? 'Practice words you keep missing' : 'Practice missed and slowest words', 'Doesn’t count toward your best.'],
    daily: ['daily challenge', 'Today’s passage', `${passage?.day} · resets at midnight UTC · ${passage?.firstDailyAttempt ? 'first attempt' : 'repeat attempt'}${passage?.firstDailyAttempt && !passage?.fresh ? ' · previously displayed passage' : ''}`],
    lesson: ['lesson', `Lesson ${lessonIndex + 1} · ${keysLabel(LESSONS[lessonIndex].keys)}`, lessonCopy(lessonIndex, passage)],
    challenge: ghostRace?.own ? ['ghost race', 'Race your best run', 'The ghost is your own recording. Not counted toward your best.']
      : ['ghost race', `Race ${ghostRace?.name}’s run`, 'Your first finish without a break is sent. Not counted toward your best.'],
  }[practice.sessionKind];

  $('session-kicker').textContent = copy[0];
  $('session-title').textContent = copy[1];
  $('session-description').textContent = copy[2];
  $('typing-screen').dataset.session = practice.sessionKind;
  document.body.dataset.session = practice.sessionKind;
  flushSync(() => practice.controls.publish({ ...practice.controls.getSnapshot(), visible: practice.sessionKind === 'practice' || practice.sessionKind === 'custom', bookPage: bookPlace(learning.profile.runs, learning.preferences.book) + 1 }));
  // Every new run (resetSession) brings its own settings and input class to the footer best.
  showBest();
}

// `show: false` replaces the session without leaving the current view.
function resetSession(kind = practice.sessionKind, { focus = false, selectedPassage = null, show = true, keepRace = false, leaveCompose = false } = {}) {
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
  typingHost.clearFor('primary');
  runSession.stopClock();
  setRunning(false);
  saveRunCounts();
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
  const kindChanged = practice.sessionKind !== kind;
  setSessionKind(kind);

  // The mode bar marks Custom while a custom session is loaded, so it is redrawn whenever the kind changes.
  // Changing to any session but custom (a lesson or a ghost race too) also closes the custom editor, or Custom would stay marked over it.
  if (kindChanged && kind !== 'custom') customOpen = false;

  if (kindChanged) setModeControls();

  // Every lesson restart (Esc, the palette, a settings change) lands here: a lesson that is locked again,
  // after history was cleared, gives way to the next open lesson.
  if (kind === 'lesson' && !lessonUnlocked(learning.profile.lessons, lessonIndex)) lessonIndex = nextLessonIndex(learning.profile.lessons);
  passage = selectedPassage || (kind === 'missed' ? wordsPassage : kind === 'daily' ? todayPassage() : kind === 'drill' ? drillPassage()
    : kind === 'lesson' ? lessonPassage(lessonIndex) : kind === 'challenge' ? ghostPassage() : kind === 'custom' ? customPassage()
      : (kind === 'practice' && adaptivePassage()) || choosePassage(kind === 'retest' && baselineAttempt ? [baselineAttempt.textId] : [], { allowRepeats: kind === 'practice' && learning.preferences.repeatQuotes }));

  if (kind === 'retest' && passage?.fresh === false) {
    showUnavailableRetest('You’ve seen every matching quote. Pick another quote filter or a word test, then run a new baseline.');

    return false;
  }

  if (!passage) {
    if (kind === 'retest') showUnavailableRetest('No passage matches the original conditions. Change the quote filters, then run a new baseline.');
    else {
      practice.attempt = null;
      practice.startTime = null;
      $('typing-input').value = '';
      $('typing-input').disabled = true;
      primaryFx.reset([]);
      primaryCharacters = [];
      primaryTextView = null;
      $('text-display').textContent = 'No passage matches these filters.';
      $('accessible-passage').textContent = 'No passage matches these filters.';
      $('typing-status').textContent = 'No matching text';
      $('typing-status').className = 'badge badge-warning';
      $('condition-line').textContent = describeConditions();
      $('input-help').textContent = 'Try another quote length or difficulty.';
      showSpeed($('live-wpm'), null);

      for (const id of ['live-accuracy', 'timer']) $(id).textContent = '—';
      $('progress-bar').style.setProperty('--progress', '0');
      $('progress-track').setAttribute('aria-valuenow', '0');
      configureSessionCopy();
      switchView('practice');
    }

    return false;
  }

  // Drills, word practice and lessons are generated practice text, never a passage to keep fresh for a retest.
  // Generated text records nothing, but still replaces a passage set up earlier in the same task.
  recordSeenOnDisplay(['drill', 'missed', 'lesson'].includes(kind) || passage.book || passage.adaptive ? [] : [passage.id, kind === 'daily' ? passage.challengeId : null]);
  // The one place a run gets its input class: from the press that started it, never a default or the last run's.
  const runConditions = kind === 'daily' ? dailyConditions() : kind === 'lesson' ? lessonConditions() : kind === 'missed' ? { ...conditions(), mode: 'missed', duration: null, count: null, ...practiceTextConditions(passage.text), quoteLength: null, difficulty: null, wordList: null, corpus: CORPUS_VERSION } : kind === 'challenge' ? ghostConditions() : kind === 'custom' ? customConditions() : conditions();
  practice.attempt = createAttempt({
    id: uid(),
    text: passage.text,
    textId: passage.id,
    kind: kind === 'practice' ? (passage.adaptive ? 'drill' : 'test') : kind,
    conditions: { ...sessionConditions(kind, runConditions), inputClass: activationInput },
  });

  if (kind === 'challenge') practice.attempt.challengeId = ghostRace.id;

  if (kind === 'daily') {
    practice.attempt.challengeDate = passage.day;
    practice.attempt.firstDailyAttempt = passage.firstDailyAttempt;
  }

  if (kind === 'drill') {
    practice.attempt.target = selectedTarget;
    practice.attempt.drillSeconds = drillLength();
  }

  if (passage.adaptive) {
    practice.attempt.adaptive = true;
    practice.attempt.trainFocus = passage.trainFocus;
  }

  if (kind === 'lesson') practice.attempt.lesson = { id: passage.lessonId, index: lessonIndex, pairs: passage.pairs, words: passage.words };

  // Open practice stops at the current minimums. A retest carries its baseline's, so both sides of a
  // comparison pass the same filter; drills and the daily challenge always run to the end.
  if (kind === 'practice') practice.attempt.minimums = practiceMinimums();

  if (kind === 'retest') practice.attempt.minimums = baselineAttempt?.minimums || null;
  practice.attempt.fresh = passage.fresh !== false;
  practice.startTime = null;
  $('typing-input').value = '';
  $('typing-input').disabled = false;
  $('accessible-passage').textContent = passage.text;
  primaryTextView = renderText($('text-display'), passage.text, { tape: onTape });
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
  setParts($('condition-line'), describeRun(practice.attempt));
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
      const unseen = displayedIds.filter((id) => id && !learning.profile.seenTextIds.includes(id));
      displayedIds = null;

      if (!unseen.length) return;
      learning.profile.seenTextIds.push(...unseen);
      saveProfile();
    });
  }

  displayedIds = ids;
}

function showUnavailableRetest(reason) {
  switchView('train');
  updateComparison({ compared: false, conditions: '', caveat: reason });
  showComparison('No fair retest available.', 'unavailable', trainingContext?.target || null);
  announce(reason);
}

// Composing has no passage: the practice screen swaps its typing form for the composing form.
// A run in progress is dropped, as a restart would drop it; it was never stored.
function openCompose() {
  if (!composeOpen) {
    runSession.stopClock();

    if (practice.attempt?.status === 'running') {
      primaryFx.finish();
      practice.attempt = null;
    }

    setSessionKind('practice');
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
    runSession.start(stamp);
  } else if (type === 'online') {
    // The race clock started at the shared start.
    targetAttempt.status = 'running';
  } else {
    if (race.startTime !== null) return;
    race.startTime = stamp;
    race.attempt.status = 'running';
    race.attempt.startedAt = 0;
    raceRunChanged();
  }
}

// carried: a later key of an accent commit (the h of "h). One the passage has no place left for was pressed
// while its last letter was still to come, so it is a mistake against that letter, or nothing if it is that
// letter (carriedKey).

// A timed run's clock has run out by this time (by default, now).

// An accent commit made before the limit and still waiting for the key that ended it, or (Windows) a mark
// typed before the limit and waiting for its key's input.


// A timed run ends at its limit, once nothing typed before the limit is still to be scored.


// The checks every typed key passes first; false means the input is ignored (it may finish a timed run).
// at is when the key was typed: a commit made before the limit counts, though it is scored after it.


// IME text isn't keyboard input: the run stops counting, as before. An online race goes on without it.


// Each key takes the same path as a key press, so replay can't tell them apart. A mark and letter
// committed together arrive with the second key press, and share its time. Every key of a commit is
// recorded before the passage can finish: on the last letter, "h counts the h too (see pushInsert).

// An online race types through the practice path (see online). pending: a commit typed before the race's
// limit is still to be scored, so the race waits for it before it finishes. keydown: the race's own keydown
// passes each key it lets through, for a Backspace in an empty field (see backspaceInEmptyField).


// Everything the typing surface says, kept short. The focus-lost and composition
// notices stay until restart because the run no longer counts. Accent (dead) keys are
// typed characters; only IME text (any composition no accent key opened) is refused.


function showInputNotice(type, message, { sticky = false, speak = true } = {}) {
  if (learning.preferences.keybindings.restart !== 'Escape') {
    const hint = learning.preferences.keybindings.restart ? `${bindingLabel(learning.preferences.keybindings.restart)} to restart` : 'Restart shortcut is disabled';
    message = message.replace('Esc to restart', hint);
  }

  if (type === 'primary') {
    $('input-help').textContent = message;

    if (sticky) primaryNotice = message;
  } else if (type === 'online') typingHost.online.notice(message);
  else {
    $('race-help').textContent = message;

    if (sticky) race.notice = message;
  }

  if (speak) announce(message);
}

// A strict space or quick end notice never hides why a run won't count; it follows that notice.
function withRule(sticky, rule) {
  return sticky ? `${sticky} ${rule}` : rule;
}

// at is when the key was typed, so a commit scored after a timed run's limit can't end the run between
// its mark and its letter (scoreCommit ends it once both are in).
function refreshAfterInput(type, previousLength, blocked = false, at = now()) {
  const isPrimary = type === 'primary';
  const targetAttempt = inputAttempt(type);
  const replay = replayAttempt(targetAttempt);

  const view = type === 'online' ? typingHost.online?.view
    : isPrimary ? { input: $('typing-input'), characters: primaryCharacters, textView: primaryTextView, fx: primaryFx }
      : { input: $('race-input'), characters: race.characters, textView: race.textView, fx: raceFx };

  if (!view) return;
  const { input, characters, textView, fx } = view;

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
  fx.update(length, outcome, (length > 0 && !lastCorrect) || blocked === 'space');
  textView.trimBehind(length);
  const waiting = awaitingSubmit(targetAttempt, replay.typed);
  const rule = blocked === 'space' ? NOTICES.strictSpace : waiting ? NOTICES.submit : '';

  // Said once when the space is refused or the run starts waiting, and again if a key is ignored.
  if (blocked === 'space' || (waiting && (length > previousLength || blocked === 'submit'))) announce(rule);

  if (isPrimary) {
    // A backspace before the first letter starts nothing. Once the run has started, every key marks it as
    // under way, which restores the mark after leaving the screen mid-run.
    if (practice.startTime !== null) setRunning(true);
    $('input-help').textContent = rule ? withRule(primaryNotice, rule) : blocked ? NOTICES.blocked : primaryNotice;
    updateLive(false, at);

    if (sessionDurationMs() === null && passageComplete(targetAttempt, replay.typed)) finishPrimary();
  } else if (type === 'online') {
    typingHost.online.notice(rule || (blocked ? NOTICES.onlineBlocked : ''));
    typingHost.online.changed();

    if (passageComplete(targetAttempt, replay.typed)) typingHost.online.finish();
  } else {
    const help = $('race-help');

    if (rule) help.textContent = withRule(race.notice, rule);
    else if ([NOTICES.strictSpace, NOTICES.submit].some((notice) => help.textContent.endsWith(notice))) {
      if (race.notice) help.textContent = race.notice;
      else showRaceRestartHint();
    }

    updateRaceProgress(replay);

    if (passageComplete(targetAttempt, replay.typed)) finishRacePlayer();
  }
}

const typingHost = createInputController({
  attempt: (type) => type === 'primary' ? practice.attempt : race.attempt,
  origin: (type) => type === 'primary' ? practice.startTime : race.startTime,
  durationMs: sessionDurationMs, start: startAttempt,
  finish: (type, elapsed) => type === 'primary' ? finishPrimary(elapsed) : type === 'online' ? typingHost.online?.finish() : finishRacePlayer(),
  refresh: refreshAfterInput, notice: showInputNotice, play: (outcome) => sounds.play(outcome),
});

const inputAttempt = typingHost.attempt;
const offsetFor = typingHost.offsetFor;
const finishIfTimeUp = typingHost.finishIfTimeUp;
const wireOnlineTyping = typingHost.wireOnlineTyping;

// The pace caret is presentational and never scored. It runs at the personal best, the average of
// the last 10 comparable runs, the last comparable run, or a custom pace; with no runs, a gentle 60 wpm.
function ghostPace(mode = learning.preferences.paceCaret) {
  // In a lesson the pace line runs at the lesson's speed target, whatever the pace setting.
  if (practice.attempt?.kind === 'lesson') {
    const wpm = LESSONS[lessonIndex].wpm;

    return { wpm, cps: (wpm * CHARS_PER_WORD) / 60, fromBest: false, fallback: false };
  }

  // The active attempt knows its real input class (from the press that started it, or a later touch).
  const key = conditionKey(practice.attempt?.conditions || conditions());
  let wpm = null;

  if (mode === 'custom') wpm = learning.preferences.paceWpm;
  else if (mode === 'best') wpm = learning.profile.bests[key]?.wpm || null;
  else if (mode === 'average' || mode === 'last') {
    // Only test and retest runs are comparable, as for trends and bests: drills would skew the pace.
    const recent = trendRunsAt(key).slice(mode === 'last' ? -1 : -10);

    if (recent.length) wpm = meanWpm(recent);
  }

  const fromBest = mode === 'best' && Boolean(wpm);
  const fallback = !wpm;
  wpm = wpm || 60;

  return { wpm, cps: (wpm * CHARS_PER_WORD) / 60, fromBest, fallback };
}

function showPace() {
  const on = ghostOn();
  const pace = ghostPace();
  // A ghost race's caret is the friend's run, not the pacer, so the pace isn't labelled there.
  const shown = on && practice.sessionKind !== 'challenge';
  $('pace-label').hidden = !shown;
  setParts($('pace-label'), shown ? ['pace ', speedFigure(pace.wpm)] : '');
  selectSetting('pace-select', learning.preferences.paceCaret);
  // The custom pace field holds its speed in its own unit (data-unit), with its range beside it in that unit.
  // A speed being typed in (focused, and not what was last written here, data-shown) stays as typed, in the
  // unit it was typed in, when this redraws (another tab's save taken in, say): setting the field would drop
  // the edit without a change event. Leaving the field redraws it.
  const field = $('pace-wpm');

  if (document.activeElement !== field || field.value === field.dataset.shown) {
    const unit = learning.preferences.speedUnit;
    field.dataset.unit = unit;
    field.dataset.shown = speedValue(learning.preferences.paceWpm, unit);
    field.value = field.dataset.shown;
    field.min = speedValue(PACE_MIN_WPM, unit);
    field.max = speedValue(PACE_MAX_WPM, unit);
    field.step = speedValue(1, unit);
  }

  $('pace-range').textContent = `${formatSpeed(PACE_MIN_WPM, { bare: true }, field.dataset.unit)}–${formatSpeed(PACE_MAX_WPM, {}, field.dataset.unit)}`;
  $('pace-custom').hidden = learning.preferences.paceCaret !== 'custom';
  setParts($('pace-note'), on && learning.preferences.paceCaret !== 'custom' ? [pace.fallback ? 'no runs yet — ' : '', speedFigure(pace.wpm)] : '');
  document.body.dataset.ghost = on ? 'on' : 'off';
}

// Arms the caret on the current attempt in place: a ready run keeps its passage, and a run in
// progress joins the caret to its own clock. Called whenever the mode or the history behind it changes.
function armPace() {
  const running = practice.attempt?.status === 'running' && practice.startTime !== null;
  const live = running || practice.attempt?.status === 'ready';

  // A ghost race keeps its replayed run: the pacer never replaces or hides it.
  if (practice.sessionKind !== 'challenge') primaryFx.ghost.arm(ghostOn() && live ? ghostPace().cps : 0, running ? practice.startTime : 0);
  showPace();
}

// A pick, even of the pace shown, is stamped (saveChoice), so a different one waiting from elsewhere
// doesn't replace it when a drill or retest ends. The custom speed is stamped only when it was on show:
// typed in (`speed`), or kept by picking custom again. Picking custom from another pace shows a speed
// nobody chose here, so a speed chosen elsewhere outranks it.
function setPaceCaret(mode, { speed = false } = {}) {
  const speedShown = speed || (mode === 'custom' && learning.preferences.paceCaret === 'custom');
  learning.preferences.paceCaret = mode;
  saveChoice('paceCaret', ...(speedShown ? ['paceWpm'] : []));
  armPace();
}



// The live readout shows no rate until RATE_FLOOR_MS has passed. Custom text (any non-comparable kind) can
// be short enough to finish inside that second, so its run card follows the same floor. Built-in passages
// take far longer than a second to type, so their card is unchanged.
const rateShown = (completed) => comparableKind(completed.kind) || completed.summary.elapsedMs >= RATE_FLOOR_MS;

// Where the primary run stands: worked out from the run itself on every call (its duration, and
// whether its passage is finished or, with quick end off, its last word submitted by space), so no
// caller states the end conditions by hand.


function updateLive(reset = false, at = now()) {
  if (!practice.attempt) return;
  const replay = replayAttempt(practice.attempt);
  const elapsed = practice.startTime === null ? 0 : now() - practice.startTime;
  const duration = sessionDurationMs();
  const boundedElapsed = duration ? Math.min(elapsed, duration) : elapsed;
  // A rate over the first second is mostly noise (one key in 5 ms reads as thousands of wpm),
  // and a number that changes every keystroke pulls the eye off the text: update once a second.
  const second = practice.startTime === null ? -1 : Math.floor(boundedElapsed / 1000);

  if (reset || second !== liveSecond) {
    liveSecond = second;
    const live = second >= 0 && boundedElapsed >= RATE_FLOOR_MS ? replayAttempt({ ...practice.attempt, endedAt: boundedElapsed }) : null;
    const score = live?.score;
    showSpeed($('live-wpm'), score ? score.wpm : null);
    setText($('live-accuracy'), score ? score.accuracy : '—');

    // Minimums are judged on this once-a-second tick, after the grace period, never per keystroke.
    // At the run's end (its duration, or its last character) this live check stands aside: the
    // end-of-run check in finishPrimary judges it.
    if (!reset && live && practice.attempt.minimums && practice.attempt.status === 'running' && !practice.attempt.interrupted && !practice.attempt.unsupportedInput) {
      const position = runPosition(live, boundedElapsed);
      const stop = atRunEnd(position) ? null : minimumStop(practice.attempt.minimums, live, position);

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
    const wordTotal = practice.attempt.text.split(' ').length;
    const wordCount = replay.typed.length === practice.attempt.text.length ? wordTotal : (replay.typed.match(/ /g) || []).length;
    setText($('timer'), wordCount);
    setText($('timer-unit'), `/${wordTotal}`);
    setText($('timer-label'), 'words');
    progress = replay.typed.length / practice.attempt.text.length;
  }

  const percent = Math.max(0, Math.min(100, progress * 100));
  $('progress-bar').style.setProperty('--progress', String(percent / 100));
  $('progress-track').setAttribute('aria-valuenow', String(Math.round(percent)));
  $('progress-track').setAttribute('aria-valuetext', reset ? 'Not started' : `${Math.round(percent)} percent complete`);
  finishIfTimeUp(at);
}

function storeAttempt(completed) { return recording.store(completed); }

// The end of a run (the timer, the passage end) is a word boundary for the failure
// policies, so a wrong letter typed just before the timer runs out still fails the run.


const failedDrill = (completed) => completed.kind === 'drill' && Boolean(completed.failed);

// `replacing`: another session or view takes over at once, so a drill draws no retest passage to throw away.
// `stop`: the live tick found the run under a minimum (minimumStop).
function finishPrimary(forcedElapsed = null, { replacing = false, stop = null } = {}) {
  if (!practice.attempt || practice.attempt.status !== 'running') return;

  // A pending accent mark isn't a keystroke; disabling the field commits it, and that is ignored. Nor can
  // the disabled field hear a held accent key let go.
  typingHost.clearFor('primary');
  runSession.stopClock();
  const endedAt = forcedElapsed ?? offsetFor();
  const sealed = runSession.seal(endedAt, stop);

  if (!sealed) return;
  const { completed, valid } = sealed;
  $('typing-input').disabled = true;
  primaryFx.finish();
  setRunning(false);
  $('typing-status').className = `badge ${valid ? 'badge-success' : 'badge-warning'}`;
  $('typing-status').textContent = valid ? 'Complete' : completed.failed ? 'Failed' : 'Interrupted';

  // Lessons keep their own progress and never enter runs, traces or bests.
  if (practice.sessionKind === 'lesson') {
    finishLesson(completed, valid);
    saveRunCounts();

    return;
  }

  const saved = storeAttempt(completed);

  // A drill the correction setting failed shows its result like any failed run, so it can be tried
  // again; a finished or interrupted drill goes straight on to the retest.
  if (practice.sessionKind === 'drill' && baselineAttempt && trainingContext?.retest !== false && !completed.failed) {
    if (trainingContext) trainingContext.drillCompleted = valid;

    // Train already offers this retest: startDrill() rendered its actions.
    if (replacing) return;
    announce(valid ? 'Drill complete. Retest ready.' : 'Drill interrupted. Retest ready.');
    startRetest();

    return;
  }

  if (practice.sessionKind === 'practice' || practice.sessionKind === 'daily') {
    // A code run is never a baseline, so it drops the earlier one rather than retest against it. An
    // adaptive run is drill-kind: it leaves the baseline as it was.
    if (completed.conditions?.mode === 'code') {
      baselineAttempt = null;
      trainingContext = null;
    } else if (valid && !completed.adaptive) {
      // Familiar text flatters the score, so a repeated passage can't be the baseline for a fresh retest.
      baselineAttempt = completed.fresh === false ? null : completed;
      trainingContext = null;
    }
  }

  renderResults(completed, saved);

  // A retest's result is its comparison, on Train, and its card waits behind Back to practice; every
  // other run's result stays on Practice.
  if (practice.sessionKind === 'retest') {
    switchView('train');
    renderComparison(baselineAttempt, completed, saved);
    // The passage may have scrolled the page; Train opens at its top.
    scrollTo(0, 0);
    $('comparison-status').focus({ preventScroll: true });

    return;
  }

  if (practice.sessionKind === 'challenge') {
    // Touch and physical-keyboard runs are never compared, so only the sender's kind of input is sent.
    const sameInput = inputOf(completed.conditions) === inputOf(ghostRace.conditions);
    ghostRace.run = completed;
    ghostRace.trace = valid && sameInput ? encodeTrace(completed) : null;
    ghostRace.state = !valid ? 'interrupted' : !sameInput ? 'other-input' : ghostRace.own && ghostRace.trace ? 'own' : ghostRace.trace ? 'sending'
      : traceTrouble(completed) === 'character' ? 'unreplayable' : 'unsendable';
    renderGhostResult();

    // Your own recording goes nowhere: the result is this replay.
    if (ghostRace.trace && !ghostRace.own) submitGhostRun();
    else announce(`${$('ghost-result-heading').textContent} ${$('ghost-result-status').textContent}`);
  }

  switchView('results');
  renderCard(completed);
  focusResult($(failedDrill(completed) ? 'result-drill' : 'run-again'));
  // Every run a minimum ends gets the hold, wherever it was caught: the tick, the last character or
  // the timer.
  stopHold = completed.stopped ? now() : null;
}

// The next step takes focus when it fits on screen below the score, clear of the dock; otherwise the
// heading does, so the score never scrolls away. The page then shows as much around the focused step
// as fits with the score: the whole card with its margin, else the whole action row, else the step alone
// (so the card never rests on the bottom edge, and the other actions never hide behind a phone's dock).
function focusResult(control) {
  const root = getComputedStyle(document.documentElement);
  const room = innerHeight - (parseFloat(root.scrollPaddingTop) || 0) - (parseFloat(root.scrollPaddingBottom) || 0);
  const scoreTop = $('result-wpm').getBoundingClientRect().top;
  const fits = (node, from = scoreTop) => node.getBoundingClientRect().bottom + (parseFloat(getComputedStyle(node).scrollMarginBottom) || 0) - from <= room;
  const card = $('run-card');
  const target = fits(control) ? control : $('results-heading');
  const row = control.closest('.result-actions');
  const widest = fits(card, card.getBoundingClientRect().top) ? card : fits(row) ? row : control;

  target.focus({ preventScroll: true });
  (target === control ? widest : target).scrollIntoView({ block: 'nearest' });
}

// Draw after the results view is shown so the graph has its size.
function renderCard(completed) {
  if (rateShown(completed)) renderSpeedGraph($('speed-graph'), completed, { animate: true });
}

// Offer the words this run tripped on or was slowest through as their own uncounted run.
// Only an evidence run is mined for words, by the same rule as recurring patterns: a complete test,
// retest or daily run on fresh text. Not a drill (synthetic, target-heavy text), repeated text (a daily
// passage shown before, a repeated quote), custom text or word practice itself. Run again repeats a word-practice passage.

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
  const { words } = recurringMissedWords(learning.profile.runs);

  if (words.length < 2) return;
  baselineAttempt ||= retainedBaseline();
  startWordPractice(words.map((item) => item.word), { recurring: true });
}

function resultHeadline(completed) {
  if (completed.failed) return `failed · ${completed.failed}`;

  if (completed.status !== 'complete') return completed.stopped?.atEnd ? 'Under your minimum · not counted' : 'Interrupted · not counted';

  if (completed.adaptive) return 'Adaptive run · not counted toward your best';

  if (completed.kind === 'drill') return 'Drill complete · not counted toward your best';

  if (completed.kind === 'challenge') return 'Ghost race complete · not counted toward your best';

  if (completed.kind === 'missed') return 'Word practice complete · not counted toward your best';

  if (completed.kind === 'custom') return 'Custom text complete · not counted toward your best';

  if (completed.conditions?.mode === 'code') return 'Code run complete · not counted toward your best';

  if (completed.kind === 'daily') return completed.firstDailyAttempt ? 'Daily challenge complete' : 'Daily challenge complete · repeat attempt';

  if (completed.fresh === false) {
    // A repeat chases its own passage, never the personal best.
    if (!recording.passageBefore) return 'Repeated text · not counted toward your best';
    const before = recording.passageBefore.score.wpm;
    const change = completed.summary.score.wpm - before;

    return change === 0 ? ['Repeated text · matched your best of ', speedFigure(before), ' on this passage']
      : ['Repeated text · ', speedFigure(change, { bare: true, signed: true }), ' vs your best of ', speedFigure(before), ' on this passage'];
  }

  if (!recording.bestBefore) return 'First run at these settings';
  const delta = completed.summary.score.wpm - recording.bestBefore.wpm;

  if (delta === 0) return ['Matched your best of ', speedFigure(recording.bestBefore.wpm)];

  return [speedFigure(delta, { bare: true, signed: true }), ' vs your best of ', speedFigure(recording.bestBefore.wpm)];
}

// Code runs never become retest baselines, so a drill at code settings always stands alone.
const CODE_DRILL_NOTE = 'A standalone drill. Code runs have no fresh-text retest.';

// Records the run the results view now shows; Watch replay appears only when it has a trace. A custom run
// (any non-comparable kind) keeps no trace, so, as with its best, it offers no replay.
function showResult(completed) {
  practice.shownResult = completed;

  if (!completed) flushSync(() => practice.result.publish(null));
}

function renderResults(completed, saved) {
  const replay = completed.summary;
  const counted = completed.status === 'complete';
  showResult(completed);
  const speed = rateShown(completed) ? formatSpeed(replay.score.wpm) : 'Too quick to time';
  const repeated = repeatedResult(completed);
  const stopped = completed.stopped ? stopReason(completed.stopped) : '';
  const uncounted = counted ? '' : completed.failed ? 'The correction setting ended this run, so it isn’t counted.' : stopped ? [stopped, ', so it isn’t counted.'] : 'Focus or input changed during the run, so it isn’t counted.';
  const unsaved = saved || practice.sessionKind === 'retest' ? '' : 'Couldn’t save on this device.';
  const chars = characterBreakdown(completed, replay);
  const errors = replay.firstAttempts.filter((item) => !item.correct).length;
  const recent = trendRun(completed) ? trendRunsAt(conditionKey(completed.conditions)).slice(-10) : [];
  const best = learning.profile.bests[conditionKey(completed.conditions)]?.wpm;
  const mined = evidenceRun(completed);
  const { missed, slow } = mined ? missedAndSlowWords(completed) : { missed: [], slow: [] };
  const words = [...missed, ...slow.map((item) => item.word)];
  practice.commands.practiceWords = () => { baselineAttempt = completed; startWordPractice(words); };

  flushSync(() => practice.result.publish({
    id: completed.id, counted, wpm: rateShown(completed) ? replay.score.wpm : null,
    accuracy: replay.score.accuracy, seconds: (replay.elapsedMs / 1000).toFixed(1),
    consistency: consistency(completed, replay) ?? null,
    accuracyTitle: plural(errors, 'first-try error') + ' · final c/i/e/m ' + chars.correct + '/' + chars.incorrect + '/' + chars.extra + '/' + chars.missed,
    standing: recent.length < 2 || !best ? [] : copyParts(['average ', speedFigure(meanWpm(recent), { bare: true, whole: true }), ' · best ', speedFigure(best, { bare: true, whole: true })]),
    headline: copyParts(resultHeadline(completed)), conditions: copyParts(describeRun(completed)),
    note: copyParts([uncounted, uncounted && unsaved ? ' ' : '', unsaved]),
    words: wordHistory(completed, replay).map((item) => ({ ...item, wpm: rateShown(completed) ? item.wpm : null })),
    practiceWords: words, drillLabel: '',
    againLabel: practice.sessionKind === 'daily' ? 'Try daily again' : counted && completed.conditions?.mode === 'book' && completed.kind !== 'drill' ? 'Next page' : 'Run again',
    replay: Boolean(completed.events?.length) && comparableKind(completed.kind), graph: rateShown(completed),
  }));
  renderResultDrill(completed);
  renderDaily();
  const failure = completed.failed ? (completed.kind === 'drill' ? 'Drill' : 'Run') + ' failed, ' + completed.failed + '. ' : stopped ? plain(stopped) + '. ' : '';
  $('ghost-result').hidden = completed.kind !== 'challenge';
  renderGhostOffer(completed);
  announce([failure + speed + ', ' + replay.score.accuracy + '% accuracy.',
    repeated ? 'Repeated text, not counted toward your best.' : '',
    saved ? '' : 'Couldn’t save on this device.'].filter(Boolean).join(' '));
}

// A counted practice run on repeated text: saved and listed, never a best, trend or retest baseline.
const repeatedResult = (completed) => completed?.status === 'complete' && completed.kind === 'test' && completed.fresh === false;

// The result's second action. After a counted run it starts the drill and retest loop for what the recommender
// names now at the run's conditions, under the training settings in use, and drills what it names; after a
// failed drill, that drill again; after an adaptive run, a fresh-text retest against the newest normal run at these
// conditions, or a plain test when there is none. Custom text and ghost races are never mined for targets
// or kept as a baseline, so they offer neither. Word practice isn't compared either, but like a drill it
// leads on to a retest of the run its words came from.
function renderResultDrill(completed) {
  const counted = completed.status === 'complete';
  const compared = comparableKind(completed.kind) || completed.kind === 'missed';
  let label = '';

  if (completed.adaptive) {
    label = baselineFor(completed.conditions) ? 'Retest on fresh text' : 'Retest';
    practice.commands.drill = startAdaptiveRetest;
  } else if (compared && (counted || failedDrill(completed))) {
    const again = failedDrill(completed) ? trainingContext?.recommendation : null;
    const recommendation = again || trainingRecommendation(completed.conditions, failedDrill(completed) ? null : completed);
    const { target } = recommendation;
    label = failedDrill(completed) ? 'Try drill again' : target ? 'Drill “' + target + '”' : learning.preferences.retest ? 'Drill and retest' : 'Drill';
    practice.commands.drill = () => startDrill(recommendation);
  }

  const current = practice.result.getSnapshot();

  if (current) flushSync(() => practice.result.publish({ ...current, drillLabel: label }));
}

const COMPARISON_HEADINGS = {
  improved: 'The retest was stronger.',
  mixed: 'A mixed result.',
  regressed: 'The retest was lower.',
  steady: 'Level with your baseline.',
};

// Train after a retest: the step just retested moves behind you, and its comparison is that step: the outcome, then
// the trained unit's misses or pace, accuracy and speed beside the baseline's, the text they were measured on, and any
// caveat. `trained` is the unit, or null for a drill that named none; `source` the retest's conditions, or null when no
// fair retest ran. The path opens the next step at those conditions, as the comparison's Next always did.
function showComparison(heading, outcome, trained = null, source = null) {
  updateComparison({ heading, outcome, unit: trained || { adaptive: 'Adaptive', general: 'General drill' }[trainingContext?.recommendationKind] || 'Retest' });
  trainAfter = { trained, source };
  renderTrain({ advance: true });
}

function renderComparison(before, after, saved) {
  const comparison = compareAttempts(before, after);
  const trainedTarget = trainingContext?.target || selectedTarget;
  updateComparison({ compared: comparison.comparable });
  showComparison(comparison.comparable ? COMPARISON_HEADINGS[comparison.state] : 'Retest complete.', comparison.comparable ? comparison.state : 'unavailable',
    trainedTarget || null, after.conditions);

  // No comparison means none of its numbers: a retest that isn't compared (stopped under a minimum,
  // interrupted, other conditions or repeated text) says why instead. No baseline: a clear from another
  // tab or device removed it while this retest was under way.
  if (!comparison.comparable) {
    const reason = before ? comparison.reason : 'Your history was cleared, so there is no baseline to compare with.';
    updateComparison({ conditions: '', caveat: reason + (saved ? '' : ' Couldn’t save on this device.') });
    renderHistory();

    return;
  }

  const beforePattern = summarizePatterns([before]).pairs.find((item) => item.pair === trainedTarget);
  const afterPattern = summarizePatterns([after]).pairs.find((item) => item.pair === trainedTarget);
  // The target's misses on the retest, a pair's or a key's, beside the evidence the drill was chosen on (or,
  // for a target picked by hand, the baseline run's). A pair chosen for its slowness reads back its pace: the
  // retest's clean intervals against the runs it was chosen on.
  const now = firstTriesAt(after, trainedTarget);
  const was = trainingContext?.was || firstTriesAt(before, trainedTarget);

  const pace = was?.basis === 'slow' && afterPattern?.timings.length && afterPattern.slowdownMs !== null
    ? { target: trainedTarget, was: { slowMs: was.slowMs, timed: was.timed, timedRuns: was.timedRuns, slowRuns: was.slowRuns },
      now: { slowMs: afterPattern.slowdownMs, timed: afterPattern.timings.length } } : null;

  const target = was?.basis === 'slow' ? pace ? {
    label: trainedTarget + ' pace', value: paceShift(pace.now.slowMs),
    was: 'over ' + plural(pace.now.timed, 'interval') + ', was ' + paceShift(pace.was.slowMs) + ' over ' + pace.was.timed,
  } : null : now && was ? { label: trainedTarget + ' missed', value: missedCopy(now), was: 'was ' + missedCopy(was) } : null;

  const parts = conditionParts(after.conditions);
  updateComparison({ target, accuracy: after.summary.score.accuracy, accuracyDelta: signed(comparison.accuracyDelta, 'pp'),
    wpm: after.summary.score.wpm, wpmDelta: comparison.wpmDelta, conditions: ['fresh text', parts.language, parts.length].join(' · ') });
  const enoughTiming = beforePattern?.timings.length >= 10 && afterPattern?.timings.length >= 10;

  // A key has no timing of its own.
  const timingSummary = trainedTarget?.length === 1 ? null : { target: trainedTarget, beforeCount: beforePattern?.timings.length || 0,
    afterCount: afterPattern?.timings.length || 0, deltaMs: enoughTiming ? afterPattern.medianMs - beforePattern.medianMs : null };

  let comparisonSaved = saved;

  if (saved) {
    learning.profile.loops.push({
      id: uid(),
      at: new Date().toISOString(),
      beforeAttemptId: before.id,
      afterAttemptId: after.id,
      target: selectedTarget,
      recommendationKind: trainingContext?.recommendationKind || 'manual',
      // Which policy and version ranked the target (learner-decay-timing@1, counting@1), or null when it was typed
      // by hand or drilled again from a past loop.
      policy: trainingContext?.policy ?? null,
      // The training focus it was ranked for (balanced, accuracy, speed), beside the policy.
      focus: trainingContext?.focus ?? null,
      // What the target was named for, so a slow pair reads back pace even when the retest timed none of it.
      targetBasis: trainedTarget ? (was?.basis === 'slow' ? 'slow' : 'errors') : null,
      drillCompleted: Boolean(trainingContext?.drillCompleted),
      conditions: after.conditions,
      comparison,
      targetTiming: timingSummary,
      targetMisses: now && was && was.basis !== 'slow' ? { target: trainedTarget, was: { errors: was.errors, observations: was.observations }, now } : null,
      targetPace: pace,
      drill: trainingContext?.drill || null,
    });
    comparisonSaved = saveProfile();
  }

  updateComparison({ caveat: comparisonSaved ? '' : 'Couldn’t save on this device.' });
  renderHistory();
}

// The baseline for a fresh-text retest at `source` conditions: this tab's, when it matches, else the newest
// retained run. Adaptive runs are drill-kind and never one.
function baselineFor(source) {
  const key = conditionKey(source);

  return baselineAttempt?.status === 'complete' && !baselineAttempt.adaptive && conditionKey(baselineAttempt.conditions) === key
    ? baselineAttempt : retainedBaseline(source);
}

// After an adaptive run: a fresh-text retest against the newest normal run at the same conditions, or,
// with none, a plain test that can become the next baseline.
function startAdaptiveRetest() {
  const baseline = baselineFor(practice.shownResult.conditions);

  if (!baseline) {
    plainNext = true;
    resetSession('practice', { focus: true });

    return;
  }

  baselineAttempt = baseline;
  selectedTarget = null;
  trainingContext = { target: null, recommendationKind: 'adaptive', policy: DEFAULT_POLICY, focus: practice.shownResult.trainFocus || learning.preferences.trainFocus, baselineAttemptId: baseline.id, drillCompleted: false };
  startRetest();
}

// What Train shows while a retest's comparison is up: the unit just retested and the retest's conditions (see
// showComparison). Null otherwise; opening Train from the dock draws the path afresh.
let trainAfter = null;

// Train: the path (src/train-path.js) at the current conditions, or after a retest at the retest's. Behind you, the
// targets you have drilled; open, the drill the learner names (the results card's Drill and Patterns across runs
// name the same), or after a retest the next one it queues; ahead, the next three. `advance` moves the path on by
// one step, once, as a retest's comparison opens. `fresh` draws it as Train opens, scrolled to its end; otherwise a
// redraw keeps the reader's place (drawPath).
function renderTrain({ advance = false, fresh = false } = {}) {
  const after = trainAfter;
  const source = after?.source || conditions();
  const recommendation = trainingRecommendation(source);
  const path = trainPath({ recommendation, loops: learning.profile.loops, runs: learning.profile.runs, keyboard: keyboardOf(source), after });
  const { current } = path;
  const baseline = baselineFor(source);
  const named = current.kind === 'targeted';
  const next = Boolean(after && named);
  const retests = learning.preferences.retest && baseline && !layoutMismatch(baseline.conditions);
  learning.commands.next = () => practiceTarget(current.unit, source, recommendation);
  learning.commands.target = (unit) => practiceTarget(unit, source, recommendation);
  learning.commands.start = () => {
    baselineAttempt = baseline;
    startDrill(after ? { ...recommendation, kind: 'general', target: null, title: current.title, was: null } : recommendation);
  };

  const length = retests ? conditionParts(baseline.conditions).length : '';
  const since = sinceCopy(current.since);
  const previous = learning.train.getSnapshot();
  flushSync(() => learning.train.publish({
    path, named, next, hasComparison: Boolean(after),
    startLabel: named ? 'Drill “' + current.unit + '”' : retests ? 'Drill and retest' : 'Drill',
    starts: learning.preferences.drillSeconds + ' s' + (length ? ', then ' + (baseline.conditions.mode === 'quote' ? 'a ' : '') + length + ' on fresh text' : ''),
    words: named && current.was?.basis !== 'slow' ? evidenceWords(current.unit, source) : [],
    evidence: named ? evidenceCopy(current.was, { all: Boolean(since) }) : '', since,
    fresh, advance, revision: (previous?.revision ?? 0) + 1,
  }));
}

// A figure keeps its number with its unit, and the first half of a before → after pair keeps its arrow, so the pair
// breaks only between its halves: "70 ms slower → 20 ms faster" never leaves "ms faster" on a line of its own. The
// text itself is the copy, unchanged.

// The steps around the comparison and the open step. Phones show the two newest steps behind you; wider screens
// scroll the line back through all of them. Progress keeps every drill either way.

// The line takes keyboard focus only while it scrolls, so its arrow keys reach the steps that don't fit. An edge fades
// while more of the line lies past it, so steps behind you scrolled off the start show there are more.
function scrollablePath() {
  const list = $('train-path');

  if (list.scrollWidth > list.clientWidth + 1) list.tabIndex = 0;
  else list.removeAttribute('tabindex');
  pathEdges();
}

function pathEdges() {
  const list = $('train-path');
  list.toggleAttribute('data-more-behind', list.scrollLeft > 1);
  list.toggleAttribute('data-more-ahead', list.scrollLeft < list.scrollWidth - list.clientWidth - 1);
}

// Words this person missed on the first try that hold the target, newest first, from the runs the
// recommendation reads: every measured run on this keyboard.
function evidenceWords(target, source) {
  const keyboard = keyboardOf(source);
  const words = [];

  for (const run of [...learning.profile.runs].reverse()) {
    if (!evidenceRun(run) || keyboardOf(run.conditions) !== keyboard) continue;

    for (const word of run.missedWords || []) {
      const bare = word.toLowerCase().replace(/[^a-z]/g, '');

      if (bare.includes(target) && !words.includes(bare)) words.push(bare);

      if (words.length === 6) return words;
    }
  }

  return words;
}

// A drill of what `recommendation` names, then the retest unless the retest setting is off. The drill keeps the
// recommendation, its length and the retest setting it started with.
function startDrill(recommendation) {
  selectedTarget = recommendation.target || null;
  const mismatch = baselineAttempt ? layoutMismatch(baselineAttempt.conditions) : "";

  if (mismatch) baselineAttempt = null;
  const source = baselineAttempt?.conditions;

  if (source) restoreConditions(source);
  trainingContext = { recommendation, target: selectedTarget, recommendationKind: recommendation.kind, policy: recommendation.policy || null,
    focus: recommendation.focus || null, baselineAttemptId: baselineAttempt?.id || null, drillCompleted: false, was: recommendation.was || null,
    retest: learning.preferences.retest };
  const drill = drillPassage();
  trainingContext.drill = { target: selectedTarget, duration: learning.preferences.drillSeconds, wordList: learning.preferences.wordList, textVersion: drill.textVersion };

  if (drill.lean) trainingContext.drill.lean = drill.lean;
  showManualTarget(false);
  resetSession('drill', { focus: true });

  // With no baseline, or the retest off, nothing follows the drill, so it says so where the drill describes itself.
  if (!baselineAttempt || !learning.preferences.retest) $('session-description').textContent = learning.preferences.mode === 'code' ? CODE_DRILL_NOTE : `Standalone drill.${mismatch ? ` ${mismatch}` : ''}`;
}

function startRetest() {
  if (!baselineAttempt || baselineAttempt.status !== 'complete') return;
  const source = baselineAttempt.conditions;
  const mismatch = layoutMismatch(source);

  if (mismatch) {
    showUnavailableRetest(mismatch);

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

  if (source?.inputClass === 'touch' || layout === learning.preferences.layout) return '';

  return `The baseline was typed on ${layoutLabel(layout)}. Switch the keyboard layout back to ${layoutLabel(layout)} to retest it.`;
}

// A drill or retest runs at its baseline's conditions without recording them as a settings edit: the
// saved settings, including a pick from another tab or device made meanwhile, apply again once it ends
// (resetSession leaves them waiting), and a restore never outranks a choice someone made.
// Only what the source's mode varies is restored: fields a mode fixes in conditions() (code's and a book's
// punctuation, numbers and word list; quote's numbers) keep the person's own prose settings.
function restoreConditions(source) {
  commitPreferences();
  const fixedPunctuation = ['code', 'book'].includes(source.mode);
  const prose = !['quote', 'code', 'book'].includes(source.mode);

  // The standard recipe carries its own settings; restoring it must not overwrite the person's.
  if (source.mode === 'standard') learning.preferences = { ...learning.preferences, mode: 'standard' };
  else learning.preferences = {
    ...learning.preferences,
    mode: source.mode,
    duration: source.duration || learning.preferences.duration,
    count: source.count || learning.preferences.count,
    punctuation: fixedPunctuation ? learning.preferences.punctuation : Boolean(source.punctuation),
    numbers: prose ? Boolean(source.numbers) : learning.preferences.numbers,
    quoteLength: source.quoteLength || learning.preferences.quoteLength,
    difficulty: source.difficulty || learning.preferences.difficulty,
    wordList: source.wordList || learning.preferences.wordList,
    codeLanguage: source.codeLanguage || learning.preferences.codeLanguage,
    book: source.book || learning.preferences.book,
    correction: correctionPreference({ correction: source.correctionPolicy, stopOnError: source.correctionPolicy !== 'relaxed' }),
    stopOnError: source.correctionPolicy === 'mandatory',
  };
  learning.livePreferences = JSON.stringify(learning.preferences);
  applyPreferences();
  setModeControls();
}

// "results" is the practice screen showing a finished run in place of the passage.
function switchView(view) {
  quoteFilters.dismiss();
  const previous = document.body.dataset.view;

  // Progress opens on its overview whenever it is opened from elsewhere.
  if (view === 'progress' && document.body.dataset.view !== 'progress') Object.assign(progressState, { detail: '', moversOpen: false });
  document.body.dataset.view = view;
  const shown = view === 'results' ? 'practice' : view;
  document.querySelectorAll('[data-screen]').forEach((screen) => { screen.hidden = screen.dataset.screen !== shown; });
  document.querySelectorAll('[data-nav]').forEach((control) => {
    const active = control.dataset.nav === shown;
    control.classList.toggle('is-active', active);

    if (active) control.setAttribute('aria-current', 'page');
    else control.removeAttribute('aria-current');
  });
  setRunning(false);
  syncRules();
  // Pills in a hidden screen measured zero width; remeasure every group now it is visible.
  updateGlides();

  if (view === 'progress') renderHistory();
  // Challenge opens on its people list, unless a one-keyboard race is being typed there.
  onlineRace?.onViewChange(view, { keep: previous === 'compete' && raceUnderWay() });

  // Opened from anywhere, Train draws the path afresh; a retest's comparison draws it once more as it opens.
  if (view === 'train') {
    trainAfter = null;
    renderTrain({ fresh: true });
  }

  if (view === 'compete') renderDaily();

  if (view === 'learn') renderLessons();
}

// `keep` is for the ways back to Practice that show it as it stands: the dock, the palette's "practice" and focus mode.
// They keep a drill or retest nobody has started, Train's work waiting, when Practice is shown from another screen
// (TOB-448); Practice pressed on Practice still leaves it for practice. Everything else that goes to Practice does so
// to start what was asked for (a length, a word list, custom text), so it leaves a waiting drill or retest, as before.
function navigate(view, { keep = false } = {}) {
  if (view === 'practice') {
    // A custom passage that is ready or under way is practice too, so going to Practice keeps it. An unstarted
    // repeat that repeats-off would replace is redrawn.
    const waitingTraining = keep && document.body.dataset.view !== 'practice' && practice.attempt?.status === 'ready' && (practice.sessionKind === 'drill' || practice.sessionKind === 'retest');
    const current = practice.attempt && (practice.sessionKind === 'practice' || practice.sessionKind === 'custom' || waitingTraining) && !['complete', 'interrupted'].includes(practice.attempt.status);
    // A waiting passage is rebuilt, as the same kind, if strict space or quick end changed while another screen showed.
    const staleRules = current && inputRules(practice.attempt.conditions).join() !== inputRules(sessionConditions(practice.sessionKind)).join();

    if (!current || staleRepeat() || staleAdaptive() || (preferencesWaiting && untouchedPractice())) resetSession('practice');
    else if (staleRules) resetSession(practice.sessionKind);
    switchView('practice');

    return;
  }

  // Leaving mid-drill draws no retest passage to throw away.
  if (practice.attempt?.status === 'running' && view !== 'practice') {
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
  typingHost.forget('primary');
  // A timed run past its limit (its finish can wait for a commit made in time) is over, not interrupted.
  finishIfTimeUp();

  if (practice.attempt?.status !== 'running' || practice.attempt.interrupted) return;
  practice.attempt.interrupted = true;
  practice.attempt.events.push({ type: 'focus-lost', offsetMs: offsetFor() });
  $('typing-status').className = 'badge badge-warning';
  $('typing-status').textContent = 'Interrupted';
  showInputNotice('primary', message, { sticky: true });
}

function markRaceInterrupted() {
  typingHost.forget('race');

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
    option.textContent = describeConditions(value, [...groups.values()]);

    return option;
  }));

  if (groups.has(prior)) select.value = prior;
  select.disabled = !groups.size;

  return groups.get(select.value);
}

// Consistency and the static words list. Display only. The card shows no first-try errors or character
// breakdown; accuracy's tooltip keeps both, since accuracy is counted from them.

// Counted runs on fresh text at one set of conditions, oldest first: what the pace caret and the run
// card average.
function trendRunsAt(key) {
  return filterRuns(learning.profile.runs.filter(trendRun), key).filter((run) => run.score?.wpm);
}

function meanWpm(runs) {
  return Math.round(runs.reduce((sum, run) => sum + run.score.wpm, 0) / runs.length);
}

// Under the facts: the average of the last ten counted runs at these conditions (the pace caret's
// average) and the best. Only after a counted run with one before it at the same conditions.

// Words reached: one tab stop. Arrow keys, Home and End move between words, and focus or a tap
// shows that word's pace in the line below, so the numbers never depend on a hover tooltip.


// Each word's pace in the chosen unit. A unit change relabels the list in place, keeping the selection.
function labelWords() {
  const result = practice.result.getSnapshot();

  if (result) flushSync(() => practice.result.publish({ ...result }));
}

// Before any choice the first word is the tab stop and the line below stays empty.




function dateCopy(at) {
  return at ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Earlier run · date unavailable';
}

function openHistoryRun(id) {
  if (progressState.detail !== 'runs') openProgressDetail('runs', { opener: document.activeElement, focus: false });
  const find = () => [...$('run-history').children].find((item) => item.dataset.runId === id);

  if (!find() && listedRuns.some((run) => run.id === id)) showAllRuns();
  const row = find();

  if (row) { row.open = true; row.scrollIntoView({ block: 'center', behavior: 'instant' }); row.querySelector('summary').focus(); }
}

function targetButton(target, source, ranked) {
  const button = element('button', `Practice “${target}” again`, 'btn btn-secondary');
  button.type = 'button';
  button.addEventListener('click', () => practiceTarget(target, source, ranked), { signal: lifetime.signal });

  return button;
}

// The newest retained run that can anchor a fresh-text retest, at `source` conditions when given.
// Older corpus or standard recipe versions need a new baseline; a code run is never one.
function retainedBaseline(source = null) {
  return [...learning.profile.attempts].reverse().find((a) => {
    const wanted = source || a.conditions;

    return a.status === 'complete' && !a.interrupted && ['test', 'retest', 'daily'].includes(a.kind) && a.fresh !== false
      && a.conditions?.mode !== 'code'
      && (!source || conditionKey(a.conditions) === conditionKey(source)) && wanted.corpus === CORPUS_VERSION
      && (wanted.mode !== 'standard' || wanted.recipe === STANDARD_VERSION);
  }) || null;
}

// A drill on a target picked from a list. Patterns across runs and the comparison's Next pass the recommendation
// whose queue they show, so the loop records the policy and focus that queued it; a past loop's target was picked
// by hand. Either way the drill brings the counts the learner queues it on, which the comparison reads back.
function practiceTarget(target, source, ranked = null) {
  baselineAttempt = retainedBaseline({ ...source, layout: inputLayout(source.inputClass) });
  restoreConditions({ ...source, corpus: CORPUS_VERSION });
  const was = (ranked || trainingRecommendation(source)).queue.find((item) => item.unit === target)?.was ?? null;
  startDrill({ kind: 'manual', target, title: `Practice “${target}”`, was, policy: ranked?.policy ?? null, focus: ranked?.focus ?? null });
}

// The recommender's pick for `source` conditions. The run just finished always counts toward its own
// recommendation: its summary is saved even when its trace was too large to keep (the counting rule reads traces).
function trainingRecommendation(source, current = null) {
  const traces = current && !learning.profile.attempts.includes(current) ? [...learning.profile.attempts, current] : learning.profile.attempts;

  return recommendFor(DEFAULT_POLICY, { runs: learning.profile.runs, loops: learning.profile.loops, traces, source, now: Date.now(), focus: learning.preferences.trainFocus });
}

// A drill's text: the target's words, or, for a general drill with units ranked for it, words leaning
// toward them.
function drillPassage() {
  return makeDrill(selectedTarget, learning.preferences.wordList, trainingContext?.recommendation?.lean || []);
}

// Patterns across runs: the learner's queue at the chosen conditions' keyboard, as Train reads it, each unit with
// its observed evidence and its last drill. Redrawn under someone using it, focus stays on the row for the same unit,
// or the first row when that one is gone.
function renderTraining() {
  const list = $('training-targets');
  const hadUnit = list.contains(document.activeElement) ? document.activeElement.closest('[data-unit]')?.dataset.unit : undefined;

  const source = conditionOptions($('training-conditions'), learning.profile.runs.filter((r) => validRun(r)
    && ['test', 'retest', 'daily'].includes(r.kind)), conditions());

  const recommendation = trainingRecommendation(source);
  const { queue } = recommendation;
  $('training-memory-note').textContent = queue.length ? '' : 'Not enough evidence yet.';
  list.replaceChildren(...queue.slice(0, 8).map(({ unit, was }) => {
    const row = element('article', '', 'training-target');
    row.dataset.unit = unit;
    const copy = document.createElement('div');
    copy.append(element('h3', `Practice “${unit}”`), element('p', evidenceCopy(was)));
    const loop = [...learning.profile.loops].reverse().find((item) => item.target === unit && keyboardOf(item.conditions) === keyboardOf(source));

    if (loop) copy.append(element('p', `Last practiced ${dateCopy(loop.at)}. Last retest: ${loop.comparison.state}.`));
    row.append(copy, targetButton(unit, source, recommendation));

    return row;
  }));

  if (hadUnit !== undefined) (list.querySelector(`[data-unit="${CSS.escape(hadUnit)}"] button`) || list.querySelector('button') || $('training-conditions')).focus({ preventScroll: true });
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// Progress headline: the current standard recipe at one input class (standardInputClass decides), so
// one touch run can't replace a keyboard score. The other class's best is named in the note.
function renderStandardScore() {
  const scoreFor = (inputClass) => {
    const key = conditionKey({ ...standardConditions(inputClass), layout: inputLayout(inputClass) });

    return standardScore(learning.profile.runs, key, learning.profile.bests[key]?.wpm ?? null);
  };

  const keyboard = scoreFor('physical-keyboard');
  const touch = scoreFor('touch');
  const onTouch = standardInputClass(keyboard, touch) === 'touch';
  const sourceInput = onTouch ? 'touch' : 'physical-keyboard';
  const source = { ...standardConditions(sourceInput), layout: inputLayout(sourceInput) };
  const score = onTouch ? touch : keyboard;
  const other = onTouch ? keyboard : touch;
  // Bests outlive run summaries, so counts are of kept runs, never lifetime counts, and a best above every
  // kept run came from one that has aged out of the kept history. With none left, nothing is counted.
  const kept = MAX_RUN_SUMMARIES.toLocaleString('en-US');
  const keptBest = standardScore(learning.profile.runs, conditionKey(source)).best;
  const olderBest = score.total && score.best > keptBest ? ` Your best comes from a run older than the newest ${kept} runs that Progress keeps.` : '';
  let note = `${plural(score.total, 'completed standard run')} kept.${olderBest}`;

  if (!score.total && score.best !== null) note = `Your best is kept, but your standard runs are older than the newest ${kept} runs that Progress keeps, so the median waits for ${STANDARD_MIN_RUNS} new ones.`;
  else if (!score.total) note = 'No standard runs yet.';
  else if (!score.settled) note = `${plural(score.total, 'standard run')} kept.${olderBest} The median appears after ${STANDARD_MIN_RUNS}.`;
  // With nothing scored yet, the recipe is what Take the standard test sets up, so it isn't repeated here.
  const empty = !score.total && score.best === null;
  flushSync(() => learning.progress.standard.publish({ best: score.best, median: score.median,
    medianLabel: score.settled ? 'median of last ' + plural(score.recent, 'run') : 'median', conditions: recipeSummary(source) + ' · ' + conditionTail(source), empty,
    note: copyParts([note, other.best === null ? '' : [' Your ' + (onTouch ? 'physical keyboard' : 'touch') + ' best is ', speedFigure(other.best), '.']]) }));
}

// Static heatmap: coral steps by first-attempt miss rate; thin evidence stays neutral.
// One tab stop: arrow keys move between keys as drawn, and focus or a click shows that key's numbers
// in the line below, so the values never depend on a hover tooltip. Ten keys in a phone-width row
// cannot each be a 44px touch target, so on coarse pointers the heatmap is a picture and a native
// "Key" select drives the same line.
const coarsePointer = window.matchMedia('(pointer: coarse)');
let heatRuns = [];

function renderKeys(runs) { heatRuns = runs; learning.progress.keys.show(runs, coarsePointer.matches); }

// Marks one key as chosen (and, in the grid, the tab stop) and shows its numbers; with no key
// chosen yet, "q" is the stop.

// The practice calendar (Sunday-first columns), static by design: 26 weeks across the column, fewer on a phone.
// The calendar is one tab stop: each day is a labelled cell, and the arrow keys move between them as drawn.
// Goal-met days carry a dot as well as the green step, and the caption under the calendar repeats the
// focused or hovered day's label for sighted users (it is aria-hidden; the cell's own label is announced).
let goalDay = '';

// The day the Progress page was last drawn for (renderHistory).
let historyDay = '';

const narrowColumn = window.matchMedia('(max-width: 760px)');
const calendarWeeks = () => (narrowColumn.matches ? 17 : 26);

function renderGoal(date = new Date()) {
  goalDay = dayKey(date);
  const byDay = minutesByDay(learning.profile.runs, learning.profile.practiceDays);
  const coarse = matchMedia('(any-pointer: coarse)').matches;
  $('practice-goal').hidden = Object.keys(byDay).length === 0;
  const goal = learning.preferences.dailyGoal;
  const weeks = calendarWeeks();
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - (weeks - 1) * 7 - date.getDay());
  const days = [];

  for (const day = new Date(start); day <= date; day.setDate(day.getDate() + 1)) {
    const minutes = byDay[dayKey(day)] || 0;
    const met = goal > 0 && minutes >= goal;
    days.push({ day: dayKey(day), level: String(practiceLevel(minutes, goal)), met,
      label: day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + ': ' + goalMinutes(minutes) + ' min' + (met ? ', goal met' : ''),
      caption: [day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), goalMinutes(minutes) + ' min', met && 'goal met'].filter(Boolean).join(' · ') });
  }

  const practised = days.filter((day) => day.level !== '0').length;
  flushSync(() => learning.progress.calendar.view.publish({ days, months: monthLabels(days.map((day) => day.day)), weeks, coarse, today: goalDay,
    label: 'Practice minutes per day, last ' + weeks + ' weeks: ' + plural(practised, 'day') + ' with practice. Arrow keys move between days.' }));
  renderPracticeStats(progressState.period, date);
}

// Progress filters and view. Plain state, kept for the session: a guest writes nothing to storage.
const progressState = { period: '30', key: '', view: 'speed', allRuns: false, detail: '', moversOpen: false };

// The run list opens on the newest few, and one button builds the rest. Choosing a period, test or
// condition set, or another profile, opens it on the newest few again.
const RECENT_RUNS = 10;
let listedRuns = [];

function chooseProgress(choice) {
  if (Object.entries(choice).every(([name, value]) => progressState[name] === value)) return;
  Object.assign(progressState, choice, { allRuns: false });
  renderHistory();
}

function renderRunRows() {
  const shown = progressState.allRuns ? listedRuns : listedRuns.slice(0, RECENT_RUNS);
  const previous = learning.progress.runs.getSnapshot();
  flushSync(() => learning.progress.runs.publish({ rows: shown.map(runRow), total: listedRuns.length, revision: previous.revision + 1 }));
}

function showAllRuns() {
  progressState.allRuns = true;
  const previous = learning.progress.runs.getSnapshot();
  flushSync(() => learning.progress.runs.publish({ ...previous, rows: listedRuns.map(runRow) }));
}

// What the width-dependent charts last drew from, so a resize, a unit change or a new view redraws them:
// the runs and the period window they were selected from, taken on the same day.
let progressRuns = [];
let progressTrendNote = '';
let progressWindow = null;

// The overview's week (weekChange), kept so a unit change can redraw the lead without closing anything.
let progressWeek = null;
let practicePerDay = [];

const shapeLabel = (shape) => {
  if (shape.mode === 'words') return { text: `${shape.size} words` };

  if (shape.mode === 'time') return { text: `${shape.size} s`, label: `${shape.size} seconds` };

  if (shape.mode === 'quote') return { text: `${shape.size} quote` };

  if (shape.mode === 'code') return { text: `code · ${shape.size}` };

  if (shape.mode === 'book') return { text: bookName(shape.size) };

  return { text: shape.mode };
};

// One pill per test length in testShapes' order; a length without runs is disabled.
function renderTestPills(shapes) {
  const selected = shapes.find((shape) => shape.variants.some((variant) => variant.key === progressState.key));
  const focused = document.activeElement?.closest('#progress-tests') ? { ...document.activeElement.dataset } : null;
  const variants = selected?.variants || [];
  const labels = conditionLabels(variants.map((variant) => variant.conditions));
  const tests = shapes.map((shape) => ({ id: shape.id, mode: shape.mode, ...shapeLabel(shape), key: shape.variants[0]?.key, selected: shape === selected, disabled: !shape.variants.length }));
  const previous = learning.progress.filters.view.getSnapshot();
  flushSync(() => learning.progress.filters.view.publish({ ...previous, tests, variants: variants.map((variant, i) => ({ key: variant.key, label: labels[i] })), key: progressState.key, period: progressState.period }));

  if (focused) {
    const pill = [...$('progress-tests').children].find((node) => node.dataset.shape === focused.shape && !node.disabled && node.isConnected);

    if (pill?.checkVisibility()) pill.focus({ preventScroll: true }); else landProgressFocus();
  }
}

// Where focus lands on Progress when what held it is gone, hidden or disabled (TOB-448): somewhere a sighted keyboard
// user can see it. In a detail view, the view's own heading; on the overview, the empty state's heading, or the lead's
// figure. The page's heading is for screen readers only, so it is never the landing. The view is the one on screen (a
// view of rows stays until it is left, after a clear too); the overview's state is read from the history, so a landing
// chosen mid-redraw is the one the redraw ends on.
function progressLanding() {
  if ($('progress-screen').dataset.detail) return $('progress-detail-heading');

  return learning.profile.runs.some(practiceRun) || learning.profile.loops.length ? $('lead-figure') : $('progress-empty-title');
}

// Whether the person's last input was a key. Where the page moves focus for them, each engine guesses differently
// whether to show its ring (Firefox shows none after the element that held focus is gone), so the landing shows it
// by this instead: a ring for someone using the keyboard, none after a click or a tap (TOB-448).
// A modifier on its own (a shortcut half pressed, Shift before a click) is no keyboard use.
let keyboardInput = false;
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'Fn']);

document.addEventListener('keydown', (event) => { if (!MODIFIER_KEYS.has(event.key)) keyboardInput = true; }, { capture: true, signal: lifetime.signal });

document.addEventListener('pointerdown', () => { keyboardInput = false; }, { capture: true, signal: lifetime.signal });

// Focus the page moves to a heading or figure (.focus-landing) shows its ring by this rule alone, never by an engine's
// own :focus-visible guess, which in Chromium counts a lone modifier as keyboard use.
function focusShown(target, { scroll = false } = {}) {
  target.toggleAttribute('data-focus-ring', keyboardInput);
  target.addEventListener('blur', () => target.removeAttribute('data-focus-ring'), { ...{ once: true }, signal: lifetime.signal });
  target.focus({ preventScroll: !scroll });
}

const landProgressFocus = (options) => focusShown(progressLanding(), options);

function runRow(run) {
  const trace = learning.profile.attempts.find((a) => a.id === run.id);

  return { id: run.id, wpm: run.score.wpm, accuracy: run.score.accuracy,
    date: dateCopy(run.at) + (run.kind === 'retest' ? ' · retest' : run.conditions?.mode === 'standard' ? ' · standard' : '') + (run.fresh === false ? ' · repeated text' : ''),
    errors: run.errors, time: (run.elapsedMs / 1000).toFixed(1) + ' s', description: copyParts(describeRun(run)),
    textNote: 'Text: ' + run.textId + ' · ' + (run.fresh === false ? 'previously displayed' : 'fresh when displayed'), passage: trace?.text };
}

function renderHistory() {
  // One moment for the whole page, so the week, every figure, chart and list read the same days.
  const date = new Date();
  const { source, key, span, runRows, loops } = renderOverview(date);
  renderStandardScore();
  renderTraining();
  renderGoal(date);
  renderKeys(source ? filterRuns(learning.profile.runs, key, span) : []);
  listedRuns = [...runRows].reverse();
  renderRunRows();
  renderLoops(loops);
  renderComposeHistory();
  showProgressDetail();
}

// The overview, and the conditions it reads: the lead, what moved it, the small charts and the quiet links. Every
// change to the history redraws it (followHistory, through renderWeek), whatever the page shows; the detail views
// wait for renderHistory, so a row someone has open there stays open.
function renderOverview(date) {
  historyDay = dayKey(date);
  const listed = learning.profile.runs.filter(practiceRun);
  const hasProgress = listed.length > 0 || learning.profile.loops.length > 0;
  const hasHistory = hasAnyHistory();
  // Conditions never mix: the lead, the charts and every list read one exact condition set. A length opens on its
  // most used set; with no choice yet, on the length of the newest run.
  const shapes = testShapes([...listed, ...learning.profile.loops]);
  const variants = shapes.flatMap((shape) => shape.variants);

  // An emptied history keeps the choice, so undoing a clear comes back to the conditions that were showing.
  if (variants.length && !variants.some((variant) => variant.key === progressState.key)) {
    const newest = listed.at(-1) || learning.profile.loops.at(-1);
    progressState.key = (newest && shapes.find((shape) => shape.id === shapeOf(newest.conditions))?.variants[0].key) || variants[0]?.key || '';
    progressState.allRuns = false;
  }

  renderTestPills(shapes);
  const source = variants.find((variant) => variant.key === progressState.key)?.conditions;
  const key = source ? progressState.key : '';
  const period = progressState.period;

  const siblings = shapes.find((shape) => shape.variants.some((variant) => variant.key === key))?.variants.map((variant) => variant.conditions);
  flushSync(() => learning.progress.filters.view.publish({ ...learning.progress.filters.view.getSnapshot(), hasSource: Boolean(source), conditions: source ? describeConditions(source, siblings) : '' }));

  const week = weekChange({ runs: learning.profile.runs, loops: learning.profile.loops, practiceDays: learning.profile.practiceDays, key, conditions: source || null,
    focus: learning.preferences.trainFocus, goal: learning.preferences.dailyGoal, period, now: date.getTime() });

  progressWeek = week;
  $('progress-empty').hidden = hasProgress;
  $('week-lead').hidden = !hasProgress;
  renderLead(week.lead);
  renderMovers(week);
  progressRuns = week.charts.runs;
  progressWindow = week.charts.window;
  $('week-charts').hidden = !progressRuns.length;

  // What the charts can't show: an empty period, or runs listed that aren't drawn.
  const span = periodWindow(period, date);
  const runRows = source ? filterRuns(listed, key, span) : [];
  const repeats = runRows.length - progressRuns.length;
  const repeatCopy = repeats ? `${repeats} repeated-text ${repeats === 1 ? 'run' : 'runs'} not charted.` : '';
  progressTrendNote = progressRuns.length
    ? [progressRuns.some((r) => !r.at) ? 'Undated runs not charted.' : '', repeatCopy].filter(Boolean).join(' ')
    : runRows.length ? `No fresh-text runs in this period. ${repeatCopy}` : 'No runs in this period.';

  // Everything else, one step away.
  const byDay = minutesByDay(learning.profile.runs, learning.profile.practiceDays);
  const loops = source ? filterRuns(learning.profile.loops, key, span).reverse() : [];
  const links = { runs: hasProgress, keys: hasProgress, calendar: Object.keys(byDay).length > 0, standard: hasHistory, compose: learning.profile.compositions.length > 0 };

  flushSync(() => learning.progress.overview.publish({ hasHistory, hasProgress, links,
    runsLabel: runRows.length || loops.length ? `${plural(runRows.length, 'run')}${loops.length ? ` and ${plural(loops.length, 'drill')}` : ''}` : 'Runs' }));

  // The full charts are opened from a small chart, not a link, and stay open through their own filters.
  if (progressState.detail && !{ ...links, trends: hasProgress }[progressState.detail]) progressState.detail = '';

  return { source, key, span, runRows, loops };
}

// Under the fuller charts, the period in figures: the median speed and accuracy of the runs charted, the fastest
// single run with its day (the chart names the best day's median, which can be another day), and how many runs.
// Speeds are speed figures, so a unit change rewords them.
function renderTrendFigures(runs) {
  const stats = periodStats(runs);
  const speed = (wpm) => [speedFigure(wpm, { bare: true, whole: true }), ' ', unitLabel()];
  const day = stats.best?.at ? ` on ${new Date(stats.best.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ', date unavailable';

  const parts = stats.count ? [
    ['median ', ...speed(stats.wpm)],
    [`${Number(stats.accuracy.toFixed(1))}% accuracy`],
    ['best run ', ...speed(stats.best.score.wpm), day],
    [plural(stats.count, 'run')],
  ] : [];

  $('trend-figures').replaceChildren(...parts.flatMap((part, i) => [i ? ' · ' : '', element('span', part)]));
  $('trend-figures').hidden = !stats.count;
}

// A change to the history (followHistory) or the train focus, on Progress: the overview follows at once, with focus
// kept where it was. A detail view of rows keeps them until it is left, so a row someone has open stays open.
function renderWeek() {
  const open = progressState.detail;
  const focused = $('progress-screen').contains(document.activeElement) ? document.activeElement : null;
  renderOverview(new Date());

  // The full charts keep no rows, so when a clear from another tab leaves them nothing to draw they close whole,
  // back to the overview. A view of rows stays as it is until it is left.
  if (open === 'trends' && !progressState.detail) {
    showProgressDetail();
  } else {
    // The full charts follow at once too, unless focus is on one of their points, which a redraw would drop: then
    // they wait, whole, for the view's next drawing.
    const held = ['progress-trend', 'accuracy-trend', 'progress-spread'].some((id) => $(id).contains(document.activeElement));

    if (!progressState.detail || (progressState.detail === 'trends' && !held)) drawProgressView();
  }

  // Focus that was on the page and now rests on nothing, or on something hidden or disabled, lands where Progress
  // lands it (progressLanding), never on the body. Focus that wasn't on the page stays where it was. A row drawn again
  // has already taken its focus back (renderMovers).
  const now = document.activeElement;
  const lost = focused && (!now || now === document.body || now.disabled || Boolean(now.closest('[hidden]')));

  if (lost) landProgressFocus();
}

// The lead: the change in speed, this week against the week before, with the two medians beside it and one line of
// sample sizes and conditions; or, without two weeks to compare, what there is and when a change can show. Speeds
// read whole, in the unit on screen, and the change is the difference of the two figures printed, so they add up.
// A unit change redraws it (applySpeedUnit).
function renderLead(lead) {
  const whole = (wpm) => Math.round(speedValue(wpm));
  const bare = (wpm) => speedFigure(wpm, { bare: true, whole: true });
  const day = (key) => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const runs = (count) => plural(count, 'run');
  const { current, previous } = lead;
  let figure = null;
  let spoken = '';
  let sentence = [];
  let sample = '';
  let note = '';
  let tone = 'none';

  if (lead.state === 'change') {
    const change = whole(current.median) - whole(previous.median);
    tone = change > 0 ? 'gain' : change < 0 ? 'drop' : 'flat';
    figure = `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}`;
    spoken = change ? `${Math.abs(change)} ${unitText('{unit}')} ${change > 0 ? 'faster' : 'slower'} than the week before.` : 'The same as the week before.';
    sentence = [bare(current.median), ' this week, ', bare(previous.median), ' the week before'];
    sample = `medians of ${current.count} and ${runs(previous.count)}`;
  } else if (lead.state === 'this-week') {
    figure = String(whole(current.median));
    sentence = ['this week so far'];
    sample = `median of ${runs(current.count)}`;
    note = previous.count ? `The week before has ${runs(previous.count)}, too few for a median.` : '';
  } else if (lead.state === 'last-week') {
    figure = String(whole(previous.median));
    sentence = ['the week before'];
    sample = `median of ${runs(previous.count)}`;
    note = current.count ? `${runs(current.count)} this week, too few for a median.` : 'No runs this week yet.';
  } else if (lead.state === 'thin') {
    figure = String(whole(lead.latest.score.wpm));
    sentence = [current.count ? 'your latest run' : `your latest run, ${day(runDay(lead.latest))}`];
    sample = current.count ? `${runs(current.count)} this week` : `${runs(previous.count)} the week before`;
    note = `A week has a median from ${WEEK_MIN_RUNS} runs.`;
  } else {
    sentence = ['No runs at these conditions in the last two weeks'];
  }

  $('week-lead').dataset.state = lead.state;
  $('week-lead').dataset.tone = tone;
  flushSync(() => learning.progress.lead.publish({ figure, spoken, sentence: copyParts(sentence), sample, note, state: lead.state, tone }));
}

// What moved it: the units fixed this week, ranked (weekMovers), the first SHOWN_MOVERS shown and the rest behind one
// "more"; then practice.
function renderMovers(week) {
  const open = progressState.moversOpen;

  const rows = week.movers.map((mover) => {
    const copy = moverCopy(mover);

    return { unit: mover.unit, before: copy.before, after: copy.after,
      tail: [copy.tail || 'over ' + plural(mover.after.intervals, 'clean interval'), mover.split === 'drill' && 'since your drill'].filter(Boolean).join(' '),
      title: moverSample(mover), status: 'fixed' };
  });

  if (week.practice) {
    const practice = week.practice;
    const streak = practice.streak ? plural(practice.streak, 'day') + ' in a row' + (practice.goal ? ' at ' + practice.goal + ' min' : '') : '';
    rows.push({ practice: true, before: goalMinutes(practice.previous), after: goalMinutes(practice.current) + ' min', tail: streak ? '· ' + streak : '', status: practice.status });
  }

  flushSync(() => learning.progress.movers.publish({ rows, open, extra: week.movers.length - SHOWN_MOVERS, shown: SHOWN_MOVERS }));
  $('week-moved').hidden = !rows.length;
  const extra = week.movers.length - SHOWN_MOVERS;
  $('more-movers').hidden = extra < 1;
  $('more-movers').textContent = extra < 1 ? '' : open ? 'Fewer' : extra + ' more';
  $('more-movers').setAttribute('aria-expanded', String(open));
}

// Practice, a plain fact: minutes the week before → this week, and the streak (at the goal, when one is set).


function renderLoops(loops) {
  learning.commands.loopTarget = (id) => {
    const loop = learning.profile.loops.find((item) => item.id === id);

    if (loop?.target) practiceTarget(loop.target, loop.conditions);
  };

  const rows = loops.map((loop) => {
    const drilled = loop.drillCompleted || Boolean(loop.drill);
    let conditions = describeConditions(loop.conditions);
    const pace = loop.targetPace;
    const timing = loop.targetTiming?.target && loop.targetTiming.beforeCount + loop.targetTiming.afterCount > 0 ? loop.targetTiming : null;
    const misses = loop.targetMisses;

    if (pace) conditions += ' · ' + pace.target + ' ' + paceShift(pace.now.slowMs) + ' over ' + plural(pace.now.timed, 'interval') + ', was ' + paceShift(pace.was.slowMs) + ' over ' + pace.was.timed;
    else if (misses) conditions += ' · ' + misses.target + ' missed ' + missedCopy(misses.now) + ', was ' + missedCopy(misses.was);
    else if (timing) conditions += ' · ' + timing.target + ' · ' + timing.beforeCount + ' before · ' + timing.afterCount + ' after';
    const notes = [];

    if (timing) notes.push('“' + timing.target + '” clean intervals: ' + timing.beforeCount + ' before / ' + timing.afterCount + ' after. ' + (timing.deltaMs === null ? 'Too few samples to call a timing change.' : signed(timing.deltaMs, 'ms') + ' median timing change.'));
    notes.push(loop.comparison.reason || 'One retest is feedback, not proof.');

    if (loop.beforeAttemptId && loop.afterAttemptId) notes.push('Baseline ' + loop.beforeAttemptId + ' · retest ' + loop.afterAttemptId + '. Open their run entries above for saved details.');

    return {
      id: loop.id, date: new Date(loop.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      title: drilled ? loop.target ? '“' + loop.target + '” drill and retest' : 'General drill and retest' : 'Fresh-text check',
      conditions, accuracy: signed(loop.comparison.accuracyDelta, 'pp'), delta: loop.comparison.wpmDelta, state: loop.comparison.state,
      facts: [
        { label: 'before', parts: copyParts(loop.comparison.before ? [speedFigure(loop.comparison.before.wpm), ' · ' + loop.comparison.before.accuracy + '%'] : 'Not retained in this older comparison') },
        { label: 'after', parts: copyParts(loop.comparison.after ? [speedFigure(loop.comparison.after.wpm), ' · ' + loop.comparison.after.accuracy + '%'] : 'Not retained in this older comparison') },
        { label: 'drill', parts: [loop.drillCompleted ? (loop.drill?.duration || 60) + ' s · ' + (loop.target || 'general') : drilled ? 'interrupted · ' + (loop.target || 'general') : 'Skipped'] },
      ], notes, target: loop.target || null,
    };
  });

  flushSync(() => learning.loops.publish(rows));
}

// Practice over the period, whatever the test: days practised, the longest and current streaks (days meeting
// the goal, or with any practice when it's off) and minutes typed, from the same minutes the calendar draws.
function renderPracticeStats(period, date = new Date()) {
  const byDay = minutesByDay(learning.profile.runs, learning.profile.practiceDays);
  const first = Object.keys(byDay).sort()[0] || null;
  const days = periodDays(period, date, first);
  const goal = learning.preferences.dailyGoal;
  const stats = practiceStats(byDay, learning.profile.runs, days, goal);
  practicePerDay = stats.runsPerDay;
  const runs = stats.runsPerDay.reduce((sum, d) => sum + d.runs, 0);
  const current = practiceStreak(byDay, goal, date);

  const figure = (label, value, unit, note) => ({ label, value, unit, note });

  const daysWord = (n) => (n === 1 ? 'day' : 'days');
  const runDays = stats.runsPerDay.filter((d) => d.runs).length;
  const counted = runCountTotals(learning.profile.runCounts, { from: period === 'all' ? null : days[0], to: days.at(-1) });
  flushSync(() => learning.progress.calendar.figures.publish([
    figure('Active days', String(stats.active), `of ${days.length}`, runDays ? `${plural(Number((runs / runDays).toFixed(1)), 'run')} a day when you practise` : 'no runs in this period'),
    figure('Longest streak', String(stats.longest), daysWord(stats.longest), goal ? `at ${goal} min a day` : 'in this period'),
    figure('Current streak', String(current), daysWord(current), `today ${goalMinutes(byDay[dayKey(date)])}${goal ? ` of ${goal}` : ''} min`),
    figure('Time typing', goalMinutes(stats.minutes), 'min', period === 'all' ? `since ${new Date(`${days[0]}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : `in the last ${days.length} days`),
    figure('Runs started', String(counted.started), `${counted.finished} finished`),
  ]));
}

// Everything the overview doesn't show sits one step away in a detail view, each with a way back. The conditions
// and the period move into a view that reads them, and back to the overview after.
const PROGRESS_DETAILS = { runs: 'Runs', trends: 'Trends', keys: 'Keys', calendar: 'Practice', standard: 'Standard score', compose: 'Composing' };

let detailOpener = null;

function openProgressDetail(name, { opener = null, focus = true } = {}) {
  progressState.detail = name;
  detailOpener = opener;
  showProgressDetail({ focus });
  // A view opens at its top, as a new page would, whatever the overview was scrolled to.
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function closeProgressDetail() {
  const back = detailOpener;
  progressState.detail = '';
  detailOpener = null;
  // What changed while the view was open (a merge or a clear elsewhere) shows on the way back.
  renderHistory();
  const opener = typeof back === 'function' ? back() : back;

  if (opener?.isConnected && !opener.hidden) opener.focus();
  else landProgressFocus({ scroll: true });
}

function showProgressDetail({ focus = false } = {}) {
  const name = progressState.detail;
  $('progress-screen').dataset.detail = name;
  $('progress-overview').hidden = Boolean(name);
  $('progress-detail').hidden = !name;

  for (const panel of $('progress-detail').querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== name;
  flushSync(() => learning.progress.filters.detail.publish(name));

  setText($('progress-detail-heading'), PROGRESS_DETAILS[name] || '');
  drawProgressView();

  if (focus && name) focusShown($('progress-detail-heading'));
}

// Only what is on screen is drawn: a hidden chart has no width to draw to.
const shownProgressView = () => $('progress-tabs').querySelector('[aria-selected="true"]')?.dataset.viewTab;

function drawProgressView() {
  const detail = progressState.detail;
  const view = detail === 'trends' ? shownProgressView() : '';
  const overview = !detail && !$('week-charts').hidden && document.body.dataset.view === 'progress';

  const draw = {
    'week-speed': () => renderWeekChart($('week-speed'), progressRuns, 'wpm', { period: progressWindow, onOpen: () => openTrend('speed') }),
    'week-accuracy': () => renderWeekChart($('week-accuracy'), progressRuns, 'accuracy', { period: progressWindow, onOpen: () => openTrend('accuracy') }),
    'progress-trend': () => renderTrend($('progress-trend'), progressRuns, openHistoryRun, 'wpm', { period: progressWindow }),
    'accuracy-trend': () => renderTrend($('accuracy-trend'), progressRuns, openHistoryRun, 'accuracy', { period: progressWindow }),
    'progress-spread': () => renderSpread($('progress-spread'), progressRuns),
    'practice-runs': () => renderRunsPerDay($('practice-runs'), practicePerDay),
  };

  const shown = { 'week-speed': overview, 'week-accuracy': overview, 'progress-trend': view === 'speed', 'accuracy-trend': view === 'accuracy',
    'progress-spread': view === 'consistency', 'practice-runs': detail === 'calendar' && !$('practice-goal').hidden };

  for (const [id, render] of Object.entries(draw)) {
    if (shown[id]) render();
    else $(id).replaceChildren();
  }

  // The figures and the note under the full charts are drawn with them, so the three never tell of different runs.
  if (detail === 'trends') {
    renderTrendFigures(progressRuns);
    $('progress-trend-note').textContent = progressTrendNote;
  }
}

// A small chart opens its fuller chart, on its own tab, with the chart's own button to return to.
function openTrend(view) {
  progressState.view = view;
  selectTrendTab(view);
  // The small chart is drawn again on the way back, so the way back finds its new button.
  openProgressDetail('trends', { opener: () => $(view === 'speed' ? 'week-speed' : 'week-accuracy').querySelector('button') });
}

function selectTrendTab(view, { focus = false } = {}) {
  for (const tab of $('progress-tabs').querySelectorAll('[role="tab"]')) {
    const on = tab.dataset.viewTab === view;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !on;

    if (on && focus) tab.focus();
  }
}

// The trends are tabs: one panel at a time, arrow keys move between tabs and show each as they go.
function showProgressView(view, { focus = false } = {}) {
  progressState.view = view;
  selectTrendTab(view, { focus });
  drawProgressView();
}

function moveProgressTab(event) {
  const tabs = [...$('progress-tabs').querySelectorAll('[role="tab"]')];
  const from = tabs.indexOf(event.target);
  const to = { ArrowRight: from + 1, ArrowLeft: from - 1, Home: 0, End: tabs.length - 1 }[event.key];

  if (from < 0 || to === undefined) return;
  event.preventDefault();
  showProgressView(tabs[(to + tabs.length) % tabs.length].dataset.viewTab, { focus: true });
}

function hasAnyHistory() {
  return learning.profile.runs.length > 0 || learning.profile.attempts.length > 0 || learning.profile.loops.length > 0 || learning.profile.compositions.length > 0
    || lessonsStarted(learning.profile.lessons) || Object.keys(learning.profile.practiceDays).length > 0 || Object.keys(learning.profile.runCounts).length > 0;
}

// Composing numbers get their own list: no chart, no trend, no best, nothing shared with copy tests.
function renderComposeHistory() {
  const list = learning.profile.compositions;
  $('compose-history').hidden = !list.length;
  const shown = [...list].reverse().slice(0, 10);

  const rows = shown.map((item) => {
    const prompt = promptText(item.promptId);

    return { id: item.id, wpm: item.wpm, backspaceRate: item.backspaceRate, prompt: prompt ? '“' + prompt + '”' : 'A prompt no longer offered',
      detail: dateCopy(item.at) + ' · ' + item.characters + ' characters · ' + item.backspaces + ' ' + (item.backspaces === 1 ? 'backspace' : 'backspaces') + ' in ' + item.keystrokes + ' keystrokes · ' + (item.activeMs / 1000).toFixed(1) + ' s active of ' + (item.elapsedMs / 1000).toFixed(1) + ' s · ' + (item.inputClass === 'touch' ? 'touch input' : 'physical keyboard') };
  });

  flushSync(() => learning.progress.composing.publish({ rows, note: list.length > shown.length ? 'newest ' + shown.length + ' of ' + list.length : '' }));
}

// Everyone types the daily passage under the same rules, whatever their practice settings.
function dailyConditions() {
  return { ...settingsConditions(), mode: 'quote', duration: null, count: null, punctuation: true, numbers: false,
    quoteLength: 'medium', difficulty: 'any', wordList: null, correctionPolicy: 'relaxed', strictSpace: false, quickEnd: true, corpus: CORPUS_VERSION };
}

function todayPassage() {
  const daily = dailyPassage();

  return { ...daily, id: daily.sourceTextId, challengeId: daily.id, corpus: CORPUS_VERSION,
    firstDailyAttempt: !learning.profile.seenTextIds.includes(daily.id), fresh: !learning.profile.seenTextIds.includes(daily.sourceTextId) };
}

function startDaily() {
  if (practice.attempt?.status === 'running') { markInterrupted(NOTICES.leftSurface); finishPrimary(null, { replacing: true }); }

  if (race.attempt?.status === 'running') markRaceInterrupted();
  baselineAttempt = null;
  trainingContext = null;
  resetSession('daily', { focus: true });
}

function renderDaily() {
  const daily = dailyPassage();
  $('daily-date').textContent = `${daily.day} · english · resets 00:00 UTC`;
  const completed = learning.profile.runs.filter((r) => r.kind === 'daily' && validRun(r));
  const today = completed.filter((r) => r.challengeDate === daily.day && conditionKey(r.conditions) === conditionKey(dailyConditions()));
  const best = [...today].sort((a, b) => b.score.wpm - a.score.wpm || b.score.accuracy - a.score.accuracy)[0];
  const layout = isDefaultLayout(learning.preferences.layout) ? '' : ` in ${layoutLabel(learning.preferences.layout)}`;
  setParts($('daily-status'), best
    ? ['Today’s best: ', speedFigure(best.score.wpm), ` · ${best.score.accuracy}% accuracy${layout}.`]
    : `No completed physical-keyboard attempt${layout} today.`);
  $('daily-history-panel').hidden = !completed.length;
  $('daily-history').replaceChildren(...[...completed].reverse().slice(0, 30).map((run) => {
    const row = element('div', '', 'daily-result');
    row.append(element('strong', [speedFigure(run.score.wpm), ` · ${run.score.accuracy}%`], 'num'),
      element('span', `${run.challengeDate} · ${(run.firstDailyAttempt ?? run.fresh) ? 'first attempt' : 'repeat attempt'}${run.firstDailyAttempt && !run.fresh ? ' · previously displayed passage' : ''} · ${inputLabel(run.conditions)}`));

    return row;
  }));
}

// ── Lessons ───────────────────────────────────────────────────────────────

const handoffCopy = () => `That’s the whole keyboard. From here the training loop takes over: take a practice run, and Train suggests a ${learning.preferences.drillSeconds}-second drill from your own mistakes once there’s enough evidence${learning.preferences.retest ? ', then retests you on fresh text' : ''}.`;

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
  const tries = learning.profile.lessons[lesson.id]?.tries;

  return [`${lessonFingers(lesson)} · pass at ${LESSON_ACCURACY}% accuracy and `, speedFigure(lesson.wpm), ` in one run${tries ? ` · ${tries} ${tries === 1 ? 'try' : 'tries'} so far` : ''}`];
}

// Like every run, a lesson is classed by the press that started it (resetSession reads activationInput).
function startLesson(index) {
  if (!lessonUnlocked(learning.profile.lessons, index)) return;

  if (practice.attempt?.status === 'running') { markInterrupted(NOTICES.leftSurface); finishPrimary(null, { replacing: true }); }

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
    const run = recordLessonRun(learning.profile.lessons, lessonIndex, score, at, completed.conditions.inputClass);
    // A lesson that was locked when it finished saves nothing, but still shows its numbers.
    outcome = run.outcome || lessonOutcome(lessonIndex, score);
    firstPass = run.firstPass;
    recorded = run.recorded;

    if (recorded) {
      learning.profile.lessons = run.progress;
      learning.profile.practiceDays = recordPracticeTime(learning.profile.practiceDays, at, elapsedMs);
      saved = saveProfile();
    }
  }

  lessonResult = { failed: completed.failed, index: lessonIndex, score, elapsedMs, errors: firstAttempts.filter((item) => !item.correct).length, outcome, firstPass, recorded, at, touch, saved, valid };
  switchView('learn');
  announce(`${plain(lessonHeadline(lessonResult))} ${score.accuracy}% accuracy, ${formatSpeed(score.wpm)}.`);
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
  const next = nextLessonIndex(learning.profile.lessons);

  if (result.outcome?.passed) {
    if (!result.firstPass) return `Lesson ${n} passed again.`;

    if (next >= LESSONS.length) return `Lesson ${n} passed. Every letter is in.`;
    const keys = LESSONS[next].keys;

    return `Lesson ${n} passed. ${keysLabel(keys)} ${keys.length > 1 ? 'are' : 'is'} next.`;
  }

  const { accuracyMet, speedMet, accuracyTarget, wpmTarget } = result.outcome;
  const needs = [accuracyMet ? '' : `${accuracyTarget}% accuracy`, !accuracyMet && !speedMet ? ' and ' : '', speedMet ? '' : speedFigure(wpmTarget)];

  return [`Not yet. Lesson ${n} needs `, needs, ' in one run.'];
}

function renderLessons() {
  const progress = learning.profile.lessons;
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
      copy = complete ? handoffCopy() : lessonCopy(next);

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

    if (!result.saved) meta = [meta, meta ? ' · ' : '', 'Couldn’t save on this device.'];
  } else if (complete) {
    status = ['all letters in', 'badge-success'];
    heading = 'Every letter is in.';
    copy = handoffCopy();
    primary = ['Take a practice run', startTrainingLoop];
  } else {
    heading = `Lesson ${next + 1} · ${keysLabel(LESSONS[next].keys)}`;
    copy = lessonCopy(next);
    meta = lessonMeta(next);
    primary = [`Start lesson ${next + 1}`, start(next)];
  }

  learning.commands.lessonPrimary = primary[1];
  learning.commands.lessonSecondary = secondary?.[1] || (() => {});
  learning.commands.lesson = startLesson;

  const facts = result?.valid ? [
    { label: 'accuracy', value: [result.score.accuracy + '%'], need: [result.outcome.accuracyTarget + '% needed'], met: result.outcome.accuracyMet },
    { label: 'speed', speedUnit: true, value: copyParts(speedFigure(result.score.wpm, { bare: true })), need: copyParts([speedFigure(result.outcome.wpmTarget, { bare: true }), ' needed']), met: result.outcome.speedMet },
    { label: 'first-try errors', value: [String(result.errors)], need: [], met: null },
    { label: 'time', value: [(result.elapsedMs / 1000).toFixed(1) + ' s'], need: [], met: null },
  ] : [];

  const rows = LESSONS.map((lesson, index) => {
    const entry = progress[lesson.id];
    const passed = Boolean(entry?.passed);
    const open = !passed && index <= next;

    const numbers = passed ? [speedFigure(entry.passed.wpm), ' · ' + entry.passed.accuracy + '%']
      : entry?.last ? [entry.tries + ' ' + (entry.tries === 1 ? 'try' : 'tries') + ' · last ', speedFigure(entry.last.wpm), ' · ' + entry.last.accuracy + '%' + (entry.last.inputClass === 'touch' ? ' · touch input' : '')] : '';

    const action = passed ? 'Repeat' : open ? 'Start' : '';

    return { id: lesson.id, index, keys: lesson.keys, fingers: fingerNames(lesson), state: passed ? 'passed' : open ? 'next' : 'locked', numbers: copyParts(numbers), action, actionLabel: action + ' lesson ' + (index + 1) + ', ' + keysLabel(lesson.keys) };
  });

  flushSync(() => learning.lessons.publish({
    status: status ? { label: status[0], tone: status[1] } : null,
    heading: copyParts(heading), copy, meta: copyParts(meta), facts,
    primary: primary[0], secondary: secondary?.[0] || '',
    known: lessonKeys(complete ? LESSONS.length - 1 : next - 1), fresh: complete ? [] : LESSONS[next].keys,
    caption: complete ? 'every key learned' : 'green edge: lesson ' + (next + 1) + '’s keys',
    saveNote: isDefaultLayout(learning.preferences.layout) ? '' : 'Lessons teach QWERTY finger positions. Use QWERTY in your operating system for these lessons.', rows,
  }));
}

// ── Ghost races ───────────────────────────────────────────────────────────
// A friend's recorded run, raced on the practice surface against a ghost caret that replays their
// keystrokes (src/ghost-race.js). The run is kind 'challenge', non-comparable like custom text: only its
// summary is kept, and it is never a best.

const GHOST_CONDITION_KEYS = ['mode', 'duration', 'count', 'punctuation', 'numbers', 'quoteLength', 'difficulty', 'wordList',
  'correctionPolicy', 'language', 'corpus', 'metricVersion'];

const inputOf = (value = {}) => value.inputClass === 'touch' ? 'touch' : 'physical-keyboard';

// A run that wasn't sent for these reasons can be raced again; a failed send is retried as is.
const RACE_AGAIN = ['interrupted', 'unsendable', 'unreplayable', 'other-input', 'own'];
const ghostInputLabel = (value) => inputOf(value) === 'touch' ? 'touch input' : 'a physical keyboard';

// The sender's test conditions, so the same finish rule applies; the input class is this device's.
function ghostConditions() {
  const source = ghostRace.conditions || {};

  return { ...Object.fromEntries(GHOST_CONDITION_KEYS.flatMap((key) => (key in source ? [[key, source[key]]] : []))),
    inputClass: 'physical-keyboard' };
}

// A quote or daily passage keeps its own text id, worked out from the text, so a quote raced here
// can't later count as fresh. Word and timed text gets the id of exactly that text.
function ghostPassage() {
  const id = challengeTextId(ghostRace.passage, ghostRace.conditions);

  return { id, text: ghostRace.passage, fresh: !learning.profile.seenTextIds.includes(id) };
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
  return JSON.stringify([document.body.dataset.view, sessionCount, practice.attempt?.status, typedCount, customOpen, race.attempt?.id,
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

  try { view = await getChallenge(accounts.session, id); } catch (error) { failure = error; }

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

  if (practice.attempt?.status === 'running') { markInterrupted(NOTICES.leftSurface); finishPrimary(null, { replacing: true }); }

  if (race.attempt?.status === 'running') markRaceInterrupted();
  ghostRace = { id, name: view.name, passage: view.passage, conditions, duration: view.duration ?? null,
    points: ghostPoints(view.trace, view.passage.length), sender: view.sender, result: null, run: null, state: 'ready' };
  // As with the daily: someone else's text ends any drill-and-retest cycle in progress.
  baselineAttempt = null;
  trainingContext = null;
  inbox?.settle(`challenge:${id}`);
  resetSession('challenge', { focus: true });
}

// When nobody is waiting for a quick match: the fastest recorded run of yours on its setup (30 seconds of the
// 200 words, no punctuation or numbers, a physical keyboard) that this device still keeps the keystrokes of.
// Only your own recording is ever used; other people's stay on their devices (ADR 0006).
function ownBestRun() {
  let best = null;

  for (const run of learning.profile.attempts) {
    const c = run.conditions || {};

    if (run.adaptive || c.mode !== 'time' || c.duration !== 30 || c.punctuation || c.numbers || (c.wordList || DEFAULT_WORD_LIST) !== '200'
      || inputOf(c) !== 'physical-keyboard' || (c.corpus || CORPUS_VERSION) !== CORPUS_VERSION) continue;
    // The same run a friend would get: its trace, its passage cut past the furthest key, its checked conditions.
    const payload = challengePayload(run);

    if (payload && (!best || payload.score.wpm > best.score.wpm)) best = payload;
  }

  return best;
}

function startOwnGhost() {
  const best = ownBestRun();

  if (!best || onlineRoomFirst()) return;

  if (practice.attempt?.status === 'running') { markInterrupted(NOTICES.leftSurface); finishPrimary(null, { replacing: true }); }

  if (race.attempt?.status === 'running') markRaceInterrupted();
  ghostRace = { id: null, own: true, name: 'Your best run', passage: best.passage, conditions: best.conditions, duration: best.duration,
    points: ghostPoints(best.trace, best.passage.length), sender: best.score, result: null, run: null, state: 'ready' };
  baselineAttempt = null;
  trainingContext = null;
  navigate('practice');
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
  // Your own recording goes nowhere, so a run that can't be scored against it is not compared, never "not sent".
  const kept = ghost.own ? 'compared' : 'sent';
  $('ghost-result-heading').textContent = ghost.state === 'interrupted' ? (ghost.own ? 'Interrupted.' : 'Interrupted, so not sent.')
    : ghost.state === 'other-input' ? `A different kind of input, so not ${kept}.`
      : ghost.state === 'unreplayable' ? `A character a ghost race can’t replay, so not ${kept}.` : !mine ? (ghost.own ? 'Too long to replay.' : 'Too long to send.')
        : leader === 'tie' ? 'A tie.' : `${leader === 'recipient' ? 'You' : ghost.name} ${leadVerb(match, leader)}.`;
  const rows = [...(mine ? [{ name: 'You', score: mine }] : []), { name: ghost.name, score: ghost.sender }];

  if (leader === 'sender') rows.reverse();
  $('ghost-result-rows').replaceChildren(...rows.map(({ name, score }) => {
    const row = element('article', '', 'race-result-row');
    row.append(element('strong', name));

    for (const value of [speedFigure(score.wpm), `${score.accuracy}% accuracy`, `${(score.elapsedMs / 1000).toFixed(1)} s`]) row.append(element('span', value, 'num'));

    return row;
  }));
  $('ghost-result-rule').textContent = outcomeRule(ghost);
  const retry = ghost.state === 'failed' && (!ghost.error?.status || ghost.error.status >= 500);
  $('ghost-result-status').textContent = {
    sending: `Sending your run to ${ghost.name}…`,
    sent: `Sent to ${ghost.name}.`,
    kept: 'Your first finish stands, so this run wasn’t sent.',
    failed: `Not sent. ${ghost.error?.message || ''}`,
    unsendable: 'Race again with fewer corrections.',
    unreplayable: 'Race again without emoji.',
    'other-input': `Race again on ${ghostInputLabel(ghost.conditions)} to ${ghost.own ? 'compare' : 'send a run'}.`,
    own: 'The ghost was your own recording.',
  }[ghost.state] || '';
  const again = RACE_AGAIN.includes(ghost.state);
  const action = $('ghost-result-action');
  action.hidden = !(again || retry);
  action.textContent = again ? 'Race again' : 'Send again';
}

async function submitGhostRun() {
  const ghost = ghostRace;

  if (!ghost?.trace || !accounts.session) return;
  // The run this request finishes. The service records it either way, and its result reaches the inbox.
  const { run, trace } = ghost;
  ghost.state = 'sending';
  renderGhostResult();
  let view = null;
  let failure = null;

  try {
    view = await finishChallenge(accounts.session, ghost.id, trace);
    const id = `challenge:${ghost.id}`;
    inbox?.notify({ id, kind: 'challenge-result', challengeId: ghost.id, closed: false, until: null, completedAt: view.completedAt, text: resultText(view) });
    inbox?.deliver(id);
  } catch (error) {
    failure = error;
  }

  // The panel shows the reply only while the results on screen are still this run's: once a later run
  // has finished (after Run again, a restart or another race), its result never gains this panel.
  if (ghostRace !== ghost || ghost.run !== run || practice.shownResult !== run) return;

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

const racerName = () => $('online-name').value.trim() || accounts.session?.user.email.split('@')[0].slice(0, 24) || '';

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

  $('ghost-offer').hidden = !accounts.session || !challengePayload(offerRun);
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

  try { friends = await listFriends(accounts.session); } catch (error) { failure = error.message; }

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

  if (!payload || !friend || !accounts.session || offerBusy()) return;

  if (!name) {
    $('ghost-offer-error').textContent = 'Enter the name your friend will see.';
    $('ghost-name').focus();

    return;
  }

  if (offerSentTo.has(friend.id)) {
    $('ghost-offer-status').textContent = `Already sent to ${friend.name}.`;

    return;
  }

  const run = offerRun;

  if (!offerRequests.has(friend.id)) offerRequests.set(friend.id, crypto.randomUUID());
  const requestId = offerRequests.get(friend.id);
  offerSending = run;
  $('send-ghost').disabled = true;
  $('ghost-offer-status').textContent = `Sending to ${friend.name}…`;

  try {
    await sendChallenge(accounts.session, { friendId: friend.id, displayName: name, payload, requestId });

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


// A split keyboard where each column belongs to one finger, labelled underneath; thumbs take the space bar.
// Keys learned before this lesson read in the text colour, this lesson's keys get the full green edge.



// The typing keyboard shows the finger map for the whole of a lesson, whatever the keyboard setting.


// A one-keyboard race is a quote under the current settings, whatever the practice test shape.
function raceConditions() {
  return { ...conditions(), mode: 'quote', wordList: null, localRace: true, corpus: CORPUS_VERSION };
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

  if (race.passage?.id && !learning.profile.seenTextIds.includes(race.passage.id)) {
    learning.profile.seenTextIds.push(race.passage.id);
    saveProfile();
  }

  $('compete-setup').hidden = true;
  $('race-leaderboard').hidden = true;
  $('race-handoff').hidden = true;
  syncRules();
  setupRacePlayer();
}

function setupRacePlayer() {
  typingHost.clearFor('race');
  race.attempt = createAttempt({ id: uid(), text: race.passage.text, textId: race.passage.id, kind: 'race', conditions: { ...race.conditions } });
  race.startTime = null;
  race.notice = '';
  raceRunChanged();
  $('race-stage').hidden = false;
  $('race-player').textContent = race.names[race.player];
  $('race-input').value = '';
  $('race-input').disabled = false;
  race.textView = renderText($('race-text-display'), race.passage.text);
  race.characters = race.textView.characters;
  raceFx.reset(race.characters);
  $('race-accessible-passage').textContent = race.passage.text;
  updateRaceProgress(replayAttempt(race.attempt));
  showRaceRestartHint();
  $('race-input').focus({ preventScroll: true });
}

// A key hint: hidden on touch-only devices (.key-hint in styles.css), where there is no restart key.
function showRaceRestartHint() {
  const hint = learning.preferences.keybindings.restart ? `${bindingLabel(learning.preferences.keybindings.restart)} restarts.` : 'Restart shortcut is disabled.';
  $('race-help').replaceChildren(element('span', hint, 'key-hint'));
}

function updateRaceProgress(replay) {
  const percent = Math.round((replay.typed.length / race.attempt.text.length) * 100);
  $('race-progress').firstElementChild.style.setProperty('--progress', String(percent / 100));
  $('race-progress').setAttribute('aria-valuenow', String(percent));
}

function finishRacePlayer() {
  markEndFailure(race.attempt);

  typingHost.clearFor('race');
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
    speed.append(result.attempt.status === 'complete' ? speedFigure(score.wpm) : result.attempt.failed ? `failed · ${result.attempt.failed}` : 'interrupted');
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
  // The practised words came from the cleared runs, so Run again starts a normal test.
  wordsPassage = null;
  showResult(null);
  $('speed-graph').replaceChildren();
  $('ghost-result').hidden = true;
  renderGhostOffer(null);
  trainAfter = null;

  // A retest nobody has started compares with the baseline just forgotten, so a practice test takes its place; a
  // drill nobody has started stands alone now, with no retest after it, and says so (TOB-448).
  if (practice.attempt?.status === 'ready' && practice.sessionKind === 'retest') resetSession('practice', { show: false });
  else if (practice.attempt?.status === 'ready' && practice.sessionKind === 'drill') $('session-description').textContent = learning.preferences.mode === 'code' ? CODE_DRILL_NOTE : 'Standalone drill.';

  if (document.body.dataset.view === 'train') renderTrain();
}

// Empties history in memory and on the results screen once the account is deleted, when there is
// nothing left to save to (clear history keeps its marker and Undo; see clearHistory).
function wipeHistory() {
  learning.profile = emptyProfile();
  progressState.allRuns = false;
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
  if (runInProgress()) return false;
  const marker = learning.profile.historyClearedAt || null;
  const arrived = marker && !trainingClears.has(marker) ? marker : null;
  trainingClears = account.clearsApplied(learning.profile);
  const legacyStart = learning.profile.legacyClearedAt || '';
  const legacyAt = legacyStart !== trainingLegacyAt ? legacyStart : '';
  trainingLegacyAt = legacyStart;

  if (!baselineAttempt && !practice.shownResult) return false;
  const named = account.clearedIds(learning.profile);

  const takenByLegacy = (record) => Boolean(legacyAt) && (record.at || '') <= legacyAt
    && !learning.profile.runs.some((run) => run.id === record.id);

  const cleared = (record) => Boolean(record) && ((arrived && (record.at || '') <= arrived) || named.has(record.id)
    || takenByLegacy(record));

  if (!cleared(baselineAttempt) && !cleared(practice.shownResult)) return false;
  forgetTraining();

  return true;
}

// The one way a change to the history this tab holds reaches the screen: a merge from another tab or device, a clear
// or its undo, made here or elsewhere. A clear that took the baseline or the run on show is forgotten first (so a
// comparison of cleared runs goes, and with it its Next), then every training surface asks the recommender again
// (showTraining), as after a settings change. Mid-run nothing changes: the run's end brings it (flushDeferredSync).
function followHistory() {
  if (runInProgress()) {
    historyWaiting = true;

    return;
  }

  historyWaiting = false;
  forgetClearedTraining();
  showTraining();
}

// ── Accounts ──────────────────────────────────────────────────────────────


function renderAccount() { accounts.render(); }


const dailyKey = () => conditionKey(dailyConditions());

// The friends board's summary of exactly the copy being written, stamped with that write
// (src/friends-board.js). While an opt-out on this device is unconfirmed its writes clear the column
// (null), so this device shows nothing new on the board; turning sharing on repairs it (repairBoardNow).
const boardFor = (data) => (at) => (optOutPending(accounts.session) ? null : boardColumn(data.runs, dailyKey(), at));

// Whether this tab still belongs to the user a sync started for. Another tab can sign out, or in as
// someone else, while a request is out; the sync then stops and writes nothing here. A tab that heard of
// a sign-out elsewhere stays out even if the same account has signed in again since: it reloads first.


// Folds another copy of this account's profile (the account row, or another tab's cache) into memory.
// Only stored data changes here; showMerged() brings the screen up to date. Returns whether it changed.


// After a merge: preferences follow where they can't disturb a run, the training surfaces follow the merged history
// (followHistory), and the visible history view re-renders, but not while someone is using it. Nothing takes focus or
// announces anything, and nothing changes mid-run; Progress and Challenge re-render whenever they are next shown.
function showMerged() {
  followStoredPreferences();
  // Lesson progress follows at once: the learn screen is hidden while a run is typed.
  followLessonProgress();
  followHistory();

  if (runInProgress()) return;

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

// Pushes wait for the run in progress to end, so network and merge work never lands mid-run.


// One push at a time, each reading the account row afresh. Resolves true once the row holds this tab's edits.

// Read the row, merge, then write only if the row is still the version read. If another writer got in
// between, the write matches nothing: read again and merge again, three times at most. The merged copy
// is kept here and in the device cache.


// Brings in what other devices saved: when the tab comes back into view (at most every 15 s) and when
// the connection returns. With edits pending here it pushes instead, which reads and merges first.


function adoptProfile(data) {
  learning.profile = normalizeProfile(data);
  progressState.allRuns = false;
  learning.preferences = preferencesInUse(learning.profile.preferences);
  learning.livePreferences = JSON.stringify(learning.preferences);
  storeLocally();
  applyPreferences();
  setModeControls();
  renderHistory();

  if (practice.sessionKind === 'practice' && practice.attempt?.status !== 'running') resetSession('practice', { keepRace: true });
  followLessonProgress();
}

// Lesson progress changed under this tab (a copy merged from elsewhere, a clear or its undo here): a result
// the progress no longer holds is dropped, a lesson waiting that is now locked gives way to the next open
// one (one being typed finishes as not counted), and the learn screen and the first-run prompt follow. The
// learn screen is redrawn even while in use, so it never shows a pass the progress no longer holds; focus
// on a lesson row comes back to that row (or to the lesson button, if the row has no button now).
function followLessonProgress() {
  if (lessonResult && !lessonResultHeld(lessonResult, learning.profile.lessons)) lessonResult = null;

  if (practice.sessionKind === 'lesson' && practice.attempt?.status !== 'running' && !lessonUnlocked(learning.profile.lessons, lessonIndex)) resetSession('lesson', { show: false });
  redrawLessons();
}

// The learn screen drawn again under someone using it: focus on a lesson row comes back to that row (or to the lesson
// button, if the row has no button now).
function redrawLessons() {
  const list = $('lesson-list');
  const row = list.contains(document.activeElement) ? [...list.children].indexOf(document.activeElement.closest('.lesson-row')) : -1;
  renderLessons();

  if (row >= 0) (list.children[row]?.querySelector('button') || $('lesson-primary')).focus({ preventScroll: true });
}

// The device's copy and the account row are merged, and whatever the row lacks goes up.
function freshAccountSession() { return accounts.fresh(); }

// A row whose board summary doesn't describe it (written before the board column existed, by an older
// cached build, or without a part this build adds) is given one counted from that row's own data, when
// this load writes nothing itself. The write is conditional on the row's version, so a row another save
// has moved since is left alone. Not while an opt-out here is unconfirmed: this device shows nothing new.
function repairBoard(cloud) {
  if (sync.state.syncTimer || boardCurrent(cloud) || optOutPending(accounts.session)) return;
  account.repairBoard(accounts.session, boardColumn(normalizeProfile(cloud.data).runs, dailyKey(), cloud.updated_at), cloud.updated_at)
    .then((sent) => { if (sent) friendsBoard?.pushed(); }, () => {});
}

// Sharing turned on: saves made while an opt-out was still unconfirmed wrote no summary, so the row as
// it stands now is read and, if its summary doesn't describe it, repaired as on load.
async function repairBoardNow() {
  if (!accounts.session) return;

  try {
    accounts.session = await freshAccountSession();
    const cloud = await account.fetchCloudProfile(accounts.session);

    if (cloud) repairBoard(cloud);
  } catch {}
}

// Puts the account's profile in the device cache, then starts over as that user. A device copy kept
// at sign-out (edits that hadn't synced) is merged with the row rather than replaced.
async function enterAccount(newSession) {
  await accounts.replaceIdentity(newSession);
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
  const userId = accounts.session.user.id;
  // What this ends is the account's sign-in on the device as it stands now. That may be newer than this
  // tab's: a guest tab may have signed in to the account since, with no sign-out between. Every tab of the
  // account then signs out, as tabs that share one sign-in do.
  const stored = account.loadSession();

  if (!sync.state.signedOutElsewhere && stored?.user.id === userId) accounts.session = stored;
  const ending = accounts.session;

  // Another tab signed out, or in as someone else, before this sign-out (this tab has followed:
  // followSessionElsewhere), or signed out or in as anyone (the same account included) while it waits on
  // the network: this sign-out stops here, and the tab starts again as the device now is. Whatever the
  // device holds (another session included) stays.
  // Checked again after every wait; account.signOut checks the stored session once more.
  const overtaken = () => {
    const now = account.loadSession();

    if (!sync.state.signedOutElsewhere && (!now || account.sameSignIn(now, ending))) return false;

    // Followed: after hearing the cache removed, for a sign-out elsewhere that sent everything (finishFollow).
    if (sync.state.pendingSignOut === null) location.reload();

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
    sync.state.unsynced = true;
    synced = await pushProfile();

    if (overtaken()) return;

    // Unreachable (requests time out, see account.request) or refused: another round would only wait again.
    if (!synced && $('account').dataset.sync !== 'syncing') break;
  }

  // The cache goes only if it still holds what the last push sent, checked as it is removed.
  await account.signOut(accounts.session, { sentText: synced ? sync.state.sentText : null });
  await accounts.replaceIdentity(null);
  location.reload();
}

function closeAccountMenu() {
  $('account').open = false;
}

// Saves this device's copy of the profile as a file. Nothing is sent anywhere: the browser builds the file.
function exportData() {
  const file = account.exportCopy(learning.profile);
  const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
  link.click();
  URL.revokeObjectURL(url);
  announce('Your data was saved as a file on this device.');
}

// Account deletion. The server deletes first (account.deleteAccount); only a confirmed deletion
// signs this device out and clears it. Any failure leaves the session, cache and history untouched.

const DELETED_NOTICE = 'stilltype-account-deleted';


function openDeleteAccount() { deletion.open(); }

// Shown once, after the reload that follows a deletion. Nothing else about the account remains.
function noticeDeletedAccount() {
  let deleted = false;

  try {
    deleted = sessionStorage.getItem(DELETED_NOTICE) === '1';
    sessionStorage.removeItem(DELETED_NOTICE);
  } catch {}

  if (deleted && !accounts.session) showAccountToast('Account deleted. You’re in guest mode.', 'done');
}

function openAccountDialog(mode) { accounts.open(mode); }

// tone 'done' marks a completed action; the default marks a problem.
function showAccountToast(message, tone = 'problem') { accounts.notify(message, tone); announce(message); }

function bindAccount() {
  runSession.configure({ durationMs: sessionDurationMs, tick: () => updateLive(), startFx: (stamp) => primaryFx.ghost.run(stamp), started() {
    setRunning(true); setCustomLengthError(''); $('typing-status').innerHTML = '<span class="status-dot" aria-hidden="true"></span>In progress';
  } });
  recording.configure(showBest);
  learning.progress.commands.clear = historyClear.open;
  historyClear.configure({ dismissFilters: () => quoteFilters.dismiss(), passageLabel: () => ({ fresh: passage?.fresh, exhausted: passage?.exhausted }), labelPassage,
    forgetTraining() { trainingClears = account.clearsApplied(learning.profile); forgetTraining(); },
    afterClear() { renderHistory(); followHistory(); renderDaily(); followLessonProgress(); showBest(); armPace(); },
    afterUndo() { followStoredPreferences(); showBest(); armPace(); renderHistory(); followHistory(); renderDaily(); followLessonProgress(); },
  });
  release.configure(() => { markInterrupted(NOTICES.focusLost); compose.interrupt(NOTICES.composeFocusLost); markRaceInterrupted(); });
  importing.configure({ beforeOpen() {
    quoteFilters.dismiss(); settingsView.close(); markInterrupted(NOTICES.importOpened); compose.interrupt(NOTICES.composeImport); markRaceInterrupted();
  }, apply: importSettings, member: () => Boolean(accounts.session), announce });
  suggestion.configure({ beforeOpen() {
    quoteFilters.dismiss(); settingsView.close(); markInterrupted(NOTICES.suggestOpened); compose.interrupt(NOTICES.composeSuggest); markRaceInterrupted();
  }, screen: () => document.body.dataset.view || '' });
  deletion.configure({ dismissFilters: () => quoteFilters.dismiss(), beforeOpen() {
    if ($('account').contains(document.activeElement)) $('account-trigger').focus();
    closeAccountMenu(); markInterrupted(NOTICES.deleteOpened); markRaceInterrupted();
  }, confirmed(deleted) {
    clearTimeout(sync.state.syncTimer); sync.state.syncTimer = 0; sync.state.unsynced = false;
    inbox?.forget(); forgetRace(); friendsBoard?.forget(); accounts.session = null; account.forgetAccount(deleted); wipeHistory();

    try { sessionStorage.setItem(DELETED_NOTICE, '1'); } catch {}

    location.reload();
  } });
  accounts.configure({ beforeOpen: () => quoteFilters.dismiss(), enter: enterAccount, signOut: signOutAccount, exportData, deleteAccount: openDeleteAccount, toast: showAccountToast });
  const menu = $('account');

  // While the request is out, the dialog stays: its answer decides what happens next.
  

  document.addEventListener('pointerdown', (event) => {
    if (menu.open && !menu.contains(event.target)) closeAccountMenu();
  }, { signal: lifetime.signal });
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !menu.open) return;
    event.preventDefault();
    event.stopPropagation();
    closeAccountMenu();
    menu.querySelector('summary').focus();
  }, { signal: lifetime.signal });
  // Only one corner panel at a time; a keyboard open sends no pointerdown to close the other. This
  // runs as the menu opens: its toggle event comes a task later and would close a panel opened since.
  lifetime.observeMutation(() => {
    if (menu.open) { settingsView?.close(); $('inbox').open = false; }
  }, menu, { attributeFilter: ['open'] });
  // Hiding sends nothing: unsent changes wait in the device cache for the pending push or the next return
  // or load (a hidden page's keepalive write is capped at 64 KiB, far below a profile). Other devices'
  // changes come in when it is shown again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveRunCounts();
    else pullProfile();
  }, { signal: lifetime.signal });
  addEventListener('online', () => {
    if (!accounts.session) return;

    if (!sync.state.cloudChecked) syncOnLoad();
    else pullProfile({ force: true });

    if (sync.state.cloudChecked) friendsBoard?.resume();
  }, { signal: lifetime.signal });
  // Another tab signed in to this account saved: merge its copy. Only what the copy lacks is written back
  // (absorbCache), so tabs settle rather than echo each other. Mid-run the merge waits; the save at the
  // end of the run merges it then. While this tab follows a sign-out that sent everything, only that
  // sign-out's removal of the cache matters (finishFollow).
  addEventListener('storage', (event) => {
    if (!accounts.session) return;

    if (sync.state.pendingSignOut !== null) {
      finishFollow(event);

      return;
    }

    if (sync.state.signedOutElsewhere || followSessionElsewhere(event)) return;

    if (event.key !== account.profileKey(accounts.session.user.id)) return;

    if (runInProgress()) sync.state.cacheWaiting = true;
    else if (absorbCache()) showMerged();
  }, { signal: lifetime.signal });
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
  const userId = accounts.session.user.id;
  const current = account.loadSession()?.user.id;

  const signedOut = event.key === null
    || (event.key === account.signedOutKey(userId) && event.newValue !== null)
    || (event.key === account.profileKey(userId) && event.newValue === null)
    || (event.key === account.SESSION_KEY && (current ? current !== userId : account.signedOut(userId)));

  if (!signedOut) return false;
  sync.state.signedOutElsewhere = true;
  void accounts.replaceIdentity(null);
  // What this device knew of the account's board sharing goes with the sign-out, as in the tab that signed out.
  friendsBoard?.signOut();
  clearTimeout(sync.state.syncTimer);
  sync.state.syncTimer = 0;
  // A sign-out that sent everything removes the cache next: this tab waits to hear it (finishFollow).
  const sent = event.key === account.signedOutKey(userId) ? sentStamp(event.newValue) : null;

  if (sent !== null) sync.state.pendingSignOut = sent;
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
  const userId = accounts.session.user.id;
  const cacheRemoved = event.key === account.profileKey(userId) && event.newValue === null;
  const finished = cacheRemoved || event.key === null || (event.key === account.signedOutKey(userId) && event.newValue === null);

  if (!finished) return;

  if (cacheRemoved) account.restoreUnsent(userId, event.oldValue, sync.state.pendingSignOut, sync.state.cacheText);
  sync.state.pendingSignOut = null;

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

// Import from Monkeytype: its exported settings JSON, pasted or from a file, mapped by src/monkeytype.js.
// Each setting brought over is applied as a pick of it here (saveChoice), so it syncs to the account and
// outranks an older value from another device, as choosing it in settings would.
function openImport() { importing.open(); }

function importSettings(result) {
  const keys = Object.keys(result.preferences);
  const conditions = keys.some((key) => !DISPLAY_PREFERENCES.includes(key) && !['paceCaret', 'paceWpm'].includes(key));
  learning.preferences = validPreferences({ ...learning.preferences, ...result.preferences });

  if (keys.includes('mode')) customOpen = false;
  applyPreferences();
  setModeControls();
  // The correction rule and the older stop-on-error flag are one choice, saved together as setCorrection does.
  saveChoice(...keys, ...(keys.includes('correction') ? ['stopOnError'] : []));

  if (conditions && !runInProgress()) resetSession(keys.includes('mode') ? 'practice' : restartKind(), { leaveCompose: keys.includes('mode') });

}

// Feature suggestions go straight to Supabase (account.sendSuggestion), never linked to an account.


function openSuggest() { suggestion.open(); }

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

      if (!practice.attempt || practice.attempt.status === 'complete' || $('typing-input').disabled || staleRepeat()) resetSession('practice');
      else switchView('practice');
      $('typing-input').focus({ preventScroll: false });

      return;
    }

    const nav = event.target.closest('[data-nav]');

    if (nav) {
      event.preventDefault();
      navigate(nav.dataset.nav, { keep: true });

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
  }, { signal: lifetime.signal });
  $('mode-more').addEventListener('click', (event) => {
    if (event.target.closest('button')) $('mode-more').open = false;
  }, { signal: lifetime.signal });
  document.addEventListener('pointerdown', (event) => {
    if ($('mode-more').open && !$('mode-more').contains(event.target)) $('mode-more').open = false;
  }, { signal: lifetime.signal });
  $('custom-text').addEventListener('input', updateCustomState, { signal: lifetime.signal });
  $('custom-use').addEventListener('click', useCustomText, { signal: lifetime.signal });
  Object.assign(practice.choices, {
    chooseMode(mode) {
      customOpen = false;
      learning.preferences.mode = mode;
      setModeControls();
      saveChoice('mode');
      resetSession('practice', { focus: true, leaveCompose: true });
    },
    chooseLanguage(language) {
      learning.preferences.codeLanguage = language;
      setModeControls();
      saveChoice('mode', 'codeLanguage');
      resetSession('practice', { focus: true });
    },
    chooseLength(length) {
      if (learning.preferences.mode === 'time') learning.preferences.duration = length;
      else learning.preferences.count = length;
      setModeControls();
      saveChoice('mode', learning.preferences.mode === 'time' ? 'duration' : 'count');
      resetSession('practice', { focus: true });
    },
    punctuation(on) { learning.preferences.punctuation = on; setModeControls(); saveProfile(); resetSession('practice', { focus: true }); },
    adaptive(on) { learning.preferences.adaptive = on; setModeControls(); saveProfile(); resetSession('practice', { focus: true }); },
    compose: openCompose,
    custom: () => openCustom(!customOpen),
  });
  // Numbers sits beside the word list in settings and, like it, keeps a custom passage.
  onSetting('numbers-toggle', (value) => {
    const changed = Boolean(learning.preferences.numbers) !== (value === 'true');
    learning.preferences.numbers = value === 'true';
    saveChoice('numbers');

    if (!changed) return;
    applyPreferences();
    showBest();
    resetForCondition(restartKind());
  });
  onSetting('word-list', (value) => setWordList(value));
  onSetting('repeat-quotes-toggle', (value) => setRepeatQuotes(value === 'true'));
  onSetting('daily-goal', (value) => { learning.preferences.dailyGoal = Number(value); saveChoice('dailyGoal'); renderGoal(); });
  onSetting('train-focus', (value) => setTraining('trainFocus', value));
  onSetting('drill-length', (value) => setTraining('drillSeconds', Number(value)));
  onSetting('retest-toggle', (value) => setTraining('retest', value === 'true'));
  learning.progress.filters.commands.choose = chooseProgress;
  learning.progress.commands.calendar = () => openProgressDetail('calendar', { opener: () => $('week-movers').querySelector('.is-practice .mover-link') });
  learning.progress.commands.showAll = () => {
    showAllRuns();
    $('run-history').children[RECENT_RUNS]?.querySelector('summary').focus();
  };

  narrowColumn.addEventListener('change', () => renderGoal(), { signal: lifetime.signal });
  onSetting('font-size', (value) => { learning.preferences.fontSize = value; applyPreferences(); saveChoice('fontSize'); });
  onSetting('typing-font', (value) => { learning.preferences.typingFont = value; applyFonts(); saveChoice('typingFont'); });
  onSetting('app-font', (value) => { learning.preferences.appFont = value; applyFonts(); saveChoice('appFont'); });
  onSetting('speed-unit', (value) => setSpeedUnit(value));
  onSetting('word-highlight', (value) => setWordHighlight(value));
  onSetting('word-highlight-slide', (value) => setWordHighlightSlide(value === 'true'));
  keybindingEditor = settingsView.keybindings;
  keybindingEditor.configure({
    getBindings: () => learning.preferences.keybindings,
    onSave: (bindings) => { learning.preferences.keybindings = bindings; applyPreferences(); saveChoice('keybindings'); },
  });
  keybindingEditor.refresh();
  onSetting('wallpaper-style', wallpaper.style);
  detachWallpaper = wallpaper.attach({ layer: $('wallpaper'), surfaces: [$('typing-form'), $('compose-form')], reading: [$('live-stats'), $('typing-wrap'), ...document.querySelectorAll('.shortcut-row, .site-footer > *')] });
  settingsView.configure(() => keybindingEditor.stopRecording());
  $('settings-trigger').addEventListener('click', () => settingsView.open(), { signal: lifetime.signal });
  onSetting('live-toggle', (value) => { learning.preferences.liveMetrics = value === 'true'; applyPreferences(); saveChoice('liveMetrics'); });
  onSetting('keyboard-toggle', (value) => { learning.preferences.keyboard = value === 'true'; applyPreferences(); saveChoice('keyboard'); });
  onSetting('finger-toggle', (value) => { learning.preferences.fingerMap = value === 'true'; applyPreferences(); saveChoice('fingerMap'); });
  onSetting('layout-select', (value) => setLayout(value));
  onSetting('correction-select', (value) => setCorrection(value));
  onSetting('strict-space-toggle', (value) => setInputRule('strictSpace', value === 'true'));
  onSetting('quick-end-toggle', (value) => setInputRule('quickEnd', value === 'true'));
  onSetting('min-accuracy', (value) => setMinimum('minAccuracy', Number(value)));
  onSetting('min-wpm', (value) => setMinimum('minWpm', Number(value)));
  onSetting('theme-select', setThemeMode);
  onSetting('dark-theme', (value) => pickTheme('dark', value));
  onSetting('light-theme', (value) => pickTheme('light', value));
  themeEditor.configure({
    themes: () => readCustomThemes(learning.preferences.customThemes),
    currentTheme: shownTheme,
    preview: (colors) => (colors ? wearTheme(colors) : applyTheme()),
    save: saveCustomThemes,
    signedIn: () => Boolean(accounts.session) && !sync.state.signedOutElsewhere,
    generate: (vibe) => account.generateTheme(accounts.session, vibe),
    signIn: () => { settingsView.close(); openAccountDialog('signin'); },
  });
  $('settings-dialog').addEventListener('close', () => themeEditor.close({ focus: false }), { signal: lifetime.signal });
  prefersLight.addEventListener('change', () => { if (learning.preferences.theme === 'system') applyTheme(); }, { signal: lifetime.signal });
  onSetting('pace-select', (value) => setPaceCaret(value));
  $('pace-wpm').addEventListener('change', (event) => {
    const field = event.target;
    learning.preferences.paceWpm = clampPace(wpmFromSpeed(field.value, field.dataset.unit));
    field.dataset.shown = field.value;
    setPaceCaret('custom', { speed: true });
  }, { signal: lifetime.signal });
  // Left unsaved, it shows any speed or unit that arrived while it was being typed in (see showPace).
  $('pace-wpm').addEventListener('blur', showPace, { signal: lifetime.signal });
  onSetting('focus-toggle', (value) => { learning.preferences.focusMode = value === 'true'; applyPreferences(); saveChoice('focusMode'); });
  onSetting('tape-toggle', (value) => { learning.preferences.tape = value === 'true'; applyPreferences(); saveChoice('tape'); });
  onSetting('sound-select', (value) => setSound(value));
  // Dragging updates the level as it goes; the profile is saved once the slider settles.
  $('sound-volume').addEventListener('input', (event) => setSoundVolume(Number(event.target.value), { save: false }), { signal: lifetime.signal });
  $('sound-volume').addEventListener('change', () => saveChoice('soundVolume'), { signal: lifetime.signal });
  $('exit-focus').addEventListener('click', () => {
    learning.preferences.focusMode = false;
    applyPreferences();
    saveProfile();
    focusPractice();
  }, { signal: lifetime.signal });

  practice.connectNative(typingHost);

  for (const type of ['keydown', 'keyup']) $('typing-input').addEventListener(type, syncCapsLock, { signal: lifetime.signal });
  $('typing-input').addEventListener('blur', () => setCapsWarning(false), { signal: lifetime.signal });
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

    if (activationInput !== 'touch' || !['ready', 'running'].includes(practice.attempt?.status) || practice.attempt.conditions.inputClass === 'touch') return;
    practice.attempt.conditions.inputClass = 'touch';
    practice.attempt.conditions.layout = inputLayout('touch');
    setParts($('condition-line'), describeRun(practice.attempt));
    showBest();

    if (practice.attempt.status === 'ready') armPace();
  }, { capture: true, signal: lifetime.signal });
  document.addEventListener('keydown', (event) => {
    if (!event.target.matches?.(TEXT_FIELDS)) activationInput = 'physical-keyboard';
  }, { capture: true, signal: lifetime.signal });
  // Anything typed, in the passage or a field, counts for a Race still loading (see raceContext).
  document.addEventListener('beforeinput', () => { typedCount += 1; }, { capture: true, signal: lifetime.signal });
  $('restart-button').addEventListener('click', () => resetSession(practice.sessionKind, { focus: true }), { signal: lifetime.signal });
  practice.commands.watchReplay = () => practice.replay.open(practice.shownResult);
  practice.commands.runAgain = runAgain;

  // When a minimum ends a run (on the tick, its last character or its timer), the typist is mid-stride
  // and focus lands here. Until they pause, Space and Enter do nothing, so the keys already on their
  // way can't discard the result and start a new run.
  const heldAfterStop = () => {
    if (stopHold === null) return false;
    const stamp = now();

    if (stamp - stopHold >= STOP_HOLD_MS) {
      stopHold = null;

      return false;
    }

    stopHold = stamp;

    return true;
  };

  practice.commands.resultKeyDown = (event) => {
    if (heldAfterStop() && (event.key === ' ' || event.key === 'Enter')) event.preventDefault();
  };

  // Where Run again can't fit beside the score, the heading takes focus and Enter runs again from there.
  practice.commands.headingKeyDown = (event) => {
    const held = heldAfterStop();

    if (event.key !== 'Enter' || matchesAppBinding(event, learning.preferences.keybindings.restart)) return;
    event.preventDefault();

    if (!held && !event.repeat) runAgain();
  };

  practice.commands.resultKeyUp = (event) => { if (stopHold !== null && event.key === ' ') event.preventDefault(); };

  $('progress-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');

    if (tab) showProgressView(tab.dataset.viewTab);
  }, { signal: lifetime.signal });
  $('progress-tabs').addEventListener('keydown', moveProgressTab, { signal: lifetime.signal });
  $('take-standard').addEventListener('click', () => setTestShape('standard'), { signal: lifetime.signal });
  $('empty-standard').addEventListener('click', () => setTestShape('standard'), { signal: lifetime.signal });
  $('progress-more').addEventListener('click', (event) => {
    const link = event.target.closest('[data-progress-open]');

    if (link) openProgressDetail(link.dataset.progressOpen, { opener: link });
  }, { signal: lifetime.signal });
  $('progress-back').addEventListener('click', closeProgressDetail, { signal: lifetime.signal });
  $('more-movers').addEventListener('click', () => {
    progressState.moversOpen = !progressState.moversOpen;
    renderMovers(progressWeek);
  }, { signal: lifetime.signal });

  coarsePointer.addEventListener('change', () => renderKeys(heatRuns), { signal: lifetime.signal });
  $('training-conditions').addEventListener('change', renderTraining, { signal: lifetime.signal });
  $('train-path').addEventListener('scroll', pathEdges, { ...{ passive: true }, signal: lifetime.signal });
  $('start-daily').addEventListener('click', startDaily, { signal: lifetime.signal });
  // A finished retest is a run like any other, so its card waits on Practice with everything a result offers.
  learning.commands.back = () => {
    if (practice.shownResult?.kind !== 'retest' || practice.shownResult !== practice.attempt) {
      navigate('practice');

      return;
    }

    switchView('results');
    renderCard(practice.shownResult);
    // Its Drill action is drawn again too: a training setting may have changed while the comparison showed.
    renderResultDrill(practice.shownResult);
    focusResult($('run-again'));
  };

  $('mode-drill').addEventListener('click', toggleManualTarget, { signal: lifetime.signal });
  $('manual-target').addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = $('manual-target-input').value.trim();
    const valid = /^[a-z]{1,8}$/i.test(raw);
    $('manual-target-input').setAttribute('aria-invalid', String(!valid));
    $('manual-target-error').textContent = valid ? '' : 'Use 1–8 letters, no spaces or punctuation.';

    if (!valid) return;
    const target = normalizeManualTarget(raw);
    startDrill({ kind: 'manual', target, title: `Practice “${target}”` });
  }, { signal: lifetime.signal });

  $('ghost-offer').addEventListener('toggle', () => { if ($('ghost-offer').open && accounts.session) loadGhostFriends(); }, { signal: lifetime.signal });
  $('ghost-offer-form').addEventListener('submit', sendGhost, { signal: lifetime.signal });
  $('ghost-offer-friends').addEventListener('click', () => onlineRace?.openAdd(), { signal: lifetime.signal });
  $('ghost-result-action').addEventListener('click', () => {
    if (ghostRace?.state === 'failed') submitGhostRun();
    else if (RACE_AGAIN.includes(ghostRace?.state)) { ghostRace.run = null; resetSession('challenge', { focus: true }); }
  }, { signal: lifetime.signal });

  $('compete-setup').addEventListener('submit', (event) => { event.preventDefault(); startRace(); }, { signal: lifetime.signal });
  typingHost.attach($('race-input'), 'race');
  $('race-input').addEventListener('blur', markRaceInterrupted, { signal: lifetime.signal });
  $('start-next-player').addEventListener('click', () => {
    // A short unblur of the passage, then the typing stage takes over.
    const reveal = () => { $('race-handoff').hidden = true; $('race-handoff').classList.remove('is-revealing'); setupRacePlayer(); };

    if (reducedMotion.matches) {
      reveal();

      return;
    }

    $('race-handoff').classList.add('is-revealing');
    setTimeout(reveal, 200);
  }, { signal: lifetime.signal });
  $('race-again').addEventListener('click', () => { $('race-leaderboard').hidden = true; $('compete-setup').hidden = false; $('player-one-name').focus(); }, { signal: lifetime.signal });

  // Focus goes back to the version in the same task that closes the panel. The close event comes a task
  // later, when focus may already be back in the passage, and would take it from the keys being typed.

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;

    // A held space that submitted a run (quick end off) must not also press Run again.
    if (event.repeat && event.key === ' ' && document.activeElement === $('run-again')) {
      event.preventDefault();

      return;
    }

    if (event.target.closest('#quote-options [role="combobox"]')) {
      if (!matchesAppBinding(event, learning.preferences.keybindings.commands)) return;
      quoteFilters.dismiss();
    }

    const typing = document.activeElement === $('typing-input') || document.activeElement === $('race-input');

    if (typing && event.repeat && (event.key.length === 1 || ['Dead', 'Process'].includes(event.key))) {
      event.preventDefault();
      showInputNotice(document.activeElement === $('typing-input') ? 'primary' : 'race', NOTICES.repeat, { speak: false });

      return;
    }

    if (((event.isComposing || event.keyCode === 229) && !activeAccentComposition()) || event.getModifierState?.('AltGraph')) return;

    if (document.querySelector('dialog[open]')) {
      if ($('settings-dialog').open && event.key === 'Escape') return;

      if ($('settings-dialog').open && !keybindingEditor.isRecording()
        && !document.activeElement?.closest('input, textarea, select, [contenteditable]')
        && matchesAppBinding(event, learning.preferences.keybindings.commands)) {
        event.preventDefault();

        if (!event.repeat) palette.open();
      } else if ($('palette').open && matchesAppBinding(event, learning.preferences.keybindings.commands)) {
        event.preventDefault();

        // Open, it closes; fading out, it opens again.
        if (!event.repeat) palette.toggle();
      }

      return;
    }

    if ($('mode-more').open && event.key === 'Escape') {
      event.preventDefault();
      $('mode-more').open = false;
      $('mode-more-label').focus();

      return;
    }

    const menuOpen = $('account').open || $('inbox').open;

    if (menuOpen && event.key === 'Escape') return;
    const active = document.activeElement;
    const onTypingSurface = ['typing-input', 'race-input', 'online-input', 'compose-input'].includes(active?.id);
    const editable = active?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');

    if (!keybindingEditor.isRecording() && (!editable || onTypingSurface) && matchesAppBinding(event, learning.preferences.keybindings.commands)) {
      event.preventDefault();

      if (!event.repeat) palette.open();

      return;
    }

    if (menuOpen) return;

    if (learning.preferences.focusMode && (!editable || onTypingSurface) && matchesAppBinding(event, learning.preferences.keybindings.exitFocus)) {
      event.preventDefault();

      if (!event.repeat) {
        learning.preferences.focusMode = false;
        applyPreferences();
        saveProfile();
        focusPractice();
      }

      return;
    }

    if (composeOpen && active === $('compose-input') && matchesAppBinding(event, learning.preferences.keybindings.restart)
      && !(event.key === 'Enter' && compose.isRunning())) {
      event.preventDefault();

      if (!event.repeat) compose.restart();

      return;
    }

    if (quickRestart(event)) return;
    practice.keyboard.key(event.key);
  }, { capture: true, signal: lifetime.signal });
  document.addEventListener('keyup', () => practice.keyboard.key(null), { signal: lifetime.signal });
  window.addEventListener('blur', () => {
    practice.keyboard.key(null);
    markInterrupted(NOTICES.focusLost);
    compose.interrupt(NOTICES.composeFocusLost);
    markRaceInterrupted();
  }, { signal: lifetime.signal });

  // The chrome fades while typing; a real mouse nudge (not layout-induced jitter) brings it back.
  let pointer = null;
  document.addEventListener('pointermove', (event) => {
    const moved = pointer ? Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) : 0;

    if (!pointer || document.body.dataset.running !== 'true' || moved > 4) pointer = { x: event.clientX, y: event.clientY };

    if (moved > 4) showChrome(true);
  }, { signal: lifetime.signal });
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
  else if (practice.attempt?.status === 'running') resetSession(restartKind());
  customOpen = open;

  if (open) {
    if (!$('custom-text').value) $('custom-text').value = learning.preferences.customText || '';
    $('custom-order').value = learning.preferences.customOrder;
    updateCustomState();
  }

  setModeControls();

  if (open) $('custom-text').focus();
}

// "drill" in the more menu: a 1–8 letter target of your own, drilled at once.
function showManualTarget(open) {
  $('manual-target').hidden = !open;
  $('mode-drill').setAttribute('aria-expanded', String(open));

  if (open) $('manual-target-input').focus();
}

function toggleManualTarget() {
  showManualTarget($('manual-target').hidden);
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

  learning.preferences.customText = text;
  learning.preferences.customOrder = CUSTOM_ORDERS.includes($('custom-order').value) ? $('custom-order').value : 'as-written';
  saveChoice('customText', 'customOrder');
  customOpen = false;
  resetSession('custom', { focus: true });
  setModeControls();
}

function setTestShape(mode, length) {
  customOpen = false;
  learning.preferences.mode = mode;

  if (mode === 'time' && length) learning.preferences.duration = length;

  if (mode === 'words' && length) learning.preferences.count = length;
  setModeControls();
  saveChoice('mode', ...(length && mode !== 'quote' ? [mode === 'time' ? 'duration' : 'count'] : []));
  resetSession('practice', { focus: true, leaveCompose: true });
}

function togglePreference(key) {
  learning.preferences[key] = !learning.preferences[key];
  applyPreferences();
  saveProfile();

  if (document.body.dataset.view === 'practice') focusPractice();
}

function setCorrection(policy) {
  if (standardLocked()) return;
  const next = correctionPreference({ correction: policy });
  const changed = learning.preferences.correction !== next;
  learning.preferences.correction = next;
  learning.preferences.stopOnError = learning.preferences.correction === 'mandatory';
  saveChoice('correction', 'stopOnError');

  if (!changed) return;
  applyPreferences();

  // A lesson stays a lesson and custom text stays custom; any other session restarts as practice.
  if (document.body.dataset.view === 'practice') resetSession(practice.sessionKind === 'lesson' ? 'lesson' : restartKind());
}

function setSound(mode) {
  learning.preferences.sound = normalizeSoundMode(mode);
  applySoundPreferences();
  sounds.prepare();
  saveChoice('sound');
}

function setSoundVolume(volume, { save = true } = {}) {
  learning.preferences.soundVolume = normalizeSoundVolume(volume);
  applySoundPreferences();
  sounds.prepare();

  if (save) saveChoice('soundVolume');
}

// Display only: bests, comparisons and condition keys stay in wpm, so nothing is reset or re-keyed.
function setSpeedUnit(unit) {
  learning.preferences.speedUnit = unit;
  applyPreferences();
  saveChoice('speedUnit');
}

// Strict space and quick end change how a run is scored, so a change on the practice screen starts
// the session again as the same kind: a drill stays a drill. A session that can't take it (quick
// end in a timed run, the daily, a retest, custom text) carries on and the preference waits for a run it applies
// to; the switch's note says why. Other screens stay put, and a practice passage left waiting there
// is rebuilt when practice is shown again (navigate).
function setInputRule(key, enabled) {
  const changed = learning.preferences[key] !== enabled;
  learning.preferences[key] = enabled;
  applyPreferences();
  saveChoice(key);

  if (!changed) return;
  const limits = ruleLimits(ruleSession());

  if (limits.fixed || (key === 'quickEnd' && limits.quickEnd)) return;

  if (document.body.dataset.view === 'practice') resetSession(practice.sessionKind);
}

function activeAccentComposition() {
  return typingHost.accentCompositionActive;
}

function matchesAppBinding(event, binding) {
  return matchesBinding(event, binding, { allowAccentComposition: activeAccentComposition() });
}

// Restart only owns the typing surfaces, bare practice/results page, run-again and the result heading.
// Controls retain their native activation and Tab navigation; online rooms cannot restart.
function quickRestart(event) {
  if (!matchesAppBinding(event, learning.preferences.keybindings.restart)) return false;
  const view = document.body.dataset.view;
  const active = document.activeElement;
  const onInput = active === $('typing-input');
  const onLocalRace = active === $('race-input');
  const onPage = !active || active === document.body || active === document.documentElement;
  const onResult = event.key !== 'Tab' && view === 'results' && (active === $('run-again') || active === $('results-heading'));

  if (!onInput && !onLocalRace && !onResult && !(onPage && (view === 'practice' || view === 'results'))) return false;

  if (event.key === 'Enter' && (onLocalRace ? race.attempt : practice.attempt)?.status === 'running') return false;
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
  else resetSession(practice.sessionKind, { focus: true });
}

function runAgain() {
  if (practice.sessionKind === 'daily') startDaily();
  else resetSession(practice.sessionKind === 'missed' ? 'missed' : restartKind(), { focus: true, leaveCompose: true });
}

// The key that restarts from where focus sits. On the result card that is the focused run-again
// button (the palette hands focus back to it), which tab moves past and enter activates.
function restartHint() {
  return document.body.dataset.view === 'results' && learning.preferences.keybindings.restart === 'Tab' ? 'enter' : bindingLabel(learning.preferences.keybindings.restart);
}

// How Train trains. A drill or retest under way keeps what it started with; what Train would drill next follows at
// once, and so does an adaptive passage nobody has started, as one drawn next would.
function setTraining(key, value) {
  learning.preferences[key] = value;
  applyPreferences();
  saveChoice(key);
  showTraining();
}

// Every surface that shows what Train would drill asks the recommender again, after a training setting changes here
// or arrives from another device: the results card's drill, Train or its comparison's Next, and Patterns across runs.
// Each binds its button to what it shows. A drill or retest under way keeps what it started with. The lessons'
// hand-off states the drill's length. A waiting adaptive passage is drawn again for a new focus; a plain one is
// kept, so the plain passage that follows an adaptive run stays the baseline it was drawn to be.
function showTraining() {
  const view = document.body.dataset.view;

  if (view === 'learn') redrawLessons();

  if (view === 'results' && practice.shownResult) renderResultDrill(practice.shownResult);

  if (view === 'train') renderTrain();

  renderTraining();

  if (view === 'progress') renderWeek();

  if (view === 'practice' && staleAdaptive()) resetSession('practice');
}

// Repeat quotes changes only open practice's next quote, so a custom passage (or any other session) is kept.
function setRepeatQuotes(enabled) {
  const changed = learning.preferences.repeatQuotes !== enabled;
  learning.preferences.repeatQuotes = enabled;
  saveChoice('repeatQuotes');

  if (!changed) return;
  applyPreferences();

  if (practice.sessionKind !== 'practice' || passage?.fresh !== false || practice.attempt?.status !== 'ready') return;

  // A repeated passage that hasn't been started. Off swaps it for unseen text if any remains: here on Practice,
  // otherwise when Practice next opens (staleRepeat), so the setting never changes the view. Else reword its notice.
  if (staleRepeat() && document.body.dataset.view === 'practice') resetSession('practice');
  else setPassageNotice(repeatedTextNotice());
}

// Relabels the unstarted passage when the history that judged it changes: a clear, or undoing one.
function labelPassage(fresh, exhausted) {
  passage.fresh = fresh;
  passage.exhausted = exhausted;
  practice.attempt.fresh = fresh;
  setPassageNotice(repeatedTextNotice());
  setParts($('condition-line'), describeRun(practice.attempt));
}

// An unstarted repeated passage that repeats-off would have replaced with unseen text.
// An adaptive passage nobody has started, whose words another focus chose. It is drawn again on the practice
// screen, or on the way back to it, like a waiting repeat that repeats-off would replace.
function staleAdaptive() {
  return untouchedPractice() && Boolean(passage?.adaptive) && passage.trainFocus !== learning.preferences.trainFocus;
}

function staleRepeat() {
  return !learning.preferences.repeatQuotes && practice.sessionKind === 'practice' && practice.attempt?.status === 'ready' && passage?.fresh === false && !passage.exhausted;
}

// A ready practice run takes a new minimum in place; one already under way restarts with it.
function setMinimum(key, value) {
  const changed = learning.preferences[key] !== value;
  learning.preferences[key] = value;
  saveChoice(key);

  if (!changed) return;
  applyPreferences();

  if (practice.sessionKind !== 'practice' || !practice.attempt) return;

  if (practice.attempt.status === 'ready') {
    practice.attempt.minimums = practiceMinimums();
    setParts($('condition-line'), describeRun(practice.attempt));
  } else if (practice.attempt.status === 'running') resetSession('practice');
}

// A display preference like text size: it never restarts the run or enters the test conditions.
function setWordHighlight(mode) {
  learning.preferences.wordHighlight = normalizeWordHighlight(mode);
  applyPreferences();
  saveChoice('wordHighlight');
}

function setWordHighlightSlide(on) {
  const turnedOn = on && !learning.preferences.wordHighlightSlide;
  learning.preferences.wordHighlightSlide = on;
  applyPreferences();

  // The preview shows what was turned on: its highlight slides in from the word before.
  if (turnedOn) placePreviewGlide({ from: -1 });
  saveChoice('wordHighlightSlide');
}

// A test condition changed in settings prepares the next practice passage wherever the person is, and shows
// it only where they are already practising (the run card counts: it sits on the practice screen). Train,
// Progress, Challenge and the lessons stay as they are behind the dialog, with focus left in it.
function resetForCondition(kind) {
  const practising = ['practice', 'results'].includes(document.body.dataset.view);

  return resetSession(kind, { focus: practising, show: practising });
}

function setWordList(id, kind = restartKind()) {
  if (!wordListIds.includes(id)) return;
  const changed = learning.preferences.wordList !== id;
  learning.preferences.wordList = id;
  saveChoice('wordList');

  if (!changed) return;
  applyPreferences();
  resetForCondition(kind);
}

function inPractice(change) {
  const kind = restartKind();
  navigate('practice');
  change(kind);
}

// "custom time…" / "custom words…": the hint shows the custom value in use, or the one remembered.
function customLengthCommand(mode) {
  const spec = LENGTHS[mode];
  // As for the presets, no length is current during a custom text session.
  const current = comparableKind(practice.sessionKind) && learning.preferences.mode === mode && !isPresetLength(mode, learning.preferences[spec.key]);
  const value = current ? learning.preferences[spec.key] : learning.preferences[spec.customKey];

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
  const changed = learning.preferences.layout !== next;
  learning.preferences.layout = next;
  applyPreferences();
  saveChoice('layout');

  if (changed) resetForCondition(kind);
}

// The finger map is drawn on the on-screen keyboard, so turning it on shows the keyboard too.
function toggleFingerMap() {
  const show = !(learning.preferences.keyboard && learning.preferences.fingerMap);
  learning.preferences.fingerMap = show;

  if (show) learning.preferences.keyboard = true;
  applyPreferences();
  saveChoice('fingerMap', ...(show ? ['keyboard'] : []));

  if (document.body.dataset.view === 'practice') $('typing-input').focus({ preventScroll: true });
}

// A jump from the palette lands where the screen starts: the passage on Practice, the heading elsewhere.
function jumpTo(view) {
  // Progress is its overview, from one of its own detail views too, as from any other screen (TOB-448).
  if (view === 'progress' && document.body.dataset.view === 'progress' && progressState.detail) {
    progressState.detail = '';
    detailOpener = null;
    renderHistory();
  }

  navigate(view, { keep: true });

  if (view !== 'practice') $(`${view}-heading`).focus();
  else if (composeOpen) compose.focus();
  else $('typing-input').focus({ preventScroll: true });
}

function paletteCommands(query) {
  const onOff = (value) => (value ? 'on' : 'off');
  const missedWords = recurringMissedWords(learning.profile.runs).words.length;
  // The friends board's switch: on, off, or null (no hint) before this device has read the board.
  const shared = friendsBoard?.sharing ?? null;
  // During a custom session, a ghost race or composing no test shape is current (a custom session marks "custom text").
  const shape = (mode, length) => !composeOpen && comparableKind(practice.sessionKind) && learning.preferences.mode === mode && (['quote', 'standard', 'book'].includes(mode) || (mode === 'time' ? learning.preferences.duration : learning.preferences.count) === length);
  // The standard recipe fixes these; like quote mode, the palette leaves out what can't change.
  const fixedText = ['quote', 'code', 'book'].includes(learning.preferences.mode) || standardLocked();

  const commands = [
    ...[['practice', 'practice'], ['train', 'train'], ['progress', 'progress'], ['compete', 'challenge']].map(([view, label]) => ({
      group: 'go to', label, keywords: `${view} open view page`, hint: document.body.dataset.view === view ? 'here' : '', on: document.body.dataset.view === view, run: () => jumpTo(view),
    })),
    ...[['runs', 'runs and drills', 'history list retests comparisons'], ['keys', 'keys and pairs', 'heatmap patterns across runs'], ['calendar', 'practice calendar', 'daily goal streak minutes days'], ['standard', 'your standard score', 'standard test best median']].map(([detail, label, keywords]) => ({
      group: 'go to', label, keywords: `progress ${keywords}`, hint: document.body.dataset.view === 'progress' && progressState.detail === detail ? 'here' : '',
      run: () => { navigate('progress'); openProgressDetail(detail); },
    })),
    { group: 'go to', label: 'friends board', keywords: 'leaderboard compare daily week practice minutes friends bests personal best', disabled: Boolean(onlineRace?.liveRoomId), run: () => { onlineRace.openBoard(); $(onlineRace.mode === 'daily' ? 'friends-board-heading' : 'compete-heading').focus(); } },
    { group: 'go to', label: 'learn to type', keywords: 'lessons beginner keys fingers home row', hint: document.body.dataset.view === 'learn' ? 'here' : '', on: document.body.dataset.view === 'learn', run: openLessons },
    { group: 'test', label: 'restart test', keywords: 'reset again new passage', hint: restartHint(), run: restartTest },
    { group: 'test', label: 'daily challenge', keywords: 'today shared passage daily quote', run: startDaily },
    ...(lessonsComplete(learning.profile.lessons) ? [] : [{ group: 'test', label: `next lesson · ${LESSONS[nextLessonIndex(learning.profile.lessons)].keys.join(' ')}`, keywords: 'learn to type beginner keys fingers', run: () => startLesson(nextLessonIndex(learning.profile.lessons)) }]),
    { group: 'test', label: 'practice words you keep missing', keywords: 'missed words mistakes errors practise recurring list', hint: `${missedWords} words`, disabled: missedWords < 2, run: practiseRecurringWords },
    ...LENGTHS.time.presets.map((length) => ({ group: 'test', label: `time · ${length} seconds`, keywords: `timed ${length}s`, hint: shape('time', length) ? 'current' : '', on: shape('time', length), run: () => setTestShape('time', length) })),
    customLengthCommand('time'),
    ...LENGTHS.words.presets.map((length) => ({ group: 'test', label: `words · ${length} words`, keywords: `count ${length}`, hint: shape('words', length) ? 'current' : '', on: shape('words', length), run: () => setTestShape('words', length) })),
    customLengthCommand('words'),
    { group: 'test', label: 'custom text', keywords: 'own text paste bring your passage', hint: practice.sessionKind === 'custom' ? 'current' : '', on: practice.sessionKind === 'custom', run: () => { navigate('practice'); openCustom(true); } },
    { group: 'test', label: 'quote', keywords: 'passage original text', hint: shape('quote') ? 'current' : '', on: shape('quote'), run: () => setTestShape('quote') },
    { group: 'test', label: 'book', keywords: `novel page read ${BOOKS.map((book) => book.name).join(' ')}`, hint: shape('book') ? 'current' : '', on: shape('book'), run: () => setTestShape('book') },
    { group: 'test', label: 'composing practice', keywords: 'compose write writing free typing prompt own words', hint: composeOpen ? 'current' : '', on: composeOpen, run: openCompose },
    { group: 'test', label: 'another prompt', keywords: 'compose composing writing new different prompt skip', disabled: !composeOpen, run: () => { switchView('practice'); compose.another(); } },
    { group: 'test', label: 'standard test · 60 seconds', keywords: `standard score real world fixed recipe benchmark ${recipeLabel()}`, hint: shape('standard') ? 'current' : recipeLabel(), on: shape('standard'), run: () => setTestShape('standard') },
    { group: 'test', label: 'punctuation', keywords: 'capitals commas periods', hint: onOff(learning.preferences.punctuation), on: learning.preferences.punctuation, disabled: fixedText, run: () => { learning.preferences.punctuation = !learning.preferences.punctuation; applyPreferences(); saveProfile(); resetSession(restartKind(), { focus: true }); } },
    { group: 'test', label: 'numbers', keywords: 'digits figures', hint: onOff(learning.preferences.numbers), on: Boolean(learning.preferences.numbers), disabled: fixedText, run: () => { learning.preferences.numbers = !learning.preferences.numbers; applyPreferences(); saveProfile(); resetSession(restartKind(), { focus: true }); } },
    ...wordListIds.map((id) => ({ group: 'test', label: `word list · top ${id}`, keywords: 'common words vocabulary 200 1000 5000 10000 monkeytype easier harder', hint: learning.preferences.wordList === id ? 'current' : '', on: learning.preferences.wordList === id, disabled: fixedText, run: () => inPractice((kind) => setWordList(id, kind)) })),
    ...layoutIds.map((id) => ({ group: 'test', label: `layout · ${layoutLabel(id)}`, keywords: 'keyboard alternative remap', hint: learning.preferences.layout === id ? 'current' : '', on: learning.preferences.layout === id, run: () => setLayout(id) })),
    ...[['off', 'off'], ['best', 'personal best'], ['average', 'average'], ['last', 'last run'], ['custom', 'custom']].map(([mode, name]) => (
      { group: 'test', label: `pace caret: ${name}`, keywords: 'ghost pacer pace caret', hint: learning.preferences.paceCaret === mode ? 'on' : '', on: learning.preferences.paceCaret === mode, run: () => setPaceCaret(mode) })),
    ...Object.entries(CORRECTION_LABELS).map(([policy, name]) => ({ group: 'test', label: `correction · ${policy === 'relaxed' ? 'free' : name}`, keywords: 'mistakes correction continue stop error backspace fail expert master confidence', hint: learning.preferences.correction === policy ? 'current' : '', on: learning.preferences.correction === policy, disabled: standardLocked(), run: () => setCorrection(policy) })),
    { group: 'test', label: 'repeat quotes', keywords: 'seen again same quote passage score chase replay', hint: onOff(learning.preferences.repeatQuotes), on: learning.preferences.repeatQuotes, disabled: learning.preferences.mode !== 'quote', run: () => setRepeatQuotes(!learning.preferences.repeatQuotes) },
    { group: 'test', label: 'strict space', keywords: 'space bar early skip word mistakes input', hint: onOff(learning.preferences.strictSpace), on: learning.preferences.strictSpace, run: () => setInputRule('strictSpace', !learning.preferences.strictSpace) },
    { group: 'test', label: 'quick end', keywords: 'finish last word end mistakes submit confirm', hint: onOff(learning.preferences.quickEnd), on: learning.preferences.quickEnd, disabled: Boolean(ruleLimits(ruleSession()).quickEnd), run: () => setInputRule('quickEnd', !learning.preferences.quickEnd) },
    ...MIN_ACCURACY_OPTIONS.map((value) => ({ group: 'test', label: `minimum accuracy · ${value ? `${value}%` : 'off'}`, keywords: 'min acc threshold fail stop below continue', hint: learning.preferences.minAccuracy === value ? 'current' : '', on: learning.preferences.minAccuracy === value, run: () => setMinimum('minAccuracy', value) })),
    ...MIN_WPM_OPTIONS.map((value) => ({ group: 'test', label: `minimum speed · ${value ? formatSpeed(value) : 'off'}`, keywords: 'min wpm cpm pace threshold fail stop below continue', hint: learning.preferences.minWpm === value ? 'current' : '', on: learning.preferences.minWpm === value, run: () => setMinimum('minWpm', value) })),
    ...FOCUSES.map((focus) => ({ group: 'train', label: `train focus · ${focus}`, keywords: `training drill target weak pairs ${FOCUS_KEYWORDS[focus]}`, hint: learning.preferences.trainFocus === focus ? 'current' : '', on: learning.preferences.trainFocus === focus, run: () => setTraining('trainFocus', focus) })),
    ...DRILL_LENGTHS.map((seconds) => ({ group: 'train', label: `drill length · ${seconds} seconds`, keywords: 'training drill time duration session long short', hint: learning.preferences.drillSeconds === seconds ? 'current' : '', on: learning.preferences.drillSeconds === seconds, run: () => setTraining('drillSeconds', seconds) })),
    { group: 'train', label: 'retest after drill', keywords: 'training drill retest fresh text compare comparison', hint: onOff(learning.preferences.retest), on: learning.preferences.retest, run: () => setTraining('retest', !learning.preferences.retest) },
    ...['system', 'dark', 'light'].map((mode) => ({ group: 'display', label: `theme · ${mode}`, keywords: 'colour color mode appearance', hint: themeMode() === mode ? 'current' : '', on: themeMode() === mode, run: () => setThemeMode(mode) })),
    ...[['dark', DARK_THEMES], ['light', LIGHT_THEMES]].flatMap(([mode, themes]) => [
      ...themes.map((theme) => [theme, theme]),
      ...readCustomThemes(learning.preferences.customThemes).filter((custom) => colorsMode(custom.colors) === mode).map((custom) => [custom.id, custom.name]),
    ].map(([theme, name]) => ({ group: 'display', label: `${mode} theme · ${name}`, keywords: 'colour color appearance', hint: themeFor(mode) === theme ? 'current' : '', on: themeFor(mode) === theme, run: () => pickTheme(mode, theme) }))),
    ...[['22', 'small'], ['28', 'medium'], ['36', 'large']].map(([size, name]) => ({ group: 'display', label: `text size · ${name}`, keywords: 'font passage bigger smaller', hint: learning.preferences.fontSize === size ? 'current' : '', on: learning.preferences.fontSize === size, run: () => { learning.preferences.fontSize = size; applyPreferences(); saveChoice('fontSize'); } })),
    ...TYPING_FONTS.map((font) => ({ group: 'display', label: `typing font · ${fontName(font)}`, keywords: 'typeface passage monospace serif sans', hint: learning.preferences.typingFont === font ? 'current' : '', on: learning.preferences.typingFont === font, run: () => { learning.preferences.typingFont = font; applyFonts(); saveChoice('typingFont'); } })),
    ...APP_FONTS.map((font) => ({ group: 'display', label: `app font · ${fontName(font)}`, keywords: 'typeface interface serif sans', hint: learning.preferences.appFont === font ? 'current' : '', on: learning.preferences.appFont === font, run: () => { learning.preferences.appFont = font; applyFonts(); saveChoice('appFont'); } })),
    // Named "this word" / "next word" so no mode reads like the palette's "current" hint.
    ...[['off', 'off'], ['current', 'this word'], ['next', 'next word']].map(([mode, name]) => ({ group: 'display', label: `word highlight · ${name}`, keywords: 'tint emphasis reading ahead', hint: learning.preferences.wordHighlight === mode ? 'current' : '', on: learning.preferences.wordHighlight === mode, run: () => setWordHighlight(mode) })),
    { group: 'display', label: 'word highlight · slide', keywords: 'glide smooth motion animate', hint: onOff(learning.preferences.wordHighlightSlide), on: learning.preferences.wordHighlightSlide, disabled: learning.preferences.wordHighlight === 'off', run: () => setWordHighlightSlide(!learning.preferences.wordHighlightSlide) },
    { group: 'display', label: 'one-line tape', keywords: 'tape mode single line passage layout scroll', hint: onOff(learning.preferences.tape), on: learning.preferences.tape, run: () => togglePreference('tape') },
    ...[['wpm', 'words'], ['cpm', 'characters']].map(([unit, per]) => ({ group: 'display', label: `speed unit · ${unit}`, keywords: `${per} per minute speed measure`, hint: learning.preferences.speedUnit === unit ? 'current' : '', on: learning.preferences.speedUnit === unit, run: () => setSpeedUnit(unit) })),
    { group: 'display', label: 'live metrics', keywords: 'wpm accuracy while typing', hint: onOff(learning.preferences.liveMetrics), on: learning.preferences.liveMetrics, run: () => togglePreference('liveMetrics') },
    { group: 'display', label: 'keyboard', keywords: 'keys layout', hint: onOff(learning.preferences.keyboard), on: learning.preferences.keyboard, run: () => togglePreference('keyboard') },
    { group: 'display', label: 'finger map', keywords: 'keyboard fingers touch typing hands which finger', hint: onOff(learning.preferences.keyboard && learning.preferences.fingerMap), on: learning.preferences.keyboard && learning.preferences.fingerMap, run: toggleFingerMap },
    { group: 'display', label: 'focus mode', keywords: 'zen hide distraction', hint: onOff(learning.preferences.focusMode), on: learning.preferences.focusMode, run: () => { navigate('practice', { keep: true }); togglePreference('focusMode'); } },
    { group: 'display', label: 'import Monkeytype settings…', keywords: 'monkeytype import settings config json migrate', run: openImport },
    ...SOUND_MODES.map((mode) => ({ group: 'sound', label: `sound · ${SOUND_LABELS[mode]}`, keywords: 'audio typing key clicks error tick mute volume', hint: learning.preferences.sound === mode ? 'current' : '', on: learning.preferences.sound === mode, run: () => setSound(mode) })),
    ...[25, 50, 75, 100].map((volume) => ({ group: 'sound', label: `sound volume · ${volume}%`, keywords: 'audio loud quiet louder quieter', hint: learning.preferences.soundVolume === volume ? 'current' : '', on: learning.preferences.soundVolume === volume, disabled: learning.preferences.sound === 'off', run: () => setSoundVolume(volume) })),
    { group: 'account', label: 'share on friends board', keywords: 'friends board leaderboard privacy opt in out publish stop sharing', hint: accounts.session ? (shared === null ? '' : onOff(shared)) : 'sign in', on: Boolean(accounts.session && shared), disabled: !accounts.session || Boolean(onlineRace?.liveRoomId), run: () => { onlineRace.openBoard(); friendsBoard.setShare(!friendsBoard.sharing); } },
    { group: 'account', label: 'export my data', keywords: 'download backup json history runs take out privacy', run: exportData },
    ...(accounts.session
      ? [
        { group: 'account', label: 'sign out', keywords: `log out logout ${accounts.session.user.email}`, hint: accounts.session.user.email, run: signOutAccount },
        { group: 'account', label: 'delete account…', keywords: 'remove erase close account data privacy', run: openDeleteAccount },
      ]
      : [
        { group: 'account', label: 'create account…', keywords: 'sign up register save login', run: () => openAccountDialog('create') },
        { group: 'account', label: 'sign in…', keywords: 'log in login account', run: () => openAccountDialog('signin') },
        { group: 'account', label: 'continue with Google', keywords: 'sign in log in login google', run: () => accounts.google() },
      ]),
    { group: 'help', label: 'keybindings…', keywords: 'settings shortcuts restart keyboard', run: () => { settingsView.open('shortcuts', $('palette-trigger')); $('keybinding-restart').focus(); } },
    { group: 'help', label: 'suggest a feature…', keywords: 'feedback idea request feature', run: openSuggest },
    { group: 'local data', label: 'clear local history…', keywords: 'delete reset erase', disabled: !hasAnyHistory(), run: () => { navigate('progress'); $('clear-history').click(); } },
  ];

  // Only an exact word finds this one.
  if (query === 'ghost') commands.unshift({ group: 'secret', secret: true, label: 'ghost pacer', hint: onOff(ghostOn()), on: ghostOn(), run: toggleGhost });

  return commands;
}

function bindPalette() {
  $('palette-trigger').addEventListener('click', () => palette.open(), { signal: lifetime.signal });
  palette.configure({
    getCommands: paletteCommands,
    onOpen: () => {
      quoteFilters.dismiss();
      settingsView?.close();
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
  setParts($('egg-feedback'), on ? ['Ghost pacer · ', speedFigure(pace.wpm), pace.fromBest ? ' (your best)' : ''] : 'Ghost off');
  $('egg-toast').hidden = false;
  $('egg-toast').classList.toggle('is-solo', $('history-toast').hidden);
  clearTimeout(toggleGhost.timer);
  toggleGhost.timer = setTimeout(() => { $('egg-toast').hidden = true; }, 3000);
  announce($('egg-feedback').textContent);
  setPaceCaret(on ? 'best' : 'off');
}

// A focused input takes the sequence's "b" and starts the run; restart the same passage clean.
const stopSequence = listenForSequence(() => {
  toggleGhost();

  if (practice.attempt?.status === 'running' && document.body.dataset.view === 'practice') resetSession(practice.sessionKind, { focus: true, selectedPassage: passage });
});

let resizeFrame = 0;

// Everything placed from letter widths: after a resize, a font choice, or a font file arriving.
function relayoutText() {
  // On one line, crossing the 760px breakpoint changes the text size, which the trim spacer cannot follow.
  if (onTape()) primaryTextView?.restore();
  primaryFx.relayout();
  raceFx.relayout();
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => updateGlides({ instant: true }));
}

addEventListener('resize', () => {
  relayoutText();
  scrollablePath();
}, { signal: lifetime.signal });

document.fonts?.addEventListener?.('loadingdone', () => { measureTypingBaseline(); relayoutText(); }, { signal: lifetime.signal });

// Both observers below redraw in the next frame: a redraw resizes the box it observes, and doing that
// inside the observer's own callback is a resize loop, which browsers report as an error.
// The graph is drawn at its pixel size, so redraw whenever that changes, including when results
// comes back into view after a resize on another screen.
let graphFrame = 0;

lifetime.observeResize(() => {
  cancelAnimationFrame(graphFrame);
  graphFrame = requestAnimationFrame(() => {
    const graph = $('speed-graph');
    const width = Math.round(graph.clientWidth);

    // Sub-pixel layout settling is ignored so it cannot cut the first draw short.
    if (!practice.shownResult || !width || Math.abs(Number(graph.querySelector('svg')?.getAttribute('width')) - width) <= 1) return;
    renderSpeedGraph(graph, practice.shownResult, { animate: false });
  });
}, $('speed-graph'));

// The shown view's charts, drawn again at a new width.
let viewsWidth = 0;
let viewsFrame = 0;

lifetime.observeResize(() => {
  cancelAnimationFrame(viewsFrame);
  viewsFrame = requestAnimationFrame(() => {
    const screen = $('progress-screen');

    if (!screen.clientWidth || viewsWidth === screen.clientWidth) return;
    viewsWidth = screen.clientWidth;
    drawProgressView();
  });
}, $('progress-screen'));

const isMac = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform || '');

document.querySelectorAll('.mod-key').forEach((key) => { key.textContent = isMac ? '⌘' : 'ctrl'; });

compose.configure({
  playKeySound: (outcome) => sounds.play(outcome),
  setRunning, announce, uid,
  signedIn: () => Boolean(accounts.session),
  save(record) {
    learning.profile.compositions.push(record);
    learning.profile.practiceDays = recordPracticeTime(learning.profile.practiceDays, record.at, record.activeMs);

    return saveProfile();
  },
});

quoteFilters.configure({
  read: () => learning.preferences,
  commit(key, value, { focus, trigger }) {
    learning.preferences[key] = value;
    saveChoice(key);
    resetSession('practice', { focus });

    if (focus && $('typing-input').disabled) trigger.focus();
  },
});

$('mode-more').addEventListener('toggle', () => {
  if ($('mode-more').open) quoteFilters.dismiss();
}, { signal: lifetime.signal });

$('quote-options').addEventListener('click', () => { $('mode-more').open = false; }, { signal: lifetime.signal });

$('book-options').addEventListener('click', () => { $('mode-more').open = false; }, { signal: lifetime.signal });


renderKeyboard();

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

resetSession('practice', { focus: matchMedia('(hover: hover) and (pointer: fine)').matches });

inbox.configure({
  isRunning: runInProgress,
  getSession: () => accounts.session,
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
friendsBoard.configure({
  getSession: () => accounts.session,
  dailyKey,
  // Which shape the bests picker opens on: the one you have run most (src/friends-board.js defaultShape).
  runs: () => learning.profile.runs,
  signIn: () => openAccountDialog('signin'),
  // The button that asks for this goes with the board, so Add a friend opens with its email field focused.
  openOnline: () => onlineRace.openAdd(),
  onShared: repairBoardNow,
});

onlineRace.configure({
  rankCard: challenge.rankCard, review: challenge.review, people: challenge.people, quick: challenge.quick,
  getSession: () => accounts.session,
  inbox,
  board: friendsBoard,
  signIn: () => openAccountDialog('signin'),
  navigate, renderText, updateCharacterStates, setRunning, announce,
  wireTyping: wireOnlineTyping,
  updateGlide,
  ownBest: () => Boolean(ownBestRun()),
  raceOwnBest: startOwnGhost,
  raceGhost: startGhostRace,
  // What plain Challenge races: the practice setup, and the session it is in (custom text, compose or a drill
  // are practice's own, so a race falls back to its default).
  practice: () => ({ mode: learning.preferences.mode, duration: learning.preferences.duration, count: learning.preferences.count, punctuation: learning.preferences.punctuation,
    numbers: learning.preferences.numbers, wordList: learning.preferences.wordList, quoteLength: learning.preferences.quoteLength, difficulty: learning.preferences.difficulty, adaptive: learning.preferences.adaptive,
    session: composeOpen ? 'compose' : customOpen || practice.sessionKind === 'custom' ? 'custom' : practice.sessionKind === 'drill' ? 'drill' : 'practice' }),
  // The one-keyboard tab makes the race the session the rule switches act on.
  onModeChange: syncRules,
  onPassageSeen(id) {
    if (!id || learning.profile.seenTextIds.includes(id)) return;
    learning.profile.seenTextIds.push(id);
    saveProfile();
  },
});

updateGlides({ instant: true });

// Literata arrives after first paint; remeasure everything that depends on glyph widths.
document.fonts?.ready.then(() => { primaryFx.relayout(); updateGlides({ instant: true }); });

console.info('stilltype · ↑ ↑ ↓ ↓ ← → ← → b a');

if (!sync.state.storageAvailable) announce('Storage is unavailable. Results last only in this tab.');

noticeDeletedAccount();

completeAuthRedirect();

syncOnLoad();

inbox.refresh();

// Refresh the day label and the practice calendar when a tab returns, and across midnight without reloading.
// On Progress the whole page moves to the new day, so its figures, charts and list keep one window. That
// reads the day Progress was last drawn for, not the calendar's: a breakpoint or goal change redraws only
// the calendar, and would otherwise hide the new day from this check.
const refreshGoalDay = () => {
  const today = dayKey(new Date());

  if (document.body.dataset.view === 'progress' && today !== historyDay) renderHistory();
  else if (today !== goalDay) renderGoal();
};

setInterval(() => {
  if (document.body.dataset.view === 'compete') { renderDaily(); friendsBoard.rollover(); onlineRace.tick(); }

  if (document.body.dataset.view === 'progress') refreshGoalDay();
}, 30000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { renderDaily(); friendsBoard.rollover(); refreshGoalDay(); }
}, { signal: lifetime.signal });

// Offline shell (sw.js): installable and playable without a connection. Skipped on localhost so local
// edits are never served stale; Supabase and other origins are never cached.
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  Promise.resolve(navigator.serviceWorker.register('/sw.js')).catch(() => {});
}

return {
  async dispose() {
    lifetime.dispose();
    stopSequence();
    typingHost.dispose();
    runSession.dispose();
    onlineRace.dispose();
    practice.replay.dispose();
    primaryFx.dispose();
    raceFx.dispose();
    sounds.dispose();
    compose.dispose();
    challenge.quick.dispose();
    challenge.review.dispose();
    challenge.rankCard.clear();
    palette.dispose();
    detachWallpaper?.();
    wallpaper.dispose();
    themeEditor.dispose();
    accounts.dispose();
    sync.dispose();
    deletion.dispose();
    suggestion.dispose();
    importing.dispose();
    historyClear.dispose();
    inbox.dispose();
    friendsBoard.dispose();
    await disposePageWork();
  },
};

}

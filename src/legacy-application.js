import { createLoopHistory } from './loop-history.js';
import { createSessionRules } from './session-rules.js';
import { createProgressHistory } from './progress-history.js';
import { createGhostLaunch } from './ghost-launch.js';
import { createLessonController } from './lesson-controller.js';
import { createAccountTransitions } from './account-transitions.js';
import { createDisplayPreferences } from './display-preferences.js';
import { createControlGlides } from './control-glide.js';
import { createTrainingPolicy, CODE_DRILL_NOTE } from './training-policy.js';
import { createTrainingResults } from './training-results.js';
import { createInputPresentation } from './input-presentation.js';
import { createPracticeProgress } from './progress-practice.js';
import { createPracticeConditions } from './practice-conditions.js';
import { copyParts, plain } from './native-copy.js';
import { createApplicationLifetime } from './application-lifetime.js';
import { startPageWork, disposePageWork } from './async-runtime.js';
import { flushSync } from 'react-dom';
import { createInputController } from './input.js';
import { NOTICES } from './input-notices.js';
import { renderText, updateCharacterStates } from './passage-view.js';
import {
  CHARS_PER_WORD,
  CORPUS_VERSION,
  RATE_FLOOR_MS,
  STANDARD_VERSION,
  conditionKey,
  createAttempt,
  inputRules,
  DRILL_SECONDS,
  normalizeCustomText,
  orderCustomText,
  correctionPreference,
  selectPassage,
  standardConditions,
  consistency,
  characterBreakdown,
  wordHistory,
} from './typing.js';
import { wordListIds } from './words.js';
import { codePassage } from './code-snippets.js';
import { BOOKS, BOOK_VERSION, bookPage, bookPlace, openBook } from './books.js';
import { LENGTHS, isPresetLength } from './lengths.js';
import { layoutIds, layoutLabel, normalizeLayout } from './layouts.js';
import { normalizeWordHighlight } from './word-highlight.js';
import { APP_FONTS, TYPING_FONTS, fontName } from './fonts.js';
import { createTypingFx, createWordGlide } from './motion.js';
import { SOUND_LABELS, SOUND_MODES, createSounds, normalizeSoundMode, normalizeSoundVolume } from './sound.js';
import { renderSpeedGraph } from './graph.js';
import { readCustomThemes, themeMode as colorsMode } from './custom-themes.js';
import { matchesBinding, bindingLabel } from './keybindings.js';
import { listenForSequence } from './egg.js';
import * as account from './account.js';
import { boardColumn, boardCurrent, optOutPending } from './friends-board.js';
import { forgetRace, listRaceInvites } from './multiplayer.js';
import { listChallenges } from './ghost-race.js';
import { DEFAULT_POLICY, FOCUSES, recommendFor } from './learner.js';
import { CORRECTION_LABELS, conditionParts, correctionLabel, dayKey, recordPracticeTime, comparableKind, evidenceRun, filterRuns, missedAndSlowWords, practiceTextConditions, recurringMissedWords, trendRun } from './insights.js';
import { formatSpeed, showSpeed, speedFigure } from './units.js';
import {
  LESSONS, LESSON_ACCURACY, keysLabel, lessonKeys, lessonPassage, lessonUnlocked, lessonsComplete,
  makeupShort, nextLessonIndex,
} from './lessons.js';
import { DARK_THEMES, DRILL_LENGTHS, LIGHT_THEMES, MIN_ACCURACY_OPTIONS, MIN_WPM_OPTIONS, defaultPreferences, emptyProfile, normalizeProfile, preferencesInUse, uid, validPreferences } from './profile.js';



export async function attachApplication({ practice, learning, palette, settings: settingsView, compose, quoteFilters, challenge, themeEditor, wallpaper, accounts, sync, deletion, inbox, friendsBoard, suggestion, importing, release, historyClear, recording, practiceRun: runSession, onlineRace, editors, lengthEditor, training, navigation, ghostOffer, ghostResult, displayedUnits }) {
startPageWork();
const lifetime = createApplicationLifetime();
const glides = createControlGlides(lifetime);
const updateGlide = glides.update;
const updateGlides = glides.all;
const setTimeout = lifetime.timeout;
const clearTimeout = lifetime.clearTimeout;
const setInterval = lifetime.interval;
const requestAnimationFrame = lifetime.frame;
const cancelAnimationFrame = lifetime.cancelFrame;
const selectSetting = settingsView.select;
const disableSetting = settingsView.disable;
const onSetting = settingsView.onSetting;



const $ = (id) => document.getElementById(id);
const now = () => performance.now();



const renderDaily = challenge.daily.refresh;
const todayPassage = challenge.daily.passage;
const renderLengthOptions = lengthEditor.refresh;
const setCustomLengthError = lengthEditor.error;
const openCustomLength = lengthEditor.open;
const closeCustomLength = lengthEditor.close;


function openCustom(open = true) { editors.open(open); }

function showManualTarget(open) { editors.manual(open); setModeControls(); }

function toggleManualTarget() { editors.toggleManual(); setModeControls(); }


function markKeyboardTargets(target) { practice.keyboard.target(target); }

function renderKeyboard() {
  const lesson = practice.sessionKind === 'lesson';
  practice.keyboard.show({ layout: learning.preferences.layout, fingers: learning.preferences.fingerMap,
    visible: Boolean(learning.preferences.keyboard) || lesson,
    lesson: lesson ? { known: lessonKeys(lessons.index - 1), fresh: LESSONS[lessons.index].keys } : null });
}




function customPassage() {
  const text = normalizeCustomText(learning.preferences.customText);

  if (!text) return null;

  return { id: null, text: orderCustomText(text, learning.preferences.customOrder), fresh: false };
}

const customOrderLabel = (order) => ({ shuffled: 'shuffled words', random: 'random words' }[order] || 'as written');

// No session means guest mode: default settings, and nothing leaves this tab.

await accounts.replaceIdentity(accounts.session);
const { loadProfile, saveProfile, storeLocally, commitPreferences, saveChoice, absorbCache, pullProfile, syncOnLoad } = sync;
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



// The time of the last key since a minimum stopped the run; see the Run again key guard.
let stopHold = null;
const STOP_HOLD_MS = 600;

// An online race's typing surface (src/online-race.js), which takes keys through this same path as type
// 'online': { attempt, origin (the shared start), view, accepting(at), notice(message), changed(), finish() }.


// Whether the practice passage is on one line. Read from the body, as the stylesheet does, so trimming and
// measuring always follow the layout on screen (see tapeLayout).
const onTape = () => document.body.dataset.tape === 'true';
const primaryFx = createTypingFx($('typing-wrap'), $('text-display'), { ensureCharacters: (index) => primaryTextView?.ensureForward(index), tape: onTape });
const race = challenge.local.state;
const raceFx = challenge.local.fx;
const setupRacePlayer = challenge.local.prepare;
const finishRacePlayer = challenge.local.finish;

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

const displayPreferences = createDisplayPreferences({ learning, practice, sync, settings: settingsView, themeEditor,
  ports: { light: () => prefersLight.matches, restorePassage: () => primaryTextView?.restore(), typingRelayout: () => primaryFx.relayout(), relayout: relayoutText,
    onlineRelayout: () => onlineRace.relayout(), syncSound: () => sounds.sync() },
});

const themeMode = displayPreferences.themeMode;
const themeFor = displayPreferences.themeFor;
const shownTheme = displayPreferences.shownTheme;
const wearTheme = displayPreferences.wearTheme;
const applyTheme = displayPreferences.applyTheme;
const setThemeMode = displayPreferences.setThemeMode;
const pickTheme = displayPreferences.pickTheme;
const saveCustomThemes = displayPreferences.saveCustomThemes;
const syncLayout = displayPreferences.syncLayout;
const setSessionKind = displayPreferences.session;
const measureTypingBaseline = displayPreferences.measureTypingBaseline;
const applyFonts = displayPreferences.applyFonts;
const applySoundPreferences = displayPreferences.applySound;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// The completed run the results view shows: its numbers, run card graph and Watch replay. Only
// showResult sets it. `attempt` moves on without it (a drill whose retest is unavailable, the
// next run), so nothing on the results view reads `attempt`.


// The words the Train list last drew, so its button can tell when the runs changed underneath.
const ghostOn = () => learning.preferences.paceCaret !== 'off';
let keybindingEditor = null;
let detachWallpaper = null;





let displayedIds = null;


// The label of the practice passage waiting when history was cleared, which undo gives back.



// Composing practice takes the passage's place on the practice screen; see openCompose.
let composeOpen = false;

// The lesson being typed and the last lesson result in this tab (shown on the learn screen).
const lessons = createLessonController(learning, sync, {
  beforeStart() {
    if (practice.attempt?.status === 'running') { markInterrupted(NOTICES.leftSurface); finishPrimary(null, { replacing: true }); }

    if (race.attempt?.status === 'running') markRaceInterrupted();
  }, reset: resetSession, learn: () => switchView('learn'), openLearn: () => navigate('learn'), announce,
});

const { lessonCopy, startLesson, openLessons, finishLesson, renderLessons } = lessons;
const { conditions, customConditions, practiceMinimums, inputLayout, lessonConditions, dailyConditions } = createPracticeConditions(learning, () => lessons.index);

const { restartKind, drillLength, sessionDurationMs, ruleLimits, ruleSession, sessionConditions, raceUnderWay } = createSessionRules(
  learning, practice, training, challenge.local, onlineRace, ghostResult, navigation,
  { conditions, daily: dailyConditions, custom: customConditions, lesson: lessonConditions, ghost: () => ghostConditions(), race: raceConditions });


const trainingPolicy = createTrainingPolicy(learning, practice, training, sync, { conditions, inputLayout, retainedBaseline, recommendation: trainingRecommendation,
  reset: resetSession, controls: setModeControls, applyPreferences, manual: showManualTarget, unavailable: showUnavailableRetest,
  description: (text) => practice.presentIntro({ description: text }),
});

const layoutMismatch = trainingPolicy.layoutMismatch;
const startDrill = trainingPolicy.startDrill;
const startRetest = trainingPolicy.startRetest;
const practiceTarget = trainingPolicy.practiceTarget;
const baselineFor = trainingPolicy.baselineFor;
const startAdaptiveRetest = trainingPolicy.adaptiveRetest;
const startWordPractice = trainingPolicy.wordPractice;
const practiseRecurringWords = trainingPolicy.recurringWords;
const adaptivePassage = trainingPolicy.adaptivePassage;
const drillPassage = trainingPolicy.drillPassage;

const trainingResults = createTrainingResults(learning, training, sync, { conditions, recommendation: trainingRecommendation, baseline: baselineFor,
  layoutMismatch, practiceTarget, startDrill, history: () => renderHistory() });

const updateComparison = trainingResults.update;
const showComparison = trainingResults.show;
const renderComparison = trainingResults.compare;
const renderTrain = trainingResults.render;


// The friend's recorded run being raced (sessionKind 'challenge'), and the run offered to friends.
ghostResult.configure({ announce, repeat: () => resetSession('challenge', { focus: true }) });

const ghostLaunch = createGhostLaunch(accounts, onlineRace, inbox, training, ghostResult, learning, {
  context: raceContext, running: () => runInProgress(), beforeStart() {
    if (practice.attempt?.status === 'running') { markInterrupted(NOTICES.leftSurface); finishPrimary(null, { replacing: true }); }

    if (race.attempt?.status === 'running') markRaceInterrupted();
  }, reset: () => resetSession('challenge', { focus: true }), practice: () => navigate('practice'), notice: showAccountToast,
});

const startGhostRace = ghostLaunch.start;
const startOwnGhost = ghostLaunch.own;
const ownBestRun = ghostLaunch.ownBest;
const ghostConditions = ghostResult.conditions;
const ghostPassage = () => ghostResult.passage(learning.profile.seenTextIds);

// The Race still waiting for its challenge, and the offer's friend list still loading (see startGhostRace).
// A Race carries where it was clicked (raceContext); a later Race replaces it.
// The friend list belongs to the offer on screen: renderGhostOffer drops it when another run replaces it.



// Counts the sessions set up on the practice surface, and everything typed anywhere (a passage or a form
// field), so a Race can tell whether the person has set up something new or gone on typing since the click.
let sessionCount = 0;
let typedCount = 0;

// A Race's error that lands beside a run the person went on typing waits for the run to end (see runChanged).

// For each clear still in force here, the copies merged here that it removed history from, as they were
// before it, so its Undo from any tab brings all of it back (account.mergeAndHold): { [marker]: [copy, …] }.
// A list goes back only with its own clear's undo. In memory only.


// The history clears this tab had applied when its training state (baseline, results on show) was last
// checked against them, and where an older build's clear left history starting (legacyClearedAt).
let trainingClears = account.clearsApplied(learning.profile);
let trainingLegacyAt = learning.profile.legacyClearedAt || '';



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

const { enterAccount, signOutAccount, followSessionElsewhere, finishFollow } = createAccountTransitions(
  accounts, sync, onlineRace, inbox, friendsBoard, { running: runInProgress, reload: () => location.reload() });

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
  if ((practice.intro.getSnapshot().caps === true) === on) return;
  practice.presentIntro({ caps: on });

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

  ghostLaunch.runChanged();
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
    practice.presentIntro({ best: ['Code runs aren’t ranked'] });

    return;
  }

  const best = key && learning.profile.bests[key];
  practice.presentIntro({ best: copyParts(!key ? 'Not counted' : best ? ['Best · ', speedFigure(best.wpm)] : 'No best yet') });
}

// The mode a theme belongs to, a custom one's by its background; null for 'system' or a theme not saved.




// A mode's pick: the theme shown, in that mode, else the one saved for it, else the mode's default.




// A custom theme (src/custom-themes.js) is worn over dark or light by its colours; without them the theme is built in.




// The theme left for another becomes its mode's pick.


// Shows a theme, or 'system'.




// Outside system mode, a pick is shown at once, in its own mode.


// After the editor saves or deletes a custom theme: a saved one is picked as pickTheme does; a pick whose
// theme was deleted, or moved to the other mode, goes back to its mode's default.


// Slides a group's pill under its selected control; used by the dock and the segmented controls.




// The tape is for solo practice. A ghost race keeps three lines, as the other races do, so the
// friend's caret stays in view however far ahead or behind it is.


// The one writer of the passage layout: the text size, and three lines or the tape.




// The typing font's baseline below the middle of its line, from the font's own metrics, so every caret
// stands on the baseline exactly as it does on Literata's (--typing-baseline in src/styles.css).


// A new font changes letter widths, as a resize does, and again once its file arrives.


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
  settingsView.present({ slide: learning.preferences.wordHighlight !== 'off' });
  placePreviewGlide();
  selectSetting('live-toggle', learning.preferences.liveMetrics);
  selectSetting('keyboard-toggle', learning.preferences.keyboard);
  syncRules();
  selectSetting('finger-toggle', learning.preferences.fingerMap);
  disableSetting('finger-toggle', !learning.preferences.keyboard);
  selectSetting('correction-select', learning.preferences.correction);
  selectSetting('focus-toggle', learning.preferences.focusMode);
  selectSetting('tape-toggle', learning.preferences.tape);
  renderKeyboard();
  applySoundPreferences();
  applyTheme();
  selectSetting('numbers-toggle', Boolean(learning.preferences.numbers));
  quoteFilters.refresh();
  selectSetting('word-list', learning.preferences.wordList);
  applySpeedUnit();
  selectSetting('repeat-quotes-toggle', learning.preferences.repeatQuotes);
  keybindingEditor?.refresh();
  navigation.bindings(learning.preferences.keybindings);
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



// Display only: every speed and unit word on screen re-texts in place (src/units.js), so nothing restarts
// and open rows and focus stay as they are. Only text re-texts: a speed placed in an attribute or drawn in
// SVG has to be redrawn here, as the words' spoken paces and the two charts are
// (the pace field follows in showPace).
function applySpeedUnit() {
  selectSetting('speed-unit', learning.preferences.speedUnit);
  const changed = displayedUnits.select(learning.preferences.speedUnit);

  if (!changed) return;
  labelWords();

  if (practice.shownResult && rateShown(practice.shownResult)) renderSpeedGraph($('speed-graph'), practice.shownResult, { animate: false });

  if (document.body.dataset.view === 'progress') {
    drawProgressView();

    progressHistory.relabelLead();
  }
}

// Minimums decide which practice runs count, and custom text never counts, so a custom run has none and
// runs to the end like a drill: the note stands aside while Custom or composing is on, as the test
// controls do, and while the standard test is selected (practiceMinimums).
function showMinimumNote() {
  const minimums = describeMinimums(practiceMinimums());
  flushSync(() => practice.controls.publish({ ...practice.controls.getSnapshot(), minimums: copyParts(minimums), minimumVisible: Boolean(minimums.length) && !editors.customOpen && !composeOpen && practice.sessionKind !== 'custom' }));
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

  settingsView.present({ quickEnd: RULE_NOTES[limits.quickEnd] || '', rules: RULE_NOTES[limits.fixed] || '' });
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
  settingsView.present({ standard });
  selectSetting('word-list', standard ? 'standard' : learning.preferences.wordList);
  disableSetting('repeat-quotes-toggle', learning.preferences.mode !== 'quote');
  disableSetting('correction-select', standard);
  selectSetting('correction-select', standard ? 'mandatory' : learning.preferences.correction);

}

function setModeControls() {
  quoteFilters.dismiss();
  // Composing takes the passage's place, so Custom is never marked over it.
  const custom = !composeOpen && (editors.customOpen || practice.sessionKind === 'custom');
  syncLockedSettings();
  showMinimumNote();

  if (custom || composeOpen || learning.preferences.mode === "standard") closeCustomLength();
  renderLengthOptions();
  flushSync(() => practice.controls.publish({
    ...practice.controls.getSnapshot(),
    visible: practice.sessionKind === 'practice' || practice.sessionKind === 'custom', bookPage: bookPlace(learning.profile.runs, learning.preferences.book) + 1,
    mode: learning.preferences.mode, duration: learning.preferences.duration, count: learning.preferences.count,
    lengthMode: ['time', 'words'].includes(learning.preferences.mode) ? learning.preferences.mode : practice.controls.getSnapshot().lengthMode,
    lengthValue: learning.preferences.mode === 'time' ? learning.preferences.duration : learning.preferences.mode === 'words' ? learning.preferences.count : practice.controls.getSnapshot().lengthValue,
    punctuation: Boolean(learning.preferences.punctuation), adaptive: learning.preferences.adaptive,
    custom, customOpen: editors.customOpen, manualOpen: editors.view.getSnapshot().manual, composing: composeOpen, codeLanguage: learning.preferences.codeLanguage,
    standardRecipe: recipeSummary() + ' · ' + correctionLabel(standardConditions().correctionPolicy),
  }));
  showBest();
  requestAnimationFrame(() => updateGlides());
}

// The four presets and the custom pill are relabelled in place, never rebuilt, so a click that
// lands just as the custom field commits on blur still reaches the button under the pointer.


// The custom pill turns into a short field in place. Enter, or leaving the field with a valid
// number, sets the length; Escape puts the pill back. Guests keep the value for the tab only.


// Set even when unchanged, so a second bad entry is announced again.










// A mode change resets once, in the new mode, so a quote is never drawn (and marked seen) only to be replaced.
// Custom text hides the length row, so from its editor or session this goes through setTestShape too, which
// closes the editor and starts a test in this mode, as the length buttons do.
function setCustomLengthFromPalette(mode) {
  if (learning.preferences.mode !== mode || editors.customOpen || practice.sessionKind === 'custom') setTestShape(mode);
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
  inputPresentation.noticeText = text;
  $('input-help').textContent = text;
  $('input-help-reserve').textContent = text;
}

// Restarting or changing a setting keeps a custom passage; every other session restarts as practice.


// A drill runs the length it started with. That is its context's, or its own once another device's clear
// has taken the context from under a drill that is waiting or under way. A drill not yet drawn takes the setting.


// Daily and missed-word passages run to the end of their text, whatever the practice shape is.


// Why strict space and quick end can't change a session's run, read from the session itself (its
// kind, its timing and the conditions its run was built with), never from the test-shape
// preferences: a drill started from a words baseline is still timed. quickEnd names why
// quick end does nothing there ('' when it applies); fixed names a session that keeps the rules it
// started with (the daily's are set, a retest has to match its baseline, custom text keeps the
// defaults, and a race under way keeps its own for both players).




// The session the rule switches act on. On the Challenge screen's one-keyboard tab it is the race:
// the one under way, whose rules startRace fixed for both players, or else the next one. Elsewhere
// it is the run waiting or in progress or, once it's over, the next one, which Run again makes the
// daily again, the same custom text or a practice run.


// The conditions a new run of this kind is built with. The daily's rules are fixed and a retest
// takes its baseline's, whatever the switches say now. A rule that can't change the run is recorded
// at its default, so a drill's conditions and key never carry quick end.


function configureSessionCopy() {
  const copy = {
    practice: ['practice', 'Practice', ''],
    drill: [`drill · ${drillLength()} s`, training.target ? `Practice “${training.target}”` : 'General drill', 'Doesn’t count toward your best.'],
    custom: ['custom text', 'Your text', 'Doesn’t count toward your best.'],
    retest: ['fresh-text retest', 'Measure the change', passage?.fresh === false ? 'You’ve seen every matching quote, so this can’t be a fresh comparison.' : 'Fresh text, same conditions.'],
    missed: ['missed words', training.words?.recurring ? 'Practice words you keep missing' : 'Practice missed and slowest words', 'Doesn’t count toward your best.'],
    daily: ['daily challenge', 'Today’s passage', `${passage?.day} · resets at midnight UTC · ${passage?.firstDailyAttempt ? 'first attempt' : 'repeat attempt'}${passage?.firstDailyAttempt && !passage?.fresh ? ' · previously displayed passage' : ''}`],
    lesson: ['lesson', `Lesson ${lessons.index + 1} · ${keysLabel(LESSONS[lessons.index].keys)}`, lessonCopy(lessons.index, passage)],
    challenge: ghostResult.race?.own ? ['ghost race', 'Race your best run', 'The ghost is your own recording. Not counted toward your best.']
      : ['ghost race', `Race ${ghostResult.race?.name}’s run`, 'Your first finish without a break is sent. Not counted toward your best.'],
  }[practice.sessionKind];

  practice.presentIntro({ kicker: copy[0] });
  practice.presentIntro({ title: copy[1] });
  practice.presentIntro({ description: copy[2] });
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

  if (kind === 'challenge' && !ghostResult.race) kind = 'practice';

  // Word practice whose words were cleared with history falls back to a normal test.
  if (kind === 'missed' && !training.words) kind = 'practice';
  const kindChanged = practice.sessionKind !== kind;
  setSessionKind(kind);

  // The mode bar marks Custom while a custom session is loaded, so it is redrawn whenever the kind changes.
  // Changing to any session but custom (a lesson or a ghost race too) also closes the custom editor, or Custom would stay marked over it.
  if (kindChanged && kind !== 'custom') editors.customOpen = false;

  if (kindChanged) setModeControls();

  // Every lesson restart (Esc, the palette, a settings change) lands here: a lesson that is locked again,
  // after history was cleared, gives way to the next open lesson.
  if (kind === 'lesson' && !lessonUnlocked(learning.profile.lessons, lessons.index)) lessons.index = nextLessonIndex(learning.profile.lessons);
  passage = selectedPassage || (kind === 'missed' ? training.words : kind === 'daily' ? todayPassage() : kind === 'drill' ? drillPassage()
    : kind === 'lesson' ? lessonPassage(lessons.index) : kind === 'challenge' ? ghostPassage() : kind === 'custom' ? customPassage()
      : (kind === 'practice' && adaptivePassage()) || choosePassage(kind === 'retest' && training.baseline ? [training.baseline.textId] : [], { allowRepeats: kind === 'practice' && learning.preferences.repeatQuotes }));

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
      practice.presentIntro({ conditions: copyParts(describeConditions()) });
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

  if (kind === 'challenge') practice.attempt.challengeId = ghostResult.race.id;

  if (kind === 'daily') {
    practice.attempt.challengeDate = passage.day;
    practice.attempt.firstDailyAttempt = passage.firstDailyAttempt;
  }

  if (kind === 'drill') {
    practice.attempt.target = training.target;
    practice.attempt.drillSeconds = drillLength();
  }

  if (passage.adaptive) {
    practice.attempt.adaptive = true;
    practice.attempt.trainFocus = passage.trainFocus;
  }

  if (kind === 'lesson') practice.attempt.lesson = { id: passage.lessonId, index: lessons.index, pairs: passage.pairs, words: passage.words };

  // Open practice stops at the current minimums. A retest carries its baseline's, so both sides of a
  // comparison pass the same filter; drills and the daily challenge always run to the end.
  if (kind === 'practice') practice.attempt.minimums = practiceMinimums();

  if (kind === 'retest') practice.attempt.minimums = training.baseline?.minimums || null;
  practice.attempt.fresh = passage.fresh !== false;
  practice.startTime = null;
  $('typing-input').value = '';
  $('typing-input').disabled = false;
  $('accessible-passage').textContent = passage.text;
  primaryTextView = renderText($('text-display'), passage.text, { tape: onTape });
  primaryCharacters = primaryTextView.characters;
  primaryFx.reset(primaryCharacters);

  // In a ghost race the ghost caret replays the friend's run; armPace leaves it to that.
  if (kind === 'challenge') primaryFx.ghost.replay(ghostResult.race.points);
  armPace();
  renderKeyboard();

  if (kind !== 'lesson') markKeyboardTargets(kind === 'drill' ? training.target : null);
  $('typing-status').className = 'badge badge-info';
  $('typing-status').innerHTML = '<span class="status-dot" aria-hidden="true"></span>Ready';
  // Open practice hides the condition line, so a repeated passage says so in the footer, before and during the run.
  setPassageNotice(repeatedTextNotice());
  practice.presentIntro({ conditions: copyParts(describeRun(practice.attempt)) });
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
  showComparison('No fair retest available.', 'unavailable', training.context?.target || null);
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
    editors.customOpen = false;
    document.body.dataset.compose = 'true';
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
  setModeControls();
}

function focusPractice() {
  if (composeOpen) compose.focus();
  else $('typing-input').focus({ preventScroll: true });
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




// A strict space or quick end notice never hides why a run won't count; it follows that notice.


// at is when the key was typed, so a commit scored after a timed run's limit can't end the run between
// its mark and its letter (scoreCommit ends it once both are in).


const typingHost = createInputController({
  attempt: (type) => type === 'primary' ? practice.attempt : race.attempt,
  origin: (type) => type === 'primary' ? practice.startTime : race.startTime,
  durationMs: sessionDurationMs, start: (...args) => inputPresentation.start(...args),
  finish: (type, elapsed) => type === 'primary' ? finishPrimary(elapsed) : type === 'online' ? typingHost.online?.finish() : finishRacePlayer(),
  refresh: (...args) => inputPresentation.refresh(...args), notice: (...args) => inputPresentation.notice(...args), play: (outcome) => sounds.play(outcome),
});

const offsetFor = typingHost.offsetFor;
const finishIfTimeUp = typingHost.finishIfTimeUp;
const wireOnlineTyping = typingHost.wireOnlineTyping;

const inputPresentation = createInputPresentation({ practice, learning, run: runSession, local: challenge.local, input: typingHost,
  elements: { help: $('input-help'), wpm: $('live-wpm'), accuracy: $('live-accuracy'), timer: $('timer'), timerUnit: $('timer-unit'), timerLabel: $('timer-label'), progressBar: $('progress-bar'), progressTrack: $('progress-track') },
  ports: { durationMs: sessionDurationMs, setRunning, announce, finishPrimary,
    surface: (type) => type === 'primary' ? { input: $('typing-input'), characters: primaryCharacters, textView: primaryTextView, fx: primaryFx }
      : { input: $('race-input'), characters: race.characters, textView: race.textView, fx: raceFx },
  },
});

const showInputNotice = inputPresentation.notice;
const updateLive = inputPresentation.live;


// The pace caret is presentational and never scored. It runs at the personal best, the average of
// the last 10 comparable runs, the last comparable run, or a custom pace; with no runs, a gentle 60 wpm.
function ghostPace(mode = learning.preferences.paceCaret) {
  // In a lesson the pace line runs at the lesson's speed target, whatever the pace setting.
  if (practice.attempt?.kind === 'lesson') {
    const wpm = LESSONS[lessons.index].wpm;

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
  const shown = on && practice.sessionKind !== 'challenge';
  practice.presentIntro({ paceVisible: shown, pace: copyParts(shown ? ['pace ', speedFigure(pace.wpm)] : '') });
  selectSetting('pace-select', learning.preferences.paceCaret);
  settingsView.pace.sync({ on, custom: learning.preferences.paceCaret === 'custom', wpm: pace.wpm, fallback: pace.fallback,
    unit: learning.preferences.speedUnit, valueWpm: learning.preferences.paceWpm });
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
  if (practice.sessionKind === 'drill' && training.baseline && training.context?.retest !== false && !completed.failed) {
    if (training.context) training.context.drillCompleted = valid;

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
      training.baseline = null;
      training.context = null;
    } else if (valid && !completed.adaptive) {
      // Familiar text flatters the score, so a repeated passage can't be the baseline for a fresh retest.
      training.baseline = completed.fresh === false ? null : completed;
      training.context = null;
    }
  }

  renderResults(completed, saved);

  // A retest's result is its comparison, on Train, and its card waits behind Back to practice; every
  // other run's result stays on Practice.
  if (practice.sessionKind === 'retest') {
    switchView('train');
    renderComparison(training.baseline, completed, saved);
    // The passage may have scrolled the page; Train opens at its top.
    scrollTo(0, 0);
    $('comparison-status').focus({ preventScroll: true });

    return;
  }

  if (practice.sessionKind === 'challenge') ghostResult.finish(completed, valid);

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


// The words you keep missing across runs. Without a baseline in this tab, the newest retained
// counted run becomes one (as for a recurring pattern), so a fresh-text retest can follow.


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
  practice.commands.practiceWords = () => { training.baseline = completed; startWordPractice(words); };

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
  ghostResult.show(completed.kind === 'challenge');
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
    const again = failedDrill(completed) ? training.context?.recommendation : null;
    const recommendation = again || trainingRecommendation(completed.conditions, failedDrill(completed) ? null : completed);
    const { target } = recommendation;
    label = failedDrill(completed) ? 'Try drill again' : target ? 'Drill “' + target + '”' : learning.preferences.retest ? 'Drill and retest' : 'Drill';
    practice.commands.drill = () => startDrill(recommendation);
  }

  const current = practice.result.getSnapshot();

  if (current) flushSync(() => practice.result.publish({ ...current, drillLabel: label }));
}



// Train after a retest: the step just retested moves behind you, and its comparison is that step: the outcome, then
// the trained unit's misses or pace, accuracy and speed beside the baseline's, the text they were measured on, and any
// caveat. `trained` is the unit, or null for a drill that named none; `source` the retest's conditions, or null when no
// fair retest ran. The path opens the next step at those conditions, as the comparison's Next always did.




// The baseline for a fresh-text retest at `source` conditions: this tab's, when it matches, else the newest
// retained run. Adaptive runs are drill-kind and never one.


// After an adaptive run: a fresh-text retest against the newest normal run at the same conditions, or,
// with none, a plain test that can become the next baseline.


// What Train shows while a retest's comparison is up: the unit just retested and the retest's conditions (see
// showComparison). Null otherwise; opening Train from the dock draws the path afresh.


// Train: the path (src/train-path.js) at the current conditions, or after a retest at the retest's. Behind you, the
// targets you have drilled; open, the drill the learner names (the results card's Drill and Patterns across runs
// name the same), or after a retest the next one it queues; ahead, the next three. `advance` moves the path on by
// one step, once, as a retest's comparison opens. `fresh` draws it as Train opens, scrolled to its end; otherwise a
// redraw keeps the reader's place (drawPath).


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


// A drill of what `recommendation` names, then the retest unless the retest setting is off. The drill keeps the
// recommendation, its length and the retest setting it started with.




// The layout is set in the operating system, not here, so restoring conditions never switches it.
// A baseline typed on another layout (a missing layout means QWERTY) can't be retested on this one.
// A touch baseline never used the setting, so the setting can't block it.


// A drill or retest runs at its baseline's conditions without recording them as a settings edit: the
// saved settings, including a pick from another tab or device made meanwhile, apply again once it ends
// (resetSession leaves them waiting), and a restore never outranks a choice someone made.
// Only what the source's mode varies is restored: fields a mode fixes in conditions() (code's and a book's
// punctuation, numbers and word list; quote's numbers) keep the person's own prose settings.


// "results" is the practice screen showing a finished run in place of the passage.
function switchView(view) {
  quoteFilters.dismiss();
  const previous = document.body.dataset.view;

  // Progress opens on its overview whenever it is opened from elsewhere.
  if (view === 'progress' && document.body.dataset.view !== 'progress') Object.assign(progressState, { detail: '', moversOpen: false });
  navigation.show(view);
  setRunning(false);
  syncRules();
  // Pills in a hidden screen measured zero width; remeasure every group now it is visible.
  updateGlides();

  if (view === 'progress') renderHistory();
  // Challenge opens on its people list, unless a one-keyboard race is being typed there.
  onlineRace?.onViewChange(view, { keep: previous === 'compete' && raceUnderWay() });

  // Opened from anywhere, Train draws the path afresh; a retest's comparison draws it once more as it opens.
  if (view === 'train') {
    training.after = null;
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


// The recommender's pick for `source` conditions. The run just finished always counts toward its own
// recommendation: its summary is saved even when its trace was too large to keep (the counting rule reads traces).
function trainingRecommendation(source, current = null) {
  const traces = current && !learning.profile.attempts.includes(current) ? [...learning.profile.attempts, current] : learning.profile.attempts;

  return recommendFor(DEFAULT_POLICY, { runs: learning.profile.runs, loops: learning.profile.loops, traces, source, now: Date.now(), focus: learning.preferences.trainFocus });
}

// A drill's text: the target's words, or, for a general drill with units ranked for it, words leaning
// toward them.


// Patterns across runs: the learner's queue at the chosen conditions' keyboard, as Train reads it, each unit with
// its observed evidence and its last drill. Redrawn under someone using it, focus stays on the row for the same unit,
// or the first row when that one is gone.
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const renderTraining = learning.progress.patterns.refresh;
learning.progress.patterns.configure({ learning, conditions, describe: describeConditions, recommendation: trainingRecommendation, practice: practiceTarget, date: dateCopy });



// Progress headline: the current standard recipe at one input class (standardInputClass decides), so
// one touch run can't replace a keyboard score. The other class's best is named in the note.


// Static heatmap: coral steps by first-attempt miss rate; thin evidence stays neutral.
// One tab stop: arrow keys move between keys as drawn, and focus or a click shows that key's numbers
// in the line below, so the values never depend on a hover tooltip. Ten keys in a phone-width row
// cannot each be a 44px touch target, so on coarse pointers the heatmap is a picture and a native
// "Key" select drives the same line.
const narrowColumn = window.matchMedia('(max-width: 760px)');

const practiceProgress = createPracticeProgress(learning, { inputLayout, recipeSummary, conditionTail, dateCopy,
  calendarWeeks: () => narrowColumn.matches ? 17 : 26, coarse: () => matchMedia('(any-pointer: coarse)').matches, period: () => progressState.period });


const renderGoal = practiceProgress.goal;




// Progress filters and view. Plain state, kept for the session: a guest writes nothing to storage.
const renderLoops = createLoopHistory(learning, { describe: describeConditions, practice: practiceTarget }).render;

const progressState = learning.progress.navigation.state;
const progressHistory = createProgressHistory(learning, practiceProgress, { describe: describeConditions, describeRun, date: dateCopy, loops: renderLoops, focusShown });
const { renderHistory, renderWeek, drawProgressView, chooseProgress, hasAnyHistory } = progressHistory;

// Where focus lands on Progress when what held it is gone, hidden or disabled (TOB-448): somewhere a sighted keyboard
// user can see it. In a detail view, the view's own heading; on the overview, the empty state's heading, or the lead's
// figure. The page's heading is for screen readers only, so it is never the landing. The view is the one on screen (a
// view of rows stays until it is left, after a clear too); the overview's state is read from the history, so a landing
// chosen mid-redraw is the one the redraw ends on.
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







// The overview, and the conditions it reads: the lead, what moved it, the small charts and the quiet links. Every
// change to the history redraws it (followHistory, through renderWeek), whatever the page shows; the detail views
// wait for renderHistory, so a row someone has open there stays open.


// Under the fuller charts, the period in figures: the median speed and accuracy of the runs charted, the fastest
// single run with its day (the chart names the best day's median, which can be another day), and how many runs.
// Speeds are speed figures, so a unit change rewords them.
// A change to the history (followHistory) or the train focus, on Progress: the overview follows at once, with focus
// kept where it was. A detail view of rows keeps them until it is left, so a row someone has open stays open.


// The lead: the change in speed, this week against the week before, with the two medians beside it and one line of
// sample sizes and conditions; or, without two weeks to compare, what there is and when a change can show. Speeds
// read whole, in the unit on screen, and the change is the difference of the two figures printed, so they add up.
// A unit change redraws it (applySpeedUnit).
// Practice, a plain fact: minutes the week before → this week, and the streak (at the goal, when one is set).




// Practice over the period, whatever the test: days practised, the longest and current streaks (days meeting
// the goal, or with any practice when it's off) and minutes typed, from the same minutes the calendar draws.


// Everything the overview doesn't show sits one step away in a detail view, each with a way back. The conditions
// and the period move into a view that reads them, and back to the overview after.
const openProgressDetail = learning.progress.navigation.open;



// Composing numbers get their own list: no chart, no trend, no best, nothing shared with copy tests.


// Everyone types the daily passage under the same rules, whatever their practice settings.




function startDaily() {
  if (practice.attempt?.status === 'running') { markInterrupted(NOTICES.leftSurface); finishPrimary(null, { replacing: true }); }

  if (race.attempt?.status === 'running') markRaceInterrupted();
  training.baseline = null;
  training.context = null;
  resetSession('daily', { focus: true });
}



// ── Lessons ───────────────────────────────────────────────────────────────

// ── Ghost races ───────────────────────────────────────────────────────────
// A friend's recorded run, raced on the practice surface against a ghost caret that replays their
// keystrokes (src/ghost-race.js). The run is kind 'challenge', non-comparable like custom text: only its
// summary is kept, and it is never a best.





// A run that wasn't sent for these reasons can be raced again; a failed send is retried as is.

// The sender's test conditions, so the same finish rule applies; the input class is this device's.


// A quote or daily passage keeps its own text id, worked out from the text, so a quote raced here
// can't later count as fresh. Word and timed text gets the id of exactly that text.


// An open online room keeps the surface: a ghost race never starts over it.
// Where the person is, as a Race sees it: the view, the session set up on the practice surface and its run's
// status, anything typed since (in the passage or any field), the custom editor, a local race player, an
// online room open or on its way, and any dialog.
function raceContext() {
  return JSON.stringify([document.body.dataset.view, sessionCount, practice.attempt?.status, typedCount, editors.customOpen, race.attempt?.id,
    race.attempt?.status, onlineRace?.liveRoomId || null, Boolean(onlineRace?.pending), Boolean(document.querySelector('dialog[open]'))]);
}

// Every ghost race reply checks, once it lands, that what it was asked for is still current: the Race
// (ghostRequest), the finished run still on screen (submitGhostRun), the offered run (sendGhost) or the
// friend list (friendsRequest). A late one changes nothing here; what the service did stands, and its
// result still reaches the inbox.
// When nobody is waiting for a quick match: the fastest recorded run of yours on its setup (30 seconds of the
// 200 words, no punctuation or numbers, a physical keyboard) that this device still keeps the keystrokes of.
// Only your own recording is ever used; other people's stay on their devices (ADR 0006).


const renderGhostOffer = ghostOffer.render;

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






// A key hint: hidden on touch-only devices (.key-hint in styles.css), where there is no restart key.








// What this tab holds in memory about the runs a clear removes: the baseline, the drill and retest it
// offers, and the results on show.
function forgetTraining() {
  training.baseline = null;
  training.context = null;
  training.target = null;
  // The practised words came from the cleared runs, so Run again starts a normal test.
  training.words = null;
  showResult(null);
  $('speed-graph').replaceChildren();
  ghostResult.show(false);
  renderGhostOffer(null);
  training.after = null;

  // A retest nobody has started compares with the baseline just forgotten, so a practice test takes its place; a
  // drill nobody has started stands alone now, with no retest after it, and says so (TOB-448).
  if (practice.attempt?.status === 'ready' && practice.sessionKind === 'retest') resetSession('practice', { show: false });
  else if (practice.attempt?.status === 'ready' && practice.sessionKind === 'drill') practice.presentIntro({ description: learning.preferences.mode === 'code' ? CODE_DRILL_NOTE : 'Standalone drill.' });

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

  if (!training.baseline && !practice.shownResult) return false;
  const named = account.clearedIds(learning.profile);

  const takenByLegacy = (record) => Boolean(legacyAt) && (record.at || '') <= legacyAt
    && !learning.profile.runs.some((run) => run.id === record.id);

  const cleared = (record) => Boolean(record) && ((arrived && (record.at || '') <= arrived) || named.has(record.id)
    || takenByLegacy(record));

  if (!cleared(training.baseline) && !cleared(practice.shownResult)) return false;
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
  lessons.follow();

  if (practice.sessionKind === 'lesson' && practice.attempt?.status !== 'running' && !lessonUnlocked(learning.profile.lessons, lessons.index)) resetSession('lesson', { show: false });
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

  if (keys.includes('mode')) editors.customOpen = false;
  applyPreferences();
  setModeControls();
  // The correction rule and the older stop-on-error flag are one choice, saved together as setCorrection does.
  saveChoice(...keys, ...(keys.includes('correction') ? ['stopOnError'] : []));

  if (conditions && !runInProgress()) resetSession(keys.includes('mode') ? 'practice' : restartKind(), { leaveCompose: keys.includes('mode') });

}

// Feature suggestions go straight to Supabase (account.sendSuggestion), never linked to an account.


function openSuggest() { suggestion.open(); }

function bindEvents() {
  navigation.configure({ go: (view, keep) => navigate(view, { keep }), restart: () => resetSession(practice.sessionKind, { focus: true }),
    skip() {
      if (composeOpen) { switchView('practice'); compose.focus();

 return; }

      if (!practice.attempt || practice.attempt.status === 'complete' || $('typing-input').disabled || staleRepeat()) resetSession('practice');
      else switchView('practice');
      $('typing-input').focus({ preventScroll: false });
    },
    exitFocus() { learning.preferences.focusMode = false; applyPreferences(); saveProfile(); focusPractice(); },
  });
  learning.commands.practice = () => { editors.customOpen = false; setModeControls(); resetSession('practice', { focus: true, leaveCompose: true }); };

  learning.commands.openLessons = openLessons;
  Object.assign(practice.choices, {
    chooseMode(mode) {
      editors.customOpen = false;
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
    manual: toggleManualTarget,
    lessons: openLessons,
    custom: () => openCustom(!editors.customOpen),
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
  learning.progress.commands.showAll = progressHistory.showAll;

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
  prefersLight.addEventListener('change', () => { if (learning.preferences.theme === 'system') applyTheme(); }, { signal: lifetime.signal });
  onSetting('pace-select', (value) => setPaceCaret(value));
  settingsView.pace.configure({ changed(wpm) { learning.preferences.paceWpm = wpm; setPaceCaret('custom', { speed: true }); }, refresh: showPace });
  onSetting('focus-toggle', (value) => { learning.preferences.focusMode = value === 'true'; applyPreferences(); saveChoice('focusMode'); });
  onSetting('tape-toggle', (value) => { learning.preferences.tape = value === 'true'; applyPreferences(); saveChoice('tape'); });
  onSetting('sound-select', (value) => setSound(value));
  // Dragging updates the level as it goes; the profile is saved once the slider settles.
  settingsView.onVolume((value) => setSoundVolume(value, { save: false }), () => saveChoice('soundVolume'));


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
    practice.presentIntro({ conditions: copyParts(describeRun(practice.attempt)) });
    showBest();

    if (practice.attempt.status === 'ready') armPace();
  }, { capture: true, signal: lifetime.signal });
  document.addEventListener('keydown', (event) => {
    if (!event.target.matches?.(TEXT_FIELDS)) activationInput = 'physical-keyboard';
  }, { capture: true, signal: lifetime.signal });
  // Anything typed, in the passage or a field, counts for a Race still loading (see raceContext).
  document.addEventListener('beforeinput', () => { typedCount += 1; }, { capture: true, signal: lifetime.signal });
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

  learning.progress.commands.standard = () => setTestShape('standard');
  learning.progress.commands.movers = progressHistory.movers;

  matchMedia('(pointer: coarse)').addEventListener('change', progressHistory.refreshKeys, { signal: lifetime.signal });
  $('train-path').addEventListener('scroll', pathEdges, { ...{ passive: true }, signal: lifetime.signal });
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







// While the text is too short to time, "Use this text" is off and the line under it says why. Other problems
// are reported when the button is pressed, and editing clears them.


// The panel never opens or closes beside a live run: like the other mode buttons, it restarts the run first.


// "drill" in the more menu: a 1–8 letter target of your own, drilled at once.




// Signed in, the text is kept with the other preferences; a guest's preferences live only in memory.
// Using it is a pick of the text and order shown, stamped even when they match what is stored, so a text
// waiting from another tab doesn't replace it as the passage is prepared.


function setTestShape(mode, length) {
  editors.customOpen = false;
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
  practice.presentIntro({ conditions: copyParts(describeRun(practice.attempt)) });
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
    practice.presentIntro({ conditions: copyParts(describeRun(practice.attempt)) });
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
    learning.progress.navigation.forgetOpener();
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
  practice.presentIntro({ egg: copyParts(on ? ['Ghost pacer · ', speedFigure(pace.wpm), pace.fromBest ? ' (your best)' : ''] : 'Ghost off') });
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

navigation.platform(isMac);

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

challenge.daily.configure({ conditions: dailyConditions, inputLabel, start: startDaily });

challenge.local.configure({ conditions: raceConditions, changed: raceRunChanged, offset: () => offsetFor('race'),
  clearInput: () => typingHost.clearFor('race'), wire: (input) => typingHost.attach(input, 'race'), interrupt: markRaceInterrupted,
  restartBinding: () => learning.preferences.keybindings.restart, reducedMotion: () => reducedMotion.matches,
  rules: syncRules, announce,
  seen(id) { if (!learning.profile.seenTextIds.includes(id)) { learning.profile.seenTextIds.push(id); saveProfile(); } },
});

lengthEditor.configure({ reset(focus = false) { resetSession('practice', { focus }); }, controls: setModeControls,
  glide() { updateGlide($('duration-options'), { instant: true }); },
  focusPractice() { $('typing-input').focus({ preventScroll: true }); },
});

editors.configure({
  beforeCustom() {
    if (composeOpen) resetSession(restartKind(), { leaveCompose: true });
    else if (practice.attempt?.status === 'running') resetSession(restartKind());
  },
  changed: setModeControls,
  useCustom() { resetSession('custom', { focus: true }); setModeControls(); },
  drill: startDrill,
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




renderKeyboard();

applyPreferences();

setModeControls();

bindEvents();


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
    session: composeOpen ? 'compose' : editors.customOpen || practice.sessionKind === 'custom' ? 'custom' : practice.sessionKind === 'drill' ? 'drill' : 'practice' }),
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

  if (document.body.dataset.view === 'progress' && today !== progressHistory.day) renderHistory();
  else if (today !== practiceProgress.day) renderGoal();
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
    challenge.local.dispose();
    sounds.dispose();
    compose.dispose();
    challenge.quick.dispose();
    challenge.review.dispose();
    challenge.rankCard.clear();
    palette.dispose();
    detachWallpaper?.();
    wallpaper.dispose();
    themeEditor.dispose();
    settingsView.pace.dispose();
    ghostLaunch.dispose();
    ghostResult.dispose();
    ghostOffer.dispose();
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

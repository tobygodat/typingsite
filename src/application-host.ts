import { createRunCopy } from './run-copy.js';
import { createHistorySelection } from './history-selection.js';
import { createLoopHistory } from './loop-history.js';
import type { PaletteCommand } from './palette.js';
import type { AppView } from './navigation.js';
import type { InputClass, MinimumFailure } from './typing.js';
import type { SealedRun, SessionKind } from './practice-session.js';
import type { HistoricalRecord, ActivePreferences } from './profile-types.js';
import type { KeybindingEditorController } from './keybinding-editor.js';
import type { ImportedSettings } from './import-dialog.js';
import { at as indexed, isRecord, lookup } from './domain-values.js';

interface PreparedPassage {
  id: string | null; text: string; fresh?: boolean; exhausted?: boolean; day?: string; firstDailyAttempt?: boolean;
  challengeId?: string; book?: unknown; adaptive?: boolean; trainFocus?: string; textVersion?: string;
  lessonId?: string; pairs?: number | string[]; words?: number | string[];
}

interface ResetOptions { focus?: boolean; selectedPassage?: PreparedPassage | null; show?: boolean; keepRace?: boolean; leaveCompose?: boolean }

import type { Application } from './application.js';
import { applicationElement } from './application-elements.js';
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
  conditionKey,
  createAttempt,
  inputRules,
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
import { BOOKS, BOOK_VERSION, bookPlace, openBook } from './books.js';
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
import { FOCUSES } from './learner.js';
import { isScoredRun } from './domain-history.js';
import { CORRECTION_LABELS, correctionLabel, dayKey, recordPracticeTime, comparableKind, evidenceRun, filterRuns, missedAndSlowWords, practiceTextConditions, recurringMissedWords, trendRun } from './insights.js';
import { formatSpeed, showSpeed, speedFigure } from './units.js';
import {
  LESSONS, keysLabel, lessonKeys, lessonPassage, lessonUnlocked, lessonsComplete,
  nextLessonIndex,
} from './lessons.js';
import { DARK_THEMES, DRILL_LENGTHS, LIGHT_THEMES, MIN_ACCURACY_OPTIONS, MIN_WPM_OPTIONS, defaultPreferences, emptyProfile, normalizeProfile, preferencesInUse, uid, validPreferences } from './profile.js';

export async function attachApplication({ practice, learning, palette, settings: settingsView, compose, quoteFilters, challenge, themeEditor, wallpaper, accounts, sync, deletion, inbox, friendsBoard, suggestion, importing, release, historyClear, recording, practiceRun: runSession, onlineRace, editors, lengthEditor, training, navigation, ghostOffer, ghostResult, displayedUnits }: Application) {
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

  const $ = applicationElement;
  const now = () => performance.now();

  const renderDaily = challenge.daily.refresh;
  const todayPassage = challenge.daily.passage;
  const renderLengthOptions = lengthEditor.refresh;
  const setCustomLengthError = lengthEditor.error;
  const openCustomLength = lengthEditor.open;
  const closeCustomLength = lengthEditor.close;

  function openCustom(open = true) { editors.open(open); }

  function showManualTarget(open: boolean) { editors.manual(open); setModeControls(); }

  function toggleManualTarget() { editors.toggleManual(); setModeControls(); }

  function markKeyboardTargets(target: string | null) { practice.keyboard.target(target); }

  function renderKeyboard() {
    const lesson = practice.sessionKind === 'lesson';
    practice.keyboard.show({ layout: learning.preferences.layout, fingers: learning.preferences.fingerMap,
      visible: Boolean(learning.preferences.keyboard) || lesson,
      lesson: lesson ? { known: lessonKeys(lessons.index - 1), fresh: indexed(LESSONS, lessons.index).keys } : null });
  }

  function customPassage() {
    const text = normalizeCustomText(learning.preferences.customText);

    if (!text) return null;

    return { id: null, text: orderCustomText(text, learning.preferences.customOrder), fresh: false };
  }

  await accounts.replaceIdentity(accounts.session);
  const { loadProfile, saveProfile, storeLocally, commitPreferences, saveChoice, absorbCache, pullProfile, syncOnLoad } = sync;
  sync.configure({ running: () => runInProgress(), showMerged, resetListedRuns() { progressState.allRuns = false; }, boardFor: (data) => boardFor(data),
    boardPushed() { friendsBoard?.pushed(); }, boardResume() { friendsBoard?.resume(); }, repairBoard, adoptProfile,
    legacyPreferences() { learning.preferences = preferencesInUse(learning.profile.preferences); }, clearCountsUnsaved() { runSession.markCountsSaved(); } });

  let historyWaiting = false;

  const saveRunCounts = runSession.saveCounts;
  const initialProfile = loadProfile();
  learning.initialize(initialProfile, preferencesInUse(initialProfile.preferences));

  let preferencesWaiting = false;
  let passage: PreparedPassage | null = null;

  let primaryCharacters: HTMLSpanElement[] = [];
  let primaryTextView: ReturnType<typeof renderText> | null = null;

  let stopHold: number | null = null;
  const STOP_HOLD_MS = 600;

  const onTape = () => document.body.dataset.tape === 'true';
  const primaryFx = createTypingFx($('typing-wrap'), $('text-display'), { ensureCharacters: (index) => primaryTextView?.ensureForward(index), tape: onTape });
  const race = challenge.local.state;
  const raceFx = challenge.local.fx;
  const setupRacePlayer = challenge.local.prepare;
  const finishRacePlayer = challenge.local.finish;

  const previewGlide = createWordGlide();

  $('settings-preview-passage').append(previewGlide.element);

  lifetime.observeResize(() => placePreviewGlide({ instant: true }), $('settings-preview-passage'));

  function placePreviewGlide({ instant = false, from = 0 } = {}) {
    const passage = $('settings-preview-passage');

    if (!learning.preferences.wordHighlightSlide || learning.preferences.wordHighlight === 'off' || !$('settings-dialog').open || !passage.offsetWidth) return;
    const word = (offset: number) => passage.querySelectorAll<HTMLElement>(':scope > *')[(learning.preferences.wordHighlight === 'next' ? 3 : 2) + offset] ?? null;

    if (from) previewGlide.follow(word(from), { instant: true });
    previewGlide.follow(word(0), { instant });
  }

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

  const ghostOn = () => learning.preferences.paceCaret !== 'off';
  let keybindingEditor: KeybindingEditorController | null = null;
  let detachWallpaper: (() => void) | null = null;

  let displayedIds: (string | null | undefined)[] | null = null;

  let composeOpen = false;

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

  const historySelection = createHistorySelection(learning, practice, training, { running: () => runInProgress(), forgetTraining });
  const retainedBaseline = historySelection.retainedBaseline;
  const trainingRecommendation = historySelection.recommendation;
  const forgetClearedTraining = historySelection.forgetCleared;

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

  function requireGhost() {
    const current = ghostResult.race;

    if (!current) throw new TypeError('A ghost attempt requires its race');

    return current;
  }

  const ghostPassage = () => ghostResult.passage(learning.profile.seenTextIds);

  let sessionCount = 0;
  let typedCount = 0;

  const TRAINING_PREFERENCES = ['trainFocus', 'drillSeconds', 'retest'];

  const FOCUS_KEYWORDS = { balanced: 'both mix', accuracy: 'mistakes errors misses', speed: 'slow pace timing' };

  const DISPLAY_PREFERENCES = ['theme', 'darkTheme', 'lightTheme', 'customThemes', 'fontSize', 'typingFont', 'appFont', 'wordHighlight', 'wordHighlightSlide', 'tape', 'liveMetrics', 'keyboard', 'fingerMap', 'focusMode', 'speedUnit', 'sound', 'soundVolume', 'keybindings', 'dailyGoal',
    ...TRAINING_PREFERENCES];

  const runInProgress = () => runActive || localRaceRunning();

  const { enterAccount, signOutAccount, followSessionElsewhere, finishFollow } = createAccountTransitions(
    accounts, sync, onlineRace, inbox, friendsBoard, { running: runInProgress, reload: () => location.reload() });

  const attemptPrepared = () => practice.attempt !== null && !['complete', 'interrupted'].includes(practice.attempt.status);

  const untouchedPractice = () => practice.sessionKind === 'practice' && practice.attempt?.status === 'ready' && !practice.attempt.events.length;

  function followStoredPreferences({ conditions = !attemptPrepared() } = {}) {
    commitPreferences();

    if (runInProgress()) {
      preferencesWaiting = true;

      return;
    }

    const stored: HistoricalRecord = { ...defaultPreferences, ...learning.profile.preferences };
    const next: HistoricalRecord = { ...learning.preferences };
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

  function setCapsWarning(on: boolean) {
    if ((practice.intro.getSnapshot().caps === true) === on) return;
    practice.presentIntro({ caps: on });

    if (on) announce('Caps Lock is on');
  }

  function syncCapsLock(event: Event) {
    if (!('getModifierState' in event) || typeof event.getModifierState !== 'function') return;
    setCapsWarning(event.getModifierState('CapsLock'));
  }

  let announcing: string[] = [];

  function announce(message: string) {
    if (!announcing.length) {
      $('announcement').textContent = '';
      requestAnimationFrame(() => { $('announcement').textContent = announcing.join(' '); announcing = []; });
    }

    if (!announcing.includes(message)) announcing.push(message);
  }

  const { recipeLabel, recipeSummary, conditionTail, describeConditions, describeMinimums, stopReason, describeRun, inputLabel } = createRunCopy(learning, conditions);

  const startedBy = (event: { pointerType?: string } | null) => (event?.pointerType && event.pointerType !== 'mouse' ? 'touch' : 'physical-keyboard');

  let activationInput: InputClass = 'physical-keyboard';
  const TEXT_FIELDS = 'textarea, input:not([type="checkbox"])';

  let runActive = false;

  function setRunning(running: boolean) {
    if (runActive !== running) {
      runActive = running;
      runChanged();
    }

    if (!running) flushDeferredSync();
    showChrome(!running);
  }

  function runChanged() {
    inbox?.runChanged();

    if (!runInProgress()) sounds.rest();

    ghostLaunch.runChanged();
  }

  function flushDeferredSync() {
    if (runInProgress()) return;

    if (sync.state.signedOutElsewhere) {
    
      if (sync.state.pendingSignOut === null) location.reload();

      return;
    }

    if (sync.state.cacheWaiting && absorbCache()) setTimeout(showMerged);

    if (preferencesWaiting) followStoredPreferences();

    if (forgetClearedTraining() || historyWaiting) followHistory();
  }

  function raceRunChanged() {
    runChanged();
    flushDeferredSync();
  }

  function showChrome(shown: boolean) {
    const value = String(!shown);

    if (document.body.dataset.running !== value) document.body.dataset.running = value;
  }

  function currentBestKey() {
    return comparableKind(practice.sessionKind) ? conditionKey(practice.attempt?.conditions || conditions()) : null;
  }

  function showBest() {
    const key = currentBestKey();

    if (key && (practice.attempt?.conditions || conditions()).mode === 'code') {
      practice.presentIntro({ best: ['Code runs aren’t ranked'] });

      return;
    }

    const best = key && learning.profile.bests[key];
    practice.presentIntro({ best: copyParts(!key ? 'Not counted' : best ? ['Best · ', speedFigure(best.wpm)] : 'No best yet') });
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
    selectSetting('font-size', String(learning.preferences.fontSize));
    selectSetting('word-highlight', learning.preferences.wordHighlight);
    selectSetting('word-highlight-slide', learning.preferences.wordHighlightSlide);
    settingsView.present({ slide: learning.preferences.wordHighlight !== 'off' });
    placePreviewGlide();
    selectSetting('live-toggle', String(learning.preferences.liveMetrics));
    selectSetting('keyboard-toggle', String(learning.preferences.keyboard));
    syncRules();
    selectSetting('finger-toggle', learning.preferences.fingerMap);
    disableSetting('finger-toggle', !learning.preferences.keyboard);
    selectSetting('correction-select', learning.preferences.correction);
    selectSetting('focus-toggle', String(learning.preferences.focusMode));
    selectSetting('tape-toggle', learning.preferences.tape);
    renderKeyboard();
    applySoundPreferences();
    applyTheme();
    selectSetting('numbers-toggle', Boolean(learning.preferences.numbers));
    quoteFilters.refresh();
    selectSetting('word-list', String(learning.preferences.wordList));
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

  function showMinimumNote() {
    const minimums = describeMinimums(practiceMinimums());
    flushSync(() => practice.controls.publish({ ...practice.controls.getSnapshot(), minimums: copyParts(minimums), minimumVisible: Boolean(minimums.length) && !editors.customOpen && !composeOpen && practice.sessionKind !== 'custom' }));
  }

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

  function syncRules() {
    const limits = ruleLimits(ruleSession());
    selectSetting('strict-space-toggle', learning.preferences.strictSpace);
    selectSetting('quick-end-toggle', learning.preferences.quickEnd);
    disableSetting('quick-end-toggle', Boolean(limits.quickEnd));

    settingsView.present({ quickEnd: lookup(RULE_NOTES, limits.quickEnd) || '', rules: lookup(RULE_NOTES, limits.fixed) || '' });
  }

  const standardLocked = () => learning.preferences.mode === 'standard' && practice.sessionKind !== 'custom';

  function syncLockedSettings() {
    const standard = standardLocked();
  
    const fixed = ['quote', 'code', 'book'].some((mode) => mode === learning.preferences.mode);
    disableSetting('numbers-toggle', fixed || standard);
    selectSetting('numbers-toggle', standard || Boolean(learning.preferences.numbers));
    disableSetting('word-list', fixed || standard);
    settingsView.present({ standard });
    selectSetting('word-list', String(standard ? 'standard' : learning.preferences.wordList));
    disableSetting('repeat-quotes-toggle', learning.preferences.mode !== 'quote');
    disableSetting('correction-select', standard);
    selectSetting('correction-select', standard ? 'mandatory' : learning.preferences.correction);

  }

  function setModeControls() {
    quoteFilters.dismiss();
  
    const custom = !composeOpen && (editors.customOpen || practice.sessionKind === 'custom');
    syncLockedSettings();
    showMinimumNote();

    if (custom || composeOpen || learning.preferences.mode === "standard") closeCustomLength();
    renderLengthOptions();
    flushSync(() => practice.controls.publish({
      ...practice.controls.getSnapshot(),
      visible: practice.sessionKind === 'practice' || practice.sessionKind === 'custom', bookPage: bookPlace(learning.profile.runs, learning.preferences.book) + 1,
      mode: learning.preferences.mode, duration: learning.preferences.duration, count: learning.preferences.count,
      lengthMode: (learning.preferences.mode === 'time' || learning.preferences.mode === 'words') ? learning.preferences.mode : practice.controls.getSnapshot().lengthMode,
      lengthValue: learning.preferences.mode === 'time' ? learning.preferences.duration : learning.preferences.mode === 'words' ? learning.preferences.count : practice.controls.getSnapshot().lengthValue,
      punctuation: Boolean(learning.preferences.punctuation), adaptive: learning.preferences.adaptive,
      custom, customOpen: editors.customOpen, manualOpen: editors.view.getSnapshot().manual, composing: composeOpen, codeLanguage: learning.preferences.codeLanguage,
      standardRecipe: recipeSummary() + ' · ' + correctionLabel(standardConditions().correctionPolicy),
    }));
    showBest();
    requestAnimationFrame(() => updateGlides());
  }

  function setCustomLengthFromPalette(mode: 'time' | 'words') {
    if (learning.preferences.mode !== mode || editors.customOpen || practice.sessionKind === 'custom') setTestShape(mode);
    else navigate('practice');
    openCustomLength(mode);
  }

  function choosePassage(extraSeen: readonly unknown[] = [], { allowRepeats = false } = {}) {
    if (learning.preferences.mode === 'code') return { ...codePassage(learning.preferences.codeLanguage, { seenIds: [...learning.profile.seenTextIds, ...extraSeen] }), corpus: CORPUS_VERSION };

    if (learning.preferences.mode === 'book') return bookPassage(extraSeen);

    return selectPassage({
      mode: learning.preferences.mode,
      count: learning.preferences.count,
      duration: learning.preferences.duration,
      punctuation: Boolean(learning.preferences.punctuation),
      numbers: Boolean(learning.preferences.numbers),
      quoteLength: learning.preferences.quoteLength,
      difficulty: learning.preferences.difficulty,
      wordList: learning.preferences.wordList,
      seenIds: [...learning.profile.seenTextIds, ...extraSeen],
      allowRepeats,
    });
  }

  function bookPassage(extraSeen: readonly unknown[] = []) {
    const book = openBook(learning.preferences.book);

    if (!book) throw new TypeError('A book passage requires its book');
    const page = indexed(book, bookPlace(learning.profile.runs, learning.preferences.book));
    const seen = [...learning.profile.seenTextIds, ...extraSeen].includes(page.id);

    return { ...page, textVersion: `${page.id}@1`, corpus: BOOK_VERSION, difficulty: 'book', fresh: !seen, exhausted: seen };
  }

  function repeatedTextNotice() {
    if (practice.sessionKind !== 'practice' || passage?.fresh !== false) return '';

    return passage.exhausted && !learning.preferences.repeatQuotes && learning.preferences.mode === 'quote'
      ? 'You’ve seen every matching quote. Repeated text doesn’t count toward your best.'
      : 'Repeated text · doesn’t count toward your best.';
  }

  function setPassageNotice(text: string) {
    inputPresentation.noticeText = text;
    $('input-help').textContent = text;
    $('input-help-reserve').textContent = text;
  }

  function configureSessionCopy() {
    const copy = {
      practice: ['practice', 'Practice', ''],
      drill: [`drill · ${drillLength()} s`, training.target ? `Practice “${training.target}”` : 'General drill', 'Doesn’t count toward your best.'],
      custom: ['custom text', 'Your text', 'Doesn’t count toward your best.'],
      retest: ['fresh-text retest', 'Measure the change', passage?.fresh === false ? 'You’ve seen every matching quote, so this can’t be a fresh comparison.' : 'Fresh text, same conditions.'],
      missed: ['missed words', training.words?.recurring ? 'Practice words you keep missing' : 'Practice missed and slowest words', 'Doesn’t count toward your best.'],
      daily: ['daily challenge', 'Today’s passage', `${passage?.day} · resets at midnight UTC · ${passage?.firstDailyAttempt ? 'first attempt' : 'repeat attempt'}${passage?.firstDailyAttempt && !passage?.fresh ? ' · previously displayed passage' : ''}`],
      lesson: ['lesson', `Lesson ${lessons.index + 1} · ${keysLabel(indexed(LESSONS, lessons.index).keys)}`, lessonCopy(lessons.index, passage)],
      challenge: ghostResult.race?.own ? ['ghost race', 'Race your best run', 'The ghost is your own recording. Not counted toward your best.']
        : ['ghost race', `Race ${ghostResult.race?.name}’s run`, 'Your first finish without a break is sent. Not counted toward your best.'],
    }[practice.sessionKind];

    practice.presentIntro({ kicker: copy[0] });
    practice.presentIntro({ title: copy[1] });
    practice.presentIntro({ description: copy[2] });
    document.body.dataset.session = practice.sessionKind;
    flushSync(() => practice.controls.publish({ ...practice.controls.getSnapshot(), visible: practice.sessionKind === 'practice' || practice.sessionKind === 'custom', bookPage: bookPlace(learning.profile.runs, learning.preferences.book) + 1 }));
  
    showBest();
  }

  function assertPrepared<T extends object>(value: T): asserts value is T & Pick<PreparedPassage, 'id' | 'text'> {
    if (!('id' in value) || (value.id !== null && typeof value.id !== 'string') || !('text' in value) || typeof value.text !== 'string') throw new TypeError('A native passage requires its id and text');
  }

  function resetSession(kind: SessionKind = practice.sessionKind, { focus = false, selectedPassage = null, show = true, keepRace = false, leaveCompose = false }: ResetOptions = {}) {

    if (composeOpen) {
      if (kind === 'practice' && !leaveCompose) {
        switchView('practice');

        if (focus) compose.focus();

        return false;
      }

      closeCompose();
    }

    typingHost.clearFor('primary');
    runSession.stopClock();
    setRunning(false);
    saveRunCounts();

    followStoredPreferences({ conditions: kind !== 'retest' && kind !== 'drill' });
    setPassageNotice('');
    setCustomLengthError('');

    if (!keepRace) sessionCount += 1;

    if (kind === 'challenge' && !ghostResult.race) kind = 'practice';

    if (kind === 'missed' && !training.words) kind = 'practice';
    const kindChanged = practice.sessionKind !== kind;
    setSessionKind(kind);

    if (kindChanged && kind !== 'custom') editors.customOpen = false;

    if (kindChanged) setModeControls();

    if (kind === 'lesson' && !lessonUnlocked(learning.profile.lessons, lessons.index)) lessons.index = nextLessonIndex(learning.profile.lessons);

    const prepared = selectedPassage || (kind === 'missed' ? training.words : kind === 'daily' ? todayPassage() : kind === 'drill' ? drillPassage()
      : kind === 'lesson' ? lessonPassage(lessons.index) : kind === 'challenge' ? ghostPassage() : kind === 'custom' ? customPassage()
        : (kind === 'practice' && adaptivePassage()) || choosePassage(kind === 'retest' && training.baseline ? [training.baseline.textId] : [], { allowRepeats: kind === 'practice' && learning.preferences.repeatQuotes }));

    if (prepared) assertPrepared(prepared);

    passage = prepared;

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

        for (const id of ['live-accuracy', 'timer'] as const) $(id).textContent = '—';
        $('progress-bar').style.setProperty('--progress', '0');
        $('progress-track').setAttribute('aria-valuenow', '0');
        configureSessionCopy();
        switchView('practice');
      }

      return false;
    }

    recordSeenOnDisplay(['drill', 'missed', 'lesson'].includes(kind) || passage.book || passage.adaptive ? [] : [passage.id, kind === 'daily' ? passage.challengeId : null]);
  
    const runConditions = kind === 'daily' ? dailyConditions() : kind === 'lesson' ? lessonConditions() : kind === 'missed' ? { ...conditions(), mode: 'missed', duration: null, count: null, ...practiceTextConditions(passage.text), quoteLength: null, difficulty: null, wordList: null, corpus: CORPUS_VERSION } : kind === 'challenge' ? ghostConditions() : kind === 'custom' ? customConditions() : conditions();
    practice.attempt = createAttempt({
      id: uid(),
      text: passage.text,
      textId: passage.id,
      kind: kind === 'practice' ? (passage.adaptive ? 'drill' : 'test') : kind,
      conditions: { ...sessionConditions(kind, runConditions), inputClass: activationInput },
    });

    if (kind === 'challenge') practice.attempt.challengeId = requireGhost().id;

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

    if (kind === 'lesson') {
      const { lessonId, pairs, words } = passage;

      if (typeof lessonId !== 'string' || typeof pairs !== 'number' || typeof words !== 'number') throw new TypeError('A lesson passage requires its lesson counts');
      practice.attempt.lesson = { id: lessonId, index: lessons.index, pairs, words };
    }

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

    if (kind === 'challenge') primaryFx.ghost.replay(requireGhost().points);
    armPace();
    renderKeyboard();

    if (kind !== 'lesson') markKeyboardTargets(kind === 'drill' ? training.target : null);
    $('typing-status').className = 'badge badge-info';
    $('typing-status').innerHTML = '<span class="status-dot" aria-hidden="true"></span>Ready';
  
    setPassageNotice(repeatedTextNotice());
    practice.presentIntro({ conditions: copyParts(describeRun(practice.attempt)) });
    configureSessionCopy();
    updateLive(true);

    if (show) switchView('practice');

    if (focus) $('typing-input').focus({ preventScroll: true });

    return true;
  }

  function recordSeenOnDisplay(ids: (string | null | undefined)[]) {
    if (!displayedIds) {
      queueMicrotask(() => {
        const batch = displayedIds;

        if (!batch) throw new Error('A seen-passage batch is required');
        const unseen = batch.filter((id): id is string => Boolean(id) && typeof id === 'string' && !learning.profile.seenTextIds.includes(id));
        displayedIds = null;

        if (!unseen.length) return;
        learning.profile.seenTextIds.push(...unseen);
        saveProfile();
      });
    }

    displayedIds = ids;
  }

  function showUnavailableRetest(reason: string) {
    switchView('train');
    updateComparison({ compared: false, conditions: '', caveat: reason });
    showComparison('No fair retest available.', 'unavailable', training.context?.target || null);
    announce(reason);
  }

  function openCompose() {
    if (!composeOpen) {
      runSession.stopClock();

      if (practice.attempt?.status === 'running') {
        primaryFx.finish();
        practice.attempt = null;
      }

      setSessionKind('practice');
      composeOpen = true;
    
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

  function ghostPace(mode = learning.preferences.paceCaret) {
  
    if (practice.attempt?.kind === 'lesson') {
      const wpm = indexed(LESSONS, lessons.index).wpm;

      return { wpm, cps: (wpm * CHARS_PER_WORD) / 60, fromBest: false, fallback: false };
    }

    const key = conditionKey(practice.attempt?.conditions || conditions());
    let wpm = null;

    if (mode === 'custom') wpm = learning.preferences.paceWpm;
    else if (mode === 'best') wpm = learning.profile.bests[key]?.wpm || null;
    else if (mode === 'average' || mode === 'last') {
    
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

  function armPace() {
    const start = practice.startTime;
    const running = practice.attempt?.status === 'running' && start !== null;
    const live = running || practice.attempt?.status === 'ready';

    if (practice.sessionKind !== 'challenge') primaryFx.ghost.arm(ghostOn() && live ? ghostPace().cps : 0, running ? start : 0);
    showPace();
  }

  function setPaceCaret(mode: ActivePreferences['paceCaret'], { speed = false } = {}) {
    const speedShown = speed || (mode === 'custom' && learning.preferences.paceCaret === 'custom');
    learning.preferences.paceCaret = mode;
    saveChoice('paceCaret', ...(speedShown ? ['paceWpm'] : []));
    armPace();
  }

  const rateShown = (completed: SealedRun) => comparableKind(completed.kind) || completed.summary.elapsedMs >= RATE_FLOOR_MS;

  function storeAttempt(completed: SealedRun) { return recording.store(completed); }

  const failedDrill = (completed: SealedRun) => completed.kind === 'drill' && Boolean(completed.failed);

  function finishPrimary(forcedElapsed: number | null = null, { replacing = false, stop = null }: { replacing?: boolean; stop?: MinimumFailure | null } = {}) {
    if (!practice.attempt || practice.attempt.status !== 'running') return;

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

    if (practice.sessionKind === 'lesson') {
      finishLesson(completed, valid);
      saveRunCounts();

      return;
    }

    const saved = storeAttempt(completed);

    if (practice.sessionKind === 'drill' && training.baseline && training.context?.retest !== false && !completed.failed) {
      if (training.context) training.context.drillCompleted = valid;

      if (replacing) return;
      announce(valid ? 'Drill complete. Retest ready.' : 'Drill interrupted. Retest ready.');
      startRetest();

      return;
    }

    if (practice.sessionKind === 'practice' || practice.sessionKind === 'daily') {

      if (completed.conditions?.mode === 'code') {
        training.baseline = null;
        training.context = null;
      } else if (valid && !completed.adaptive) {
      
        training.baseline = completed.fresh === false ? null : completed;
        training.context = null;
      }
    }

    renderResults(completed, saved);

    if (practice.sessionKind === 'retest') {
      switchView('train');
      renderComparison(training.baseline, completed, saved);
    
      scrollTo(0, 0);
      $('comparison-status').focus({ preventScroll: true });

      return;
    }

    if (practice.sessionKind === 'challenge') ghostResult.finish(completed, valid);

    switchView('results');
    renderCard(completed);
    focusResult($(failedDrill(completed) ? 'result-drill' : 'run-again'));

    stopHold = completed.stopped ? now() : null;
  }

  function focusResult(control: HTMLElement) {
    const root = getComputedStyle(document.documentElement);
    const room = innerHeight - (parseFloat(root.scrollPaddingTop) || 0) - (parseFloat(root.scrollPaddingBottom) || 0);
    const scoreTop = $('result-wpm').getBoundingClientRect().top;
    const fits = (node: HTMLElement, from = scoreTop) => node.getBoundingClientRect().bottom + (parseFloat(getComputedStyle(node).scrollMarginBottom) || 0) - from <= room;
    const card = $('run-card');
    const target = fits(control) ? control : $('results-heading');
    const row = control.closest<HTMLElement>('.result-actions');

    if (!row) throw new TypeError('A result action requires its row');
    const widest = fits(card, card.getBoundingClientRect().top) ? card : fits(row) ? row : control;

    target.focus({ preventScroll: true });
    (target === control ? widest : target).scrollIntoView({ block: 'nearest' });
  }

  function renderCard(completed: SealedRun) {
    if (rateShown(completed)) renderSpeedGraph($('speed-graph'), completed, { animate: true });
  }

  function resultHeadline(completed: SealedRun) {
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

  function showResult(completed: SealedRun | null) {
    practice.shownResult = completed;

    if (!completed) flushSync(() => practice.result.publish(null));
  }

  function renderResults(completed: SealedRun, saved: boolean) {
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

  const repeatedResult = (completed: SealedRun | null) => completed?.status === 'complete' && completed.kind === 'test' && completed.fresh === false;

  function renderResultDrill(completed: SealedRun) {
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

  function switchView(view: AppView) {
    quoteFilters.dismiss();
    const previous = document.body.dataset.view;

    if (view === 'progress' && document.body.dataset.view !== 'progress') Object.assign(progressState, { detail: '', moversOpen: false });
    navigation.show(view);
    setRunning(false);
    syncRules();
  
    updateGlides();

    if (view === 'progress') renderHistory();
  
    onlineRace?.onViewChange(view, { keep: previous === 'compete' && raceUnderWay() });

    if (view === 'train') {
      training.after = null;
      renderTrain({ fresh: true });
    }

    if (view === 'compete') renderDaily();

    if (view === 'learn') renderLessons();
  }

  function navigate(view: AppView, { keep = false } = {}) {
    if (view === 'practice') {

      const waitingTraining = keep && document.body.dataset.view !== 'practice' && practice.attempt?.status === 'ready' && (practice.sessionKind === 'drill' || practice.sessionKind === 'retest');
      const active = practice.attempt;
      const current = active && (practice.sessionKind === 'practice' || practice.sessionKind === 'custom' || waitingTraining) && !['complete', 'interrupted'].includes(active.status);
    
      const staleRules = current && active && inputRules(active.conditions).join() !== inputRules(sessionConditions(practice.sessionKind)).join();

      if (!current || staleRepeat() || staleAdaptive() || (preferencesWaiting && untouchedPractice())) resetSession('practice');
      else if (staleRules) resetSession(practice.sessionKind);
      switchView('practice');

      return;
    }

    if (practice.attempt?.status === 'running') {
      markInterrupted(NOTICES.leftSurface);
      finishPrimary(null, { replacing: true });
    }

    if (compose.isRunning()) compose.interrupt(NOTICES.composeLeft, { end: true });

    if (race.attempt?.status === 'running' && view !== 'compete') markRaceInterrupted();
    switchView(view);
  }

  function markInterrupted(message: string) {
    typingHost.forget('primary');
  
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

  function localRaceRunning() {
    return race.attempt?.status === 'running' && !race.attempt.interrupted && document.body.dataset.view === 'compete';
  }

  function trendRunsAt(key: string) {
    return filterRuns(learning.profile.runs.filter(trendRun), key).filter((run): run is typeof run & import('./profile-types.js').ScoredRun => isScoredRun(run) && Boolean(run.score.wpm));
  }

  function meanWpm(runs: readonly import('./profile-types.js').ScoredRun[]) {
    return Math.round(runs.reduce((sum, run) => sum + run.score.wpm, 0) / runs.length);
  }

  function labelWords() {
    const result = practice.result.getSnapshot();

    if (result) flushSync(() => practice.result.publish({ ...result }));
  }

  function dateCopy(at: string | number | null | undefined) {
    return at ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Earlier run · date unavailable';
  }

  const renderTraining = learning.progress.patterns.refresh;
  learning.progress.patterns.configure({ learning, conditions, describe: describeConditions, recommendation: trainingRecommendation, practice: practiceTarget, date: dateCopy });

  const plural = (count: number | undefined, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

  const narrowColumn = window.matchMedia('(max-width: 760px)');

  const practiceProgress = createPracticeProgress(learning, { inputLayout, recipeSummary, conditionTail, dateCopy,
    calendarWeeks: () => narrowColumn.matches ? 17 : 26, coarse: () => matchMedia('(any-pointer: coarse)').matches, period: () => progressState.period });

  const renderGoal = practiceProgress.goal;

  const renderLoops = createLoopHistory(learning, { describe: describeConditions, practice: practiceTarget }).render;

  const progressState = learning.progress.navigation.state;
  const progressHistory = createProgressHistory(learning, practiceProgress, { describe: describeConditions, describeRun, date: dateCopy, loops: renderLoops, focusShown });
  const { renderHistory, renderWeek, drawProgressView, chooseProgress, hasAnyHistory } = progressHistory;

  let keyboardInput = false;
  const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'Fn']);

  document.addEventListener('keydown', (event) => { if (!MODIFIER_KEYS.has(event.key)) keyboardInput = true; }, { capture: true, signal: lifetime.signal });

  document.addEventListener('pointerdown', () => { keyboardInput = false; }, { capture: true, signal: lifetime.signal });

  function focusShown(target: HTMLElement, { scroll = false } = {}) {
    target.toggleAttribute('data-focus-ring', keyboardInput);
    target.addEventListener('blur', () => target.removeAttribute('data-focus-ring'), { ...{ once: true }, signal: lifetime.signal });
    target.focus({ preventScroll: !scroll });
  }

  const openProgressDetail = learning.progress.navigation.open;

  function startDaily() {
    if (practice.attempt?.status === 'running') { markInterrupted(NOTICES.leftSurface); finishPrimary(null, { replacing: true }); }

    if (race.attempt?.status === 'running') markRaceInterrupted();
    training.baseline = null;
    training.context = null;
    resetSession('daily', { focus: true });
  }

  function raceContext() {
    return JSON.stringify([document.body.dataset.view, sessionCount, practice.attempt?.status, typedCount, editors.customOpen, race.attempt?.id,
      race.attempt?.status, onlineRace?.liveRoomId || null, Boolean(onlineRace?.pending), Boolean(document.querySelector('dialog[open]'))]);
  }

  const renderGhostOffer = ghostOffer.render;

  function raceConditions() {
    return { ...conditions(), mode: 'quote', wordList: null, localRace: true, corpus: CORPUS_VERSION };
  }

  function forgetTraining() {
    training.baseline = null;
    training.context = null;
    training.target = null;
  
    training.words = null;
    showResult(null);
    $('speed-graph').replaceChildren();
    ghostResult.show(false);
    renderGhostOffer(null);
    training.after = null;

    if (practice.attempt?.status === 'ready' && practice.sessionKind === 'retest') resetSession('practice', { show: false });
    else if (practice.attempt?.status === 'ready' && practice.sessionKind === 'drill') practice.presentIntro({ description: learning.preferences.mode === 'code' ? CODE_DRILL_NOTE : 'Standalone drill.' });

    if (document.body.dataset.view === 'train') renderTrain();
  }

  function wipeHistory() {
    learning.profile = emptyProfile();
    progressState.allRuns = false;
    forgetTraining();
  }

  function followHistory() {
    if (runInProgress()) {
      historyWaiting = true;

      return;
    }

    historyWaiting = false;
    forgetClearedTraining();
    showTraining();
  }

  function renderAccount() { accounts.render(); }

  const dailyKey = () => conditionKey(dailyConditions());

  const boardFor = (data: import('./profile-copy.js').SyncedProfile<import('./profile-types.js').HydratedProfile>) => (at: string) => (optOutPending(requireSession()) ? null : boardColumn(data.runs, dailyKey(), at));

  function showMerged() {
    followStoredPreferences();
  
    followLessonProgress();
    followHistory();

    if (runInProgress()) return;

    if (preferencesWaiting && untouchedPractice() && document.body.dataset.view === 'practice') resetSession('practice');
    showBest();
  
    armPace();
    const view = document.body.dataset.view;
    const screen = document.querySelector(`[data-screen="${view}"]`);
    const inUse = screen?.contains(document.activeElement) || screen?.querySelector('details[open]');

    if (view === 'progress' && !inUse) renderHistory();

    if (view === 'compete') renderDaily();
  }

  function adoptProfile(data: import('./profile-copy.js').SyncedProfile<import('./profile-types.js').HydratedProfile>) {
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

  function followLessonProgress() {
    lessons.follow();

    if (practice.sessionKind === 'lesson' && practice.attempt?.status !== 'running' && !lessonUnlocked(learning.profile.lessons, lessons.index)) resetSession('lesson', { show: false });
    redrawLessons();
  }

  function redrawLessons() {
    const list = $('lesson-list');
    const focused = document.activeElement;
    const selected = focused && list.contains(focused) ? focused.closest('.lesson-row') : null;
    const row = selected ? [...list.children].indexOf(selected) : -1;
    renderLessons();

    if (row >= 0) (list.children[row]?.querySelector('button') || $('lesson-primary')).focus({ preventScroll: true });
  }

  function freshAccountSession() { return accounts.fresh(); }

  function requireSession() {
    const current = accounts.session;

    if (!current) throw new TypeError('This account operation requires its session');

    return current;
  }

  function repairBoard(cloud: NonNullable<Awaited<ReturnType<typeof account.fetchCloudProfile>>>) {
    if (sync.state.syncTimer || boardCurrent(cloud) || optOutPending(requireSession())) return;
    account.repairBoard(requireSession(), boardColumn(normalizeProfile(cloud.data).runs, dailyKey(), cloud.updated_at), cloud.updated_at)
      .then((sent) => { if (sent) friendsBoard?.pushed(); }, () => {});
  }

  async function repairBoardNow() {
    if (!accounts.session) return;

    try {
      accounts.session = await freshAccountSession();
      const cloud = await account.fetchCloudProfile(requireSession());

      if (cloud) repairBoard(cloud);
    } catch {}
  }

  function closeAccountMenu() {
    $('account').open = false;
  }

  function exportData() {
    const file = account.exportCopy(learning.profile);
    const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
    link.click();
    URL.revokeObjectURL(url);
    announce('Your data was saved as a file on this device.');
  }

  const DELETED_NOTICE = 'stilltype-account-deleted';

  function openDeleteAccount() { deletion.open(); }

  function noticeDeletedAccount() {
    let deleted = false;

    try {
      deleted = sessionStorage.getItem(DELETED_NOTICE) === '1';
      sessionStorage.removeItem(DELETED_NOTICE);
    } catch {}

    if (deleted && !accounts.session) showAccountToast('Account deleted. You’re in guest mode.', 'done');
  }

  function openAccountDialog(mode: 'create' | 'signin') { accounts.open(mode); }

  function showAccountToast(message: string, tone = 'problem') { accounts.notify(message, tone); announce(message); }

  function bindAccount() {
    runSession.configure({ durationMs: sessionDurationMs, tick: () => updateLive(), startFx: (stamp) => primaryFx.ghost.run(stamp), started() {
      setRunning(true); setCustomLengthError(''); $('typing-status').innerHTML = '<span class="status-dot" aria-hidden="true"></span>In progress';
    } });
    recording.configure(showBest);
    learning.progress.commands.clear = historyClear.open;
    historyClear.configure({ dismissFilters: () => quoteFilters.dismiss(), passageLabel: () => ({ fresh: passage?.fresh, exhausted: passage?.exhausted }), labelPassage,
      forgetTraining() { historySelection.appliedClears(); forgetTraining(); },
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

    document.addEventListener('pointerdown', (event) => {
      if (menu.open && !(event.target instanceof Node && menu.contains(event.target))) closeAccountMenu();
    }, { signal: lifetime.signal });
    menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !menu.open) return;
      event.preventDefault();
      event.stopPropagation();
      closeAccountMenu();
      $('account-trigger').focus();
    }, { signal: lifetime.signal });

    lifetime.observeMutation(() => {
      if (menu.open) { settingsView?.close(); $('inbox').open = false; }
    }, menu, { attributeFilter: ['open'] });

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

  async function completeAuthRedirect() {
    try {
      const newSession = await account.completeRedirect(location.href);

      if (newSession) await enterAccount(newSession);
    } catch (error) {
      showAccountToast(error instanceof Error ? error.message : String(error));
    }
  }

  function openImport() { importing.open(); }

  function importSettings(result: ImportedSettings) {
    const keys = Object.keys(result.preferences);
    const conditions = keys.some((key) => !DISPLAY_PREFERENCES.includes(key) && !['paceCaret', 'paceWpm'].includes(key));
    learning.preferences = validPreferences({ ...learning.preferences, ...result.preferences });

    if (keys.includes('mode')) editors.customOpen = false;
    applyPreferences();
    setModeControls();
  
    saveChoice(...keys, ...(keys.includes('correction') ? ['stopOnError'] : []));

    if (conditions && !runInProgress()) resetSession(keys.includes('mode') ? 'practice' : restartKind(), { leaveCompose: keys.includes('mode') });

  }

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
      chooseMode(mode: Parameters<typeof practice.choices.chooseMode>[0]) {
        editors.customOpen = false;
        learning.preferences.mode = mode;
        setModeControls();
        saveChoice('mode');
        resetSession('practice', { focus: true, leaveCompose: true });
      },
      chooseLanguage(language: Parameters<typeof practice.choices.chooseLanguage>[0]) {
        learning.preferences.codeLanguage = language;
        setModeControls();
        saveChoice('mode', 'codeLanguage');
        resetSession('practice', { focus: true });
      },
      chooseLength(length: number) {
        if (learning.preferences.mode === 'time') learning.preferences.duration = length;
        else learning.preferences.count = length;
        setModeControls();
        saveChoice('mode', learning.preferences.mode === 'time' ? 'duration' : 'count');
        resetSession('practice', { focus: true });
      },
      punctuation(on: boolean) { learning.preferences.punctuation = on; setModeControls(); saveProfile(); resetSession('practice', { focus: true }); },
      adaptive(on: boolean) { learning.preferences.adaptive = on; setModeControls(); saveProfile(); resetSession('practice', { focus: true }); },
      compose: openCompose,
      manual: toggleManualTarget,
      lessons: openLessons,
      custom: () => openCustom(!editors.customOpen),
    });
  
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
    onSetting('speed-unit', (value) => { if (value === 'wpm' || value === 'cpm') setSpeedUnit(value); });
    onSetting('word-highlight', (value) => setWordHighlight(value));
    onSetting('word-highlight-slide', (value) => setWordHighlightSlide(value === 'true'));
    keybindingEditor = settingsView.keybindings;
    keybindingEditor.configure({
      getBindings: () => learning.preferences.keybindings,
      onSave: (bindings) => { learning.preferences.keybindings = bindings; applyPreferences(); saveChoice('keybindings'); },
    });
    keybindingEditor.refresh();
    onSetting('wallpaper-style', wallpaper.style);
    detachWallpaper = wallpaper.attach({ layer: $('wallpaper'), surfaces: [$('typing-form'), $('compose-form')], reading: [$('live-stats'), $('typing-wrap'), ...document.querySelectorAll<HTMLElement>('.shortcut-row, .site-footer > *')] });
    settingsView.configure(() => settingsView.keybindings.stopRecording());
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
  
    settingsView.onVolume((value) => setSoundVolume(value, { save: false }), () => saveChoice('soundVolume'));

    practice.connectNative(typingHost);

    for (const type of ['keydown', 'keyup']) $('typing-input').addEventListener(type, syncCapsLock, { signal: lifetime.signal });
    $('typing-input').addEventListener('blur', () => setCapsWarning(false), { signal: lifetime.signal });

    document.addEventListener('pointerdown', (event) => {
      activationInput = startedBy(event);

      const active = practice.attempt;

      if (activationInput !== 'touch' || !active || !['ready', 'running'].includes(active.status) || active.conditions.inputClass === 'touch') return;
      active.conditions.inputClass = 'touch';
      active.conditions.layout = inputLayout('touch');
      practice.presentIntro({ conditions: copyParts(describeRun(active)) });
      showBest();

      if (active.status === 'ready') armPace();
    }, { capture: true, signal: lifetime.signal });
    document.addEventListener('keydown', (event) => {
      if (!(event.target instanceof Element && event.target.matches(TEXT_FIELDS))) activationInput = 'physical-keyboard';
    }, { capture: true, signal: lifetime.signal });
  
    document.addEventListener('beforeinput', () => { typedCount += 1; }, { capture: true, signal: lifetime.signal });
    practice.commands.watchReplay = () => practice.replay.open(practice.shownResult);
    practice.commands.runAgain = runAgain;

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
  
    learning.commands.back = () => {
      if (practice.shownResult?.kind !== 'retest' || practice.shownResult !== practice.attempt) {
        navigate('practice');

        return;
      }

      switchView('results');
      renderCard(practice.shownResult);
    
      renderResultDrill(practice.shownResult);
      focusResult($('run-again'));
    };

    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) return;

      if (event.repeat && event.key === ' ' && document.activeElement === $('run-again')) {
        event.preventDefault();

        return;
      }

      if (event.target instanceof Element && event.target.closest('#quote-options [role="combobox"]')) {
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

        if ($('settings-dialog').open && !settingsView.keybindings.isRecording()
          && !document.activeElement?.closest('input, textarea, select, [contenteditable]')
          && matchesAppBinding(event, learning.preferences.keybindings.commands)) {
          event.preventDefault();

          if (!event.repeat) palette.open();
        } else if ($('palette').open && matchesAppBinding(event, learning.preferences.keybindings.commands)) {
          event.preventDefault();

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
      const onTypingSurface = ['typing-input', 'race-input', 'online-input', 'compose-input'].some((id) => id === active?.id);
      const editable = active?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');

      if (!settingsView.keybindings.isRecording() && (!editable || onTypingSurface) && matchesAppBinding(event, learning.preferences.keybindings.commands)) {
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

    let pointer: { x: number; y: number } | null = null;
    document.addEventListener('pointermove', (event) => {
      const moved = pointer ? Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) : 0;

      if (!pointer || document.body.dataset.running !== 'true' || moved > 4) pointer = { x: event.clientX, y: event.clientY };

      if (moved > 4) showChrome(true);
    }, { signal: lifetime.signal });
  }

  function setTestShape(mode: string, length?: number) {
    editors.customOpen = false;
    learning.preferences.mode = mode;

    if (mode === 'time' && length) learning.preferences.duration = length;

    if (mode === 'words' && length) learning.preferences.count = length;
    setModeControls();
    saveChoice('mode', ...(length && mode !== 'quote' ? [mode === 'time' ? 'duration' : 'count'] : []));
    resetSession('practice', { focus: true, leaveCompose: true });
  }

  function togglePreference(key: 'keyboard' | 'liveMetrics' | 'focusMode' | 'tape') {
    learning.preferences[key] = !learning.preferences[key];
    applyPreferences();
    saveProfile();

    if (document.body.dataset.view === 'practice') focusPractice();
  }

  function setCorrection(policy: string) {
    if (standardLocked()) return;
    const next = correctionPreference({ correction: policy });
    const changed = learning.preferences.correction !== next;
    learning.preferences.correction = next;
    learning.preferences.stopOnError = learning.preferences.correction === 'mandatory';
    saveChoice('correction', 'stopOnError');

    if (!changed) return;
    applyPreferences();

    if (document.body.dataset.view === 'practice') resetSession(practice.sessionKind === 'lesson' ? 'lesson' : restartKind());
  }

  function setSound(mode: string) {
    learning.preferences.sound = normalizeSoundMode(mode);
    applySoundPreferences();
    sounds.prepare();
    saveChoice('sound');
  }

  function setSoundVolume(volume: number, { save = true } = {}) {
    learning.preferences.soundVolume = normalizeSoundVolume(volume);
    applySoundPreferences();
    sounds.prepare();

    if (save) saveChoice('soundVolume');
  }

  function setSpeedUnit(unit: 'wpm' | 'cpm') {
    learning.preferences.speedUnit = unit;
    applyPreferences();
    saveChoice('speedUnit');
  }

  function setInputRule(key: 'strictSpace' | 'quickEnd', enabled: boolean) {
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

  function matchesAppBinding(event: Parameters<typeof matchesBinding>[0], binding: string | null | undefined) {
    return matchesBinding(event, binding, { allowAccentComposition: activeAccentComposition() });
  }

  function quickRestart(event: KeyboardEvent) {
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

  function restartTest() {
    if (document.body.dataset.view === 'results') runAgain();
    else if (composeOpen) compose.restart();
    else resetSession(practice.sessionKind, { focus: true });
  }

  function runAgain() {
    if (practice.sessionKind === 'daily') startDaily();
    else resetSession(practice.sessionKind === 'missed' ? 'missed' : restartKind(), { focus: true, leaveCompose: true });
  }

  function restartHint() {
    return document.body.dataset.view === 'results' && learning.preferences.keybindings.restart === 'Tab' ? 'enter' : bindingLabel(learning.preferences.keybindings.restart);
  }

  function setTraining<K extends 'trainFocus' | 'drillSeconds' | 'retest'>(key: K, value: ActivePreferences[K]) {
    learning.preferences[key] = value;
    applyPreferences();
    saveChoice(key);
    showTraining();
  }

  function showTraining() {
    const view = document.body.dataset.view;

    if (view === 'learn') redrawLessons();

    if (view === 'results' && practice.shownResult) renderResultDrill(practice.shownResult);

    if (view === 'train') renderTrain();

    renderTraining();

    if (view === 'progress') renderWeek();

    if (view === 'practice' && staleAdaptive()) resetSession('practice');
  }

  function setRepeatQuotes(enabled: boolean) {
    const changed = learning.preferences.repeatQuotes !== enabled;
    learning.preferences.repeatQuotes = enabled;
    saveChoice('repeatQuotes');

    if (!changed) return;
    applyPreferences();

    if (practice.sessionKind !== 'practice' || passage?.fresh !== false || practice.attempt?.status !== 'ready') return;

    if (staleRepeat() && document.body.dataset.view === 'practice') resetSession('practice');
    else setPassageNotice(repeatedTextNotice());
  }

  function labelPassage(fresh: boolean | undefined, exhausted: boolean | undefined) {
    const active = practice.attempt;

    if (!passage || !active) throw new TypeError('Labeling a passage requires its prepared attempt');
    passage.fresh = fresh;
    passage.exhausted = exhausted;
    active.fresh = fresh;
    setPassageNotice(repeatedTextNotice());
    practice.presentIntro({ conditions: copyParts(describeRun(active)) });
  }

  function staleAdaptive() {
    return untouchedPractice() && passage?.adaptive && passage.trainFocus !== learning.preferences.trainFocus;
  }

  function staleRepeat() {
    return !learning.preferences.repeatQuotes && practice.sessionKind === 'practice' && practice.attempt?.status === 'ready' && passage?.fresh === false && !passage.exhausted;
  }

  function setMinimum(key: 'minAccuracy' | 'minWpm', value: number) {
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

  function setWordHighlight(mode: string) {
    learning.preferences.wordHighlight = normalizeWordHighlight(mode);
    applyPreferences();
    saveChoice('wordHighlight');
  }

  function setWordHighlightSlide(on: boolean) {
    const turnedOn = on && !learning.preferences.wordHighlightSlide;
    learning.preferences.wordHighlightSlide = on;
    applyPreferences();

    if (turnedOn) placePreviewGlide({ from: -1 });
    saveChoice('wordHighlightSlide');
  }

  function resetForCondition(kind: SessionKind) {
    const practising = ['practice', 'results'].some((view) => view === document.body.dataset.view);

    return resetSession(kind, { focus: practising, show: practising });
  }

  function setWordList(id: string, kind: SessionKind = restartKind()) {
    if (!wordListIds.some((offered) => offered === id)) return;
    const changed = learning.preferences.wordList !== id;
    learning.preferences.wordList = id;
    saveChoice('wordList');

    if (!changed) return;
    applyPreferences();
    resetForCondition(kind);
  }

  function inPractice(change: (kind: SessionKind) => void) {
    const kind = restartKind();
    navigate('practice');
    change(kind);
  }

  function customLengthCommand(mode: 'time' | 'words') {
    const spec = LENGTHS[mode];
  
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

  function setLayout(id: string, kind: SessionKind = restartKind()) {
    const next = normalizeLayout(id);
    const changed = learning.preferences.layout !== next;
    learning.preferences.layout = next;
    applyPreferences();
    saveChoice('layout');

    if (changed) resetForCondition(kind);
  }

  function toggleFingerMap() {
    const show = !(learning.preferences.keyboard && learning.preferences.fingerMap);
    learning.preferences.fingerMap = show;

    if (show) learning.preferences.keyboard = true;
    applyPreferences();
    saveChoice('fingerMap', ...(show ? ['keyboard'] : []));

    if (document.body.dataset.view === 'practice') $('typing-input').focus({ preventScroll: true });
  }

  function jumpTo(view: AppView) {
  
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

  function paletteCommands(query: string): PaletteCommand[] {
    const onOff = (value: boolean) => (value ? 'on' : 'off');
    const missedWords = recurringMissedWords(learning.profile.runs).words.length;
  
    const shared = friendsBoard?.sharing ?? null;
  
    const shape = (mode: string, length?: number) => !composeOpen && comparableKind(practice.sessionKind) && learning.preferences.mode === mode && (['quote', 'standard', 'book'].includes(mode) || (mode === 'time' ? learning.preferences.duration : learning.preferences.count) === length);
  
    const fixedText = ['quote', 'code', 'book'].some((mode) => mode === learning.preferences.mode) || standardLocked();

    const commands: PaletteCommand[] = [
      ...([['practice', 'practice'], ['train', 'train'], ['progress', 'progress'], ['compete', 'challenge']] as const).map(([view, label]) => ({
        group: 'go to', label, keywords: `${view} open view page`, hint: document.body.dataset.view === view ? 'here' : '', on: document.body.dataset.view === view, run: () => jumpTo(view),
      })),
      ...([['runs', 'runs and drills', 'history list retests comparisons'], ['keys', 'keys and pairs', 'heatmap patterns across runs'], ['calendar', 'practice calendar', 'daily goal streak minutes days'], ['standard', 'your standard score', 'standard test best median']] as const).map(([detail, label, keywords]) => ({
        group: 'go to', label, keywords: `progress ${keywords}`, hint: document.body.dataset.view === 'progress' && progressState.detail === detail ? 'here' : '',
        run: () => { navigate('progress'); openProgressDetail(detail); },
      })),
      { group: 'go to', label: 'friends board', keywords: 'leaderboard compare daily week practice minutes friends bests personal best', disabled: Boolean(onlineRace?.liveRoomId), run: () => { onlineRace.openBoard(); $(onlineRace.mode === 'daily' ? 'friends-board-heading' : 'compete-heading').focus(); } },
      { group: 'go to', label: 'learn to type', keywords: 'lessons beginner keys fingers home row', hint: document.body.dataset.view === 'learn' ? 'here' : '', on: document.body.dataset.view === 'learn', run: openLessons },
      { group: 'test', label: 'restart test', keywords: 'reset again new passage', hint: restartHint(), run: restartTest },
      { group: 'test', label: 'daily challenge', keywords: 'today shared passage daily quote', run: startDaily },
      ...(lessonsComplete(learning.profile.lessons) ? [] : [{ group: 'test', label: `next lesson · ${indexed(LESSONS, nextLessonIndex(learning.profile.lessons)).keys.join(' ')}`, keywords: 'learn to type beginner keys fingers', run: () => startLesson(nextLessonIndex(learning.profile.lessons)) }]),
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
      { group: 'test', label: 'punctuation', keywords: 'capitals commas periods', hint: onOff(Boolean(learning.preferences.punctuation)), on: Boolean(learning.preferences.punctuation), disabled: fixedText, run: () => { learning.preferences.punctuation = !learning.preferences.punctuation; applyPreferences(); saveProfile(); resetSession(restartKind(), { focus: true }); } },
      { group: 'test', label: 'numbers', keywords: 'digits figures', hint: onOff(Boolean(learning.preferences.numbers)), on: Boolean(learning.preferences.numbers), disabled: fixedText, run: () => { learning.preferences.numbers = !learning.preferences.numbers; applyPreferences(); saveProfile(); resetSession(restartKind(), { focus: true }); } },
      ...wordListIds.map((id) => ({ group: 'test', label: `word list · top ${id}`, keywords: 'common words vocabulary 200 1000 5000 10000 monkeytype easier harder', hint: learning.preferences.wordList === id ? 'current' : '', on: learning.preferences.wordList === id, disabled: fixedText, run: () => inPractice((kind) => setWordList(id, kind)) })),
      ...layoutIds.map((id) => ({ group: 'test', label: `layout · ${layoutLabel(id)}`, keywords: 'keyboard alternative remap', hint: learning.preferences.layout === id ? 'current' : '', on: learning.preferences.layout === id, run: () => setLayout(id) })),
      ...([['off', 'off'], ['best', 'personal best'], ['average', 'average'], ['last', 'last run'], ['custom', 'custom']] as const).map(([mode, name]) => (
        { group: 'test', label: `pace caret: ${name}`, keywords: 'ghost pacer pace caret', hint: learning.preferences.paceCaret === mode ? 'on' : '', on: learning.preferences.paceCaret === mode, run: () => setPaceCaret(mode) })),
      ...Object.entries(CORRECTION_LABELS).map(([policy, name]) => ({ group: 'test', label: `correction · ${policy === 'relaxed' ? 'free' : name}`, keywords: 'mistakes correction continue stop error backspace fail expert master confidence', hint: learning.preferences.correction === policy ? 'current' : '', on: learning.preferences.correction === policy, disabled: standardLocked(), run: () => setCorrection(policy) })),
      { group: 'test', label: 'repeat quotes', keywords: 'seen again same quote passage score chase replay', hint: onOff(Boolean(learning.preferences.repeatQuotes)), on: learning.preferences.repeatQuotes, disabled: learning.preferences.mode !== 'quote', run: () => setRepeatQuotes(!learning.preferences.repeatQuotes) },
      { group: 'test', label: 'strict space', keywords: 'space bar early skip word mistakes input', hint: onOff(Boolean(learning.preferences.strictSpace)), on: learning.preferences.strictSpace, run: () => setInputRule('strictSpace', !learning.preferences.strictSpace) },
      { group: 'test', label: 'quick end', keywords: 'finish last word end mistakes submit confirm', hint: onOff(Boolean(learning.preferences.quickEnd)), on: learning.preferences.quickEnd, disabled: Boolean(ruleLimits(ruleSession()).quickEnd), run: () => setInputRule('quickEnd', !learning.preferences.quickEnd) },
      ...MIN_ACCURACY_OPTIONS.map((value) => ({ group: 'test', label: `minimum accuracy · ${value ? `${value}%` : 'off'}`, keywords: 'min acc threshold fail stop below continue', hint: learning.preferences.minAccuracy === value ? 'current' : '', on: learning.preferences.minAccuracy === value, run: () => setMinimum('minAccuracy', value) })),
      ...MIN_WPM_OPTIONS.map((value) => ({ group: 'test', label: `minimum speed · ${value ? formatSpeed(value) : 'off'}`, keywords: 'min wpm cpm pace threshold fail stop below continue', hint: learning.preferences.minWpm === value ? 'current' : '', on: learning.preferences.minWpm === value, run: () => setMinimum('minWpm', value) })),
      ...FOCUSES.map((focus) => ({ group: 'train', label: `train focus · ${focus}`, keywords: `training drill target weak pairs ${lookup(FOCUS_KEYWORDS, focus)}`, hint: learning.preferences.trainFocus === focus ? 'current' : '', on: learning.preferences.trainFocus === focus, run: () => setTraining('trainFocus', focus) })),
      ...DRILL_LENGTHS.map((seconds) => ({ group: 'train', label: `drill length · ${seconds} seconds`, keywords: 'training drill time duration session long short', hint: learning.preferences.drillSeconds === seconds ? 'current' : '', on: learning.preferences.drillSeconds === seconds, run: () => setTraining('drillSeconds', seconds) })),
      { group: 'train', label: 'retest after drill', keywords: 'training drill retest fresh text compare comparison', hint: onOff(Boolean(learning.preferences.retest)), on: learning.preferences.retest, run: () => setTraining('retest', !learning.preferences.retest) },
      ...['system', 'dark', 'light'].map((mode) => ({ group: 'display', label: `theme · ${mode}`, keywords: 'colour color mode appearance', hint: themeMode() === mode ? 'current' : '', on: themeMode() === mode, run: () => setThemeMode(mode) })),
      ...([['dark', DARK_THEMES], ['light', LIGHT_THEMES]] as const).flatMap(([mode, themes]) => [
        ...themes.map((theme) => [theme, theme] as const),
        ...readCustomThemes(learning.preferences.customThemes).filter((custom) => colorsMode(custom.colors) === mode).map((custom) => [custom.id, custom.name] as const),
      ].map(([theme, name]) => ({ group: 'display', label: `${mode} theme · ${name}`, keywords: 'colour color appearance', hint: themeFor(mode) === theme ? 'current' : '', on: themeFor(mode) === theme, run: () => pickTheme(mode, theme) }))),
      ...([['22', 'small'], ['28', 'medium'], ['36', 'large']] as const).map(([size, name]) => ({ group: 'display', label: `text size · ${name}`, keywords: 'font passage bigger smaller', hint: learning.preferences.fontSize === size ? 'current' : '', on: learning.preferences.fontSize === size, run: () => { learning.preferences.fontSize = size; applyPreferences(); saveChoice('fontSize'); } })),
      ...TYPING_FONTS.map((font) => ({ group: 'display', label: `typing font · ${fontName(font)}`, keywords: 'typeface passage monospace serif sans', hint: learning.preferences.typingFont === font ? 'current' : '', on: learning.preferences.typingFont === font, run: () => { learning.preferences.typingFont = font; applyFonts(); saveChoice('typingFont'); } })),
      ...APP_FONTS.map((font) => ({ group: 'display', label: `app font · ${fontName(font)}`, keywords: 'typeface interface serif sans', hint: learning.preferences.appFont === font ? 'current' : '', on: learning.preferences.appFont === font, run: () => { learning.preferences.appFont = font; applyFonts(); saveChoice('appFont'); } })),
    
      ...([['off', 'off'], ['current', 'this word'], ['next', 'next word']] as const).map(([mode, name]) => ({ group: 'display', label: `word highlight · ${name}`, keywords: 'tint emphasis reading ahead', hint: learning.preferences.wordHighlight === mode ? 'current' : '', on: learning.preferences.wordHighlight === mode, run: () => setWordHighlight(mode) })),
      { group: 'display', label: 'word highlight · slide', keywords: 'glide smooth motion animate', hint: onOff(Boolean(learning.preferences.wordHighlightSlide)), on: learning.preferences.wordHighlightSlide, disabled: learning.preferences.wordHighlight === 'off', run: () => setWordHighlightSlide(!learning.preferences.wordHighlightSlide) },
      { group: 'display', label: 'one-line tape', keywords: 'tape mode single line passage layout scroll', hint: onOff(Boolean(learning.preferences.tape)), on: learning.preferences.tape, run: () => togglePreference('tape') },
      ...([['wpm', 'words'], ['cpm', 'characters']] as const).map(([unit, per]) => ({ group: 'display', label: `speed unit · ${unit}`, keywords: `${per} per minute speed measure`, hint: learning.preferences.speedUnit === unit ? 'current' : '', on: learning.preferences.speedUnit === unit, run: () => setSpeedUnit(unit) })),
      { group: 'display', label: 'live metrics', keywords: 'wpm accuracy while typing', hint: onOff(Boolean(learning.preferences.liveMetrics)), on: Boolean(learning.preferences.liveMetrics), run: () => togglePreference('liveMetrics') },
      { group: 'display', label: 'keyboard', keywords: 'keys layout', hint: onOff(Boolean(learning.preferences.keyboard)), on: Boolean(learning.preferences.keyboard), run: () => togglePreference('keyboard') },
      { group: 'display', label: 'finger map', keywords: 'keyboard fingers touch typing hands which finger', hint: onOff(Boolean(learning.preferences.keyboard && learning.preferences.fingerMap)), on: Boolean(learning.preferences.keyboard && learning.preferences.fingerMap), run: toggleFingerMap },
      { group: 'display', label: 'focus mode', keywords: 'zen hide distraction', hint: onOff(Boolean(learning.preferences.focusMode)), on: Boolean(learning.preferences.focusMode), run: () => { navigate('practice', { keep: true }); togglePreference('focusMode'); } },
      { group: 'display', label: 'import Monkeytype settings…', keywords: 'monkeytype import settings config json migrate', run: openImport },
      ...SOUND_MODES.map((mode) => ({ group: 'sound', label: `sound · ${lookup(SOUND_LABELS, mode)}`, keywords: 'audio typing key clicks error tick mute volume', hint: learning.preferences.sound === mode ? 'current' : '', on: learning.preferences.sound === mode, run: () => setSound(mode) })),
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

  let ghostToastTimer = 0;

  function toggleGhost() {
    const on = !ghostOn();
    const pace = ghostPace('best');
    practice.presentIntro({ egg: copyParts(on ? ['Ghost pacer · ', speedFigure(pace.wpm), pace.fromBest ? ' (your best)' : ''] : 'Ghost off') });
    $('egg-toast').hidden = false;
    $('egg-toast').classList.toggle('is-solo', Boolean($('history-toast').hidden));
    clearTimeout(ghostToastTimer);
    ghostToastTimer = setTimeout(() => { $('egg-toast').hidden = true; }, 3000);
    announce($('egg-feedback').textContent || '');
    setPaceCaret(on ? 'best' : 'off');
  }

  const stopSequence = listenForSequence(() => {
    toggleGhost();

    if (practice.attempt?.status === 'running' && document.body.dataset.view === 'practice') resetSession(practice.sessionKind, { focus: true, selectedPassage: passage });
  });

  let resizeFrame = 0;

  function relayoutText() {
  
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

  let graphFrame = 0;

  lifetime.observeResize(() => {
    cancelAnimationFrame(graphFrame);
    graphFrame = requestAnimationFrame(() => {
      const graph = $('speed-graph');
      const width = Math.round(graph.clientWidth);

      if (!practice.shownResult || !width || Math.abs(Number(graph.querySelector('svg')?.getAttribute('width')) - width) <= 1) return;
      renderSpeedGraph(graph, practice.shownResult, { animate: false });
    });
  }, $('speed-graph'));

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

  const isMac = /Mac|iPhone|iPad/.test(('userAgentData' in navigator && isRecord(navigator.userAgentData) && typeof navigator.userAgentData.platform === 'string' ? navigator.userAgentData.platform : '') || navigator.platform || '');

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
    read: () => ({ quoteLength: learning.preferences.quoteLength, difficulty: learning.preferences.difficulty, book: learning.preferences.book }),
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
      challenge: { label: 'Race', run: (entry) => { if (typeof entry.challengeId !== 'string') throw new TypeError('A ghost action requires its source id');

        return startGhostRace(entry.challengeId); } },
      invite: { label: 'Join', run: (entry) => { if (typeof entry.roomId !== 'string') throw new TypeError('An invite action requires its source id');

        return onlineRace.joinInvite(entry.roomId); } },
      joined: { label: 'Open', available: (entry) => onlineRace?.liveRoomId === entry.roomId, run: () => onlineRace.open() },
      result: { label: 'Race again', run: (entry) => { if (typeof entry.roomId !== 'string') throw new TypeError('A rematch action requires its source id');

        return onlineRace.rematchRoom(entry.roomId, entry.conditions); } },
    },
  });

  friendsBoard.configure({
    getSession: () => accounts.session,
    dailyKey,
  
    runs: () => learning.profile.runs,
    signIn: () => openAccountDialog('signin'),
  
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

    practice: () => ({ mode: learning.preferences.mode, duration: learning.preferences.duration, count: learning.preferences.count, punctuation: Boolean(learning.preferences.punctuation),
      numbers: learning.preferences.numbers, wordList: learning.preferences.wordList, quoteLength: learning.preferences.quoteLength, difficulty: learning.preferences.difficulty, adaptive: learning.preferences.adaptive,
      session: composeOpen ? 'compose' : editors.customOpen || practice.sessionKind === 'custom' ? 'custom' : practice.sessionKind === 'drill' ? 'drill' : 'practice' }),
  
    onModeChange: syncRules,
    onPassageSeen(id) {
      if (!id || learning.profile.seenTextIds.includes(id)) return;
      learning.profile.seenTextIds.push(id);
      saveProfile();
    },
  });

  updateGlides({ instant: true });

  document.fonts?.ready.then(() => { if (!lifetime.signal.aborted) { measureTypingBaseline(); primaryFx.relayout(); updateGlides({ instant: true }); } });

  console.info('stilltype · ↑ ↑ ↓ ↓ ← → ← → b a');

  if (!sync.state.storageAvailable) announce('Storage is unavailable. Results last only in this tab.');

  noticeDeletedAccount();

  completeAuthRedirect();

  syncOnLoad();

  inbox.refresh();

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

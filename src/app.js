import {
  CORPUS_VERSION,
  CUSTOM_MAX,
  CUSTOM_MIN_CHARS,
  CUSTOM_MIN_WORDS,
  METRIC_VERSION,
  compareAttempts,
  completeAttempt,
  conditionKey,
  createAttempt,
  customTextProblem,
  makeDrill,
  normalizeCustomText,
  normalizeManualTarget,
  orderCustomText,
  passageComplete,
  recommendTarget,
  replayAttempt,
  selectPassage,
  summarizePatterns,
  rawWpm,
  consistency,
  characterBreakdown,
  wordHistory,
} from './typing.js';
import { DEFAULT_WORD_LIST, wordListIds } from './words.js';
import { createTypingFx } from './motion.js';
import { renderSpeedGraph } from './graph.js';
import { createPalette } from './palette.js';
import { listenForSequence } from './egg.js';
import * as account from './account.js';
import { createOnlineRace } from './online-race.js';
import { createInbox } from './inbox.js';
import { listRaceInvites } from './multiplayer.js';
import { comparableKind, dailyPassage, filterRuns, recurringTargets, retainRuns, runRecord, trendRun, validRun, weeklyChange } from './insights.js';
import { renderTrend } from './progress-view.js';

const MAX_STORED_ATTEMPTS = 24;
const $ = (id) => document.getElementById(id);
const now = () => performance.now();
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const defaultPreferences = {
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
  tape: false,
  theme: 'system',
  customText: '',
  customOrder: 'as-written',
  paceCaret: 'off',
  paceWpm: 80,
};

const CUSTOM_ORDERS = ['as-written', 'shuffled', 'random'];
let customOpen = false;

function customPassage() {
  const text = normalizeCustomText(prefs.customText);
  if (!text) return null;
  return { id: null, text: orderCustomText(text, prefs.customOrder), fresh: false };
}

const customOrderLabel = (order) => ({ shuffled: 'shuffled words', random: 'random words' }[order] || 'as written');

const PACE_MODES = ['off', 'best', 'average', 'last', 'custom'];
const clampPace = (value) => Math.min(300, Math.max(10, Math.round(Number(value) || 80)));

function emptyProfile() {
  return {
    version: 2,
    profileId: uid(),
    preferences: { ...defaultPreferences },
    attempts: [],
    runs: [],
    loops: [],
    seenTextIds: [],
    bests: {},
  };
}

let storageAvailable = true;
// No session means guest mode: default settings, and nothing leaves this tab.
let session = account.loadSession();
let syncTimer = 0;
// Saves only count as edits once the account row has been compared with the device cache;
// otherwise a boot-time save (marking the first passage seen) would make a stale cache look newer.
let cloudChecked = false;
let unsynced = false;

function validPreferences(value) {
  if (!wordListIds.includes(value.wordList)) value.wordList = DEFAULT_WORD_LIST;
  // Profiles saved before tape mode have no value; anything but true is the three-line passage.
  value.tape = value.tape === true;
  const customText = typeof value.customText === 'string' ? normalizeCustomText(value.customText) : '';
  value.customText = customTextProblem(customText) ? '' : customText;
  if (!CUSTOM_ORDERS.includes(value.customOrder)) value.customOrder = 'as-written';
  if (!PACE_MODES.includes(value.paceCaret)) value.paceCaret = 'off';
  value.paceWpm = clampPace(value.paceWpm);
  return value;
}

function normalizeProfile(parsed) {
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
    preferences: validPreferences({ ...defaultPreferences, ...parsed.preferences }),
    attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
    runs: retainRuns(records),
    loops: Array.isArray(parsed.loops) ? parsed.loops : [],
    seenTextIds: Array.isArray(parsed.seenTextIds) ? parsed.seenTextIds : [],
    bests: parsed.bests && typeof parsed.bests === 'object' ? parsed.bests : {},
  };
}

function loadProfile() {
  if (!session) return emptyProfile();
  return normalizeProfile(account.loadCachedProfile(session.user.id));
}

let profile = loadProfile();
let prefs = profile.preferences;
let sessionKind = 'practice';
let passage = null;
let attempt = null;
let startTime = null;
let ticker = null;
let primaryCharacters = [];
let primaryTextView = null;
let primaryNotice = '';
let liveSecond = -1;
const primaryFx = createTypingFx($('typing-wrap'), $('text-display'), { ensureCharacters: (index) => primaryTextView?.ensureForward(index), tape: () => prefs.tape });
const raceFx = createTypingFx(document.querySelector('.race-typing-wrap'), $('race-text-display'), { ensureCharacters: (index) => race.textView?.ensureForward(index) });
const prefersLight = matchMedia('(prefers-color-scheme: light)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let lastCompleted = null;
const ghostOn = () => prefs.paceCaret !== 'off';
let palette = null;
let onlineRace = null;
let inbox = null;
let baselineAttempt = null;
let activeRecommendation = null;
let selectedTarget = null;
let trainingContext = null;
let resultBestBefore = null;
let clearSnapshot = null;
let clearTimer = null;

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
};

// Signed in, the profile is cached on this device and synced to the account shortly after.
// A guest's profile lives only in memory, so there is nothing to fail.
function saveProfile() {
  profile.preferences = { ...prefs };
  profile.attempts = profile.attempts.slice(-MAX_STORED_ATTEMPTS);
  profile.runs = retainRuns(profile.runs);
  if (!session) return true;
  unsynced = true;
  if (cloudChecked) {
    profile.updatedAt = new Date().toISOString();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushProfile, 1500);
  }
  storageAvailable = account.cacheProfile(session.user.id, profile);
  return storageAvailable;
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

function announce(message) {
  $('announcement').textContent = '';
  requestAnimationFrame(() => { $('announcement').textContent = message; });
}

function conditions(inputClass = 'physical-keyboard') {
  return {
    mode: prefs.mode,
    duration: prefs.mode === 'time' ? prefs.duration : null,
    count: prefs.mode === 'words' ? prefs.count : null,
    punctuation: prefs.punctuation,
    numbers: prefs.mode === 'quote' ? false : Boolean(prefs.numbers),
    quoteLength: prefs.mode === 'quote' ? prefs.quoteLength : null,
    difficulty: prefs.mode === 'quote' ? prefs.difficulty : null,
    wordList: prefs.mode === 'quote' ? null : prefs.wordList,
    inputClass,
    correctionPolicy: prefs.stopOnError ? 'mandatory' : 'relaxed',
    language: 'en',
    corpus: CORPUS_VERSION,
    metricVersion: METRIC_VERSION,
  };
}

// Custom text has its own condition key, so it can never share a best, trend or retest with a test.
function customConditions() {
  return { ...conditions(), mode: 'custom', duration: null, count: null, punctuation: false, numbers: false,
    quoteLength: null, difficulty: null, wordList: null, customOrder: prefs.customOrder };
}

function describeConditions(value = conditions()) {
  const length = value.mode === 'time' ? `${value.duration} s` : value.mode === 'words' ? `${value.count} words` : `${value.quoteLength || 'any'} quote`;
  const punctuation = value.mode === 'quote' ? value.difficulty || 'any difficulty' : `${value.punctuation ? 'punctuation' : 'plain'}${value.numbers ? ' · numbers' : ''}`;
  const input = value.inputClass === 'touch' ? 'touch input' : 'physical keyboard';
  const correction = value.correctionPolicy === 'relaxed' ? 'continue on error' : 'stop on error';
  const language = value.wordList ? `english ${value.wordList}` : 'english';
  return `${language} · ${length} · ${punctuation} · ${input} · ${correction} · corpus ${(value.corpus || CORPUS_VERSION).replace(/^.*-(v\d+)$/, '$1')} · metric v1`;
}

// A drill is always one minute of generated text, whatever the baseline was.
function describeRun(run) {
  if (run.kind === 'daily') return `daily · ${run.challengeDate} · ${run.firstDailyAttempt ? 'first attempt' : 'repeat attempt'}${run.firstDailyAttempt && !run.fresh ? ' · previously displayed passage' : ''} · ${describeConditions(run.conditions)}`;
  if (run.kind === 'custom') return `custom text · ${customOrderLabel(run.conditions.customOrder)} · ${run.conditions.inputClass === 'touch' ? 'touch input' : 'physical keyboard'} · ${run.conditions.correctionPolicy === 'relaxed' ? 'continue on error' : 'stop on error'} · not counted`;
  if (run.kind !== 'drill') return describeConditions(run.conditions);
  return `drill · 60 s · english · ${run.conditions.inputClass === 'touch' ? 'touch input' : 'physical keyboard'} · ${run.conditions.correctionPolicy === 'relaxed' ? 'continue on error' : 'stop on error'}`;
}

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
    inbox?.runChanged();
  }
  showChrome(!running);
}
// Skip no-op writes on every keystroke.
function showChrome(shown) {
  const value = String(!shown);
  if (document.body.dataset.running !== value) document.body.dataset.running = value;
}

// The footer best belongs to the session on screen. A custom session (any non-comparable kind) has no best,
// so it says it isn't counted rather than showing the best for the time or word settings underneath it.
function currentBestKey() {
  return comparableKind(sessionKind) ? conditionKey(conditions()) : null;
}

function showBest() {
  const key = currentBestKey();
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
  if (document.body.dataset.tape !== String(prefs.tape) || document.body.dataset.fontSize !== String(prefs.fontSize)) {
    // Trimmed words leave a spacer shaped for one layout and text size; put them back first.
    primaryTextView?.restore();
  }
  document.body.dataset.fontSize = prefs.fontSize;
  document.body.dataset.tape = String(prefs.tape);
  primaryFx.relayout();
  document.body.dataset.liveMetrics = String(prefs.liveMetrics);
  document.body.dataset.keyboard = String(prefs.keyboard);
  document.body.dataset.focusMode = String(prefs.focusMode);
  $('font-size').value = prefs.fontSize;
  $('live-toggle').checked = prefs.liveMetrics;
  $('keyboard-toggle').checked = prefs.keyboard;
  $('stop-on-error-toggle').checked = prefs.stopOnError;
  $('focus-toggle').checked = prefs.focusMode;
  $('tape-toggle').checked = prefs.tape;
  $('keyboard').hidden = !prefs.keyboard;
  applyTheme();
  $('punctuation-toggle').checked = prefs.punctuation;
  $('numbers-toggle').checked = Boolean(prefs.numbers);
  $('quote-length').value = prefs.quoteLength;
  $('quote-difficulty').value = prefs.difficulty;
  $('word-list').value = prefs.wordList;
  armPace();
  showBest();
}

function setModeControls() {
  const custom = customOpen || sessionKind === 'custom';
  $('mode-custom').classList.toggle('is-active', custom);
  $('mode-custom').setAttribute('aria-pressed', String(custom));
  $('mode-custom').setAttribute('aria-expanded', String(customOpen));
  $('custom-options').hidden = !customOpen;
  document.querySelectorAll('[data-mode]').forEach((button) => {
    const selected = !custom && button.dataset.mode === prefs.mode;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('quote-options').hidden = custom || prefs.mode !== 'quote';
  $('punctuation-toggle').disabled = prefs.mode === 'quote';
  $('numbers-toggle').disabled = prefs.mode === 'quote';
  $('word-list').disabled = prefs.mode === 'quote';
  $('duration-options').hidden = custom || prefs.mode === 'quote';
  document.querySelector('.compact-switch').hidden = custom;
  const values = prefs.mode === 'time' ? [15, 30, 60, 120] : [10, 25, 50, 100];
  const lengthPill = $('duration-options').querySelector(':scope > .glide-pill');
  $('duration-options').replaceChildren(...(lengthPill ? [lengthPill] : []), ...values.map((value) => {
    const button = document.createElement('button');
    const selected = value === (prefs.mode === 'time' ? prefs.duration : prefs.count);
    button.type = 'button';
    button.textContent = value;
    button.dataset.length = String(value);
    button.className = selected ? 'is-active' : '';
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', `${value} ${prefs.mode === 'time' ? 'seconds' : 'words'}`);
    return button;
  }));
  showBest();
  requestAnimationFrame(() => updateGlides());
}

// tape: whether the passage is on one line (tape mode), which changes how passed text is trimmed.
function renderText(display, text, { tape = () => false } = {}) {
  const words = text.split(' ');
  const characters = [];
  const characterWords = [];
  const groups = [];
  let renderedWords = 0;
  let firstRenderedWord = 0;
  let lastTrimPosition = 0;
  let lastPosition = 0;

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

  // Puts trimmed words back in place of their spacer.
  function remountTrimmed() {
    if (!firstRenderedWord) return;
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < firstRenderedWord; index += 1) fragment.append(...groups[index]);
    display.querySelector('.passage-spacer')?.remove();
    display.insertBefore(fragment, display.querySelector('.word'));
    firstRenderedWord = 0;
  }

  // Tape mode: words more than two line-widths behind the caret give way to a spacer of the
  // same width, so nothing in view moves.
  function trimTape(current) {
    const keepLeft = (current.closest('.word') || current).offsetLeft - display.clientWidth * 2;
    if (keepLeft <= 0) return;
    const firstKept = [...display.querySelectorAll('.word')].find((word) => word.offsetLeft >= keepLeft);
    if (!firstKept || firstKept === display.querySelector('.word')) return;
    const spacer = document.createElement('span');
    spacer.className = 'passage-spacer';
    // The word's exact x, not the rounded offsetLeft; the shared transform cancels out.
    spacer.style.width = `${firstKept.getBoundingClientRect().left - display.getBoundingClientRect().left}px`;
    for (const child of [...display.childNodes]) {
      if (child === firstKept) break;
      if (child.classList?.contains('caret') || child.classList?.contains('ghost-caret')) continue;
      child.remove();
    }
    display.insertBefore(spacer, firstKept);
    firstRenderedWord = Number(firstKept.dataset.wordIndex);
  }

  // Tape mode, backspacing: a step back can show up to a line-width behind the caret, so the
  // trimmed words come back before the spacer could show as a blank stretch.
  function nearTapeSpacer(position) {
    const spacer = display.querySelector('.passage-spacer');
    const at = characters[Math.min(position, characters.length - 1)];
    return Boolean(spacer && at?.isConnected) && at.offsetLeft - spacer.offsetWidth < display.clientWidth;
  }

  display.replaceChildren();
  appendWords(100);
  characters[0]?.classList.add('current');
  return {
    characters,
    ensureAhead(position) {
      const currentWord = characterWords[Math.min(position, characters.length - 1)] || 0;
      const back = position < lastPosition;
      lastPosition = position;
      // A separator before the first mounted word maps to that word, but is
      // itself detached. Remount it when backspacing reaches the boundary.
      if (currentWord < firstRenderedWord || (currentWord === firstRenderedWord && !characters[position]?.isConnected)
        || (back && firstRenderedWord && tape() && nearTapeSpacer(position))) {
        remountTrimmed();
        lastTrimPosition = position;
      }
      ensureForward(position);
    },
    ensureForward,
    // Before switching between three lines and the tape: the spacer only fits the old layout.
    restore() {
      remountTrimmed();
      lastTrimPosition = 0;
    },
    trimBehind(position) {
      if (position - lastTrimPosition < 160) return;
      lastTrimPosition = position;
      const current = characters[position];
      if (!current?.isConnected) return;
      if (tape()) {
        trimTape(current);
        return;
      }
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

function choosePassage(extraSeen = []) {
  return selectPassage({
    mode: prefs.mode,
    count: prefs.count,
    punctuation: prefs.punctuation,
    numbers: Boolean(prefs.numbers),
    quoteLength: prefs.quoteLength,
    difficulty: prefs.difficulty,
    wordList: prefs.wordList,
    seenIds: [...profile.seenTextIds, ...extraSeen],
  });
}

// Restarting or changing a setting keeps a custom passage; every other session restarts as practice.
const restartKind = () => (sessionKind === 'custom' && prefs.customText ? 'custom' : 'practice');

function sessionDurationMs() {
  if (sessionKind === 'daily') return null;
  if (sessionKind === 'drill') return 60000;
  if (sessionKind === 'custom') return null;
  if (prefs.mode === 'time') return prefs.duration * 1000;
  return null;
}

function configureSessionCopy() {
  const copy = {
    practice: ['practice', 'Practice', ''],
    drill: ['drill · 1 min', selectedTarget ? `Practice “${selectedTarget}”` : 'General drill', 'Doesn’t count toward your best.'],
    custom: ['custom text', 'Your text', 'Doesn’t count toward your best.'],
    retest: ['fresh-text retest', 'Measure the change', passage?.fresh === false ? 'You’ve seen every matching quote, so this can’t be a fresh comparison.' : 'Fresh text, same conditions.'],
    daily: ['daily challenge', 'Today’s passage', `${passage?.day} · resets at midnight UTC · ${passage?.firstDailyAttempt ? 'first attempt' : 'repeat attempt'}${passage?.firstDailyAttempt && !passage?.fresh ? ' · previously displayed passage' : ''}`],
  }[sessionKind];
  $('session-kicker').textContent = copy[0];
  $('session-title').textContent = copy[1];
  $('session-description').textContent = copy[2];
  $('typing-screen').dataset.session = sessionKind;
  document.body.dataset.session = sessionKind;
  const setup = document.querySelector('.practice-controls');
  if (setup) setup.hidden = sessionKind !== 'practice' && sessionKind !== 'custom';
  $('quote-options').hidden = sessionKind !== 'practice' || prefs.mode !== 'quote';
}

function resetSession(kind = sessionKind, { focus = false, selectedPassage = null } = {}) {
  clearInterval(ticker);
  ticker = null;
  setRunning(false);
  primaryNotice = '';
  const kindChanged = sessionKind !== kind;
  sessionKind = kind;
  // The mode bar marks Custom while a custom session is loaded, so it is redrawn whenever the kind changes.
  // Changing to any session but custom also closes the custom editor, or Custom would stay marked over it.
  if (kindChanged && kind !== 'custom') customOpen = false;
  if (kindChanged) setModeControls();
  passage = selectedPassage || (kind === 'daily' ? todayPassage() : kind === 'drill' ? makeDrill(selectedTarget, prefs.wordList) : kind === 'custom' ? customPassage() : choosePassage(kind === 'retest' && baselineAttempt ? [baselineAttempt.textId] : []));
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
  if (kind !== 'drill' && passage.id && !profile.seenTextIds.includes(passage.id)) {
    profile.seenTextIds.push(passage.id);
    saveProfile();
  }
  if (kind === 'daily' && !profile.seenTextIds.includes(passage.challengeId)) {
    profile.seenTextIds.push(passage.challengeId);
    saveProfile();
  }
  attempt = createAttempt({
    id: uid(),
    text: passage.text,
    textId: passage.id,
    kind: kind === 'practice' ? 'test' : kind,
    conditions: kind === 'daily' ? dailyConditions() : kind === 'custom' ? customConditions() : conditions(),
  });
  if (kind === 'daily') {
    attempt.challengeDate = passage.day;
    attempt.firstDailyAttempt = passage.firstDailyAttempt;
  }
  if (kind === 'drill') attempt.target = selectedTarget;
  attempt.fresh = passage.fresh !== false;
  startTime = null;
  $('typing-input').value = '';
  $('typing-input').disabled = false;
  $('accessible-passage').textContent = passage.text;
  primaryTextView = renderText($('text-display'), passage.text, { tape: () => prefs.tape });
  primaryCharacters = primaryTextView.characters;
  primaryFx.reset(primaryCharacters);
  armPace();
  markKeyboardTargets(kind === 'drill' ? selectedTarget : null);
  $('typing-status').className = 'badge badge-info';
  $('typing-status').innerHTML = '<span class="status-dot" aria-hidden="true"></span>Ready';
  $('input-help').textContent = '';
  $('condition-line').textContent = describeRun(attempt);
  configureSessionCopy();
  updateLive(true);
  switchView('practice');
  if (focus) $('typing-input').focus({ preventScroll: true });
  return true;
}

function showUnavailableRetest(reason) {
  switchView('results');
  $('comparison-panel').hidden = false;
  $('comparison-panel').dataset.outcome = 'unavailable';
  $('comparison-status').textContent = 'No fair retest available.';
  $('comparison-accuracy').textContent = '—';
  $('comparison-timing').textContent = '—';
  $('comparison-wpm').textContent = '—';
  $('comparison-sample').textContent = 'no matching fresh text';
  $('comparison-caveat').textContent = reason;
  announce(reason);
}

function startAttempt(targetAttempt, type = 'primary') {
  const stamp = now();
  if (type === 'primary') {
    if (startTime !== null) return;
    startTime = stamp;
    attempt.status = 'running';
    attempt.startedAt = 0;
    ticker = setInterval(updateLive, 100);
    primaryFx.ghost.run(stamp);
    setRunning(true);
    $('typing-status').innerHTML = '<span class="status-dot" aria-hidden="true"></span>In progress';
  } else {
    if (race.startTime !== null) return;
    race.startTime = stamp;
    race.attempt.status = 'running';
    race.attempt.startedAt = 0;
    inbox?.runChanged();
  }
}

function offsetFor(type = 'primary') {
  const origin = type === 'primary' ? startTime : race.startTime;
  return origin === null ? 0 : Math.max(0, now() - origin);
}

function currentReplay(type = 'primary') {
  return replayAttempt(type === 'primary' ? attempt : race.attempt);
}

function pushInsert(char, type = 'primary') {
  const targetAttempt = type === 'primary' ? attempt : race.attempt;
  startAttempt(targetAttempt, type);
  const replay = replayAttempt(targetAttempt);
  const unresolved = targetAttempt.conditions.correctionPolicy !== 'relaxed'
    && replay.typed.length > 0
    && replay.typed.at(-1) !== targetAttempt.text[replay.typed.length - 1];
  targetAttempt.events.push(unresolved
    ? { type: 'blocked-insert', text: char, position: replay.typed.length - 1, offsetMs: offsetFor(type) }
    : { type: 'insert', text: char, position: replay.typed.length, accepted: true, offsetMs: offsetFor(type) });
  return { previousLength: replay.typed.length, blocked: unresolved };
}

function pushDelete(type = 'primary') {
  const targetAttempt = type === 'primary' ? attempt : race.attempt;
  const replay = replayAttempt(targetAttempt);
  if (!replay.typed.length) return replay.typed.length;
  targetAttempt.events.push({ type: 'delete', count: 1, offsetMs: offsetFor(type) });
  return replay.typed.length;
}

function beforeTypingInput(event, type = 'primary') {
  const targetAttempt = type === 'primary' ? attempt : race.attempt;
  if (!targetAttempt || ['complete', 'interrupted'].includes(targetAttempt.status)) {
    event.preventDefault();
    return;
  }
  if (type === 'primary' && startTime !== null && sessionDurationMs() && now() - startTime >= sessionDurationMs()) {
    event.preventDefault();
    finishPrimary(sessionDurationMs());
    return;
  }
  if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') {
    event.preventDefault();
    refusePaste(type);
    return;
  }
  if (event.inputType?.includes('Composition') || event.isComposing) {
    event.preventDefault();
    targetAttempt.unsupportedInput = true;
    targetAttempt.interrupted = true;
    targetAttempt.events.push({ type: 'composition', offsetMs: offsetFor(type) });
    showInputNotice(type, NOTICES.composition, { sticky: true });
    return;
  }
  if (event.inputType?.startsWith('delete')) {
    event.preventDefault();
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
  if ([...event.data].length !== 1) {
    targetAttempt.unsupportedInput = true;
    targetAttempt.interrupted = true;
    showInputNotice(type, NOTICES.multiCharacter, { sticky: true });
    return;
  }
  const change = pushInsert(event.data, type);
  refreshAfterInput(type, change.previousLength, change.blocked);
}

// Everything the typing surface says, kept short. The focus-lost and composition
// notices stay until restart because the run no longer counts.
const NOTICES = {
  blocked: 'Fix the underlined letter.',
  paste: 'Paste is off. Type the passage.',
  composition: 'IME input isn’t scored. Esc to restart.',
  multiCharacter: 'One key at a time. Esc to restart.',
  repeat: 'Key repeat ignored.',
  focusLost: 'Focus lost. This run won’t count. Esc to restart.',
  leftSurface: 'You left mid-run, so it won’t count.',
  paletteOpened: 'Commands opened mid-run, so it won’t count.',
  suggestOpened: 'Suggestions opened mid-run, so it won’t count.',
  raceFocusLost: 'Focus lost. Esc to restart this turn.',
};

function showInputNotice(type, message, { sticky = false, speak = true } = {}) {
  if (type === 'primary') {
    $('input-help').textContent = message;
    if (sticky) primaryNotice = message;
  } else $('race-help').textContent = message;
  if (speak) announce(message);
}

function refusePaste(type) {
  showInputNotice(type, NOTICES.paste);
}

function refreshAfterInput(type, previousLength, blocked = false) {
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
  (isPrimary ? primaryFx : raceFx).update(length, outcome, length > 0 && !lastCorrect);
  textView.trimBehind(length);
  if (isPrimary) {
    setRunning(true);
    $('input-help').textContent = blocked ? NOTICES.blocked : primaryNotice;
    updateLive();
    if (sessionDurationMs() === null && passageComplete(targetAttempt, replay.typed)) finishPrimary();
  } else {
    updateRaceProgress(replay);
    if (passageComplete(targetAttempt, replay.typed)) finishRacePlayer();
  }
}

// The pace caret is presentational and never scored. It runs at the personal best, the average of
// the last 10 comparable runs, the last comparable run, or a custom pace; with no runs, a gentle 60 wpm.
function ghostPace(mode = prefs.paceCaret) {
  // The active attempt knows its real input class (touch is detected after reset).
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
  $('pace-label').hidden = !on;
  $('pace-label').textContent = on ? `pace ${pace.wpm} wpm` : '';
  $('pace-select').value = prefs.paceCaret;
  $('pace-wpm').value = prefs.paceWpm;
  $('pace-custom').hidden = prefs.paceCaret !== 'custom';
  $('pace-note').textContent = on && prefs.paceCaret !== 'custom' ? (pace.fallback ? 'no runs yet — 60 wpm' : `${pace.wpm} wpm`) : '';
  document.body.dataset.ghost = on ? 'on' : 'off';
}

// Arms the caret on the current attempt in place: a ready run keeps its passage, and a run in
// progress joins the caret to its own clock. Called whenever the mode or the history behind it changes.
function armPace() {
  const running = attempt?.status === 'running' && startTime !== null;
  const live = running || attempt?.status === 'ready';
  primaryFx.ghost.arm(ghostOn() && live ? ghostPace().cps : 0, running ? startTime : 0);
  showPace();
}

function setPaceCaret(mode) {
  prefs.paceCaret = mode;
  saveProfile();
  armPace();
}

function markKeyboardTargets(target) {
  const letters = new Set((target || '').toLowerCase());
  document.querySelectorAll('.key').forEach((key) => key.classList.toggle('target', letters.has(key.dataset.key)));
}

// The live readout shows no rate until a second has passed: before that it is noise. Custom text (any
// non-comparable kind) can be short enough to finish inside that second, so its run card follows the same
// floor. Built-in passages take far longer than a second to type, so their card is unchanged.
const RATE_FLOOR_MS = 1000;
const rateShown = (completed) => comparableKind(completed.kind) || completed.summary.elapsedMs >= RATE_FLOOR_MS;

function updateLive(reset = false) {
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
    const score = second >= 0 && boundedElapsed >= RATE_FLOOR_MS ? replayAttempt({ ...attempt, endedAt: boundedElapsed }).score : null;
    setText($('live-wpm'), score ? score.wpm : '—');
    setText($('live-accuracy'), score ? score.accuracy : '—');
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
  if (duration && startTime !== null && elapsed >= duration && attempt.status === 'running') finishPrimary(duration);
}

function storeAttempt(completed) {
  completed.at = new Date().toISOString();
  const key = conditionKey(completed.conditions);
  const score = completed.summary.score;
  const eligibleBest = completed.status === 'complete' && !completed.interrupted && ['test', 'retest'].includes(completed.kind);
  resultBestBefore = profile.bests[key] || null;
  // Traces serve baselines and patterns. A custom passage is neither and can run to thousands of characters,
  // so only its summary record is kept.
  if (comparableKind(completed.kind)) profile.attempts.push(completed);
  profile.runs.push(runRecord(completed));
  if (eligibleBest && (!profile.bests[key] || score.wpm > profile.bests[key].wpm)) {
    profile.bests[key] = { wpm: score.wpm, attemptId: completed.id, at: new Date().toISOString() };
  }
  if (eligibleBest && completed.textId && !profile.seenTextIds.includes(completed.textId)) profile.seenTextIds.push(completed.textId);
  const saved = saveProfile();
  showBest();
  return saved;
}

function finishPrimary(forcedElapsed = null) {
  if (!attempt || attempt.status !== 'running') return;
  clearInterval(ticker);
  ticker = null;
  const endedAt = forcedElapsed ?? offsetFor();
  const valid = !attempt.interrupted && !attempt.unsupportedInput;
  const completed = completeAttempt(attempt, { endedAt, status: valid ? 'complete' : 'interrupted' });
  completed.interrupted = attempt.interrupted;
  completed.unsupportedInput = attempt.unsupportedInput;
  completed.fresh = attempt.fresh;
  attempt = completed;
  $('typing-input').disabled = true;
  primaryFx.finish();
  setRunning(false);
  $('typing-status').className = `badge ${valid ? 'badge-success' : 'badge-warning'}`;
  $('typing-status').textContent = valid ? 'Complete' : 'Interrupted';
  const saved = storeAttempt(completed);

  if (sessionKind === 'drill' && baselineAttempt) {
    if (trainingContext) trainingContext.drillCompleted = valid;
    announce(valid ? 'Drill complete. Retest ready.' : 'Drill interrupted. Retest ready.');
    startRetest();
    return;
  }

  if ((sessionKind === 'practice' || sessionKind === 'daily') && valid) {
    baselineAttempt = completed;
    trainingContext = null;
  }
  renderResults(completed, saved);
  if (sessionKind === 'retest') renderComparison(baselineAttempt, completed, saved);
  switchView('results');
  renderCard(completed);
  $('run-again').focus({ preventScroll: true });
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Draw after the results view is shown so the graph has its size.
function renderCard(completed) {
  lastCompleted = completed;
  const kind = completed.kind === 'test' ? 'practice' : completed.kind;
  const at = new Date();
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  $('run-card-stamp').textContent = `${MONTHS[at.getMonth()]} ${at.getDate()} · ${time} · ${kind}`;
  $('run-card').hidden = false;
  const graph = $('speed-graph').closest('figure');
  graph.hidden = !rateShown(completed);
  if (!graph.hidden) renderSpeedGraph($('speed-graph'), completed, { animate: true });
}

function resultHeadline(completed) {
  if (completed.status !== 'complete') return 'Interrupted · not counted';
  if (completed.kind === 'drill') return 'Drill complete · not counted toward your best';
  if (completed.kind === 'custom') return 'Custom text complete · not counted toward your best';
  if (completed.kind === 'daily') return completed.firstDailyAttempt ? 'Daily challenge complete' : 'Daily challenge complete · repeat attempt';
  if (!resultBestBefore) return 'First run at these settings';
  const delta = completed.summary.score.wpm - resultBestBefore.wpm;
  if (delta === 0) return `Matched your best of ${resultBestBefore.wpm}`;
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} vs your best of ${resultBestBefore.wpm}`;
}

function retestLength(value) {
  if (value.mode === 'time') return `${value.duration} s`;
  if (value.mode === 'words') return `${value.count}-word`;
  return value.quoteLength && value.quoteLength !== 'any' ? `${value.quoteLength} quote` : 'quote';
}

function renderResults(completed, saved) {
  activeRecommendation ||= recommendTarget([], completed.conditions);
  const replay = completed.summary;
  const counted = completed.status === 'complete';
  const firstErrors = replay.firstAttempts.filter((item) => !item.correct).length;
  const speed = rateShown(completed) ? `${replay.score.wpm} wpm` : 'Too quick to time';
  $('result-wpm').textContent = rateShown(completed) ? replay.score.wpm : '—';
  $('result-accuracy').textContent = replay.score.accuracy;
  $('result-errors').textContent = firstErrors;
  $('result-time').textContent = `${(replay.elapsedMs / 1000).toFixed(1)} s`;
  renderSecondaryStats(completed);
  $('result-conditions').textContent = describeRun(completed);
  $('result-delta').textContent = resultHeadline(completed);
  // A retest reports a failed save once, in the comparison caveat.
  $('result-comparison-note').textContent = [
    counted ? '' : 'Focus or input changed during the run, so it isn’t counted.',
    saved || sessionKind === 'retest' ? '' : 'Couldn’t save on this device.',
  ].filter(Boolean).join(' ');

  if (sessionKind === 'practice' || sessionKind === 'daily') {
    activeRecommendation = trainingRecommendation(completed.conditions);
    selectedTarget = activeRecommendation.target;
  }
  $('recommendation-title').textContent = counted ? activeRecommendation.title : 'Restart for a counted run';
  $('recommendation-evidence').textContent = counted ? activeRecommendation.reason : 'This run lost focus or used unsupported input.';
  $('recommendation-meta').textContent = baselineAttempt
    ? `About 1 min, then a fresh ${retestLength(completed.conditions)} retest.`
    : 'A standalone drill. Finish a practice run to establish a fresh-text retest baseline.';
  $('start-drill').disabled = !counted;
  $('skip-to-retest').disabled = !counted || !baselineAttempt;
  // Custom text is never mined for targets or kept as a baseline, so its results offer no drill or retest:
  // the recommendation would come from other runs and the retest would measure a different text.
  const compared = comparableKind(completed.kind);
  for (const id of ['recommendation-title', 'recommendation-evidence', 'recommendation-list', 'recommendation-meta', 'start-drill', 'skip-to-retest']) $(id).hidden = !compared;
  renderEvidenceList(activeRecommendation.evidence);
  $('run-again').textContent = sessionKind === 'daily' ? 'Try daily again' : 'Run again';
  renderTraining();
  renderDaily();
  $('comparison-panel').hidden = true;
  announce(saved
    ? `${speed}, ${replay.score.accuracy}% accuracy.`
    : `${speed}, ${replay.score.accuracy}% accuracy. Couldn’t save on this device.`);
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
  const beforePattern = before ? summarizePatterns([before]).pairs.find((item) => item.pair === trainedTarget) : null;
  const afterPattern = summarizePatterns([after]).pairs.find((item) => item.pair === trainedTarget);
  const enoughTiming = beforePattern?.timings.length >= 10 && afterPattern?.timings.length >= 10;
  let timingSummary = { target: trainedTarget, beforeCount: beforePattern?.timings.length || 0, afterCount: afterPattern?.timings.length || 0, deltaMs: null };
  if (enoughTiming) {
    const delta = afterPattern.medianMs - beforePattern.medianMs;
    timingSummary.deltaMs = delta;
    $('comparison-timing').textContent = signed(delta, 'ms');
    $('comparison-sample').textContent = `${trainedTarget} · ${beforePattern.timings.length} before · ${afterPattern.timings.length} after`;
  } else {
    $('comparison-timing').textContent = '—';
    $('comparison-sample').textContent = trainedTarget
      ? `${trainedTarget} · ${timingSummary.beforeCount} before · ${timingSummary.afterCount} after · too few to call`
      : `keystrokes · ${before?.summary?.insertions || 0} before · ${after.summary.insertions} after · no target pattern`;
  }
  let comparisonSaved = saved;
  if (comparison.comparable && saved) {
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
  selectedTarget = activeRecommendation?.target || null;
  const source = baselineAttempt?.conditions;
  if (source) restoreConditions(source);
  trainingContext = { target: selectedTarget, recommendationKind: activeRecommendation?.kind || 'general', baselineAttemptId: baselineAttempt?.id || null, drillCompleted: false };
  trainingContext.drill = { target: selectedTarget, duration: 60, wordList: prefs.wordList, textVersion: makeDrill(selectedTarget, prefs.wordList).textVersion };
  resetSession('drill', { focus: true });
}

function startRetest() {
  if (!baselineAttempt || baselineAttempt.status !== 'complete') return;
  const source = baselineAttempt.conditions;
  restoreConditions(source);
  resetSession('retest', { focus: true });
}

function restoreConditions(source) {
  prefs = {
    ...prefs,
    mode: source.mode,
    duration: source.duration || prefs.duration,
    count: source.count || prefs.count,
    punctuation: Boolean(source.punctuation),
    numbers: Boolean(source.numbers),
    quoteLength: source.quoteLength || prefs.quoteLength,
    difficulty: source.difficulty || prefs.difficulty,
    wordList: source.wordList || prefs.wordList,
    stopOnError: source.correctionPolicy !== 'relaxed',
  };
  profile.preferences = prefs;
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
  // Pills in a hidden screen measured zero width; remeasure every group now it is visible.
  updateGlides();
  if (view === 'progress') renderHistory();
  onlineRace?.onViewChange(view);
  if (view === 'results') renderTraining();
  if (view === 'compete') renderDaily();
}

function navigate(view) {
  if (view === 'practice') {
    // A custom passage that is ready or under way is practice too, so going to Practice keeps it.
    const current = attempt && (sessionKind === 'practice' || sessionKind === 'custom') && !['complete', 'interrupted'].includes(attempt.status);
    if (!current) resetSession('practice');
    switchView('practice');
    return;
  }
  if (attempt?.status === 'running' && view !== 'practice') {
    markInterrupted(NOTICES.leftSurface);
    finishPrimary();
  }
  if (race.attempt?.status === 'running' && view !== 'compete') markRaceInterrupted();
  switchView(view);
}

function markInterrupted(message) {
  if (attempt?.status !== 'running' || attempt.interrupted) return;
  attempt.interrupted = true;
  attempt.events.push({ type: 'focus-lost', offsetMs: offsetFor() });
  $('typing-status').className = 'badge badge-warning';
  $('typing-status').textContent = 'Interrupted';
  showInputNotice('primary', message, { sticky: true });
}

function markRaceInterrupted() {
  if (race.attempt?.status !== 'running' || race.attempt.interrupted) return;
  race.attempt.interrupted = true;
  race.attempt.events.push({ type: 'focus-lost', offsetMs: offsetFor('race') });
  showInputNotice('race', NOTICES.raceFocusLost, { speak: false });
  inbox?.runChanged();
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

function practiceTarget(target, source) {
  // Use a retained, compatible baseline when possible. Older corpus versions need a new baseline.
  baselineAttempt = [...profile.attempts].reverse().find((a) => a.status === 'complete' && !a.interrupted
    && ['test', 'retest', 'daily'].includes(a.kind) && a.fresh !== false
    && conditionKey(a.conditions) === conditionKey(source) && source.corpus === CORPUS_VERSION) || null;
  restoreConditions({ ...source, corpus: CORPUS_VERSION });
  selectedTarget = target;
  activeRecommendation = { kind: 'manual', target, title: `Practice “${target}”`,
    reason: baselineAttempt ? `You chose “${target}”. A retained run at these conditions is your baseline.`
      : `You chose “${target}”. Finish a new practice run afterward to establish a retest baseline.`,
    evidence: summarizePatterns(profile.attempts, 20, source) };
  startDrill();
  if (!baselineAttempt) $('session-description').textContent = 'Standalone drill. Finish a new practice run afterward for a comparable retest.';
}

function trainingRecommendation(source) {
  const recommendation = recommendTarget(profile.attempts, source);
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
}

function renderHistory() {
  const eligible = profile.runs.filter(trendRun);
  const hasProgress = eligible.length > 0 || profile.loops.length > 0;
  $('progress-empty').hidden = hasProgress;
  $('progress-content').hidden = !hasProgress;
  const hasHistory = profile.runs.length > 0 || profile.attempts.length > 0 || profile.loops.length > 0;
  $('clear-history').hidden = !hasHistory;
  $('clear-history').disabled = !hasHistory;
  const source = conditionOptions($('progress-conditions'), [...eligible, ...profile.loops]);
  const key = source ? conditionKey(source) : '';
  const period = $('progress-period').value;
  const matching = source ? filterRuns(eligible, key, period) : [];
  const week = weeklyChange(eligible, key);
  $('progress-week').textContent = week.wpm === null
    ? `This week: ${week.current.length} matching runs. A week-to-week change needs runs in both this week and the preceding week.`
    : `Weekly median: ${signed(week.wpm, 'wpm')} · ${signed(week.accuracy, 'pp accuracy')} · ${week.current.length} runs this week / ${week.previous.length} last week. This describes your runs, not a proven learning effect.`;
  renderTrend($('progress-trend'), matching, openHistoryRun);
  $('progress-trend-note').textContent = matching.length
    ? `${matching.length} completed practice runs and retests, oldest to newest. Select a point or open a run below. Daily scores are in Challenge.${matching.some((r) => !r.at) ? ' Earlier undated runs appear only in All saved runs.' : ''}`
    : 'No completed practice runs at these conditions in this period. Try a longer period or different conditions.';
  $('run-history').replaceChildren(...[...matching].reverse().map((run) => {
    const row = element('details', '', 'run-row');
    row.dataset.runId = run.id;
    const summary = element('summary', '', 'run-summary');
    summary.append(element('strong', `${run.score.wpm} wpm · ${run.score.accuracy}%`, 'num'),
      element('span', `${dateCopy(run.at)} · ${run.kind === 'retest' ? 'retest' : 'practice'} · view details`));
    const detail = element('div', '', 'run-detail');
    detail.append(scoreFacts([['first-try errors', run.errors], ['time', `${(run.elapsedMs / 1000).toFixed(1)} s`]]),
      element('p', describeConditions(run.conditions)), element('p', `Text: ${run.textId} · ${run.fresh === false ? 'previously displayed' : 'fresh when displayed'}`));
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
}

function dailyConditions() {
  return { ...conditions(), mode: 'quote', duration: null, count: null, punctuation: true, numbers: false,
    quoteLength: 'medium', difficulty: 'any', wordList: null, correctionPolicy: 'relaxed', corpus: CORPUS_VERSION };
}

function todayPassage() {
  const daily = dailyPassage();
  return { ...daily, id: daily.sourceTextId, challengeId: daily.id, corpus: CORPUS_VERSION,
    firstDailyAttempt: !profile.seenTextIds.includes(daily.id), fresh: !profile.seenTextIds.includes(daily.sourceTextId) };
}

function startDaily() {
  if (attempt?.status === 'running') { markInterrupted(NOTICES.leftSurface); finishPrimary(); }
  if (race.attempt?.status === 'running') markRaceInterrupted();
  baselineAttempt = null;
  trainingContext = null;
  activeRecommendation = null;
  resetSession('daily', { focus: true });
}

function renderDaily() {
  const daily = dailyPassage();
  $('daily-date').textContent = `${daily.day} · english · resets 00:00 UTC`;
  const completed = profile.runs.filter((r) => r.kind === 'daily' && validRun(r));
  const today = completed.filter((r) => r.challengeDate === daily.day && conditionKey(r.conditions) === conditionKey(dailyConditions()));
  const best = [...today].sort((a, b) => b.score.wpm - a.score.wpm || b.score.accuracy - a.score.accuracy)[0];
  $('daily-status').textContent = best
    ? `Today’s best: ${best.score.wpm} wpm · ${best.score.accuracy}% accuracy · ${today.length} ${today.length === 1 ? 'attempt' : 'attempts'} on a physical keyboard.${session ? '' : ' Sign in to save future results beyond this tab.'}`
    : `No completed physical-keyboard attempt today.${session ? ' Your results save to your account.' : ' Results last in this tab; sign in to save future attempts.'}`;
  $('daily-history-panel').hidden = !completed.length;
  $('daily-history').replaceChildren(...[...completed].reverse().slice(0, 30).map((run) => {
    const row = element('div', '', 'daily-result');
    row.append(element('strong', `${run.score.wpm} wpm · ${run.score.accuracy}%`, 'num'),
      element('span', `${run.challengeDate} · ${(run.firstDailyAttempt ?? run.fresh) ? 'first attempt' : 'repeat attempt'}${run.firstDailyAttempt && !run.fresh ? ' · previously displayed passage' : ''} · ${run.conditions.inputClass === 'touch' ? 'touch input' : 'physical keyboard'}`));
    return row;
  }));
}

function buildKeyboard() {
  const fragment = document.createDocumentFragment();
  ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', ' '].forEach((keys) => {
    const row = document.createElement('div');
    row.className = 'key-row';
    for (const letter of keys) {
      const key = document.createElement('span');
      key.className = `key${letter === ' ' ? ' space' : ''}`;
      key.dataset.key = letter;
      key.textContent = letter === ' ' ? 'space' : letter;
      row.append(key);
    }
    fragment.append(row);
  });
  $('keyboard').replaceChildren(fragment);
}

function startRace() {
  race = {
    passage: selectPassage({ mode: 'quote', quoteLength: 'medium', difficulty: 'any', seenIds: [] }),
    conditions: { ...conditions(), mode: 'quote', wordList: null, localRace: true },
    names: [$('player-one-name').value.trim() || 'Player one', $('player-two-name').value.trim() || 'Player two'],
    player: 0,
    attempt: null,
    startTime: null,
    results: [],
    characters: [],
    textView: null,
  };
  if (race.passage?.id && !profile.seenTextIds.includes(race.passage.id)) {
    profile.seenTextIds.push(race.passage.id);
    saveProfile();
  }
  $('compete-setup').hidden = true;
  $('race-leaderboard').hidden = true;
  $('race-handoff').hidden = true;
  setupRacePlayer();
}

function setupRacePlayer() {
  race.attempt = createAttempt({ id: uid(), text: race.passage.text, textId: race.passage.id, kind: 'race', conditions: { ...race.conditions } });
  race.startTime = null;
  inbox?.runChanged();
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
  $('race-help').textContent = 'Esc restarts.';
  $('race-input').focus({ preventScroll: true });
}

function updateRaceProgress(replay) {
  const percent = Math.round((replay.typed.length / race.attempt.text.length) * 100);
  $('race-progress').firstElementChild.style.setProperty('--progress', String(percent / 100));
  $('race-progress').setAttribute('aria-valuenow', String(percent));
}

function finishRacePlayer() {
  const valid = !race.attempt.interrupted && !race.attempt.unsupportedInput;
  const completed = completeAttempt(race.attempt, { endedAt: offsetFor('race'), status: valid ? 'complete' : 'interrupted' });
  completed.interrupted = race.attempt.interrupted;
  race.attempt = completed;
  inbox?.runChanged();
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
  } else renderRaceResults();
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
    speed.textContent = result.attempt.status === 'complete' ? `${score.wpm} wpm` : 'interrupted';
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

function clearHistory() {
  clearSnapshot = JSON.stringify(profile);
  profile.attempts = [];
  profile.runs = [];
  profile.loops = [];
  profile.seenTextIds = [];
  profile.bests = {};
  baselineAttempt = null;
  trainingContext = null;
  selectedTarget = null;
  activeRecommendation = null;
  for (const id of ['result-wpm', 'result-accuracy', 'result-errors', 'result-time', 'result-raw', 'result-consistency', 'result-chars']) $(id).textContent = '—';
  $('result-words').replaceChildren();
  wordItems = [];
  selectWord(null);
  $('result-delta').textContent = 'No run yet.';
  $('result-comparison-note').textContent = '';
  $('run-card-stamp').textContent = 'no run yet';
  $('run-card').hidden = true;
  lastCompleted = null;
  $('speed-graph').replaceChildren();
  $('recommendation-title').textContent = 'Finish a run to get a drill.';
  $('recommendation-evidence').textContent = '';
  $('recommendation-list').replaceChildren();
  $('comparison-panel').hidden = true;
  $('start-drill').disabled = true;
  $('skip-to-retest').disabled = true;
  const saved = saveProfile();
  $('clear-dialog').close();
  $('history-toast').hidden = false;
  $('history-feedback').textContent = saved ? 'History cleared.' : 'Cleared in this tab, but storage is unavailable.';
  $('undo-clear').hidden = false;
  $('undo-clear').focus();
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => { $('history-toast').hidden = true; clearSnapshot = null; }, 5000);
  renderHistory();
  renderTraining();
  renderDaily();
  showBest();
  armPace();
}

function undoClear() {
  if (!clearSnapshot) return;
  try { profile = JSON.parse(clearSnapshot); } catch { return; }
  prefs = profile.preferences;
  saveProfile();
  clearSnapshot = null;
  clearTimeout(clearTimer);
  $('history-feedback').textContent = 'History restored.';
  $('undo-clear').hidden = true;
  applyPreferences();
  setModeControls();
  renderHistory();
  renderTraining();
  renderDaily();
  setTimeout(() => { $('history-toast').hidden = true; }, 1600);
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

// Resolves true once the account row matches the device.
async function pushProfile({ keepalive = false } = {}) {
  clearTimeout(syncTimer);
  syncTimer = 0;
  if (!session) return false;
  try {
    session = await account.freshSession(session);
    await account.pushCloudProfile(session, profile, { keepalive });
    unsynced = false;
    setSyncState('synced');
    return true;
  } catch {
    setSyncState(account.loadSession() ? 'offline' : 'expired');
    return false;
  }
}

function adoptProfile(data) {
  profile = normalizeProfile(data);
  prefs = profile.preferences;
  account.cacheProfile(session.user.id, profile);
  applyPreferences();
  setModeControls();
  renderHistory();
  if (sessionKind === 'practice' && attempt?.status !== 'running') resetSession('practice');
}

// The newer of the device cache and the account row wins; the other side is brought up to date.
async function syncOnLoad() {
  if (!session) return;
  try {
    session = await account.freshSession(session);
    const cloud = await account.fetchCloudProfile(session);
    if (cloudChecked) return;
    cloudChecked = true;
    const localAt = profile.updatedAt || '';
    const cloudAt = cloud?.data?.updatedAt || '';
    if (!cloud) {
      // History from before accounts existed goes to the first account that has none of its own.
      // Taken only once the account is known to be empty, so a failed fetch leaves it in place.
      const legacy = account.takeLegacyProfile();
      if (legacy?.version === 2) {
        profile = account.mergeProfiles(profile, normalizeProfile(legacy));
        prefs = profile.preferences;
      }
      // Stored and sent before anything re-renders, so the import can't be left half done.
      saveProfile();
      await pushProfile();
      if (legacy?.version === 2) adoptProfile(profile);
    } else if (cloudAt > localAt) {
      // Edits made here before the check (usually just the passage marked seen) give way to the newer row.
      adoptProfile(cloud.data);
      if (!syncTimer) {
        unsynced = false;
        setSyncState('synced');
      }
    } else if (localAt > cloudAt || unsynced) {
      saveProfile();
      await pushProfile();
    } else {
      setSyncState('synced');
    }
  } catch {
    // Offline or unreachable: edits stay on the device, unstamped, until a check succeeds.
    setSyncState(account.loadSession() ? 'offline' : 'expired');
  }
}

// Puts the account's profile in the device cache, then starts over as that user.
// A device copy newer than the account row (unsynced when last signed out) is kept for syncOnLoad.
async function enterAccount(newSession) {
  try {
    const cloud = await account.fetchCloudProfile(newSession);
    const cached = account.loadCachedProfile(newSession.user.id);
    if (cloud && (cloud.data?.updatedAt || '') >= (cached?.updatedAt || '')) account.cacheProfile(newSession.user.id, cloud.data);
  } catch {}
  location.reload();
}

async function signOutAccount() {
  closeAccountMenu();
  await onlineRace?.leave();
  inbox?.forget();
  const synced = !unsynced || await pushProfile();
  // Unsynced edits stay on this device and go up the next time this account signs in here.
  await account.signOut(session, { keepCache: !synced });
  location.reload();
}

function closeAccountMenu() {
  $('account').open = false;
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

function showAccountToast(message) {
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
  // Unsynced changes go out when the tab is hidden; anything too large for that syncs on the next load.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && syncTimer) pushProfile({ keepalive: true });
  });
  addEventListener('online', () => {
    if (!session) return;
    if (!cloudChecked) syncOnLoad();
    else if (unsynced) pushProfile();
  });
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
      if (!attempt || attempt.status === 'complete' || $('typing-input').disabled) resetSession('practice');
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
      resetSession('practice', { focus: true });
    }
  });
  $('mode-custom').addEventListener('click', () => openCustom(!customOpen));
  $('custom-text').addEventListener('input', updateCustomState);
  $('custom-use').addEventListener('click', useCustomText);
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
    customOpen = false;
    prefs.mode = button.dataset.mode;
    setModeControls();
    saveProfile();
    resetSession('practice', { focus: true });
  }));
  $('duration-options').addEventListener('click', (event) => {
    const button = event.target.closest('[data-length]');
    if (!button) return;
    if (prefs.mode === 'time') prefs.duration = Number(button.dataset.length);
    else prefs.count = Number(button.dataset.length);
    setModeControls();
    saveProfile();
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
  $('font-size').addEventListener('change', (event) => { prefs.fontSize = event.target.value; applyPreferences(); saveProfile(); });
  $('live-toggle').addEventListener('change', (event) => { prefs.liveMetrics = event.target.checked; applyPreferences(); saveProfile(); });
  $('keyboard-toggle').addEventListener('change', (event) => { prefs.keyboard = event.target.checked; applyPreferences(); saveProfile(); });
  $('stop-on-error-toggle').addEventListener('change', (event) => setStopOnError(event.target.checked));
  $('theme-select').addEventListener('change', (event) => { prefs.theme = event.target.value; applyTheme(); saveProfile(); });
  prefersLight.addEventListener('change', () => { if (prefs.theme === 'system') applyTheme(); });
  $('pace-select').addEventListener('change', (event) => setPaceCaret(event.target.value));
  $('pace-wpm').addEventListener('change', (event) => { prefs.paceWpm = clampPace(event.target.value); setPaceCaret('custom'); });
  $('focus-toggle').addEventListener('change', (event) => { prefs.focusMode = event.target.checked; applyPreferences(); saveProfile(); });
  $('tape-toggle').addEventListener('change', (event) => { prefs.tape = event.target.checked; applyPreferences(); saveProfile(); });
  $('exit-focus').addEventListener('click', () => {
    prefs.focusMode = false;
    applyPreferences();
    saveProfile();
    $('typing-input').focus({ preventScroll: true });
  });

  $('typing-input').addEventListener('beforeinput', (event) => beforeTypingInput(event));
  $('typing-input').addEventListener('input', () => { $('typing-input').value = replayAttempt(attempt).typed; });
  $('typing-input').addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) event.preventDefault();
  });
  for (const type of ['keydown', 'keyup']) $('typing-input').addEventListener(type, syncCapsLock);
  $('typing-input').addEventListener('blur', () => setCapsWarning(false));
  $('typing-input').addEventListener('paste', (event) => { event.preventDefault(); refusePaste('primary'); });
  $('typing-input').addEventListener('drop', (event) => event.preventDefault());
  $('typing-input').addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' && attempt?.status === 'ready') {
      attempt.conditions.inputClass = 'touch';
      $('condition-line').textContent = describeRun(attempt);
      armPace();
    }
  });
  $('typing-input').addEventListener('click', () => { const value = $('typing-input').value; $('typing-input').setSelectionRange(value.length, value.length); });
  $('typing-input').addEventListener('compositionstart', () => {
    if (attempt && ['ready', 'running'].includes(attempt.status)) {
      if (attempt.status === 'ready') startAttempt(attempt);
      attempt.unsupportedInput = true;
      attempt.interrupted = true;
      attempt.events.push({ type: 'composition', offsetMs: offsetFor() });
      showInputNotice('primary', NOTICES.composition, { sticky: true });
    }
  });
  $('restart-button').addEventListener('click', () => resetSession(sessionKind, { focus: true }));
  $('run-again').addEventListener('click', () => sessionKind === 'daily' ? startDaily() : resetSession(restartKind(), { focus: true }));
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
  $('progress-period').addEventListener('change', renderHistory);
  $('training-conditions').addEventListener('change', renderTraining);
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

  $('compete-setup').addEventListener('submit', (event) => { event.preventDefault(); startRace(); });
  $('race-input').addEventListener('beforeinput', (event) => beforeTypingInput(event, 'race'));
  $('race-input').addEventListener('input', () => { if (race.attempt) $('race-input').value = replayAttempt(race.attempt).typed; });
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
    if (palette?.isOpen() || $('clear-dialog').open || $('account-dialog').open || $('suggest-dialog').open) return;
    if (event.key === 'Escape' && preferences.open) {
      event.preventDefault();
      preferences.open = false;
      preferences.querySelector('summary').focus();
      return;
    }
    if (event.repeat && event.key.length === 1 && (document.activeElement === $('typing-input') || document.activeElement === $('race-input'))) {
      event.preventDefault();
      showInputNotice(document.activeElement === $('typing-input') ? 'primary' : 'race', NOTICES.repeat, { speak: false });
      return;
    }
    if (event.key === 'Escape' && prefs.focusMode) {
      event.preventDefault();
      prefs.focusMode = false;
      applyPreferences();
      saveProfile();
      $('typing-input').focus({ preventScroll: true });
    } else if (event.key === 'Escape' && document.activeElement === $('typing-input')) {
      event.preventDefault();
      resetSession(sessionKind, { focus: true });
    } else if (event.key === 'Escape' && document.activeElement === $('race-input')) {
      event.preventDefault();
      setupRacePlayer();
    }
    document.querySelectorAll('.key').forEach((key) => key.classList.toggle('active', key.dataset.key === event.key.toLowerCase()));
  });
  document.addEventListener('keyup', () => document.querySelectorAll('.key.active').forEach((key) => key.classList.remove('active')));
  window.addEventListener('blur', () => {
    document.querySelectorAll('.key.active').forEach((key) => key.classList.remove('active'));
    markInterrupted(NOTICES.focusLost);
    markRaceInterrupted();
  });
  document.addEventListener('pointerdown', (event) => {
    if (preferences.open && !preferences.contains(event.target)) preferences.open = false;
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
  if (attempt?.status === 'running') resetSession(restartKind());
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
  saveProfile();
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
  saveProfile();
  resetSession('practice', { focus: true });
}

function togglePreference(key) {
  prefs[key] = !prefs[key];
  applyPreferences();
  saveProfile();
  if (document.body.dataset.view === 'practice') $('typing-input').focus({ preventScroll: true });
}

function setStopOnError(enabled) {
  if (prefs.stopOnError === enabled) return;
  prefs.stopOnError = enabled;
  applyPreferences();
  saveProfile();
  if (document.body.dataset.view === 'practice') resetSession(restartKind());
}

function setWordList(id, kind = restartKind()) {
  prefs.wordList = id;
  applyPreferences();
  saveProfile();
  resetSession(kind, { focus: true });
}

// A palette command that changes a practice setting restarts the session the user was in, as the settings
// popover does, even when going to Practice first has ended a finished custom run.
function inPractice(change) {
  const kind = restartKind();
  navigate('practice');
  change(kind);
}

function paletteCommands(query) {
  const onOff = (value) => (value ? 'on' : 'off');
  // During a custom session no test shape is current, only "custom text".
  const shape = (mode, length) => comparableKind(sessionKind) && prefs.mode === mode && (mode === 'quote' || (mode === 'time' ? prefs.duration : prefs.count) === length);
  const commands = [
    ...[['practice', 'practice'], ['results', 'train'], ['progress', 'progress'], ['compete', 'challenge']].map(([view, label]) => ({
      group: 'go to', label, keywords: `${view} open view page`, hint: document.body.dataset.view === view ? 'here' : '', on: document.body.dataset.view === view, run: () => navigate(view),
    })),
    { group: 'test', label: 'restart test', keywords: 'reset again new passage', hint: 'esc', run: () => inPractice((kind) => resetSession(kind, { focus: true })) },
    { group: 'test', label: 'daily challenge', keywords: 'today shared passage daily quote', run: startDaily },
    ...[15, 30, 60, 120].map((length) => ({ group: 'test', label: `time · ${length} seconds`, keywords: `timed ${length}s`, hint: shape('time', length) ? 'current' : '', on: shape('time', length), run: () => setTestShape('time', length) })),
    ...[10, 25, 50, 100].map((length) => ({ group: 'test', label: `words · ${length} words`, keywords: `count ${length}`, hint: shape('words', length) ? 'current' : '', on: shape('words', length), run: () => setTestShape('words', length) })),
    { group: 'test', label: 'custom text', keywords: 'own text paste bring your passage', hint: sessionKind === 'custom' ? 'current' : '', on: sessionKind === 'custom', run: () => { navigate('practice'); openCustom(true); } },
    { group: 'test', label: 'quote', keywords: 'passage original text', hint: shape('quote') ? 'current' : '', on: shape('quote'), run: () => setTestShape('quote') },
    { group: 'test', label: 'punctuation', keywords: 'capitals commas periods', hint: onOff(prefs.punctuation), on: prefs.punctuation, disabled: prefs.mode === 'quote', run: () => { prefs.punctuation = !prefs.punctuation; applyPreferences(); saveProfile(); resetSession(restartKind(), { focus: true }); } },
    { group: 'test', label: 'numbers', keywords: 'digits figures', hint: onOff(prefs.numbers), on: Boolean(prefs.numbers), disabled: prefs.mode === 'quote', run: () => { prefs.numbers = !prefs.numbers; applyPreferences(); saveProfile(); resetSession(restartKind(), { focus: true }); } },
    ...wordListIds.map((id) => ({ group: 'test', label: `word list · top ${id}`, keywords: 'common words vocabulary 200 1000 5000 10000 monkeytype easier harder', hint: prefs.wordList === id ? 'current' : '', on: prefs.wordList === id, disabled: prefs.mode === 'quote', run: () => inPractice((kind) => setWordList(id, kind)) })),
    ...[['off', 'off'], ['best', 'personal best'], ['average', 'average'], ['last', 'last run'], ['custom', 'custom']].map(([mode, name]) => (
      { group: 'test', label: `pace caret: ${name}`, keywords: 'ghost pacer pace caret', hint: prefs.paceCaret === mode ? 'on' : '', on: prefs.paceCaret === mode, run: () => setPaceCaret(mode) })),
    { group: 'test', label: 'stop on error', keywords: 'mistakes correction continue', hint: onOff(prefs.stopOnError), on: prefs.stopOnError, run: () => setStopOnError(!prefs.stopOnError) },
    ...['dark', 'light', 'system'].map((theme) => ({ group: 'display', label: `theme · ${theme}`, keywords: 'colour color mode appearance', hint: prefs.theme === theme ? 'current' : '', on: prefs.theme === theme, run: () => { prefs.theme = theme; applyTheme(); saveProfile(); } })),
    ...[['22', 'small'], ['28', 'medium'], ['36', 'large']].map(([size, name]) => ({ group: 'display', label: `text size · ${name}`, keywords: 'font passage bigger smaller', hint: prefs.fontSize === size ? 'current' : '', on: prefs.fontSize === size, run: () => { prefs.fontSize = size; applyPreferences(); saveProfile(); } })),
    { group: 'display', label: 'one-line tape', keywords: 'tape mode single line passage layout scroll', hint: onOff(prefs.tape), on: prefs.tape, run: () => togglePreference('tape') },
    { group: 'display', label: 'live metrics', keywords: 'wpm accuracy while typing', hint: onOff(prefs.liveMetrics), on: prefs.liveMetrics, run: () => togglePreference('liveMetrics') },
    { group: 'display', label: 'keyboard', keywords: 'keys layout', hint: onOff(prefs.keyboard), on: prefs.keyboard, run: () => togglePreference('keyboard') },
    { group: 'display', label: 'focus mode', keywords: 'zen hide distraction', hint: onOff(prefs.focusMode), on: prefs.focusMode, run: () => { navigate('practice'); togglePreference('focusMode'); } },
    ...(session
      ? [{ group: 'account', label: 'sign out', keywords: `log out logout ${session.user.email}`, hint: session.user.email, run: signOutAccount }]
      : [
        { group: 'account', label: 'create account…', keywords: 'sign up register save login', run: () => openAccountDialog('create') },
        { group: 'account', label: 'sign in…', keywords: 'log in login account', run: () => openAccountDialog('signin') },
        { group: 'account', label: 'continue with Google', keywords: 'sign in log in login google', run: continueWithGoogle },
      ]),
    { group: 'help', label: 'suggest a feature…', keywords: 'feedback idea request feature', run: openSuggest },
    { group: 'local data', label: 'clear local history…', keywords: 'delete reset erase', disabled: profile.runs.length === 0 && profile.attempts.length === 0 && profile.loops.length === 0, run: () => { navigate('progress'); $('clear-history').click(); } },
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
      markInterrupted(NOTICES.paletteOpened);
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
  // On one line, crossing the 760px breakpoint changes the text size, which the trim spacer cannot follow.
  if (prefs.tape) primaryTextView?.restore();
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
  if (!lastCompleted || !width || Math.abs(Number(graph.querySelector('svg')?.getAttribute('width')) - width) <= 1) return;
  renderSpeedGraph(graph, lastCompleted, { animate: false });
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
buildKeyboard();
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
inbox = createInbox({
  isRunning: () => runActive || localRaceRunning(),
  getSession: () => session,
  listInvites: listRaceInvites,
  announce,
  actions: {
    invite: { label: 'Join', run: (entry) => onlineRace.joinInvite(entry.roomId) },
    joined: { label: 'Open', available: (entry) => onlineRace?.liveRoomId === entry.roomId, run: () => onlineRace.open() },
    result: { label: 'Race again', run: (entry) => onlineRace.rematchRoom(entry.roomId, entry.conditions) },
  },
});
onlineRace = createOnlineRace({
  getSession: () => session,
  inbox,
  signIn: () => openAccountDialog('signin'),
  navigate, renderText, updateCharacterStates, setRunning, announce,
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
completeAuthRedirect();
syncOnLoad();
inbox.refresh();
// Refresh the day label when a tab returns, and across midnight without reloading.
setInterval(() => { if (document.body.dataset.view === 'compete') renderDaily(); }, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) renderDaily();
});

// Offline shell (sw.js): installable and playable without a connection. Skipped on localhost so local
// edits are never served stale; Supabase and other origins are never cached.
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  Promise.resolve(navigator.serviceWorker.register('/sw.js')).catch(() => {});
}

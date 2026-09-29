import {
  CORPUS_VERSION,
  METRIC_VERSION,
  compareAttempts,
  completeAttempt,
  conditionKey,
  createAttempt,
  makeDrill,
  normalizeManualTarget,
  passageComplete,
  recommendTarget,
  replayAttempt,
  selectPassage,
  summarizePatterns,
} from './typing.js';
import { DEFAULT_WORD_LIST, wordListIds } from './words.js';
import { createTypingFx } from './motion.js';
import { renderRunArt } from './rhythm.js';
import { createPalette } from './palette.js';
import { listenForSequence } from './egg.js';

const STORAGE_KEY = 'stilltype-profile-v2';
const MAX_STORED_ATTEMPTS = 24;
const $ = (id) => document.getElementById(id);
const now = () => performance.now();
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const defaultPreferences = {
  mode: 'time',
  duration: 30,
  count: 25,
  punctuation: false,
  quoteLength: 'medium',
  difficulty: 'any',
  wordList: DEFAULT_WORD_LIST,
  fontSize: '28',
  liveMetrics: false,
  keyboard: false,
  stopOnError: false,
  focusMode: false,
  theme: 'system',
};

function emptyProfile() {
  return {
    version: 2,
    profileId: uid(),
    preferences: { ...defaultPreferences },
    attempts: [],
    loops: [],
    seenTextIds: [],
    bests: {},
  };
}

let storageAvailable = true;

function validPreferences(value) {
  if (!wordListIds.includes(value.wordList)) value.wordList = DEFAULT_WORD_LIST;
  return value;
}

function loadProfile() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed?.version !== 2) return emptyProfile();
    return {
      ...emptyProfile(),
      ...parsed,
      preferences: validPreferences({ ...defaultPreferences, ...parsed.preferences }),
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
      loops: Array.isArray(parsed.loops) ? parsed.loops : [],
      seenTextIds: Array.isArray(parsed.seenTextIds) ? parsed.seenTextIds : [],
      bests: parsed.bests && typeof parsed.bests === 'object' ? parsed.bests : {},
    };
  } catch {
    storageAvailable = false;
    return emptyProfile();
  }
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
const primaryFx = createTypingFx($('typing-wrap'), $('text-display'), { ensureCharacters: (index) => primaryTextView?.ensureForward(index) });
const raceFx = createTypingFx(document.querySelector('.race-typing-wrap'), $('race-text-display'), { ensureCharacters: (index) => race.textView?.ensureForward(index) });
const prefersLight = matchMedia('(prefers-color-scheme: light)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let lastCompleted = null;
let ghostOn = false;
let palette = null;
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

function saveProfile() {
  profile.preferences = { ...prefs };
  profile.attempts = profile.attempts.slice(-MAX_STORED_ATTEMPTS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    storageAvailable = true;
    return true;
  } catch {
    storageAvailable = false;
    return false;
  }
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

function describeConditions(value = conditions()) {
  const length = value.mode === 'time' ? `${value.duration} s` : value.mode === 'words' ? `${value.count} words` : `${value.quoteLength || 'any'} quote`;
  const punctuation = value.mode === 'quote' ? value.difficulty || 'any difficulty' : value.punctuation ? 'punctuation' : 'plain';
  const input = value.inputClass === 'touch' ? 'touch input' : 'physical keyboard';
  const correction = value.correctionPolicy === 'relaxed' ? 'continue on error' : 'stop on error';
  const language = value.wordList ? `english ${value.wordList}` : 'english';
  return `${language} · ${length} · ${punctuation} · ${input} · ${correction} · corpus ${(value.corpus || CORPUS_VERSION).replace(/^.*-(v\d+)$/, '$1')} · metric v1`;
}

// A drill is always one minute of generated text, whatever the baseline was.
function describeRun(run) {
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

// body[data-running] lets the CSS fade the chrome mid-run; skip no-op writes on every keystroke.
function setRunning(running) {
  const value = String(running);
  if (document.body.dataset.running !== value) document.body.dataset.running = value;
}

function currentBestKey() {
  return conditionKey(conditions());
}

function showBest() {
  const best = profile.bests[currentBestKey()];
  $('best').textContent = best ? `Best · ${best.wpm} wpm` : 'No best yet';
}

function resolvedTheme() {
  if (prefs.theme === 'light' || prefs.theme === 'dark') return prefs.theme;
  return prefersLight.matches ? 'light' : 'dark';
}

function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#f4f1eb' : '#0f0f0e';
  $('theme-select').value = prefs.theme;
  if (document.body.dataset.view === 'results' && lastCompleted) renderRunArt($('card-canvas'), lastCompleted, { animate: false });
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
  $('stop-on-error-toggle').checked = prefs.stopOnError;
  $('focus-toggle').checked = prefs.focusMode;
  $('keyboard').hidden = !prefs.keyboard;
  applyTheme();
  $('punctuation-toggle').checked = prefs.punctuation;
  $('quote-length').value = prefs.quoteLength;
  $('quote-difficulty').value = prefs.difficulty;
  $('word-list').value = prefs.wordList;
  showBest();
}

function setModeControls() {
  document.querySelectorAll('[data-mode]').forEach((button) => {
    const selected = button.dataset.mode === prefs.mode;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('quote-options').hidden = prefs.mode !== 'quote';
  $('punctuation-toggle').disabled = prefs.mode === 'quote';
  $('word-list').disabled = prefs.mode === 'quote';
  $('duration-options').hidden = prefs.mode === 'quote';
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

function choosePassage(extraSeen = []) {
  return selectPassage({
    mode: prefs.mode,
    count: prefs.count,
    punctuation: prefs.punctuation,
    quoteLength: prefs.quoteLength,
    difficulty: prefs.difficulty,
    wordList: prefs.wordList,
    seenIds: [...profile.seenTextIds, ...extraSeen],
  });
}

function sessionDurationMs() {
  if (sessionKind === 'drill') return 60000;
  if (prefs.mode === 'time') return prefs.duration * 1000;
  return null;
}

function configureSessionCopy() {
  const copy = {
    practice: ['practice', 'Practice', ''],
    drill: ['drill · 1 min', selectedTarget ? `Practice “${selectedTarget}”` : 'General drill', 'Doesn’t count toward your best.'],
    retest: ['fresh-text retest', 'Measure the change', passage?.fresh === false ? 'You’ve seen every matching quote, so this can’t be a fresh comparison.' : 'Fresh text, same conditions.'],
  }[sessionKind];
  $('session-kicker').textContent = copy[0];
  $('session-title').textContent = copy[1];
  $('session-description').textContent = copy[2];
  $('typing-screen').dataset.session = sessionKind;
  document.body.dataset.session = sessionKind;
  const setup = document.querySelector('.practice-controls');
  if (setup) setup.hidden = sessionKind !== 'practice';
  $('quote-options').hidden = sessionKind !== 'practice' || prefs.mode !== 'quote';
}

function resetSession(kind = sessionKind, { focus = false, selectedPassage = null } = {}) {
  clearInterval(ticker);
  ticker = null;
  setRunning(false);
  primaryNotice = '';
  sessionKind = kind;
  passage = selectedPassage || (kind === 'drill' ? makeDrill(selectedTarget, prefs.wordList) : choosePassage(kind === 'retest' && baselineAttempt ? [baselineAttempt.textId] : []));
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
  attempt = createAttempt({
    id: uid(),
    text: passage.text,
    textId: passage.id,
    kind: kind === 'practice' ? 'test' : kind,
    conditions: conditions(),
  });
  attempt.fresh = passage.fresh !== false;
  startTime = null;
  $('typing-input').value = '';
  $('typing-input').disabled = false;
  $('accessible-passage').textContent = passage.text;
  primaryTextView = renderText($('text-display'), passage.text);
  primaryCharacters = primaryTextView.characters;
  primaryFx.reset(primaryCharacters);
  primaryFx.ghost.arm(ghostOn ? ghostPace().cps : 0);
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

// The ghost runs at the personal best for these exact conditions, or a gentle 60 wpm without one.
function ghostPace() {
  // The active attempt knows its real input class (touch is detected after reset).
  const best = profile.bests[conditionKey(attempt?.conditions || conditions())];
  const wpm = best?.wpm || 60;
  return { wpm, cps: (wpm * 5) / 60, fromBest: Boolean(best) };
}

function markKeyboardTargets(target) {
  const letters = new Set((target || '').toLowerCase());
  document.querySelectorAll('.key').forEach((key) => key.classList.toggle('target', letters.has(key.dataset.key)));
}

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
    const score = second >= 1 ? replayAttempt({ ...attempt, endedAt: boundedElapsed }).score : null;
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
  const key = conditionKey(completed.conditions);
  const score = completed.summary.score;
  const eligibleBest = completed.status === 'complete' && !completed.interrupted && completed.kind !== 'drill' && completed.kind !== 'race';
  resultBestBefore = profile.bests[key] || null;
  profile.attempts.push(completed);
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

  if (sessionKind === 'practice' && valid) {
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

// Draw after the results view is shown so the canvas has its size.
function renderCard(completed) {
  lastCompleted = completed;
  const kind = completed.kind === 'test' ? 'practice' : completed.kind;
  const at = new Date();
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  $('run-card-stamp').textContent = `${MONTHS[at.getMonth()]} ${at.getDate()} · ${time} · ${kind}`;
  $('run-card').hidden = false;
  renderRunArt($('card-canvas'), completed, { animate: true });
}

function resultHeadline(completed) {
  if (completed.status !== 'complete') return 'Interrupted · not counted';
  if (completed.kind === 'drill') return 'Drill complete · not counted toward your best';
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
  $('result-wpm').textContent = replay.score.wpm;
  $('result-accuracy').textContent = replay.score.accuracy;
  $('result-errors').textContent = firstErrors;
  $('result-time').textContent = `${(replay.elapsedMs / 1000).toFixed(1)} s`;
  $('result-conditions').textContent = describeRun(completed);
  $('result-delta').textContent = resultHeadline(completed);
  // A retest reports a failed save once, in the comparison caveat.
  $('result-comparison-note').textContent = [
    counted ? '' : 'Focus or input changed during the run, so it isn’t counted.',
    saved || sessionKind === 'retest' ? '' : 'Couldn’t save on this device.',
  ].filter(Boolean).join(' ');

  if (sessionKind === 'practice') {
    activeRecommendation = recommendTarget(profile.attempts, completed.conditions);
    selectedTarget = activeRecommendation.target;
  }
  $('recommendation-title').textContent = counted ? activeRecommendation.title : 'Restart for a counted run';
  $('recommendation-evidence').textContent = counted ? activeRecommendation.reason : 'This run lost focus or used unsupported input.';
  $('recommendation-meta').textContent = `About 1 min, then a fresh ${retestLength(completed.conditions)} retest.`;
  $('start-drill').disabled = !counted;
  $('skip-to-retest').disabled = !counted || !baselineAttempt;
  renderEvidenceList(activeRecommendation.evidence);
  $('comparison-panel').hidden = true;
  announce(saved
    ? `${replay.score.wpm} wpm, ${replay.score.accuracy}% accuracy.`
    : `${replay.score.wpm} wpm, ${replay.score.accuracy}% accuracy. Couldn’t save on this device.`);
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
    });
    comparisonSaved = saveProfile();
  }
  $('comparison-caveat').textContent = `${comparison.reason}${comparisonSaved ? '' : ' Couldn’t save on this device.'}`;
  renderHistory();
}

function startDrill() {
  selectedTarget = activeRecommendation?.target || null;
  trainingContext = { target: selectedTarget, recommendationKind: activeRecommendation?.kind || 'general', baselineAttemptId: baselineAttempt?.id || null, drillCompleted: false };
  resetSession('drill', { focus: true });
}

function startRetest() {
  if (!baselineAttempt || baselineAttempt.status !== 'complete') return;
  const source = baselineAttempt.conditions;
  prefs = {
    ...prefs,
    mode: source.mode,
    duration: source.duration || prefs.duration,
    count: source.count || prefs.count,
    punctuation: Boolean(source.punctuation),
    quoteLength: source.quoteLength || prefs.quoteLength,
    difficulty: source.difficulty || prefs.difficulty,
    wordList: source.wordList || prefs.wordList,
    stopOnError: source.correctionPolicy !== 'relaxed',
  };
  profile.preferences = prefs;
  applyPreferences();
  setModeControls();
  resetSession('retest', { focus: true });
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
}

function navigate(view) {
  if (view === 'practice') {
    if (!attempt || sessionKind !== 'practice' || ['complete', 'interrupted'].includes(attempt.status)) resetSession('practice');
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
}

function renderHistory() {
  const loops = [...profile.loops].reverse();
  $('progress-empty').hidden = loops.length > 0;
  $('history-list').hidden = loops.length === 0;
  const hasHistory = profile.attempts.length > 0 || loops.length > 0;
  $('clear-history').hidden = !hasHistory;
  $('clear-history').disabled = !hasHistory;
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
    return row;
  });
  $('history-list').replaceChildren(...rows);
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
  profile.loops = [];
  profile.seenTextIds = [];
  profile.bests = {};
  baselineAttempt = null;
  trainingContext = null;
  selectedTarget = null;
  activeRecommendation = null;
  for (const id of ['result-wpm', 'result-accuracy', 'result-errors', 'result-time']) $(id).textContent = '—';
  $('result-delta').textContent = 'No run yet.';
  $('result-comparison-note').textContent = '';
  $('run-card-stamp').textContent = 'no run yet';
  $('run-card').hidden = true;
  lastCompleted = null;
  const canvas = $('card-canvas');
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
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
  showBest();
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
  setTimeout(() => { $('history-toast').hidden = true; }, 1600);
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
    const practice = event.target.closest('[data-action="go-practice"]');
    if (practice) resetSession('practice', { focus: true });
  });
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
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
  $('quote-length').addEventListener('change', (event) => { prefs.quoteLength = event.target.value; saveProfile(); resetSession('practice', { focus: true }); });
  $('quote-difficulty').addEventListener('change', (event) => { prefs.difficulty = event.target.value; saveProfile(); resetSession('practice', { focus: true }); });
  $('word-list').addEventListener('change', (event) => setWordList(event.target.value));
  $('font-size').addEventListener('change', (event) => { prefs.fontSize = event.target.value; applyPreferences(); saveProfile(); });
  $('live-toggle').addEventListener('change', (event) => { prefs.liveMetrics = event.target.checked; applyPreferences(); saveProfile(); });
  $('keyboard-toggle').addEventListener('change', (event) => { prefs.keyboard = event.target.checked; applyPreferences(); saveProfile(); });
  $('stop-on-error-toggle').addEventListener('change', (event) => setStopOnError(event.target.checked));
  $('theme-select').addEventListener('change', (event) => { prefs.theme = event.target.value; applyTheme(); saveProfile(); });
  prefersLight.addEventListener('change', () => { if (prefs.theme === 'system') applyTheme(); });
  $('focus-toggle').addEventListener('change', (event) => { prefs.focusMode = event.target.checked; applyPreferences(); saveProfile(); });
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
  $('typing-input').addEventListener('paste', (event) => { event.preventDefault(); refusePaste('primary'); });
  $('typing-input').addEventListener('drop', (event) => event.preventDefault());
  $('typing-input').addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' && attempt?.status === 'ready') {
      attempt.conditions.inputClass = 'touch';
      $('condition-line').textContent = describeRun(attempt);
      if (ghostOn) primaryFx.ghost.arm(ghostPace().cps);
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
  $('run-again').addEventListener('click', () => resetSession('practice', { focus: true }));
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

  const preferences = document.querySelector('.preferences');
  document.addEventListener('keydown', (event) => {
    if (palette?.isOpen() || $('clear-dialog').open) return;
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
    if (moved > 4) setRunning(false);
  });
}

function setTestShape(mode, length) {
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
  if (document.body.dataset.view === 'practice') resetSession('practice');
}

function setWordList(id) {
  prefs.wordList = id;
  applyPreferences();
  saveProfile();
  resetSession('practice', { focus: true });
}

function paletteCommands(query) {
  const onOff = (value) => (value ? 'on' : 'off');
  const shape = (mode, length) => prefs.mode === mode && (mode === 'quote' || (mode === 'time' ? prefs.duration : prefs.count) === length);
  const commands = [
    ...[['practice', 'practice'], ['results', 'train'], ['progress', 'progress'], ['compete', 'challenge']].map(([view, label]) => ({
      group: 'go to', label, keywords: `${view} open view page`, hint: document.body.dataset.view === view ? 'here' : '', on: document.body.dataset.view === view, run: () => navigate(view),
    })),
    { group: 'test', label: 'restart test', keywords: 'reset again new passage', hint: 'esc', run: () => { navigate('practice'); resetSession(sessionKind, { focus: true }); } },
    ...[15, 30, 60, 120].map((length) => ({ group: 'test', label: `time · ${length} seconds`, keywords: `timed ${length}s`, hint: shape('time', length) ? 'current' : '', on: shape('time', length), run: () => setTestShape('time', length) })),
    ...[10, 25, 50, 100].map((length) => ({ group: 'test', label: `words · ${length} words`, keywords: `count ${length}`, hint: shape('words', length) ? 'current' : '', on: shape('words', length), run: () => setTestShape('words', length) })),
    { group: 'test', label: 'quote', keywords: 'passage original text', hint: shape('quote') ? 'current' : '', on: shape('quote'), run: () => setTestShape('quote') },
    { group: 'test', label: 'punctuation', keywords: 'capitals commas periods', hint: onOff(prefs.punctuation), on: prefs.punctuation, disabled: prefs.mode === 'quote', run: () => { prefs.punctuation = !prefs.punctuation; applyPreferences(); saveProfile(); resetSession('practice', { focus: true }); } },
    ...wordListIds.map((id) => ({ group: 'test', label: `word list · top ${id}`, keywords: 'common words vocabulary 1000 5000 10000 harder', hint: prefs.wordList === id ? 'current' : '', on: prefs.wordList === id, disabled: prefs.mode === 'quote', run: () => { navigate('practice'); setWordList(id); } })),
    { group: 'test', label: 'stop on error', keywords: 'mistakes correction continue', hint: onOff(prefs.stopOnError), on: prefs.stopOnError, run: () => setStopOnError(!prefs.stopOnError) },
    ...['dark', 'light', 'system'].map((theme) => ({ group: 'display', label: `theme · ${theme}`, keywords: 'colour color mode appearance', hint: prefs.theme === theme ? 'current' : '', on: prefs.theme === theme, run: () => { prefs.theme = theme; applyTheme(); saveProfile(); } })),
    ...[['22', 'small'], ['28', 'medium'], ['36', 'large']].map(([size, name]) => ({ group: 'display', label: `text size · ${name}`, keywords: 'font passage bigger smaller', hint: prefs.fontSize === size ? 'current' : '', on: prefs.fontSize === size, run: () => { prefs.fontSize = size; applyPreferences(); saveProfile(); } })),
    { group: 'display', label: 'live metrics', keywords: 'wpm accuracy while typing', hint: onOff(prefs.liveMetrics), on: prefs.liveMetrics, run: () => togglePreference('liveMetrics') },
    { group: 'display', label: 'keyboard', keywords: 'keys layout', hint: onOff(prefs.keyboard), on: prefs.keyboard, run: () => togglePreference('keyboard') },
    { group: 'display', label: 'focus mode', keywords: 'zen hide distraction', hint: onOff(prefs.focusMode), on: prefs.focusMode, run: () => { navigate('practice'); togglePreference('focusMode'); } },
    { group: 'local data', label: 'clear local history…', keywords: 'delete reset erase', disabled: profile.attempts.length === 0 && profile.loops.length === 0, run: () => { navigate('progress'); $('clear-history').click(); } },
  ];
  // Only an exact word finds this one.
  if (query === 'ghost') commands.unshift({ group: 'secret', secret: true, label: 'ghost pacer', hint: onOff(ghostOn), on: ghostOn, run: toggleGhost });
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
      markInterrupted(NOTICES.paletteOpened);
      markRaceInterrupted();
    },
  });
}

// ↑ ↑ ↓ ↓ ← → ← → b a, or "ghost" in the palette: a pacer caret at your best pace for these conditions.
function toggleGhost() {
  ghostOn = !ghostOn;
  document.body.dataset.ghost = ghostOn ? 'on' : 'off';
  const pace = ghostPace();
  const message = ghostOn ? `Ghost pacer · ${pace.wpm} wpm${pace.fromBest ? ' (your best)' : ''}` : 'Ghost off';
  $('egg-feedback').textContent = message;
  $('egg-toast').hidden = false;
  $('egg-toast').classList.toggle('is-solo', $('history-toast').hidden);
  clearTimeout(toggleGhost.timer);
  toggleGhost.timer = setTimeout(() => { $('egg-toast').hidden = true; }, 3000);
  announce(message);
  if (document.body.dataset.view === 'practice' && sessionKind !== 'retest') resetSession(sessionKind, { focus: true });
  else primaryFx.ghost.arm(ghostOn ? pace.cps : 0);
}

listenForSequence(toggleGhost);

let resizeFrame = 0;
addEventListener('resize', () => {
  primaryFx.relayout();
  raceFx.relayout();
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => updateGlides({ instant: true }));
});
const isMac = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform || '');
document.querySelectorAll('.mod-key').forEach((key) => { key.textContent = isMac ? '⌘' : 'ctrl'; });
buildKeyboard();
applyPreferences();
setModeControls();
bindEvents();
bindPalette();
setRunning(false);
renderHistory();
resetSession('practice', { focus: matchMedia('(hover: hover) and (pointer: fine)').matches });
updateGlides({ instant: true });
// Literata arrives after first paint; remeasure everything that depends on glyph widths.
document.fonts?.ready.then(() => { primaryFx.relayout(); updateGlides({ instant: true }); });
console.info('stilltype · ↑ ↑ ↓ ↓ ← → ← → b a');

if (!storageAvailable) announce('Storage is unavailable. Results last only in this tab.');

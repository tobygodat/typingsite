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
  textId,
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
import { MAX_MISSED_WORDS, dailyPassage, filterRuns, missedAndSlowWords, practiceWordsPassage, recurringMissedWords, recurringTargets, retainRuns, runRecord, trendRun, validRun, weeklyChange } from './insights.js';
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
const primaryFx = createTypingFx($('typing-wrap'), $('text-display'), { ensureCharacters: (index) => primaryTextView?.ensureForward(index) });
const raceFx = createTypingFx(document.querySelector('.race-typing-wrap'), $('race-text-display'), { ensureCharacters: (index) => race.textView?.ensureForward(index) });
const prefersLight = matchMedia('(prefers-color-scheme: light)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let lastCompleted = null;
let wordsPassage = null;
let ghostOn = false;
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
  if (run.kind === 'daily') return `daily · ${run.challengeDate} · ${run.firstDailyAttempt ? 'first attempt' : 'repeat attempt'}${run.firstDailyAttempt && !run.fresh ? ' · previously displayed passage' : ''} · ${describeConditions(run.conditions)}`;
  if (run.kind === 'missed') return `missed words · not counted · ${run.text?.split(' ').length || 40} words${run.conditions.punctuation ? ' · punctuation' : ''} · ${run.conditions.inputClass === 'touch' ? 'touch input' : 'physical keyboard'} · ${run.conditions.correctionPolicy === 'relaxed' ? 'continue on error' : 'stop on error'}`;
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

// Daily and missed-word passages run to the end of their text, whatever the practice shape is.
function sessionDurationMs() {
  if (sessionKind === 'daily' || sessionKind === 'missed') return null;
  if (sessionKind === 'drill') return 60000;
  if (prefs.mode === 'time') return prefs.duration * 1000;
  return null;
}

function configureSessionCopy() {
  const copy = {
    practice: ['practice', 'Practice', ''],
    drill: ['drill · 1 min', selectedTarget ? `Practice “${selectedTarget}”` : 'General drill', 'Doesn’t count toward your best.'],
    retest: ['fresh-text retest', 'Measure the change', passage?.fresh === false ? 'You’ve seen every matching quote, so this can’t be a fresh comparison.' : 'Fresh text, same conditions.'],
    missed: ['missed words', wordsPassage?.recurring ? 'Practice words you keep missing' : 'Practice missed and slowest words', 'Doesn’t count toward your best.'],
    daily: ['daily challenge', 'Today’s passage', `${passage?.day} · resets at midnight UTC · ${passage?.firstDailyAttempt ? 'first attempt' : 'repeat attempt'}${passage?.firstDailyAttempt && !passage?.fresh ? ' · previously displayed passage' : ''}`],
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
  // Word practice whose words were cleared with history falls back to a normal test.
  sessionKind = kind === 'missed' && !wordsPassage ? 'practice' : kind;
  kind = sessionKind;
  passage = selectedPassage || (kind === 'missed' ? wordsPassage : kind === 'daily' ? todayPassage() : kind === 'drill' ? makeDrill(selectedTarget, prefs.wordList) : choosePassage(kind === 'retest' && baselineAttempt ? [baselineAttempt.textId] : []));
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
  if (!['drill', 'missed'].includes(kind) && passage.id && !profile.seenTextIds.includes(passage.id)) {
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
    conditions: kind === 'daily' ? dailyConditions() : kind === 'missed' ? { ...conditions(), mode: 'missed', duration: null, count: null, punctuation: /[^\p{Ll}\p{N} ]/u.test(passage.text), quoteLength: null, difficulty: null, wordList: null } : conditions(),
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
  completed.at = new Date().toISOString();
  const key = conditionKey(completed.conditions);
  const score = completed.summary.score;
  const eligibleBest = completed.status === 'complete' && !completed.interrupted && ['test', 'retest'].includes(completed.kind);
  resultBestBefore = profile.bests[key] || null;
  profile.attempts.push(completed);
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
  renderSpeedGraph($('speed-graph'), completed, { animate: true });
  renderPracticeWords(completed);
}

// Offer the words this run tripped on or was slowest through as their own uncounted run. The
// slowest are one timing each, so they show their speed beside the run's median, not a weakness.
function renderPracticeWords(completed) {
  const { missed, slow, timedCount, medianWpm } = completed.status === 'complete' ? missedAndSlowWords(completed) : { missed: [], slow: [] };
  const words = [...missed, ...slow.map((item) => item.word)];
  const button = $('practice-words');
  const evidence = $('practice-words-evidence');
  button.hidden = evidence.hidden = !words.length;
  if (!words.length) return;
  evidence.textContent = [
    missed.length ? `missed first try: ${missed.map(wordCopy).join(', ')}` : '',
    slow.length ? `slowest in this run: ${slow.map((item) => `${item.word} ${item.wpm} wpm`).join(', ')} · median ${medianWpm} wpm over ${timedCount} clean words` : '',
  ].filter(Boolean).join('\n');
  button.textContent = words.length === 1 ? 'Practice this word' : `Practice these ${words.length} words`;
  button.onclick = () => startWordPractice(words);
}

// Quote a token that carries punctuation, so "table," reads as the word typed.
function wordCopy(word) {
  return /[^\p{L}\p{N}]/u.test(word) ? `“${word}”` : word;
}

// An uncounted `missed` run of these words. It is not a drill, so a drill's context from earlier
// doesn't carry over into the next retest's record.
function startWordPractice(words, { recurring = false } = {}) {
  const text = practiceWordsPassage(words);
  wordsPassage = { id: `missed-${textId(text)}`, text, fresh: false, words, recurring };
  trainingContext = null;
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

function resultHeadline(completed) {
  if (completed.status !== 'complete') return 'Interrupted · not counted';
  if (completed.kind === 'drill') return 'Drill complete · not counted toward your best';
  if (completed.kind === 'missed') return 'Word practice complete · not counted toward your best';
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

  if (sessionKind === 'practice' || sessionKind === 'daily') {
    activeRecommendation = trainingRecommendation(completed.conditions);
    selectedTarget = activeRecommendation.target;
  }
  $('recommendation-title').textContent = counted ? activeRecommendation.title : 'Restart for a counted run';
  $('recommendation-evidence').textContent = counted ? activeRecommendation.reason : 'This run lost focus or used unsupported input.';
  $('recommendation-meta').textContent = baselineAttempt
    ? `About 1 min, then a fresh ${retestLength(baselineAttempt.conditions)} retest.`
    : 'A standalone drill. Finish a practice run to establish a fresh-text retest baseline.';
  $('start-drill').disabled = !counted;
  $('skip-to-retest').disabled = !counted || !baselineAttempt;
  renderEvidenceList(activeRecommendation.evidence);
  $('run-again').textContent = sessionKind === 'daily' ? 'Try daily again' : 'Run again';
  renderTraining();
  renderDaily();
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
// Older corpus versions need a new baseline.
function retainedBaseline(source = null) {
  return [...profile.attempts].reverse().find((a) => a.status === 'complete' && !a.interrupted
    && ['test', 'retest', 'daily'].includes(a.kind) && a.fresh !== false
    && (!source || conditionKey(a.conditions) === conditionKey(source)) && (source || a.conditions).corpus === CORPUS_VERSION) || null;
}

function practiceTarget(target, source) {
  // Use a retained, compatible baseline when possible.
  baselineAttempt = retainedBaseline(source);
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
  renderMissedWords();
}

// Words missed on the first try in two or more recent counted runs, with what was counted.
function renderMissedWords() {
  const { runs, inputClass, recurring, words } = recurringMissedWords(profile.runs);
  const enough = words.length >= 2;
  const input = inputClass === 'touch' ? 'touch input' : 'a physical keyboard';
  $('missed-words-note').textContent = enough
    ? `First-try misses in your last ${runs} complete tests, retests and new daily passages on ${input}, all other test conditions together, up to ${MAX_MISSED_WORDS} words a run. Word practice and drills aren’t counted.`
    : runs < 2
      ? `Not enough evidence yet: ${runs ? `one run on ${input}` : 'no runs'} counted so far. A word shows here once you miss it on the first try in two complete tests, retests or new daily passages.`
      : `Not enough evidence yet: ${recurring ? `only ${wordCopy(words[0].word)} was missed on the first try in more than one of your last ${runs} runs on ${input} (in ${words[0].runs})` : `no word was missed on the first try in more than one of your last ${runs} runs on ${input}`}. The list starts at two such words.`;
  $('missed-words-list').replaceChildren(...(enough ? words : []).map((item) => {
    const row = element('li', '', 'missed-word');
    row.append(element('span', wordCopy(item.word), 'missed-word-text'), element('span', `missed in ${item.runs} of the last ${runs} runs`, 'num'));
    return row;
  }));
  $('missed-words-list').hidden = !enough;
  $('practice-missed-list').hidden = !enough;
  $('practice-missed-list').textContent = `Practice these ${words.length} words`;
  // The run card can offer "Practice these N words" too, so the name says which words these are.
  $('practice-missed-list').setAttribute('aria-label', `Practice these ${words.length} words you keep missing`);
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
  return { ...conditions(), mode: 'quote', duration: null, count: null, punctuation: true,
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
  // The practised words came from the cleared runs, so Run again starts a normal test.
  wordsPassage = null;
  for (const id of ['result-wpm', 'result-accuracy', 'result-errors', 'result-time']) $(id).textContent = '—';
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
  $('run-again').addEventListener('click', () => sessionKind === 'daily' ? startDaily() : resetSession(sessionKind === 'missed' ? 'missed' : 'practice', { focus: true }));
  $('progress-conditions').addEventListener('change', renderHistory);
  $('progress-period').addEventListener('change', renderHistory);
  $('training-conditions').addEventListener('change', renderTraining);
  $('practice-missed-list').addEventListener('click', practiseRecurringWords);
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
  const missedWords = recurringMissedWords(profile.runs).words.length;
  const shape = (mode, length) => prefs.mode === mode && (mode === 'quote' || (mode === 'time' ? prefs.duration : prefs.count) === length);
  const commands = [
    ...[['practice', 'practice'], ['results', 'train'], ['progress', 'progress'], ['compete', 'challenge']].map(([view, label]) => ({
      group: 'go to', label, keywords: `${view} open view page`, hint: document.body.dataset.view === view ? 'here' : '', on: document.body.dataset.view === view, run: () => navigate(view),
    })),
    { group: 'test', label: 'restart test', keywords: 'reset again new passage', hint: 'esc', run: () => { navigate('practice'); resetSession(sessionKind, { focus: true }); } },
    { group: 'test', label: 'daily challenge', keywords: 'today shared passage daily quote', run: startDaily },
    { group: 'test', label: 'practice words you keep missing', keywords: 'missed words mistakes errors practise recurring list', hint: `${missedWords} words`, disabled: missedWords < 2, run: practiseRecurringWords },
    ...[15, 30, 60, 120].map((length) => ({ group: 'test', label: `time · ${length} seconds`, keywords: `timed ${length}s`, hint: shape('time', length) ? 'current' : '', on: shape('time', length), run: () => setTestShape('time', length) })),
    ...[10, 25, 50, 100].map((length) => ({ group: 'test', label: `words · ${length} words`, keywords: `count ${length}`, hint: shape('words', length) ? 'current' : '', on: shape('words', length), run: () => setTestShape('words', length) })),
    { group: 'test', label: 'quote', keywords: 'passage original text', hint: shape('quote') ? 'current' : '', on: shape('quote'), run: () => setTestShape('quote') },
    { group: 'test', label: 'punctuation', keywords: 'capitals commas periods', hint: onOff(prefs.punctuation), on: prefs.punctuation, disabled: prefs.mode === 'quote', run: () => { prefs.punctuation = !prefs.punctuation; applyPreferences(); saveProfile(); resetSession('practice', { focus: true }); } },
    ...wordListIds.map((id) => ({ group: 'test', label: `word list · top ${id}`, keywords: 'common words vocabulary 200 1000 5000 10000 monkeytype easier harder', hint: prefs.wordList === id ? 'current' : '', on: prefs.wordList === id, disabled: prefs.mode === 'quote', run: () => { navigate('practice'); setWordList(id); } })),
    { group: 'test', label: 'stop on error', keywords: 'mistakes correction continue', hint: onOff(prefs.stopOnError), on: prefs.stopOnError, run: () => setStopOnError(!prefs.stopOnError) },
    ...['dark', 'light', 'system'].map((theme) => ({ group: 'display', label: `theme · ${theme}`, keywords: 'colour color mode appearance', hint: prefs.theme === theme ? 'current' : '', on: prefs.theme === theme, run: () => { prefs.theme = theme; applyTheme(); saveProfile(); } })),
    ...[['22', 'small'], ['28', 'medium'], ['36', 'large']].map(([size, name]) => ({ group: 'display', label: `text size · ${name}`, keywords: 'font passage bigger smaller', hint: prefs.fontSize === size ? 'current' : '', on: prefs.fontSize === size, run: () => { prefs.fontSize = size; applyPreferences(); saveProfile(); } })),
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
      closeAccountMenu();
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

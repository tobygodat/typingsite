import {
  CORPUS_VERSION,
  METRIC_VERSION,
  compareAttempts,
  completeAttempt,
  conditionKey,
  createAttempt,
  makeDrill,
  normalizeManualTarget,
  recommendTarget,
  replayAttempt,
  selectPassage,
  summarizePatterns,
} from './typing.js';

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
  fontSize: '28',
  liveMetrics: true,
  keyboard: false,
  focusMode: false,
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

function loadProfile() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed?.version !== 2) return emptyProfile();
    return {
      ...emptyProfile(),
      ...parsed,
      preferences: { ...defaultPreferences, ...parsed.preferences },
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
let baselineAttempt = null;
let activeRecommendation = null;
let selectedTarget = null;
let trainingContext = null;
let resultBestBefore = null;
let clearSnapshot = null;
let clearTimer = null;

let race = {
  passage: null,
  names: [],
  player: 0,
  attempt: null,
  startTime: null,
  results: [],
  characters: [],
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
    inputClass,
    correctionPolicy: 'mandatory',
    language: 'en',
    corpus: CORPUS_VERSION,
    metricVersion: METRIC_VERSION,
  };
}

function describeConditions(value = conditions()) {
  const length = value.mode === 'time' ? `${value.duration} s` : value.mode === 'words' ? `${value.count} words` : `${value.quoteLength || 'any'} quote`;
  const punctuation = value.mode === 'quote' ? value.difficulty || 'any difficulty' : value.punctuation ? 'punctuation' : 'plain';
  const input = value.inputClass === 'touch' ? 'touch input' : 'physical keyboard';
  return `english · ${length} · ${punctuation} · ${input} · corpus v3 · metric v1`;
}

function currentBestKey() {
  return conditionKey(conditions());
}

function showBest() {
  const best = profile.bests[currentBestKey()];
  $('best').textContent = best ? `Best · ${best.wpm} wpm` : 'No best for these conditions';
}

function applyPreferences() {
  document.body.dataset.fontSize = prefs.fontSize;
  document.body.dataset.liveMetrics = String(prefs.liveMetrics);
  document.body.dataset.keyboard = String(prefs.keyboard);
  document.body.dataset.focusMode = String(prefs.focusMode);
  $('font-size').value = prefs.fontSize;
  $('live-toggle').checked = prefs.liveMetrics;
  $('keyboard-toggle').checked = prefs.keyboard;
  $('focus-toggle').checked = prefs.focusMode;
  $('keyboard').hidden = !prefs.keyboard;
  $('punctuation-toggle').checked = prefs.punctuation;
  $('quote-length').value = prefs.quoteLength;
  $('quote-difficulty').value = prefs.difficulty;
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
  $('duration-options').hidden = prefs.mode === 'quote';
  const values = prefs.mode === 'time' ? [15, 30, 60, 120] : [10, 25, 50, 100];
  $('duration-options').replaceChildren(...values.map((value) => {
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
}

function renderText(display, text) {
  const fragment = document.createDocumentFragment();
  const characters = [];
  text.split(' ').forEach((word, wordIndex, words) => {
    const group = document.createElement('span');
    group.className = 'word';
    for (const letter of word) {
      const span = document.createElement('span');
      span.className = 'char';
      span.textContent = letter;
      group.append(span);
      characters.push(span);
    }
    fragment.append(group);
    if (wordIndex < words.length - 1) {
      const space = document.createElement('span');
      space.className = 'char';
      space.textContent = ' ';
      fragment.append(space);
      characters.push(space);
    }
  });
  display.replaceChildren(fragment);
  characters[0]?.classList.add('current');
  display.style.transform = '';
  return characters;
}

function updateCharacterStates(characters, typed, target, start = 0) {
  const from = Math.max(0, start - 1);
  const to = Math.min(characters.length, Math.max(typed.length + 2, start + 2));
  for (let index = from; index < to; index += 1) {
    const character = characters[index];
    character.className = 'char';
    if (index < typed.length) character.classList.add(typed[index] === target[index] ? 'correct' : 'wrong');
    else if (index === typed.length) character.classList.add('current');
  }
}

function keepCurrentLineVisible(display, characters, position) {
  const current = characters[position];
  if (!current) return;
  const lineHeight = parseFloat(getComputedStyle(display).lineHeight) || 48;
  const line = Math.floor(current.offsetTop / lineHeight);
  display.style.transform = `translateY(-${Math.max(0, line - 1) * lineHeight}px)`;
}

function choosePassage(extraSeen = []) {
  return selectPassage({
    mode: prefs.mode,
    count: prefs.count,
    punctuation: prefs.punctuation,
    quoteLength: prefs.quoteLength,
    difficulty: prefs.difficulty,
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
    practice: ['Open practice', 'Practice', 'Settle into a steady pace. Your next useful exercise comes from what happens here.'],
    drill: ['Targeted drill', selectedTarget ? `Practice “${selectedTarget}”` : 'General fluency drill', 'Keep the rhythm calm. This minute is practice, so it stays out of your personal best.'],
    retest: ['Fresh-text retest', 'Measure the change', passage?.fresh === false ? 'The matching corpus is exhausted. You can type this passage, but it will not support a fresh-text comparison.' : 'Same conditions, unfamiliar text. This is one observed comparison, not a promise of lasting improvement.'],
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
  sessionKind = kind;
  passage = selectedPassage || (kind === 'drill' ? makeDrill(selectedTarget) : choosePassage(kind === 'retest' && baselineAttempt ? [baselineAttempt.textId] : []));
  if (kind === 'retest' && passage?.fresh === false) {
    showUnavailableRetest('You have seen every matching quote. Choose another quote filter or a word test and complete a new baseline.');
    return false;
  }
  if (!passage) {
    if (kind === 'retest') showUnavailableRetest('No passage matches the original conditions. Change the quote filters and run a new baseline.');
    else {
      attempt = null;
      startTime = null;
      $('typing-input').value = '';
      $('typing-input').disabled = true;
      $('text-display').style.transform = '';
      $('text-display').textContent = 'No passage matches these filters.';
      $('accessible-passage').textContent = 'No passage matches these filters.';
      $('typing-status').textContent = 'No matching text';
      $('typing-status').className = 'badge badge-warning';
      $('condition-line').textContent = describeConditions();
      $('input-help').textContent = 'Choose another quote length or difficulty to continue.';
      for (const id of ['live-wpm', 'live-accuracy', 'timer']) $(id).textContent = '—';
      $('progress-bar').style.width = '0%';
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
  primaryCharacters = renderText($('text-display'), passage.text);
  $('typing-status').className = 'badge badge-info';
  $('typing-status').innerHTML = '<span class="status-dot" aria-hidden="true"></span>Ready';
  $('input-help').textContent = 'Start typing to begin';
  $('condition-line').textContent = describeConditions(attempt.conditions);
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
  $('comparison-status').textContent = 'A comparable retest is unavailable.';
  $('comparison-accuracy').textContent = '—';
  $('comparison-timing').textContent = '—';
  $('comparison-wpm').textContent = '—';
  $('comparison-sample').textContent = 'No matching fresh text';
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
  const unresolved = replay.typed.length > 0 && replay.typed.at(-1) !== targetAttempt.text[replay.typed.length - 1];
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
    const help = type === 'primary' ? $('input-help') : $('race-help');
    help.textContent = 'Paste and drop are disabled. Type the passage with the keyboard.';
    announce('Paste is disabled for typing practice.');
    return;
  }
  if (event.inputType?.includes('Composition') || event.isComposing) {
    event.preventDefault();
    targetAttempt.unsupportedInput = true;
    targetAttempt.interrupted = true;
    targetAttempt.events.push({ type: 'composition', offsetMs: offsetFor(type) });
    const help = type === 'primary' ? $('input-help') : $('race-help');
    help.textContent = 'Composition input is not scored in this English physical-keyboard mode. Restart and use direct key input.';
    announce(help.textContent);
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
    const help = type === 'primary' ? $('input-help') : $('race-help');
    help.textContent = 'Multi-character input is not scored. Restart and type one key at a time.';
    announce(help.textContent);
    return;
  }
  const change = pushInsert(event.data, type);
  refreshAfterInput(type, change.previousLength, change.blocked);
}

function refreshAfterInput(type, previousLength, blocked = false) {
  const isPrimary = type === 'primary';
  const targetAttempt = isPrimary ? attempt : race.attempt;
  const replay = replayAttempt(targetAttempt);
  const input = isPrimary ? $('typing-input') : $('race-input');
  const display = isPrimary ? $('text-display') : $('race-text-display');
  const characters = isPrimary ? primaryCharacters : race.characters;
  input.value = replay.typed;
  input.setSelectionRange(replay.typed.length, replay.typed.length);
  updateCharacterStates(characters, replay.typed, targetAttempt.text, previousLength);
  keepCurrentLineVisible(display, characters, replay.typed.length);
  if (isPrimary) {
    if (blocked) $('input-help').textContent = 'Correct the underlined character before moving on.';
    else $('input-help').textContent = 'Backspace corrects · Escape restarts';
    updateLive();
    if ((sessionDurationMs() === null || sessionKind === 'drill') && replay.typed === targetAttempt.text) finishPrimary();
  } else {
    updateRaceProgress(replay);
    if (replay.typed === targetAttempt.text) finishRacePlayer();
  }
}

function updateLive(reset = false) {
  if (!attempt) return;
  const replay = replayAttempt(attempt);
  const elapsed = startTime === null ? 0 : now() - startTime;
  const duration = sessionDurationMs();
  const boundedElapsed = duration ? Math.min(elapsed, duration) : elapsed;
  const live = { ...replay, score: replayAttempt({ ...attempt, endedAt: boundedElapsed }).score };
  $('live-wpm').textContent = startTime === null ? '—' : live.score.wpm;
  $('live-accuracy').textContent = startTime === null ? '—' : live.score.accuracy;
  let progress;
  if (duration) {
    const remaining = Math.max(0, Math.ceil((duration - boundedElapsed) / 1000));
    $('timer').textContent = remaining;
    $('timer-unit').textContent = 's';
    $('timer-label').textContent = 'remaining';
    progress = boundedElapsed / duration;
  } else {
    const wordTotal = attempt.text.split(' ').length;
    const wordCount = replay.typed.length === attempt.text.length ? wordTotal : (replay.typed.match(/ /g) || []).length;
    $('timer').textContent = wordCount;
    $('timer-unit').textContent = `/${wordTotal}`;
    $('timer-label').textContent = 'words';
    progress = replay.typed.length / attempt.text.length;
  }
  const percent = Math.max(0, Math.min(100, progress * 100));
  $('progress-bar').style.width = `${percent}%`;
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
  $('typing-status').className = `badge ${valid ? 'badge-success' : 'badge-warning'}`;
  $('typing-status').textContent = valid ? 'Complete' : 'Interrupted';
  const saved = storeAttempt(completed);

  if (sessionKind === 'drill' && baselineAttempt) {
    if (trainingContext) trainingContext.drillCompleted = valid;
    announce(valid ? 'Drill complete. Fresh retest ready.' : 'Drill ended with an interruption. The fresh retest is still available.');
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
  $('run-again').focus({ preventScroll: true });
}

function renderResults(completed, saved) {
  activeRecommendation ||= recommendTarget([], completed.conditions);
  const replay = completed.summary;
  const firstErrors = replay.firstAttempts.filter((item) => !item.correct).length;
  $('result-wpm').textContent = replay.score.wpm;
  $('result-accuracy').textContent = replay.score.accuracy;
  $('result-errors').textContent = firstErrors;
  $('result-time').textContent = `${(replay.elapsedMs / 1000).toFixed(1)} s`;
  $('result-conditions').textContent = describeConditions(completed.conditions);
  $('result-comparison-note').textContent = completed.status === 'complete'
    ? `${replay.correctInsertions} correct insertions from ${replay.insertions} total.`
    : 'Focus or input method interrupted this run, so it is kept out of comparison.';
  $('result-delta').textContent = completed.status !== 'complete'
    ? 'Interrupted · kept out of your best'
    : completed.kind === 'drill'
      ? 'Drill · kept out of your best'
    : resultBestBefore
      ? `${replay.score.wpm >= resultBestBefore.wpm ? '+' : ''}${replay.score.wpm - resultBestBefore.wpm} vs previous best ${resultBestBefore.wpm}`
      : 'First completed run for these conditions';

  if (sessionKind === 'practice') {
    activeRecommendation = recommendTarget(profile.attempts, completed.conditions);
    selectedTarget = activeRecommendation.target;
  }
  $('recommendation-title').textContent = completed.status === 'complete' ? activeRecommendation.title : 'Restart for a comparable baseline';
  $('recommendation-evidence').textContent = completed.status === 'complete'
    ? activeRecommendation.reason
    : 'This run lost focus or used unsupported input. It is stored as interrupted and cannot support a personal recommendation.';
  $('recommendation-meta').textContent = `About 1 min, then a fresh ${prefs.mode === 'time' ? `${prefs.duration} s` : prefs.mode === 'words' ? `${prefs.count}-word` : prefs.quoteLength} passage.`;
  const confidence = $('recommendation-confidence');
  confidence.className = `badge ${activeRecommendation.kind === 'targeted' ? 'badge-info' : 'badge-neutral'}`;
  confidence.textContent = completed.status !== 'complete'
    ? 'Interrupted'
    : activeRecommendation.kind === 'targeted'
      ? 'Enough local evidence'
      : activeRecommendation.kind === 'manual' ? 'Manual target' : 'More data needed';
  $('start-drill').disabled = completed.status !== 'complete';
  $('skip-to-retest').disabled = completed.status !== 'complete' || !baselineAttempt;
  renderEvidenceList(activeRecommendation.evidence);
  $('comparison-panel').hidden = true;
  if (!saved) {
    $('result-delta').textContent += ' · could not save on this device';
    announce('Run complete, but local storage is unavailable. This result was not saved.');
  } else announce(`${replay.score.wpm} corrected words per minute, ${replay.score.accuracy} percent input accuracy.`);
}

function renderEvidenceList(evidence) {
  const strongest = [...evidence.pairs]
    .filter((item) => item.errors > 0 || (item.timings.length >= 10 && item.slowdownMs > 0))
    .sort((a, b) => b.errors - a.errors || (b.slowdownMs || 0) - (a.slowdownMs || 0))
    .slice(0, 2);
  $('recommendation-list').replaceChildren(...strongest.map((item) => {
    const row = document.createElement('div');
    row.className = 'evidence-row';
    const timing = item.medianMs === null ? 'timing needs more samples' : `${item.medianMs} ms median · ${item.timings.length} clean intervals`;
    row.innerHTML = `<strong>${item.pair}</strong><span>${item.errors}/${item.observations} first-attempt errors · ${timing}</span>`;
    return row;
  }));
}

function renderComparison(before, after, saved) {
  const comparison = compareAttempts(before, after);
  const panel = $('comparison-panel');
  panel.hidden = false;
  const outcome = comparison.comparable ? comparison.state : 'unavailable';
  panel.dataset.outcome = outcome;
  $('comparison-status').textContent = comparison.comparable
    ? comparison.state === 'improved' ? 'This fresh retest was stronger.'
      : comparison.state === 'mixed' ? 'Speed and accuracy moved in different directions.'
        : comparison.state === 'regressed' ? 'This retest was lower.' : 'This retest held steady.'
    : 'These runs cannot support a fair comparison.';
  $('comparison-accuracy').textContent = comparison.comparable ? `${comparison.accuracyDelta >= 0 ? '+' : ''}${comparison.accuracyDelta} percentage points` : '—';
  $('comparison-wpm').textContent = comparison.comparable ? `${comparison.wpmDelta >= 0 ? '+' : ''}${comparison.wpmDelta} wpm` : '—';

  const trainedTarget = trainingContext?.target || selectedTarget;
  const beforePattern = before ? summarizePatterns([before]).pairs.find((item) => item.pair === trainedTarget) : null;
  const afterPattern = summarizePatterns([after]).pairs.find((item) => item.pair === trainedTarget);
  const enoughTiming = beforePattern?.timings.length >= 10 && afterPattern?.timings.length >= 10;
  let timingSummary = { target: trainedTarget, beforeCount: beforePattern?.timings.length || 0, afterCount: afterPattern?.timings.length || 0, deltaMs: null };
  if (enoughTiming) {
    const delta = afterPattern.medianMs - beforePattern.medianMs;
    timingSummary.deltaMs = delta;
    $('comparison-timing').textContent = `${delta >= 0 ? '+' : ''}${delta} ms`;
    $('comparison-sample').textContent = `${trainedTarget} intervals · ${beforePattern.timings.length} before · ${afterPattern.timings.length} after`;
  } else {
    $('comparison-timing').textContent = 'More data needed';
    $('comparison-sample').textContent = trainedTarget
      ? `${trainedTarget} intervals · ${timingSummary.beforeCount} before · ${timingSummary.afterCount} after · too few to call`
      : `Insertions · ${before?.summary?.insertions || 0} before · ${after.summary.insertions} after`;
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
  $('comparison-caveat').textContent = `${comparison.reason}${comparisonSaved ? ' Saved to local progress.' : ' Local storage is unavailable, so this comparison was not saved.'}`;
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
  if (view === 'progress') renderHistory();
}

function navigate(view) {
  if (view === 'practice') {
    if (!attempt || sessionKind !== 'practice' || ['complete', 'interrupted'].includes(attempt.status)) resetSession('practice');
    switchView('practice');
    return;
  }
  if (attempt?.status === 'running' && view !== 'practice') {
    markInterrupted('You left the typing surface. This run is stored as interrupted.');
    finishPrimary();
  }
  if (race.attempt?.status === 'running' && view !== 'compete') markInterrupted('The local challenge lost focus. Restart this player for a fair result.');
  switchView(view);
}

function markInterrupted(message) {
  if (attempt?.status === 'running' && !attempt.interrupted) {
    attempt.interrupted = true;
    attempt.events.push({ type: 'focus-lost', offsetMs: offsetFor() });
    $('typing-status').className = 'badge badge-warning';
    $('typing-status').textContent = 'Interrupted';
    $('input-help').textContent = message;
    announce(message);
  }
  if (race.attempt?.status === 'running' && !race.attempt.interrupted) {
    race.attempt.interrupted = true;
    race.attempt.events.push({ type: 'focus-lost', offsetMs: offsetFor('race') });
    $('race-help').textContent = 'Focus changed. Restart this player for a fair local result.';
  }
}

function renderHistory() {
  const loops = [...profile.loops].reverse();
  $('progress-empty').hidden = loops.length > 0;
  $('history-list').hidden = loops.length === 0;
  $('clear-history').disabled = profile.attempts.length === 0 && loops.length === 0;
  const template = $('history-row-template');
  const rows = loops.map((loop) => {
    const row = template.content.firstElementChild.cloneNode(true);
    row.querySelector('.history-date').textContent = new Date(loop.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    row.querySelector('.history-target').textContent = loop.drillCompleted
      ? loop.target ? `“${loop.target}” drill and retest` : 'General fluency drill and retest'
      : 'Fresh-text check';
    row.querySelector('.history-conditions').textContent = describeConditions(loop.conditions);
    if (loop.targetTiming?.target) {
      row.querySelector('.history-conditions').textContent += ` · ${loop.targetTiming.target}: ${loop.targetTiming.beforeCount} clean intervals before, ${loop.targetTiming.afterCount} after`;
    }
    row.querySelector('.history-accuracy').textContent = `${loop.comparison.accuracyDelta >= 0 ? '+' : ''}${loop.comparison.accuracyDelta} pp`;
    const measures = row.querySelectorAll('.history-measure span');
    if (measures[1]) measures[1].textContent = 'Corrected wpm';
    row.querySelector('.history-timing').textContent = `${loop.comparison.wpmDelta >= 0 ? '+' : ''}${loop.comparison.wpmDelta} wpm`;
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
    names: [$('player-one-name').value.trim() || 'Player one', $('player-two-name').value.trim() || 'Player two'],
    player: 0,
    attempt: null,
    startTime: null,
    results: [],
    characters: [],
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
  race.attempt = createAttempt({ id: uid(), text: race.passage.text, textId: race.passage.id, kind: 'race', conditions: { ...conditions(), mode: 'quote', localRace: true } });
  race.startTime = null;
  $('race-stage').hidden = false;
  $('race-player').textContent = race.names[race.player];
  $('race-status').textContent = `Player ${race.player + 1} of 2 · local`;
  $('race-input').value = '';
  $('race-input').disabled = false;
  race.characters = renderText($('race-text-display'), race.passage.text);
  $('race-accessible-passage').textContent = race.passage.text;
  updateRaceProgress(replayAttempt(race.attempt));
  $('race-help').textContent = 'Start typing when you are ready. Escape restarts your attempt.';
  $('race-input').focus({ preventScroll: true });
}

function updateRaceProgress(replay) {
  const percent = Math.round((replay.typed.length / race.attempt.text.length) * 100);
  $('race-progress').firstElementChild.style.width = `${percent}%`;
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
    : tied ? 'This local challenge is a tie.' : `${ordered[0].name} leads this local challenge.`;
  const ranked = [...race.results].sort((a, b) => {
    if (a.attempt.status !== b.attempt.status) return a.attempt.status === 'complete' ? -1 : 1;
    return b.attempt.summary.score.wpm - a.attempt.summary.score.wpm || b.attempt.summary.score.accuracy - a.attempt.summary.score.accuracy;
  });
  $('race-results').replaceChildren(...ranked.map((result, index) => {
    const row = document.createElement('article');
    const score = result.attempt.summary.score;
    row.className = 'race-result-row';
    const name = document.createElement('strong');
    name.textContent = `${index + 1}. ${result.name}`;
    const speed = document.createElement('span');
    speed.className = 'num';
    speed.textContent = result.attempt.status === 'complete' ? `${score.wpm} wpm` : 'interrupted';
    const accuracy = document.createElement('span');
    accuracy.className = 'num';
    accuracy.textContent = `${score.accuracy}% accuracy`;
    const elapsed = document.createElement('span');
    elapsed.textContent = `${(result.attempt.summary.elapsedMs / 1000).toFixed(1)} s · local only`;
    row.append(name, speed, accuracy, elapsed);
    return row;
  }));
  announce('Local challenge complete.');
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
  $('result-delta').textContent = 'Complete a run to build a new baseline.';
  $('result-comparison-note').textContent = 'No saved run selected.';
  $('recommendation-title').textContent = 'Choose a target or start a new run.';
  $('recommendation-evidence').textContent = 'Your local history was cleared. Manual practice is always available.';
  $('recommendation-confidence').textContent = 'No saved evidence';
  $('recommendation-list').replaceChildren();
  $('comparison-panel').hidden = true;
  $('start-drill').disabled = true;
  $('skip-to-retest').disabled = true;
  const saved = saveProfile();
  $('clear-dialog').close();
  $('history-toast').hidden = false;
  $('history-feedback').textContent = saved ? 'Local history cleared.' : 'History cleared in this tab, but storage is unavailable.';
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
  $('history-feedback').textContent = 'Local history restored.';
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
  $('font-size').addEventListener('change', (event) => { prefs.fontSize = event.target.value; applyPreferences(); saveProfile(); });
  $('live-toggle').addEventListener('change', (event) => { prefs.liveMetrics = event.target.checked; applyPreferences(); saveProfile(); });
  $('keyboard-toggle').addEventListener('change', (event) => { prefs.keyboard = event.target.checked; applyPreferences(); saveProfile(); });
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
  $('typing-input').addEventListener('paste', (event) => { event.preventDefault(); announce('Paste is disabled for typing practice.'); });
  $('typing-input').addEventListener('drop', (event) => event.preventDefault());
  $('typing-input').addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' && attempt?.status === 'ready') {
      attempt.conditions.inputClass = 'touch';
      $('condition-line').textContent = describeConditions(attempt.conditions);
    }
  });
  $('typing-input').addEventListener('click', () => { const value = $('typing-input').value; $('typing-input').setSelectionRange(value.length, value.length); });
  $('typing-input').addEventListener('compositionstart', () => {
    if (attempt && ['ready', 'running'].includes(attempt.status)) {
      if (attempt.status === 'ready') startAttempt(attempt);
      attempt.unsupportedInput = true;
      attempt.interrupted = true;
      attempt.events.push({ type: 'composition', offsetMs: offsetFor() });
      $('input-help').textContent = 'Composition input is not scored in this English physical-keyboard mode. Restart and use direct key input.';
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
    $('manual-target-error').textContent = valid ? '' : 'Use 1–8 English letters with no spaces or punctuation.';
    if (!valid) return;
    selectedTarget = normalizeManualTarget(raw);
    activeRecommendation = {
      kind: 'manual',
      target: selectedTarget,
      title: `Practice “${selectedTarget}”`,
      reason: `You chose “${selectedTarget}” manually. It stays separate from the automatic recommendation evidence.`,
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
  $('race-input').addEventListener('paste', (event) => event.preventDefault());
  $('race-input').addEventListener('blur', () => {
    if (race.attempt?.status === 'running') markInterrupted('The local challenge lost focus. Restart this player for a fair result.');
  });
  $('start-next-player').addEventListener('click', () => { $('race-handoff').hidden = true; setupRacePlayer(); });
  $('race-again').addEventListener('click', () => { $('race-leaderboard').hidden = true; $('compete-setup').hidden = false; $('player-one-name').focus(); });

  $('clear-history').addEventListener('click', () => { $('confirm-clear-input').value = ''; $('confirm-clear').disabled = true; $('clear-dialog').showModal(); $('confirm-clear-input').focus(); });
  $('confirm-clear-input').addEventListener('input', (event) => { $('confirm-clear').disabled = event.target.value !== 'clear'; });
  $('confirm-clear').addEventListener('click', clearHistory);
  $('cancel-clear').addEventListener('click', () => $('clear-dialog').close());
  $('undo-clear').addEventListener('click', undoClear);

  document.addEventListener('keydown', (event) => {
    if (event.repeat && event.key.length === 1 && (document.activeElement === $('typing-input') || document.activeElement === $('race-input'))) {
      event.preventDefault();
      const help = document.activeElement === $('typing-input') ? $('input-help') : $('race-help');
      help.textContent = 'Held-key repeats are ignored. Press each key once.';
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
  window.addEventListener('blur', () => { document.querySelectorAll('.key.active').forEach((key) => key.classList.remove('active')); markInterrupted('Focus changed. The clock kept running, but this run will stay out of comparisons. Restart for a comparable result.'); });
}

document.documentElement.dataset.theme = 'dark';
buildKeyboard();
applyPreferences();
setModeControls();
bindEvents();
renderHistory();
resetSession('practice', { focus: matchMedia('(hover: hover) and (pointer: fine)').matches });

if (!storageAvailable) announce('Local storage is unavailable. Results will last only in this tab.');

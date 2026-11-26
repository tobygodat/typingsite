import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSED, WORD_FLOW_MAX_EXTRA, applyWordFlowDelete, applyWordFlowDeleteWord, applyWordFlowKey, createWordFlow, linearWordDeleteCount,
} from '../src/word-flow.js';
import {
  EVENT_VERSION, WORD_FLOW_EVENT_VERSION, characterBreakdown, completeAttempt, conditionKey, createAttempt, fluidWords, inputRules,
  replayAttempt, replayCursor, replayFlow, standardConditions, withWordFlow, wordHistory,
} from '../src/typing.js';
import { correctionTimes, missedAndSlowWords } from '../src/insights.js';
import { isAttemptEvent } from '../src/domain-history.js';
import { encodeTrace, ghostPoints, scoreTrace } from '../src/ghost-race.js';
import { historyWordFlow, normalizeProfile, preferencesInUse } from '../src/profile.js';

const fluid = { mode: 'words', count: 10, punctuation: false, numbers: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', wordFlow: 'fluid' };

function typeKeys(text, keys) {
  let state = createWordFlow(text);

  for (const key of keys) {
    if (key === '⌫') ({ state } = applyWordFlowDelete(state));
    else if (key === '⌥') ({ state } = applyWordFlowDeleteWord(state));
    else ({ state } = applyWordFlowKey(state, key));
  }

  return state;
}

const shown = (state) => state.typed.replaceAll(MISSED, '_');

test('a space mid-word jumps to the next word and marks the letters it skipped', () => {
  const state = typeKeys('the cat sat', [...'th ']);
  assert.equal(shown(state), 'th_ ');
  assert.deepEqual(applyWordFlowKey(createWordFlow('the cat'), ' ').steps, []);
  assert.deepEqual(applyWordFlowKey(typeKeys('the cat', [...'t']), ' ').steps, [{ type: 'skip', position: 1, count: 2 }]);
  assert.equal(shown(typeKeys('the cat sat', [...'th c'])), 'th_ c');
});

test('a space at a word start is ignored with no step, so a double space costs nothing', () => {
  assert.deepEqual(applyWordFlowKey(createWordFlow('the cat'), ' ').steps, []);
  const afterWord = typeKeys('the cat', [...'the ']);
  assert.deepEqual(applyWordFlowKey(afterWord, ' ').steps, []);
  assert.equal(shown(typeKeys('the cat', [...'the   cat'])), 'the cat');
});

test('letters past a word end stay on that word, at most eight, and never shift the next word', () => {
  const state = typeKeys('the cat', [...'theabcdefghij']);
  assert.equal(state.typed, 'the');
  assert.equal(state.extras.get(3), 'abcdefgh');
  assert.equal(WORD_FLOW_MAX_EXTRA, 8);
  const next = typeKeys('the cat', [...'theab cat']);
  assert.equal(next.typed, 'the cat');
  assert.equal(next.extras.get(3), 'ab');
});

test('the last letter of the passage ends it, and a space on the last word skips to the end', () => {
  assert.equal(typeKeys('the cat', [...'the cat']).typed, 'the cat');
  assert.equal(shown(typeKeys('the cat', [...'the c '])), 'the c__');
  assert.deepEqual(applyWordFlowKey(typeKeys('the cat', [...'the cat']), 'x').steps, []);
});

test('backspace at a word start reopens a wrong previous word and leaves a clean one locked', () => {
  const clean = typeKeys('the cat', [...'the ']);
  assert.deepEqual(applyWordFlowDelete(clean).steps, []);
  assert.equal(typeKeys('the cat', [...'thx ⌫']).typed, 'thx');
  assert.equal(shown(typeKeys('the cat', [...'t ⌫'])), 't');
  const extras = typeKeys('the cat', [...'theab ⌫']);
  assert.equal(extras.typed, 'the');
  assert.equal(extras.extras.get(3), 'ab');
  assert.equal(typeKeys('the cat', [...'theab ⌫⌫']).extras.get(3), 'a');
  assert.equal(typeKeys('the cat', [...'theab ⌫⌫⌫⌫']).typed, 'th');
  assert.deepEqual(applyWordFlowDelete(createWordFlow('the cat')).steps, []);
});

test('word delete clears the current word with its extras, and at a word start takes only a wrong previous word', () => {
  assert.equal(typeKeys('the cat sat', [...'the ca⌥']).typed, 'the ');
  const overflow = typeKeys('the cat', [...'theabc⌥']);
  assert.equal(overflow.typed, '');
  assert.equal(overflow.extras.size, 0);
  assert.deepEqual(applyWordFlowDeleteWord(typeKeys('the cat', [...'the '])).steps, []);
  assert.equal(typeKeys('the cat sat', [...'thx ⌥']).typed, '');
  assert.equal(typeKeys('the cat sat', [...'the t ⌥']).typed, 'the ');
  const reopened = typeKeys('the cat sat', [...'theab ⌥']);
  assert.equal(reopened.typed, '');
  assert.equal(reopened.extras.size, 0);
  assert.deepEqual(applyWordFlowDeleteWord(createWordFlow('the cat')).steps, []);
});

test('a linear word delete takes trailing spaces and then the letters before them', () => {
  assert.equal(linearWordDeleteCount(''), 0);
  assert.equal(linearWordDeleteCount('the ca'), 2);
  assert.equal(linearWordDeleteCount('the '), 4);
  assert.equal(linearWordDeleteCount('the  '), 5);
  assert.equal(linearWordDeleteCount('thecat'), 6);
});

test('fluid word flow is its own condition and applies only to free-correction prose practice', () => {
  const linear = withWordFlow(fluid, 'linear');
  assert.equal(Object.hasOwn(linear, 'wordFlow'), false);
  assert.equal(conditionKey(fluid), `${conditionKey(linear)}:word-flow`);
  assert.deepEqual(inputRules(fluid), ['word-flow']);
  assert.deepEqual(inputRules({ ...fluid, strictSpace: true, quickEnd: false, mode: 'quote' }), ['strict-space', 'quick-end-off']);

  for (const conditions of [
    { ...fluid, correctionPolicy: 'mandatory' }, { ...fluid, correctionPolicy: 'no-backspace' }, { ...fluid, correctionPolicy: 'fail-word' },
    { ...fluid, correctionPolicy: 'fail-any' }, { ...fluid, strictSpace: true }, { ...fluid, mode: 'code', codeLanguage: 'js' },
    { ...fluid, mode: 'lesson' }, { ...fluid, onlineRace: true }, { ...fluid, localRace: true }, { ...standardConditions(), wordFlow: 'fluid' },
  ]) {
    assert.equal(fluidWords(conditions), false, JSON.stringify(conditions));
    assert.equal(conditionKey(conditions), conditionKey(withWordFlow(conditions, 'linear')));
    assert.equal(Object.hasOwn(withWordFlow(conditions, 'fluid'), 'wordFlow'), false);
  }

  for (const mode of ['time', 'words', 'quote', 'book', 'custom', 'missed']) assert.equal(fluidWords(withWordFlow({ ...fluid, mode }, 'fluid')), true, mode);
  assert.equal(createAttempt({ id: 'a', text: 'a b', textId: 'a', conditions: fluid }).eventVersion, WORD_FLOW_EVENT_VERSION);
  assert.equal(createAttempt({ id: 'a', text: 'a b', textId: 'a', conditions: linear }).eventVersion, EVENT_VERSION);
});

// Drives the domain as the live input does: each action's steps become events at its time.
function record(text, actions, { gap = 37 } = {}) {
  const attempt = createAttempt({ id: 'run', text, textId: 'run', conditions: fluid });
  let state = createWordFlow(text);
  const states = [];
  let offsetMs = 0;

  for (const action of actions) {
    offsetMs += gap;
    const result = action === '⌫' ? applyWordFlowDelete(state) : action === '⌥' ? applyWordFlowDeleteWord(state) : applyWordFlowKey(state, action);

    for (const step of result.steps) {
      if (step.type === 'insert') attempt.events.push({ type: 'insert', text: step.text, position: step.position, accepted: true, offsetMs });
      else attempt.events.push({ ...step, offsetMs });
    }

    state = result.state;
    states.push({ offsetMs, state });

    if (state.typed.length >= text.length) break;
  }

  attempt.startedAt = attempt.events[0]?.offsetMs ?? 0;

  return { attempt: completeAttempt(attempt, { endedAt: offsetMs }), states, state };
}

function seeded(seed) {
  let value = seed >>> 0;

  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['the', 'a', 'cat', 'sat', 'on', 'mat', 'quiet', 'river', 'is', 'deep', 'x', 'note'];

function randomRun(random) {
  const text = Array.from({ length: 3 + Math.floor(random() * 8) }, () => WORDS[Math.floor(random() * WORDS.length)]).join(' ');
  const actions = [];
  let cursor = 0;

  for (let i = 0; i < 20 + Math.floor(random() * 80); i += 1) {
    const roll = random();

    if (roll < 0.5) actions.push(text[cursor] ?? 'e');
    else if (roll < 0.62) actions.push(' ');
    else if (roll < 0.74) actions.push('qzx'[Math.floor(random() * 3)]);
    else if (roll < 0.9) actions.push('⌫');
    else actions.push('⌥');
    cursor = Math.min(text.length, cursor + 1);
  }

  return { text, actions };
}

test('500 random fluid runs keep every invariant and replay exactly', () => {
  const random = seeded(2027);

  for (let run = 0; run < 500; run += 1) {
    const { text, actions } = randomRun(random);
    const { attempt, states, state } = record(text, actions);
    const label = JSON.stringify({ text, actions });

    // The passage spaces never move: a space stands only where the passage has one, and every
    // space the caret passed is kept as a space. So one word's mistakes can't shift the next.
    for (let i = 0; i < state.typed.length; i += 1) assert.equal(state.typed[i] === ' ', text[i] === ' ', label);

    for (const [end, letters] of state.extras) {
      assert.ok(letters.length >= 1 && letters.length <= WORD_FLOW_MAX_EXTRA, label);
      assert.ok(text[end] === ' ' && end <= state.typed.length, label);
      assert.ok(!state.typed.slice(text.lastIndexOf(' ', end - 1) + 1, end).includes(MISSED), label);
    }

    // Replay folds the recorded events to the live state, at the end and at every recorded moment.
    const flow = replayFlow(attempt)(Infinity);
    assert.equal(flow.typed, state.typed, label);
    assert.deepEqual([...flow.extras], [...state.extras], label);
    assert.equal(attempt.summary.typed, state.typed, label);
    const cursor = replayCursor(attempt);

    for (const moment of states) assert.equal(cursor(moment.offsetMs), moment.state.typed, label);
    assert.equal(replayCursor(attempt)(Infinity), state.typed, label);

    // Every recorded key is scored once; skips and extras are always misses.
    const keys = attempt.events.filter((event) => event.type === 'insert' || event.type === 'skip' || event.type === 'extra');
    const replay = replayAttempt(attempt);
    assert.equal(replay.insertions, keys.length, label);
    assert.ok(replay.correctInsertions <= keys.filter((event) => event.type === 'insert').length, label);

    for (const first of replay.firstAttempts) {
      if (first.correct) assert.equal(first.actual, text[first.position], label);
    }

    for (const pair of replay.pairTimings) assert.equal(pair.pair, text.slice(pair.position - 1, pair.position + 1), label);
    assert.ok(attempt.events.every(isAttemptEvent), label);

    const chars = characterBreakdown(attempt, replay);
    const skipped = [...state.typed].filter((char) => char === MISSED).length;
    assert.ok(chars.missed >= skipped, label);
    assert.equal(chars.correct + chars.incorrect + skipped, state.typed.length, label);
    assert.equal(chars.extra, [...state.extras.values()].join('').length, label);

    const words = wordHistory(attempt, replay);
    assert.ok(words.every((word) => !word.word.includes(MISSED)), label);
    assert.equal(correctionTimes(attempt).length, 2, label);

    // The ghost trace walks the same caret path and counts the same correct letters.
    const trace = encodeTrace(attempt);

    if (attempt.events.length) {
      assert.equal(ghostPoints(trace, text.length).at(-1)[1], state.typed.length, label);
      assert.equal(scoreTrace(trace, text, { relaxed: true }).correct, [...state.typed].filter((char, i) => char === text[i]).length, label);
    }

    assert.ok(Array.isArray(missedAndSlowWords(attempt).missed), label);
  }
});

test('a delete reaches back at most one word, and only into a word left wrong', () => {
  const random = seeded(77);

  for (let run = 0; run < 300; run += 1) {
    const { text, actions } = randomRun(random);
    let state = createWordFlow(text);

    for (const action of actions) {
      const before = state;
      state = (action === '⌫' ? applyWordFlowDelete(state) : action === '⌥' ? applyWordFlowDeleteWord(state) : applyWordFlowKey(state, action)).state;
      const caretWord = text.lastIndexOf(' ', before.typed.length - 1) + 1;

      if (state.typed.length < caretWord) {
        const end = caretWord - 1;
        const start = text.lastIndexOf(' ', end - 1) + 1;
        const label = JSON.stringify({ text, actions, before: before.typed });
        assert.ok(before.typed.slice(start, end) !== text.slice(start, end) || before.extras.has(end), label);
        assert.ok(state.typed.length >= start, label);
      }

      if (state.typed.length >= text.length) break;
    }
  }
});

test('a fluid run scores its skip and extras as misses and shows them on the word list', () => {
  const { attempt } = record('the cat sat', [...'th catxx sat']);
  const replay = replayAttempt(attempt);
  assert.equal(replay.typed, `th${MISSED} cat sat`);
  assert.equal(replay.insertions, 12);
  assert.equal(replay.mistakes, 3);
  assert.deepEqual(replay.firstAttempts.filter((item) => !item.correct).map((item) => [item.position, item.actual]), [[2, ' '], [7, 'x']]);
  assert.deepEqual(characterBreakdown(attempt, replay), { correct: 10, incorrect: 0, extra: 2, missed: 1 });
  assert.deepEqual(wordHistory(attempt, replay).map(({ word, wrong }) => [word, wrong]), [['th', true], ['catxx', true], ['sat', false]]);
  assert.deepEqual(missedAndSlowWords(attempt).missed.length, 2);
});

test('linear runs replay exactly as before: no extras and the same typed text', () => {
  const text = 'the cat';
  const attempt = createAttempt({ id: 'l', text, textId: 'l', conditions: withWordFlow(fluid, 'linear') });
  attempt.events = [...'thx cat'].map((char, position) => ({ type: 'insert', text: char, position, accepted: true, offsetMs: position * 50 }));
  attempt.events.push({ type: 'delete', count: 3, offsetMs: 400 });
  const flow = replayFlow(attempt)(Infinity);
  assert.equal(flow.typed, 'thx ');
  assert.equal(flow.extras.size, 0);
  assert.equal(replayCursor(attempt)(Infinity), replayAttempt(attempt).typed);
});

test('a profile with only linear history types linear until it chooses; a new or fluid profile types fluid, and nothing is stored', () => {
  const linearRun = { id: 'a', at: '2026-11-01T10:00:00Z', status: 'complete', kind: 'test', conditions: withWordFlow(fluid, 'linear'), summary: { score: { wpm: 60, accuracy: 97 } } };
  const fluidRun = { ...linearRun, id: 'b', conditions: fluid };

  const flowOf = (data) => {
    const profile = normalizeProfile({ version: 2, ...data });
    assert.equal(Object.hasOwn(profile.preferences, 'wordFlow'), Object.hasOwn(data.preferences, 'wordFlow'));

    return preferencesInUse(profile.preferences, profile).wordFlow;
  };

  assert.equal(preferencesInUse({}).wordFlow, 'fluid');
  assert.equal(historyWordFlow(null), 'fluid');
  assert.equal(flowOf({ preferences: {}, runs: [] }), 'fluid');
  assert.equal(flowOf({ preferences: {}, runs: [linearRun] }), 'linear');
  assert.equal(flowOf({ preferences: {}, runs: [], bests: { [conditionKey(withWordFlow(fluid, 'linear'))]: { wpm: 72 } } }), 'linear');
  assert.equal(flowOf({ preferences: {}, runs: [], bests: { [conditionKey(fluid)]: { wpm: 72 } } }), 'fluid');
  assert.equal(flowOf({ preferences: {}, runs: [linearRun, fluidRun] }), 'fluid');
  assert.equal(flowOf({ preferences: { wordFlow: 'fluid' }, runs: [linearRun] }), 'fluid');
  assert.equal(flowOf({ preferences: { wordFlow: 'linear' }, runs: [] }), 'linear');
});

test('a fluid run sends a ghost trace whose caret path and correct letters match the run', () => {
  const { attempt } = record('the cat sat on mat', [...'th catxx⌫⌫ sat on mat']);
  attempt.kind = 'test';
  attempt.textId = 'x';
  const trace = encodeTrace(attempt);
  assert.ok(trace);
  assert.equal(trace.k.length, trace.t.length);
  const replay = replayAttempt(attempt);
  const points = ghostPoints(trace, attempt.text.length);
  assert.equal(points.at(-1)[1], attempt.text.length);
  const correct = [...replay.typed].filter((char, i) => char === attempt.text[i]).length;
  assert.equal(scoreTrace(trace, attempt.text, { relaxed: true }).correct, correct);
  assert.equal(scoreTrace(trace, attempt.text, { relaxed: true }).wpm, replay.score.wpm);
});

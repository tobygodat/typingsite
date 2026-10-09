import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPOSE_MIN_ACTIVE_MS,
  COMPOSE_PAUSE_MS,
  COMPOSE_PROMPTS,
  COMPOSE_VERSION,
  MAX_COMPOSITIONS,
  activeTime,
  composeSummary,
  compositionRecord,
  countCharacters,
  countWords,
  normalizeCompositions,
  promptDeck,
  promptText,
} from '../src/compose.js';
import { conditionKey } from '../src/typing.js';

// Keys typed `gap` ms apart, with `pauses` (index → extra ms before that key).
function keysFor(types, gap = 200, pauses = {}) {
  let at = 0;
  return [...types].map((type, index) => {
    if (index > 0) at += gap + (pauses[index] || 0);
    return { type: type === '<' ? 'delete' : 'insert', at };
  });
}

test('active time leaves out every gap longer than the pause cut-off', () => {
  assert.equal(activeTime([]), 0);
  assert.equal(activeTime([0]), 0);
  assert.equal(activeTime([0, 200, 400]), 400);
  // A 2 s gap still counts; anything longer is thinking time and counts for nothing.
  assert.equal(activeTime([0, COMPOSE_PAUSE_MS, COMPOSE_PAUSE_MS + 100]), COMPOSE_PAUSE_MS + 100);
  assert.equal(activeTime([0, 100, 100 + COMPOSE_PAUSE_MS + 1, 100 + COMPOSE_PAUSE_MS + 301]), 400);
});

test('free-typing speed is kept characters ÷ 5 per active minute', () => {
  // 61 keys 200 ms apart: 12 s of active typing, 61 characters kept.
  const text = 'a'.repeat(61);
  const summary = composeSummary({ keys: keysFor('i'.repeat(61)), text, elapsedMs: 12_000 });
  assert.equal(summary.activeMs, 12_000);
  assert.equal(summary.characters, 61);
  assert.equal(summary.wpm, Math.round(61 / 5 / (12_000 / 60_000)));
  assert.equal(summary.backspaceRate, 0);
  assert.equal(summary.version, COMPOSE_VERSION);
  assert.equal(summary.measurable, true);
});

test('a long pause lowers elapsed time use but not the speed', () => {
  const steady = composeSummary({ keys: keysFor('i'.repeat(41)), text: 'x'.repeat(41), elapsedMs: 8000 });
  const paused = composeSummary({ keys: keysFor('i'.repeat(41), 200, { 20: 9000 }), text: 'x'.repeat(41), elapsedMs: 17_200 });
  // The 9.2 s gap is left out entirely, so only one 200 ms interval is lost.
  assert.equal(paused.activeMs, steady.activeMs - 200);
  assert.ok(Math.abs(paused.wpm - steady.wpm) <= 2);
  assert.equal(paused.elapsedMs, 17_200);
});

test('backspace rate counts deleting keys against every key, and deleted text is not speed', () => {
  // 30 letters, 5 backspaces, 5 letters again: 40 keys, 30 characters kept.
  const types = 'i'.repeat(30) + '<'.repeat(5) + 'i'.repeat(5);
  const summary = composeSummary({ keys: keysFor(types, 250), text: 'y'.repeat(30), elapsedMs: 10_000 });
  assert.equal(summary.keystrokes, 40);
  assert.equal(summary.backspaces, 5);
  assert.equal(summary.backspaceRate, 13);
  assert.equal(summary.characters, 30);
  assert.equal(summary.activeMs, 39 * 250);
  assert.equal(summary.wpm, Math.round(30 / 5 / ((39 * 250) / 60_000)));
});

test('too little active typing gives no speed', () => {
  const short = composeSummary({ keys: keysFor('iiiii', 200), text: 'hello', elapsedMs: 800 });
  assert.equal(short.activeMs, 800);
  assert.ok(short.activeMs < COMPOSE_MIN_ACTIVE_MS);
  assert.equal(short.wpm, null);
  assert.equal(short.measurable, false);
  assert.equal(short.backspaceRate, 0);
  const deletedAll = composeSummary({ keys: keysFor('i'.repeat(30) + '<'.repeat(30), 200), text: '', elapsedMs: 12_000 });
  assert.equal(deletedAll.wpm, null, 'nothing kept, nothing to measure');
  assert.equal(deletedAll.backspaceRate, 50);
  const empty = composeSummary();
  assert.equal(empty.wpm, null);
  assert.equal(empty.backspaceRate, null);
});

test('invisible format characters are not counted as writing', () => {
  assert.equal(countCharacters('a​b­c‎'), 3);
  assert.equal(countCharacters('naïve café'), 10);
  assert.equal(countCharacters('one\ntwo'), 7);
  assert.equal(countWords('  Three short   words\n'), 3);
  assert.equal(countWords(''), 0);
});

test('the stored record holds numbers and labels only, never the writing', () => {
  const secret = 'My private morning notes';
  const summary = composeSummary({ keys: keysFor('i'.repeat(secret.length), 300), text: secret, elapsedMs: 9000 });
  const record = compositionRecord(summary, { id: 'c1', at: '2026-10-09T12:00:00.000Z', promptId: 'morning', inputClass: 'physical-keyboard', endedBy: 'done' });
  assert.deepEqual(Object.keys(record).sort(), [
    'activeMs', 'at', 'backspaceRate', 'backspaces', 'characters', 'elapsedMs', 'endedBy', 'id',
    'inputClass', 'keystrokes', 'promptId', 'version', 'words', 'wpm',
  ]);
  assert.ok(!JSON.stringify(record).includes('private'));
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') assert.ok(['id', 'at', 'version', 'promptId', 'inputClass', 'endedBy'].includes(key), key);
  }
});

test('loading keeps well-formed records, rebuilt from known fields only', () => {
  const summary = composeSummary({ keys: keysFor('i'.repeat(40), 200), text: 'z'.repeat(40), elapsedMs: 8000 });
  const good = compositionRecord(summary, { id: 'ok', at: '2026-10-09T12:00:00.000Z', promptId: 'room' });
  const smuggled = { ...good, id: 'extra', text: 'should not survive', promptId: 'not-a-prompt', inputClass: 'stylus' };
  const list = normalizeCompositions([good, smuggled, { id: 'bad', wpm: 'fast' }, null, 'x', { ...good, id: 'neg', wpm: -1 }]);
  assert.deepEqual(list.map((item) => item.id), ['ok', 'extra']);
  assert.equal('text' in list[1], false);
  assert.equal(list[1].promptId, null);
  assert.equal(list[1].inputClass, 'physical-keyboard');
  assert.deepEqual(normalizeCompositions(undefined), []);
  const many = Array.from({ length: MAX_COMPOSITIONS + 5 }, (_, i) => ({ ...good, id: `c${i}` }));
  const kept = normalizeCompositions(many);
  assert.equal(kept.length, MAX_COMPOSITIONS);
  assert.equal(kept[0].id, 'c5', 'the oldest go first');
});

test('the prompt deck shows every prompt once before repeating, never the current one first', () => {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const ids = COMPOSE_PROMPTS.map((prompt) => prompt.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const prompt of COMPOSE_PROMPTS) assert.equal(promptText(prompt.id), prompt.text);
  for (let round = 0; round < 50; round += 1) {
    const avoid = ids[round % ids.length];
    const deck = promptDeck(random, avoid);
    assert.deepEqual([...deck].sort(), [...ids].sort());
    assert.notEqual(deck[0], avoid);
  }
  assert.equal(promptText('missing'), null);
});

test('composing adds nothing to copy-test conditions', () => {
  // Composing is stored apart from runs; condition keys for every test stay exactly as they were.
  assert.equal(conditionKey({ mode: 'time', duration: 30, punctuation: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed' }),
    'time:30::plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1');
});

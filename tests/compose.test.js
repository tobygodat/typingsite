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
  keyedEdit,
  normalizeCompositions,
  promptDeck,
  promptText,
  refusedEdit,
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

test('active time counts every gap longer than the pause cut-off as the average shorter gap', () => {
  assert.equal(activeTime([]), 0);
  assert.equal(activeTime([0]), 0);
  assert.equal(activeTime([0, 200, 400]), 400);
  // A 2 s gap still counts as it is.
  assert.equal(activeTime([0, COMPOSE_PAUSE_MS, COMPOSE_PAUSE_MS + 100]), COMPOSE_PAUSE_MS + 100);
  // Gaps of 100 and 300 ms average 200 ms, which is what the thinking pause between them counts as.
  assert.equal(activeTime([0, 100, 100 + COMPOSE_PAUSE_MS + 1, 100 + COMPOSE_PAUSE_MS + 301]), 600);
  // Nothing but pauses: no typing rhythm to go on, so no active time.
  assert.equal(activeTime([0, 5000, 10_000]), 0);
});

test('writing in bursts is measured at the speed of the keys, not faster', () => {
  // 26 bursts of three keys 100 ms apart (10 keys a second, 120 wpm), with 2.1 s between bursts.
  const times = [];
  for (let burst = 0; burst < 26; burst += 1) for (let key = 0; key < 3; key += 1) times.push(burst * 2300 + key * 100);
  const keys = times.map((at) => ({ type: 'insert', at }));
  const summary = composeSummary({ keys, text: 'ab '.repeat(26), elapsedMs: times.at(-1) + 100 });
  // 52 gaps of 100 ms plus 25 pauses counted as 100 ms each.
  assert.equal(summary.activeMs, 7700);
  assert.equal(summary.wpm, Math.round(78 / 5 / (7700 / 60_000)));
  assert.ok(summary.wpm >= 120 && summary.wpm <= 122, `${summary.wpm} wpm`);
  // Word at a time: six keys 200 ms apart (60 wpm), then 2.5 s of thought.
  const words = [];
  for (let word = 0; word < 10; word += 1) for (let key = 0; key < 6; key += 1) words.push({ type: 'insert', at: word * 3500 + key * 200 });
  const paced = composeSummary({ keys: words, text: 'word, '.repeat(10), elapsedMs: words.at(-1).at + 200 });
  assert.equal(paced.wpm, Math.round(60 / 5 / (59 * 200 / 60_000)));
  assert.ok(paced.wpm <= 62, `${paced.wpm} wpm`);
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
  // The 9.2 s gap counts as one ordinary 200 ms gap, so the speed is exactly the same.
  assert.equal(paused.activeMs, steady.activeMs);
  assert.equal(paused.wpm, steady.wpm);
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

test('only single keys at the caret are counted; cut, line deletes and other edits are refused', () => {
  const at = (inputType, extra = {}) => refusedEdit({ inputType, selectionStart: 7, selectionEnd: 7, ...extra });
  // Backspace and Delete, by letter or by word, are one deleting key each.
  for (const type of ['deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteWordForward']) {
    assert.equal(keyedEdit(type), 'delete', type);
    assert.equal(at(type), null, type);
  }
  for (const type of ['insertText', 'insertLineBreak', 'insertParagraph']) {
    assert.equal(keyedEdit(type), 'insert', type);
    assert.equal(at(type, { data: type === 'insertText' ? 'a' : null }), null, type);
  }
  assert.equal(at('insertText', { data: 'é' }), null, 'one accented character is one key');
  assert.equal(at('insertText', { data: '👍' }), null, 'one emoji is one key');

  // A cut can remove any selection with one key, so it is refused and counts nothing.
  assert.equal(at('deleteByCut'), 'edit');
  assert.equal(keyedEdit('deleteByCut'), null);
  for (const type of ['deleteSoftLineBackward', 'deleteSoftLineForward', 'deleteHardLineBackward', 'deleteHardLineForward', 'deleteEntireSoftLine']) {
    assert.equal(at(type), 'lineDelete', type);
    assert.equal(keyedEdit(type), null, type);
  }
  for (const type of ['insertFromPaste', 'insertFromPasteAsQuotation']) assert.equal(at(type), 'paste', type);
  for (const type of ['deleteByDrag', 'deleteContent', 'insertFromDrop', 'insertReplacementText', 'insertTranspose',
    'insertFromYank', 'historyUndo', 'historyRedo', 'formatBold', 'insertLink', '']) {
    assert.equal(at(type), 'edit', type || '(none)');
    assert.equal(keyedEdit(type), null, type || '(none)');
  }
  assert.equal(at('insertText', { data: 'two words' }), 'multiCharacter');
  assert.equal(at('insertText', { data: 'ab' }), 'multiCharacter');
});

test('a key typed or deleted over a selection is refused, so a selection never vanishes uncounted', () => {
  const over = (inputType, data = null) => refusedEdit({ inputType, data, selectionStart: 2, selectionEnd: 30 });
  assert.equal(over('insertText', 'x'), 'selection');
  assert.equal(over('insertLineBreak'), 'selection');
  assert.equal(over('deleteContentBackward'), 'selection');
  assert.equal(over('deleteContentForward'), 'selection');
  assert.equal(over('deleteWordBackward'), 'selection');
  assert.equal(refusedEdit({ inputType: 'insertText', data: 'x', selectionStart: 4, selectionEnd: 5 }), 'selection', 'even one selected character');
  assert.equal(over('deleteByCut'), 'edit', 'a cut is refused whatever is selected');
  assert.equal(refusedEdit({ inputType: 'insertText', data: 'x' }), null, 'no selection given means a caret');
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

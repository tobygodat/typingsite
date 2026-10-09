import test from 'node:test';
import assert from 'node:assert/strict';
import { TAPE_BACK, TAPE_LEAD, TAPE_REACH, tapeOffset } from '../src/tape.js';

const width = 1000;
const margin = 40;
const lead = width * TAPE_LEAD;
const at = (left, length = 60) => ({ left, right: left + length });

test('the tape holds still while the caret travels, then steps a whole word to the lead', () => {
  // Letters inside a word never move the tape, wherever the caret is in view.
  for (const caret of [0, 120, 480, 690, 900]) assert.equal(tapeOffset({ offset: 0, caret, width, margin }), 0);
  // A new word before the reach point: no step.
  assert.equal(tapeOffset({ offset: 0, caret: 650, word: at(650), width, margin }), 0);
  // A new word past it: one step, and the word lands at the lead.
  const offset = tapeOffset({ offset: 0, caret: 720, word: at(720), width, margin });
  assert.equal(offset, 720 - lead);
  assert.ok(720 - offset < width * TAPE_REACH);
  // Already scrolled, the same rule applies to what is in view.
  assert.equal(tapeOffset({ offset: 2000, caret: 2650, word: at(2650), width, margin }), 2000);
  assert.equal(tapeOffset({ offset: 2000, caret: 2720, word: at(2720), width, margin }), 2720 - lead);
});

test('a word that would run off the edge steps at its start, not halfway through', () => {
  // Starts before the reach point but ends beyond the edge.
  assert.equal(tapeOffset({ offset: 0, caret: 600, word: at(600, 380), width, margin }), 600 - lead);
  // Ends just inside the edge: no step.
  assert.equal(tapeOffset({ offset: 0, caret: 600, word: at(600, 350), width, margin }), 0);
});

test('a word longer than the line steps inside the word, a chunk at a time', () => {
  const word = at(300, 1500);
  let offset = tapeOffset({ offset: 0, caret: 300, word, width, margin });
  assert.equal(offset, 300 - lead);
  const offsets = new Set([offset]);
  // Twenty-pixel letters through the whole word.
  for (let caret = 320; caret <= 1800; caret += 20) {
    offset = tapeOffset({ offset, caret, width, margin });
    offsets.add(offset);
    assert.ok(caret - offset >= 0 && caret - offset <= width - margin, `caret ${caret} at ${caret - offset}`);
  }
  // 74 letters, a handful of steps.
  assert.ok(offsets.size > 1 && offsets.size <= 3, `${offsets.size} positions`);
});

test('backspacing into the left edge steps back so the caret sits mid-line', () => {
  const offset = 5000;
  // Still clear of the edge: no step.
  assert.equal(tapeOffset({ offset, caret: offset + lead / 2 + 1, width, margin }), offset);
  const back = tapeOffset({ offset, caret: offset + 10, width, margin });
  assert.equal(back, Math.round(offset + 10 - width * TAPE_BACK));
  // Never before the start of the line.
  assert.equal(tapeOffset({ offset: 100, caret: 20, width, margin }), 0);
  assert.equal(tapeOffset({ offset: 0, caret: 0, width, margin }), 0);
});

test('a re-layout keeps the tape if the caret is still in view and lines the word up if not', () => {
  assert.equal(tapeOffset({ offset: 400, caret: 900, word: at(880), width, margin, realign: true }), 400);
  // A late word that would otherwise have stepped is left alone on re-layout.
  assert.equal(tapeOffset({ offset: 0, caret: 760, word: at(760), width, margin, realign: true }), 0);
  // Out of view (a narrower window, or switching from three lines): word to the lead.
  assert.equal(tapeOffset({ offset: 0, caret: 4210, word: at(4200), width, margin, realign: true }), 4200 - lead);
  assert.equal(tapeOffset({ offset: 9000, caret: 4210, word: at(4200), width, margin, realign: true }), 4200 - lead);
  // On a space, the caret itself goes to the lead.
  assert.equal(tapeOffset({ offset: 0, caret: 4210, width, margin, realign: true }), 4210 - lead);
});

test('the result is whole pixels and degenerate input falls back to the start', () => {
  assert.equal(tapeOffset({ offset: 0, caret: 733.4, word: at(733.4), width: 987, margin }), Math.round(733.4 - 98.7));
  assert.equal(tapeOffset({ offset: 300, caret: 500, width: 0, margin }), 0);
  assert.equal(tapeOffset({ offset: 300, caret: Number.NaN, width, margin }), 0);
  assert.equal(tapeOffset({ offset: Number.NaN, caret: 10, width, margin }), 0);
});

// The corner's rank pill (src/rank-pill.tsx): what it reads of the signed-in racer's own rating, and that it reads
// nothing for a guest or for a rating no race has moved (docs/adr/0016-race-rank.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPill } from '../src/rank-pill.js';

const plain = (pill) => ({ ...pill, line: pill.line.replaceAll(' ', ' ') });

test('a guest, or a rating not loaded, shows no pill', () => {
  assert.equal(rankPill(null), null);
  assert.equal(rankPill(undefined), null);
});

test('the rating everyone starts with, before any rated race, shows no pill', () => {
  assert.equal(rankPill({ rating: 1500, races: 0 }), null);
});

test('a provisional rating shows its figure and how many of the ten races to a rank are run', () => {
  assert.deepEqual(plain(rankPill({ rating: 1540, races: 3 })), { rank: null, rating: 1540, lit: 3, note: '3/10 races to a rank', line: 'Race rating 1540 · 3 rated races · provisional' });
});

test('a stepped rank shows the rank and step, and how far the step is filled', () => {
  assert.deepEqual(plain(rankPill({ rating: 1920, races: 18 })), { rank: 'Gale II', rating: 1920, lit: 2, note: '80 to Gale I · 18 rated races', line: 'Gale II · 1920 · 18 rated races' });
});

test('the top rank has no step and a full ring', () => {
  assert.deepEqual(plain(rankPill({ rating: 2480, races: 60 })), { rank: 'Hurricane', rating: 2480, lit: 10, note: '60 rated races', line: 'Hurricane · 2480 · 60 rated races' });
});

test('the pill carries the racer’s own rating and nothing of anyone else’s', () => {
  const pill = rankPill({ rating: 1920, races: 18, last: { roomId: 'r1', opponent: 'Mara', opponentRating: 2210 } });
  assert.deepEqual(Object.keys(pill).sort(), ['line', 'lit', 'note', 'rank', 'rating']);
  assert.doesNotMatch(JSON.stringify(pill), /Mara|2210|Tempest/);
});

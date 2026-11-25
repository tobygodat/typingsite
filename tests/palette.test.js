// The command palette (src/palette.tsx): which queries offer a generated theme, how high the offer ranks, and the
// contrast note it shows for a theme being tried.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastNote, vibeOf } from '../src/palette.js';

test('"vibe …" and "generate …" ask for a theme and lead the list, even over a command they spell', () => {
  assert.deepEqual(vibeOf('vibe  warm kyoto matcha '), { vibe: 'warm kyoto matcha', score: 301 });
  assert.deepEqual(vibeOf('generate theme midnight coral'), { vibe: 'midnight coral', score: 301 });
  assert.deepEqual(vibeOf('Generate paper', true), { vibe: 'paper', score: 301 });
});

test('two or more words, or "theme …", are offered after every command that matches', () => {
  assert.deepEqual(vibeOf('warm kyoto matcha'), { vibe: 'warm kyoto matcha', score: 0 });
  assert.deepEqual(vibeOf('theme sage'), { vibe: 'sage', score: 0 });
});

test('a query that names a command outright, a single word, or a bare keyword offers nothing', () => {
  assert.equal(vibeOf('quick end', true), null);
  assert.equal(vibeOf('theme · light', true), null);
  assert.equal(vibeOf('matcha'), null);
  assert.equal(vibeOf('vibe'), null);
  assert.equal(vibeOf('generate '), null);
  assert.equal(vibeOf('   '), null);
});

test('the vibe sent is at most 120 characters, as the function accepts', () => {
  assert.equal(vibeOf('vibe deep ' + 'sea'.repeat(60)).vibe.length, 120);
});

test('the contrast note reads AA with the text ratio, or names each colour under it', () => {
  assert.equal(contrastNote({ status: 'ready', vibe: 'v', name: 'n', colors: {}, issues: {}, ratio: 16.38 }), 'AA · 16.3:1');
  assert.equal(contrastNote({ status: 'ready', vibe: 'v', name: 'n', colors: {}, issues: { muted: 3.9, danger: 4.1 }, ratio: 12 }), 'under AA · muted text 3.9:1, mistakes 4.1:1');
});

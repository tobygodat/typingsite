import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastNote, createPalette, vibeOf } from '../src/palette.js';

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

const THEME = { name: 'Kyoto Matcha', colors: { ground: '#10140f', text: '#eef2e6', muted: '#a7b39a', accent: '#9ccc65', danger: '#ff8a80', 'accent-ink': '#0d1a05', warning: '#ffd54f', ghost: '#b3c7ff' } };

// A member's palette whose generations wait until the test answers them, or are dropped.
function memberPalette() {
  const sent = [];
  const palette = createPalette();
  palette.configure({
    getCommands: () => [],
    themes: {
      member: () => true, full: () => false, preview() {}, save() {}, signIn() {},
      generate: (vibe, signal) => new Promise((resolve) => { sent.push({ vibe, signal, resolve }); }),
    },
  });
  palette.open();

  return { palette, sent, generate(query) { palette.query(query); palette.run(0); } };
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

test('editing the query, Escape, closing, or asking again aborts the generation in flight', async () => {
  for (const leave of [(p) => p.query('vibe cold harbour'), (p) => p.escape(), (p) => p.close(), (p) => p.dispose()]) {
    const { palette, sent, generate } = memberPalette();
    generate('vibe warm kyoto matcha');
    assert.equal(palette.view.getSnapshot().theme.status, 'generating');
    leave(palette);
    assert.equal(sent[0].signal.aborted, true);
    sent[0].resolve(THEME);
    await settle();
    assert.notEqual(palette.view.getSnapshot().theme.status, 'ready');
  }

  const { palette, sent, generate } = memberPalette();
  generate('vibe warm kyoto matcha');
  palette.run(0);
  generate('vibe cold harbour');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].signal.aborted, true);
  assert.equal(sent[1].signal.aborted, false);
});

test('a generation dropped mid-request shows no error', async () => {
  const sent = [];
  const palette = createPalette();
  palette.configure({
    getCommands: () => [],
    themes: {
      member: () => true, full: () => false, preview() {}, save() {}, signIn() {},
      generate: (vibe, signal) => new Promise((resolve, reject) => { sent.push(signal); signal.addEventListener('abort', () => reject(signal.reason)); }),
    },
  });
  palette.open();
  palette.query('vibe warm kyoto matcha');
  palette.run(0);
  palette.escape();
  await settle();
  assert.equal(sent[0].aborted, true);
  assert.equal(palette.view.getSnapshot().theme.status, 'idle');
});

test('a generated theme with a blank name is saved as "generated", not as the prompt', async () => {
  const { palette, sent, generate } = memberPalette();
  generate('vibe warm kyoto matcha');
  sent[0].resolve({ ...THEME, name: '   ' });
  await settle();
  const theme = palette.view.getSnapshot().theme;
  assert.equal(theme.status, 'ready');
  assert.equal(theme.name, 'generated');
});

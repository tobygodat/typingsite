import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_WORD_HIGHLIGHT, WORD_HIGHLIGHT_MODES, normalizeWordHighlight, wordIndexes, wordsAt } from '../src/word-highlight.js';

test('word highlight is off by default and unknown or missing values fall back to off', () => {
  assert.equal(DEFAULT_WORD_HIGHLIGHT, 'off');
  assert.deepEqual(WORD_HIGHLIGHT_MODES, ['off', 'current', 'next']);
  for (const mode of WORD_HIGHLIGHT_MODES) assert.equal(normalizeWordHighlight(mode), mode);
  for (const value of [undefined, null, '', 'word', true, 1, 'Current']) assert.equal(normalizeWordHighlight(value), 'off');
});

test('a space belongs to the word before it, matching the rendered word groups', () => {
  const text = 'the cat sat';
  assert.deepEqual(wordIndexes(text), [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2]);
  assert.equal(new Set(wordIndexes(text)).size, text.split(' ').length);
  assert.deepEqual(wordIndexes(''), []);
});

test('the current word stays until its space is typed; next is the word after it', () => {
  const text = 'the cat sat';
  const indexes = wordIndexes(text);
  const count = text.split(' ').length;
  assert.deepEqual(wordsAt(indexes, count, 0), { current: 0, next: 1 });
  // "the" typed, caret on its space: still the current word.
  assert.deepEqual(wordsAt(indexes, count, 3), { current: 0, next: 1 });
  assert.deepEqual(wordsAt(indexes, count, 4), { current: 1, next: 2 });
  // The last word has no next word.
  assert.deepEqual(wordsAt(indexes, count, 8), { current: 2, next: -1 });
  // A finished passage highlights nothing.
  assert.deepEqual(wordsAt(indexes, count, text.length), { current: -1, next: -1 });
  assert.deepEqual(wordsAt(indexes, count, -1), { current: -1, next: -1 });
});

test('punctuation and capitals stay inside their word', () => {
  const text = 'Hello, world.';
  const indexes = wordIndexes(text);
  assert.deepEqual(wordsAt(indexes, 2, text.indexOf(',')), { current: 0, next: 1 });
  assert.deepEqual(wordsAt(indexes, 2, text.indexOf('.')), { current: 1, next: -1 });
});

// The tint sits behind untyped (muted) letters, so it must keep them at WCAG AA in both shipped themes.
test('the highlight token keeps muted and text letters at 4.5:1 in dark and light', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const tokens = (selector) => {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, selector);
    const body = css.slice(start, css.indexOf('}', start));
    return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
  };
  const rgb = (value) => value.replace('#', '').match(/../g).map((pair) => parseInt(pair, 16));
  const channel = (value) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  for (const selector of [':root,\n:root[data-theme="dark"]', ':root[data-theme="light"]']) {
    const set = tokens(selector);
    const share = Number(set['--word-highlight']?.match(/^color-mix\(in oklab, var\(--text\) ([\d.]+)%, transparent\)$/)?.[1]) / 100;
    assert.ok(share > 0 && share < 1, `${selector} --word-highlight`);
    const ground = rgb(set['--ground']);
    // The tint is the text colour at `share` alpha, composited over the page.
    const tint = rgb(set['--text']).map((value, index) => value * share + ground[index] * (1 - share));
    assert.ok(contrast(rgb(set['--muted']), tint) >= 4.5, `${selector} muted on the tint`);
    assert.ok(contrast(rgb(set['--text']), tint) >= 4.5, `${selector} text on the tint`);
    assert.ok(contrast(tint, ground) > 1.05, `${selector} the tint shows against the page`);
  }
});

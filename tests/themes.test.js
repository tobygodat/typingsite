import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DARK_THEMES, LIGHT_THEMES, normalizeProfile, preferencesInUse } from '../src/profile.js';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const blocks = [...css.matchAll(/:root\[data-theme="([^"]+)"\]\s*\{([^}]*)\}/g)].map(([, name, body]) => ({
  name,
  ground: body.match(/--ground:\s*(#[0-9a-f]{6})/i)[1],
  scheme: body.match(/color-scheme:\s*(\w+)/)[1],
}));
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

test('every theme sits in the family its ground and colour scheme put it in', () => {
  assert.deepEqual(blocks.map((block) => block.name).sort(), [...DARK_THEMES, ...LIGHT_THEMES].sort());
  for (const { name, ground, scheme } of blocks) {
    const dark = DARK_THEMES.includes(name);
    assert.equal(luminance(ground) < 0.18, dark, `${name} ground ${ground}`);
    assert.equal(scheme, dark ? 'dark' : 'light', `${name} color-scheme`);
  }
});

test('system mode with the default picks unless chosen; a pick from the other family reads as the default', () => {
  const fresh = preferencesInUse({});
  assert.deepEqual([fresh.theme, fresh.darkTheme, fresh.lightTheme], ['system', 'dark', 'light']);
  const bad = preferencesInUse({ darkTheme: 'paper', lightTheme: 'nord' });
  assert.deepEqual([bad.darkTheme, bad.lightTheme], ['dark', 'light']);
  // A stored copy keeps only what was chosen: picks stay absent until one is made.
  assert.deepEqual(normalizeProfile({ version: 2, preferences: { theme: 'nord' } }).preferences, { theme: 'nord' });
  assert.deepEqual(normalizeProfile({ version: 2, preferences: { theme: 'system', darkTheme: 'terminal' } }).preferences, { theme: 'system', darkTheme: 'terminal' });
});

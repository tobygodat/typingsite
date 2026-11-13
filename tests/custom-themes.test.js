// Custom themes (src/custom-themes.js): what a stored list keeps, the tokens it covers, the contrast notes,
// and the pre-paint script in index.html that wears one before the first frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BASE_TOKENS, MAX_CUSTOM_THEMES, THEME_TOKENS, contrastIssues, normalizeCustomThemes, readCustomThemes, themeMode } from '../src/custom-themes.js';
import { normalizeProfile, preferencesInUse } from '../src/profile.js';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

const block = (selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} is in the stylesheet`);

  return css.slice(start, css.indexOf('}', start));
};

const tokensIn = (body) => [...body.matchAll(/--([\w-]+):/g)].map((match) => match[1]);

const DARK = {
  ground: '#0f0f0e', text: '#ece8e1', muted: '#a39e96', accent: '#8fd18a', danger: '#ff8a6b',
  'accent-ink': '#0f1a0e', warning: '#e0b565', ghost: '#b9c3ff',
};

const theme = (overrides = {}) => ({ id: 'custom-a', name: 'Dusk', colors: { ...DARK }, ...overrides });

test('the editor covers every colour token the built-in themes define, and only those', () => {
  const builtIn = new Set(['dark', 'light', 'paper', 'nord'].flatMap((name) => tokensIn(block(`:root[data-theme="${name}"]`))));
  builtIn.delete('shadow-float');
  assert.deepEqual(THEME_TOKENS.map((token) => token.name).sort(), [...builtIn].sort());
  assert.deepEqual(THEME_TOKENS.filter((token) => token.key).map((token) => token.label), ['background', 'text', 'muted text', 'accent', 'mistakes']);
});

test('every derived tint follows its source in both dark and light unless the theme sets it', () => {
  const shared = tokensIn(block(':root[data-theme][data-custom]'));

  for (const mode of ['dark', 'light']) {
    const derived = new Set([...shared, ...tokensIn(block(`:root[data-theme="${mode}"][data-custom]`))]);

    // The backdrop and word highlight are dark's or light's own; the word highlight already follows --text.
    for (const token of THEME_TOKENS.filter((t) => t.derived && !['backdrop', 'word-highlight'].includes(t.name))) {
      assert.ok(derived.has(token.name), `${token.name} derives in ${mode}`);
    }

    for (const token of derived) assert.ok(THEME_TOKENS.find((t) => t.name === token)?.derived, `${token} is a derived token`);
  }
});

test('a stored list keeps whole themes only: hex for every base token, known tokens, a name, at most five', () => {
  const kept = readCustomThemes(normalizeCustomThemes(JSON.stringify([
    theme({ colors: { ...DARK, danger: 'red' } }),
    theme({ id: 'custom-b', colors: { ...DARK, text: 'nope' } }),
    theme({ id: 'custom-c', name: '   ' }),
    theme({ id: 'dark' }),
  ])));

  assert.deepEqual(kept, []);
  const fixed = readCustomThemes(normalizeCustomThemes([theme({ name: '  Rainy   night ', colors: { ...DARK, accent: '#ABCDEF', 'accent-soft': '#112233', bogus: '#000000' } }), theme()]));
  assert.deepEqual(fixed, [{ id: 'custom-a', name: 'Rainy night', colors: { ...DARK, accent: '#abcdef', 'accent-soft': '#112233' } }]);
  const many = Array.from({ length: 8 }, (_, n) => theme({ id: `custom-${n}` }));
  assert.equal(readCustomThemes(normalizeCustomThemes(many)).length, MAX_CUSTOM_THEMES);
  assert.deepEqual(readCustomThemes('not json'), []);
  assert.equal(normalizeCustomThemes(undefined), '[]');
});

test('the list is stored as text, so older builds compare it by value', () => {
  const stored = normalizeCustomThemes([theme()]);
  const profile = normalizeProfile({ version: 2, preferences: { customThemes: stored, theme: 'custom-a' } });
  assert.equal(profile.preferences.customThemes, stored);
  assert.equal(preferencesInUse({}).customThemes, '[]');
  // A copy that never chose one stores none.
  assert.equal(Object.hasOwn(normalizeProfile({ version: 2, preferences: {} }).preferences, 'customThemes'), false);
  // A theme naming a custom theme the list lacks (deleted elsewhere) stays as chosen; it shows as system.
  assert.equal(preferencesInUse({ theme: 'custom-gone' }).theme, 'custom-gone');
  // So do the dark and light picks; the app shows the mode's default while the list lacks one.
  const picks = preferencesInUse({ darkTheme: 'custom-a', lightTheme: 'custom-b' });
  assert.deepEqual([picks.darkTheme, picks.lightTheme], ['custom-a', 'custom-b']);
});

test('dark or light follows the background, and readability notes name the tokens under AA', () => {
  assert.equal(themeMode(DARK), 'dark');
  assert.equal(themeMode({ ground: '#f4f1eb' }), 'light');
  assert.deepEqual(contrastIssues(DARK), {});
  const issues = contrastIssues({ ...DARK, text: '#333333', muted: '#444444', accent: '#1a1a1a', danger: '#552222' });
  assert.deepEqual(Object.keys(issues).sort(), ['accent', 'danger', 'muted', 'text']);
  assert.ok(issues.text < 4.5 && issues.accent < 3);
  // The caret needs 3:1, not 4.5:1.
  assert.deepEqual(contrastIssues({ ...DARK, accent: '#5b8a58' }), {});
});

// Runs index.html's inline script against a stored session and profile, as a page load would.
function prePaint({ preferences, light = false } = {}) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const style = new Map();
  const root = { dataset: { theme: 'dark' }, style: { setProperty: (name, value) => style.set(name, value) } };

  const storage = {
    'stilltype-session-v1': JSON.stringify({ user: { id: 'u1' } }),
    'stilltype-profile-v2:u1': JSON.stringify({ version: 2, preferences }),
  };

  vm.runInNewContext(script, {
    document: { documentElement: root },
    localStorage: { getItem: (key) => storage[key] ?? null },
    matchMedia: () => ({ matches: light }),
  });

  return { theme: root.dataset.theme, custom: Object.hasOwn(root.dataset, 'custom'), style: Object.fromEntries(style) };
}

test('the pre-paint script wears a saved custom theme before the first frame', () => {
  const light = { ...DARK, ground: '#f4f1eb', text: '#1b1a19' };
  const customThemes = normalizeCustomThemes([theme(), theme({ id: 'custom-b', colors: light })]);
  const dark = prePaint({ preferences: { theme: 'custom-a', customThemes } });
  assert.equal(dark.theme, 'dark');
  assert.ok(dark.custom);
  assert.equal(dark.style['--accent'], DARK.accent);
  assert.equal(Object.keys(dark.style).length, BASE_TOKENS.length);
  assert.equal(prePaint({ preferences: { theme: 'custom-b', customThemes } }).theme, 'light');
  // A built-in theme, a custom one that's gone, or a broken list: the usual choice, with nothing inline.
  assert.deepEqual(prePaint({ preferences: { theme: 'nord', customThemes } }), { theme: 'nord', custom: false, style: {} });
  assert.deepEqual(prePaint({ preferences: { theme: 'custom-gone', customThemes }, light: true }), { theme: 'light', custom: false, style: {} });
  assert.deepEqual(prePaint({ preferences: { theme: 'custom-a', customThemes: '{oops' } }), { theme: 'dark', custom: false, style: {} });
  assert.deepEqual(prePaint({ preferences: { theme: 'system', lightTheme: 'paper', customThemes: '{oops' }, light: true }), { theme: 'paper', custom: false, style: {} });
});

test('in system mode the pre-paint script wears a custom pick for the mode the system is in', () => {
  const light = { ...DARK, ground: '#f4f1eb', text: '#1b1a19' };
  const customThemes = normalizeCustomThemes([theme(), theme({ id: 'custom-b', colors: light })]);
  const preferences = { theme: 'system', darkTheme: 'custom-a', lightTheme: 'custom-b', customThemes };
  const dark = prePaint({ preferences });
  assert.equal(dark.theme, 'dark');
  assert.equal(dark.style['--ground'], DARK.ground);
  const day = prePaint({ preferences, light: true });
  assert.equal(day.theme, 'light');
  assert.equal(day.style['--ground'], light.ground);
  // A pick whose background is in the other mode, or that's gone, reads as the mode's default.
  assert.deepEqual(prePaint({ preferences: { ...preferences, darkTheme: 'custom-b' } }), { theme: 'dark', custom: false, style: {} });
  assert.deepEqual(prePaint({ preferences: { ...preferences, lightTheme: 'custom-gone' }, light: true }), { theme: 'light', custom: false, style: {} });
});

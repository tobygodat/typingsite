import test from 'node:test';
import { settingsMarkup } from './rendered-markup.js';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { APP_FONTS, DEFAULT_FONT, TYPING_FONTS } from '../src/fonts.js';
import { normalizeProfile, preferencesInUse } from '../src/profile.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('typing and app fonts default to Literata and drop unknown values', () => {
  assert.equal(DEFAULT_FONT, 'literata');
  assert.equal(preferencesInUse({}).typingFont, 'literata');
  assert.equal(preferencesInUse({}).appFont, 'literata');
  assert.equal(preferencesInUse({ typingFont: 'jetbrains-mono', appFont: 'inter' }).typingFont, 'jetbrains-mono');
  assert.equal(preferencesInUse({ appFont: 'jetbrains-mono' }).appFont, 'literata');
  assert.equal(preferencesInUse({ typingFont: 'comic-sans' }).typingFont, 'literata');
  const stored = normalizeProfile({ version: 2, preferences: { fontSize: '36' } }).preferences;
  assert.equal(Object.hasOwn(stored, 'typingFont') || Object.hasOwn(stored, 'appFont'), false);
});

test('the paint script, settings and stylesheet offer exactly the fonts src/fonts.js lists', async () => {
  const html = await read('dist/index.html');
  const css = await read('src/styles.css');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

  for (const [key, fonts] of [['typingFont', TYPING_FONTS], ['appFont', APP_FONTS]]) {
    for (const font of [...TYPING_FONTS, 'unknown']) {
      const root = { dataset: {}, style: { setProperty() {} } };
      vm.runInNewContext(script, {
        document: { documentElement: root },
        localStorage: { getItem: (name) => JSON.stringify(name === 'stilltype-session-v1'
          ? { user: { id: 'fonts' } } : { preferences: { [key]: font } }) },
        matchMedia: () => ({ matches: false }),
      });
      assert.equal(root.dataset[key], fonts.includes(font) ? font : undefined, `${key} ${font}`);
    }
  }

  const settings = settingsMarkup();
  const radios = (name) => [...settings.matchAll(/<input\b[^>]*>/g)].flatMap(([input]) => (input.includes(`name="${name}"`) ? [input.match(/\bvalue="([^"]+)"/)[1]] : []));
  assert.deepEqual(radios('typing-font'), TYPING_FONTS);
  assert.deepEqual(radios('app-font'), APP_FONTS);

  for (const font of TYPING_FONTS.filter((id) => id !== DEFAULT_FONT)) assert.match(css, new RegExp(`:root\\[data-typing-font="${font}"\\] \\{ --font-typing: `));

  for (const font of APP_FONTS.filter((id) => id !== DEFAULT_FONT)) assert.match(css, new RegExp(`:root\\[data-app-font="${font}"\\] \\{ --font-app: `));
});

// --font-serif became --font-typing and --font-app; a branch still using an undeclared font token would
// silently drop its whole font declaration.
test('every font token the stylesheet uses is declared', async () => {
  const css = await read('src/styles.css');
  const declared = new Set([...css.matchAll(/(--font-[a-z-]+):/g)].map((match) => match[1]));
  const used = new Set([...css.matchAll(/var\((--font-[a-z-]+)\)/g)].map((match) => match[1]));
  assert.deepEqual([...used].filter((token) => !declared.has(token)), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { settingsMarkup } from './rendered-markup.js';
import { SIDE_BAR_KEY } from '../src/side-bar.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// Runs the inline paint script against a stored session, profile and side bar state, and returns html's dataset.
async function paint({ user = 'ada', preferences = {}, sideBar = null } = {}) {
  const html = await read('dist/index.html');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const root = { dataset: { navigation: 'side', sideBar: 'shown' }, style: { setProperty() {} } };

  const stored = {
    'stilltype-session-v1': user ? JSON.stringify({ user: { id: user } }) : null,
    [`stilltype-profile-v2:${user}`]: JSON.stringify({ preferences }),
    [SIDE_BAR_KEY + user]: sideBar,
  };

  vm.runInNewContext(script, { document: { documentElement: root }, localStorage: { getItem: (name) => stored[name] ?? null }, matchMedia: () => ({ matches: false }) });

  return root.dataset;
}

test('the paint script applies a signed-in person’s navigation and hidden side bar before first paint', async () => {
  assert.deepEqual(await paint(), { navigation: 'side', sideBar: 'shown', theme: 'dark' });
  assert.equal((await paint({ preferences: { navigation: 'top' } })).navigation, 'top');
  assert.equal((await paint({ preferences: { navigation: 'bottom' } })).navigation, 'side');
  assert.equal((await paint({ sideBar: 'hidden' })).sideBar, 'hidden');
  assert.equal((await paint({ sideBar: 'shown' })).sideBar, 'shown');
  // A guest keeps nothing, so a stored state under no one never applies.
  assert.equal((await paint({ user: null, sideBar: 'hidden' })).sideBar, 'shown');
});

test('the document starts with the side bar shown, and settings offer both places', async () => {
  const html = await read('index.html');
  assert.match(html, /<html [^>]*data-navigation="side"[^>]*data-side-bar="shown"/);
  const settings = settingsMarkup();
  const radios = [...settings.matchAll(/<input\b[^>]*name="navigation-select"[^>]*>/g)].map(([input]) => input.match(/\bvalue="([^"]+)"/)[1]);
  assert.deepEqual(radios, ['side', 'top']);
});

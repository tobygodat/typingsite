import test from 'node:test';
import { releaseMarkup } from './rendered-markup.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the footer version and What’s new match the package version', async () => {
  const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
  const html = releaseMarkup();
  const app = await read('../src/app.tsx');
  const pkg = JSON.parse(await read('../package.json'));
  const lock = JSON.parse(await read('../package-lock.json'));
  const version = `v${pkg.version}`;
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  const trigger = app.match(/<button\b[\s\S]*?<\/button>/g)?.find((button) => button.includes('id="release-trigger"'));
  assert.ok(trigger, 'the release trigger is present');
  assert.match(trigger, new RegExp(`aria-label="What’s new in ${version}"`));
  assert.match(trigger, new RegExp(`>${version}</button>`));
  assert.match(html, new RegExp(`<h2 id="release-title">${version}</h2>`));
  const notes = html.match(/<ul class="release-notes">([\s\S]*?)<\/ul>/)[1].match(/<li>/g);
  assert.ok(notes.length >= 1 && notes.length <= 6);
});

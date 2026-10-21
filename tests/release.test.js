import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the footer version and What’s new match the package version', async () => {
  const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
  const html = await read('../index.html');
  const pkg = JSON.parse(await read('../package.json'));
  const lock = JSON.parse(await read('../package-lock.json'));
  const version = `v${pkg.version}`;
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.match(html, new RegExp(`id="release-trigger"[^>]*aria-label="What’s new in ${version}">${version}</button>`));
  assert.match(html, new RegExp(`<h2 id="release-title">${version}</h2>`));
  const notes = html.match(/<ul class="release-notes">([\s\S]*?)<\/ul>/)[1].match(/<li>/g);
  assert.ok(notes.length >= 1 && notes.length <= 6);
});

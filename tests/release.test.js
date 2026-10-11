import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { release } from '../src/release.js';

test('product release has concise notes and matching private package metadata', async () => {
  assert.match(release.version, /^\d+\.\d+\.\d+$/);
  assert.ok(release.notes.length > 0 && release.notes.length <= 6);
  for (const note of release.notes) assert.ok(typeof note === 'string' && note.length > 0 && note.length <= 200);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url)));
  assert.equal(pkg.version, release.version);
  assert.equal(lock.version, release.version);
  assert.equal(lock.packages[''].version, release.version);
});

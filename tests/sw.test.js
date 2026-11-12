import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the built worker precaches the emitted app and leaves optional fonts on demand', async () => {
  const manifest = JSON.parse(await readFile(new URL('../dist/.serve-manifest.json', import.meta.url), 'utf8'));
  const source = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
  const shell = JSON.parse(source.match(/const SHELL = (\[[^;]+\]);/)[1]);

  const expected = ['/', ...manifest.files.filter((file) => file !== 'index.html' && file !== 'sw.js'
    && (!/\.(?:ttf|woff2|txt)$/.test(file) || /\/(?:literata|geist-mono)-/.test(file))).map((file) => `/${file}`)];

  assert.deepEqual([...shell].sort(), [...expected].sort());
  assert.equal(new Set(shell).size, shell.length);
  assert.ok(shell.some((file) => file.endsWith('.js')));
  assert.ok(shell.some((file) => file.endsWith('.css')));
  assert.match(source, /url\.origin !== self\.location\.origin\)/, 'cross-origin requests stay uncached');
  assert.match(source, /FONTS\.includes\(key\)/, 'a picked font is cached once used');
  assert.ok(!source.includes('__SHELL__') && !source.includes('__VERSION__') && !source.includes('__FONTS__'));
  assert.ok(!manifest.files.some((file) => /(?:\.tsx?$|\.map$|^\.serve)/.test(file)));
});

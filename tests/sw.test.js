import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

// sw.js precaches exactly the served app shell: a new module, stylesheet, font or icon must be added there.
test('the service worker precaches every shell file and nothing else', async () => {
  const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const shell = [...source.match(/const SHELL = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const list = async (dir, pattern) => (await readdir(new URL(`../${dir}/`, import.meta.url)))
    .filter((name) => pattern.test(name)).map((name) => `/${dir}/${name}`);
  const expected = [
    '/', '/index.html', '/manifest.webmanifest',
    ...await list('icons', /^[a-z0-9-]+\.(?:svg|png)$/),
    ...await list('src', /^[a-z-]+\.(?:js|css)$/),
    ...await list('src/fonts', /^[a-z0-9-]+\.(?:ttf|woff2)$/),
  ];
  assert.deepEqual([...shell].sort(), [...expected].sort());
  assert.match(source, /url\.origin !== self\.location\.origin\) return;/, 'cross-origin requests stay uncached');
});

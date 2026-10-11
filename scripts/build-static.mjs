// Copies exactly the files server.mjs serves into dist/ for static hosting:
// index.html, src/*.js, src/*.css, the self-hosted fonts and their licence, and the install files.
// Design references (design/), research and project documents stay out of the build.
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'dist');
const matching = async (dir, pattern) => (await readdir(path.join(root, dir)))
  .filter((name) => pattern.test(name))
  .sort()
  .map((name) => `${dir}/${name}`);
const files = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  ...(await matching('icons', /^[a-z0-9-]+\.(?:svg|png)$/)),
  ...(await matching('src', /^[a-z-]+\.(?:js|css)$/)),
  ...(await matching('src/fonts', /^(?:[a-z0-9-]+\.(?:ttf|woff2)|OFL(?:-[a-z]+)?\.txt)$/)),
];

await rm(out, { recursive: true, force: true });
for (const file of files) {
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  await cp(path.join(root, file), path.join(out, file));
}
// A new build gets a new offline cache name, so returning visitors pick up the new shell.
const hash = createHash('sha256');
for (const file of files) hash.update(file).update(await readFile(path.join(out, file)));
const worker = path.join(out, 'sw.js');
await writeFile(worker, (await readFile(worker, 'utf8')).replace("'stilltype-shell-v1'", `'stilltype-shell-${hash.digest('hex').slice(0, 12)}'`));
console.log(`Copied ${files.length} files to dist/`);

// Copies exactly the files server.mjs serves into dist/ for static hosting:
// index.html, src/*.js, src/*.css, the self-hosted fonts and their licence.
// Design references (design/), research and project documents stay out of the build.
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'dist');
const matching = async (dir, pattern) => (await readdir(path.join(root, dir)))
  .filter((name) => pattern.test(name))
  .sort()
  .map((name) => `${dir}/${name}`);
const files = [
  'index.html',
  ...(await matching('src', /^[a-z-]+\.(?:js|css)$/)),
  ...(await matching('src/fonts', /^(?:[a-z0-9-]+\.(?:ttf|woff2)|OFL(?:-[a-z]+)?\.txt)$/)),
];

await rm(out, { recursive: true, force: true });
for (const file of files) {
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  await cp(path.join(root, file), path.join(out, file));
}
console.log(`Copied ${files.length} files to dist/`);

// Copies exactly the files server.mjs serves into dist/ for static hosting.
// Canvas artboards, research and project documents stay out of the build.
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'dist');
const tokens = ['fonts', 'colors', 'typography', 'spacing', 'radius', 'motion', 'code'].map((name) => `design/ash/tokens/${name}.css`);
const appAssets = (await readdir(path.join(root, 'src'))).filter((name) => /^[a-z-]+\.(?:js|css)$/.test(name)).map((name) => `src/${name}`);
const fonts = (await readdir(path.join(root, 'src/fonts'))).filter((name) => /^[a-z0-9-]+\.ttf$/.test(name) || name === 'OFL.txt').map((name) => `src/fonts/${name}`);
const files = ['index.html', 'design/ash/styles.css', 'design/ash/components/components.css', ...tokens, ...appAssets, ...fonts];

await rm(out, { recursive: true, force: true });
for (const file of files) {
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  await cp(path.join(root, file), path.join(out, file));
}
console.log(`Copied ${files.length} files to dist/`);

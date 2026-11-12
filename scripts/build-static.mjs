import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build, transformWithOxc } from 'vite';

const root = process.cwd();
const out = path.join(root, 'dist');

await build({
  configFile: false,
  publicDir: false,
  build: { target: 'es2022', assetsInlineLimit: 0, cssMinify: false, sourcemap: false },
});

for (const file of ['manifest.webmanifest', 'icons', 'src/fonts']) {
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  await cp(path.join(root, file), path.join(out, file), { recursive: true });
}

async function filesIn(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });

  const groups = await Promise.all(entries.map(async (entry) => {
    const name = prefix + entry.name;

    return entry.isDirectory() ? filesIn(path.join(directory, entry.name), `${name}/`) : [name];
  }));

  return groups.flat().sort();
}

const files = await filesIn(out);
const hash = createHash('sha256');

for (const file of files) hash.update(file).update(await readFile(path.join(out, file)));

const version = `stilltype-shell-${hash.digest('hex').slice(0, 12)}`;

const shell = ['/', ...files.filter((file) => file !== 'index.html'
  && (!/\.(?:ttf|woff2|txt)$/.test(file) || /\/(?:literata|geist-mono)-/.test(file))).map((file) => `/${file}`)];

const fonts = files.filter((file) => /\.(?:ttf|woff2)$/.test(file)).map((file) => `/${file}`);

const workerSource = (await readFile(path.join(root, 'src/sw.ts'), 'utf8'))
  .replace('__VERSION__;', `${JSON.stringify(version)};`)
  .replace('__SHELL__;', `${JSON.stringify(shell)};`)
  .replace('__FONTS__;', `${JSON.stringify(fonts)};`);

const worker = (await transformWithOxc(workerSource, 'sw.ts', { target: 'es2022' })).code
  .replace(/\nexport \{\};?\s*$/, '\n');

await writeFile(path.join(out, 'sw.js'), worker);

await writeFile(path.join(out, '.serve-manifest.json'), JSON.stringify({
  version, files: [...files, 'sw.js'], shell, fonts,
}, null, 2));

console.log(`Built ${files.length + 1} files for ${version}`);

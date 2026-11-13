import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../dist/.serve-manifest.json', import.meta.url), 'utf8'));
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

export const buildVersion = manifest.version;
export const appEntry = html.match(/<script\b[^>]*\bsrc="([^"]+)"/)[1];
export const appStyles = manifest.files.filter((file) => file.endsWith('.css')).map((file) => `/${file}`);

const fontNames = manifest.files.filter((file) => file.startsWith('src/fonts/')).map((file) => file.slice('src/fonts/'.length));

export function fontAssetName(url) {
  const path = new URL(url).pathname;
  const file = path.slice(path.lastIndexOf('/') + 1);

  return fontNames.find((name) => file === name || (file.startsWith(name.replace(/\.[^.]+$/, '') + '-') && file.endsWith(name.slice(name.lastIndexOf('.')))));
}

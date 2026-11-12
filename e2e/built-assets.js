import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../dist/.serve-manifest.json', import.meta.url), 'utf8'));
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

export const buildVersion = manifest.version;
export const appEntry = html.match(/<script\b[^>]*\bsrc="([^"]+)"/)[1];
export const appStyles = manifest.files.filter((file) => file.endsWith('.css')).map((file) => `/${file}`);

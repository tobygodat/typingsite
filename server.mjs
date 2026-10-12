import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
// Serves exactly the app: index.html, src/*.js, src/*.css, the self-hosted fonts and their licence,
// plus the install files (manifest.webmanifest, sw.js, icons/).
// scripts/build-static.mjs copies the same set. Design references (design/), docs and everything else 404.
const root = process.cwd();
const servable = /^\/(?:index\.html|manifest\.webmanifest|sw\.js|icons\/[a-z0-9-]+\.(?:svg|png)|src\/[a-z-]+\.(?:js|css)|src\/fonts\/(?:[a-z0-9-]+\.(?:ttf|woff2)|OFL(?:-[a-z]+)?\.txt))$/;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !servable.test(pathname)) { res.writeHead(404).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' }); res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(Number(process.env.PORT || 5173), '0.0.0.0', () => console.log('Stilltype is ready at http://localhost:5173'));

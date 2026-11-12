import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.join(process.cwd(), 'dist');
const manifest = JSON.parse(await readFile(path.join(root, '.serve-manifest.json'), 'utf8'));
const servable = new Set(manifest.files.map((file) => `/${file}`));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const port = Number(process.env.PORT || 5173);

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, '.' + pathname);

    if (!file.startsWith(root + path.sep) || !servable.has(pathname)) {
      res.writeHead(404).end();

      return;
    }

    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Stilltype-Build': manifest.version,
    });
    res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '0.0.0.0', () => console.log(`Stilltype is ready at http://localhost:${port}`));

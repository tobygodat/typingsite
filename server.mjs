import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const designStyles = new Set(['/design/ash/styles.css', '/design/ash/components/components.css', ...['fonts', 'colors', 'typography', 'spacing', 'radius', 'motion', 'code'].map(name => `/design/ash/tokens/${name}.css`)]);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, '.' + pathname);
    const appAsset = /^\/src\/(?:[a-z-]+\.(?:js|css)|fonts\/[a-z0-9-]+\.ttf)$/.test(pathname);
    if (!file.startsWith(root + path.sep) || !(designStyles.has(pathname) || pathname === '/index.html' || appAsset)) { res.writeHead(404).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' }); res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(Number(process.env.PORT || 5173), '0.0.0.0', () => console.log('Stilltype is ready at http://localhost:5173'));

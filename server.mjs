import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const designStyles = new Set(['/design/ash/styles.css', '/design/ash/components/components.css', ...['fonts', 'colors', 'typography', 'spacing', 'radius', 'motion', 'code'].map(name => `/design/ash/tokens/${name}.css`)]);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep) || !(designStyles.has(url.pathname) || ['/index.html', '/src/styles.css', '/src/app.js', '/src/typing.js'].includes(url.pathname === '/' ? '/index.html' : url.pathname))) { res.writeHead(404).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' }); res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(Number(process.env.PORT || 5173), '0.0.0.0', () => console.log('Stilltype is ready at http://localhost:5173'));

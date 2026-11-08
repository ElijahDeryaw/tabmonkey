// Local development: builds dist/ and serves it on http://localhost:5050, rebuilding when public/ changes.
// The app talks to the deployed Worker by default; add ?api=http://localhost:8787 to use `npm run worker` instead.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 5050;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject', '.ttf': 'font/ttf', '.sf2': 'application/octet-stream' };

build();
let timer = null;
fs.watch(path.join(ROOT, 'public'), { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => { try { build({ quiet: true }); console.log('Rebuilt'); } catch (e) { console.error(e.message); } }, 150);
});

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(OUT, decodeURIComponent(url.pathname));
  if (!file.startsWith(OUT)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(data);
  });
}).listen(PORT, () => console.log(`TabMonkey on http://localhost:${PORT}`));

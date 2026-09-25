#!/usr/bin/env node
// 依存ゼロの静的サーバー（開発/プレビュー用）。 `npm run dev` / `npm run preview dist`
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const port = Number(process.env.PORT || 8080);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.includes('..')) { res.writeHead(400); res.end('Bad request'); return; }
    if (p.endsWith('/')) p += 'index.html';
    let full = path.join(root, p);
    try { const st = await stat(full); if (st.isDirectory()) full = path.join(full, 'index.html'); } catch { full = path.join(root, 'index.html'); }
    const data = await readFile(full);
    const ext = path.extname(full);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Cross-Origin-Opener-Policy': 'same-origin' });
    res.end(data);
  } catch (e) { res.writeHead(404); res.end('Not found: ' + req.url); }
});
server.listen(port, () => { console.log(`Voice DAW を配信中: http://localhost:${port}/`); console.log('(マイクを使うには https:// か localhost が必要です。localhost はOKです)'); });

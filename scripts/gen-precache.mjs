// sw.js の PRECACHE_FILES とキャッシュバージョンを自動生成する
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = execSync('git ls-files 2>/dev/null || find . -type f', { cwd: root }).toString();
let files = out.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/^\.\//, ''));
files = files.filter((f) => !f.startsWith('scripts/') && !f.startsWith('.git') && f !== 'sw.js' && f !== 'package-lock.json' && !f.startsWith('dist/') && !f.startsWith('node_modules/') && f !== 'README.md');
files = [...new Set(['index.html', 'manifest.json', ...files])].sort();

const hash = createHash('sha256');
for (const f of files) { try { hash.update(f); hash.update(readFileSync(path.join(root, f))); } catch {} }
const version = hash.digest('hex').slice(0, 12);

const swPath = path.join(root, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
sw = sw.replace(/const CACHE_VERSION = .*;/, `const CACHE_VERSION = ${JSON.stringify(version)};`);
sw = sw.replace(/const PRECACHE_FILES = \[[\s\S]*?\];/, `const PRECACHE_FILES = ${JSON.stringify(files, null, 2)};`);
writeFileSync(swPath, sw);
console.log('sw.js updated: version=' + version + ' files=' + files.length);

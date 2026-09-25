#!/usr/bin/env node
// dist/ に静的公開用ファイル一式をコピーし、Service Worker のプリキャッシュ一覧を更新する。
import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

function listFiles() {
  let out;
  try { out = execSync('git ls-files', { cwd: root }).toString(); } catch { out = execSync('find . -type f', { cwd: root }).toString(); }
  let files = out.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/^\.\//, ''));
  files = files.filter((f) => !f.startsWith('scripts/') && !f.startsWith('.git') && f !== 'package-lock.json' && !f.startsWith('dist/') && !f.startsWith('node_modules/') && f !== 'README.md' && f !== '.gitignore');
  return [...new Set(files)].sort();
}
async function main() {
  await rm(dist, { recursive: true, force: true }); await mkdir(dist, { recursive: true });
  const files = listFiles();
  for (const f of files) { const dest = path.join(dist, f); await mkdir(path.dirname(dest), { recursive: true }); await cp(path.join(root, f), dest); }
  // sw.js のプリキャッシュ一覧を更新
  const hash = createHash('sha256'); const precache = [...new Set(['index.html', 'manifest.json', ...files])].filter((f) => f !== 'sw.js').sort();
  for (const f of precache) { try { hash.update(f); hash.update(await readFile(path.join(dist, f))); } catch {} }
  const version = hash.digest('hex').slice(0, 12);
  let sw = await readFile(path.join(dist, 'sw.js'), 'utf8');
  sw = sw.replace(/const CACHE_VERSION = .*;/, `const CACHE_VERSION = ${JSON.stringify(version)};`);
  sw = sw.replace(/const PRECACHE_FILES = \[[\s\S]*?\];/, `const PRECACHE_FILES = ${JSON.stringify(precache, null, 2)};`);
  await writeFile(path.join(dist, 'sw.js'), sw);
  console.log(`ビルド完了: dist/ (${files.length}ファイル, cache=${version})`);
  console.log('GitHub Pages に公開する場合は dist/ の中身をリポジトリのルート（または docs/）に配置してください。');
}
main().catch((e) => { console.error(e); process.exit(1); });

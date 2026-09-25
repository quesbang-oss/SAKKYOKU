// レンダリングクライアント：Web Workerで実行（使えない場合はメインスレッドで分割実行）
import { getAsset } from '../app.js';
import { bus } from '../utils/bus.js';

let worker = null, workerFailed = false, job = 0; const sent = new Map(), pending = new Map();
function ensureWorker() {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { const p = pending.get(data.job); if (data.type === 'progress') { p && p.onProgress && p.onProgress(data.p); } else if (data.type === 'done') { pending.delete(data.job); p.resolve(data.r); } else if (data.type === 'error') { if (p) { pending.delete(data.job); p.reject(new Error(data.message)); } } };
    worker.onerror = (e) => { console.warn('render worker error', e); workerFailed = true; worker = null; for (const [k, p] of pending) { p.reject(new Error('WORKER_FAILED')); pending.delete(k); } };
  } catch (e) { workerFailed = true; worker = null; }
  return worker;
}
function neededAssets(P) { const ids = new Set(); for (const t of P.tracks) for (const c of t.clips) if (c.assetId) ids.add(c.assetId); if (P.carrierAssetId) ids.add(P.carrierAssetId); return [...ids]; }
export async function renderMix(P, opts = {}) {
  const ids = neededAssets(P);
  if (ensureWorker()) {
    try {
      const list = []; for (const id of ids) { const b = getAsset(id); if (b && sent.get(id) !== b) { list.push({ id, sr: b.sr, ch: b.ch }); sent.set(id, b); } }
      if (list.length) worker.postMessage({ type: 'assets', list });
      const j = ++job; const { onProgress, ...rest } = opts;
      return await new Promise((resolve, reject) => { pending.set(j, { resolve, reject, onProgress }); worker.postMessage({ type: 'render', job: j, project: P, opts: rest }); });
    } catch (e) { if (String(e.message) !== 'WORKER_FAILED') throw e; }
  }
  const { renderProject } = await import('./render.js');
  return renderProject(P, getAsset, { ...opts, yield: true });
}
export function workerAvailable() { return !!worker || !workerFailed; }
bus.on('project:restored', () => {});

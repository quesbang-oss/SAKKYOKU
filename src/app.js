// アプリ全体の状態：プロジェクト・素材・履歴(Undo/Redo)・保存
import { bus } from './utils/bus.js';
import { newProject } from './timeline/project.js';
import { uid, deepClone, debounce } from './utils/util.js';
import { db, kvSet, kvGet } from './storage/db.js';

export const app = { project: newProject(), assets: new Map(), rev: 0, dirty: false, sel: { trackId: null, clipIds: [], assetId: null }, hist: { undo: [], redo: [] }, clipboard: null, lastSaved: 0, ready: false, settings: { autosave: true, countdown: 3, silenceThr: -45, monitorWarned: false } };
const MAX_HIST = 100;
const snap = () => ({ proj: JSON.stringify(app.project), bufs: new Map(app.assets) });
let lastKey = null, lastAt = 0;

// プロジェクトを変更する唯一の入口（Undo対応）。coalesceKey を渡すとスライダー操作などをまとめる
export function mutate(label, fn, coalesceKey) {
  const now = Date.now();
  if (!(coalesceKey && coalesceKey === lastKey && now - lastAt < 900)) { app.hist.undo.push({ label, ...snap() }); if (app.hist.undo.length > MAX_HIST) app.hist.undo.shift(); }
  lastKey = coalesceKey || null; lastAt = now; app.hist.redo = [];
  try { fn(app.project); } catch (e) { console.error(e); const s = app.hist.undo.pop(); if (s) restore(s, false); throw e; }
  touch(label);
}
export function touch(label) { app.rev++; app.dirty = true; app.project.updated = Date.now(); bus.emit('project:changed', label); bus.emit('dirty', true); }
function restore(s, emit = true) { app.project = JSON.parse(s.proj); app.assets = new Map(s.bufs); if (emit) { app.rev++; app.dirty = true; bus.emit('project:restored'); bus.emit('project:changed', 'restore'); bus.emit('dirty', true); } }
export function undo() { const s = app.hist.undo.pop(); if (!s) return false; app.hist.redo.push({ label: s.label, ...snap() }); restore(s); lastKey = null; return s.label; }
export function redo() { const s = app.hist.redo.pop(); if (!s) return false; app.hist.undo.push({ label: s.label, ...snap() }); restore(s); lastKey = null; return s.label; }
export const canUndo = () => app.hist.undo.length > 0;
export const canRedo = () => app.hist.redo.length > 0;

// ---- 素材 ----
export function getAsset(id) { return app.assets.get(id); }
export function assetMeta(id) { return app.project.assets.find((a) => a.id === id); }
export async function addAsset(buf, meta = {}) {
  const id = meta.id || uid('ast');
  const m = { id, name: meta.name || '素材', folder: meta.folder || 'VOICE', tags: meta.tags || [], fav: !!meta.fav, kind: meta.kind || 'voice', created: Date.now() };
  mutate('素材を追加', (P) => { app.assets.set(id, buf); P.assets.push(m); });
  await persistAsset(id); bus.emit('assets:changed'); return id;
}
// 素材データを置き換える（編集操作）。Undo対応：新しいバッファオブジェクトを作る
export async function replaceAsset(id, buf, label = '素材を編集') {
  mutate(label, () => { app.assets.set(id, buf); });
  await persistAsset(id); bus.emit('assets:changed'); bus.emit('asset:edited', id);
}
export async function persistAsset(id) { const b = app.assets.get(id); if (!b) return; try { await db.put('assets', id, { id, sr: b.sr, ch: b.ch }); } catch (e) { bus.emit('storage:error', e); } }
export function removeAsset(id) {
  mutate('素材を削除', (P) => { P.assets = P.assets.filter((a) => a.id !== id); for (const t of P.tracks) t.clips = t.clips.filter((c) => c.assetId !== id); for (const p of P.pads) if (p.assetId === id) p.assetId = null; if (P.sampler.assetId === id) P.sampler.assetId = null; if (P.synth.assetId === id) P.synth.assetId = null; if (P.carrierAssetId === id) P.carrierAssetId = null; app.assets.delete(id); });
  bus.emit('assets:changed');
}

// ---- プロジェクト保存/読込 ----
function projectAssetIds(P) { return P.assets.map((a) => a.id); }
export async function saveProject(name) {
  const P = app.project; if (name) P.name = name; P.updated = Date.now();
  for (const id of projectAssetIds(P)) await persistAsset(id);
  await db.put('projects', P.id, { id: P.id, name: P.name, updated: P.updated, data: JSON.stringify(P), assetIds: projectAssetIds(P) });
  app.dirty = false; app.lastSaved = Date.now(); bus.emit('dirty', false); bus.emit('project:saved'); await kvSet('lastProject', P.id);
}
export async function listProjects() { const all = await db.all('projects'); return all.map((x) => x.value).sort((a, b) => b.updated - a.updated); }
export async function loadProjectById(id) {
  const rec = await db.get('projects', id); if (!rec) throw new Error('プロジェクトが見つかりません');
  const P = JSON.parse(rec.data); const bufs = new Map(); const missing = [];
  for (const a of P.assets) { const r = await db.get('assets', a.id); if (r) bufs.set(a.id, { sr: r.sr, ch: r.ch }); else missing.push(a.name); }
  P.assets = P.assets.filter((a) => bufs.has(a.id));
  applyLoaded(P, bufs); return { missing };
}
export function applyLoaded(P, bufs) {
  const def = newProject(); for (const k of Object.keys(def)) if (P[k] === undefined) P[k] = def[k];
  app.project = P; app.assets = bufs; app.hist = { undo: [], redo: [] }; app.sel = { trackId: P.tracks[0] && P.tracks[0].id, clipIds: [], assetId: null }; app.rev++; app.dirty = false; lastKey = null;
  bus.emit('project:restored'); bus.emit('project:changed', 'load'); bus.emit('assets:changed'); bus.emit('dirty', false);
}
export async function deleteProject(id) { await db.del('projects', id); }
export function newEmpty() { applyLoaded(newProject(), new Map()); }

// ---- バックアップ ----
export async function makeBackup(reason = 'auto') {
  const P = app.project; const key = P.id + ':' + Date.now();
  await db.put('backups', key, { key, pid: P.id, name: P.name, time: Date.now(), reason, data: JSON.stringify(P), assetIds: projectAssetIds(P) });
  const all = (await db.keys('backups')).map(String).filter((k) => k.startsWith(P.id + ':')).sort(); while (all.length > 12) await db.del('backups', all.shift());
}
export async function listBackups() { const all = await db.all('backups'); return all.map((x) => x.value).sort((a, b) => b.time - a.time); }
export async function restoreBackup(key) {
  const rec = await db.get('backups', key); if (!rec) throw new Error('バックアップが見つかりません');
  const P = JSON.parse(rec.data), bufs = new Map(); for (const a of P.assets) { const r = await db.get('assets', a.id); if (r) bufs.set(a.id, { sr: r.sr, ch: r.ch }); }
  P.assets = P.assets.filter((a) => bufs.has(a.id)); applyLoaded(P, bufs); app.dirty = true; bus.emit('dirty', true);
}
export async function autosaveNow() {
  if (!app.dirty) return false; const P = app.project;
  for (const id of projectAssetIds(P)) if (!(await db.get('assets', id))) await persistAsset(id);
  await db.put('projects', P.id, { id: P.id, name: P.name, updated: P.updated, data: JSON.stringify(P), assetIds: projectAssetIds(P), auto: true });
  await kvSet('lastProject', P.id); app.lastSaved = Date.now(); bus.emit('autosaved'); return true;
}
let bkAt = 0;
export function startAutosave() {
  setInterval(async () => { if (!app.settings.autosave) return; try { if (await autosaveNow()) { if (Date.now() - bkAt > 5 * 60 * 1000) { bkAt = Date.now(); await makeBackup('auto'); } } } catch (e) { bus.emit('storage:error', e); } }, 20000);
  window.addEventListener('beforeunload', (e) => { if (app.dirty) { autosaveNow().catch(() => {}); e.preventDefault(); e.returnValue = ''; return ''; } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && app.dirty && app.settings.autosave) autosaveNow().catch(() => {}); });
}
export async function loadLast() { const id = await kvGet('lastProject', null); if (!id) return false; try { await loadProjectById(id); return true; } catch { return false; } }

// ---- プロジェクトファイル(.vdaw) 書き出し/読み込み。素材はPCM16で埋め込み ----
function f32ToB64(a) { const i16 = new Int16Array(a.length); for (let i = 0; i < a.length; i++) { const v = Math.max(-1, Math.min(1, a[i])); i16[i] = v < 0 ? v * 32768 : v * 32767; } const u8 = new Uint8Array(i16.buffer); let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
function b64ToF32(b64) { const s = atob(b64), u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); const i16 = new Int16Array(u8.buffer, 0, u8.length >> 1), f = new Float32Array(i16.length); for (let i = 0; i < i16.length; i++) f[i] = i16[i] / (i16[i] < 0 ? 32768 : 32767); return f; }
export function serializeProject() {
  const P = app.project, assets = {}; for (const a of P.assets) { const b = app.assets.get(a.id); if (b) assets[a.id] = { sr: b.sr, ch: b.ch.map(f32ToB64) }; }
  return JSON.stringify({ format: 'voice-daw-project', version: 1, project: P, assets });
}
export function parseProjectFile(text) {
  const o = JSON.parse(text); if (o.format !== 'voice-daw-project') throw new Error('Voice DAW のプロジェクトファイルではありません');
  const bufs = new Map(); for (const [id, a] of Object.entries(o.assets || {})) bufs.set(id, { sr: a.sr, ch: a.ch.map(b64ToF32) });
  const P = o.project; P.assets = P.assets.filter((a) => bufs.has(a.id)); return { P, bufs };
}
export function selectedTrack() { return app.project.tracks.find((t) => t.id === app.sel.trackId) || app.project.tracks[0]; }
export function setSel(patch) { Object.assign(app.sel, patch); bus.emit('selection'); }

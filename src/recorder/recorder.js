import { engine } from '../audio/engine.js';
import { bus } from '../utils/bus.js';
import { db } from '../storage/db.js';

// 録音（マイク入力または楽器出力）。録音中は約1秒ごとにIndexedDBへ退避してデータ消失を防ぐ
export class Recorder {
  constructor(nodeGetter, { recoverable = true, channelsGetter } = {}) { this.getNode = nodeGetter; this.recoverable = recoverable; this.getChannels = channelsGetter || (() => engine.settings.channels); this.state = 'idle'; this.reset(); this.bound = null; }
  reset() { this.chunks = []; this.frames = 0; this.peaks = []; this.sid = null; this.pending = []; this.pendN = 0; this.blockNo = 0; }
  get seconds() { return this.frames / engine.sr; }
  attach() { const node = this.getNode(); if (this.bound === node) return; this.bound = node; node.port.onmessage = (e) => this.onMsg(e.data); }
  onMsg(d) {
    if (d.type === 'level') bus.emit('rec:level', d, this);
    else if (d.type === 'chunk') {
      if (this.state !== 'recording') return;
      this.chunks.push(d.ch); this.frames += d.ch[0].length;
      let mn = 1, mx = -1; const a = d.ch[0]; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < mn) mn = v; if (v > mx) mx = v; } this.peaks.push([mn, mx]);
      if (this.recoverable) this.persist(d.ch);
      bus.emit('rec:chunk', this);
    }
  }
  async persist(ch) {
    this.pending.push(ch); this.pendN += ch[0].length;
    if (this.pendN >= engine.sr) { const blk = this.pending; this.pending = []; this.pendN = 0; const n = this.blockNo++; try { await db.put('recovery', `${this.sid}:${String(n).padStart(6, '0')}`, blk); } catch (e) { bus.emit('storage:error', e); } }
  }
  async start({ countdown = 0 } = {}) {
    if (this.state !== 'idle') return; this.reset(); this.attach();
    this.sid = 'rec' + Date.now(); this.state = 'countdown'; bus.emit('rec:state', this.state);
    for (let i = countdown; i > 0; i--) { bus.emit('rec:countdown', i); this.beep(i === 1 ? 1320 : 880); await new Promise((r) => setTimeout(r, 1000)); if (this.state !== 'countdown') return; }
    bus.emit('rec:countdown', 0);
    if (this.recoverable) { try { await db.put('recovery', this.sid + ':meta', { sr: engine.sr, channels: this.getChannels(), started: Date.now() }); } catch {} }
    this.state = 'recording'; this.getNode().port.postMessage({ type: 'rec', on: true }); bus.emit('rec:state', this.state);
  }
  beep(f) { try { const c = engine.ctx, o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; g.gain.value = 0.15; g.gain.setTargetAtTime(0, c.currentTime + 0.08, 0.03); o.connect(g); g.connect(engine.master); o.start(); o.stop(c.currentTime + 0.25); } catch {} }
  pause() { if (this.state !== 'recording') return; this.getNode().port.postMessage({ type: 'rec', on: false }); this.state = 'paused'; bus.emit('rec:state', this.state); }
  resume() { if (this.state !== 'paused') return; this.state = 'recording'; this.getNode().port.postMessage({ type: 'rec', on: true }); bus.emit('rec:state', this.state); }
  cancel() { if (this.state === 'countdown') { this.state = 'idle'; bus.emit('rec:state', this.state); return; } this.getNode().port.postMessage({ type: 'rec', on: false }); this.state = 'idle'; this.discard(); bus.emit('rec:state', this.state); }
  async stop() {
    if (this.state === 'countdown') { this.cancel(); return null; }
    if (this.state !== 'recording' && this.state !== 'paused') return null;
    this.getNode().port.postMessage({ type: 'rec', on: false });
    await new Promise((r) => setTimeout(r, 60)); // 最後のチャンクを待つ
    this.state = 'idle'; bus.emit('rec:state', this.state);
    const nch = Math.min(2, Math.max(1, this.getChannels())), total = this.frames, out = Array.from({ length: nch }, () => new Float32Array(total)); let p = 0;
    for (const c of this.chunks) { for (let k = 0; k < nch; k++) out[k].set(c[k], p); p += c[0].length; }
    const buf = { sr: engine.sr, ch: out }; await this.discard(); this.reset(); return total > 0 ? buf : null;
  }
  async discard() { if (!this.recoverable || !this.sid) return; try { const keys = await db.keys('recovery'); for (const k of keys) if (String(k).startsWith(this.sid + ':')) await db.del('recovery', k); } catch {} }
}
// 前回のクラッシュ等で残った録音データの検出・復元
export async function findRecoverable() {
  try {
    const keys = (await db.keys('recovery')).map(String), sids = new Set(keys.map((k) => k.split(':')[0])); const out = [];
    for (const sid of sids) { const meta = await db.get('recovery', sid + ':meta'); const blocks = keys.filter((k) => k.startsWith(sid + ':') && !k.endsWith(':meta')).length; if (meta && blocks > 0) out.push({ sid, meta, blocks }); else if (!meta || !blocks) { for (const k of keys) if (k.startsWith(sid + ':')) await db.del('recovery', k); } }
    return out;
  } catch { return []; }
}
export async function recoverSession(sid) {
  const keys = (await db.keys('recovery')).map(String).filter((k) => k.startsWith(sid + ':') && !k.endsWith(':meta')).sort(), meta = await db.get('recovery', sid + ':meta'); const nch = Math.min(2, meta.channels || 1); const parts = [];
  for (const k of keys) parts.push(await db.get('recovery', k));
  let total = 0; for (const blk of parts) for (const c of blk) total += c[0].length; const out = Array.from({ length: nch }, () => new Float32Array(total)); let p = 0;
  for (const blk of parts) for (const c of blk) { for (let k = 0; k < nch; k++) out[k].set(c[k], p); p += c[0].length; }
  return { sr: meta.sr, ch: out };
}
export async function deleteRecoverable(sid) { const keys = (await db.keys('recovery')).map(String); for (const k of keys) if (k.startsWith(sid + ':')) await db.del('recovery', k); }

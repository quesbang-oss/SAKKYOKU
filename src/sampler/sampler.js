import { engine } from '../audio/engine.js';
import { crossfadeLoop, slice, reverseRange } from '../audio/edit.js';

export const defaultSamplerSettings = () => ({ assetId: null, root: 60, tune: 0, start: 0, end: 1, offset: 0, loop: false, loopStart: 0, loopEnd: 1, xfade: 20, reverse: false, a: 0.005, d: 0.15, s: 0.8, r: 0.25, gain: 0.9 });

const abCache = new Map(); // key -> AudioBuffer
export function toAudioBuffer(buf) { const ab = engine.ctx.createBuffer(buf.ch.length, buf.ch[0].length, buf.sr); buf.ch.forEach((c, i) => ab.copyToChannel(c, i)); return ab; }

// 素材と設定から再生用バッファを作る（キャッシュ付き）
export function prepareRegion(buf, s, cacheKey) {
  const key = cacheKey + '|' + [s.start, s.end, s.offset, s.reverse, s.loop, s.loopStart, s.loopEnd, s.xfade].join(',');
  if (abCache.has(key)) return abCache.get(key);
  const n = buf.ch[0].length; let a = Math.floor(n * s.start) + Math.floor(s.offset * buf.sr), b = Math.floor(n * s.end);
  a = Math.max(0, Math.min(n - 2, a)); b = Math.max(a + 2, Math.min(n, b));
  let reg = slice(buf, a, b), L = reg.ch[0].length, ls = 0, le = L;
  if (s.reverse) reg = reverseRange(reg, 0, L);
  if (s.loop) { ls = Math.floor(L * Math.min(s.loopStart, s.loopEnd - 0.01)); le = Math.max(ls + 16, Math.floor(L * s.loopEnd)); if (s.xfade > 0) reg = crossfadeLoop(reg, ls, le, s.xfade); }
  const r = { ab: toAudioBuffer(reg), ls: ls / buf.sr, le: le / buf.sr };
  if (abCache.size > 40) abCache.delete(abCache.keys().next().value);
  abCache.set(key, r); return r;
}
export function clearRegionCache() { abCache.clear(); }

// 単発/ループ再生（ADSR付き）。戻り値 {stop()}
export function triggerSample(buf, cacheKey, s, { rate = 1, vel = 1, dest, when } = {}) {
  const ctx = engine.ctx, r = prepareRegion(buf, s, cacheKey), src = ctx.createBufferSource(), g = ctx.createGain(), t0 = when ?? ctx.currentTime;
  src.buffer = r.ab; src.playbackRate.value = rate; if (s.loop) { src.loop = true; src.loopStart = r.ls; src.loopEnd = r.le; }
  const peak = Math.max(0.0001, s.gain * vel);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + Math.max(0.001, s.a)); g.gain.setTargetAtTime(peak * s.s, t0 + Math.max(0.001, s.a), Math.max(0.005, s.d / 3));
  src.connect(g); g.connect(dest || engine.instIn); src.start(t0);
  let stopped = false;
  const stop = (immediate) => { if (stopped) return; stopped = true; const t = ctx.currentTime, rel = immediate ? 0.01 : Math.max(0.01, s.r); g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.setTargetAtTime(0, t, rel / 4); try { src.stop(t + rel * 1.5 + 0.05); } catch {} };
  src.onended = () => { try { g.disconnect(); } catch {} handle.ended = true; };
  const handle = { stop, src, ended: false };
  if (!s.loop) { const dur = r.ab.duration / Math.max(0.01, rate); setTimeout(() => { if (!stopped) { stopped = true; } }, dur * 1000); }
  return handle;
}

export class Sampler {
  constructor(getAsset) { this.getAsset = getAsset; this.s = defaultSamplerSettings(); this.voices = new Map(); }
  noteOn(midi, vel = 1) {
    const buf = this.s.assetId && this.getAsset(this.s.assetId); if (!buf) return false;
    this.noteOff(midi, true); if (this.voices.size > 32) { const k = this.voices.keys().next().value; this.noteOff(k, true); }
    const rate = Math.pow(2, (midi - this.s.root + this.s.tune / 100) / 12);
    this.voices.set(midi, triggerSample(buf, this.s.assetId + ':' + buf.ch[0].length, this.s, { rate, vel })); return true;
  }
  noteOff(midi, imm) { const v = this.voices.get(midi); if (v) { v.stop(imm); this.voices.delete(midi); } }
  allOff() { for (const k of [...this.voices.keys()]) this.noteOff(k); }
}

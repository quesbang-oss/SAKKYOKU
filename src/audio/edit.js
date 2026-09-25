import { clamp } from '../utils/util.js';
import { processBuffer, newFx } from '../effects/registry.js';
import { getFFT, hann } from './fft.js';
// buf: {sr, ch:[Float32Array...]}
export const slice = (b, s, e) => ({ sr: b.sr, ch: b.ch.map((c) => c.slice(clamp(s | 0, 0, c.length), clamp(e | 0, 0, c.length))) });
export function concat(bufs) { const sr = bufs[0].sr, nch = Math.max(...bufs.map((b) => b.ch.length)), len = bufs.reduce((a, b) => a + b.ch[0].length, 0), ch = Array.from({ length: nch }, () => new Float32Array(len)); let p = 0; for (const b of bufs) { for (let c = 0; c < nch; c++) ch[c].set(b.ch[c] || b.ch[0], p); p += b.ch[0].length; } return { sr, ch }; }
export function cutRange(b, s, e) { return concat([slice(b, 0, s), slice(b, e, b.ch[0].length)].filter((x) => x.ch[0].length > 0).concat(s === 0 && e >= b.ch[0].length ? [{ sr: b.sr, ch: b.ch.map(() => new Float32Array(0)) }] : [])); }
export function insertAt(b, pos, ins) { const parts = [slice(b, 0, pos), ins, slice(b, pos, b.ch[0].length)].filter((x) => x.ch[0].length > 0); return concat(parts); }
export function applyGain(b, s, e, g) { const o = { sr: b.sr, ch: b.ch.map((c) => new Float32Array(c)) }; for (const c of o.ch) for (let i = s; i < Math.min(e, c.length); i++) c[i] *= g; return o; }
export function silenceRange(b, s, e) { return applyGain(b, s, e, 0); }
export function fade(b, s, e, kind) { const o = { sr: b.sr, ch: b.ch.map((c) => new Float32Array(c)) }, n = Math.max(1, e - s); for (const c of o.ch) for (let i = s; i < Math.min(e, c.length); i++) { const t = (i - s) / n; c[i] *= kind === 'in' ? Math.sin(t * Math.PI / 2) : Math.cos(t * Math.PI / 2); } return o; }
export function reverseRange(b, s, e) { const o = { sr: b.sr, ch: b.ch.map((c) => new Float32Array(c)) }; for (const c of o.ch) { let i = s, j = Math.min(e, c.length) - 1; while (i < j) { const t = c[i]; c[i] = c[j]; c[j] = t; i++; j--; } } return o; }
export function normalize(b, peakDb = -1) { let p = 0; for (const c of b.ch) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i])); if (p < 1e-6) return b; return applyGain(b, 0, b.ch[0].length, Math.pow(10, peakDb / 20) / p); }
export function trimEnds(b, thrDb = -50) { const th = Math.pow(10, thrDb / 20), n = b.ch[0].length; let s = 0, e = n; const lv = (i) => Math.max(...b.ch.map((c) => Math.abs(c[i]))); while (s < n && lv(s) < th) s++; while (e > s && lv(e - 1) < th) e--; return slice(b, Math.max(0, s - 200), Math.min(n, e + 400)); }
export function toMono(b) { if (b.ch.length === 1) return b; const n = b.ch[0].length, m = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (const c of b.ch) s += c[i]; m[i] = s / b.ch.length; } return { sr: b.sr, ch: [m] }; }
export function toStereo(b) { return b.ch.length >= 2 ? b : { sr: b.sr, ch: [b.ch[0], new Float32Array(b.ch[0])] }; }
export function applyEffects(b, fxList, opts) { const st = toStereo(b), out = processBuffer(b.sr, st.ch, fxList, opts); return { sr: b.sr, ch: b.ch.length >= 2 ? out : [out[0]] }; }
export function pitchShiftBuf(b, semi) { return applyEffects(b, [newFx('pitch', { semi: Math.max(-12, Math.min(12, semi)), oct: 0, cents: 0, win: 60 })]); }
// WSOLA タイムストレッチ（ピッチ維持）ratio>1 で長くなる
export function timeStretch(b, ratio) {
  ratio = clamp(ratio, 0.25, 4); if (Math.abs(ratio - 1) < 1e-3) return b;
  return { sr: b.sr, ch: b.ch.map((x) => wsola(x, b.sr, ratio)) };
}
function wsola(x, sr, ratio) {
  const win = Math.round(sr * 0.046) & ~1, hop = win >> 1, hopA = hop / ratio, tol = Math.round(sr * 0.012), outLen = Math.floor(x.length * ratio), out = new Float32Array(outLen + win), norm = new Float32Array(outLen + win), w = hann(win);
  let prev = 0;
  for (let k = 0; ; k++) {
    const o = k * hop; if (o >= outLen) break;
    let pos = Math.round(k * hopA);
    if (k > 0) {
      const target = prev + hop; let best = pos, bs = -Infinity; const lo = Math.max(0, pos - tol), hi = Math.min(x.length - win, pos + tol);
      for (let c = lo; c <= hi; c += 2) { let s = 0; for (let i = 0; i < win; i += 4) s += (x[c + i] || 0) * (x[target + i] || 0); if (s > bs) { bs = s; best = c; } }
      pos = best;
    }
    for (let i = 0; i < win; i++) { const v = x[pos + i] || 0; out[o + i] += v * w[i]; norm[o + i] += w[i]; }
    prev = pos;
  }
  const res = new Float32Array(outLen); for (let i = 0; i < outLen; i++) res[i] = norm[i] > 1e-3 ? out[i] / norm[i] : 0; return res;
}
export function resampleBuf(b, sr) { if (b.sr === sr) return b; return { sr, ch: b.ch.map((c) => { const n = Math.round(c.length * sr / b.sr), o = new Float32Array(n), r = b.sr / sr; for (let i = 0; i < n; i++) { const p = i * r, i0 = Math.floor(p), f = p - i0, a = c[i0] || 0, d = c[Math.min(i0 + 1, c.length - 1)] || 0; o[i] = a + (d - a) * f; } return o; }) }; }
export function crossfadeLoop(b, ls, le, xfMs = 20) { // ループ端をクロスフェードしたバッファを作る
  const xf = Math.min(Math.round(b.sr * xfMs / 1000), ls, le - ls >> 1); if (xf < 8) return b;
  const o = { sr: b.sr, ch: b.ch.map((c) => new Float32Array(c)) };
  for (const c of o.ch) for (let i = 0; i < xf; i++) { const t = i / xf; c[le - xf + i] = c[le - xf + i] * (1 - t) + c[ls - xf + i] * t; }
  return o;
}

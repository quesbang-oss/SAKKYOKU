import { getFFT, hann } from '../audio/fft.js';
import { detectPitch } from './pitch.js';
import { Biquad } from '../effects/core.js';
import { hzToMidi } from '../utils/util.js';
import { NR_N, NR_HOP, NR_BINS } from '../effects/fx-voice.js';

export function peakOf(chs) { let p = 0; for (const c of chs) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > p) p = v; } return p; }
export function rmsOf(x, s = 0, e = x.length) { let r = 0; for (let i = s; i < e; i++) r += x[i] * x[i]; return Math.sqrt(r / Math.max(1, e - s)); }
export function peakPositions(x, sr, count = 8) {
  const win = Math.floor(sr * 0.05), pk = [];
  for (let i = 0; i < x.length; i += win) { let m = 0, mi = i; for (let j = i; j < Math.min(x.length, i + win); j++) { const v = Math.abs(x[j]); if (v > m) { m = v; mi = j; } } pk.push({ i: mi, v: m }); }
  return pk.sort((a, b) => b.v - a.v).slice(0, count).map((p) => ({ t: p.i / sr, db: 20 * Math.log10(p.v + 1e-9) }));
}
export function envelope(x, sr, hopMs = 10) {
  const hop = Math.max(1, Math.round(sr * hopMs / 1000)), n = Math.floor(x.length / hop), e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = rmsOf(x, i * hop, i * hop + hop);
  return { env: e, hop };
}
export function detectSilence(x, sr, thrDb = -45, minMs = 200) {
  const { env, hop } = envelope(x, sr, 10), thr = Math.pow(10, thrDb / 20), segs = []; let st = -1;
  for (let i = 0; i <= env.length; i++) {
    const quiet = i < env.length && env[i] < thr;
    if (quiet && st < 0) st = i; else if (!quiet && st >= 0) { if ((i - st) * hop / sr * 1000 >= minMs) segs.push({ s: st * hop, e: Math.min(x.length, i * hop) }); st = -1; }
  }
  return segs;
}
export function estimateBPM(x, sr) {
  const { env, hop } = envelope(x, sr, 11.6), n = env.length; if (n < 100) return { bpm: 0, conf: 0 };
  const flux = new Float32Array(n); for (let i = 1; i < n; i++) flux[i] = Math.max(0, env[i] - env[i - 1]);
  const fps = sr / hop, minLag = Math.floor((fps * 60) / 200), maxLag = Math.ceil((fps * 60) / 60); let best = 0, bl = 0; const sc = [];
  for (let lag = minLag; lag <= maxLag && lag < n / 2; lag++) { let s = 0; for (let i = lag; i < n; i++) s += flux[i] * flux[i - lag]; s /= n - lag; sc[lag] = s; if (s > best) { best = s; bl = lag; } }
  if (!bl) return { bpm: 0, conf: 0 };
  let bpm = (fps * 60) / bl; while (bpm < 70) bpm *= 2; while (bpm > 180) bpm /= 2;
  let mean = 0, c = 0; for (const s of sc) if (s !== undefined) { mean += s; c++; }
  return { bpm: Math.round(bpm * 10) / 10, conf: Math.min(1, best / (mean / c + 1e-12) / 6) };
}
export function spectrumDb(x, start, N = 2048) {
  const fft = getFFT(N), w = hann(N), re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[start + i] || 0) * w[i];
  fft.transform(re, im); const out = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) out[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / (N / 4) + 1e-9);
  return out;
}
export function computeNoiseProfile(x, s = 0, e = x.length) {
  const fft = getFFT(NR_N), w = hann(NR_N), re = new Float64Array(NR_N), im = new Float64Array(NR_N), acc = new Float64Array(NR_BINS); let cnt = 0;
  for (let p = s; p + NR_N <= e; p += NR_HOP) {
    for (let i = 0; i < NR_N; i++) { re[i] = x[p + i] * w[i]; im[i] = 0; }
    fft.transform(re, im); for (let k = 0; k < NR_BINS; k++) acc[k] += Math.hypot(re[k], im[k]); cnt++;
  }
  if (!cnt) return null; const out = new Float32Array(NR_BINS); for (let k = 0; k < NR_BINS; k++) out[k] = (acc[k] / cnt) * 1.15; return out;
}
export function pitchTrack(x, sr, hopMs = 10) {
  const hop = Math.round(sr * hopMs / 1000), win = 2048 * Math.round(sr / 44100 || 1), out = [];
  for (let p = 0; p + win <= x.length; p += hop) { const r = detectPitch(x, p, win, sr, 65, 1000, 0.15); out.push({ t: (p + win / 2) / sr, f0: r.f0, conf: r.conf, rms: rmsOf(x, p, p + win) }); }
  return out;
}
export function pitchToNotes(track, opts = {}) {
  const minLen = opts.minLen ?? 0.06, minConf = opts.minConf ?? 0.7, notes = []; let cur = null; const hop = track.length > 1 ? track[1].t - track[0].t : 0.01;
  const close = () => { if (cur && cur.end - cur.start >= minLen) { const ms = cur.ms.slice().sort((a, b) => a - b), med = ms[ms.length >> 1]; notes.push({ start: cur.start, dur: cur.end - cur.start, midi: Math.round(med), cents: (med - Math.round(med)) * 100, vel: Math.min(127, Math.round(40 + cur.pk * 400)) }); } cur = null; };
  for (const f of track) {
    const ok = f.f0 > 0 && f.conf >= minConf;
    if (!ok) { if (cur) { cur.gap = (cur.gap || 0) + 1; if (cur.gap > 3) close(); } continue; }
    const m = hzToMidi(f.f0);
    if (cur && Math.abs(m - cur.ref) < 0.7) { cur.ms.push(m); cur.end = f.t + hop / 2; cur.gap = 0; cur.ref = cur.ref * 0.9 + m * 0.1; cur.pk = Math.max(cur.pk, f.rms); }
    else { close(); cur = { start: f.t - hop / 2, end: f.t + hop / 2, ms: [m], ref: m, pk: f.rms }; }
  }
  close(); return notes;
}
// 音節・区切り自動分割（RMS包絡の谷で分割）
export function autoChop(x, sr, sens = 0.5, minMs = 60) {
  const { env, hop } = envelope(x, sr, 5); if (!env.length) return [];
  const sm = new Float32Array(env.length); for (let i = 0; i < env.length; i++) { let s = 0, c = 0; for (let k = -2; k <= 2; k++) { const v = env[i + k]; if (v !== undefined) { s += v; c++; } } sm[i] = s / c; }
  let mx = 0; for (const v of sm) if (v > mx) mx = v; if (mx <= 1e-5) return [];
  const thr = mx * 0.04, ratio = 0.15 + sens * 0.6, minF = Math.round(minMs / 5), segs = []; let st = -1;
  for (let i = 0; i <= sm.length; i++) { const on = i < sm.length && sm[i] > thr; if (on && st < 0) st = i; else if (!on && st >= 0) { segs.push([st, i]); st = -1; } }
  const out = [];
  for (const [a, b] of segs) {
    let s = a; let pk = sm[a], valley = -1, vv = 1e9;
    for (let i = a + 1; i < b; i++) {
      if (sm[i] > pk) { pk = sm[i]; valley = -1; vv = 1e9; }
      if (sm[i] < vv) { vv = sm[i]; valley = i; }
      if (valley > 0 && sm[i] > vv * (1 + (1 - ratio) * 2) && vv < pk * ratio && valley - s >= minF && i - valley >= 2) { out.push([s, valley]); s = valley; pk = sm[i]; valley = -1; vv = 1e9; }
    }
    if (b - s >= 2) out.push([s, b]);
  }
  return out.filter(([s, e]) => e - s >= Math.max(2, minF / 2)).map(([s, e]) => ({ s: Math.max(0, s * hop - Math.round(0.004 * sr)), e: Math.min(x.length, e * hop + Math.round(0.01 * sr)) }));
}
// LUFS(BS.1770 K特性)
function kFilters(sr) { const a = new Biquad().set('hs', 1681.97, 0.7071, 4.0, sr), b = new Biquad().set('hp', 38.13, 0.5, 0, sr); return [a, b]; }
export function integratedLufs(chs, sr) {
  const fl = chs.map(() => kFilters(sr)), blk = Math.round(sr * 0.4), hop = Math.round(sr * 0.1), n = chs[0].length, len = chs.length;
  const z = chs.map((c, ci) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = fl[ci][1].tick(fl[ci][0].tick(c[i])); return o; });
  const ms = []; for (let p = 0; p + blk <= n; p += hop) { let s = 0; for (let ci = 0; ci < len; ci++) { let a = 0; const zz = z[ci]; for (let i = p; i < p + blk; i++) a += zz[i] * zz[i]; s += a / blk; } ms.push(s); }
  const abs = ms.filter((v) => -0.691 + 10 * Math.log10(v + 1e-12) > -70); if (!abs.length) return -Infinity;
  const rel = -0.691 + 10 * Math.log10(abs.reduce((a, b) => a + b, 0) / abs.length) - 10, g = ms.filter((v) => -0.691 + 10 * Math.log10(v + 1e-12) > Math.max(-70, rel));
  return g.length ? -0.691 + 10 * Math.log10(g.reduce((a, b) => a + b, 0) / g.length) : -Infinity;
}
export class LufsMeter { // リアルタイム(モーメンタリー400ms)
  constructor(sr) { this.sr = sr; this.f = [kFilters(sr), kFilters(sr)]; this.n = Math.round(sr * 0.4); this.buf = new Float32Array(this.n); this.p = 0; this.sum = 0; }
  push(L, R) { for (let i = 0; i < L.length; i++) { const a = this.f[0][1].tick(this.f[0][0].tick(L[i])), b = this.f[1][1].tick(this.f[1][0].tick(R[i])), v = a * a + b * b; this.sum += v - this.buf[this.p]; this.buf[this.p] = v; this.p = (this.p + 1) % this.n; } if (this.sum < 0) this.sum = 0; }
  get lufs() { return -0.691 + 10 * Math.log10(this.sum / this.n + 1e-12); }
}

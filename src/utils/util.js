export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-9));
export const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);
const NN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m) => NN[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
export const NOTE_NAMES = NN;
export function fmtTime(sec, ms = true) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  const base = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return ms ? base + '.' + String(Math.floor((sec % 1) * 100)).padStart(2, '0') : base;
}
export const deepClone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export function interpAuto(points, t, def) {
  if (!points || !points.length) return def;
  if (t <= points[0].t) return points[0].v;
  const last = points[points.length - 1];
  if (t >= last.t) return last.v;
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid].t <= t) lo = mid; else hi = mid; }
  const a = points[lo], b = points[hi];
  return a.v + ((b.v - a.v) * (t - a.t)) / Math.max(1e-9, b.t - a.t);
}
export function makeBuf(sr, chs) { return { sr, ch: chs }; }
export function bufDuration(b) { return b && b.ch[0] ? b.ch[0].length / b.sr : 0; }
export function cloneBuf(b) { return { sr: b.sr, ch: b.ch.map((c) => new Float32Array(c)) }; }
export function resampleLinear(data, from, to) {
  if (from === to) return new Float32Array(data);
  const n = Math.max(1, Math.round((data.length * to) / from)), out = new Float32Array(n), r = from / to;
  for (let i = 0; i < n; i++) { const p = i * r, i0 = Math.floor(p), f = p - i0; out[i] = (data[i0] || 0) * (1 - f) + (data[Math.min(i0 + 1, data.length - 1)] || 0) * f; }
  return out;
}

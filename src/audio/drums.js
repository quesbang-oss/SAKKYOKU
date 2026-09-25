// ドラム音源（すべて合成。外部サンプル不要）
export const DRUM_ROWS = [
  { id: 'kick', name: 'Kick', color: '#ff5d73' }, { id: 'snare', name: 'Snare', color: '#ffb02e' }, { id: 'hihat', name: 'Hi-Hat', color: '#4de0c1' },
  { id: 'clap', name: 'Clap', color: '#c084fc' }, { id: 'perc', name: 'Percussion', color: '#5db4ff' }, { id: 'sub808', name: '808', color: '#ff8a5d' }];
const cache = new Map();
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }
function bp(x, f, q, sr) { // 簡易バンドパス(2極)
  const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), cs = Math.cos(w), b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al; let z1 = 0, z2 = 0; const o = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) { const y = (b0 / a0) * x[i] + z1; z1 = (b2 / a0) * x[i] * 0 + z2 - (a1 / a0) * y + 0; z2 = (b2 / a0) * x[i] - (a2 / a0) * y; o[i] = y; } return o;
}
function hp(x, f, sr) { const rc = 1 / (2 * Math.PI * f), a = rc / (rc + 1 / sr); const o = new Float32Array(x.length); let py = 0, px = 0; for (let i = 0; i < x.length; i++) { py = a * (py + x[i] - px); px = x[i]; o[i] = py; } return o; }
export function makeDrum(id, sr) {
  const key = id + sr; if (cache.has(key)) return cache.get(key);
  let out, n, r = rng(id.length * 7919 + 13);
  if (id === 'kick') { n = Math.round(sr * 0.5); out = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr, f = 45 + 120 * Math.exp(-t * 28); ph += (2 * Math.PI * f) / sr; out[i] = Math.tanh(1.6 * Math.sin(ph) * Math.exp(-t * 7)) + (i < 60 ? r() * 0.3 * (1 - i / 60) : 0); } }
  else if (id === 'snare') { n = Math.round(sr * 0.3); const nz = new Float32Array(n); for (let i = 0; i < n; i++) nz[i] = r(); const b = bp(nz, 2200, 0.7, sr); out = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / sr; out[i] = b[i] * 2.2 * Math.exp(-t * 18) + Math.sin(2 * Math.PI * (190 - 60 * t) * t) * Math.exp(-t * 25) * 0.7; } }
  else if (id === 'hihat') { n = Math.round(sr * 0.1); const nz = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / sr; nz[i] = (r() + Math.sign(Math.sin(2 * Math.PI * 7400 * t)) * 0.3) * Math.exp(-t * 55); } out = hp(nz, 6500, sr); for (let i = 0; i < n; i++) out[i] *= 1.4; }
  else if (id === 'clap') { n = Math.round(sr * 0.3); const nz = new Float32Array(n); const bursts = [0, 0.011, 0.023]; for (let i = 0; i < n; i++) { const t = i / sr; let e = 0; for (const b of bursts) if (t >= b && t < b + 0.008) e = Math.max(e, Math.exp(-(t - b) * 200)); e = Math.max(e, t > 0.033 ? Math.exp(-(t - 0.033) * 22) : 0); nz[i] = r() * e; } out = bp(nz, 1400, 0.9, sr); for (let i = 0; i < n; i++) out[i] *= 2.4; }
  else if (id === 'perc') { n = Math.round(sr * 0.35); out = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr, f = 240 + 140 * Math.exp(-t * 30); ph += 2 * Math.PI * f / sr; out[i] = (Math.sin(ph) * Math.exp(-t * 11) + r() * 0.1 * Math.exp(-t * 90)) * 0.9; } }
  else { n = Math.round(sr * 1.4); out = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr, f = 40 + 30 * Math.exp(-t * 12); ph += 2 * Math.PI * f / sr; out[i] = Math.tanh(2.2 * Math.sin(ph)) * Math.exp(-t * 2.4) * 0.9; } }
  let pk = 0; for (const v of out) pk = Math.max(pk, Math.abs(v)); for (let i = 0; i < out.length; i++) out[i] = (out[i] / (pk || 1)) * 0.9;
  const b = { sr, ch: [out] }; cache.set(key, b); return b;
}
export function emptyPattern(name = 'パターン', steps = 16) { const rows = {}; for (const r of DRUM_ROWS) rows[r.id] = new Array(steps).fill(0); return { id: 'pat_' + Math.random().toString(36).slice(2, 8), name, steps, swing: 0, rows }; }
export function defaultPattern() { const p = emptyPattern('基本ビート', 16); [0, 4, 8, 12].forEach((i) => (p.rows.kick[i] = 1)); [4, 12].forEach((i) => (p.rows.snare[i] = 1)); for (let i = 0; i < 16; i += 2) p.rows.hihat[i] = i % 4 === 0 ? 1 : 0.6; p.rows.sub808[0] = 1; p.rows.sub808[10] = 0.7; p.rows.clap[12] = 0.7; return p; }
export function resizePattern(p, steps) { const q = JSON.parse(JSON.stringify(p)); for (const r of DRUM_ROWS) { const a = q.rows[r.id] || []; const o = new Array(steps).fill(0); for (let i = 0; i < steps; i++) o[i] = a[i % a.length] && i < a.length ? a[i] : (steps > a.length ? a[i % a.length] || 0 : 0); q.rows[r.id] = o; } q.steps = steps; return q; }

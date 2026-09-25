// YIN法によるピッチ検出（軽量化のため内部でデシメーション）
export function detectPitch(x, start, len, sr, fmin = 70, fmax = 1100, thr = 0.15) {
  const dec = Math.max(1, Math.floor(sr / 12000)), n = Math.floor(len / dec), srd = sr / dec;
  if (n < 64) return { f0: 0, conf: 0 };
  const y = detectPitch._buf && detectPitch._buf.length >= n ? detectPitch._buf : (detectPitch._buf = new Float32Array(Math.max(n, 2048)));
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < dec; k++) s += x[start + i * dec + k] || 0; y[i] = s / dec; }
  const H = n >> 1, tauMax = Math.min(Math.floor(srd / fmin), H - 1), tauMin = Math.max(2, Math.floor(srd / fmax));
  if (tauMax <= tauMin + 2) return { f0: 0, conf: 0 };
  let e = 0; for (let i = 0; i < n; i++) e += y[i] * y[i];
  if (e / n < 1e-7) return { f0: 0, conf: 0 };
  const d = detectPitch._d && detectPitch._d.length > tauMax + 1 ? detectPitch._d : (detectPitch._d = new Float32Array(tauMax + 64));
  d[0] = 1; let run = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0; for (let j = 0; j < H; j++) { const df = y[j] - y[j + tau]; s += df * df; }
    run += s; d[tau] = run > 0 ? (s * tau) / run : 1;
  }
  let tau = -1;
  for (let t = tauMin; t < tauMax; t++) { if (d[t] < thr) { while (t + 1 < tauMax && d[t + 1] < d[t]) t++; tau = t; break; } }
  if (tau < 0) { let m = 1e9; for (let t = tauMin; t <= tauMax; t++) if (d[t] < m) { m = d[t]; tau = t; } if (m > 0.35) return { f0: 0, conf: 0 }; }
  let better = tau;
  if (tau > 1 && tau < tauMax) { const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a - 2 * b + c; if (Math.abs(den) > 1e-12) better = tau + (a - c) / (2 * den); }
  return { f0: srd / better, conf: Math.max(0, 1 - d[tau]) };
}

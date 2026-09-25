export function fitCanvas(cv) { const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect(), w = Math.max(1, Math.round(r.width * dpr)), hh = Math.max(1, Math.round(r.height * dpr)); if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; } const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); return { c, w: r.width, h: r.height }; }
export const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#4de0c1';
// 波形描画。buf: {sr,ch}, 範囲は秒
export function drawWave(c, buf, x, y, w, h, t0, dur, color, opts = {}) {
  if (!buf || w < 1) return; const sr = buf.sr, ch = buf.ch, nch = opts.mono ? 1 : Math.min(2, ch.length), rowH = h / nch;
  c.fillStyle = color;
  for (let k = 0; k < nch; k++) {
    const d = ch[k], mid = y + rowH * (k + 0.5), amp = rowH * 0.46;
    for (let px = 0; px < w; px++) {
      const a = Math.floor((t0 + (px / w) * dur) * sr), b = Math.floor((t0 + ((px + 1) / w) * dur) * sr); if (b < 0 || a >= d.length) continue;
      const s0 = Math.max(0, a), s1 = Math.min(d.length, Math.max(b, a + 1)), step = Math.max(1, Math.floor((s1 - s0) / 48)); let mn = 1, mx = -1;
      for (let i = s0; i < s1; i += step) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      if (mn > mx) continue; const yy = mid - mx * amp, hh = Math.max(1, (mx - mn) * amp); c.fillRect(x + px, yy, 1, hh);
    }
  }
}
export function drawPeaksLive(c, peaks, w, h, color) { const n = Math.min(peaks.length, Math.floor(w)); c.fillStyle = color; for (let i = 0; i < n; i++) { const p = peaks[peaks.length - n + i], mid = h / 2; c.fillRect(w - n + i, mid - p[1] * mid * 0.95, 1, Math.max(1, (p[1] - p[0]) * mid * 0.95)); } }
export function dbFrac(v) { const db = 20 * Math.log10(Math.max(v, 1e-6)); return Math.max(0, Math.min(1, (db + 60) / 60)); }
// メーター（DOM）
export function makeMeter(label) {
  const el = document.createElement('div'); el.className = 'meter'; el.setAttribute('role', 'img'); el.setAttribute('aria-label', label || '入力メーター');
  el.innerHTML = '<div class="m-rms"></div><div class="m-peak"></div><div class="m-hold"></div>'; const rms = el.children[0], pk = el.children[1], hold = el.children[2]; let hv = 0, ht = 0;
  el.update = (peak, r) => { rms.style.width = dbFrac(r) * 100 + '%'; pk.style.width = dbFrac(peak) * 100 + '%'; const now = performance.now(); if (peak >= hv || now - ht > 1200) { hv = peak; ht = now; } hold.style.left = dbFrac(hv) * 100 + '%'; el.classList.toggle('clip', peak >= 0.98); };
  return el;
}

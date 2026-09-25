import { clamp } from '../utils/util.js';
export const TAU = Math.PI * 2;
export class Effect {
  constructor(sr, params, defs) { this.sr = sr; this.p = {}; for (const d of defs || []) this.p[d.k] = d.def; if (params) Object.assign(this.p, params); this.init && this.init(); }
  setParam(k, v) { this.p[k] = v; this.onParam && this.onParam(k, v); }
  process() {}
  reset() {}
  get latency() { return 0; }
}
export class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(type, f, q, gainDb, sr) {
    f = clamp(f, 10, sr * 0.49); q = Math.max(q, 0.05);
    const w = (TAU * f) / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q), A = Math.pow(10, (gainDb || 0) / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lp': b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case 'hp': b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case 'bp': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case 'notch': b0 = 1; b1 = -2 * cs; b2 = 1; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case 'peak': b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; break;
      case 'ls': { const s = 2 * Math.sqrt(A) * al; b0 = A * (A + 1 - (A - 1) * cs + s); b1 = 2 * A * (A - 1 - (A + 1) * cs); b2 = A * (A + 1 - (A - 1) * cs - s); a0 = A + 1 + (A - 1) * cs + s; a1 = -2 * (A - 1 + (A + 1) * cs); a2 = A + 1 + (A - 1) * cs - s; break; }
      case 'hs': { const s = 2 * Math.sqrt(A) * al; b0 = A * (A + 1 + (A - 1) * cs + s); b1 = -2 * A * (A - 1 + (A + 1) * cs); b2 = A * (A + 1 + (A - 1) * cs - s); a0 = A + 1 - (A - 1) * cs + s; a1 = 2 * (A - 1 - (A + 1) * cs); a2 = A + 1 - (A - 1) * cs - s; break; }
      case 'ap': b0 = 1 - al; b1 = -2 * cs; b2 = 1 + al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      default: b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0; return this;
  }
  tick(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
  run(buf, n) { for (let i = 0; i < n; i++) buf[i] = this.tick(buf[i]); }
  reset() { this.z1 = this.z2 = 0; }
  // 周波数応答の大きさ（EQ表示用）
  mag(f, sr) { const w = (TAU * f) / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = this.b0 + this.b1 * c1 + this.b2 * c2, ni = -(this.b1 * s1 + this.b2 * s2), dr = 1 + this.a1 * c1 + this.a2 * c2, di = -(this.a1 * s1 + this.a2 * s2);
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di)); }
}
export class DelayLine {
  constructor(maxSamples) { this.n = Math.max(4, Math.ceil(maxSamples) + 4); this.buf = new Float32Array(this.n); this.w = 0; }
  write(x) { this.buf[this.w] = x; this.w = (this.w + 1) % this.n; }
  read(d) { // d: サンプル数（小数可）。write後に呼ぶと d=0 が直前の入力
    let p = this.w - 1 - d; while (p < 0) p += this.n;
    const i0 = Math.floor(p), f = p - i0, a = this.buf[i0 % this.n], b = this.buf[(i0 + 1) % this.n];
    return a + (b - a) * f;
  }
  clear() { this.buf.fill(0); this.w = 0; }
}
export class Env { // ピーク/RMS エンベロープフォロワ
  constructor(sr, atk = 5, rel = 80) { this.sr = sr; this.v = 0; this.set(atk, rel); }
  set(atk, rel) { this.a = Math.exp(-1 / (Math.max(0.01, atk) * 0.001 * this.sr)); this.r = Math.exp(-1 / (Math.max(0.01, rel) * 0.001 * this.sr)); }
  tick(x) { x = Math.abs(x); this.v = x > this.v ? this.a * this.v + (1 - this.a) * x : this.r * this.v + (1 - this.r) * x; return this.v; }
}
export class LFO {
  constructor(sr) { this.sr = sr; this.ph = 0; }
  tick(freq, shape = 0) { this.ph += freq / this.sr; if (this.ph >= 1) this.ph -= 1; const p = this.ph;
    return shape === 0 ? Math.sin(TAU * p) : shape === 1 ? 1 - 4 * Math.abs(p - 0.5) : shape === 2 ? (p < 0.5 ? 1 : -1) : 2 * p - 1; }
}
export class Rng { constructor(s = 12345) { this.s = s >>> 0; } next() { this.s = (this.s * 1664525 + 1013904223) >>> 0; return this.s / 4294967296; } }
export const LFO_SHAPES = ['サイン', '三角', '矩形', 'ノコギリ'];
export function softClip(x) { return x > 1 ? 2 / 3 : x < -1 ? -2 / 3 : x - (x * x * x) / 3; }

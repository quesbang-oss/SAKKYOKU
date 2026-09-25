import { Effect, Rng, TAU } from './core.js';
const RING = 4; // 秒
class Ring {
  constructor(sr) { this.n = Math.round(sr * RING); this.b = [new Float32Array(this.n), new Float32Array(this.n)]; this.w = 0; }
  push(l, r) { this.b[0][this.w] = l; this.b[1][this.w] = r; this.w = (this.w + 1) % this.n; }
  at(c, back) { let p = this.w - 1 - back; while (p < 0) p += this.n; return this.b[c][p % this.n]; }
  atf(c, back) { const i0 = Math.floor(back), f = back - i0; return this.at(c, i0) * (1 - f) + this.at(c, i0 + 1) * f; }
}
export class Glitch extends Effect {
  static label = 'グリッチ'; static group = 'グリッチ';
  static defs = [{ k: 'prob', n: '発生確率', min: 0, max: 1, def: 0.5 }, { k: 'len', n: 'スライス長', min: 10, max: 400, def: 90, unit: 'ms' }, { k: 'interval', n: '間隔', min: 50, max: 1500, def: 300, unit: 'ms' }, { k: 'reverse', n: 'リバース率', min: 0, max: 1, def: 0.3 }, { k: 'pitch', n: 'ピッチ乱れ', min: 0, max: 1, def: 0.3 }, { k: 'seed', n: 'シード', min: 1, max: 999, def: 42, step: 1 }];
  init() { this.r = new Ring(this.sr); this.rng = new Rng(this.p.seed); this.t = 0; this.act = null; }
  onParam(k) { if (k === 'seed') this.rng = new Rng(this.p.seed); }
  process(L, R, n) {
    const sr = this.sr, ms = sr / 1000;
    for (let i = 0; i < n; i++) {
      this.r.push(L[i], R[i]);
      if (!this.act && ++this.t >= this.p.interval * ms) {
        this.t = 0;
        if (this.rng.next() < this.p.prob) {
          const len = Math.max(64, Math.round(this.p.len * ms * (0.5 + this.rng.next()))), reps = 2 + Math.floor(this.rng.next() * 5);
          this.act = { len, pos: 0, total: len * reps, rev: this.rng.next() < this.p.reverse, rate: this.rng.next() < this.p.pitch ? Math.pow(2, (this.rng.next() * 2 - 1) * 1) : 1, mute: this.rng.next() < 0.1, snapL: null };
          const a = this.act; a.sl = new Float32Array(len); a.sr = new Float32Array(len);
          for (let k = 0; k < len; k++) { a.sl[k] = this.r.at(0, len - 1 - k); a.sr[k] = this.r.at(1, len - 1 - k); }
        }
      }
      if (this.act) {
        const a = this.act; let p = (a.pos * a.rate) % a.len; if (a.rev) p = a.len - 1 - p; const k = Math.floor(p), f = p - k, k2 = Math.min(a.len - 1, k + 1);
        const fade = Math.min(1, a.pos / 32, (a.total - a.pos) / 32);
        if (a.mute) { L[i] = 0; R[i] = 0; } else { L[i] = (a.sl[k] * (1 - f) + a.sl[k2] * f) * fade + L[i] * (1 - fade); R[i] = (a.sr[k] * (1 - f) + a.sr[k2] * f) * fade + R[i] * (1 - fade); }
        if (++a.pos >= a.total) this.act = null;
      }
    }
  }
}
export class Stutter extends Effect {
  static label = 'スタッター'; static group = 'グリッチ';
  static defs = [{ k: 'slice', n: 'スライス長', min: 10, max: 500, def: 120, unit: 'ms' }, { k: 'every', n: '発動間隔', min: 200, max: 4000, def: 1000, unit: 'ms' }, { k: 'hold', n: '継続時間', min: 50, max: 2000, def: 500, unit: 'ms' }, { k: 'decay', n: '減衰', min: 0, max: 1, def: 0.2 }];
  init() { this.r = new Ring(this.sr); this.t = 0; this.act = null; }
  process(L, R, n) {
    const ms = this.sr / 1000;
    for (let i = 0; i < n; i++) {
      this.r.push(L[i], R[i]);
      if (++this.t >= this.p.every * ms) { this.t = 0; const len = Math.max(32, Math.round(this.p.slice * ms)); this.act = { len, pos: 0, total: this.p.hold * ms, sl: new Float32Array(len), sr: new Float32Array(len) }; for (let k = 0; k < len; k++) { this.act.sl[k] = this.r.at(0, len - 1 - k); this.act.sr[k] = this.r.at(1, len - 1 - k); } }
      if (this.act) { const a = this.act, k = a.pos % a.len, fade = Math.min(1, (k + 1) / 24, (a.len - k) / 24), g = 1 - this.p.decay * (a.pos / a.total); L[i] = a.sl[k] * fade * g + L[i] * (1 - fade); R[i] = a.sr[k] * fade * g + R[i] * (1 - fade); if (++a.pos >= a.total) this.act = null; }
    }
  }
}
export class ReverseFx extends Effect {
  static label = 'リバース'; static group = 'グリッチ';
  static defs = [{ k: 'len', n: 'ブロック長', min: 50, max: 2000, def: 400, unit: 'ms' }];
  init() { this.n = 0; this.a = [new Float32Array(1), new Float32Array(1)]; this.b = [new Float32Array(1), new Float32Array(1)]; this.p0 = 0; this.alloc(); }
  alloc() { this.n = Math.max(64, Math.round(this.p.len * this.sr / 1000)); this.a = [new Float32Array(this.n), new Float32Array(this.n)]; this.b = [new Float32Array(this.n), new Float32Array(this.n)]; this.p0 = 0; }
  onParam(k) { if (k === 'len') this.alloc(); }
  get latency() { return this.n; }
  process(L, R, n) {
    for (let i = 0; i < n; i++) {
      const p = this.p0, ol = this.b[0][this.n - 1 - p], or = this.b[1][this.n - 1 - p], win = Math.min(1, (p + 1) / 48, (this.n - p) / 48);
      this.a[0][p] = L[i]; this.a[1][p] = R[i]; L[i] = ol * win; R[i] = or * win;
      if (++this.p0 >= this.n) { this.p0 = 0; [this.a, this.b] = [this.b, this.a]; }
    }
  }
}
export class Freeze extends Effect {
  static label = 'フリーズ'; static group = 'グリッチ';
  static defs = [{ k: 'every', n: '発動間隔', min: 0.5, max: 10, def: 3, unit: 's' }, { k: 'hold', n: '継続時間', min: 0.1, max: 6, def: 1.2, unit: 's' }, { k: 'size', n: 'グレインサイズ', min: 20, max: 500, def: 120, unit: 'ms' }, { k: 'manual', n: '手動フリーズ', min: 0, max: 1, def: 0, opts: ['自動', 'ON固定'] }];
  init() { this.r = new Ring(this.sr); this.t = 0; this.act = null; }
  process(L, R, n) {
    const sr = this.sr;
    for (let i = 0; i < n; i++) {
      this.r.push(L[i], R[i]); this.t++;
      if (!this.act && (this.p.manual === 1 || this.t >= this.p.every * sr)) { this.t = 0; const len = Math.round(this.p.size * sr / 1000); this.act = { len, pos: 0, total: this.p.manual === 1 ? Infinity : this.p.hold * sr, sl: new Float32Array(len), sr: new Float32Array(len) }; for (let k = 0; k < len; k++) { this.act.sl[k] = this.r.at(0, len - 1 - k); this.act.sr[k] = this.r.at(1, len - 1 - k); } }
      if (this.act) {
        const a = this.act, len = a.len, h = len >> 1, p1 = a.pos % len, p2 = (a.pos + h) % len, w1 = Math.sin(Math.PI * p1 / len) ** 2, w2 = 1 - w1;
        const fo = Math.min(1, (a.total - a.pos) / 256, a.pos / 256);
        L[i] = (a.sl[p1] * w1 + a.sl[p2] * w2) * fo + L[i] * (1 - fo); R[i] = (a.sr[p1] * w1 + a.sr[p2] * w2) * fo + R[i] * (1 - fo);
        if (this.p.manual !== 1 && ++a.pos >= a.total) this.act = null; else if (this.p.manual === 1) a.pos++;
      }
    }
  }
}
export class Granular extends Effect {
  static label = 'グラニュラー'; static group = 'グリッチ';
  static defs = [{ k: 'size', n: 'グレインサイズ', min: 10, max: 300, def: 80, unit: 'ms' }, { k: 'density', n: '密度', min: 2, max: 80, def: 20, unit: '/s' }, { k: 'spread', n: '位置ばらつき', min: 0, max: 2000, def: 400, unit: 'ms' }, { k: 'pitch', n: 'ピッチ乱れ', min: 0, max: 12, def: 3, unit: 'st' }, { k: 'level', n: 'グレイン量', min: 0, max: 1.5, def: 1 }, { k: 'thru', n: '原音', min: 0, max: 1, def: 0.2 }];
  init() { this.r = new Ring(this.sr); this.rng = new Rng(5); this.gr = []; this.t = 0; }
  process(L, R, n) {
    const sr = this.sr, ms = sr / 1000;
    for (let i = 0; i < n; i++) {
      this.r.push(L[i], R[i]);
      if (++this.t >= sr / this.p.density) {
        this.t = 0; if (this.gr.length < 64) { const len = Math.round(this.p.size * ms * (0.7 + this.rng.next() * 0.6)); this.gr.push({ len, pos: 0, off: 200 + this.rng.next() * this.p.spread * ms, rate: Math.pow(2, ((this.rng.next() * 2 - 1) * this.p.pitch) / 12), pan: this.rng.next() }); }
      }
      let ol = 0, orr = 0;
      for (let g = this.gr.length - 1; g >= 0; g--) {
        const G = this.gr[g], w = 0.5 - 0.5 * Math.cos(TAU * G.pos / G.len), back = Math.max(1, G.off - G.pos * (G.rate - 1) + 0), s0 = this.r.atf(0, back), s1 = this.r.atf(1, back);
        ol += s0 * w * (1 - G.pan * 0.6); orr += s1 * w * (0.4 + G.pan * 0.6); if (++G.pos >= G.len) this.gr.splice(g, 1);
      }
      const norm = 1 / Math.sqrt(Math.max(1, (this.p.density * this.p.size) / 1000));
      L[i] = L[i] * this.p.thru + ol * norm * this.p.level; R[i] = R[i] * this.p.thru + orr * norm * this.p.level;
    }
  }
}

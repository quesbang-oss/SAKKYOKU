import { Effect, Biquad, Env, softClip } from './core.js';
import { dbToGain, gainToDb } from '../utils/util.js';

class Bq2 {
  constructor() { this.l = new Biquad(); this.r = new Biquad(); }
  set(t, f, q, g, sr) { this.l.set(t, f, q, g, sr); this.r.set(t, f, q, g, sr); }
  run(L, R, n) { this.l.run(L, n); this.r.run(R, n); }
  reset() { this.l.reset(); this.r.reset(); }
}
export { Bq2 };

export class Gain extends Effect {
  static label = 'ゲイン'; static group = '基本';
  static defs = [{ k: 'gain', n: 'ゲイン', min: -24, max: 24, def: 0, unit: 'dB' }];
  process(L, R, n) { const g = dbToGain(this.p.gain); for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; } }
}

export class NoiseGate extends Effect {
  static label = 'ノイズゲート'; static group = 'ノイズ除去';
  static defs = [
    { k: 'thr', n: 'しきい値', min: -80, max: -10, def: -50, unit: 'dB' }, { k: 'atk', n: 'アタック', min: 0.5, max: 50, def: 3, unit: 'ms' },
    { k: 'hold', n: 'ホールド', min: 0, max: 500, def: 80, unit: 'ms' }, { k: 'rel', n: 'リリース', min: 5, max: 800, def: 120, unit: 'ms' },
    { k: 'floor', n: '減衰量', min: -80, max: 0, def: -60, unit: 'dB' }];
  init() { this.env = new Env(this.sr, 1, 30); this.g = 0; this.holdC = 0; }
  process(L, R, n) {
    const p = this.p, thr = dbToGain(p.thr), fl = dbToGain(p.floor), sr = this.sr;
    const ac = Math.exp(-1 / (p.atk * 0.001 * sr)), rc = Math.exp(-1 / (p.rel * 0.001 * sr)), holdS = p.hold * 0.001 * sr;
    for (let i = 0; i < n; i++) {
      const e = this.env.tick(Math.max(Math.abs(L[i]), Math.abs(R[i])));
      let target;
      if (e > thr) { this.holdC = holdS; target = 1; } else if (this.holdC > 0) { this.holdC--; target = 1; } else target = fl;
      this.g = target > this.g ? ac * this.g + (1 - ac) * target : rc * this.g + (1 - rc) * target;
      L[i] *= this.g; R[i] *= this.g;
    }
  }
}

export class LowCut extends Effect {
  static label = 'ローカット'; static group = 'EQ';
  static defs = [{ k: 'freq', n: '周波数', min: 20, max: 1000, def: 80, unit: 'Hz' }, { k: 'slope', n: '傾斜', min: 0, max: 2, def: 1, opts: ['12dB/oct', '24dB/oct', '36dB/oct'] }];
  init() { this.a = new Bq2(); this.b = new Bq2(); this.c = new Bq2(); this.up(); }
  up() { for (const x of [this.a, this.b, this.c]) x.set('hp', this.p.freq, 0.707, 0, this.sr); }
  onParam() { this.up(); }
  process(L, R, n) { this.a.run(L, R, n); if (this.p.slope >= 1) this.b.run(L, R, n); if (this.p.slope >= 2) this.c.run(L, R, n); }
}
export class HighCut extends Effect {
  static label = 'ハイカット'; static group = 'EQ';
  static defs = [{ k: 'freq', n: '周波数', min: 1000, max: 20000, def: 12000, unit: 'Hz' }, { k: 'slope', n: '傾斜', min: 0, max: 2, def: 1, opts: ['12dB/oct', '24dB/oct', '36dB/oct'] }];
  init() { this.a = new Bq2(); this.b = new Bq2(); this.c = new Bq2(); this.up(); }
  up() { for (const x of [this.a, this.b, this.c]) x.set('lp', this.p.freq, 0.707, 0, this.sr); }
  onParam() { this.up(); }
  process(L, R, n) { this.a.run(L, R, n); if (this.p.slope >= 1) this.b.run(L, R, n); if (this.p.slope >= 2) this.c.run(L, R, n); }
}
export class HumRemove extends Effect {
  static label = 'ハムノイズ除去'; static group = 'ノイズ除去';
  static defs = [{ k: 'base', n: '電源周波数', min: 0, max: 1, def: 0, opts: ['50Hz', '60Hz'] }, { k: 'harm', n: '倍音数', min: 1, max: 6, def: 4, step: 1 }, { k: 'q', n: 'ノッチ幅(Q)', min: 5, max: 80, def: 30 }];
  init() { this.f = []; this.up(); }
  up() { const base = this.p.base ? 60 : 50; this.f = []; for (let i = 1; i <= this.p.harm; i++) { const b = new Bq2(); b.set('notch', base * i, this.p.q, 0, this.sr); this.f.push(b); } }
  onParam() { this.up(); }
  process(L, R, n) { for (const b of this.f) b.run(L, R, n); }
}
class BandEQ extends Effect {
  init() { this.bands = this.spec().map(() => new Bq2()); this.up(); }
  onParam() { this.up(); }
  up() { const s = this.spec(); s.forEach((b, i) => this.bands[i].set(b.t, this.p[b.f] ?? b.fd, this.p[b.q] ?? b.qd ?? 0.9, this.p[b.g], this.sr)); }
  process(L, R, n) { for (const b of this.bands) b.run(L, R, n); }
  response(f) { let m = 1; for (const b of this.bands) m *= b.l.mag(f, this.sr); return m; }
}
export class EQ3 extends BandEQ {
  static label = '3バンドEQ'; static group = 'EQ';
  static defs = [{ k: 'low', n: 'LOW', min: -18, max: 18, def: 0, unit: 'dB' }, { k: 'mid', n: 'MID', min: -18, max: 18, def: 0, unit: 'dB' }, { k: 'high', n: 'HIGH', min: -18, max: 18, def: 0, unit: 'dB' },
    { k: 'lf', n: 'LOW周波数', min: 60, max: 500, def: 200, unit: 'Hz' }, { k: 'mf', n: 'MID周波数', min: 300, max: 4000, def: 1200, unit: 'Hz' }, { k: 'hf', n: 'HIGH周波数', min: 2000, max: 12000, def: 5000, unit: 'Hz' }];
  spec() { return [{ t: 'ls', f: 'lf', g: 'low', q: 'x', qd: 0.7 }, { t: 'peak', f: 'mf', g: 'mid', q: 'x', qd: 0.8 }, { t: 'hs', f: 'hf', g: 'high', q: 'x', qd: 0.7 }]; }
}
export class EQ5 extends BandEQ {
  static label = '5バンドEQ'; static group = 'EQ';
  static defs = [{ k: 'g1', n: '80Hz', min: -18, max: 18, def: 0, unit: 'dB' }, { k: 'g2', n: '250Hz', min: -18, max: 18, def: 0, unit: 'dB' }, { k: 'g3', n: '1kHz', min: -18, max: 18, def: 0, unit: 'dB' }, { k: 'g4', n: '4kHz', min: -18, max: 18, def: 0, unit: 'dB' }, { k: 'g5', n: '12kHz', min: -18, max: 18, def: 0, unit: 'dB' }];
  spec() { return [{ t: 'ls', fd: 80, g: 'g1', qd: 0.7 }, { t: 'peak', fd: 250, g: 'g2', qd: 1 }, { t: 'peak', fd: 1000, g: 'g3', qd: 1 }, { t: 'peak', fd: 4000, g: 'g4', qd: 1 }, { t: 'hs', fd: 12000, g: 'g5', qd: 0.7 }]; }
}
export class ParaEQ extends BandEQ {
  static label = 'パラメトリックEQ'; static group = 'EQ';
  static defs = (() => { const d = [], fs = [100, 500, 2000, 8000]; fs.forEach((f, i) => { const n = i + 1; d.push({ k: 'f' + n, n: `帯域${n} 周波数`, min: 20, max: 20000, def: f, unit: 'Hz' }, { k: 'g' + n, n: `帯域${n} ゲイン`, min: -18, max: 18, def: 0, unit: 'dB' }, { k: 'q' + n, n: `帯域${n} Q`, min: 0.2, max: 12, def: 1 }); }); return d; })();
  spec() { return [1, 2, 3, 4].map((n) => ({ t: 'peak', f: 'f' + n, g: 'g' + n, q: 'q' + n })); }
}

export class Compressor extends Effect {
  static label = 'コンプレッサー'; static group = 'ダイナミクス';
  static defs = [{ k: 'thr', n: 'しきい値', min: -60, max: 0, def: -18, unit: 'dB' }, { k: 'ratio', n: 'レシオ', min: 1, max: 20, def: 3 }, { k: 'atk', n: 'アタック', min: 0.5, max: 100, def: 10, unit: 'ms' }, { k: 'rel', n: 'リリース', min: 10, max: 1000, def: 150, unit: 'ms' }, { k: 'knee', n: 'ニー', min: 0, max: 24, def: 6, unit: 'dB' }, { k: 'makeup', n: 'メイクアップ', min: 0, max: 24, def: 3, unit: 'dB' }];
  init() { this.env = 0; this.gr = 0; }
  process(L, R, n) {
    const p = this.p, ac = Math.exp(-1 / (p.atk * 0.001 * this.sr)), rc = Math.exp(-1 / (p.rel * 0.001 * this.sr)), mk = dbToGain(p.makeup), slope = 1 - 1 / p.ratio;
    for (let i = 0; i < n; i++) {
      const lvl = Math.max(Math.abs(L[i]), Math.abs(R[i])), db = gainToDb(lvl), over = db - p.thr;
      let red = 0;
      if (2 * over < -p.knee) red = 0; else if (2 * Math.abs(over) <= p.knee) red = slope * Math.pow(over + p.knee / 2, 2) / (2 * Math.max(p.knee, 0.001)); else red = slope * over;
      this.env = red > this.env ? ac * this.env + (1 - ac) * red : rc * this.env + (1 - rc) * red;
      const g = dbToGain(-this.env) * mk; this.gr = this.env; L[i] *= g; R[i] *= g;
    }
  }
}
export class Limiter extends Effect {
  static label = 'リミッター'; static group = 'ダイナミクス';
  static defs = [{ k: 'ceil', n: '上限', min: -12, max: 0, def: -1, unit: 'dB' }, { k: 'rel', n: 'リリース', min: 10, max: 500, def: 80, unit: 'ms' }, { k: 'drive', n: 'ドライブ', min: 0, max: 18, def: 0, unit: 'dB' }];
  init() { this.g = 1; this.la = Math.max(16, Math.round(this.sr * 0.002)); this.dl = new Float32Array(this.la); this.dr = new Float32Array(this.la); this.pos = 0; }
  get latency() { return this.la; }
  process(L, R, n) {
    const p = this.p, ceil = dbToGain(p.ceil), dr = dbToGain(p.drive), rc = Math.exp(-1 / (p.rel * 0.001 * this.sr)), la = this.la;
    for (let i = 0; i < n; i++) {
      const xl = L[i] * dr, xr = R[i] * dr, pk = Math.max(Math.abs(xl), Math.abs(xr)), need = pk > ceil ? ceil / pk : 1;
      this.g = need < this.g ? need : rc * this.g + (1 - rc) * need; // 即時アタック
      const ol = this.dl[this.pos], or = this.dr[this.pos]; this.dl[this.pos] = xl; this.dr[this.pos] = xr; this.pos = (this.pos + 1) % la;
      // 先読みバッファ内の最大ピークに対しても下がるよう補正
      L[i] = Math.max(-ceil, Math.min(ceil, ol * this.g)); R[i] = Math.max(-ceil, Math.min(ceil, or * this.g));
    }
  }
}

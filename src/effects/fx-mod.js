import { Effect, TAU, LFO, DelayLine, Biquad, LFO_SHAPES } from './core.js';
import { clamp } from '../utils/util.js';

export class Tremolo extends Effect {
  static label = 'トレモロ'; static group = 'モジュレーション';
  static defs = [{ k: 'rate', n: 'レート', min: 0.1, max: 30, def: 5, unit: 'Hz' }, { k: 'depth', n: '深さ', min: 0, max: 1, def: 0.7 }, { k: 'shape', n: '波形', min: 0, max: 3, def: 0, opts: LFO_SHAPES }];
  init() { this.l = new LFO(this.sr); }
  process(L, R, n) { for (let i = 0; i < n; i++) { const m = 1 - this.p.depth * (0.5 + 0.5 * this.l.tick(this.p.rate, this.p.shape)); L[i] *= m; R[i] *= m; } }
}
export class AutoPan extends Effect {
  static label = 'オートパン'; static group = 'モジュレーション';
  static defs = [{ k: 'rate', n: 'レート', min: 0.05, max: 20, def: 1, unit: 'Hz' }, { k: 'depth', n: '深さ', min: 0, max: 1, def: 0.8 }, { k: 'shape', n: '波形', min: 0, max: 3, def: 0, opts: LFO_SHAPES }];
  init() { this.l = new LFO(this.sr); }
  process(L, R, n) { for (let i = 0; i < n; i++) { const p = this.l.tick(this.p.rate, this.p.shape) * this.p.depth, a = (p + 1) * Math.PI / 4; const m = (L[i] + R[i]) * 0.5; L[i] = m * Math.cos(a) * 1.414; R[i] = m * Math.sin(a) * 1.414; } }
}
export class Phaser extends Effect {
  static label = 'フェイザー'; static group = 'モジュレーション';
  static defs = [{ k: 'rate', n: 'レート', min: 0.05, max: 10, def: 0.5, unit: 'Hz' }, { k: 'depth', n: '深さ', min: 0, max: 1, def: 0.8 }, { k: 'stages', n: '段数', min: 2, max: 12, def: 6, step: 2 }, { k: 'fb', n: 'フィードバック', min: 0, max: 0.9, def: 0.5 }, { k: 'center', n: '中心周波数', min: 200, max: 3000, def: 800, unit: 'Hz' }];
  init() { this.l = new LFO(this.sr); this.ap = [0, 1].map(() => Array.from({ length: 12 }, () => ({ z: 0 }))); this.fbv = [0, 0]; }
  process(L, R, n) {
    const chs = [L, R];
    for (let i = 0; i < n; i++) {
      const m = this.l.tick(this.p.rate), f = this.p.center * Math.pow(2, m * this.p.depth * 2), t = Math.tan(Math.PI * clamp(f, 20, this.sr * 0.45) / this.sr), a = (t - 1) / (t + 1);
      for (let c = 0; c < 2; c++) {
        let x = chs[c][i] + this.fbv[c] * this.p.fb;
        for (let s = 0; s < this.p.stages; s++) { const st = this.ap[c][s], y = a * x + st.z; st.z = x - a * y; x = y; }
        this.fbv[c] = x; chs[c][i] = (chs[c][i] + x) * 0.5;
      }
    }
  }
}
class ModDelay extends Effect {
  init() { this.d = [new DelayLine(this.sr * 0.06), new DelayLine(this.sr * 0.06)]; this.l = new LFO(this.sr); this.fbv = [0, 0]; }
}
export class Flanger extends ModDelay {
  static label = 'フランジャー'; static group = 'モジュレーション';
  static defs = [{ k: 'rate', n: 'レート', min: 0.05, max: 8, def: 0.3, unit: 'Hz' }, { k: 'depth', n: '深さ', min: 0, max: 1, def: 0.7 }, { k: 'delay', n: '基準ディレイ', min: 0.5, max: 8, def: 2, unit: 'ms' }, { k: 'fb', n: 'フィードバック', min: -0.95, max: 0.95, def: 0.6 }];
  process(L, R, n) {
    const chs = [L, R];
    for (let i = 0; i < n; i++) {
      const m = this.l.tick(this.p.rate, 1), dms = this.p.delay * (1 + this.p.depth * m * 0.9), ds = dms * 0.001 * this.sr;
      for (let c = 0; c < 2; c++) { const dl = this.d[c]; dl.write(chs[c][i] + this.fbv[c] * this.p.fb); const w = dl.read(ds); this.fbv[c] = w; chs[c][i] = (chs[c][i] + w) * 0.7; }
    }
  }
}
export class Chorus extends ModDelay {
  static label = 'コーラス'; static group = 'モジュレーション';
  static defs = [{ k: 'rate', n: 'レート', min: 0.05, max: 5, def: 0.8, unit: 'Hz' }, { k: 'depth', n: '深さ', min: 0, max: 1, def: 0.5 }, { k: 'delay', n: '基準ディレイ', min: 8, max: 30, def: 15, unit: 'ms' }, { k: 'voices', n: 'ボイス数', min: 1, max: 3, def: 2, step: 1 }];
  init() { super.init(); this.ls = [0, 1, 2].map((i) => { const l = new LFO(this.sr); l.ph = i / 3; return l; }); }
  process(L, R, n) {
    const chs = [L, R];
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 2; c++) {
        const dl = this.d[c]; dl.write(chs[c][i]); let acc = 0;
        for (let v = 0; v < this.p.voices; v++) { const ph = this.ls[v]; if (c === 0) ph.tick(this.p.rate * (1 + v * 0.13)); const dms = this.p.delay * (1 + this.p.depth * 0.4 * Math.sin(TAU * (ph.ph + c * 0.25))); acc += dl.read(dms * 0.001 * this.sr); }
        chs[c][i] = chs[c][i] * 0.6 + (acc / this.p.voices) * 0.7;
      }
    }
  }
}
export class StereoWidener extends Effect {
  static label = 'ステレオワイドナー'; static group = 'モジュレーション';
  static defs = [{ k: 'width', n: '広がり', min: 0, max: 3, def: 1.5 }, { k: 'haas', n: 'ハース効果', min: 0, max: 30, def: 0, unit: 'ms' }];
  init() { this.d = new DelayLine(this.sr * 0.04); }
  process(L, R, n) {
    for (let i = 0; i < n; i++) {
      const m = (L[i] + R[i]) * 0.5, s = (L[i] - R[i]) * 0.5 * this.p.width; let r = m - s; const l = m + s;
      if (this.p.haas > 0) { this.d.write(r); r = this.d.read(this.p.haas * 0.001 * this.sr); }
      L[i] = l; R[i] = r;
    }
  }
}

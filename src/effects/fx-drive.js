import { Effect, TAU, softClip, LFO } from './core.js';
import { Bq2 } from './fx-basic.js';
import { dbToGain } from '../utils/util.js';

class Shaper extends Effect {
  init() { this.tone = new Bq2(); this.dc = [0, 0, 0, 0]; this.up(); }
  onParam() { this.up(); }
  up() { this.tone.set('lp', this.p.tone, 0.707, 0, this.sr); }
  shape(x) { return x; }
  process(L, R, n) {
    const drive = dbToGain(this.p.drive), lvl = dbToGain(this.p.level);
    for (let i = 0; i < n; i++) { L[i] = this.shape(L[i] * drive); R[i] = this.shape(R[i] * drive); }
    // DCオフセット除去
    for (let i = 0; i < n; i++) { const a = L[i] - this.dc[0] + 0.995 * this.dc[1]; this.dc[0] = L[i]; this.dc[1] = a; L[i] = a; const b = R[i] - this.dc[2] + 0.995 * this.dc[3]; this.dc[2] = R[i]; this.dc[3] = b; R[i] = b; }
    this.tone.run(L, R, n);
    for (let i = 0; i < n; i++) { L[i] *= lvl; R[i] *= lvl; }
  }
}
const DD = [{ k: 'drive', n: 'ドライブ', min: 0, max: 40, def: 12, unit: 'dB' }, { k: 'tone', n: 'トーン', min: 500, max: 18000, def: 8000, unit: 'Hz' }, { k: 'level', n: '出力', min: -24, max: 6, def: -6, unit: 'dB' }];
export class Distortion extends Shaper { static label = 'ディストーション'; static group = '歪み'; static defs = DD; shape(x) { return Math.max(-1, Math.min(1, x * 1.5)) * 0.8 + Math.tanh(x * 3) * 0.2; } }
export class Overdrive extends Shaper { static label = 'オーバードライブ'; static group = '歪み'; static defs = DD.map((d) => ({ ...d })); shape(x) { return Math.tanh(x); } }
export class Fuzz extends Shaper {
  static label = 'ファズ'; static group = '歪み'; static defs = [...DD.map((d) => ({ ...d, def: d.k === 'drive' ? 24 : d.def })), { k: 'gate', n: 'ゲート感', min: 0, max: 0.2, def: 0.02 }];
  shape(x) { const s = x > 0 ? 1 : -1, a = Math.abs(x); return s * (1 - Math.exp(-a * 3)) * (a < this.p.gate ? a / this.p.gate : 1); }
}
export class Saturation extends Shaper { static label = 'サチュレーション'; static group = '歪み'; static defs = DD.map((d) => ({ ...d, def: d.k === 'drive' ? 6 : d.def, ...(d.k === 'level' ? { def: -3 } : {}) })); shape(x) { return softClip(x * 0.9) * 1.1 + 0.1 * Math.sin(x * 2); }}

export class BitCrusher extends Effect {
  static label = 'ビットクラッシャー'; static group = '歪み';
  static defs = [{ k: 'bits', n: 'ビット深度', min: 1, max: 16, def: 6, step: 1 }, { k: 'rate', n: 'サンプルレート比', min: 0.02, max: 1, def: 0.5 }, { k: 'dither', n: 'ディザ', min: 0, max: 1, def: 0 }];
  init() { this.h = [0, 0]; this.c = 0; }
  process(L, R, n) {
    const lv = Math.pow(2, this.p.bits - 1), r = this.p.rate;
    for (let i = 0; i < n; i++) {
      this.c += r;
      if (this.c >= 1) { this.c -= 1; const d = (Math.random() - Math.random()) * this.p.dither / lv; this.h[0] = Math.round((L[i] + d) * lv) / lv; this.h[1] = Math.round((R[i] + d) * lv) / lv; }
      L[i] = this.h[0]; R[i] = this.h[1];
    }
  }
}
export class Downsampler extends Effect {
  static label = 'ダウンサンプラー'; static group = '歪み';
  static defs = [{ k: 'sr', n: '目標サンプルレート', min: 500, max: 24000, def: 8000, unit: 'Hz' }, { k: 'smooth', n: 'スムーズ', min: 0, max: 1, def: 0 }];
  init() { this.h = [0, 0]; this.c = 0; this.s = [0, 0]; }
  process(L, R, n) {
    const step = this.p.sr / this.sr, sm = this.p.smooth * 0.9;
    for (let i = 0; i < n; i++) { this.c += step; if (this.c >= 1) { this.c -= 1; this.h[0] = L[i]; this.h[1] = R[i]; } this.s[0] = this.s[0] * sm + this.h[0] * (1 - sm); this.s[1] = this.s[1] * sm + this.h[1] * (1 - sm); L[i] = this.s[0]; R[i] = this.s[1]; }
  }
}
export class RingMod extends Effect {
  static label = 'リングモジュレーター'; static group = '電子音';
  static defs = [{ k: 'freq', n: '周波数', min: 1, max: 4000, def: 440, unit: 'Hz' }, { k: 'shape', n: '波形', min: 0, max: 3, def: 0, opts: ['サイン', '三角', '矩形', 'ノコギリ'] }, { k: 'lfo', n: 'ゆらぎ', min: 0, max: 1, def: 0 }];
  init() { this.l = new LFO(this.sr); this.v = new LFO(this.sr); }
  process(L, R, n) { for (let i = 0; i < n; i++) { const f = this.p.freq * (1 + this.p.lfo * 0.5 * this.v.tick(5)); const m = this.l.tick(f, this.p.shape); L[i] *= m; R[i] *= m; } }
}
export class FreqShifter extends Effect {
  static label = '周波数シフター'; static group = '電子音';
  static defs = [{ k: 'shift', n: 'シフト量', min: -2000, max: 2000, def: 100, unit: 'Hz' }, { k: 'fb', n: 'フィードバック', min: 0, max: 0.85, def: 0 }];
  init() {
    const N = 63, c = (N - 1) / 2; this.h = new Float32Array(N);
    for (let i = 0; i < N; i++) { const k = i - c; this.h[i] = k % 2 === 0 ? 0 : (2 / (Math.PI * k)) * (0.54 + 0.46 * Math.cos((Math.PI * k) / (c + 1))); }
    this.N = N; this.c = c; this.hist = [new Float32Array(N), new Float32Array(N)]; this.pos = 0; this.ph = 0; this.fbv = [0, 0];
  }
  process(L, R, n) {
    const N = this.N, w = (TAU * this.p.shift) / this.sr, chs = [L, R];
    for (let i = 0; i < n; i++) {
      this.ph += w; if (this.ph > TAU) this.ph -= TAU; else if (this.ph < -TAU) this.ph += TAU;
      const cs = Math.cos(this.ph), sn = Math.sin(this.ph);
      for (let c = 0; c < 2; c++) {
        const hist = this.hist[c]; hist[this.pos] = chs[c][i] + this.fbv[c] * this.p.fb;
        let im = 0; for (let k = 0; k < N; k++) im += this.h[k] * hist[(this.pos - k + N) % N];
        const re = hist[(this.pos - this.c + N) % N];
        const y = re * cs - im * sn; this.fbv[c] = y; chs[c][i] = y;
      }
      this.pos = (this.pos + 1) % N;
    }
  }
  get latency() { return this.c; }
}

import { Effect, TAU, DelayLine, Biquad, Env, LFO, Rng } from './core.js';
import { StreamSTFT } from '../audio/fft.js';
import { detectPitch } from '../analysis/pitch.js';
import { hzToMidi, midiToHz, clamp } from '../utils/util.js';

export const NR_N = 1024, NR_HOP = 256, NR_BINS = NR_N / 2 + 1;

export class NoiseReduce extends Effect {
  static label = 'ノイズ抑制'; static group = 'ノイズ除去';
  static defs = [
    { k: 'strength', n: '抑制量', min: 0, max: 1, def: 0.6 },
    { k: 'mode', n: 'ノイズ推定', min: 0, max: 1, def: 0, opts: ['自動推定', 'プロファイル使用'] },
    { k: 'quality', n: '声の保護', min: 0, max: 1, def: 1, opts: ['OFF', 'ON(品質保持)'] },
    { k: 'smooth', n: 'スムージング', min: 0, max: 0.95, def: 0.6 }];
  init() {
    this.profile = null; this.st = [0, 1].map((c) => ({ min: new Float32Array(NR_BINS).fill(1e-3), sm: new Float32Array(NR_BINS), g: new Float32Array(NR_BINS).fill(1), init: false }));
    this.stft = [0, 1].map((c) => new StreamSTFT(NR_N, NR_HOP, (re, im) => this.frame(re, im, this.st[c])));
    this.tmp = new Float32Array(8192);
  }
  setResource(name, data) { if (name === 'noise') this.profile = data && data.length === NR_BINS ? Float32Array.from(data) : null; }
  get latency() { return NR_N; }
  reset() { this.stft.forEach((s) => s.reset()); }
  frame(re, im, st) {
    const p = this.p, K = NR_BINS, useProf = p.mode === 1 && this.profile, alpha = 1 + p.strength * 3.2, floor = 0.02 + (1 - p.strength) * (p.quality ? 0.28 : 0.15), sm = p.smooth;
    const mag = this._mag || (this._mag = new Float32Array(K)), g = this._g || (this._g = new Float32Array(K));
    for (let k = 0; k < K; k++) mag[k] = Math.hypot(re[k], im[k]);
    for (let k = 0; k < K; k++) {
      let noise;
      if (useProf) noise = this.profile[k];
      else { // 最小値追跡による自動推定
        st.sm[k] = st.init ? st.sm[k] * 0.9 + mag[k] * 0.1 : mag[k];
        if (!st.init || st.sm[k] < st.min[k]) st.min[k] = st.sm[k]; else st.min[k] *= 1.0015;
        noise = st.min[k] * 1.6;
      }
      let gg = 1 - (alpha * noise) / (mag[k] + 1e-9);
      if (p.quality && mag[k] > noise * 6) gg = Math.max(gg, 0.85 + 0.15 * (1 - p.strength));
      g[k] = gg < floor ? floor : gg > 1 ? 1 : gg;
    }
    st.init = true;
    for (let k = 0; k < K; k++) { const a = g[Math.max(0, k - 1)], c = g[Math.min(K - 1, k + 1)], f = 0.5 * g[k] + 0.25 * (a + c); st.g[k] = st.g[k] * sm + f * (1 - sm); }
    for (let k = 0; k < K; k++) { const gk = st.g[k]; re[k] *= gk; im[k] *= gk; if (k > 0 && k < K - 1) { re[NR_N - k] *= gk; im[NR_N - k] *= gk; } }
  }
  process(L, R, n) {
    if (this.tmp.length < n) this.tmp = new Float32Array(n);
    this.tmp.set(L.subarray(0, n)); this.stft[0].process(this.tmp, L, n);
    this.tmp.set(R.subarray(0, n)); this.stft[1].process(this.tmp, R, n);
  }
}

// 二重ディレイ線方式のピッチシフタ（1ch）
export class PShift {
  constructor(sr, winMs = 45) { this.W = Math.round(sr * winMs / 1000); this.d = new DelayLine(this.W * 2 + 8); this.ph = 0; }
  tick(x, ratio) {
    this.d.write(x);
    this.ph += 1 - ratio; const W = this.W; while (this.ph < 0) this.ph += W; while (this.ph >= W) this.ph -= W;
    const p1 = this.ph, p2 = (this.ph + W / 2) % W;
    const w1 = Math.sin((Math.PI * p1) / W) ** 2, w2 = Math.sin((Math.PI * p2) / W) ** 2;
    return this.d.read(p1 + 1) * w1 + this.d.read(p2 + 1) * w2;
  }
}
export class PitchShift extends Effect {
  static label = 'ピッチシフト'; static group = 'ピッチ・フォルマント';
  static defs = [{ k: 'oct', n: 'オクターブ', min: -2, max: 2, def: 0, step: 1 }, { k: 'semi', n: '半音', min: -12, max: 12, def: 0, step: 1, unit: 'st' }, { k: 'cents', n: '微調整', min: -100, max: 100, def: 0, unit: 'cent' }, { k: 'win', n: 'ウィンドウ', min: 20, max: 100, def: 45, unit: 'ms' }];
  init() { this.s = [new PShift(this.sr, this.p.win), new PShift(this.sr, this.p.win)]; }
  onParam(k) { if (k === 'win') this.init(); }
  get latency() { return Math.round(this.s[0].W / 2); }
  process(L, R, n) {
    const r = Math.pow(2, this.p.oct + this.p.semi / 12 + this.p.cents / 1200);
    if (Math.abs(r - 1) < 1e-6) return;
    for (let i = 0; i < n; i++) { L[i] = this.s[0].tick(L[i], r); R[i] = this.s[1].tick(R[i], r); }
  }
}
export class Formant extends Effect {
  static label = 'フォルマントシフト'; static group = 'ピッチ・フォルマント';
  static defs = [{ k: 'shift', n: 'フォルマント', min: -12, max: 12, def: 0, unit: 'st' }, { k: 'smooth', n: '包絡の粗さ', min: 4, max: 40, def: 16, step: 1 }];
  init() {
    this.stft = [0, 1].map(() => new StreamSTFT(1024, 256, (re, im) => this.frame(re, im)));
    this.tmp = new Float32Array(4096);
  }
  get latency() { return 1024; }
  frame(re, im) {
    const N = 1024, K = 513, ratio = Math.pow(2, this.p.shift / 12); if (Math.abs(ratio - 1) < 1e-4) return;
    const mag = this._m || (this._m = new Float32Array(K)), env = this._e || (this._e = new Float32Array(K)), cs = this._c || (this._c = new Float32Array(K + 1)), w = this.p.smooth | 0;
    for (let k = 0; k < K; k++) mag[k] = Math.hypot(re[k], im[k]);
    cs[0] = 0; for (let k = 0; k < K; k++) cs[k + 1] = cs[k] + mag[k];
    for (let k = 0; k < K; k++) { const a = Math.max(0, k - w), b = Math.min(K, k + w + 1); env[k] = (cs[b] - cs[a]) / (b - a) + 1e-9; }
    for (let k = 1; k < K - 1; k++) {
      const src = k / ratio, i0 = Math.floor(src), f = src - i0, e2 = i0 + 1 < K ? env[i0] * (1 - f) + env[i0 + 1] * f : env[K - 1];
      const g = Math.min(8, Math.max(0.02, e2 / env[k]));
      re[k] *= g; im[k] *= g; re[N - k] = re[k]; im[N - k] = -im[k];
    }
  }
  process(L, R, n) {
    if (this.tmp.length < n) this.tmp = new Float32Array(n);
    this.tmp.set(L.subarray(0, n)); this.stft[0].process(this.tmp, L, n);
    this.tmp.set(R.subarray(0, n)); this.stft[1].process(this.tmp, R, n);
  }
}
const SCALES = { 0: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 1: [0, 2, 4, 5, 7, 9, 11], 2: [0, 2, 3, 5, 7, 8, 10], 3: [0, 2, 4, 7, 9], 4: [0, 3, 5, 7, 10] };
export class AutoTune extends Effect {
  static label = 'オートチューン'; static group = 'ピッチ・フォルマント';
  static defs = [{ k: 'key', n: 'キー', min: 0, max: 11, def: 0, opts: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] }, { k: 'scale', n: 'スケール', min: 0, max: 4, def: 1, opts: ['クロマチック', 'メジャー', 'マイナー', 'ペンタトニック', 'マイナーペンタ'] }, { k: 'speed', n: '補正スピード', min: 0, max: 1, def: 0.6 }, { k: 'amount', n: '補正量', min: 0, max: 1, def: 1 }];
  static hard = false;
  init() { this.s = [new PShift(this.sr, 35), new PShift(this.sr, 35)]; this.hist = new Float32Array(2048); this.hp = 0; this.cnt = 0; this.ratio = 1; this.target = 1; this.win = new Float32Array(1536); }
  get latency() { return Math.round(this.s[0].W / 2); }
  detect() {
    const N = 1536; for (let i = 0; i < N; i++) this.win[i] = this.hist[(this.hp - N + i + 2048) % 2048];
    const { f0, conf } = detectPitch(this.win, 0, N, this.sr, 80, 900, 0.18);
    if (f0 > 0 && conf > 0.6) {
      const m = hzToMidi(f0), sc = SCALES[this.p.scale], k = this.p.key; let best = m, bd = 99;
      for (let o = Math.floor(m / 12) - 1; o <= Math.floor(m / 12) + 1; o++) for (const d of sc) { const cand = o * 12 + ((d + k) % 12); const dist = Math.abs(cand - m); if (dist < bd) { bd = dist; best = cand; } }
      this.target = Math.pow(2, ((best - m) * this.p.amount) / 12);
    } else this.target = 1 + (this.target - 1) * 0.9;
  }
  process(L, R, n) {
    const coef = 1 - Math.pow(0.001, 1 / (this.sr * (0.002 + (1 - this.p.speed) * 0.25)));
    for (let i = 0; i < n; i++) {
      this.hist[this.hp] = (L[i] + R[i]) * 0.5; this.hp = (this.hp + 1) % 2048;
      if (++this.cnt >= 384) { this.cnt = 0; this.detect(); }
      this.ratio += (this.target - this.ratio) * coef;
      L[i] = this.s[0].tick(L[i], this.ratio); R[i] = this.s[1].tick(R[i], this.ratio);
    }
  }
}
export class HardTune extends AutoTune {
  static label = 'ハードチューン(ケロケロ)'; static group = 'ピッチ・フォルマント';
  static defs = AutoTune.defs.map((d) => (d.k === 'speed' ? { ...d, def: 1 } : d.k === 'scale' ? { ...d, def: 0 } : d));
}
export class Robot extends Effect {
  static label = 'ロボットボイス'; static group = 'ピッチ・フォルマント';
  static defs = [{ k: 'freq', n: '基音', min: 40, max: 500, def: 120, unit: 'Hz' }, { k: 'fb', n: '共鳴', min: 0, max: 0.95, def: 0.7 }, { k: 'ring', n: 'リング量', min: 0, max: 1, def: 0.4 }];
  init() { this.d = [new DelayLine(this.sr / 30), new DelayLine(this.sr / 30)]; this.lfo = new LFO(this.sr); }
  process(L, R, n) {
    const ds = this.sr / this.p.freq, chs = [L, R];
    for (let i = 0; i < n; i++) { const m = this.lfo.tick(this.p.freq); for (let c = 0; c < 2; c++) { const x = chs[c][i], w = this.d[c].read(ds - 1); const y = x + w * this.p.fb; this.d[c].write(y); chs[c][i] = (y * (1 - this.p.ring) + x * m * this.p.ring * 1.5) * 0.6; } }
  }
}
export class Vocoder extends Effect {
  static label = 'ボコーダー'; static group = 'ボコーダー';
  static defs = [
    { k: 'bands', n: 'バンド数', min: 6, max: 32, def: 16, step: 1 },
    { k: 'carrier', n: 'キャリア音', min: 0, max: 5, def: 0, opts: ['ノコギリ波(内蔵シンセ)', '矩形波(内蔵シンセ)', 'ノイズ', '和音(内蔵シンセ)', '外部音声(素材)', 'ストリング風'] },
    { k: 'note', n: 'キャリア音程', min: 24, max: 84, def: 48, step: 1, unit: 'note' },
    { k: 'rel', n: 'リリース', min: 5, max: 200, def: 30, unit: 'ms' }, { k: 'sib', n: '子音強調', min: 0, max: 1, def: 0.4 }, { k: 'mix', n: 'ボコーダー量', min: 0, max: 1, def: 1 }, { k: 'gain', n: '出力', min: 0, max: 4, def: 1.5 }];
  init() { this.res = null; this.rpos = 0; this.ph = [0, 0, 0, 0]; this.rng = new Rng(3); this.build(); }
  setResource(name, data) { if (name === 'carrier') { this.res = data; this.rpos = 0; } }
  onParam(k) { if (k === 'bands' || k === 'rel') this.build(); }
  build() {
    const B = this.p.bands | 0, lo = 110, hi = Math.min(8000, this.sr * 0.42); this.bm = []; this.bc = []; this.env = [];
    for (let b = 0; b < B; b++) {
      const f = lo * Math.pow(hi / lo, (b + 0.5) / B), q = Math.max(2, B / 3.2);
      this.bm.push([new Biquad().set('bp', f, q, 0, this.sr), new Biquad().set('bp', f, q, 0, this.sr)]);
      this.bc.push([new Biquad().set('bp', f, q, 0, this.sr), new Biquad().set('bp', f, q, 0, this.sr)]);
      this.env.push(new Env(this.sr, 2, this.p.rel));
    }
    this.hp = new Biquad().set('hp', 5500, 0.7, 0, this.sr); this.sibEnv = new Env(this.sr, 1, 20);
  }
  carrierSample() {
    const p = this.p, f = midiToHz(p.note), dt = f / this.sr, ph = this.ph;
    const saw = (x) => 2 * (x - Math.floor(x)) - 1;
    switch (p.carrier | 0) {
      case 0: ph[0] = (ph[0] + dt) % 1; return saw(ph[0]) * 0.6 + saw((ph[1] = (ph[1] + dt * 1.004) % 1)) * 0.4;
      case 1: ph[0] = (ph[0] + dt) % 1; return ph[0] < 0.5 ? 0.7 : -0.7;
      case 2: return this.rng.next() * 2 - 1;
      case 3: { let s = 0; const r = [1, 1.25992, 1.49831, 2]; for (let i = 0; i < 4; i++) { ph[i] = (ph[i] + dt * r[i]) % 1; s += saw(ph[i]) * 0.3; } return s; }
      case 4: { if (!this.res || !this.res.length) return 0; const v = this.res[this.rpos]; this.rpos = (this.rpos + 1) % this.res.length; return v; }
      default: { let s = 0; for (let i = 0; i < 4; i++) { ph[i] = (ph[i] + dt * (1 + (i - 1.5) * 0.006)) % 1; s += saw(ph[i]) * 0.25; } return s; }
    }
  }
  process(L, R, n) {
    const B = this.bm.length, p = this.p;
    for (let i = 0; i < n; i++) {
      const m = (L[i] + R[i]) * 0.5, c = this.carrierSample(); let out = 0;
      for (let b = 0; b < B; b++) {
        const ma = this.bm[b][1].tick(this.bm[b][0].tick(m)), e = this.env[b].tick(ma), ca = this.bc[b][1].tick(this.bc[b][0].tick(c));
        out += ca * e * 6;
      }
      const sibE = this.sibEnv.tick(this.hp.tick(m)); out += (this.rng.next() * 2 - 1) * sibE * p.sib * 3;
      const y = out * p.gain * (1 / Math.sqrt(B / 8));
      const o = y * p.mix + m * (1 - p.mix); L[i] = o; R[i] = o;
    }
  }
}

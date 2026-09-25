import { Effect, TAU, DelayLine, LFO, Rng, softClip } from './core.js';
import { Bq2 } from './fx-basic.js';
import { Biquad } from './core.js';

export class Delay extends Effect {
  static label = 'ディレイ'; static group = '空間系';
  static defs = [{ k: 'time', n: 'タイム', min: 10, max: 1500, def: 350, unit: 'ms' }, { k: 'fb', n: 'フィードバック', min: 0, max: 0.95, def: 0.4 }, { k: 'tone', n: 'トーン', min: 500, max: 16000, def: 6000, unit: 'Hz' }, { k: 'level', n: 'ディレイ量', min: 0, max: 1, def: 0.5 }];
  init() { this.d = [new DelayLine(this.sr * 2), new DelayLine(this.sr * 2)]; this.lp = [new Biquad(), new Biquad()]; this.up(); }
  onParam() { this.up(); }
  up() { this.lp.forEach((l) => l.set('lp', this.p.tone, 0.707, 0, this.sr)); }
  process(L, R, n) {
    const ds = this.p.time * 0.001 * this.sr, chs = [L, R];
    for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) { const w = this.d[c].read(ds), x = chs[c][i]; this.d[c].write(x + this.lp[c].tick(w) * this.p.fb); chs[c][i] = x + w * this.p.level; }
  }
}
export class PingPong extends Effect {
  static label = 'ピンポンディレイ'; static group = '空間系';
  static defs = [{ k: 'time', n: 'タイム', min: 10, max: 1500, def: 300, unit: 'ms' }, { k: 'fb', n: 'フィードバック', min: 0, max: 0.95, def: 0.5 }, { k: 'tone', n: 'トーン', min: 500, max: 16000, def: 7000, unit: 'Hz' }, { k: 'level', n: 'ディレイ量', min: 0, max: 1, def: 0.5 }];
  init() { this.d = [new DelayLine(this.sr * 2), new DelayLine(this.sr * 2)]; this.lp = [new Biquad(), new Biquad()]; this.up(); }
  onParam() { this.up(); }
  up() { this.lp.forEach((l) => l.set('lp', this.p.tone, 0.707, 0, this.sr)); }
  process(L, R, n) {
    const ds = this.p.time * 0.001 * this.sr;
    for (let i = 0; i < n; i++) {
      const wl = this.d[0].read(ds), wr = this.d[1].read(ds), m = (L[i] + R[i]) * 0.5;
      this.d[0].write(m + this.lp[1].tick(wr) * this.p.fb); this.d[1].write(this.lp[0].tick(wl) * this.p.fb);
      L[i] += wl * this.p.level; R[i] += wr * this.p.level;
    }
  }
}
export class Echo extends Effect {
  static label = 'エコー'; static group = '空間系';
  static defs = [{ k: 'time', n: 'タイム', min: 50, max: 1000, def: 220, unit: 'ms' }, { k: 'repeats', n: 'リピート', min: 0, max: 0.9, def: 0.55 }, { k: 'dark', n: 'こもり', min: 0, max: 1, def: 0.5 }, { k: 'level', n: 'エコー量', min: 0, max: 1, def: 0.6 }];
  init() { this.d = [new DelayLine(this.sr * 1.5), new DelayLine(this.sr * 1.5)]; this.s = [0, 0]; }
  process(L, R, n) {
    const ds = this.p.time * 0.001 * this.sr, chs = [L, R], k = 0.15 + (1 - this.p.dark) * 0.85;
    for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) { const w = this.d[c].read(ds); this.s[c] += (w - this.s[c]) * k; this.d[c].write(chs[c][i] + this.s[c] * this.p.repeats); chs[c][i] += w * this.p.level; }
  }
}
export class Reverb extends Effect {
  static label = 'リバーブ'; static group = '空間系';
  static defs = [{ k: 'room', n: 'ルームサイズ', min: 0, max: 1, def: 0.7 }, { k: 'damp', n: 'ダンピング', min: 0, max: 1, def: 0.4 }, { k: 'width', n: 'ステレオ幅', min: 0, max: 1, def: 1 }, { k: 'pre', n: 'プリディレイ', min: 0, max: 200, def: 15, unit: 'ms' }, { k: 'level', n: 'リバーブ量', min: 0, max: 1, def: 0.35 }];
  init() {
    const t = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], a = [556, 441, 341, 225], k = this.sr / 44100;
    this.combs = [0, 1].map((c) => t.map((x) => ({ b: new Float32Array(Math.round((x + c * 23) * k)), i: 0, s: 0 })));
    this.aps = [0, 1].map((c) => a.map((x) => ({ b: new Float32Array(Math.round((x + c * 23) * k)), i: 0 })));
    this.pre = new DelayLine(this.sr * 0.25);
  }
  process(L, R, n) {
    const fb = 0.7 + this.p.room * 0.28, dm = this.p.damp * 0.4, ps = this.p.pre * 0.001 * this.sr, w1 = 0.5 + this.p.width / 2, w2 = 0.5 - this.p.width / 2;
    for (let i = 0; i < n; i++) {
      this.pre.write((L[i] + R[i]) * 0.5 * 0.03); const inp = this.pre.read(ps), o = [0, 0];
      for (let c = 0; c < 2; c++) {
        let acc = 0;
        for (const cb of this.combs[c]) { const y = cb.b[cb.i]; cb.s = y * (1 - dm) + cb.s * dm; cb.b[cb.i] = inp + cb.s * fb; if (++cb.i >= cb.b.length) cb.i = 0; acc += y; }
        for (const ap of this.aps[c]) { const bo = ap.b[ap.i], y = -acc + bo; ap.b[ap.i] = acc + bo * 0.5; if (++ap.i >= ap.b.length) ap.i = 0; acc = y; }
        o[c] = acc;
      }
      L[i] += (o[0] * w1 + o[1] * w2) * this.p.level * 8; R[i] += (o[1] * w1 + o[0] * w2) * this.p.level * 8;
    }
  }
}
export class Tape extends Effect {
  static label = 'テープ'; static group = 'ローファイ';
  static defs = [{ k: 'sat', n: '飽和', min: 0, max: 1, def: 0.5 }, { k: 'wow', n: 'ワウ', min: 0, max: 1, def: 0.3 }, { k: 'flutter', n: 'フラッター', min: 0, max: 1, def: 0.2 }, { k: 'hiss', n: 'ヒスノイズ', min: 0, max: 1, def: 0.1 }, { k: 'tone', n: '高域', min: 2000, max: 16000, def: 9000, unit: 'Hz' }];
  init() { this.d = [new DelayLine(this.sr * 0.05), new DelayLine(this.sr * 0.05)]; this.w = new LFO(this.sr); this.f = new LFO(this.sr); this.lp = new Bq2(); this.rng = new Rng(7); this.up(); }
  onParam() { this.up(); }
  up() { this.lp.set('lp', this.p.tone, 0.707, 0, this.sr); }
  process(L, R, n) {
    for (let i = 0; i < n; i++) {
      const mod = this.w.tick(0.6) * this.p.wow * 0.003 + this.f.tick(9) * this.p.flutter * 0.0004, ds = (0.01 + mod) * this.sr, dr = 1 + this.p.sat * 4;
      this.d[0].write(L[i]); this.d[1].write(R[i]);
      L[i] = Math.tanh(this.d[0].read(ds) * dr) / Math.tanh(dr) + (this.rng.next() - 0.5) * this.p.hiss * 0.05;
      R[i] = Math.tanh(this.d[1].read(ds) * dr) / Math.tanh(dr) + (this.rng.next() - 0.5) * this.p.hiss * 0.05;
    }
    this.lp.run(L, R, n);
  }
  get latency() { return Math.round(0.01 * this.sr); }
}
export class Vinyl extends Effect {
  static label = 'ビニール'; static group = 'ローファイ';
  static defs = [{ k: 'crackle', n: 'クラックル', min: 0, max: 1, def: 0.4 }, { k: 'noise', n: 'ノイズ', min: 0, max: 1, def: 0.2 }, { k: 'rumble', n: 'ランブル', min: 0, max: 1, def: 0.2 }, { k: 'tone', n: '高域カット', min: 2000, max: 16000, def: 8000, unit: 'Hz' }, { k: 'warp', n: '回転ゆらぎ', min: 0, max: 1, def: 0.2 }];
  init() { this.rng = new Rng(99); this.lp = new Bq2(); this.rl = new Biquad(); this.rl.set('lp', 60, 0.7, 0, this.sr); this.pop = 0; this.d = [new DelayLine(this.sr * 0.03), new DelayLine(this.sr * 0.03)]; this.w = new LFO(this.sr); this.up(); }
  onParam() { this.up(); }
  up() { this.lp.set('lp', this.p.tone, 0.707, 0, this.sr); }
  process(L, R, n) {
    const dens = this.p.crackle * 40 / this.sr;
    for (let i = 0; i < n; i++) {
      const ds = (0.008 + this.w.tick(0.55) * this.p.warp * 0.0006) * this.sr; this.d[0].write(L[i]); this.d[1].write(R[i]);
      if (this.rng.next() < dens) this.pop = (this.rng.next() - 0.5) * (0.3 + this.rng.next() * 0.7) * 0.6;
      this.pop *= 0.85;
      const nz = (this.rng.next() - 0.5) * this.p.noise * 0.03 + this.rl.tick((this.rng.next() - 0.5) * 2) * this.p.rumble * 0.4;
      L[i] = this.d[0].read(ds) + this.pop * this.p.crackle + nz; R[i] = this.d[1].read(ds) + this.pop * this.p.crackle * 0.8 + nz;
    }
    this.lp.run(L, R, n);
  }
  get latency() { return Math.round(0.008 * this.sr); }
}

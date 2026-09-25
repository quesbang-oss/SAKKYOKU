import { Gain, NoiseGate, LowCut, HighCut, HumRemove, EQ3, EQ5, ParaEQ, Compressor, Limiter } from './fx-basic.js';
import { Distortion, Overdrive, Fuzz, Saturation, BitCrusher, Downsampler, RingMod, FreqShifter } from './fx-drive.js';
import { Tremolo, AutoPan, Phaser, Flanger, Chorus, StereoWidener } from './fx-mod.js';
import { Delay, PingPong, Echo, Reverb, Tape, Vinyl } from './fx-time.js';
import { Glitch, Stutter, ReverseFx, Freeze, Granular } from './fx-glitch.js';
import { NoiseReduce, PitchShift, Formant, AutoTune, HardTune, Robot, Vocoder } from './fx-voice.js';

export const EFFECTS = {
  nr: NoiseReduce, gate: NoiseGate, hum: HumRemove, lowcut: LowCut, highcut: HighCut,
  eq3: EQ3, eq5: EQ5, peq: ParaEQ, comp: Compressor, limiter: Limiter, gain: Gain,
  pitch: PitchShift, formant: Formant, autotune: AutoTune, hardtune: HardTune, robot: Robot, vocoder: Vocoder,
  distortion: Distortion, overdrive: Overdrive, fuzz: Fuzz, saturation: Saturation, bitcrush: BitCrusher, downsample: Downsampler,
  ringmod: RingMod, freqshift: FreqShifter, tremolo: Tremolo, autopan: AutoPan, phaser: Phaser, flanger: Flanger, chorus: Chorus, widener: StereoWidener,
  delay: Delay, pingpong: PingPong, echo: Echo, reverb: Reverb, tape: Tape, vinyl: Vinyl,
  glitch: Glitch, stutter: Stutter, reverse: ReverseFx, freeze: Freeze, granular: Granular,
};
export const EFFECT_LIST = Object.entries(EFFECTS).map(([type, c]) => ({ type, label: c.label, group: c.group, defs: c.defs }));
export function defaultParams(type) { const o = {}; for (const d of EFFECTS[type].defs) o[d.k] = d.def; return o; }
export function newFx(type, params, extra) { return { id: 'fx_' + Math.random().toString(36).slice(2, 9), type, on: true, mix: 1, params: { ...defaultParams(type), ...(params || {}) }, ...(extra || {}) }; }

import { DelayLine } from './core.js';
export class Chain {
  constructor(sr) { this.sr = sr; this.slots = []; this.res = {}; this.s1 = new Float32Array(4096); this.s2 = new Float32Array(4096); this.sig = ''; }
  setResource(name, data) { this.res[name] = data; for (const s of this.slots) s.inst.setResource && s.inst.setResource(name, data); }
  sync(list) {
    const old = new Map(this.slots.map((s) => [s.id, s])), next = [];
    for (const f of list || []) {
      const C = EFFECTS[f.type]; if (!C) continue;
      let s = old.get(f.id);
      if (!s || s.type !== f.type) {
        s = { id: f.id, type: f.type, inst: new C(this.sr, f.params, C.defs), dry: null };
        for (const [k, v] of Object.entries(this.res)) s.inst.setResource && s.inst.setResource(k, v);
      } else for (const [k, v] of Object.entries(f.params || {})) if (s.inst.p[k] !== v) s.inst.setParam(k, v);
      s.on = f.on !== false; s.mix = f.mix ?? 1; next.push(s);
    }
    this.slots = next;
  }
  setParam(id, k, v) { const s = this.slots.find((x) => x.id === id); if (s) s.inst.setParam(k, v); }
  setMix(id, v) { const s = this.slots.find((x) => x.id === id); if (s) s.mix = v; }
  get latency() { let t = 0; for (const s of this.slots) if (s.on) t += s.inst.latency || 0; return t; }
  reset() { for (const s of this.slots) { s.inst.reset && s.inst.reset(); } }
  process(L, R, n) {
    if (this.s1.length < n) { this.s1 = new Float32Array(n); this.s2 = new Float32Array(n); }
    for (const s of this.slots) {
      if (!s.on) continue;
      const lat = s.inst.latency || 0;
      if (s.mix >= 0.999) { s.inst.process(L, R, n); continue; }
      const dl = this.s1, dr = this.s2; dl.set(L.subarray(0, n)); dr.set(R.subarray(0, n));
      s.inst.process(L, R, n);
      const m = s.mix;
      if (lat > 0) { // ドライ信号を遅延補正
        if (!s.dry || s.dry.lat !== lat) s.dry = { lat, l: new DelayLine(lat), r: new DelayLine(lat) };
        for (let i = 0; i < n; i++) { s.dry.l.write(dl[i]); s.dry.r.write(dr[i]); const a = s.dry.l.read(lat - 1), b = s.dry.r.read(lat - 1); L[i] = a * (1 - m) + L[i] * m; R[i] = b * (1 - m) + R[i] * m; }
      } else for (let i = 0; i < n; i++) { L[i] = dl[i] * (1 - m) + L[i] * m; R[i] = dr[i] * (1 - m) + R[i] * m; }
    }
  }
}
// バッファ全体に一括適用（オフライン）。latencyを補正して同じ長さ+tail を返す
export function processBuffer(sr, chs, fxList, opts = {}) {
  const chain = new Chain(sr); for (const [k, v] of Object.entries(opts.res || {})) chain.setResource(k, v);
  chain.sync(fxList);
  const lat = chain.latency, tail = opts.tail ?? 0, len = chs[0].length, total = len + lat + tail;
  const L = new Float32Array(total), R = new Float32Array(total); L.set(chs[0]); R.set(chs[1] || chs[0]);
  const B = 512; let done = 0;
  while (done < total) { const n = Math.min(B, total - done); chain.process(L.subarray(done, done + n), R.subarray(done, done + n), n); done += n; if (opts.onProgress && (done / B) % 64 === 0) opts.onProgress(done / total); }
  return [L.slice(lat, lat + len + tail), R.slice(lat, lat + len + tail)];
}

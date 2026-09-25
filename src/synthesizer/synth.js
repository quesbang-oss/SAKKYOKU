import { engine } from '../audio/engine.js';
import { midiToHz } from '../utils/util.js';
import { toAudioBuffer } from '../sampler/sampler.js';

export const OSC_TYPES = ['sine', 'triangle', 'sawtooth', 'square', 'noise'];
export const OSC_LABELS = ['サイン', '三角', 'ノコギリ', '矩形', 'ノイズ'];
export const defaultSynthSettings = () => ({ osc: 2, voiceMix: 0.4, assetId: null, root: 60, cutoff: 3500, res: 2, filterType: 0, a: 0.01, d: 0.2, s: 0.7, r: 0.4, lfoRate: 5, lfoDepth: 0, lfoTarget: 0, lfoShape: 0, detune: 0, gain: 0.5, voiceLoop: true });
let noiseAb = null;
function noiseBuffer() { if (noiseAb && noiseAb.sampleRate === engine.ctx.sampleRate) return noiseAb; const n = engine.ctx.sampleRate * 2, ab = engine.ctx.createBuffer(1, n, engine.ctx.sampleRate), d = ab.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return (noiseAb = ab); }

export class VoiceSynth {
  constructor(getAsset) { this.getAsset = getAsset; this.s = defaultSynthSettings(); this.voices = new Map(); }
  noteOn(midi, vel = 1) {
    const c = engine.ctx, s = this.s, t = c.currentTime; this.noteOff(midi, true);
    if (this.voices.size > 24) this.noteOff(this.voices.keys().next().value, true);
    const amp = c.createGain(), filt = c.createBiquadFilter(), oscMix = c.createGain(), voiceMix = c.createGain(), nodes = [];
    filt.type = ['lowpass', 'highpass', 'bandpass'][s.filterType] || 'lowpass'; filt.frequency.value = s.cutoff; filt.Q.value = s.res;
    oscMix.gain.value = 1 - s.voiceMix; voiceMix.gain.value = s.voiceMix;
    let osc = null;
    if (s.voiceMix < 1) {
      if (s.osc === 4) { osc = c.createBufferSource(); osc.buffer = noiseBuffer(); osc.loop = true; } else { osc = c.createOscillator(); osc.type = OSC_TYPES[s.osc]; osc.frequency.value = midiToHz(midi); osc.detune.value = s.detune; }
      osc.connect(oscMix); oscMix.connect(filt); osc.start(t); nodes.push(osc);
    }
    let vs = null; const buf = s.assetId && this.getAsset(s.assetId);
    if (s.voiceMix > 0 && buf) { vs = c.createBufferSource(); vs.buffer = toAudioBuffer(buf); vs.loop = s.voiceLoop; vs.playbackRate.value = Math.pow(2, (midi - s.root) / 12); vs.detune.value = s.detune; vs.connect(voiceMix); voiceMix.connect(filt); vs.start(t); nodes.push(vs); }
    // LFO
    let lfo = null, lg = null;
    if (s.lfoDepth > 0) {
      lfo = c.createOscillator(); lfo.type = ['sine', 'triangle', 'square', 'sawtooth'][s.lfoShape]; lfo.frequency.value = s.lfoRate; lg = c.createGain();
      if (s.lfoTarget === 0) { lg.gain.value = s.lfoDepth * 100; [osc, vs].forEach((n) => n && n.detune && lg.connect(n.detune)); }       // ピッチ(セント)
      else if (s.lfoTarget === 1) { lg.gain.value = s.lfoDepth * s.cutoff * 0.8; lg.connect(filt.frequency); }                         // フィルター
      else { lg.gain.value = s.lfoDepth * 0.5; lg.connect(amp.gain); }                                                                 // 音量
      lfo.connect(lg); lfo.start(t); nodes.push(lfo);
    }
    const peak = Math.max(0.0001, s.gain * vel);
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(peak, t + Math.max(0.002, s.a)); amp.gain.setTargetAtTime(peak * s.s, t + Math.max(0.002, s.a), Math.max(0.01, s.d / 3));
    filt.connect(amp); amp.connect(engine.instIn);
    this.voices.set(midi, { amp, nodes, peakAt: t });
  }
  noteOff(midi, imm) {
    const v = this.voices.get(midi); if (!v) return; this.voices.delete(midi);
    const c = engine.ctx, t = c.currentTime, rel = imm ? 0.01 : Math.max(0.02, this.s.r);
    v.amp.gain.cancelScheduledValues(t); v.amp.gain.setValueAtTime(v.amp.gain.value, t); v.amp.gain.setTargetAtTime(0, t, rel / 4);
    for (const n of v.nodes) { try { n.stop(t + rel * 1.6 + 0.05); } catch {} } setTimeout(() => { try { v.amp.disconnect(); } catch {} }, (rel * 1.6 + 0.2) * 1000);
  }
  allOff() { for (const k of [...this.voices.keys()]) this.noteOff(k); }
}

import { uid } from '../utils/util.js';
import { defaultPattern } from '../audio/drums.js';
import { defaultSamplerSettings } from '../sampler/sampler.js';
import { defaultSynthSettings } from '../synthesizer/synth.js';

export const TRACK_COLORS = ['#4de0c1', '#5db4ff', '#c084fc', '#ff8a5d', '#ffb02e', '#ff5d73', '#7be36b', '#f472b6'];
export const PAD_COLORS = ['#ff5d73', '#ff8a5d', '#ffb02e', '#e6e34d', '#7be36b', '#4de0c1', '#5db4ff', '#8a7dff', '#c084fc', '#f472b6', '#ff5d9e', '#4dc3ff', '#a3e635', '#fb923c', '#38bdf8', '#e879f9'];
export function newTrack(n, type = 'audio') {
  return { id: uid('trk'), name: (type === 'drum' ? 'ドラム ' : 'トラック ') + n, type, color: TRACK_COLORS[(n - 1) % TRACK_COLORS.length], vol: 0.9, pan: 0, mute: false, solo: false, fx: [], auto: {}, clips: [] };
}
export function newPads() { return Array.from({ length: 16 }, (_, i) => ({ id: i, name: 'PAD ' + (i + 1), color: PAD_COLORS[i], assetId: null, loop: false, oneShot: true, pitch: 0, gain: 1, chopIndex: null })); }
export function newProject(name = '無題のプロジェクト') {
  const pat = defaultPattern();
  return {
    v: 1, id: uid('prj'), name, created: Date.now(), updated: Date.now(), bpm: 120, sig: [4, 4], metronome: false, loop: { on: false, start: 0, end: 8 }, snap: 4,
    tracks: [newTrack(1)], assets: [], patterns: [pat], activePattern: pat.id, pads: newPads(), sampler: defaultSamplerSettings(), synth: defaultSynthSettings(), instFx: [],
    master: { vol: 1, comp: { on: false, thr: -14, ratio: 3, atk: 15, rel: 200, knee: 6, makeup: 2 }, limiter: { on: true, ceil: -1 }, autoGain: { on: false, target: -14 } },
    noiseProfile: null, carrierAssetId: null, midiNotes: {}, chops: {}, liveSlots: [null, null, null],
  };
}
export function projectEnd(P) { let e = 0; for (const t of P.tracks) for (const c of t.clips) e = Math.max(e, c.start + c.dur); return e; }
export function beatSec(P) { return 60 / P.bpm; }
export function snapValue(P, t) { // P.snap: 分割数(4=1/4拍…)。0=OFF
  if (!P.snap) return t; const g = beatSec(P) / (P.snap / 4); return Math.round(t / g) * g;
}
export function newClip(assetId, start, dur, offset = 0) { return { id: uid('clp'), assetId, start, dur, offset, gain: 1, fadeIn: 0.005, fadeOut: 0.01, reverse: false }; }
export function newDrumClip(patternId, start, dur) { return { id: uid('clp'), patternId, start, dur, offset: 0, gain: 1, fadeIn: 0, fadeOut: 0 }; }
export function findClip(P, id) { for (const t of P.tracks) { const c = t.clips.find((x) => x.id === id); if (c) return { track: t, clip: c }; } return null; }
export function paramSpecForAuto(P, track, key) { // オートメーション対象の仕様(min,max,def,label)
  return null; // app.js 側で effect レジストリと結合して解決
}

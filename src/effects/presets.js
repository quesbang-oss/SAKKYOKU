import { newFx } from './registry.js';
import { db } from '../storage/db.js';
// 組み込みプリセット：[type, params, wet/dry(mix)]
const P = (name, desc, list) => ({ name, desc, builtin: true, fx: list.map(([type, params, mix]) => ({ type, params: params || {}, mix: mix ?? 1 })) });
export const BUILTIN_PRESETS = [
  P('ROBOT', 'ロボットボイス', [['nr', { strength: 0.5 }], ['robot', { freq: 110, fb: 0.75, ring: 0.45 }], ['eq3', { low: -2, high: 3 }], ['reverb', { room: 0.3, level: 0.15 }]]),
  P('ALIEN', '宇宙人', [['nr', { strength: 0.5 }], ['pitch', { semi: 5 }], ['formant', { shift: 6 }], ['ringmod', { freq: 60, lfo: 0.6 }, 0.5], ['chorus', { depth: 0.8 }], ['reverb', { room: 0.6, level: 0.25 }]]),
  P('8BIT', 'ファミコン風', [['nr', { strength: 0.5 }], ['bitcrush', { bits: 4, rate: 0.25 }], ['downsample', { sr: 6000 }, 0.7], ['highcut', { freq: 6000 }], ['gain', { gain: 2 }]]),
  P('CYBER', 'サイバー', [['nr', { strength: 0.5 }], ['autotune', { speed: 1, scale: 3, key: 9 }], ['vocoder', { carrier: 0, note: 45, bands: 20 }, 0.7], ['phaser', { rate: 0.4 }], ['pingpong', { time: 250, fb: 0.4, level: 0.35 }], ['reverb', { room: 0.5, level: 0.2 }]]),
  P('HARD', 'ハードなディストーション', [['nr', { strength: 0.5 }], ['comp', { thr: -24, ratio: 4 }], ['distortion', { drive: 26, tone: 5000 }], ['eq5', { g1: 3, g3: 2, g4: 3 }], ['limiter', { drive: 3 }]]),
  P('GHOST', '幽霊', [['nr', { strength: 0.5 }], ['pitch', { semi: -3 }], ['formant', { shift: -3 }], ['tremolo', { rate: 4, depth: 0.4 }], ['echo', { time: 380, repeats: 0.6, level: 0.6 }], ['reverb', { room: 0.95, damp: 0.6, level: 0.6 }]]),
  P('RADIO', '無線・ラジオ', [['nr', { strength: 0.5 }], ['lowcut', { freq: 400 }], ['highcut', { freq: 3200 }], ['overdrive', { drive: 12, tone: 3500 }], ['vinyl', { crackle: 0.5, noise: 0.5, rumble: 0 }, 0.7]]),
  P('VOCODER', 'ボコーダー(ノコギリ和音)', [['nr', { strength: 0.6 }], ['gate', { thr: -45 }], ['vocoder', { carrier: 3, note: 48, bands: 24, sib: 0.5, gain: 1.6 }], ['chorus', {}, 0.5], ['reverb', { level: 0.2 }]]),
  P('GLITCH', 'グリッチ', [['nr', { strength: 0.5 }], ['glitch', { prob: 0.6, len: 80 }], ['stutter', { every: 900, hold: 350 }, 0.8], ['bitcrush', { bits: 9, rate: 0.7 }, 0.5], ['delay', { time: 180, fb: 0.35, level: 0.3 }]]),
  P('SPACE', '宇宙空間', [['nr', { strength: 0.5 }], ['pitch', { semi: 0 }], ['granular', { size: 120, density: 30, spread: 800, pitch: 4, thru: 0.4, level: 0.9 }, 0.6], ['flanger', { rate: 0.15, depth: 0.8 }], ['pingpong', { time: 420, fb: 0.6, level: 0.5 }], ['reverb', { room: 0.98, damp: 0.3, level: 0.7 }]]),
];
// ワンクリック電子音化
export const ELECTRONIZE_PRESETS = [
  P('電子ボーカル（標準）', 'ノイズ除去→EQ→ピッチ補正→ボコーダー→ディストーション→ディレイ→リバーブ', [['nr', { strength: 0.6 }], ['eq3', { low: -2, mid: 1, high: 3 }], ['autotune', { speed: 0.9, scale: 1 }], ['vocoder', { carrier: 0, note: 48, bands: 20, gain: 1.5 }, 0.65], ['overdrive', { drive: 8, level: -4 }, 0.5], ['delay', { time: 300, fb: 0.35, level: 0.3 }], ['reverb', { room: 0.6, level: 0.22 }]]),
  P('ロボット合唱', '和音キャリアのボコーダー＋コーラス', [['nr', { strength: 0.6 }], ['gate', { thr: -48 }], ['vocoder', { carrier: 3, note: 48, bands: 24, sib: 0.5, gain: 1.6 }], ['chorus', { depth: 0.6, voices: 3 }], ['reverb', { room: 0.7, level: 0.3 }]]),
  P('ケロケロ', 'ハードチューン', [['nr', { strength: 0.6 }], ['hardtune', { scale: 1, speed: 1 }], ['eq3', { high: 3 }], ['delay', { time: 260, fb: 0.3, level: 0.25 }]]),
  P('8bitチップ', 'ビットクラッシュ＋ダウンサンプル', [['nr', { strength: 0.6 }], ['bitcrush', { bits: 5, rate: 0.3 }], ['highcut', { freq: 7000 }], ['echo', { time: 200, level: 0.3 }]]),
  P('ダーク・グリッチ', 'ピッチダウン＋グリッチ＋リバーブ', [['nr', { strength: 0.6 }], ['pitch', { semi: -5 }], ['formant', { shift: -3 }], ['distortion', { drive: 14 }, 0.5], ['glitch', { prob: 0.55 }], ['reverb', { room: 0.85, level: 0.4 }]]),
  P('宇宙シンセ', 'グラニュラー＋フェイザー＋ロングリバーブ', [['nr', { strength: 0.6 }], ['vocoder', { carrier: 5, note: 52, bands: 20, gain: 1.4 }, 0.6], ['granular', { thru: 0.3, level: 0.9 }, 0.5], ['phaser', { rate: 0.2 }], ['pingpong', { level: 0.4 }], ['reverb', { room: 0.97, level: 0.6 }]]),
];
export function presetToFx(p) { return p.fx.map((f) => newFx(f.type, f.params, { mix: f.mix, on: f.on !== false })); }
export async function loadUserPresets() { try { const all = await db.all('presets'); return all.map((x) => x.value).sort((a, b) => a.name.localeCompare(b.name, 'ja')); } catch { return []; } }
export async function saveUserPreset(name, fxList) { const rec = { name, builtin: false, fx: fxList.map((f) => ({ type: f.type, params: { ...f.params }, mix: f.mix, on: f.on })) }; await db.put('presets', name, rec); return rec; }
export async function deleteUserPreset(name) { await db.del('presets', name); }
// 実験モード用
export function randomChain(extreme = false) {
  const types = ['pitch', 'formant', 'robot', 'ringmod', 'freqshift', 'distortion', 'fuzz', 'bitcrush', 'downsample', 'tremolo', 'autopan', 'phaser', 'flanger', 'chorus', 'delay', 'pingpong', 'echo', 'reverb', 'tape', 'glitch', 'stutter', 'granular', 'vocoder', 'saturation'];
  const n = extreme ? 5 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 3), chosen = [];
  while (chosen.length < n) { const t = types[Math.floor(Math.random() * types.length)]; if (!chosen.includes(t)) chosen.push(t); }
  return chosen.map((t) => randomizeFx(newFx(t), extreme));
}
import { EFFECTS } from './registry.js';
export function randomizeFx(fx, extreme = false) {
  const defs = EFFECTS[fx.type].defs; const p = { ...fx.params };
  for (const d of defs) { const r = Math.random(); const span = d.max - d.min, lo = extreme ? d.min : d.min + span * 0.1, hi = extreme ? d.max : d.max - span * 0.15; let v = lo + (hi - lo) * r; if (d.opts) v = Math.floor(Math.random() * d.opts.length); else if (d.step) v = Math.round(v / d.step) * d.step; p[d.k] = v; }
  return { ...fx, params: p };
}

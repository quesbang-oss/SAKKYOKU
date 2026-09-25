// プロジェクト全体のオフラインミックスダウン（Worker/メインスレッド共通・DOM非依存）
import { Chain } from '../effects/registry.js';
import { interpAuto } from '../utils/util.js';
import { makeDrum, DRUM_ROWS } from '../audio/drums.js';
import { integratedLufs } from '../analysis/analyze.js';

export function projectEnd(P) { let e = 0; for (const t of P.tracks) for (const c of t.clips) e = Math.max(e, c.start + c.dur); return e; }
const yieldUI = () => new Promise((r) => setTimeout(r, 0));
function resampled(buf, sr, cache) {
  if (buf.sr === sr) return buf.ch; let r = cache.get(buf); if (r && r.sr === sr) return r.ch;
  const ratio = buf.sr / sr, ch = buf.ch.map((c) => { const n = Math.round(c.length / ratio), o = new Float32Array(n); for (let i = 0; i < n; i++) { const p = i * ratio, i0 = Math.floor(p), f = p - i0; o[i] = (c[i0] || 0) * (1 - f) + (c[Math.min(i0 + 1, c.length - 1)] || 0) * f; } return o; });
  cache.set(buf, { sr, ch }); return ch;
}
function placeAudio(L, R, clip, src, sr, t0, cache) {
  const ch = resampled(src, sr, cache), a = ch[0], b = ch[1] || ch[0], start = Math.round((clip.start - t0) * sr), off = Math.round(clip.offset * sr), n = Math.round(clip.dur * sr), len = L.length;
  const fi = Math.round((clip.fadeIn || 0) * sr), fo = Math.round((clip.fadeOut || 0) * sr), g = clip.gain ?? 1;
  for (let i = 0; i < n; i++) {
    const d = start + i; if (d < 0) continue; if (d >= len) break;
    const si = clip.reverse ? off + n - 1 - i : off + i; if (si < 0 || si >= a.length) continue;
    let f = g; if (fi && i < fi) f *= i / fi; if (fo && n - i < fo) f *= (n - i) / fo;
    L[d] += a[si] * f; R[d] += b[si] * f;
  }
}
function placeDrums(L, R, clip, pat, P, sr, t0) {
  if (!pat) return; const step = 60 / P.bpm / 4, len = L.length, end = clip.start + clip.dur;
  for (let k = 0; ; k++) {
    const si = k % pat.steps, sw = si % 2 === 1 ? (pat.swing || 0) * step * 0.5 : 0, t = clip.start + k * step + sw; if (t >= end - 1e-6) break;
    for (const row of DRUM_ROWS) {
      const v = (pat.rows[row.id] || [])[si]; if (!v) continue; const hit = makeDrum(row.id, sr).ch[0], st = Math.round((t - t0) * sr), gain = v * (clip.gain ?? 1) * 0.9;
      for (let i = 0; i < hit.length; i++) { const d = st + i; if (d < 0) continue; if (d >= len) break; const w = L[d] += hit[i] * gain; R[d] += hit[i] * gain; void w; }
    }
  }
}
export async function renderProject(P, getAsset, o = {}) {
  const sr = o.sr || 44100, t0 = o.start ?? 0, t1 = o.end ?? (projectEnd(P) + (o.tail ?? 2)), len = Math.max(1, Math.ceil((t1 - t0) * sr)), cache = new WeakMap();
  const anySolo = P.tracks.some((t) => t.solo), mL = new Float32Array(len), mR = new Float32Array(len), res = {};
  if (P.noiseProfile) res.noise = Float32Array.from(P.noiseProfile);
  if (P.carrierAssetId) { const cb = getAsset(P.carrierAssetId); if (cb) { const m = resampled(cb, sr, cache)[0]; res.carrier = m; } }
  const list = P.tracks.filter((t) => (o.tracks ? o.tracks.includes(t.id) : true) && (o.ignoreMuteSolo || (anySolo ? t.solo : !t.mute)));
  let ti = 0;
  for (const tr of list) {
    const L = new Float32Array(len), R = new Float32Array(len);
    for (const c of tr.clips) {
      if (c.start + c.dur < t0 || c.start > t1) continue;
      if (tr.type === 'drum') placeDrums(L, R, c, P.patterns.find((p) => p.id === c.patternId), P, sr, t0);
      else { const src = getAsset(c.assetId); if (src) placeAudio(L, R, c, src, sr, t0, cache); }
    }
    const chain = new Chain(sr); for (const [k, v] of Object.entries(res)) chain.setResource(k, v); chain.sync(tr.fx);
    const lat = chain.latency, tot = len + lat, L2 = new Float32Array(tot), R2 = new Float32Array(tot); L2.set(L); R2.set(R);
    const autoKeys = Object.keys(tr.auto || {}).filter((k) => tr.auto[k] && tr.auto[k].length), B = 256; let curVol = tr.vol, curPan = tr.pan; const last = {};
    const gl = new Float32Array(tot), gr = new Float32Array(tot);
    for (let p = 0; p < tot; p += B) {
      const n = Math.min(B, tot - p), t = t0 + Math.max(0, p - lat) / sr;
      for (const k of autoKeys) { const v = interpAuto(tr.auto[k], t, undefined); if (v === undefined || last[k] === v) continue; last[k] = v; if (k === 'vol') curVol = v; else if (k === 'pan') curPan = v; else if (k.startsWith('mix.')) chain.setMix(k.slice(4), v); else if (k.startsWith('fx.')) { const [, id, ...pr] = k.split('.'); chain.setParam(id, pr.join('.'), v); } }
      const pan = Math.max(-1, Math.min(1, curPan)), a = pan <= 0 ? 1 : Math.cos(pan * Math.PI / 2), b = pan >= 0 ? 1 : Math.cos(-pan * Math.PI / 2);
      for (let i = 0; i < n; i++) { gl[p + i] = curVol * a; gr[p + i] = curVol * b; }
      chain.process(L2.subarray(p, p + n), R2.subarray(p, p + n), n);
      if (o.yield && (p / B) % 200 === 0) await yieldUI();
    }
    for (let i = 0; i < len; i++) { mL[i] += L2[i + lat] * gl[i + lat]; mR[i] += R2[i + lat] * gr[i + lat]; }
    ti++; o.onProgress && o.onProgress(ti / (list.length + 1)); if (o.yield) await yieldUI();
  }
  // マスター処理：コンプ → オートゲイン → 音量 → リミッター
  const M = P.master; let outL = mL, outR = mR;
  if (!o.raw) {
    const fx1 = []; if (M.comp.on) fx1.push({ id: 'mc', type: 'comp', on: true, mix: 1, params: { thr: M.comp.thr, ratio: M.comp.ratio, atk: M.comp.atk, rel: M.comp.rel, knee: M.comp.knee, makeup: M.comp.makeup } });
    if (fx1.length) { const ch = new Chain(sr); ch.sync(fx1); for (let p = 0; p < len; p += 512) { const n = Math.min(512, len - p); ch.process(outL.subarray(p, p + n), outR.subarray(p, p + n), n); } }
    let g = M.vol;
    if (M.autoGain.on) { const l = integratedLufs([outL, outR], sr); if (isFinite(l)) g *= Math.pow(10, Math.max(-12, Math.min(18, M.autoGain.target - l)) / 20); }
    for (let i = 0; i < len; i++) { outL[i] *= g; outR[i] *= g; }
    if (M.limiter.on) { const ch = new Chain(sr); ch.sync([{ id: 'ml', type: 'limiter', on: true, mix: 1, params: { ceil: M.limiter.ceil, rel: 80, drive: 0 } }]); const lat = ch.latency, oL = new Float32Array(len + lat), oR = new Float32Array(len + lat); oL.set(outL); oR.set(outR); for (let p = 0; p < len + lat; p += 512) { const n = Math.min(512, len + lat - p); ch.process(oL.subarray(p, p + n), oR.subarray(p, p + n), n); } outL = oL.subarray(lat, lat + len); outR = oR.subarray(lat, lat + len); }
  }
  let peak = 0; for (let i = 0; i < len; i++) { const v = Math.max(Math.abs(outL[i]), Math.abs(outR[i])); if (v > peak) peak = v; }
  o.onProgress && o.onProgress(1);
  return { sr, L: outL.slice ? outL.slice() : new Float32Array(outL), R: outR.slice ? outR.slice() : new Float32Array(outR), peak, start: t0 };
}

import { h, slider, toast } from '../utils/dom.js';
import { engine } from '../audio/engine.js';
import { fitCanvas, drawWave } from './draw.js';
import { computeNoiseProfile } from '../analysis/analyze.js';
import { applyEffects, normalize, slice, trimEnds } from '../audio/edit.js';
import { newFx } from '../effects/registry.js';

export function compareUI(origBuf, onSave) {
  const root = h('div', { class: 'compare' });
  const cv = h('canvas', { class: 'cmp-wave' });
  let sel = null, profile = null, processed = origBuf, playing = null, mode = 'processed';
  const params = { nr: true, strength: 0.6, quality: true, eq: true, low: 0, mid: 0, high: 2, normalize: true, trim: true };
  const nameInp = h('input', { value: '仕上げ済み音声', 'aria-label': '保存名' });
  const status = h('span', { class: 'cmp-status' }, '');

  function draw() { const { c, w, h: hh } = fitCanvas(cv); c.clearRect(0, 0, w, hh); const buf = mode === 'original' ? origBuf : processed; drawWave(c, buf, 0, 0, w, hh, 0, buf.ch[0].length / buf.sr, mode === 'original' ? '#999' : '#4de0c1', { mono: true });
    if (sel) { const x0 = (sel[0] / origBuf.ch[0].length) * w, x1 = (sel[1] / origBuf.ch[0].length) * w; c.fillStyle = 'rgba(255,176,46,0.25)'; c.fillRect(x0, 0, x1 - x0, hh); } }
  let dragStart = null;
    cv.addEventListener('pointerdown', (e) => { const r = cv.getBoundingClientRect(); dragStart = Math.floor(((e.clientX - r.left) / r.width) * origBuf.ch[0].length); sel = [dragStart, dragStart]; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (dragStart == null) return; const r = cv.getBoundingClientRect(); const x = Math.floor(((e.clientX - r.left) / r.width) * origBuf.ch[0].length); sel = [Math.min(dragStart, x), Math.max(dragStart, x)]; draw(); });
  cv.addEventListener('pointerup', () => { dragStart = null; });

  function process() {
    let b = origBuf;
    if (params.trim) b = trimEnds(b, -50);
    const fx = [];
    if (params.nr) fx.push(newFx('nr', { strength: params.strength, quality: params.quality ? 1 : 0, mode: profile ? 1 : 0 }));
    if (params.eq) fx.push(newFx('eq3', { low: params.low, mid: params.mid, high: params.high }));
    processed = fx.length ? applyEffects(b, fx, { res: profile ? { noise: profile } : {} }) : b;
    if (params.normalize) processed = normalize(processed, -1);
    draw();
  }
  function play(buf) { engine.init().then(() => { stop(); const ab = engine.ctx.createBuffer(buf.ch.length, buf.ch[0].length, buf.sr); buf.ch.forEach((c, i) => ab.copyToChannel(c, i)); const s = engine.ctx.createBufferSource(); s.buffer = ab; s.connect(engine.preview); s.start(); playing = s; s.onended = () => { if (playing === s) playing = null; }; }); }
  function stop() { if (playing) { try { playing.stop(); } catch {} playing = null; } }

  root.append(
    h('p', { class: 'hint' }, '波形をドラッグして無音区間を選択し、「選択範囲からノイズ推定」を押すと、その区間の音をノイズとして学習して除去精度が上がります。'),
    cv,
    h('div', { class: 'cmp-row' }, h('button', { class: 'btn sm', onclick: () => { if (!sel || sel[1] - sel[0] < 256) { toast('波形をドラッグして範囲を選んでください', 'warn'); return; } profile = computeNoiseProfile(origBuf.ch[0], sel[0], sel[1]); status.textContent = 'ノイズプロファイルを取得しました'; process(); } }, '選択範囲からノイズ推定'),
      h('button', { class: 'btn sm', onclick: () => { profile = null; status.textContent = '自動推定モードに戻しました'; process(); } }, '自動推定に戻す'), status),
    h('div', { class: 'cmp-controls' },
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: params.nr, onchange: (e) => { params.nr = e.target.checked; process(); } }), 'ノイズ除去'),
      slider({ k: 'strength', n: '抑制量', min: 0, max: 1, def: 0.6 }, params.strength, (v) => { params.strength = v; process(); }),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: params.quality, onchange: (e) => { params.quality = e.target.checked; process(); } }), '声の保護'),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: params.eq, onchange: (e) => { params.eq = e.target.checked; process(); } }), 'EQ補正'),
      slider({ k: 'low', n: 'LOW', min: -12, max: 12, def: 0, unit: 'dB' }, params.low, (v) => { params.low = v; process(); }),
      slider({ k: 'high', n: 'HIGH', min: -12, max: 12, def: 2, unit: 'dB' }, params.high, (v) => { params.high = v; process(); }),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: params.trim, onchange: (e) => { params.trim = e.target.checked; process(); } }), '前後の無音をトリム'),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: params.normalize, onchange: (e) => { params.normalize = e.target.checked; process(); } }), 'ノーマライズ')),
    h('div', { class: 'cmp-row' }, h('button', { class: 'btn sm', onclick: () => { mode = 'original'; draw(); play(origBuf); } }, '▶ 原音'), h('button', { class: 'btn sm', onclick: () => { mode = 'processed'; draw(); play(processed); } }, '▶ 処理後'), h('button', { class: 'btn sm', onclick: stop }, '■ 停止')),
    h('div', { class: 'cmp-row' }, h('label', null, '保存名', nameInp), h('button', { class: 'btn primary', onclick: () => onSave(processed, nameInp.value.trim()) }, 'ライブラリへ保存')));
  process();
  return root;
}

import { h, toast, confirmBox } from '../utils/dom.js';
import { app, getAsset, addAsset, mutate } from '../app.js';
import { engine } from '../audio/engine.js';
import { randomChain, randomizeFx } from '../effects/presets.js';
import { applyEffects } from '../audio/edit.js';
import { fitCanvas, drawWave } from './draw.js';

export function experimentUI() {
  const root = h('div', { class: 'experiment' });
  const cv = h('canvas', { class: 'inst-wave' });
  let curId = app.project.assets[0] && app.project.assets[0].id, result = null, chain = [];
  const sel = h('select', { 'aria-label': '素材選択' }, app.project.assets.map((a) => h('option', { value: a.id, selected: a.id === curId }, a.name)));
  sel.addEventListener('change', () => { curId = sel.value; result = null; draw(); });
  const chainLabel = h('div', { class: 'exp-chain' }, 'まだランダム化していません');
  function buf() { return curId && getAsset(curId); }
  function draw() { const b = result || buf(); if (!b) return; const { c, w, h: hh } = fitCanvas(cv); c.clearRect(0, 0, w, hh); drawWave(c, b, 0, 0, w, hh, 0, b.ch[0].length / b.sr, result ? '#c084fc' : '#4de0c1', { mono: true }); }
  function run(extreme) { const b = buf(); if (!b) { toast('素材がありません。先に録音してください', 'warn'); return; } chain = randomChain(extreme); result = applyEffects(b, chain); chainLabel.textContent = 'チェーン: ' + chain.map((f) => f.type).join(' → '); draw(); play(result); }
  function reroll() { if (!chain.length) return run(false); chain = chain.map((f) => randomizeFx(f)); result = applyEffects(buf(), chain); draw(); play(result); }
  let src = null; function play(b) { engine.init().then(() => { if (src) try { src.stop(); } catch {} const ab = engine.ctx.createBuffer(1, b.ch[0].length, b.sr); ab.copyToChannel(b.ch[0], 0); src = engine.ctx.createBufferSource(); src.buffer = ab; src.connect(engine.preview); src.start(); }); }
  async function saveResult() { if (!result) { toast('まだ生成していません', 'warn'); return; } const id = await addAsset(result, { name: '実験_' + Date.now().toString(36), folder: 'VOICE' }); toast('素材ライブラリに保存しました', 'ok'); }
  root.append(h('p', { class: 'hint' }, 'ランダムなエフェクトの組み合わせで遊んで音を探索できます。気に入ったらライブラリに保存できます（元の素材は変更されません）。'),
    h('div', { class: 'exp-row' }, h('label', null, '素材', sel), h('button', { class: 'btn' , onclick: () => run(false) }, '🎲 ランダムエフェクト'), h('button', { class: 'btn danger', onclick: () => run(true) }, '💥 Extreme Mode'), h('button', { class: 'btn', onclick: reroll }, '🔁 パラメータを振り直す')),
    chainLabel, cv, h('div', { class: 'exp-row' }, h('button', { class: 'btn', onclick: () => play(result || buf())}, '▶ 再生'), h('button', { class: 'btn primary', onclick: saveResult }, 'ライブラリへ保存')));
  draw();
  return root;
}

import { h, toast } from '../utils/dom.js';
import { engine, explainMicError } from '../audio/engine.js';
import { app, mutate } from '../app.js';
import { fxChainUI } from './fxchain.js';
import { BUILTIN_PRESETS, presetToFx } from '../effects/presets.js';
import { makeMeter } from './draw.js';
import { addTick } from './loop.js';
import { bus } from '../utils/bus.js';

export function liveModeUI() {
  const root = h('div', { class: 'live-mode' });
  let active = false, bypass = false;
  const meterIn = makeMeter('入力'), meterOut = makeMeter('出力(処理後)');
  const status = h('span', { class: 'live-status' }, '停止中');
  const slotsWrap = h('div', { class: 'live-slots' });
  const mixSlider = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: 1, 'aria-label': 'Dry/Wet' });
  const startBtn = h('button', { class: 'btn primary lg', onclick: toggle }, '▶ LIVE開始');
  const bypassBtn = h('button', { class: 'btn lg', onclick: () => { bypass = !bypass; engine.setBypass(bypass); bypassBtn.classList.toggle('on', bypass); bypassBtn.textContent = bypass ? 'Bypass中' : 'Bypass'; } }, 'Bypass');

  function slots() { return app.project.liveSlots; }
  function renderSlots() {
    slotsWrap.replaceChildren(...slots().map((fx, i) => h('button', { class: 'btn slot' + (fx ? ' filled' : ''), onclick: () => applySlot(i) },
      'Effect ' + (i + 1) + (fx ? '\n' + presetLabel(fx) : '\n(未設定)'),
      h('span', { class: 'slot-set', onclick: (e) => { e.stopPropagation(); setSlot(i); } }, '⚙')
    )));
  }
  function presetLabel(fx) { return Array.isArray(fx) ? fx.map((f) => f.type).join('+') : ''; }
  function applySlot(i) { const fx = slots()[i]; if (!fx) { toast('まず ⚙ でこのスロットにエフェクトを設定してください', 'warn'); return; } engine.setLiveFx(fx); toast('Effect ' + (i + 1) + ' を適用しました'); }
  async function setSlot(i) { const { modal } = await import('../utils/dom.js'); const cur = { list: JSON.parse(JSON.stringify(slots()[i] || [])) }; const ui = fxChainUI({ get: () => cur.list, edit: (fn) => fn(cur.list), onLive: () => {}, allowPresets: true }); await modal('Effect ' + (i + 1) + ' を設定', ui, [{ label: '保存', primary: true, value: true }]); mutate('LIVEスロット設定', () => { app.project.liveSlots[i] = cur.list; }); renderSlots(); }

  async function toggle() {
    if (active) { engine.stopMic(); active = false; startBtn.textContent = '▶ LIVE開始'; status.textContent = '停止中'; return; }
    try { await engine.startMic({ sampleRate: engine.settings.sampleRate, channels: 1, deviceId: engine.settings.deviceId }); engine.setMonitor(true); active = true; startBtn.textContent = '■ LIVE停止'; status.textContent = 'LIVE中'; toast('LIVEモードを開始しました。ヘッドホンの使用を推奨します（ハウリング防止）。'); }
    catch (e) { const err = e.title ? e : explainMicError(e); const { showError } = await import('../utils/dom.js'); showError(err.title, err.message, err.help); }
  }
  mixSlider.addEventListener('input', () => engine.setLiveMix(+mixSlider.value));
  addTick(() => { if (!active) return; meterIn.update(...Object.values(engine.constructor.level(engine.micAn))); meterOut.update(...Object.values(engine.constructor.level(engine.micPostAn))); });
  root.append(h('p', { class: 'hint' }, 'マイク入力をリアルタイムでエフェクト処理します。3つのスロットに好きなエフェクトチェーンを設定し、ボタンで瞬時に切り替えられます。'),
    h('div', { class: 'live-row' }, startBtn, bypassBtn, status),
    h('div', { class: 'live-meters' }, h('label', null, '入力', meterIn), h('label', null, '出力', meterOut)),
    h('label', { class: 'live-mix' }, 'Dry/Wet', mixSlider),
    slotsWrap);
  renderSlots(); bus.on('project:restored', renderSlots);
  root.stop = () => { if (active) toggle(); };
  return root;
}

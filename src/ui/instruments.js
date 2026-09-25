import { h, slider, toast, askText } from '../utils/dom.js';
import { app, mutate, getAsset, addAsset, selectedTrack } from '../app.js';
import { Sampler, defaultSamplerSettings, triggerSample } from '../sampler/sampler.js';
import { VoiceSynth, OSC_LABELS, defaultSynthSettings } from '../synthesizer/synth.js';
import { keyboardUI, PC_KEYMAP, pcKeyLabel } from './keyboard.js';
import { padsUI, PAD_KEY_TO_IDX } from './pads.js';
import { engine } from '../audio/engine.js';
import { bus } from '../utils/bus.js';
import { fitCanvas, drawWave } from './draw.js';
import { autoChop } from '../analysis/analyze.js';
import { slice } from '../audio/edit.js';
import { midiState, initMIDI } from '../midi/midi.js';
import { newClip, snapValue } from '../timeline/project.js';
import { transport } from '../sequencer/transport.js';

function assetSelect(curId, onChange, allowNone = true) {
  const sel = h('select', { 'aria-label': '素材を選択' }, allowNone ? h('option', { value: '' }, '(素材を選択)') : null, app.project.assets.map((a) => h('option', { value: a.id, selected: a.id === curId }, a.name)));
  sel.addEventListener('change', () => onChange(sel.value || null));
  return sel;
}
export function instrumentsUI() {
  const root = h('div', { class: 'instruments' });
  const tabs = h('div', { class: 'inst-tabs' }); const body = h('div', { class: 'inst-body' });
  root.append(tabs, body);
  let mode = 'sampler';
  const sampler = new Sampler(getAsset), synth = new VoiceSynth(getAsset);
  function syncSettings() { sampler.s = { ...defaultSamplerSettings(), ...app.project.sampler }; synth.s = { ...defaultSynthSettings(), ...app.project.synth }; }
  syncSettings(); bus.on('project:restored', syncSettings); bus.on('project:changed', syncSettings);
  let heldKeys = new Set(), heldPads = new Map(), midiInit = false;
  function activeVoice() { return mode === 'synth' ? synth : sampler; }
  function noteOn(m, v) { engine.init().then(() => activeVoice().noteOn(m, v)); }
  function noteOff(m) { activeVoice().noteOff(m); }
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (!root.isConnected || root.closest('.dock-panel.hidden')) return;
    const k = e.key.toLowerCase();
    if (mode === 'pads' && PAD_KEY_TO_IDX[k] !== undefined) { triggerPad(PAD_KEY_TO_IDX[k]); return; }
    if ((mode === 'sampler' || mode === 'synth') && PC_KEYMAP[k] !== undefined) { const m = PC_KEYMAP[k] + octave * 12; if (!heldKeys.has(k)) { heldKeys.add(k); noteOn(m, 0.9); kbEl && kbEl.press(m); } }
  });
  window.addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); if (PC_KEYMAP[k] !== undefined && heldKeys.has(k)) { heldKeys.delete(k); const m = PC_KEYMAP[k] + octave * 12; noteOff(m); kbEl && kbEl.release(m); } if (mode === 'pads' && PAD_KEY_TO_IDX[k] !== undefined) releasePad(PAD_KEY_TO_IDX[k]); });
  bus.on('midi:noteon', (n, v) => noteOn(n, v)); bus.on('midi:noteoff', (n) => noteOff(n));
  let octave = 0, kbEl = null;

  function tabBtn(id, label) { return h('button', { class: 'btn tab' + (mode === id ? ' active' : ''), onclick: () => { mode = id; renderTabs(); renderBody(); } }, label); }
  function renderTabs() { tabs.replaceChildren(tabBtn('sampler', 'Sampler'), tabBtn('synth', 'Voice Synth'), tabBtn('pads', 'パッド'), tabBtn('chop', 'Voice Chop'), h('span', { class: 'grow' }), h('span', { class: 'midi-status', title: midiState.status }, midiState.status)); }

  function paramList(obj, defs, onSet) { return defs.map((d) => slider(d, obj[d.k], (v) => onSet(d.k, v))); }
  const samplerDefs = [{ k: 'root', n: 'ルートキー', min: 24, max: 96, def: 60, step: 1 }, { k: 'tune', n: 'チューニング', min: -100, max: 100, def: 0, unit: 'cent' }, { k: 'start', n: 'Start', min: 0, max: 1, def: 0 }, { k: 'end', n: 'End', min: 0, max: 1, def: 1 }, { k: 'gain', n: 'Gain', min: 0, max: 1.5, def: 0.9 }, { k: 'a', n: 'Attack', min: 0.001, max: 1, def: 0.005, unit: 's' }, { k: 'd', n: 'Decay', min: 0.01, max: 2, def: 0.15, unit: 's' }, { k: 's', n: 'Sustain', min: 0, max: 1, def: 0.8 }, { k: 'r', n: 'Release', min: 0.01, max: 3, def: 0.25, unit: 's' }, { k: 'xfade', n: 'ループクロスフェード', min: 0, max: 100, def: 20, unit: 'ms' }];
  function samplerPanel() {
    const s = sampler.s, cv = h('canvas', { class: 'inst-wave' });
    const wrap = h('div', { class: 'inst-panel' },
      h('div', { class: 'inst-row' }, h('label', null, '素材', assetSelect(s.assetId, (id) => { mutate('サンプラー素材設定', () => { app.project.sampler.assetId = id; }); syncSettings(); drawSampleWave(); })),
        h('button', { class: 'btn sm', onclick: () => { const buf = s.assetId && getAsset(s.assetId); if (buf) previewLoop(buf, s); } }, '試聴'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: s.loop, onchange: (e) => setS('loop', e.target.checked) }), 'ループ'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: s.reverse, onchange: (e) => setS('reverse', e.target.checked) }), 'リバース')),
      cv,
      h('div', { class: 'inst-grid' }, ...paramList(s, samplerDefs, setS),
        slider({ k: 'loopStart', n: 'Loop Start', min: 0, max: 1, def: 0 }, s.loopStart, (v) => setS('loopStart', v)), slider({ k: 'loopEnd', n: 'Loop End', min: 0, max: 1, def: 1 }, s.loopEnd, (v) => setS('loopEnd', v))));
    function setS(k, v) { mutate('サンプラー設定', () => { app.project.sampler[k] = v; }, 's' + k); syncSettings(); if (['start', 'end', 'loopStart', 'loopEnd'].includes(k)) drawSampleWave(); }
    function drawSampleWave() { const buf = s.assetId && getAsset(s.assetId); if (!buf) return; const { c, w, h: hh } = fitCanvas(cv); c.clearRect(0, 0, w, hh); drawWave(c, buf, 0, 0, w, hh, 0, buf.ch[0].length / buf.sr, '#4de0c1', { mono: true }); c.fillStyle = 'rgba(255,93,115,0.18)'; c.fillRect(0, 0, s.start * w, hh); c.fillRect(s.end * w, 0, (1 - s.end) * w, hh); if (s.loop) { c.strokeStyle = '#ffb02e'; c.beginPath(); c.moveTo(s.start * w + s.loopStart * (s.end - s.start) * w, 0); c.lineTo(s.start * w + s.loopStart * (s.end - s.start) * w, hh); c.moveTo(s.start * w + s.loopEnd * (s.end - s.start) * w, 0); c.lineTo(s.start * w + s.loopEnd * (s.end - s.start) * w, hh); c.stroke(); } }
    requestAnimationFrame(drawSampleWave); return wrap;
  }
  function previewLoop(buf, s) { engine.init().then(() => sampler.noteOn(s.root, 1)); setTimeout(() => sampler.noteOff(s.root), 700); }
  const synthDefs1 = [{ k: 'osc', n: '波形', min: 0, max: 4, def: 2, opts: OSC_LABELS }, { k: 'voiceMix', n: 'Voice/Synth Mix', min: 0, max: 1, def: 0.4 }, { k: 'detune', n: 'デチューン', min: -50, max: 50, def: 0, unit: 'cent' }];
  const synthDefs2 = [{ k: 'cutoff', n: 'Cutoff', min: 60, max: 12000, def: 3500, unit: 'Hz' }, { k: 'res', n: 'Resonance', min: 0.1, max: 20, def: 2 }, { k: 'filterType', n: 'フィルター種別', min: 0, max: 2, def: 0, opts: ['ローパス', 'ハイパス', 'バンドパス'] }];
  const synthDefs3 = [{ k: 'a', n: 'Attack', min: 0.001, max: 1.5, def: 0.01, unit: 's' }, { k: 'd', n: 'Decay', min: 0.01, max: 2, def: 0.2, unit: 's' }, { k: 's', n: 'Sustain', min: 0, max: 1, def: 0.7 }, { k: 'r', n: 'Release', min: 0.01, max: 3, def: 0.4, unit: 's' }, { k: 'gain', n: 'Gain', min: 0, max: 1.5, def: 0.5 }];
  const synthDefs4 = [{ k: 'lfoRate', n: 'LFO Rate', min: 0.05, max: 20, def: 5, unit: 'Hz' }, { k: 'lfoDepth', n: 'LFO Depth', min: 0, max: 1, def: 0 }, { k: 'lfoTarget', n: 'LFO対象', min: 0, max: 2, def: 0, opts: ['ピッチ', 'フィルター', '音量'] }, { k: 'lfoShape', n: 'LFO波形', min: 0, max: 3, def: 0, opts: ['サイン', '三角', '矩形', 'ノコギリ'] }];
  function synthPanel() {
    const s = synth.s;
    const wrap = h('div', { class: 'inst-panel' }, h('div', { class: 'inst-row' }, h('label', null, 'Voice素材(任意)', assetSelect(s.assetId, (id) => setS('assetId', id))), h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: s.voiceLoop, onchange: (e) => setS('voiceLoop', e.target.checked) }), 'Voiceループ')),
      h('h5', null, 'Oscillator'), h('div', { class: 'inst-grid' }, ...paramList(s, synthDefs1, setS)),
      h('h5', null, 'Filter'), h('div', { class: 'inst-grid' }, ...paramList(s, synthDefs2, setS)),
      h('h5', null, 'ADSR'), h('div', { class: 'inst-grid' }, ...paramList(s, synthDefs3, setS)),
      h('h5', null, 'LFO'), h('div', { class: 'inst-grid' }, ...paramList(s, synthDefs4, setS)));
    function setS(k, v) { mutate('シンセ設定', () => { app.project.synth[k] = v; }, 'syn' + k); syncSettings(); }
    return wrap;
  }
  function keyboardPanel() {
    const wrap = h('div', { class: 'inst-panel' });
    const octLbl = h('span', null, 'オクターブ ' + octave);
    kbEl = keyboardUI({ lowNote: 36, highNote: 96, onDown: (m, v) => noteOn(m, v), onUp: (m) => noteOff(m) });
    wrap.append(h('div', { class: 'kb-toolbar' },
      h('button', { class: 'btn sm', onclick: () => { octave = Math.max(-3, octave - 1); octLbl.textContent = 'オクターブ ' + octave; } }, '⟵ Oct'), octLbl, h('button', { class: 'btn sm', onclick: () => { octave = Math.min(3, octave + 1); octLbl.textContent = 'オクターブ ' + octave; } }, 'Oct ⟶'),
      h('span', { class: 'hint' }, 'PCキー: ' + pcKeyLabel(PC_KEYMAP)),
      h('button', { class: 'btn sm', onclick: async () => { if (!midiInit) { midiInit = true; await initMIDI(); } toast(midiState.status); } }, 'MIDI接続')));
    wrap.append(kbEl); return wrap;
  }
  const padsData = () => app.project.pads;
  function triggerPad(i) { const p = padsData()[i]; engine.init().then(() => { const buf = p.assetId && getAsset(p.assetId); if (!buf) { toast('このパッドには素材が割り当てられていません。ライブラリからドラッグするか、Voice Chopで割り当ててください。', 'warn'); return; } padsEl.flash(i); const { triggerSample } = requireSampler(); const s = { ...defaultSamplerSettings(), root: 60, tune: p.pitch * 100, loop: p.loop && !p.oneShot, gain: p.gain, a: 0.002, d: 0.05, s: 1, r: p.oneShot ? 0.05 : 0.2 }; heldPads.set(i, s.__voice = triggerSampleWrap(buf, p.id, s)); }); }
  function releasePad(i) { const v = heldPads.get(i); if (v && !padsData()[i].oneShot) { v.stop(); heldPads.delete(i); } }
  function requireSampler() { return { triggerSample }; }
  function triggerSampleWrap(buf, key, s) { return triggerSample(buf, key, s); }
  let padsEl = null;
  function padsPanel() {
    padsEl = padsUI(padsData(), { onTrigger: (i) => triggerPad(i), onRelease: (i) => releasePad(i), onEdit: (i) => editPad(i) });
    const wrap = h('div', { class: 'inst-panel' }, h('p', { class: 'hint' }, 'クリックまたはキー（' + Object.keys(PAD_KEY_TO_IDX).join(' ').toUpperCase() + '）で演奏。ダブルクリックで編集。ライブラリからドラッグでも割り当てできます。'), padsEl);
    padsEl.addEventListener('dragover', (e) => e.preventDefault());
    padsEl.addEventListener('drop', (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/x-asset'); if (!id) return; const el = e.target.closest('.pad'); if (!el) return; const i = [...padsEl.children].indexOf(el); mutate('パッドに素材を割り当て', () => { app.project.pads[i].assetId = id; app.project.pads[i].name = app.project.assets.find((a) => a.id === id)?.name || app.project.pads[i].name; }); padsEl.refreshEmpty(app.project.pads); });
    return wrap;
  }
  async function editPad(i) { const p = app.project.pads[i]; const n = await askText('パッド編集', '名前', p.name); if (n) mutate('パッド名変更', () => { p.name = n; }); mutate('パッド設定', () => { p.oneShot = !p.oneShot; }); toast(p.oneShot ? 'One Shot に設定' : 'ループ(押している間再生) に設定'); padsEl.refreshEmpty(app.project.pads); }
  bus.on('project:changed', () => padsEl && padsEl.refreshEmpty(app.project.pads));

  function chopPanel() {
    const cv = h('canvas', { class: 'inst-wave' }); let curAsset = app.sel.assetId || (app.project.assets[0] && app.project.assets[0].id); let segs = [], sensitivity = 0.5;
    const assetSel = assetSelect(curAsset, (id) => { curAsset = id; segs = []; draw(); }, false);
    const list = h('div', { class: 'chop-list' });
    function buf() { return curAsset && getAsset(curAsset); }
    function draw() { const b = buf(); if (!b) return; const { c, w, h: hh } = fitCanvas(cv); c.clearRect(0, 0, w, hh); drawWave(c, b, 0, 0, w, hh, 0, b.ch[0].length / b.sr, '#4de0c1', { mono: true }); const n = b.ch[0].length; c.fillStyle = 'rgba(255,176,46,0.25)'; c.strokeStyle = '#ffb02e'; for (const s of segs) { const x0 = (s.s / n) * w, x1 = (s.e / n) * w; c.fillRect(x0, 0, x1 - x0, hh); c.beginPath(); c.moveTo(x0, 0); c.lineTo(x0, hh); c.moveTo(x1, 0); c.lineTo(x1, hh); c.stroke(); } }
    function renderList() { list.replaceChildren(...segs.map((s, i) => h('div', { class: 'chop-item' }, h('span', null, 'チャンク ' + (i + 1) + ' (' + ((s.e - s.s) / buf().sr).toFixed(2) + 's)'), h('button', { class: 'btn xs', onclick: () => { const b = slice(buf(), s.s, s.e); engine.init().then(() => { const ab = engine.ctx.createBuffer(1, b.ch[0].length, b.sr); ab.copyToChannel(b.ch[0], 0); const src2 = engine.ctx.createBufferSource(); src2.buffer = ab; src2.connect(engine.preview); src2.start(); }); } }, '▶'), h('button', { class: 'btn xs', onclick: async () => { const b = slice(buf(), s.s, s.e); const id = await addAsset(b, { name: (app.project.assets.find((a) => a.id === curAsset) || {}).name + '_' + (i + 1), folder: 'CHOPS' }); toast('素材として保存しました'); } }, '素材化'), h('button', { class: 'btn xs', onclick: () => { const idx = padsData().findIndex((p) => !p.assetId); if (idx < 0) { toast('空いているパッドがありません', 'warn'); return; } saveSegAndAssign(s, idx); } }, 'パッドへ'), h('button', { class: 'btn xs', onclick: () => addToTimeline(s) }, 'タイムラインへ')))); }
    async function saveSegAndAssign(s, idx) { const b = slice(buf(), s.s, s.e); const id = await addAsset(b, { name: 'chop_' + (idx + 1), folder: 'CHOPS' }); mutate('パッドに割り当て', () => { app.project.pads[idx].assetId = id; app.project.pads[idx].name = 'CHOP ' + (idx + 1); }); toast('パッド ' + (idx + 1) + ' に割り当てました'); padsEl && padsEl.refreshEmpty(app.project.pads); }
    function addToTimeline(s) { const b = slice(buf(), s.s, s.e); addAsset(b, { name: 'chop_clip', folder: 'CHOPS' }).then((id) => { const tr = selectedTrack(); mutate('タイムラインに追加', () => { const start = snapValue(app.project, transport.pos); tr.clips.push(newClip(id, start, b.ch[0].length / b.sr)); }); toast('タイムラインに配置しました'); }); }
    let dragS = null;
    cv.addEventListener('pointerdown', (e) => { const b = buf(); if (!b) return; const r = cv.getBoundingClientRect(); dragS = Math.floor(((e.clientX - r.left) / r.width) * b.ch[0].length); });
    cv.addEventListener('pointermove', (e) => { if (dragS == null) return; const b = buf(); const r = cv.getBoundingClientRect(); const x = Math.floor(((e.clientX - r.left) / r.width) * b.ch[0].length); draw(); const { c, w, h: hh } = fitCanvas(cv); c.fillStyle = 'rgba(93,180,255,0.3)'; c.fillRect((Math.min(dragS, x) / b.ch[0].length) * w, 0, (Math.abs(x - dragS) / b.ch[0].length) * w, hh); });
    cv.addEventListener('pointerup', (e) => { if (dragS == null) return; const b = buf(); const r = cv.getBoundingClientRect(); const x = Math.floor(((e.clientX - r.left) / r.width) * b.ch[0].length); const s = Math.min(dragS, x), en = Math.max(dragS, x); dragS = null; if (en - s > 128) { segs.push({ s, e: en }); segs.sort((a, b2) => a.s - b2.s); draw(); renderList(); } });
    const wrap = h('div', { class: 'inst-panel' }, h('div', { class: 'inst-row' }, h('label', null, '素材', assetSel), h('button', { class: 'btn sm', onclick: () => { const b = buf(); if (!b) { toast('素材がありません', 'warn'); return; } segs = autoChop(b.ch[0], b.sr, sensitivity).map((s) => ({ s: s.s, e: s.e })); draw(); renderList(); if (!segs.length) toast('区切りを検出できませんでした。感度を上げてお試しください。', 'warn'); } }, '自動分割'),
      slider({ k: 'sens', n: '感度', min: 0.1, max: 1, def: 0.5 }, sensitivity, (v) => (sensitivity = v)), h('button', { class: 'btn sm', onclick: () => { segs = []; draw(); renderList(); } }, 'クリア'), h('span', { class: 'hint' }, 'ドラッグで手動分割も追加できます')),
      cv, list);
    draw(); return wrap;
  }
  function renderBody() { body.replaceChildren(mode === 'sampler' ? samplerPanel() : mode === 'synth' ? synthPanel() : mode === 'pads' ? padsPanel() : chopPanel()); if (mode === 'sampler' || mode === 'synth') body.append(keyboardPanel()); }
  bus.on('project:restored', () => { syncSettings(); renderBody(); });
  bus.on('assets:changed', () => renderBody());
  renderTabs(); renderBody();
  root.allOff = () => { sampler.allOff(); synth.allOff(); };
  return root;
}

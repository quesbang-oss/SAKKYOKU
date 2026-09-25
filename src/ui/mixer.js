import { h, slider } from '../utils/dom.js';
import { app, mutate } from '../app.js';
import { engine } from '../audio/engine.js';
import { LufsMeter } from '../analysis/analyze.js';
import { bus } from '../utils/bus.js';
import { addTick } from './loop.js';

export function mixerUI() {
  const root = h('div', { class: 'mixer' });
  const strips = h('div', { class: 'mixer-strips' });
  root.append(strips);
  const meters = new Map(); let lufsRT = null;
  function render() {
    strips.replaceChildren();
    for (const tr of app.project.tracks) strips.append(strip(tr));
    strips.append(masterStrip());
  }
  function strip(tr) {
    const meter = h('div', { class: 'ch-meter' }, h('div', { class: 'ch-meter-l' }), h('div', { class: 'ch-meter-r' }));
    meters.set(tr.id, meter);
    const el = h('div', { class: 'mixer-strip', style: { '--c': tr.color } },
      h('div', { class: 'ms-name' }, tr.name),
      h('div', { class: 'ms-btns' }, h('button', { class: 'btn xs' + (tr.mute ? ' on' : ''), onclick: () => { mutate('ミュート', () => { tr.mute = !tr.mute; }); render(); } }, 'M'), h('button', { class: 'btn xs' + (tr.solo ? ' on' : ''), onclick: () => { mutate('ソロ', () => { tr.solo = !tr.solo; }); render(); } }, 'S')),
      h('div', { class: 'ms-pan' }, slider({ k: 'pan', n: 'Pan', min: -1, max: 1, def: 0 }, tr.pan, (v) => mutate('パン', () => { tr.pan = v; }, 'pan' + tr.id))),
      h('div', { class: 'ms-fadewrap' }, meter, h('input', { type: 'range', class: 'fader', orient: 'vertical', min: 0, max: 1.5, step: 0.01, value: tr.vol, oninput: (e) => mutate('音量', () => { tr.vol = +e.target.value; }, 'vol' + tr.id) })),
      h('div', { class: 'ms-val' }, (20 * Math.log10(Math.max(tr.vol, 1e-4))).toFixed(1) + ' dB'));
    return el;
  }
  function masterStrip() {
    const M = app.project.master, meter = h('div', { class: 'ch-meter' }, h('div', { class: 'ch-meter-l' }), h('div', { class: 'ch-meter-r' })); meters.set('__master', meter);
    const lufsEl = h('div', { class: 'ms-lufs' }, '— LUFS');
    const el = h('div', { class: 'mixer-strip master' },
      h('div', { class: 'ms-name' }, 'MASTER'),
      h('div', { class: 'ms-section' }, h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: M.comp.on, onchange: (e) => mutate('コンプON/OFF', () => { M.comp.on = e.target.checked; }) }), 'Compressor'),
        slider({ k: 'thr', n: 'Threshold', min: -40, max: 0, def: -14, unit: 'dB' }, M.comp.thr, (v) => mutate('コンプThr', () => { M.comp.thr = v; }, 'cthr')),
        slider({ k: 'ratio', n: 'Ratio', min: 1, max: 12, def: 3 }, M.comp.ratio, (v) => mutate('コンプRatio', () => { M.comp.ratio = v; }, 'cr'))),
      h('div', { class: 'ms-section' }, h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: M.limiter.on, onchange: (e) => mutate('リミッターON/OFF', () => { M.limiter.on = e.target.checked; }) }), 'Limiter'),
        slider({ k: 'ceil', n: 'Ceiling', min: -6, max: 0, def: -1, unit: 'dB' }, M.limiter.ceil, (v) => mutate('リミッター上限', () => { M.limiter.ceil = v; }, 'lc'))),
      h('div', { class: 'ms-section' }, h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: M.autoGain.on, onchange: (e) => mutate('オートゲインON/OFF', () => { M.autoGain.on = e.target.checked; }) }), 'Auto Gain'),
        slider({ k: 'target', n: 'Target LUFS', min: -24, max: -8, def: -14, unit: '' }, M.autoGain.target, (v) => mutate('オートゲイン目標', () => { M.autoGain.target = v; }, 'ag'))),
      h('div', { class: 'ms-fadewrap' }, meter, h('input', { type: 'range', class: 'fader', orient: 'vertical', min: 0, max: 1.5, step: 0.01, value: M.vol, oninput: (e) => { mutate('マスター音量', () => { M.vol = +e.target.value; }, 'mvol'); engine.setMasterVolume ? null : null; } })),
      lufsEl);
    el._lufs = lufsEl; return el;
  }
  function readLevel(an) { return engine.constructor.level(an); }
  addTick(() => {
    if (!engine.ctx) return;
    for (const tr of app.project.tracks) { /* トラック単体メーターは簡易表示: マスターに委譲(将来拡張) */ }
    const m = meters.get('__master'); if (m && engine.masterAn) { const { peak, rms } = readLevel(engine.masterAn); m.querySelector('.ch-meter-l').style.height = Math.min(100, rms * 260) + '%'; m.querySelector('.ch-meter-r').style.height = Math.min(100, peak * 260) + '%'; m.classList.toggle('clip', peak > 0.98); }
    if (!lufsRT || lufsRT.sr !== engine.sr) lufsRT = new LufsMeter(engine.sr);
    if (engine.masterAn) { const buf = mixerUI._buf && mixerUI._buf.length === engine.masterAn.fftSize ? mixerUI._buf : (mixerUI._buf = new Float32Array(engine.masterAn.fftSize)); engine.masterAn.getFloatTimeDomainData(buf); lufsRT.push(buf, buf); const strip = strips.querySelector('.mixer-strip.master'); if (strip) strip._lufs.textContent = (isFinite(lufsRT.lufs) ? lufsRT.lufs.toFixed(1) : '—') + ' LUFS'; }
  });
  bus.on('project:changed', render); bus.on('project:restored', render);
  root.render = render; render(); return root;
}

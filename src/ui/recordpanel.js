import { h, toast, showError, askText, confirmBox } from '../utils/dom.js';
import { engine, explainMicError } from '../audio/engine.js';
import { Recorder, findRecoverable, recoverSession, deleteRecoverable } from '../recorder/recorder.js';
import { app, addAsset, replaceAsset, mutate } from '../app.js';
import { bus } from '../utils/bus.js';
import { makeMeter, fitCanvas } from './draw.js';
import { detectSilence } from '../analysis/analyze.js';
import { trimEnds, cutRange, concat, slice } from '../audio/edit.js';
import { addTick } from './loop.js';

export function recordPanelUI() {
  const root = h('div', { class: 'record-panel' });
  const rec = new Recorder(() => engine.recNode, { recoverable: true });
  let takes = [], curName = '', wave = [], recBuf = null, deviceList = [];
  const meter = makeMeter('入力レベル');
  const cv = h('canvas', { class: 'rec-wave' });
  const timeEl = h('span', { class: 'rec-time' }, '00:00.00');
  const stateEl = h('span', { class: 'rec-state' }, '待機中');
  const takesList = h('div', { class: 'takes-list' });
  const deviceSel = h('select', { 'aria-label': 'マイクを選択' });
  const srSel = h('select', { 'aria-label': 'サンプリングレート' }, [48000, 44100, 32000, 16000].map((s) => h('option', { value: s }, s + ' Hz')));
  const chSel = h('select', { 'aria-label': 'チャンネル' }, [['1', 'モノラル'], ['2', 'ステレオ']].map(([v, l]) => h('option', { value: v }, l)));
  const cdSel = h('select', { 'aria-label': 'カウントダウン' }, [0, 1, 2, 3, 5].map((s) => h('option', { value: s, selected: s === 3 }, s === 0 ? 'なし' : s + '秒')));
  const monitorChk = h('input', { type: 'checkbox' });
  const clipWarn = h('div', { class: 'clip-warn', hidden: true }, '⚠ クリッピングが発生しています。入力音量を下げてください。');
  const recoverBanner = h('div', { class: 'recover-banner', hidden: true });

  async function refreshDevices() { deviceList = await engine.listInputs(); deviceSel.replaceChildren(h('option', { value: '' }, '既定のマイク'), ...deviceList.map((d, i) => h('option', { value: d.deviceId }, d.label || 'マイク ' + (i + 1)))); }
  navigator.mediaDevices && navigator.mediaDevices.addEventListener && navigator.mediaDevices.addEventListener('devicechange', refreshDevices);

  async function ensureMic() {
    try { await engine.startMic({ sampleRate: +srSel.value, channels: +chSel.value, deviceId: deviceSel.value }); engine.setMonitor(monitorChk.checked); rec.attach(); await refreshDevices(); return true; }
    catch (e) { const err = e.title ? e : explainMicError(e); showError(err.title, err.message, err.help); return false; }
  }
  const startBtn = h('button', { class: 'btn primary lg', onclick: async () => { if (!(await ensureMic())) return; wave = []; await rec.start({ countdown: +cdSel.value }); } }, '● 録音');
  const pauseBtn = h('button', { class: 'btn lg', disabled: true, onclick: () => (rec.state === 'recording' ? rec.pause() : rec.resume()) }, '⏸ 一時停止');
  const stopBtn = h('button', { class: 'btn lg', disabled: true, onclick: async () => { recBuf = await rec.stop(); if (recBuf) { curName = '録音 ' + (takes.length + 1); takes.push({ name: curName, buf: recBuf }); renderTakes(); drawWave(); toast('録音を停止しました。プレビューして保存できます。', 'ok'); } } }, '■ 停止');
  const cancelBtn = h('button', { class: 'btn danger', onclick: () => rec.cancel() }, '取消');

  bus.on('rec:state', (s) => { stateEl.textContent = s === 'idle' ? '待機中' : s === 'countdown' ? 'カウントダウン中…' : s === 'recording' ? '録音中' : '一時停止中'; startBtn.disabled = s !== 'idle'; pauseBtn.disabled = s === 'idle' || s === 'countdown'; pauseBtn.textContent = s === 'paused' ? '▶ 再開' : '⏸ 一時停止'; stopBtn.disabled = s === 'idle'; root.classList.toggle('is-rec', s === 'recording'); });
  bus.on('rec:countdown', (n) => { stateEl.textContent = n > 0 ? 'カウントダウン: ' + n : '録音中'; });
  bus.on('rec:level', (d) => { meter.update(d.peak, d.rms); clipWarn.hidden = d.peak < 0.98; });
  bus.on('rec:chunk', () => { timeEl.textContent = fmt(rec.seconds); wave.push(...rec.peaks.slice(wave.length)); drawWave(); });
  bus.on('mic:ended', () => showError('マイクが切断されました', 'デバイスが取り外されたか、他のアプリに切り替わりました。', 'マイクを選び直して、もう一度お試しください。'));

  function fmt(s) { const m = Math.floor(s / 60), r = (s % 60).toFixed(2); return String(m).padStart(2, '0') + ':' + r.padStart(5, '0'); }
  function drawWave() { const { c, w, h: hh } = fitCanvas(cv); c.clearRect(0, 0, w, hh); c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#4de0c1'; const n = Math.min(wave.length, Math.floor(w)); for (let i = 0; i < n; i++) { const p = wave[wave.length - n + i], mid = hh / 2; c.fillRect(w - n + i, mid + p[0] * mid * 0.95, 1, Math.max(1, (p[1] - p[0]) * mid * 0.95)); } }

  function renderTakes() {
    takesList.replaceChildren(...takes.map((t, i) => h('div', { class: 'take-row' },
      h('input', { class: 'take-name', value: t.name, onchange: (e) => (t.name = e.target.value || t.name) }),
      h('span', { class: 'take-dur' }, (t.buf.ch[0].length / t.buf.sr).toFixed(2) + 's'),
      h('button', { class: 'btn xs', title: '再生', onclick: () => playBuf(t.buf) }, '▶'),
      h('button', { class: 'btn xs', title: 'ノイズ除去プレビューと保存', onclick: () => openPreview(t) }, '仕上げ→保存'),
      h('button', { class: 'btn xs', title: '無音を自動カット', onclick: () => { t.buf = autoTrim(t.buf); toast('無音部分をカットしました'); } }, '無音カット'),
      h('button', { class: 'btn xs danger', title: '削除', onclick: () => { takes.splice(i, 1); renderTakes(); } }, '✕'))));
  }
  function autoTrim(buf) { const trimmed = trimEnds(buf, -50); const segs = detectSilence(trimmed.ch[0], trimmed.sr, app.settings.silenceThr, 250); if (!segs.length) return trimmed; const parts = []; let p = 0; for (const s of segs) { if (s.s > p) parts.push(slice(trimmed, p, s.s)); p = s.e; } if (p < trimmed.ch[0].length) parts.push(slice(trimmed, p, trimmed.ch[0].length)); return parts.length ? concat(parts) : trimmed; }
  let previewSrc = null;
  function playBuf(buf) { engine.init().then(() => { if (previewSrc) try { previewSrc.stop(); } catch {} const ab = engine.ctx.createBuffer(buf.ch.length, buf.ch[0].length, buf.sr); buf.ch.forEach((c, i) => ab.copyToChannel(c, i)); const s = engine.ctx.createBufferSource(); s.buffer = ab; s.connect(engine.preview); s.start(); previewSrc = s; }); }
  async function openPreview(t) {
    const { compareUI } = await import('./compare.js'); const ui = compareUI(t.buf, async (finalBuf, name) => { const id = await addAsset(finalBuf, { name: name || t.name, folder: 'VOICE' }); toast('素材ライブラリに保存しました：' + (name || t.name), 'ok'); bus.emit('lib:added', id); });
    const { modal } = await import('../utils/dom.js'); modal(t.name + ' の仕上げ', ui, [{ label: '閉じる', primary: true }]);
  }
  async function showRecoverBanner() { const items = await findRecoverable(); if (!items.length) { recoverBanner.hidden = true; return; } recoverBanner.hidden = false; recoverBanner.replaceChildren('⚠ 前回保護された未保存の録音があります。', ...items.map((it) => h('span', { class: 'recover-item' }, h('button', { class: 'btn xs', onclick: async () => { const buf = await recoverSession(it.sid); takes.push({ name: '復元された録音', buf }); renderTakes(); await deleteRecoverable(it.sid); showRecoverBanner(); toast('録音を復元しました', 'ok'); } }, '復元する'), h('button', { class: 'btn xs danger', onclick: async () => { await deleteRecoverable(it.sid); showRecoverBanner(); } }, '破棄')))); }
  showRecoverBanner();

  root.append(
    recoverBanner,
    h('div', { class: 'rec-setup' },
      h('label', null, 'マイク', deviceSel), h('label', null, 'サンプルレート', srSel), h('label', null, 'チャンネル', chSel), h('label', null, 'カウントダウン', cdSel),
      h('label', { class: 'chk' }, monitorChk, 'モニター(自分の声を聞く)')),
    meter, clipWarn,
    h('div', { class: 'rec-main' }, cv, h('div', { class: 'rec-info' }, timeEl, stateEl)),
    h('div', { class: 'rec-btns' }, startBtn, pauseBtn, stopBtn, cancelBtn),
    h('h4', null, 'テイク'), takesList);
  monitorChk.addEventListener('change', () => engine.setMonitor(monitorChk.checked));
  refreshDevices();
  addTick(() => { if (rec.state === 'recording' || rec.state === 'paused') timeEl.textContent = fmt(rec.seconds); });
  root.stopAll = () => { rec.state !== 'idle' && rec.cancel(); if (previewSrc) try { previewSrc.stop(); } catch {} };
  return root;
}

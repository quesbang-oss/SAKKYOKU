import { h, modal, showError } from '../utils/dom.js';
import { engine, explainMicError } from '../audio/engine.js';
import { makeMeter } from './draw.js';
import { addTick } from './loop.js';
import { BUILTIN_PRESETS } from '../effects/presets.js';
import { db, kvGet, kvSet } from '../storage/db.js';

export async function maybeShowSetupWizard() {
  const done = await kvGet('setupDone', false); if (done) return; await runSetupWizard(); await kvSet('setupDone', true);
}
export async function runSetupWizard() {
  const meter = makeMeter('入力レベル確認');
  const deviceSel = h('select', { 'aria-label': 'マイクを選択' });
  const monChk = h('input', { type: 'checkbox' });
  let started = false, off = null;
  async function refresh() { const list = await engine.listInputs(); deviceSel.replaceChildren(h('option', { value: '' }, '既定のマイク'), ...list.map((d, i) => h('option', { value: d.deviceId }, d.label || 'マイク ' + (i + 1)))); }
  async function tryMic() { try { await engine.startMic({ sampleRate: 48000, channels: 1, deviceId: deviceSel.value }); await refresh(); started = true; engine.setMonitor(monChk.checked); status.textContent = 'マイクの入力が確認できています。声を出してメーターが動くか確認してください。'; } catch (e) { const err = e.title ? e : explainMicError(e); status.textContent = '⚠ ' + err.message; showError(err.title, err.message, err.help); } }
  const status = h('p', { class: 'hint' }, 'マイクを選んで「マイクを許可してテスト」を押してください。');
  monChk.addEventListener('change', () => engine.setMonitor(monChk.checked));
  const body = h('div', { class: 'setup-wizard' },
    h('h3', null, 'ようこそ Voice DAW へ'),
    h('p', null, 'このアプリは、あなたの声を録音してエフェクトで電子音化し、鍵盤やパッドで演奏しながら曲を作れる音声制作ツールです。まずはマイクを準備しましょう。'),
    h('div', { class: 'setup-row' }, h('label', null, 'マイク', deviceSel), h('button', { class: 'btn sm', onclick: tryMic }, '🎙 マイクを許可してテスト')),
    h('label', { class: 'chk' }, monChk, 'モニター（自分の声をヘッドホンで確認。ハウリング防止のためスピーカーでは避けてください）'),
    meter, status,
    h('h4', null, '基本プリセットを選ぶ（あとで変更できます）'),
    h('div', { class: 'preset-pick' }, BUILTIN_PRESETS.slice(0, 5).map((p) => h('label', { class: 'chk' }, h('input', { type: 'radio', name: 'preset0', value: p.name }), p.name))),
    h('p', { class: 'hint' }, 'このあと、「録音」→「電子音化」→「鍵盤で演奏」の順に進めます。左のメニューからいつでも各機能に移動できます。'));
  const off2 = addTick(() => started && meter.update(...Object.values(engine.constructor.level(engine.micAn))));
  await refresh();
  await modal('初期セットアップ', body, [{ label: 'スキップ', value: 'skip' }, { label: 'はじめる', primary: true, value: 'go' }]);
  off2();
}

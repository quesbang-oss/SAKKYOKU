import { h, modal, download, toast } from '../utils/dom.js';
import { app } from '../app.js';
import { exportAudio } from '../export/exporter.js';
import { notesToSMF } from '../midi/midi.js';

export async function openExportDialog() {
  const o = { scope: 'master', format: 'wav', sr: 44100, bits: 16, kbps: 192, normalize: true, normDb: -1 };
  const prog = h('div', { class: 'export-progress', hidden: true }, h('div', { class: 'bar' }), h('span', { class: 'pct' }, '0%'));
  const body = h('div', { class: 'export-dialog' },
    h('label', null, '対象', h('select', { onchange: (e) => (o.scope = e.target.value) }, h('option', { value: 'master' }, 'マスター(全体)'), h('option', { value: 'tracks' }, 'トラックごと'), h('option', { value: 'selection' }, '選択範囲のみ'), h('option', { value: 'loop' }, 'ループ範囲のみ'))),
    h('label', null, '形式', h('select', { onchange: (e) => { o.format = e.target.value; renderExtra(); } }, h('option', { value: 'wav' }, 'WAV'), h('option', { value: 'mp3' }, 'MP3'), h('option', { value: 'ogg' }, 'OGG'), h('option', { value: 'webm' }, 'WebM'))),
    h('label', null, 'サンプルレート', h('select', { onchange: (e) => (o.sr = +e.target.value) }, [44100, 48000, 22050].map((s) => h('option', { value: s, selected: s === 44100 }, s + ' Hz')))),
    h('div', { id: 'extra' }),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => (o.normalize = e.target.checked) }), 'ノーマライズ'),
    prog);
  function renderExtra() { const ex = body.querySelector('#extra'); ex.replaceChildren(o.format === 'wav' ? h('label', null, 'ビット深度', h('select', { onchange: (e) => (o.bits = +e.target.value) }, [16, 24, 32].map((b) => h('option', { value: b, selected: b === 16 }, b + 'bit')))) : h('label', null, 'ビットレート', h('select', { onchange: (e) => (o.kbps = +e.target.value) }, [128, 160, 192, 256, 320].map((k) => h('option', { value: k, selected: k === 192 }, k + 'kbps'))))); }
  renderExtra();
  const r = await modal('書き出し', body, [{ label: 'キャンセル', value: null }, { label: '書き出す', primary: true, value: 'go' }]);
  if (r !== 'go') return;
  prog.hidden = false; const bar = prog.querySelector('.bar'), pct = prog.querySelector('.pct');
  try {
    const range = o.scope === 'selection' ? { start: app.project.loop.start, end: app.project.loop.end } : undefined; // 選択範囲UIは簡略化しループ範囲を利用
    const results = await exportAudio({ ...o, range }, (p) => { bar.style.width = Math.round(p * 100) + '%'; pct.textContent = Math.round(p * 100) + '%'; });
    for (const r2 of results) { download(r2.blob, r2.name); if (r2.note) toast(r2.note, 'warn', 6000); }
    toast('書き出しが完了しました（' + results.length + '件）', 'ok');
  } catch (e) { const { showError } = await import('../utils/dom.js'); showError('書き出しに失敗しました', e.message, 'ブラウザを最新版に更新するか、別の形式（WAV）でお試しください。'); }
}
export async function exportMidiFromNotes(notes, bpm, name) { if (!notes.length) { toast('ノートがありません', 'warn'); return; } const blob = notesToSMF(notes, bpm, name); download(blob, (name || 'voice') + '.mid'); toast('MIDIファイルを書き出しました', 'ok'); }

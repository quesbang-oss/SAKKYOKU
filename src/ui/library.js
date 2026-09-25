import { h, askText, confirmBox, toast, download, modal } from '../utils/dom.js';
import { app, getAsset, addAsset, removeAsset, mutate } from '../app.js';
import { engine } from '../audio/engine.js';
import { bus } from '../utils/bus.js';
import { exportAssetWav } from '../export/exporter.js';
import { fitCanvas, drawWave } from './draw.js';
import { pitchTrack, pitchToNotes } from '../analysis/analyze.js';
import { noteName } from '../utils/util.js';
import { exportMidiFromNotes } from './exportdialog.js';

export function libraryUI({ onUse }) {
  const root = h('div', { class: 'library' });
  const tools = h('div', { class: 'lib-tools' });
  const list = h('div', { class: 'lib-list' });
  root.append(tools, list);
  let query = '', folder = 'ALL', favOnly = false, previewSrc = null;
  function folders() { const s = new Set(['ALL']); for (const a of app.project.assets) s.add(a.folder || 'VOICE'); return [...s]; }
  function render() {
    tools.replaceChildren(
      h('input', { type: 'search', placeholder: '検索…', value: query, 'aria-label': '素材を検索', oninput: (e) => { query = e.target.value; renderList(); } }),
      h('select', { 'aria-label': 'フォルダ', onchange: (e) => { folder = e.target.value; renderList(); } }, folders().map((f) => h('option', { value: f, selected: f === folder }, f))),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: favOnly, onchange: (e) => { favOnly = e.target.checked; renderList(); } }), '★のみ'));
    renderList();
  }
  function stopPreview() { if (previewSrc) { try { previewSrc.stop(); } catch {} previewSrc = null; } }
  async function openVoiceToMidi(a, buf) {
    toast('歌声を解析しています…');
    const notes = pitchToNotes(pitchTrack(buf.ch[0], buf.sr));
    if (!notes.length) { await modal('MIDI化', h('p', null, '音程を検出できませんでした。はっきりと歌った声の素材でお試しください。'), [{ label: '閉じる', primary: true }]); return; }
    const list = h('div', { class: 'chop-list' }, notes.map((n, i) => h('div', { class: 'chop-item' }, h('span', null, (i + 1) + ': ' + noteName(n.midi) + '　' + n.start.toFixed(2) + 's 〜 +' + n.dur.toFixed(2) + 's'))));
    const bpmInp = h('input', { type: 'number', value: 120, style: { width: '70px' } });
    const r = await modal('Voice to MIDI（' + a.name + '）', h('div', null, h('p', { class: 'hint' }, notes.length + ' 個のノートを検出しました。'), list, h('label', null, '書き出しBPM(タイミングの基準)', bpmInp)), [{ label: '閉じる', value: null }, { label: 'MIDIとして書き出す', primary: true, value: 'go' }]);
    if (r === 'go') await exportMidiFromNotes(notes, +bpmInp.value || 120, a.name);
  }
  function renderList() {
    list.replaceChildren();
    const items = app.project.assets.filter((a) => (folder === 'ALL' || a.folder === folder) && (!favOnly || a.fav) && (!query || a.name.includes(query) || a.tags.some((t) => t.includes(query))));
    if (!items.length) { list.append(h('p', { class: 'hint' }, '素材がありません。録音するか、Voice Chopで作成してください。')); return; }
    for (const a of items) list.append(row(a));
  }
  function row(a) {
    const buf = getAsset(a.id); const cv = h('canvas', { class: 'lib-wave' });
    const el = h('div', { class: 'lib-item', draggable: 'true', dataset: { id: a.id } },
      cv, h('div', { class: 'lib-info' }, h('input', { class: 'lib-name', value: a.name, onchange: (e) => mutate('素材名を変更', () => { a.name = e.target.value || a.name; }) }), h('span', { class: 'lib-dur' }, buf ? (buf.ch[0].length / buf.sr).toFixed(2) + 's' : '') , h('span', { class: 'lib-folder' }, a.folder)),
      h('div', { class: 'lib-btns' },
        h('button', { class: 'btn xs', title: 'プレビュー再生', onclick: () => { stopPreview(); engine.init().then(() => { const ab = engine.ctx.createBuffer(buf.ch.length, buf.ch[0].length, buf.sr); buf.ch.forEach((c, i) => ab.copyToChannel(c, i)); const s = engine.ctx.createBufferSource(); s.buffer = ab; s.connect(engine.preview); s.start(); previewSrc = s; }); } }, '▶'),
        h('button', { class: 'btn xs' + (a.fav ? ' on' : ''), title: 'お気に入り', onclick: () => { mutate('お気に入り切替', () => { a.fav = !a.fav; }); renderList(); } }, '★'),
        h('button', { class: 'btn xs', title: '複製', onclick: async () => { const id = await addAsset({ sr: buf.sr, ch: buf.ch.map((c) => new Float32Array(c)) }, { name: a.name + ' コピー', folder: a.folder, tags: a.tags }); toast('複製しました'); } }, '⎘'),
        h('button', { class: 'btn xs', title: 'WAVで書き出し', onclick: () => download(exportAssetWav(buf), (a.name || 'asset') + '.wav') }, '⇩'),
        h('button', { class: 'btn xs', title: '歌声からMIDIノートを検出して書き出し', onclick: () => openVoiceToMidi(a, buf) }, '🎼 MIDI化'),
        h('button', { class: 'btn xs', title: 'フォルダ変更', onclick: async () => { const f = await askText('フォルダ', 'フォルダ名', a.folder); if (f) { mutate('フォルダ変更', () => { a.folder = f; }); render(); } } }, '📁'),
        h('button', { class: 'btn xs', title: 'タグ編集', onclick: async () => { const t = await askText('タグ', 'カンマ区切りで入力', a.tags.join(',')); if (t !== null) mutate('タグ編集', () => { a.tags = t.split(',').map((x) => x.trim()).filter(Boolean); }); } }, '🏷'),
        h('button', { class: 'btn xs danger', title: '削除', onclick: async () => { if (await confirmBox('素材を削除', a.name + ' を削除しますか？関連するクリップ・パッドの割り当ても解除されます。')) { removeAsset(a.id); renderList(); } } }, '✕')));
    if (onUse) el.addEventListener('dblclick', () => onUse(a.id));
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-asset', a.id); e.dataTransfer.effectAllowed = 'copy'; });
    if (buf) requestAnimationFrame(() => { const { c, w, h: hh } = fitCanvas(cv); c.clearRect(0, 0, w, hh); drawWave(c, buf, 0, 0, w, hh, 0, buf.ch[0].length / buf.sr, '#4de0c1', { mono: true }); });
    return el;
  }
  bus.on('assets:changed', render); bus.on('project:restored', render);
  root.render = render; render(); return root;
}

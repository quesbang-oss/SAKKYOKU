import { h, modal, toast, confirmBox, download } from '../utils/dom.js';
import { app, listProjects, loadProjectById, deleteProject, saveProject, newEmpty, serializeProject, parseProjectFile, applyLoaded, listBackups, restoreBackup } from '../app.js';

function fmtDate(t) { const d = new Date(t); return d.toLocaleString('ja-JP'); }
export async function openProjectDialog(guard) {
  const list = await listProjects(); const backups = await listBackups();
  const body = h('div', { class: 'project-dialog' },
    h('div', { class: 'pd-row' }, h('button', { class: 'btn primary', onclick: async () => { if (await guard()) { newEmpty(); toast('新規プロジェクトを作成しました'); closeAll(); } } }, '＋ 新規プロジェクト'),
      h('label', { class: 'btn' }, 'ファイルを開く(.vdaw)', h('input', { type: 'file', accept: '.vdaw,.json', style: { display: 'none' }, onchange: async (e) => { const f = e.target.files[0]; if (!f) return; if (!(await guard())) return; try { const text = await f.text(); const { P, bufs } = parseProjectFile(text); applyLoaded(P, bufs); toast('読み込みました：' + P.name, 'ok'); closeAll(); } catch (err) { const { showError } = await import('../utils/dom.js'); showError('読み込みに失敗しました', err.message, '拡張子が .vdaw の、このアプリで書き出したファイルを選んでください。'); } } })),
      h('button', { class: 'btn', onclick: () => download(new Blob([serializeProject()], { type: 'application/json' }), (app.project.name || 'project') + '.vdaw') }, '名前を付けて保存(.vdaw)')),
    h('h4', null, '保存済みプロジェクト'),
    h('div', { class: 'pd-list' }, list.length ? list.map((p) => h('div', { class: 'pd-item' }, h('span', null, p.name), h('span', { class: 'pd-date' }, fmtDate(p.updated)), h('button', { class: 'btn xs', onclick: async () => { if (!(await guard())) return; try { const { missing } = await loadProjectById(p.id); toast('読み込みました：' + p.name + (missing.length ? '（見つからない素材: ' + missing.join(',') + '）' : ''), missing.length ? 'warn' : 'ok'); closeAll(); } catch (err) { toast(err.message, 'error'); } } }, '開く'), h('button', { class: 'btn xs danger', onclick: async () => { if (await confirmBox('削除確認', p.name + ' を削除しますか？')) { await deleteProject(p.id); toast('削除しました'); reopen(); } } }, '✕'))) : h('p', { class: 'hint' }, '保存済みのプロジェクトはありません')),
    h('h4', null, '自動バックアップ'),
    h('div', { class: 'pd-list' }, backups.length ? backups.slice(0, 12).map((b) => h('div', { class: 'pd-item' }, h('span', null, b.name), h('span', { class: 'pd-date' }, fmtDate(b.time) + (b.reason === 'auto' ? ' (自動)' : '')), h('button', { class: 'btn xs', onclick: async () => { if (!(await guard())) return; await restoreBackup(b.key); toast('バックアップから復元しました', 'ok'); closeAll(); } }, '復元'))) : h('p', { class: 'hint' }, 'バックアップはまだありません')));
  const handle = modal('プロジェクト', body, [{ label: '閉じる', primary: true }]);
  let closed = false; function closeAll() { closed = true; document.querySelector('.modal-ov')?.remove(); }
  async function reopen() { closeAll(); await openProjectDialog(guard); }
  return handle;
}
export async function guardUnsaved() { if (!app.dirty) return true; const r = await modal('保存されていない変更があります', h('p', null, '今の変更を保存しますか？'), [{ label: 'キャンセル', value: 'cancel' }, { label: '保存しない', value: 'discard' }, { label: '保存する', primary: true, value: 'save' }]); if (r === 'cancel') return false; if (r === 'save') await saveProject(); return true; }

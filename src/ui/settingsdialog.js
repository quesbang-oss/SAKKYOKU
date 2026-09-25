import { h, modal, toast, confirmBox } from '../utils/dom.js';
import { app } from '../app.js';
import { engine } from '../audio/engine.js';
import { db } from '../storage/db.js';
import { installApp, showInstallHelp, isStandalone, pwa } from '../pwa/pwa.js';

export async function openSettingsDialog() {
  const est = await db.estimate();
  const body = h('div', { class: 'settings-dialog' },
    h('h4', null, 'ストレージ'),
    h('p', null, est ? ('使用中: ' + fmtMB(est.usage) + ' / 上限目安: ' + fmtMB(est.quota)) : '（この端末ではストレージ使用量を取得できません）'),
    h('button', { class: 'btn sm', onclick: async () => { const ok = await db.persist(); toast(ok ? '永続化を有効にしました（自動的に消えにくくなります）' : '永続化の許可が得られませんでした', ok ? 'ok' : 'warn'); } }, '保存データを永続化する'),
    h('h4', null, '自動保存'),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: app.settings.autosave, onchange: (e) => (app.settings.autosave = e.target.checked) }), '自動保存を有効にする（20秒ごと）'),
    h('h4', null, 'アプリ / PWA'),
    h('p', null, isStandalone() ? 'このウィンドウはアプリとして起動しています。' : 'ブラウザのタブで開いています。'),
    h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: installApp }, 'アプリとしてインストール'), h('button', { class: 'btn sm', onclick: showInstallHelp }, 'デスクトップから起動する方法')),
    h('h4', null, 'オーディオ環境'),
    h('p', null, 'サンプルレート: ' + engine.sr + ' Hz　/　AudioWorklet: ' + (engine.supported() ? '利用可能' : '非対応')),
    h('h4', null, 'データの初期化'),
    h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox('本当に削除しますか', '保存済みの全プロジェクト・素材・バックアップを削除します。この操作は取り消せません。')) { await Promise.all(['assets', 'projects', 'backups', 'recovery', 'presets'].map((s) => db.clear(s))); toast('すべてのデータを削除しました。ページを再読み込みします。', 'ok'); setTimeout(() => location.reload(), 1200); } } }, 'すべてのローカルデータを削除'));
  return modal('設定', body, [{ label: '閉じる', primary: true }]);
}
function fmtMB(b) { return (b / 1048576).toFixed(1) + ' MB'; }

import { bus } from '../utils/bus.js';
import { modal, download, h } from '../utils/dom.js';
export const pwa = { deferred: null, installed: false };
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
export function initPWA() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pwa.deferred = e; bus.emit('pwa:available'); });
  window.addEventListener('appinstalled', () => { pwa.installed = true; pwa.deferred = null; bus.emit('pwa:installed'); });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register(new URL('../../sw.js', import.meta.url).href, { scope: new URL('../../', import.meta.url).pathname }).then((reg) => { bus.emit('pwa:sw', reg); reg.addEventListener('updatefound', () => bus.emit('pwa:update')); }).catch((e) => console.warn('SW登録失敗', e));
  }
}
export async function installApp() {
  if (isStandalone()) { await modal('すでにアプリとして起動中です', h('p', null, 'このウィンドウは、インストール済みのアプリとして動作しています。')); return; }
  if (pwa.deferred) { pwa.deferred.prompt(); const r = await pwa.deferred.userChoice.catch(() => null); pwa.deferred = null; if (r && r.outcome === 'accepted') return; }
  else showInstallHelp();
}
function launcherFiles() {
  const url = location.href.split('#')[0].split('?')[0];
  const urlFile = `[InternetShortcut]\r\nURL=${url}\r\nIconIndex=0\r\n`;
  const bat = `@echo off\r\nrem Voice DAW desktop shortcut creator (Edge app window)\r\nset "URL=${url}"\r\nset "EDGE=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"\r\nif not exist "%EDGE%" set "EDGE=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"\r\nset "CHROME=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"\r\nif not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"\r\nset "BROWSER=%EDGE%"\r\nif not exist "%BROWSER%" set "BROWSER=%CHROME%"\r\nif not exist "%BROWSER%" (echo Edge or Chrome was not found. & pause & exit /b 1)\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\\VoiceDAW.lnk'); $s.TargetPath='%BROWSER%'; $s.Arguments='--app=%URL%'; $s.Description='Voice DAW'; $s.Save()"\r\necho Created VoiceDAW shortcut on your Desktop.\r\npause\r\n`;
  return { urlFile, bat };
}
export function showInstallHelp() {
  const { urlFile, bat } = launcherFiles();
  const body = h('div', { class: 'help' },
    h('p', null, 'ブラウザの制約で、Webページから直接デスクトップに .lnk ファイルを作ることはできません。次のどれかの方法で、実際にデスクトップから起動できます。'),
    h('h4', null, '方法1：アプリとしてインストール（おすすめ）'),
    h('ol', null, h('li', null, 'Microsoft Edge：右上「…」→「アプリ」→「このサイトをアプリとしてインストール」'), h('li', null, 'Google Chrome：アドレスバー右端のインストールアイコン、または「︙」→「キャスト、保存、共有」→「インストール」'), h('li', null, 'インストール時に「デスクトップにショートカットを作成する」にチェックを入れる')),
    h('h4', null, '方法2：スタートメニューからデスクトップへ'),
    h('p', null, 'インストール後、スタートメニューの「Voice DAW」を右クリック→「その他」→「ファイルの場所を開く」→ショートカットをデスクトップへコピー。'),
    h('h4', null, '方法3：簡易ランチャーを作る（Windows）'),
    h('p', null, '下のボタンでファイルを保存できます。「.url」は、ダブルクリックで通常のブラウザで開くショートカットです。「.bat」は、実行するとデスクトップに Edge/Chrome のアプリウィンドウ用ショートカットを作ります（PowerShellを使用。SmartScreenの警告が出た場合は内容を確認して実行してください）。'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => download(new Blob([urlFile], { type: 'text/plain' }), 'VoiceDAW.url') }, 'VoiceDAW.url を保存'), h('button', { class: 'btn', onclick: () => download(new Blob([bat], { type: 'text/plain' }), 'create-desktop-shortcut.bat') }, 'create-desktop-shortcut.bat を保存')));
  return modal('デスクトップから起動する方法', body, [{ label: '閉じる', primary: true }]);
}

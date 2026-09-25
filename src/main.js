import { h, toast, showError, modal, confirmBox, askText } from './utils/dom.js';
import { app, mutate, undo, redo, canUndo, canRedo, saveProject, startAutosave, loadLast, newEmpty, setSel, selectedTrack } from './app.js';
import { bus } from './utils/bus.js';
import { engine } from './audio/engine.js';
import { transport } from './sequencer/transport.js';
import { timelineUI } from './ui/timeline.js';
import { mixerUI } from './ui/mixer.js';
import { drumMachineUI } from './ui/drummachine.js';
import { libraryUI } from './ui/library.js';
import { recordPanelUI } from './ui/recordpanel.js';
import { instrumentsUI } from './ui/instruments.js';
import { liveModeUI } from './ui/livemode.js';
import { experimentUI } from './ui/experiment.js';
import { fxChainUI } from './ui/fxchain.js';
import { openExportDialog } from './ui/exportdialog.js';
import { openProjectDialog, guardUnsaved } from './ui/projectdialog.js';
import { openSettingsDialog } from './ui/settingsdialog.js';
import { maybeShowSetupWizard } from './ui/setupwizard.js';
import { initPWA, installApp, pwa } from './pwa/pwa.js';
import { newClip, newDrumClip, snapValue } from './timeline/project.js';
import { addAsset } from './app.js';

const el = document.getElementById('app');
document.title = 'Voice DAW – 声を電子楽器に';

function topbar() {
  const nameInp = h('input', { class: 'proj-name', value: app.project.name, 'aria-label': 'プロジェクト名', onchange: (e) => mutate('名前変更', () => { app.project.name = e.target.value || app.project.name; }) });
  const dirtyDot = h('span', { class: 'dirty-dot', hidden: !app.dirty });
  bus.on('dirty', (d) => (dirtyDot.hidden = !d));
  bus.on('project:changed', () => { nameInp.value = app.project.name; });
  bus.on('project:restored', () => { nameInp.value = app.project.name; });
  const undoBtn = h('button', { class: 'btn sm', title: '元に戻す (Ctrl+Z)', onclick: () => { const l = undo(); if (l) toast('元に戻しました: ' + l); refreshUndo(); } }, '↶');
  const redoBtn = h('button', { class: 'btn sm', title: 'やり直す (Ctrl+Shift+Z)', onclick: () => { const l = redo(); if (l) toast('やり直しました: ' + l); refreshUndo(); } }, '↷');
  function refreshUndo() { undoBtn.disabled = !canUndo(); redoBtn.disabled = !canRedo(); }
  bus.on('project:changed', refreshUndo); bus.on('project:restored', refreshUndo); refreshUndo();
  const bar = h('header', { class: 'topbar' },
    h('div', { class: 'tb-left' }, h('span', { class: 'logo' }, '🎙️ Voice DAW'), nameInp, dirtyDot),
    h('div', { class: 'tb-mid' }, undoBtn, redoBtn,
      h('button', { class: 'btn sm', title: '保存 (Ctrl+S)', onclick: () => doSave() }, '保存'),
      h('button', { class: 'btn sm', title: 'プロジェクト (Ctrl+O)', onclick: () => openProjectDialog(guardUnsaved) }, '📁 プロジェクト'),
      h('button', { class: 'btn sm', onclick: () => openExportDialog() }, '⇩ 書き出し')),
    h('div', { class: 'tb-right' }, h('button', { class: 'btn sm', onclick: () => openSettingsDialog() }, '⚙ 設定'), h('button', { class: 'btn sm', onclick: () => installApp() }, '📲 アプリ化')));
  return bar;
}
async function doSave() { const name = await askText('プロジェクトを保存', '名前', app.project.name); if (name === null) return; await saveProject(name); toast('保存しました', 'ok'); }

const NAV = [
  { id: 'project', label: 'Project', icon: '📁' }, { id: 'record', label: 'Record', icon: '🎙' }, { id: 'samples', label: 'Samples', icon: '🎵' },
  { id: 'effects', label: 'Effects', icon: '🎛' }, { id: 'instruments', label: 'Instruments', icon: '🎹' }, { id: 'sequencer', label: 'Sequencer', icon: '🥁' },
  { id: 'mixer', label: 'Mixer', icon: '🎚' }, { id: 'live', label: 'LIVE', icon: '⚡' }, { id: 'experiment', label: '実験', icon: '🎲' }, { id: 'presets', label: 'Presets', icon: '⭐' },
];
function sidebar(onNav) {
  const btns = new Map();
  const nav = h('nav', { class: 'sidebar' }, NAV.map((n) => { const b = h('button', { class: 'nav-btn', onclick: () => onNav(n.id) }, h('span', { class: 'nav-icon' }, n.icon), h('span', { class: 'nav-label' }, n.label)); btns.set(n.id, b); return b; }));
  nav.setActive = (id) => btns.forEach((b, k) => b.classList.toggle('active', k === id));
  return nav;
}
function transportBar() {
  const timeEl = h('span', { class: 'tp-time' }, '00:00.00');
  const playBtn = h('button', { class: 'btn tp-play', title: '再生/停止 (Space)', onclick: () => transport.toggle() }, '▶');
  const stopBtn = h('button', { class: 'btn', title: '停止', onclick: () => transport.stop() }, '■');
  const recBtn = h('button', { class: 'btn', title: '録音パネルを開く (R)', onclick: () => bus.emit('nav', 'record') }, '⏺');
  const bpmInp = h('input', { type: 'number', value: app.project.bpm, min: 40, max: 300, style: { width: '64px' }, 'aria-label': 'BPM', onchange: (e) => mutate('BPM変更', () => { app.project.bpm = Math.max(40, Math.min(300, +e.target.value || 120)); }) });
  const sigSel = h('select', { 'aria-label': '拍子' }, ['4/4', '3/4', '6/8', '2/4'].map((s) => h('option', { value: s }, s)));
  sigSel.addEventListener('change', () => { const [n, d] = sigSel.value.split('/').map(Number); mutate('拍子変更', () => { app.project.sig = [n, d]; }); });
  const metroChk = h('input', { type: 'checkbox', checked: app.project.metronome, title: 'メトロノーム(M)', onchange: (e) => mutate('メトロノーム', () => { app.project.metronome = e.target.checked; }) });
  const loopChk = h('input', { type: 'checkbox', checked: app.project.loop.on, title: 'ループ', onchange: (e) => mutate('ループON/OFF', () => { app.project.loop.on = e.target.checked; }) });
  const snapSel = h('select', { 'aria-label': 'スナップ' }, [[0, 'OFF'], [1, '1拍'], [2, '1/2拍'], [4, '1/4拍'], [8, '1/8拍'], [16, '1/16拍']].map(([v, l]) => h('option', { value: v, selected: app.project.snap === v }, 'Snap: ' + l)));
  snapSel.addEventListener('change', () => mutate('スナップ変更', () => { app.project.snap = +snapSel.value; }, null));
  const masterVol = h('input', { type: 'range', min: 0, max: 1.5, step: 0.01, value: app.project.master.vol, 'aria-label': 'マスター音量', oninput: (e) => { mutate('マスター音量', () => { app.project.master.vol = +e.target.value; }, 'mastervol'); } });
  const zoomOut = h('button', { class: 'btn xs', title: '縮小', onclick: () => bus.emit('tl:zoom', 0.8) }, '－');
  const zoomIn = h('button', { class: 'btn xs', title: '拡大', onclick: () => bus.emit('tl:zoom', 1.25) }, '＋');
  bus.on('transport', (s) => { playBtn.textContent = s === 'play' ? '⏸' : '▶'; });
  bus.on('render:start', () => { playBtn.disabled = true; playBtn.title = 'ミックスをレンダリング中…'; }); bus.on('render:end', () => { playBtn.disabled = false; playBtn.title = '再生/停止 (Space)'; });
  bus.on('project:restored', () => { bpmInp.value = app.project.bpm; loopChk.checked = app.project.loop.on; metroChk.checked = app.project.metronome; masterVol.value = app.project.master.vol; sigSel.value = app.project.sig.join('/'); });
  const bar = h('footer', { class: 'transport' }, recBtn, playBtn, stopBtn, timeEl, h('span', { class: 'sep' }), h('label', null, 'BPM', bpmInp), sigSel, h('label', { class: 'chk' }, metroChk, 'Metro'), h('label', { class: 'chk' }, loopChk, 'Loop'), snapSel, h('span', { class: 'sep' }), zoomOut, zoomIn, h('span', { class: 'grow' }), h('span', null, 'Master'), masterVol);
  import('./ui/loop.js').then(({ addTick }) => addTick(() => { const s = transport.currentPos(); const m = Math.floor(s / 60), r = (s % 60).toFixed(2); timeEl.textContent = String(m).padStart(2, '0') + ':' + r.padStart(5, '0'); }));
  return bar;
}

async function main() {
  initPWA();
  const errBanner = h('div', { class: 'error-banner', hidden: true });
  el.append(errBanner);
  const tb = topbar(); el.append(tb);
  const wrap = h('div', { class: 'main-wrap' });
  const nav = sidebar((id) => bus.emit('nav', id));
  const centerTop = h('div', { class: 'center-top' });
  const tl = timelineUI(); centerTop.append(tl);
  bus.on('tl:zoom', (f) => tl.zoom(f));
  const dock = h('div', { class: 'dock' });
  const dockHead = h('div', { class: 'dock-head' }, h('span', { class: 'dock-title' }, 'Record'), h('button', { class: 'btn xs', title: '閉じる/開く', onclick: () => dock.classList.toggle('collapsed') }, '▾'));
  const dockBody = h('div', { class: 'dock-body' }); dock.append(dockHead, dockBody);
  const right = h('aside', { class: 'right-panel' });
  const rightHead = h('div', { class: 'rp-head' }, h('span', null, 'トラックFX'));
  const rightBody = h('div', { class: 'rp-body' });
  right.append(rightHead, rightBody);
  const center = h('div', { class: 'center' }, centerTop, dock);
  wrap.append(nav, center, right); el.append(wrap); el.append(transportBar());

  const panels = {}; let curPanel = null;
  function ensure(id, factory) { if (!panels[id]) panels[id] = factory(); return panels[id]; }
  function showPanel(id) {
    nav.setActive(id); curPanel = id; dockHead.querySelector('.dock-title').textContent = NAV.find((n) => n.id === id)?.label || id; dock.classList.remove('collapsed');
    let node;
    if (id === 'project') { openProjectDialog(guardUnsaved); return; }
    if (id === 'record') node = ensure('record', recordPanelUI);
    else if (id === 'samples') node = ensure('samples', () => libraryUI({ onUse: (assetId) => { const tr = selectedTrack(); mutate('タイムラインに配置', () => { const start = snapValue(app.project, transport.pos); tr.clips.push(newClip(assetId, start, requireDur(assetId))); }); toast('タイムラインに配置しました'); } }));
    else if (id === 'effects') node = ensure('effects', () => { const wrap2 = h('div', { class: 'panel-pad' }, h('p', { class: 'hint' }, 'トラックを選択して右側の「トラックFX」で編集するか、下のワンクリック電子音化を使ってください。'), electronizeUI()); return wrap2; });
    else if (id === 'instruments') node = ensure('instruments', instrumentsUI);
    else if (id === 'sequencer') node = ensure('sequencer', drumMachineUI);
    else if (id === 'mixer') node = ensure('mixer', mixerUI);
    else if (id === 'live') node = ensure('live', liveModeUI);
    else if (id === 'experiment') node = ensure('experiment', experimentUI);
    else if (id === 'presets') node = ensure('presets', presetsPanel);
    dockBody.replaceChildren(node);
  }
  function requireDur(assetId) { const b = app.assets.get(assetId); return b ? b.ch[0].length / b.sr : 1; }
  bus.on('nav', showPanel);
  bus.on('opentrackfx', renderTrackFx); bus.on('selection', renderTrackFx); bus.on('project:restored', renderTrackFx);
  function renderTrackFx() { const tr = selectedTrack(); if (!tr) { rightBody.replaceChildren(h('p', { class: 'hint' }, 'トラックを選択してください')); return; } rightHead.querySelector('span').textContent = 'トラックFX: ' + tr.name; rightBody.replaceChildren(fxChainUI({ get: () => tr.fx, edit: (fn) => mutate('トラックFX編集', () => fn(tr.fx), null), trackId: tr.id, onStructure: () => {} })); }
  renderTrackFx();

  function electronizeUI() {
    const wrap2 = h('div', {});
    import('./effects/presets.js').then(({ ELECTRONIZE_PRESETS, presetToFx }) => {
      const sel = h('select', { 'aria-label': '素材選択' }, app.project.assets.map((a) => h('option', { value: a.id }, a.name)));
      const preSel = h('select', { 'aria-label': '電子音化プリセット' }, ELECTRONIZE_PRESETS.map((p) => h('option', { value: p.name }, p.name + ' - ' + p.desc)));
      wrap2.append(h('h4', null, 'ワンクリック電子音化'), h('div', { class: 'row' }, h('label', null, '素材', sel), h('label', null, 'プリセット', preSel),
        h('button', { class: 'btn primary', onclick: async () => { const id = sel.value; if (!id) { toast('素材がありません。先に録音してください', 'warn'); return; } const buf = app.assets.get(id); const p = ELECTRONIZE_PRESETS.find((x) => x.name === preSel.value);
          const { applyEffects } = await import('./audio/edit.js'); const out = applyEffects(buf, presetToFx(p)); const name = (app.project.assets.find((a) => a.id === id) || {}).name + '_電子音'; const nid = await addAsset(out, { name, folder: 'VOICE' }); toast('「' + name + '」として保存しました', 'ok'); } }, '⚡ 電子音化して保存')));
    });
    return wrap2;
  }
  function presetsPanel() { const wrap2 = h('div', { class: 'panel-pad' }); wrap2.append(fxChainUI({ get: () => app.project.instFx, edit: (fn) => mutate('楽器用エフェクト編集', () => fn(app.project.instFx)), onStructure: () => engine.setInstFx(app.project.instFx) })); engine.setInstFx(app.project.instFx); return wrap2; }
  bus.on('project:restored', () => engine.setInstFx(app.project.instFx));

  // エラー通知
  bus.on('error', async (e) => { const err = e instanceof Error ? e : new Error(String(e)); await showError(err.title || 'エラーが発生しました', err.message, err.help); });
  bus.on('engine:error', (msg) => toast('音声処理でエラー: ' + msg, 'error', 6000));
  bus.on('storage:error', (e) => { errBanner.hidden = false; errBanner.textContent = '⚠ 保存領域への書き込みに失敗しました（容量不足の可能性があります）。設定からストレージ使用量を確認してください。'; });

  // キーボードショートカット
  window.addEventListener('keydown', (e) => {
    const tag = e.target.tagName; if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === ' ') { e.preventDefault(); transport.toggle(); }
    else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) { bus.emit('nav', 'record'); }
    else if (e.key.toLowerCase() === 'm' && !e.ctrlKey) { mutate('メトロノーム切替', () => { app.project.metronome = !app.project.metronome; }); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { tl.deleteSelected(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); const l = redo(); l && toast('やり直し: ' + l); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); const l = undo(); l && toast('元に戻す: ' + l); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); openProjectDialog(guardUnsaved); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && app.sel.clipIds.length) {
      const found = [];
      for (const t of app.project.tracks) for (const c of t.clips) if (app.sel.clipIds.includes(c.id)) found.push({ trackId: t.id, clip: JSON.parse(JSON.stringify(c)) });
      if (found.length) { app.clipboard = found; toast('コピーしました（' + found.length + '件）'); }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && app.clipboard && app.clipboard.length) {
      e.preventDefault(); const minStart = Math.min(...app.clipboard.map((x) => x.clip.start)); const at = snapValue(app.project, transport.pos);
      mutate('クリップを貼り付け', (P) => { for (const item of app.clipboard) { const tr = P.tracks.find((t) => t.id === item.trackId) || P.tracks[0]; const nc = JSON.parse(JSON.stringify(item.clip)); nc.id = 'clp_' + Math.random().toString(36).slice(2, 9); nc.start = at + (item.clip.start - minStart); tr.clips.push(nc); } });
      toast('貼り付けました'); tl.render();
    } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey && app.sel.clipIds.length === 1) {
      // 分割: 選択中クリップを再生ヘッド位置で分割
      mutate('クリップを分割', (P) => { for (const t of P.tracks) { const c = t.clips.find((x) => x.id === app.sel.clipIds[0]); if (!c) continue; const at = transport.pos; if (at <= c.start || at >= c.start + c.dur) continue; const dur1 = at - c.start; const nc = JSON.parse(JSON.stringify(c)); nc.id = 'clp_' + Math.random().toString(36).slice(2, 9); nc.start = at; nc.dur = c.dur - dur1; if (t.type !== 'drum') nc.offset = (c.offset || 0) + dur1; c.dur = dur1; t.clips.push(nc); } });
      tl.render();
    }
  });

  bus.on('timeline:emptydblclick', async (tr, t) => {
    if (tr.type === 'drum') { mutate('ドラムクリップを配置', () => { tr.clips.push(newDrumClip(app.project.activePattern, t, 4)); }); bus.emit('nav', 'sequencer'); return; }
    if (!app.project.assets.length) { toast('素材がありません。先に録音してください', 'warn'); bus.emit('nav', 'record'); return; }
    const selEl = h('select', { 'aria-label': '配置する素材' }, app.project.assets.map((a) => h('option', { value: a.id }, a.name)));
    const r = await modal('配置する素材を選択', h('label', null, '素材', selEl), [{ label: 'キャンセル', value: null }, { label: '配置', primary: true, value: 'go' }]);
    if (r !== 'go') return; const a = app.project.assets.find((x) => x.id === selEl.value); if (!a) return; const buf = app.assets.get(a.id);
    mutate('クリップを配置', () => { tr.clips.push(newClip(a.id, t, buf ? buf.ch[0].length / buf.sr : 1)); }); tl.render();
  });
  bus.on('timeline:clipdblclick', (tr, c) => { if (tr.type === 'drum') { mutate('パターン切替', () => { app.project.activePattern = c.patternId; }); bus.emit('nav', 'sequencer'); } else { setSel({ clipIds: [c.id], trackId: tr.id }); toast('クリップの端をドラッグして長さ調整、ドラッグで移動できます。Sキーで分割、Deleteで削除できます。'); } });
  startAutosave();
  const loaded = await loadLast().catch(() => false);
  if (!loaded) await maybeShowSetupWizard();
  showPanel('record'); renderTrackFx(); tl.render();
  toast('準備ができました。マイクに向かって「録音」から始めましょう。', 'ok', 4000);
}
main().catch((e) => { console.error(e); document.body.innerHTML = '<div style="padding:40px;color:#fff;font-family:sans-serif">アプリの起動に失敗しました: ' + (e && e.message) + '<br>ページを再読み込みしてください。</div>'; });

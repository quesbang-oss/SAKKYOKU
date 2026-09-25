import { h, slider, askText, toast } from '../utils/dom.js';
import { EFFECTS, EFFECT_LIST, newFx, defaultParams } from '../effects/registry.js';
import { BUILTIN_PRESETS, presetToFx, loadUserPresets, saveUserPreset } from '../effects/presets.js';
import { bus } from '../utils/bus.js';
import { app } from '../app.js';

const groups = () => { const g = {}; for (const e of EFFECT_LIST) (g[e.group] ||= []).push(e); return g; };
// opts: { get(), edit(fn, key), onStructure?, trackId?, allowPresets:true }
export function fxChainUI(opts) {
  const root = h('div', { class: 'fxchain' });
  let dragId = null; const open = new Set();
  const list = () => opts.get() || [];
  function render() {
    root.replaceChildren();
    const head = h('div', { class: 'fx-head' },
      h('select', { 'aria-label': 'エフェクトを追加', onchange: (e) => { const t = e.target.value; e.target.value = ''; if (!t) return; const fx = newFx(t); opts.edit((l) => l.push(fx)); open.add(fx.id); render(); opts.onStructure && opts.onStructure(); } },
        h('option', { value: '' }, '＋ エフェクトを追加…'), Object.entries(groups()).map(([g, es]) => h('optgroup', { label: g }, es.map((e) => h('option', { value: e.type }, e.label))))),
      opts.allowPresets === false ? null : h('select', { 'aria-label': 'プリセット', id: 'pre-' + Math.random().toString(36).slice(2, 6), onchange: async (e) => { const v = e.target.value; e.target.value = ''; if (!v) return; const all = [...BUILTIN_PRESETS, ...(await loadUserPresets())], p = all.find((x) => x.name === v); if (!p) return; opts.edit((l) => { l.length = 0; l.push(...presetToFx(p)); }); render(); opts.onStructure && opts.onStructure(); toast('プリセット「' + p.name + '」を読み込みました'); } },
        h('option', { value: '' }, 'プリセット読込…'), ...BUILTIN_PRESETS.map((p) => h('option', { value: p.name }, p.name + ' - ' + p.desc)), h('option', { value: '', disabled: true }, '── ユーザー ──'), ...userPresetOpts),
      opts.allowPresets === false ? null : h('button', { class: 'btn sm', title: '現在のチェーンをプリセットとして保存', onclick: async () => { if (!list().length) { toast('エフェクトがありません', 'warn'); return; } const n = await askText('プリセット保存', 'プリセット名', ''); if (!n) return; await saveUserPreset(n, list()); await refreshUser(); render(); toast('プリセット「' + n + '」を保存しました', 'ok'); } }, '保存'),
      h('button', { class: 'btn sm', title: '全てのエフェクトを削除', onclick: () => { if (!list().length) return; opts.edit((l) => { l.length = 0; }); render(); opts.onStructure && opts.onStructure(); } }, '全削除'));
    root.append(head);
    if (!list().length) root.append(h('p', { class: 'hint' }, 'エフェクトがありません。上のメニューから追加するか、プリセットを読み込んでください。'));
    list().forEach((fx, idx) => root.append(fxCard(fx, idx)));
  }
  function fxCard(fx, idx) {
    const C = EFFECTS[fx.type]; if (!C) return h('div');
    const card = h('div', { class: 'fx-card' + (fx.on ? '' : ' off'), draggable: 'true', dataset: { id: fx.id }, 'aria-label': C.label });
    card.addEventListener('dragstart', (e) => { dragId = fx.id; e.dataTransfer.setData('text/x-fx', fx.id); e.dataTransfer.effectAllowed = 'move'; card.classList.add('drag'); });
    card.addEventListener('dragend', () => { card.classList.remove('drag'); dragId = null; });
    card.addEventListener('dragover', (e) => { if (dragId) { e.preventDefault(); card.classList.add('over'); } });
    card.addEventListener('dragleave', () => card.classList.remove('over'));
    card.addEventListener('drop', (e) => { e.preventDefault(); card.classList.remove('over'); if (!dragId || dragId === fx.id) return; const from = list().findIndex((x) => x.id === dragId), to = list().findIndex((x) => x.id === fx.id); if (from < 0 || to < 0) return; opts.edit((l) => { const [m] = l.splice(from, 1); l.splice(to, 0, m); }); render(); opts.onStructure && opts.onStructure(); });
    const move = (d) => { const to = idx + d; if (to < 0 || to >= list().length) return; opts.edit((l) => { const [m] = l.splice(idx, 1); l.splice(to, 0, m); }); render(); opts.onStructure && opts.onStructure(); };
    const bypass = h('input', { type: 'checkbox', 'aria-label': C.label + ' ON/OFF', title: 'ON/OFF' }); bypass.checked = fx.on; bypass.addEventListener('change', () => { opts.edit((l) => { const f = l.find((x) => x.id === fx.id); if (f) f.on = bypass.checked; }); card.classList.toggle('off', !bypass.checked); opts.onStructure && opts.onStructure(); });
    const isOpen = open.has(fx.id);
    const head = h('div', { class: 'fx-title' }, h('span', { class: 'grip', 'aria-hidden': 'true' }, '⋮⋮'), bypass, h('button', { class: 'fx-name', onclick: () => { open.has(fx.id) ? open.delete(fx.id) : open.add(fx.id); render(); } }, (isOpen ? '▾ ' : '▸ ') + C.label),
      h('button', { class: 'btn xs', 'aria-label': '上へ', onclick: () => move(-1) }, '↑'), h('button', { class: 'btn xs', 'aria-label': '下へ', onclick: () => move(1) }, '↓'),
      h('button', { class: 'btn xs', 'aria-label': 'ランダム化', title: 'パラメータをランダム化', onclick: async () => { const { randomizeFx } = await import('../effects/presets.js'); opts.edit((l) => { const i = l.findIndex((x) => x.id === fx.id); if (i >= 0) l[i] = randomizeFx(l[i]); }); render(); opts.onStructure && opts.onStructure(); } }, '🎲'),
      h('button', { class: 'btn xs danger', 'aria-label': C.label + 'を削除', onclick: () => { opts.edit((l) => { const i = l.findIndex((x) => x.id === fx.id); if (i >= 0) l.splice(i, 1); }); render(); opts.onStructure && opts.onStructure(); } }, '✕'));
    card.append(head);
    const mixWrap = slider({ k: 'mix', n: 'Wet/Dry', min: 0, max: 1, def: 1 }, fx.mix, (v) => { opts.edit((l) => { const f = l.find((x) => x.id === fx.id); if (f) f.mix = v; }, 'mix' + fx.id, false); opts.onLive && opts.onLive(); }, null);
    if (opts.trackId) mixWrap.append(autoBtn('mix.' + fx.id, 'Wet/Dry'));
    if (isOpen) { const body = h('div', { class: 'fx-body' }, mixWrap);
      for (const d of C.defs) { const s = slider(d, fx.params[d.k], (v) => { opts.edit((l) => { const f = l.find((x) => x.id === fx.id); if (f) f.params[d.k] = v; }, fx.id + d.k, false); opts.onLive && opts.onLive(fx.id, d.k, v); }, null); if (opts.trackId && !d.opts) s.append(autoBtn('fx.' + fx.id + '.' + d.k, C.label + ' ' + d.n)); body.append(s); }
      card.append(body); } else card.append(h('div', { class: 'fx-sum' }, C.group + (fx.mix < 1 ? ' · Wet ' + Math.round(fx.mix * 100) + '%' : '')));
    return card;
  }
  function autoBtn(key, label) { return h('button', { class: 'btn xs auto', title: 'オートメーションを編集（タイムラインに表示）', 'aria-label': label + 'のオートメーション', onclick: () => { app.autoView = { trackId: opts.trackId, key }; bus.emit('autoview'); toast('タイムラインのオートメーションレーンに「' + label + '」を表示しました'); } }, 'A'); }
  let userPresetOpts = [];
  async function refreshUser() { const u = await loadUserPresets(); userPresetOpts = u.map((p) => h('option', { value: p.name }, '★ ' + p.name)); }
  root.refresh = render; refreshUser().then(render);
  bus.on('project:restored', () => render());
  return root;
}

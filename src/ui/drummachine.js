import { h } from '../utils/dom.js';
import { DRUM_ROWS, makeDrum, resizePattern, emptyPattern } from '../audio/drums.js';
import { app, mutate } from '../app.js';
import { engine } from '../audio/engine.js';
import { bus } from '../utils/bus.js';
import { askText, confirmBox, toast } from '../utils/dom.js';
import { transport } from '../sequencer/transport.js';
import { addTick } from './loop.js';

export function drumMachineUI() {
  const root = h('div', { class: 'drum-machine' });
  const head = h('div', { class: 'dm-head' });
  const grid = h('div', { class: 'dm-grid' });
  root.append(head, grid);
  function pat() { return app.project.patterns.find((p) => p.id === app.project.activePattern) || app.project.patterns[0]; }
  function render() {
    const P = pat(); if (!P) return;
    head.replaceChildren(
      h('select', { 'aria-label': 'パターン選択', onchange: (e) => { mutate('パターン切替', () => { app.project.activePattern = e.target.value; }); render(); } }, app.project.patterns.map((p) => h('option', { value: p.id, selected: p.id === P.id }, p.name))),
      h('button', { class: 'btn sm', onclick: () => { mutate('パターン追加', (proj) => { const np = emptyPattern('パターン ' + (proj.patterns.length + 1)); proj.patterns.push(np); proj.activePattern = np.id; }); render(); } }, '＋新規'),
      h('button', { class: 'btn sm', onclick: () => { mutate('パターン複製', (proj) => { const np = JSON.parse(JSON.stringify(P)); np.id = 'pat_' + Math.random().toString(36).slice(2, 8); np.name += ' コピー'; proj.patterns.push(np); proj.activePattern = np.id; }); render(); } }, '⎘複製'),
      h('button', { class: 'btn sm', onclick: async () => { const n = await askText('パターン名を変更', '名前', P.name); if (n) mutate('パターン名変更', () => { P.name = n; }); render(); } }, '名前変更'),
      h('button', { class: 'btn sm danger', onclick: async () => { if (app.project.patterns.length <= 1) { toast('最後のパターンは削除できません', 'warn'); return; } if (await confirmBox('削除確認', P.name + ' を削除しますか？')) { mutate('パターン削除', (proj) => { proj.patterns = proj.patterns.filter((p) => p.id !== P.id); proj.activePattern = proj.patterns[0].id; }); render(); } } }, '削除'),
      h('label', { class: 'inline' }, 'Steps', h('select', { onchange: (e) => { mutate('ステップ数変更', () => { const np = resizePattern(P, +e.target.value); Object.assign(P, np); }); render(); } }, [16, 32].map((s) => h('option', { value: s, selected: P.steps === s }, s)))),
      h('label', { class: 'inline' }, 'Swing', h('input', { type: 'range', min: 0, max: 0.6, step: 0.01, value: P.swing, oninput: (e) => mutate('スイング', () => { P.swing = +e.target.value; }, 'swing') })),
      h('button', { class: 'btn sm', onclick: () => { for (const r of DRUM_ROWS) previewHit(r.id); } }, '▶ プレビュー'));
    grid.replaceChildren(...DRUM_ROWS.map((r) => drumRow(r, P)));
  }
  function previewHit(id) { engine.init().then(() => { const buf = makeDrum(id, engine.sr); const src = engine.ctx.createBufferSource(); const ab = engine.ctx.createBuffer(1, buf.ch[0].length, buf.sr); ab.copyToChannel(buf.ch[0], 0); src.buffer = ab; src.connect(engine.preview); src.start(); }); }
  function drumRow(r, P) {
    const cells = [];
    const row = h('div', { class: 'dm-row' }, h('button', { class: 'dm-label', style: { color: r.color }, onclick: () => previewHit(r.id) }, r.name),
      h('div', { class: 'dm-cells', dataset: { row: r.id } }, Array.from({ length: P.steps }, (_, i) => { const v = P.rows[r.id][i]; const c = h('button', { class: 'dm-cell' + (v ? ' on' : '') + (i % 4 === 0 ? ' beat' : ''), style: { '--v': v, '--c': r.color }, 'aria-label': r.name + ' ' + (i + 1) + '拍目', onclick: () => { mutate('ステップ編集', () => { P.rows[r.id][i] = v ? 0 : 1; }); c.classList.toggle('on'); c.style.setProperty('--v', P.rows[r.id][i]); if (!v) previewHit(r.id); }, oncontextmenu: (e) => { e.preventDefault(); const nv = Math.max(0, (v || 0) - 0.34); mutate('ベロシティ調整', () => { P.rows[r.id][i] = nv < 0.05 ? 0 : nv; }, 'vel' + r.id + i); c.classList.toggle('on', P.rows[r.id][i] > 0); c.style.setProperty('--v', P.rows[r.id][i]); } }); cells.push(c); return c; })));
    return row;
  }
  addTick(() => { const P = pat(); if (!P) return; const step = 60 / app.project.bpm / 4, t = transport.currentPos() % (step * P.steps), idx = Math.floor(t / step); grid.querySelectorAll('.dm-cells').forEach((row) => { [...row.children].forEach((c, i) => c.classList.toggle('play', transport.playing && i === idx)); }); });
  bus.on('project:changed', render); bus.on('project:restored', render);
  root.render = render; render(); return root;
}

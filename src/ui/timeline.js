import { h } from '../utils/dom.js';
import { fitCanvas, drawWave, css } from './draw.js';
import { app, mutate, getAsset, setSel, touch } from '../app.js';
import { snapValue, newClip, newDrumClip, newTrack, TRACK_COLORS } from '../timeline/project.js';
import { bus } from '../utils/bus.js';
import { transport } from '../sequencer/transport.js';
import { addTick as addTickFn } from './loop.js';
import { toast, confirmBox } from '../utils/dom.js';

const PXPS_DEFAULT = 90;
export function timelineUI() {
  let pxps = PXPS_DEFAULT, scrollX = 0, trackH = 76, dragClip = null, dragMode = null, resizeEdge = null, marquee = null, autoDrag = null;
  const root = h('div', { class: 'timeline' });
  const ruler = h('canvas', { class: 'tl-ruler' }); const tracksWrap = h('div', { class: 'tl-tracks' }); const body = h('div', { class: 'tl-body' }, tracksWrap);
  const rulerWrap = h('div', { class: 'tl-rulerwrap' }, ruler);
  root.append(rulerWrap, body);
  function timeToX(t) { return t * pxps - scrollX; }
  function xToTime(x) { return (x + scrollX) / pxps; }
  function trackEls() { return [...tracksWrap.querySelectorAll('.tl-track')]; }
  function render() {
    tracksWrap.replaceChildren();
    const P = app.project;
    P.tracks.forEach((tr, ti) => tracksWrap.append(trackRow(tr, ti)));
    tracksWrap.append(h('div', { class: 'tl-addtrack-row' }, h('button', { class: 'btn sm', onclick: () => { mutate('トラックを追加', (P2) => { P2.tracks.push(newTrack(P2.tracks.length + 1)); }); render(); } }, '＋ トラックを追加'),
      h('button', { class: 'btn sm', onclick: () => { mutate('ドラムトラックを追加', (P2) => { P2.tracks.push(newTrack(P2.tracks.length + 1, 'drum')); }); render(); } }, '＋ ドラムトラックを追加')));
    drawRuler(); tracksWrap.querySelectorAll('.tl-canvas').forEach(drawTrackCanvas);
  }
  function trackRow(tr, ti) {
    const row = h('div', { class: 'tl-track', style: { height: trackH + 'px' }, dataset: { id: tr.id } });
    const head = h('div', { class: 'tl-thead', style: { borderLeftColor: tr.color } },
      h('input', { class: 'tl-tname', value: tr.name, 'aria-label': 'トラック名', onchange: (e) => mutate('トラック名を変更', () => { tr.name = e.target.value || tr.name; }) }),
      h('div', { class: 'tl-tbtns' },
        h('button', { class: 'btn xs' + (tr.mute ? ' on' : ''), title: 'ミュート(M)', onclick: () => { mutate('ミュート切替', () => { tr.mute = !tr.mute; }); rerenderTrack(tr); } }, 'M'),
        h('button', { class: 'btn xs' + (tr.solo ? ' on' : ''), title: 'ソロ', onclick: () => { mutate('ソロ切替', () => { tr.solo = !tr.solo; }); render(); } }, 'S'),
        h('button', { class: 'btn xs', title: '複製', onclick: () => { mutate('トラックを複製', (P) => { const c = JSON.parse(JSON.stringify(tr)); c.id = 'trk_' + Math.random().toString(36).slice(2, 9); c.name += ' コピー'; c.clips.forEach((cl) => (cl.id = 'clp_' + Math.random().toString(36).slice(2, 9))); const i = P.tracks.indexOf(tr); P.tracks.splice(i + 1, 0, c); }); render(); } }, '⎘'),
        h('button', { class: 'btn xs danger', title: '削除', onclick: async () => { if (app.project.tracks.length <= 1) { toast('最後のトラックは削除できません', 'warn'); return; } if (await confirmBox('トラックを削除', tr.name + ' を削除しますか？')) { mutate('トラックを削除', (P) => { P.tracks = P.tracks.filter((x) => x.id !== tr.id); }); render(); } } }, '✕')),
      h('div', { class: 'tl-vol' }, h('input', { type: 'range', min: 0, max: 1.5, step: 0.01, value: tr.vol, title: '音量', 'aria-label': tr.name + ' 音量', oninput: (e) => { mutate('音量変更', () => { tr.vol = +e.target.value; }, 'vol' + tr.id); } })),
      h('div', { class: 'tl-pan' }, h('input', { type: 'range', min: -1, max: 1, step: 0.01, value: tr.pan, title: 'パン', 'aria-label': tr.name + ' パン', oninput: (e) => { mutate('パン変更', () => { tr.pan = +e.target.value; }, 'pan' + tr.id); } })),
      h('button', { class: 'btn xs' + (app.sel.trackId === tr.id ? ' on' : ''), title: 'エフェクトを編集', onclick: () => { setSel({ trackId: tr.id }); bus.emit('opentrackfx', tr.id); } }, 'FX'));
    const lane = h('div', { class: 'tl-lane', dataset: { id: tr.id } });
    const cv = h('canvas', { class: 'tl-canvas' }); lane.append(cv);
    tr.clips.forEach((c) => lane.append(clipEl(tr, c)));
    lane.addEventListener('dblclick', (e) => { if (e.target !== lane && e.target !== cv) return; const t = snapValue(app.project, xToTime(e.offsetX)); bus.emit('timeline:emptydblclick', tr, t); });
    lane.addEventListener('pointerdown', (e) => { if (e.target !== lane && e.target !== cv) return; startMarquee(e, tr); });
    lane.addEventListener('contextmenu', (e) => e.preventDefault());
    row.append(head, lane); row._lane = lane; row._cv = cv; row._tr = tr;
    if (app.autoView && app.autoView.trackId === tr.id) row.append(automationLane(tr, app.autoView.key));
    return row;
  }
  function automationLane(tr, key) {
    tr.auto[key] = tr.auto[key] || [];
    const pts = tr.auto[key];
    const wrap = h('div', { class: 'auto-lane' }); const cv = h('canvas', { class: 'auto-cv' });
    const close = h('button', { class: 'btn xs auto-close', title: '閉じる', onclick: () => { app.autoView = null; render(); } }, '✕ オートメーションを閉じる');
    wrap.append(cv, close);
    const range = key === 'pan' ? [-1, 1] : key === 'vol' ? [0, 1.5] : [0, 1];
    function toXY(p, w, h) { return [timeToX(p.t), h - ((p.v - range[0]) / (range[1] - range[0])) * h]; }
    function fromXY(x, y, w, h) { return { t: Math.max(0, xToTime(x)), v: Math.max(range[0], Math.min(range[1], range[0] + (1 - y / h) * (range[1] - range[0]))) }; }
    function draw() { const { c, w, h: hh } = fitCanvas(cv); c.clearRect(0, 0, w, hh); c.fillStyle = css('--panel3') || '#1a2230'; c.fillRect(0, 0, w, hh); c.strokeStyle = tr.color; c.lineWidth = 1.5; c.beginPath();
      const sorted = [...pts].sort((a, b) => a.t - b.t); if (sorted.length) { const [x0, y0] = toXY(sorted[0], w, hh); c.moveTo(0, y0); c.lineTo(x0, y0); for (const p of sorted) { const [x, y] = toXY(p, w, hh); c.lineTo(x, y); } const [xl, yl] = toXY(sorted[sorted.length - 1], w, hh); c.lineTo(w, yl); } else { c.moveTo(0, hh / 2); c.lineTo(w, hh / 2); }
      c.stroke(); c.fillStyle = tr.color; for (const p of sorted) { const [x, y] = toXY(p, w, hh); c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill(); } }
    let dragP = null;
    cv.addEventListener('pointerdown', (e) => { const r = cv.getBoundingClientRect(), w = r.width, hh = r.height, x = e.clientX - r.left, y = e.clientY - r.top;
      let near = null, nd = 10; for (const p of pts) { const [px, py] = toXY(p, w, hh); const d = Math.hypot(px - x, py - y); if (d < nd) { nd = d; near = p; } }
      if (e.button === 2 || e.shiftKey) { if (near) { pts.splice(pts.indexOf(near), 1); touch('オートメーション点を削除'); draw(); } return; }
      if (near) dragP = near; else { const np = fromXY(x, y, w, hh); pts.push(np); dragP = np; }
      cv.setPointerCapture(e.pointerId); draw(); });
    cv.addEventListener('pointermove', (e) => { if (!dragP) return; const r = cv.getBoundingClientRect(); const np = fromXY(e.clientX - r.left, e.clientY - r.top, r.width, r.height); dragP.t = np.t; dragP.v = np.v; draw(); });
    cv.addEventListener('pointerup', () => { if (dragP) touch('オートメーション編集'); dragP = null; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    draw(); wrap._draw = draw; return wrap;
  }
  function rerenderTrack(tr) { const row = trackEls().find((r) => r.dataset.id === tr.id); if (row) { const nr = trackRow(tr, 0); row.replaceWith(nr); drawTrackCanvas(nr._cv); } }
  function clipEl(tr, c) {
    const dur = c.dur, x = timeToX(c.start), w = Math.max(6, dur * pxps);
    const el = h('div', { class: 'tl-clip' + (app.sel.clipIds.includes(c.id) ? ' sel' : ''), style: { left: x + 'px', width: w + 'px', background: tr.color + '33', borderColor: tr.color }, dataset: { id: c.id }, tabIndex: 0, 'aria-label': (tr.type === 'drum' ? 'ドラムクリップ' : (app.project.assets.find((a) => a.id === c.assetId) || {}).name || 'クリップ') },
      h('div', { class: 'clip-body' }, h('span', { class: 'clip-name' }, tr.type === 'drum' ? (app.project.patterns.find((p) => p.id === c.patternId) || {}).name || 'パターン' : (app.project.assets.find((a) => a.id === c.assetId) || {}).name || '')),
      h('div', { class: 'clip-h clip-h-l' }), h('div', { class: 'clip-h clip-h-r' }));
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); const edge = e.target.classList.contains('clip-h-l') ? 'l' : e.target.classList.contains('clip-h-r') ? 'r' : null;
      if (!(e.shiftKey || e.ctrlKey || e.metaKey)) setSel({ clipIds: [c.id], trackId: tr.id }); else { const s = new Set(app.sel.clipIds); s.has(c.id) ? s.delete(c.id) : s.add(c.id); setSel({ clipIds: [...s], trackId: tr.id }); }
      renderSelOnly(); el.setPointerCapture(e.pointerId); dragClip = { track: tr, clip: c, startX: e.clientX, origStart: c.start, origDur: c.dur, origOffset: c.offset, moved: false }; resizeEdge = edge; });
    el.addEventListener('pointermove', (e) => { if (!dragClip || dragClip.clip !== c) return; const dx = (e.clientX - dragClip.startX) / pxps; dragClip.moved = Math.abs(e.clientX - dragClip.startX) > 3;
      if (!dragClip.moved) return;
      if (resizeEdge === 'r') { c.dur = Math.max(0.05, snapValue(app.project, dragClip.origStart + dragClip.origDur + dx) - c.start); }
      else if (resizeEdge === 'l') { let ns = snapValue(app.project, dragClip.origStart + dx); ns = Math.min(ns, dragClip.origStart + dragClip.origDur - 0.05); const delta = ns - dragClip.origStart; if (tr.type !== 'drum') c.offset = Math.max(0, dragClip.origOffset + delta); c.start = ns; c.dur = dragClip.origDur - delta; }
      else { c.start = Math.max(0, snapValue(app.project, dragClip.origStart + dx)); }
      el.style.left = timeToX(c.start) + 'px'; el.style.width = Math.max(6, c.dur * pxps) + 'px'; });
    el.addEventListener('pointerup', () => { if (dragClip && dragClip.clip === c && dragClip.moved) touchProj('クリップを編集'); dragClip = null; resizeEdge = null; });
    el.addEventListener('dblclick', (e) => { e.stopPropagation(); bus.emit('timeline:clipdblclick', tr, c); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); } });
    return el;
  }
  function touchProj(label) { touch(label); rerenderTrack(dragClip ? dragClip.track : app.project.tracks[0]); }
  function renderSelOnly() { tracksWrap.querySelectorAll('.tl-clip').forEach((el) => el.classList.toggle('sel', app.sel.clipIds.includes(el.dataset.id))); }
  function startMarquee(e, tr) {
    const lane = e.currentTarget, r = lane.getBoundingClientRect(); const box = h('div', { class: 'marquee' }); lane.append(box); const sx = e.clientX - r.left;
    const move = (ev) => { const x2 = ev.clientX - r.left, l = Math.min(sx, x2), w = Math.abs(x2 - sx); box.style.left = l + 'px'; box.style.width = w + 'px'; box.style.top = '2px'; box.style.height = (trackH - 6) + 'px';
      const t0 = xToTime(l), t1 = xToTime(l + w); const ids = tr.clips.filter((c) => c.start < t1 && c.start + c.dur > t0).map((c) => c.id); setSel({ clipIds: ids, trackId: tr.id }); renderSelOnly(); };
    const up = () => { box.remove(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function deleteSelected() { if (!app.sel.clipIds.length) return; mutate('クリップを削除', (P) => { for (const t of P.tracks) t.clips = t.clips.filter((c) => !app.sel.clipIds.includes(c.id)); }); setSel({ clipIds: [] }); render(); }
  function drawRuler() {
    const { c, w, h: hh } = fitCanvas(ruler); c.clearRect(0, 0, w, hh); c.fillStyle = css('--panel2'); c.fillRect(0, 0, w, hh);
    const P = app.project, beat = 60 / P.bpm, bar = beat * P.sig[0]; c.strokeStyle = css('--line'); c.fillStyle = css('--text-dim'); c.font = '10px ui-sans-serif';
    const startBar = Math.floor(xToTime(0) / bar), endBar = Math.ceil(xToTime(w) / bar) + 1;
    for (let b = Math.max(0, startBar); b <= endBar; b++) { const x = timeToX(b * bar); c.beginPath(); c.moveTo(x + 0.5, hh * 0.35); c.lineTo(x + 0.5, hh); c.stroke(); c.fillText(String(b + 1), x + 3, hh * 0.55); if (pxps * beat > 24) for (let s = 1; s < P.sig[0]; s++) { const xs = timeToX(b * bar + s * beat); c.strokeStyle = css('--line-weak'); c.beginPath(); c.moveTo(xs + 0.5, hh * 0.65); c.lineTo(xs + 0.5, hh); c.stroke(); c.strokeStyle = css('--line'); } }
    if (P.loop.on) { c.fillStyle = '#4de0c155'; c.fillRect(timeToX(P.loop.start), 0, (P.loop.end - P.loop.start) * pxps, hh); }
    const px = timeToX(transport.currentPos()); c.strokeStyle = '#ff5d73'; c.beginPath(); c.moveTo(px + 0.5, 0); c.lineTo(px + 0.5, hh); c.stroke();
  }
  function drawTrackCanvas(cv) { const { c, w, h: hh } = fitCanvas(cv); c.clearRect(0, 0, w, hh); const tr = cv.closest('.tl-track')._tr;
    c.strokeStyle = css('--line-weak'); const P = app.project, beat = 60 / P.bpm; for (let x = -((scrollX) % (beat * pxps)); x < w; x += beat * pxps) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, hh); c.stroke(); }
    for (const clip of tr.clips) { const x = timeToX(clip.start), cw = clip.dur * pxps; if (x + cw < 0 || x > w) continue; if (tr.type !== 'drum') { const buf = getAsset(clip.assetId); if (buf) drawWave(c, buf, Math.max(0, x), 16, Math.min(cw, w - Math.max(0, x)) , hh - 18, clip.offset + Math.max(0, -x) / pxps, Math.min(cw, w - x) / pxps, tr.color, { mono: true }); } else drawPattern(c, x, 16, cw, hh - 18, tr, clip); }
    const px = timeToX(transport.currentPos()); c.strokeStyle = '#ff5d73aa'; c.beginPath(); c.moveTo(px + 0.5, 0); c.lineTo(px + 0.5, hh); c.stroke();
  }
  function drawPattern(c, x, y, w, h, tr, clip) { const pat = app.project.patterns.find((p) => p.id === clip.patternId); if (!pat) return; const step = 60 / app.project.bpm / 4 * pxps; const rows = Object.keys(pat.rows); c.fillStyle = tr.color;
    for (let k = 0; ; k++) { const sx = x + k * step; if (sx > x + w + step) break; const si = k % pat.steps; rows.forEach((rid, ri) => { const v = pat.rows[rid][si]; if (v) c.fillRect(Math.max(0, sx), y + (ri / rows.length) * h, Math.max(1, step - 1), Math.max(1.5, h / rows.length - 1)); }); if (sx > x + w) break; } }
  addTickFn(tick);
  function tick() { drawRuler(); const px = timeToX(transport.currentPos()); if (transport.playing && (px < 0 || px > body.clientWidth - 60)) { scrollX = Math.max(0, transport.currentPos() * pxps - body.clientWidth * 0.3); render(); return; } if (transport.playing) tracksWrap.querySelectorAll('.tl-canvas').forEach(drawTrackCanvas); }
  ruler.addEventListener('pointerdown', (e) => { const r = ruler.getBoundingClientRect(); const t = Math.max(0, xToTime(e.clientX - r.left)); transport.seek(snapValue(app.project, t)); const move = (ev) => { const t2 = Math.max(0, xToTime(ev.clientX - r.left)); transport.pos = t2; drawRuler(); transport.scrub(t2); }; const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); });
  body.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); const old = pxps; pxps = Math.max(15, Math.min(500, pxps * (e.deltaY < 0 ? 1.1 : 0.9))); scrollX = Math.max(0, scrollX * (pxps / old)); render(); } else { scrollX = Math.max(0, scrollX + e.deltaY + e.deltaX); render(); } }, { passive: false });
  bus.on('project:changed', render); bus.on('project:restored', render); bus.on('selection', renderSelOnly);
  bus.on('autoview', render);
  root.render = render; root.deleteSelected = deleteSelected; root.zoom = (f) => { pxps = Math.max(15, Math.min(500, pxps * f)); render(); };
  root.setLoopSelToView = () => {};
  render();
  return root;
}

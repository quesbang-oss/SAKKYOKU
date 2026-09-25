import { h } from '../utils/dom.js';
import { noteName } from '../utils/util.js';
export const PC_KEYMAP = { z: 48, s: 49, x: 50, d: 51, c: 52, v: 53, g: 54, b: 55, h: 56, n: 57, j: 58, m: 59, ',': 60, l: 61, '.': 62, ';': 63, '/': 64, q: 60, '2': 61, w: 62, '3': 63, e: 64, r: 65, '5': 66, t: 67, '6': 68, y: 69, '7': 70, u: 71, i: 72, '9': 73, o: 74, '0': 75, p: 76 };
export function keyboardUI({ lowNote = 36, highNote = 84, onDown, onUp, octaveGetter }) {
  const wrap = h('div', { class: 'kbd-wrap' }), roll = h('div', { class: 'kbd-roll' }), active = new Map();
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);
  const whiteW = 34, blackW = 20;
  let whiteIdx = 0; const keys = [];
  for (let m = lowNote; m <= highNote; m++) { if (!isBlack(m)) { keys.push({ m, x: whiteIdx * whiteW, w: whiteW, black: false }); whiteIdx++; } }
  for (let m = lowNote; m <= highNote; m++) if (isBlack(m)) { let wi = 0; for (let k = lowNote; k < m; k++) if (!isBlack(k)) wi++; keys.push({ m, x: wi * whiteW - blackW / 2, w: blackW, black: true }); }
  keys.sort((a, b) => (a.black === b.black ? 0 : a.black ? 1 : -1));
  roll.style.width = whiteIdx * whiteW + 'px';
  const els = new Map();
  for (const k of keys) {
    const el = h('div', { class: 'key' + (k.black ? ' black' : ' white'), style: { left: k.x + 'px', width: k.w + 'px' }, 'aria-label': noteName(k.m), title: noteName(k.m) });
    if (!k.black) el.append(h('span', { class: 'kn' }, k.m % 12 === 0 ? noteName(k.m) : ''));
    els.set(k.m, el); roll.append(el);
  }
  function press(m, vel = 0.9) { if (active.has(m)) return; active.set(m, 1); els.get(m)?.classList.add('active'); onDown && onDown(m, vel); }
  function release(m) { if (!active.has(m)) return; active.delete(m); els.get(m)?.classList.remove('active'); onUp && onUp(m); }
  let pointerNote = null;
  const posToNote = (clientX) => { const r = roll.getBoundingClientRect(); const rel = clientX - r.left; let best = null, bd = 1e9; for (const k of keys) { if (rel >= k.x && rel <= k.x + k.w) { if (k.black) return k.m; if (best == null || k.w < 999) { best = k.m; } } } return best; };
  roll.addEventListener('pointerdown', (e) => { const m = posToNote(e.clientX); if (m == null) return; roll.setPointerCapture(e.pointerId); pointerNote = m; press(m); });
  roll.addEventListener('pointermove', (e) => { if (pointerNote == null || e.buttons !== 1) return; const m = posToNote(e.clientX); if (m != null && m !== pointerNote) { release(pointerNote); press(m); pointerNote = m; } });
  const end = () => { if (pointerNote != null) { release(pointerNote); pointerNote = null; } };
  roll.addEventListener('pointerup', end); roll.addEventListener('pointercancel', end); roll.addEventListener('pointerleave', (e) => { if (e.buttons !== 1) end(); });
  wrap.append(roll); wrap.press = press; wrap.release = release; wrap.keys = keys;
  return wrap;
}
export function pcKeyLabel(map) { return Object.entries(map).slice(0, 17).map(([k]) => k.toUpperCase()).join(' '); }

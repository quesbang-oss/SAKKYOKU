import { h } from '../utils/dom.js';
export function padsUI(pads, { onTrigger, onRelease, onEdit }) {
  const grid = h('div', { class: 'pad-grid' });
  const els = pads.map((p, i) => {
    const el = h('button', { class: 'pad', style: { '--pad-color': p.color }, 'aria-label': p.name, dataset: { key: String((i + 1) % 16) } },
      h('span', { class: 'pad-key' }, PAD_KEYS[i] || ''), h('span', { class: 'pad-name' }, p.name), !p.assetId ? h('span', { class: 'pad-empty' }, '空') : null);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.classList.add('hit'); onTrigger(i, 1); });
    const up = () => { el.classList.remove('hit'); onRelease && onRelease(i); };
    el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up);
    el.addEventListener('dblclick', () => onEdit && onEdit(i));
    grid.append(el); return el;
  });
  grid.flash = (i) => { els[i] && els[i].classList.add('hit'); setTimeout(() => els[i] && els[i].classList.remove('hit'), 90); };
  grid.refreshEmpty = (pads2) => { pads2.forEach((p, i) => { const el = els[i]; if (!el) return; el.querySelector('.pad-name').textContent = p.name; let e = el.querySelector('.pad-empty'); if (!p.assetId) { if (!e) el.append(h('span', { class: 'pad-empty' }, '空')); } else if (e) e.remove(); el.style.setProperty('--pad-color', p.color); }); };
  return grid;
}
export const PAD_KEYS = ['1', '2', '3', '4', 'Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V'];
export const PAD_KEY_TO_IDX = Object.fromEntries(PAD_KEYS.map((k, i) => [k.toLowerCase(), i]));

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) { if (kid == null || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return el;
}
export function toast(msg, kind = 'info', ms = 3500) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind }, msg);
  box.append(t); setTimeout(() => t.remove(), ms);
}
export function modal(title, body, buttons = [{ label: 'OK', primary: true }]) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const close = (v) => { ov.remove(); prev && prev.focus && prev.focus(); resolve(v); };
    const btns = buttons.map((b, i) => h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), onclick: () => close(b.value !== undefined ? b.value : i) }, b.label));
    const ov = h('div', { class: 'modal-ov', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal' }, h('h3', null, title), h('div', { class: 'modal-body' }, body), h('div', { class: 'modal-btns' }, btns)));
    ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(-1); });
    document.body.append(ov); (btns[btns.length - 1] || ov).focus();
  });
}
export function showError(title, detail, help) {
  return modal(title, h('div', null, h('p', { class: 'err-detail' }, detail || ''), help ? h('p', { class: 'err-help' }, '💡 ' + help) : null), [{ label: '閉じる', primary: true }]);
}
export async function askText(title, label, def = '') {
  const inp = h('input', { type: 'text', value: def, 'aria-label': label, class: 'txt' });
  const p = modal(title, h('label', null, label, h('br'), inp), [{ label: 'キャンセル', value: null }, { label: 'OK', primary: true, value: 'ok' }]);
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
  const r = await p; return r === 'ok' ? inp.value.trim() || null : null;
}
export function confirmBox(title, msg) { return modal(title, h('p', null, msg), [{ label: 'キャンセル', value: false }, { label: 'OK', primary: true, value: true }]); }
export function slider(spec, value, onInput, onChange) {
  const wrap = h('label', { class: 'ctl' });
  const lab = h('span', { class: 'ctl-l' }, spec.n || spec.k);
  const val = h('span', { class: 'ctl-v' });
  const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)) + (spec.unit || '');
  if (spec.opts) {
    const sel = h('select', { 'aria-label': spec.n || spec.k }, spec.opts.map((o, i) => h('option', { value: i }, o)));
    sel.value = String(value ?? spec.def);
    sel.addEventListener('change', () => { const v = +sel.value; onInput && onInput(v); onChange && onChange(v); });
    wrap.append(lab, sel); wrap.setValue = (v) => { sel.value = String(v); };
    return wrap;
  }
  const inp = h('input', { type: 'range', min: spec.min, max: spec.max, step: spec.step || (spec.max - spec.min) / 200, 'aria-label': spec.n || spec.k });
  inp.value = value ?? spec.def; val.textContent = fmt(+inp.value);
  inp.addEventListener('input', () => { val.textContent = fmt(+inp.value); onInput && onInput(+inp.value); });
  inp.addEventListener('change', () => onChange && onChange(+inp.value));
  inp.addEventListener('dblclick', () => { inp.value = spec.def; val.textContent = fmt(spec.def); onInput && onInput(spec.def); onChange && onChange(spec.def); });
  wrap.append(lab, inp, val); wrap.setValue = (v) => { inp.value = v; val.textContent = fmt(v); };
  return wrap;
}
export function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

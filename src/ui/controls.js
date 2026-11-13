// controls.js — precision slider (drag, shift-drag fine, typed entry), segments, switches.
import { toDisp, fromDisp, parseLen, unitLabel, lenDp } from './units.js';

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// opts: { label, kind:'len'|'num'|'int', min, max, step, hardMin, hardMax, get, set(v, final), units(), def, hint, dp, suffix }
export function createSlider(o) {
  const root = h('div', 'ctl');
  const head = h('div', 'ctl-head');
  const lab = h('label', 'ctl-label', o.label);
  if (o.hint) lab.title = o.hint;
  const valWrap = h('div', 'ctl-val');
  const input = h('input', 'num');
  input.type = 'text'; input.inputMode = 'decimal'; input.spellcheck = false; input.setAttribute('aria-label', o.label.replace(/<[^>]+>/g, ''));
  const unit = h('span', 'unit');
  valWrap.append(input, unit); head.append(lab, valWrap);
  const track = h('div', 'track');
  const fill = h('div', 'fill'), thumb = h('div', 'thumb'), rail = h('div', 'rail');
  thumb.tabIndex = 0; thumb.setAttribute('role', 'slider');
  track.append(rail, fill, thumb);
  root.append(head, track);

  const U = () => (o.units ? o.units() : 'mm');
  const isLen = o.kind === 'len';
  const dp = () => o.dp ?? (isLen ? lenDp(U()) : o.kind === 'int' ? 0 : 3);
  const disp = v => isLen ? toDisp(v, U()) : v;
  const hardMin = o.hardMin ?? -Infinity, hardMax = o.hardMax ?? Infinity;
  const clampH = v => Math.min(hardMax, Math.max(hardMin, v));
  const quant = v => o.kind === 'int' ? Math.round(v) : v;
  let editing = false;

  function refresh() {
    const v = o.get();
    const f = Math.min(1, Math.max(0, (v - o.min) / (o.max - o.min)));
    fill.style.width = (f * 100) + '%';
    thumb.style.left = (f * 100) + '%';
    thumb.setAttribute('aria-valuenow', v);
    if (!editing) input.value = Number.isFinite(v) ? disp(v).toFixed(dp()) : '';
    unit.textContent = isLen ? unitLabel(U()) : (o.suffix || '');
  }
  function commit(v, final) { v = clampH(quant(v)); o.set(v, final); refresh(); }

  // drag
  let drag = null;
  track.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = track.getBoundingClientRect();
    let v0 = o.get();
    if (e.target !== thumb) { v0 = o.min + (o.max - o.min) * Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); commit(v0, false); }
    drag = { x: e.clientX, v: o.get(), w: r.width, fine: e.shiftKey };
    track.setPointerCapture(e.pointerId); root.classList.add('active'); thumb.focus({ preventScroll: true });
  });
  track.addEventListener('pointermove', e => {
    if (!drag) return;
    // shift engages fine control from the current point
    if (e.shiftKey !== drag.fine) { drag = { x: e.clientX, v: o.get(), w: drag.w, fine: e.shiftKey }; }
    const scale = drag.fine ? 0.08 : 1;
    let v = drag.v + (e.clientX - drag.x) / drag.w * (o.max - o.min) * scale;
    v = Math.min(o.max, Math.max(o.min, v));
    root.classList.toggle('fine', drag.fine);
    commit(v, false);
  });
  const end = () => { if (!drag) return; drag = null; root.classList.remove('active', 'fine'); commit(o.get(), true); };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
  track.addEventListener('dblclick', () => { if (o.def != null) commit(typeof o.def === 'function' ? o.def() : o.def, true); });

  thumb.addEventListener('keydown', e => {
    const st = (o.step || (o.max - o.min) / 200) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { commit(o.get() + st, true); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { commit(o.get() - st, true); e.preventDefault(); }
  });

  // typed entry
  input.addEventListener('focus', () => { editing = true; input.select(); root.classList.add('editing'); });
  const apply = () => {
    const v = isLen ? parseLen(input.value, U()) : parseFloat(input.value.replace(',', '.'));
    if (v != null && Number.isFinite(v)) commit(v, true);
    else root.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], { duration: 220 });
  };
  input.addEventListener('blur', () => { editing = false; root.classList.remove('editing'); apply(); refresh(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { input.blur(); }
    else if (e.key === 'Escape') { editing = false; refresh(); input.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const st = (o.step || 1) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
      commit(o.get() + st, true); input.value = disp(o.get()).toFixed(dp()); input.select();
    }
  });
  refresh();
  return { el: root, refresh };
}

export function createSegment(options, get, set, { cls = '' } = {}) {
  const root = h('div', 'seg ' + cls);
  const ind = h('div', 'seg-ind'); root.appendChild(ind);
  const btns = options.map(op => {
    const b = h('button', 'seg-btn', op.label); b.type = 'button'; b.dataset.value = op.value;
    if (op.title) b.title = op.title;
    b.addEventListener('click', () => { set(op.value); refresh(); });
    root.appendChild(b); return b;
  });
  function refresh() {
    const v = get();
    btns.forEach(b => b.classList.toggle('on', b.dataset.value === String(v)));
    const on = btns.find(b => b.classList.contains('on'));
    if (on) requestAnimationFrame(() => { ind.style.width = on.offsetWidth + 'px'; ind.style.transform = `translateX(${on.offsetLeft}px)`; ind.style.opacity = 1; });
    else ind.style.opacity = 0;
  }
  refresh();
  return { el: root, refresh };
}

export function createSwitch(label, get, set) {
  const root = h('label', 'switch');
  root.innerHTML = `<span class="sw-label">${label}</span><input type="checkbox"><span class="sw-track"><span class="sw-knob"></span></span>`;
  const cb = root.querySelector('input');
  cb.addEventListener('change', () => set(cb.checked));
  const refresh = () => { cb.checked = !!get(); };
  refresh();
  return { el: root, refresh };
}

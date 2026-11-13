// blueprint.js — top-down technical drawing of a Design (SVG, cyan on navy).
// Drawing frame: X = design y (nut left, bridge right), Y = design x (treble top, bass bottom).
import { fmtLen, fmtRadius, perpFret } from './ui/units.js';

const NS = 'http://www.w3.org/2000/svg';
const MARKERS = new Set([3, 5, 7, 9, 15, 17, 19, 21, 27, 29, 31, 33]);
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const P = p => ({ X: p.y, Y: p.x });
const pathD = pts => pts.map((p, i) => (i ? 'L' : 'M') + p.y.toFixed(3) + ' ' + p.x.toFixed(3)).join('');

export function createBlueprint(container, { onHover } = {}) {
  container.innerHTML = '';
  const svg = el('svg', { class: 'bp-svg', role: 'img', 'aria-label': 'Fretboard blueprint' }, container);
  const defs = el('defs', {}, svg);
  defs.innerHTML = `
    <filter id="bpGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <marker id="bpArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0,1.5 L9,5 L0,8.5" fill="none" stroke="currentColor" stroke-width="1.2"/></marker>`;
  const gGrid = el('g', { class: 'bp-grid' }, svg);
  const gMain = el('g', {}, svg);
  const tip = document.createElement('div'); tip.className = 'bp-tip'; container.appendChild(tip);
  const block = document.createElement('div'); block.className = 'bp-titleblock'; container.appendChild(block);

  let design = null, units = 'in', insets = { left: 0, right: 0, top: 0, bottom: 0 };
  let fit = null, zoom = 1, pan = { x: 0, y: 0 }, W = 1, H = 1, hoverN = null;

  function computeFit() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const add = p => { x0 = Math.min(x0, p.y); x1 = Math.max(x1, p.y); y0 = Math.min(y0, p.x); y1 = Math.max(y1, p.x); };
    design.outline.forEach(add); design.strings.forEach(s => { add(s.nut); add(s.bridge); });
    design.bridge.curve.forEach(add);
    const pad = 30;
    return { x0: x0 - pad, x1: x1 + pad, y0: y0 - pad - 12, y1: y1 + pad + 12 };
  }
  function viewBox() {
    const tb = block.offsetHeight ? block.offsetHeight + 18 : 0;   // keep clear of the title block
    const top = insets.top + tb;
    const fw = Math.max(50, W - insets.left - insets.right), fh = Math.max(50, H - top - insets.bottom);
    const bw = fit.x1 - fit.x0, bh = fit.y1 - fit.y0;
    const s = Math.min(fw / bw, fh / bh) * zoom;              // px per mm
    const cx = (fit.x0 + fit.x1) / 2 + pan.x, cy = (fit.y0 + fit.y1) / 2 + pan.y;
    const fcx = insets.left + fw / 2, fcy = top + fh / 2;
    return { s, x: cx - fcx / s, y: cy - fcy / s, w: W / s, h: H / s };
  }

  function draw() {
    if (!design) return;
    const r = container.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
    if (!fit) fit = computeFit();
    const vb = viewBox(), k = 1 / vb.s;                      // mm per px
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    svg.style.setProperty('--k', k);
    // grid
    gGrid.innerHTML = '';
    const minor = vb.s > 2.2 ? 5 : 10, major = 50;
    let dMin = '', dMaj = '';
    for (let x = Math.floor(vb.x / minor) * minor; x < vb.x + vb.w; x += minor) (Math.abs(x % major) < 1e-6 ? (dMaj += `M${x} ${vb.y}V${vb.y + vb.h}`) : (dMin += `M${x} ${vb.y}V${vb.y + vb.h}`));
    for (let y = Math.floor(vb.y / minor) * minor; y < vb.y + vb.h; y += minor) (Math.abs(y % major) < 1e-6 ? (dMaj += `M${vb.x} ${y}H${vb.x + vb.w}`) : (dMin += `M${vb.x} ${y}H${vb.x + vb.w}`));
    el('path', { d: dMin, class: 'grid-minor' }, gGrid);
    el('path', { d: dMaj, class: 'grid-major' }, gGrid);

    gMain.innerHTML = '';
    const fs = 10.5 * k, d = design, N = d.strings.length;
    const g = (cls) => el('g', { class: cls }, gMain);
    const text = (parent, x, y, str, attrs = {}) => { const t = el('text', { x, y, 'font-size': fs, ...attrs }, parent); t.textContent = str; return t; };

    // board
    const gb = g('board');
    el('path', { d: pathD(d.outline) + 'Z', class: 'outline' }, gb);
    // markers on the face
    const gm = g('markers');
    const mid = (f0, f1) => {
      const c0 = f0.crossings, c1 = f1.crossings, kk = (N - 1) / 2, i0 = Math.floor(kk), i1 = Math.min(N - 1, i0 + 1), t = kk - i0;
      const a = { x: c0[i0].x + (c0[i1].x - c0[i0].x) * t, y: c0[i0].y + (c0[i1].y - c0[i0].y) * t };
      const b = { x: c1[i0].x + (c1[i1].x - c1[i0].x) * t, y: c1[i0].y + (c1[i1].y - c1[i0].y) * t };
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    d.frets.forEach((f, i) => {
      const prev = i ? d.frets[i - 1] : d.nut;
      if (MARKERS.has(f.n)) { const m = mid(prev, f); el('circle', { cx: m.y, cy: m.x, r: 2.2, class: 'marker' }, gm); }
      if (f.n % 12 === 0) {
        const w = (d.widths?.nut || 50) * 0.18, m = mid(prev, f);
        el('circle', { cx: m.y, cy: m.x - w, r: 2.2, class: 'marker' }, gm); el('circle', { cx: m.y, cy: m.x + w, r: 2.2, class: 'marker' }, gm);
      }
    });
    // strings
    const gs = g('strings');
    d.strings.forEach(s => el('line', { x1: s.nut.y, y1: s.nut.x, x2: s.bridge.y, y2: s.bridge.x, class: s.wound ? 'string wound' : 'string', 'stroke-width': Math.max(0.6, s.gauge * 25.4 * vb.s * 0.9) }, gs));
    // perpendicular line
    const gp = g('perp');
    const xs = d.outline.map(p => p.x), xmin = Math.min(...xs), xmax = Math.max(...xs);
    el('line', { x1: 0, y1: xmin - 14, x2: 0, y2: xmax + 14, class: 'perp' }, gp);
    const pf = perpFret(d.params.perpRatio ?? 0.5);
    text(gp, 2.5 * k * 2, xmax + 14, `⟂  PERPENDICULAR  ·  ${Number.isFinite(pf) ? 'fret ' + (Math.abs(pf - Math.round(pf)) < 0.01 ? Math.round(pf) : pf.toFixed(1)) : 'bridge'}`, { class: 'perp-label', 'dominant-baseline': 'hanging' });
    // frets
    const gf = g('frets');
    const fretEls = new Map();
    let lastLabelX = -Infinity;
    d.frets.forEach(f => {
      const side = f.sagitta != null && f.sagitta < 0.02 ? 's0' : f.perpSide > 0 ? 'sp' : f.perpSide < 0 ? 'sn' : 's0';
      const p = el('path', { d: pathD(f.curve), class: `fret ${side}` + (f.n % 12 === 0 ? ' octave' : ''), 'data-n': f.n }, gf);
      fretEls.set(f.n, p);
      const a = f.curve[0];
      if ((a.y - lastLabelX) * vb.s > 15 || f.n % 12 === 0) {
        text(gf, a.y, a.x - 5 * k - 3, String(f.n), { class: 'fret-num' + (f.n % 12 === 0 ? ' octave' : ''), 'text-anchor': 'middle' });
        lastLabelX = a.y;
      }
    });
    // inflection points: where each S-curve fret changes direction
    const gi = g('infl');
    d.frets.forEach(f => (f.inflectionPoints || []).forEach(q => {
      el('circle', { cx: q.y, cy: q.x, r: 5 * k, class: 'infl-halo' }, gi);
      el('circle', { cx: q.y, cy: q.x, r: 2.2 * k, class: 'infl' }, gi);
    }));
    // nut and bridge
    el('path', { d: pathD(d.nut.curve), class: 'nut' }, gf);
    el('path', { d: pathD(d.bridge.curve), class: 'bridge' }, gf);
    d.bridge.crossings.forEach(c => el('circle', { cx: c.y, cy: c.x, r: 2.6 * k, class: 'saddle' }, gf));
    d.nut.crossings.forEach(c => el('circle', { cx: c.y, cy: c.x, r: 1.8 * k, class: 'nutpt' }, gf));

    // dimensions
    const gd = g('dims');
    const dimAlong = (s, side, label) => {
      const dx = s.bridge.x - s.nut.x, dy = s.bridge.y - s.nut.y, l = Math.hypot(dx, dy) || 1;
      const nx = dy / l * side, ny = -dx / l * side;          // perpendicular in design frame
      const off = Math.max(9, 30 * k);
      const a = { x: s.nut.x + nx * off, y: s.nut.y + ny * off }, b = { x: s.bridge.x + nx * off, y: s.bridge.y + ny * off };
      el('line', { x1: s.nut.y + ny * 3, y1: s.nut.x + nx * 3, x2: a.y + ny * 3, y2: a.x + nx * 3, class: 'ext' }, gd);
      el('line', { x1: s.bridge.y + ny * 3, y1: s.bridge.x + nx * 3, x2: b.y + ny * 3, y2: b.x + nx * 3, class: 'ext' }, gd);
      el('line', { x1: a.y, y1: a.x, x2: b.y, y2: b.x, class: 'dim', 'marker-start': 'url(#bpArrow)', 'marker-end': 'url(#bpArrow)' }, gd);
      const mx = (a.y + b.y) / 2, my = (a.x + b.x) / 2, ang = Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI;
      const t = text(gd, mx, my - 3 * k * side * -1, label, { class: 'dim-label', 'text-anchor': 'middle', 'dominant-baseline': side < 0 ? 'auto' : 'hanging', transform: `rotate(${ang} ${mx} ${my})` });
      t.setAttribute('y', my + (side < 0 ? -4 * k : 4 * k));
    };
    const s0 = d.strings[0], sN = d.strings[N - 1];
    dimAlong(s0, -1, `${N > 1 ? 'TREBLE  ' : 'SCALE  '}${fmtLen(s0.scale, units)}`);
    if (N > 1) dimAlong(sN, 1, `BASS  ${fmtLen(sN.scale, units)}`);
    const dimAcross = (curve, side, label) => {
      const a = curve[0], b = curve[curve.length - 1];
      const X = (side < 0 ? Math.min(a.y, b.y) : Math.max(a.y, b.y)) + side * Math.max(8, 26 * k);
      el('line', { x1: a.y + side * 2, y1: a.x, x2: X + side * 3, y2: a.x, class: 'ext' }, gd);
      el('line', { x1: b.y + side * 2, y1: b.x, x2: X + side * 3, y2: b.x, class: 'ext' }, gd);
      el('line', { x1: X, y1: a.x, x2: X, y2: b.x, class: 'dim', 'marker-start': 'url(#bpArrow)', 'marker-end': 'url(#bpArrow)' }, gd);
      const my = (a.x + b.x) / 2;
      text(gd, X + side * 4 * k, my, label, { class: 'dim-label', 'text-anchor': 'middle', transform: `rotate(-90 ${X + side * 4 * k} ${my})`, 'dominant-baseline': side < 0 ? 'auto' : 'hanging' });
    };
    dimAcross(d.nut.curve, -1, `NUT  ${fmtLen(d.widths.nut, units)}`);
    dimAcross(d.bridge.curve, 1, `BRIDGE  ${fmtLen(d.widths.bridge, units)}`);

    // hover: nearest fret to the pointer (within ~14 px)
    draw.k = k;
    draw.fretEls = fretEls;

    // title block
    const sr = d.metrics?.scaleRange || [s0.scale, sN.scale];
    block.innerHTML = `<div class="tb-row"><span class="tb-k">DWG</span><span class="tb-v">CFD-${String(N).padStart(2, '0')}-${String(d.frets.length).padStart(2, '0')}</span></div>
      <div class="tb-row"><span class="tb-k">MODE</span><span class="tb-v">${(d.params.mode || '').toUpperCase()}</span></div>
      <div class="tb-row"><span class="tb-k">SCALE</span><span class="tb-v">${fmtLen(sr[0], units)} – ${fmtLen(sr[1], units)}</span></div>
      <div class="tb-row"><span class="tb-k">KEY</span><span class="tb-v"><i class="lg sn"></i>nut side <i class="lg sp"></i>bridge side <i class="lg in"></i>inflection</span></div>
      <div class="tb-row"><span class="tb-k">GRID</span><span class="tb-v">${minor} mm · ${major} mm</span></div>`;
    if (hoverN) setHover(hoverN);
  }

  function setHover(n, e) {
    if (hoverN && draw.fretEls?.get(hoverN)) draw.fretEls.get(hoverN).classList.remove('hover');
    hoverN = n;
    if (!n) { tip.classList.remove('show'); onHover?.(null); return; }
    const p = draw.fretEls?.get(n); if (p) p.classList.add('hover');
    const f = design.frets[n - 1]; if (!f) return;
    const frac = 1 - Math.pow(2, -n / 12);
    const s0 = design.strings[0], sN = design.strings[design.strings.length - 1];
    const prevFrac = 1 - Math.pow(2, -(n - 1) / 12);
    tip.innerHTML = `<div class="tip-h"><span>FRET</span><b>${n}</b></div>
      <div class="tip-g">
        <span>Sagitta</span><b>${fmtLen(f.sagitta, units)}</b>
        <span>Min radius</span><b>${fmtRadius(f.minRadius, units)}</b>
        <span>Inflections</span><b>${f.inflections ?? 0}</b>
        <span>Bows toward</span><b>${f.sagitta < 0.02 ? 'straight' : (f.signedSagitta ?? 0) > 0 ? 'bridge' : 'nut'}</b>
        <span>From nut · T</span><b>${fmtLen(s0.scale * frac, units)}</b>
        ${design.strings.length > 1 ? `<span>From nut · B</span><b>${fmtLen(sN.scale * frac, units)}</b>` : ''}
        <span>Spacing · T</span><b>${fmtLen(s0.scale * (frac - prevFrac), units)}</b>
      </div>`;
    tip.classList.add('show');
    if (e) placeTip(e);
    onHover?.(n);
  }
  function placeTip(e) {
    const r = container.getBoundingClientRect();
    let x = e.clientX - r.left + 16, y = e.clientY - r.top + 16;
    const tw = tip.offsetWidth || 200, th = tip.offsetHeight || 120;
    if (x + tw > r.width - insets.right - 8) x = e.clientX - r.left - tw - 16;
    if (y + th > r.height - insets.bottom - 8) y = e.clientY - r.top - th - 16;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }

  svg.addEventListener('pointermove', e => {
    if (drag || !design) return;
    const m = svg.getScreenCTM(); if (!m) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()); // X = design y, Y = design x
    let best = null, bd = Infinity;
    for (const f of design.frets) {
      const c = f.curve;
      for (let i = 0; i < c.length; i += 1) { const dx = c[i].y - pt.x, dy = c[i].x - pt.y, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = f.n; } }
    }
    const lim = 14 * (draw.k || 1);
    if (best && Math.sqrt(bd) < Math.max(lim, 2)) { if (best !== hoverN) setHover(best, e); else placeTip(e); }
    else if (hoverN) setHover(null);
  });
  svg.addEventListener('pointerleave', () => { if (hoverN) setHover(null); });
  // zoom & pan
  let drag = null;
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const vb = viewBox(), r = svg.getBoundingClientRect();
    const mx = vb.x + (e.clientX - r.left) / vb.s, my = vb.y + (e.clientY - r.top) / vb.s;
    const z1 = Math.min(40, Math.max(0.4, zoom * Math.exp(-e.deltaY * 0.0015)));
    const f = zoom / z1;
    // keep the point under the cursor fixed
    const cx = (fit.x0 + fit.x1) / 2 + pan.x, cy = (fit.y0 + fit.y1) / 2 + pan.y;
    pan.x += (mx - cx) * (1 - f); pan.y += (my - cy) * (1 - f);
    zoom = z1; draw();
  }, { passive: false });
  svg.addEventListener('pointerdown', e => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; svg.setPointerCapture(e.pointerId); svg.classList.add('dragging'); });
  svg.addEventListener('pointermove', e => { if (!drag) return; const s = viewBox().s; pan.x = drag.px - (e.clientX - drag.x) / s; pan.y = drag.py - (e.clientY - drag.y) / s; draw(); });
  svg.addEventListener('pointerup', () => { drag = null; svg.classList.remove('dragging'); });
  svg.addEventListener('dblclick', () => { zoom = 1; pan = { x: 0, y: 0 }; draw(); });
  new ResizeObserver(() => draw()).observe(container);

  return {
    update(d, u, { refit = false } = {}) { const nChanged = !design || design.strings.length !== d.strings.length; design = d; units = u; if (refit || nChanged || !fit) { fit = computeFit(); } else { const nf = computeFit(); fit = nf; } draw(); },
    setInsets(i) { insets = { ...insets, ...i }; container.style.setProperty('--bp-right', insets.right + 'px'); container.style.setProperty('--bp-bottom', insets.bottom + 'px'); container.style.setProperty('--bp-top', insets.top + 'px'); draw(); },
    resetView() { zoom = 1; pan = { x: 0, y: 0 }; draw(); },
    redraw: draw,
  };
}

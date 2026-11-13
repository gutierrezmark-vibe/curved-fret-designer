// profile.js — live "scale profile" chart: scale length vs string index.
import { toDisp } from './units.js';

const NS = 'http://www.w3.org/2000/svg';
let VW = 320; const VH = 150, PL = 40, PR = 12, PT = 16, PB = 24;

function catmull(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}
function resampleArr(a, n) {
  if (a.length === n) return a.slice();
  if (a.length === 1) return Array(n).fill(a[0]);
  return Array.from({ length: n }, (_, i) => { const f = n === 1 ? 0 : i / (n - 1) * (a.length - 1), k = Math.min(a.length - 2, Math.floor(f)), t = f - k; return a[k] + (a[k + 1] - a[k]) * t; });
}
export function inflectionsOf(L) {
  const out = [];
  let prev = 0;
  for (let i = 1; i < L.length - 1; i++) {
    const d2 = L[i + 1] - 2 * L[i] + L[i - 1];
    const s = Math.abs(d2) < 1e-6 ? 0 : Math.sign(d2);
    if (s && prev && s !== prev) out.push(i - 0.5);
    if (s) prev = s;
  }
  return out;
}

export function createProfileChart(host) {
  host.innerHTML = `<svg viewBox="0 0 ${VW} ${VH}" class="profile-svg" preserveAspectRatio="none" aria-label="Scale length by string">
    <defs>
      <linearGradient id="pfArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0.32"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient>
      <linearGradient id="pfLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--nickel)"/><stop offset="0.5" stop-color="var(--accent)"/><stop offset="1" stop-color="#c9b8ff"/></linearGradient>
      <filter id="pfGlow" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="3.2"/></filter>
    </defs>
    <g class="pf-grid"></g>
    <path class="pf-area" fill="url(#pfArea)"/>
    <path class="pf-glow" stroke="url(#pfLine)" filter="url(#pfGlow)"/>
    <path class="pf-line" stroke="url(#pfLine)"/>
    <g class="pf-pivot"><line/><text>PIVOT</text></g>
    <g class="pf-infl"></g>
    <g class="pf-dots"></g>
    <g class="pf-labels"></g>
  </svg>`;
  const svg = host.firstElementChild;
  const q = s => svg.querySelector(s);
  const grid = q('.pf-grid'), area = q('.pf-area'), glow = q('.pf-glow'), line = q('.pf-line'), pivotG = q('.pf-pivot'), infl = q('.pf-infl'), dots = q('.pf-dots'), labels = q('.pf-labels');

  let shown = null, shownS = null, targetS = null, target = null, anim = null, opts = {}, range = null;

  function render(vals, samp) {
    const w = Math.round(host.clientWidth || 320);
    if (w > 100 && w !== VW) { VW = w; svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`); if (target) axes(); }
    const N = vals.length;
    const [lo, hi] = range;
    const X = i => PL + (N === 1 ? 0.5 : i / (N - 1)) * (VW - PL - PR);
    const Y = v => PT + (1 - (v - lo) / (hi - lo)) * (VH - PT - PB);
    const pts = vals.map((v, i) => [X(i), Y(v)]);
    const d = N === 1 ? `M${PL},${pts[0][1]}L${VW - PR},${pts[0][1]}`
      : samp && samp.length > 2 ? samp.map((v, k) => `${k ? 'L' : 'M'}${X(k / (samp.length - 1) * (N - 1)).toFixed(2)},${Y(v).toFixed(2)}`).join('') : catmull(pts);
    line.setAttribute('d', d); glow.setAttribute('d', d);
    area.setAttribute('d', d + `L${N === 1 ? VW - PR : pts[N - 1][0]},${VH - PB}L${N === 1 ? PL : pts[0][0]},${VH - PB}Z`);
    // dots
    if (dots.childElementCount !== N) {
      dots.innerHTML = '';
      for (let i = 0; i < N; i++) { const c = document.createElementNS(NS, 'circle'); c.setAttribute('r', N > 16 ? 1.6 : 2.4); dots.appendChild(c); }
    }
    [...dots.children].forEach((c, i) => { c.setAttribute('cx', pts[i][0]); c.setAttribute('cy', pts[i][1]); });
    // pivot
    const pv = opts.pivot;
    if (pv != null && N > 1 && ['divergent', 'convergent', 's-curve'].includes(opts.mode)) {
      const px = X(Math.min(N - 1, Math.max(0, pv)));
      pivotG.style.opacity = 1;
      const l = pivotG.querySelector('line'); l.setAttribute('x1', px); l.setAttribute('x2', px); l.setAttribute('y1', PT - 6); l.setAttribute('y2', VH - PB);
      const t = pivotG.querySelector('text'); t.setAttribute('x', px + 4); t.setAttribute('y', PT - 2);
    } else pivotG.style.opacity = 0;
    // inflections
    const inf = N > 2 ? (samp && samp.length > 4 ? inflectionsOf(samp).map(f => f / (samp.length - 1) * (N - 1)) : inflectionsOf(vals)) : [];
    infl.innerHTML = inf.map(f => { const k = Math.min(N - 2, Math.floor(f)), t = f - k, v = samp && samp.length > 4 ? samp[Math.round(f / (N - 1) * (samp.length - 1))] : vals[k] + (vals[k + 1] - vals[k]) * t; return `<circle cx="${X(f)}" cy="${Y(v)}" r="5.5"/><circle cx="${X(f)}" cy="${Y(v)}" r="9" class="halo"/>`; }).join('');
  }
  function axes() {
    const [lo, hi] = range, u = opts.units || 'in';
    grid.innerHTML = '';
    let html = '';
    for (let k = 0; k <= 3; k++) {
      const y = PT + k / 3 * (VH - PT - PB), v = hi - k / 3 * (hi - lo);
      html += `<line x1="${PL}" x2="${VW - PR}" y1="${y}" y2="${y}"/><text x="${PL - 6}" y="${y + 3}" text-anchor="end">${toDisp(v, u).toFixed(u === 'in' ? 2 : 0)}</text>`;
    }
    grid.innerHTML = html;
    const N = target.length;
    labels.innerHTML = N === 1 ? `<text x="${(PL + VW - PR) / 2}" y="${VH - 6}" text-anchor="middle">SINGLE STRING</text>`
      : `<text x="${PL}" y="${VH - 6}">T · 1</text><text x="${VW - PR}" y="${VH - 6}" text-anchor="end">${N} · B</text><text x="${(PL + VW - PR) / 2}" y="${VH - 6}" text-anchor="middle" class="u">${u === 'in' ? 'INCHES' : 'MM'}</text>`;
  }
  function tick(now) {
    const k = Math.min(1, (now - anim.t0) / anim.dur), e = 1 - Math.pow(1 - k, 3);
    const v = anim.from.map((a, i) => a + (anim.to[i] - a) * e);
    const sv = anim.toS ? anim.fromS.map((a, i) => a + (anim.toS[i] - a) * e) : null;
    range = [anim.r0[0] + (anim.r1[0] - anim.r0[0]) * e, anim.r0[1] + (anim.r1[1] - anim.r0[1]) * e];
    render(v, sv); shown = v; shownS = sv;
    if (k < 1) requestAnimationFrame(tick); else { anim = null; axes(); }
  }
  new ResizeObserver(() => { if (shown && !anim) render(shown, shownS); }).observe(host);
  return {
    update(scales, o = {}) {
      opts = o;
      target = scales.slice();
      targetS = o.samples ? o.samples.slice() : null;
      let lo = Math.min(...target), hi = Math.max(...target);
      const pad = Math.max((hi - lo) * 0.12, 6); lo -= pad; hi += pad;
      const r1 = [lo, hi];
      if (targetS) { lo = Math.min(lo, Math.min(...targetS) - pad * 0.2); hi = Math.max(hi, Math.max(...targetS) + pad * 0.2); r1[0] = lo; r1[1] = hi; }
      if (!shown) { shown = target.slice(); shownS = targetS; range = r1; axes(); render(shown, shownS); return; }
      const from = resampleArr(shown, target.length);
      const fromS = targetS ? resampleArr(shownS || resampleArr(shown, targetS.length), targetS.length) : null;
      const r0 = range || r1;
      const running = !!anim;
      anim = { t0: performance.now(), dur: 420, from, to: target, fromS, toS: targetS, r0, r1 };
      axes();
      range = r1; axes(); range = r0;
      if (!running) requestAnimationFrame(tick);
    },
  };
}

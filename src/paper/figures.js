// figures.js — live SVG figures for the white paper. Every number and line is
// computed by the same geometry engine that drives the designer.
import * as G from '../geometry.js';

const IN = 25.4;
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
const f2 = v => v.toFixed(2);
const pts = arr => arr.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
const pathOf = arr => arr.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------ designs ------
// Shared "musical" layout used by the comparison figures.
const LAYOUT8 = { units: 'in', numFrets: 24, perpRatio: 0.5, nutSpacing: 2.25 / 7 * IN, bridgeSpacing: 2.625 / 7 * IN, edgeMargin: 0.09375 * IN };
export const DESIGNS = {
  fan8: { label: '8-string linear fan', params: { ...LAYOUT8, numStrings: 8, mode: 'fan', trebleScale: 25.5 * IN, bassScale: 28.5 * IN } },
  acc8: { label: '8-string accelerating exponential (g = 1.3)', params: { ...LAYOUT8, numStrings: 8, mode: 'exponential', direction: 'toBass', fitToEnds: true, trebleScale: 25.5 * IN, bassScale: 28.5 * IN, scalar: 5, growth: 1.3 } },
  dec8: { label: '8-string decelerating exponential (g = 0.9)', params: { ...LAYOUT8, numStrings: 8, mode: 'exponential', direction: 'toBass', fitToEnds: true, trebleScale: 25.5 * IN, bassScale: 28.5 * IN, scalar: 5, growth: 0.9 } },
  div9: { label: '9-string divergent D-scale', preset: 'd-scale-9' },
  con9: { label: '9-string convergent C-scale (g = 1.32)', params: { units: 'in', numStrings: 9, numFrets: 24, mode: 'convergent', fitToEnds: true, pivot: 4, trebleScale: 647.7, bassScale: 762, trebleHalf: { scalar: 9, growth: 1.32 }, bassHalf: { scalar: 9, growth: 1.32 }, perpRatio: 0.5, nutSpacing: 2.5 / 8 * IN, bridgeSpacing: 3.25 / 8 * IN, edgeMargin: 0.09375 * IN } },
  s8: { label: '8-string S-curve', preset: 's-curve-8' },
  s12: { label: '12-string S-curve', preset: 's-curve-12' },
};
export function designParams(id) {
  const d = DESIGNS[id];
  if (!d) return null;
  if (d.preset && G.PRESETS?.[d.preset]) return JSON.parse(JSON.stringify(G.PRESETS[d.preset].params));
  return JSON.parse(JSON.stringify(d.params));
}
const cache = new Map();
export function design(id, over) {
  const key = id + (over ? JSON.stringify(over) : '');
  if (!cache.has(key)) cache.set(key, G.computeDesign({ ...designParams(id), ...(over || {}) }));
  return cache.get(key);
}

// ------------------------------------------------------------ fret map -----
// Top view, nut on the left, treble at the top (the same orientation as the
// SVG/DXF export). Optional exaggeration multiplies each line's departure from
// its own chord, so a 2 mm bow can be read at article width.
function exCurveFn(curve, k) {
  const a = curve[0], b = curve[curve.length - 1], dx = (b.x - a.x) || 1e-9;
  const yc = x => a.y + (x - a.x) / dx * (b.y - a.y);
  return p => (k === 1 ? p : { x: p.x, y: yc(p.x) + k * (p.y - yc(p.x)) });
}

export function fretMap(d, { k = 1, width = 880, perpLine = true, infl = false, pivot = false, sideTint = false, labels = true, title = '' } = {}) {
  const p = d.params, N = d.strings.length;
  const T = c => exCurveFn(c, k);
  const tNut = T(d.nut.curve), tBr = T(d.bridge.curve), tEnd = T(d.boardEnd.curve);
  const nut = d.nut.curve.map(tNut), end = d.boardEnd.curve.map(tEnd), br = d.bridge.curve.map(tBr);
  const frets = d.frets.map(f => { const t = T(f.curve); return { f, t, curve: f.curve.map(t) }; });
  const all = [...nut, ...end, ...br];
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const q of all) { xmin = Math.min(xmin, q.x); xmax = Math.max(xmax, q.x); ymin = Math.min(ymin, q.y); ymax = Math.max(ymax, q.y); }
  const padL = 14, padR = 14, padT = 12, padB = labels ? 26 : 12;
  const sc = (width - padL - padR) / (ymax - ymin);
  const H = Math.ceil((xmax - xmin) * sc + padT + padB);
  const X = q => padL + (q.y - ymin) * sc, Y = q => padT + (q.x - xmin) * sc;
  const P = q => [X(q), Y(q)];
  let s = '';
  // board
  s += `<path class="fm-board" d="${pathOf([...nut, ...end.slice().reverse()].map(P))}Z"/>`;
  // strings
  d.strings.forEach((st, i) => {
    const a = tNut(d.nut.crossings[i]), b = tBr(d.bridge.crossings[i]);
    s += `<line class="fm-str${st.wound ? ' w' : ''}" x1="${X(a).toFixed(1)}" y1="${Y(a).toFixed(1)}" x2="${X(b).toFixed(1)}" y2="${Y(b).toFixed(1)}"/>`;
  });
  // perpendicular line (y = 0), clipped to the board edges
  const pr = p.perpRatio;
  if (perpLine && pr > 0 && pr < 1 && d.edges) {
    const e = (E) => ({ x: E[0].x + pr * (E[1].x - E[0].x), y: 0 });
    const a = e(d.edges.treble), b = e(d.edges.bass);
    s += `<line class="fm-perp" x1="${X(a).toFixed(1)}" y1="${(Y(a) - 6).toFixed(1)}" x2="${X(b).toFixed(1)}" y2="${(Y(b) + 6).toFixed(1)}"/>`;
  }
  // pivot (virtual string at the pivot)
  if (pivot && d.profile && Number.isFinite(d.profile.pivot)) {
    const sP = d.profile.pivot, c = (N - 1) / 2, L = d.profile.at(sP);
    const x0 = (sP - c) * p.nutSpacing, x1 = (sP - c) * p.bridgeSpacing, dy = Math.sqrt(Math.max(L * L - (x1 - x0) ** 2, 1));
    const a = tNut({ x: x0, y: -pr * dy }), b = tBr({ x: x1, y: (1 - pr) * dy });
    s += `<line class="fm-pivot" x1="${X(a).toFixed(1)}" y1="${Y(a).toFixed(1)}" x2="${X(b).toFixed(1)}" y2="${Y(b).toFixed(1)}"/>`;
  }
  // frets
  const perpN = d.metrics.perpFret;
  for (const { f, curve } of frets) {
    const isPerp = Math.abs(f.n - perpN) < 0.02;
    const side = sideTint ? (f.t < pr - 1e-9 ? ' nutside' : f.t > pr + 1e-9 ? ' brside' : '') : '';
    s += `<polyline class="fm-fret${isPerp ? ' perp' : ''}${f.n === 12 ? ' oct' : ''}${side}" points="${pts(curve.map(P))}"/>`;
  }
  // nut + bridge
  s += `<polyline class="fm-nut" points="${pts(nut.map(P))}"/>`;
  s += `<polyline class="fm-bridge" points="${pts(br.map(P))}"/>`;
  d.strings.forEach((_, i) => { const q = tBr(d.bridge.crossings[i]); s += `<circle class="fm-saddle" cx="${X(q).toFixed(1)}" cy="${Y(q).toFixed(1)}" r="1.9"/>`; });
  // inflection points
  if (infl) for (const { f, t } of frets) for (const ip of f.inflectionPoints || []) {
    const q = t(ip);
    s += `<circle class="fm-infl-halo" cx="${X(q).toFixed(1)}" cy="${Y(q).toFixed(1)}" r="4.6"/><circle class="fm-infl" cx="${X(q).toFixed(1)}" cy="${Y(q).toFixed(1)}" r="1.9"/>`;
  }
  // fret numbers under the bass edge
  if (labels) {
    const show = new Set([1, 3, 5, 7, 9, 12, 15, 17, 19, 21, 24]);
    for (const { f, curve } of frets) if (show.has(f.n)) {
      const q = curve[curve.length - 1];
      s += `<text class="fm-num${f.n === 12 ? ' oct' : ''}" x="${X(q).toFixed(1)}" y="${(Y(q) + 15).toFixed(1)}" text-anchor="middle">${f.n}</text>`;
    }
    const q = nut[nut.length - 1];
    s += `<text class="fm-num" x="${X(q).toFixed(1)}" y="${(Y(q) + 15).toFixed(1)}" text-anchor="middle">nut</text>`;
  }
  return `<svg class="fig-svg fm" viewBox="0 0 ${width} ${H}" role="img" aria-label="${esc(title || 'Top view of the fretboard')}">${s}</svg>`;
}

// ------------------------------------------------------------ axes ---------
function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n + 0.5) || 10 * mag;
  const out = []; for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
function frame({ W, H, m, xs, ys, xt, yt, xlab, ylab, xfmt = String, yfmt = String }) {
  let s = '';
  for (const v of yt) s += `<line class="ax-grid" x1="${m.l}" x2="${W - m.r}" y1="${ys(v).toFixed(1)}" y2="${ys(v).toFixed(1)}"/><text class="ax-t" x="${m.l - 7}" y="${(ys(v) + 3).toFixed(1)}" text-anchor="end">${yfmt(v)}</text>`;
  for (const v of xt) s += `<text class="ax-t" x="${xs(v).toFixed(1)}" y="${H - m.b + 15}" text-anchor="middle">${xfmt(v)}</text>`;
  s += `<line class="ax-base" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
  if (xlab) s += `<text class="ax-l" x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle">${xlab}</text>`;
  if (ylab) s += `<text class="ax-l" x="${m.l}" y="${m.t - 10}" text-anchor="start">${ylab}</text>`;
  return s;
}

// ------------------------------------------------------------ profile ------
/** Small scale-profile chart: L(s) with string dots, the straight-fan chord and the pivot. */
export function profileChart(d, { W = 300, H = 170, title = '' } = {}) {
  const sm = d.profile.samples, N = d.strings.length, sc = d.strings.map(s => s.scale);
  const m = { l: 40, r: 10, t: 22, b: 26 };
  const lo = Math.min(...sc), hi = Math.max(...sc), padY = (hi - lo) * 0.08 || 5;
  const xs = s => m.l + (s / Math.max(1, N - 1)) * (W - m.l - m.r);
  const ys = L => H - m.b - ((L - (lo - padY)) / ((hi + padY) - (lo - padY))) * (H - m.t - m.b);
  const yt = niceTicks((lo - padY) / IN, (hi + padY) / IN, 3).map(v => v * IN);
  const xt = Array.from({ length: N }, (_, i) => i).filter(i => N <= 9 || i % 2 === 0 || i === N - 1);
  let s = frame({ W, H, m, xs, ys, xt, yt, ylab: 'scale, in', xfmt: i => i + 1, yfmt: v => (v / IN).toFixed(1) });
  s += `<line class="pc-chord" x1="${xs(0)}" y1="${ys(sc[0]).toFixed(1)}" x2="${xs(N - 1)}" y2="${ys(sc[N - 1]).toFixed(1)}"/>`;
  if (['divergent', 'convergent', 's-curve'].includes(d.params.mode)) {
    const xp = xs(d.profile.pivot);
    s += `<line class="pc-pivot" x1="${xp.toFixed(1)}" x2="${xp.toFixed(1)}" y1="${m.t - 4}" y2="${H - m.b}"/><text class="pc-pivot-t" x="${(xp + 4).toFixed(1)}" y="${m.t + 4}">PIVOT</text>`;
  }
  s += `<path class="pc-glow" d="${pathOf(sm.map(q => [xs(q.s), ys(q.L)]))}"/><path class="pc-line" d="${pathOf(sm.map(q => [xs(q.s), ys(q.L)]))}"/>`;
  sc.forEach((L, i) => { s += `<circle class="pc-dot" cx="${xs(i).toFixed(1)}" cy="${ys(L).toFixed(1)}" r="2.6"/>`; });
  return `<svg class="fig-svg pc" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${s}</svg>`;
}

// ------------------------------------------------------------ figure 2 -----
/** Departure from a straight fan, L(s) − chord(s), for several growths with the same ends. */
export function growthFamily({ W = 880, H = 300 } = {}) {
  const gs = [0.8, 0.9, 1, 1.15, 1.3];
  const base = designParams('acc8');
  const series = gs.map(g => {
    const d = G.computeDesign({ ...base, growth: g, numFrets: 1 });
    const N = d.strings.length, L0 = d.strings[0].scale, L1 = d.strings[N - 1].scale;
    const chord = s => L0 + (L1 - L0) * s / (N - 1);
    return { g, N, samples: d.profile.samples.map(q => [q.s, q.L - chord(q.s)]), dots: d.strings.map((st, i) => [i, st.scale - chord(i)]), steps: d.strings.slice(1).map((st, i) => st.scale - d.strings[i].scale) };
  });
  const N = series[0].N;
  const all = series.flatMap(S => S.samples.map(q => q[1]));
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.1;
  const m = { l: 46, r: 92, t: 26, b: 34 };
  const xs = s => m.l + s / (N - 1) * (W - m.l - m.r);
  const ys = v => H - m.b - (v - (lo - pad)) / ((hi + pad) - (lo - pad)) * (H - m.t - m.b);
  let s = frame({ W, H, m, xs, ys, xt: Array.from({ length: N }, (_, i) => i), yt: niceTicks(lo - pad, hi + pad, 5), xlab: 'string (1 = treble)', ylab: 'departure from a straight fan, mm', xfmt: i => i + 1, yfmt: v => (v > 0 ? '+' : '') + v.toFixed(0) });
  s += `<line class="ax-zero" x1="${m.l}" x2="${W - m.r}" y1="${ys(0).toFixed(1)}" y2="${ys(0).toFixed(1)}"/>`;
  const cls = g => g === 1 ? 'gf-fan' : g > 1 ? (g > 1.2 ? 'gf-acc' : 'gf-acc2') : (g < 0.85 ? 'gf-dec' : 'gf-dec2');
  const labels = [];
  for (const S of series) {
    s += `<path class="gf-line ${cls(S.g)}" d="${pathOf(S.samples.map(q => [xs(q[0]), ys(q[1])]))}"/>`;
    S.dots.forEach(q => { s += `<circle class="gf-dot ${cls(S.g)}" cx="${xs(q[0]).toFixed(1)}" cy="${ys(q[1]).toFixed(1)}" r="2.4"/>`; });
    // label at the string where this curve is furthest from the fan
    const peak = S.dots.reduce((a, b) => Math.abs(b[1]) > Math.abs(a[1]) ? b : a, S.dots[0]);
    labels.push({ g: S.g, y: ys(S.g === 1 ? 0 : peak[1]), cls: cls(S.g) });
  }
  // stack labels on the right, nudged apart
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
  for (const L of labels) s += `<text class="gf-lab ${L.cls}" x="${W - m.r + 12}" y="${(L.y + 4).toFixed(1)}">g = ${L.g}</text>`;
  const stepsTable = series.map(S => ({ g: S.g, first: S.steps[0], last: S.steps[S.steps.length - 1] }));
  return { svg: `<svg class="fig-svg gf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Departure from a straight fan for growth 0.8 to 1.3">${s}</svg>`, steps: stepsTable };
}

// ------------------------------------------------------------ figure 3 -----
/** k_n = 1 − p − 2^(−n/12) for the nut (n = 0), frets 1..24 and the bridge. */
export function kBars(p, { W = 880, H = 150, frets = 24 } = {}) {
  const items = [{ n: 0, lab: 'nut', k: -p }];
  for (let n = 1; n <= frets; n++) items.push({ n, lab: String(n), k: 1 - p - Math.pow(2, -n / 12) });
  items.push({ n: Infinity, lab: 'br', k: 1 - p });
  const m = { l: 40, r: 10, t: 14, b: 22 };
  const bw = (W - m.l - m.r) / items.length;
  const ys = k => m.t + (1 - (k + 1) / 2) * (H - m.t - m.b);
  let s = '';
  for (const v of [-1, -0.5, 0, 0.5, 1]) s += `<line class="${v === 0 ? 'ax-zero' : 'ax-grid'}" x1="${m.l}" x2="${W - m.r}" y1="${ys(v).toFixed(1)}" y2="${ys(v).toFixed(1)}"/><text class="ax-t" x="${m.l - 7}" y="${(ys(v) + 3).toFixed(1)}" text-anchor="end">${v > 0 ? '+' : ''}${v}</text>`;
  items.forEach((it, i) => {
    const x = m.l + i * bw + bw * 0.18, w = bw * 0.64, y0 = ys(0), y1 = ys(it.k);
    const cls = Math.abs(it.k) < 0.012 ? 'kb-zero' : it.k < 0 ? 'kb-neg' : 'kb-pos';
    s += `<rect class="kb ${cls}" x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1.2, Math.abs(y1 - y0)).toFixed(1)}" rx="1"/>`;
    if (i === 0 || i === items.length - 1 || it.n % 3 === 0 || it.n === 1) s += `<text class="ax-t" x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${it.lab}</text>`;
  });
  return `<svg class="fig-svg kbars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Scale factor k for the nut, each fret and the bridge">${s}</svg>`;
}

// ------------------------------------------------------------ figure 6 -----
const IN3 = 3 * IN;
const SWEEP_BASE = N => ({ units: 'in', numStrings: N, numFrets: 1, trebleScale: 25.5 * IN, nutSpacing: 7.3, bridgeSpacing: 9.5, perpRatio: 0.5, fitToEnds: true });
export const SWEEP = [
  { id: 'exp130', label: 'Exponential, g 1.30, +3″', cls: 'sw-a', params: N => ({ ...SWEEP_BASE(N), mode: 'exponential', direction: 'toBass', growth: 1.3, bassScale: 25.5 * IN + IN3 }) },
  { id: 'exp115', label: 'Exponential, g 1.15, +3″', cls: 'sw-b', params: N => ({ ...SWEEP_BASE(N), mode: 'exponential', direction: 'toBass', growth: 1.15, bassScale: 25.5 * IN + IN3 }) },
  { id: 'exp090', label: 'Exponential, g 0.90, +3″', cls: 'sw-c', params: N => ({ ...SWEEP_BASE(N), mode: 'exponential', direction: 'toBass', growth: 0.9, bassScale: 25.5 * IN + IN3 }) },
  { id: 'c132', label: 'C-scale, g 1.32, +4.5″', cls: 'sw-d', params: N => ({ ...SWEEP_BASE(N), mode: 'convergent', pivot: (N - 1) / 2, trebleHalf: { scalar: 9, growth: 1.32 }, bassHalf: { scalar: 9, growth: 1.32 }, bassScale: 30 * IN }) },
  { id: 's080', label: 'S-curve, g 0.80 per half, +3″', cls: 'sw-e', params: N => ({ ...SWEEP_BASE(N), mode: 's-curve', pivot: (N - 1) / 2, trebleHalf: { scalar: 10, growth: 0.8 }, bassHalf: { scalar: 10, growth: 0.8 }, bassScale: 25.5 * IN + IN3 }) },
];
let sweepCache = null;
/** Fret-1 sagitta and tightest radius for each setting and string count. */
export function sweep(counts = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
  if (sweepCache) return sweepCache;
  const rows = SWEEP.map(S => ({ ...S, pts: counts.map(N => { const d = G.computeDesign(S.params(N)); return { N, sag: d.frets[0].sagitta, r: d.frets[0].minRadius }; }) }));
  sweepCache = { counts, rows };
  return sweepCache;
}
export function sagittaChart({ W = 880, H = 320 } = {}) {
  const { counts, rows } = sweep();
  const m = { l: 46, r: 178, t: 26, b: 36 };
  const hi = Math.max(...rows.flatMap(r => r.pts.map(p => p.sag))) * 1.08;
  const xs = N => m.l + (N - counts[0]) / (counts[counts.length - 1] - counts[0]) * (W - m.l - m.r);
  const ys = v => H - m.b - v / hi * (H - m.t - m.b);
  let s = frame({ W, H, m, xs, ys, xt: counts, yt: niceTicks(0, hi, 5), xlab: 'number of strings', ylab: 'bow of fret 1 (sagitta), mm' });
  // reference bands
  s += `<rect class="sg-band" x="${m.l}" y="${ys(1).toFixed(1)}" width="${W - m.l - m.r}" height="${(ys(0) - ys(1)).toFixed(1)}"/>`;
  s += `<text class="sg-band-t" x="${m.l + 6}" y="${(ys(1) + 11).toFixed(1)}">under 1 mm: reads as nearly straight</text>`;
  s += `<line class="sg-ref" x1="${m.l}" x2="${W - m.r}" y1="${ys(2.5).toFixed(1)}" y2="${ys(2.5).toFixed(1)}"/><text class="sg-ref-t" x="${W - m.r - 4}" y="${(ys(2.5) - 5).toFixed(1)}" text-anchor="end">≈ one fret-crown width (2.5 mm)</text>`;
  for (const n of [6, 8]) s += `<line class="sg-six" x1="${xs(n).toFixed(1)}" x2="${xs(n).toFixed(1)}" y1="${m.t}" y2="${H - m.b}"/>`;
  const labels = [];
  for (const r of rows) {
    s += `<path class="sg-line ${r.cls}" d="${pathOf(r.pts.map(p => [xs(p.N), ys(p.sag)]))}"/>`;
    r.pts.forEach(p => { s += `<circle class="sg-dot ${r.cls}" cx="${xs(p.N).toFixed(1)}" cy="${ys(p.sag).toFixed(1)}" r="2.3"><title>${esc(r.label)} · ${p.N} strings · ${f2(p.sag)} mm</title></circle>`; });
    const lp = r.pts[r.pts.length - 1];
    labels.push({ y: ys(lp.sag), text: r.label, cls: r.cls });
  }
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
  for (const L of labels) s += `<text class="sg-lab ${L.cls}" x="${W - m.r + 10}" y="${(L.y + 4).toFixed(1)}">${esc(L.text)}</text>`;
  return `<svg class="fig-svg sg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bow of the first fret against string count for five scale settings">${s}</svg>`;
}
export function sagittaTable(counts = [6, 7, 8, 9, 12]) {
  const { rows } = sweep();
  const head = `<tr><th>Setting</th>${counts.map(n => `<th>${n} str</th>`).join('')}<th>Tightest radius</th></tr>`;
  const body = rows.map(r => {
    const cells = counts.map(n => {
      const p = r.pts.find(q => q.N === n), v = p ? p.sag : NaN;
      const cls = v < 1 ? 'faint' : v < 1.6 && /^(c|s)/.test(r.id) ? 'marg' : '';
      return `<td class="${cls}">${f1(v)}</td>`;
    }).join('');
    const rad = r.pts.find(q => q.N === 8)?.r;
    return `<tr><th scope="row"><i class="sw-key ${r.cls}"></i>${esc(r.label)}</th>${cells}<td class="rad">${rad ? rad.toFixed(0) + ' mm' : '—'}</td></tr>`;
  }).join('');
  return `<table class="ptable live"><caption>Bow of fret 1 in mm (sagitta), computed now. Treble 25.5″, nut spacing 7.3 mm, bridge spacing 9.5 mm, perpendicular at the octave, ends fitted.</caption><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

// ------------------------------------------------------------ live facts ---
/** Max |difference| between a C-scale with growth g and an S-curve with 1/g (same ends, pivot 4). */
export function cVersusS(g = 1.32) {
  const c = design('con9');
  const s = G.computeDesign({ ...designParams('con9'), mode: 's-curve', trebleHalf: { scalar: 9, growth: 1 / g }, bassHalf: { scalar: 9, growth: 1 / g } });
  let mx = 0; c.strings.forEach((st, i) => { mx = Math.max(mx, Math.abs(st.scale - s.strings[i].scale)); });
  return mx;
}
export function inflectionSummary(d) {
  const piv = d.profile.pivot;
  const inflecting = d.frets.filter(f => f.inflections > 0);
  let off = 0; for (const f of inflecting) for (const ip of f.inflectionPoints) off = Math.max(off, Math.abs(ip.s - piv));
  return { count: inflecting.length, total: d.frets.length, maxOffset: off, pivot: piv };
}

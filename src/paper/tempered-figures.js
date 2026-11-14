// tempered-figures.js: live figures, tables and facts for the tempered-frets
// paper. Everything is computed by the same engine the designer uses
// (geometry.js + tempered.js), so the paper and the tool cannot disagree.
import * as G from '../geometry.js';
import { TF1 } from '../tempered.js';
import { fretMap } from './figures.js';

const IN = 25.4;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sgn = (v, dp = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(dp);
const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
const PURE = { M3: 1200 * Math.log2(5 / 4), P5: 1200 * Math.log2(3 / 2), m3: 1200 * Math.log2(6 / 5) };

// ------------------------------------------------------------ designs ------
const BASE = () => JSON.parse(JSON.stringify(G.PRESETS['tempered-6'].params));
export const DESIGNS = {
  tt6: { label: 'Tempered 6-string (Thidell Formula 1, compensated)', params: () => BASE() },
  tt6t: { label: 'Tempered 6-string (Formula 1, temperament only)', params: () => ({ ...BASE(), compensate: false }) },
  tt6e: { label: 'Tempered 6-string (equal temperament, compensation only)', params: () => ({ ...BASE(), temperament: 'equal' }) },
  tt6s: { label: 'Tempered 6-string (smooth fret style)', params: () => ({ ...BASE(), fretStyle: 'smooth' }) },
};
export function designParams(id) { const d = DESIGNS[id]; return d ? d.params() : null; }
const cache = new Map();
export function design(id, over) {
  const key = id + (over ? JSON.stringify(over) : '');
  if (!cache.has(key)) cache.set(key, G.computeDesign({ ...designParams(id), ...(over || {}) }));
  return cache.get(key);
}

// ------------------------------------------------------------ intervals ----
/** Size in cents of each key's major third, fifth and minor third under Formula 1. */
export function intervals() {
  const o = TF1.notes;
  return NOTE.map((n, k) => {
    const M3 = 400 + o[(k + 4) % 12] - o[k], P5 = 700 + o[(k + 7) % 12] - o[k], m3 = 300 + o[(k + 3) % 12] - o[k];
    return { key: n, M3, P5, m3, dM3: M3 - PURE.M3, dP5: P5 - PURE.P5, dm3: m3 - PURE.m3 };
  });
}

// ------------------------------------------------------------ facts --------
export function facts() {
  const d = design('tt6'), t = design('tt6t');
  const all = a => a.frets.flatMap(f => f.shifts).map(Math.abs);
  const iv = intervals();
  const guitarKeys = iv.filter(r => ['C', 'D', 'E', 'G', 'A', 'B'].includes(r.key));
  const remote = iv.filter(r => ['C♯', 'E♭', 'G♯', 'B♭'].includes(r.key));
  const L = 25.5 * IN;
  const pe = d.tempered.plainError;
  return {
    etM3: (400 - PURE.M3).toFixed(1), etP5: (PURE.P5 - 700).toFixed(1), etm3: (PURE.m3 - 300).toFixed(1),
    guitarM3lo: Math.min(...guitarKeys.map(r => r.dM3)).toFixed(1), guitarM3hi: Math.max(...guitarKeys.map(r => r.dM3)).toFixed(1),
    remoteM3lo: Math.min(...remote.map(r => r.dM3)).toFixed(1), remoteM3hi: Math.max(...remote.map(r => r.dM3)).toFixed(1),
    p5worst: Math.max(...iv.map(r => Math.abs(r.dP5))).toFixed(1),
    centMm1: (L * Math.pow(2, -1 / 12) * Math.LN2 / 1200).toFixed(3), centMm12: (L / 2 * Math.LN2 / 1200).toFixed(3),
    maxShift: Math.max(...all(d)).toFixed(2), maxShiftT: Math.max(...all(t)).toFixed(2),
    gShift: Math.abs(d.frets[0].shifts[2]).toFixed(2), gShiftT: Math.abs(t.frets[0].shifts[2]).toFixed(2),
    setbacks: d.tempered.setbacks.map(v => v.toFixed(1)).join(', '),
    setMin: Math.min(...d.tempered.setbacks).toFixed(1), setMax: Math.max(...d.tempered.setbacks).toFixed(1),
    err1lo: Math.min(...pe.map(r => r[0])).toFixed(1), err1hi: Math.max(...pe.map(r => r[0])).toFixed(1),
    err22lo: Math.min(...pe.map(r => r[r.length - 1])).toFixed(1), err22hi: Math.max(...pe.map(r => r[r.length - 1])).toFixed(1),
    minR: d.metrics.minRadius.toFixed(1), minRs: design('tt6s').metrics.minRadius.toFixed(1),
  };
}

// ------------------------------------------------------------ tables -------
export function offsetsTable() {
  const o = TF1.notes;
  const open = [[64, 'E4', 1], [59, 'B3', 2], [55, 'G3', 3], [50, 'D3', 4], [45, 'A2', 5], [40, 'E2', 6], [35, 'B1', 7], [30, 'F♯1', 8]];
  return `<caption>Thidell Formula 1 as published by True Temperament, in cents from 12-TET. Top: every chromatic note. Bottom: the open strings (strings 7 and 8 are the 7- and 8-string extensions). These are the only inputs this tool takes from True Temperament.</caption>
<thead><tr><th>Note</th>${NOTE.map(n => `<th>${n}</th>`).join('')}</tr></thead>
<tbody><tr><th scope="row">Offset</th>${o.map(v => `<td>${sgn(v, 0)}</td>`).join('')}</tr></tbody>
<thead><tr><th>Open</th>${open.map(([, n, i]) => `<th>${i}: ${n}</th>`).join('')}<th></th><th></th><th></th><th></th></tr></thead>
<tbody><tr><th scope="row">Offset</th>${open.map(([m]) => `<td>${sgn(TF1.open[m], 0)}</td>`).join('')}<td></td><td></td><td></td><td></td></tr></tbody>`;
}

export function intervalTable() {
  const rows = intervals().map(r => `<tr><th scope="row">${r.key}</th><td>${r.M3.toFixed(0)}</td><td class="${Math.abs(r.dM3) < 400 - PURE.M3 - 1e-9 ? 'good' : 'marg'}">${sgn(r.dM3)}</td><td>${r.P5.toFixed(0)}</td><td>${sgn(r.dP5)}</td><td>${r.m3.toFixed(0)}</td><td class="${Math.abs(r.dm3) < PURE.m3 - 300 - 1e-9 ? 'good' : 'marg'}">${sgn(r.dm3)}</td></tr>`).join('');
  return `<caption>Every key's major third, fifth and minor third under Formula 1, in cents, and the error against the pure ratio (5/4, 3/2, 6/5). Equal temperament is ${sgn(400 - PURE.M3)} on every major third, ${sgn(700 - PURE.P5)} on every fifth and ${sgn(300 - PURE.m3)} on every minor third. Green errors beat equal temperament, amber ones are worse.</caption>
<thead><tr><th>Key</th><th>M3</th><th>err</th><th>P5</th><th>err</th><th>m3</th><th>err</th></tr></thead><tbody>${rows}</tbody>`;
}

/** Fret-by-fret split on one string: temperament shift, compensation shift, total. */
export function splitTable(stringIndex = 2, frets = 12) {
  const d = design('tt6'), t = design('tt6t'), st = d.strings[stringIndex];
  const rows = [];
  for (let n = 1; n <= frets; n++) {
    const tot = d.frets[n - 1].shifts[stringIndex], tmp = t.frets[n - 1].shifts[stringIndex];
    const note = NOTE[(st.midi + n) % 12], c = d.tempered.targets[stringIndex][n - 1] - 100 * n;
    rows.push(`<tr><th scope="row">${n}</th><td class="txt">${note}</td><td>${sgn(c, 0)}</td><td>${sgn(d.tempered.plainError[stringIndex][n - 1])}</td><td>${sgn(tmp, 2)}</td><td>${sgn(tot - tmp, 2)}</td><td><b>${sgn(tot, 2)}</b></td></tr>`);
  }
  return `<caption>String 3 (${st.note}) on the 25.5″ preset. <b>Target</b> is the note's cents relative to the open string. <b>Plain error</b> is how far a straight 12-TET fret plays from 12-TET after a normal saddle setup. The last three columns are the fret's move along the string in mm (− toward the nut): from the temperament, from the compensation, and in total.</caption>
<thead><tr><th>Fret</th><th>Note</th><th>Target ¢</th><th>Plain error ¢</th><th>Temperament mm</th><th>Compensation mm</th><th>Total mm</th></tr></thead><tbody>${rows.join('')}</tbody>`;
}

export function sensitivityTable() {
  const rows = [];
  for (const fd of [0, 0.2, 0.4, 0.8]) for (const act of [[1.4, 1.8], [1.6, 2.0], [2.0, 2.6]]) {
    if (fd !== 0.2 && act[0] !== 1.6) continue;
    const d = design('tt6', { fingerDepth: fd, actionTreble: act[0], actionBass: act[1] });
    const s = d.tempered.setbacks, f1 = d.frets[0].shifts;
    rows.push(`<tr${fd === 0.2 && act[0] === 1.6 ? ' class="hl"' : ''}><th scope="row">${fd.toFixed(1)} mm</th><td>${act[0].toFixed(1)}–${act[1].toFixed(1)}</td><td>${s[0].toFixed(1)}</td><td>${s[2].toFixed(1)}</td><td>${s[5].toFixed(1)}</td><td>${sgn(d.tempered.plainError[5][0])}</td><td>${sgn(f1[5], 2)}</td></tr>`);
  }
  return `<caption>How the compensation responds to the two inputs a builder controls least: finger pressure and action. Setbacks are for strings 1, 3 and 6. The last two columns are for the low E at fret 1: how sharp a plain fret plays, and how far the tempered fret moves to cancel it. The highlighted row is the designer's default.</caption>
<thead><tr><th>Finger depth</th><th>Action mm</th><th>Setback 1</th><th>Setback 3</th><th>Setback 6</th><th>E2 f1 error ¢</th><th>E2 f1 shift mm</th></tr></thead><tbody>${rows.join('')}</tbody>`;
}

// ------------------------------------------------------------ charts -------
function ticks(lo, hi, n = 4) {
  const span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n + 0.5) || 10 * mag;
  const out = []; for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
function axes({ W, H, m, xs, ys, yt, xt, xlab, ylab, xfmt = String, yfmt = String }) {
  let s = '';
  for (const v of yt) s += `<line class="${v === 0 ? 'ax-zero' : 'ax-grid'}" x1="${m.l}" x2="${W - m.r}" y1="${ys(v).toFixed(1)}" y2="${ys(v).toFixed(1)}"/><text class="ax-t" x="${m.l - 7}" y="${(ys(v) + 3).toFixed(1)}" text-anchor="end">${yfmt(v)}</text>`;
  for (const v of xt) s += `<text class="ax-t" x="${xs(v).toFixed(1)}" y="${H - m.b + 15}" text-anchor="middle">${xfmt(v)}</text>`;
  s += `<line class="ax-base" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
  if (xlab) s += `<text class="ax-l" x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle">${xlab}</text>`;
  if (ylab) s += `<text class="ax-l" x="${m.l}" y="${m.t - 10}" text-anchor="start">${ylab}</text>`;
  return s;
}

/** Major-third and fifth error per key: Formula 1 bars against the equal-temperament line. */
export function intervalChart({ W = 880, H = 300 } = {}) {
  const iv = intervals();
  const m = { l: 46, r: 16, t: 26, b: 34 };
  const lo = -8, hi = 24;
  const bw = (W - m.l - m.r) / 12;
  const xs = k => m.l + (k + 0.5) * bw, ys = v => H - m.b - (v - lo) / (hi - lo) * (H - m.t - m.b);
  let s = axes({ W, H, m, xs, ys, yt: ticks(lo, hi, 6), xt: iv.map((_, k) => k), xlab: 'key (root of the interval)', ylab: 'error from pure, cents', xfmt: k => iv[k].key, yfmt: v => (v > 0 ? '+' : '') + v });
  iv.forEach((r, k) => {
    const x = xs(k);
    const bar = (v, dx, cls) => `<rect class="tt-bar ${cls}" x="${(x + dx).toFixed(1)}" y="${Math.min(ys(0), ys(v)).toFixed(1)}" width="${(bw * 0.3).toFixed(1)}" height="${Math.max(1, Math.abs(ys(v) - ys(0))).toFixed(1)}" rx="1.5"/>`;
    s += bar(r.dM3, -bw * 0.32, r.dM3 < 400 - PURE.M3 ? 'm3good' : 'm3bad') + bar(r.dP5, bw * 0.02, 'p5');
  });
  s += `<line class="tt-et" x1="${m.l}" x2="${W - m.r}" y1="${ys(400 - PURE.M3).toFixed(1)}" y2="${ys(400 - PURE.M3).toFixed(1)}"/><text class="tt-et-t" x="${W - m.r - 4}" y="${(ys(400 - PURE.M3) - 6).toFixed(1)}" text-anchor="end">12-TET major third +13.7</text>`;
  s += `<line class="tt-et p5" x1="${m.l}" x2="${W - m.r}" y1="${ys(700 - PURE.P5).toFixed(1)}" y2="${ys(700 - PURE.P5).toFixed(1)}"/>`;
  return `<svg class="fig-svg tt" viewBox="0 0 ${W} ${H}" role="img" aria-label="Major third and fifth error per key under Thidell Formula 1">${s}</svg>`;
}

/** How sharp a plain 12-TET fret plays on each string, fret 1..F, after the saddle is set. */
export function errorChart({ W = 880, H = 300 } = {}) {
  const d = design('tt6'), pe = d.tempered.plainError, F = pe[0].length;
  const m = { l: 46, r: 70, t: 26, b: 34 };
  const all = pe.flat(), lo = Math.min(-1, ...all) - 0.5, hi = Math.max(...all) + 0.5;
  const xs = n => m.l + (n - 1) / (F - 1) * (W - m.l - m.r), ys = v => H - m.b - (v - lo) / (hi - lo) * (H - m.t - m.b);
  let s = axes({ W, H, m, xs, ys, yt: ticks(lo, hi, 5), xt: [1, 3, 5, 7, 9, 12, 15, 17, 19, 22].filter(n => n <= F), xlab: 'fret', ylab: 'plain fret error, cents', yfmt: v => (v > 0 ? '+' : '') + v });
  const cls = ['tt-s1', 'tt-s2', 'tt-s3', 'tt-s4', 'tt-s5', 'tt-s6'];
  const labs = [];
  pe.forEach((row, i) => {
    s += `<path class="tt-line ${cls[i % 6]}" d="${row.map((v, k) => (k ? 'L' : 'M') + xs(k + 1).toFixed(1) + ' ' + ys(v).toFixed(1)).join('')}"/>`;
    labs.push({ y: ys(row[0]), t: `${i + 1} ${d.strings[i].note}`, c: cls[i % 6] });
  });
  labs.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 12) labs[i].y = labs[i - 1].y + 12;
  labs.forEach(l => { s += `<text class="tt-lab ${l.c}" x="${xs(1) + 8}" y="${(l.y - 2).toFixed(1)}">${esc(l.t)}</text>`; });
  return `<svg class="fig-svg tt" viewBox="0 0 ${W} ${H}" role="img" aria-label="Plain fret pitch error per string">${s}</svg>`;
}

// ------------------------------------------------------------ figure renderers
// Each takes (body, fig, { openBtn, seg }) and fills the figure body.
export const RENDER = {
  'tt-map'(body) {
    let id = 'tt6', k = 5;
    const draw = () => {
      body.innerHTML = `<div class="fig-tools"><div class="fig-seg" role="group" aria-label="Which layers">${[['tt6t', 'Temperament only'], ['tt6e', 'Compensation only'], ['tt6', 'Both']].map(([v, l]) => `<button type="button" data-id="${v}" class="${v === id ? 'on' : ''}" aria-pressed="${v === id}">${l}</button>`).join('')}</div><div class="fig-seg" role="group" aria-label="Shift scale">${[[1, 'True scale'], [5, 'Shifts ×5']].map(([v, l]) => `<button type="button" data-k="${v}" class="${v === k ? 'on' : ''}" aria-pressed="${v === k}">${l}</button>`).join('')}</div></div>${fretMap(design(id), { k, title: DESIGNS[id].label })}`;
      body.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => { id = b.dataset.id; draw(); });
      body.querySelectorAll('button[data-k]').forEach(b => b.onclick = () => { k = +b.dataset.k; draw(); });
    };
    draw();
  },
  'tt-intervals'(body) {
    body.innerHTML = intervalChart() + `<div class="fig-legend"><span><i class="lg tt-lg-good"></i>major third, better than 12-TET</span><span><i class="lg tt-lg-bad"></i>major third, worse than 12-TET</span><span><i class="lg tt-lg-p5"></i>fifth</span><span><i class="lg tt-lg-et"></i>12-TET major third</span></div>`;
  },
  'tt-error'(body) { body.innerHTML = errorChart(); },
  'tt-shape'(body) {
    let k = 4;
    const draw = () => {
      const a = design('tt6', { numFrets: 7 }), b = design('tt6s', { numFrets: 7 });
      body.innerHTML = `<div class="fig-tools"><div class="fig-seg" role="group" aria-label="Shift scale">${[[1, 'True scale'], [4, 'Shifts ×4']].map(([v, l]) => `<button type="button" data-k="${v}" class="${v === k ? 'on' : ''}" aria-pressed="${v === k}">${l}</button>`).join('')}</div></div>
        <div class="fm-pair"><div class="fm-lab"><b>Segments</b><span>flat under each string · C2 steps · tightest ${a.metrics.minRadius.toFixed(1)} mm</span></div>${fretMap(a, { k, title: 'Segment-style tempered frets, frets 1 to 7' })}
        <div class="fm-lab"><b>Smooth</b><span>natural cubic spline · tightest ${b.metrics.minRadius.toFixed(1)} mm</span></div>${fretMap(b, { k, title: 'Smooth-style tempered frets, frets 1 to 7' })}</div>`;
      body.querySelectorAll('button[data-k]').forEach(b => b.onclick = () => { k = +b.dataset.k; draw(); });
    };
    draw();
  },
};

/** Fill the data-live tables in a built pane. */
export function fillLive(pane, typeset) {
  const put = (key, html) => { const el = pane.querySelector(`[data-live="${key}"]`); if (el) el.innerHTML = typeset(html); };
  put('tt-offsets', offsetsTable());
  put('tt-ivtable', intervalTable());
  put('tt-split', splitTable());
  put('tt-sens', sensitivityTable());
}

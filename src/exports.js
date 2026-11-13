// exports.js: pure file writers for a Design from geometry.js. No DOM.
// Every function takes a Design (computeDesign output) and returns
//   { data: string | Uint8Array, mime, extension }
// The UI turns that into a Blob and a download.
//
// Drawing frame shared by SVG, DXF and PDF: the board lies horizontally with
// the nut on the LEFT and the treble edge at the TOP, at true 1:1 scale.
//   along  = design y (mm, nut -> bridge)
//   across = design x (mm, treble -> bass)

import { curveSpline, mapSpline, toBeziers, dxfR2000 } from './cad.js';

const IN = 25.4;
const MM2PT = 72 / 25.4;

const f3 = v => (Math.round(v * 1000) / 1000).toString();
const ascii = s => String(s).replace(/[‘’]/g, "'").replace(/[“”″]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7e]/g, '?');

function titleOf(design, opts) {
  if (opts && opts.title) return opts.title;
  const p = design.params, n = p.numStrings, u = p.units;
  const [a, b] = design.metrics.scaleRange;
  const L = v => (u === 'mm' ? `${v.toFixed(1)} mm` : `${(v / IN).toFixed(3)}"`);
  return `${n}-string ${p.mode} ${L(a)}${n > 1 && b - a > 1e-6 ? ' - ' + L(b) : ''}`;
}

/**
 * Smooth CAM curves: each fret, the nut, the bridge line and the board end as ONE
 * cubic B-spline (design coordinates), fitted to the engine's exact curve within
 * `tol` mm. Returns null for a curve the design can't evaluate (then exporters
 * fall back to the dense polyline).
 */
export function smoothCurves(design, tol = 0.001) {
  const fit = c => (c && typeof c.at === 'function' && c.sRange ? curveSpline(c, tol) : null);
  const out = {
    nut: fit(design.nut), bridge: fit(design.bridge), boardEnd: fit(design.boardEnd),
    frets: design.frets.map(f => ({ n: f.n, spline: fit(f) })),
  };
  const all = [out.nut, out.bridge, out.boardEnd, ...out.frets.map(f => f.spline)].filter(Boolean);
  out.maxErr = all.reduce((m, sp) => Math.max(m, sp.maxErr), 0);
  out.ok = all.length === design.frets.length + 3;
  return out;
}

/** All the lines of the top view, in design coordinates. */
function drawingParts(design) {
  const strings = design.strings.map(s => [s.nut, s.bridge]);
  const pts = [...design.outline, ...design.bridge.curve, ...design.strings.flatMap(s => [s.nut, s.bridge])];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of pts) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
  return {
    outline: design.outline,
    nut: design.nut.curve,
    frets: design.frets.map(f => ({ n: f.n, curve: f.curve })),
    bridge: design.bridge.curve,
    strings,
    centre: [{ x: 0, y: minY }, { x: 0, y: maxY }],
    bounds: { minX, maxX, minY, maxY },
  };
}

// ---------------------------------------------------------------------------
// SVG

/** 1:1 SVG top-view template (units: mm). */
export function exportSVG(design, opts = {}) {
  // Coordinates are written in CSS px at 96 px/in (1 mm = 96/25.4 px), and the root
  // width/height are given in mm. Browsers, Inkscape and Illustrator honour the mm size,
  // and CAD importers that ignore units and read px at 96 dpi (Autodesk Fusion) also land
  // at exactly 1:1. Lines are solid: dash arrays turn into hundreds of loose segments in CAD.
  const K = 96 / 25.4;
  const P = drawingParts(design), b = P.bounds, M = 15;
  const W = b.maxY - b.minY + 2 * M, H = b.maxX - b.minX + 2 * M;
  const px = v => f3(v * K);
  const T = q => `${px(q.y - b.minY + M)},${px(q.x - b.minX + M)}`;
  const poly = (pts, attrs) => `<polyline points="${pts.map(T).join(' ')}" ${attrs}/>`;
  // Smooth curves as cubic Bezier <path>s converted exactly from the fitted B-splines.
  const sm = smoothCurves(design, opts.tol ?? 0.001);
  const segsD = sp => toBeziers(sp).map(([, c1, c2, e]) => `C${T(c1)} ${T(c2)} ${T(e)}`).join(' ');
  const pathOf = (sp, pts, attrs) => sp ? `<path d="M${T(sp.ctrl[0])} ${segsD(sp)}" ${attrs}/>` : poly(pts, attrs);
  const reverseSp = sp => sp && ({ ...sp, knots: sp.knots.map(k => 1 - k).reverse(), ctrl: sp.ctrl.slice().reverse() });
  const outlineEl = (sm.nut && sm.boardEnd)
    ? (() => { const nutC = design.nut.curve, endC = design.boardEnd.curve, rev = reverseSp(sm.boardEnd);
        return `<path d="M${T(sm.nut.ctrl[0])} ${segsD(sm.nut)} L${T(endC[endC.length - 1])} ${segsD(rev)} Z"/>`; })()
    : `<polygon points="${P.outline.map(T).join(' ')}"/>`;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const title = titleOf(design, opts);
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f3(W)}mm" height="${f3(H)}mm" viewBox="0 0 ${px(W)} ${px(H)}">`);
  out.push(`<title>${esc(title)}</title>`);
  out.push('<desc>Curved Fret Designer top-view template at 1:1. Size is in mm; user units are px at 96 per inch. Nut on the left, treble edge at the top.</desc>');
  out.push('<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">');
  out.push(`<g id="centreline" stroke="#999" stroke-width="${px(0.15)}">${poly(P.centre, '')}</g>`);
  out.push(`<g id="strings" stroke="#999" stroke-width="${px(0.12)}">${P.strings.map(s => poly(s, '')).join('')}</g>`);
  out.push(`<g id="outline" stroke-width="${px(0.3)}">${outlineEl}</g>`);
  out.push(`<g id="nut" stroke-width="${px(0.5)}">${pathOf(sm.nut, P.nut, '')}</g>`);
  out.push(`<g id="frets" stroke-width="${px(0.25)}">${P.frets.map((fr, i) => pathOf(sm.frets[i].spline, fr.curve, `data-fret="${fr.n}"`)).join('')}</g>`);
  out.push(`<g id="bridge" stroke-width="${px(0.4)}">${pathOf(sm.bridge, P.bridge, '')}</g>`);
  out.push('</g>');
  out.push(`<g id="labels" font-family="Helvetica, Arial, sans-serif" font-size="${px(2.6)}" text-anchor="middle" fill="#000">`);
  for (const fr of P.frets) { const q = fr.curve[0]; out.push(`<text x="${px(q.y - b.minY + M)}" y="${px(q.x - b.minX + M - 2.5)}">${fr.n}</text>`); }
  const n0 = P.nut[0];
  out.push(`<text x="${px(n0.y - b.minY + M)}" y="${px(n0.x - b.minX + M - 2.5)}">NUT</text>`);
  const b0 = P.bridge[0];
  out.push(`<text x="${px(b0.y - b.minY + M)}" y="${px(b0.x - b.minX + M - 2.5)}">BRIDGE</text>`);
  design.strings.forEach(s => out.push(`<text x="${px(s.nut.y - b.minY + M - 4)}" y="${px(s.nut.x - b.minX + M + 0.9)}" text-anchor="end">${s.i + 1}</text>`));
  out.push(`<text x="${px(M)}" y="${px(H - 4)}" text-anchor="start" font-size="${px(3)}">${esc(title)} - 1:1, mm</text>`);
  out.push('</g>');
  out.push('</svg>');
  return { data: out.join('\n'), mime: 'image/svg+xml', extension: 'svg' };
}

// ---------------------------------------------------------------------------
// DXF R2000 (AC1015, mm). X = along the board, Y = up = toward the treble edge.
// Every fret, the nut, the bridge line and the board end is ONE SPLINE entity
// (degree 3, within 0.001 mm of the exact curve), so CAM can trace each slot as a
// single curve. The board outline is a closed chain of four entities: nut spline,
// treble edge LINE, board-end spline, bass edge LINE.

export function exportDXF(design, opts = {}) {
  const P = drawingParts(design), b = P.bounds;
  const tol = opts.tol ?? 0.001;
  const map = q => ({ x: q.y, y: -q.x });
  const sm = smoothCurves(design, tol);
  const E = [];
  const curve = (sp, pts, layer) => {
    if (sp) E.push({ type: 'SPLINE', layer, spline: mapSpline(sp, map) });
    else for (let i = 0; i + 1 < pts.length; i++) E.push({ type: 'LINE', layer, a: map(pts[i]), b: map(pts[i + 1]) });
  };
  // Outline: nut + edges + board end (each edge is straight by construction).
  const nutC = design.nut.curve, endC = design.boardEnd.curve;
  curve(sm.nut, nutC, 'OUTLINE');
  E.push({ type: 'LINE', layer: 'OUTLINE', a: map(nutC[0]), b: map(endC[0]) });
  curve(sm.boardEnd, endC, 'OUTLINE');
  E.push({ type: 'LINE', layer: 'OUTLINE', a: map(nutC[nutC.length - 1]), b: map(endC[endC.length - 1]) });
  curve(sm.nut, nutC, 'NUT');
  design.frets.forEach((f, i) => curve(sm.frets[i].spline, f.curve, 'FRETS'));
  curve(sm.bridge, design.bridge.curve, 'BRIDGE');
  for (const st of P.strings) E.push({ type: 'LINE', layer: 'STRINGS', a: map(st[0]), b: map(st[1]) });
  E.push({ type: 'LINE', layer: 'CENTRE', a: map(P.centre[0]), b: map(P.centre[1]) });
  const text = (q, h, str) => E.push({ type: 'TEXT', layer: 'TEXT', at: map(q), height: h, text: ascii(str) });
  for (const fr of P.frets) { const q = fr.curve[0]; text({ x: q.x - 4, y: q.y - 0.8 }, 2.5, String(fr.n)); }
  text({ x: P.nut[0].x - 4, y: P.nut[0].y - 2 }, 2.5, 'NUT');
  text({ x: b.maxX + 8, y: b.minY }, 3, titleOf(design, opts) + ' - 1:1 mm');
  const data = dxfR2000({
    entities: E,
    extents: { minX: b.minY, minY: -b.maxX, maxX: b.maxY, maxY: -b.minX },
  });
  return { data, mime: 'application/dxf', extension: 'dxf', maxDeviationMm: sm.maxErr, splines: sm.ok };
}

// ---------------------------------------------------------------------------
// CSV

/** Per string: distance from the nut to each fret along the string, plus x/y. */
export function exportCSV(design) {
  const rows = [['string', 'note', 'gauge_in', 'scale_mm', 'scale_in', 'fret', 'from_nut_mm', 'from_nut_in', 'x_mm', 'y_mm', 'x_in', 'y_in']];
  const r4 = v => (Math.round(v * 1e4) / 1e4).toString();
  for (const s of design.strings) {
    const pts = [{ f: 0, t: 0, q: s.nut }, ...design.frets.map(fr => ({ f: fr.n, t: fr.t ?? 1 - Math.pow(2, -fr.n / 12), q: fr.crossings[s.i] })), { f: 'bridge', t: 1, q: s.bridge }];
    for (const { f, t, q } of pts) {
      const d = s.scale * t;
      rows.push([s.i + 1, s.note || '', s.gauge, r4(s.scale), r4(s.scale / IN), f, r4(d), r4(d / IN), r4(q.x), r4(q.y), r4(q.x / IN), r4(q.y / IN)]);
    }
  }
  return { data: rows.map(r => r.join(',')).join('\r\n') + '\r\n', mime: 'text/csv', extension: 'csv' };
}

// ---------------------------------------------------------------------------
// PDF (hand-written, Letter landscape, true 1:1)

const PAGE_W = 279.4, PAGE_H = 215.9, MARGIN = 10, HEADER = 24; // mm

function pdfPage() {
  let c = '';
  const n = v => v.toFixed(2);
  const esc = s => '(' + ascii(s).replace(/[\\()]/g, ch => '\\' + ch) + ')';
  const textW = (s, size) => String(s).length * size * 0.52;
  return {
    get content() { return c; },
    stroke(w, gray = 0) { c += `${n(w)} w ${gray} G [] 0 d\n`; },
    dash(on, off) { c += `[${on} ${off}] 0 d\n`; },
    line(x1, y1, x2, y2) { c += `${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S\n`; },
    poly(pts, close) { pts.forEach((q, i) => { c += `${n(q[0])} ${n(q[1])} ${i ? 'l' : 'm'}\n`; }); c += close ? 'h S\n' : 'S\n'; },
    rect(x, y, w, h) { c += `${n(x)} ${n(y)} ${n(w)} ${n(h)} re S\n`; },
    fillRect(x, y, w, h, gray) { c += `${gray} g ${n(x)} ${n(y)} ${n(w)} ${n(h)} re f 0 g\n`; },
    circle(x, y, r) {
      const k = 0.5523 * r;
      c += `${n(x + r)} ${n(y)} m ${n(x + r)} ${n(y + k)} ${n(x + k)} ${n(y + r)} ${n(x)} ${n(y + r)} c ${n(x - k)} ${n(y + r)} ${n(x - r)} ${n(y + k)} ${n(x - r)} ${n(y)} c ${n(x - r)} ${n(y - k)} ${n(x - k)} ${n(y - r)} ${n(x)} ${n(y - r)} c ${n(x + k)} ${n(y - r)} ${n(x + r)} ${n(y - k)} ${n(x + r)} ${n(y)} c S\n`;
    },
    clip(x, y, w, h) { c += `q ${n(x)} ${n(y)} ${n(w)} ${n(h)} re W n\n`; },
    unclip() { c += 'Q\n'; },
    text(x, y, s, size, o = {}) {
      let tx = x;
      if (o.align === 'center') tx -= textW(s, size) / 2; else if (o.align === 'right') tx -= textW(s, size);
      c += `BT /${o.bold ? 'F2' : 'F1'} ${size} Tf ${o.gray || 0} g 1 0 0 1 ${n(tx)} ${n(y)} Tm ${esc(s)} Tj ET 0 g\n`;
    },
  };
}

function buildPDF(pageWpt, pageHpt, contents, title) {
  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${contents.map((_, i) => (5 + 2 * i) + ' 0 R').join(' ')}] /Count ${contents.length} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  contents.forEach((content, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWpt.toFixed(2)} ${pageHpt.toFixed(2)}] /Contents ${6 + 2 * i} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  objs.push(`<< /Title (${ascii(title).replace(/[\\()]/g, ch => '\\' + ch)}) /Creator (Curved Fret Designer) >>`);
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += String(off).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

/** Scale-check rulers drawn in page points at (x, y) baseline. */
function rulers(pg, x, y) {
  pg.stroke(0.6);
  const mm = 100 * MM2PT;
  pg.line(x, y, x + mm, y);
  for (let k = 0; k <= 100; k++) {
    const h = k % 10 === 0 ? 3.5 : k % 5 === 0 ? 2.5 : 1.4;
    pg.stroke(k % 10 === 0 ? 0.5 : 0.25);
    pg.line(x + k * MM2PT, y, x + k * MM2PT, y + h * MM2PT * 0.6);
  }
  pg.text(x + mm + 4, y, '100 mm', 6.5);
  const y2 = y - 8 * MM2PT;
  pg.stroke(0.6);
  pg.line(x, y2, x + 4 * 72, y2);
  for (let k = 0; k <= 32; k++) {
    const h = k % 8 === 0 ? 3.5 : k % 4 === 0 ? 2.5 : 1.4;
    pg.stroke(k % 8 === 0 ? 0.5 : 0.25);
    pg.line(x + k * 9, y2, x + k * 9, y2 + h * MM2PT * 0.6);
  }
  pg.text(x + 4 * 72 + 4, y2, '4 in   - check both before cutting', 6.5);
}

/**
 * 1:1 tiled template on Letter-landscape pages plus a cover page with the
 * per-string fret table. Pages overlap by 15 mm: trim each later page on its
 * dashed cut line, lay it over its neighbour and match the + marks.
 */
export function exportPDF(design, opts = {}) {
  const P = drawingParts(design), b = P.bounds, p = design.params;
  const title = titleOf(design, opts);
  const units = p.units === 'mm' ? 'mm' : 'in';
  const U = v => (units === 'mm' ? v.toFixed(2) : (v / IN).toFixed(4));
  const PW = PAGE_W * MM2PT, PH = PAGE_H * MM2PT;
  const pages = [];

  // ---- cover + fret table pages
  const strings = design.strings, F = design.frets.length;
  const COLS = 10, ROWS = 32;
  const rowsAll = [{ label: 'nut', t: 0 }, ...design.frets.map(fr => ({ label: String(fr.n), t: fr.t ?? 1 - Math.pow(2, -fr.n / 12) })), { label: 'scale', t: 1 }];
  const colChunks = []; for (let i = 0; i < strings.length; i += COLS) colChunks.push(strings.slice(i, i + COLS));
  const rowChunks = []; for (let i = 0; i < rowsAll.length; i += ROWS) rowChunks.push(rowsAll.slice(i, i + ROWS));
  let first = true;
  for (const rc of rowChunks) for (const cc of colChunks) {
    const pg = pdfPage();
    let y = PH - MARGIN * MM2PT - 14;
    const x0 = MARGIN * MM2PT;
    if (first) {
      pg.text(x0, y, title, 15, { bold: true }); y -= 16;
      const m = design.metrics, s = design.profile && design.profile.solved || {};
      const L = v => (units === 'mm' ? `${v.toFixed(2)} mm` : `${(v / IN).toFixed(4)} in`);
      const lines = [
        `Mode: ${p.mode}   Strings: ${p.numStrings}   Frets: ${p.numFrets}   Perpendicular at ${(p.perpRatio * 100).toFixed(1)}% of each scale (fret ${isFinite(m.perpFret) ? m.perpFret.toFixed(2) : 'bridge'})`,
        `Scales: ${L(m.scaleRange[0])} to ${L(m.scaleRange[1])}   Nut width ${L(design.widths.nut)}   Bridge width ${L(design.widths.bridge)}   Edge margin ${L(p.edgeMargin)}`,
        `Largest fret bow (sagitta) ${m.maxSagitta.toFixed(2)} mm at fret ${m.maxSagittaFret ?? '-'}   Tightest radius ${isFinite(m.minRadius) ? m.minRadius.toFixed(0) + ' mm' : 'straight'}   Frets with an S: ${m.inflectingFrets}`,
      ];
      if (s.scalar != null) lines.push(`Series: scalar ${s.scalar.toFixed(4)} mm, growth ${s.growth.toFixed(4)}`);
      if (s.trebleHalf) lines.push(`Treble half: scalar ${s.trebleHalf.scalar.toFixed(4)} mm, growth ${s.trebleHalf.growth.toFixed(4)}   Bass half: scalar ${s.bassHalf.scalar.toFixed(4)} mm, growth ${s.bassHalf.growth.toFixed(4)}   Pivot ${design.profile.pivot}`);
      for (const w of design.warnings.slice(0, 4)) lines.push(`${w.level.toUpperCase()}: ${w.message}`);
      for (const t of lines) { pg.text(x0, y, t.length > 150 ? t.slice(0, 147) + '...' : t, 8); y -= 11; }
      y -= 6;
      first = false;
    } else { pg.text(x0, y, `${title} - fret table (continued)`, 10, { bold: true }); y -= 16; }
    pg.text(x0, y, `Distance from the nut to each fret, measured along the string (${units}). String 1 = treble.`, 8, { bold: true }); y -= 13;
    const colW = 22 * MM2PT, firstW = 14 * MM2PT, rowH = Math.min(11, (y - MARGIN * MM2PT) / (rc.length + 1));
    pg.text(x0, y, 'fret', 7.5, { bold: true });
    cc.forEach((s, k) => pg.text(x0 + firstW + (k + 1) * colW - 3, y, `str ${s.i + 1}${s.note ? ' ' + s.note : ''}`, 7.5, { bold: true, align: 'right' }));
    y -= 3; pg.stroke(0.5); pg.line(x0, y, x0 + firstW + cc.length * colW, y); y -= rowH - 2;
    rc.forEach((row, j) => {
      if (j % 2 === 0) pg.fillRect(x0, y - 2.2, firstW + cc.length * colW, rowH, 0.93);
      pg.text(x0, y, row.label, 7.5);
      cc.forEach((s, k) => pg.text(x0 + firstW + (k + 1) * colW - 3, y, U(s.scale * row.t), 7.5, { align: 'right' }));
      y -= rowH;
    });
    pages.push(pg.content);
  }

  // ---- tiled 1:1 template
  const LAB = 14; // room for labels around the drawing, mm
  const u0 = b.minY - LAB, u1 = b.maxY + 6, v0 = b.minX - LAB, v1 = b.maxX + 8;
  const areaW = PAGE_W - 2 * MARGIN, areaH = PAGE_H - 2 * MARGIN - HEADER, OVER = 15;
  const stepU = areaW - OVER, stepV = areaH - OVER;
  const nu = Math.max(1, Math.ceil((u1 - u0 - OVER) / stepU)), nv = Math.max(1, Math.ceil((v1 - v0 - OVER) / stepV));
  const tileU = i => u0 + i * stepU, tileV = j => v0 + j * stepV;
  // Registration marks inside each overlap strip, shared by both neighbours.
  const marks = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i + 1 < nu; i++) {
    const u = tileU(i + 1) + OVER * 0.7;
    for (const v of [tileV(j) + 8, tileV(j) + areaH / 2, tileV(j) + areaH - 8]) marks.push([u, v]);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j + 1 < nv; j++) {
    const v = tileV(j + 1) + OVER * 0.7;
    for (const u of [tileU(i) + 8, tileU(i) + areaW / 2, tileU(i) + areaW - 8]) marks.push([u, v]);
  }
  const total = nu * nv;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const pg = pdfPage();
    const ua = tileU(i), va = tileV(j);
    const left = MARGIN * MM2PT, top = (PAGE_H - MARGIN - HEADER) * MM2PT, bottom = MARGIN * MM2PT;
    const T = q => [left + (q.y - ua) * MM2PT, top - (q.x - va) * MM2PT];
    const Tuv = (u, v) => [left + (u - ua) * MM2PT, top - (v - va) * MM2PT];
    const k = j * nu + i + 1;
    pg.text(left, (PAGE_H - MARGIN) * MM2PT - 9, `${title} - 1:1 TEMPLATE - tile ${k} of ${total} (column ${i + 1}/${nu}, row ${j + 1}/${nv})`, 9, { bold: true });
    pg.text(left, (PAGE_H - MARGIN) * MM2PT - 19, 'Print at 100% / Actual size on Letter landscape. Nut on the left, treble edge at the top.', 7, { gray: 0.35 });
    rulers(pg, left, (PAGE_H - MARGIN - 13) * MM2PT);

    pg.clip(left, bottom, areaW * MM2PT, areaH * MM2PT);
    pg.stroke(0.25, 0.5); pg.dash(6, 2); pg.poly(P.centre.map(T));
    pg.stroke(0.2, 0.5); pg.dash(2, 1.5); for (const s of P.strings) pg.poly(s.map(T));
    pg.stroke(0.6); pg.poly(P.outline.map(T), true);
    pg.stroke(1.0); pg.poly(P.nut.map(T));
    for (const fr of P.frets) {
      pg.stroke(fr.n === 12 ? 0.6 : 0.4); pg.poly(fr.curve.map(T));
      const [x, y] = T(fr.curve[0]); pg.text(x, y + 5, String(fr.n), 6.5, { align: 'center' });
    }
    pg.stroke(0.6); pg.dash(4, 2); pg.poly(P.bridge.map(T));
    { const [x, y] = T(P.nut[0]); pg.text(x, y + 5, 'NUT', 6.5, { align: 'center', bold: true }); }
    { const [x, y] = T(P.bridge[0]); pg.text(x, y + 5, 'BRIDGE', 6.5, { align: 'center', bold: true }); }
    for (const s of design.strings) { const [x, y] = T(s.nut); pg.text(x - 6, y - 2, String(s.i + 1), 6, { align: 'right', gray: 0.3 }); }
    pg.stroke(0.5);
    for (const [u, v] of marks) {
      if (u < ua || u > ua + areaW || v < va || v > va + areaH) continue;
      const [x, y] = Tuv(u, v);
      pg.line(x - 10, y, x + 10, y); pg.line(x, y - 10, x, y + 10); pg.circle(x, y, 4);
    }
    pg.unclip();
    pg.stroke(0.3, 0.6); pg.rect(left, bottom, areaW * MM2PT, areaH * MM2PT);
    if (i > 0) {
      const [x] = Tuv(ua + OVER * 0.3, va);
      pg.stroke(0.5); pg.dash(4, 3); pg.line(x, bottom, x, top);
      pg.text(x + 3, bottom + 3, `CUT, lay over tile ${k - 1}, match the + marks`, 6.5, { gray: 0.35 });
    }
    if (j > 0) {
      const [, y] = Tuv(ua, va + OVER * 0.3);
      pg.stroke(0.5); pg.dash(4, 3); pg.line(left, y, left + areaW * MM2PT, y);
      pg.text(left + 3, y - 9, `CUT, lay over tile ${k - nu}, match the + marks`, 6.5, { gray: 0.35 });
    }
    pages.push(pg.content);
  }
  return { data: buildPDF(PW, PH, pages, title), mime: 'application/pdf', extension: 'pdf', pages: pages.length, tiles: total };
}

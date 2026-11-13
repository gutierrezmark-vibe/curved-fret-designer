// cad.js — CAM-grade curve output. Pure ES module (no DOM).
//
// Every fret, the nut, the bridge line and the board end are exported as ONE
// smooth cubic B-spline each (not a chain of short lines), so a CAM "trace"
// operation can follow a fret slot as a single entity.
//
// fitBSpline() fits a clamped cubic B-spline to an exact curve evaluator
// (design.frets[n].at(s), s = continuous string index). Interior knots start at
// the integer string positions (where the scale profile's own spline has its
// breaks) and spans are split until the curve is within `tol` mm everywhere.
// x is linear in s, which B-splines reproduce exactly, so only y is fitted.

import { DXF_R2000_TEMPLATE, DXF_MODEL_SPACE, DXF_FIRST_HANDLE } from './dxf-template.js';

const DEG = 3;

/** Cox–de Boor: the DEG+1 non-zero basis values at u and the span index. */
function findSpan(U, n, u) {
  if (u >= U[n + 1]) return n;
  if (u <= U[DEG]) return DEG;
  let lo = DEG, hi = n + 1, mid = (lo + hi) >> 1;
  while (u < U[mid] || u >= U[mid + 1]) { if (u < U[mid]) hi = mid; else lo = mid; mid = (lo + hi) >> 1; }
  return mid;
}
function basis(U, span, u) {
  const N = [1], left = [], right = [];
  for (let j = 1; j <= DEG; j++) {
    left[j] = u - U[span + 1 - j]; right[j] = U[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const tmp = N[r] / (right[r + 1] + left[j - r]);
      N[r] = saved + right[r + 1] * tmp; saved = left[j - r] * tmp;
    }
    N[j] = saved;
  }
  return N;
}

/** Evaluate a clamped cubic B-spline {knots, ctrl} at u in [0,1]. */
export function evalBSpline(sp, u) {
  const n = sp.ctrl.length - 1, span = findSpan(sp.knots, n, u), N = basis(sp.knots, span, u);
  let x = 0, y = 0;
  for (let j = 0; j <= DEG; j++) { const P = sp.ctrl[span - DEG + j]; x += N[j] * P.x; y += N[j] * P.y; }
  return { x, y };
}

function solveSPD(A, B) {
  // Gaussian elimination with partial pivoting; A is n×n, B is n×2 (x, y columns).
  const n = A.length;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [B[c], B[p]] = [B[p], B[c]];
    const d = A[c][c] || 1e-300;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / d; if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      B[r][0] -= f * B[c][0]; B[r][1] -= f * B[c][1];
    }
  }
  const X = Array.from({ length: n }, () => [0, 0]);
  for (let r = n - 1; r >= 0; r--) {
    let sx = B[r][0], sy = B[r][1];
    for (let k = r + 1; k < n; k++) { sx -= A[r][k] * X[k][0]; sy -= A[r][k] * X[k][1]; }
    X[r][0] = sx / A[r][r]; X[r][1] = sy / A[r][r];
  }
  return X;
}

/**
 * Fit one clamped cubic B-spline to at(s) over [s0, s1].
 * @returns {{degree:3, knots:number[], ctrl:{x,y}[], maxErr:number}} knots normalised to [0,1].
 */
export function fitBSpline(at, s0, s1, { tol = 0.001, breaks = null, maxCtrl = 400, single = false } = {}) {
  const S = u => s0 + u * (s1 - s0);
  const span = s1 - s0 || 1;
  let interior = (breaks || []).map(b => (b - s0) / span).filter(u => u > 1e-3 && u < 1 - 1e-3).sort((a, b) => a - b);
  if (single) interior = [];
  else if (!interior.length) interior = [0.5];
  let best = null;
  for (let iter = 0; iter < 16; iter++) {
    const U = [0, 0, 0, 0, ...interior, 1, 1, 1, 1];
    const n = U.length - DEG - 1; // control point count
    const edges = [0, ...interior, 1];
    // Least-squares samples: 24 per knot span plus the two ends.
    const us = [0];
    for (let k = 0; k + 1 < edges.length; k++) for (let j = 1; j <= 24; j++) us.push(edges[k] + (edges[k + 1] - edges[k]) * j / 24);
    const Q = us.map(u => at(S(u)));
    const P0 = Q[0], Pn = Q[Q.length - 1];
    const m = n - 2; // unknown interior control points
    const A = Array.from({ length: m }, () => new Array(m).fill(0));
    const B = Array.from({ length: m }, () => [0, 0]);
    for (let k = 1; k < us.length - 1; k++) {
      const sp = findSpan(U, n - 1, us[k]), N = basis(U, sp, us[k]);
      const row = new Map();
      let rx = Q[k].x, ry = Q[k].y;
      for (let j = 0; j <= DEG; j++) {
        const i = sp - DEG + j;
        if (i === 0) { rx -= N[j] * P0.x; ry -= N[j] * P0.y; }
        else if (i === n - 1) { rx -= N[j] * Pn.x; ry -= N[j] * Pn.y; }
        else row.set(i - 1, N[j]);
      }
      for (const [a, va] of row) {
        B[a][0] += va * rx; B[a][1] += va * ry;
        for (const [b, vb] of row) A[a][b] += va * vb;
      }
    }
    const X = m > 0 ? solveSPD(A, B) : [];
    const ctrl = [P0, ...X.map(([x, y]) => ({ x, y })), Pn];
    const sp = { degree: DEG, knots: U, ctrl };
    // Error: exact curve vs spline at the same parameter, 64 checks per span.
    let maxErr = 0; const bad = [];
    for (let k = 0; k + 1 < edges.length; k++) {
      let e = 0;
      for (let j = 0; j <= 64; j++) {
        const u = edges[k] + (edges[k + 1] - edges[k]) * j / 64, a = at(S(u)), c = evalBSpline(sp, u);
        e = Math.max(e, Math.hypot(a.x - c.x, a.y - c.y));
      }
      maxErr = Math.max(maxErr, e);
      if (e > tol) bad.push((edges[k] + edges[k + 1]) / 2);
    }
    sp.maxErr = maxErr;
    best = sp;
    if (single || !bad.length || n >= maxCtrl) break;
    interior = [...interior, ...bad].sort((a, b) => a - b);
  }
  return best;
}

/** Fit a design curve object ({at, sRange}) with knots at the integer strings. */
export function curveSpline(c, tol = 0.001) {
  const [s0, s1] = c.sRange;
  const breaks = []; for (let k = Math.ceil(s0); k <= Math.floor(s1); k++) breaks.push(k);
  return fitBSpline(c.at, s0, s1, { tol, breaks });
}

/** Apply an affine point map to a spline (exact: B-splines are affine invariant). */
export function mapSpline(sp, f) { return { ...sp, ctrl: sp.ctrl.map(f) }; }

/** Convert to a list of cubic Bézier segments [[p0,p1,p2,p3], ...] by knot insertion. */
export function toBeziers(sp) {
  let U = sp.knots.slice(), P = sp.ctrl.map(q => ({ ...q }));
  const interior = [...new Set(U.slice(DEG + 1, U.length - DEG - 1))];
  for (const u of interior) {
    let mult = U.filter(v => v === u).length;
    while (mult < DEG) {
      const k = findSpan(U, P.length - 1, u);
      const Q = [];
      for (let i = 0; i < P.length + 1; i++) {
        if (i <= k - DEG) Q.push(P[i]);
        else if (i > k) Q.push(P[i - 1]);
        else {
          const a = (u - U[i]) / (U[i + DEG] - U[i]);
          Q.push({ x: (1 - a) * P[i - 1].x + a * P[i].x, y: (1 - a) * P[i - 1].y + a * P[i].y });
        }
      }
      U.splice(k + 1, 0, u); P = Q; mult++;
    }
  }
  const segs = [];
  for (let i = 0; i + 3 < P.length; i += 3) segs.push([P[i], P[i + 1], P[i + 2], P[i + 3]]);
  return segs;
}

// ---------------------------------------------------------------------------
// DXF R2000 (AC1015) writer for SPLINE entities. The tables, blocks and objects
// come from a template generated by ezdxf (see dxf-template.js); Fusion 360
// rejects R2000 files without that full structure. Layers in the template:
// OUTLINE NUT FRETS STRINGS CENTRE BRIDGE TEXT.


export function dxfR2000({ entities, extents }) {
  let next = DXF_FIRST_HANDLE;
  const H = () => (next++).toString(16).toUpperCase();
  const fmt = v => (Math.abs(v) < 1e-12 ? 0 : +v.toFixed(6)).toString();
  const E = [];
  const eg = (c, v) => E.push(String(c), String(v));
  const head = (type, layer) => { eg(0, type); eg(5, H()); eg(330, DXF_MODEL_SPACE); eg(100, 'AcDbEntity'); eg(8, layer); };
  for (const e of entities) {
    if (e.type === 'LINE') {
      head('LINE', e.layer); eg(100, 'AcDbLine');
      eg(10, fmt(e.a.x)); eg(20, fmt(e.a.y)); eg(30, 0); eg(11, fmt(e.b.x)); eg(21, fmt(e.b.y)); eg(31, 0);
    } else if (e.type === 'SPLINE') {
      const sp = e.spline;
      head('SPLINE', e.layer); eg(100, 'AcDbSpline');
      eg(210, 0); eg(220, 0); eg(230, 1);
      eg(70, 8); eg(71, sp.degree); eg(72, sp.knots.length); eg(73, sp.ctrl.length); eg(74, 0);
      eg(42, '0.0000001'); eg(43, '0.0000001');
      for (const k of sp.knots) eg(40, fmt(k));
      for (const q of sp.ctrl) { eg(10, fmt(q.x)); eg(20, fmt(q.y)); eg(30, 0); }
    } else if (e.type === 'TEXT') {
      head('TEXT', e.layer); eg(100, 'AcDbText');
      eg(10, fmt(e.at.x)); eg(20, fmt(e.at.y)); eg(30, 0); eg(40, e.height); eg(1, e.text); eg(7, 'Standard'); eg(100, 'AcDbText');
    }
  }
  const body = E.length ? E.join('\r\n') + '\r\n' : '';
  return DXF_R2000_TEMPLATE
    .replace('{{HANDSEED}}', (next + 1).toString(16).toUpperCase())
    .replace('{{XMIN}}', fmt(extents.minX)).replace('{{YMIN}}', fmt(extents.minY))
    .replace('{{XMAX}}', fmt(extents.maxX)).replace('{{YMAX}}', fmt(extents.maxY))
    .replace('{{ENTITIES}}\r\n', body);
}

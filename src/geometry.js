// geometry.js: pure math for the Curved Fret Designer. No DOM, no three.js.
// Runs unchanged in Node 18+ and in browsers (plain ES module).
//
// Conventions (see docs/CONTRACT.md and docs/MATH.md):
//   * All geometry is in millimetres. Inches are display only.
//   * String i = 0 is the treble string, i = N-1 the bass string.
//   * x = 0 is the board centreline, +x toward the bass side.
//   * y = 0 is the perpendicular line (fraction perpRatio along every string),
//     +y toward the bridge, so the nut sits at negative y.
//   * `scale` is measured ALONG the string, nut point to bridge point.
//
// The model in one paragraph: string index s is treated as a continuous
// variable. L(s) is the scale-length profile (the analytic series where one
// exists, otherwise a not-a-knot cubic spline through the per-string values).
// Nut and bridge x are linear in s. Fret n on "virtual string" s is the point
// at fraction t = 1 - 2^(-n/12) from nut(s) to bridge(s). So every fret, the
// nut and the bridge are members of one smooth family of curves; they pass
// exactly through the real string crossings, and run on naturally to the
// straight board edges, which are clipped where they meet each curve.

export const MM_PER_IN = 25.4;
const IN = MM_PER_IN;

export const MODES = Object.freeze(['single', 'fan', 'exponential', 'divergent', 'convergent', 's-curve', 'custom']);

// Mark's 9-string from FretFind2D design B (convergent "C-scale", 25.5"-29.99").
const MARK_9 = [25.5, 25.85, 26.32, 26.939, 27.754, 28.56, 29.17, 29.64, 29.99].map(v => v * IN);

export const DEFAULTS = Object.freeze({
  units: 'in',
  numStrings: 9,
  numFrets: 24,
  mode: 'custom',
  trebleScale: 25.5 * IN,
  bassScale: 29.99 * IN,
  scalar: 9,
  growth: 1.32,
  direction: 'toBass',
  fitToEnds: true,
  pivot: 4,
  trebleHalf: { scalar: 9, growth: 1.32 },
  bassHalf: { scalar: 9, growth: 1.32 },
  customScales: MARK_9,
  perpRatio: 0.5,
  // FretFind2D "nutWidth"/"bridgeWidth" are outer-string centre to centre.
  nutSpacing: 2.5 / 8 * IN,
  bridgeSpacing: 3.25 / 8 * IN,
  edgeMargin: 0.09375 * IN,
  boardExtension: 0.25 * IN,
  gauges: null,
  tuning: null, // optional: note names ('E4') or MIDI numbers, index 0 = treble
});

// ---------------------------------------------------------------------------
// Small helpers

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num = (v, d) => { const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return isNum(x) ? x : d; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Fraction of the scale from the nut to fret n (12-TET). */
export function fretFraction(n) { return 1 - Math.pow(2, -n / 12); }

/** Fret number (fractional) that sits on the perpendicular line for a perpRatio. */
export function perpFretNumber(perpRatio) { return perpRatio >= 1 ? Infinity : -12 * Math.log2(1 - perpRatio); }

/**
 * Sum of the first d steps of a geometric series whose first step is 1 and
 * each next step is `g` times the last: 1 + g + ... + g^(d-1). Continuous in
 * d (the analytic extension (g^d - 1)/(g - 1)), so fractional pivots and
 * in-between "virtual strings" are well defined.
 */
export function seriesSum(d, g) {
  const e = g - 1;
  if (Math.abs(e) < 1e-7) return d + 0.5 * d * (d - 1) * e;
  return (Math.pow(g, d) - 1) / e;
}
/** d/dd of seriesSum. */
function seriesSlope(d, g) {
  const e = g - 1;
  if (Math.abs(e) < 1e-7) return 1 + (d - 0.5) * e;
  return Math.pow(g, d) * Math.log(g) / e;
}

function safeGrowth(g) { return isNum(g) && g > 1e-3 ? g : (isNum(g) && g > 0 ? 1e-3 : 1); }

/** Merge params over DEFAULTS, copying nested objects and sanitising types. */
export function resolveParams(params = {}) {
  const src = params || {};
  const p = { ...DEFAULTS, ...src };
  p.trebleHalf = { ...DEFAULTS.trebleHalf, ...(src.trebleHalf || {}) };
  p.bassHalf = { ...DEFAULTS.bassHalf, ...(src.bassHalf || {}) };
  p.customScales = Array.isArray(p.customScales) ? p.customScales.map(Number).filter(isNum) : DEFAULTS.customScales.slice();
  p.numStrings = Math.max(1, Math.round(num(p.numStrings, DEFAULTS.numStrings)));
  p.numFrets = Math.max(0, Math.round(num(p.numFrets, DEFAULTS.numFrets)));
  if (!MODES.includes(p.mode)) p.mode = DEFAULTS.mode;
  if (p.direction !== 'toTreble') p.direction = 'toBass';
  p.units = p.units === 'mm' ? 'mm' : 'in';
  for (const k of ['trebleScale', 'bassScale', 'scalar', 'growth', 'pivot', 'perpRatio', 'nutSpacing', 'bridgeSpacing', 'edgeMargin', 'boardExtension'])
    p[k] = num(p[k], DEFAULTS[k]);
  for (const h of ['trebleHalf', 'bassHalf']) {
    p[h].scalar = num(p[h].scalar, DEFAULTS[h].scalar);
    p[h].growth = num(p[h].growth, DEFAULTS[h].growth);
  }
  p.fitToEnds = !!p.fitToEnds;
  p.perpRatio = clamp(p.perpRatio, 0, 1);
  p.edgeMargin = Math.max(0, p.edgeMargin);
  p.boardExtension = Math.max(0, p.boardExtension);
  return p;
}

// ---------------------------------------------------------------------------
// Scale-length profile L(s)

/**
 * Not-a-knot cubic spline through (i, y[i]) at integer knots i = 0..n-1.
 * Returns {at(s), d2(s)}. 1 point = constant, 2 = straight line, 3 = parabola.
 * Beyond the end knots the end cubic is continued (only used a fraction of a
 * string into the board-edge margins).
 */
export function cubicSpline(y) {
  const n = y.length;
  if (n === 0) return { at: () => NaN, d2: () => 0 };
  if (n === 1) return { at: () => y[0], d2: () => 0 };
  let M;
  if (n === 2) M = [0, 0];
  else if (n === 3) { const m = y[0] - 2 * y[1] + y[2]; M = [m, m, m]; }
  else {
    // Unknowns M_0..M_{n-1} (second derivatives). Uniform knot spacing 1.
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    const b = new Array(n).fill(0);
    A[0][0] = 1; A[0][1] = -2; A[0][2] = 1;                 // not-a-knot at knot 1
    for (let i = 1; i < n - 1; i++) {
      A[i][i - 1] = 1; A[i][i] = 4; A[i][i + 1] = 1;
      b[i] = 6 * (y[i - 1] - 2 * y[i] + y[i + 1]);
    }
    A[n - 1][n - 3] = 1; A[n - 1][n - 2] = -2; A[n - 1][n - 1] = 1; // not-a-knot at knot n-2
    M = solveLinear(A, b) || new Array(n).fill(0);
  }
  const seg = s => clamp(Math.floor(s), 0, n - 2);
  return {
    at(s) {
      const j = seg(s), t = s - j, u = 1 - t;
      return u * y[j] + t * y[j + 1] + ((u * u * u - u) * M[j] + (t * t * t - t) * M[j + 1]) / 6;
    },
    d2(s) { const j = seg(s), t = s - j; return (1 - t) * M[j] + t * M[j + 1]; },
  };
}

/** Gaussian elimination with partial pivoting. Returns null if singular. */
function solveLinear(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/**
 * The scale-length profile for a param set.
 * Returns { kind: 'analytic'|'spline', at(s), scales[], pivot, solved, junction }.
 * `solved` holds the scalar/growth values actually used (after fitToEnds), so
 * the UI can show them. `junction` (convergent only) reports how well the two
 * halves meet at the pivot.
 */
export function scaleProfile(params) {
  const p = params && params.__resolved ? params : resolveParams(params);
  const N = p.numStrings, last = N - 1;
  const Lt = p.trebleScale, Lb = p.bassScale, dL = Lb - Lt;
  const piv = clamp(p.pivot, 0, last), q = last - piv;
  let at, kind = 'analytic', solved = {}, junction = null;

  switch (p.mode) {
    case 'single':
      at = () => Lt;
      break;

    case 'fan': {
      const step = last > 0 ? dL / last : 0;
      at = s => Lt + step * s;
      solved = { scalar: step, growth: 1 };
      break;
    }

    case 'exponential': {
      const g = safeGrowth(p.growth);
      let a = p.scalar;
      if (p.fitToEnds && last > 0) a = dL / seriesSum(last, g);
      if (p.direction === 'toTreble') {
        const Lb0 = p.fitToEnds ? Lb : Lb;
        at = s => Lb0 - a * seriesSum(last - s, g);
      } else at = s => Lt + a * seriesSum(s, g);
      solved = { scalar: a, growth: g, direction: p.direction };
      break;
    }

    case 'divergent': {
      // D-scale: one series grows outward from the pivot in both directions.
      const g = safeGrowth(p.growth);
      let a = p.scalar, Lp;
      const den = seriesSum(piv, g) + seriesSum(q, g);
      if (p.fitToEnds && Math.abs(den) > 1e-12) { a = dL / den; Lp = Lt + a * seriesSum(piv, g); }
      else Lp = p.direction === 'toTreble' ? Lb - a * seriesSum(q, g) : Lt + a * seriesSum(piv, g);
      at = s => (s >= piv ? Lp + a * seriesSum(s - piv, g) : Lp - a * seriesSum(piv - s, g));
      solved = { scalar: a, growth: g, pivotScale: Lp };
      break;
    }

    case 'convergent': {
      // C-scale: one series from the treble string, one from the bass string,
      // meeting at the pivot. Strings at or below the pivot take the treble
      // series (Mark's "cherry pick").
      const gt = safeGrowth(p.trebleHalf.growth), gb = safeGrowth(p.bassHalf.growth);
      let at_ = p.trebleHalf.scalar, ab = p.bassHalf.scalar;
      const den = at_ * seriesSum(piv, gt) + ab * seriesSum(q, gb);
      if (p.fitToEnds && Math.abs(den) > 1e-12) { const k = dL / den; at_ *= k; ab *= k; }
      const tre = s => Lt + at_ * seriesSum(s, gt);
      const bas = s => Lb - ab * seriesSum(last - s, gb);
      const gap = bas(piv) - tre(piv);
      const slopeT = at_ * seriesSlope(piv, gt), slopeB = ab * seriesSlope(q, gb);
      const slopeMismatch = slopeB - slopeT;
      junction = { gap, slopeTreble: slopeT, slopeBass: slopeB, slopeMismatch };
      solved = { trebleHalf: { scalar: at_, growth: gt }, bassHalf: { scalar: ab, growth: gb }, pivotScale: tre(piv) };
      const scl = Math.max(Math.abs(slopeT), Math.abs(slopeB), 1e-9);
      if (Math.abs(gap) < 1e-6 && Math.abs(slopeMismatch) / scl < 1e-6) at = s => (s <= piv ? tre(s) : bas(s));
      else {
        const vals = Array.from({ length: N }, (_, i) => (i <= piv + 1e-9 ? tre(i) : bas(i)));
        const sp = cubicSpline(vals); at = sp.at; kind = 'spline';
      }
      break;
    }

    case 's-curve': {
      // Two series grow OUTWARD from the pivot (the inflection point). Each
      // half has its own scalar (first step away from the pivot) and growth.
      // With fitToEnds the scalars are solved so the end scales are exact AND
      // the slope dL/ds matches at the pivot (a smooth inflection, no kink).
      const gt = safeGrowth(p.trebleHalf.growth), gb = safeGrowth(p.bassHalf.growth);
      let a = p.trebleHalf.scalar, b = p.bassHalf.scalar, Lp;
      const ct = seriesSlope(0, gt), cb = seriesSlope(0, gb);
      if (p.fitToEnds && last > 0) {
        const ratio = ct / cb;
        const den = seriesSum(piv, gt) + ratio * seriesSum(q, gb);
        if (Math.abs(den) > 1e-12) { a = dL / den; b = a * ratio; }
        Lp = Lt + a * seriesSum(piv, gt);
      } else Lp = p.direction === 'toTreble' ? Lb - b * seriesSum(q, gb) : Lt + a * seriesSum(piv, gt);
      at = s => (s < piv ? Lp - a * seriesSum(piv - s, gt) : Lp + b * seriesSum(s - piv, gb));
      solved = { trebleHalf: { scalar: a, growth: gt }, bassHalf: { scalar: b, growth: gb }, pivotScale: Lp };
      break;
    }

    case 'custom':
    default: {
      // Missing entries continue the last step (a straight fan beyond the list).
      const c = p.customScales.length ? p.customScales : [Lt];
      const k = c.length, step = k >= 2 ? c[k - 1] - c[k - 2] : 0;
      const vals = Array.from({ length: N }, (_, i) => (i < k ? c[i] : c[k - 1] + step * (i - k + 1)));
      const sp = cubicSpline(vals); at = sp.at; kind = 'spline';
    }
  }

  const scales = Array.from({ length: N }, (_, i) => at(i));
  // One or two strings cannot define a bend: draw straight frets through them.
  if (N <= 2) { const sp = cubicSpline(scales); at = sp.at; kind = 'linear'; }
  return { kind, at, scales, pivot: piv, solved, junction };
}

/** Per-string scale lengths in mm, index 0 = treble. */
export function scaleLengths(params) { return scaleProfile(params).scales; }

// ---------------------------------------------------------------------------
// Strings: gauges, tuning, tension

// Treble-first extended-range set, then bass-VI/baritone weights, capped.
const GAUGE_TABLE = [0.009, 0.011, 0.016, 0.024, 0.032, 0.042, 0.054, 0.068, 0.080, 0.090, 0.100];
export const WOUND_FROM = 0.020; // gauges at or above this are wound

/** Sensible gauges (inches) for any string count, index 0 = treble. */
export function defaultGauges(n) {
  n = Math.max(0, Math.round(n) || 0);
  return Array.from({ length: n }, (_, i) => GAUGE_TABLE[Math.min(i, GAUGE_TABLE.length - 1)]);
}

const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const PC_NAME = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** 'E4', 'F#1', 'Bb2' or a MIDI number -> MIDI number (NaN if unreadable). */
export function parseNote(v) {
  if (isNum(v)) return v;
  const m = /^\s*([A-Ga-g])\s*([#b♯♭]?)\s*(-?\d+)\s*$/.exec(String(v));
  if (!m) return NaN;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + NOTE_PC[m[1].toUpperCase()] + acc;
}
export function noteName(midi) { return PC_NAME[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }

/** Standard guitar tuning, extended down in fourths past the low E. */
export function defaultTuning(n) {
  const std = [64, 59, 55, 50, 45, 40];
  return Array.from({ length: n }, (_, i) => (i < 6 ? std[i] : 40 - 5 * (i - 5)));
}

/**
 * Tension estimate in pounds-force: T = UW·(2·L·f)²/386.4 with unit weight
 * UW ≈ 0.2227·d² lb/in for plain steel and ≈ 0.185·d² for nickel-wound.
 */
export function stringTension(gaugeIn, wound, scaleMm, midi) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const uw = (wound ? 0.185 : 0.2227) * gaugeIn * gaugeIn;
  const Lin = scaleMm / IN;
  return uw * Math.pow(2 * Lin * f, 2) / 386.4;
}

// ---------------------------------------------------------------------------
// Curve analysis

function chordStats(curve) {
  const a = curve[0], b = curve[curve.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L; // +y side for a treble->bass chord
  let best = 0;
  for (const q of curve) { const d = (q.x - a.x) * nx + (q.y - a.y) * ny; if (Math.abs(d) > Math.abs(best)) best = d; }
  return { sagitta: Math.abs(best), signedSagitta: best, chord: L };
}

// ---------------------------------------------------------------------------
// The design

const FD_H = 1e-2;          // finite-difference step in string-index units
const SAMPLES_PER_GAP = 8;  // curve samples between adjacent strings
const KAPPA_ZERO = 1e-6;    // |curvature| below this (radius > 1 km) counts as straight

/** Build the full design. Contract: docs/CONTRACT.md. */
export function computeDesign(params = {}) {
  const p = resolveParams(params);
  const N = p.numStrings, last = N - 1, c = last / 2, r = p.perpRatio, m = p.edgeMargin;
  const prof = scaleProfile({ ...p, __resolved: true });
  const scales = prof.scales;
  const sn = Math.max(p.nutSpacing, 1e-3), sb = Math.max(p.bridgeSpacing, 1e-3);
  const warnings = [];
  let impossible = false;

  // Virtual string s: nut/bridge x linear in s, length L(s) along the string.
  const vstring = s => {
    const L = prof.at(s), x0 = (s - c) * sn, x1 = (s - c) * sb, dx = x1 - x0;
    const d2 = L * L - dx * dx;
    if (!(d2 > 0)) impossible = true;
    const dy = Math.sqrt(Math.max(d2, 1e-9));
    return { L, x0, y0: -r * dy, x1, y1: (1 - r) * dy };
  };
  const pointAt = (s, t) => { const v = vstring(s); return { x: v.x0 + t * (v.x1 - v.x0), y: v.y0 + t * (v.y1 - v.y0) }; };

  // Gauges / tuning / tension.
  const userG = Array.isArray(p.gauges) ? p.gauges.map(Number) : null;
  const gauges = userG && userG.length >= N && userG.slice(0, N).every(g => g > 0) ? userG.slice(0, N) : defaultGauges(N);
  if (userG && gauges !== userG && !(userG.length >= N)) warnings.push({ level: 'info', message: `Only ${userG.length} gauges given for ${N} strings; using default gauges.` });
  const userTuning = Array.isArray(p.tuning) && p.tuning.length >= N ? p.tuning.slice(0, N).map(parseNote) : null;
  const tuning = userTuning && userTuning.every(isNum) ? userTuning : defaultTuning(N);

  const strings = scales.map((L, i) => {
    const v = vstring(i), wound = gauges[i] >= WOUND_FROM;
    const tensionLb = stringTension(gauges[i], wound, L, tuning[i]);
    return {
      i, scale: L, gauge: gauges[i], wound,
      nut: { x: v.x0, y: v.y0 }, bridge: { x: v.x1, y: v.y1 },
      note: noteName(tuning[i]), midi: tuning[i], tensionLb, tensionN: tensionLb * 4.44822,
    };
  });

  // Straight board edges: from the nut curve at edgeMargin outside the outer
  // string to the bridge curve at edgeMargin outside it (x offsets).
  const edgeT = { a: pointAt(-m / sn, 0), b: pointAt(-m / sb, 1) };
  const edgeB = { a: pointAt(last + m / sn, 0), b: pointAt(last + m / sb, 1) };
  const side = (P, e) => (e.b.x - e.a.x) * (P.y - e.a.y) - (e.b.y - e.a.y) * (P.x - e.a.x);
  const reach = 2 * m / Math.min(sn, sb) + 1;
  const findEdge = (tOf, e, inside, outside) => {
    const f = s => side(pointAt(s, tOf(s)), e);
    let lo = inside, hi = outside, flo = f(lo);
    if (Math.abs(flo) < 1e-9) return lo;
    const fhi = f(hi);
    if (Math.sign(flo) === Math.sign(fhi)) return inside; // degenerate, keep the string
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2, fm = f(mid);
      if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid;
    }
    return (lo + hi) / 2;
  };

  // A curve of the family: t may depend on s (board end). Returns samples.
  const traceLine = tOf => {
    const sLo = findEdge(tOf, edgeT, 0, -reach), sHi = findEdge(tOf, edgeB, last, last + reach);
    const ss = [sLo];
    const K = SAMPLES_PER_GAP, first = Math.floor(sLo * K) + 1, end = Math.ceil(sHi * K) - 1;
    for (let k = first; k <= end; k++) { const s = k / K; if (s - sLo > 1e-9 && sHi - s > 1e-9) ss.push(s); }
    ss.push(sHi);
    if (ss.length < 3) ss.splice(1, 0, (sLo + sHi) / 2);
    const curve = ss.map(s => pointAt(s, tOf(s)));
    const crossings = strings.map(st => pointAt(st.i, tOf(st.i)));
    return { ss, curve, crossings, sLo, sHi };
  };
  // Exact evaluator for exporters (smooth splines for CAM): sRange is the
  // string-index span edge to edge; at(s) is non-enumerable so designs stay plain data.
  const withEval = (obj, line, tOf) => {
    obj.sRange = [line.sLo, line.sHi];
    Object.defineProperty(obj, 'at', { value: s => pointAt(s, tOf(s)), enumerable: false });
    return obj;
  };

  const kappaAt = (tOf, s) => {
    const a = pointAt(s - FD_H, tOf(s - FD_H)), b = pointAt(s, tOf(s)), d = pointAt(s + FD_H, tOf(s + FD_H));
    const x1 = (d.x - a.x) / (2 * FD_H), y1 = (d.y - a.y) / (2 * FD_H);
    const x2 = (d.x - 2 * b.x + a.x) / (FD_H * FD_H), y2 = (d.y - 2 * b.y + a.y) / (FD_H * FD_H);
    const sp = Math.pow(x1 * x1 + y1 * y1, 1.5) || 1;
    return (x1 * y2 - y1 * x2) / sp;
  };

  const analyse = (tOf, line) => {
    const ks = line.ss.map(s => kappaAt(tOf, s));
    let kmax = 0; for (const k of ks) kmax = Math.max(kmax, Math.abs(k));
    const thr = Math.max(KAPPA_ZERO, 1e-3 * kmax);
    let inflections = 0, prevSign = 0, prevIdx = -1;
    const inflectionPoints = [], cuts = [0];
    for (let j = 0; j < ks.length; j++) {
      if (Math.abs(ks[j]) < thr) continue;
      const sg = Math.sign(ks[j]);
      if (prevSign && sg !== prevSign) {
        inflections++;
        const k0 = ks[prevIdx], k1 = ks[j], u = k0 / (k0 - k1);
        const s = line.ss[prevIdx] + u * (line.ss[j] - line.ss[prevIdx]);
        inflectionPoints.push({ s, ...pointAt(s, tOf(s)) });
        cuts.push(u < 0.5 ? prevIdx : j);
      }
      prevSign = sg; prevIdx = j;
    }
    const cs = chordStats(line.curve);
    // Bow of each piece between inflections (an S has two). This is what the
    // eye reads as "how curved" on each half.
    cuts.push(line.curve.length - 1);
    const bows = [];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const piece = line.curve.slice(cuts[k], cuts[k + 1] + 1);
      bows.push(piece.length > 2 ? chordStats(piece).sagitta : 0);
    }
    return {
      sagitta: cs.sagitta, signedSagitta: cs.signedSagitta, bows,
      minRadius: kmax > KAPPA_ZERO ? 1 / kmax : Infinity,
      inflections, inflectionPoints,
    };
  };

  const frets = [];
  for (let n = 1; n <= p.numFrets; n++) {
    const t = fretFraction(n), tOf = () => t;
    const line = traceLine(tOf);
    frets.push(withEval({ n, t, perpSide: Math.sign(Math.round((t - r) * 1e9)), crossings: line.crossings, curve: line.curve, ...analyse(tOf, line) }, line, tOf));
  }
  const mk = t => { const tOf = () => t, line = traceLine(tOf); return withEval({ crossings: line.crossings, curve: line.curve, ...analyse(tOf, line) }, line, tOf); };
  const nut = mk(0), bridge = mk(1);
  const tLast = fretFraction(p.numFrets);
  const endOf = s => tLast + p.boardExtension / Math.max(prof.at(s), 1);
  const endLine = traceLine(endOf);
  const boardEnd = withEval({ curve: endLine.curve, crossings: endLine.crossings }, endLine, endOf);
  const outline = [...nut.curve, ...boardEnd.curve.slice().reverse()];

  // Widths at the nut and bridge (edge to edge, along x).
  const widths = { nut: last * p.nutSpacing + 2 * m, bridge: last * p.bridgeSpacing + 2 * m };

  // Metrics.
  let maxSag = 0, maxSagFret = null, minR = Infinity, minRFret = null, inflecting = 0;
  for (const f of frets) {
    if (f.sagitta > maxSag) { maxSag = f.sagitta; maxSagFret = f.n; }
    if (f.minRadius < minR) { minR = f.minRadius; minRFret = f.n; }
    if (f.inflections > 0) inflecting++;
  }
  const Lmin = Math.min(...scales), Lmax = Math.max(...scales);
  const F = p.numFrets;
  const minFretSpacing = F >= 2 ? Lmin * (Math.pow(2, -(F - 1) / 12) - Math.pow(2, -F / 12)) : Infinity;
  const secondDiff = scales.slice(1, -1).map((L, k) => scales[k] - 2 * L + scales[k + 2]);
  const samples = [];
  for (let k = 0; k <= Math.max(1, last) * 16; k++) { const s = (k / 16); if (s <= last + 1e-9) samples.push({ s, L: prof.at(s) }); }

  const metrics = {
    maxSagitta: maxSag, maxSagittaFret: maxSagFret,
    minRadius: minR, minRadiusFret: minRFret,
    scaleRange: [Lmin, Lmax],
    nutSagitta: nut.sagitta,
    inflectingFrets: inflecting,
    perpFret: perpFretNumber(r),
    minFretSpacing,
  };

  // ---- warnings
  if (scales.some(L => !(L > 0) || !isNum(L))) warnings.push({ level: 'error', message: 'A string has a non-positive or invalid scale length.' });
  if (impossible) warnings.push({ level: 'error', message: 'A string is shorter than its sideways nut-to-bridge offset; the geometry is impossible. Reduce the bridge/nut spacing difference or lengthen the scales.' });
  if (N > 2) {
    const d = scales.slice(1).map((L, i) => L - scales[i]);
    if (d.some(v => v > 1e-6) && d.some(v => v < -1e-6)) {
      const k = d.findIndex((v, i) => i > 0 && Math.sign(v) !== Math.sign(d[0]) && Math.abs(v) > 1e-6);
      warnings.push({ level: 'warn', message: `Scale lengths are not monotonic (direction reverses at string ${k + 1}). Frets will zig-zag.` });
    }
  }
  const growthCheck = (g, label) => {
    if (!(g > 0)) { warnings.push({ level: 'error', message: `${label} growth must be greater than 0.` }); return; }
    if (g > 1.3 + 1e-9 || g < 0.8 - 1e-9)
      warnings.push({ level: g > 1.45 + 1e-9 || g < 0.7 - 1e-9 ? 'warn' : 'info',
        message: `${label} growth ${g.toFixed(3)} is outside 0.8-1.3. Mark's notes call growth above 1.3 "too severe" for practical use.` });
  };
  if (N > 2) {
    if (p.mode === 'exponential' || p.mode === 'divergent') growthCheck(p.growth, 'The');
    if (p.mode === 'convergent' || p.mode === 's-curve') { growthCheck(p.trebleHalf.growth, 'Treble-half'); growthCheck(p.bassHalf.growth, 'Bass-half'); }
  }
  const rangeMm = Lmax - Lmin;
  if (rangeMm > 7 * IN) warnings.push({ level: 'warn', message: `Scale range is ${(rangeMm / IN).toFixed(2)}" (${rangeMm.toFixed(0)} mm). Above about 7" the outer strings feel like different instruments.` });
  else if (rangeMm > 5 * IN) warnings.push({ level: 'info', message: `Scale range is a wide ${(rangeMm / IN).toFixed(2)}" (${rangeMm.toFixed(0)} mm).` });
  if (Lmin < 300 || Lmax > 1000) warnings.push({ level: 'info', message: 'Scale lengths are outside the usual 300-1000 mm range.' });
  if (minFretSpacing < 6) warnings.push({ level: 'warn', message: `Frets ${F - 1} and ${F} are only ${minFretSpacing.toFixed(1)} mm apart on the shortest string (under 6 mm is hard to play and to slot).` });
  // Mark's built 9-string (preset mark-b) bends to about 60-75 mm, so that is known buildable.
  if (minR < 25) warnings.push({ level: 'error', message: `Fret ${minRFret} bends to a ${minR.toFixed(0)} mm radius. That is too tight to bend fret wire sideways.` });
  else if (minR < 50) warnings.push({ level: 'warn', message: `Fret ${minRFret} bends to a ${minR.toFixed(0)} mm radius. Very tight: bend the wire on a jig and expect the tang to fight you.` });
  else if (minR < 100) warnings.push({ level: 'info', message: `Fret ${minRFret} bends to a ${minR.toFixed(0)} mm radius. Pre-bend the wire on a jig.` });
  if (N >= 3 && ['exponential', 'divergent', 'convergent', 's-curve', 'custom'].includes(p.mode) && maxSag < 1)
    warnings.push({ level: 'info', message: `The largest fret bow is only ${maxSag.toFixed(2)} mm, so the frets will look nearly straight.` });
  if (p.mode === 's-curve' || p.mode === 'divergent' || p.mode === 'convergent') {
    const piv = prof.pivot;
    if (piv < 1 || piv > last - 1) warnings.push({ level: 'info', message: 'The pivot is at or next to an outer string, so one half has almost no curve.' });
    if (p.mode === 's-curve' && (p.trebleHalf.growth - 1) * (p.bassHalf.growth - 1) <= 0)
      warnings.push({ level: 'info', message: 'The two halves bend the same way (one growth above 1, one below), so there is no S. Put both growths on the same side of 1 for an inflection.' });
    if (N < 7 && N >= 3) warnings.push({ level: 'info', message: `An S needs about 3 strings on each side of the pivot to read clearly. On ${N} strings each half bows only about 1 mm.` });
  }
  if (prof.junction && !p.fitToEnds && Math.abs(prof.junction.gap) > 0.5)
    warnings.push({ level: 'info', message: `The treble and bass series miss each other by ${prof.junction.gap.toFixed(2)} mm at the pivot. Turn on "fit to ends" to make them meet.` });
  if (userTuning) strings.forEach(st => {
    if (st.tensionLb < 10 || st.tensionLb > 32) warnings.push({ level: 'info', message: `String ${st.i + 1} (${st.note}, ${st.gauge}) is about ${st.tensionLb.toFixed(1)} lb, outside 10-32 lb.` });
  });

  return {
    params: p, strings, frets, nut, bridge, boardEnd, outline, widths, metrics, warnings,
    profile: { kind: prof.kind, pivot: prof.pivot, solved: prof.solved, junction: prof.junction, at: prof.at, samples, secondDiff },
    edges: { treble: [edgeT.a, edgeT.b], bass: [edgeB.a, edgeB.b] },
  };
}

// ---------------------------------------------------------------------------
// Fitting measured scales to the formula modes (reverse engineering)

function lsq(rows, ys) {
  const k = rows[0].length, A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
  rows.forEach((r, i) => { for (let a = 0; a < k; a++) { b[a] += r[a] * ys[i]; for (let c = 0; c < k; c++) A[a][c] += r[a] * r[c]; } });
  return solveLinear(A, b);
}
function errStats(pred, ys) {
  let ss = 0, mx = 0;
  ys.forEach((y, i) => { const e = pred[i] - y; ss += e * e; mx = Math.max(mx, Math.abs(e)); });
  return { rms: Math.sqrt(ss / ys.length), maxErr: mx };
}
function golden(f, lo, hi, it = 60) {
  const R = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi, c = b - R * (b - a), d = a + R * (b - a), fc = f(c), fd = f(d);
  for (let i = 0; i < it; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - R * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + R * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}
// Minimise f over log-growths (1 or 2 of them) in [0.4, 2.5]: grid, then coordinate golden passes.
function minimiseGrowths(f, dims) {
  const lo = Math.log(0.4), hi = Math.log(2.5), G = dims === 1 ? 211 : 41;
  let best = null, bestV = Infinity;
  const grid = Array.from({ length: G }, (_, i) => lo + (hi - lo) * i / (G - 1));
  if (dims === 1) for (const u of grid) { const v = f([u]); if (v < bestV) { bestV = v; best = [u]; } }
  else for (const u of grid) for (const w of grid) { const v = f([u, w]); if (v < bestV) { bestV = v; best = [u, w]; } }
  const step = (hi - lo) / (G - 1);
  for (let pass = 0; pass < 4; pass++) for (let d = 0; d < dims; d++) {
    const x = best.slice();
    const u = golden(v => { x[d] = v; return f(x); }, best[d] - step, best[d] + step);
    x[d] = u; const v = f(x); if (v <= bestV) { bestV = v; best = x; }
  }
  return best;
}

/**
 * Reverse-fit a list of scale lengths (mm, treble first) to every formula mode.
 * Returns { fits: [{ mode, label, params, rms, maxErr, scales }], best }.
 * `params` is a partial param set that reproduces the fit (fitToEnds: false).
 * `best` is the simplest fit whose max error is within `tolerance` mm.
 */
export function fitScales(input, { tolerance = 0.3 } = {}) {
  const ys = input.map(Number), N = ys.length, last = N - 1, idx = ys.map((_, i) => i);
  const fits = [];
  const push = (mode, label, params, complexity) => {
    const sc = scaleLengths({ numStrings: N, ...params });
    fits.push({ mode, label, params, complexity, scales: sc, ...errStats(sc, ys) });
  };
  if (N === 0) return { fits, best: null };
  const mean = ys.reduce((a, b) => a + b, 0) / N;
  push('single', 'single', { mode: 'single', trebleScale: mean }, 1);
  if (N < 2) return { fits, best: fits[0] };
  const lin = lsq(idx.map(i => [1, i]), ys);
  push('fan', 'linear fan', { mode: 'fan', trebleScale: lin[0], bassScale: lin[0] + lin[1] * last }, 2);
  if (N < 3) return pickBest(fits, tolerance);

  // exponential: L = Lt + a·S(i, g)
  {
    const solveFor = g => lsq(idx.map(i => [1, seriesSum(i, g)]), ys);
    const cost = ([u]) => { const g = Math.exp(u), s = solveFor(g); if (!s) return Infinity; return errStats(idx.map(i => s[0] + s[1] * seriesSum(i, g)), ys).rms; };
    const g = Math.exp(minimiseGrowths(cost, 1)[0]), s = solveFor(g);
    if (s) push('exponential', 'exponential toward bass', { mode: 'exponential', direction: 'toBass', fitToEnds: false, trebleScale: s[0], scalar: s[1], growth: g }, 3);
  }
  const pivots = [];
  for (let k = 2; k <= 2 * last - 2; k++) pivots.push(k / 2);
  // divergent: L = Lp ± a·S(|i-p|, g)
  {
    let best = null;
    for (const piv of pivots) {
      const basis = g => idx.map(i => [1, i >= piv ? seriesSum(i - piv, g) : -seriesSum(piv - i, g)]);
      const cost = ([u]) => { const g = Math.exp(u), B = basis(g), s = lsq(B, ys); if (!s) return Infinity; return errStats(B.map(r => s[0] + s[1] * r[1]), ys).rms; };
      const g = Math.exp(minimiseGrowths(cost, 1)[0]), s = lsq(basis(g), ys), v = cost([Math.log(g)]);
      if (s && (!best || v < best.v)) best = { v, piv, g, Lp: s[0], a: s[1] };
    }
    if (best) push('divergent', 'divergent (D-scale)', { mode: 'divergent', direction: 'toBass', fitToEnds: false, pivot: best.piv, scalar: best.a, growth: best.g, trebleScale: best.Lp - best.a * seriesSum(best.piv, best.g) }, 4);
  }
  // convergent, Mark's way: same scalar and growth for both halves.
  {
    let best = null;
    for (const piv of pivots) {
      const basis = g => idx.map(i => (i <= piv + 1e-9 ? [1, 0, seriesSum(i, g)] : [0, 1, -seriesSum(last - i, g)]));
      const cost = ([u]) => { const g = Math.exp(u), B = basis(g), s = lsq(B, ys); if (!s) return Infinity; return errStats(B.map(r => r[0] * s[0] + r[1] * s[1] + r[2] * s[2]), ys).rms; };
      const g = Math.exp(minimiseGrowths(cost, 1)[0]), s = lsq(basis(g), ys), v = cost([Math.log(g)]);
      if (s && (!best || v < best.v)) best = { v, piv, g, s };
    }
    if (best) push('convergent', 'convergent (C-scale), equal halves', { mode: 'convergent', fitToEnds: false, pivot: best.piv, trebleScale: best.s[0], bassScale: best.s[1], trebleHalf: { scalar: best.s[2], growth: best.g }, bassHalf: { scalar: best.s[2], growth: best.g } }, 5);
  }
  // s-curve: L = Lp - a·S(p-i, gt) | Lp + b·S(i-p, gb)
  {
    let best = null;
    for (const piv of pivots) {
      const basis = (gt, gb) => idx.map(i => (i < piv ? [1, -seriesSum(piv - i, gt), 0] : [1, 0, seriesSum(i - piv, gb)]));
      const cost = ([u, w]) => { const B = basis(Math.exp(u), Math.exp(w)), s = lsq(B, ys); if (!s) return Infinity; return errStats(B.map(r => s[0] + r[1] * s[1] + r[2] * s[2]), ys).rms; };
      const x = minimiseGrowths(cost, 2), gt = Math.exp(x[0]), gb = Math.exp(x[1]), s = lsq(basis(gt, gb), ys), v = cost(x);
      if (s && (!best || v < best.v)) best = { v, piv, gt, gb, s };
    }
    if (best) {
      const { piv, gt, gb, s } = best;
      push('s-curve', 's-curve (outward halves)', { mode: 's-curve', direction: 'toBass', fitToEnds: false, pivot: piv, trebleScale: s[0] - s[1] * seriesSum(piv, gt), trebleHalf: { scalar: s[1], growth: gt }, bassHalf: { scalar: s[2], growth: gb } }, 6);
    }
  }
  return pickBest(fits, tolerance);
}
function pickBest(fits, tol) {
  const ok = fits.filter(f => f.maxErr <= tol).sort((a, b) => a.complexity - b.complexity || a.rms - b.rms);
  return { fits, best: ok[0] || fits.slice().sort((a, b) => a.rms - b.rms)[0] };
}

// ---------------------------------------------------------------------------
// Presets

const fromInches = (nutIn, bridgeIn, n, edgeIn = 0.09375) => ({
  nutSpacing: nutIn / (n - 1) * IN, bridgeSpacing: bridgeIn / (n - 1) * IN, edgeMargin: edgeIn * IN,
});

export const PRESETS = Object.freeze({
  'mark-a': {
    label: "Mark's A: 8-string accelerating exponential",
    description: '25.5" to 28.665", growth 1.45 toward the bass (FretFind2D design A). Steps 2.9 mm, then x1.45 each string.',
    params: { units: 'in', numStrings: 8, numFrets: 24, mode: 'exponential', direction: 'toBass', fitToEnds: false,
      trebleScale: 25.5 * IN, bassScale: 28.665 * IN, scalar: 2.9, growth: 1.45, perpRatio: 0.5, ...fromInches(2.25, 2.625, 8) },
  },
  'mark-b': {
    label: "Mark's B: 9-string C-scale",
    description: '25.5" to 30", two series of scalar 9 mm, growth 1.32, one from each end, meeting exactly at string 5 (FretFind2D design B, within 0.25 mm).',
    params: { units: 'in', numStrings: 9, numFrets: 24, mode: 'convergent', fitToEnds: true, pivot: 4,
      trebleScale: 647.7, bassScale: 762, trebleHalf: { scalar: 9, growth: 1.32 }, bassHalf: { scalar: 9, growth: 1.32 },
      perpRatio: 0.5, ...fromInches(2.5, 3.25, 9) },
  },
  'mark-b-built': {
    label: "Mark's B as built (exact FretFind2D scales)",
    description: 'The nine scale lengths exactly as entered in FretFind2D for the headless 9-string: 25.5, 25.85, 26.32, 26.939, 27.754, 28.56, 29.17, 29.64, 29.99.',
    params: { units: 'in', numStrings: 9, numFrets: 24, mode: 'custom', customScales: MARK_9.slice(),
      trebleScale: MARK_9[0], bassScale: MARK_9[8], perpRatio: 0.5, ...fromInches(2.5, 3.25, 9) },
  },
  'mark-c': {
    label: "Mark's C: 8-string decelerating exponential",
    description: '25.5" to 28.688", growth 0.935 (FretFind2D design C). First step 14.025 mm, each next x0.935.',
    params: { units: 'in', numStrings: 8, numFrets: 24, mode: 'exponential', direction: 'toBass', fitToEnds: false,
      trebleScale: 25.5 * IN, bassScale: 28.688 * IN, scalar: 14.025, growth: 0.935, perpRatio: 0.5, ...fromInches(2.25, 2.625, 8) },
  },
  's-curve-8': {
    label: 'S-curve 8-string',
    description: '25.5" to 28.5", inflection between strings 4 and 5. Both halves slow down away from the centre (growth 0.8).',
    params: { units: 'in', numStrings: 8, numFrets: 24, mode: 's-curve', fitToEnds: true, pivot: 3.5,
      trebleScale: 25.5 * IN, bassScale: 28.5 * IN, trebleHalf: { scalar: 10, growth: 0.8 }, bassHalf: { scalar: 10, growth: 0.8 },
      perpRatio: 0.5, ...fromInches(2.25, 2.625, 8) },
  },
  'exp-6': {
    label: '6-string exponential',
    description: '25.5" to 27", growth 1.3 toward the bass. About as curved as a 6-string gets.',
    params: { units: 'in', numStrings: 6, numFrets: 24, mode: 'exponential', direction: 'toBass', fitToEnds: true,
      trebleScale: 25.5 * IN, bassScale: 27 * IN, scalar: 5, growth: 1.3, perpRatio: 0.5, ...fromInches(1.8, 2.15, 6, 0.125) },
  },
  's-curve-12': {
    label: '12-string S-curve',
    description: '25.5" to 30", pivot between strings 6 and 7, growth 0.88 per half.',
    params: { units: 'in', numStrings: 12, numFrets: 24, mode: 's-curve', fitToEnds: true, pivot: 5.5,
      trebleScale: 25.5 * IN, bassScale: 30 * IN, trebleHalf: { scalar: 10, growth: 0.88 }, bassHalf: { scalar: 10, growth: 0.88 },
      perpRatio: 0.5, ...fromInches(3.3, 3.95, 12) },
  },
  'd-scale-9': {
    label: '9-string D-scale (divergent)',
    description: '25.5" to 29", one series growing out from string 5 both ways, growth 1.2.',
    params: { units: 'in', numStrings: 9, numFrets: 24, mode: 'divergent', fitToEnds: true, pivot: 4,
      trebleScale: 25.5 * IN, bassScale: 29 * IN, scalar: 10, growth: 1.2, perpRatio: 0.5, ...fromInches(2.5, 3.25, 9) },
  },
  'fan-7': {
    label: 'Classic 7-string fan',
    description: 'Straight fanned frets, 25.5" to 27", perpendicular at the 7th fret area (perpRatio 0.4).',
    params: { units: 'in', numStrings: 7, numFrets: 24, mode: 'fan', trebleScale: 25.5 * IN, bassScale: 27 * IN,
      perpRatio: 0.4, ...fromInches(1.95, 2.4, 7, 0.125) },
  },
  'single-6': {
    label: 'Standard 6-string',
    description: 'Single 25.5" scale, straight frets.',
    params: { units: 'in', numStrings: 6, numFrets: 22, mode: 'single', trebleScale: 25.5 * IN, bassScale: 25.5 * IN,
      perpRatio: 0, ...fromInches(1.75, 2.1, 6, 0.125) },
  },
});

// ---------------------------------------------------------------------------
// FretFind2D import

/**
 * Parse a FretFind2D share URL (or just its hash) into params.
 * Understands sl=single|multiple|individual, len, lenF, lenL, pDist, il[],
 * ipDist, nutWidth/bridgeWidth (outer-string centres), the overhang keys
 * (oE, oN/oB, oF/oL, oNF/oNL/oBF/oBL), numStrings, numFrets, u=in|cm|mm.
 * Returns params (mode 'custom' for individual scales). Fit them to a formula
 * with fitScales(params.customScales) if wanted.
 */
export function importFretFind(url) {
  let s = String(url || '').trim();
  const h = s.indexOf('#');
  if (h >= 0) s = s.slice(h + 1);
  else if (s.includes('?')) s = s.slice(s.indexOf('?') + 1);
  const q = new URLSearchParams(s.replace(/\+/g, '%20'));
  const one = {}, arr = {};
  for (const [kRaw, v] of q) {
    const m = /^([A-Za-z]+)\[(\d*)\]$/.exec(kRaw);
    if (m) (arr[m[1]] = arr[m[1]] || []).push([m[2] === '' ? (arr[m[1]] || []).length : Number(m[2]), v]);
    else one[kRaw] = v;
  }
  const list = k => (arr[k] || []).sort((a, b) => a[0] - b[0]).map(e => Number(e[1]))
    .concat(one[k] != null && !arr[k] ? String(one[k]).split(',').map(Number) : []).filter(isNum);
  const u = (one.u || 'in').toLowerCase();
  const f = u === 'mm' ? 1 : u === 'cm' ? 10 : IN;
  const n = v => { const x = Number(v); return isNum(x) ? x : undefined; };
  const il = list('il');
  const N = Math.max(1, Math.round(n(one.numStrings) ?? (il.length || 6)));
  const out = { units: u === 'in' ? 'in' : 'mm', numStrings: N };
  if (n(one.numFrets) != null) out.numFrets = Math.round(n(one.numFrets));
  const sl = one.sl || (il.length ? 'individual' : one.lenF ? 'multiple' : 'single');
  if (sl === 'individual') {
    const sc = il.map(v => v * f);
    while (sc.length < N) sc.push(sc.length ? sc[sc.length - 1] : 25.5 * IN);
    out.mode = 'custom'; out.customScales = sc.slice(0, N);
    out.trebleScale = out.customScales[0]; out.bassScale = out.customScales[N - 1];
    if (n(one.ipDist) != null) out.perpRatio = clamp(n(one.ipDist), 0, 1);
  } else if (sl === 'multiple') {
    out.mode = 'fan';
    if (n(one.lenF) != null) out.trebleScale = n(one.lenF) * f;
    if (n(one.lenL) != null) out.bassScale = n(one.lenL) * f;
    if (n(one.pDist) != null) out.perpRatio = clamp(n(one.pDist), 0, 1);
  } else {
    out.mode = 'single';
    if (n(one.len) != null) out.trebleScale = out.bassScale = n(one.len) * f;
    out.perpRatio = 0;
  }
  if (N > 1 && n(one.nutWidth) != null) out.nutSpacing = n(one.nutWidth) * f / (N - 1);
  if (N > 1 && n(one.bridgeWidth) != null) out.bridgeSpacing = n(one.bridgeWidth) * f / (N - 1);
  const oh = ['oE', 'oN', 'oB', 'oF', 'oL', 'oNF', 'oNL', 'oBF', 'oBL'];
  const pick = one.o === 'nutbridge' ? ['oN', 'oB'] : one.o === 'firstlast' ? ['oF', 'oL'] : one.o === 'all' ? ['oNF', 'oNL', 'oBF', 'oBL'] : one.o === 'equal' ? ['oE'] : oh;
  const ov = pick.map(k => n(one[k])).filter(v => v != null);
  if (ov.length) out.edgeMargin = Math.max(...ov) * f;
  return out;
}

// ---------------------------------------------------------------------------
// Share links: compact, versioned, tolerant

const KEYS = [
  ['u', 'units', 's'], ['n', 'numStrings', 'i'], ['f', 'numFrets', 'i'], ['m', 'mode', 's'],
  ['lt', 'trebleScale', 'n'], ['lb', 'bassScale', 'n'], ['a', 'scalar', 'n'], ['g', 'growth', 'n'],
  ['d', 'direction', 's'], ['fit', 'fitToEnds', 'b'], ['pv', 'pivot', 'n'],
  ['th', 'trebleHalf', 'h'], ['bh', 'bassHalf', 'h'], ['cs', 'customScales', 'a'],
  ['pr', 'perpRatio', 'n'], ['ns', 'nutSpacing', 'n'], ['bs', 'bridgeSpacing', 'n'],
  ['em', 'edgeMargin', 'n'], ['ext', 'boardExtension', 'n'], ['ga', 'gauges', 'a'], ['tu', 'tuning', 't'],
];
const fmt = v => String(+(+v).toFixed(4));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Params -> compact URL-hash string (only values that differ from DEFAULTS). */
export function encodeParams(params = {}) {
  const parts = ['v=2'];
  for (const [short, long, type] of KEYS) {
    const v = params[long];
    if (v === undefined || v === null || same(v, DEFAULTS[long])) continue;
    let s;
    if (type === 'n' || type === 'i') { if (!isNum(Number(v))) continue; s = fmt(v); }
    else if (type === 'b') s = v ? '1' : '0';
    else if (type === 'h') { if (!v || typeof v !== 'object') continue; s = `${fmt(num(v.scalar, 0))},${fmt(num(v.growth, 1))}`; }
    else if (type === 'a') { if (!Array.isArray(v)) continue; s = v.map(fmt).join(','); }
    else if (type === 't') { if (!Array.isArray(v)) continue; s = v.map(x => encodeURIComponent(String(x))).join(','); }
    else s = encodeURIComponent(String(v));
    if (type === 'h' && same({ scalar: +fmt(v.scalar), growth: +fmt(v.growth) }, DEFAULTS[long])) continue;
    parts.push(`${short}=${s}`);
  }
  return parts.join('&');
}

/** URL-hash string -> params merged over DEFAULTS. Never throws. */
export function decodeParams(hash) {
  const base = resolveParams({});
  try {
    let s = String(hash || '').replace(/^#/, '');
    if (!s) return base;
    if (s.startsWith('{') || s.startsWith('%7B') || s.startsWith('%7b')) {   // legacy JSON links
      const o = JSON.parse(decodeURIComponent(s));
      return resolveParams(o && typeof o === 'object' ? o : {});
    }
    const q = new URLSearchParams(s), out = {};
    for (const [short, long, type] of KEYS) {
      const raw = q.has(short) ? q.get(short) : q.has(long) ? q.get(long) : null;
      if (raw == null) continue;
      if (type === 'n' || type === 'i') { const x = Number(raw); if (isNum(x)) out[long] = type === 'i' ? Math.round(x) : x; }
      else if (type === 'b') out[long] = raw === '1' || raw === 'true';
      else if (type === 'h') { const [a, g] = raw.split(',').map(Number); if (isNum(a) && isNum(g)) out[long] = { scalar: a, growth: g }; }
      else if (type === 'a') { const v = raw.split(',').map(Number).filter(isNum); if (v.length) out[long] = v; }
      else if (type === 't') { const v = raw.split(',').map(x => { const d = decodeURIComponent(x); return /^-?\d+(\.\d+)?$/.test(d) ? Number(d) : d; }); if (v.length) out[long] = v; }
      else out[long] = decodeURIComponent(raw);
    }
    if (out.numStrings != null) out.numStrings = clamp(out.numStrings, 1, 1000);
    if (out.numFrets != null) out.numFrets = clamp(out.numFrets, 0, 60);
    return resolveParams(out);
  } catch {
    return base;
  }
}

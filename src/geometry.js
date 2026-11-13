// geometry.js — pure math for the Curved Fret Designer. No DOM, no three.js.
// FIRST-PASS SCAFFOLD written by the lead so the UI can start immediately.
// The math agent owns this file and will replace/extend it (see docs/CONTRACT.md).
// Conventions: mm; string i=0 is treble; +x toward bass; y=0 is the perpendicular
// line, +y toward the bridge.

const IN = 25.4;

// Mark's 9-string from FretFind2D link #2 (convergent "C-scale", 25.5"–29.99").
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
  fitToEnds: false,
  pivot: 4,
  trebleHalf: { scalar: 9, growth: 1.32 },
  bassHalf: { scalar: 9, growth: 1.32 },
  customScales: MARK_9,
  perpRatio: 0.5,
  nutSpacing: (2.5 - 2 * 0.09375) / 8 * IN,
  bridgeSpacing: (3.25 - 2 * 0.09375) / 8 * IN,
  edgeMargin: 0.09375 * IN,
  boardExtension: 0.25 * IN,
  gauges: null,
});

export function defaultGauges(n) {
  const lo = 0.009, hi = Math.min(0.009 * Math.pow(1.32, Math.max(n - 1, 0)), 0.2);
  return Array.from({ length: n }, (_, i) =>
    n === 1 ? lo : +(lo * Math.pow(hi / lo, i / (n - 1))).toFixed(4));
}

export function scaleLengths(params) {
  const p = { ...DEFAULTS, ...params };
  const N = p.numStrings;
  switch (p.mode) {
    case 'single': return Array(N).fill(p.trebleScale);
    case 'fan': {
      const step = N > 1 ? (p.bassScale - p.trebleScale) / (N - 1) : 0;
      return Array.from({ length: N }, (_, i) => p.trebleScale + step * i);
    }
    case 'exponential': {
      // L[n] = L[n-1] + scalar * growth^(n-1), anchored at treble (toBass) or bass (toTreble).
      let scalar = p.scalar;
      if (p.fitToEnds && N > 1) {
        let sum = 0; for (let k = 0; k < N - 1; k++) sum += Math.pow(p.growth, k);
        scalar = (p.bassScale - p.trebleScale) / sum;
      }
      const out = new Array(N);
      if (p.direction === 'toTreble') {
        out[N - 1] = p.bassScale;
        for (let k = 1; k < N; k++) out[N - 1 - k] = out[N - k] - scalar * Math.pow(p.growth, k - 1);
      } else {
        out[0] = p.trebleScale;
        for (let k = 1; k < N; k++) out[k] = out[k - 1] + scalar * Math.pow(p.growth, k - 1);
      }
      return out;
    }
    case 'custom':
    default: {
      // TODO(math agent): divergent / convergent / s-curve. Fall back to custom, padded/trimmed.
      const c = p.customScales || [];
      return Array.from({ length: N }, (_, i) => c[i] ?? c[c.length - 1] ?? p.trebleScale);
    }
  }
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Centripetal-ish Catmull-Rom through points, `per` samples per segment.
function smooth(pts, per = 12) {
  if (pts.length < 3) return pts.slice();
  const out = [];
  for (let s = 0; s < pts.length - 1; s++) {
    const p0 = pts[Math.max(s - 1, 0)], p1 = pts[s], p2 = pts[s + 1], p3 = pts[Math.min(s + 2, pts.length - 1)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function sagitta(curve) {
  const a = curve[0], b = curve[curve.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  let m = 0; for (const q of curve) m = Math.max(m, Math.abs((q.x - a.x) * dy - (q.y - a.y) * dx) / L);
  return m;
}

export function computeDesign(params = {}) {
  const p = { ...DEFAULTS, ...params };
  const N = Math.max(1, Math.round(p.numStrings));
  p.numStrings = N;
  const scales = scaleLengths(p);
  const gauges = p.gauges && p.gauges.length >= N ? p.gauges : defaultGauges(N);
  const nutW = (N - 1) * p.nutSpacing, brW = (N - 1) * p.bridgeSpacing;

  const strings = scales.map((L, i) => {
    const xn = -nutW / 2 + i * p.nutSpacing, xb = -brW / 2 + i * p.bridgeSpacing;
    const dx = xb - xn, dy = Math.sqrt(Math.max(L * L - dx * dx, 0));
    return { i, scale: L, gauge: gauges[i], wound: gauges[i] >= 0.02,
      nut: { x: xn, y: -p.perpRatio * dy }, bridge: { x: xb, y: (1 - p.perpRatio) * dy } };
  });

  const at = t => strings.map(s => lerp(s.nut, s.bridge, t));
  const edgeOffset = pts => {
    // Extend the end segments outward by edgeMargin (in x) to reach the board edges.
    if (pts.length < 2) return [{ x: pts[0].x - p.edgeMargin, y: pts[0].y }, ...pts, { x: pts[0].x + p.edgeMargin, y: pts[0].y }];
    const ext = (a, b) => { const k = p.edgeMargin / Math.abs(b.x - a.x || 1); return { x: b.x + (b.x - a.x) * k, y: b.y + (b.y - a.y) * k }; };
    return [ext(pts[1], pts[0]), ...pts, ext(pts[pts.length - 2], pts[pts.length - 1])];
  };
  const line = t => { const c = at(t); const curve = smooth(edgeOffset(c)); return { crossings: c, curve }; };

  const frets = [];
  for (let n = 1; n <= p.numFrets; n++) {
    const { crossings, curve } = line(1 - Math.pow(2, -n / 12));
    frets.push({ n, crossings, curve, sagitta: sagitta(curve), minRadius: Infinity, inflections: 0 });
  }
  const nut = line(0), bridge = line(1);
  const tEnd = 1 - Math.pow(2, -p.numFrets / 12);
  const boardEnd = { curve: smooth(edgeOffset(strings.map(s => {
    const d = Math.hypot(s.bridge.x - s.nut.x, s.bridge.y - s.nut.y) || 1;
    return lerp(s.nut, s.bridge, tEnd + p.boardExtension / d);
  }))) };
  const outline = [...nut.curve, ...boardEnd.curve.slice().reverse()];

  const warnings = [];
  if (scales.some(L => !(L > 0))) warnings.push({ level: 'error', message: 'A string has a non-positive scale length.' });
  return {
    params: p, strings, frets, nut, bridge, boardEnd, outline,
    widths: { nut: nutW + 2 * p.edgeMargin, bridge: brW + 2 * p.edgeMargin },
    metrics: { maxSagitta: Math.max(...frets.map(f => f.sagitta)), minRadius: Infinity,
      scaleRange: [Math.min(...scales), Math.max(...scales)] },
    warnings,
  };
}

export function encodeParams(params) {
  const diff = {};
  for (const [k, v] of Object.entries(params)) if (JSON.stringify(v) !== JSON.stringify(DEFAULTS[k])) diff[k] = v;
  return encodeURIComponent(JSON.stringify(diff));
}
export function decodeParams(hash) {
  try { return { ...DEFAULTS, ...JSON.parse(decodeURIComponent(hash.replace(/^#/, ''))) }; }
  catch { return { ...DEFAULTS }; }
}

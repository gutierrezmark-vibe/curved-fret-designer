// tempered.js: the "Tempered" fret mode (True-Temperament-style frets).
// Pure math, no DOM, no three.js. Only geometry.js imports it, and only the
// 'tempered' mode calls it, so every other mode is untouched by this file.
//
// A tempered fret is moved a little, separately under every string, for two
// reasons (the same two layers True Temperament describes):
//   1. Temperament: each note gets a target pitch in cents from 12-TET.
//      Thidell Formula 1 uses the offsets that True Temperament publishes.
//   2. Fretting compensation (optional): pressing a string onto a fret
//      stretches it (tension rises), and a stiff string sounds sharp. Both
//      are predicted with a physics model, then the fret is moved so the note
//      sounds its target. True Temperament measures this on real instruments;
//      here it is an estimate driven by action, finger pressure and gauge.
// The per-string positions are then joined into one continuous fret: flat
// under each string (patent US 7,728,210 style) with smooth C2 transitions
// in the gaps, or a smooth spline through every point.
//
// Conventions follow geometry.js: mm, string i = 0 is the treble.

const IN = 25.4;
export const TEMPERAMENTS = Object.freeze([
  { id: 'tf1', label: 'Thidell Formula 1', hint: 'True Temperament’s published well temperament: sweeter thirds, fifths kept in tune.' },
  { id: 'equal', label: 'Equal (compensated)', hint: 'Plain 12-TET targets. Frets move only to cancel fretting sharpness.' },
]);

// Thidell Formula 1, cents from 12-TET, by pitch class (C = 0).
const TF1_PC = [+2, -4, +2, -4, -2, 0, -4, +4, -4, 0, -4, -1];
// Open strings are tuned to their own published offsets (by MIDI number).
const TF1_OPEN = { 64: -1, 59: -1, 55: +4, 50: +2, 45: 0, 40: -2, 35: -4, 30: -8 };
const pc = m => ((Math.round(m) % 12) + 12) % 12;
/** The published Thidell Formula 1 data (read-only), for the paper and any table. */
export const TF1 = Object.freeze({ notes: Object.freeze(TF1_PC.slice()), open: Object.freeze({ ...TF1_OPEN }) });

/** Target offset (cents from 12-TET) for a note, and for an open string. */
export function noteOffset(temperament, midi) { return temperament === 'tf1' ? TF1_PC[pc(midi)] : 0; }
export function openOffset(temperament, midi) {
  if (temperament !== 'tf1') return 0;
  return TF1_OPEN[Math.round(midi)] ?? TF1_PC[pc(midi)];
}

// Fixed physical constants for the compensation model.
const PHYS = Object.freeze({
  E: 2.0e11,          // steel Young's modulus, Pa
  coreRatio: 0.42,    // wound strings: core / outer diameter (core carries stretch and bending)
  fretHeight: 1.2,    // crown above the board, mm (matches the 3D renderer)
  nutClear: 0.5,      // string above the fret-top plane at the nut, mm
  deadLength: 160,    // string beyond nut and saddle sharing the stretch, mm
  clamp: 0.5,         // stiffness term scale: real saddles/frets are not rigid clamps (calibrated to typical setbacks)
});

const cents = r => 1200 * Math.log2(r);
const tet = (L, n) => L * (1 - Math.pow(2, -n / 12));

/**
 * Pitch, in cents above the open string, of string `st` fretted with the
 * crown at x mm from the nut, saddle at S mm, previous fret at xPrev.
 */
function frettedCents(st, x, S, xPrev, opt) {
  const a = Math.min(opt.fingerDepth, PHYS.fretHeight), b = PHYS.nutClear;
  const x12 = st.scale / 2, slope = (st.action - b) / x12, s0 = b + slope * S;
  const rest = Math.hypot(S, s0 - b);
  const xf = (xPrev + x) / 2;
  const path = Math.hypot(xf, b + a) + Math.hypot(x - xf, a) + Math.hypot(S - x, s0);
  const T = st.T0 + st.EA * (path - rest) / (rest + PHYS.deadLength);
  const Lv = Math.hypot(S - x, s0) / 1000, L0 = rest / 1000;
  const stiff = (T_, L) => { const e = PHYS.clamp * Math.sqrt(st.EI / T_) / L; return 1 + 2 * e + 4 * e * e; };
  // f = sqrt(T/mu)/(2L) * stiffness; mu cancels in the ratio.
  return cents((Math.sqrt(T) / Lv * stiff(T, Lv)) / (Math.sqrt(st.T0) / L0 * stiff(st.T0, L0)));
}

function solveX(st, n, S, target, xPrev, opt) {
  let x0 = tet(S, n), x1 = x0 + 0.5;
  let g0 = frettedCents(st, x0, S, xPrev, opt) - target;
  for (let k = 0; k < 40; k++) {
    const g1 = frettedCents(st, x1, S, xPrev, opt) - target;
    if (Math.abs(g1) < 1e-7 || g1 === g0) break;
    const x2 = x1 - g1 * (x1 - x0) / (g1 - g0);
    x0 = x1; g0 = g1; x1 = x2;
  }
  return x1;
}

/**
 * Per-string fret positions.
 * strings: [{ scale, gauge (in), wound, midi, tensionN }] (treble first)
 * opt: { temperament, compensate, actionTreble, actionBass, fingerDepth, numFrets }
 * Returns { shifts[n-1][i] (mm along the string, + = toward the bridge, vs
 * plain 12-TET on the nominal scale), setbacks[i] (mm), targets[i][n-1]
 * (cents above the open string), plainError[i][n-1] (cents a plain fret
 * would be off after the saddle is set) }.
 */
export function temperedLayout(strings, opt) {
  const N = strings.length, F = Math.max(0, opt.numFrets);
  const shifts = Array.from({ length: F }, () => new Array(N).fill(0));
  const setbacks = new Array(N).fill(0), targets = [], plainError = [];
  strings.forEach((s, i) => {
    const L = s.scale, f0 = 440 * Math.pow(2, (s.midi - 69) / 12);
    const T0 = Math.max(s.tensionN, 1e-3);
    const dCore = (s.wound ? PHYS.coreRatio : 1) * s.gauge * IN / 1000;
    const st = {
      scale: L, T0, mu: T0 / Math.pow(2 * L / 1000 * f0, 2),
      EA: PHYS.E * Math.PI * dCore * dCore / 4, EI: PHYS.E * Math.PI * Math.pow(dCore, 4) / 64,
      action: opt.actionTreble + (opt.actionBass - opt.actionTreble) * (N > 1 ? i / (N - 1) : 0.5),
    };
    const open = openOffset(opt.temperament, s.midi);
    const tg = [], pe = [];
    for (let n = 1; n <= F; n++) tg.push(100 * n + noteOffset(opt.temperament, s.midi + n) - open);
    targets.push(tg);
    // Very slack strings (extreme extended-range tunings) fall outside the model: temperament only.
    if (!opt.compensate || s.tensionN < 5) {
      // Ideal string: the speaking length alone sets the pitch.
      for (let n = 1; n <= F; n++) shifts[n - 1][i] = L * (1 - Math.pow(2, -tg[n - 1] / 1200)) - tet(L, n);
      plainError.push(new Array(F).fill(0));
      return;
    }
    // Saddle: set back until a plain 12th fret plays a true octave (a normal setup).
    let S = L;
    if (F >= 12) for (let k = 0; k < 30; k++) S += (frettedCents(st, tet(L, 12), S, tet(L, 11), opt) - 1200) * S * Math.LN2 / 1200;
    else for (let k = 0; k < 30; k++) { const m = Math.max(1, F); S += (frettedCents(st, tet(L, m), S, tet(L, m - 1), opt) - 100 * m) * S * Math.LN2 / 1200; }
    setbacks[i] = S - L;
    let xp = 0, xq = 0;
    for (let n = 1; n <= F; n++) {
      const xPlain = tet(L, n);
      pe.push(frettedCents(st, xPlain, S, xq, opt) - 100 * n); xq = xPlain;
      const x = solveX(st, n, S, tg[n - 1], xp, opt);
      shifts[n - 1][i] = x - xPlain; xp = x;
    }
    plainError.push(pe);
  });
  return { shifts, setbacks, targets, plainError };
}

// C2 blend 0 -> 1 (smootherstep). Peak |y''| = 10/sqrt(3) for unit width.
const smoother = u => u * u * u * (u * (6 * u - 15) + 10);
const SMOOTHER_K = 10 / Math.sqrt(3);

/** Natural cubic spline through (k, y[k]); linear beyond the ends. */
function naturalSpline(y) {
  const n = y.length;
  if (n === 1) return () => y[0];
  if (n === 2) return s => y[0] + (y[1] - y[0]) * s;
  const m = new Array(n).fill(0), c = new Array(n).fill(0), d = new Array(n).fill(0), b = new Array(n).fill(4);
  for (let k = 1; k < n - 1; k++) d[k] = 6 * (y[k + 1] - 2 * y[k] + y[k - 1]);
  for (let k = 1; k < n - 1; k++) c[k] = 1;
  for (let k = 2; k < n - 1; k++) { const w = 1 / b[k - 1]; b[k] -= w; d[k] -= w * d[k - 1]; }
  for (let k = n - 2; k >= 1; k--) m[k] = (d[k] - (k < n - 2 ? m[k + 1] : 0)) / b[k];
  const seg = (k, u) => (1 - u) * y[k] + u * y[k + 1] + (((1 - u) ** 3 - (1 - u)) * m[k] + (u ** 3 - u) * m[k + 1]) / 6;
  const slope0 = (y[1] - y[0]) - (2 * m[0] + m[1]) / 6, slope1 = (y[n - 1] - y[n - 2]) + (m[n - 2] + 2 * m[n - 1]) / 6;
  return s => {
    if (s <= 0) return y[0] + slope0 * s;
    if (s >= n - 1) return y[n - 1] + slope1 * (s - (n - 1));
    const k = Math.min(n - 2, Math.floor(s));
    return seg(k, s - k);
  };
}

/**
 * The fret shape across the strings: a function of string index s -> shift
 * in mm. 'segments': flat for a while under each string, then a C2 blend in
 * the gap, as wide as needed so the bend radius stays >= minRadius (mm).
 * gapMm is the string spacing at this fret. Beyond the outer strings the
 * fret stays flat (segments) or continues straight (smooth).
 */
export function fretShape(shifts, gapMm, { style = 'segments', minRadius = 2.5, flatMax = 0.3 } = {}) {
  const N = shifts.length;
  if (style === 'smooth') return naturalSpline(shifts);
  if (N === 1) return () => shifts[0];
  const flats = [];
  for (let k = 0; k < N - 1; k++) {
    const h = Math.abs(shifts[k + 1] - shifts[k]);
    const w = Math.sqrt(SMOOTHER_K * h * minRadius);   // blend width for the target radius
    flats.push(Math.max(0, Math.min(flatMax, (gapMm - w) / 2 / gapMm)));
  }
  return s => {
    if (s <= 0) return shifts[0];
    if (s >= N - 1) return shifts[N - 1];
    const k = Math.min(N - 2, Math.floor(s)), u = s - k, a = flats[k];
    if (u <= a) return shifts[k];
    if (u >= 1 - a) return shifts[k + 1];
    return shifts[k] + (shifts[k + 1] - shifts[k]) * smoother((u - a) / (1 - 2 * a));
  };
}

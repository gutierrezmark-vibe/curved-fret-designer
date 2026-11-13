// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, PRESETS, MODES, computeDesign, scaleLengths, scaleProfile, defaultGauges, fitScales,
  importFretFind, encodeParams, decodeParams, fretFraction, seriesSum,
} from '../src/geometry.js';
import { exportSVG, exportDXF, exportPDF, exportCSV } from '../src/exports.js';

const IN = 25.4;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a} (tol ${tol})`);

// Mark's three FretFind2D boards (inches).
const BOARD_A = [25.5, 25.614, 25.77, 26.019, 26.367, 26.872, 27.6, 28.665];
const BOARD_B = [25.5, 25.85, 26.32, 26.939, 27.754, 28.56, 29.17, 29.64, 29.99];
const BOARD_C = [25.5, 26.052, 26.56, 27.051, 27.5025, 27.9245, 28.319, 28.688];

// A spread of designs covering every mode, odd/even counts and perp ratios.
const CASES = [
  ...Object.entries(PRESETS).map(([k, v]) => [k, v.params]),
  ['defaults', {}],
  ['exp toTreble', { mode: 'exponential', direction: 'toTreble', numStrings: 7, growth: 1.2, bassScale: 28 * IN }],
  ['divergent even', { mode: 'divergent', numStrings: 8, pivot: 3.5, growth: 0.85, bassScale: 28 * IN }],
  ['convergent uneven', { mode: 'convergent', numStrings: 10, pivot: 6, trebleHalf: { scalar: 5, growth: 1.2 }, bassHalf: { scalar: 12, growth: 1.1 }, bassScale: 29 * IN }],
  ['s-curve asym', { mode: 's-curve', numStrings: 11, pivot: 3, trebleHalf: { scalar: 9, growth: 1.25 }, bassHalf: { scalar: 9, growth: 1.1 }, bassScale: 30 * IN, perpRatio: 0.2 }],
  ['perp nut', { mode: 'exponential', numStrings: 8, perpRatio: 0 }],
  ['perp bridge', { mode: 'exponential', numStrings: 8, perpRatio: 1 }],
];

test('every string is exactly its scale length, nut to bridge', () => {
  for (const [name, p] of CASES) {
    const d = computeDesign(p);
    const sc = scaleLengths(p);
    d.strings.forEach((s, i) => {
      near(dist(s.nut, s.bridge), s.scale, 1e-9, `${name} string ${i}`);
      near(s.scale, sc[i], 1e-9, `${name} scaleLengths ${i}`);
    });
  }
});

test('fret crossings lie exactly on their strings at 1 - 2^(-n/12)', () => {
  for (const [name, p] of CASES) {
    const d = computeDesign(p);
    for (const f of d.frets) d.strings.forEach((s, i) => {
      const c = f.crossings[i];
      const ux = (s.bridge.x - s.nut.x) / s.scale, uy = (s.bridge.y - s.nut.y) / s.scale;
      const off = Math.abs((c.x - s.nut.x) * uy - (c.y - s.nut.y) * ux);
      assert.ok(off < 1e-9, `${name} fret ${f.n} string ${i} off-string by ${off}`);
      near(dist(s.nut, c), s.scale * fretFraction(f.n), 1e-9, `${name} fret ${f.n} string ${i}`);
    });
  }
});

test('fret curves pass exactly through every crossing and end on the board edges', () => {
  for (const [name, p] of CASES) {
    const d = computeDesign(p);
    for (const f of [...d.frets, { n: 0, ...d.nut }]) {
      for (const c of f.crossings) {
        const m = Math.min(...f.curve.map(q => dist(q, c)));
        assert.ok(m < 1e-9, `${name} fret ${f.n} curve misses a crossing by ${m}`);
      }
      // Edge points sit on the straight board edges.
      const [ta, tb] = d.edges.treble, [ba, bb] = d.edges.bass;
      const onLine = (P, a, b) => Math.abs((b.x - a.x) * (P.y - a.y) - (b.y - a.y) * (P.x - a.x)) / dist(a, b);
      assert.ok(onLine(f.curve[0], ta, tb) < 1e-6, `${name} fret ${f.n} treble end`);
      assert.ok(onLine(f.curve[f.curve.length - 1], ba, bb) < 1e-6, `${name} fret ${f.n} bass end`);
    }
  }
});

test('fret 12 is at half scale on every string', () => {
  for (const [name, p] of CASES) {
    const d = computeDesign({ ...p, numFrets: 24 });
    const f12 = d.frets[11];
    d.strings.forEach((s, i) => near(dist(s.nut, f12.crossings[i]), s.scale / 2, 1e-9, `${name} string ${i}`));
  }
});

test('the perp fraction of every string sits at y = 0', () => {
  for (const r of [0, 0.25, 0.5, 0.7, 1]) {
    const d = computeDesign({ ...PRESETS['mark-a'].params, perpRatio: r });
    for (const s of d.strings) near(s.nut.y + r * (s.bridge.y - s.nut.y), 0, 1e-9, `perp ${r}`);
    if (r === 0.5) {
      for (const c of d.frets[11].crossings) near(c.y, 0, 1e-9, 'fret 12 on the perp line');
      assert.equal(d.frets[11].inflections, 0);
      assert.ok(d.frets[11].sagitta < 1e-9);
    }
  }
});

test('fret curvature flips sign across the perpendicular fret', () => {
  const d = computeDesign(PRESETS['mark-a'].params); // perp at fret 12
  const s1 = d.frets[0].signedSagitta, s24 = d.frets[23].signedSagitta;
  assert.ok(s1 * s24 < 0, `fret 1 (${s1}) and fret 24 (${s24}) should bow opposite ways`);
  assert.ok(Math.sign(d.nut.signedSagitta) === Math.sign(s1));
});

test("Mark's boards A, B and C are reproduced", () => {
  const check = (key, board, tolMm) => {
    const sc = scaleLengths(PRESETS[key].params);
    assert.equal(sc.length, board.length);
    sc.forEach((L, i) => near(L, board[i] * IN, tolMm, `${key} string ${i + 1}`));
  };
  // FretFind values were typed to 2-3 decimals (some truncated), so the
  // formula presets agree to a quarter millimetre (0.01").
  check('mark-a', BOARD_A, 0.26);
  check('mark-b', BOARD_B, 0.26);
  check('mark-c', BOARD_C, 0.26);
  check('mark-b-built', BOARD_B, 1e-9);
});

test('reverse fits recover the formulas behind boards A, B and C', () => {
  const fa = fitScales(BOARD_A.map(v => v * IN)), fb = fitScales(BOARD_B.map(v => v * IN)), fc = fitScales(BOARD_C.map(v => v * IN));
  assert.equal(fa.best.mode, 'exponential'); near(fa.best.params.growth, 1.45, 0.01); near(fa.best.params.scalar, 2.9, 0.1);
  assert.equal(fc.best.mode, 'exponential'); near(fc.best.params.growth, 0.935, 0.01); near(fc.best.params.scalar, 14.025, 0.1);
  const conv = fb.fits.find(f => f.mode === 'convergent');
  near(conv.params.trebleHalf.growth, 1.32, 0.01); near(conv.params.pivot, 4, 0); near(conv.params.trebleHalf.scalar, 9, 0.1);
  assert.ok(conv.maxErr < 0.2);
  assert.ok(fb.fits.find(f => f.mode === 'exponential').maxErr > 4, 'B is not a single exponential');
});

test('fitToEnds hits both end scales exactly in every formula mode', () => {
  for (const mode of ['fan', 'exponential', 'divergent', 'convergent', 's-curve']) for (const N of [2, 5, 8, 9]) for (const dir of ['toBass', 'toTreble']) {
    const p = { mode, numStrings: N, direction: dir, fitToEnds: true, pivot: (N - 1) / 2, trebleScale: 640, bassScale: 760,
      growth: 1.2, trebleHalf: { scalar: 7, growth: 1.15 }, bassHalf: { scalar: 11, growth: 1.25 } };
    const sc = scaleLengths(p);
    near(sc[0], 640, 1e-9, `${mode} N${N} ${dir} treble`);
    near(sc[N - 1], 760, 1e-9, `${mode} N${N} ${dir} bass`);
  }
});

test('the formula matches the RTF/spreadsheet: L[n] = L[n-1] + scalar * growth^(n-1)', () => {
  // Spreadsheet "Works 24": 609.6 mm, scalar 9, growth 1.2.
  const sc = scaleLengths({ mode: 'exponential', numStrings: 9, fitToEnds: false, trebleScale: 609.6, scalar: 9, growth: 1.2 });
  near(sc[8], 758.0917632, 1e-6);
  // C-scale from the RTF: treble series reaches 704.961312 at string 5, bass series 704.738688.
  const c = scaleProfile({ mode: 'convergent', numStrings: 9, pivot: 4, fitToEnds: false, trebleScale: 647.7, bassScale: 762,
    trebleHalf: { scalar: 9, growth: 1.32 }, bassHalf: { scalar: 9, growth: 1.32 } });
  near(c.scales[4], 704.961312, 1e-6);
  near(c.scales[5], 725.4384, 1e-6);
  near(c.junction.gap, 704.738688 - 704.961312, 1e-6);
  near(seriesSum(3, 1), 3, 0);
});

test('S-curve presets have an inflection, and it lands on the pivot', () => {
  for (const key of ['s-curve-8', 's-curve-12', 'mark-b', 'd-scale-9']) {
    const d = computeDesign(PRESETS[key].params);
    const piv = d.profile.pivot;
    for (const f of d.frets) {
      if (Math.abs(f.t - d.params.perpRatio) < 0.02) continue; // frets at the perp line are straight
      assert.ok(f.inflections > 0, `${key} fret ${f.n} has no inflection`);
      assert.ok(f.inflectionPoints.some(q => Math.abs(q.s - piv) < 0.15), `${key} fret ${f.n} inflects at ${f.inflectionPoints.map(q => q.s)}`);
    }
    assert.ok(d.nut.inflections > 0);
    assert.ok(d.metrics.inflectingFrets >= d.frets.length - 2);
  }
  // Exponential boards bend one way only.
  assert.equal(computeDesign(PRESETS['mark-a'].params).metrics.inflectingFrets, 0);
});

test('s-curve with fitToEnds is smooth (C1) at the pivot', () => {
  const p = { mode: 's-curve', numStrings: 9, pivot: 3, fitToEnds: true, trebleScale: 640, bassScale: 770, trebleHalf: { scalar: 1, growth: 0.8 }, bassHalf: { scalar: 1, growth: 0.9 } };
  const { at } = scaleProfile(p), h = 1e-6;
  const left = (at(3) - at(3 - h)) / h, right = (at(3 + h) - at(3)) / h;
  near(left, right, 1e-3 * Math.abs(left));
});

test('1, 2, 6, 12, 18 and 24 strings all produce finite geometry', () => {
  for (const N of [1, 2, 6, 12, 18, 24]) for (const mode of MODES) {
    const d = computeDesign({ numStrings: N, mode, pivot: (N - 1) / 2, nutSpacing: 7.5, bridgeSpacing: 9.5 });
    const all = [...d.outline, ...d.nut.curve, ...d.bridge.curve, ...d.boardEnd.curve, ...d.frets.flatMap(f => [...f.curve, ...f.crossings]), ...d.strings.flatMap(s => [s.nut, s.bridge])];
    assert.ok(all.every(q => Number.isFinite(q.x) && Number.isFinite(q.y)), `N=${N} ${mode}`);
    assert.equal(d.strings.length, N);
    assert.ok(d.frets.every(f => f.curve.length >= 3 && Number.isFinite(f.sagitta) && f.minRadius > 0));
    assert.ok(Number.isFinite(d.metrics.maxSagitta));
    assert.ok(!d.warnings.some(w => w.level === 'error'), `N=${N} ${mode}: ${JSON.stringify(d.warnings)}`);
    if (N <= 2) assert.ok(d.frets.every(f => f.inflections === 0));
  }
});

test('board widths and edges follow nutSpacing, bridgeSpacing and edgeMargin', () => {
  const d = computeDesign({ numStrings: 7, nutSpacing: 7, bridgeSpacing: 10, edgeMargin: 3 });
  near(d.widths.nut, 6 * 7 + 6, 1e-9);
  near(d.widths.bridge, 6 * 10 + 6, 1e-9);
  near(d.nut.curve[0].x, d.strings[0].nut.x - 3, 1e-6);
  near(d.nut.curve[d.nut.curve.length - 1].x, d.strings[6].nut.x + 3, 1e-6);
});

test('defaultGauges suits any string count', () => {
  for (const n of [0, 1, 6, 9, 24]) {
    const g = defaultGauges(n);
    assert.equal(g.length, n);
    for (let i = 1; i < n; i++) assert.ok(g[i] >= g[i - 1]);
    assert.ok(g.every(v => v >= 0.009 && v <= 0.1));
  }
  assert.deepEqual(defaultGauges(6), [0.009, 0.011, 0.016, 0.024, 0.032, 0.042]);
  const d = computeDesign({ numStrings: 6, mode: 'single' });
  assert.deepEqual(d.strings.map(s => s.wound), [false, false, false, true, true, true]);
  near(d.strings[0].tensionLb, 13.1, 0.3); // .009 E4 at 25.5" is about 13.1 lb
});

test('warnings: steep growth, non-monotonic scales, cramped frets', () => {
  const lv = (p, re) => computeDesign(p).warnings.find(w => re.test(w.message));
  assert.ok(lv({ mode: 'exponential', numStrings: 8, growth: 1.6, bassScale: 28 * IN }, /growth/).level === 'warn');
  assert.ok(lv({ mode: 'custom', numStrings: 4, customScales: [650, 660, 655, 670] }, /monotonic/));
  assert.ok(lv({ mode: 'single', numStrings: 4, trebleScale: 330, numFrets: 24 }, /apart/));
  assert.ok(!lv(PRESETS['s-curve-8'].params, /monotonic/));
});

test('encodeParams / decodeParams round-trip and survive junk', () => {
  for (const [, p] of Object.entries(PRESETS)) {
    const h = encodeParams({ ...DEFAULTS, ...p.params });
    assert.ok(h.length < 400, `hash too long: ${h.length}`);
    const back = decodeParams('#' + h);
    const a = computeDesign(p.params), b = computeDesign(back);
    a.strings.forEach((s, i) => near(b.strings[i].scale, s.scale, 1e-3));
    assert.equal(back.mode, a.params.mode);
  }
  assert.equal(encodeParams(DEFAULTS), 'v=2');
  assert.equal(decodeParams('').numStrings, DEFAULTS.numStrings);
  assert.equal(decodeParams('#%%%garbage{{').numStrings, DEFAULTS.numStrings);
  assert.equal(decodeParams('#n=abc&m=nonsense&g=1.2').growth, 1.2);
  // legacy JSON links from the scaffold still open
  assert.equal(decodeParams(encodeURIComponent(JSON.stringify({ numStrings: 7 }))).numStrings, 7);
  const t = decodeParams(encodeParams({ tuning: ['F#1', 'E4'], gauges: [0.01, 0.07] }));
  assert.deepEqual(t.tuning, ['F#1', 'E4']);
});

test('importFretFind reads a FretFind2D share link', () => {
  const il = BOARD_B.map(v => `il%5B%5D=${v}`).join('&');
  const url = `https://acspike.github.io/FretFind2D/src/fretfind.html#u=in&sl=individual&ipDist=0.5&nutWidth=2.5&bridgeWidth=3.25&oE=0.09375&o=equal&numFrets=24&numStrings=9&${il}`;
  const p = importFretFind(url);
  assert.equal(p.mode, 'custom');
  assert.equal(p.numStrings, 9);
  assert.equal(p.numFrets, 24);
  near(p.perpRatio, 0.5, 0);
  near(p.nutSpacing, 2.5 / 8 * IN, 1e-9);
  near(p.bridgeSpacing, 3.25 / 8 * IN, 1e-9);
  near(p.edgeMargin, 0.09375 * IN, 1e-9);
  p.customScales.forEach((L, i) => near(L, BOARD_B[i] * IN, 1e-9));
  const fan = importFretFind('#sl=multiple&lenF=650&lenL=690&pDist=0.3&u=mm&numStrings=7&nutWidth=48');
  assert.equal(fan.mode, 'fan'); near(fan.bassScale, 690, 0); near(fan.nutSpacing, 8, 1e-9);
});

test('exports produce valid-looking files', () => {
  for (const key of ['mark-b', 's-curve-12', 'single-6']) {
    const d = computeDesign(PRESETS[key].params);

    const svg = exportSVG(d);
    assert.equal(svg.mime, 'image/svg+xml');
    assert.ok(svg.data.startsWith('<?xml') && /<svg [^>]*width="[\d.]+mm"/.test(svg.data) && svg.data.trim().endsWith('</svg>'));
    // XML-ish: every opened element is closed, in order.
    const stack = [];
    for (const m of svg.data.replace(/<\?xml[^>]*>/, '').matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
      if (m[3]) continue;
      if (m[1]) assert.equal(stack.pop(), m[2]); else stack.push(m[2]);
    }
    assert.equal(stack.length, 0);
    assert.equal((svg.data.match(/data-fret=/g) || []).length, d.frets.length);

    const dxf = exportDXF(d).data.split('\r\n');
    assert.equal(dxf[0], '0'); assert.equal(dxf[1], 'SECTION');
    assert.ok(dxf.includes('ENTITIES') && dxf.includes('POLYLINE'));
    assert.equal(dxf[dxf.length - 2], 'EOF');

    const pdf = exportPDF(d);
    const s = Array.from(pdf.data, c => String.fromCharCode(c)).join('');
    assert.ok(s.startsWith('%PDF-1.'));
    assert.ok(s.trimEnd().endsWith('%%EOF'));
    const sx = Number(/startxref\n(\d+)/.exec(s)[1]);
    assert.equal(s.slice(sx, sx + 4), 'xref');
    // each xref entry points at its object
    const entries = s.slice(sx).split('\n').slice(3).filter(l => / 00000 n $/.test(l)).map(l => Number(l.slice(0, 10)));
    entries.forEach((off, i) => assert.ok(s.startsWith(`${i + 1} 0 obj`, off), `object ${i + 1}`));
    assert.ok(pdf.pages >= 2 && /\/Count \d+/.test(s));

    const csv = exportCSV(d).data.trim().split('\r\n');
    assert.equal(csv.length, 1 + d.strings.length * (d.frets.length + 2));
    const row12 = csv.find(r => r.startsWith('1,') && r.split(',')[5] === '12').split(',');
    near(Number(row12[6]), d.strings[0].scale / 2, 1e-3);
  }
});

test('SVG imports 1:1 in CAD that reads px at 96 dpi (Autodesk Fusion), with no dashed lines', async () => {
  const E = await import('../src/exports.js');
  const d = computeDesign(PRESETS['mark-b'].params);
  const svg = E.exportSVG(d).data;
  const m = svg.match(/width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  assert.ok(m, 'root svg has mm size and a viewBox');
  assert.ok(Math.abs(+m[3] / +m[1] - 96 / 25.4) < 1e-4, 'viewBox width is px at 96 dpi');
  assert.ok(Math.abs(+m[4] / +m[2] - 96 / 25.4) < 1e-4, 'viewBox height is px at 96 dpi');
  assert.ok(!/stroke-dasharray/.test(svg), 'no dash arrays (they shatter into loose segments in CAD)');
});

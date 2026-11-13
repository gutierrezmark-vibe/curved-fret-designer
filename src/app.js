// app.js — Curved Fret Designer UI. Wires the geometry engine to the 3D view,
// blueprint, charts and controls. Optional engine features are feature-detected.
import * as G from './geometry.js';
import { createBlueprint } from './blueprint.js';
import { createProfileChart, inflectionsOf } from './ui/profile.js';
import { createSlider, createSegment, createSwitch } from './ui/controls.js';
import { glyphSVG, MODES } from './ui/glyphs.js';
import { toast } from './ui/toast.js';
import { fmtLen, fmtRadius, fmtGauge, toDisp, parseLen, IN, perpFret } from './ui/units.js';
import { createPresetMenu } from './ui/presets.js';

const $ = id => document.getElementById(id);
const app = $('app');
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clone = o => JSON.parse(JSON.stringify(o));
const isMobile = () => window.matchMedia('(max-width: 820px)').matches;

// ------------------------------------------------------------ state -------
const resolve = p => (G.resolveParams ? G.resolveParams(p) : { ...G.DEFAULTS, ...p });
const prefs = (() => { try { return JSON.parse(localStorage.getItem('cfd.prefs') || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem('cfd.prefs', JSON.stringify({ view: S.view, fret: S.fret, wood: S.wood, strings: S.strings, overlay: S.overlay })); } catch { /* storage unavailable */ } };
const S = {
  params: location.hash.length > 1 ? resolve(G.decodeParams(location.hash)) : resolve({}),
  design: null, lastGood: null,
  view: prefs.view || '3d', cam: 'hero',
  fret: prefs.fret || 'nickel', wood: prefs.wood || 'wenge', strings: prefs.strings ?? true, overlay: prefs.overlay ?? true, spin: true,
  warnSeen: new Set(),
};
let R3 = null, bp = null, chart = null, X = null; // X: exports module

// Inline presets used only if the engine doesn't provide PRESETS.
const FALLBACK_PRESETS = {
  'mark-9': { label: "Mark's 9-string (as built)", description: 'FretFind2D design B, 25.5″–29.99″ convergent.', params: {} },
  'fan-7': { label: '7-string fan', description: '25.5″–27″ straight fan.', params: { numStrings: 7, mode: 'fan', trebleScale: 25.5 * IN, bassScale: 27 * IN, perpRatio: 0.4 } },
  'exp-8': { label: '8-string exponential', description: '25.5″–28.5″, growth 1.3.', params: { numStrings: 8, mode: 'exponential', fitToEnds: true, trebleScale: 25.5 * IN, bassScale: 28.5 * IN, growth: 1.3 } },
};
const PRESETS = G.PRESETS || FALLBACK_PRESETS;

// ------------------------------------------------------------ params ------
function setParam(path, value, { final = true, rebuildControls = false } = {}) {
  const p = clone(S.params);
  const keys = path.split('.');
  let o = p; for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] = { ...(o[keys[i]] || {}) };
  o[keys[keys.length - 1]] = value;
  if (path === 'numStrings') {
    const N = value;
    if (Array.isArray(p.gauges)) { const d = G.defaultGauges(N); p.gauges = Array.from({ length: N }, (_, i) => p.gauges[i] ?? d[i]); }
    if (p.mode === 'custom' && Array.isArray(p.customScales) && p.customScales.length < N && S.design) {
      // extend custom scales by continuing the last step
      const c = p.customScales.slice(), step = c.length > 1 ? c[c.length - 1] - c[c.length - 2] : 0;
      while (c.length < N) c.push(c[c.length - 1] + step);
      p.customScales = c;
    }
    p.pivot = Math.min(p.pivot, Math.max(0, N - 1));
  }
  S.params = p;
  schedule({ final });
  if (rebuildControls) buildModeParams();
}
function setMode(mode) {
  if (mode === S.params.mode) return;
  const p = clone(S.params), sc = S.design ? S.design.strings.map(s => s.scale) : null;
  if (sc) {
    if (mode === 'custom') p.customScales = sc;
    if (S.params.mode === 'custom' || S.params.mode === 'single') { p.trebleScale = sc[0]; p.bassScale = sc[sc.length - 1]; }
    if (S.params.mode === 'single' && Math.abs(p.bassScale - p.trebleScale) < 1) p.bassScale = p.trebleScale + 3 * IN;
  }
  if (['divergent', 'convergent', 's-curve'].includes(mode)) p.fitToEnds = true;
  p.mode = mode;
  S.params = resolve(p);
  buildModeParams(); refreshModes();
  schedule({ final: true });
}
function loadParams(p, { reframe = true, msg } = {}) {
  S.params = resolve(p);
  buildModeParams(); buildLayoutParams(); refreshModes(); unitSeg?.refresh();
  schedule({ final: true, reframe });
  if (msg) toast(msg, 'ok');
}

// ------------------------------------------------------------ compute -----
let rafPending = false, pendingFinal = false, pendingReframe = false, t3d = null, tHash = null, lastFrameKey = '';
function schedule({ final = false, reframe = false } = {}) {
  pendingFinal = pendingFinal || final; pendingReframe = pendingReframe || reframe;
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; const f = pendingFinal, r = pendingReframe; pendingFinal = pendingReframe = false; recompute(f, r); });
}
function recompute(final, reframe) {
  let d;
  try { d = G.computeDesign(S.params); }
  catch (err) { console.error(err); toast('The geometry engine could not build this design: ' + err.message, 'error'); return; }
  if (!d || !d.strings?.length) return;
  S.design = d;
  updateData(d, final);
  if (S.view === 'split' || S.view === 'blueprint') bp?.update(d, S.params.units);
  // 3D: debounce heavy rebuilds while dragging
  clearTimeout(t3d);
  const key = `${d.strings.length}|${Math.round(d.metrics.scaleRange[1] / 30)}|${Math.round(Math.max(d.widths.nut, d.widths.bridge) / 18)}|${d.frets.length > 0}`;
  const doReframe = reframe || (final && key !== lastFrameKey && lastFrameKey !== '');
  const push = () => { if (!R3) return; R3.setDesign(d, { animate: true }); if (doReframe || key !== lastFrameKey && reframe) R3.reframe(); lastFrameKey = key; };
  if (!R3) lastFrameKey = key;
  if (final) push(); else t3d = setTimeout(push, 70);
  clearTimeout(tHash);
  tHash = setTimeout(() => { try { history.replaceState(null, '', '#' + G.encodeParams(S.params)); } catch { /* file:// or sandbox */ } }, 450);
}

// ------------------------------------------------------------ data panel --
function updateData(d, final = true) {
  const u = S.params.units, N = d.strings.length;
  // profile
  const scales = d.strings.map(s => s.scale);
  const samples = Array.isArray(d.profile?.samples) && d.profile.samples.length > 2 ? d.profile.samples.map(q => q.L) : null;
  chart.update(scales, { pivot: d.profile?.pivot ?? S.params.pivot, mode: S.params.mode, units: u, samples });
  const infl = N > 2 ? inflectionsOf(samples || scales).length : 0;
  $('profileKind').textContent = `${(d.profile?.kind || S.params.mode).toUpperCase()}${infl ? ' · ' + infl + ' INFLECTION' + (infl > 1 ? 'S' : '') : ''}`;
  // metrics
  const m = d.metrics, sr = m.scaleRange;
  const pf = m.perpFret ?? perpFret(S.params.perpRatio);
  const tiles = [
    ['Scale range', N > 1 && sr[1] - sr[0] > 0.01 ? `${toDisp(sr[0], u).toFixed(u === 'in' ? 2 : 1)}–${toDisp(sr[1], u).toFixed(u === 'in' ? 2 : 1)}<small>${u}</small>` : `${fmtLen(sr[0], u, { suffix: false })}<small>${u}</small>`],
    ['Spread', `${fmtLen(sr[1] - sr[0], u, { suffix: false })}<small>${u}</small>`],
    ['Nut width', `${fmtLen(d.widths.nut, u, { suffix: false })}<small>${u}</small>`],
    ['Bridge width', `${fmtLen(d.widths.bridge, u, { suffix: false })}<small>${u}</small>`],
    ['Max bow', `${fmtLen(m.maxSagitta, u, { suffix: false, dp: u === 'in' ? 3 : 2 })}<small>${u}${m.maxSagittaFret ? ' · f' + m.maxSagittaFret : ''}</small>`, true],
    ['Tightest bend', `${fmtRadius(m.minRadius, u)}${m.minRadiusFret && Number.isFinite(m.minRadius) ? `<small>f${m.minRadiusFret}</small>` : ''}`],
    ['Perpendicular', Number.isFinite(pf) ? `fret ${Math.abs(pf - Math.round(pf)) < 0.01 ? Math.round(pf) : pf.toFixed(1)}` : 'bridge'],
    ['Inflecting', `${m.inflectingFrets ?? d.frets.filter(f => f.inflections > 0).length}<small>of ${d.frets.length} frets</small>`],
  ];
  $('metrics').innerHTML = tiles.map(([k, v, hi]) => `<div class="metric${hi ? ' hi' : ''}"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  // warnings
  const ws = d.warnings || [];
  $('warnBadges').innerHTML = ws.map(w => `<div class="wbadge ${w.level}"><i></i><span>${escapeHtml(w.message)}</span></div>`).join('');
  // Toast only newly appearing kinds of warning (numbers stripped), and only on committed changes.
  const kind = w => w.level + ':' + w.message.replace(/[\d.]+/g, '#');
  const now = new Set(ws.map(kind));
  if (final) {
    const fresh = ws.filter(w => w.level !== 'info' && !S.warnSeen.has(kind(w)));
    fresh.slice(0, 2).forEach(w => toast(w.message, w.level === 'error' ? 'error' : 'warn', { timeout: 6000 }));
    S.warnSeen = now;
  }
  // solved values
  const sv = d.profile?.solved || {};
  const bits = [];
  const mode = S.params.mode;
  if (S.params.fitToEnds || mode === 'fan') {
    if (sv.scalar != null && ['exponential', 'divergent', 'fan'].includes(mode)) bits.push(`${mode === 'fan' ? 'step' : 'scalar'} <b>${sv.scalar.toFixed(3)} mm</b>`);
    if (sv.trebleHalf && ['convergent', 's-curve'].includes(mode)) bits.push(`treble scalar <b>${sv.trebleHalf.scalar.toFixed(3)}</b>  ·  bass scalar <b>${sv.bassHalf.scalar.toFixed(3)} mm</b>`);
  }
  if (sv.pivotScale != null) bits.push(`pivot string scale <b>${fmtLen(sv.pivotScale, S.params.units)}</b>`);
  if (d.profile?.junction && Math.abs(d.profile.junction.gap) > 0.01) bits.push(`junction gap <b>${d.profile.junction.gap.toFixed(2)} mm</b>`);
  $('solved').innerHTML = bits.length ? 'solved  ' + bits.join('<br>') : '';
  // strings table
  renderTable(d);
  $('stringsAside').textContent = `${N} STR · ${d.strings.filter(s => s.wound).length} WOUND`;
  sliders.forEach(s => s.refresh());
  unitSeg.refresh();
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function renderTable(d) {
  const t = $('stringTable');
  if (t.contains(document.activeElement)) return; // don't stomp on typing
  const u = S.params.units, hasT = d.strings[0]?.tensionLb != null, hasNote = !!d.strings[0]?.note;
  let html = `<thead><tr><th>#</th>${hasNote ? '<th>Note</th>' : ''}<th>Scale ${u}</th><th>Gauge</th>${hasT ? '<th>lb</th>' : ''}<th>Δ</th></tr></thead><tbody>`;
  d.strings.forEach((s, i) => {
    const delta = i ? s.scale - d.strings[i - 1].scale : null;
    html += `<tr><td class="idx"><i class="${s.wound ? 'w' : ''}" title="${s.wound ? 'wound' : 'plain'}"></i>${i + 1}</td>${hasNote ? `<td class="note">${s.note || ''}</td>` : ''}
      <td><input class="cell" data-k="scale" data-i="${i}" value="${toDisp(s.scale, u).toFixed(u === 'in' ? 3 : 2)}" aria-label="String ${i + 1} scale"></td>
      <td><input class="cell g" data-k="gauge" data-i="${i}" value="${fmtGauge(s.gauge)}" aria-label="String ${i + 1} gauge"></td>
      ${hasT ? `<td>${s.tensionLb.toFixed(1)}</td>` : ''}
      <td class="delta">${delta == null ? '' : (delta >= 0 ? '+' : '') + toDisp(delta, u).toFixed(u === 'in' ? 3 : 1)}</td></tr>`;
  });
  t.innerHTML = html + '</tbody>';
}
$('stringTable').addEventListener('change', e => {
  const c = e.target.closest('.cell'); if (!c) return;
  const i = +c.dataset.i, d = S.design;
  if (c.dataset.k === 'scale') {
    const v = parseLen(c.value, S.params.units);
    if (!(v > 50)) { toast('Type a scale length, e.g. 25.5 or 648mm.', 'warn'); renderTable(d); return; }
    const sc = d.strings.map(s => s.scale); sc[i] = v;
    if (S.params.mode !== 'custom') { toast('Switched to Custom so each string can be edited.', 'info'); }
    const p = clone(S.params); p.mode = 'custom'; p.customScales = sc; S.params = resolve(p);
    buildModeParams(); refreshModes();
  } else {
    let g = parseFloat(String(c.value).replace(/^\./, '0.'));
    if (g >= 1) g = g / 1000;
    if (!(g > 0.003 && g < 0.4)) { toast('Type a gauge in inches, e.g. .046 or 46.', 'warn'); renderTable(d); return; }
    const gs = d.strings.map(s => s.gauge); gs[i] = +g.toFixed(4);
    S.params = { ...S.params, gauges: gs };
  }
  c.blur();
  schedule({ final: true });
});
$('stringTable').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('cell')) e.target.blur(); });
$('stringTable').addEventListener('focusout', () => setTimeout(() => { if (S.design && !$('stringTable').contains(document.activeElement)) renderTable(S.design); }, 0));

// ------------------------------------------------------------ controls ----
let sliders = [];
const U = () => S.params.units;
const lenSlider = (key, label, min, max, extra = {}) => createSlider({ label, kind: 'len', min, max, step: 0.254, hardMin: 0, units: U, get: () => getPath(key), set: (v, f) => setParam(key, v, { final: f }), def: () => getPath(key, G.DEFAULTS), ...extra });
const numSlider = (key, label, min, max, step, extra = {}) => createSlider({ label, kind: 'num', min, max, step, units: U, get: () => getPath(key), set: (v, f) => setParam(key, v, { final: f }), def: () => getPath(key, G.DEFAULTS), ...extra });
function getPath(path, src = S.params) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), src); }

function buildModeParams() {
  const host = $('modeParams'); host.innerHTML = '';
  sliders = sliders.filter(s => s.layout);
  const p = S.params, m = p.mode, N = p.numStrings;
  const add = c => { host.appendChild(c.el); if (c.refresh) sliders.push(c); return c; };
  const sub = t => host.appendChild(h('div', 'sub-h', t));
  const fitSwitch = () => {
    const row = h('div', 'inline-row');
    const sw = createSwitch('Fit ends', () => S.params.fitToEnds, v => setParam('fitToEnds', v, { rebuildControls: true }));
    row.appendChild(sw.el);
    if (!p.fitToEnds && ['exponential', 'divergent', 's-curve'].includes(m)) {
      const seg = createSegment([{ value: 'toBass', label: 'From treble' }, { value: 'toTreble', label: 'From bass' }], () => S.params.direction, v => setParam('direction', v, { rebuildControls: true }), { cls: 'small' });
      row.appendChild(seg.el);
    }
    host.appendChild(row);
  };
  const scaleSliders = (needBass = true) => {
    if (m === 'single') { add(lenSlider('trebleScale', 'Scale length', 300, 1000)); return; }
    const row = h('div', 'row2'); host.appendChild(row);
    const a = lenSlider('trebleScale', 'Treble', 300, 1000), b = lenSlider('bassScale', 'Bass', 300, 1000);
    row.append(a.el); sliders.push(a);
    if (needBass) { row.append(b.el); sliders.push(b); }
  };
  const growthHint = 'Each step is the previous one times this. 1 = linear fan. Mark’s notes: keep it within 0.8–1.3.';
  const pivotSlider = () => add(numSlider('pivot', 'Pivot <small>string</small>', 1, Math.max(1, N), 0.5, { get: () => S.params.pivot + 1, set: (v, f) => setParam('pivot', v - 1, { final: f }), def: () => (N - 1) / 2 + 1, dp: 1, hardMin: 1, hardMax: N, hint: 'Where the two halves meet. Halves (e.g. 4.5) put it between two strings.' }));
  if (m === 'single') scaleSliders();
  else if (m === 'fan') scaleSliders();
  else if (m === 'exponential') {
    fitSwitch();
    scaleSliders(p.fitToEnds || p.direction === 'toTreble');
    if (p.fitToEnds && p.direction === 'toTreble') { /* both used */ }
    if (!p.fitToEnds) add(numSlider('scalar', 'Scalar <small>first step</small>', -10, 30, 0.05, { suffix: 'mm', dp: 2 }));
    add(numSlider('growth', 'Growth', 0.5, 1.6, 0.005, { suffix: '×', dp: 3, hint: growthHint }));
  } else if (m === 'divergent') {
    fitSwitch(); scaleSliders(p.fitToEnds || p.direction === 'toTreble'); pivotSlider();
    if (!p.fitToEnds) add(numSlider('scalar', 'Scalar', -10, 30, 0.05, { suffix: 'mm', dp: 2 }));
    add(numSlider('growth', 'Growth', 0.5, 1.6, 0.005, { suffix: '×', dp: 3, hint: growthHint }));
  } else if (m === 'convergent' || m === 's-curve') {
    fitSwitch(); scaleSliders(m === 'convergent' || p.fitToEnds || p.direction === 'toTreble'); pivotSlider();
    sub('Treble half');
    const r1 = h('div', 'row2'); host.appendChild(r1);
    const ts = numSlider('trebleHalf.scalar', 'Scalar', 0, 30, 0.05, { suffix: 'mm', dp: 2 }), tg = numSlider('trebleHalf.growth', 'Growth', 0.5, 1.6, 0.005, { suffix: '×', dp: 3, hint: growthHint });
    if (!(m === 's-curve' && p.fitToEnds)) { r1.append(ts.el); sliders.push(ts); }
    r1.append(tg.el); sliders.push(tg);
    sub('Bass half');
    const r2 = h('div', 'row2'); host.appendChild(r2);
    const bs = numSlider('bassHalf.scalar', 'Scalar', 0, 30, 0.05, { suffix: 'mm', dp: 2 }), bg = numSlider('bassHalf.growth', 'Growth', 0.5, 1.6, 0.005, { suffix: '×', dp: 3, hint: growthHint });
    if (!(m === 's-curve' && p.fitToEnds)) { r2.append(bs.el); sliders.push(bs); }
    r2.append(bg.el); sliders.push(bg);
  } else if (m === 'custom') {
    const note = h('div', 'pop-note', 'Type each string’s scale in the Strings table. Values between strings follow a smooth spline.');
    host.appendChild(note);
    if (G.fitScales) {
      const box = h('div', 'fit-box');
      const btn = h('button', 'btn sm', '<svg viewBox="0 0 16 16"><path d="M2 12c3 0 4-8 7-8s3 5 5 5"/></svg><span>Find the formula behind these scales</span>');
      btn.onclick = () => showFits(box);
      box.appendChild(btn); host.appendChild(box);
    }
  }
}
function showFits(box) {
  const sc = S.design.strings.map(s => s.scale);
  let res;
  try { res = G.fitScales(sc); } catch (e) { toast('Fit failed: ' + e.message, 'error'); return; }
  const fits = res.fits.slice().sort((a, b) => a.complexity - b.complexity);
  box.innerHTML = `<div class="sub-h" style="margin:0 0 6px">Formula fits · max error</div>` + fits.map((f, k) => `
    <div class="fit-row"><div>${f.label}${res.best === f ? ' <b style="color:var(--accent);font-weight:500">· best</b>' : ''}<br><span>max ${f.maxErr.toFixed(2)} mm · rms ${f.rms.toFixed(2)} mm</span></div><button class="btn sm" data-k="${k}">Use</button></div>`).join('');
  box.querySelectorAll('button[data-k]').forEach(b => b.onclick = () => {
    const f = fits[+b.dataset.k];
    loadParams({ ...S.params, ...f.params, numStrings: sc.length }, { reframe: false, msg: `Now driven by the ${f.label} formula (max error ${f.maxErr.toFixed(2)} mm).` });
  });
}
function buildLayoutParams() {
  const host = $('layoutParams'); host.innerHTML = '';
  sliders = sliders.filter(s => !s.layout);
  const add = (c, parent = host) => { parent.appendChild(c.el); c.layout = true; sliders.push(c); };
  const r0 = h('div', 'row2'); host.appendChild(r0);
  add(numSlider('numStrings', 'Strings', 1, 24, 1, { kind: 'int', dp: 0, hardMin: 1, hardMax: 200, hint: 'No maximum: type any number.' }), r0);
  add(numSlider('numFrets', 'Frets', 0, 36, 1, { kind: 'int', dp: 0, hardMin: 0, hardMax: 60 }), r0);
  add(numSlider('perpRatio', 'Perpendicular <small>0 nut · 1 bridge</small>', 0, 1, 0.01, { dp: 3, hardMin: 0, hardMax: 1, hint: '0.5 puts the straight fret at the octave.' }));
  const r1 = h('div', 'row2'); host.appendChild(r1);
  add(lenSlider('nutSpacing', 'Nut spacing', 4, 16, { hint: 'Centre-to-centre between adjacent strings at the nut' }), r1);
  add(lenSlider('bridgeSpacing', 'Bridge spacing', 5, 22, { hint: 'Centre-to-centre between adjacent strings at the bridge' }), r1);
  const r2 = h('div', 'row2'); host.appendChild(r2);
  add(lenSlider('edgeMargin', 'Edge margin', 0, 8), r2);
  add(lenSlider('boardExtension', 'Past last fret', 0, 30), r2);
}
let modeBtns = [];
function buildModes() {
  const host = $('modes');
  modeBtns = MODES.map(m => {
    const b = h('button', 'mode', `${glyphSVG(m.id)}<span>${m.label}</span>`);
    b.type = 'button'; b.title = m.hint; b.setAttribute('role', 'radio'); b.dataset.mode = m.id;
    b.onclick = () => setMode(m.id);
    host.appendChild(b); return b;
  });
  refreshModes();
}
function refreshModes() { modeBtns.forEach(b => { const on = b.dataset.mode === S.params.mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); }

// ------------------------------------------------------------ top bar -----
const viewSeg = createSegment([{ value: '3d', label: '3D' }, { value: 'split', label: 'Split' }, { value: 'blueprint', label: 'Blueprint' }, { value: 'paper', label: 'Paper', title: 'White paper: the geometry of curved frets' }], () => S.view, setView);
$('viewSeg').appendChild(viewSeg.el);
const unitSeg = createSegment([{ value: 'in', label: 'in' }, { value: 'mm', label: 'mm' }], () => S.params.units, v => { setParam('units', v); }, { cls: 'small' });
$('unitSeg').appendChild(unitSeg.el);
// White paper: built the first time the Paper tab opens (src/paper/paper.js).
let paper = null, paperLoading = null;
function ensurePaper() {
  if (paper) return Promise.resolve(paper);
  return (paperLoading ||= import('./paper/paper.js')
    .then(m => (paper = m.createPaper({ app, onOpenDesign: (p, label) => { loadParams(p, { msg: `Opened “${label}” from the paper` }); setView('3d'); }, onClose: () => setView('3d') })))
    .catch(err => { console.error(err); paperLoading = null; toast('The paper could not be loaded: ' + err.message, 'error'); setView('3d'); return null; }));
}
function setView(v) {
  if (!['3d', 'split', 'blueprint', 'paper'].includes(v)) v = '3d';
  const was = S.view;
  S.view = v; app.dataset.view = v; viewSeg.refresh(); savePrefs();
  if (v === 'paper') { R3?.setAutoRotate(false); ensurePaper().then(pp => { if (S.view === 'paper') pp?.show().catch(e => console.error(e)); }); return; }
  if (was === 'paper') { paper?.hide(); R3?.setAutoRotate(S.spin); }
  if (v !== '3d' && S.design) bp.update(S.design, S.params.units);
  setTimeout(() => { updateInsets(); R3?.resize(); R3?.reframe(); }, 720);
  updateInsets(); R3?.resize();
}

// presets
function buildPresetMenu() {
  createPresetMenu({
    menu: $('presetMenu'), button: $('presetBtn'), G, builtins: PRESETS,
    getParams: () => S.params, getDesign: () => S.design,
    load: (p, msg) => loadParams(p, { msg }), close: closeMenus, toast,
  });
}
function toggleMenu(btn, pop) {
  const open = pop.hidden;
  closeMenus();
  if (open) { pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); pop.querySelector('input, button')?.focus({ preventScroll: true }); }
}
function closeMenus() { for (const [b, p] of [['presetBtn', 'presetMenu'], ['importBtn', 'importPop']]) { $(p).hidden = true; $(b).setAttribute('aria-expanded', 'false'); } }
$('presetBtn').onclick = e => { e.stopPropagation(); toggleMenu($('presetBtn'), $('presetMenu')); };
$('importBtn').onclick = e => { e.stopPropagation(); toggleMenu($('importBtn'), $('importPop')); };
document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) closeMenus(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });

// FretFind2D import
if (!G.importFretFind) { $('importBtn').disabled = true; $('importBtn').title = 'FretFind2D import is coming online'; }
async function doImport() {
  const url = $('importUrl').value.trim();
  if (!url) { $('importNote').textContent = 'Paste a FretFind2D link first.'; return; }
  try {
    let out = await G.importFretFind(url);
    if (out && out.params) out = out.params;
    let msg = `Imported ${out.numStrings || '?'} strings from FretFind2D.`;
    if (G.fitScales && out.mode === 'custom' && out.customScales?.length > 2) {
      const f = G.fitScales(out.customScales).best;
      if (f && f.maxErr < 0.5) msg += ` Closest formula: ${f.label} (max error ${f.maxErr.toFixed(2)} mm).`;
    }
    loadParams({ ...G.DEFAULTS, ...out }, { msg });
    closeMenus(); $('importUrl').value = '';
  } catch (err) { $('importNote').textContent = 'That link could not be read: ' + err.message; }
}
$('importGo').onclick = doImport;
$('importUrl').addEventListener('keydown', e => { if (e.key === 'Enter') doImport(); });

// share
$('shareBtn').onclick = async () => {
  const hash = '#' + G.encodeParams(S.params);
  try { history.replaceState(null, '', hash); } catch { location.hash = hash; }
  const url = location.href.split('#')[0] + hash;
  try { await navigator.clipboard.writeText(url); toast('Share link copied. It opens this exact design.', 'ok'); }
  catch { toast('Link is in the address bar. Copy it from there.', 'info'); }
};
window.addEventListener('hashchange', () => {
  const cur = '#' + G.encodeParams(S.params);
  if (location.hash && location.hash !== cur) loadParams(G.decodeParams(location.hash), { msg: 'Loaded design from link' });
});

// ------------------------------------------------------------ dock --------
const ICONS = {
  hero: '<svg viewBox="0 0 20 20"><path d="M3 15L12 4l5 3-8 11z"/><path d="M6 12l5 2M8 9.5l5 2"/></svg>',
  player: '<svg viewBox="0 0 20 20"><circle cx="10" cy="7" r="2.6"/><path d="M4 17c1.2-3.4 3.4-5 6-5s4.8 1.6 6 5"/></svg>',
  top: '<svg viewBox="0 0 20 20"><rect x="2.5" y="6" width="15" height="8" rx="1.5"/><path d="M6 6v8M9.5 6v8M13 6v8"/></svg>',
  top180: '<svg viewBox="0 0 20 20"><rect x="2.5" y="6" width="15" height="8" rx="1.5"/><path d="M7 6v8M10.5 6v8M14 6v8"/><path d="M4.2 4.2a7 7 0 0111.6 0M15.8 4.2l.3-2M15.8 4.2l-2 .2"/></svg>',
  back: '<svg viewBox="0 0 20 20"><rect x="2.5" y="6" width="15" height="8" rx="1.5"/><path d="M5.5 10h9" stroke-dasharray="1.6 1.4"/><path d="M10 2.5v2.2M10 15.3v2.2"/></svg>',
  rotL: '<svg viewBox="0 0 20 20"><path d="M4.5 10a5.5 5.5 0 105.5-5.5H7"/><path d="M8.6 2.4L6.4 4.5l2.2 2.1"/></svg>',
  rotR: '<svg viewBox="0 0 20 20"><path d="M15.5 10A5.5 5.5 0 1110 4.5h3"/><path d="M11.4 2.4l2.2 2.1-2.2 2.1"/></svg>',
  macro: '<svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5"/><path d="M12.2 12.2L17 17M6 9.8c1-2.4 2.6-3 4.6-2.6"/></svg>',
  bridge: '<svg viewBox="0 0 20 20"><path d="M3 13h14M5 13V9.5h2V13M9 13V9.5h2V13M13 13V9.5h2V13M3 16h14"/></svg>',
  strings: '<svg viewBox="0 0 20 20"><path d="M3 5h14M3 8.5h14M3 12h14M3 15.5h14"/></svg>',
  insight: '<svg viewBox="0 0 20 20"><path d="M3 10h14" stroke-dasharray="2 2"/><path d="M7 3c3 3.5 3 10.5 0 14M13 3c-3 3.5-3 10.5 0 14"/><circle cx="10" cy="10" r="1.3"/></svg>',
  spin: '<svg viewBox="0 0 20 20"><path d="M16 10a6 6 0 11-2-4.5"/><path d="M14.5 2.5v3.3h-3.3"/></svg>',
};
const CAMS = [['hero', 'Hero'], ['player', 'Player'], ['top', 'Top'], ['top180', 'Top 180°'], ['back', 'Back'], ['macro', 'Macro'], ['bridge', 'Bridge']];
function buildDock() {
  const cb = $('camBtns');
  CAMS.forEach(([id, label], k) => {
    const b = h('button', 'dbtn', `${ICONS[id]}<span class="lbl">${label}</span>`); b.type = 'button'; b.dataset.cam = id; b.title = `${label} view  (${k + 1})`;
    b.onclick = () => setCam(id); cb.appendChild(b);
  });
  // Turn about the instrument's long axis in 45° steps (Top = 0°, Back = 180°).
  const rot = h('div', 'rot-group');
  const rl = h('button', 'dbtn rot', `${ICONS.rotL}`); rl.type = 'button'; rl.title = 'Turn 45° about the neck  ([)'; rl.setAttribute('aria-label', 'Turn the view 45 degrees one way');
  const rr = h('button', 'dbtn rot', `${ICONS.rotR}`); rr.type = 'button'; rr.title = 'Turn 45° about the neck  (])'; rr.setAttribute('aria-label', 'Turn the view 45 degrees the other way');
  const ra = h('span', 'rot-angle', '0°'); ra.id = 'rotAngle'; ra.title = 'Angle about the neck: 0° is Top, 180° is Back';
  rl.onclick = () => rollCam(-45); rr.onclick = () => rollCam(45);
  rot.append(rl, ra, rr); cb.appendChild(rot);
  const fs = $('fretSwatches');
  [['nickel', 'Nickel silver', 'linear-gradient(135deg,#fff7e8,#cdb894 55%,#8d7a5c)'], ['stainless', 'Stainless steel', 'linear-gradient(135deg,#ffffff,#c4ccd6 55%,#7c8794)'], ['gold', 'EVO gold', 'linear-gradient(135deg,#fff0c8,#d9b064 55%,#8e6a2c)']].forEach(([id, label, bg]) => {
    const b = h('button', 'swatch'); b.style.background = bg; b.title = `Frets: ${label}`; b.dataset.fret = id; b.setAttribute('aria-label', `Fret wire ${label}`);
    b.onclick = () => { S.fret = id; R3?.setFinish({ fret: id }); refreshDock(); savePrefs(); }; fs.appendChild(b);
  });
  const wsw = $('woodSwatches');
  [['ebony', 'Ebony', 'linear-gradient(135deg,#3a302b,#0d0b0a)'], ['wenge', 'Wenge', 'repeating-linear-gradient(100deg,#4a3b30 0 2px,#1d1612 2px 4px)'], ['roasted', 'Roasted maple', 'linear-gradient(135deg,#a66b3c,#4a2a14)']].forEach(([id, label, bg]) => {
    const b = h('button', 'swatch'); b.style.background = bg; b.title = `Board: ${label}`; b.dataset.wood = id; b.setAttribute('aria-label', `Fretboard ${label}`);
    b.onclick = () => { S.wood = id; R3?.setFinish({ wood: id }); refreshDock(); savePrefs(); }; wsw.appendChild(b);
  });
  const tg = $('toggles');
  const sb = h('button', 'dbtn', `${ICONS.strings}<span class="lbl">Strings</span>`); sb.dataset.t = 'strings'; sb.title = 'Show strings  (S)';
  sb.onclick = () => { S.strings = !S.strings; R3?.setShowStrings(S.strings); refreshDock(); savePrefs(); };
  const rb = h('button', 'dbtn', `${ICONS.spin}<span class="lbl">Orbit</span>`); rb.dataset.t = 'spin'; rb.title = 'Slow idle orbit  (O)';
  rb.onclick = () => { S.spin = !S.spin; R3?.setAutoRotate(S.spin); refreshDock(); };
  const ib = h('button', 'dbtn', `${ICONS.insight}<span class="lbl">Insight</span>`); ib.dataset.t = 'overlay'; ib.title = 'Show the perpendicular line and S-curve inflection points  (I)';
  ib.onclick = () => { S.overlay = !S.overlay; R3?.setOverlay(S.overlay); refreshDock(); savePrefs(); };
  tg.append(sb, ib, rb);
  const eb = $('exportBtns');
  const pb = h('button', 'dbtn exp', '<b>PNG</b>'); pb.title = 'Save the 3D view as an image'; pb.dataset.png = '1';
  pb.onclick = () => {
    if (!R3) return;
    const c = R3.snapshot();
    c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `curved-frets-${S.params.numStrings}str-${S.params.mode}.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Render saved as PNG', 'ok'); }, 'image/png');
  };
  eb.appendChild(pb);
  ['svg', 'dxf', 'pdf', 'csv'].forEach(fmt => {
    const b = h('button', 'dbtn exp soon', `<b>${fmt.toUpperCase()}</b>`); b.dataset.fmt = fmt; b.disabled = true; b.title = `${fmt.toUpperCase()} export is coming online`;
    b.onclick = () => doExport(fmt); eb.appendChild(b);
  });
  refreshDock();
}
function refreshDock() {
  document.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('on', b.dataset.cam === S.cam));
  document.querySelectorAll('[data-fret]').forEach(b => b.classList.toggle('on', b.dataset.fret === S.fret));
  document.querySelectorAll('[data-wood]').forEach(b => b.classList.toggle('on', b.dataset.wood === S.wood));
  document.querySelector('[data-t="strings"]')?.classList.toggle('on', S.strings);
  document.querySelector('[data-t="spin"]')?.classList.toggle('on', S.spin);
  document.querySelector('[data-t="overlay"]')?.classList.toggle('on', S.overlay);
}
function rollCam(deg) {
  if (!R3?.rotate) return;
  if (S.view === 'blueprint') setView('split');
  if (S.spin) { S.spin = false; R3.setAutoRotate(false); }
  const ang = R3.rotate(deg);
  S.cam = ang === 0 ? 'top' : ang === 180 ? 'back' : 'roll'; refreshDock();
  const el = $('rotAngle'); if (el) el.textContent = `${ang}°`;
}
function setCam(id) {
  S.cam = id; refreshDock();
  { const el = $('rotAngle'); if (el) el.textContent = (id === 'top' || id === 'top180') ? '0°' : id === 'back' ? '180°' : '–'; }
  if (S.view === 'blueprint') setView('split');
  R3?.view(id);
  if (S.spin) { S.spin = false; R3?.setAutoRotate(false); refreshDock(); }
}
const EXPORT_FNS = {
  svg: ['exportSVG', 'toSVG', 'svg'], dxf: ['exportDXF', 'toDXF', 'dxf'], pdf: ['exportPDF', 'toPDF', 'pdf'], csv: ['exportCSV', 'toCSV', 'csv'],
};
async function loadExports() {
  try { X = await import('./exports.js'); } catch { X = null; }
  document.querySelectorAll('.dbtn.exp[data-fmt]').forEach(b => {
    const fmt = b.dataset.fmt, fn = X && (EXPORT_FNS[fmt].map(n => X[n]).find(f => typeof f === 'function') || (typeof X.exportDesign === 'function' ? (d) => X.exportDesign(d, fmt) : null));
    b.disabled = !fn; b.classList.toggle('soon', !fn);
    b.title = fn ? { svg: '1:1 SVG template (laser / print)', dxf: 'DXF for CAM: one smooth spline per fret (mm)', pdf: 'Tiled 1:1 PDF with fret table', csv: 'Fret positions per string' }[fmt] : `${fmt.toUpperCase()} export is coming online`;
    b._fn = fn;
  });
}
async function doExport(fmt) {
  const b = document.querySelector(`.dbtn.exp[data-fmt="${fmt}"]`);
  if (!b?._fn || !S.design) return;
  try {
    let r = await b._fn(S.design, { title: undefined });
    if (typeof r === 'string' || r instanceof Uint8Array || r instanceof Blob) r = { data: r };
    const mime = r.mime || { svg: 'image/svg+xml', dxf: 'application/dxf', pdf: 'application/pdf', csv: 'text/csv' }[fmt];
    const p = S.params, sr = S.design.metrics.scaleRange;
    const name = r.filename || `curved-frets-${p.numStrings}str-${p.mode}-${(sr[0] / IN).toFixed(2)}-${(sr[1] / IN).toFixed(2)}in.${r.extension || fmt}`;
    const blob = r.data instanceof Blob ? r.data : new Blob([r.data], { type: mime });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`${fmt.toUpperCase()} saved: ${name}${r.pages ? ` (${r.pages} pages)` : ''}`, 'ok');
  } catch (err) { console.error(err); toast(`${fmt.toUpperCase()} export failed: ${err.message}`, 'error'); }
}

// ------------------------------------------------------------ layout ------
function updateInsets() {
  const mob = isMobile();
  const rectOf = id => { const e = $(id); const r = e.getBoundingClientRect(); return r; };
  for (const [pane, target] of [['pane3d', R3], ['paneBp', bp]]) {
    if (!target) continue;
    const P = rectOf(pane);
    const ins = { left: 0, right: 0, top: 0, bottom: 0 };
    const top = document.querySelector('.topbar').getBoundingClientRect();
    ins.top = Math.max(0, top.bottom + 8 - P.top);
    if (mob) {
      const sheetOpen = app.dataset.sheet !== 'none';
      const sh = sheetOpen ? window.innerHeight * 0.46 : 56;
      ins.bottom = Math.max(0, P.bottom - (window.innerHeight - sh));
    } else {
      const L = $('panelDesign').getBoundingClientRect(), Rr = $('panelData').getBoundingClientRect(), D = $('dock').getBoundingClientRect();
      ins.left = Math.max(0, L.right + 8 - P.left);
      ins.right = Math.max(0, P.right - (Rr.left - 8));
      ins.bottom = Math.max(0, P.bottom - (D.top - 8));
    }
    target.setInsets(ins);
  }
}
document.querySelector('.topbar').id = 'topbar';
$('sheetTabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  app.dataset.sheet = app.dataset.sheet === b.dataset.sheet ? 'none' : b.dataset.sheet;
  setTimeout(() => { updateInsets(); R3?.reframe(); }, 520);
});
let tResize = null;
window.addEventListener('resize', () => { clearTimeout(tResize); tResize = setTimeout(() => { updateInsets(); R3?.resize(); viewSeg.refresh(); unitSeg.refresh(); }, 80); });

// keyboard
document.addEventListener('keydown', e => {
  if (e.target.closest?.('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (S.view === 'paper' && k !== 'v') return; // reading: leave the keys to the page
  if (k >= '1' && k <= String(CAMS.length)) setCam(CAMS[+k - 1][0]);
  if (k === '[' || k === ']') rollCam(k === '[' ? -45 : 45);
  else if (k === 'v') setView({ '3d': 'split', split: 'blueprint', blueprint: '3d', paper: '3d' }[S.view]);
  else if (k === 'u') setParam('units', S.params.units === 'in' ? 'mm' : 'in');
  else if (k === 's') document.querySelector('[data-t="strings"]').click();
  else if (k === 'i') document.querySelector('[data-t="overlay"]').click();
  else if (k === 'o') document.querySelector('[data-t="spin"]').click();
});

// ------------------------------------------------------------ boot --------
async function boot() {
  chart = createProfileChart($('profile'));
  bp = createBlueprint($('paneBp'));
  buildModes(); buildModeParams(); buildLayoutParams(); buildPresetMenu(); buildDock();
  app.dataset.view = S.view; viewSeg.refresh();
  if (isMobile()) app.dataset.sheet = 'none';
  loadExports();

  // first compute (sync) so panels have data immediately
  recompute(true, false);
  if (S.view === 'split' || S.view === 'blueprint') bp.update(S.design, S.params.units);
  if (S.view === 'paper') setView('paper');

  try {
    const mod = await import('./render3d.js');
    R3 = mod.create3D($('gl'), {});
    R3.onAutoRotateStop = () => { S.spin = false; refreshDock(); };
    R3.setFinish({ fret: S.fret, wood: S.wood });
    R3.setShowStrings(S.strings);
    R3.setOverlay(S.overlay);
    updateInsets();
    R3.setDesign(S.design, { animate: false });
    R3.intro();
    setTimeout(() => { if (S.spin && R3 && !R3._touched && S.view !== 'paper') R3.setAutoRotate(true); refreshDock(); }, 3400);
  } catch (err) {
    console.error(err);
    $('glFallback').hidden = false;
    if (S.view === '3d') setView('blueprint');
    toast('3D preview is unavailable here, so the blueprint is shown instead.', 'info');
  }
  updateInsets();
  requestAnimationFrame(() => app.classList.add('ready'));
  setTimeout(() => { updateInsets(); viewSeg.refresh(); unitSeg.refresh(); }, 1400);
  window.__cfd = { S, get R3() { return R3; }, G, setParam, loadParams, setView, setCam };
}
boot();

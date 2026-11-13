// render3d.js — photoreal three.js preview of a curved-fret Design.
// Design units are millimetres; the scene uses millimetres too.
// Mapping: design (x, y) on the board plane, h above the board top ->
//   three (x, h, -y). Board top is y=0 in three.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  makeWoodMaterial, makeFretMaterial, makeSatinMaterial, makeStringMaterials, makeAccentWoodMaterial,
  makeHardwareMaterials, makeBackdropTexture, setMaxAnisotropy,
} from './materials.js';
import { buildBody } from './render/body.js';
import { createPost } from './render/post.js';
import { createContactShadow } from './render/contact.js';

// ------------------------------------------------------------ constants ----
const BOARD_T = 6.4;         // fretboard thickness
const EDGE_R = 0.7;          // eased board edge radius
const FRET_W = 2.3, FRET_H = 1.2, FRET_EMBED = 0.3, FRET_TRIM = 0.45, FRET_BEVEL = 1.9;
const NECK_DEPTH = 19;
const HEAD_LEN = 30;
const BODY_TOP = -BOARD_T - 0.5;            // top of the black shell
const BODY_SEAM = BODY_TOP - 21;            // shell / wood back layer joint
const BODY_BOTTOM = BODY_TOP - 33;          // underside
const BODY_TAIL = 24;                       // body ends this far past the bridge line
const FLOOR_Y = BODY_BOTTOM - 0.2;          // invisible studio floor (contact shadow)
const BARREL_LEN = 27;                      // tuner barrel length
const INTRO_LIFT = 46;                      // the instrument settles onto the floor
const FOV = 30;                             // long-lens look
// Flat views (Top, Top 180°): an extreme telephoto from far away. At 0.2° the
// depth of the whole instrument changes scale by under 0.03%, so the picture is
// orthographic for all practical purposes while every pass (AO, bloom, contact
// shadow, string-width shader) keeps working with the same perspective camera.
const FLAT_FOV = 0.2;
const EXPOSURE = 1.0;
const INCH = 25.4;
const MARKERS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24, 27, 29, 31, 33, 36];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);

// ------------------------------------------------------------ polylines ----
function cumLen(pts) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return L;
}
// Uniform arc-length resample of a polyline between arc lengths s0..s1 (may extrapolate).
function resample(pts, M, s0 = 0, s1 = null) {
  if (pts.length === 1) return Array.from({ length: M }, () => ({ ...pts[0] }));
  const L = cumLen(pts), tot = L[L.length - 1];
  if (s1 == null) s1 = tot;
  const out = [];
  let k = 0;
  for (let i = 0; i < M; i++) {
    const s = s0 + (s1 - s0) * (M === 1 ? 0 : i / (M - 1));
    if (s <= 0) { const a = pts[0], b = pts[1], d = L[1] || 1; out.push({ x: a.x + (b.x - a.x) * s / d, y: a.y + (b.y - a.y) * s / d }); continue; }
    if (s >= tot) { const n = pts.length, a = pts[n - 2], b = pts[n - 1], d = (L[n - 1] - L[n - 2]) || 1, e = s - tot; out.push({ x: b.x + (b.x - a.x) * e / d, y: b.y + (b.y - a.y) * e / d }); continue; }
    while (k < L.length - 2 && L[k + 1] < s) k++;
    const f = (s - L[k]) / ((L[k + 1] - L[k]) || 1);
    out.push({ x: pts[k].x + (pts[k + 1].x - pts[k].x) * f, y: pts[k].y + (pts[k + 1].y - pts[k].y) * f });
  }
  return out;
}
function evalAt(arr, u) {
  const f = clamp(u, 0, 1) * (arr.length - 1), i = Math.min(arr.length - 2, Math.floor(f)), t = f - i;
  if (arr.length < 2) return arr[0];
  return { x: arr[i].x + (arr[i + 1].x - arr[i].x) * t, y: arr[i].y + (arr[i + 1].y - arr[i].y) * t };
}
const shiftY = (pts, dy) => pts.map(p => ({ x: p.x, y: p.y + dy }));

// Swap triangle winding wherever it disagrees with the supplied vertex normals.
function orient(pos, nor, idx) {
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    const vx = nor[a] + nor[b] + nor[c], vy = nor[a + 1] + nor[b + 1] + nor[c + 1], vz = nor[a + 2] + nor[b + 2] + nor[c + 2];
    if (fx * vx + fy * vy + fz * vz < 0) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  }
}
function toGeometry(m) {
  orient(m.pos, m.nor, m.idx);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.pos instanceof Float32Array ? m.pos : new Float32Array(m.pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.nor instanceof Float32Array ? m.nor : new Float32Array(m.nor), 3));
  if (m.uv) g.setAttribute('uv', new THREE.BufferAttribute(m.uv instanceof Float32Array ? m.uv : new Float32Array(m.uv), 2));
  const n = m.pos.length / 3;
  g.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(m.idx) : new Uint16Array(m.idx), 1));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- slabs ----
// A slab between two edge-to-edge curves A (start) and B (end), resampled to the
// same count M. Flat top with an eased (quarter-round) edge all round, vertical
// walls, flat bottom. Deterministic topology for a given (M, K) so it can tween.
function buildSlab(A, B, { K = 8, top = 0, bottom = -BOARD_T, r = EDGE_R, arc = 4, uvLong = true }) {
  const M = A.length;
  const P = (u, v) => { const a = evalAt(A, u), b = evalAt(B, u); return { x: a.x + (b.x - a.x) * v, y: a.y + (b.y - a.y) * v }; };
  const width = v => { const p = P(0, v), q = P(1, v); return Math.hypot(q.x - p.x, q.y - p.y) || 1; };
  const len = u => { const a = evalAt(A, u), b = evalAt(B, u); return Math.hypot(b.x - a.x, b.y - a.y) || 1; };
  const params = (i, j) => {
    const u = i / (M - 1), v = j / K;
    const dv = Math.min(0.45, r / len(u)), vv = dv + v * (1 - 2 * dv);
    const du = Math.min(0.45, r / width(vv)), uu = du + u * (1 - 2 * du);
    return [uu, vv];
  };
  const pos = [], nor = [], uv = [], idx = [];
  const push = (x, h, y, nx, nh, ny, a, b) => { pos.push(x, h, -y); nor.push(nx, nh, -ny); uv.push(a, b); return pos.length / 3 - 1; };
  // top grid
  const top0 = 0;
  for (let j = 0; j <= K; j++) for (let i = 0; i < M; i++) {
    const [uu, vv] = params(i, j), p = P(uu, vv);
    push(p.x, top, p.y, 0, 1, 0, p.x, p.y);
  }
  for (let j = 0; j < K; j++) for (let i = 0; i < M - 1; i++) {
    const a = top0 + j * M + i, b = a + 1, c = a + M, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // perimeter loop (i, j)
  const loop = [];
  for (let i = 0; i < M; i++) loop.push([i, 0]);
  for (let j = 1; j <= K; j++) loop.push([M - 1, j]);
  for (let i = M - 2; i >= 0; i--) loop.push([i, K]);
  for (let j = K - 1; j >= 1; j--) loop.push([0, j]);
  const Lc = loop.length;
  const inner = [], outer = [], dirs = [], sArc = [];
  let acc = 0;
  for (let l = 0; l < Lc; l++) {
    const [i, j] = loop[l], [uu, vv] = params(i, j);
    const pi = P(uu, vv);
    const po = P(i === 0 ? 0 : i === M - 1 ? 1 : uu, j === 0 ? 0 : j === K ? 1 : vv);
    let dx = po.x - pi.x, dy = po.y - pi.y, d = Math.hypot(dx, dy);
    if (d < 1e-6) { dx = 0; dy = 0; d = 1; }
    inner.push(pi); outer.push(po); dirs.push({ x: dx / d, y: dy / d });
    if (l > 0) acc += Math.hypot(po.x - outer[l - 1].x, po.y - outer[l - 1].y);
    sArc.push(acc);
  }
  const rings = arc + 2, ring0 = pos.length / 3;
  for (let q = 0; q < rings; q++) {
    for (let l = 0; l < Lc; l++) {
      const pi = inner[l], po = outer[l], o = dirs[l];
      let x, y, h, nx, nh, ny;
      if (q <= arc) {
        const th = (q / arc) * Math.PI / 2, s = Math.sin(th), c = Math.cos(th);
        x = pi.x + (po.x - pi.x) * s; y = pi.y + (po.y - pi.y) * s; h = top - r * (1 - c);
        nx = o.x * s; ny = o.y * s; nh = c;
      } else { x = po.x; y = po.y; h = bottom; nx = o.x; ny = o.y; nh = 0; }
      push(x, h, y, nx, nh, ny, uvLong ? (top - h) * 3 : x, uvLong ? sArc[l] : (top - h) * 3);
    }
  }
  for (let q = 0; q < rings - 1; q++) for (let l = 0; l < Lc; l++) {
    const a = ring0 + q * Lc + l, b = ring0 + q * Lc + (l + 1) % Lc, c = a + Lc, d = b + Lc;
    idx.push(a, c, b, b, c, d);
  }
  // bottom
  const bot0 = pos.length / 3;
  for (let j = 0; j <= K; j++) for (let i = 0; i < M; i++) { const p = P(i / (M - 1), j / K); push(p.x, bottom, p.y, 0, -1, 0, p.x, p.y); }
  for (let j = 0; j < K; j++) for (let i = 0; i < M - 1; i++) { const a = bot0 + j * M + i, b = a + 1, c = a + M, d = c + 1; idx.push(a, b, c, b, d, c); }
  return { pos, nor, uv, idx };
}

// Carved C-shaped neck under the board, between curves A and B.
function buildNeck(A, B, { K = 40, top = -BOARD_T, depth = NECK_DEPTH, inset = 0.6, rise = 24 }) {
  const M = A.length, pos = [], nor = [], uv = [], idx = [];
  const P = (u, v) => { const a = evalAt(A, u), b = evalAt(B, u); return { x: a.x + (b.x - a.x) * v, y: a.y + (b.y - a.y) * v }; };
  const len = Math.hypot(evalAt(B, 0.5).x - evalAt(A, 0.5).x, evalAt(B, 0.5).y - evalAt(A, 0.5).y) || 1;
  for (let j = 0; j <= K; j++) {
    const v = j / K, s = v * len;
    const taper = Math.min(1, 0.55 + 0.45 * Math.min(1, s / rise));
    const p0 = P(0, v), p1 = P(1, v), w = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1, du = inset / w;
    for (let i = 0; i < M; i++) {
      const u = du + (i / (M - 1)) * (1 - 2 * du), p = P(u, v), c = 2 * u - 1;
      const prof = Math.pow(Math.max(0, 1 - c * c), 0.62);
      const h = top - depth * taper * (0.08 + 0.92 * prof);
      pos.push(p.x, h, -p.y);
      // approximate outward normal (fixed up by computeVertexNormals later)
      nor.push(c * (p1.x - p0.x) / w, -0.6, -c * (p1.y - p0.y) / w);
      uv.push(p.x, p.y);
    }
  }
  for (let j = 0; j < K; j++) for (let i = 0; i < M - 1; i++) { const a = j * M + i, b = a + 1, c = a + M, d = c + 1; idx.push(a, c, b, b, c, d); }
  orient(pos, nor, idx);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// --------------------------------------------------------------- sweeps ----
// profile: [{w, h, nw, nh}] across the path (w along the path's in-plane normal).
// opts.taper(s, total) -> [hScale, wScale] for the fret-end bevel.
function sweep(path, profile, { closed = false, caps = true, taper = null, hBase = 0, out = null } = {}) {
  const M = path.length, Pn = profile.length;
  const o = out || { pos: [], nor: [], uv: [], idx: [] };
  const base = o.pos.length / 3;
  const L = cumLen(path), tot = L[M - 1] || 1;
  const frames = [];
  for (let k = 0; k < M; k++) {
    const a = path[Math.max(0, k - 1)], b = path[Math.min(M - 1, k + 1)];
    let tx = b.x - a.x, ty = b.y - a.y; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
    frames.push({ tx, ty, nx: -ty, ny: tx });
  }
  for (let k = 0; k < M; k++) {
    const p = path[k], f = frames[k];
    const [hs, ws] = taper ? taper(L[k], tot) : [1, 1];
    for (let q = 0; q < Pn; q++) {
      const pr = profile[q];
      const w = pr.w * ws, h = hBase + (pr.h - hBase) * (pr.h > hBase ? hs : 1);
      let nw = pr.nw, nh = pr.nh;
      if (hs !== 1 && pr.h > hBase) { nh = pr.nh / Math.max(hs, 0.2); const n = Math.hypot(nw, nh) || 1; nw /= n; nh /= n; }
      const x = p.x + f.nx * w, y = p.y + f.ny * w;
      o.pos.push(x, h, -y); o.nor.push(f.nx * nw, nh, -f.ny * nw); o.uv.push(L[k] / tot, q / (Pn - 1));
    }
  }
  const qs = closed ? Pn : Pn - 1;
  for (let k = 0; k < M - 1; k++) for (let q = 0; q < qs; q++) {
    const a = base + k * Pn + q, b = base + k * Pn + (q + 1) % Pn, c = a + Pn, d = b + Pn;
    o.idx.push(a, c, b, b, c, d);
  }
  if (caps) for (const end of [0, M - 1]) {
    const f = frames[end], sgn = end === 0 ? -1 : 1, start = o.pos.length / 3;
    const ring = base + end * Pn;
    let cx = 0, cy = 0, ch = 0;
    for (let q = 0; q < Pn; q++) { cx += o.pos[(ring + q) * 3]; ch += o.pos[(ring + q) * 3 + 1]; cy += o.pos[(ring + q) * 3 + 2]; }
    o.pos.push(cx / Pn, ch / Pn, cy / Pn); o.nor.push(f.tx * sgn, 0, -f.ty * sgn); o.uv.push(0.5, 0.5);
    for (let q = 0; q < Pn; q++) {
      o.pos.push(o.pos[(ring + q) * 3], o.pos[(ring + q) * 3 + 1], o.pos[(ring + q) * 3 + 2]);
      o.nor.push(f.tx * sgn, 0, -f.ty * sgn); o.uv.push(0, 0);
    }
    const qn = closed ? Pn : Pn - 1;
    for (let q = 0; q < qn; q++) o.idx.push(start, start + 1 + q, start + 1 + (q + 1) % Pn);
  }
  return o;
}
function fretProfile() {
  const a = FRET_W / 2, b = FRET_H, pts = [{ w: -a, h: -FRET_EMBED, nw: -1, nh: 0 }];
  const S = 14;
  for (let s = 0; s <= S; s++) {
    const th = Math.PI * (1 - s / S), c = Math.cos(th), si = Math.sin(th);
    let nw = c / a, nh = si / b; const n = Math.hypot(nw, nh); nw /= n; nh /= n;
    pts.push({ w: a * c, h: b * Math.pow(si, 0.9), nw, nh });
  }
  pts.push({ w: a, h: -FRET_EMBED, nw: 1, nh: 0 });
  return pts;
}
// Closed rounded-rect profile, top corners rounded, sharp bottom corners.
function roundRectProfile(w0, w1, h0, h1, r, seg = 4) {
  r = Math.min(r, (w1 - w0) / 2, h1 - h0);
  const pts = [];
  pts.push({ w: w0, h: h0, nw: 0, nh: -1 }, { w: w1, h: h0, nw: 0, nh: -1 });
  pts.push({ w: w1, h: h0, nw: 1, nh: 0 });
  for (let s = 0; s <= seg; s++) { const t = (s / seg) * Math.PI / 2; pts.push({ w: w1 - r + Math.cos(t) * r, h: h1 - r + Math.sin(t) * r, nw: Math.cos(t), nh: Math.sin(t) }); }
  for (let s = 0; s <= seg; s++) { const t = Math.PI / 2 + (s / seg) * Math.PI / 2; pts.push({ w: w0 + r + Math.cos(t) * r, h: h1 - r + Math.sin(t) * r, nw: Math.cos(t), nh: Math.sin(t) }); }
  pts.push({ w: w0, h: h0, nw: -1, nh: 0 });
  return pts;
}
// Extend a curve at both ends along its end tangents by `e` mm.
function extendCurve(c, e) {
  if (c.length < 2) return c;
  const n = c.length, a = c[0], b = c[1], y = c[n - 1], z = c[n - 2];
  const da = Math.hypot(a.x - b.x, a.y - b.y) || 1, dz = Math.hypot(y.x - z.x, y.y - z.y) || 1;
  return [{ x: a.x + (a.x - b.x) / da * e, y: a.y + (a.y - b.y) / da * e }, ...c, { x: y.x + (y.x - z.x) / dz * e, y: y.y + (y.y - z.y) / dz * e }];
}
function roundedPolyShape(pts, r) {
  const s = new THREE.Shape(), n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const da = Math.hypot(a.x - p.x, a.y - p.y), db = Math.hypot(b.x - p.x, b.y - p.y);
    const rr = Math.min(r, da * 0.45, db * 0.45);
    const p1 = { x: p.x + (a.x - p.x) / da * rr, y: p.y + (a.y - p.y) / da * rr };
    const p2 = { x: p.x + (b.x - p.x) / db * rr, y: p.y + (b.y - p.y) / db * rr };
    if (i === 0) s.moveTo(p1.x, p1.y); else s.lineTo(p1.x, p1.y);
    s.quadraticCurveTo(p.x, p.y, p2.x, p2.y);
  }
  s.closePath();
  return s;
}

// A dark product-photography studio for image-based lighting. Mostly black,
// so polished metal mirrors darkness, with a few narrow strip lights that
// draw crisp streaks along fret crowns and strings, a modest key softbox and
// a cool rim. No big bright overhead panel: that is what made frets glow.
export function makeStudioEnvironment() {
  const s = new THREE.Scene();
  const dome = new THREE.SphereGeometry(30, 48, 24), col = [], pos = dome.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const ny = pos.getY(i) / 30, t = THREE.MathUtils.smoothstep(ny, -0.2, 1.0);
    const v = 0.004 + 0.045 * Math.pow(t, 1.6);
    col.push(v * 0.95, v, v * 1.08);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  s.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const panel = (w, h, intensity, pos, look, tint = 0xffffff) => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(intensity), side: THREE.DoubleSide });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.position.set(...pos); p.lookAt(...look); s.add(p);
  };
  panel(7, 4.5, 4.2, [-9, 10, 7], [0, 0, 0], 0xfff2e4);        // key softbox, upper left front
  panel(26, 0.9, 5.0, [0, 15, -2.5], [0, 0, 0], 0xf1f4f8);      // overhead strip across: fret crown streaks
  panel(0.8, 24, 2.6, [-3, 15, 2], [0, 0, 0], 0xf4f6fa);        // overhead strip along: string lines
  panel(16, 1.0, 3.8, [6, 6, -12], [0, 0, 0], 0xcfe0ff);        // cool rim strip behind
  panel(0.9, 13, 2.4, [13, 7, 4], [0, 0, 0], 0xdfe9ff);         // side strip
  panel(4.5, 2.6, 2.0, [7, 9, -6], [0, 0, 0], 0xffffff);        // small kicker
  panel(30, 30, 0.015, [0, -3.9, 0], [0, 10, 0], 0x8a8278);     // floor bounce
  return s;
}

// =============================================================== create ====
export function create3D(canvas, { onStats } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 is not available');
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true });
  const isSmall = Math.min(window.innerWidth, window.innerHeight) < 700;
  const DPR_BASE = isSmall ? 1.5 : 2;
  let dprCap = DPR_BASE;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // used only by the direct (lowest quality) path
  renderer.toneMappingExposure = EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.background = makeBackdropTexture();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = makeStudioEnvironment();
  const envRT = pmrem.fromScene(envScene, 0.015);
  envScene.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
  scene.environment = envRT.texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 30000);
  camera.position.set(-500, 600, 900);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.075, rotateSpeed: 0.55, zoomSpeed: 0.9, panSpeed: 0.8,
    screenSpacePanning: true, minDistance: 25, maxDistance: 8000, maxPolarAngle: Math.PI, autoRotateSpeed: 0.35 });

  // Lights: warm key from upper left front (casts the fret/string shadows),
  // cool rim from behind, very low fill. Intensities are illuminance-like:
  // the board sits around mid-grey after tone mapping, like the photo.
  const key = new THREE.DirectionalLight(0xfff0dc, 3.6);
  key.castShadow = true;
  key.shadow.mapSize.set(isSmall ? 2048 : 4096, isSmall ? 2048 : 4096);
  key.shadow.bias = -0.00015; key.shadow.normalBias = 0.04;
  const rim = new THREE.DirectionalLight(0xbcd5ff, 1.5);
  const fill = new THREE.HemisphereLight(0x9fb4cc, 0x0b0a09, 0.16);
  // Under fill: off from normal views; fades in only when the camera drops below
  // the instrument (Back view, 45° turns) so the underside isn't a black silhouette.
  const under = new THREE.DirectionalLight(0xd9e2ee, 0);
  scene.add(key, key.target, rim, rim.target, fill, under, under.target);
  const KEY_DIR = new THREE.Vector3(-0.42, 1, 0.3).normalize();
  const RIM_DIR = new THREE.Vector3(0.75, 0.42, -0.6).normalize();

  // Materials
  const mats = {
    wood: makeWoodMaterial('wenge'), fret: makeFretMaterial('nickel'), satin: makeSatinMaterial(), accent: makeAccentWoodMaterial(),
    ...makeStringMaterials(), ...makeHardwareMaterials(),
  };
  let finish = { fret: 'nickel', wood: 'wenge' };
  // Strings are 0.2-1.4 mm thick: at full-board framing they fall below a pixel and
  // vanish. Inflate each string's radius in the vertex shader so it never renders
  // thinner than ~0.55 px, like a photo where specular strings always read.
  const stringUniforms = { uPxPerUnit: { value: 500 } };
  for (const m of [mats.plain, mats.wound]) {
    m.onBeforeCompile = sh => {
      sh.uniforms.uPxPerUnit = stringUniforms.uPxPerUnit;
      sh.vertexShader = 'uniform float uPxPerUnit;\nvarying float vThin;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vThin = 0.0;
        {
          vec4 axisV = modelViewMatrix * vec4(0.0, position.y, 0.0, 1.0);
          float r = length(position.xz);
          float depth = max(1e-3, -axisV.z);
          float minR = 0.55 * depth / uPxPerUnit;
          if (r > 1e-6 && r < minR) { transformed.xz *= minR / r; }
          vThin = clamp((minR / max(r, 1e-6) - 0.6) / 2.5, 0.0, 1.0);
        }`);
      // Specular anti-aliasing: a sub-pixel cylinder averages its whole highlight
      // ring, so widen the lobe and lift it slightly as the string thins on screen.
      sh.fragmentShader = 'varying float vThin;\n' + sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.45, vThin);')
        .replace('#include <opaque_fragment>', 'outgoingLight += vec3(0.030, 0.032, 0.034) * vThin;\n#include <opaque_fragment>');
    };
    m.customProgramCacheKey = () => 'thinline';
  }

  const root = new THREE.Group(); scene.add(root);
  const contact = createContactShadow(renderer, { size: isSmall ? 256 : 512 });
  scene.add(contact.group);
  let contactDirty = true;

  // Post chain. Helpers that must not occlude in the AO / depth renders.
  const noAO = [contact.plane];
  const post = createPost(renderer, scene, camera, { hide: noAO });
  post.setExposure(EXPOSURE);
  let quality = isSmall ? 2 : 3; // 3 full, 2 no GTAO, 1 no bloom + lower DPR, 0 direct render
  let dofWanted = false;

  // ------------------------------------------------------ parts & tweens --
  const parts = {};
  let tweens = [], tween0 = 0, tweenDur = 0;
  function setPart(name, geo, sig, material, { animate, cast = true, receive = true } = {}) {
    let p = parts[name];
    if (!p) {
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = cast; mesh.receiveShadow = receive; mesh.frustumCulled = false;
      root.add(mesh); parts[name] = p = { mesh, sig };
      return;
    }
    const old = p.mesh.geometry;
    if (animate && p.sig === sig && old.attributes.position.count === geo.attributes.position.count) {
      for (const key of ['position', 'normal']) {
        const live = geo.attributes[key].array, to = live.slice(), from = old.attributes[key].array.slice();
        live.set(from);
        tweens.push({ live, from, to, attr: geo.attributes[key] });
      }
    }
    p.mesh.geometry = geo; p.sig = sig; p.mesh.material = material;
    old.dispose();
  }
  function removePart(name) {
    const p = parts[name]; if (!p) return;
    root.remove(p.mesh); p.mesh.geometry.dispose();
    if (p.mesh.isInstancedMesh) p.mesh.dispose();
    delete parts[name];
  }
  // Instanced parts: tween instance matrices.
  function setInstanced(name, geo, material, matrices, { animate, cast = true, receive = true } = {}) {
    const count = matrices.length / 16;
    let p = parts[name];
    if (p && (p.mesh.count !== count || p.geoKey !== geo.userData.key)) { removePart(name); p = null; }
    if (!p) {
      const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, count));
      mesh.count = count; mesh.castShadow = cast; mesh.receiveShadow = receive; mesh.frustumCulled = false;
      mesh.instanceMatrix.array.set(matrices);
      mesh.instanceMatrix.needsUpdate = true;
      root.add(mesh); parts[name] = { mesh, geoKey: geo.userData.key };
      return;
    }
    geo.dispose();
    p.mesh.material = material;
    const live = p.mesh.instanceMatrix.array;
    if (animate) { tweens.push({ live, from: live.slice(0, matrices.length), to: Float32Array.from(matrices), attr: p.mesh.instanceMatrix }); }
    else { live.set(matrices); p.mesh.instanceMatrix.needsUpdate = true; }
  }

  // Strings: individual cylinders whose endpoints tween.
  let strings = []; // {mesh, live:Float32Array(6)}
  const unitCyl = (r, uvRepeat) => {
    const g = new THREE.CylinderGeometry(r, r, 1, 14, 1, true);
    g.translate(0, 0.5, 0);
    if (uvRepeat) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * uvRepeat); }
    return g;
  };
  const _v = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();
  function applyString(s) {
    const a = s.live;
    _v.set(a[3] - a[0], a[4] - a[1], a[5] - a[2]);
    const len = _v.length() || 1;
    s.mesh.position.set(a[0], a[1], a[2]);
    s.mesh.quaternion.copy(_q.setFromUnitVectors(_u, _v.multiplyScalar(1 / len)));
    s.mesh.scale.set(1, len, 1);
    s.mesh.updateMatrix();
  }

  // Unit hardware geometries (shared, never rebuilt).
  const unitGeo = (g, key) => { g.userData.key = key; return g; };
  const HW = {
    saddle: () => unitGeo(new RoundedBoxGeometry(1, 1, 1, 3, 0.16), 'saddle'),
    crown: () => unitGeo(new THREE.CylinderGeometry(1, 1, 1, 16).rotateZ(Math.PI / 2), 'crown'),
    screw: () => unitGeo(new THREE.CylinderGeometry(1, 1, 1, 16).translate(0, 0.5, 0), 'screw'),
    barrel: () => unitGeo(new THREE.CylinderGeometry(0.88, 1, 1, 28, 1), 'barrel'),
    ring: () => unitGeo(new THREE.CylinderGeometry(1, 1, 1, 28, 1), 'ring'),
    knob: () => unitGeo(new THREE.CylinderGeometry(0.8, 1, 1, 28, 2), 'knob'),
  };

  // ------------------------------------------------------------ build -----
  let design = null, frame = null, showStrings = true, overlay = true;
  mats.bead = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fd0ff).multiplyScalar(1.7), toneMapped: false });
  mats.perp = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(2.2), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
  function build(d, { animate = false } = {}) {
    design = d;
    const N = d.strings.length;
    tweens = [];
    // --- board, headpiece, neck
    const M = clamp(40 + N * 8, 48, 420);
    const nutC = resample(d.nut.curve, M), endC = resample(d.boardEnd.curve, M);
    setPart('board', toGeometry(buildSlab(nutC, endC, { K: 10 })), `board:${M}`, mats.wood, { animate });
    const headA = resample(shiftY(extendCurve(d.nut.curve, 1.2), -HEAD_LEN), M), headB = resample(shiftY(extendCurve(d.nut.curve, 1.2), 0.01), M);
    setPart('head', toGeometry(buildSlab(headA, headB, { K: 4, top: -1.2, bottom: -BOARD_T - NECK_DEPTH - 1, r: 2.4, uvLong: false })), `head:${M}`, mats.satin, { animate });
    setPart('neck', buildNeck(resample(shiftY(d.nut.curve, -2), M), endC, {}), `neck:${M}`, mats.satin, { animate });

    // --- frets
    const Mf = clamp(56 + N * 10, 64, 480);
    const prof = fretProfile(), fo = { pos: [], nor: [], uv: [], idx: [] };
    for (const f of d.frets) {
      const L = cumLen(f.curve), tot = L[L.length - 1];
      const path = resample(f.curve, Mf, FRET_TRIM, tot - FRET_TRIM);
      sweep(path, prof, { taper: (s, total) => { const dd = Math.min(s, total - s); if (dd >= FRET_BEVEL) return [1, 1]; const t = dd / FRET_BEVEL; const k = 0.32 + 0.68 * Math.sqrt(t); return [k, 0.82 + 0.18 * t]; }, out: fo });
    }
    setPart('frets', toGeometry(fo), `frets:${d.frets.length}:${Mf}`, mats.fret, { animate });

    // --- string heights
    const rads = d.strings.map(s => (s.gauge || 0.01) * INCH / 2);
    const nutBottom = FRET_H + 0.55;
    const heights = d.strings.map((s, i) => {
      const action = 1.45 + 0.85 * (N > 1 ? i / (N - 1) : 0.5);
      const b12 = FRET_H + action, bridgeBottom = 2 * b12 - nutBottom;
      return { nut: nutBottom + rads[i], bridge: bridgeBottom + rads[i], bridgeBottom };
    });
    const maxR = Math.max(...rads);

    // --- nut clamp block
    const nutTop = nutBottom + 2 * maxR + 2.4;
    const nutPath = resample(extendCurve(d.nut.curve, 0.6), M);
    const no = sweep(nutPath, roundRectProfile(-7.5, 0.2, -0.4, nutTop, 1.6), { closed: true });
    setPart('nut', toGeometry(no), `nut:${M}`, mats.anodized, { animate });
    // clamp screws between string pairs
    const screwM = [];
    const mtx = new THREE.Matrix4();
    for (let i = 0; i <= N; i++) {
      const u = N === 1 ? (i === 0 ? 0.15 : 0.85) : clamp((i) / N, 0.04, 0.96);
      const p = evalAt(nutPath, u);
      mtx.makeTranslation(p.x, nutTop + 0.05, -(p.y - 3.7));
      screwM.push(...mtx.elements);
    }
    const screwGeo = new THREE.CylinderGeometry(1.25, 1.25, 0.5, 18); screwGeo.translate(0, 0.25, 0); screwGeo.userData.key = 'nutscrew';
    setInstanced('screws', screwGeo, mats.steel, screwM, { animate });

    // --- strings
    const dirs = d.strings.map(s => { const dx = s.bridge.x - s.nut.x, dy = s.bridge.y - s.nut.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l, l }; });
    const sameStrings = strings.length === N;
    if (!sameStrings || !animate) { strings.forEach(s => { root.remove(s.mesh); s.mesh.geometry.dispose(); }); strings = []; }
    d.strings.forEach((s, i) => {
      const dir = dirs[i], h = heights[i];
      const a = [s.nut.x - dir.x * 5, h.nut, -(s.nut.y - dir.y * 5)];
      const b = [s.bridge.x + dir.x * 7, h.bridge, -(s.bridge.y + dir.y * 7)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const gaugeMM = 2 * rads[i], pitch = Math.max(0.16, gaugeMM * 0.3);
      const geo = unitCyl(rads[i], s.wound ? len / pitch : 0);
      const mat = s.wound ? mats.wound : mats.plain;
      let st = strings[i];
      if (!st) {
        const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = false; mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
        mesh.visible = showStrings;
        root.add(mesh); st = strings[i] = { mesh, live: new Float32Array([...a, ...b]) };
      } else {
        const old = st.mesh.geometry; st.mesh.geometry = geo; old.dispose(); st.mesh.material = mat;
        tweens.push({ live: st.live, from: st.live.slice(), to: new Float32Array([...a, ...b]), apply: () => applyString(st) });
      }
      applyString(st);
    });

    // --- bridge: one saddle unit per string in a row along the bridge line,
    // each with a steel crown, brass intonation screw, and a gloss-black
    // tuner barrel with brass rings that overhangs the tail of the body.
    const bSpacing = N > 1 ? Math.min(...d.strings.slice(1).map((s, i) => Math.hypot(s.bridge.x - d.strings[i].bridge.x, s.bridge.y - d.strings[i].bridge.y))) : 12;
    const sw = clamp(bSpacing * 0.8, 2.2, 10.5), sl = 15, rb = clamp(sw * 0.46, 1.1, 3.9);
    const base = BODY_TOP;
    const M4 = { saddle: [], crown: [], screw: [], barrel: [], ring: [], knob: [] };
    const X = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(), S = new THREE.Vector3(), Pp = new THREE.Vector3(), Q = new THREE.Quaternion(), Rm = new THREE.Matrix4();
    const qX90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), qb = new THREE.Quaternion();
    const along = (s, dir, t) => ({ x: s.bridge.x + dir.x * t, y: s.bridge.y + dir.y * t });
    const put = (arr, c, h, q, sx, sy, sz) => { mtx.compose(Pp.set(c.x, h, -c.y), q, S.set(sx, sy, sz)); arr.push(...mtx.elements); };
    d.strings.forEach((s, i) => {
      const dir = dirs[i];
      Z.set(dir.x, 0, -dir.y).normalize(); X.crossVectors(Y, Z).normalize();
      Rm.makeBasis(X, Y, Z); Q.setFromRotationMatrix(Rm);
      qb.copy(Q).multiply(qX90);
      const crownR = clamp(rads[i] + 0.7, 0.9, 1.5);
      const top = heights[i].bridgeBottom - 2 * crownR + 0.25;      // housing top under the crown
      const sh = Math.max(2.5, top - base);
      put(M4.saddle, along(s, dir, sl / 2 - 4), base + sh / 2, Q, sw, sh, sl);
      put(M4.crown, along(s, dir, 0), top + crownR - 0.3, Q, sw * 0.62, crownR, crownR);
      put(M4.screw, along(s, dir, 7.5), base + sh, Q, Math.min(sw * 0.24, 1.5), 0.7, Math.min(sw * 0.24, 1.5));
      const bh = base + rb + 0.5, b0 = sl - 4.5, bl = BARREL_LEN;
      put(M4.barrel, along(s, dir, b0 + bl / 2), bh, qb, rb, bl, rb);
      put(M4.ring, along(s, dir, b0 + 2.2), bh, qb, rb * 1.07, 1.4, rb * 1.07);
      put(M4.ring, along(s, dir, b0 + bl - 6), bh, qb, rb * 0.95, 1.0, rb * 0.95);
      put(M4.knob, along(s, dir, b0 + bl + 1.6), bh, qb, rb * 0.93, 3.2, rb * 0.93);
    });
    setInstanced('saddles', HW.saddle(), mats.anodized, M4.saddle, { animate });
    setInstanced('crowns', HW.crown(), mats.steel, M4.crown, { animate });
    setInstanced('sscrews', HW.screw(), mats.brass, M4.screw, { animate });
    setInstanced('barrels', HW.barrel(), mats.gloss, M4.barrel, { animate });
    setInstanced('rings', HW.ring(), mats.brass, M4.ring, { animate });
    setInstanced('knobs', HW.knob(), mats.gloss, M4.knob, { animate });

    // --- pickups: ivory covers on a line of equal string fraction between board end and bridge
    const tEnd = 1 - Math.pow(2, -d.frets.length / 12), ext = d.params?.boardExtension ?? 6;
    const gapMM = Math.min(...dirs.map(dd => dd.l * (1 - tEnd) - ext));
    const pickupTs = gapMM > 125 ? [0.34, 0.7] : gapMM > 70 ? [0.55] : [];
    pickupTs.forEach((ft, k) => {
      const pts = d.strings.map((s, i) => {
        const l = dirs[i].l, t0 = tEnd + (ext + 10) / l, t = t0 + (1 - t0 - 24 / l) * ft;
        return { x: s.nut.x + (s.bridge.x - s.nut.x) * t, y: s.nut.y + (s.bridge.y - s.nut.y) * t };
      });
      const path = resample(extendCurve(pts.length > 1 ? pts : [{ x: pts[0].x - 1, y: pts[0].y }, { x: pts[0].x + 1, y: pts[0].y }], 5), M);
      setPart('pickup' + k, toGeometry(sweep(path, roundRectProfile(-8.8, 8.8, BODY_TOP - 0.3, BODY_TOP + 5.6, 1.4), { closed: true })), `pickup:${M}`, mats.pickup, { animate });
    });
    for (let k = pickupTs.length; k < 2; k++) removePart('pickup' + k);

    // --- body (snaps rather than tweens; it is cheap to rebuild)
    const body = buildBody(d, { top: BODY_TOP, seam: BODY_SEAM, bottom: BODY_BOTTOM, chamfer: 3, tail: BODY_TAIL });
    const sigB = 'body' + Math.random();
    setPart('bodyShell', body.shell, sigB, mats.satin);
    setPart('bodyWood', body.wood, sigB, mats.accent);
    if (body.inlay) setPart('bodyInlay', body.inlay, sigB, mats.accent, { cast: false }); else removePart('bodyInlay');
    if (body.jackRing) { setPart('jackRing', body.jackRing, sigB, mats.steel, { cast: false }); setPart('jackHole', body.jackHole, sigB, mats.socket, { cast: false }); }
    else { removePart('jackRing'); removePart('jackHole'); }

    // --- side dots on the bass edge, pearl dots on the face at 12 & 24
    const dotM = [], inlayM = [];
    const edgePt = (f, end) => f ? f.curve[end ? f.curve.length - 1 : 0] : null;
    for (const n of MARKERS) {
      if (n > d.frets.length) break;
      const f1 = d.frets[n - 1], f0 = n > 1 ? d.frets[n - 2] : { curve: d.nut.curve, crossings: d.nut.crossings };
      const a = edgePt(f0, true), b = edgePt(f1, true);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1;
      const out = { x: ty / tl, y: -tx / tl };            // outward (bass) normal
      const sgn = out.x >= 0 ? 1 : -1; out.x *= sgn; out.y *= sgn;
      const offs = n % 12 === 0 ? [-3.2, 3.2] : [0];
      for (const o of offs) {
        const p = { x: m.x + tx / tl * o, y: m.y + ty / tl * o };
        Z.set(out.x, 0, -out.y).normalize();
        Q.setFromUnitVectors(Y, Z);
        mtx.compose(Pp.set(p.x, -2.0, -p.y), Q, S.set(1, 1, 1)); dotM.push(...mtx.elements);
      }
      if (n % 12 === 0 && N >= 2) {
        for (const fr of N >= 4 ? [0.27, 0.73] : [0.5]) {
          const k = fr * (N - 1), i0 = Math.floor(k), i1 = Math.min(N - 1, i0 + 1), tt = k - i0;
          const lerpC = c => ({ x: c[i0].x + (c[i1].x - c[i0].x) * tt, y: c[i0].y + (c[i1].y - c[i0].y) * tt });
          const p0 = lerpC(f0.crossings), p1 = lerpC(f1.crossings);
          mtx.compose(Pp.set((p0.x + p1.x) / 2, 0, -(p0.y + p1.y) / 2), Q.identity(), S.set(1, 1, 1)); inlayM.push(...mtx.elements);
        }
      }
    }
    const dotGeo = new THREE.CylinderGeometry(1.0, 1.0, 1.0, 20); dotGeo.userData.key = 'dot';
    dotM.length ? setInstanced('dots', dotGeo, mats.dot, dotM, { animate: false, cast: false }) : removePart('dots');
    const inlayGeo = new THREE.CylinderGeometry(2.2, 2.2, 0.3, 32); inlayGeo.translate(0, -0.13, 0); inlayGeo.userData.key = 'inlay';
    inlayM.length ? setInstanced('inlays', inlayGeo, mats.inlay, inlayM, { animate: false, cast: false }) : removePart('inlays');

    // --- analysis overlay: inflection beads on S-curve frets, glowing perpendicular line
    const beadM = [];
    for (const f of d.frets) for (const q of (f.inflectionPoints || [])) { mtx.makeTranslation(q.x, FRET_H + 0.1, -q.y); beadM.push(...mtx.elements); }
    const beadGeo = new THREE.SphereGeometry(0.7, 20, 12); beadGeo.userData.key = 'bead';
    beadM.length ? setInstanced('beads', beadGeo, mats.bead, beadM, { animate: false, cast: false, receive: false }) : removePart('beads');
    if (parts.beads) parts.beads.mesh.visible = overlay;
    const edgeX = e => { if (!e) return null; const [a, b] = e; const t = (0 - a.y) / ((b.y - a.y) || 1); return a.x + (b.x - a.x) * t; };
    let px0 = edgeX(d.edges?.treble), px1 = edgeX(d.edges?.bass);
    if (px0 == null || px1 == null) { const xs = d.outline.map(q => q.x); px0 = Math.min(...xs); px1 = Math.max(...xs); }
    const perpGeo = new THREE.PlaneGeometry(1, 1); perpGeo.rotateX(-Math.PI / 2);
    const pExt = 3, wPerp = (px1 - px0) + 2 * pExt;
    perpGeo.scale(wPerp, 1, 0.45); perpGeo.translate((px0 + px1) / 2, FRET_H + 0.4, 0);
    setPart('perp', perpGeo, 'perp-' + Math.round(wPerp * 10), mats.perp, { cast: false, receive: false });
    parts.perp.mesh.visible = overlay; parts.perp.mesh.renderOrder = 2;
    noAO.length = 1;
    for (const k of ['perp', 'beads', 'dots']) if (parts[k]) noAO.push(parts[k].mesh);

    // --- framing data, lights, ground shadow
    // Silhouette sample points (root space) for tight framing.
    const pts = [];
    const addP = (x, h, y) => pts.push(new THREE.Vector3(x, h, -y));
    for (const p of d.outline) { addP(p.x, 0.5, p.y); addP(p.x, -BOARD_T - NECK_DEPTH, p.y); }
    for (const s of d.strings) addP(s.nut.x, 0, s.nut.y - HEAD_LEN);
    const step = Math.max(1, Math.floor(body.outline.length / 60));
    for (let i = 0; i < body.outline.length; i += step) { const p = body.outline[i]; addP(p.x, BODY_TOP, p.y); addP(p.x, BODY_BOTTOM, p.y); }
    d.strings.forEach((s, i) => { const e = along(s, dirs[i], sl - 4.5 + BARREL_LEN + 3.2); addP(e.x, BODY_TOP + 2 * rb + 0.5, e.y); addP(e.x, BODY_TOP, e.y); });
    const box = new THREE.Box3().setFromPoints(pts);
    const boardBox = new THREE.Box3();
    for (const p of d.outline) boardBox.expandByPoint(new THREE.Vector3(p.x, 0, -p.y));
    for (const s of d.strings) { boardBox.expandByPoint(new THREE.Vector3(s.bridge.x, 0, -(s.bridge.y + 34))); boardBox.expandByPoint(new THREE.Vector3(s.nut.x, 0, -(s.nut.y - HEAD_LEN))); }
    // Anchor the instrument so its centre stays put in the world when the
    // design shifts (e.g. moving the perpendicular moves y = 0 along the board).
    const zOff = -boardBox.getCenter(new THREE.Vector3()).z, shift = new THREE.Vector3(0, 0, zOff);
    box.translate(shift); boardBox.translate(shift);
    for (const p of pts) p.add(shift);
    if (animate && parts.board && Math.abs(root.position.z - zOff) > 1e-6) {
      const live = new Float32Array([root.position.z]);
      tweens.push({ live, from: live.slice(), to: new Float32Array([zOff]), apply: () => { root.position.z = live[0]; } });
    } else root.position.z = zOff;
    const bridgeC = d.bridge.curve[Math.floor(d.bridge.curve.length / 2)];
    const fret7 = d.frets[Math.min(6, d.frets.length - 1)];
    const boardPts = pts.slice(0, d.outline.length * 2);
    frame = {
      box: boardBox, full: box, pts, boardPts, center: boardBox.getCenter(new THREE.Vector3()), size: boardBox.getSize(new THREE.Vector3()),
      bridge: new THREE.Vector3(bridgeC.x, 2, -(bridgeC.y + 10) + zOff),
      macro: fret7 ? new THREE.Vector3(0, 1, -fret7.curve[Math.floor(fret7.curve.length / 2)].y + zOff) : boardBox.getCenter(new THREE.Vector3()),
      nutZ: -d.nut.curve[Math.floor(d.nut.curve.length / 2)].y + zOff,
      features: body.features, bodySimple: body.plan.simple,
      bridgeW: Math.abs(d.strings[N - 1].bridge.x - d.strings[0].bridge.x) + 2 * rb + 30,
    };
    const fc3 = box.getCenter(new THREE.Vector3()), fs = box.getSize(new THREE.Vector3()), R = Math.max(fs.x, fs.z) * 0.62;
    key.target.position.copy(fc3); key.position.copy(fc3).addScaledVector(KEY_DIR, R * 3);
    Object.assign(key.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: R * 1.2, far: R * 5 });
    key.shadow.camera.updateProjectionMatrix();
    rim.target.position.copy(fc3); rim.position.copy(fc3).addScaledVector(RIM_DIR, R * 3);
    const pad = 70;
    contact.setFootprint(fc3.x, fc3.z, fs.x + pad * 2, fs.z + pad * 2, FLOOR_Y);
    contactDirty = true;

    if (tweens.length) { tween0 = performance.now(); tweenDur = 240; }
    renderer.shadowMap.needsUpdate = true;
    dirty = true;
  }

  function stepTweens(now) {
    if (!tweens.length) return false;
    const k = ease(clamp((now - tween0) / tweenDur, 0, 1));
    for (const t of tweens) {
      const { live, from, to } = t;
      for (let i = 0; i < live.length; i++) live[i] = from[i] + (to[i] - from[i]) * k;
      if (t.attr) t.attr.needsUpdate = true;
      if (t.apply) t.apply();
    }
    renderer.shadowMap.needsUpdate = true;
    contactDirty = true;
    if (k >= 1) tweens = [];
    return true;
  }

  // --------------------------------------------------------- camera ------
  let insets = { left: 0, right: 0, top: 0, bottom: 0 };
  let W = 1, H = 1;
  function applyViewOffset() {
    const dx = (insets.left - insets.right) / 2, dy = (insets.top - insets.bottom) / 2;
    camera.setViewOffset(W, H, -dx, -dy, W, H);
    post.setCenter(W / 2 + dx, H / 2 + dy);
  }
  // Hero: a low, dramatic three-quarter from the bridge end on the bass side
  // (vents and inlay towards camera, neck rising away like the reference),
  // long lens; the instrument fills ~3/4 of the free viewport.
  const VIEWS = {
    hero: { dir: [0.32, 0.5, -0.8], fill: 0.8 },
    player: { dir: [0.62, 0.78, 0.04], fill: 0.86 },
    top: { dir: [0.0015, 1, 0], fill: 0.9, board: false, flat: true },
    // Top 180°: the same flat plan view rotated half a turn in the screen plane
    // (nut and treble edge swap sides).
    top180: { dir: [-0.0015, 1, 0], fill: 0.9, board: false, flat: true },
    // Back: the top view turned 180° about the instrument's long axis (underside up).
    back: { dir: [0.0015, -1, 0], fill: 0.9, board: false },
    macro: { dir: [0.16, 0.16, 1], fixed: 0.42 },
    bridge: { dir: [0.46, 0.5, 0.74], fixed: 0 },
  };
  const _r = new THREE.Vector3(), _up = new THREE.Vector3(), _f = new THREE.Vector3(), _c = new THREE.Vector3();
  // Fit a point cloud: find target + distance so the projected silhouette is
  // centred in the free viewport and fills `fill` of its limiting dimension.
  function fitPose(dir, pts, fill, fovDeg = FOV) {
    const fov = THREE.MathUtils.degToRad(fovDeg);
    const tanV = Math.tan(fov / 2) * Math.max(0.2, (H - insets.top - insets.bottom) / H) * fill;
    const tanH = Math.tan(fov / 2) * camera.aspect * Math.max(0.2, (W - insets.left - insets.right) / W) * fill;
    _f.copy(dir).negate();
    // Screen 'up' exactly as camera.lookAt() will choose it (world Y projected
    // off the view direction), including the near-vertical plan views.
    _up.set(0, 1, 0).addScaledVector(_f, -_f.y).normalize();
    _r.crossVectors(_f, _up).normalize(); _up.crossVectors(_r, _f);
    const target = new THREE.Vector3();
    for (const p of pts) target.add(p);
    target.multiplyScalar(1 / pts.length);
    let D = 0;
    for (let it = 0; it < 4; it++) {
      D = 0;
      for (const p of pts) {
        _c.copy(p).sub(target);
        const qx = _c.dot(_r), qy = _c.dot(_up), qz = _c.dot(_f);
        D = Math.max(D, Math.abs(qx) / tanH - qz, Math.abs(qy) / tanV - qz);
      }
      // re-centre on the projected extents
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        _c.copy(p).sub(target);
        const z = D + _c.dot(_f), x = _c.dot(_r) / z, y = _c.dot(_up) / z;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      target.addScaledVector(_r, (x0 + x1) / 2 * D).addScaledVector(_up, (y0 + y1) / 2 * D);
    }
    return { target, dist: D };
  }
  function viewPose(name) {
    const v = VIEWS[name] || VIEWS.hero;
    const dir = new THREE.Vector3(...v.dir).normalize();
    let target, dist;
    if (name === 'macro') {
      target = frame.macro.clone();
      dist = frame.size.z * v.fixed;
    } else if (name === 'bridge') {
      target = frame.bridge.clone();
      dist = Math.max(150, frame.bridgeW * 1.15 + 70);
    } else {
      ({ target, dist } = fitPose(dir, v.board ? frame.boardPts : frame.pts, v.fill, v.flat ? FLAT_FOV : FOV));
    }
    return { pos: target.clone().addScaledVector(dir, dist), target, fov: v.flat ? FLAT_FOV : FOV };
  }
  let fly = null, currentView = 'hero', pendingView = false;
  function flyTo(name, { instant = false, dur = 1400 } = {}) {
    if (!frame) return;
    if (H < 40) { currentView = name; pendingView = true; return; }
    currentView = name;
    const to = viewPose(name);
    controls.maxDistance = Math.max(MAX_DIST_FOR(camera.fov), MAX_DIST_FOR(to.fov));
    if (instant) { setFov(to.fov); camera.position.copy(to.pos); controls.target.copy(to.target); controls.update(); dirty = true; return; }
    fly = { t0: performance.now(), dur, fromPos: camera.position.clone(), fromT: controls.target.clone(), fromFov: camera.fov, to };
    controls.enabled = false;
  }
  function MAX_DIST_FOR(fovDeg) { return fovDeg < 1 ? 5e6 : 8000; }
  function updatePxPerUnit() {
    stringUniforms.uPxPerUnit.value = (H * renderer.getPixelRatio() / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  }
  function setFov(f) {
    if (camera.fov === f) return;
    camera.fov = f; camera.updateProjectionMatrix(); updatePxPerUnit(); dirty = true;
  }
  // Turn the camera about the instrument's long axis (world Z) to the next
  // multiple of `deg` degrees, measured from straight above (Top = 0°, Back = 180°).
  // Elevation along the neck is kept, so from Hero it turns the instrument over.
  function rollView(deg = 45) {
    if (!frame) return 0;
    const cur = (fly ? fly.to.pos.clone().sub(fly.to.target) : camera.position.clone().sub(controls.target)).normalize();
    const a = Math.atan2(cur.x, cur.y), step = THREE.MathUtils.degToRad(Math.abs(deg)), eps = 0.01;
    const k = deg > 0 ? Math.floor(a / step + eps + 1) : Math.ceil(a / step - eps - 1);
    const next = k * step, rxy = Math.max(Math.hypot(cur.x, cur.y), 0.2);
    const dir = new THREE.Vector3(Math.sin(next) * rxy, Math.cos(next) * rxy, Math.abs(cur.z) > 0.98 ? 0 : cur.z);
    // Never sit exactly on a pole: keep the same tiny sideways nudge the Top view uses.
    if (Math.abs(dir.y) > 0.999 * dir.length()) dir.x = 0.0015 * dir.length();
    const flatNow = (fly ? fly.to.fov ?? FOV : camera.fov) < 1;
    VIEWS.roll = { dir: dir.normalize().toArray(), fill: 0.88, board: false, flat: flatNow };
    flyTo('roll', { dur: 900 });
    return ((Math.round(THREE.MathUtils.radToDeg(next)) % 360) + 360) % 360;
  }
  const _s0 = new THREE.Spherical(), _s1 = new THREE.Spherical();
  function stepFly(now) {
    if (!fly) return false;
    const k = clamp((now - fly.t0) / fly.dur, 0, 1), e = fly.easeFn ? fly.easeFn(k) : ease(k);
    const tgt = fly.fromT.clone().lerp(fly.to.target, e);
    _s0.setFromVector3(fly.fromPos.clone().sub(fly.fromT));
    _s1.setFromVector3(fly.to.pos.clone().sub(fly.to.target));
    let dth = _s1.theta - _s0.theta; if (dth > Math.PI) dth -= 2 * Math.PI; if (dth < -Math.PI) dth += 2 * Math.PI;
    const sp = new THREE.Spherical(
      Math.exp(Math.log(_s0.radius) + (Math.log(_s1.radius) - Math.log(_s0.radius)) * e),
      _s0.phi + (_s1.phi - _s0.phi) * e, _s0.theta + dth * e);
    camera.position.copy(tgt).add(new THREE.Vector3().setFromSpherical(sp));
    controls.target.copy(tgt);
    camera.lookAt(tgt);
    // Lens and distance change together (log space), so the framing holds while
    // the view flattens into (or out of) the orthographic-like flat views.
    const f0 = fly.fromFov ?? camera.fov, f1 = fly.to.fov ?? FOV;
    if (f0 !== f1) setFov(Math.exp(Math.log(f0) + (Math.log(f1) - Math.log(f0)) * e));
    if (k >= 1) { fly = null; setFov(f1); controls.maxDistance = MAX_DIST_FOR(f1); controls.enabled = true; controls.update(); }
    return true;
  }

  // ----------------------------------------------------------- intro -----
  // The instrument settles down onto the studio floor as the camera swings in.
  let intro = null;
  function playIntro() {
    if (!frame) return;
    if (H < 40) { pendingView = true; return; }
    const hero = viewPose('hero');
    const start = hero.pos.clone().sub(hero.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.75).multiplyScalar(1.55);
    start.y *= 0.55;
    camera.position.copy(hero.target).add(start); controls.target.copy(hero.target); camera.lookAt(hero.target);
    fly = { t0: performance.now() + 150, dur: 3000, fromPos: camera.position.clone(), fromT: hero.target.clone(), to: hero, easeFn: easeOut };
    controls.enabled = false;
    intro = { t0: performance.now(), dur: 2400 };
    root.position.y = INTRO_LIFT;
  }
  function stepIntro(now) {
    if (!intro) return false;
    const k = clamp((now - intro.t0) / intro.dur, 0, 1);
    root.position.y = INTRO_LIFT * (1 - easeOut(k));
    if (k >= 1) intro = null;
    renderer.shadowMap.needsUpdate = true;
    contactDirty = true;
    return true;
  }

  // ------------------------------------------------------------ loop -----
  let dirty = true, running = true, autoRotate = false, lastInteract = 0;
  controls.addEventListener('start', () => { lastInteract = performance.now(); api._touched = true; if (autoRotate) { autoRotate = false; controls.autoRotate = false; api.onAutoRotateStop?.(); } fly = null; controls.enabled = true; });
  controls.addEventListener('change', () => { dirty = true; });
  function updateDoF() {
    // Shallow focus only for the macro view, focused on the orbit target.
    const on = dofWanted && quality >= 2 && currentView === 'macro';
    post.dof.enabled = on;
    if (on) post.dof.uniforms.focus.value = camera.position.distanceTo(controls.target);
  }
  const _ud = new THREE.Vector3(), _szv = new THREE.Vector3();
  function updateUnderFill() {
    _ud.copy(camera.position).sub(controls.target);
    const len = _ud.length() || 1, below = clamp(-_ud.y / len, 0, 1);
    under.intensity = 2.2 * below;
    if (below > 0) {
      _ud.multiplyScalar(1 / len); _ud.x += 0.25; _ud.normalize();
      under.position.copy(controls.target).addScaledVector(_ud, 1000);
      under.target.position.copy(controls.target); under.target.updateMatrixWorld();
    }
  }
  function draw() {
    updateUnderFill();
    if (contactDirty) { contact.render(scene, noAO.slice(1)); contactDirty = false; }
    updateDoF();
    if (quality >= 1) post.render(); else renderer.render(scene, camera);
  }
  const fpsWin = []; let lastT = performance.now(), degradeCooldown = 0;
  function loop(now) {
    if (!running) return;
    requestAnimationFrame(loop);
    if (document.hidden) return;
    let active = false;
    active = stepIntro(now) || active;
    active = stepFly(now) || active;
    active = stepTweens(now) || active;
    if (!fly) { controls.autoRotate = autoRotate; if (controls.update()) active = true; }
    if (autoRotate) active = true;
    if (!active && !dirty) { lastT = now; return; }
    const dist = camera.position.distanceTo(controls.target);
    // Near plane hugs the instrument when the camera is far away (flat views) to keep depth precision.
    const R = frame ? frame.full.getSize(_szv).length() : 2000;
    camera.near = Math.max(clamp(dist / 300, 0.2, 20), dist - 3 * R); camera.far = dist * 40 + 5000; camera.updateProjectionMatrix();
    draw();
    dirty = false;
    // adaptive quality: watch frame time while animating. Drops GTAO first,
    // then bloom and DPR, then the composer itself.
    const dt = now - lastT; lastT = now;
    if (dt < 250) { fpsWin.push(dt); if (fpsWin.length > 90) fpsWin.shift(); }
    if (fpsWin.length >= 90 && now > degradeCooldown) {
      // Median, not mean: shader compiles and texture uploads in the first
      // frames must not cost a capable GPU its ambient occlusion.
      const avg = fpsWin.slice().sort((a, b) => a - b)[fpsWin.length >> 1];
      const limit = quality >= 3 ? 19.5 : quality === 2 ? 22 : 30;
      if (avg > limit && quality > 0) { setQuality(quality - 1); degradeCooldown = now + 4000; fpsWin.length = 0; }
      onStats?.({ fps: 1000 / avg, quality });
    }
  }
  function setQuality(q) {
    const prev = quality;
    quality = clamp(q, 0, 3);
    post.setQuality(quality);
    dprCap = quality >= 2 ? DPR_BASE : quality === 1 ? Math.min(DPR_BASE, 1.5) : 1;
    const sm = quality === 0 || isSmall ? 2048 : 4096;
    if (key.shadow.mapSize.x !== sm) {
      key.shadow.mapSize.set(sm, sm); key.shadow.map?.dispose(); key.shadow.map = null;
      renderer.shadowMap.needsUpdate = true;
    }
    if (prev !== quality) fpsWin.length = 0;
    resize();
  }
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width)); H = Math.max(1, Math.round(rect.height));
    // Pixel budget per quality level: big retina canvases are fill-rate bound,
    // and 4x MSAA already resolves edges, so cap total pixels, not just DPR.
    const budget = [0.9e6, 1.6e6, 2.4e6, 2.1e6][quality];
    const dpr = Math.max(0.75, Math.min(window.devicePixelRatio || 1, dprCap, Math.sqrt(budget / (W * H))));
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    updatePxPerUnit();
    post.setSize(W, H, renderer.getPixelRatio());
    camera.aspect = W / H;
    applyViewOffset();
    camera.updateProjectionMatrix();
    dirty = true;
    if (pendingView && H >= 40 && frame) { pendingView = false; flyTo(currentView, { dur: 900 }); }
  }

  const api = {
    renderer, scene, camera, controls,
    _touched: false,
    setDesign(d, opts) { const first = !design; build(d, opts); if (first) flyTo('hero', { instant: true }); },
    setFinish(f) {
      finish = { ...finish, ...f };
      if (f.fret) { mats.fret.dispose(); mats.fret = makeFretMaterial(finish.fret); if (parts.frets) parts.frets.mesh.material = mats.fret; }
      if (f.wood) { mats.wood.dispose(); mats.wood = makeWoodMaterial(finish.wood); if (parts.board) parts.board.mesh.material = mats.wood; }
      dirty = true;
    },
    setShowStrings(on) { showStrings = on; strings.forEach(s => s.mesh.visible = on); renderer.shadowMap.needsUpdate = true; contactDirty = true; dirty = true; },
    setOverlay(on) { overlay = on; if (parts.beads) parts.beads.mesh.visible = on; if (parts.perp) parts.perp.mesh.visible = on; dirty = true; },
    setAutoRotate(on) { autoRotate = on; controls.autoRotate = on; dirty = true; },
    get autoRotate() { return autoRotate; },
    view: flyTo,
    rotate: rollView,
    get currentView() { return currentView; },
    reframe() { if (frame) flyTo(currentView, { dur: 700 }); },
    setInsets(i) { insets = { ...insets, ...i }; applyViewOffset(); camera.updateProjectionMatrix(); dirty = true; },
    intro: playIntro,
    resize,
    setQuality, get quality() { return quality; },
    // Shallow depth of field in the Macro view (off elsewhere, and off by default).
    setDepthOfField(on) { dofWanted = !!on; dirty = true; },
    get depthOfField() { return dofWanted; },
    invalidate() { dirty = true; },
    get _frame() { return frame; },
    get _views() { return VIEWS; },
    get _post() { return post; },
    get _mats() { return mats; },
    _lights: { key, rim, fill, under },
    // Render synchronously and copy the frame (preserveDrawingBuffer is off).
    snapshot(region = [0, 0, 1, 1]) {
      draw();
      const c = renderer.domElement, w = c.width, h = c.height;
      const out = document.createElement('canvas');
      out.width = Math.round(region[2] * w); out.height = Math.round(region[3] * h);
      out.getContext('2d').drawImage(c, region[0] * w, region[1] * h, out.width, out.height, 0, 0, out.width, out.height);
      return out;
    },
    dispose() {
      running = false; ro.disconnect();
      for (const k of Object.keys(parts)) removePart(k);
      strings.forEach(s => s.mesh.geometry.dispose());
      for (const m of Object.values(mats)) m.dispose?.();
      post.dispose(); contact.dispose(); envRT.dispose(); controls.dispose(); renderer.dispose();
    },
    onAutoRotateStop: null,
  };
  setQuality(quality);
  let roT = null;
  const ro = new ResizeObserver(() => { cancelAnimationFrame(roT); roT = requestAnimationFrame(resize); });
  ro.observe(canvas.parentElement);
  requestAnimationFrame(loop);
  return api;
}

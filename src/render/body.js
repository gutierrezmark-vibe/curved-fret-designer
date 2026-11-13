// render/body.js — the headless body: an angular, swept, asymmetric shell with
// chamfered edges, a figured-wood back layer, a tapered wood inlay and slot
// vents on the bass wing, and a recessed output jack on the treble point.
//
// Everything is derived from the design's real geometry (board edges, bridge
// line, string directions), so it adapts to 1-24+ strings, fans, convergent
// and divergent layouts. Every derived feature (inlay, vents, jack) is
// validated against the outline and a keep-out zone around the strings and
// hardware, and is simply left out when it would not fit cleanly.
//
// Design coordinates: x across the strings (treble -, bass +), y along the
// strings (nut -, bridge +). Three: (x, h, -y).
import * as THREE from 'three';

const V = (x, y) => ({ x, y });
const add = (a, b) => V(a.x + b.x, a.y + b.y);
const sub = (a, b) => V(a.x - b.x, a.y - b.y);
const mul = (a, k) => V(a.x * k, a.y * k);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = a => Math.hypot(a.x, a.y);
const norm = a => { const l = len(a) || 1; return V(a.x / l, a.y / l); };
const lerp = (a, b, t) => V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function area(P) { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a.x * b.y - b.x * a.y; } return s / 2; }
function ccw(P) { return area(P) < 0 ? P.slice().reverse() : P; }
function segX(a, b, c, d) {
  const d1 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x), d2 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
  const d3 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x), d4 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
function isSimple(P) {
  const n = P.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segX(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) return false;
  }
  return true;
}
function inside(p, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
// Allocation-free squared distance to a polygon's edges (hot path).
function edgeDist(p, P) {
  let m = Infinity; const n = P.length, px = p.x, py = p.y;
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[i + 1 === n ? 0 : i + 1], abx = b.x - a.x, aby = b.y - a.y;
    const L2 = abx * abx + aby * aby || 1;
    let t = ((px - a.x) * abx + (py - a.y) * aby) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - a.x - abx * t, dy = py - a.y - aby * t, d = dx * dx + dy * dy;
    if (d < m) m = d;
  }
  return Math.sqrt(m);
}
function hull(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y), cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// Round each corner i with radius r[i] (quadratic fillet), dense output.
function roundCorners(P, R, seg = 7) {
  const n = P.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = P[i], a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
    const da = len(sub(a, p)), db = len(sub(b, p)), r = Math.min(R[i] || 0, da * 0.45, db * 0.45);
    if (r < 0.05) { out.push(p); continue; }
    const p1 = add(p, mul(sub(a, p), r / da)), p2 = add(p, mul(sub(b, p), r / db));
    for (let s = 0; s <= seg; s++) {
      const t = s / seg, u = 1 - t;
      out.push(V(u * u * p1.x + 2 * u * t * p.x + t * t * p2.x, u * u * p1.y + 2 * u * t * p.y + t * t * p2.y));
    }
  }
  // drop near-duplicates
  return out.filter((q, i) => len(sub(q, out[(i + 1) % out.length])) > 0.05);
}
// Outward unit normals and miter scale at each vertex of a CCW polygon.
function vertexNormals(P) {
  const n = P.length, N = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], p = P[i], b = P[(i + 1) % n];
    const e1 = norm(sub(p, a)), e2 = norm(sub(b, p));
    const n1 = V(e1.y, -e1.x), n2 = V(e2.y, -e2.x);
    const m = norm(add(n1, n2)), c = Math.max(0.35, dot(m, n1));
    N.push({ n: m, k: 1 / c });
  }
  return N;
}
const offset = (P, d) => { const N = vertexNormals(P); return P.map((p, i) => add(p, mul(N[i].n, d * N[i].k))); };
function stadium(a, b, r, seg = 8) {
  const t = norm(sub(b, a)), n = V(-t.y, t.x), out = [];
  for (let s = 0; s <= seg; s++) { const th = Math.PI / 2 + Math.PI * s / seg; out.push(add(a, add(mul(t, Math.cos(th) * r), mul(n, Math.sin(th) * r)))); }
  for (let s = 0; s <= seg; s++) { const th = -Math.PI / 2 + Math.PI * s / seg; out.push(add(b, add(mul(t, Math.cos(th) * r), mul(n, Math.sin(th) * r)))); }
  return ccw(out);
}
function circle(c, r, seg = 28) { const out = []; for (let s = 0; s < seg; s++) { const th = 2 * Math.PI * s / seg; out.push(V(c.x + Math.cos(th) * r, c.y + Math.sin(th) * r)); } return out; }

// ------------------------------------------------------------ mesh build ----
function builder() { return { pos: [], nor: [], uv: [], idx: [] }; }
function vert(o, x, h, y, nx, nh, ny, u, v) { o.pos.push(x, h, -y); o.nor.push(nx, nh, -ny); o.uv.push(u, v); return o.pos.length / 3 - 1; }
// Sweep a (w, h) profile around a closed CCW outline. w is the outward offset
// from the outline, (nw, nh) the profile normal (nw outward). flip: hole walls.
function wall(o, P, prof, { flip = false, uvAlong = false } = {}) {
  const N = vertexNormals(P), n = P.length, base = o.pos.length / 3;
  const arc = [0]; for (let i = 1; i <= n; i++) arc.push(arc[i - 1] + len(sub(P[i % n], P[i - 1])));
  for (let i = 0; i <= n; i++) {
    const p = P[i % n], { n: nv, k } = N[i % n];
    for (const q of prof) {
      const nw = flip ? -q.nw : q.nw;
      vert(o, p.x + nv.x * q.w * k, q.h, p.y + nv.y * q.w * k, nv.x * nw, q.nh, nv.y * nw, uvAlong ? q.h : arc[i], uvAlong ? arc[i] : q.h);
    }
  }
  const m = prof.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < m - 1; j++) {
    const a = base + i * m + j, b = a + 1, c = a + m, d = c + 1;
    o.idx.push(a, c, b, b, c, d);
  }
}
function cap(o, P, holes, h, up = 1) {
  const c2 = P.map(p => new THREE.Vector2(p.x, p.y)), h2 = holes.map(H => H.map(p => new THREE.Vector2(p.x, p.y)));
  const tris = THREE.ShapeUtils.triangulateShape(c2, h2);
  const all = [...P, ...holes.flat()], base = o.pos.length / 3;
  for (const p of all) vert(o, p.x, h, p.y, 0, up, 0, p.x, p.y);
  for (const t of tris) o.idx.push(base + t[0], base + t[1], base + t[2]);
}
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
function geometry(o) {
  orient(o.pos, o.nor, o.idx);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(o.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2));
  g.setIndex(o.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(o.idx, 1) : new THREE.Uint16BufferAttribute(o.idx, 1));
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------- outline -----
function endpoints(curve) {
  const a = curve[0], b = curve[curve.length - 1];
  return a.x <= b.x ? [a, b] : [b, a];
}
/**
 * Body plan in design coordinates.
 * tail: how far past the bridge line the body ends (tuner barrels overhang it).
 */
export function bodyPlan(d, { tail = 24, keepReach = 46 } = {}) {
  const S = d.strings, N = S.length, tr = S[0], bs = S[N - 1];
  const dirOf = s => norm(sub(s.bridge, s.nut));
  const uT = dirOf(tr), uB = dirOf(bs);
  const oT = V(-uT.y, uT.x), oB = V(uB.y, -uB.x);              // outward (treble -x, bass +x)
  const [nT, nB] = endpoints(d.nut.curve), [eT, eB] = endpoints(d.boardEnd.curve);
  const edgeT = d.edges?.treble, edgeB = d.edges?.bass;
  const BTe = edgeT ? edgeT[1] : add(tr.bridge, mul(oT, 4)), BBe = edgeB ? edgeB[1] : add(bs.bridge, mul(oB, 4));
  const W = len(sub(BBe, BTe));
  const wing = clamp(42 + 0.2 * W, 46, 92), wingT = clamp(22 + 0.1 * W, 26, 46);
  const eDirB = norm(sub(eB, nB)), eDirT = norm(sub(eT, nT));
  const boardLenB = len(sub(eB, nB));
  const horn = clamp(0.25 * bs.scale, 110, boardLenB * 0.8);
  // A: horn tip, running up the bass edge of the neck.
  const A = add(sub(eB, mul(eDirB, horn)), mul(oB, 1.2));
  const B = add(add(BBe, mul(oB, wing)), mul(uB, -16));
  const C = add(add(BBe, mul(oB, wing * 0.5)), mul(uB, tail + 3));
  const tailPts = [add(BBe, mul(uB, tail))];
  for (let i = N - 1; i >= 0; i--) tailPts.push(add(S[i].bridge, mul(dirOf(S[i]), tail)));
  tailPts.push(add(BTe, mul(uT, tail)));
  const D = add(add(BTe, mul(uT, tail + 2)), mul(oT, 7));
  const E = add(add(BTe, mul(oT, wingT)), mul(uT, tail + 13));
  const F = add(lerp(eT, BTe, 0.3), mul(oT, wingT * 0.62));
  const G = add(sub(eT, mul(eDirT, 30)), mul(oT, -2.5));
  const corners = [A, B, C, ...tailPts, D, E, F, G];
  const radii = [9, 14, 10, ...tailPts.map((_, i) => i === 0 || i === tailPts.length - 1 ? 4 : 0), 7, 9, 40, 7];
  let P = roundCorners(corners, radii);
  let ok = P.length > 4 && isSimple(P);
  if (!ok) {                                                  // pathological layout: safe hull
    const H = hull(corners);
    P = roundCorners(H, H.map(() => 8));
  }
  P = ccw(P);
  // Keep-out: strings, board and hardware (tuners included), plus margin.
  const keepPts = [...d.outline];
  for (const s of S) { const u = dirOf(s); keepPts.push(s.bridge, add(s.bridge, mul(u, keepReach))); }
  keepPts.push(BTe, BBe, add(BTe, mul(uT, keepReach)), add(BBe, mul(uB, keepReach)));
  const keep = ccw(hull(keepPts));
  return { P, keep, A, B, C, E, F, BBe, BTe, uB, uT, oB, oT, wing, W, simple: ok };
}

/**
 * Build body meshes.
 * levels: { top, seam, bottom } heights (top of the black shell, the seam to
 * the wood back layer, underside).
 * Returns geometries { shell, wood, inlay, jackRing, jackHole } (some may be
 * null) and the outline for framing.
 */
export function buildBody(d, { top, seam, bottom, chamfer = 3, tail = 24 }) {
  const plan = bodyPlan(d, { tail });
  const { P, keep, A, B } = plan;
  const shell = builder(), wood = builder(), inlayB = builder();
  const inner = offset(P, -chamfer);
  const holes = [];             // outer outlines of top-cap holes
  const okHole = (H, clear = 2.6, keepClear = 4) => H.every(p => inside(p, inner) && edgeDist(p, inner) >= clear && !inside(p, keep) && edgeDist(p, keep) >= keepClear)
    && holes.every(o => H.every(p => !inside(p, o) && edgeDist(p, o) >= 2.2) && o.every(p => !inside(p, H)));

  // --- bass wing: tapered wood inlay + slot vents parallel to the swept edge
  const L = len(sub(B, A)), eAB = norm(sub(B, A));
  let nIn = V(-eAB.y, eAB.x);
  if (dot(nIn, sub(plan.BBe, B)) < 0) nIn = mul(nIn, -1);
  const at = (t, o) => add(add(A, mul(eAB, t * L)), mul(nIn, o));
  const inset = chamfer + 1.9;
  const wMax = clamp(plan.wing * 0.2, 6, 13);
  let inlay = null;
  {
    const t0 = 0.3, t1 = 1 - 22 / L, M = 24, outer = [], innerE = [];
    if (t1 - t0 > 0.15) {
      for (let s = 0; s <= M; s++) {
        const t = t0 + (t1 - t0) * s / M, w = wMax * Math.pow(s / M, 0.8);
        outer.push(at(t, inset)); innerE.push(at(t, inset + Math.max(0.25, w)));
      }
      const poly = ccw([...outer, ...innerE.reverse()]);
      const hole = offset(poly, 0.7);
      if (okHole(hole, 1.0)) { inlay = poly; holes.push(hole); }
    }
  }
  const slotW = clamp(plan.wing * 0.1, 4.5, 7), gap = 4.2;
  const slots = [];
  {
    const o0 = inset + (inlay ? wMax + 4.5 : 2) + slotW / 2 + 1;
    const maxLen = clamp(0.32 * L, 26, 72);
    for (let k = 0; k < 5; k++) {
      const o = o0 + k * (slotW + gap);
      // longest valid run along the edge (1 mm steps)
      const steps = Math.max(2, Math.floor(L / 2.5)), valid = [];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, c = at(t, o);
        let ok = !inside(c, keep) && edgeDist(c, keep) >= slotW / 2 + 5;
        if (ok) for (const p of [at(t, o - slotW / 2 - 0.9), at(t, o + slotW / 2 + 0.9)]) if (!inside(p, inner) || edgeDist(p, inner) < 3) { ok = false; break; }
        valid.push(ok);
      }
      let best = null, run = null;
      for (let s = 0; s <= steps; s++) {
        if (valid[s]) { if (!run) run = [s, s]; else run[1] = s; } else run = null;
        if (run && (!best || run[1] - run[0] > best[1] - best[0])) best = run.slice();
      }
      if (!best) break;
      const runLen = (best[1] - best[0]) / steps * L - slotW - 2;
      const want = maxLen * (1 - 0.14 * k);
      const sl = Math.min(want, runLen);
      if (sl < 16) break;
      // anchor near the lower (B) end, staggered upward
      const tEnd = best[1] / steps * L - slotW / 2 - 1 - k * 5;
      const tStart = tEnd - sl;
      if (tStart < best[0] / steps * L + slotW / 2) break;
      const poly = stadium(at(tStart / L, o), at(tEnd / L, o), slotW / 2);
      const hole = offset(poly, 0.9);
      if (!okHole(hole)) break;
      slots.push(poly); holes.push(hole);
    }
  }
  // --- recessed jack near the treble point: nearest spot to the point E
  // where the cup clears the edges, the strings/hardware and other holes.
  let jack = null;
  {
    const Rj = 6.6, need = Rj + 0.8, E = plan.E, cands = [];
    for (let gx = -80; gx <= 80; gx += 4) for (let gy = -100; gy <= 36; gy += 4) {
      const p = V(E.x + gx, E.y + gy);
      if (inside(p, keep) || edgeDist(p, keep) < need + 3.5) continue;
      if (!inside(p, inner) || edgeDist(p, inner) < need + 2.6) continue;
      cands.push({ p, d: gx * gx + gy * gy });
    }
    cands.sort((a, b) => a.d - b.d);
    for (const { p } of cands.slice(0, 12)) {
      const hole = circle(p, need);
      if (okHole(hole, 2.5, 3.5)) { jack = { c: p, r: Rj }; holes.push(hole); break; }
    }
  }
  // --- shell (satin black): top cap with holes, chamfered outer wall to the seam
  const c = chamfer, g = 0.9, s2 = Math.SQRT1_2;
  cap(shell, inner, holes, top, 1);
  wall(shell, P, [
    { w: -c, h: top, nw: s2, nh: s2 }, { w: 0, h: top - c, nw: s2, nh: s2 },
    { w: 0, h: top - c, nw: 1, nh: 0 }, { w: 0, h: seam + g, nw: 1, nh: 0 },
    { w: 0, h: seam + g, nw: s2, nh: -s2 }, { w: -g, h: seam, nw: s2, nh: -s2 },
  ]);
  // --- wood back layer
  const e = 1.6;
  wall(wood, P, [
    { w: -g, h: seam, nw: s2, nh: s2 }, { w: 0, h: seam - g, nw: s2, nh: s2 },
    { w: 0, h: seam - g, nw: 1, nh: 0 }, { w: 0, h: bottom + e, nw: 1, nh: 0 },
    { w: -e * 0.3, h: bottom + e * 0.12, nw: 0.7, nh: -0.7 }, { w: -e, h: bottom, nw: 0.2, nh: -0.98 },
  ], { uvAlong: true });
  cap(wood, offset(P, -e), [], bottom, -1);
  // --- slots: chamfered walls through the shell to the wood layer below
  for (const S of slots) {
    wall(shell, S, [
      { w: 0.9, h: top, nw: s2, nh: s2 }, { w: 0, h: top - 0.9, nw: s2, nh: s2 },
      { w: 0, h: top - 0.9, nw: 1, nh: 0 }, { w: 0, h: seam, nw: 1, nh: 0 },
    ], { flip: true });
    cap(wood, S, [], seam, 1);
  }
  // --- inlay: recessed figured wood
  const recess = 0.9;
  if (inlay) {
    wall(shell, inlay, [
      { w: 0.7, h: top, nw: s2, nh: s2 }, { w: 0, h: top - 0.7, nw: s2, nh: s2 },
      { w: 0, h: top - 0.7, nw: 1, nh: 0 }, { w: 0, h: top - recess, nw: 1, nh: 0 },
    ], { flip: true });
    cap(inlayB, inlay, [], top - recess, 1);
  }
  // --- jack: chamfered cup, chrome nut and dark socket
  let jackRing = null, jackHole = null;
  if (jack) {
    const J = jack.c, cup = circle(J, jack.r), depth = 3.2;
    wall(shell, cup, [
      { w: 0.8, h: top, nw: s2, nh: s2 }, { w: 0, h: top - 0.8, nw: s2, nh: s2 },
      { w: 0, h: top - 0.8, nw: 1, nh: 0 }, { w: 0, h: top - depth, nw: 1, nh: 0 },
    ], { flip: true });
    cap(shell, cup, [circle(J, 5.4)], top - depth, 1);
    const prof = [[3.0, 0], [5.4, 0], [5.4, 1.1], [4.9, 1.6], [3.4, 1.6], [3.0, 1.2], [3.0, 0]].map(([r, h]) => new THREE.Vector2(r, h));
    jackRing = new THREE.LatheGeometry(prof, 6);              // hex nut
    jackRing.translate(J.x, top - depth, -J.y);
    jackRing.computeVertexNormals();
    jackHole = new THREE.CylinderGeometry(5.4, 5.4, 0.2, 28);
    jackHole.translate(J.x, top - depth - 0.6, -J.y);
  }
  return {
    shell: geometry(shell), wood: geometry(wood), inlay: inlay ? geometry(inlayB) : null,
    jackRing, jackHole, outline: P, plan,
    features: { slots: slots.length, inlay: !!inlay, jack: !!jack },
  };
}

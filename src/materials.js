// materials.js — procedural textures and PBR materials for the 3D preview.
// Everything is generated on a canvas at runtime: no image downloads.
// All texture scales are in real millimetres (the scene is in mm), so wood
// grain, pores and powder-coat texture read at the right size in macro shots.
import * as THREE from 'three';

// ---------------------------------------------------------------- noise ----
// Periodic (tileable) value noise on an integer lattice.
function hash(x, y, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = t => t * t * (3 - 2 * t);
function vnoise(x, y, px, py, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = fade(x - ix), fy = fade(y - iy);
  const x0 = ((ix % px) + px) % px, x1 = (x0 + 1) % px, y0 = ((iy % py) + py) % py, y1 = (y0 + 1) % py;
  const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
// fbm over u,v in [0,1) with base periods (px,py); tileable.
function fbm(u, v, px, py, oct, s) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(u * px, v * py, px, py, s + o * 17);
    norm += amp; amp *= 0.5; px *= 2; py *= 2;
  }
  return sum / norm;
}
function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5 >>> 0) / 4294967296); }
// Low-resolution tileable field, bilinearly sampled: cheap large-scale variation.
function field(gw, gh, fn) {
  const a = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) a[y * gw + x] = fn(x / gw, y / gh);
  return (u, v) => {
    const fx = u * gw, fy = v * gh, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const x0 = ((ix % gw) + gw) % gw, x1 = (x0 + 1) % gw, y0 = ((iy % gh) + gh) % gh, y1 = (y0 + 1) % gh;
    const p = a[y0 * gw + x0], q = a[y0 * gw + x1], r = a[y1 * gw + x0], s = a[y1 * gw + x1];
    return p + (q - p) * tx + (r - p) * ty + (p - q - r + s) * tx * ty;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
function heightToNormal(H, w, h, sx, sy = sx) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = H[y * w + (x - 1 + w) % w], r = H[y * w + (x + 1) % w];
    const u = H[((y - 1 + h) % h) * w + x], d = H[((y + 1) % h) * w + x];
    let nx = (l - r) * sx, ny = (u - d) * sy, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * w + x) * 4;
    out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return out;
}

// Anisotropic filtering: set from renderer.capabilities.getMaxAnisotropy().
let maxAniso = 8;
const liveTextures = new Set();
export function setMaxAnisotropy(n) {
  maxAniso = Math.max(1, n | 0);
  for (const t of liveTextures) { t.anisotropy = maxAniso; t.needsUpdate = true; }
}
function toTexture(c, srgb, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  liveTextures.add(t);
  return t;
}
function put(c, data) { const ctx = c.getContext('2d'); const img = ctx.createImageData(c.width, c.height); img.data.set(data); ctx.putImageData(img, 0, 0); }
const small = () => typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 700;

// ---------------------------------------------------------------- woods ----
// One tile covers WOOD_TILE_MM of board (u across the board, v along the grain).
// At 1024 x 2048 that is 0.08 mm per texel across and 0.23 mm along, so the
// 0.4-2 mm growth bands and the open pores are resolved at macro distance.
export const WOOD_TILE_MM = [82, 470];
// Colours are sRGB albedo. band: [min, max] growth-band width in mm.
export const WOODS = {
  ebony: { label: 'Ebony', dark: [11, 10, 10], mid: [24, 21, 20], light: [52, 44, 38], band: [0.5, 2.6], contrast: 0.42, streak: 0.55,
    pore: 0.35, poreLen: [0.8, 3], poreW: [0.08, 0.16], fibre: 0.16, warp: 0.6, rough: 0.42, sheen: 0.55 },
  wenge: { label: 'Wenge', dark: [26, 20, 17], mid: [74, 61, 52], light: [132, 112, 94], band: [0.35, 1.9], contrast: 1.0, streak: 0.3,
    pore: 1.0, poreLen: [1.6, 9], poreW: [0.14, 0.34], fibre: 0.26, warp: 0.8, rough: 0.6, sheen: 0.35 },
  roasted: { label: 'Roasted maple', dark: [54, 34, 21], mid: [98, 64, 40], light: [142, 99, 66], band: [0.7, 3.2], contrast: 0.42, streak: 0.35,
    pore: 0.12, poreLen: [0.5, 1.5], poreW: [0.05, 0.1], fibre: 0.14, warp: 0.5, rough: 0.5, sheen: 0.45, flame: 0.35 },
  // Figured body accent (not offered as a fretboard).
  accent: { label: 'Ziricote', dark: [20, 14, 11], mid: [64, 45, 34], light: [130, 96, 70], band: [0.6, 4.5], contrast: 0.95, streak: 0.5,
    pore: 0.5, poreLen: [1, 5], poreW: [0.1, 0.24], fibre: 0.2, warp: 5.5, rough: 0.4, sheen: 0.6 },
};
const woodCache = new Map();

export function woodTextures(kind = 'wenge') {
  if (woodCache.has(kind)) return woodCache.get(kind);
  const P = WOODS[kind] || WOODS.wenge;
  const lo = small();
  const W = lo ? 512 : 1024, H = lo ? 1024 : 2048, N = W * H;
  const mmU = WOOD_TILE_MM[0] / W, mmV = WOOD_TILE_MM[1] / H;
  const seed = [...kind].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) & 0xffff;
  const r = rng(seed * 977 + 1);

  // 1-D growth-band profile across the tile (tileable): bands of random width
  // and tone, eased together, so lines are straight and parallel like
  // quarter-sawn stock rather than smeared noise.
  const PR = 8192, prof = new Float32Array(PR);
  {
    let pos = 0; const bands = [];
    while (pos < WOOD_TILE_MM[0]) {
      const w = P.band[0] + Math.pow(r(), 1.6) * (P.band[1] - P.band[0]);
      bands.push({ a: pos, w, t: r() }); pos += w;
    }
    const scale = WOOD_TILE_MM[0] / pos;
    for (const b of bands) { b.a *= scale; b.w *= scale; }
    let k = 0;
    for (let i = 0; i < PR; i++) {
      const x = (i / PR) * WOOD_TILE_MM[0];
      while (k < bands.length - 1 && bands[k].a + bands[k].w < x) k++;
      const b = bands[k], f = (x - b.a) / b.w;            // 0..1 inside the band
      // Each band: a darker latewood line at its end, earlywood body.
      const late = Math.pow(Math.max(0, (f - 0.62) / 0.38), 1.4);
      prof[i] = 0.35 + b.t * 0.45 - late * 0.55;
    }
  }
  const profAt = u => { const f = (((u % 1) + 1) % 1) * PR, i = Math.floor(f), t = f - i; return prof[i] + (prof[(i + 1) % PR] - prof[i]) * t; };
  const warpF = field(32, 64, (u, v) => (fbm(u, v, 2, 3, 3, seed + 3) - 0.5));
  const wigF = field(64, 256, (u, v) => (fbm(u, v, 8, 40, 2, seed + 5) - 0.5));
  const toneF = field(48, 96, (u, v) => fbm(u, v, 3, 2, 4, seed + 11));
  const streakF = field(256, 32, (u, v) => fbm(u, v, 40, 3, 3, seed + 13));
  const warpAmp = P.warp / WOOD_TILE_MM[0];                 // mm of meander, as u

  const tone = new Float32Array(N), height = new Float32Array(N), rough = new Float32Array(N);
  const fu = Math.round(WOOD_TILE_MM[0] / 0.12), fv = Math.round(WOOD_TILE_MM[1] / 9);  // fibre cells: 0.12 mm x 9 mm
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const uw = u + warpF(u, v) * warpAmp * 2 + wigF(u, v) * warpAmp * 0.35 + (P.flame ? Math.sin(v * 140 + u * 9) * 0.0008 * P.flame : 0);
      const band = profAt(uw);
      const fib = vnoise(uw * fu, v * fv, fu, fv, seed + 29);
      const st = streakF(uw, v);
      let t = 0.5 + (band - 0.5) * P.contrast + (st - 0.5) * P.streak + (fib - 0.5) * P.fibre + (toneF(u, v) - 0.5) * 0.35;
      if (P.flame) t += Math.sin(v * 900 + Math.sin(u * 40) * 3) * 0.04 * P.flame;
      const i = y * W + x;
      tone[i] = t;
      height[i] = band * 0.4 + fib * 0.6;
      rough[i] = P.rough + (fib - 0.5) * 0.12 - (band - 0.5) * 0.08;
    }
  }
  // Open pores: thin dark grooves running with the grain.
  const pores = Math.round(WOOD_TILE_MM[0] * WOOD_TILE_MM[1] * 0.11 * P.pore);
  for (let k = 0; k < pores; k++) {
    const cx = r() * W, cy = r() * H;
    const lenPx = (P.poreLen[0] + r() * (P.poreLen[1] - P.poreLen[0])) / mmV / 2;
    const wid = (P.poreW[0] + r() * (P.poreW[1] - P.poreW[0])) / mmU / 2;
    const depth = 0.45 + r() * 0.55, ext = Math.ceil(wid) + 1;
    for (let dy = -Math.ceil(lenPx); dy <= lenPx; dy++) {
      const fy = 1 - (dy / lenPx) ** 2; if (fy <= 0) continue;
      const py = ((Math.round(cy + dy) % H) + H) % H;
      for (let dx = -ext; dx <= ext; dx++) {
        const fx = 1 - (dx / (wid + 0.35)) ** 2; if (fx <= 0) continue;
        const px = ((Math.round(cx + dx) % W) + W) % W;
        const i = py * W + px, a = fx * Math.sqrt(fy) * depth;
        tone[i] -= 0.55 * a; height[i] -= 1.1 * a; rough[i] += 0.3 * a;
      }
    }
  }
  const alb = new Uint8ClampedArray(N * 4), rgh = new Uint8ClampedArray(N * 4);
  const lerp3 = (a, b, f, o, i) => { o[i] = a[0] + (b[0] - a[0]) * f; o[i + 1] = a[1] + (b[1] - a[1]) * f; o[i + 2] = a[2] + (b[2] - a[2]) * f; };
  for (let i = 0; i < N; i++) {
    const t = Math.min(1, Math.max(0, tone[i]));
    if (t < 0.5) lerp3(P.dark, P.mid, t * 2, alb, i * 4); else lerp3(P.mid, P.light, (t - 0.5) * 2, alb, i * 4);
    alb[i * 4 + 3] = 255;
    const g = Math.min(1, Math.max(0.05, rough[i])) * 255;
    rgh[i * 4] = g; rgh[i * 4 + 1] = g; rgh[i * 4 + 2] = g; rgh[i * 4 + 3] = 255;
  }
  const rep = [1 / WOOD_TILE_MM[0], 1 / WOOD_TILE_MM[1]];
  const cA = canvas(W, H), cR = canvas(W, H), cN = canvas(W, H);
  put(cA, alb); put(cR, rgh); put(cN, heightToNormal(height, W, H, 2.2, 0.8));
  const out = { map: toTexture(cA, true, rep), roughnessMap: toTexture(cR, false, rep), normalMap: toTexture(cN, false, rep) };
  woodCache.set(kind, out);
  return out;
}

// Oiled board: open-pore, low satin sheen. The sheen comes from a faint
// clearcoat (oil film) whose roughness hides tiling.
export function makeWoodMaterial(kind) {
  const P = WOODS[kind] || WOODS.wenge, t = woodTextures(kind);
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7), roughness: 1.0, metalness: 0,
    clearcoat: 0.22 * P.sheen, clearcoatRoughness: 0.42, envMapIntensity: 1.0, specularIntensity: 0.5,
  });
}
export function makeAccentWoodMaterial() {
  const t = woodTextures('accent');
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35), roughness: 1.0, metalness: 0,
    clearcoat: 0.55, clearcoatRoughness: 0.18, envMapIntensity: 1.0, specularIntensity: 0.5,
  });
}

// --------------------------------------------------------------- finishes --
// Polished fret wire: a dark mirror of the studio with a narrow crown streak.
// Anisotropy stretches highlights along the wire (u of the swept geometry).
export const FRET_FINISHES = {
  nickel: { label: 'Nickel silver', color: 0xc9c4b8, roughness: 0.12, aniso: 0.3 },
  stainless: { label: 'Stainless', color: 0xc8cdd3, roughness: 0.09, aniso: 0.25 },
  gold: { label: 'EVO gold', color: 0xd2ae6e, roughness: 0.14, aniso: 0.3 },
};
export function makeFretMaterial(kind = 'nickel') {
  const f = FRET_FINISHES[kind] || FRET_FINISHES.nickel;
  return new THREE.MeshPhysicalMaterial({
    color: f.color, metalness: 1, roughness: f.roughness, envMapIntensity: 1.0,
    anisotropy: f.aniso, anisotropyRotation: 0,
  });
}

// Black textured powder coat for the body, neck and headpiece: a fine
// "stone" mottle like the reference finish, satin sheen.
let satinCache = null;
function satinTextures() {
  if (satinCache) return satinCache;
  const W = small() ? 256 : 512, H = W, N = W * H, TILE = 120;   // 120 mm tile
  const hgt = new Float32Array(N), rgh = new Uint8ClampedArray(N * 4), alb = new Uint8ClampedArray(N * 4);
  const big = field(32, 32, (u, v) => fbm(u, v, 3, 3, 4, 91));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H, i = y * W + x;
    const m = big(u, v), s = fbm(u, v, 24, 24, 3, 7), f = vnoise(u * W / 2, v * H / 2, W / 2, H / 2, 5);
    const speck = Math.pow(Math.max(0, s - 0.45) / 0.55, 2.2);
    hgt[i] = f * 0.55 + s * 0.45;
    const g = (0.6 + (m - 0.5) * 0.18 - speck * 0.12 + (f - 0.5) * 0.08) * 255;
    rgh[i * 4] = rgh[i * 4 + 1] = rgh[i * 4 + 2] = g; rgh[i * 4 + 3] = 255;
    const a = 27 + (m - 0.5) * 12 + speck * 22 + (f - 0.5) * 4;
    alb[i * 4] = a; alb[i * 4 + 1] = a + 0.6; alb[i * 4 + 2] = a + 1.8; alb[i * 4 + 3] = 255;
  }
  const cA = canvas(W, H), cR = canvas(W, H), cN = canvas(W, H);
  put(cA, alb); put(cR, rgh); put(cN, heightToNormal(hgt, W, H, 0.9));
  const rep = [1 / TILE, 1 / TILE];
  satinCache = { map: toTexture(cA, true, rep), roughnessMap: toTexture(cR, false, rep), normalMap: toTexture(cN, false, rep) };
  return satinCache;
}
export function makeSatinMaterial(tint = 0xffffff) {
  const t = satinTextures();
  return new THREE.MeshPhysicalMaterial({
    color: tint, map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.22, 0.22),
    roughness: 1, metalness: 0.0, envMapIntensity: 1.0, clearcoat: 0.08, clearcoatRoughness: 0.55, specularIntensity: 0.7,
  });
}

// ---------------------------------------------------------------- strings --
// Helical winding normal map: one tile = one wrap pitch along v, full turn along u.
let woundCache = null;
export function woundNormalMap() {
  if (woundCache) return woundCache;
  const W = 64, H = 32, N = W * H, hgt = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const f = ((y / H + x / W) % 1 + 1) % 1;               // helix: shifts one pitch per turn
    const c = f * 2 - 1;
    hgt[y * W + x] = Math.pow(Math.max(0, 1 - c * c), 0.7);  // round wrap wire, tight groove
  }
  const c = canvas(W, H); put(c, heightToNormal(hgt, W, H, 5));
  const t = toTexture(c, false);
  woundCache = t;
  return t;
}
export function makeStringMaterials() {
  const plain = new THREE.MeshPhysicalMaterial({ color: 0xd8dbdf, metalness: 1, roughness: 0.16, envMapIntensity: 1.0 });
  const wound = new THREE.MeshPhysicalMaterial({
    color: 0xc2baab, metalness: 1, roughness: 0.27, envMapIntensity: 1.0,
    normalMap: woundNormalMap(), normalScale: new THREE.Vector2(1.0, 1.0),
  });
  return { plain, wound };
}

// ------------------------------------------------------------- hardware ----
export function makeHardwareMaterials() {
  return {
    // Hard-anodised black: nut clamp, saddle housings.
    anodized: new THREE.MeshPhysicalMaterial({ color: 0x111215, metalness: 0.6, roughness: 0.38, envMapIntensity: 1.0, clearcoat: 0.25, clearcoatRoughness: 0.35 }),
    // Gloss black tuner barrels.
    gloss: new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, metalness: 0.0, roughness: 0.32, envMapIntensity: 1.0, clearcoat: 1.0, clearcoatRoughness: 0.08 }),
    brass: new THREE.MeshPhysicalMaterial({ color: 0xd4ad62, metalness: 1, roughness: 0.24, envMapIntensity: 1.0, anisotropy: 0.3 }),
    steel: new THREE.MeshPhysicalMaterial({ color: 0xc4c8cd, metalness: 1, roughness: 0.2, envMapIntensity: 1.0 }),
    dot: new THREE.MeshStandardMaterial({ color: 0xbfe9ff, emissive: 0x9fdcff, emissiveIntensity: 0.9, roughness: 0.3 }),
    inlay: new THREE.MeshPhysicalMaterial({ color: 0xc9d3d8, metalness: 0.1, roughness: 0.2, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 520], clearcoat: 1, envMapIntensity: 1.0 }),
    // Ivory pickup covers (matte with a soft sheen), like the reference.
    pickup: new THREE.MeshPhysicalMaterial({ color: 0xc9c5bd, metalness: 0, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 1.0 }),
    socket: new THREE.MeshStandardMaterial({ color: 0x040405, roughness: 0.7, metalness: 0 }),
  };
}

// -------------------------------------------------------------- backdrop ---
// Hand-painted, mottled grey studio canvas with a soft pool of light behind
// the subject, cool graphite like the reference photograph.
export function makeBackdropTexture(w = 1600, h = 1000) {
  if (small()) { w = 900; h = 900; }
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
  const r = rng(1234);
  const a = field(48, 32, (u, v) => fbm(u, v, 3, 2, 5, 77));
  const b = field(160, 100, (u, v) => fbm(u, v, 10, 6, 4, 133));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    const m = a(u, v), m2 = b(u, v);
    const dx = (u - 0.6) * 1.15, dy = (v - 0.4) * 1.0;
    const vig = Math.max(0, 1 - (dx * dx + dy * dy) * 1.45);
    // Mottle: soft clouds plus a sharper "sponge" layer, mostly in the light.
    const sponge = Math.max(0, m2 - 0.48) * 2.2;
    let t = 0.055 + vig * vig * (0.14 + Math.pow(m, 1.5) * 0.42 + sponge * 0.12);
    t += (r() - 0.5) * 0.008;                              // dither against banding
    const i = (y * w + x) * 4;
    img.data[i] = 255 * t * 0.985; img.data[i + 1] = 255 * t * 0.995; img.data[i + 2] = 255 * t * 1.03; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Soft elliptical ground shadow (alpha map).
export function makeShadowBlobTexture() {
  const c = canvas(256, 256), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.45, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  return t;
}

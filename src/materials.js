// materials.js — procedural textures and PBR materials for the 3D preview.
// Everything is generated on a canvas at runtime: no image downloads.
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

function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
function heightToNormal(H, w, h, strength) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = H[y * w + (x - 1 + w) % w], r = H[y * w + (x + 1) % w];
    const u = H[((y - 1 + h) % h) * w + x], d = H[((y + 1) % h) * w + x];
    let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * w + x) * 4;
    out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return out;
}
function toTexture(c, srgb, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
function put(c, data) { const ctx = c.getContext('2d'); const img = ctx.createImageData(c.width, c.height); img.data.set(data); ctx.putImageData(img, 0, 0); }

// ---------------------------------------------------------------- woods ----
// Each tile covers TILE_MM in board millimetres (grain runs along v = board length).
export const WOOD_TILE_MM = [70, 300];
export const WOODS = {
  ebony: { label: 'Ebony', dark: [7, 6, 6], mid: [17, 14, 13], light: [38, 31, 27], streak: 0.5, pore: 0.5, contrast: 0.75 },
  wenge: { label: 'Wenge', dark: [13, 10, 9], mid: [40, 32, 27], light: [88, 72, 58], streak: 0.85, pore: 1.0, contrast: 0.95 },
  roasted: { label: 'Roasted maple', dark: [40, 22, 12], mid: [82, 48, 26], light: [124, 80, 44], streak: 0.35, pore: 0.25, contrast: 0.7 },
};
const woodCache = new Map();

export function woodTextures(kind = 'wenge') {
  if (woodCache.has(kind)) return woodCache.get(kind);
  const P = WOODS[kind] || WOODS.wenge;
  const W = 512, H = 1024, N = W * H;
  const tone = new Float32Array(N), height = new Float32Array(N), rough = new Float32Array(N);
  const seed = kind.length * 31 + 7;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const warp = fbm(u, v, 2, 3, 3, seed) - 0.5;
      const uw = u + warp * 0.07 + (fbm(u, v, 6, 10, 2, seed + 3) - 0.5) * 0.015;
      const streak = fbm(uw, v * 0.5 + 0.13, 36, 2, 4, seed + 11);           // long figure along the grain
      const band = 0.5 + 0.5 * Math.sin((uw * 26 + streak * 2.2) * Math.PI * 2);
      const fiber = vnoise(uw * 300, v * 6, 300, 6, seed + 29);              // fine fibres
      const fleck = vnoise(uw * 90, v * 22, 90, 22, seed + 41);
      let t = 0.5 + (streak - 0.5) * 1.6 * P.streak + (Math.pow(band, 3) - 0.18) * 0.35 * P.streak
        + (fiber - 0.5) * 0.28 + (fleck - 0.5) * 0.12;
      t = 0.5 + (t - 0.5) * P.contrast;
      const i = y * W + x;
      tone[i] = Math.min(1, Math.max(0, t));
      height[i] = fiber * 0.5 + streak * 0.3 + band * 0.15;
      rough[i] = 0.5 + (fiber - 0.5) * 0.22;
    }
  }
  // Open pores: short dark dashes running with the grain (wenge has big ones).
  const r = rng(seed * 977);
  const pores = Math.round(N / 210 * P.pore);
  for (let k = 0; k < pores; k++) {
    const cx = r() * W, cy = r() * H, len = 4 + r() * 18 * P.pore, wid = 0.6 + r() * 1.1, depth = 0.35 + r() * 0.65;
    for (let dy = -len; dy <= len; dy++) {
      const fy = 1 - (dy / len) ** 2; if (fy <= 0) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const fx = 1 - (dx / (wid + 0.001)) ** 2; if (fx <= 0) continue;
        const px = ((Math.round(cx + dx) % W) + W) % W, py = ((Math.round(cy + dy) % H) + H) % H;
        const i = py * W + px, a = fx * Math.sqrt(fy) * depth;
        tone[i] *= 1 - 0.75 * a; height[i] -= 0.9 * a; rough[i] += 0.35 * a;
      }
    }
  }
  const alb = new Uint8ClampedArray(N * 4), rgh = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const t = tone[i];
    const a = t < 0.5 ? P.dark : P.mid, b = t < 0.5 ? P.mid : P.light, f = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    alb[i * 4] = a[0] + (b[0] - a[0]) * f; alb[i * 4 + 1] = a[1] + (b[1] - a[1]) * f; alb[i * 4 + 2] = a[2] + (b[2] - a[2]) * f; alb[i * 4 + 3] = 255;
    const g = Math.min(1, Math.max(0, rough[i])) * 255;
    rgh[i * 4] = g; rgh[i * 4 + 1] = g; rgh[i * 4 + 2] = g; rgh[i * 4 + 3] = 255;
  }
  const rep = [1 / WOOD_TILE_MM[0], 1 / WOOD_TILE_MM[1]];
  const cA = canvas(W, H), cR = canvas(W, H), cN = canvas(W, H);
  put(cA, alb); put(cR, rgh); put(cN, heightToNormal(height, W, H, 3.2));
  const out = { map: toTexture(cA, true, rep), roughnessMap: toTexture(cR, false, rep), normalMap: toTexture(cN, false, rep) };
  woodCache.set(kind, out);
  return out;
}

export function makeWoodMaterial(kind) {
  const t = woodTextures(kind);
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55), roughness: 1.0, metalness: 0,
    clearcoat: 0.07, clearcoatRoughness: 0.5, envMapIntensity: 0.38, specularIntensity: 0.55,
  });
}

// --------------------------------------------------------------- finishes --
export const FRET_FINISHES = {
  nickel: { label: 'Nickel silver', color: 0xe6e1d7, roughness: 0.15 },
  stainless: { label: 'Stainless', color: 0xdfe5ec, roughness: 0.11 },
  gold: { label: 'EVO gold', color: 0xe2bd78, roughness: 0.17 },
};
export function makeFretMaterial(kind = 'nickel') {
  const f = FRET_FINISHES[kind] || FRET_FINISHES.nickel;
  return new THREE.MeshPhysicalMaterial({
    color: f.color, metalness: 1, roughness: f.roughness, envMapIntensity: 1.25,
    clearcoat: 0.0, specularIntensity: 1,
  });
}

// Black satin powder-coat for the body, neck and headpiece.
let satinCache = null;
function satinTextures() {
  if (satinCache) return satinCache;
  const W = 256, H = 256, N = W * H;
  const hgt = new Float32Array(N), rgh = new Uint8ClampedArray(N * 4), alb = new Uint8ClampedArray(N * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H, i = y * W + x;
    const m = fbm(u, v, 4, 4, 4, 91), f = vnoise(u * 256, v * 256, 256, 256, 5);
    hgt[i] = f * 0.6 + m * 0.4;
    const g = (0.52 + (m - 0.5) * 0.3 + (f - 0.5) * 0.12) * 255;
    rgh[i * 4] = rgh[i * 4 + 1] = rgh[i * 4 + 2] = g; rgh[i * 4 + 3] = 255;
    const a = 15 + (m - 0.5) * 8;
    alb[i * 4] = a; alb[i * 4 + 1] = a + 0.5; alb[i * 4 + 2] = a + 1.5; alb[i * 4 + 3] = 255;
  }
  const cA = canvas(W, H), cR = canvas(W, H), cN = canvas(W, H);
  put(cA, alb); put(cR, rgh); put(cN, heightToNormal(hgt, W, H, 0.5));
  const rep = [1 / 90, 1 / 90];
  satinCache = { map: toTexture(cA, true, rep), roughnessMap: toTexture(cR, false, rep), normalMap: toTexture(cN, false, rep) };
  return satinCache;
}
export function makeSatinMaterial(tint = 0xffffff) {
  const t = satinTextures();
  return new THREE.MeshPhysicalMaterial({
    color: tint, map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.12, 0.12),
    roughness: 1, metalness: 0.0, envMapIntensity: 0.32, clearcoat: 0.12, clearcoatRoughness: 0.5,
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
    hgt[y * W + x] = Math.sqrt(Math.max(0, 1 - c * c));    // round wrap wire
  }
  const c = canvas(W, H); put(c, heightToNormal(hgt, W, H, 6));
  const t = toTexture(c, false);
  t.anisotropy = 16;
  woundCache = t;
  return t;
}
export function makeStringMaterials() {
  const plain = new THREE.MeshPhysicalMaterial({ color: 0xe8ebee, metalness: 1, roughness: 0.2, envMapIntensity: 1.35 });
  const wound = new THREE.MeshPhysicalMaterial({
    color: 0xd9ccb4, metalness: 1, roughness: 0.3, envMapIntensity: 1.25,
    normalMap: woundNormalMap(), normalScale: new THREE.Vector2(1.1, 1.1),
  });
  return { plain, wound };
}

// ------------------------------------------------------------- hardware ----
export function makeHardwareMaterials() {
  return {
    anodized: new THREE.MeshPhysicalMaterial({ color: 0x141518, metalness: 0.75, roughness: 0.34, envMapIntensity: 0.9, clearcoat: 0.3, clearcoatRoughness: 0.3 }),
    brass: new THREE.MeshPhysicalMaterial({ color: 0xd8b067, metalness: 1, roughness: 0.22, envMapIntensity: 1.2 }),
    steel: new THREE.MeshPhysicalMaterial({ color: 0xc9ced4, metalness: 1, roughness: 0.25, envMapIntensity: 1.1 }),
    dot: new THREE.MeshStandardMaterial({ color: 0xbfe9ff, emissive: 0x9fdcff, emissiveIntensity: 2.2, roughness: 0.3 }),
    inlay: new THREE.MeshPhysicalMaterial({ color: 0xd9e4ea, metalness: 0.1, roughness: 0.18, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 520], clearcoat: 1, envMapIntensity: 1.3 }),
    pickup: new THREE.MeshPhysicalMaterial({ color: 0x0d0e10, metalness: 0.1, roughness: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.7 }),
  };
}

// -------------------------------------------------------------- backdrop ---
// Mottled studio backdrop with a vignette, like a hand-painted photo canvas.
export function makeBackdropTexture(w = 1280, h = 800) {
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
  const r = rng(1234);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    const m = fbm(u, v, 3, 2, 6, 77);
    const m2 = fbm(u + 0.31, v + 0.17, 7, 5, 4, 133);
    const dx = (u - 0.58) * 1.25, dy = (v - 0.42) * 1.05;
    const vig = Math.max(0, 1 - (dx * dx + dy * dy) * 1.55);
    let t = 0.05 + vig * (0.1 + Math.pow(m, 1.6) * 0.32 + (m2 - 0.5) * 0.08);
    t += (r() - 0.5) * 0.006;                              // dither against banding
    const i = (y * w + x) * 4;
    img.data[i] = 255 * t * 0.96; img.data[i + 1] = 255 * t * 0.99; img.data[i + 2] = 255 * t * 1.08; img.data[i + 3] = 255;
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

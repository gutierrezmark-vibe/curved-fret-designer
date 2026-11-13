// glyphs.js — tiny fret-shape glyphs for the mode chips.
const W = 40, H = 26;
const FRETS = [6, 14, 21, 27, 32];
const shapes = {
  single: (c) => () => 0,
  fan: (c) => t => (t - 0.5) * (c - 17) * 0.42,
  exponential: (c) => t => Math.pow(t, 2.4) * (c - 4) * 0.34 - (c - 4) * 0.06,
  divergent: (c) => t => -(1 - (2 * t - 1) ** 2) * (c - 3) * 0.2,
  convergent: (c) => t => (1 - (2 * t - 1) ** 2) * (c - 3) * 0.2,
  's-curve': (c) => t => Math.sin((t - 0.5) * Math.PI * 2) * (c - 3) * 0.13 + (t - 0.5) * (c - 17) * 0.14,
  custom: (c) => t => [0, 0.6, -0.4, 0.8, 0.2][Math.round(t * 4)] * (c - 2) * 0.12,
};
export function glyphSVG(mode) {
  const f = shapes[mode] || shapes.single;
  const strings = [4, 9.5, 15, 20.5].map(y => `<line x1="2" x2="${W - 2}" y1="${y + 1}" y2="${y + 1}" class="g-str"/>`).join('');
  const frets = FRETS.map((c, k) => {
    const fn = f(c);
    const pts = [];
    const steps = mode === 'custom' ? 4 : 16;
    for (let i = 0; i <= steps; i++) { const t = i / steps; pts.push([c + fn(t) + 2, 2 + t * (H - 4)]); }
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('');
    const nodes = mode === 'custom' ? pts.map(p => `<circle cx="${p[0].toFixed(2)}" cy="${p[1].toFixed(2)}" r="0.9" class="g-node"/>`).join('') : '';
    return `<path d="${d}" class="g-fret" style="--i:${k}" pathLength="1"/>${nodes}`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="glyph" aria-hidden="true">${strings}${frets}</svg>`;
}
export const MODES = [
  { id: 'single', label: 'Single', hint: 'One scale length, straight parallel frets' },
  { id: 'fan', label: 'Fan', hint: 'Linear multiscale: straight fanned frets' },
  { id: 'exponential', label: 'Exponential', hint: 'L[n] = L[n−1] ± scalar · growth^(n−1)' },
  { id: 'divergent', label: 'Divergent', hint: 'D-scale: frets bow toward the nut' },
  { id: 'convergent', label: 'Convergent', hint: 'C-scale: frets bow toward the bridge' },
  { id: 's-curve', label: 'S-curve', hint: 'Divergent and convergent halves meet at the pivot' },
  { id: 'custom', label: 'Custom', hint: 'Type each string’s scale length' },
];

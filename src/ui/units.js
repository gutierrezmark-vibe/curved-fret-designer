// units.js — display formatting. Geometry is always millimetres.
export const IN = 25.4;
export const toDisp = (mm, u) => u === 'in' ? mm / IN : mm;
export const fromDisp = (v, u) => u === 'in' ? v * IN : v;
export const unitLabel = u => u === 'in' ? 'in' : 'mm';
export const lenDp = u => u === 'in' ? 3 : 2;

export function fmtLen(mm, u, { dp, suffix = true } = {}) {
  if (mm == null || Number.isNaN(mm)) return '—';
  if (!Number.isFinite(mm)) return '∞';
  const v = toDisp(mm, u), d = dp ?? lenDp(u);
  return v.toFixed(d) + (suffix ? (u === 'in' ? '″' : ' mm') : '');
}
// Radii are big: show metres / feet-ish when large.
export function fmtRadius(mm, u) {
  if (mm == null || Number.isNaN(mm)) return '—';
  if (!Number.isFinite(mm) || mm > 1e6) return 'straight';
  if (u === 'in') return (mm / IN).toFixed(mm / IN > 100 ? 0 : 1) + '″';
  return mm > 1000 ? (mm / 1000).toFixed(2) + ' m' : mm.toFixed(0) + ' mm';
}
export const fmtGauge = g => g == null ? '—' : '.' + Math.round(g * 1000).toString().padStart(3, '0');

// Parse "25.5", "25.5in", '25.5"', "648mm", "64.8cm" into mm given the current unit.
export function parseLen(text, u) {
  const s = String(text).trim().toLowerCase().replace(/,/g, '.');
  const m = s.match(/^(-?[\d.]+(?:e-?\d+)?)\s*(mm|cm|in|"|″|inch|inches)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]); if (!Number.isFinite(v)) return null;
  const unit = m[2];
  if (unit === 'mm') return v;
  if (unit === 'cm') return v * 10;
  if (unit) return v * IN;
  return fromDisp(v, u);
}
export const perpFret = r => r <= 0 ? 0 : r >= 1 ? Infinity : -12 * Math.log2(1 - r);

// presets.js — the top-bar Presets menu: "My presets" saved in this browser,
// preset files (export / import), and the built-in PRESETS.
//
// Storage: localStorage[KEY] = [{ name, params, savedAt }]. `params` is the
// full, resolved param set (the shape computeDesign accepts). Everything read
// back, from storage or from a file, is checked field by field, because a
// file may come from anyone and storage may hold an older or edited copy.
// If storage is blocked (private window, sandbox), presets live in memory for
// this tab and the menu says saving is unavailable.

export const STORAGE_KEY = 'cfd.myPresets.v1';
const FILE_APP = 'curved-fret-designer';
const FILE_KIND = 'presets';
const FILE_VERSION = 1;
const MAX_FILE_BYTES = 2_000_000;
const MAX_PRESETS = 500;
const MAX_NAME = 60;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const cleanName = n => String(n ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const numIn = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;
const NOTE_RE = /^[A-Ga-g][#b♯♭]?-?\d{1,2}$/;

/**
 * Keep only known params with sane types and ranges, then resolve over the
 * engine defaults. Returns null when nothing usable is there.
 */
export function sanitizeParams(raw, G) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  const MODES = Array.isArray(G.MODES) ? G.MODES : ['single', 'fan', 'exponential', 'divergent', 'convergent', 's-curve', 'custom'];
  if (raw.units === 'in' || raw.units === 'mm') out.units = raw.units;
  if (numIn(raw.numStrings, 1, 200)) out.numStrings = Math.round(raw.numStrings);
  if (numIn(raw.numFrets, 0, 60)) out.numFrets = Math.round(raw.numFrets);
  if (MODES.includes(raw.mode)) out.mode = raw.mode;
  for (const k of ['trebleScale', 'bassScale']) if (numIn(raw[k], 50, 5000)) out[k] = raw[k];
  if (numIn(raw.scalar, -1000, 1000)) out.scalar = raw.scalar;
  if (numIn(raw.growth, 0.01, 10)) out.growth = raw.growth;
  if (raw.direction === 'toBass' || raw.direction === 'toTreble') out.direction = raw.direction;
  if (typeof raw.fitToEnds === 'boolean') out.fitToEnds = raw.fitToEnds;
  if (numIn(raw.pivot, 0, 200)) out.pivot = raw.pivot;
  for (const k of ['trebleHalf', 'bassHalf']) {
    const h = raw[k];
    if (h && typeof h === 'object' && numIn(h.scalar, -1000, 1000) && numIn(h.growth, 0.01, 10)) out[k] = { scalar: h.scalar, growth: h.growth };
  }
  if (Array.isArray(raw.customScales) && raw.customScales.length >= 1 && raw.customScales.length <= 200 && raw.customScales.every(v => numIn(v, 50, 5000)))
    out.customScales = raw.customScales.slice();
  if (numIn(raw.perpRatio, 0, 1)) out.perpRatio = raw.perpRatio;
  for (const k of ['nutSpacing', 'bridgeSpacing']) if (numIn(raw[k], 0.5, 100)) out[k] = raw[k];
  if (numIn(raw.edgeMargin, 0, 100)) out.edgeMargin = raw.edgeMargin;
  if (numIn(raw.boardExtension, 0, 200)) out.boardExtension = raw.boardExtension;
  if (Array.isArray(raw.gauges) && raw.gauges.length >= 1 && raw.gauges.length <= 200 && raw.gauges.every(v => numIn(v, 0.001, 0.5)))
    out.gauges = raw.gauges.slice();
  if (Array.isArray(raw.tuning) && raw.tuning.length >= 1 && raw.tuning.length <= 200
    && raw.tuning.every(v => (typeof v === 'string' && NOTE_RE.test(v)) || (Number.isInteger(v) && v >= 0 && v <= 127)))
    out.tuning = raw.tuning.slice();
  if (!Object.keys(out).length) return null;
  try { return G.resolveParams ? G.resolveParams(out) : { ...G.DEFAULTS, ...out }; } catch { return null; }
}

/** One stored/imported entry -> { name, params, savedAt } or null. */
function cleanEntry(e, G) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const name = cleanName(e.name);
  const params = sanitizeParams(e.params, G);
  if (!name || !params) return null;
  const t = typeof e.savedAt === 'string' && !Number.isNaN(Date.parse(e.savedAt)) ? e.savedAt : new Date().toISOString();
  return { name, params, savedAt: t };
}

/** "Name" -> "Name (2)", "Name (3)"... until it is free. */
export function uniqueName(name, taken) {
  const has = n => taken.some(t => t.toLowerCase() === n.toLowerCase());
  if (!has(name)) return name;
  const base = name.replace(/\s\(\d+\)$/, '').slice(0, MAX_NAME - 5);
  let k = 2;
  while (has(`${base} (${k})`)) k++;
  return `${base} (${k})`;
}

/** Parse a preset file's text -> { entries, skipped } or throws with a reason. */
export function parsePresetFile(text, G) {
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  let list;
  if (Array.isArray(doc)) list = doc;
  else if (doc && typeof doc === 'object') {
    if (doc.app != null && doc.app !== FILE_APP) throw new Error('That file was made by a different app.');
    if (Array.isArray(doc.presets)) list = doc.presets;
    else if (doc.params) list = [doc];
  }
  if (!list) throw new Error('No presets were found in that file.');
  const entries = [];
  let skipped = 0;
  for (const e of list.slice(0, MAX_PRESETS)) { const c = cleanEntry(e, G); if (c) entries.push(c); else skipped++; }
  skipped += Math.max(0, list.length - MAX_PRESETS);
  return { entries, skipped };
}

// ------------------------------------------------------------------ store --
function createStore(G) {
  let available = false, memory = [];
  try { const k = '__cfd_probe__'; localStorage.setItem(k, '1'); localStorage.removeItem(k); available = true; } catch { available = false; }
  const read = () => {
    if (!available) return memory.slice();
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(raw) ? raw.map(e => cleanEntry(e, G)).filter(Boolean) : [];
    } catch { return []; }
  };
  const write = list => {
    if (!available) { memory = list.slice(); return true; }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); return true; } catch { return false; }
  };
  return { get available() { return available; }, read, write };
}

// ------------------------------------------------------------------ icons --
const I = {
  plus: '<svg viewBox="0 0 16 16"><path d="M8 3.2v9.6M3.2 8h9.6"/></svg>',
  down: '<svg viewBox="0 0 16 16"><path d="M8 2.5v8M4.6 7.3L8 10.7l3.4-3.4M3 13.5h10"/></svg>',
  up: '<svg viewBox="0 0 16 16"><path d="M8 11V3M4.6 6.2L8 2.8l3.4 3.4M3 13.5h10"/></svg>',
  pen: '<svg viewBox="0 0 16 16"><path d="M10.6 2.8l2.6 2.6-7.6 7.6-3.1.5.5-3.1z"/><path d="M9.2 4.2l2.6 2.6"/></svg>',
  save: '<svg viewBox="0 0 16 16"><path d="M3 2.8h8l2.2 2.2V13a.4.4 0 01-.4.4H3.2a.4.4 0 01-.4-.4V3.2c0-.2.1-.4.2-.4z"/><path d="M5.2 2.8v3.4h5V2.8M5 13.4V9.6h6v3.8"/></svg>',
  trash: '<svg viewBox="0 0 16 16"><path d="M3 4.4h10M6.4 4.4V3h3.2v1.4M4.4 4.4l.6 8.8h6l.6-8.8M6.8 6.8v4.4M9.2 6.8v4.4"/></svg>',
};

const MODE_WORD = { single: 'single scale', fan: 'fan', exponential: 'exponential', divergent: 'divergent', convergent: 'convergent', 's-curve': 'S-curve', custom: 'custom' };
const tagOf = p => `${String(p.numStrings ?? '?').padStart(2, '0')}·${String(p.mode || '').slice(0, 4).toUpperCase()}`;

/**
 * Take over the #presetMenu element.
 * opts: { menu, button, G, builtins, getParams(), getDesign(), load(params, msg), close(), toast(msg, level) }
 */
export function createPresetMenu(opts) {
  const { menu, button, G, builtins = {}, getParams, getDesign, load, close, toast } = opts;
  const store = createStore(G);
  let ui = null;            // null | {t:'save'} | {t:'rename'|'overwrite'|'delete', i}
  let fresh = new Set();    // names just imported (briefly highlighted)
  let draft = '';           // text in the open name field

  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = '.json,application/json'; fileInput.hidden = true;
  menu.parentElement.appendChild(fileInput);

  const encode = p => { try { return G.encodeParams(p); } catch { return JSON.stringify(p); } };
  const fmtRange = p => {
    const u = getParams().units === 'mm' ? 'mm' : 'in';
    let a = p.trebleScale, b = p.bassScale;
    if (p.mode === 'custom' && p.customScales?.length) { a = Math.min(...p.customScales); b = Math.max(...p.customScales); }
    if (p.mode === 'single') b = a;
    const f = v => u === 'in' ? (v / 25.4).toFixed(2) : v.toFixed(0);
    return Math.abs(b - a) < 0.05 ? `${f(a)}${u === 'in' ? '″' : ' mm'}` : `${f(a)}–${f(b)}${u === 'in' ? '″' : ' mm'}`;
  };
  const fmtDate = iso => { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); } catch { return ''; } };
  const suggestName = () => {
    const p = getParams(), d = getDesign?.();
    const sr = d?.metrics?.scaleRange;
    const r = sr ? (Math.abs(sr[1] - sr[0]) < 0.05 ? `${(sr[0] / 25.4).toFixed(2)}″` : `${(sr[0] / 25.4).toFixed(2)}–${(sr[1] / 25.4).toFixed(2)}″`) : '';
    return cleanName(`${p.numStrings}-string ${MODE_WORD[p.mode] || p.mode} ${r}`);
  };

  // ---------------------------------------------------------------- render --
  function render({ focus } = {}) {
    const list = store.read();
    const cur = encode(getParams());
    const nameTaken = n => list.findIndex(e => e.name.toLowerCase() === n.toLowerCase());
    let html = `<div class="pm-head"><div class="menu-title">My presets${list.length ? ` <span class="pm-count">${list.length}</span>` : ''}</div>
      <div class="pm-tools">
        <button class="pm-icon" type="button" data-act="import" title="Import a preset file (.json)" aria-label="Import a preset file">${I.up}</button>
        <button class="pm-icon" type="button" data-act="export" title="${list.length ? 'Export my presets to a .json file' : 'Nothing to export yet'}" aria-label="Export my presets" ${list.length ? '' : 'disabled'}>${I.down}</button>
      </div></div>`;

    // save
    if (ui?.t === 'save') {
      const at = nameTaken(cleanName(draft));
      html += `<form class="pm-form" data-form="save" autocomplete="off">
        <input class="pm-input" name="name" maxlength="${MAX_NAME}" value="${esc(draft)}" placeholder="Name this design" aria-label="Preset name" spellcheck="false">
        <div class="pm-form-row"><span class="pm-note${at >= 0 ? ' warn' : ''}" data-note>${at >= 0 ? 'Replaces your preset with this name.' : store.available ? 'Saved in this browser.' : 'Kept until this tab closes.'}</span>
        <span class="pm-btns"><button class="btn sm" type="button" data-act="cancel">Cancel</button><button class="btn accent sm" type="submit" data-submit>${at >= 0 ? 'Replace' : 'Save'}</button></span></div>
      </form>`;
    } else {
      html += `<button class="pm-save" type="button" data-act="save">${I.plus}<span>Save current design…</span><span class="mi-tag">${esc(tagOf(getParams()))}</span></button>`;
    }

    // list
    if (!list.length) {
      html += `<div class="pm-empty">No saved designs yet. Save the current design to keep it${store.available ? ' in this browser' : ''}, or import a preset file.</div>`;
    } else {
      html += `<div class="pm-list" role="group" aria-label="My presets">`;
      list.forEach((e, i) => {
        const isCur = encode(e.params) === cur;
        const st = ui && ui.i === i ? ui.t : null;
        const cls = `pm-row${isCur ? ' current' : ''}${fresh.has(e.name) ? ' fresh' : ''}${st ? ' ' + st : ''}`;
        if (st === 'rename') {
          html += `<form class="${cls} pm-form" data-form="rename" data-i="${i}" autocomplete="off">
            <input class="pm-input" name="name" maxlength="${MAX_NAME}" value="${esc(draft)}" aria-label="New name for ${esc(e.name)}" spellcheck="false">
            <div class="pm-form-row"><span class="pm-note" data-note>Rename “${esc(e.name)}”</span>
            <span class="pm-btns"><button class="btn sm" type="button" data-act="cancel">Cancel</button><button class="btn accent sm" type="submit" data-submit>Rename</button></span></div></form>`;
        } else if (st === 'overwrite' || st === 'delete') {
          const del = st === 'delete';
          html += `<div class="${cls} pm-confirm" data-i="${i}" role="alertdialog" aria-label="${del ? 'Confirm delete' : 'Confirm overwrite'}">
            <div class="pm-q">${del ? `Delete “${esc(e.name)}”? <span>This can’t be undone.</span>` : `Overwrite “${esc(e.name)}” with the current design?`}</div>
            <div class="pm-btns"><button class="btn sm" type="button" data-act="cancel">Cancel</button><button class="btn sm ${del ? 'danger' : 'accent'}" type="button" data-act="${del ? 'confirm-delete' : 'confirm-overwrite'}" data-i="${i}">${del ? 'Delete' : 'Overwrite'}</button></div></div>`;
        } else {
          html += `<div class="${cls}" data-i="${i}">
            <button class="menu-item pm-load" type="button" role="menuitem" data-act="load" data-i="${i}" title="Load “${esc(e.name)}”"><b><span class="mi-tag">${esc(tagOf(e.params))}</span>${esc(e.name)}</b><span>${esc(fmtRange(e.params))} · ${esc(MODE_WORD[e.params.mode] || e.params.mode)}${e.savedAt ? ' · ' + esc(fmtDate(e.savedAt)) : ''}${isCur ? ' · <em>on the board</em>' : ''}</span></button>
            <div class="pm-acts">
              <button class="pm-icon" type="button" data-act="rename" data-i="${i}" title="Rename" aria-label="Rename ${esc(e.name)}">${I.pen}</button>
              <button class="pm-icon" type="button" data-act="overwrite" data-i="${i}" title="Overwrite with the current design" aria-label="Overwrite ${esc(e.name)} with the current design">${I.save}</button>
              <button class="pm-icon danger" type="button" data-act="delete" data-i="${i}" title="Delete" aria-label="Delete ${esc(e.name)}">${I.trash}</button>
            </div></div>`;
        }
      });
      html += `</div>`;
    }
    if (!store.available) html += `<div class="pm-unavail"><i></i><span>Saving is unavailable in this browser (private window or blocked storage). Presets last until this tab closes. Export them to keep them.</span></div>`;

    // built-ins
    html += `<div class="pm-divider"></div><div class="menu-title">Built-in</div>` + Object.entries(builtins).map(([id, pr]) => {
      const pp = pr.params || pr, n = pp.numStrings ?? G.DEFAULTS.numStrings, mode = pp.mode ?? G.DEFAULTS.mode;
      return `<button class="menu-item" type="button" role="menuitem" data-act="builtin" data-id="${esc(id)}"><b><span class="mi-tag">${String(n).padStart(2, '0')}·${esc(mode.slice(0, 4).toUpperCase())}</span>${esc(pr.label || id)}</b>${pr.description ? `<span>${esc(pr.description)}</span>` : ''}</button>`;
    }).join('');

    menu.innerHTML = html;
    if (focus) {
      const el = typeof focus === 'string' ? menu.querySelector(focus) : null;
      if (el) { el.focus({ preventScroll: true }); if (el.select && el.tagName === 'INPUT') el.select(); el.scrollIntoView?.({ block: 'nearest' }); }
    }
  }

  // ---------------------------------------------------------------- actions --
  const persist = (list, okMsg) => {
    if (store.write(list)) { if (okMsg) toast(okMsg, 'ok'); return true; }
    toast('This browser would not store the preset (storage is full or blocked).', 'error');
    return false;
  };
  const current = () => sanitizeParams(JSON.parse(JSON.stringify(getParams())), G);

  function act(a, i) {
    const list = store.read();
    switch (a) {
      case 'save': ui = { t: 'save' }; draft = suggestName(); render({ focus: '.pm-input' }); break;
      case 'cancel': ui = null; render({ focus: '[data-act="save"]' }); break;
      case 'rename': ui = { t: 'rename', i }; draft = list[i]?.name || ''; render({ focus: '.pm-input' }); break;
      case 'overwrite': ui = { t: 'overwrite', i }; render({ focus: '[data-act="confirm-overwrite"]' }); break;
      case 'delete': ui = { t: 'delete', i }; render({ focus: '[data-act="cancel"]' }); break;
      case 'confirm-overwrite': {
        const e = list[i], p = current(); if (!e || !p) break;
        list[i] = { ...e, params: p, savedAt: new Date().toISOString() };
        ui = null; persist(list, `Updated “${e.name}” with the current design.`); render();
        break;
      }
      case 'confirm-delete': {
        const e = list[i]; if (!e) break;
        list.splice(i, 1); ui = null; persist(list, `Deleted “${e.name}”.`); render({ focus: '[data-act="save"]' });
        break;
      }
      case 'load': {
        const e = list[i]; if (!e) break;
        load(e.params, `Loaded “${e.name}”`); ui = null; close();
        break;
      }
      case 'builtin': break; // handled with the id below
      case 'export': exportFile(list); break;
      case 'import': fileInput.value = ''; fileInput.click(); break;
    }
  }

  function submit(form) {
    const name = cleanName(form.querySelector('.pm-input')?.value);
    const note = form.querySelector('[data-note]');
    if (!name) { note.textContent = 'Type a name first.'; note.classList.add('warn'); form.querySelector('.pm-input').focus(); return; }
    const list = store.read();
    if (form.dataset.form === 'save') {
      const p = current(); if (!p) { toast('The current design could not be saved.', 'error'); return; }
      const entry = { name, params: p, savedAt: new Date().toISOString() };
      const at = list.findIndex(e => e.name.toLowerCase() === name.toLowerCase());
      if (at >= 0) list[at] = entry; else list.unshift(entry);
      if (list.length > MAX_PRESETS) list.length = MAX_PRESETS;
      ui = null;
      if (persist(list, at >= 0 ? `Replaced “${name}”.` : (store.available ? `Saved “${name}”.` : `Kept “${name}” for this tab. Saving is unavailable in this browser.`))) { fresh = new Set([name]); setTimeout(() => { fresh.clear(); }, 1600); }
      render();
    } else if (form.dataset.form === 'rename') {
      const i = +form.dataset.i, e = list[i]; if (!e) return;
      const clash = list.findIndex((x, k) => k !== i && x.name.toLowerCase() === name.toLowerCase());
      if (clash >= 0) { note.textContent = 'You already have a preset with that name.'; note.classList.add('warn'); return; }
      list[i] = { ...e, name };
      ui = null; persist(list, name === e.name ? null : `Renamed to “${name}”.`); render();
    }
  }

  function exportFile(list) {
    if (!list.length) return;
    const doc = { app: FILE_APP, kind: FILE_KIND, version: FILE_VERSION, exported: new Date().toISOString(), presets: list.map(e => ({ name: e.name, savedAt: e.savedAt, params: e.params })) };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const day = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `curved-fret-presets-${day}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`Exported ${list.length} preset${list.length === 1 ? '' : 's'} to ${a.download}`, 'ok');
  }

  async function importFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { toast('That file is too big to be a preset file.', 'warn'); return; }
    let parsed;
    try { parsed = parsePresetFile(await file.text(), G); }
    catch (err) { toast(err.message || 'That file could not be read.', 'warn'); return; }
    const { entries, skipped } = parsed;
    if (!entries.length) { toast(`No usable presets in that file${skipped ? ` (${skipped} skipped)` : ''}.`, 'warn'); return; }
    const list = store.read();
    const names = list.map(e => e.name);
    let renamed = 0;
    const added = [];
    for (const e of entries) {
      const n = uniqueName(e.name, names);
      if (n !== e.name) renamed++;
      names.push(n); added.push({ ...e, name: n });
    }
    const merged = [...added, ...list].slice(0, MAX_PRESETS);
    const bits = [`Imported ${added.length} preset${added.length === 1 ? '' : 's'}.`];
    if (renamed) bits.push(`${renamed} renamed to avoid a clash.`);
    if (skipped) bits.push(`${skipped} unreadable entr${skipped === 1 ? 'y' : 'ies'} skipped.`);
    if (persist(merged, bits.join(' '))) { fresh = new Set(added.map(e => e.name)); setTimeout(() => { fresh.clear(); }, 1800); }
    ui = null;
    if (!menu.hidden) render();
  }

  // ---------------------------------------------------------------- events --
  menu.addEventListener('click', e => {
    e.stopPropagation(); // the menu re-renders; keep the outside-click closer away
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === 'builtin') {
      const pr = builtins[b.dataset.id]; if (!pr) return;
      load({ ...(pr.params || pr), units: getParams().units }, `Loaded “${pr.label || b.dataset.id}”`);
      ui = null; close(); return;
    }
    act(a, b.dataset.i != null ? +b.dataset.i : undefined);
  });
  menu.addEventListener('submit', e => { e.preventDefault(); submit(e.target); });
  menu.addEventListener('input', e => {
    if (!e.target.classList.contains('pm-input')) return;
    draft = e.target.value;
    const form = e.target.closest('form');
    if (form?.dataset.form === 'save') {
      const n = cleanName(draft), taken = n && store.read().some(x => x.name.toLowerCase() === n.toLowerCase());
      const note = form.querySelector('[data-note]'), sb = form.querySelector('[data-submit]');
      note.textContent = taken ? 'Replaces your preset with this name.' : store.available ? 'Saved in this browser.' : 'Kept until this tab closes.';
      note.classList.toggle('warn', !!taken); sb.textContent = taken ? 'Replace' : 'Save';
    }
  });
  menu.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ui) { e.stopPropagation(); e.preventDefault(); act('cancel'); }
  });
  fileInput.addEventListener('change', () => importFile(fileInput.files?.[0]));
  // Re-render each time the menu opens, so it reflects the current design and other tabs.
  button?.addEventListener('click', () => {
    if (menu.hidden) return;
    ui = null; render();
    menu.querySelector('[data-act="save"]')?.focus({ preventScroll: true });
  });
  window.addEventListener('storage', e => { if (e.key === STORAGE_KEY && !menu.hidden && !ui) render(); });

  render();
  return { render, get available() { return store.available; }, importFile, list: () => store.read() };
}

// paper.js — the "Paper" view: a technical white paper on curved-fret,
// exponential-scale instruments with live figures from the geometry engine.
// Loaded on demand the first time the Paper tab opens; nothing here runs at
// app start.
import * as G from '../geometry.js';
import { META, SECTIONS } from './content.js';
import * as F from './figures.js';

const KATEX_VER = '0.16.9';
const KATEX_BASE = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VER}/dist/`;
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..500&display=swap';

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad2 = n => String(n).padStart(2, '0');

function loadCSS(href) {
  return new Promise(res => {
    if ([...document.styleSheets].some(s => s.href === href) || document.querySelector(`link[href="${href}"]`)) return res(true);
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href;
    if (href.startsWith('https://cdn.jsdelivr.net/')) l.crossOrigin = 'anonymous';
    l.onload = () => res(true); l.onerror = () => res(false);
    document.head.appendChild(l);
  });
}
function loadScript(src) {
  return new Promise(res => {
    const s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => res(true); s.onerror = () => res(false);
    document.head.appendChild(s);
  });
}
const withTimeout = (p, ms, v) => Promise.race([p, new Promise(r => setTimeout(() => r(v), ms))]);

// ------------------------------------------------------------ math ---------
function typeset(html, katex) {
  const dec = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const r = (tex, display) => {
    const src = dec(tex.trim());
    if (katex) {
      try { return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml', trust: false }); }
      catch { /* fall through */ }
    }
    return `<code class="tex${display ? ' block' : ''}">${esc(src)}</code>`;
  };
  return html
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => `<div class="eq">${r(t, true)}</div>`)
    .replace(/\$([^$\n]+?)\$/g, (_, t) => r(t, false));
}

// ------------------------------------------------------------ live facts ---
function facts() {
  const acc = F.design('acc8'), fam = F.growthFamily().steps;
  const g13 = fam.find(s => s.g === 1.3), g08 = fam.find(s => s.g === 0.8);
  const s12 = F.inflectionSummary(F.design('s12'));
  const L = 25.5 * 25.4;
  return {
    acc8sag1: acc.frets[0].sagitta.toFixed(1),
    acc8r: acc.metrics.minRadius.toFixed(0), acc8rf: acc.metrics.minRadiusFret,
    g13first: g13.first.toFixed(2), g13last: g13.last.toFixed(2),
    g08first: g08.first.toFixed(2), g08last: g08.last.toFixed(2),
    g13pow: Math.pow(1.3, 6).toFixed(1), g145pow: Math.pow(1.45, 6).toFixed(1),
    cvs: F.cVersusS(1.32).toFixed(4),
    s12count: s12.count, s12total: s12.total, s12off: s12.maxOffset.toFixed(2),
    sp2324: (L * (Math.pow(2, -23 / 12) - Math.pow(2, -24 / 12))).toFixed(1),
  };
}

function kTable() {
  const p = 0.5;
  const rows = [['Nut', 0, 0], ['Fret 1', 1], ['Fret 5', 5], ['Fret 12', 12], ['Fret 24', 24], ['Bridge (saddles)', Infinity]];
  const body = rows.map(([lab, n]) => {
    const t = n === Infinity ? 1 : 1 - Math.pow(2, -n / 12), k = t - p;
    const what = Math.abs(k) < 1e-9 ? 'straight: this is the perpendicular' : n === 0 ? 'the full curve, one way' : n === Infinity ? 'mirror image of the nut' : k < 0 ? `${(Math.abs(k) / p * 100).toFixed(0)} % of the nut's bow` : `${(k / p * 100).toFixed(0)} % of the nut's bow, the other way`;
    return `<tr${Math.abs(k) < 1e-9 ? ' class="hl"' : ''}><th scope="row">${lab}</th><td>${t.toFixed(4)}</td><td>${k >= 0 ? '+' : '−'}${Math.abs(k).toFixed(3)}</td><td class="txt">${what}</td></tr>`;
  }).join('');
  return `<caption>Fret fraction $t_n$ and scale factor $k_n$ with the perpendicular at the octave, $p = 0.5$.</caption><thead><tr><th>Line</th><th>$t_n$</th><th>$k_n$</th><th>Bow</th></tr></thead><tbody>${body}</tbody>`;
}

// ------------------------------------------------------------ build --------
export function createPaper({ app, onOpenDesign, onClose }) {
  const root = document.documentElement;
  const pane = h('div', 'paper-pane');
  pane.id = 'panePaper';
  pane.setAttribute('role', 'region'); pane.setAttribute('aria-label', 'White paper');
  pane.tabIndex = -1;
  pane.innerHTML = `<div class="paper-loading"><div class="loader-mark"><svg viewBox="0 0 32 32"><path d="M9 5c4 6 4 16 0 22M16 5c3 6 3 16 0 22M23 5c2 6 2 16 0 22"/></svg></div><div class="loader-t">Typesetting the paper</div></div>`;
  const topbar = app.querySelector('.topbar');
  app.insertBefore(pane, topbar);
  const progress = h('div', 'paper-progress'); progress.setAttribute('aria-hidden', 'true');
  topbar.appendChild(progress);

  let built = false, building = null, sections = [], tocItems = [], tocCur = null, nav = null;

  async function build() {
    const cssOk = loadCSS(new URL('./paper.css', import.meta.url).href);
    loadCSS(FONT_CSS);
    const katexCss = loadCSS(KATEX_BASE + 'katex.min.css');
    const katexJs = window.katex ? Promise.resolve(true) : loadScript(KATEX_BASE + 'katex.min.js');
    await withTimeout(cssOk, 4000, false);
    await withTimeout(Promise.all([katexCss, katexJs]), 9000, false);
    const katex = window.katex || null;
    if (!katex) console.warn('KaTeX did not load; equations are shown as TeX source.');

    const fx = facts();
    const fill = s => s.replace(/\{\{(\w+)\}\}/g, (_, k) => fx[k] != null ? esc(fx[k]) : '—');
    const nSec = SECTIONS.length;
    const nFig = SECTIONS.reduce((a, s) => a + (s.html.match(/<figure /g) || []).length, 0);
    const words = SECTIONS.reduce((a, s) => a + s.html.replace(/<[^>]+>|\$[^$]*\$/g, ' ').split(/\s+/).filter(Boolean).length, 0);

    const toc = SECTIONS.map((s, i) => `<li><button type="button" class="toc-a" data-target="p-${s.id}"><span class="n">${pad2(i + 1)}</span><span class="t">${esc(s.title)}</span></button></li>`).join('');
    const body = SECTIONS.map((s, i) => `<section class="psec" id="p-${s.id}" data-n="${i + 1}" aria-labelledby="h-${s.id}"><h2 id="h-${s.id}"><span class="sec-n">${pad2(i + 1)}</span><span class="sec-t">${esc(s.title)}</span></h2>${fill(s.html)}</section>`).join('');

    const PRINT_ICON = '<svg viewBox="0 0 16 16"><path d="M4.5 6V2.5h7V6M4.5 11.5H3a1 1 0 01-1-1V7a1 1 0 011-1h10a1 1 0 011 1v3.5a1 1 0 01-1 1h-1.5"/><path d="M4.5 9.5h7v4h-7z"/></svg>';
    const BACK_ICON = '<svg viewBox="0 0 16 16"><path d="M9.5 3.5L5 8l4.5 4.5"/></svg>';
    const html = `
      <div class="paper-wrap">
        <nav class="paper-toc" aria-label="Contents">
          <div class="toc-inner">
            <button type="button" class="toc-current" aria-expanded="false"><span class="n">01</span><span class="t">${esc(SECTIONS[0].title)}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6.5l4 4 4-4"/></svg></button>
            <div class="toc-panel">
              <div class="toc-h">Contents</div>
              <ol class="toc-list">${toc}</ol>
              <div class="toc-foot"><button type="button" class="btn sm" data-print>${PRINT_ICON}<span>Print / Save as PDF</span></button></div>
            </div>
          </div>
        </nav>
        <article class="paper">
          <header class="paper-hero">
            <div class="kicker">${esc(META.kicker)}</div>
            <h1>${esc(META.title)}</h1>
            <p class="dek">${esc(META.dek)}</p>
            <div class="hero-meta"><span>${nSec} sections</span><span>${nFig} live figures</span><span>about ${Math.max(5, Math.round(words / 230))} min read</span><span>figures computed in your browser</span></div>
            <div class="paper-actions">
              <button type="button" class="btn accent sm" data-print>${PRINT_ICON}<span>Print / Save as PDF</span></button>
              <button type="button" class="btn sm" data-close>${BACK_ICON}<span>Back to the designer</span></button>
            </div>
          </header>
          ${typeset(body, katex)}
          <footer class="paper-end">
            <div class="end-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 5c4 6 4 16 0 22M16 5c3 6 3 16 0 22M23 5c2 6 2 16 0 22"/></svg></div>
            <p>Every curve in this paper can be opened, changed and exported in the designer.</p>
            <div class="paper-actions center"><button type="button" class="btn accent sm" data-close>${BACK_ICON}<span>Back to the designer</span></button><button type="button" class="btn sm" data-print>${PRINT_ICON}<span>Print / Save as PDF</span></button></div>
          </footer>
        </article>
      </div>`;
    pane.innerHTML = html;
    pane.querySelector('[data-live="ktable"]').innerHTML = typeset(kTable(), katex);
    pane.querySelector('[data-live="sagtable"]').innerHTML = F.sagittaTable();
    mountFigures();
    wire();
    built = true;
  }

  // ---------------------------------------------------------- figures ------
  function openBtn(id, label = 'Open this design') {
    const d = F.DESIGNS[id];
    return `<button type="button" class="btn sm fig-open" data-open-id="${id}" title="Load “${esc(d?.label || id)}” into the designer and show it in 3D"><svg viewBox="0 0 16 16"><path d="M6 3.5H3.5v9h9V10M9 3h4v4M13 3L7.5 8.5"/></svg><span>${esc(label)}</span></button>`;
  }
  const exSeg = (opts, cur) => `<div class="fig-seg" role="group" aria-label="Bow scale">${opts.map(([v, l]) => `<button type="button" data-k="${v}" class="${v === cur ? 'on' : ''}" aria-pressed="${v === cur}">${l}</button>`).join('')}</div>`;

  function mountFigures() {
    pane.querySelectorAll('figure.fig').forEach(fig => {
      const head = fig.querySelector('.fig-head');
      head.insertAdjacentHTML('beforeend', `<span class="fig-sp"></span><span class="live-chip" title="Computed by the geometry engine when this page opened"><i></i>Live</span>${fig.dataset.open ? openBtn(fig.dataset.open) : ''}`);
      const body = fig.querySelector('.fig-body');
      const kind = fig.dataset.fig;
      try { RENDER[kind]?.(body, fig); }
      catch (err) { console.error(err); body.innerHTML = `<div class="fig-err">This figure could not be computed: ${esc(err.message)}</div>`; }
    });
  }

  const RENDER = {
    fan(body) {
      let k = 1;
      const draw = () => {
        body.innerHTML = `<div class="fig-tools">${exSeg([[1, 'True scale'], [4, 'Bows ×4']], k)}</div>
          <div class="fm-pair"><div class="fm-lab"><b>Linear fan</b><span>g = 1 · equal steps</span></div>${F.fretMap(F.design('fan8'), { k, title: 'Linear fan, straight frets' })}
          <div class="fm-lab"><b>Accelerating exponential</b><span>g = 1.3 · steps grow toward the bass</span></div>${F.fretMap(F.design('acc8'), { k, title: 'Exponential board, curved frets' })}</div>`;
        body.querySelectorAll('.fig-seg button').forEach(b => b.onclick = () => { k = +b.dataset.k; draw(); });
      };
      draw();
    },
    growth(body) { body.innerHTML = F.growthFamily().svg + `<div class="fig-legend"><span><i class="lg gf-acc"></i>g &gt; 1, accelerating</span><span><i class="lg gf-fan"></i>g = 1, straight fan</span><span><i class="lg gf-dec"></i>g &lt; 1, decelerating</span></div>`; },
    seesaw(body, fig) {
      let p = 0.5, k = 1, raf = 0;
      body.innerHTML = `<div class="fig-tools"><label class="pslider"><span>Perpendicular <b>p</b></span><input type="range" min="0" max="1" step="0.01" value="0.5" aria-label="Perpendicular position p"><output>0.50</output></label><span class="pnote"></span>${exSeg([[1, 'True scale'], [4, 'Bows ×4']], k)}</div><div class="kb-host"></div><div class="fm-host"></div><div class="fig-legend"><span><i class="lg nutside"></i>nut side, k &lt; 0</span><span><i class="lg perp"></i>perpendicular, k = 0</span><span><i class="lg brside"></i>bridge side, k &gt; 0</span></div>`;
      const input = body.querySelector('input'), out = body.querySelector('output'), note = body.querySelector('.pnote');
      const draw = () => {
        raf = 0;
        const d = G.computeDesign({ ...F.designParams('acc8'), perpRatio: p });
        body.querySelector('.kb-host').innerHTML = F.kBars(p);
        body.querySelector('.fm-host').innerHTML = F.fretMap(d, { k, sideTint: true, title: `Exponential board with the perpendicular at ${p.toFixed(2)}` });
        out.textContent = p.toFixed(2);
        const nPerp = G.perpFretNumber ? G.perpFretNumber(p) : -12 * Math.log2(1 - p);
        note.textContent = p <= 0 ? 'straight nut; every fret bends one way' : p >= 1 ? 'straight saddle line; every fret bends one way' : nPerp > 24 ? `straight line past the last fret (fret ${nPerp.toFixed(1)})` : `straight fret: ${Math.abs(nPerp - Math.round(nPerp)) < 0.05 ? Math.round(nPerp) : nPerp.toFixed(1)}`;
        fig.dataset.p = p;
      };
      input.addEventListener('input', () => { p = +input.value; if (!raf) raf = requestAnimationFrame(draw); });
      body.querySelectorAll('.fig-seg button').forEach(b => b.onclick = () => { k = +b.dataset.k; body.querySelectorAll('.fig-seg button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); draw(); });
      draw();
    },
    profiles(body) {
      const panels = [
        ['acc8', 'Exponential', 'accelerating, g 1.3'],
        ['dec8', 'Exponential', 'decelerating, g 0.9'],
        ['div9', 'Divergent (D)', 'outward from the pivot, g 1.2'],
        ['con9', 'Convergent (C)', 'inward to the pivot, g 1.32'],
        ['s8', 'S-curve', 'two outward halves, g 0.8'],
      ];
      body.innerHTML = `<div class="pc-grid">${panels.map(([id, t, sub], i) => `<div class="pc-cell"><div class="pc-head"><span class="pc-l">${'abcde'[i]}</span><div><b>${t}</b><span>${sub}</span></div></div>${F.profileChart(F.design(id), { title: `${t} scale profile` })}<div class="pc-foot">${openBtn(id, 'Open')}</div></div>`).join('')}</div>`;
    },
    scurve(body) {
      let k = 5;
      const d = F.design('s12');
      const draw = () => {
        body.innerHTML = `<div class="fig-tools">${exSeg([[1, 'True scale'], [5, 'Bows ×5']], k)}</div>${F.fretMap(d, { k, infl: true, pivot: true, title: '12-string S-curve with inflection points' })}<div class="fig-legend"><span><i class="lg infl"></i>inflection point</span><span><i class="lg pivot"></i>pivot (virtual string 6.5)</span><span><i class="lg perp"></i>perpendicular</span></div>`;
        body.querySelectorAll('.fig-seg button').forEach(b => b.onclick = () => { k = +b.dataset.k; draw(); });
      };
      draw();
    },
    sagitta(body) {
      body.innerHTML = F.sagittaChart();
    },
  };

  // ---------------------------------------------------------- behaviour ----
  function wire() {
    nav = pane.querySelector('.paper-toc');
    sections = [...pane.querySelectorAll('.psec')];
    tocItems = [...pane.querySelectorAll('.toc-a')];
    tocCur = pane.querySelector('.toc-current');
    pane.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.matches('[data-print]')) { print(); return; }
      if (t.matches('[data-close]')) { onClose?.(); return; }
      if (t.classList.contains('toc-current')) { const open = !nav.classList.contains('open'); nav.classList.toggle('open', open); t.setAttribute('aria-expanded', open); return; }
      if (t.classList.contains('toc-a')) { goTo(t.dataset.target); nav.classList.remove('open'); tocCur.setAttribute('aria-expanded', 'false'); return; }
      if (t.dataset.openId) {
        const id = t.dataset.openId, fig = t.closest('figure');
        const params = F.designParams(id);
        if (!params) return;
        if (fig?.dataset.fig === 'seesaw' && fig.dataset.p != null) params.perpRatio = +fig.dataset.p;
        onOpenDesign?.(params, F.DESIGNS[id].label);
      }
    });
    document.addEventListener('click', e => { if (nav.classList.contains('open') && !e.target.closest('.paper-toc')) { nav.classList.remove('open'); tocCur.setAttribute('aria-expanded', 'false'); } });
    let raf = 0;
    pane.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; spy(); }); }, { passive: true });
    window.addEventListener('resize', () => { if (root.classList.contains('paper-mode')) spy(); });
    spy();
  }
  function topOffset() {
    const tb = app.querySelector('.topbar').getBoundingClientRect();
    const bar = getComputedStyle(nav).position === 'sticky' ? nav.getBoundingClientRect().height + 8 : 0;
    return tb.bottom + 16 + bar;
  }
  function goTo(id) {
    const el = pane.querySelector('#' + CSS.escape(id)); if (!el) return;
    const y = el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - topOffset() + 4;
    pane.scrollTo({ top: Math.max(0, y), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function spy() {
    if (!sections.length) return;
    const line = topOffset() + window.innerHeight * 0.12;
    let cur = 0;
    sections.forEach((s, i) => { if (s.getBoundingClientRect().top <= line) cur = i; });
    if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 4) cur = sections.length - 1;
    tocItems.forEach((a, i) => { a.classList.toggle('on', i === cur); if (i === cur) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    tocCur.querySelector('.n').textContent = pad2(cur + 1);
    tocCur.querySelector('.t').textContent = SECTIONS[cur].title;
    const max = pane.scrollHeight - pane.clientHeight;
    progress.style.setProperty('--p', max > 0 ? Math.min(1, pane.scrollTop / max).toFixed(4) : 0);
  }
  function print() {
    if (!built) return;
    root.classList.add('paper-mode');
    window.print();
  }

  return {
    el: pane,
    async show() {
      root.classList.add('paper-mode');
      if (!built) { building ||= build().catch(err => { building = null; throw err; }); await building; }
      requestAnimationFrame(spy);
      pane.focus({ preventScroll: true });
    },
    hide() { root.classList.remove('paper-mode'); nav?.classList.remove('open'); },
    print,
    get built() { return built; },
  };
}

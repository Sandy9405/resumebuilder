// Renders resume state to a self-contained HTML document with an embedded
// layout engine. The same document is used for the browser preview and the
// server-side PDF, so the PDF is the preview.
//
// Pipeline inside the document (see engine() below):
//   measure every block with real font metrics -> paginate with keep-together
//   rules -> optionally apply a small, bounded density adjustment -> move blocks
//   onto fixed-size pages -> run visual QA -> publish window.__layout.
//
// Spacing is applied as padding-top on blocks (never margins), so block heights
// add up exactly and the paginator's arithmetic matches what is drawn.

import { getTemplate, contentBox, FONT_FACES, DENSITY_LEVELS, MAX_AUTO_TIGHTEN, EXPAND_LEVELS, FILL_TARGET, FILL_CEILING, LOW_CONTENT, MM_TO_PX } from './templates.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Inline emphasis: **key result** becomes bold. Escaping happens first, so only
// the bold markers are interpreted; unpaired asterisks stay literal.
export const rich = (s) => esc(s).replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<b>$1</b>');
export const plain = (s) => String(s ?? '').replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1');

const visibleSections = (resume) =>
  (resume.sections || [])
    .filter((s) => !s.hidden)
    .map((s) => ({ ...s, items: (s.items || []).filter((i) => !i.hidden) }))
    .filter((s) => s.items.length);

// ---------------------------------------------------------------- CSS

function css(t, opts) {
  const m = t.marginsMm;
  const sp = t.spacingPt;
  const sz = (pt) => `calc(${pt}pt + var(--fd))`; // name, headings: shrink ladder only
  const bz = (pt) => `calc(${pt}pt + var(--fd) + var(--fx))`; // body text: may also grow to fill a page
  const gap = (pt) => `calc(${pt}pt * var(--sp))`;
  const fam = `"${t.font.family}", ${t.font.fallback}`;
  const faces = FONT_FACES.map(
    ([family, file, weight, style]) =>
      `@font-face{font-family:"${family}";src:url("${opts.fontUrl(file)}") format("woff2");font-weight:${weight};font-style:${style};font-display:block}`,
  ).join('\n');
  const h = t.heading;
  const C = { accent: '#111', muted: '#111', link: 'inherit', ...(t.colors || {}) };
  const headingCss = {
    'rule-under': `border-bottom:0.75pt solid ${C.accent};padding-bottom:1pt;`,
    band: `background:${h.fill};padding:${h.padPt[0]}pt ${h.padPt[1]}pt;`,
    'dotted-rules': `border-top:0.6pt dotted #222;border-bottom:0.6pt dotted #222;padding:${h.padPt[0]}pt 0;`,
  }[h.style];
  const caps = (c) => (c === 'upper' ? 'text-transform:uppercase;' : c === 'small-caps' ? 'font-variant-caps:small-caps;' : '');
  const ind = t.indentMm;
  const et = t.educationTable;

  return `${faces}
@page{size:${t.page.widthMm}mm ${t.page.heightMm}mm;margin:0}
:root{--sp:1;--fd:0pt;--fx:0pt;--lx:1;--lh:calc((${t.size.base}pt + var(--fd) + var(--fx)) * ${t.lineHeight} * var(--lx))}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:${opts.screen ? 'transparent' : '#fff'};color:#111;font-family:${fam};font-size:${bz(t.size.base)};line-height:calc(${t.lineHeight} * var(--lx));
  font-kerning:normal;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
#flow{position:absolute;left:-20000px;top:0;width:${contentBox(t.id).widthMm}mm}
.page{width:${t.page.widthMm}mm;height:${t.page.heightMm}mm;padding:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;
  background:#fff;overflow:hidden;position:relative;break-after:page}
.page:last-child{break-after:auto}
.screen .page{margin:0 auto 14px;box-shadow:0 1px 8px rgba(0,0,0,.18)}
.screen .page.over{outline:2px solid #c0392b;outline-offset:-1px}
.screen .page.over::after{content:attr(data-label);position:absolute;top:4px;right:6px;font:11px system-ui,sans-serif;color:#fff;background:#c0392b;padding:1px 6px;border-radius:3px}
@media print{body{background:#fff}.page{margin:0;box-shadow:none;outline:none}.page::after{display:none}}

.blk{position:relative;padding-top:${gap(0)};text-align:left;hyphens:manual;overflow-wrap:break-word}
.blk[data-gap="header"]{padding-top:0}
.blk[data-gap="section"]{padding-top:${gap(sp.section)};--gap-pt:${sp.section}pt}
.blk[data-gap="headingAfter"]{padding-top:${gap(sp.headingAfter)};--gap-pt:${sp.headingAfter}pt}
.blk[data-gap="entry"]{padding-top:${gap(sp.entry)};--gap-pt:${sp.entry}pt}
.blk[data-gap="line2"]{padding-top:${gap(sp.line2)};--gap-pt:${sp.line2}pt}
.blk[data-gap="bullet"]{padding-top:${gap(sp.bullet)};--gap-pt:${sp.bullet}pt}
.page>.blk.pg-first{padding-top:0}

/* header */
.hd .name{font-size:${sz(t.size.name)};font-weight:700;line-height:1.1;letter-spacing:${t.header.nameLetterSpacingPt}pt;${caps(t.header.nameCase)}}
.hd .name{color:${C.accent}}
.hd .tagline{font-style:${t.header.layout === 'centered' ? 'normal' : 'italic'};font-size:${sz(t.size.tagline || t.size.base)};color:${C.muted}}
.hd .contact{color:${C.muted}}
.hd.centered{text-align:center}
.hd .contact,.hd .details{font-size:${sz(t.size.contact)}}
.hd a.mail{color:inherit !important;text-decoration:none !important}
.hd a{color:${C.link};text-decoration:${t.colors?.link ? 'underline' : 'none'};text-underline-offset:1.5pt;text-decoration-thickness:0.5pt}
.hd .contact span+span::before{content:"${t.header.layout === 'left-rule' ? '\\00a0\\2022\\00a0' : '\\00a0|\\00a0'}";color:#444}
.hd.split{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:12pt;align-items:start}
.hd.split .details{text-align:left}
.hd.right-name{text-align:right}
.hd.left-rule{border-bottom:0.9pt solid #111;padding-bottom:2pt}

/* section headings */
.sh{font-size:${sz(t.size.heading)};font-weight:700;line-height:1.25;text-align:${h.align};letter-spacing:${h.letterSpacingPt}pt;${caps(h.case)}}
.sh>span{display:block;${headingCss}}

/* entries: a two-column grid keeps dates on the content edge; the left side wraps */
.row{display:grid;grid-template-columns:minmax(0,1fr) max-content;column-gap:10pt;align-items:baseline}
.row>.r{text-align:right;white-space:nowrap}
.eh{padding-left:${ind.entryText}mm}
.mk{position:absolute;left:0;width:0;white-space:nowrap;line-height:var(--lh)}
/* markers sit on the first text line: offset by the block's own spacing, not the padding edge */
.blk>.mk{top:calc(var(--gap-pt, 0pt) * var(--sp))}
.page>.blk.pg-first>.mk{top:0}
.eh>.mk{left:${ind.entryMarker}mm}
.bul{padding-left:${ind.bulletText}mm}
.bul>.mk{left:${ind.bulletMarker}mm}
.st{padding-left:${t.entry.marker ? ind.entryText : ind.bulletText}mm}
.st>.mk{left:${t.entry.marker ? ind.entryMarker : ind.bulletMarker}mm}
.t{text-wrap:pretty}
.org{font-weight:700}
.sh{color:${C.accent}}
.muted,.pro .org,.pro .det,.pro .loc{color:${C.muted}}
.pro .org{font-weight:400}
${t.size.title ? `.eh:not(.edu)>.row>.l{font-size:${sz(t.size.title)}}` : ''}
.pro .eh.edu.det{padding-left:2mm}
.note{font-style:italic;color:${C.muted}}
.eh.note-line{padding-left:${t.indentMm.bulletText}mm}
.iima .org{text-decoration:underline;text-underline-offset:1.5pt;text-decoration-thickness:0.6pt}
.hbs .org{text-transform:uppercase}
.iitb .orgsep{font-weight:400}
.iitb .org{font-style:italic}
.ttl{font-weight:700}
.hbs .ttl{font-style:italic}
.dates{font-weight:${t.entry.datesStyle === 'bold' ? 700 : 400};font-style:${t.entry.datesStyle === 'italic-paren' ? 'italic' : 'normal'};color:${t.entry.datesStyle === 'muted' ? C.muted : 'inherit'}}
.det{font-style:${t.id === 'iitb' ? 'italic' : 'normal'}}
.para{text-wrap:pretty}
.sk .cat{font-weight:700}
.mk.sq::before,.mk.dot::before,.mk.ring::before{content:"";display:inline-block;vertical-align:0.08em;box-sizing:border-box}
.mk.sq::before{width:0.34em;height:0.34em;background:#111;vertical-align:0.06em}
.mk.dot::before{width:0.32em;height:0.32em;border-radius:50%;background:#111;vertical-align:0.1em}
.mk.ring::before{width:0.32em;height:0.32em;border-radius:50%;border:0.07em solid #111;vertical-align:0.1em}
.st.nomk{padding-left:0}

/* education table: fixed column widths, rows never split */
table.edu{width:100%;border-collapse:collapse;table-layout:fixed;font-size:${bz(t.size.table)};line-height:1.15}
table.edu td,table.edu th{padding:1.6pt 4pt;vertical-align:middle;overflow-wrap:break-word;text-align:left}
table.edu tr{break-inside:avoid}
${et?.style === 'rules' ? `table.edu thead tr{border-top:0.8pt solid #111;border-bottom:0.5pt solid #111}table.edu tbody tr:last-child{border-bottom:0.8pt solid #111}table.edu th{font-weight:700}` : ''}
${et?.style === 'grid' ? `table.edu th,table.edu td{border:0.6pt solid #333}table.edu th{background:${et.headerFill};font-weight:700;text-align:center}` : ''}
table.edu .c-center{text-align:center}
table.edu .c-bold{font-weight:700}

[contenteditable]{outline:none;border-radius:1px}
[contenteditable]:hover{box-shadow:0 0 0 1px #8fb0e6}
[contenteditable]:focus{box-shadow:0 0 0 1.5px #3d6fc4;background:#f3f7ff}
`;
}

// ---------------------------------------------------------------- blocks

function ed(opts, path) {
  return opts.editable ? ` contenteditable="true" spellcheck="true" data-path="${esc(path)}"` : ` data-path="${esc(path)}"`;
}

function blk(cls, gap, inner, { keep = false, path = '', sec = '' } = {}) {
  return `<div class="blk ${cls}" data-gap="${gap}"${keep ? ' data-keep="next"' : ''}${path ? ` data-item="${esc(path)}"` : ''}${sec ? ` data-sec="${esc(sec)}"` : ''}>${inner}</div>`;
}

// Links are real hyperlinks in the PDF, shown as the URL itself (not "LinkedIn")
// so ATS parsers that read only text still capture the address.
export function linkHref(raw) {
  const s = String(raw || '').trim();
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
  if (/^[a-z0-9][\w-]*(\.[\w-]+)+(\/[^\s]*)?$/i.test(s)) return `https://${s}`;
  return null;
}
export const linkLabel = (raw) => String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');

function headerBlock(r, t, opts) {
  const h = r.header || {};
  const item = (text, href) => `<span>${href ? `<a href="${esc(href)}">${esc(text)}</a>` : esc(text)}</span>`;
  const parts = {
    email: h.email ? [`<span><a class="mail" href="${/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(h.email) ? esc(`mailto:${h.email}`) : '#'}">${esc(h.email)}</a></span>`] : [],
    phone: h.phone ? [item(h.phone)] : [],
    location: h.location ? [item(h.location)] : [],
    links: (h.links || []).filter(Boolean).map((l) => item(linkLabel(l), linkHref(l))),
  };
  const contact = (t.header.contactOrder || ['email', 'phone', 'location', 'links']).flatMap((k) => parts[k]);
  const contactHtml = contact.length ? `<div class="contact">${contact.join('')}</div>` : '';
  const details = (h.details || []).filter(Boolean);
  const name = `<div class="name"${ed(opts, 'header.name')}>${esc(h.name)}</div>`;
  const tagline = h.tagline ? `<div class="tagline"${ed(opts, 'header.tagline')}>${esc(h.tagline)}</div>` : '';
  const detailsHtml = details.length ? `<div class="details">${details.map((d) => `<div>${esc(d)}</div>`).join('')}</div>` : '';
  const layout = t.header.layout;
  if (layout === 'centered') {
    return blk('hd centered', 'header', `${name}${tagline}${detailsHtml}${contactHtml}`);
  }
  if (layout === 'split') {
    return blk(`hd split`, 'header', `<div>${name}${tagline}${contactHtml}</div>${detailsHtml}`);
  }
  return blk(`hd ${layout}`, 'header', `${name}${tagline}${detailsHtml}${contactHtml}`);
}

// Bullet markers are drawn, not typed: glyph size and height vary across fonts,
// and drawn shapes keep every marker identical and centred on the x-height.
const SHAPES = { '•': 'dot', '◦': 'ring', '▪': 'sq' };
const mark = (m) => (SHAPES[m] ? `<span class="mk ${SHAPES[m]}"></span>` : `<span class="mk">${m}</span>`);

const fmtDates = (t, d) => (!d ? '' : t.entry.datesStyle === 'italic-paren' ? `(${d})` : d);

function entryBlocks(sec, it, t, opts, firstGap) {
  const p = (f) => ed(opts, `${sec.id}.${it.id}.${f}`);
  const edu = sec.kind === 'education' ? ' edu' : '';
  const out = [];
  const style = t.entry.style;
  const dates = it.dates ? `<span class="dates"${p('dates')}>${esc(fmtDates(t, it.dates))}</span>` : '';
  const loc = it.location ? `<span class="loc">, <span${p('location')}>${esc(it.location)}</span></span>` : '';
  const isStatement = !it.org && !it.bullets.length && !it.detail;
  const bullets = it.bullets || [];
  const itemPath = `${sec.id}.${it.id}`;

  if (isStatement) {
    // One-line achievement / POR: marker + sentence, year on the right.
    const mk = t.entry.marker || t.entry.bulletMarker;
    out.push(
      blk('st', firstGap, `${mark(mk)}<div class="row"><div class="l t"><span${p('heading')}>${esc(it.heading)}</span>${loc}</div><div class="r">${dates}</div></div>`, { path: itemPath, sec: sec.id }),
    );
    return out;
  }

  let left;
  let line2 = '';
  if (style === 'pro') {
    // **Role** · Organisation, Location           dates
    const ttl = it.heading ? `<span class="ttl"${p('heading')}>${esc(it.heading)}</span>` : '';
    const org = it.org ? `${ttl ? '<span class="muted"> · </span>' : ''}<span class="org"${p('org')}>${esc(it.org)}</span>` : '';
    left = `${ttl}${org}${loc}`;
  } else if (style === 'iitb') {
    // • **Title** | ***Org***, Location        (dates)
    const ttl = it.heading ? `<span class="ttl"${p('heading')}>${esc(it.heading)}</span>` : '';
    const org = it.org ? `${ttl ? '<span class="orgsep"> | </span>' : ''}<span class="ttl org"${p('org')}>${esc(it.org)}</span>` : '';
    left = `${ttl}${org}${loc}`;
  } else {
    // **Org**, Location                          Dates
    // Title
    if (it.org) {
      left = `<span class="org"${p('org')}>${esc(it.org)}</span>${loc}`;
      if (it.heading) line2 = `<span class="ttl"${p('heading')}>${esc(it.heading)}</span>`;
    } else {
      left = `<span class="ttl"${p('heading')}>${esc(it.heading)}</span>${loc}`;
    }
  }
  const mk = t.entry.marker ? mark(t.entry.marker) : '';
  const following = !!(line2 || it.detail || bullets.length || it.note);
  out.push(blk(`eh${edu}`, firstGap, `${mk}<div class="row"><div class="l t">${left}</div><div class="r">${dates}</div></div>`, { keep: following, path: itemPath, sec: sec.id }));
  if (line2) out.push(blk('eh l2', 'line2', `<div class="t">${line2}</div>`, { keep: !!(it.detail || bullets.length), path: itemPath, sec: sec.id }));
  if (it.detail) out.push(blk(`eh det${edu}`, 'line2', `<div class="t"${p('detail')}>${esc(it.detail)}</div>`, { keep: bullets.length > 0 || !!it.note, path: itemPath, sec: sec.id }));
  bullets.forEach((b, i) => {
    // Keep the last two bullets together, and the last bullet with a recognition line.
    const keep = (bullets.length >= 3 && i === bullets.length - 2) || (!!it.note && i === bullets.length - 1);
    out.push(blk('bul', i === 0 && !t.entry.marker ? 'line2' : 'bullet', `${mark(t.entry.bulletMarker)}<div class="t"${p(`bullets.${i}`)}>${rich(b)}</div>`, { keep, path: itemPath, sec: sec.id }));
  });
  // Recognition under a role ("Best Performer, New Business 2019"), or an education distinction.
  if (it.note) out.push(blk('eh note-line', 'line2', `<div class="t note"${p('note')}>${esc(it.note)}</div>`, { path: itemPath, sec: sec.id }));
  return out;
}

function educationTable(sec, t, opts) {
  const et = t.educationTable;
  const cols = et.cols;
  const colgroup = `<colgroup>${cols.map((c) => `<col style="width:${c.w}%">`).join('')}</colgroup>`;
  const head = `<thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>`;
  const rows = sec.items
    .map((it) => {
      const cells = cols
        .map((c) => {
          const cls = [c.align === 'center' ? 'c-center' : '', c.bold ? 'c-bold' : ''].filter(Boolean).join(' ');
          return `<td${cls ? ` class="${cls}"` : ''}><span${ed(opts, `${sec.id}.${it.id}.${c.field}`)}>${esc(it[c.field])}</span></td>`;
        })
        .join('');
      return `<tr data-item="${esc(`${sec.id}.${it.id}`)}">${cells}</tr>`;
    })
    .join('');
  const out = [blk('tbl', 'headingAfter', `<table class="edu">${colgroup}${head}<tbody>${rows}</tbody></table>`, { sec: sec.id })];
  // Coursework or honours listed as bullets under a degree follow the table.
  for (const it of sec.items) {
    (it.bullets || []).forEach((b, i) =>
      out.push(blk('bul', 'bullet', `${mark(t.entry.bulletMarker)}<div class="t"${ed(opts, `${sec.id}.${it.id}.bullets.${i}`)}>${esc(b)}</div>`, { path: `${sec.id}.${it.id}`, sec: sec.id })),
    );
  }
  return out;
}

function skillsBlocks(sec, t, opts) {
  return sec.items.map((it, i) => {
    const p = (f) => ed(opts, `${sec.id}.${it.id}.${f}`);
    const body = it.detail ? `<span${p('detail')}>${esc(it.detail)}</span>` : esc((it.bullets || []).join(', '));
    const cat = it.heading ? `<span class="cat"${p('heading')}>${esc(it.heading)}</span>: ` : '';
    const marker = t.skills === 'bullets' ? mark(t.entry.marker || t.entry.bulletMarker) : '';
    return blk(`st sk${t.skills === 'bullets' ? '' : ' nomk'}`, i === 0 ? 'headingAfter' : 'bullet', `${marker}<div class="t">${cat}${body}</div>`, { path: `${sec.id}.${it.id}`, sec: sec.id });
  });
}

function summaryBlocks(sec, t, opts) {
  const out = [];
  sec.items.forEach((it, i) => {
    const p = (f) => ed(opts, `${sec.id}.${it.id}.${f}`);
    const gap = i === 0 ? 'headingAfter' : 'entry';
    if (it.detail) out.push(blk('para', gap, `<div class="t"${p('detail')}>${rich(it.detail)}</div>`, { path: `${sec.id}.${it.id}`, sec: sec.id }));
    (it.bullets || []).forEach((b, j) =>
      out.push(blk('bul', !it.detail && j === 0 ? gap : 'bullet', `${mark(t.entry.bulletMarker)}<div class="t"${p(`bullets.${j}`)}>${esc(b)}</div>`, { path: `${sec.id}.${it.id}`, sec: sec.id })),
    );
  });
  return out;
}

function sectionBlocks(sec, t, opts, isFirst) {
  const out = [blk('sh', isFirst ? 'section' : 'section', `<span${ed(opts, `${sec.id}.title`)}>${esc(sec.title)}</span>`, { keep: true, sec: sec.id })];
  if (sec.kind === 'education' && t.educationTable) return out.concat(educationTable(sec, t, opts));
  if (sec.kind === 'skills') return out.concat(skillsBlocks(sec, t, opts));
  if (sec.kind === 'summary') return out.concat(summaryBlocks(sec, t, opts));
  sec.items.forEach((it, i) => out.push(...entryBlocks(sec, it, t, opts, i === 0 ? 'headingAfter' : 'entry')));
  return out;
}

// ---------------------------------------------------------------- engine
// Runs inside the rendered document (browser preview and headless Chromium).
// Serialized with Function.prototype.toString, so it must be self-contained.

function engine() {
  const cfg = JSON.parse(document.getElementById('layout-cfg').textContent);
  const root = document.documentElement;
  window.__layout = null;
  window.__layoutPromise = (async () => {
    try {
      await Promise.all(cfg.fontProbes.map((f) => document.fonts.load(f).catch(() => null)));
      await document.fonts.ready;
    } catch (_) { /* measure with whatever loaded */ }

    const flow = document.getElementById('flow');
    const pagesEl = document.getElementById('pages');
    const blocks = Array.from(flow.children);
    const pageH = cfg.contentHeightPx;
    const levels = cfg.levels;

    const apply = (lv) => {
      root.style.setProperty('--sp', String(levels[lv].spacing));
      root.style.setProperty('--fd', `${levels[lv].font}pt`);
      root.style.setProperty('--fx', '0pt');
      root.style.setProperty('--lx', '1');
    };
    const applyExpand = (e) => {
      root.style.setProperty('--sp', String(e.spacing));
      root.style.setProperty('--fd', '0pt');
      root.style.setProperty('--fx', `${e.font}pt`);
      root.style.setProperty('--lx', String(e.leading || 1));
    };
    const measure = () =>
      blocks.map((b) => ({
        h: b.getBoundingClientRect().height,
        pad: parseFloat(getComputedStyle(b).paddingTop) || 0,
        keep: b.dataset.keep === 'next',
      }));
    const paginate = (m) => {
      const groups = [];
      let cur = [];
      m.forEach((x, i) => {
        cur.push(i);
        if (!x.keep || i === m.length - 1) {
          groups.push(cur);
          cur = [];
        }
      });
      const pages = [[]];
      const used = [0];
      const place = (i, atTop) => {
        pages[pages.length - 1].push(i);
        used[used.length - 1] += atTop ? m[i].h - m[i].pad : m[i].h;
      };
      const newPage = () => {
        pages.push([]);
        used.push(0);
      };
      for (const g of groups) {
        const top = used[used.length - 1] === 0;
        const h = g.reduce((s, i) => s + m[i].h, 0) - (top ? m[g[0]].pad : 0);
        if (h <= pageH - used[used.length - 1] + 0.5) {
          g.forEach((i, k) => place(i, top && k === 0));
          continue;
        }
        const hAtTop = g.reduce((s, i) => s + m[i].h, 0) - m[g[0]].pad;
        if (!top && hAtTop <= pageH + 0.5) {
          newPage();
          g.forEach((i, k) => place(i, k === 0));
          continue;
        }
        // Group taller than a page: break between its blocks.
        for (const i of g) {
          const atTop = used[used.length - 1] === 0;
          const hi = atTop ? m[i].h - m[i].pad : m[i].h;
          if (!atTop && used[used.length - 1] + hi > pageH + 0.5) {
            newPage();
            place(i, true);
          } else place(i, atTop);
        }
      }
      return { pages, used };
    };
    const overflowOf = (p) => {
      if (p.pages.length <= cfg.limit) return 0;
      let extra = 0;
      for (let k = cfg.limit; k < p.used.length; k++) extra += p.used[k];
      return extra / pageH;
    };

    let level = 0;
    apply(0);
    let m = measure();
    let p = paginate(m);
    const baseOverflow = overflowOf(p);
    if (baseOverflow > 0 && baseOverflow <= cfg.maxAutoTighten) {
      for (let lv = 1; lv < levels.length; lv++) {
        if (cfg.baseSize + levels[lv].font < cfg.minSize) break;
        apply(lv);
        const m2 = measure();
        const p2 = paginate(m2);
        if (p2.pages.length <= cfg.limit) {
          level = lv;
          m = m2;
          p = p2;
          break;
        }
      }
      if (level === 0) {
        apply(0);
        m = measure();
        p = paginate(m);
      }
    }

    // Fill a short one-page resume: grow spacing and body text, never past the
    // template's maximum body size, never into a second page.
    const fillOf = (p) => p.used[p.used.length - 1] / pageH;
    const baseFill = p.pages.length === 1 ? fillOf(p) : 1;
    let expand = 0;
    if (cfg.limit === 1 && p.pages.length === 1 && level === 0 && baseFill < cfg.fillTarget) {
      const ex = cfg.expandLevels;
      for (let k = 1; k < ex.length; k++) {
        if (cfg.baseSize + ex[k].font > cfg.maxSize) break;
        applyExpand(ex[k]);
        const m2 = measure();
        const p2 = paginate(m2);
        if (p2.pages.length > 1 || fillOf(p2) > cfg.fillCeiling) break;
        expand = k;
        m = m2;
        p = p2;
        if (fillOf(p2) >= cfg.fillTarget) break;
      }
      if (expand === 0) apply(0);
      else applyExpand(ex[expand]);
    }

    // Build pages.
    const pageEls = p.pages.map((idxs, k) => {
      const pg = document.createElement('div');
      pg.className = 'page';
      pg.dataset.page = String(k + 1);
      if (k >= cfg.limit) {
        pg.classList.add('over');
        pg.dataset.label = `Page ${k + 1}: over the ${cfg.limit}-page limit`;
      }
      idxs.forEach((i, j) => {
        if (j === 0) blocks[i].classList.add('pg-first');
        pg.appendChild(blocks[i]);
      });
      pagesEl.appendChild(pg);
      return pg;
    });
    flow.remove();

    // ------------------------------------------------------------ QA
    const issues = [];
    const add = (level, code, message, el) => {
      const pathEl = el && (el.closest('[data-path]') || el.querySelector?.('[data-path]'));
      const itemEl = el && el.closest('[data-item]');
      issues.push({ level, code, message, path: pathEl?.dataset.path || itemEl?.dataset.item || '' });
    };
    const px = (mm) => mm * cfg.mmToPx;
    const textOf = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ');
    const short = (s) => (s.length > 60 ? `${s.slice(0, 57)}...` : s);

    if (p.pages.length > cfg.limit) {
      add('error', 'over-limit', `Renders to ${p.pages.length} pages; the limit is ${cfg.limit}. Overflow is about ${Math.round(overflowOf(p) * 100)}% of a page.`);
    }
    if (!document.fonts.check(`12px "${cfg.family}"`)) {
      add('error', 'font-fallback', `The ${cfg.family} font did not load; a fallback font was used, so spacing will differ from the final document.`);
    }

    let dateRight = null;
    const bulletLefts = new Map();
    pageEls.forEach((pg, k) => {
      const pr = pg.getBoundingClientRect();
      const box = { l: pr.left + px(cfg.margins.left), r: pr.right - px(cfg.margins.right), t: pr.top + px(cfg.margins.top), b: pr.bottom - px(cfg.margins.bottom) };
      const kids = Array.from(pg.children);
      if (!kids.length) add('error', 'blank-page', `Page ${k + 1} is blank.`);
      const last = kids[kids.length - 1];
      if (last && last.dataset.keep === 'next' && k < pageEls.length - 1) {
        add('error', 'orphan-heading', `"${short(textOf(last))}" is stranded at the bottom of page ${k + 1}, separated from what follows.`, last);
      }
      kids.forEach((b, j) => {
        const r = b.getBoundingClientRect();
        if (r.bottom > box.b + 0.5 && k < cfg.limit) add('error', 'outside-boundary', `Content runs past the bottom margin on page ${k + 1}: "${short(textOf(b))}"`, b);
        if (j > 0) {
          const prev = kids[j - 1].getBoundingClientRect();
          if (prev.bottom > r.top + 0.5) add('error', 'overlap', `Blocks overlap on page ${k + 1}: "${short(textOf(b))}"`, b);
        }
      });
      pg.querySelectorAll('.blk span, .blk div, .blk td').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width) return;
        if (r.right > box.r + 0.75 || r.left < box.l - 0.75) {
          add('error', 'outside-boundary', `Text extends past the side margin: "${short(textOf(el))}"`, el);
        }
      });
      pg.querySelectorAll('.row').forEach((row) => {
        const l = row.querySelector('.l');
        const rr = row.querySelector('.r');
        if (!rr || !rr.textContent.trim()) return;
        const lr = l.getBoundingClientRect();
        const dr = rr.getBoundingClientRect();
        if (lr.right > dr.left - 2) add('error', 'date-collision', `Text runs into the dates: "${short(textOf(l))}"`, row);
        if (Math.abs(dr.right - box.r) > 0.75) add('error', 'date-misaligned', `Dates are not aligned to the right margin: "${short(textOf(rr))}"`, rr);
        if (dateRight !== null && Math.abs(dr.right - pr.left - dateRight) > 0.75) add('error', 'date-misaligned', `Dates are not aligned with the others: "${short(textOf(rr))}"`, rr);
        dateRight = dr.right - pr.left;
      });
      pg.querySelectorAll('.bul > .t').forEach((t) => {
        const left = Math.round((t.getBoundingClientRect().left - pr.left) * 2) / 2;
        bulletLefts.set(left, (bulletLefts.get(left) || 0) + 1);
        const lh = parseFloat(getComputedStyle(t).lineHeight);
        const lines = Math.round(t.getBoundingClientRect().height / lh);
        if (lines >= 3) add('info', 'long-bullet', `Bullet wraps to ${lines} lines; a two-line version would read faster: "${short(textOf(t))}"`, t);
        // A lone word on the last line: the last word starts at the text's left edge.
        if (lines >= 2) {
          const walker = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
          let node = null;
          while (walker.nextNode()) if (walker.currentNode.textContent.trim()) node = walker.currentNode;
          if (node) {
            const txt = node.textContent.replace(/\s+$/, '');
            const start = txt.lastIndexOf(' ') + 1;
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, txt.length);
            const wr = range.getBoundingClientRect();
            if (start > 0 && Math.abs(wr.left - t.getBoundingClientRect().left) < 1.5) {
              add('info', 'widow-word', `A single word ("${txt.slice(start)}") sits alone on the last line of a bullet; slight rewording would tidy it.`, t);
            }
          }
        }
      });
      pg.querySelectorAll('.blk > .mk').forEach((mk) => {
        const b = mk.parentElement;
        const top = b.getBoundingClientRect().top + (parseFloat(getComputedStyle(b).paddingTop) || 0);
        if (Math.abs(mk.getBoundingClientRect().top - top) > 0.75) add('error', 'marker-misaligned', `A bullet marker is not level with its text: "${short(textOf(b))}"`, b);
      });
      pg.querySelectorAll('table.edu td, table.edu th').forEach((td) => {
        if (td.scrollWidth > td.clientWidth + 1) add('error', 'table-overflow', `Table cell text does not fit its column: "${short(textOf(td))}"`, td);
      });
    });
    if (bulletLefts.size > 1) add('error', 'indent-inconsistent', `Bullet text starts at ${bulletLefts.size} different indents.`);
    document.querySelectorAll('.blk, .blk *').forEach((el) => {
      if (getComputedStyle(el).textAlign === 'justify') add('error', 'justified', 'Justified text found; it stretches word spacing.', el);
    });
    const lastUsed = p.used[p.used.length - 1] / pageH;
    if (cfg.limit === 1 && p.pages.length === 1 && baseFill < cfg.lowContent) {
      add(
        'warn',
        'underfilled',
        `At normal size the content fills only ${Math.round(baseFill * 100)}% of the page${expand ? ` (enlarged to fill ${Math.round(lastUsed * 100)}%)` : ''}. A one-page resume should look full: ask for projects, internships, coursework, competitions, positions of responsibility, certifications or interests.`,
      );
    }
    if (cfg.limit === 2 && p.pages.length === 2 && lastUsed < 0.2) {
      add('info', 'sparse-page', `Page 2 is only about ${Math.round(lastUsed * 100)}% full. This may read better as one page.`);
    }
    if (cfg.limit === 2 && p.pages.length === 1) {
      add('info', 'sparse-page', 'Everything fits on one page. A one-page resume is likely the stronger choice here.');
    }

    window.__layout = {
      pages: p.pages.length,
      limit: cfg.limit,
      fits: p.pages.length <= cfg.limit,
      level,
      overflow: Number(overflowOf(p).toFixed(3)),
      baseOverflow: Number(baseOverflow.toFixed(3)),
      expand,
      baseFill: Number(baseFill.toFixed(3)),
      bodySize: cfg.baseSize + (expand ? cfg.expandLevels[expand].font : level ? levels[level].font : 0),
      lastPageFill: Number(lastUsed.toFixed(3)),
      issues,
    };
    root.dataset.layout = 'done';
    window.dispatchEvent(new CustomEvent('layout-done', { detail: window.__layout }));
    return window.__layout;
  })();
}

// ---------------------------------------------------------------- public

/**
 * @param {object} resume  { settings, header, sections }
 * @param {{ editable?: boolean, screen?: boolean, fontUrl?: (file:string)=>string }} opts
 */
export function renderResume(resume, opts = {}) {
  const t = getTemplate(resume.settings?.template);
  const o = { fontUrl: (f) => `/fonts/${f}`, ...opts };
  const sections = visibleSections(resume);
  const blocks = [headerBlock(resume, t, o), ...sections.flatMap((s, i) => sectionBlocks(s, t, o, i === 0))];
  const box = contentBox(t.id);
  const fam = t.font.family;
  const cfg = {
    limit: resume.settings?.pages === 2 ? 2 : 1,
    contentHeightPx: box.heightMm * MM_TO_PX,
    margins: t.marginsMm,
    mmToPx: MM_TO_PX,
    levels: DENSITY_LEVELS,
    maxAutoTighten: resume.settings?.autoTighten === false ? 0 : MAX_AUTO_TIGHTEN,
    expandLevels: EXPAND_LEVELS,
    fillTarget: FILL_TARGET,
    fillCeiling: FILL_CEILING,
    lowContent: LOW_CONTENT,
    maxSize: t.size.max,
    baseSize: t.size.base,
    minSize: t.size.min,
    family: fam,
    fontProbes: [`400 12px "${fam}"`, `700 12px "${fam}"`, `italic 400 12px "${fam}"`, `italic 700 12px "${fam}"`],
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(resume.header?.name || 'Resume')}</title>
<style>${css(t, o)}</style></head>
<body class="${t.id}${o.screen ? ' screen' : ''}">
<div id="flow">${blocks.join('\n')}</div>
<div id="pages"></div>
<script type="application/json" id="layout-cfg">${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>
<script>(${engine.toString()})();</script>
</body></html>`;
}

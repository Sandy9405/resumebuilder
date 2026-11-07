// Renders resume state to a standalone HTML document.
// Used by the browser preview AND the server-side PDF export, so the export
// matches the preview by construction.

import { getTemplate, PAGE } from './templates.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function editAttr(opts, path) {
  return opts.editable ? ` contenteditable="true" data-path="${esc(path)}"` : '';
}

function css(t) {
  const m = t.marginsMm;
  const heading = {
    band: `background:#e4e4e4;padding:1px 4px;border-top:1px solid #999;border-bottom:1px solid #999;`,
    'rule-top': `border-top:2px solid #111;padding-top:2px;letter-spacing:.04em;`,
    'rule-under': `border-bottom:0.75px solid #111;padding-bottom:1px;letter-spacing:.06em;`,
  }[t.headingStyle];
  return `
  @page { size: ${PAGE.widthMm}mm ${PAGE.heightMm}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; }
  body { font-family: ${t.fontFamily}; font-size: ${t.baseSizePt}pt; line-height: ${t.lineHeight}; }
  .sheet { width: ${PAGE.widthMm - m.left - m.right}mm; }
  .screen .sheet { margin: 0 auto; }
  header.rh { text-align: ${t.nameAlign}; margin-bottom: 4pt; }
  header.rh .name { font-size: ${t.nameSizePt}pt; font-weight: bold; ${t.nameAlign === 'center' ? 'text-transform: uppercase; letter-spacing: .05em;' : ''} }
  header.rh .tagline { font-style: italic; }
  header.rh .contact { font-size: ${(t.baseSizePt - 0.5).toFixed(1)}pt; }
  header.rh .contact span + span::before { content: " | "; color: #555; }
  section.rs { margin-top: 5pt; }
  section.rs > h2 { font-size: ${t.headingSizePt}pt; font-weight: bold; text-transform: uppercase; margin: 0 0 3pt 0; ${heading} }
  .item { margin-bottom: 3pt; break-inside: avoid; }
  .row { display: flex; justify-content: space-between; gap: 8pt; }
  .row .l { flex: 1 1 auto; }
  .row .r { flex: 0 0 auto; text-align: right; white-space: nowrap; }
  .org { font-weight: bold; }
  .heading { font-style: italic; }
  .detail { color: #222; }
  ul { margin: 1pt 0 0 0; padding-left: 13pt; }
  li { margin: 0 0 0.5pt 0; }
  table.edu { width: 100%; border-collapse: collapse; font-size: ${t.baseSizePt}pt; }
  table.edu th, table.edu td { border: 0.5px solid #888; padding: 1px 4px; text-align: left; vertical-align: top; }
  table.edu th { background: #f0f0f0; }
  .skills .item { margin-bottom: 1pt; }
  .skills .cat { font-weight: bold; }
  [contenteditable]:hover { outline: 1px dashed #4a7bd0; }
  [contenteditable]:focus { outline: 2px solid #4a7bd0; background: #f3f7ff; }
  `;
}

function renderHeader(h, opts) {
  const contact = [h.email, h.phone, h.location, ...(h.links || [])].filter(Boolean);
  return `<header class="rh">
    <div class="name"${editAttr(opts, 'header.name')}>${esc(h.name)}</div>
    ${h.tagline ? `<div class="tagline"${editAttr(opts, 'header.tagline')}>${esc(h.tagline)}</div>` : ''}
    <div class="contact">${contact.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
  </header>`;
}

function bullets(sec, item, opts) {
  if (!item.bullets?.length) return '';
  return `<ul>${item.bullets
    .map((b, i) => `<li${editAttr(opts, `${sec.id}.${item.id}.bullets.${i}`)}>${esc(b)}</li>`)
    .join('')}</ul>`;
}

function renderItem(sec, item, opts) {
  const p = (f) => editAttr(opts, `${sec.id}.${item.id}.${f}`);
  const line1 = item.org || item.heading;
  const line1Field = item.org ? 'org' : 'heading';
  const showLine2 = item.org && (item.heading || item.dates);
  return `<div class="item">
    <div class="row"><div class="l"><span class="org"${p(line1Field)}>${esc(line1)}</span>${
      item.location ? `, <span${p('location')}>${esc(item.location)}</span>` : ''
    }</div><div class="r"${showLine2 ? '' : p('dates')}>${showLine2 ? '' : esc(item.dates)}</div></div>
    ${
      showLine2
        ? `<div class="row"><div class="l heading"${p('heading')}>${esc(item.heading)}</div><div class="r"${p('dates')}>${esc(item.dates)}</div></div>`
        : ''
    }
    ${item.detail ? `<div class="detail"${p('detail')}>${esc(item.detail)}</div>` : ''}
    ${bullets(sec, item, opts)}
  </div>`;
}

function renderEducationTable(sec, opts) {
  const rows = sec.items
    .map((it) => {
      const p = (f) => editAttr(opts, `${sec.id}.${it.id}.${f}`);
      return `<tr><td${p('heading')}>${esc(it.heading)}</td><td${p('org')}>${esc(it.org)}</td><td${p('dates')}>${esc(it.dates)}</td><td${p('detail')}>${esc(it.detail)}</td></tr>${
        it.bullets?.length ? `<tr><td colspan="4">${bullets(sec, it, opts)}</td></tr>` : ''
      }`;
    })
    .join('');
  return `<table class="edu"><thead><tr><th>Degree / Exam</th><th>Institute</th><th>Year</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderSkills(sec, opts) {
  return sec.items
    .map((it) => {
      const p = (f) => editAttr(opts, `${sec.id}.${it.id}.${f}`);
      const body = it.detail || (it.bullets || []).join(', ');
      return `<div class="item">${it.heading ? `<span class="cat"${p('heading')}>${esc(it.heading)}:</span> ` : ''}<span${
        it.detail ? p('detail') : ''
      }>${esc(body)}</span></div>`;
    })
    .join('');
}

function renderSection(sec, t, opts) {
  let body;
  if (sec.kind === 'education' && t.educationAsTable) body = renderEducationTable(sec, opts);
  else if (sec.kind === 'skills') body = renderSkills(sec, opts);
  else body = sec.items.map((it) => renderItem(sec, it, opts)).join('');
  return `<section class="rs ${esc(sec.kind)}" data-section="${esc(sec.id)}"><h2${editAttr(
    opts,
    `${sec.id}.title`,
  )}>${esc(sec.title)}</h2>${body}</section>`;
}

/**
 * @param {object} resume  resume state ({ settings, header, sections })
 * @param {{ editable?: boolean, screen?: boolean }} opts
 */
export function renderResume(resume, opts = {}) {
  const t = getTemplate(resume.settings?.template);
  const sections = (resume.sections || []).filter((s) => s.items?.length);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(resume.header?.name || 'Resume')}</title>
<style>${css(t)}</style></head>
<body class="${opts.screen ? 'screen' : ''}"><div class="sheet" id="sheet">
${renderHeader(resume.header || {}, opts)}
${sections.map((s) => renderSection(s, t, opts)).join('\n')}
</div></body></html>`;
}

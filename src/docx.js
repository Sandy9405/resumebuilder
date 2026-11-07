// Editable DOCX export from the same resume state and template spec as the
// preview. Word paginates with its own engine, so the DOCX carries the same
// keep-together rules (keepNext, keepLines, cantSplit) rather than fixed page breaks.
//
// Alignment uses real structure, never spaces or runs of tabs:
//   - organisation/dates lines are a borderless two-column table, so a long
//     organisation name wraps inside its cell and the dates stay on the right edge;
//   - bullets use numbering definitions with hanging indents.

import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { getTemplate } from '../shared/templates.js';

const TW_PER_MM = 56.6929;
const tw = (mm) => Math.round(mm * TW_PER_MM);
const hp = (pt) => Math.round(pt * 2); // half-points
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };

export async function renderDocx(resume) {
  const t = getTemplate(resume.settings.template);
  const m = t.marginsMm;
  const contentTw = tw(t.page.widthMm - m.left - m.right);
  const sp = (pt) => Math.round(pt * 20);
  const font = t.font.docx;
  const base = hp(t.size.base);
  const line = Math.round(240 * t.lineHeight);
  const run = (text, o = {}) => new TextRun({ text: String(text ?? ''), font, size: base, ...o });
  const para = (children, o = {}) => new Paragraph({ ...o, children, spacing: { before: 0, after: 0, line, ...(o.spacing || {}) } });

  const ind = t.indentMm;
  // Dates never wrap: non-breaking spaces, and a word joiner around dashes.
  const glue = (d) => d.replace(/ /g, '\u00a0').replace(/([–—-])/g, '\u2060$1\u2060');
  const datesRun = (d) =>
    !d
      ? []
      : [
          run(glue(t.entry.datesStyle === 'italic-paren' ? `(${d})` : d), {
            bold: t.entry.datesStyle === 'bold',
            italics: t.entry.datesStyle === 'italic-paren',
          }),
        ];

  // Two-column row: left content wraps, dates right-aligned on the content edge.
  // Dates column sized for the longest date in this resume, assuming a wide
  // fallback font (0.62em per character) so it holds even without Garamond.
  const longest = Math.max(
    4,
    ...(resume.sections || []).flatMap((sec) => (sec.items || []).map((i) => (i.dates || '').length + (t.entry.datesStyle === 'italic-paren' ? 2 : 0))),
  );
  const DATES_W = Math.min(tw(60), Math.max(tw(18), Math.round(longest * t.size.base * 0.62 * 20) + tw(2)));
  const splitRow = (leftRuns, d, { before = 0, keepNext = true, numbering = null } = {}) =>
    new Table({
      width: { size: contentTw, type: WidthType.DXA },
      columnWidths: [contentTw - DATES_W, DATES_W],
      layout: TableLayoutType.FIXED,
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: contentTw - DATES_W, type: WidthType.DXA },
              margins: { top: 0, bottom: 0, left: 0, right: tw(2) },
              borders: NO_BORDERS,
              children: [para(leftRuns, { keepNext, keepLines: true, spacing: { before }, ...(numbering ? { numbering } : {}) })],
            }),
            new TableCell({
              width: { size: DATES_W, type: WidthType.DXA },
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              borders: NO_BORDERS,
              verticalAlign: VerticalAlign.TOP,
              children: [para(datesRun(d), { alignment: AlignmentType.RIGHT, keepNext, spacing: { before } })],
            }),
          ],
        }),
      ],
    });

  const children = [];
  const h = resume.header || {};
  const contact = [h.email, h.phone, h.location, ...(h.links || [])].filter(Boolean);
  const sep = t.header.layout === 'left-rule' ? ' • ' : ' | ';
  const nameRun = run(h.name || '', {
    bold: true,
    size: hp(t.size.name),
    smallCaps: t.header.nameCase === 'small-caps',
    characterSpacing: Math.round(t.header.nameLetterSpacingPt * 20),
  });
  const contactPara = (align, border) =>
    para([run(contact.join(sep), { size: hp(t.size.contact) })], {
      alignment: align,
      ...(border ? { border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '111111', space: 2 } } } : {}),
    });
  const details = (h.details || []).filter(Boolean);

  if (t.header.layout === 'split') {
    const leftW = Math.round(contentTw * 0.68);
    children.push(
      new Table({
        width: { size: contentTw, type: WidthType.DXA },
        columnWidths: [leftW, contentTw - leftW],
        layout: TableLayoutType.FIXED,
        borders: NO_BORDERS,
        rows: [
          new TableRow({
            children: [
              new TableCell({ borders: NO_BORDERS, margins: { left: 0, right: 0 }, children: [para([nameRun]), ...(h.tagline ? [para([run(h.tagline, { italics: true })])] : []), ...(contact.length ? [contactPara(AlignmentType.LEFT)] : [])] }),
              new TableCell({ borders: NO_BORDERS, margins: { left: 0, right: 0 }, children: details.length ? details.map((d) => para([run(d, { size: hp(t.size.contact) })], { alignment: AlignmentType.RIGHT })) : [para([])] }),
            ],
          }),
        ],
      }),
    );
  } else {
    const align = t.header.layout === 'right-name' ? AlignmentType.RIGHT : AlignmentType.LEFT;
    children.push(para([nameRun], { alignment: align }));
    if (h.tagline) children.push(para([run(h.tagline, { italics: true })], { alignment: align }));
    for (const d of details) children.push(para([run(d, { size: hp(t.size.contact) })], { alignment: align }));
    if (contact.length) children.push(contactPara(align, t.header.rule === 'solid'));
  }

  const hs = t.heading;
  const headingPara = (title) => {
    const r = run(hs.case === 'upper' ? title.toUpperCase() : title, {
      bold: true,
      size: hp(t.size.heading),
      smallCaps: hs.case === 'small-caps',
      characterSpacing: Math.round(hs.letterSpacingPt * 20),
    });
    const o = {
      keepNext: true,
      keepLines: true,
      spacing: { before: sp(t.spacingPt.section) },
      alignment: hs.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
    };
    if (hs.style === 'band') {
      return para([r], { ...o, shading: { type: ShadingType.CLEAR, fill: hs.fill.replace('#', ''), color: 'auto' }, indent: { left: 0 } });
    }
    return para([r], {
      ...o,
      border: {
        top: { style: BorderStyle.DOTTED, size: 4, color: '222222', space: 1 },
        bottom: { style: BorderStyle.DOTTED, size: 4, color: '222222', space: 1 },
      },
    });
  };

  const bulletPara = (text, before, keepNext = false) =>
    para([run(text)], { numbering: { reference: 'bul', level: 0 }, keepLines: true, keepNext, spacing: { before } });
  const statementNumbering = t.entry.marker ? { reference: 'entry', level: 0 } : { reference: 'bul', level: 0 };

  for (const sec of resume.sections || []) {
    if (sec.hidden) continue;
    const items = (sec.items || []).filter((i) => !i.hidden);
    if (!items.length) continue;
    children.push(headingPara(sec.title));

    if (sec.kind === 'education' && t.educationTable) {
      const et = t.educationTable;
      const widths = et.cols.map((c) => Math.round((contentTw * c.w) / 100));
      const rule = { style: BorderStyle.SINGLE, size: 6, color: '111111' };
      const grid = { style: BorderStyle.SINGLE, size: 4, color: '333333' };
      const cellBorders = (isHead, isLast) =>
        et.style === 'grid'
          ? { top: grid, bottom: grid, left: grid, right: grid }
          : { top: isHead ? rule : NONE, bottom: isHead || isLast ? rule : NONE, left: NONE, right: NONE };
      const cell = (text, c, i, { head = false, last = false } = {}) =>
        new TableCell({
          width: { size: widths[i], type: WidthType.DXA },
          borders: cellBorders(head, last),
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 30, bottom: 30, left: 70, right: 70 },
          shading: head && et.headerFill ? { type: ShadingType.CLEAR, fill: et.headerFill.replace('#', ''), color: 'auto' } : undefined,
          children: [
            para([run(text, { bold: head || c.bold, size: hp(t.size.table) })], {
              alignment: head && et.style === 'grid' ? AlignmentType.CENTER : c.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
              spacing: { line: 240 },
            }),
          ],
        });
      children.push(
        new Table({
          width: { size: contentTw, type: WidthType.DXA },
          columnWidths: widths,
          layout: TableLayoutType.FIXED,
          rows: [
            new TableRow({ tableHeader: true, cantSplit: true, children: et.cols.map((c, i) => cell(c.label, c, i, { head: true })) }),
            ...items.map((it, r) => new TableRow({ cantSplit: true, children: et.cols.map((c, i) => cell(it[c.field], c, i, { last: r === items.length - 1 })) })),
          ],
        }),
      );
      for (const it of items) for (const b of it.bullets || []) children.push(bulletPara(b, sp(t.spacingPt.bullet)));
      continue;
    }

    if (sec.kind === 'skills') {
      items.forEach((it, i) => {
        const body = it.detail || (it.bullets || []).join(', ');
        const runs = [...(it.heading ? [run(`${it.heading}: `, { bold: true })] : []), run(body)];
        const before = sp(i === 0 ? t.spacingPt.headingAfter : t.spacingPt.bullet);
        children.push(t.skills === 'bullets' ? para(runs, { numbering: statementNumbering, keepLines: true, spacing: { before } }) : para(runs, { spacing: { before } }));
      });
      continue;
    }

    if (sec.kind === 'summary') {
      items.forEach((it, i) => {
        if (it.detail) children.push(para([run(it.detail)], { spacing: { before: sp(i === 0 ? t.spacingPt.headingAfter : t.spacingPt.entry) } }));
        for (const b of it.bullets || []) children.push(bulletPara(b, sp(t.spacingPt.bullet)));
      });
      continue;
    }

    items.forEach((it, idx) => {
      const before = sp(idx === 0 ? t.spacingPt.headingAfter : t.spacingPt.entry);
      const bullets = it.bullets || [];
      const statement = !it.org && !bullets.length && !it.detail;
      const loc = it.location ? [run(`, ${it.location}`)] : [];
      if (statement) {
        children.push(splitRow([run(it.heading), ...loc], it.dates, { before, keepNext: false, numbering: statementNumbering }));
        return;
      }
      let left;
      let line2 = null;
      if (t.entry.style === 'iitb') {
        left = [
          ...(it.heading ? [run(it.heading, { bold: true })] : []),
          ...(it.org ? [run(it.heading ? ' | ' : ''), run(it.org, { bold: true, italics: true })] : []),
          ...loc,
        ];
      } else if (it.org) {
        left = [run(t.entry.orgCase === 'upper' ? it.org.toUpperCase() : it.org, { bold: true, underline: t.entry.style === 'iima' ? {} : undefined }), ...loc];
        if (it.heading) line2 = run(it.heading, { bold: true, italics: t.entry.style === 'hbs' });
      } else {
        left = [run(it.heading, { bold: true, italics: t.entry.style === 'hbs' }), ...loc];
      }
      children.push(splitRow(left, it.dates, { before, keepNext: true, numbering: t.entry.marker ? { reference: 'entry', level: 0 } : null }));
      const textIndent = t.entry.marker ? { left: tw(ind.entryText) } : undefined;
      if (line2) children.push(para([line2], { keepNext: true, keepLines: true, spacing: { before: sp(t.spacingPt.line2) }, indent: textIndent }));
      if (it.detail) children.push(para([run(it.detail, { italics: t.id === 'iitb' })], { keepNext: bullets.length > 0, keepLines: true, spacing: { before: sp(t.spacingPt.line2) }, indent: textIndent }));
      bullets.forEach((b, i) => children.push(bulletPara(b, sp(i === 0 ? t.spacingPt.line2 : t.spacingPt.bullet), bullets.length >= 3 && i === bullets.length - 2)));
    });
  }

  const level = (text, markerMm, textMm) => ({
    level: 0,
    format: LevelFormat.BULLET,
    text,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: tw(textMm), hanging: tw(textMm - markerMm) } }, run: { font } },
  });

  const doc = new Document({
    creator: resume.header?.name || 'Resume',
    title: `${resume.header?.name || 'Resume'} – Resume`,
    styles: { default: { document: { run: { font, size: base }, paragraph: { spacing: { line } } } } },
    numbering: {
      config: [
        { reference: 'bul', levels: [level(t.entry.bulletMarker, ind.bulletMarker, ind.bulletText)] },
        { reference: 'entry', levels: [level(t.entry.marker || t.entry.bulletMarker, ind.entryMarker, ind.entryText || ind.bulletText)] },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: tw(t.page.widthMm), height: tw(t.page.heightMm) },
            margin: { top: tw(m.top), right: tw(m.right), bottom: tw(m.bottom), left: tw(m.left), header: 0, footer: 0 },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

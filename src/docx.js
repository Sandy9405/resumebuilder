// Editable DOCX export built from the same resume state and template spec as
// the preview. Word's layout engine is not Chromium's, so line breaks can differ
// slightly from the PDF; fonts, sizes, margins, order and content are the same.

import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from 'docx';
import { getTemplate, PAGE } from '../shared/templates.js';

const MM = 56.6929; // twips per mm
const hp = (pt) => Math.round(pt * 2); // half-points

export async function renderDocx(resume) {
  const t = getTemplate(resume.settings.template);
  const m = t.marginsMm;
  const contentWidth = Math.round((PAGE.widthMm - m.left - m.right) * MM);
  const size = hp(t.baseSizePt);
  const run = (text, o = {}) => new TextRun({ text, font: t.docxFont, size, ...o });
  const tight = { spacing: { before: 0, after: 0, line: Math.round(240 * t.lineHeight) } };

  const children = [];
  const h = resume.header || {};
  const centered = t.nameAlign === 'center';
  children.push(
    new Paragraph({
      alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT,
      ...tight,
      children: [run(centered ? (h.name || '').toUpperCase() : h.name || '', { bold: true, size: hp(t.nameSizePt) })],
    }),
  );
  if (h.tagline) {
    children.push(new Paragraph({ alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT, ...tight, children: [run(h.tagline, { italics: true })] }));
  }
  const contact = [h.email, h.phone, h.location, ...(h.links || [])].filter(Boolean).join(' | ');
  if (contact) {
    children.push(
      new Paragraph({
        alignment: centered ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { before: 0, after: 80 },
        children: [run(contact, { size: hp(t.baseSizePt - 0.5) })],
      }),
    );
  }

  const headingPara = (title) => {
    const base = {
      keepNext: true,
      spacing: { before: 100, after: 50 },
      children: [run(title.toUpperCase(), { bold: true, size: hp(t.headingSizePt) })],
    };
    if (t.headingStyle === 'band') {
      return new Paragraph({
        ...base,
        shading: { type: ShadingType.CLEAR, fill: 'E4E4E4', color: 'auto' },
        border: {
          top: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
        },
      });
    }
    if (t.headingStyle === 'rule-top') {
      return new Paragraph({ ...base, border: { top: { style: BorderStyle.SINGLE, size: 12, color: '111111', space: 2 } } });
    }
    return new Paragraph({ ...base, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '111111', space: 1 } } });
  };

  const rightTab = [{ type: TabStopType.RIGHT, position: contentWidth }];
  const bulletParas = (bullets) =>
    (bullets || []).map(
      (b) => new Paragraph({ bullet: { level: 0 }, ...tight, children: [run(b)] }),
    );

  for (const sec of resume.sections || []) {
    if (!sec.items?.length) continue;
    children.push(headingPara(sec.title));

    if (sec.kind === 'education' && t.educationAsTable) {
      const cell = (text, bold = false) =>
        new TableCell({ children: [new Paragraph({ ...tight, children: [run(text || '', { bold })] })] });
      const rows = [
        new TableRow({ tableHeader: true, children: ['Degree / Exam', 'Institute', 'Year', 'Result'].map((x) => cell(x, true)) }),
        ...sec.items.map((it) => new TableRow({ children: [cell(it.heading), cell(it.org), cell(it.dates), cell(it.detail)] })),
      ];
      children.push(new Table({ width: { size: contentWidth, type: WidthType.DXA }, rows }));
      for (const it of sec.items) children.push(...bulletParas(it.bullets));
      continue;
    }

    if (sec.kind === 'skills') {
      for (const it of sec.items) {
        const body = it.detail || (it.bullets || []).join(', ');
        children.push(
          new Paragraph({ ...tight, children: [...(it.heading ? [run(`${it.heading}: `, { bold: true })] : []), run(body)] }),
        );
      }
      continue;
    }

    for (const it of sec.items) {
      const line1 = it.org || it.heading;
      const showLine2 = it.org && (it.heading || it.dates);
      children.push(
        new Paragraph({
          ...tight,
          keepNext: true,
          spacing: { ...tight.spacing, before: 40 },
          tabStops: rightTab,
          children: [
            run(line1, { bold: true }),
            ...(it.location ? [run(`, ${it.location}`)] : []),
            ...(!showLine2 && it.dates ? [run(`\t${it.dates}`)] : []),
          ],
        }),
      );
      if (showLine2) {
        children.push(
          new Paragraph({
            ...tight,
            keepNext: true,
            tabStops: rightTab,
            children: [run(it.heading || '', { italics: true }), ...(it.dates ? [run(`\t${it.dates}`)] : [])],
          }),
        );
      }
      if (it.detail) children.push(new Paragraph({ ...tight, children: [run(it.detail)] }));
      children.push(...bulletParas(it.bullets));
    }
  }

  const doc = new Document({
    creator: resume.header?.name || 'Resume',
    title: `${resume.header?.name || 'Resume'} – Resume`,
    styles: { default: { document: { run: { font: t.docxFont, size } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: Math.round(PAGE.widthMm * MM), height: Math.round(PAGE.heightMm * MM) },
            margin: { top: Math.round(m.top * MM), right: Math.round(m.right * MM), bottom: Math.round(m.bottom * MM), left: Math.round(m.left * MM) },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

// Template design specifications, derived from the reference resumes:
//
//   IITB  <- fndpyhthjqpm.pdf (pdfTeX, URW Palladio, A4)
//   IIMA  <- ankit-saraf.pdf (Word 2016, Garamond + Constantia, A4)
//   HBS   <- 02/03 Chronological Layout templates and 07 VP sample (Word, Garamond, US Letter)
//
// What was measured is noted inline. Where a reference has a defect the product
// brief forbids, the spec deliberately departs from it (marked DEPARTS):
//   - IIMA sample and HBS samples justify body text, which stretches word spacing.
//     All templates here are left-aligned with text-wrap: pretty.
//   - HBS Template 2 right-aligns dates on a tab stop at 7.06in, past the 6.9in
//     text width, so dates overhang the right margin; one line pads with 11 tabs.
//     Here dates align exactly to the content edge.
//   - IIMA sample puts contact details in a running footer. Here they sit in the header.
//   - Institute logos are not reproduced (trademarks).
//
// The renderer (render.js), the in-page layout engine, the DOCX exporter and
// the QA checks all read this file. Units: pt for type and spacing, mm for page geometry.

export const FONT_FACES = [
  // [family, file, weight, style]
  ['EB Garamond', 'eb-garamond-latin-400-normal.woff2', 400, 'normal'],
  ['EB Garamond', 'eb-garamond-latin-400-italic.woff2', 400, 'italic'],
  ['EB Garamond', 'eb-garamond-latin-600-normal.woff2', 600, 'normal'],
  ['EB Garamond', 'eb-garamond-latin-600-italic.woff2', 600, 'italic'],
  ['EB Garamond', 'eb-garamond-latin-700-normal.woff2', 700, 'normal'],
  ['EB Garamond', 'eb-garamond-latin-700-italic.woff2', 700, 'italic'],
  ['TeX Gyre Pagella', 'tex-gyre-pagella-400.woff2', 400, 'normal'],
  ['TeX Gyre Pagella', 'tex-gyre-pagella-400italic.woff2', 400, 'italic'],
  ['TeX Gyre Pagella', 'tex-gyre-pagella-700.woff2', 700, 'normal'],
  ['TeX Gyre Pagella', 'tex-gyre-pagella-700italic.woff2', 700, 'italic'],
];

const A4 = { widthMm: 210, heightMm: 297, name: 'A4' };
const LETTER = { widthMm: 215.9, heightMm: 279.4, name: 'Letter' };

export const TEMPLATES = {
  iitb: {
    id: 'iitb',
    label: 'IIT Bombay (IITB)',
    blurb: 'Compact academic layout: education table, projects, internships, skills, positions of responsibility.',
    reference: 'fndpyhthjqpm.pdf',
    page: A4,
    // Measured text block x 28.2–570.1pt => ~10mm left, ~9mm right. Top offset in the
    // sample comes from the logo; without a logo 12mm keeps the same visual weight.
    marginsMm: { top: 12, right: 10, bottom: 12, left: 10 },
    font: { family: 'TeX Gyre Pagella', fallback: '"Palatino Linotype", Palatino, "URW Palladio L", "Book Antiqua", serif', docx: 'Palatino Linotype' },
    headingFont: null,
    // Measured: body word height 9.9pt, baseline pitch 12.0pt => 10pt / 1.2.
    size: { base: 10, min: 9.5, name: 14.4, heading: 9, contact: 9.5, table: 10 },
    lineHeight: 1.2,
    header: { layout: 'split', nameCase: 'normal', nameLetterSpacingPt: 0, rule: 'none' },
    // Grey full-width band, small bold caps (measured 8.7pt cap height ~ 9pt bold).
    heading: { style: 'band', fill: '#d4d4d4', align: 'left', case: 'upper', letterSpacingPt: 0.2, padPt: [1.5, 3] },
    educationTable: {
      style: 'rules', // booktabs: rule above header, below header, below last row; no verticals
      cols: [
        { label: 'Examination', field: 'heading', w: 26 },
        { label: 'Institute', field: 'org', w: 26 },
        { label: 'University / Board', field: 'note', w: 20 },
        { label: 'Year', field: 'dates', w: 13 },
        { label: 'CPI / %', field: 'detail', w: 15 },
      ],
      headerFill: null,
    },
    entry: {
      // "• Position held | Name of company ............ (July'17-Apr'18)"
      style: 'iitb',
      marker: '•',
      bulletMarker: '◦',
      datesStyle: 'italic-paren',
      orgCase: 'normal',
    },
    // Measured: entry bullet at +3.8mm, entry text +7.7mm, sub-bullets +12mm.
    indentMm: { entryMarker: 3.8, entryText: 7.7, bulletMarker: 11.8, bulletText: 15 },
    spacingPt: { header: 6, section: 6, headingAfter: 3, entry: 2.5, line2: 0, bullet: 0.5 },
    skills: 'bullets',
    sectionOrder: ['summary', 'education', 'experience', 'projects', 'skills', 'leadership', 'achievements', 'certifications', 'extracurricular', 'other'],
  },

  iima: {
    id: 'iima',
    label: 'IIM Ahmedabad (IIMA)',
    blurb: 'Achievement-led: education grid with distinctions, then experience, leadership and achievements.',
    reference: 'ankit-saraf.pdf',
    page: A4,
    // Measured text block x 27.0–567.3pt => ~9.5mm each side.
    marginsMm: { top: 9, right: 9.5, bottom: 10, left: 9.5 },
    font: { family: 'EB Garamond', fallback: 'Garamond, "Times New Roman", serif', docx: 'Garamond' },
    // Sample uses Constantia (proprietary) for name and headings; EB Garamond bold stands in.
    headingFont: null,
    // Measured: body word height 11.9pt => Garamond 11pt. 10.5pt keeps the same
    // density with left-aligned text (the sample's justification hid extra width).
    size: { base: 10.5, min: 10, name: 18, heading: 11.5, contact: 10, table: 10 },
    lineHeight: 1.18,
    header: { layout: 'right-name', nameCase: 'small-caps', nameLetterSpacingPt: 0.3, rule: 'none' },
    heading: { style: 'band', fill: '#a6a6a6', align: 'left', case: 'upper', letterSpacingPt: 0.2, padPt: [0.5, 6] },
    educationTable: {
      style: 'grid', // full borders, grey header row
      cols: [
        { label: 'College / School', field: 'org', w: 22, bold: true },
        { label: 'Degree / Class', field: 'heading', w: 26 },
        { label: 'GPA (%)', field: 'detail', w: 12, align: 'center' },
        { label: 'Year', field: 'dates', w: 14, align: 'center' },
        { label: 'Distinctions', field: 'note', w: 26, align: 'center', bold: true },
      ],
      headerFill: '#bfbfbf',
    },
    entry: {
      // "Azim Premji University (APU), Bengaluru ........ May-August 2020" (bold, underlined org)
      // "Project Manager" (bold)
      style: 'iima',
      marker: '',
      bulletMarker: '▪',
      datesStyle: 'bold',
      orgCase: 'normal',
    },
    indentMm: { entryMarker: 0, entryText: 0, bulletMarker: 0.8, bulletText: 4.6 },
    spacingPt: { header: 4, section: 5, headingAfter: 3, entry: 4, line2: 1.5, bullet: 2.5 },
    skills: 'bullets',
    sectionOrder: ['summary', 'education', 'experience', 'leadership', 'projects', 'achievements', 'certifications', 'skills', 'extracurricular', 'other'],
  },

  hbs: {
    id: 'hbs',
    label: 'Harvard Business School (HBS)',
    blurb: 'Clean chronological layout: career progression, contributions and results, then education.',
    reference: '02/03 Chronological Layout templates, 07 VP sample',
    page: LETTER,
    // Measured: margins 0.7–0.8in L/R, 0.65–1.0in top, 0.5–0.7in bottom.
    marginsMm: { top: 16.5, right: 19, bottom: 15, left: 19 },
    font: { family: 'EB Garamond', fallback: 'Garamond, "Times New Roman", serif', docx: 'Garamond' },
    headingFont: null,
    // Measured: body 10pt, name 16pt with 2.5pt letter spacing, section titles 14pt small caps.
    // Body set at 10.5pt: EB Garamond at 10pt reads small on screen and in print.
    size: { base: 10.5, min: 10, name: 16, heading: 12.5, contact: 10, table: 10.5 },
    lineHeight: 1.18,
    header: { layout: 'left-rule', nameCase: 'small-caps', nameLetterSpacingPt: 2.5, rule: 'solid' },
    // Centered small caps between dotted rules (measured w:pBdr top/bottom dotted sz=4).
    heading: { style: 'dotted-rules', fill: null, align: 'center', case: 'small-caps', letterSpacingPt: 2, padPt: [1, 0] },
    educationTable: null, // education uses the standard entry layout
    entry: {
      // "ALLIED HOSPITALS, Leominster, DE ............ 1994 - Present" (org bold caps)
      // "Corporate Vice President of Facilities" (bold italic)
      style: 'hbs',
      marker: '',
      bulletMarker: '•',
      datesStyle: 'bold',
      orgCase: 'upper',
    },
    // Measured numbering: w:ind left=360 hanging=360 => text at 0.25in, marker at 0.
    indentMm: { entryMarker: 0, entryText: 0, bulletMarker: 0, bulletText: 6.35 },
    spacingPt: { header: 6, section: 8, headingAfter: 5, entry: 5, line2: 0.5, bullet: 1 },
    skills: 'lines',
    sectionOrder: ['summary', 'experience', 'leadership', 'projects', 'education', 'achievements', 'skills', 'certifications', 'extracurricular', 'other'],
  },
};

export const SECTION_KINDS = [
  'summary', 'education', 'experience', 'projects', 'skills', 'leadership',
  'achievements', 'certifications', 'extracurricular', 'other',
];

// Controlled adjustment ladder used only when overflow is small. Spacing is
// compressed first; type shrinks by at most 0.5pt and never below size.min.
export const DENSITY_LEVELS = [
  { spacing: 1, font: 0 },
  { spacing: 0.85, font: 0 },
  { spacing: 0.7, font: 0 },
  { spacing: 0.7, font: -0.25 },
  { spacing: 0.6, font: -0.5 },
];
// Overflow larger than this share of one page is a content problem, not a spacing one.
export const MAX_AUTO_TIGHTEN = 0.06;

export const MM_TO_PX = 96 / 25.4;
export const PT_TO_PX = 96 / 72;

export function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES.hbs;
}

export function contentBox(templateId) {
  const t = getTemplate(templateId);
  const m = t.marginsMm;
  return {
    widthMm: t.page.widthMm - m.left - m.right,
    heightMm: t.page.heightMm - m.top - m.bottom,
  };
}

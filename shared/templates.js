// Template design specifications.
//
// IMPORTANT: These are working placeholders, not official institutional templates.
// The product requirement is to follow the *approved* specification for each format.
// When the approved specs arrive, change the values here. The renderer (render.js),
// the DOCX exporter (src/docx.js) and the page-fit check all read from this file,
// so a change here moves preview, PDF and DOCX together.
//
// Units: font sizes in pt, margins in mm.

export const PAGE = { widthMm: 210, heightMm: 297 }; // A4

export const TEMPLATES = {
  iitb: {
    id: 'iitb',
    label: 'IIT Bombay (IITB)',
    blurb: 'Compact and highly structured. Academics, internships and projects up front.',
    specStatus: 'placeholder',
    fontFamily: '"Times New Roman", "Liberation Serif", Times, serif',
    docxFont: 'Times New Roman',
    baseSizePt: 10,
    nameSizePt: 16,
    headingSizePt: 10.5,
    lineHeight: 1.22,
    marginsMm: { top: 10, right: 12, bottom: 10, left: 12 },
    headingStyle: 'band', // grey shaded full-width band
    nameAlign: 'left',
    educationAsTable: true,
    sectionOrder: [
      'summary', 'education', 'experience', 'projects', 'skills',
      'leadership', 'achievements', 'certifications', 'extracurricular', 'other',
    ],
  },
  iima: {
    id: 'iima',
    label: 'IIM Ahmedabad (IIMA)',
    blurb: 'Achievement-led. Professional experience, leadership and business impact.',
    specStatus: 'placeholder',
    fontFamily: 'Georgia, "DejaVu Serif", serif',
    docxFont: 'Georgia',
    baseSizePt: 9.5,
    nameSizePt: 15,
    headingSizePt: 10,
    lineHeight: 1.25,
    marginsMm: { top: 10, right: 11, bottom: 10, left: 11 },
    headingStyle: 'rule-top', // thick rule above uppercase heading
    nameAlign: 'left',
    educationAsTable: true,
    sectionOrder: [
      'summary', 'experience', 'leadership', 'education', 'projects',
      'achievements', 'skills', 'certifications', 'extracurricular', 'other',
    ],
  },
  hbs: {
    id: 'hbs',
    label: 'Harvard Business School (HBS)',
    blurb: 'Clean and understated. Impact, leadership and career progression.',
    specStatus: 'placeholder',
    fontFamily: 'Garamond, "EB Garamond", "Times New Roman", "Liberation Serif", serif',
    docxFont: 'Garamond',
    baseSizePt: 10.5,
    nameSizePt: 14,
    headingSizePt: 10.5,
    lineHeight: 1.2,
    marginsMm: { top: 15, right: 18, bottom: 15, left: 18 },
    headingStyle: 'rule-under', // uppercase heading with a thin rule beneath
    nameAlign: 'center',
    educationAsTable: false,
    sectionOrder: [
      'education', 'experience', 'leadership', 'projects', 'achievements',
      'summary', 'skills', 'certifications', 'extracurricular', 'other',
    ],
  },
};

// Text smaller than this is not acceptable, regardless of page pressure.
export const MIN_FONT_PT = 9;

export const SECTION_KINDS = [
  'summary', 'education', 'experience', 'projects', 'skills', 'leadership',
  'achievements', 'certifications', 'extracurricular', 'other',
];

export function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES.hbs;
}

export const MM_TO_PX = 96 / 25.4;

export function printableHeightPx(templateId) {
  const t = getTemplate(templateId);
  return (PAGE.heightMm - t.marginsMm.top - t.marginsMm.bottom) * MM_TO_PX;
}

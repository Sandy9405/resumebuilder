// "Do no harm": compare the built resume with the CV the user uploaded.
//
// A rewrite must not silently lose facts, delete the user's positioning, or
// fill space with low-value sections. These checks make a regression visible
// to the model (so it fixes it) and to the user (so they can judge).

import { NUM_RE, normNum, resumeTexts } from './lint.js';
import { termPattern } from './jd.js';

export function isProfessionalResume(resume) {
  return ['working', 'experienced'].includes(resume?.settings?.stage) || ['mid', 'experienced', 'senior'].includes(resume?.profile?.careerStage);
}

const stripContact = (text) =>
  String(text || '')
    .replace(/\S+@\S+/g, ' ')
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+|\b[\w-]+\.(com|in|io|me|org|net|dev|co)(\/\S*)?/gi, ' ')
    // Phone numbers only: a leading +, or 10 digits (optionally split 5+5). Not date ranges.
    .replace(/\+\d[\d\s-]{7,}\d|\b\d{5}\s?\d{5}\b/g, ' ');

/** Numbers stated in the uploaded CV, each with the line it came from. */
export function cvFacts(cvText) {
  const facts = new Map();
  for (const line of stripContact(cvText).split(/\n+/)) {
    for (const m of line.matchAll(NUM_RE)) {
      const n = normNum(m[0]);
      if (!facts.has(n)) facts.set(n, line.trim().replace(/\s+/g, ' '));
    }
  }
  return facts;
}

function numbersIn(texts) {
  const out = new Set();
  for (const t of texts) for (const m of String(t).matchAll(NUM_RE)) out.add(normNum(m[0]));
  return out;
}

/** Everything kept in the user's data, shown or not (reserve, hidden). */
function allResumeText(resume) {
  const out = [];
  const h = resume.header || {};
  out.push(h.tagline, ...(h.details || []));
  for (const s of resume.sections || []) {
    out.push(s.title);
    for (const it of s.items || []) out.push(it.heading, it.org, it.location, it.dates, it.detail, it.note, ...(it.bullets || []), ...(it.reserve || []));
  }
  return out.filter(Boolean);
}

const visible = (resume) => [...resumeTexts(resume)].map(([, t]) => t);

export function factRetention(resume, cvText) {
  if (!cvText) return null;
  const facts = cvFacts(cvText);
  const kept = numbersIn(allResumeText(resume));
  const shown = numbersIn([...visible(resume), resume.header?.tagline || '']);
  const dropped = [];
  const offPage = [];
  for (const [n, context] of facts) {
    if (!kept.has(n)) dropped.push({ value: n, context });
    else if (!shown.has(n)) offPage.push({ value: n, context });
  }
  return { total: facts.size, kept: facts.size - dropped.length, shown: facts.size - dropped.length - offPage.length, dropped, offPage };
}

const SUMMARY_HEAD = /^\s*(profile|summary|professional summary|career summary|about( me)?|objective|executive summary)\s*:?\s*$/im;
const HOBBIES = /\b(hobb(y|ies)|interests|pastimes)\b/i;
const SCHOOL = /\b(class\s*(x|xii|10|12)(th)?|ssc|hsc|matric(ulation)?|secondary school|cbse|icse|10th|12th)\b/i;
const STOP = new Set(['and', 'the', 'of', 'for', 'in', 'at', 'a', 'an', 'to', 'with', '&', '-', '–', '|', '·']);

export function compareIssues(resume, cvText) {
  const out = [];
  const add = (level, code, message, path = '') => out.push({ level, code, message, path });
  const pro = isProfessionalResume(resume);
  const sections = (resume.sections || []).filter((s) => !s.hidden && (s.items || []).some((i) => !i.hidden));

  const fr = factRetention(resume, cvText);
  if (fr) {
    for (const d of fr.dropped.slice(0, 8)) {
      add('warn', 'fact-dropped', `"${d.value}" from your CV is no longer anywhere in the resume: "${d.context.slice(0, 90)}". Restore it, or keep it in reserve if it doesn't fit.`);
    }
  }
  if (cvText && SUMMARY_HEAD.test(cvText) && !sections.some((s) => s.kind === 'summary')) {
    add('warn', 'summary-dropped', 'Your CV had a profile summary and the resume has none. For experienced people and career switchers it is the main positioning tool: rewrite it for the target, do not delete it.');
  }
  const targetName = resume.target?.title || (resume.settings?.purpose?.type === 'role' ? resume.settings.purpose.role : '');
  if (targetName) {
    const words = targetName.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 2 && !STOP.has(w));
    const head = `${resume.header?.tagline || ''} ${sections.find((s) => s.kind === 'summary')?.items.map((i) => i.detail).join(' ') || ''}`.toLowerCase();
    if (words.length && !words.some((w) => head.includes(w))) {
      add('warn', 'headline-untargeted', `Neither the sub-header nor the profile speaks to the target ("${targetName}"). Position the person toward it in their true terms (e.g. the kind of work, domain or problems), without claiming a title they have not held.`, 'header.name');
    }
  }
  if (pro) {
    for (const s of sections) {
      if (s.kind === 'extracurricular' || HOBBIES.test(s.title) || s.items.some((i) => HOBBIES.test(`${i.heading} ${i.detail}`))) {
        add('warn', 'low-value-section', `"${s.title}" spends space on a working professional's resume that results would use better. Restore dropped detail or the profile instead.`, `${s.id}.title`);
      }
      if (s.kind === 'education') {
        for (const it of s.items) {
          if (!it.hidden && SCHOOL.test(`${it.heading} ${it.org}`)) add('warn', 'low-value-section', `School results ("${it.heading}") are usually dropped after a few years of work.`, `${s.id}.${it.id}.heading`);
        }
      }
    }
  }
  return out;
}

/** Job-keyword hits in free text (the original CV), comparable with the resume's. */
export function keywordHits(text, target) {
  if (!target?.keywords?.length) return null;
  const hits = target.keywords.filter((k) => [k.term, ...(k.aliases || [])].some((t) => t && termPattern(t).test(text)));
  return { matched: hits.length, total: target.keywords.length };
}

/** The "Compared with your original" panel. */
export function comparison(resume, cvText) {
  if (!cvText) return null;
  const fr = factRetention(resume, cvText);
  const before = keywordHits(cvText, resume.target);
  const after = keywordHits(visible(resume).join('\n'), resume.target);
  return { facts: fr && { total: fr.total, kept: fr.kept, shown: fr.shown, dropped: fr.dropped.map((d) => d.value) }, keywords: before && { before: before.matched, after: after.matched, total: before.total } };
}

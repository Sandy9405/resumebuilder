// Job-description keyword coverage. Runs in the browser and on the server.
//
// The model records the JD's keywords and, for each, whether the user's own
// material shows they have it (evidence: yes / no / unknown). Coverage is then
// computed deterministically against the visible resume text. A keyword the
// user does not have is a gap to discuss, never something to add.

import { resumeTexts } from './lint.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function termPattern(term) {
  // Boundaries that work for terms like "C++", "Node.js", "CI/CD", "A/B testing".
  return new RegExp(`(?<![A-Za-z0-9])${esc(term.trim())}(?![A-Za-z0-9])`, 'i');
}

export function visibleText(resume) {
  const parts = [];
  for (const [, text] of resumeTexts(resume)) parts.push(text);
  return parts.join('\n');
}

/**
 * @returns {null | {
 *   must: { total: number, matched: number }, nice: { total: number, matched: number },
 *   matched: string[], missing: { term: string, importance: string, evidence: string }[]
 * }}
 */
export function jdCoverage(resume) {
  const target = resume.target;
  if (!target?.keywords?.length) return null;
  const text = visibleText(resume);
  const out = { must: { total: 0, matched: 0 }, nice: { total: 0, matched: 0 }, matched: [], missing: [] };
  for (const k of target.keywords) {
    const bucket = k.importance === 'must' ? out.must : out.nice;
    bucket.total++;
    const terms = [k.term, ...(k.aliases || [])].filter(Boolean);
    if (terms.some((t) => termPattern(t).test(text))) {
      bucket.matched++;
      out.matched.push(k.term);
    } else {
      out.missing.push({ term: k.term, importance: k.importance, evidence: k.evidence, status: k.status || 'open' });
    }
  }
  return out;
}

export const MAX_EVIDENCE_QUESTIONS = 6;

/**
 * The next requirement to ask the user about: required items whose evidence is
 * unknown and not yet answered or skipped, in the JD's order. Capped so the
 * interview never turns into an interrogation.
 */
export function evidenceRequests(resume) {
  const kws = resume.target?.keywords || [];
  const asked = kws.filter((k) => k.status === 'answered' || k.status === 'skipped').length;
  // Never ask about something the resume already shows (the old bug: "prompts"
  // was asked twice while the panel said "On your resume").
  const text = visibleText(resume);
  const shown = (k) => [k.term, ...(k.aliases || [])].some((t) => t && termPattern(t).test(text));
  const open = kws.filter((k) => k.importance === 'must' && k.evidence === 'unknown' && (k.status || 'open') === 'open' && !shown(k));
  return { next: asked < MAX_EVIDENCE_QUESTIONS ? open[0] || null : null, open: open.length, asked, cap: MAX_EVIDENCE_QUESTIONS };
}

/** Findings in the same shape as content checks. */
export function jdIssues(resume) {
  const c = jdCoverage(resume);
  if (!c) return [];
  return c.missing.map((m) =>
    m.evidence === 'yes'
      ? { level: 'warn', code: 'jd-missing', message: `The job asks for "${m.term}" and you have it, but the resume doesn't show it yet.`, path: '' }
      : m.evidence === 'unknown'
        ? { level: 'info', code: 'jd-ask', message: `The job asks for "${m.term}" (${m.importance === 'must' ? 'required' : 'nice to have'}). Do you have experience with it?`, path: '' }
        : m.status === 'skipped'
          ? { level: 'info', code: 'jd-gap', message: `Gap: the job asks for "${m.term}"; you said you don't have it, so it isn't on the resume.`, path: '' }
          : { level: 'info', code: 'jd-gap', message: `Gap: the job asks for "${m.term}" and your material doesn't show it. Not added; it stays a gap unless you have it.`, path: '' },
  );
}

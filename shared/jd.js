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
      out.missing.push({ term: k.term, importance: k.importance, evidence: k.evidence });
    }
  }
  return out;
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
        : { level: 'info', code: 'jd-gap', message: `Gap: the job asks for "${m.term}" and your material doesn't show it. Not added; it stays a gap unless you have it.`, path: '' },
  );
}

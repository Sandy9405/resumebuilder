// The single next question the user should answer, if any. Drives both the
// agent's instructions and the one-tap quick replies under its message.
import { latestRole } from './ops.js';
import { evidenceRequests } from '../shared/jd.js';

/** The user chose to upload a CV (upload or both) and it hasn't arrived yet. */
export function awaitingCv(session) {
  const r = session.resume;
  return r.settings.buildMode !== 'talk' && !String(session.cvText || '').trim() && !r.sections.length;
}

export function nextAsk(session) {
  const r = session.resume;
  if (awaitingCv(session)) return { kind: 'cv', target: !!(r.target || session.jd) };
  if (session.cvText && !r.settings.currency) {
    const role = latestRole(r);
    if (role) return { kind: 'currency', role: role.label, dates: role.dates };
  }
  if (r.target) {
    const e = evidenceRequests(r);
    if (e.next) return { kind: 'evidence', term: e.next.term };
  }
  return null;
}

export function askInstruction(ask) {
  if (!ask) return 'nothing pending.';
  if (ask.kind === 'cv') {
    return `the user's CV. They chose to upload one and it has not arrived yet, which is expected: you have not asked for it yet. Do not assess fit, ask evidence questions or draft anything until it arrives. Never say you haven't seen or can't find their resume. End your reply by asking for it, exactly: "Now upload your current CV (PDF or Word).${ask.target ? " I'll tailor it to this job and tell you honestly how well you fit." : " I'll turn it into a first draft and keep every fact."}"`;
  }
  if (ask.kind === 'currency') {
    return `current-role check first. Before anything else, ask exactly: "Is ${ask.role}${ask.dates ? ` (${ask.dates})` : ''} still your current job? If you've moved on, tell me your current role and when the old one ended." Then call confirm_current_role. If they moved on, add the new role at the top of Experience and give the old role an end date.`;
  }
  return `evidence for "${ask.term}". Ask exactly in this shape: "This job requires ${ask.term}. Can you tell me about a time you did this, or share any proof I can include, like a result, a project, a number or a link? If you don't have anything, just say skip." If they answer, ask once for the outcome if it is missing ("What changed because of it?"), write it up, then call mark_requirement.`;
}

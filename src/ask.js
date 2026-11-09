// The single next question the user should answer, if any. Drives both the
// agent's instructions and the one-tap quick replies under its message.
import { latestRole } from './ops.js';
import { evidenceRequests } from '../shared/jd.js';

export function nextAsk(session) {
  const r = session.resume;
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
  if (ask.kind === 'currency') {
    return `current-role check first. Before anything else, ask exactly: "Is ${ask.role}${ask.dates ? ` (${ask.dates})` : ''} still your current job? If you've moved on, tell me your current role and when the old one ended." Then call confirm_current_role. If they moved on, add the new role at the top of Experience and give the old role an end date.`;
  }
  return `evidence for "${ask.term}". Ask exactly in this shape: "This job requires ${ask.term}. Can you tell me about a time you did this, or share any proof I can include, like a result, a project, a number or a link? If you don't have anything, just say skip." If they answer, ask once for the outcome if it is missing ("What changed because of it?"), write it up, then call mark_requirement.`;
}

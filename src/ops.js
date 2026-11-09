// Resume state and the edit operations the model is allowed to perform.
//
// The model never rewrites the document wholesale after the first draft: it
// calls narrow operations (update one item, add one bullet-list item, move a
// section). Content it does not touch stays byte-identical, which is how
// "do not lose previously entered information" is enforced rather than hoped for.

import { randomBytes } from 'node:crypto';
import { getTemplate, SECTION_KINDS, TEMPLATES } from '../shared/templates.js';

const newId = (p) => `${p}_${randomBytes(3).toString('hex')}`;

export function emptyResume(settings = {}) {
  return {
    settings: {
      template: TEMPLATES[settings.template] ? settings.template : 'hbs',
      pages: settings.pages === 2 ? 2 : 1,
      buildMode: settings.buildMode || 'talk',
      purpose: cleanPurpose(settings.purpose),
      // recent: student / graduated in the last two years; working: under 5 years; experienced: 5+ or switching.
      stage: ['recent', 'working', 'experienced'].includes(settings.stage) ? settings.stage : '',
    },
    header: { name: '', tagline: '', email: '', phone: '', location: '', links: [], details: [] },
    profile: { ...emptyProfile(), careerStage: { recent: 'student', working: 'early', experienced: 'experienced' }[settings.stage] || '' },
    target: null,
    assessment: { cv: null, fit: null },
    sections: [],
  };
}

export const CAREER_STAGES = ['student', 'early', 'mid', 'experienced', 'senior'];
export const FIT_LEVELS = ['strong', 'good', 'weak', 'very_weak'];

/** What the resume is for: a specific job (JD), a type of role, or general use. */
export function cleanPurpose(p) {
  const type = ['jd', 'role', 'general'].includes(p?.type) ? p.type : '';
  const role = typeof p?.role === 'string' ? p.role.trim().slice(0, 120) : '';
  return { type: type === 'role' && !role ? 'general' : type, role: type === 'role' ? role : '' };
}

export function emptyProfile() {
  return {
    jobFamilies: [],
    currentRole: '',
    yearsExperience: '',
    industry: '',
    specialization: '',
    careerStage: '',
    targetRole: '',
  };
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

const strList = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

function cleanItem(raw, id, prev) {
  return {
    id: id || newId('i'),
    heading: str(raw?.heading),
    org: str(raw?.org),
    location: str(raw?.location),
    dates: str(raw?.dates),
    detail: str(raw?.detail),
    note: str(raw?.note),
    bullets: strList(raw?.bullets),
    // Detail kept for longer versions of the resume but not shown at the current length.
    reserve: raw?.reserve_bullets !== undefined ? strList(raw.reserve_bullets) : prev?.reserve || [],
    hidden: typeof raw?.hidden === 'boolean' ? raw.hidden : prev?.hidden || false,
    // Bullets in the user's own words: kept verbatim, exempt from style rewriting.
    locked: raw?.user_wording !== undefined ? strList(raw.user_wording) : prev?.locked || [],
  };
}

/** Every locked bullet must appear word for word in bullets or reserve. */
function checkLocked(item, prev, userRequestedChange = false) {
  const kept = new Set([...item.bullets, ...item.reserve]);
  const missing = item.locked.filter((b) => !kept.has(b));
  if (missing.length) {
    throw new OpError(
      `These bullets are the user's own wording and must stay exactly as written: ${missing.map((b) => `"${b}"`).join('; ')}. Copy them unchanged into bullets (or reserve_bullets). If the user asked to change one, put their new wording in both bullets and user_wording.`,
    );
  }
  // Rewording or removing a dictated bullet needs the user's explicit request.
  const dropped = (prev?.locked || []).filter((b) => !item.locked.includes(b) || !kept.has(b));
  if (dropped.length && !userRequestedChange) {
    throw new OpError(
      `The user dictated ${dropped.map((b) => `"${b}"`).join('; ')}. Keep it unchanged in bullets and user_wording. Only if the user explicitly asked to reword or remove it, call update_item again with user_requested_change=true.`,
    );
  }
}

function cleanHeader(raw) {
  return {
    name: str(raw?.name),
    tagline: str(raw?.tagline),
    email: str(raw?.email),
    phone: str(raw?.phone),
    location: str(raw?.location),
    links: strList(raw?.links),
    details: strList(raw?.details),
  };
}

function cleanProfile(raw) {
  return {
    jobFamilies: strList(raw?.job_families).slice(0, 4),
    currentRole: str(raw?.current_role),
    yearsExperience: str(raw?.years_experience),
    industry: str(raw?.industry),
    specialization: str(raw?.specialization),
    careerStage: CAREER_STAGES.includes(raw?.career_stage) ? raw.career_stage : '',
    targetRole: str(raw?.target_role),
  };
}

const kindOf = (k) => (SECTION_KINDS.includes(k) ? k : 'other');

function findSection(resume, id) {
  const s = resume.sections.find((x) => x.id === id);
  if (!s) throw new OpError(`No section with id "${id}". Current ids: ${resume.sections.map((x) => x.id).join(', ') || '(none)'}`);
  return s;
}

function findItemIndex(sec, id) {
  const i = sec.items.findIndex((x) => x.id === id);
  if (i < 0) throw new OpError(`No item "${id}" in section "${sec.id}". Item ids: ${sec.items.map((x) => x.id).join(', ') || '(none)'}`);
  return i;
}

export class OpError extends Error {}

/** Sort sections by the template's preferred order, keeping relative order of equal kinds. */
export function orderForTemplate(sections, templateId) {
  const order = getTemplate(templateId).sectionOrder;
  return sections
    .map((s, i) => [s, i])
    .sort(([a, ia], [b, ib]) => order.indexOf(a.kind) - order.indexOf(b.kind) || ia - ib)
    .map(([s]) => s);
}

/**
 * Apply one operation. Mutates and returns `resume`. Throws OpError on a bad
 * reference so the model gets a precise error back and can retry.
 * Returns a short human-readable description of the change.
 */
export function applyOp(resume, name, input) {
  switch (name) {
    case 'create_resume': {
      if (resume.sections.length && !input.confirm_replace) {
        throw new OpError(
          'A draft already exists. Use the narrow edit tools instead, or set confirm_replace=true only if the user asked to rebuild from scratch.',
        );
      }
      resume.header = cleanHeader(input.header);
      resume.sections = orderForTemplate(
        (input.sections || []).map((s) => ({
          id: newId('s'),
          kind: kindOf(s.kind),
          title: str(s.title) || kindOf(s.kind),
          hidden: false,
          items: (s.items || []).map((it) => {
            const item = cleanItem(it);
            checkLocked(item);
            return item;
          }),
        })),
        resume.settings.template,
      );
      return `Created draft with ${resume.sections.length} sections`;
    }
    case 'update_header': {
      resume.header = cleanHeader(input.header);
      return 'Updated header';
    }
    case 'add_section': {
      const sec = { id: newId('s'), kind: kindOf(input.kind), title: str(input.title) || kindOf(input.kind), hidden: false, items: [] };
      insertAfter(resume.sections, sec, input.after_section_id);
      return `Added section "${sec.title}" (${sec.id})`;
    }
    case 'rename_section': {
      const sec = findSection(resume, input.section_id);
      sec.title = str(input.title) || sec.title;
      return `Renamed section to "${sec.title}"`;
    }
    case 'remove_section': {
      const sec = findSection(resume, input.section_id);
      resume.sections = resume.sections.filter((s) => s !== sec);
      return `Removed section "${sec.title}"`;
    }
    case 'move_section': {
      const sec = findSection(resume, input.section_id);
      if (input.after_section_id && input.after_section_id !== '__top__') findSection(resume, input.after_section_id);
      resume.sections = resume.sections.filter((s) => s !== sec);
      insertAfter(resume.sections, sec, input.after_section_id);
      return `Moved section "${sec.title}"`;
    }
    case 'add_item': {
      const sec = findSection(resume, input.section_id);
      if (input.after_item_id && input.after_item_id !== '__top__') findItemIndex(sec, input.after_item_id);
      const item = cleanItem(input.item);
      checkLocked(item);
      insertAfter(sec.items, item, input.after_item_id);
      return `Added "${item.org || item.heading}" to ${sec.title} (${item.id})`;
    }
    case 'update_item': {
      const sec = findSection(resume, input.section_id);
      const i = findItemIndex(sec, input.item_id);
      const next = cleanItem(input.item, sec.items[i].id, sec.items[i]);
      checkLocked(next, sec.items[i], input.user_requested_change === true);
      sec.items[i] = next;
      return `Updated "${sec.items[i].org || sec.items[i].heading}" in ${sec.title}`;
    }
    case 'remove_item': {
      const sec = findSection(resume, input.section_id);
      const i = findItemIndex(sec, input.item_id);
      const [gone] = sec.items.splice(i, 1);
      return `Removed "${gone.org || gone.heading}" from ${sec.title}`;
    }
    case 'set_profile': {
      resume.profile = cleanProfile(input);
      const p = resume.profile;
      return `Profile: ${[p.jobFamilies.join(' / '), p.careerStage, p.targetRole && `target ${p.targetRole}`].filter(Boolean).join(', ')}`;
    }
    case 'set_visibility': {
      const sec = findSection(resume, input.section_id);
      if (!input.item_id) {
        sec.hidden = !!input.hidden;
        return `${input.hidden ? 'Hid' : 'Showed'} section "${sec.title}" (kept in your data)`;
      }
      const it = sec.items[findItemIndex(sec, input.item_id)];
      it.hidden = !!input.hidden;
      return `${input.hidden ? 'Hid' : 'Showed'} "${it.org || it.heading}" (kept in your data)`;
    }
    case 'set_target_job': {
      const kws = (Array.isArray(input.keywords) ? input.keywords : [])
        .map((k) => ({
          term: str(k?.term),
          aliases: strList(k?.aliases).slice(0, 5),
          importance: k?.importance === 'must' ? 'must' : 'nice',
          evidence: ['yes', 'no', 'unknown'].includes(k?.evidence) ? k.evidence : 'unknown',
        }))
        .filter((k) => k.term)
        .slice(0, 40);
      resume.target = { title: str(input.title), company: str(input.company), seniority: str(input.seniority), keywords: kws };
      const must = kws.filter((k) => k.importance === 'must').length;
      return `Target job: ${[resume.target.title, resume.target.company].filter(Boolean).join(' at ') || 'set'} (${kws.length} keywords, ${must} required)`;
    }
    case 'set_purpose': {
      resume.settings.purpose = cleanPurpose(input);
      const pp = resume.settings.purpose;
      return pp.type === 'role' ? `Purpose: applying for ${pp.role} roles` : pp.type === 'jd' ? 'Purpose: a specific job' : 'Purpose: general resume';
    }
    case 'assess_cv': {
      const verdict = input.verdict === 'already_strong' ? 'already_strong' : 'improve';
      resume.assessment = { ...(resume.assessment || {}), cv: { verdict, summary: str(input.summary), improvements: strList(input.improvements).slice(0, 8) } };
      return verdict === 'already_strong' ? 'Assessment: the CV is already strong; only light polish' : 'Assessment: the CV can be improved';
    }
    case 'assess_fit': {
      const level = FIT_LEVELS.includes(input.level) ? input.level : 'weak';
      const prev = resume.assessment?.fit;
      const sameTarget = prev && prev.target === str(input.target);
      resume.assessment = {
        ...(resume.assessment || {}),
        fit: {
          level,
          target: str(input.target),
          summary: str(input.summary),
          gaps: strList(input.gaps).slice(0, 8),
          question: str(input.decisive_question),
          better_fits: strList(input.better_fit_roles).slice(0, 4),
          // "Apply anyway" survives re-assessment of the same target.
          override: sameTarget ? !!prev.override : false,
        },
      };
      let note = '';
      const musts = (resume.target?.keywords || []).filter((k) => k.importance === 'must');
      const absent = musts.filter((k) => k.evidence === 'no').length;
      if (musts.length && absent / musts.length >= 0.5 && ['strong', 'good'].includes(level)) {
        note = ` Note: ${absent} of ${musts.length} required keywords are marked as absent from the user's material, which does not match a "${level}" fit. Re-check.`;
      }
      return `Fit for ${resume.assessment.fit.target || 'the target'}: ${level.replace('_', ' ')}${note}`;
    }
    case 'clear_target_job': {
      resume.target = null;
      return 'Stopped targeting a specific job';
    }
    case 'set_format': {
      const before = resume.settings.template;
      if (input.template && TEMPLATES[input.template]) resume.settings.template = input.template;
      if (input.pages === 1 || input.pages === 2) resume.settings.pages = input.pages;
      if (before !== resume.settings.template) {
        resume.sections = orderForTemplate(resume.sections, resume.settings.template);
      }
      return `Format: ${getTemplate(resume.settings.template).label}, ${resume.settings.pages} page(s)`;
    }
    default:
      throw new OpError(`Unknown operation ${name}`);
  }
}

function insertAfter(list, el, afterId) {
  if (!afterId) {
    // No anchor: sections go to the end, which is the least surprising default.
    list.push(el);
    return;
  }
  if (afterId === '__top__') {
    list.unshift(el);
    return;
  }
  const i = list.findIndex((x) => x.id === afterId);
  if (i < 0) list.push(el);
  else list.splice(i + 1, 0, el);
}

/**
 * Apply a direct edit from the preview (user typed into the document).
 * path: "header.name" | "<sectionId>.title" | "<sectionId>.<itemId>.<field>" | "<sectionId>.<itemId>.bullets.<n>"
 */
export function applyManualEdit(resume, path, value) {
  const v = String(value ?? '').replace(/\s+/g, ' ').trim();
  const parts = path.split('.');
  if (parts[0] === 'header') {
    if (!['name', 'tagline'].includes(parts[1])) throw new OpError('Bad header field');
    resume.header[parts[1]] = v;
    return;
  }
  const sec = findSection(resume, parts[0]);
  if (parts[1] === 'title') {
    sec.title = v || sec.title;
    return;
  }
  const item = sec.items[findItemIndex(sec, parts[1])];
  if (parts[2] === 'bullets') {
    const n = Number(parts[3]);
    if (!Number.isInteger(n) || n < 0 || n >= item.bullets.length) throw new OpError('Bad bullet index');
    const old = item.bullets[n];
    item.locked = (item.locked || []).filter((b) => b !== old);
    if (v) {
      item.bullets[n] = v;
      item.locked.push(v); // typed by the user: their wording, keep it
    } else item.bullets.splice(n, 1);
    return;
  }
  if (!['heading', 'org', 'location', 'dates', 'detail', 'note'].includes(parts[2])) throw new OpError('Bad field');
  item[parts[2]] = v;
}

/** Migrate older saved state to the current shape. */
export function normalizeResume(r) {
  r.header = cleanHeader(r.header);
  r.profile = { ...emptyProfile(), ...(r.profile || {}) };
  r.target = r.target || null;
  r.assessment = r.assessment || { cv: null, fit: null };
  r.settings.purpose = cleanPurpose(r.settings.purpose);
  r.sections = (r.sections || []).map((s) => ({
    ...s,
    hidden: !!s.hidden,
    items: (s.items || []).map((it) => ({ note: '', reserve: [], hidden: false, locked: [], ...it })),
  }));
  return r;
}

// ---------------------------------------------------------------- undo/redo

const MAX_HISTORY = 50;
const snap = (r) => JSON.stringify(r);

/** Record the state before a change. Call with the pre-change snapshot string. */
export function pushHistory(session, before) {
  if (before === snap(session.resume)) return false;
  session.undo.push(before);
  if (session.undo.length > MAX_HISTORY) session.undo.shift();
  session.redo = [];
  return true;
}

export function undo(session) {
  if (!session.undo.length) return false;
  session.redo.push(snap(session.resume));
  session.resume = JSON.parse(session.undo.pop());
  return true;
}

export function redo(session) {
  if (!session.redo.length) return false;
  session.undo.push(snap(session.resume));
  session.resume = JSON.parse(session.redo.pop());
  return true;
}

export { snap as snapshot };

/** The user chose "Apply anyway" despite a weak fit. */
export function applyAnyway(resume) {
  if (!resume.assessment?.fit) throw new OpError('There is no fit assessment to override.');
  resume.assessment.fit.override = true;
}

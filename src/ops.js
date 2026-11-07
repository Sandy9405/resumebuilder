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
    },
    header: { name: '', tagline: '', email: '', phone: '', location: '', links: [] },
    sections: [],
  };
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function cleanItem(raw, id) {
  return {
    id: id || newId('i'),
    heading: str(raw?.heading),
    org: str(raw?.org),
    location: str(raw?.location),
    dates: str(raw?.dates),
    detail: str(raw?.detail),
    bullets: Array.isArray(raw?.bullets) ? raw.bullets.map(str).filter(Boolean) : [],
  };
}

function cleanHeader(raw) {
  return {
    name: str(raw?.name),
    tagline: str(raw?.tagline),
    email: str(raw?.email),
    phone: str(raw?.phone),
    location: str(raw?.location),
    links: Array.isArray(raw?.links) ? raw.links.map(str).filter(Boolean) : [],
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
          items: (s.items || []).map((it) => cleanItem(it)),
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
      const sec = { id: newId('s'), kind: kindOf(input.kind), title: str(input.title) || kindOf(input.kind), items: [] };
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
      insertAfter(sec.items, item, input.after_item_id);
      return `Added "${item.org || item.heading}" to ${sec.title} (${item.id})`;
    }
    case 'update_item': {
      const sec = findSection(resume, input.section_id);
      const i = findItemIndex(sec, input.item_id);
      sec.items[i] = cleanItem(input.item, sec.items[i].id);
      return `Updated "${sec.items[i].org || sec.items[i].heading}" in ${sec.title}`;
    }
    case 'remove_item': {
      const sec = findSection(resume, input.section_id);
      const i = findItemIndex(sec, input.item_id);
      const [gone] = sec.items.splice(i, 1);
      return `Removed "${gone.org || gone.heading}" from ${sec.title}`;
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
    if (v) item.bullets[n] = v;
    else item.bullets.splice(n, 1);
    return;
  }
  if (!['heading', 'org', 'location', 'dates', 'detail'].includes(parts[2])) throw new OpError('Bad field');
  item[parts[2]] = v;
}

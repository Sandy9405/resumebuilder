// Tool definitions the model uses to edit the resume. strict: true makes the
// API guarantee each call's input matches its schema.

import { SECTION_KINDS } from '../shared/templates.js';

const S = { type: 'string' };

const ITEM = {
  type: 'object',
  description:
    'One entry: a job, internship, degree, project, position, award or skill group. Use "" for fields that do not apply.',
  properties: {
    heading: { type: 'string', description: 'Role / degree / project name / award / skill category' },
    org: { type: 'string', description: 'Company, institution or organisation. "" if none.' },
    location: S,
    dates: { type: 'string', description: 'As the user gave them, e.g. "Jun 2022 – Present" or "2019 – 2023"' },
    detail: { type: 'string', description: 'One line: CPI/GPA/percentage for education, tech stack or guide for projects, comma-separated list for skills' },
    note: { type: 'string', description: 'Education only: board/university (IITB table) or distinction such as "Institute Gold Medal" (IIMA table). Otherwise "".' },
    bullets: { type: 'array', items: S, description: 'Action–Project–Result bullets shown on the resume. [] if none.' },
    reserve_bullets: {
      type: 'array',
      items: S,
      description: 'Accurate bullets kept in the user\'s data but not shown at the current page limit. Move bullets here instead of deleting them when cutting for length; bring them back for a longer version.',
    },
  },
  required: ['heading', 'org', 'location', 'dates', 'detail', 'note', 'bullets', 'reserve_bullets'],
  additionalProperties: false,
};

const HEADER = {
  type: 'object',
  properties: {
    name: S,
    tagline: { type: 'string', description: 'Optional one-line professional identity. Usually "".' },
    email: S,
    phone: S,
    location: S,
    links: { type: 'array', items: S, description: 'LinkedIn, GitHub, portfolio URLs' },
    details: {
      type: 'array',
      items: S,
      description: 'Short header facts the user supplied, e.g. roll number, programme, institute (IITB header column). Never add age, gender or other personal data the user did not give.',
    },
  },
  required: ['name', 'tagline', 'email', 'phone', 'location', 'links', 'details'],
  additionalProperties: false,
};

const KIND = { type: 'string', enum: SECTION_KINDS };

function tool(name, description, properties) {
  return {
    name,
    description,
    strict: true,
    input_schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
  };
}

export const TOOLS = [
  tool(
    'create_resume',
    'Create the first complete draft. Only for the initial draft, or a full rebuild the user explicitly asked for (then confirm_replace=true).',
    {
      header: HEADER,
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: { kind: KIND, title: S, items: { type: 'array', items: ITEM } },
          required: ['kind', 'title', 'items'],
          additionalProperties: false,
        },
      },
      confirm_replace: { type: 'boolean' },
    },
  ),
  tool('update_header', 'Replace the name and contact block. Send every field, including unchanged ones.', { header: HEADER }),
  tool('add_section', 'Add an empty section. after_section_id: "" appends at the end, "__top__" puts it first.', {
    kind: KIND,
    title: S,
    after_section_id: S,
  }),
  tool('rename_section', 'Change a section heading.', { section_id: S, title: S }),
  tool('remove_section', 'Delete a whole section. Only when the user asks, or to meet the page limit.', { section_id: S }),
  tool('move_section', 'Reorder a section. after_section_id: "__top__" moves it first.', {
    section_id: S,
    after_section_id: S,
  }),
  tool('add_item', 'Add one entry to a section. after_item_id: "" appends, "__top__" puts it first (use for the most recent role).', {
    section_id: S,
    after_item_id: S,
    item: ITEM,
  }),
  tool(
    'update_item',
    'Replace one entry. Send the full item, copying unchanged fields and bullets exactly from <resume_state>.',
    { section_id: S, item_id: S, item: ITEM },
  ),
  tool('remove_item', 'Delete one entry permanently. Only when the user asks. To cut for length, use set_visibility instead.', { section_id: S, item_id: S }),
  tool(
    'set_visibility',
    'Hide or show an entry (or a whole section when item_id is "") without deleting it. Use to fit the page limit; hidden content reappears when the user wants a longer version.',
    { section_id: S, item_id: S, hidden: { type: 'boolean' } },
  ),
  tool(
    'set_profile',
    'Record your reading of the user\'s professional profile. Call it once you understand their background, and again when it changes (e.g. a new target role). Drives which questions you ask and what the resume prioritises.',
    {
      job_families: {
        type: 'array',
        items: S,
        description: 'One to three, most relevant first, e.g. "Software Engineering", "Product Management", "Consulting / Strategy", or another profession in plain words.',
      },
      current_role: S,
      years_experience: { type: 'string', description: 'e.g. "0 (final-year student)", "3", "12+". "" if unknown.' },
      industry: S,
      specialization: S,
      career_stage: { type: 'string', enum: ['student', 'early', 'mid', 'experienced', 'senior', ''] },
      target_role: { type: 'string', description: 'Only if the user stated one. "" otherwise.' },
    },
  ),
  tool(
    'set_target_job',
    'Record the target job after reading a job description: title, company, seniority, and its important keywords (skills, tools, domain terms, qualifications). For each keyword say whether the user\'s own material shows they have it. The app then checks which keywords the resume shows. Call again if your reading changes, e.g. after the user answers a gap question.',
    {
      title: S,
      company: S,
      seniority: { type: 'string', description: 'e.g. "entry", "2-4 years", "senior", "lead". "" if unclear.' },
      keywords: {
        type: 'array',
        description: 'The 8-25 terms that matter most, in the JD\'s own wording.',
        items: {
          type: 'object',
          properties: {
            term: { type: 'string', description: 'As written in the JD, e.g. "SQL", "stakeholder management", "A/B testing"' },
            aliases: { type: 'array', items: S, description: 'Other spellings that count as the same thing, e.g. ["Postgres"] for "PostgreSQL". [] if none.' },
            importance: { type: 'string', enum: ['must', 'nice'] },
            evidence: {
              type: 'string',
              enum: ['yes', 'no', 'unknown'],
              description: 'yes: the user\'s CV or answers show it. no: clearly absent. unknown: not mentioned either way; ask before using it.',
            },
          },
          required: ['term', 'aliases', 'importance', 'evidence'],
          additionalProperties: false,
        },
      },
    },
  ),
  tool('clear_target_job', 'Stop tailoring to a specific job (the user removed the job description).', {}),
  tool('set_format', 'Switch template and/or page count, only when the user asks. Send both values.', {
    template: { type: 'string', enum: ['iitb', 'iima', 'hbs'] },
    pages: { type: 'integer', enum: [1, 2] },
  }),
];

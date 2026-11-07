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
    detail: { type: 'string', description: 'One line: CPI/GPA/percentage, tech stack, or comma-separated skills' },
    bullets: { type: 'array', items: S, description: 'Action–Project–Result bullets. [] if none.' },
  },
  required: ['heading', 'org', 'location', 'dates', 'detail', 'bullets'],
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
  },
  required: ['name', 'tagline', 'email', 'phone', 'location', 'links'],
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
  tool('remove_item', 'Delete one entry.', { section_id: S, item_id: S }),
  tool('set_format', 'Switch template and/or page count, only when the user asks. Send both values.', {
    template: { type: 'string', enum: ['iitb', 'iima', 'hbs'] },
    pages: { type: 'integer', enum: [1, 2] },
  }),
];

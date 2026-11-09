// Scripted stand-in for the Anthropic client, for UI development and tests
// without an API key (MOCK_CLAUDE=1). It does NOT write resumes from your input:
// the first draft is fixed sample data.

let n = 0;
const id = () => `toolu_mock_${++n}`;

const fill = (it) => ({ note: '', reserve_bullets: [], user_wording: [], ...it });
const SAMPLE_RAW = {
  header: {
    name: 'Asha Verma',
    tagline: '',
    email: 'asha.verma@example.com',
    phone: '+91 98765 43210',
    location: 'Pune, India',
    links: ['linkedin.com/in/ashaverma'],
  },
  sections: [
    {
      kind: 'education',
      title: 'Education',
      items: [
        { heading: 'B.Tech, Computer Science', org: 'College of Engineering Pune', location: '', dates: '2019 – 2023', detail: 'CGPA 8.4/10', bullets: [] },
      ],
    },
    {
      kind: 'experience',
      title: 'Professional Experience',
      items: [
        {
          heading: 'Software Engineer',
          org: 'Acme Logistics',
          location: 'Pune',
          dates: 'Jul 2023 – Present',
          detail: '',
          bullets: [
            'Built a shipment-tracking dashboard for the operations team, bringing carrier updates into one view.',
            'Automated weekly delivery reports with Python, reducing preparation time from 6 hours to 1 hour.',
          ],
        },
      ],
    },
    {
      kind: 'skills',
      title: 'Skills',
      items: [{ heading: 'Technical', org: '', location: '', dates: '', detail: 'Python, SQL, React, PostgreSQL', bullets: [] }],
    },
  ],
  confirm_replace: false,
};
// Same shape the real model must send (validated by src/validate.js).
const SAMPLE = {
  ...SAMPLE_RAW,
  header: { details: [], ...SAMPLE_RAW.header },
  sections: SAMPLE_RAW.sections.map((sec) => ({ ...sec, items: sec.items.map(fill) })),
};

function lastUserText(messages) {
  const m = messages[messages.length - 1];
  if (typeof m.content === 'string') return m.content;
  return m.content
    .filter((b) => b.type === 'text' && !b.text.startsWith('<resume_state>') && !b.text.startsWith('(App note'))
    .map((b) => b.text)
    .join(' ');
}

function msg(content, stop_reason) {
  return { id: `msg_mock_${++n}`, type: 'message', role: 'assistant', content, stop_reason, usage: {} };
}

export const mockClient = {
  beta: {
    messages: {
      // Mirrors the SDK shape used by agent.js: stream(params).finalMessage().
      stream(params) {
        return { finalMessage: () => mockClient.beta.messages.create(params) };
      },
      async create({ messages }) {
        const last = messages[messages.length - 1];
        const isToolResult = Array.isArray(last.content) && last.content[0]?.type === 'tool_result';
        if (isToolResult) {
          const err = last.content.find((b) => b.is_error);
          return msg([{ type: 'text', text: err ? `(mock) Edit failed: ${err.content}` : '(mock) Done. What else should change?' }], 'end_turn');
        }
        const state = last.content.find?.((b) => b.type === 'text' && b.text.startsWith('<resume_state>'))?.text || '';
        const hasDraft = /"sections":\[\{/.test(state);
        const text = lastUserText(messages).toLowerCase();

        if (!hasDraft) {
          return msg(
            [
              { type: 'text', text: '(mock) Here is a first draft using sample data.' },
              { type: 'tool_use', id: id(), name: 'create_resume', input: SAMPLE },
              { type: 'tool_use', id: id(), name: 'assess_cv', input: { verdict: 'improve', summary: '(mock) Duties can become achievements.', improvements: ['Turn duties into results', 'Remove generic phrases'] } },
              {
                type: 'tool_use',
                id: id(),
                name: 'set_profile',
                input: { job_families: ['Software Engineering'], current_role: 'Software Engineer', years_experience: '1', industry: 'Logistics', specialization: 'Backend', career_stage: 'early', target_role: '' },
              },
            ],
            'tool_use',
          );
        }
        const jd = last.content.find?.((b) => b.type === 'document' && String(b.title).startsWith('Job description'));
        if (jd) {
          return msg(
            [
              { type: 'text', text: '(mock) Read the job description.' },
              {
                type: 'tool_use',
                id: id(),
                name: 'set_target_job',
                input: {
                  title: 'Backend Engineer',
                  company: 'Example Co',
                  seniority: '2-4 years',
                  keywords: [
                    { term: 'Python', aliases: [], importance: 'must', evidence: 'yes' },
                    { term: 'PostgreSQL', aliases: ['Postgres'], importance: 'must', evidence: 'yes' },
                    { term: 'Kubernetes', aliases: [], importance: 'must', evidence: 'unknown' },
                    { term: 'Kafka', aliases: [], importance: 'nice', evidence: 'no' },
                  ],
                },
              },
              {
                type: 'tool_use',
                id: id(),
                name: 'assess_fit',
                input: {
                  target: 'Backend Engineer at Example Co',
                  level: 'weak',
                  summary: '(mock) Python and PostgreSQL match, but the role needs Kubernetes and 3+ years of backend work.',
                  gaps: ['Kubernetes', '3+ years backend'],
                  decisive_question: 'Have you deployed services on Kubernetes, even in a side project?',
                  better_fit_roles: ['Junior Backend Engineer', 'Data Engineer'],
                },
              },
            ],
            'tool_use',
          );
        }
        const fmt = text.match(/\b(iitb|iima|hbs)\b/);
        const pages = /two page|2 page/.test(text) ? 2 : /one page|1 page/.test(text) ? 1 : null;
        if (fmt || pages) {
          const cur = state.match(/\(id (\w+)\), \w+ paper\. Page limit: (\d)/);
          return msg(
            [{ type: 'tool_use', id: id(), name: 'set_format', input: { template: fmt ? fmt[1] : cur[1], pages: pages || Number(cur[2]) } }],
            'tool_use',
          );
        }
        return msg([{ type: 'text', text: `(mock) I heard: "${text}". The mock client can only switch format or page count.` }], 'end_turn');
      },
    },
  },
};

// "Do no harm" checks from the RCA of a CV that scored worse than its input.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { factRetention, compareIssues, comparison, cvFacts } from '../shared/compare.js';
import { orderForTemplate, emptyResume, applyOp } from '../src/ops.js';
import { createApp } from '../src/server.js';
import { mockClient } from '../src/mock-client.js';
import { closeLayout } from '../src/layout.js';

after(closeLayout);

const CV = `RAVI KUMAR
+91 98765 43210 | ravi@example.com | ravi.dev
PROFILE
Product-minded founder who took a marketplace from 0 to 12,000 monthly users.
EXPERIENCE
Founder, Kiranaly 2021 - Present
Built an AI assistant that cut support tickets 40% and ops headcount from 5 to 1.
Wrote a 900-line pricing engine covering 80+ cities.
EDUCATION
B.Tech, NIT Trichy 2014 - 2018`;

const item = (o) => ({ id: Math.random().toString(36).slice(2, 7), heading: '', org: '', location: '', dates: '', detail: '', note: '', bullets: [], reserve: [], hidden: false, locked: [], ...o });
function built({ bullets, summary = true, tagline = 'Founder', stage = 'experienced', extra = [] } = {}) {
  return {
    settings: { template: 'iima', pages: 1, stage, purpose: { type: 'role', role: 'Product Manager - Applied AI' } },
    header: { name: 'Ravi Kumar', tagline, email: 'ravi@example.com', phone: '+91 98765 43210', location: '', links: ['ravi.dev'], details: [] },
    profile: {},
    target: { title: 'Product Manager - Applied AI', keywords: [{ term: 'evals', aliases: [], importance: 'must', evidence: 'unknown' }, { term: 'AI assistant', aliases: [], importance: 'must', evidence: 'yes' }] },
    sections: [
      ...(summary ? [{ id: 'p', kind: 'summary', title: 'Profile', hidden: false, items: [item({ detail: 'Founder who took a marketplace from 0 to 12,000 monthly users.' })] }] : []),
      { id: 'e', kind: 'experience', title: 'Experience', hidden: false, items: [item({ heading: 'Founder', org: 'Kiranaly', dates: '2021 - Present', bullets })] },
      { id: 'd', kind: 'education', title: 'Education', hidden: false, items: [item({ heading: 'B.Tech', org: 'NIT Trichy', dates: '2014 - 2018' })] },
      ...extra,
    ],
  };
}

test('facts: phone numbers are ignored, date ranges are kept as facts', () => {
  const f = cvFacts(CV);
  assert.ok(!f.has('98765') && !f.has('43210'), 'phone digits are not facts');
  for (const n of ['12000', '40', '5', '1', '900', '80', '2021', '2014', '2018']) assert.ok(f.has(n), n);
});

test('dropped facts are reported; reserve counts as kept but off the page', () => {
  const r = built({ bullets: ['Built an AI assistant that cut support tickets 40%'] });
  const fr = factRetention(r, CV);
  assert.deepEqual(fr.dropped.map((d) => d.value).sort(), ['1', '5', '80', '900'].sort()); // "5 to 1" counts both
  r.sections[1].items[0].reserve = ['Wrote a 900-line pricing engine covering 80+ cities; ops headcount 5 to 1'];
  const fr2 = factRetention(r, CV);
  assert.deepEqual(fr2.dropped, []);
  assert.equal(fr2.offPage.length, 4);
  assert.ok(compareIssues(built({ bullets: ['x'] }), CV).some((i) => i.code === 'fact-dropped' && /900/.test(i.message)));
});

test('a deleted profile and an untargeted sub-header are flagged', () => {
  const codes = compareIssues(built({ bullets: [], summary: false, tagline: "Founder's Office | 0-1 Ventures" }), CV).map((i) => i.code);
  assert.ok(codes.includes('summary-dropped'));
  assert.ok(codes.includes('headline-untargeted'));
  const ok = compareIssues(built({ bullets: [], summary: true, tagline: 'Founder and product builder · Applied AI products' }), CV).map((i) => i.code);
  assert.ok(!ok.includes('summary-dropped') && !ok.includes('headline-untargeted'));
});

test('hobbies and school results are flagged for professionals only', () => {
  const hobbies = { id: 'h', kind: 'extracurricular', title: 'Hobbies', hidden: false, items: [item({ heading: 'Formula 1, card games' })] };
  const school = { id: 's', kind: 'education', title: 'School', hidden: false, items: [item({ heading: 'Class XII (CBSE)', org: 'DPS' })] };
  const pro = compareIssues(built({ bullets: [], extra: [hobbies, school] }), CV).filter((i) => i.code === 'low-value-section');
  assert.equal(pro.length, 2);
  const student = compareIssues(built({ bullets: [], stage: 'recent', extra: [hobbies, school] }), CV).filter((i) => i.code === 'low-value-section');
  assert.equal(student.length, 0);
});

test('comparison panel: facts kept and job keywords before -> after', () => {
  const c = comparison(built({ bullets: ['Built an AI assistant that cut support tickets 40% and ops headcount from 5 to 1', 'Ran evals on 300 test questions'] }), CV);
  assert.equal(c.keywords.before, 1); // "AI assistant" was already in the CV
  assert.equal(c.keywords.after, 2); // "evals" now evidenced
  assert.ok(c.facts.kept < c.facts.total);
});

test('professionals get experience before education in academic formats too', () => {
  const secs = ['education', 'experience', 'skills'].map((kind) => ({ kind }));
  assert.deepEqual(orderForTemplate(secs, 'iitb', true).map((s) => s.kind), ['experience', 'education', 'skills']);
  assert.deepEqual(orderForTemplate(secs, 'iitb', false).map((s) => s.kind), ['education', 'experience', 'skills']);
  // Learning the person is experienced after the draft re-orders it.
  const r = emptyResume({ template: 'iima' });
  const it = (o) => ({ heading: 'x', org: 'y', location: '', dates: '', detail: '', note: '', bullets: [], reserve_bullets: [], user_wording: [], ...o });
  applyOp(r, 'create_resume', { header: {}, sections: [{ kind: 'experience', title: 'Experience', items: [it({})] }, { kind: 'education', title: 'Education', items: [it({})] }], confirm_replace: false });
  assert.equal(r.sections[0].kind, 'education');
  applyOp(r, 'set_profile', { job_families: ['Product'], current_role: 'Founder', years_experience: '10', industry: '', specialization: '', career_stage: 'experienced', target_role: '' });
  assert.equal(r.sections[0].kind, 'experience');
});

test('server: uploading a CV enables the comparison and fact checks', async () => {
  const app = createApp({ client: mockClient }).listen(0);
  await new Promise((r) => app.once('listening', r));
  const url = `http://localhost:${app.address().port}`;
  try {
    const s = await (await fetch(`${url}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ buildMode: 'upload', stage: 'experienced', template: 'pro', pages: 1 }) })).json();
    const fd = new FormData();
    fd.append('file', new Blob([CV]), 'cv.txt');
    const v = await (await fetch(`${url}/api/sessions/${s.id}/upload`, { method: 'POST', body: fd })).json();
    assert.ok(v.compare.facts.total > 5);
    assert.ok(v.issues.some((i) => i.code === 'fact-dropped'), 'the mock draft ignores the CV, so facts are reported missing');
    assert.ok(v.issues.some((i) => i.code === 'summary-dropped'));
  } finally {
    app.close();
  }
});

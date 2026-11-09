// CV verdict, purpose, fit assessment and "Apply anyway".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { emptyResume, applyOp, applyAnyway, cleanPurpose, OpError } from '../src/ops.js';
import { cvTextCounts, resumeCounts } from '../shared/lint.js';
import { createApp } from '../src/server.js';
import { mockClient } from '../src/mock-client.js';
import { closeLayout } from '../src/layout.js';

after(closeLayout);

test('purpose is validated: a role needs a name, otherwise general', () => {
  assert.deepEqual(cleanPurpose({ type: 'role', role: ' Product Manager ' }), { type: 'role', role: 'Product Manager' });
  assert.deepEqual(cleanPurpose({ type: 'role', role: '' }), { type: 'general', role: '' });
  assert.deepEqual(cleanPurpose({ type: 'jd', role: 'x' }), { type: 'jd', role: '' });
  assert.deepEqual(cleanPurpose(undefined), { type: '', role: '' });
});

test('fit: override survives re-assessment of the same target, resets for a new one; inconsistent verdicts are noted', () => {
  const r = emptyResume({});
  assert.throws(() => applyAnyway(r), OpError);
  const fit = (o) => ({ target: 'PM at X', level: 'weak', summary: 's', gaps: ['a'], decisive_question: 'q?', better_fit_roles: [], ...o });
  applyOp(r, 'assess_fit', fit());
  applyAnyway(r);
  applyOp(r, 'assess_fit', fit({ level: 'weak', decisive_question: '' }));
  assert.equal(r.assessment.fit.override, true);
  applyOp(r, 'assess_fit', fit({ target: 'Data Scientist' }));
  assert.equal(r.assessment.fit.override, false);
  r.target = { keywords: [{ term: 'SQL', importance: 'must', evidence: 'no' }, { term: 'Python', importance: 'must', evidence: 'no' }] };
  assert.match(applyOp(r, 'assess_fit', fit({ level: 'strong' })), /does not match/);
  assert.equal(r.assessment.fit.level, 'strong', 'the note informs; it does not override the model');
});

test('before/after counts measure real improvement', () => {
  const before = cvTextCounts(
    'Results-driven engineer who spearheaded various initiatives across teams\nReports were prepared every week by me for the leadership team\nI managed the vendor relationships for the logistics group',
  );
  assert.deepEqual(before, { 'ai-language': 1, 'ste-passive': 1, 'ste-length': 0, 'first-person': 2 });
  const r = { sections: [{ id: 's', kind: 'experience', items: [{ id: 'i', bullets: ['Wrote weekly reports for the leadership team', 'Managed relationships with 4 logistics vendors'], locked: [] }] }] };
  assert.deepEqual(resumeCounts(r), { 'ai-language': 0, 'ste-passive': 0, 'ste-length': 0, 'first-person': 0 });
});

test('server: purpose, measured quality after upload, weak fit, apply anyway', async () => {
  const app = createApp({ client: mockClient }).listen(0);
  await new Promise((r) => app.once('listening', r));
  const url = `http://localhost:${app.address().port}`;
  const post = (p, body = {}) => fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const { body: s } = await post('/api/sessions', { buildMode: 'upload', template: 'hbs', pages: 1, purpose: { type: 'role', role: 'Backend Engineer' } });
    assert.deepEqual(s.resume.settings.purpose, { type: 'role', role: 'Backend Engineer' });
    assert.equal((await post(`/api/sessions/${s.id}/apply-anyway`)).status, 400, 'nothing to override yet');

    const fd = new FormData();
    fd.append('file', new Blob(['Asha Verma\nResults-driven engineer who spearheaded various initiatives at Acme Logistics\nI was responsible for weekly delivery reports that were prepared by me']), 'cv.txt');
    const up = await (await fetch(`${url}/api/sessions/${s.id}/upload`, { method: 'POST', body: fd })).json();
    assert.equal(up.resume.assessment.cv.verdict, 'improve');
    assert.ok(up.quality.before['ai-language'] >= 1);
    assert.equal(up.quality.after['ai-language'], 0);

    const jd = new FormData();
    jd.append('text', 'Backend engineer role building payment services in Python with PostgreSQL on Kubernetes; 3+ years required. '.repeat(4));
    const v = await (await fetch(`${url}/api/sessions/${s.id}/jd`, { method: 'POST', body: jd })).json();
    assert.equal(v.resume.assessment.fit.level, 'weak');
    assert.match(v.resume.assessment.fit.question, /Kubernetes/);

    const any = await post(`/api/sessions/${s.id}/apply-anyway`);
    assert.equal(any.status, 200);
    assert.equal(any.body.resume.assessment.fit.override, true);
    assert.equal(any.body.chat.at(-2).text, 'Apply anyway: Backend Engineer at Example Co');
    assert.equal(any.body.canUndo, true);
  } finally {
    app.close();
  }
});

test('job description before the CV: ask for the CV, no fit verdict, no "haven\'t seen your resume"', async () => {
  // A scripted model that tries to judge fit right away; the server must stop it.
  const seen = [];
  const client = {
    beta: {
      messages: {
        stream(params) {
          seen.push(structuredClone(params.messages)); // the server appends to the same array later
          const last = params.messages[params.messages.length - 1];
          const isResult = last.content.some((b) => b.type === 'tool_result');
          const content = isResult
            ? [{ type: 'text', text: "Got the job. Now upload your current CV (PDF or Word). I'll tailor it to this job and tell you honestly how well you fit." }]
            : [
                { type: 'tool_use', id: 't1', name: 'set_target_job', input: { title: 'Product Manager', company: 'Profound', seniority: 'mid', keywords: [{ term: 'evals', aliases: [], importance: 'must', evidence: 'unknown' }] } },
                { type: 'tool_use', id: 't2', name: 'assess_fit', input: { target: 'Product Manager at Profound', level: 'very_weak', summary: 'No evidence.', gaps: ['evals'], decisive_question: '', better_fit_roles: [] } },
              ];
          return { finalMessage: async () => ({ content, stop_reason: isResult ? 'end_turn' : 'tool_use' }) };
        },
      },
    },
  };
  const app = createApp({ client }).listen(0);
  await new Promise((r) => app.once('listening', r));
  const url = `http://localhost:${app.address().port}`;
  try {
    const s = await (await fetch(`${url}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ buildMode: 'upload', stage: 'experienced', template: 'pro', pages: 1, purpose: { type: 'jd' } }) })).json();
    assert.match(s.chat[0].text, /job link or description, then upload your current CV/, 'the opener states the order');
    const jd = new FormData();
    jd.append('text', ['Product Manager, Applied AI', 'Profound', 'You will own evals for our LLM products and ship AI features to enterprise customers.', 'Requirements:', '- 3+ years of product management', '- Hands-on evals for LLM products', '- SQL and comfort with data', '- Experience working with engineers on AI features'].join('\n'));
    const r = await (await fetch(`${url}/api/sessions/${s.id}/jd`, { method: 'POST', body: jd })).json();
    const first = seen[0].at(-1).content.map((b) => b.text || '').join('\n');
    assert.match(first, /Ask me to upload my CV next/);
    assert.match(first, /Ask next: the user's CV/);
    assert.match(first, /Never say you haven't seen/);
    assert.match(first, /Evidence requests: none until the CV arrives/);
    const results = seen[1].at(-1).content;
    assert.equal(results.find((b) => b.tool_use_id === 't2').is_error, true, 'assess_fit refused before the CV');
    assert.ok(!r.resume.assessment?.fit, 'no fit verdict stored');
    assert.equal(r.resume.target.company, 'Profound', 'the job is still recorded');
    assert.equal(r.ask, null);
  } finally {
    app.close();
  }
});

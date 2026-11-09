// Evidence requests: ask for a story or proof for each required item the CV doesn't show.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { emptyResume, applyOp, OpError } from '../src/ops.js';
import { evidenceRequests, jdIssues, MAX_EVIDENCE_QUESTIONS } from '../shared/jd.js';
import { createApp } from '../src/server.js';
import { mockClient } from '../src/mock-client.js';
import { closeLayout } from '../src/layout.js';
import { SYSTEM_PROMPT } from '../src/prompt.js';

after(closeLayout);

const kw = (term, importance = 'must', evidence = 'unknown') => ({ term, aliases: [], importance, evidence });
const job = (keywords) => ({ title: 'PM, Applied AI', company: 'Profound', seniority: '', keywords });

test('the next request is the first required item with unknown evidence', () => {
  const r = emptyResume({});
  applyOp(r, 'set_target_job', job([kw('B2C', 'must', 'yes'), kw('evals'), kw('prototyping'), kw('Figma', 'nice')]));
  assert.equal(evidenceRequests(r).next.term, 'evals');
  applyOp(r, 'mark_requirement', { term: 'evals', outcome: 'has_evidence' });
  assert.equal(evidenceRequests(r).next.term, 'prototyping');
  applyOp(r, 'mark_requirement', { term: 'Prototyping', outcome: 'no_evidence' });
  assert.equal(evidenceRequests(r).next, null, 'nice-to-haves are not asked by default');
  assert.throws(() => applyOp(r, 'mark_requirement', { term: 'Kubernetes', outcome: 'no_evidence' }), OpError);
});

test('a skip sticks even when the agent re-reads the job', () => {
  const r = emptyResume({});
  applyOp(r, 'set_target_job', job([kw('evals'), kw('prototyping')]));
  applyOp(r, 'mark_requirement', { term: 'evals', outcome: 'no_evidence' });
  applyOp(r, 'set_target_job', job([kw('Evals'), kw('prototyping')])); // re-read, evidence "unknown" again
  const evals = r.target.keywords.find((k) => k.term === 'Evals');
  assert.equal(evals.status, 'skipped');
  assert.equal(evals.evidence, 'no');
  assert.equal(evidenceRequests(r).next.term, 'prototyping');
  const gap = jdIssues({ ...r, sections: [] }).find((i) => /Evals/.test(i.message));
  assert.match(gap.message, /you said you don't have it/);
});

test('questions are capped so it never becomes an interrogation', () => {
  const r = emptyResume({});
  const many = Array.from({ length: 10 }, (_, i) => kw(`skill${i}`));
  applyOp(r, 'set_target_job', job(many));
  for (let i = 0; i < MAX_EVIDENCE_QUESTIONS; i++) applyOp(r, 'mark_requirement', { term: `skill${i}`, outcome: 'no_evidence' });
  const e = evidenceRequests(r);
  assert.equal(e.next, null);
  assert.equal(e.open, 10 - MAX_EVIDENCE_QUESTIONS);
});

test('the prompt asks clearly, says why, and allows skip', () => {
  assert.match(SYSTEM_PROMPT, /This job requires <requirement>\. Can you tell me about a time you did this, or share any proof I can include/);
  assert.match(SYSTEM_PROMPT, /If you don't have anything, just say skip/);
  assert.match(SYSTEM_PROMPT, /never asked about again|Do not argue, rephrase the question or ask again/);
});

test('server: "I don\'t have this" records the skip before the model runs', async () => {
  const app = createApp({ client: mockClient }).listen(0);
  await new Promise((r) => app.once('listening', r));
  const url = `http://localhost:${app.address().port}`;
  const post = (p, body = {}) => fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const { body: s } = await post('/api/sessions', { buildMode: 'talk', stage: 'experienced', template: 'pro', pages: 1 });
    await post(`/api/sessions/${s.id}/message`, { text: 'I build backend systems' });
    const fd = new FormData();
    fd.append('text', 'Backend engineer role building payment services in Python with PostgreSQL on Kubernetes; 3+ years required. '.repeat(4));
    const v = await (await fetch(`${url}/api/sessions/${s.id}/jd`, { method: 'POST', body: fd })).json();
    assert.equal(v.evidence.next.term, 'Kubernetes');
    const r = await post(`/api/sessions/${s.id}/requirement`, { term: 'Kubernetes' });
    assert.equal(r.status, 200);
    const k = r.body.resume.target.keywords.find((x) => x.term === 'Kubernetes');
    assert.equal(k.status, 'skipped');
    assert.equal(r.body.evidence.next, null);
    assert.equal(r.body.chat.at(-2).text, "I don't have this: Kubernetes");
    assert.equal((await post(`/api/sessions/${s.id}/requirement`, { term: 'Nope' })).status, 400);
  } finally {
    app.close();
  }
});

// Fixes from the third evaluation: leaked markdown, unit mismatches, outcomes,
// the current-role check and the single "ask next" source.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { renderResume } from '../shared/render.js';
import { renderDocx } from '../src/docx.js';
import { lintResume } from '../shared/lint.js';
import { measureLayout, layoutAvailable, closeLayout } from '../src/layout.js';
import { createApp } from '../src/server.js';
import { mockClient } from '../src/mock-client.js';
import { sampleResume } from './fixtures/sample-resume.js';

after(closeLayout);

function withProfileBullet(r) {
  r.sections.unshift({ id: 'p', kind: 'summary', title: 'Profile', hidden: false, items: [{ id: 'pi', heading: '', org: '', location: '', dates: '', detail: '', note: '**Best Performer** 2019', bullets: ['Founder who built Wysa solo to **Rs 10L+ GMV in under 4 months**.'], reserve: [], hidden: false, locked: [] }] });
  r.sections[1].items[0].detail = 'Stack: **Go**, Kafka';
  r.sections[1].items[0].note = 'Award: **Spot Award** 2023';
  return r;
}

test('bold converts everywhere (profile bullets, details, notes); no markers reach HTML or DOCX', async () => {
  for (const tpl of ['iitb', 'iima', 'hbs', 'pro']) {
    const html = renderResume(withProfileBullet(sampleResume(tpl, 1)));
    const body = html.slice(html.indexOf('<div id="flow">'), html.indexOf('<script'));
    assert.doesNotMatch(body, /\*\*/, tpl);
    assert.match(body, /<b>Rs 10L\+ GMV in under 4 months<\/b>/, tpl);
  }
  const { default: JSZip } = await import('jszip');
  const xml = await (await JSZip.loadAsync(await renderDocx(withProfileBullet(sampleResume('pro', 1))))).file('word/document.xml').async('string');
  assert.doesNotMatch(xml, /\*\*/);
});

test('the profile renders as prose, not a bulleted list', () => {
  const html = renderResume(withProfileBullet(sampleResume('pro', 1)));
  const at = html.indexOf('Founder who built Wysa');
  const block = html.slice(html.lastIndexOf('<div class="blk', at), at);
  assert.match(block, /class="blk para"/);
});

test('visual QA fails if markup ever leaks onto the page', async (t) => {
  if (!(await layoutAvailable())) return t.skip('no headless browser');
  const r = sampleResume('pro', 1);
  r.header.tagline = 'Builder of **things';
  const l = await measureLayout(r);
  assert.ok(l.issues.some((i) => i.code === 'markup-leak'));
});

test('unit mismatches and missing outcomes are flagged', () => {
  const mk = (b) => ({ header: { name: 'A', email: 'a', phone: '1', tagline: 'T', location: 'P', links: ['linkedin.com/in/a'] }, sections: [{ id: 's', kind: 'experience', title: 'Experience', items: [{ id: 'i', heading: 'E', org: 'O', location: '', dates: '', detail: '', bullets: [b] }] }] });
  const codes = (b) => lintResume(mk(b), '').map((i) => i.code);
  assert.ok(codes('Improved NPS from 23 to 33% in Maharashtra').includes('unit-mismatch'));
  assert.ok(codes('Raised conversion from 2% to 3.5%').every((c) => c !== 'unit-mismatch'));
  assert.ok(codes('Built an LLM-powered US visa mock-interview simulator').includes('result-missing'));
  assert.ok(!codes('Built a mock-interview simulator used by 2,000 applicants').includes('result-missing'));
});

test('server: after a CV upload the first ask is "is this still your current job?"', async () => {
  const app = createApp({ client: mockClient }).listen(0);
  await new Promise((r) => app.once('listening', r));
  const url = `http://localhost:${app.address().port}`;
  try {
    const s = await (await fetch(`${url}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ buildMode: 'upload', stage: 'experienced', template: 'pro', pages: 1 }) })).json();
    const fd = new FormData();
    fd.append('file', new Blob(['Asha Verma\nSoftware Engineer, Acme Logistics, Jul 2023 - Present\nBuilt a tracking dashboard']), 'cv.txt');
    const v = await (await fetch(`${url}/api/sessions/${s.id}/upload`, { method: 'POST', body: fd })).json();
    assert.equal(v.ask.kind, 'currency');
    assert.match(v.ask.role, /Software Engineer at Acme Logistics/);
    const c = await (await fetch(`${url}/api/sessions/${s.id}/current`, { method: 'POST' })).json();
    assert.equal(c.resume.settings.currency, 'still_current');
    assert.notEqual(c.ask?.kind, 'currency');
    assert.equal(c.chat.at(-2).text, 'Yes, still my current job');
  } finally {
    app.close();
  }
});

// Setup: layout previews with made-up sample data, and changing the purpose
// when someone has no specific job yet.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { samplesFor } from '../src/samples.js';
import { FORMATS_BY_STAGE } from '../shared/templates.js';
import { renderResume } from '../shared/render.js';
import { measureLayout, layoutAvailable, closeLayout } from '../src/layout.js';
import { createApp } from '../src/server.js';
import { mockClient } from '../src/mock-client.js';

after(closeLayout);

test('samples: one per format offered at each stage, made-up people only', () => {
  for (const stage of ['recent', 'experienced']) {
    const samples = samplesFor(stage);
    assert.deepEqual(Object.keys(samples), FORMATS_BY_STAGE[stage]);
    for (const [id, r] of Object.entries(samples)) {
      assert.equal(r.settings.template, id);
      assert.equal(r.settings.pages, 1);
      assert.match(r.header.email, /@example\.com$/, 'sample contact details must not be real');
      assert.ok(renderResume(r, {}).includes(r.header.name));
    }
  }
  assert.equal(samplesFor('recent').pro.sections[0].kind, 'experience', 'the experienced layout keeps its own order for a graduate');
  assert.equal(samplesFor('recent').iitb.sections[0].kind, 'education');
  assert.deepEqual(Object.keys(samplesFor('nonsense')), FORMATS_BY_STAGE.recent, 'unknown stage falls back');
});

test('samples fill one page in every layout, with no layout warnings', async (t) => {
  if (!(await layoutAvailable())) return t.skip('no headless browser');
  for (const stage of ['recent', 'experienced']) {
    for (const [id, r] of Object.entries(samplesFor(stage))) {
      const l = await measureLayout(r);
      assert.equal(l.fits, true, `${stage}/${id} fits`);
      assert.equal(l.pages, 1, `${stage}/${id} is one page`);
      assert.deepEqual((l.issues || []).map((i) => i.code), [], `${stage}/${id} has no layout warnings`);
    }
  }
});

test('server: samples endpoint, and "I don\'t have a job yet" switches the purpose and the opening line', async () => {
  const app = createApp({ client: mockClient }).listen(0);
  await new Promise((r) => app.once('listening', r));
  const url = `http://localhost:${app.address().port}`;
  const post = (p, body = {}) => fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const samples = await (await fetch(`${url}/api/samples/experienced`)).json();
    assert.deepEqual(Object.keys(samples), ['pro', 'hbs']);

    const { body: s } = await post('/api/sessions', { buildMode: 'upload', stage: 'recent', template: 'pro', pages: 1, purpose: { type: 'jd' } });
    assert.equal(s.resume.settings.template, 'pro', 'a graduate may choose the experienced layout');
    assert.match(s.chat[0].text, /job link or description/);
    const r = await post(`/api/sessions/${s.id}/purpose`, { purpose: { type: 'general' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.resume.settings.purpose, { type: 'general', role: '' });
    assert.match(r.body.chat[0].text, /^Upload your current CV/, 'the opener no longer asks for a job');
    assert.equal((await post(`/api/sessions/${s.id}/purpose`, { purpose: { type: 'nope' } })).status, 400);

    // Talk mode: the opening question does not mention a job, so it stays.
    const { body: t2 } = await post('/api/sessions', { buildMode: 'talk', stage: 'experienced', template: 'pro', pages: 1, purpose: { type: 'jd' } });
    const r2 = await post(`/api/sessions/${t2.id}/purpose`, { purpose: { type: 'role', role: 'Product Manager' } });
    assert.deepEqual(r2.body.resume.settings.purpose, { type: 'role', role: 'Product Manager' });
    assert.equal(r2.body.chat[0].text, t2.chat[0].text);
  } finally {
    app.close();
  }
});

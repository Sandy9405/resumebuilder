import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { mockClient } from '../src/mock-client.js';
import { closeLayout } from '../src/layout.js';

let server, base;
before(async () => {
  server = createApp({ client: mockClient }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  server.close();
  await closeLayout();
});

const post = (p, body = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('full flow: create session, draft, format switch, manual edit, exports', async () => {
  const { body: s } = await post('/api/sessions', { buildMode: 'talk', template: 'iitb', pages: 1 });
  assert.equal(s.resume.settings.template, 'iitb');
  assert.equal(s.chat[0].role, 'assistant');

  const { status, body: t1 } = await post(`/api/sessions/${s.id}/message`, { text: 'I am a software engineer at Acme', spoken: true });
  assert.equal(status, 200);
  assert.ok(t1.resume.sections.length >= 3);
  assert.ok(t1.changes[0].startsWith('Created draft'));
  // Sample data contains numbers the user never said: the check must catch them.
  assert.ok(t1.issues.some((i) => i.code === 'unverified-number'));

  const { body: t2 } = await post(`/api/sessions/${s.id}/message`, { text: 'show it in hbs, two pages' });
  assert.equal(t2.resume.settings.template, 'hbs');
  assert.equal(t2.resume.settings.pages, 2);

  const exp = t2.resume.sections.find((x) => x.kind === 'experience');
  const { body: e } = await post(`/api/sessions/${s.id}/edit`, { path: `${exp.id}.${exp.items[0].id}.dates`, value: 'Aug 2023 – Present' });
  assert.equal(e.resume.sections.find((x) => x.kind === 'experience').items[0].dates, 'Aug 2023 – Present');

  const bad = await post(`/api/sessions/${s.id}/edit`, { path: 'nope.x.y', value: 'z' });
  assert.equal(bad.status, 400);

  // Undo the manual edit, then the format switch; redo the edit.
  const u1 = await post(`/api/sessions/${s.id}/undo`);
  assert.equal(u1.body.resume.sections.find((x) => x.kind === 'experience').items[0].dates, 'Jul 2023 – Present');
  assert.equal(u1.body.canRedo, true);
  const u2 = await post(`/api/sessions/${s.id}/undo`);
  assert.equal(u2.body.resume.settings.template, 'iitb');
  const r1 = await post(`/api/sessions/${s.id}/redo`);
  assert.equal(r1.body.resume.settings.template, 'hbs');
  if (r1.body.layout) assert.equal(typeof r1.body.layout.pages, 'number');

  const docx = await fetch(`${base}/api/sessions/${s.id}/export.docx`);
  assert.equal(docx.status, 200);
  const pdf = await fetch(`${base}/api/sessions/${s.id}/export.pdf`);
  assert.ok([200, 501].includes(pdf.status));
  if (pdf.status === 200) assert.ok(Number(pdf.headers.get('X-Page-Count')) >= 1);
});

test('upload a text CV', async () => {
  const { body: s } = await post('/api/sessions', { buildMode: 'upload', template: 'hbs', pages: 1 });
  const fd = new FormData();
  fd.append('file', new Blob(['Asha Verma\nSoftware Engineer, Acme, 2023 - present\nCut report time from 6 hours to 1 hour']), 'cv.txt');
  const r = await fetch(`${base}/api/sessions/${s.id}/upload`, { method: 'POST', body: fd });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.ok(body.resume.sections.length);

  const fd2 = new FormData();
  fd2.append('file', new Blob(['x']), 'photo.png');
  const r2 = await fetch(`${base}/api/sessions/${s.id}/upload`, { method: 'POST', body: fd2 });
  assert.equal(r2.status, 400);
});

test('unknown session is a 404', async () => {
  const r = await fetch(`${base}/api/sessions/does-not-exist`);
  assert.equal(r.status, 404);
});

test('health is public; APP_PASSWORD protects everything else', async () => {
  process.env.APP_PASSWORD = 's3cret';
  const locked = createApp({ client: mockClient }).listen(0);
  await new Promise((r) => locked.once('listening', r));
  const url = `http://localhost:${locked.address().port}`;
  try {
    assert.equal((await fetch(`${url}/health`)).status, 200);
    assert.equal((await fetch(`${url}/`)).status, 401);
    assert.equal((await fetch(`${url}/`, { headers: { Authorization: `Basic ${Buffer.from('x:wrong').toString('base64')}` } })).status, 401);
    const ok = await fetch(`${url}/`, { headers: { Authorization: `Basic ${Buffer.from('anyone:s3cret').toString('base64')}` } });
    assert.equal(ok.status, 200);
  } finally {
    delete process.env.APP_PASSWORD;
    locked.close();
  }
});

test('without a Sarvam key the browser is told to use its own recognition', async () => {
  const saved = process.env.SARVAM_API_KEY;
  delete process.env.SARVAM_API_KEY;
  const plain = createApp({ client: mockClient }).listen(0);
  await new Promise((r) => plain.once('listening', r));
  const url = `http://localhost:${plain.address().port}`;
  try {
    assert.equal((await (await fetch(`${url}/api/voice`)).json()).provider, 'browser');
    const { body: s } = await post('/api/sessions', { buildMode: 'talk', template: 'hbs', pages: 1 });
    const fd = new FormData();
    fd.append('audio', new Blob([new Uint8Array(10)], { type: 'audio/webm' }), 'c.webm');
    const r = await fetch(`${url}/api/sessions/${s.id}/transcribe`, { method: 'POST', body: fd });
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /not set up/);
  } finally {
    if (saved !== undefined) process.env.SARVAM_API_KEY = saved;
    plain.close();
  }
});

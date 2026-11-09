// Sarvam speech-to-text: provider switch, key terms, endpoint, errors.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { voiceTerms } from '../src/voice.js';
import { createApp } from '../src/server.js';
import { mockClient } from '../src/mock-client.js';
import { closeLayout } from '../src/layout.js';
import { SarvamAIError } from 'sarvamai';

after(closeLayout);

test('key terms: employers, target job terms and CV names; deduped, capped at 50, max 64 chars', () => {
  const session = {
    cvText: 'Full-stack, solo: React 19, FastAPI, MongoDB, Railway\nPartners: MakeMyTrip, Visa2Fly, UseTeleport',
    resume: {
      sections: [{ kind: 'experience', items: [{ org: 'Scapia' }, { org: 'Leverage Edu' }, { org: 'scapia' }, { org: 'x'.repeat(65) }] }],
      target: { company: 'Profound', keywords: [{ term: 'evals' }, { term: 'FastAPI' }] },
    },
  };
  const terms = voiceTerms(session);
  for (const t of ['Scapia', 'Leverage Edu', 'Profound', 'evals', 'FastAPI', 'Railway', 'MakeMyTrip', 'Visa2Fly']) assert.ok(terms.includes(t), t);
  assert.equal(terms.filter((t) => t.toLowerCase() === 'scapia').length, 1);
  assert.equal(terms.filter((t) => t === 'FastAPI').length, 1);
  assert.ok(terms.every((t) => t.length <= 64));
  const many = { cvText: '', resume: { sections: [{ kind: 'experience', items: Array.from({ length: 80 }, (_, i) => ({ org: `Org${i}` })) }] } };
  assert.equal(voiceTerms(many).length, 50);
});

async function server(voiceClient) {
  const app = createApp({ client: mockClient, voiceClient }).listen(0);
  await new Promise((r) => app.once('listening', r));
  return { app, url: `http://localhost:${app.address().port}` };
}
const newSession = async (url) => (await (await fetch(`${url}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ buildMode: 'upload', stage: 'experienced', template: 'pro', pages: 1 }) })).json()).id;
const clip = () => {
  const fd = new FormData();
  fd.append('audio', new Blob([new Uint8Array(2048)], { type: 'audio/webm' }), 'clip.webm');
  return fd;
};

test('transcribe sends the clip with saaras:v4, codemix and the user\'s names', async () => {
  const calls = [];
  const fake = { speechToText: { transcribe: async (req) => (calls.push(req), { transcript: ' At Scapia I grew GMV 14X. ', language_code: 'en-IN' }) } };
  const { app, url } = await server(fake);
  try {
    assert.equal((await (await fetch(`${url}/api/voice`)).json()).provider, 'sarvam');
    const id = await newSession(url);
    const cv = new FormData();
    cv.append('file', new Blob(['Asha Verma\nBusiness Growth, Scapia, 2025 - Present\nStack: FastAPI, MongoDB, Railway']), 'cv.txt');
    await fetch(`${url}/api/sessions/${id}/upload`, { method: 'POST', body: cv });
    const r = await (await fetch(`${url}/api/sessions/${id}/transcribe`, { method: 'POST', body: clip() })).json();
    assert.deepEqual(r, { transcript: 'At Scapia I grew GMV 14X.', language: 'en-IN' });
    const req = calls[0];
    assert.equal(req.model, 'saaras:v4');
    assert.equal(req.mode, 'codemix');
    assert.equal(req.language_code, 'unknown');
    assert.ok(req.keyterms.includes('FastAPI') && req.keyterms.includes('Railway'), JSON.stringify(req.keyterms));
    assert.equal(req.file.type, 'audio/webm');
    assert.equal((await fetch(`${url}/api/sessions/${id}/transcribe`, { method: 'POST', body: new FormData() })).status, 400);
  } finally {
    app.close();
  }
});

test('Sarvam errors become clear messages, not crashes', async () => {
  const fake = { speechToText: { transcribe: async () => { throw new SarvamAIError({ message: 'nope', statusCode: 401, body: {} }); } } };
  const { app, url } = await server(fake);
  try {
    const id = await newSession(url);
    const r = await fetch(`${url}/api/sessions/${id}/transcribe`, { method: 'POST', body: clip() });
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /not authorised/);
  } finally {
    app.close();
  }
});

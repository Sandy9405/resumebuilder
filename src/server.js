import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { emptyResume, applyOp, applyManualEdit, OpError, pushHistory, snapshot, undo, redo, applyAnyway } from './ops.js';
import { runTurn, describeApiError, setClient } from './agent.js';
import { lintResume, cvTextCounts, resumeCounts } from '../shared/lint.js';
import { jdIssues, jdCoverage, evidenceRequests } from '../shared/jd.js';
import { compareIssues, comparison } from '../shared/compare.js';
import { nextAsk, awaitingCv } from './ask.js';
import { transcribe, voiceProvider, voiceTerms, VoiceError, setVoiceClient, MAX_CLIP_BYTES } from './voice.js';
import { jobFromUrl, jobFromFile, jobFromText, JdError } from './jd.js';
import { ExtractError, extractDocument } from './extract.js';
import { measureLayout, renderPdf, layoutAvailable } from './layout.js';
import { renderDocx } from './docx.js';
import { renderResume } from '../shared/render.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// Sessions live in memory. Fine for a single instance; swap for a store
// (Redis, Postgres) before running more than one server process.
const sessions = new Map();
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) if (s.touched < cutoff) sessions.delete(id);
}, 10 * 60 * 1000).unref();

function view(s) {
  return {
    id: s.id,
    resume: s.resume,
    layout: s.layout,
    // Content, ATS and job-match checks; visual QA lives in layout (the browser recomputes it live).
    issues: [...compareIssues(s.resume, s.cvText), ...lintResume(s.resume, s.sourceText), ...jdIssues(s.resume)],
    compare: s.resume.sections.length ? comparison(s.resume, s.cvText) : null,
    jd: s.jd ? { source: s.jd.source, title: s.jd.title, company: s.jd.company, chars: s.jd.text.length } : null,
    coverage: jdCoverage(s.resume),
    evidence: s.resume.target ? evidenceRequests(s.resume) : null,
    ask: s.resume.sections.length ? nextAsk(s) : null,
    // Measured before/after quality, when the user uploaded a CV.
    quality: s.baseline && s.resume.sections.length ? { before: s.baseline, after: resumeCounts(s.resume) } : null,
    chat: s.chat,
    canUndo: s.undo.length > 0,
    canRedo: s.redo.length > 0,
  };
}

const OPENERS = {
  upload: "Upload your current CV and I'll turn it into a first draft. I'll keep every fact and rewrite how it's presented.",
  talk: "Let's start with where you are now. What's your current or most recent role (or your degree, if you're a student), and what does a typical week involve?",
  both: 'Upload your current CV first. Once the draft is up, you can talk me through anything missing or out of date.',
};

const OPENER_JD_UPLOAD = "Add the job link or description, then upload your current CV. I'll tailor the CV to the job and tell you honestly how well you fit.";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_CLIP_BYTES } });

export function createApp({ client, voiceClient } = {}) {
  if (client) setClient(client);
  if (voiceClient) setVoiceClient(voiceClient);
  const app = express();
  app.disable('x-powered-by');

  // Health check for the host (Railway). Registered before auth so it stays reachable.
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Optional shared password. Without one, anyone with the URL can spend your
  // Anthropic credits. Browsers show their own login prompt (HTTP Basic auth).
  const password = process.env.APP_PASSWORD;
  if (password) {
    const expected = Buffer.from(password);
    app.use((req, res, next) => {
      const [scheme, encoded] = (req.headers.authorization || '').split(' ');
      const given = scheme === 'Basic' && encoded ? Buffer.from(Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':')) : Buffer.alloc(0);
      if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
      res.set('WWW-Authenticate', 'Basic realm="Resume Builder", charset="UTF-8"');
      res.status(401).send('Password required.');
    });
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(root, 'public')));
  app.use('/shared', express.static(path.join(root, 'shared')));

  const getSession = (req, res, next) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found or expired. Start a new resume.' });
    s.touched = Date.now();
    req.s = s;
    next();
  };

  // One model turn at a time per session; a second request would interleave history.
  async function turn(req, res, userBlocks, chatText) {
    const s = req.s;
    if (s.busy) return res.status(409).json({ error: 'Still working on your last message.' });
    s.busy = true;
    const before = s.messages.length;
    s.chat.push({ role: 'user', text: chatText });
    if (s.messages.length === 0) {
      // The opening question was shown by the app; let the model see what the user is answering.
      userBlocks = [{ type: 'text', text: `(The app opened the conversation with: "${s.opener}")` }, ...userBlocks];
    }
    try {
      const { reply, changes } = await runTurn(s, userBlocks);
      s.chat.push({ role: 'assistant', text: reply, changes });
      res.json({ ...view(s), reply, changes });
    } catch (err) {
      // If nothing reached the model, drop the unsent user message so a retry doesn't duplicate it.
      if (s.messages.length === before + 1) s.messages.pop();
      s.chat.pop();
      const msg = describeApiError(err);
      if (!msg) console.error(err);
      res.status(502).json({ error: msg || 'Something went wrong while updating your resume.' });
    } finally {
      s.busy = false;
    }
  }

  app.post('/api/sessions', (req, res) => {
    const { template, pages, buildMode, purpose, stage } = req.body || {};
    const mode = ['upload', 'talk', 'both'].includes(buildMode) ? buildMode : 'talk';
    const opener = purpose?.type === 'jd' && mode !== 'talk' ? OPENER_JD_UPLOAD : OPENERS[mode];
    const s = {
      id: randomUUID(),
      opener,
      resume: emptyResume({ template, pages: Number(pages), buildMode: mode, purpose, stage }),
      messages: [],
      chat: [{ role: 'assistant', text: opener }],
      sourceText: '',
      layout: null,
      undo: [],
      redo: [],
      pendingNotes: [],
      jd: null,
      baseline: null,
      cvText: '',
      busy: false,
      touched: Date.now(),
    };
    sessions.set(s.id, s);
    res.json(view(s));
  });

  app.get('/api/sessions/:id', getSession, (req, res) => res.json(view(req.s)));

  // Which speech-to-text the browser should use: Sarvam via this server, or the
  // browser's own recognition when no key is configured (e.g. local development).
  app.get('/api/voice', (_req, res) => res.json({ provider: voiceProvider() }));

  // One recorded clip (under 30 seconds) -> text. Names from the user's CV and
  // target job are sent as key terms so they are spelled right.
  app.post('/api/sessions/:id/transcribe', getSession, audioUpload.single('audio'), async (req, res) => {
    if (voiceProvider() !== 'sarvam') return res.status(503).json({ error: 'Voice transcription is not set up on this server. Please type instead.' });
    if (!req.file?.size) return res.status(400).json({ error: 'No audio received.' });
    try {
      res.json(await transcribe(req.file.buffer, req.file.mimetype, voiceTerms(req.s)));
    } catch (err) {
      if (err instanceof VoiceError) return res.status(502).json({ error: err.message });
      throw err;
    }
  });

  app.post('/api/sessions/:id/message', getSession, async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Empty message.' });
    if (text.length > 20000) return res.status(400).json({ error: 'Message too long.' });
    const spoken = !!req.body?.spoken;
    req.s.sourceText += `\n${text}`;
    await turn(req, res, [{ type: 'text', text: spoken ? `(spoken) ${text}` : text }], text);
  });

  app.post('/api/sessions/:id/upload', getSession, upload.single('file'), async (req, res) => {
    const f = req.file;
    if (!f) return res.status(400).json({ error: 'No file received.' });
    const name = f.originalname || 'resume';
    const note = String(req.body?.note || '').trim();
    let extracted;
    try {
      extracted = await extractDocument(f.buffer, name, f.mimetype);
    } catch (err) {
      if (err instanceof ExtractError) return res.status(400).json({ error: err.message });
      throw err;
    }
    const { kind, text, links } = extracted;
    if (!text.trim() && kind !== 'pdf') return res.status(400).json({ error: 'That file has no readable text.' });
    // Send a PDF itself: the model reads layout and scanned pages better than extracted text.
    const doc =
      kind === 'pdf'
        ? { type: 'document', title: name, source: { type: 'base64', media_type: 'application/pdf', data: f.buffer.toString('base64') } }
        : { type: 'document', title: name, source: { type: 'text', media_type: 'text/plain', data: text } };
    req.s.sourceText += `\n${text}\n${links.join('\n')}\n${note}`;
    if (text.trim()) {
      req.s.baseline = cvTextCounts(text);
      req.s.cvText = `${req.s.cvText}\n${text}`.trim();
    }
    const lowText = text.replace(/\s/g, '').length < 200;
    const prompt =
      `I've uploaded my current CV (${name}).` +
      (req.s.resume.target ? ' Tailor it to the job I gave you: fill in evidence for its keywords from this CV, assess my fit, then ask about requirements you still cannot find.' : '') +
      (links.length ? `\n(App note: links found in the file, including any hidden behind words like "LinkedIn": ${links.join(', ')}. Put the profile and portfolio links in the header.)` : '') +
      (lowText && kind === 'pdf'
        ? ' (App note: almost no text could be extracted from this PDF, so it may be scanned. Read it carefully and ask about anything unclear.)'
        : '') +
      (note ? `\n\n${note}` : '');
    await turn(req, res, [doc, { type: 'text', text: prompt }], `Uploaded ${name}${note ? `: ${note}` : ''}`);
  });

  // Target a job description: a link, an uploaded file, or pasted text.
  // The JD is NOT added to sourceText: its numbers and skills are the employer's,
  // not evidence of what the user did.
  app.post('/api/sessions/:id/jd', getSession, upload.single('file'), async (req, res) => {
    if (req.s.busy) return res.status(409).json({ error: 'Still working on your last message.' });
    const { url, text } = req.body || {};
    let job;
    try {
      if (req.file) job = await jobFromFile(req.file.buffer, req.file.originalname, req.file.mimetype);
      else if (url) job = await jobFromUrl(url);
      else job = jobFromText(text);
    } catch (err) {
      if (err instanceof JdError || err instanceof ExtractError) return res.status(400).json({ error: err.message });
      throw err;
    }
    req.s.jd = job;
    const label = [job.title, job.company].filter(Boolean).join(' at ') || job.source;
    const doc = { type: 'document', title: `Job description: ${label}`, source: { type: 'text', media_type: 'text/plain', data: job.text } };
    const noMaterial = !req.s.resume.sections.length && !req.s.cvText.trim();
    const ask = awaitingCv(req.s)
      ? `I want to apply for this job (${job.source}). Record the target job and its keywords now; set evidence to unknown, because you haven't seen my CV yet. Don't assess fit or ask about requirements yet. Ask me to upload my CV next.`
      : noMaterial
        ? `I want to apply for this job (${job.source}). Record the target job and its keywords (evidence unknown for now), then interview me with this job in mind, starting with my current or most recent role. Don't assess fit until you know my experience. Do not add anything I haven't told you.`
        : `I want to apply for this job (${job.source}). Tailor my resume to it: record the target job and its keywords, show my relevant experience first in the job's language where it is true, and ask me about requirements you can't find evidence for. Do not add anything I haven't told you.`;
    await turn(req, res, [doc, { type: 'text', text: ask }], `Target job: ${label}`);
  });

  // "I don't have this" on a job requirement: recorded before the model runs, so
  // the skip is guaranteed to stick; then the agent moves to the next item.
  app.post('/api/sessions/:id/requirement', getSession, async (req, res) => {
    if (req.s.busy) return res.status(409).json({ error: 'Still working on your last message.' });
    const term = String(req.body?.term || '');
    const before = snapshot(req.s.resume);
    try {
      applyOp(req.s.resume, 'mark_requirement', { term, outcome: 'no_evidence' });
    } catch (err) {
      if (err instanceof OpError) return res.status(400).json({ error: err.message });
      throw err;
    }
    pushHistory(req.s, before);
    await turn(
      req,
      res,
      [{ type: 'text', text: `(App note: the user pressed "I don't have this" for "${term}"; it is already recorded as no_evidence.) I don't have anything for ${term}. Skip it.` }],
      `I don't have this: ${term}`,
    );
  });

  // "Yes, still my current job": recorded before the model runs.
  app.post('/api/sessions/:id/current', getSession, async (req, res) => {
    if (req.s.busy) return res.status(409).json({ error: 'Still working on your last message.' });
    const before = snapshot(req.s.resume);
    applyOp(req.s.resume, 'confirm_current_role', { status: 'still_current' });
    pushHistory(req.s, before);
    await turn(req, res, [{ type: 'text', text: '(App note: the user confirmed their latest role is still current.) Yes, that is still my current job.' }], 'Yes, still my current job');
  });

  // The user chose to apply despite a weak fit: tailor honestly anyway.
  app.post('/api/sessions/:id/apply-anyway', getSession, async (req, res) => {
    if (req.s.busy) return res.status(409).json({ error: 'Still working on your last message.' });
    const before = snapshot(req.s.resume);
    try {
      applyAnyway(req.s.resume);
    } catch (err) {
      if (err instanceof OpError) return res.status(400).json({ error: err.message });
      throw err;
    }
    pushHistory(req.s, before);
    const target = req.s.resume.assessment.fit.target || 'this role';
    await turn(
      req,
      res,
      [{ type: 'text', text: `(App note: the user pressed "Apply anyway" for ${target}.) I want to apply anyway. Tailor my resume for it as well as you honestly can, and tell me which gaps to address in my cover letter or interview.` }],
      `Apply anyway: ${target}`,
    );
  });

  app.delete('/api/sessions/:id/jd', getSession, async (req, res) => {
    if (req.s.busy) return res.status(409).json({ error: 'Still working on your last message.' });
    const before = snapshot(req.s.resume);
    req.s.jd = null;
    applyOp(req.s.resume, 'clear_target_job', {});
    if (pushHistory(req.s, before)) req.s.pendingNotes.push('The user removed the job description. Stop tailoring to it; keep the resume content as it is unless asked.');
    res.json(view(req.s));
  });

  // Direct edits typed into the preview. User-typed text counts as source material.
  app.post('/api/sessions/:id/edit', getSession, async (req, res) => {
    const { path: p, value } = req.body || {};
    const before = snapshot(req.s.resume);
    try {
      applyManualEdit(req.s.resume, String(p || ''), value);
    } catch (err) {
      if (err instanceof OpError) return res.status(400).json({ error: err.message });
      throw err;
    }
    req.s.sourceText += `\n${value}`;
    if (pushHistory(req.s, before)) req.s.pendingNotes.push(`The user edited the text directly at ${p}. Treat the new wording as theirs.`);
    req.s.layout = await measureLayout(req.s.resume);
    res.json(view(req.s));
  });

  // Template / page toggles from the toolbar: no model call needed.
  app.post('/api/sessions/:id/format', getSession, async (req, res) => {
    const r = req.s.resume;
    const before = snapshot(r);
    applyOp(r, 'set_format', {
      template: req.body?.template || r.settings.template,
      pages: Number(req.body?.pages) || r.settings.pages,
    });
    if (pushHistory(req.s, before)) {
      req.s.pendingNotes.push(`The user switched the format to ${r.settings.template.toUpperCase()}, ${r.settings.pages} page(s), from the toolbar.`);
    }
    req.s.layout = await measureLayout(r);
    res.json(view(req.s));
  });

  for (const [route, fn, verb] of [['undo', undo, 'undid'], ['redo', redo, 'redid']]) {
    app.post(`/api/sessions/:id/${route}`, getSession, async (req, res) => {
      if (req.s.busy) return res.status(409).json({ error: 'Still working on your last message.' });
      if (!fn(req.s)) return res.status(400).json({ error: `Nothing to ${route}.` });
      req.s.pendingNotes.push(`The user ${verb} a change. The resume state below is now current; do not reapply the reverted change unless asked.`);
      req.s.layout = await measureLayout(req.s.resume);
      res.json(view(req.s));
    });
  }

  const fileBase = (s) => (s.resume.header.name || 'resume').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'resume';

  app.get('/api/sessions/:id/export.pdf', getSession, async (req, res) => {
    if (!req.s.resume.sections.length) return res.status(400).json({ error: 'Nothing to export yet.' });
    if (!(await layoutAvailable())) return res.status(501).json({ error: 'PDF export is not available on this server.' });
    const { pdf, pages, layout } = await renderPdf(req.s.resume);
    res.set('X-Page-Count', String(pages));
    res.set('X-Page-Limit', String(layout.limit));
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${fileBase(req.s)}.pdf"`);
    res.send(pdf);
  });

  app.get('/api/sessions/:id/export.docx', getSession, async (req, res) => {
    if (!req.s.resume.sections.length) return res.status(400).json({ error: 'Nothing to export yet.' });
    const buf = await renderDocx(req.s.resume);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="${fileBase(req.s)}.docx"`);
    res.send(buf);
  });

  app.get('/api/sessions/:id/print', getSession, (req, res) => {
    res.type('html').send(renderResume(req.s.resume).replace('</body>', '<script>print()</script></body>'));
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let client;
  if (process.env.MOCK_CLAUDE === '1') {
    ({ mockClient: client } = await import('./mock-client.js'));
    console.log('MOCK_CLAUDE=1: using the scripted development client, not Claude.');
  }
  const port = Number(process.env.PORT) || 3000;
  if (!process.env.ANTHROPIC_API_KEY && !client) console.warn('ANTHROPIC_API_KEY is not set: chat and CV upload will fail until it is.');
  if (!process.env.APP_PASSWORD) console.warn('APP_PASSWORD is not set: anyone with the URL can use the app and your API credits.');
  createApp({ client }).listen(port, '0.0.0.0', () => console.log(`Resume builder listening on port ${port}`));
}

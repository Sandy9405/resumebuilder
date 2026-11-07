import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

import { emptyResume, applyOp, applyManualEdit, OpError, pushHistory, snapshot, undo, redo } from './ops.js';
import { runTurn, describeApiError, setClient } from './agent.js';
import { lintResume } from '../shared/lint.js';
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
    // Content checks only; visual QA lives in layout (the browser recomputes it live).
    issues: lintResume(s.resume, s.sourceText),
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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

export function createApp({ client } = {}) {
  if (client) setClient(client);
  const app = express();
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
    const { template, pages, buildMode } = req.body || {};
    const mode = ['upload', 'talk', 'both'].includes(buildMode) ? buildMode : 'talk';
    const opener = OPENERS[mode];
    const s = {
      id: randomUUID(),
      opener,
      resume: emptyResume({ template, pages: Number(pages), buildMode: mode }),
      messages: [],
      chat: [{ role: 'assistant', text: opener }],
      sourceText: '',
      layout: null,
      undo: [],
      redo: [],
      pendingNotes: [],
      busy: false,
      touched: Date.now(),
    };
    sessions.set(s.id, s);
    res.json(view(s));
  });

  app.get('/api/sessions/:id', getSession, (req, res) => res.json(view(req.s)));

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
    let doc;
    let text = '';
    try {
      if (f.mimetype === 'application/pdf' || /\.pdf$/i.test(name)) {
        const pdf = await getDocumentProxy(new Uint8Array(f.buffer));
        text = (await extractText(pdf, { mergePages: true })).text || '';
        // Send the PDF itself: the model reads layout and scanned pages better than extracted text.
        doc = { type: 'document', title: name, source: { type: 'base64', media_type: 'application/pdf', data: f.buffer.toString('base64') } };
      } else if (/\.docx$/i.test(name)) {
        text = (await mammoth.extractRawText({ buffer: f.buffer })).value || '';
        doc = { type: 'document', title: name, source: { type: 'text', media_type: 'text/plain', data: text } };
      } else if (/\.(txt|md)$/i.test(name) || f.mimetype?.startsWith('text/')) {
        text = f.buffer.toString('utf8');
        doc = { type: 'document', title: name, source: { type: 'text', media_type: 'text/plain', data: text } };
      } else {
        return res.status(400).json({ error: 'Please upload a PDF, DOCX or TXT file.' });
      }
    } catch (err) {
      console.error(err);
      return res.status(400).json({ error: 'Could not read that file. Is it a valid PDF or DOCX?' });
    }
    if (!text.trim() && doc.source.type === 'text') {
      return res.status(400).json({ error: 'That file has no readable text.' });
    }
    req.s.sourceText += `\n${text}\n${note}`;
    const lowText = text.replace(/\s/g, '').length < 200;
    const prompt =
      `I've uploaded my current CV (${name}).` +
      (lowText && doc.source.type === 'base64'
        ? ' (Note from the app: almost no text could be extracted from this PDF, so it may be scanned. Read it carefully and ask about anything unclear.)'
        : '') +
      (note ? `\n\n${note}` : '');
    await turn(req, res, [doc, { type: 'text', text: prompt }], `Uploaded ${name}${note ? `: ${note}` : ''}`);
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
  createApp({ client }).listen(port, () => console.log(`Resume builder on http://localhost:${port}`));
}

import { renderResume } from '/shared/render.js';
import { TEMPLATES, getTemplate, PAGE, MM_TO_PX, printableHeightPx } from '/shared/templates.js';

const $ = (s) => document.querySelector(s);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

let S = null; // current session view from the server
let busy = false;

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- Setup ----------
function buildSetup() {
  $('#templateCards').innerHTML = Object.values(TEMPLATES)
    .map(
      (t, i) => `<label class="card"><input type="radio" name="template" value="${t.id}" ${i === 0 ? 'checked' : ''}>
      <b>${t.label}</b><span>${t.blurb}</span></label>`,
    )
    .join('');
  $('#templateSel').innerHTML = Object.values(TEMPLATES).map((t) => `<option value="${t.id}">${t.label}</option>`).join('');
}

async function start() {
  const val = (n) => document.querySelector(`input[name="${n}"]:checked`).value;
  const body = { buildMode: val('buildMode'), template: val('template'), pages: Number(val('pages')) };
  S = await api('/api/sessions', { method: 'POST', body });
  store.set('sessionId', S.id);
  $('#speakToggle').checked = body.buildMode !== 'upload';
  showWorkspace();
  render();
  if (body.buildMode === 'talk') speak(S.chat[0]?.text);
}

function showWorkspace() {
  $('#setup').hidden = true;
  $('#workspace').hidden = false;
}

// ---------- Chat ----------
function addBubble(role, text, changes) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  if (changes?.length) {
    const ul = document.createElement('ul');
    ul.className = 'changes';
    for (const c of changes) {
      const li = document.createElement('li');
      li.textContent = c;
      ul.appendChild(li);
    }
    div.appendChild(ul);
  }
  $('#messages').appendChild(div);
  $('#messages').scrollTop = $('#messages').scrollHeight;
  return div;
}

function renderChat() {
  $('#messages').innerHTML = '';
  for (const m of S.chat) addBubble(m.role, m.text, m.changes);
}

function setBusy(on, label = 'Working on it…') {
  busy = on;
  $('#sendBtn').disabled = on;
  $('#messages .typing')?.remove();
  if (on) addBubble('assistant typing', label);
}

async function send(text, spoken = false) {
  text = text.trim();
  if (!text || busy) return;
  addBubble('user', text);
  $('#input').value = '';
  setBusy(true);
  try {
    const r = await api(`/api/sessions/${S.id}/message`, { method: 'POST', body: { text, spoken } });
    applyView(r, true);
    speak(r.reply);
  } catch (err) {
    setBusy(false);
    addBubble('error', err.message);
    $('#input').value = text;
  }
}

async function uploadFile(file) {
  if (!file || busy) return;
  const fd = new FormData();
  fd.append('file', file);
  const note = $('#input').value.trim();
  if (note) fd.append('note', note);
  addBubble('user', `Uploaded ${file.name}${note ? `: ${note}` : ''}`);
  $('#input').value = '';
  setBusy(true, 'Reading your CV and writing a first draft… this can take a minute.');
  try {
    const r = await api(`/api/sessions/${S.id}/upload`, { method: 'POST', body: fd });
    applyView(r, true);
    speak(r.reply);
  } catch (err) {
    setBusy(false);
    addBubble('error', err.message);
  }
}

// ---------- Voice ----------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let heard = '';

function setupVoice() {
  if (!Recognition) {
    $('#micBtn').disabled = true;
    $('#micBtn').title = 'Voice input needs Chrome, Edge or Safari. You can type instead.';
    return;
  }
  $('#micBtn').addEventListener('click', () => (rec ? stopListening() : startListening()));
}

function startListening() {
  speechSynthesis?.cancel();
  heard = '';
  rec = new Recognition();
  rec.lang = navigator.language?.startsWith('en') ? navigator.language : 'en-IN';
  rec.continuous = true;
  rec.interimResults = true;
  const base = $('#input').value ? $('#input').value + ' ' : '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) heard += e.results[i][0].transcript + ' ';
      else interim += e.results[i][0].transcript;
    }
    $('#input').value = base + heard + interim;
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed') addBubble('error', 'Microphone access was blocked. Allow it in your browser, or type instead.');
  };
  rec.onend = () => {
    const wasSpoken = heard.trim().length > 0;
    rec = null;
    $('#micBtn').classList.remove('live');
    $('#micBtn').setAttribute('aria-pressed', 'false');
    if (wasSpoken) send($('#input').value, true);
  };
  rec.start();
  $('#micBtn').classList.add('live');
  $('#micBtn').setAttribute('aria-pressed', 'true');
}

function stopListening() {
  rec?.stop();
}

function speak(text) {
  if (!$('#speakToggle').checked || !window.speechSynthesis || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\(mock\)\s*/g, ''));
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

// ---------- Preview ----------
function applyView(v, fromTurn = false) {
  S = { ...S, ...v };
  if (fromTurn) setBusy(false);
  render();
}

function render() {
  renderChat();
  const r = S.resume;
  $('#templateSel').value = r.settings.template;
  $('#pagesSel').value = String(r.settings.pages);
  const needsUpload = r.settings.buildMode !== 'talk' && !r.sections.length;
  $('#uploadZone').hidden = !needsUpload;
  renderPreview();
  renderChecks();
}

function renderPreview() {
  const r = S.resume;
  const has = r.sections.some((s) => s.items.length);
  $('#empty').hidden = has;
  $('#paper').hidden = !has;
  if (!has) return;

  const t = getTemplate(r.settings.template);
  const m = t.marginsMm;
  const paper = $('#paper');
  paper.style.padding = `${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm`;
  paper.style.width = `${PAGE.widthMm}mm`;
  const frame = $('#frame');
  frame.style.width = `${PAGE.widthMm - m.left - m.right}mm`;

  const editable = $('#editToggle').checked;
  frame.onload = () => {
    const doc = frame.contentDocument;
    const h = doc.getElementById('sheet').getBoundingClientRect().height;
    frame.style.height = `${Math.ceil(h) + 2}px`;
    drawBreaks(h);
    if (editable) wireEditing(doc);
    fitScale();
  };
  frame.srcdoc = renderResume(r, { editable });
}

function drawBreaks(contentH) {
  const r = S.resume;
  const t = getTemplate(r.settings.template);
  const pageH = printableHeightPx(r.settings.template);
  const pagesUsed = Math.max(1, Math.ceil(contentH / pageH));
  const totalH = pageH * Math.max(pagesUsed, r.settings.pages);
  $('#frame').style.minHeight = `${totalH}px`;
  const breaks = $('#breaks');
  breaks.innerHTML = '';
  for (let i = 1; i < Math.max(pagesUsed, r.settings.pages) + 1; i++) {
    const line = document.createElement('div');
    line.className = i === r.settings.pages ? 'break limit' : 'break';
    line.style.top = `${t.marginsMm.top * MM_TO_PX + pageH * i}px`;
    line.dataset.label = i === r.settings.pages ? `Page limit (${r.settings.pages})` : `Page ${i} ends`;
    breaks.appendChild(line);
  }
  // Prefer the server's PDF-based measurement; fall back to the on-screen estimate.
  const fit = S.fit || { fits: contentH <= pageH * r.settings.pages, pages: pagesUsed, limit: r.settings.pages, fill: contentH / (pageH * r.settings.pages) };
  const b = $('#fitBadge');
  b.hidden = false;
  b.className = `badge ${fit.fits ? 'ok' : 'bad'}`;
  b.textContent = fit.fits
    ? `Fits ${fit.limit} page${fit.limit > 1 ? 's' : ''}`
    : `Over by ~${Math.max(1, Math.round((fit.fill - 1) * 100))}%`;
  b.title = S.fit?.message || 'Estimated from the on-screen preview.';
}

function fitScale() {
  const stage = $('#stage');
  const paper = $('#paper');
  const avail = stage.clientWidth - 24;
  const w = PAGE.widthMm * MM_TO_PX;
  const scale = Math.min(1, avail / w);
  // Scale from the top-left and centre manually: a fixed-width box wider than
  // its container can't be centred with margin:auto.
  paper.style.transform = `scale(${scale})`;
  paper.style.marginLeft = `${Math.max(0, (stage.clientWidth - w * scale) / 2)}px`;
  paper.style.marginBottom = `${-(1 - scale) * paper.offsetHeight}px`;
}
window.addEventListener('resize', () => S && !$('#paper').hidden && fitScale());

function wireEditing(doc) {
  doc.querySelectorAll('[contenteditable]').forEach((el) => {
    el.dataset.orig = el.textContent;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') { el.textContent = el.dataset.orig; el.blur(); }
    });
    el.addEventListener('blur', async () => {
      const value = el.textContent.trim();
      if (value === el.dataset.orig.trim()) return;
      try {
        applyView(await api(`/api/sessions/${S.id}/edit`, { method: 'POST', body: { path: el.dataset.path, value } }));
      } catch (err) {
        addBubble('error', err.message);
        el.textContent = el.dataset.orig;
      }
    });
  });
}

// ---------- Checks ----------
function renderChecks() {
  const issues = S.issues || [];
  $('#checksCount').textContent = issues.length;
  $('#checksCount').className = `count ${issues.some((i) => i.level === 'error') ? 'err' : issues.length ? 'warn' : ''}`;
  const panel = $('#checksPanel');
  panel.innerHTML = issues.length
    ? `<ul>${issues.map((i, n) => `<li class="${i.level}" data-n="${n}"><b>${label(i.code)}</b> ${escapeHtml(i.message)}</li>`).join('')}</ul>`
    : '<p>No issues found.</p>';
  panel.querySelectorAll('li').forEach((li) =>
    li.addEventListener('click', () => highlight(issues[Number(li.dataset.n)].path)),
  );
}

const label = (c) =>
  ({ 'unverified-number': 'Unverified number', 'ai-language': 'Generic wording', 'first-person': 'First person', 'repeated-verb': 'Repeated verb', duplicate: 'Duplicate', placeholder: 'Placeholder' })[c] || c;

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function highlight(path) {
  const doc = $('#frame').contentDocument;
  const [sec, item, field, n] = path.split('.');
  let el = doc.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (!el && item) {
    const lis = doc.querySelectorAll(`section[data-section="${CSS.escape(sec)}"] li`);
    el = field === 'bullets' ? [...lis][Number(n)] : doc.querySelector(`section[data-section="${CSS.escape(sec)}"]`);
  }
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  el.style.background = '#fff3b0';
  setTimeout(() => (el.style.background = ''), 1800);
}

// ---------- Export ----------
function confirmExport() {
  const issues = S.issues || [];
  const serious = issues.filter((i) => i.level === 'error' || i.code === 'unverified-number');
  const fitProblem = S.fit && !S.fit.fits;
  if (!serious.length && !fitProblem) return true;
  const lines = [
    ...(fitProblem ? [`• ${S.fit.message}`] : []),
    ...serious.slice(0, 8).map((i) => `• ${i.message}`),
  ];
  return confirm(`Before you export, please check:\n\n${lines.join('\n')}\n\nExport anyway?`);
}

async function download(kind) {
  if (!S.resume.sections.length || !confirmExport()) return;
  const res = await fetch(`/api/sessions/${S.id}/export.${kind}`);
  if (res.status === 501 && kind === 'pdf') {
    // No headless browser on the server: fall back to the browser's own print-to-PDF.
    window.open(`/api/sessions/${S.id}/print`, '_blank');
    return;
  }
  if (!res.ok) {
    addBubble('error', (await res.json().catch(() => ({}))).error || 'Export failed.');
    return;
  }
  const pages = res.headers.get('X-Page-Count');
  if (pages && Number(pages) > S.resume.settings.pages) {
    addBubble('error', `Heads up: the PDF came out at ${pages} pages, over your ${S.resume.settings.pages}-page limit. Ask me to tighten it.`);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (res.headers.get('Content-Disposition')?.match(/filename="(.+)"/) || [])[1] || `resume.${kind}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- Wiring ----------
async function boot() {
  buildSetup();
  setupVoice();
  $('#startBtn').addEventListener('click', () => start().catch((e) => alert(e.message)));
  $('#composer').addEventListener('submit', (e) => { e.preventDefault(); send($('#input').value); });
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('#input').value); }
  });
  for (const id of ['#fileInput', '#fileInput2']) {
    $(id).addEventListener('change', (e) => { uploadFile(e.target.files[0]); e.target.value = ''; });
  }
  $('#templateSel').addEventListener('change', async (e) => applyView(await api(`/api/sessions/${S.id}/format`, { method: 'POST', body: { template: e.target.value } })));
  $('#pagesSel').addEventListener('change', async (e) => applyView(await api(`/api/sessions/${S.id}/format`, { method: 'POST', body: { pages: Number(e.target.value) } })));
  $('#editToggle').addEventListener('change', renderPreview);
  $('#checksBtn').addEventListener('click', () => ($('#checksPanel').hidden = !$('#checksPanel').hidden));
  $('#pdfBtn').addEventListener('click', () => download('pdf'));
  $('#docxBtn').addEventListener('click', () => download('docx'));
  $('#newBtn').addEventListener('click', () => {
    if (!confirm('Start a new resume? The current one will be discarded.')) return;
    store.del('sessionId');
    location.reload();
  });

  const saved = store.get('sessionId');
  if (saved) {
    try {
      S = await api(`/api/sessions/${saved}`);
      showWorkspace();
      render();
      return;
    } catch {
      store.del('sessionId');
    }
  }
  $('#setup').hidden = false;
}

boot();

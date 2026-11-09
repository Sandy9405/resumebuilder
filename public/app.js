import { renderResume } from '/shared/render.js';
import { TEMPLATES, getTemplate, MM_TO_PX } from '/shared/templates.js';

const $ = (s) => document.querySelector(s);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

let S = null; // current session view from the server
let busy = false;
let liveLayout = null; // layout + visual QA computed by the preview itself

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
// Each recording is capped at 2 minutes (multiple recordings are fine) and
// stops after 15 seconds without speech. Browsers sometimes end recognition on
// their own mid-sentence; within those limits it is restarted transparently.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
// window.__voiceLimits lets automated tests shorten the timers.
const MAX_TURN_MS = window.__voiceLimits?.max || 120000;
const SILENCE_MS = window.__voiceLimits?.silence || 15000;
let rec = null;
let heard = '';
let baseText = '';
let startedAt = 0;
let lastSpeechAt = 0;
let ticker = null;
let stopReason = '';
let stopping = false;

function setupVoice() {
  if (!Recognition) {
    $('#micBtn').disabled = true;
    $('#micBtn').title = 'Voice input needs Chrome, Edge or Safari. You can type instead.';
    return;
  }
  $('#micBtn').addEventListener('click', () => (rec ? stopListening('user') : startListening()));
}

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function voiceStatus(text, live = false) {
  const el = $('#voiceStatus');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('live', live);
}

function startListening() {
  if (busy) return;
  window.speechSynthesis?.cancel();
  heard = '';
  baseText = $('#input').value ? `${$('#input').value} ` : '';
  stopReason = '';
  stopping = false;
  startedAt = lastSpeechAt = Date.now();
  $('#micBtn').classList.add('live');
  $('#micBtn').setAttribute('aria-pressed', 'true');
  ticker = setInterval(tick, 250);
  tick();
  startRecognizer();
}

function startRecognizer() {
  rec = new Recognition();
  rec.lang = navigator.language?.startsWith('en') ? navigator.language : 'en-IN';
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e) => {
    lastSpeechAt = Date.now();
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) heard += `${e.results[i][0].transcript} `;
      else interim += e.results[i][0].transcript;
    }
    $('#input').value = baseText + heard + interim;
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      stopReason = 'blocked';
      stopping = true;
    }
  };
  rec.onend = () => {
    const now = Date.now();
    if (!stopping && now - startedAt < MAX_TURN_MS && now - lastSpeechAt < SILENCE_MS) {
      try {
        rec.start(); // the browser ended early; keep listening within the limits
        return;
      } catch {
        /* fall through to finish */
      }
    }
    finishListening();
  };
  rec.start();
}

function tick() {
  const now = Date.now();
  const left = MAX_TURN_MS - (now - startedAt);
  const silent = now - lastSpeechAt;
  if (left <= 0) return stopListening('limit');
  if (silent >= SILENCE_MS) return stopListening('silence');
  const quiet = silent > 5000 ? ` · no speech, stopping in ${Math.ceil((SILENCE_MS - silent) / 1000)}s` : '';
  voiceStatus(`● Listening ${fmt(left)} left${quiet}`, true);
}

function stopListening(reason) {
  if (!rec || stopping) return;
  stopReason = reason;
  stopping = true;
  rec.stop();
}

function finishListening() {
  clearInterval(ticker);
  rec = null;
  $('#micBtn').classList.remove('live');
  $('#micBtn').setAttribute('aria-pressed', 'false');
  const said = heard.trim();
  if (stopReason === 'blocked') {
    voiceStatus('');
    addBubble('error', 'Microphone access was blocked. Allow it in your browser, or type instead.');
  } else if (stopReason === 'silence' && !said) {
    voiceStatus('Stopped: no speech for 15 seconds. Tap the mic to try again.');
  } else if (stopReason === 'limit') {
    voiceStatus('2-minute limit reached. Sent what you said; tap the mic to keep going.');
  } else if (stopReason === 'silence') {
    voiceStatus('Stopped after 15 seconds of silence. Sent what you said.');
  } else {
    voiceStatus('');
  }
  if (said) send($('#input').value, true);
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
  $('#undoBtn').disabled = !S.canUndo;
  $('#redoBtn').disabled = !S.canRedo;
  renderProfile();
  renderJd();
  renderHiddenNote();
  renderPreview();
  renderChecks();
}

const STAGES = { student: 'Student / fresher', early: 'Early career', mid: 'Mid-level', experienced: 'Experienced', senior: 'Senior' };
function renderProfile() {
  const p = S.resume.profile || {};
  const parts = [(p.jobFamilies || []).join(' / '), STAGES[p.careerStage], p.targetRole && `→ ${p.targetRole}`].filter(Boolean);
  $('#profileChip').hidden = !parts.length;
  $('#profileChip').textContent = parts.join(' · ');
  $('#profileChip').title = 'How the assistant reads your background. Tell it if this is wrong.';
}

function renderJd() {
  const jd = S.jd;
  $('#jdBar').hidden = !jd;
  if (!jd) return;
  const t = S.resume.target;
  const c = S.coverage;
  const label = [t?.title || jd.title, t?.company || jd.company].filter(Boolean).join(' at ') || jd.source;
  const parts = [`Targeting <b>${escapeHtml(label)}</b>`];
  if (c) {
    parts.push(`Required keywords shown: ${c.must.matched}/${c.must.total}`);
    if (c.nice.total) parts.push(`Nice-to-have: ${c.nice.matched}/${c.nice.total}`);
  } else parts.push('Analysing…');
  $('#jdText').innerHTML = parts.join(' · ');
}

function openJdDialog(error = '') {
  $('#jdError').hidden = !error;
  $('#jdError').textContent = error;
  if (!error) {
    $('#jdUrl').value = '';
    $('#jdFile').value = '';
    $('#jdTextIn').value = '';
  }
  $('#jdDialog').showModal();
}

async function submitJd(e) {
  e.preventDefault();
  const url = $('#jdUrl').value.trim();
  const file = $('#jdFile').files[0];
  const text = $('#jdTextIn').value.trim();
  if (!url && !file && !text) return openJdDialog('Add a link, a file, or the pasted text.');
  if (busy) return openJdDialog('Still working on your last message. Try again in a moment.');
  const fd = new FormData();
  if (file) fd.append('file', file);
  else if (url) fd.append('url', url);
  else fd.append('text', text);
  $('#jdDialog').close();
  addBubble('user', `Target job: ${file ? file.name : url || 'pasted job description'}`);
  setBusy(true, url ? 'Reading the job page and tailoring your resume…' : 'Reading the job description and tailoring your resume…');
  try {
    const r = await api(`/api/sessions/${S.id}/jd`, { method: 'POST', body: fd });
    applyView(r, true);
    speak(r.reply);
  } catch (err) {
    setBusy(false);
    renderChat();
    openJdDialog(err.message);
  }
}

function renderHiddenNote() {
  const hidden = [];
  let reserved = 0;
  for (const s of S.resume.sections) {
    if (s.hidden) hidden.push(s.title);
    for (const it of s.items) {
      if (!s.hidden && it.hidden) hidden.push(it.org || it.heading);
      reserved += (it.reserve || []).length;
    }
  }
  const parts = [];
  if (hidden.length) parts.push(`${hidden.length} hidden for length (${hidden.slice(0, 3).join(', ')}${hidden.length > 3 ? '…' : ''})`);
  if (reserved) parts.push(`${reserved} extra bullet${reserved > 1 ? 's' : ''} kept in reserve`);
  $('#hiddenNote').hidden = !parts.length;
  $('#hiddenNote').textContent = parts.length ? `Not shown at this length but kept: ${parts.join('; ')}. Ask to bring anything back, or switch to two pages.` : '';
}

let renderSeq = 0;
function renderPreview() {
  const r = S.resume;
  const has = r.sections.some((s) => !s.hidden && s.items.some((i) => !i.hidden));
  $('#empty').hidden = has;
  $('#paper').hidden = !has;
  if (!has) {
    liveLayout = null;
    $('#fitBadge').hidden = true;
    return;
  }
  const t = getTemplate(r.settings.template);
  const frame = $('#frame');
  const editable = $('#editToggle').checked;
  const seq = ++renderSeq;
  frame.style.width = `${Math.ceil(t.page.widthMm * MM_TO_PX) + 24}px`;
  frame.onload = async () => {
    const win = frame.contentWindow;
    const layout = await win.__layoutPromise;
    if (seq !== renderSeq) return; // a newer render started
    liveLayout = layout;
    frame.style.height = `${win.document.documentElement.scrollHeight}px`;
    if (editable) wireEditing(win.document);
    fitScale();
    renderBadge();
    renderChecks();
  };
  frame.srcdoc = renderResume(r, { editable, screen: true });
}

function renderBadge() {
  const l = liveLayout;
  const b = $('#fitBadge');
  if (!l) return void (b.hidden = true);
  b.hidden = false;
  const underfilled = (l.issues || []).some((i) => i.code === 'underfilled');
  b.className = `badge ${!l.fits ? 'bad' : l.level || underfilled ? 'tight' : 'ok'}`;
  b.textContent = !l.fits
    ? `${l.pages} pages · over limit`
    : `${l.pages} of ${l.limit} page${l.limit > 1 ? 's' : ''}${l.level ? ' · spacing tightened' : l.expand ? ` · text ${l.bodySize}pt to fill` : ''}${underfilled ? ' · needs more content' : ''}`;
  b.title = !l.fits
    ? `About ${Math.round(l.overflow * 100)}% of a page too long. Ask the assistant to tighten it.`
    : l.level
      ? `Fits after a small spacing adjustment (level ${l.level}); text size is unchanged or within 0.5pt.`
      : l.expand
        ? `Your content filled ${Math.round(l.baseFill * 100)}% of the page at normal size, so body text and spacing were enlarged (name and headings unchanged). Adding projects, internships or achievements is better than larger text.`
        : `Fits; the page is ${Math.round(l.lastPageFill * 100)}% full.`;
}

function fitScale() {
  const stage = $('#stage');
  const paper = $('#paper');
  const frame = $('#frame');
  const w = frame.offsetWidth;
  const scale = Math.min(1, (stage.clientWidth - 8) / w);
  // Scale from the top-left and centre manually: a fixed-width box wider than
  // its container can't be centred with margin:auto.
  paper.style.transform = `scale(${scale})`;
  paper.style.marginLeft = `${Math.max(0, (stage.clientWidth - w * scale) / 2)}px`;
  paper.style.marginBottom = `${-(1 - scale) * frame.offsetHeight}px`;
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

async function history(kind) {
  if (busy) return;
  try {
    applyView(await api(`/api/sessions/${S.id}/${kind}`, { method: 'POST' }));
  } catch (err) {
    addBubble('error', err.message);
  }
}

// ---------- Checks ----------
function allIssues() {
  const visual = liveLayout?.issues || S.layout?.issues || [];
  const rank = { error: 0, warn: 1, info: 2 };
  return [...visual, ...(S.issues || [])].sort((a, b) => rank[a.level] - rank[b.level]);
}

function renderChecks() {
  const issues = allIssues();
  const serious = issues.filter((i) => i.level !== 'info');
  $('#checksCount').textContent = serious.length + (issues.length > serious.length ? `+${issues.length - serious.length}` : '');
  $('#checksCount').className = `count ${issues.some((i) => i.level === 'error') ? 'err' : serious.length ? 'warn' : ''}`;
  const panel = $('#checksPanel');
  panel.innerHTML = issues.length
    ? `<ul>${issues.map((i, n) => `<li class="${i.level}" data-n="${n}"><b>${label(i.code)}</b> ${escapeHtml(i.message)}</li>`).join('')}</ul>`
    : '<p>No issues found.</p>';
  panel.querySelectorAll('li').forEach((li) =>
    li.addEventListener('click', () => highlight(issues[Number(li.dataset.n)].path)),
  );
}

const label = (c) =>
  ({
    'unverified-number': 'Unverified number', 'ai-language': 'Generic wording', 'first-person': 'First person',
    'repeated-verb': 'Repeated verb', duplicate: 'Duplicate', placeholder: 'Placeholder',
    'over-limit': 'Too long', 'outside-boundary': 'Outside margins', overlap: 'Overlap', 'date-collision': 'Date collision',
    'date-misaligned': 'Date alignment', 'indent-inconsistent': 'Indentation', 'orphan-heading': 'Page break',
    'blank-page': 'Blank page', 'table-overflow': 'Table', justified: 'Word spacing', 'font-fallback': 'Font',
    underfilled: 'Page not full', 'header-incomplete': 'Header', 'links-missing': 'Links',
    'ste-length': 'Too long', 'ste-passive': 'Passive voice', 'ste-pattern': 'Repetitive shape', 'ste-punctuation': 'Punctuation',
    'jd-missing': 'Job keyword', 'jd-ask': 'Job question', 'jd-gap': 'Job gap',
    'ats-heading': 'ATS heading', 'ats-dates': 'ATS dates',
    'long-bullet': 'Long bullet', 'marker-misaligned': 'Bullet alignment', 'widow-word': 'Lone word', 'sparse-page': 'Length', 'pdf-mismatch': 'PDF',
  })[c] || c;

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function highlight(path) {
  if (!path) return;
  const doc = $('#frame').contentDocument;
  const el =
    doc.querySelector(`[data-path="${CSS.escape(path)}"]`) ||
    doc.querySelector(`[data-item="${CSS.escape(path.split('.').slice(0, 2).join('.'))}"]`) ||
    doc.querySelector(`[data-sec="${CSS.escape(path.split('.')[0])}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  el.style.background = '#fff3b0';
  setTimeout(() => (el.style.background = ''), 1800);
}

// ---------- Export ----------
function confirmExport() {
  const serious = allIssues().filter((i) => i.level === 'error' || i.code === 'unverified-number' || i.code === 'placeholder');
  if (!serious.length) return true;
  const lines = serious.slice(0, 8).map((i) => `• ${i.message}`);
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
  if (kind === 'pdf' && pages && Number(pages) > S.resume.settings.pages) {
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
  $('#undoBtn').addEventListener('click', () => history('undo'));
  $('#redoBtn').addEventListener('click', () => history('redo'));
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || !S) return;
    if (e.target.closest?.('textarea, input, [contenteditable]')) return;
    e.preventDefault();
    history(e.shiftKey ? 'redo' : 'undo');
  });
  $('#jdBtn').addEventListener('click', () => openJdDialog());
  $('#jdCancel').addEventListener('click', () => $('#jdDialog').close());
  $('#jdForm').addEventListener('submit', submitJd);
  $('#jdRemove').addEventListener('click', async () => {
    if (!confirm('Stop tailoring to this job? Your resume content stays as it is.')) return;
    try {
      applyView(await api(`/api/sessions/${S.id}/jd`, { method: 'DELETE' }));
    } catch (err) {
      addBubble('error', err.message);
    }
  });
  $('#skipBtn').addEventListener('click', () => send("Skip this one, I don't have that detail."));
  $('#finishBtn').addEventListener('click', () => send("That's everything I have for now. Please finish the resume and run your final checks."));
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

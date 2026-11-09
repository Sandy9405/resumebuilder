import { renderResume } from '/shared/render.js';
import { TEMPLATES, getTemplate, MM_TO_PX, FORMATS_BY_STAGE } from '/shared/templates.js';

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
// ---------- Setup: one question per screen ----------
// Recent graduates see the academic formats; experienced people see
// experience-first ones. Any layout stays available from the toolbar later.
const THUMB = '<i class="t-name"></i><i class="t-sub"></i><i class="t-h"></i><i class="w9"></i><i class="w8"></i><i class="w9"></i><i class="t-h"></i><i class="w8"></i><i class="w6"></i><i class="t-h"></i><i class="w7"></i>';

function renderFormatCards() {
  const stage = document.querySelector('input[name="stage"]:checked')?.value || 'recent';
  const ids = FORMATS_BY_STAGE[stage] || Object.keys(TEMPLATES);
  $('#templateCards').innerHTML = ids
    .map((id, i) => {
      const t = TEMPLATES[id];
      const rec = i === 0 && stage === 'experienced' ? '<em class="tag rec">Recommended</em>' : '';
      return `<label class="choice"><input type="radio" name="template" value="${t.id}">${rec}
      <span class="thumb thumb-${t.id}" aria-hidden="true">${THUMB}</span>
      <b>${t.label}</b><span>${t.blurb}</span></label>`;
    })
    .join('');
  $('#templateCards').querySelectorAll('input').forEach((r) => r.addEventListener('change', onChoice));
}

const STEPS = 4;
let step = 1;
const checked = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;

function stepValid(n) {
  if (n === 1) return !!checked('stage');
  if (n === 2) return !!checked('buildMode');
  if (n === 3) return !!checked('template');
  return !!checked('pages') && (checked('purpose') !== 'role' || $('#purposeRole').value.trim().length > 1);
}

function showStep(n) {
  step = n;
  document.querySelectorAll('.step').forEach((el) => (el.hidden = Number(el.dataset.step) !== n));
  document.querySelectorAll('.progress span').forEach((el, i) => {
    el.classList.toggle('done', i < n - 1);
    el.classList.toggle('now', i === n - 1);
  });
  $('#backBtn').hidden = n === 1;
  $('#nextBtn').hidden = n === STEPS;
  $('#startBtn').hidden = n !== STEPS;
  updateNav();
  document.querySelector(`.step[data-step="${n}"] h1`)?.focus({ preventScroll: true });
}

function updateNav() {
  $('#nextBtn').disabled = !stepValid(step);
  $('#startBtn').disabled = !stepValid(STEPS);
}

// Single-choice steps move on by themselves, like a native setup flow.
function onChoice() {
  updateNav();
  if (step === 1) renderFormatCards();
  if (step < STEPS && stepValid(step)) setTimeout(() => step < STEPS && stepValid(step) && showStep(step + 1), 260);
}

const PURPOSE_HINT = {
  general: 'A strong all-round resume, no single target.',
  role: 'I\'ll aim your resume at this kind of role and tell you honestly how well you fit.',
  jd: 'Next, you\'ll paste the job link or description. I\'ll tailor to it and tell you how well you fit.',
};

function buildSetup() {
  document.querySelectorAll('input[name="stage"], input[name="buildMode"]').forEach((r) => r.addEventListener('change', onChoice));
  document.querySelectorAll('input[name="pages"], input[name="purpose"]').forEach((r) =>
    r.addEventListener('change', () => {
      const p = checked('purpose');
      $('#purposeRole').hidden = p !== 'role';
      $('#purposeHint').textContent = PURPOSE_HINT[p] || '';
      if (p === 'role') $('#purposeRole').focus();
      updateNav();
    }),
  );
  $('#purposeRole').addEventListener('input', updateNav);
  $('#nextBtn').addEventListener('click', () => stepValid(step) && showStep(step + 1));
  $('#backBtn').addEventListener('click', () => showStep(Math.max(1, step - 1)));
  document.querySelectorAll('.step h1').forEach((h) => h.setAttribute('tabindex', '-1'));
  $('#templateSel').innerHTML = Object.values(TEMPLATES).map((t) => `<option value="${t.id}">${t.label}</option>`).join('');
  showStep(1);
}

async function start() {
  if (!stepValid(STEPS)) return;
  const val = (n) => document.querySelector(`input[name="${n}"]:checked`).value;
  const purposeType = val('purpose');
  const role = $('#purposeRole').value.trim();
  if (purposeType === 'role' && !role) {
    $('#purposeRole').focus();
    $('#purposeRole').placeholder = 'Type the role first';
    return;
  }
  const body = { buildMode: val('buildMode'), stage: val('stage'), template: val('template'), pages: Number(val('pages')), purpose: { type: purposeType, role } };
  S = await api('/api/sessions', { method: 'POST', body });
  store.set('sessionId', S.id);
  $('#speakToggle').checked = body.buildMode !== 'upload';
  showWorkspace();
  render();
  if (body.buildMode === 'talk') speak(S.chat[0]?.text);
  if (purposeType === 'jd') openJdDialog();
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
  // Users need the result, not the log: edits are tucked away, collapsed.
  if (changes?.length) {
    const det = document.createElement('details');
    det.className = 'changes';
    const sum = document.createElement('summary');
    sum.textContent = 'Show changes';
    det.appendChild(sum);
    const ul = document.createElement('ul');
    for (const c of changes) {
      const li = document.createElement('li');
      li.textContent = c;
      ul.appendChild(li);
    }
    det.appendChild(ul);
    div.appendChild(det);
  }
  $('#messages').appendChild(div);
  $('#messages').scrollTop = $('#messages').scrollHeight;
  return div;
}

function renderChat() {
  $('#messages').innerHTML = '';
  for (const m of S.chat) addBubble(m.role, m.text, m.changes);
  const bubbles = $('#messages').querySelectorAll('.msg.assistant');
  const last = bubbles[bubbles.length - 1];
  if (!last || busy) return;
  const lastMsg = S.chat[S.chat.length - 1];
  // On phones, offer a jump to the change that reply made.
  if (lastMsg?.role === 'assistant' && lastMsg.changes?.length && isPhone()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ghost see-change';
    b.textContent = 'See it on your resume';
    b.addEventListener('click', () => {
      const keys = pendingFlash.length ? pendingFlash : changedKeysFromLastTurn();
      showTab('resume');
      setTimeout(() => flashChanges(keys), 250);
    });
    last.appendChild(b);
  }
  const ask = S.ask;
  if (!ask || lastMsg?.role !== 'assistant') return;
  const wrap = document.createElement('div');
  wrap.className = 'quick-replies';
  const btn = (label, cls, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ghost ${cls}`;
    b.textContent = label;
    b.addEventListener('click', fn);
    wrap.appendChild(b);
  };
  const prefill = (text) => {
    if (isPhone()) showTab('chat');
    $('#input').value = text;
    $('#input').focus();
  };
  if (ask.kind === 'currency') {
    btn('Yes, still my current job', 'yes', confirmCurrent);
    btn("I've moved on", '', () => prefill(`I've moved on. My current role is `));
  } else if (ask.kind === 'evidence') {
    btn('I have a story', 'yes', () => prefill(`About ${ask.term}: `));
    btn("Skip, I don't have this", '', () => skipRequirement(ask.term));
  }
  last.appendChild(wrap);
  $('#messages').scrollTop = $('#messages').scrollHeight; // keep the answer buttons in view
}

let lastTurnKeys = [];
const changedKeysFromLastTurn = () => lastTurnKeys;

async function confirmCurrent() {
  if (busy) return;
  addBubble('user', 'Yes, still my current job');
  setBusy(true);
  try {
    applyView(await api(`/api/sessions/${S.id}/current`, { method: 'POST' }), true);
  } catch (err) {
    setBusy(false);
    addBubble('error', err.message);
  }
}

function setBusy(on, label = 'Working on it…') {
  busy = on;
  if (on) setComposerMode('compact');
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

// 'sarvam': record clips and transcribe on the server (accurate, knows the
// user's names). 'browser': the browser's own recognition, used only when the
// server has no Sarvam key (e.g. local development).
let voiceMode = 'browser';

async function setupVoice() {
  try {
    voiceMode = (await (await fetch('/api/voice')).json()).provider;
  } catch {
    voiceMode = 'browser';
  }
  const canRecord = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  if (voiceMode === 'sarvam' && canRecord) {
    $('#micBtn').addEventListener('click', () => (recState ? stopRecording('user') : startRecording()));
    if (S) updateComposer();
    return;
  }
  voiceMode = 'browser';
  if (!Recognition) {
    $('#micBtn').disabled = true;
    $('#micBtn').title = 'Voice input is not available in this browser. You can type instead.';
    return;
  }
  $('#micBtn').addEventListener('click', () => (rec ? stopListening('user') : startListening()));
  if (S) updateComposer();
}

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function voiceStatus(text, live = false) {
  if (live) {
    $('#voiceSub').textContent = text.replace(/^●\s*/, '');
    return;
  }
  const el = $('#voiceStatus');
  el.hidden = !text;
  el.textContent = text || '';
}

// ---------- Composer modes ----------
// compact: type, or tap the small mic. story: the AI asked for something, so
// voice becomes the big, labelled answer. recording / transcribing: live states.
let typedOverride = false; // the user chose "or type instead" for this question
let transcribing = false;

function voiceCopy() {
  return voiceMode === 'sarvam'
    ? { title: 'Tell it by voice', sub: 'Hindi, English or both · up to 2 min' }
    : { title: 'Tell it by voice', sub: 'Speak in English · up to 2 min' };
}

function setComposerMode(mode) {
  $('#composer').dataset.mode = mode;
  const c = voiceCopy();
  // Only label it "Voice AI" when the AI transcriber (Sarvam) is doing the listening.
  $('#voicePill').hidden = voiceMode !== 'sarvam' || mode === 'transcribing';
  if (mode === 'story' || mode === 'compact') {
    $('#voiceTitle').textContent = c.title;
    $('#voiceSub').textContent = c.sub;
    $('#micBtn').setAttribute('aria-label', voiceMode === 'sarvam' ? 'Answer with Voice AI' : 'Answer by voice');
  }
  if (mode === 'recording') {
    $('#voiceTitle').textContent = 'Listening…';
    $('#micBtn').setAttribute('aria-label', 'Finish recording');
  }
  if (mode === 'transcribing') {
    $('#voiceTitle').textContent = 'Turning your words into text…';
    $('#voiceSub').textContent = 'One moment';
  }
}

function updateComposer() {
  if (recState || rec || transcribing) return;
  const last = S?.chat?.[S.chat.length - 1];
  const asked = last?.role === 'assistant' && (S.ask || /\?\s*$/.test(last.text || ''));
  const canVoice = !$('#micBtn').disabled;
  setComposerMode(!busy && asked && canVoice && !typedOverride ? 'story' : 'compact');
}

function setMeter(levels) {
  const bars = $('#voiceMeter').children;
  for (let i = 0; i < bars.length; i++) bars[i].style.setProperty('--l', String(Math.min(1, levels[i] || 0)));
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
  setComposerMode('recording');
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
  // No level data from the browser recogniser: animate gently while speech is recent.
  setMeter(Array.from({ length: 14 }, () => (silent < 1200 ? 0.25 + Math.random() * 0.6 : 0.05)));
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
  setMeter([]);
  updateComposer();
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

// ---------- Voice: recorded clips transcribed by Sarvam ----------
// Sarvam's REST API takes clips under 30 seconds, so one recording is split
// into segments at natural pauses (25 s at the latest). Each segment is
// transcribed while the person keeps talking, so the text is ready almost as
// soon as they stop. Segments with no speech are never uploaded. The same
// 2-minute cap and 15-second silence stop apply.
const SEG_MIN_MS = window.__voiceLimits?.segMin || 8000;
const SEG_MAX_MS = 25000;
const SEG_PAUSE_MS = 700;
let recState = null;

function pickMime() {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

async function startRecording() {
  if (busy || recState) return;
  window.speechSynthesis?.cancel();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    addBubble('error', 'Microphone access was blocked. Allow it in your browser, or type instead.');
    return;
  }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const now = Date.now();
  recState = {
    stream, ctx, analyser, buf: new Float32Array(analyser.fftSize), mime: pickMime(),
    segments: [], seg: null, startedAt: now, lastSpeechAt: now, floor: 0.004,
    stopReason: '', errors: 0, errorMsg: '', baseText: $('#input').value ? `${$('#input').value} ` : '',
  };
  newSegment();
  $('#micBtn').classList.add('live');
  $('#micBtn').setAttribute('aria-pressed', 'true');
  recState.levels = [];
  setComposerMode('recording');
  recState.ticker = setInterval(recTick, 100);
  recTick();
}

function newSegment() {
  const st = recState;
  const rec = new MediaRecorder(st.stream, st.mime ? { mimeType: st.mime } : undefined);
  const seg = { rec, chunks: [], hadSpeech: false, startedAt: Date.now() };
  rec.ondataavailable = (e) => e.data?.size && seg.chunks.push(e.data);
  seg.result = new Promise((resolve) => {
    rec.onstop = () => {
      if (!seg.hadSpeech || !seg.chunks.length) return resolve('');
      const blob = new Blob(seg.chunks, { type: rec.mimeType || st.mime || 'audio/webm' });
      resolve(
        transcribeClip(blob).catch((err) => {
          st.errors++;
          st.errorMsg = err.message;
          return '';
        }),
      );
    };
  });
  st.segments.push(seg);
  st.seg = seg;
  rec.start();
}

async function transcribeClip(blob) {
  const fd = new FormData();
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  fd.append('audio', blob, `clip.${ext}`);
  return (await api(`/api/sessions/${S.id}/transcribe`, { method: 'POST', body: fd })).transcript || '';
}

function micLevel(st) {
  st.analyser.getFloatTimeDomainData(st.buf);
  let sum = 0;
  for (const v of st.buf) sum += v * v;
  return Math.sqrt(sum / st.buf.length);
}

function recTick() {
  const st = recState;
  if (!st || st.stopReason) return;
  const now = Date.now();
  const rms = micLevel(st);
  st.levels.push(Math.min(1, rms * 9));
  if (st.levels.length > 14) st.levels.shift();
  setMeter(st.levels);
  // Speech is anything clearly above the room's background level.
  if (rms > Math.max(0.012, st.floor * 3.5)) {
    st.lastSpeechAt = now;
    st.seg.hadSpeech = true;
  } else {
    st.floor = st.floor * 0.95 + rms * 0.05;
  }
  const left = MAX_TURN_MS - (now - st.startedAt);
  const silent = now - st.lastSpeechAt;
  if (left <= 0) return stopRecording('limit');
  if (silent >= SILENCE_MS) return stopRecording('silence');
  const segLen = now - st.seg.startedAt;
  if (segLen >= SEG_MAX_MS || (segLen >= SEG_MIN_MS && st.seg.hadSpeech && silent >= SEG_PAUSE_MS)) {
    st.seg.rec.stop(); // its transcription starts now, while recording continues
    newSegment();
  }
  const quiet = silent > 5000 ? ` · no speech, stopping in ${Math.ceil((SILENCE_MS - silent) / 1000)}s` : '';
  voiceStatus(`${fmt(left)} left · tap stop when you're done${quiet}`, true);
}

async function stopRecording(reason) {
  const st = recState;
  if (!st || st.stopReason) return;
  st.stopReason = reason;
  clearInterval(st.ticker);
  if (st.seg.rec.state !== 'inactive') st.seg.rec.stop();
  st.stream.getTracks().forEach((t) => t.stop());
  st.ctx.close().catch(() => {});
  $('#micBtn').classList.remove('live');
  $('#micBtn').setAttribute('aria-pressed', 'false');
  const hadSpeech = st.segments.some((x) => x.hadSpeech);
  if (hadSpeech) {
    transcribing = true;
    setComposerMode('transcribing');
  }
  const texts = await Promise.all(st.segments.map((x) => x.result));
  recState = null;
  transcribing = false;
  setMeter([]);
  updateComposer();
  const said = texts.filter(Boolean).join(' ').trim();
  if (!said) {
    voiceStatus(reason === 'silence' ? 'Stopped: no speech for 15 seconds. Tap the mic to try again.' : '');
    if (st.errors) addBubble('error', st.errorMsg || "Couldn't transcribe that. Please try again or type instead.");
    return;
  }
  const partial = st.errors ? ' Part of it could not be transcribed; please check.' : '';
  voiceStatus(
    reason === 'limit'
      ? `2-minute limit reached. Sent what you said; tap the mic to keep going.${partial}`
      : reason === 'silence'
        ? `Stopped after 15 seconds of silence. Sent what you said.${partial}`
        : partial.trim(),
  );
  $('#input').value = st.baseText + said;
  send($('#input').value, true);
}

function speak(text) {
  if (!$('#speakToggle').checked || !window.speechSynthesis || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\(mock\)\s*/g, ''));
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

// ---------- Preview ----------
let pendingFlash = [];
function changedItems(before, after) {
  const old = new Map();
  for (const s of before?.sections || []) for (const it of s.items || []) old.set(`${s.id}.${it.id}`, JSON.stringify(it));
  const out = [];
  for (const s of after?.sections || []) for (const it of s.items || []) {
    const k = `${s.id}.${it.id}`;
    if (old.get(k) !== JSON.stringify(it)) out.push(k);
  }
  if (JSON.stringify(before?.header) !== JSON.stringify(after?.header)) out.unshift('header');
  return out;
}

function applyView(v, fromTurn = false) {
  if (fromTurn) typedOverride = false; // a new question gets the voice prompt again
  const changed = JSON.stringify(v.resume) !== JSON.stringify(S?.resume);
  if (changed && S?.resume?.sections?.length) lastTurnKeys = pendingFlash = changedItems(S.resume, v.resume);
  S = { ...S, ...v };
  if (fromTurn) setBusy(false);
  render();
  if (changed) markResumeUpdated();
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
  // Nothing to check or download until there is a first draft.
  const draft = r.sections.some((x) => !x.hidden && x.items.some((i) => !i.hidden));
  $('#checksBtn').disabled = !draft;
  $('#downloadBtn').disabled = !draft;
  if (!draft) $('#checksPanel').hidden = true;
  renderProfile();
  renderJd();
  renderEvidence();
  renderAssessment();
  renderHiddenNote();
  renderInsights();
  updateComposer();
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

// "What this job asks for": every required item with its evidence status, and
// one-tap answers for the ones still open.
function renderEvidence() {
  const kws = (S.resume.target?.keywords || []).filter((k) => k.importance === 'must');
  const box = $('#evidenceBox');
  box.hidden = !kws.length;
  if (!kws.length) return;
  const shown = new Set(S.coverage?.matched || []);
  const rows = kws.map((k) => {
    let st;
    let actions = '';
    if (shown.has(k.term)) st = '<span class="st shown">On your resume</span>';
    else if (k.status === 'skipped') st = '<span class="st gap">Skipped: honest gap</span>';
    else if (k.evidence === 'yes') st = '<span class="st have">You have it: adding</span>';
    else if (k.evidence === 'no') st = '<span class="st gap">Gap</span>';
    else {
      st = '<span class="st ask">Needs your story</span>';
      actions = `<button type="button" class="ghost" data-story="${escapeHtml(k.term)}">I have a story</button><button type="button" class="ghost" data-skip="${escapeHtml(k.term)}">I don't have this</button>`;
    }
    return `<li><span class="term">${escapeHtml(k.term)}</span>${st}${actions}</li>`;
  });
  const done = kws.filter((k) => shown.has(k.term) || k.status === 'skipped' || k.evidence === 'no').length;
  // Open by default on desktop; collapsed on phones, where panels compete with the page.
  const prev = box.querySelector('details');
  const open = prev ? prev.open : true;
  box.innerHTML = `<details${open ? ' open' : ''}><summary>What this job requires (${done} of ${kws.length} covered)</summary><ul>${rows.join('')}</ul></details>`;
  box.querySelectorAll('[data-story]').forEach((b) =>
    b.addEventListener('click', () => {
      if (isPhone()) showTab('chat');
      $('#input').value = `About ${b.dataset.story}: `;
      $('#input').focus();
    }),
  );
  box.querySelectorAll('[data-skip]').forEach((b) => b.addEventListener('click', () => skipRequirement(b.dataset.skip)));
}

async function skipRequirement(term) {
  if (busy) return;
  addBubble('user', `I don't have this: ${term}`);
  setBusy(true);
  try {
    applyView(await api(`/api/sessions/${S.id}/requirement`, { method: 'POST', body: { term } }), true);
  } catch (err) {
    setBusy(false);
    addBubble('error', err.message);
  }
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

const FIT_LABEL = { strong: 'Strong fit', good: 'Good fit', weak: 'Weak fit', very_weak: 'Very weak fit' };
const QUALITY_LABEL = { 'ai-language': 'generic phrases', 'ste-passive': 'passive voice', 'ste-length': 'overlong bullets', 'first-person': 'first person' };

function renderAssessment() {
  const a = S.resume.assessment || {};
  const parts = [];
  if (a.cv) {
    const q = S.quality;
    const moved = q ? Object.keys(QUALITY_LABEL).filter((k) => q.before[k] || q.after[k]).map((k) => `${QUALITY_LABEL[k]} ${q.before[k]} → ${q.after[k]}`) : [];
    parts.push(
      `<div class="row"><span class="tag ${a.cv.verdict}">${a.cv.verdict === 'already_strong' ? 'Your CV is already strong' : 'Improving your CV'}</span>` +
        `<span>${escapeHtml(a.cv.summary)}</span>${moved.length ? `<span class="muted">Measured: ${escapeHtml(moved.join(' · '))}</span>` : ''}</div>`,
    );
  }
  const cmp = S.compare;
  if (cmp?.facts) {
    const bits = [`Facts kept ${cmp.facts.kept}/${cmp.facts.total}${cmp.facts.dropped.length ? ` (missing: ${cmp.facts.dropped.slice(0, 5).join(', ')})` : ''}`];
    if (cmp.keywords) bits.push(`job keywords ${cmp.keywords.before} → ${cmp.keywords.after} of ${cmp.keywords.total}`);
    const worse = cmp.facts.dropped.length > 0 || (cmp.keywords && cmp.keywords.after < cmp.keywords.before);
    parts.push(`<div class="row"><span class="tag ${worse ? 'weak' : 'good'}">Compared with your original</span><span>${escapeHtml(bits.join(' · '))}</span></div>`);
  }
  if (a.fit) {
    const f = a.fit;
    const weak = f.level === 'weak' || f.level === 'very_weak';
    parts.push(
      `<div class="row"><span class="tag ${f.level}">${FIT_LABEL[f.level]}${f.target ? ` · ${escapeHtml(f.target)}` : ''}</span><span>${escapeHtml(f.summary)}</span></div>` +
        (f.gaps.length ? `<div class="row muted">Gaps: ${escapeHtml(f.gaps.join(', '))}</div>` : '') +
        (weak && f.question && !f.override ? `<div class="row q">To check: ${escapeHtml(f.question)} (answer in the chat)</div>` : '') +
        (weak && f.better_fits.length ? `<div class="row muted">Better fits for your experience: ${escapeHtml(f.better_fits.join(', '))}</div>` : '') +
        (weak
          ? f.override
            ? '<div class="row"><span class="tag improve">Applying anyway</span><span class="muted">Tailored honestly; gaps stay gaps.</span></div>'
            : '<div class="row"><button type="button" id="applyAnyway" class="ghost">Apply anyway</button><span class="muted">I\'ll tailor it as well as I honestly can.</span></div>'
          : ''),
    );
  }
  $('#assessBar').hidden = !parts.length;
  // (comparison row is shown even before an assessment exists)
  $('#assessBar').innerHTML = parts.join('');
  $('#applyAnyway')?.addEventListener('click', applyAnywayClick);
}

async function applyAnywayClick() {
  if (busy) return;
  addBubble('user', 'Apply anyway');
  setBusy(true, 'Tailoring your resume for this role…');
  try {
    const r = await api(`/api/sessions/${S.id}/apply-anyway`, { method: 'POST' });
    applyView(r, true);
    speak(r.reply);
  } catch (err) {
    setBusy(false);
    addBubble('error', err.message);
  }
}

function renderInsights() {
  const a = S.resume.assessment || {};
  const chips = [];
  const chip = (text, cls = '') => chips.push(`<span class="chip-s ${cls}">${escapeHtml(text)}</span>`);
  if (a.cv) chip(a.cv.verdict === 'already_strong' ? 'Your CV was already strong' : 'Improving your CV', 'good');
  if (a.fit) chip(`${FIT_LABEL[a.fit.level]}${a.fit.override ? ' · applying anyway' : ''}`, a.fit.level === 'strong' || a.fit.level === 'good' ? 'good' : a.fit.level === 'weak' ? 'warn' : 'bad');
  const req = (S.resume.target?.keywords || []).filter((k) => k.importance === 'must');
  if (req.length) {
    const shown = new Set(S.coverage?.matched || []);
    const covered = req.filter((k) => shown.has(k.term) || k.status === 'skipped' || k.evidence === 'no').length;
    chip(`Requirements ${covered}/${req.length}`, covered === req.length ? 'good' : 'warn');
  }
  if (S.compare?.facts) chip(`Facts kept ${S.compare.facts.kept}/${S.compare.facts.total}`, S.compare.facts.dropped.length ? 'bad' : 'good');
  // The status row is always there once a draft exists (it carries the page badge);
  // it only expands when there are details to show.
  const anyPanel = ['#assessBar', '#jdBar', '#evidenceBox', '#hiddenNote'].some((id) => !$(id).hidden);
  const hasDraft = S.resume.sections.some((x) => !x.hidden && x.items.some((i) => !i.hidden));
  $('#insights').hidden = !hasDraft;
  $('#insights').classList.toggle('nodetails', !anyPanel);
  if (!anyPanel) $('#insights').open = false;
  $('#insightChips').innerHTML = `${chips.join('')}${anyPanel ? '<span class="muted">Details</span>' : ''}`;
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
    flashChanges();
    renderBadge();
    renderChecks();
  };
  frame.srcdoc = renderResume(r, { editable, screen: true });
}

// Show the user where the last change landed: scroll there and highlight it.
function flashChanges(keys = pendingFlash) {
  if (!keys.length || $('#paper').hidden) return;
  const doc = $('#frame').contentDocument;
  if (!doc) return;
  if (!doc.getElementById('flash-style')) {
    const st = doc.createElement('style');
    st.id = 'flash-style';
    st.textContent = '.flash{background:#fff1a8 !important;box-shadow:0 0 0 3px #fff1a8;transition:background 1.2s,box-shadow 1.2s}';
    doc.head.appendChild(st);
  }
  const els = keys.flatMap((k) => [...doc.querySelectorAll(k === 'header' ? '.hd' : `[data-item="${CSS.escape(k)}"]`)]);
  if (!els.length) return;
  els.forEach((el) => el.classList.add('flash'));
  setTimeout(() => els.forEach((el) => el.classList.remove('flash')), 2600);
  const stage = $('#stage');
  const scale = $('#frame').getBoundingClientRect().width / $('#frame').offsetWidth || 1;
  const top = els[0].getBoundingClientRect().top * scale + $('#paper').offsetTop;
  stage.scrollTo({ top: Math.max(0, top - 60), behavior: 'smooth' });
  pendingFlash = [];
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
    : `${l.pages} of ${l.limit} page${l.limit > 1 ? 's' : ''}${l.level ? ' · tightened' : underfilled ? ' · add content' : l.expand ? ' · enlarged' : ''}`;
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
  // One number: things worth fixing. Tips (info) are listed in the panel but not counted.
  $('#checksCount').textContent = serious.length ? String(serious.length) : '';
  const draft = S.resume.sections.some((x) => !x.hidden && x.items.some((i) => !i.hidden));
  $('#checksCount').hidden = !serious.length || !draft;
  $('#checksCount').className = `count ${issues.some((i) => i.level === 'error') ? 'err' : 'warn'}`;
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
    underfilled: 'Page not full', 'fact-dropped': 'Fact lost', 'summary-dropped': 'Profile removed', 'headline-untargeted': 'Positioning', 'low-value-section': 'Low-value section', 'header-incomplete': 'Header', 'links-missing': 'Links',
    'ste-length': 'Too long', 'ste-passive': 'Passive voice', 'ste-pattern': 'Repetitive shape', 'ste-punctuation': 'Punctuation',
    'jd-missing': 'Job keyword', 'jd-ask': 'Needs your story', 'jd-gap': 'Job gap',
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

// ---------- Mobile: one pane at a time ----------
const isPhone = () => window.matchMedia('(max-width: 860px)').matches;
function showTab(tab) {
  document.body.dataset.tab = tab;
  document.querySelectorAll('.mobile-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  if (tab === 'resume') {
    $('#resumeDot').hidden = true;
    requestAnimationFrame(() => !$('#paper').hidden && fitScale());
  }
}
function markResumeUpdated() {
  if (isPhone() && document.body.dataset.tab !== 'resume') $('#resumeDot').hidden = false;
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
  document.querySelectorAll('.mobile-tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#insightsSummary').addEventListener('click', (e) => {
    if ($('#insights').classList.contains('nodetails')) e.preventDefault();
  });
  showTab('chat');
  $('#typeInstead').addEventListener('click', () => {
    typedOverride = true;
    setComposerMode('compact');
    $('#input').focus();
  });
  $('#input').addEventListener('focus', () => {
    if ($('#composer').dataset.mode === 'story') {
      typedOverride = true;
      setComposerMode('compact');
    }
  });
  const menu = $('#downloadMenu');
  const closeMenu = () => {
    menu.hidden = true;
    $('#downloadBtn').setAttribute('aria-expanded', 'false');
  };
  $('#downloadBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    $('#downloadBtn').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (e) => !e.target.closest('.menu-wrap') && closeMenu());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());
  menu.addEventListener('click', closeMenu);
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

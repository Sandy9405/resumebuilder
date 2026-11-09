// Speech-to-text with Sarvam (saaras:v4). The browser records short clips and
// posts them here, so the API key never leaves the server.
//
// Settings were chosen by testing against the real API: key terms (names and
// tools from the user's CV and target job) fixed "Scapia", "FastAPI" and
// "Collegedunia", which came out wrong without them. Language is auto-detected
// and codemix mode keeps English words in English for Hinglish speakers.

import { SarvamAIClient, SarvamAIError } from 'sarvamai';
import { cvTerms } from '../shared/compare.js';

export const MAX_CLIP_BYTES = 6 * 1024 * 1024; // a 30-second clip is far smaller
const MAX_TERMS = 50; // Sarvam's limit
const MAX_TERM_CHARS = 64;

let client = null;
export function setVoiceClient(c) {
  client = c;
}
function getClient() {
  if (!client) client = new SarvamAIClient({ apiSubscriptionKey: process.env.SARVAM_API_KEY });
  return client;
}

/** 'sarvam' when a key is configured (or a test client is set), else 'browser'. */
export function voiceProvider() {
  return client || process.env.SARVAM_API_KEY ? 'sarvam' : 'browser';
}

/** Names this user is likely to say: employers, tools, the target job's terms. */
export function voiceTerms(session) {
  const r = session.resume || {};
  const out = [];
  const seen = new Set();
  // Sarvam rejects (400) any term containing a comma or semicolon, so
  // "Acme Logistics, Pune" is sent as two terms: "Acme Logistics" and "Pune".
  const add = (t) => {
    for (const part of String(t || '').split(/[,;]/)) {
      const term = part.trim();
      const key = term.toLowerCase();
      if (!term || term.length > MAX_TERM_CHARS || seen.has(key) || out.length >= MAX_TERMS) continue;
      seen.add(key);
      out.push(term);
    }
  };
  for (const s of r.sections || []) for (const it of s.items || []) add(it.org);
  add(r.target?.company);
  for (const k of r.target?.keywords || []) add(k.term);
  for (const term of cvTerms(session.cvText || '').keys()) add(term);
  return out;
}

export class VoiceError extends Error {}

const sarvamMessage = (err) => err?.body?.error?.message || err?.message || '';

async function request(buffer, mimetype, terms) {
  const r = await getClient().speechToText.transcribe({
    file: new Blob([buffer], { type: mimetype || 'audio/webm' }),
    model: process.env.SARVAM_STT_MODEL || 'saaras:v4',
    language_code: process.env.SARVAM_STT_LANGUAGE || 'unknown',
    mode: process.env.SARVAM_STT_MODE || 'codemix',
    ...(terms.length ? { keyterms: terms } : {}),
  });
  return { transcript: (r.transcript || '').trim(), language: r.language_code || null };
}

/** @returns {Promise<{ transcript: string, language: string | null }>} */
export async function transcribe(buffer, mimetype, terms = []) {
  try {
    try {
      return await request(buffer, mimetype, terms);
    } catch (err) {
      // Key terms only help spelling. If Sarvam rejects the request (400) while
      // they were sent, retry once without them rather than lose the answer.
      if (!(err instanceof SarvamAIError) || err.statusCode !== 400 || !terms.length) throw err;
      console.warn(`Sarvam STT 400 with key terms, retrying without them: ${sarvamMessage(err)}`);
      return await request(buffer, mimetype, []);
    }
  } catch (err) {
    if (err instanceof SarvamAIError) {
      console.warn(`Sarvam STT ${err.statusCode}: ${sarvamMessage(err)}`);
      throw new VoiceError(
        err.statusCode === 401 || err.statusCode === 403
          ? 'Voice transcription is not authorised. Check the Sarvam API key.'
          : err.statusCode === 429
            ? 'Voice transcription is busy. Please try again in a moment.'
            : `Voice transcription failed${err.statusCode ? ` (${err.statusCode})` : ''}. Please try again or type instead.`,
      );
    }
    throw err;
  }
}

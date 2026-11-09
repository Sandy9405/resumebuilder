// Text extraction from uploaded or fetched documents (CVs and job descriptions).

import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

export class ExtractError extends Error {}

export const isPdf = (name, type) => type === 'application/pdf' || /\.pdf$/i.test(name || '');
export const isDocx = (name, type) =>
  /\.docx$/i.test(name || '') || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const isText = (name, type) => /\.(txt|md)$/i.test(name || '') || /^text\/plain/.test(type || '');

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')]+|\b(?:linkedin\.com|github\.com|behance\.net|dribbble\.com|medium\.com|gitlab\.com|kaggle\.com)\/[^\s<>"')]+/gi;

function uniqueLinks(list) {
  const seen = new Set();
  return list
    .map((u) => String(u).trim().replace(/[.,;]+$/, ''))
    .filter((u) => u && !/^mailto:|^tel:/i.test(u))
    .filter((u) => {
      const k = u.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
      return seen.has(k) ? false : (seen.add(k), true);
    });
}

// Hyperlinks behind words like "LinkedIn" or "Portfolio" are invisible to plain
// text extraction, so read them from PDF link annotations and DOCX relationships.
async function pdfLinks(pdf) {
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    for (const a of await page.getAnnotations()) if (a.subtype === 'Link' && a.url) out.push(a.url);
  }
  return out;
}

/** @returns {Promise<{ kind: 'pdf'|'docx'|'text', text: string, links: string[] }>} */
export async function extractDocument(buffer, name, type) {
  try {
    if (isPdf(name, type)) {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const text = (await extractText(pdf, { mergePages: true })).text || '';
      const annotated = await pdfLinks(pdf).catch(() => []);
      return { kind: 'pdf', text, links: uniqueLinks([...annotated, ...(text.match(URL_RE) || [])]) };
    }
    if (isDocx(name, type)) {
      const text = (await mammoth.extractRawText({ buffer })).value || '';
      const html = (await mammoth.convertToHtml({ buffer }).catch(() => ({ value: '' }))).value;
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
      return { kind: 'docx', text, links: uniqueLinks([...hrefs, ...(text.match(URL_RE) || [])]) };
    }
    if (isText(name, type)) {
      const text = buffer.toString('utf8');
      return { kind: 'text', text, links: uniqueLinks(text.match(URL_RE) || []) };
    }
  } catch {
    throw new ExtractError('Could not read that file. Is it a valid PDF or DOCX?');
  }
  throw new ExtractError('Please use a PDF, DOCX or TXT file.');
}

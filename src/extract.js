// Text extraction from uploaded or fetched documents (CVs and job descriptions).

import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

export class ExtractError extends Error {}

export const isPdf = (name, type) => type === 'application/pdf' || /\.pdf$/i.test(name || '');
export const isDocx = (name, type) =>
  /\.docx$/i.test(name || '') || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const isText = (name, type) => /\.(txt|md)$/i.test(name || '') || /^text\/plain/.test(type || '');

/** @returns {Promise<{ kind: 'pdf'|'docx'|'text', text: string }>} */
export async function extractDocument(buffer, name, type) {
  try {
    if (isPdf(name, type)) {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      return { kind: 'pdf', text: (await extractText(pdf, { mergePages: true })).text || '' };
    }
    if (isDocx(name, type)) return { kind: 'docx', text: (await mammoth.extractRawText({ buffer })).value || '' };
    if (isText(name, type)) return { kind: 'text', text: buffer.toString('utf8') };
  } catch {
    throw new ExtractError('Could not read that file. Is it a valid PDF or DOCX?');
  }
  throw new ExtractError('Please use a PDF, DOCX or TXT file.');
}

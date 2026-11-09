// Server-side rendering in headless Chromium. Runs the same document and the
// same in-page layout engine (shared/render.js) as the browser preview, so the
// page count, page breaks and QA results the model sees are the ones the user sees.
//
// Playwright is optional. Without it, measurement returns null and PDF export
// reports itself unavailable (the client then uses the browser's print dialog).

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderResume } from '../shared/render.js';

const fontDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts');
const fontCache = new Map();
// setContent() pages have no origin to fetch /fonts from, so fonts are inlined.
const dataFontUrl = (file) => {
  if (!fontCache.has(file)) {
    fontCache.set(file, `data:font/woff2;base64,${readFileSync(path.join(fontDir, file)).toString('base64')}`);
  }
  return fontCache.get(file);
};

let browserPromise = null;
let idleTimer = null;
const IDLE_MS = Number(process.env.BROWSER_IDLE_MS) || 5 * 60 * 1000;

function touchBrowser() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => closeLayout().catch(() => {}), IDLE_MS);
  idleTimer.unref?.();
}

async function getBrowser() {
  touchBrowser();
  if (!browserPromise) {
    browserPromise = (async () => {
      // createRequire so a globally installed Playwright (NODE_PATH) is found too.
      const { chromium } = createRequire(import.meta.url)('playwright');
      const opts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
      return chromium.launch(opts);
    })().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

export async function layoutAvailable() {
  try {
    await getBrowser();
    return true;
  } catch {
    return false;
  }
}

export function countPdfPages(buf) {
  const s = buf.toString('latin1');
  return (s.match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

async function withLaidOutPage(resume, fn) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.emulateMedia({ media: 'print' });
    await page.setContent(renderResume(resume, { fontUrl: dataFontUrl }), { waitUntil: 'load' });
    const layout = await page.evaluate(() => window.__layoutPromise);
    return await fn(page, layout);
  } finally {
    await page.close();
  }
}

export async function renderPdf(resume) {
  return withLaidOutPage(resume, async (page, layout) => {
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const pages = countPdfPages(pdf);
    if (pages !== layout.pages) {
      layout.issues.push({ level: 'error', code: 'pdf-mismatch', message: `The PDF has ${pages} pages but the layout produced ${layout.pages}.`, path: '' });
    }
    return { pdf, pages, layout };
  });
}

/**
 * Lay the resume out and run visual QA.
 * @returns {Promise<null | {pages, limit, fits, level, overflow, baseOverflow, lastPageFill, issues, message}>}
 */
export async function measureLayout(resume) {
  if (!resume.sections?.some((s) => !s.hidden && s.items?.some((i) => !i.hidden))) return null;
  try {
    return await withLaidOutPage(resume, async (_page, layout) => ({ ...layout, message: describeFit(layout) }));
  } catch (err) {
    if (process.env.DEBUG) console.error('measureLayout failed:', err);
    return null;
  }
}

export function describeFit(l) {
  if (!l) return 'Layout not measured.';
  const pct = (x) => `${Math.round(x * 100)}%`;
  if (!l.fits) {
    return `Overflows: ${l.pages} pages against a ${l.limit}-page limit, about ${pct(l.overflow)} of a page too long. Shorten or hide lower-priority content (set_visibility, or move bullets to reserve_bullets). Do not rely on smaller text.`;
  }
  const tight = l.level ? ` Spacing was tightened (level ${l.level}) to absorb a ${pct(l.baseOverflow)} overflow; trimming a line or two would restore normal spacing.` : '';
  return `Fits: ${l.pages} of ${l.limit} page(s); last page ${pct(l.lastPageFill)} full.${tight}`;
}

export async function closeLayout() {
  clearTimeout(idleTimer);
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    await b?.close();
  }
}

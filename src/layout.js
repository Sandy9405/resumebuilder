// Server-side rendering with headless Chromium: page-fit measurement and PDF
// export. Both use shared/render.js, the same renderer as the browser preview.
//
// Playwright is optional. Without it, measurement returns null and PDF export
// reports itself unavailable (the client falls back to the browser's print dialog).

import { createRequire } from 'node:module';
import { renderResume } from '../shared/render.js';
import { printableHeightPx } from '../shared/templates.js';

let browserPromise = null;

async function getBrowser() {
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

function countPdfPages(buf) {
  // Count page objects. Chromium's PDFs are uncompressed at this level.
  const s = buf.toString('latin1');
  return (s.match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

async function withPage(fn) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

export async function renderPdf(resume) {
  return withPage(async (page) => {
    await page.setContent(renderResume(resume), { waitUntil: 'load' });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    return { pdf, pages: countPdfPages(pdf) };
  });
}

/**
 * Measure how the resume fits its page limit.
 * @returns {Promise<null | {pages:number, limit:number, fits:boolean, fill:number, message:string}>}
 */
export async function measureFit(resume) {
  if (!resume.sections?.length) return null;
  try {
    return await withPage(async (page) => {
      // Width matches the printable area so line wrapping is identical to print.
      await page.setContent(renderResume(resume), { waitUntil: 'load' });
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      const pages = countPdfPages(pdf);
      await page.emulateMedia({ media: 'print' });
      const heightPx = await page.evaluate(() => document.getElementById('sheet').getBoundingClientRect().height);
      const limit = resume.settings.pages;
      const fill = heightPx / (printableHeightPx(resume.settings.template) * limit);
      let message;
      if (pages > limit) {
        message = `Overflows: renders to ${pages} pages against a ${limit}-page limit (about ${Math.round((fill - 1) * 100)}% too long). Cut lower-priority content; do not shrink the text.`;
      } else if (limit === 2 && fill < 0.6) {
        message = `Fits, but uses only about ${Math.round(fill * 200)}% of one page's worth of space across two pages. The material may suit one page better.`;
      } else {
        message = `Fits: ${pages} of ${limit} page(s), about ${Math.round(Math.min(fill, 1) * 100)}% of the available space used.`;
      }
      return { pages, limit, fits: pages <= limit, fill: Number(fill.toFixed(3)), message };
    });
  } catch (err) {
    if (process.env.DEBUG) console.error('measureFit failed:', err);
    return null;
  }
}

export async function closeLayout() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    await b?.close();
  }
}

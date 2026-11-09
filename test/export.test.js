import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderResume } from '../shared/render.js';
import { renderDocx } from '../src/docx.js';
import { measureLayout, renderPdf, layoutAvailable, closeLayout } from '../src/layout.js';
import { sampleResume } from './fixtures/sample-resume.js';

const TEMPLATES = ['iitb', 'iima', 'hbs', 'pro'];

test('render escapes HTML, embeds the engine, and marks editable text', () => {
  for (const t of TEMPLATES) {
    const r = sampleResume(t, 1);
    r.header.name = 'Priya <Raman>';
    const html = renderResume(r);
    assert.match(html, /Priya &lt;Raman&gt;/);
    assert.match(html, /@page\{size:/);
    assert.match(html, /__layoutPromise/);
    assert.doesNotMatch(html, /text-align:\s*justify/);
  }
  assert.match(renderResume(sampleResume('hbs', 1), { editable: true }), /contenteditable="true"[^>]*data-path="s1\.i2\.bullets\.0"/);
});

test('hidden items and sections are not rendered; reserve bullets are not rendered', () => {
  const r = sampleResume('hbs', 1);
  r.sections[0].items[1].hidden = true; // Zeta internship
  r.sections[2].hidden = true; // Projects
  r.sections[0].items[0].reserve = ['RESERVED BULLET TEXT'];
  const html = renderResume(r);
  assert.doesNotMatch(html, /Zeta/);
  assert.doesNotMatch(html, /Apache Kafka/);
  assert.doesNotMatch(html, /RESERVED BULLET TEXT/);
});

test('docx export produces a valid file for each template, with hidden content excluded', async () => {
  for (const t of TEMPLATES) {
    const r = sampleResume(t, 1, { longOrg: true });
    r.sections[0].items[1].hidden = true;
    const buf = await renderDocx(r);
    assert.equal(buf.subarray(0, 2).toString(), 'PK');
    const { default: JSZip } = await import('jszip');
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
    assert.doesNotMatch(xml, /Zeta/);
    assert.match(xml, /Shiprocket/i);
    assert.doesNotMatch(xml, /w:jc w:val="both"/, 'no justified paragraphs');
    assert.doesNotMatch(xml, /(<w:tab\/>){2,}/, 'no runs of tabs for alignment');
  }
});

test('layout engine: QA, pagination, density and PDF', async (t) => {
  if (!(await layoutAvailable())) return t.skip('no headless browser');
  t.after(closeLayout);

  await t.test('clean resume passes visual QA in every template', async () => {
    for (const tpl of TEMPLATES) {
      const l = await measureLayout(sampleResume(tpl, 1));
      const errors = l.issues.filter((i) => i.level === 'error');
      assert.deepEqual(errors, [], `${tpl}: ${JSON.stringify(errors)}`);
      assert.equal(l.pages, 1);
      assert.equal(l.fits, true);
      assert.equal(l.level, 0);
    }
  });

  await t.test('long organisation names wrap without colliding with dates', async () => {
    for (const tpl of TEMPLATES) {
      const l = await measureLayout(sampleResume(tpl, 1, { longOrg: true }));
      const bad = l.issues.filter((i) => ['date-collision', 'date-misaligned', 'outside-boundary', 'overlap'].includes(i.code));
      assert.deepEqual(bad, [], tpl);
    }
  });

  await t.test('large overflow is reported, never squeezed; headings are never stranded', async () => {
    const l = await measureLayout(sampleResume('hbs', 1, { extraBullets: 40 }));
    assert.equal(l.fits, false);
    assert.equal(l.level, 0, 'no density change for a large overflow');
    assert.ok(l.issues.some((i) => i.code === 'over-limit'));
    assert.ok(!l.issues.some((i) => i.code === 'orphan-heading'));
  });

  await t.test('small overflow is absorbed by bounded spacing adjustment', async () => {
    let found = null;
    for (let n = 0; n <= 40 && !found; n++) {
      const l = await measureLayout(sampleResume('iitb', 1, { extraBullets: n }));
      if (l.level > 0) found = l;
      if (!l.fits) break;
    }
    assert.ok(found, 'some bullet count should trigger the ladder before overflowing');
    assert.equal(found.fits, true);
    assert.ok(found.baseOverflow > 0 && found.baseOverflow <= 0.06);
  });

  await t.test('PDF page count equals the layout and the limit', async () => {
    for (const tpl of TEMPLATES) {
      const { pdf, pages, layout } = await renderPdf(sampleResume(tpl, 1));
      assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
      assert.equal(pages, layout.pages);
      assert.equal(pages, 1, tpl);
    }
    const two = await renderPdf(sampleResume('hbs', 2, { extraBullets: 40 }));
    assert.equal(two.pages, 2);
    assert.equal(two.layout.fits, true);
  });

  await t.test('ATS: PDF text reads in order, with names and headings intact', async () => {
    const { extractText, getDocumentProxy } = await import('unpdf');
    for (const tpl of TEMPLATES) {
      const { pdf } = await renderPdf(sampleResume(tpl, 1));
      const doc = await getDocumentProxy(new Uint8Array(pdf));
      const text = (await extractText(doc, { mergePages: true })).text.replace(/\s+/g, ' ');
      assert.match(text, /Priya Raman/i, `${tpl}: name must not be letter-spaced apart`);
      assert.doesNotMatch(text, /\b(\w ){4,}\w\b/, `${tpl}: no letter-by-letter words`);
      const at = (re) => text.search(re);
      const exp = at(/experience/i);
      const edu = at(/education/i);
      assert.ok(exp >= 0 && edu >= 0, tpl);
      assert.ok(at(/Shiprocket/i) > exp, `${tpl}: experience heading precedes its content`);
      assert.ok(at(/National Institute of/i) > edu, `${tpl}: education heading precedes its content`);
      assert.ok(at(/Jul 2022/) > at(/Shiprocket/i) && at(/Jul 2022/) < at(/Built a rate-shopping/), `${tpl}: dates stay with their entry`);
    }
  });

  await t.test('a fragment spilling onto its own line in a table cell is flagged ("Top 1%")', async () => {
    const r = sampleResume('iima', 1);
    r.sections[1].items[0].note = "Dean's List · Rank 2 / 160 (Top 1%)";
    const l = await measureLayout(r);
    assert.ok(l.issues.some((i) => i.code === 'table-wrap' && /Top 1%/.test(i.message)));
  });

  await t.test('two-page limit with one page of content suggests one page', async () => {
    const l = await measureLayout(sampleResume('hbs', 2));
    assert.ok(l.issues.some((i) => i.code === 'sparse-page'));
  });
});

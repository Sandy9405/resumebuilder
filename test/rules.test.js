// Tests for: full one-page layout, header links, verbatim user wording, STE-style checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderResume } from '../shared/render.js';
import { renderDocx } from '../src/docx.js';
import { measureLayout, renderPdf, layoutAvailable, closeLayout, withBrowserPage } from '../src/layout.js';
import { extractDocument } from '../src/extract.js';
import { lintResume } from '../shared/lint.js';
import { emptyResume, applyOp, applyManualEdit, OpError } from '../src/ops.js';
import { getTemplate } from '../shared/templates.js';
import { sampleResume } from './fixtures/sample-resume.js';

function sparse(template) {
  const r = sampleResume(template, 1);
  r.sections = r.sections.filter((s) => ['experience', 'skills'].includes(s.kind));
  r.sections[0].items = r.sections[0].items.slice(0, 1);
  return r;
}

test('one page is filled: body text and spacing grow, name and headings do not', async (t) => {
  if (!(await layoutAvailable())) return t.skip('no headless browser');
  t.after(closeLayout);
  for (const tpl of ['iitb', 'iima', 'hbs']) {
    const l = await measureLayout(sparse(tpl));
    const tp = getTemplate(tpl);
    assert.equal(l.pages, 1, tpl);
    assert.ok(l.expand > 0, `${tpl}: expected expansion`);
    assert.ok(l.lastPageFill > l.baseFill, tpl);
    assert.ok(l.bodySize <= tp.size.max, `${tpl}: body ${l.bodySize} exceeds max ${tp.size.max}`);
    assert.ok(l.issues.some((i) => i.code === 'underfilled'), `${tpl}: thin content must still ask for more`);
    assert.deepEqual(l.issues.filter((i) => i.level === 'error'), [], tpl);
  }
  // Name and heading sizes are unchanged by expansion.
  const r = sparse('hbs');
  const sizes = await withBrowserPage(async (page) => {
    await page.setContent(renderResume(r, { fontUrl: (f) => `data:,${f}` }));
    await page.evaluate(() => window.__layoutPromise);
    return page.evaluate(() => ({
      name: getComputedStyle(document.querySelector('.hd .name')).fontSize,
      heading: getComputedStyle(document.querySelector('.sh')).fontSize,
      body: getComputedStyle(document.querySelector('.bul .t')).fontSize,
    }));
  });
  const pt = (px) => Math.round((parseFloat(px) * 72) / 96 * 100) / 100;
  assert.equal(pt(sizes.name), 16);
  assert.equal(pt(sizes.heading), 12.5);
  assert.ok(pt(sizes.body) > 10.5, `body grew: ${pt(sizes.body)}`);
  // A two-page limit is never stretched.
  const two = await measureLayout({ ...sparse('hbs'), settings: { template: 'hbs', pages: 2 } });
  assert.equal(two.expand, 0);
});

test('header links are real hyperlinks in HTML, PDF and DOCX, and are recovered from uploads', async (t) => {
  const r = sampleResume('hbs', 1);
  r.header.links = ['https://www.linkedin.com/in/priyaraman/', 'priya.dev', 'github.com/priyar'];
  const html = renderResume(r);
  assert.match(html, /<a href="https:\/\/www\.linkedin\.com\/in\/priyaraman\/">linkedin\.com\/in\/priyaraman<\/a>/);
  assert.match(html, /<a href="https:\/\/priya\.dev">priya\.dev<\/a>/);
  assert.match(html, /<a href="mailto:priya\.raman@example\.com">/);

  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await renderDocx(r));
  const rels = await zip.file('word/_rels/document.xml.rels').async('string');
  assert.match(rels, /Target="https:\/\/priya\.dev"[^>]*TargetMode="External"|TargetMode="External"[^>]*Target="https:\/\/priya\.dev"/);

  if (!(await layoutAvailable())) return t.skip('no headless browser for PDF part');
  t.after(closeLayout);
  const { pdf } = await renderPdf(r);
  const got = await extractDocument(pdf, 'cv.pdf', 'application/pdf');
  for (const u of ['linkedin.com/in/priyaraman', 'priya.dev', 'github.com/priyar']) {
    assert.ok(got.links.some((l) => l.includes(u)), `${u} recovered from PDF link annotations: ${got.links}`);
  }
});

test('user wording is kept verbatim and exempt from style checks', () => {
  const r = emptyResume({ template: 'hbs' });
  const it = (o) => ({ heading: 'Eng', org: 'Acme', location: '', dates: '', detail: '', note: '', bullets: [], reserve_bullets: [], user_wording: [], ...o });
  const mine = 'Spearheaded the Kafka migration — my words';
  applyOp(r, 'create_resume', { header: {}, sections: [{ kind: 'experience', title: 'Experience', items: [it({ bullets: [mine], user_wording: [mine] })] }], confirm_replace: false });
  const s = r.sections[0];
  const id = s.items[0].id;
  assert.throws(() => applyOp(r, 'update_item', { section_id: s.id, item_id: id, item: it({ bullets: ['Led the Kafka migration'], user_wording: [] }), user_requested_change: false }), OpError);
  assert.throws(() => applyOp(r, 'update_item', { section_id: s.id, item_id: id, item: it({ bullets: ['Led the Kafka migration'], user_wording: [mine] }), user_requested_change: false }), /exactly as written/);
  applyOp(r, 'update_item', { section_id: s.id, item_id: id, item: it({ bullets: [mine, 'Wrote tests'], user_wording: [mine] }), user_requested_change: false });
  assert.deepEqual(r.sections[0].items[0].bullets, [mine, 'Wrote tests']);
  const codes = lintResume(r, '').filter((i) => i.path.endsWith('bullets.0')).map((i) => i.code);
  assert.deepEqual(codes, [], 'no style flags on the user\'s own wording');
  // Typing into the preview locks the new text too.
  applyManualEdit(r, `${s.id}.${id}.bullets.1`, 'Wrote integration tests, my way');
  assert.ok(r.sections[0].items[0].locked.includes('Wrote integration tests, my way'));
  // Removing it needs the explicit flag.
  applyOp(r, 'update_item', { section_id: s.id, item_id: id, item: it({ bullets: [], user_wording: [] }), user_requested_change: true });
  assert.deepEqual(r.sections[0].items[0].bullets, []);
});

test('STE-style checks: length, passive, repeated ", …ing" shape; keywords exempt', () => {
  const mk = (bullets, target) => ({
    header: { name: 'A', email: 'a@x.com', phone: '1', tagline: 'T', location: 'P', links: ['linkedin.com/in/a'] },
    target,
    sections: [{ id: 's', kind: 'experience', title: 'Experience', items: [{ id: 'i', heading: 'E', org: 'O', location: '', dates: '', detail: '', bullets }] }],
  });
  const codes = (r) => lintResume(r, '').map((i) => i.code);
  assert.ok(codes(mk(['Reports were automated with Python'])).includes('ste-passive'));
  assert.ok(codes(mk(['The team was led by me'])).includes('ste-passive'));
  assert.ok(codes(mk([Array(27).fill('word').join(' ')])).includes('ste-length'));
  assert.ok(codes(mk(['Built A, cutting cost', 'Built B, raising uptime', 'Built C, saving time', 'Built D, adding tests'])).includes('ste-pattern'));
  assert.ok(!codes(mk(['Built A, cutting cost', 'Wrote B', 'Tested C', 'Shipped D'])).includes('ste-pattern'));
  assert.ok(codes(mk(['Built a robust pipeline'])).includes('ai-language'));
  assert.ok(!codes(mk(['Built a robust pipeline'], { keywords: [{ term: 'robust', aliases: [] }] })).includes('ai-language'), 'JD keyword exempt');
  assert.deepEqual(codes(mk(['Built the payments API in Go'])), []);
});

test('header completeness: sub-header and links are required', () => {
  const r = { header: { name: 'A', email: 'a@x.com', phone: '1' }, profile: { jobFamilies: ['UX Design'] }, sections: [] };
  const msgs = lintResume(r, '').map((i) => `${i.code}:${i.message}`);
  assert.ok(msgs.some((m) => m.startsWith('header-incomplete:No sub-header')));
  assert.ok(msgs.some((m) => m.startsWith('links-missing:No profile links')));
  assert.ok(msgs.some((m) => /portfolio/.test(m)));
});

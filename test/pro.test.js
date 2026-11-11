// Experienced Professional format, career-stage routing, inline bold, recognition lines.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { renderResume, rich } from '../shared/render.js';
import { renderDocx } from '../src/docx.js';
import { lintResume } from '../shared/lint.js';
import { TEMPLATES, FORMATS_BY_STAGE } from '../shared/templates.js';
import { emptyResume } from '../src/ops.js';
import { measureLayout, layoutAvailable, closeLayout } from '../src/layout.js';
import { sampleResume } from './fixtures/sample-resume.js';

after(closeLayout);

test('career stage routes formats: recent graduates get academic formats, professionals get experience-first', () => {
  assert.deepEqual(FORMATS_BY_STAGE.recent, ['iitb', 'iima', 'hbs', 'pro'], 'graduates can pick the experienced layout; it is listed last, not recommended');
  assert.equal(FORMATS_BY_STAGE.experienced[0], 'pro');
  assert.deepEqual(Object.keys(FORMATS_BY_STAGE), ['recent', 'experienced'], 'two stages only');
  assert.equal(emptyResume({ stage: 'working' }).settings.stage, 'experienced', 'old sessions map to experienced');
  for (const ids of Object.values(FORMATS_BY_STAGE)) for (const id of ids) assert.ok(TEMPLATES[id], id);
  const r = emptyResume({ stage: 'experienced', template: 'pro' });
  assert.equal(r.settings.stage, 'experienced');
  assert.equal(r.profile.careerStage, 'experienced');
  assert.equal(emptyResume({ stage: 'bogus' }).settings.stage, '');
});

test('the pro format puts experience before education and education before skills', () => {
  const order = TEMPLATES.pro.sectionOrder;
  assert.ok(order.indexOf('experience') < order.indexOf('education'));
  assert.ok(order.indexOf('education') < order.indexOf('skills'));
  assert.equal(order[0], 'summary');
});

test('inline bold is escaped safely and ignored by checks', () => {
  assert.equal(rich('**14X GMV** growth <b>x</b>'), '<b>14X GMV</b> growth &lt;b&gt;x&lt;/b&gt;');
  assert.equal(rich('2**3 and ** x **'), '2**3 and ** x **');
  const r = sampleResume('pro', 1);
  r.sections[0].items[0].bullets[0] = '**Spearheaded** a rate-shopping service in Go';
  const html = renderResume(r);
  assert.match(html, /<b>Spearheaded<\/b> a rate-shopping/);
  const hit = lintResume(r, '').find((i) => i.code === 'ai-language' && i.path.endsWith('bullets.0'));
  assert.ok(hit && !hit.message.includes('**'), 'checks read the text without markers');
});

test('pro header: centred, contact order phone · email · links · location, email not styled as a link', () => {
  const html = renderResume(sampleResume('pro', 1));
  assert.match(html, /class="blk hd centered"/);
  const contact = html.slice(html.indexOf('class="contact"'), html.indexOf('</div>', html.indexOf('class="contact"')));
  const at = (s) => contact.indexOf(s);
  assert.ok(at('+91 98200') < at('priya.raman@') && at('priya.raman@') < at('linkedin.com') && at('linkedin.com') < at('Bengaluru'));
  assert.match(contact, /<a class="mail" href="mailto:/);
});

test('recognition line renders under a role in HTML and DOCX, and stays with the last bullet', async () => {
  const r = sampleResume('pro', 1);
  r.sections[0].items[0].note = "Manager's Choice Award 2017";
  const html = renderResume(r);
  assert.match(html, /class="t note"[^>]*>Manager&#39;s Choice Award 2017|class="t note"[^>]*>Manager's Choice Award 2017/);
  const noteAt = html.indexOf('class="blk eh note-line"');
  const prevBlock = html.lastIndexOf('<div class="blk', noteAt - 6); // skip this block's own '<div '
  assert.match(html.slice(prevBlock, noteAt), /class="blk bul"[^>]*data-keep="next"/, 'last bullet keeps with the recognition line');
  const { default: JSZip } = await import('jszip');
  const xml = await (await JSZip.loadAsync(await renderDocx(r))).file('word/document.xml').async('string');
  assert.match(xml, /Manager(&apos;|')s Choice Award 2017/);
  assert.match(xml, /<w:b\/>[\s\S]{0,200}Software Engineer II/, 'role is bold');
});

test('pro passes visual QA and ATS reading order like the other formats', async (t) => {
  if (!(await layoutAvailable())) return t.skip('no headless browser');
  const l = await measureLayout(sampleResume('pro', 1, { longOrg: true }));
  assert.deepEqual(l.issues.filter((i) => i.level === 'error'), []);
  assert.equal(l.pages, 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderResume } from '../shared/render.js';
import { renderDocx } from '../src/docx.js';
import { measureFit, renderPdf, layoutAvailable, closeLayout } from '../src/layout.js';

const item = (o) => ({ id: Math.random().toString(36).slice(2), heading: '', org: '', location: '', dates: '', detail: '', bullets: [], ...o });
function sample(template, pages, nBullets = 3) {
  return {
    settings: { template, pages, buildMode: 'talk' },
    header: { name: 'Asha <Verma>', tagline: '', email: 'a@x.com', phone: '1', location: 'Pune', links: [] },
    sections: [
      { id: 's1', kind: 'education', title: 'Education', items: [item({ heading: 'B.Tech', org: 'COEP', dates: '2019 – 2023', detail: 'CGPA 8.4' })] },
      { id: 's2', kind: 'experience', title: 'Experience', items: [item({ heading: 'Engineer', org: 'Acme', dates: '2023 – Present', bullets: Array.from({ length: nBullets }, (_, i) => `Built component ${i} of the shipment tracking system used by the operations team every day`) })] },
      { id: 's3', kind: 'skills', title: 'Skills', items: [item({ heading: 'Technical', detail: 'Python, SQL' })] },
    ],
  };
}

test('render escapes HTML and produces every template', () => {
  for (const t of ['iitb', 'iima', 'hbs']) {
    const html = renderResume(sample(t, 1));
    assert.match(html, /Asha &lt;Verma&gt;/);
    assert.match(html, /@page/);
    assert.match(html, /CGPA 8\.4/);
  }
  assert.match(renderResume(sample('hbs', 1), { editable: true }), /contenteditable="true" data-path="s2\./);
});

test('docx export produces a valid zip for each template', async () => {
  for (const t of ['iitb', 'iima', 'hbs']) {
    const buf = await renderDocx(sample(t, 1));
    assert.equal(buf.subarray(0, 2).toString(), 'PK');
    assert.ok(buf.length > 3000);
  }
});

test('layout: short resume fits one page, long one overflows', async (t) => {
  if (!(await layoutAvailable())) return t.skip('no headless browser');
  t.after(closeLayout);
  const short = await measureFit(sample('hbs', 1));
  assert.equal(short.pages, 1);
  assert.equal(short.fits, true);
  const long = await measureFit(sample('hbs', 1, 70));
  assert.ok(long.pages > 1);
  assert.equal(long.fits, false);
  assert.match(long.message, /Overflows/);
  const { pdf, pages } = await renderPdf(sample('iitb', 1));
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.equal(pages, 1);
});

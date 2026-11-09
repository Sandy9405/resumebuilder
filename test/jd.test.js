import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isBlockedAddress, jobFromUrl, jobFromText, htmlToJobText, JdError } from '../src/jd.js';
import { jdCoverage, jdIssues, termPattern } from '../shared/jd.js';
import { createApp } from '../src/server.js';
import { mockClient } from '../src/mock-client.js';
import { closeLayout } from '../src/layout.js';

const JD_BODY = 'We are hiring a backend engineer to build payment services. You will design APIs in Python, own PostgreSQL schemas, run services on Kubernetes and work with product managers on roadmap trade-offs. 3+ years of experience required. '.repeat(3);

let srv;
let base;
before(async () => {
  srv = http
    .createServer((req, res) => {
      if (req.url === '/ld') {
        res.setHeader('Content-Type', 'text/html');
        return res.end(`<html><head><title>Jobs</title><script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Backend Engineer',
          hiringOrganization: { '@type': 'Organization', name: 'Example Co' },
          description: `<p>${JD_BODY}</p><ul><li>Python &amp; Go</li></ul>`,
        })}</script></head><body><nav>Menu</nav></body></html>`);
      }
      if (req.url === '/plain') {
        res.setHeader('Content-Type', 'text/html');
        return res.end(`<html><body><script>var x=1</script><h1>Backend Engineer</h1><p>${JD_BODY}</p></body></html>`);
      }
      if (req.url === '/thin') {
        res.setHeader('Content-Type', 'text/html');
        return res.end('<html><body>Sign in to view this job</body></html>');
      }
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/ld' });
        return res.end();
      }
      res.writeHead(404).end();
    })
    .listen(0);
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  srv.close();
  await closeLayout();
});

test('private, loopback, link-local and metadata addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:7f00:1']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '104.16.1.1', '2606:4700::1111', '::ffff:8.8.8.8']) assert.equal(isBlockedAddress(ip), false, ip);
});

test('the fetcher refuses internal targets and odd URLs', async () => {
  // Assert the reason, not just failure: a refused connection would also reject.
  const blocked = /not allowed/;
  await assert.rejects(jobFromUrl(`${base}/ld`), /standard web ports|not allowed/);
  for (const u of [
    'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost/', 'http://[::1]/',
    'http://0x7f.1/', 'http://2130706433/', 'http://10.0.0.1/', 'http://[::ffff:169.254.169.254]/',
  ]) {
    await assert.rejects(jobFromUrl(u), blocked, u);
  }
  await assert.rejects(jobFromUrl('file:///etc/passwd'), /Only http and https/);
  await assert.rejects(jobFromUrl('http://example.com:6379/'), /standard web ports/);
  await assert.rejects(jobFromUrl('not a url'), /web address/);
});

test('JSON-LD JobPosting is preferred, redirects are followed, thin pages are rejected', async () => {
  const ld = await jobFromUrl(`${base}/ld`, { allowPrivate: true });
  assert.equal(ld.title, 'Backend Engineer');
  assert.equal(ld.company, 'Example Co');
  assert.match(ld.text, /Python & Go/);
  assert.doesNotMatch(ld.text, /Menu/);
  const red = await jobFromUrl(`${base}/redirect`, { allowPrivate: true });
  assert.equal(red.title, 'Backend Engineer');
  const plain = await jobFromUrl(`${base}/plain`, { allowPrivate: true });
  assert.match(plain.text, /payment services/);
  assert.doesNotMatch(plain.text, /var x/);
  await assert.rejects(jobFromUrl(`${base}/thin`, { allowPrivate: true }), /login/);
  assert.throws(() => jobFromText('too short'), JdError);
});

test('htmlToJobText decodes entities and handles @graph', () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"JobPosting","title":"PM","description":"&lt;b&gt;Own&lt;/b&gt; the roadmap &amp; ship"}]}</script>`;
  const r = htmlToJobText(html);
  assert.equal(r.title, 'PM');
  assert.match(r.text, /Own the roadmap & ship/);
});

test('keyword coverage respects boundaries and aliases; gaps are never "added"', () => {
  assert.ok(termPattern('C++').test('Wrote C++ services'));
  assert.ok(!termPattern('Go').test('Google'));
  assert.ok(termPattern('Node.js').test('APIs in Node.js.'));
  const resume = {
    header: {},
    target: {
      keywords: [
        { term: 'PostgreSQL', aliases: ['Postgres'], importance: 'must', evidence: 'yes' },
        { term: 'Go', aliases: [], importance: 'must', evidence: 'yes' },
        { term: 'Kafka', aliases: [], importance: 'nice', evidence: 'no' },
        { term: 'Terraform', aliases: [], importance: 'nice', evidence: 'unknown' },
      ],
    },
    sections: [{ id: 's', kind: 'experience', title: 'Experience', items: [{ id: 'i', heading: 'Eng', org: 'X', location: '', dates: '', detail: '', note: '', bullets: ['Tuned Postgres queries at Google'] }] }],
  };
  const c = jdCoverage(resume);
  assert.equal(c.must.matched, 1);
  assert.deepEqual(c.matched, ['PostgreSQL']);
  const codes = Object.fromEntries(jdIssues(resume).map((i) => [i.message.match(/"([^"]+)"/)[1], i.code]));
  assert.deepEqual(codes, { Go: 'jd-missing', Kafka: 'jd-gap', Terraform: 'jd-ask' });
});

test('server: pasted JD sets a target; JD numbers do not count as the user\'s facts; removal clears it', async () => {
  const app = createApp({ client: mockClient }).listen(0);
  await new Promise((r) => app.once('listening', r));
  const url = `http://localhost:${app.address().port}`;
  const post = (p, body) => fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const { body: s } = await post('/api/sessions', { buildMode: 'talk', template: 'hbs', pages: 1 });
    await post(`/api/sessions/${s.id}/message`, { text: 'I work at Acme Logistics' });
    const fd = new FormData();
    fd.append('text', `${JD_BODY} We value 6 hours of focused work.`);
    const r = await fetch(`${url}/api/sessions/${s.id}/jd`, { method: 'POST', body: fd });
    const v = await r.json();
    assert.equal(r.status, 200);
    assert.equal(v.resume.target.title, 'Backend Engineer');
    assert.equal(v.jd.source, 'pasted text');
    assert.ok(v.coverage.must.total === 3);
    assert.ok(v.issues.some((i) => i.code === 'jd-ask'));
    // The mock draft says "6 hours"; the JD also says 6, but the JD is not the user's evidence.
    assert.ok(v.issues.some((i) => i.code === 'unverified-number' && /"6"/.test(i.message)));

    const bad = new FormData();
    bad.append('url', 'http://127.0.0.1:1/');
    const br = await fetch(`${url}/api/sessions/${s.id}/jd`, { method: 'POST', body: bad });
    assert.equal(br.status, 400);

    const del = await (await fetch(`${url}/api/sessions/${s.id}/jd`, { method: 'DELETE' })).json();
    assert.equal(del.jd, null);
    assert.equal(del.resume.target, null);
    assert.equal(del.canUndo, true);
  } finally {
    app.close();
  }
});

// Job descriptions: fetch from a URL (safely), or take uploaded/pasted text.
//
// Fetching a user-supplied URL from the server is an SSRF risk: someone could
// point it at an internal address. Every connection, including each redirect
// hop, resolves DNS through safeLookup, which refuses private, loopback,
// link-local and metadata addresses at connect time (so DNS rebinding cannot
// slip past a one-off check).

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';
import { extractDocument, isPdf, isDocx } from './extract.js';
import { withBrowserPage } from './layout.js';

export const MAX_JD_CHARS = 40000;
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const UA = 'Mozilla/5.0 (compatible; ResumeBuilder/1.0; job-description fetch)';

export class JdError extends Error {}

// ---------------------------------------------------------------- address safety

function v4ToInt(ip) {
  return ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}
const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [v4ToInt(base), bits]);

function expandV6(ip) {
  let a = ip.toLowerCase().split('%')[0];
  const v4 = a.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = v4[1].split('.').map(Number);
    a = a.slice(0, -v4[1].length) + `${((n[0] << 8) | n[1]).toString(16)}:${((n[2] << 8) | n[3]).toString(16)}`;
  }
  const [head, tail] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const fill = tail !== undefined ? Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((x) => parseInt(x || '0', 16));
}

export function isBlockedAddress(ip) {
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
  }
  if (net.isIPv6(ip)) {
    const g = expandV6(ip);
    // IPv4-mapped (::ffff:a.b.c.d, also written ::ffff:a9fe:a9fe) and IPv4-compatible forms.
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
      if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return true; // :: and ::1
      return isBlockedAddress(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    }
    return (
      (g[0] & 0xfe00) === 0xfc00 || // unique local fc00::/7
      (g[0] & 0xffc0) === 0xfe80 || // link-local fe80::/10
      (g[0] & 0xff00) === 0xff00 || // multicast
      (g[0] === 0x64 && g[1] === 0xff9b) || // NAT64 64:ff9b::/96
      (g[0] === 0x2001 && g[1] === 0xdb8) // documentation
    );
  }
  return true;
}

function makeSafeLookup(allowPrivate) {
  return (hostname, options, cb) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
      if (err) return cb(err);
      if (!allowPrivate) {
        const bad = addrs.find((a) => isBlockedAddress(a.address));
        if (bad) return cb(new JdError('That address is not allowed.'));
      }
      if (options.all) cb(null, addrs);
      else cb(null, addrs[0].address, addrs[0].family);
    });
  };
}

export async function assertPublicHost(hostname) {
  const addrs = await dns.promises.lookup(hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) throw new JdError('That address is not allowed.');
}

function parseUrl(raw, { allowPrivate = false } = {}) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new JdError('That does not look like a web address.');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new JdError('Only http and https links can be fetched.');
  if (u.username || u.password) throw new JdError('Links with embedded credentials are not supported.');
  if (!allowPrivate && u.port && !['80', '443'].includes(u.port)) throw new JdError('Only standard web ports (80, 443) are allowed.');
  // Node connects to IP-literal hosts without calling the lookup hook, so check
  // them here. (The URL parser already normalises forms like 0x7f.1 to 127.0.0.1.)
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && net.isIP(host) && isBlockedAddress(host)) throw new JdError('That address is not allowed.');
  return u;
}

// ---------------------------------------------------------------- fetching

function getOnce(u, { allowPrivate }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(
      u,
      {
        lookup: makeSafeLookup(allowPrivate),
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5', 'Accept-Encoding': 'gzip, deflate, br' },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: new URL(res.headers.location, u) });
        }
        if (res.statusCode >= 400) {
          res.resume();
          return reject(new JdError(`The page returned an error (${res.statusCode}). If it needs a login, paste the text or upload a PDF instead.`));
        }
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
        const chunks = [];
        let size = 0;
        stream.on('data', (c) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy();
            reject(new JdError('That page is too large to read.'));
          } else chunks.push(c);
        });
        stream.on('end', () => resolve({ body: Buffer.concat(chunks), type: String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), url: u }));
        stream.on('error', () => reject(new JdError('Could not read the page.')));
      },
    );
    req.on('timeout', () => req.destroy(new JdError('The page took too long to respond.')));
    req.on('error', (e) => reject(e instanceof JdError ? e : new JdError(`Could not reach that page (${e.code || e.message}).`)));
  });
}

async function fetchUrl(raw, opts) {
  let u = parseUrl(raw, opts);
  for (let hop = 0; hop < 6; hop++) {
    const r = await getOnce(u, opts);
    if (!r.redirect) return r;
    u = parseUrl(r.redirect.href, opts);
  }
  throw new JdError('Too many redirects.');
}

// ---------------------------------------------------------------- HTML -> text

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', middot: '·', rupee: '₹', euro: '€', pound: '£' };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function tagsToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<(br|hr)\s*\/?>/gi, '\n')
      .replace(/<\/?(p|div|section|article|h[1-6]|ul|ol|tr|table|header|footer|main|aside)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function findJobPosting(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map(findJobPosting).find(Boolean) || null;
  const t = node['@type'];
  if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) return node;
  return findJobPosting(node['@graph']);
}

/** Prefer the schema.org JobPosting most job boards embed; fall back to visible text. */
export function htmlToJobText(html) {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const job = findJobPosting(JSON.parse(m[1].trim()));
      if (job?.description) {
        const org = typeof job.hiringOrganization === 'object' ? job.hiringOrganization?.name : job.hiringOrganization;
        const loc = [].concat(job.jobLocation || []).map((l) => l?.address?.addressLocality).filter(Boolean).join(', ');
        const head = [job.title && `Job title: ${job.title}`, org && `Company: ${org}`, loc && `Location: ${loc}`].filter(Boolean).join('\n');
        return { title: job.title || '', company: org || '', text: `${head}\n\n${tagsToText(decodeEntities(String(job.description)))}`.trim() };
      }
    } catch {
      /* malformed JSON-LD: ignore */
    }
  }
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || html;
  return { title, company: '', text: tagsToText(body) };
}

const looksThin = (text) =>
  text.replace(/\s/g, '').length < 400 || (/\b(sign in|log in|join now|enable javascript)\b/i.test(text) && text.length < 1500);

async function renderInBrowser(u) {
  // For pages that build the job description with JavaScript. Every request the
  // page makes is checked against the same address rules.
  return withBrowserPage(async (page) => {
    await page.route('**/*', async (route) => {
      const req = route.request();
      try {
        const ru = new URL(req.url());
        if (!['http:', 'https:'].includes(ru.protocol)) return route.abort();
        if (['image', 'media', 'font'].includes(req.resourceType())) return route.abort();
        await assertPublicHost(ru.hostname);
        return route.continue();
      } catch {
        return route.abort();
      }
    });
    await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    const fromLd = htmlToJobText(await page.content());
    if (!looksThin(fromLd.text)) return fromLd;
    const text = await page.evaluate(() => document.body?.innerText || '');
    return { title: await page.title(), company: '', text };
  });
}

const clip = (s) => (s.length > MAX_JD_CHARS ? `${s.slice(0, MAX_JD_CHARS)}\n[truncated]` : s);

/**
 * @returns {Promise<{source:string, title:string, company:string, text:string}>}
 */
export async function jobFromUrl(raw, { allowPrivate = false, render = true } = {}) {
  const r = await fetchUrl(raw, { allowPrivate });
  let job;
  if (isPdf(r.url.pathname, r.type) || isDocx(r.url.pathname, r.type)) {
    const { text } = await extractDocument(r.body, r.url.pathname, r.type);
    job = { title: '', company: '', text };
  } else if (/html|xml/.test(r.type) || !r.type) {
    job = htmlToJobText(r.body.toString('utf8'));
    if (looksThin(job.text) && render && !allowPrivate) {
      try {
        const rendered = await renderInBrowser(r.url);
        if (!looksThin(rendered.text)) job = rendered;
      } catch {
        /* keep the static result; reported below if thin */
      }
    }
  } else if (r.type.startsWith('text/')) {
    job = { title: '', company: '', text: r.body.toString('utf8') };
  } else {
    throw new JdError(`That link points to a ${r.type} file, not a job description.`);
  }
  if (looksThin(job.text)) {
    throw new JdError(
      'Could not find a job description on that page. It may need a login (LinkedIn usually does) or block automated reading. Paste the text or upload a PDF instead.',
    );
  }
  return { source: r.url.href, title: job.title, company: job.company, text: clip(job.text.trim()) };
}

export async function jobFromFile(buffer, name, type) {
  const { text } = await extractDocument(buffer, name, type);
  if (text.replace(/\s/g, '').length < 200) throw new JdError('That file has too little text to be a job description.');
  return { source: name, title: '', company: '', text: clip(text.trim()) };
}

export function jobFromText(text) {
  const t = String(text || '').trim();
  if (t.replace(/\s/g, '').length < 200) throw new JdError('Paste the full job description (at least a few lines).');
  return { source: 'pasted text', title: '', company: '', text: clip(t) };
}

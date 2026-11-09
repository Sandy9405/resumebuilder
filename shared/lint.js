// Deterministic checks on resume content. These back up the prompt rules with
// code: a prompt can ask the model not to invent numbers, but only a check can
// tell the user when a number has no source.

export const AI_PHRASES = [
  [/\bspearhead(ed|ing|s)?\b/i, 'spearheaded'],
  [/\bleverag(e|ed|es|ing)\b/i, 'leveraged'],
  [/\bcutting[- ]edge\b/i, 'cutting-edge'],
  [/\bpassionate\b/i, 'passionate'],
  [/\bresults?[- ]driven\b/i, 'results-driven'],
  [/\bdynamic\b/i, 'dynamic'],
  [/\bteam player\b/i, 'team player'],
  [/\bpivotal\b/i, 'pivotal'],
  [/\brevolutioni[sz](e|ed|ing)\b/i, 'revolutionized'],
  [/\bsynerg(y|ies|istic)\b/i, 'synergy'],
  [/\bproven track record\b/i, 'proven track record'],
  [/\bhighly motivated\b/i, 'highly motivated'],
  [/\btransformative\b/i, 'transformative'],
  [/\bexceptional\b/i, 'exceptional'],
  [/\bwide (range|array|variety) of\b/i, 'wide range of'],
  [/\bsuccessfully\b/i, 'successfully'],
  [/\butili[sz](e|ed|es|ing)\b/i, 'utilized'],
  [/\bseamless(ly)?\b/i, 'seamless'],
  [/\bfoster(ed|ing)?\b/i, 'fostered'],
  [/\bplayed a (key|pivotal|crucial|vital) role\b/i, 'played a key role'],
  [/\bdemonstrated (exceptional|strong) leadership\b/i, 'demonstrated leadership'],
  [/\bin today'?s fast[- ]paced\b/i, "today's fast-paced"],
  [/\bstrategic synerg/i, 'strategic synergies'],
  [/\bresponsible for\b/i, 'responsible for (say what was done)'],
  [/\bvarious\b/i, 'various'],
  [/\borchestrat(e|ed|ing)\b/i, 'orchestrated'],
  [/\bchampion(ed|ing)\b/i, 'championed'],
  [/\bharness(ed|ing)?\b/i, 'harnessed'],
  [/\bempower(ed|ing)?\b/i, 'empowered'],
  [/\belevat(e|ed|ing)\b/i, 'elevated'],
  [/\bcatalyz(e|ed|ing)\b/i, 'catalyzed'],
  [/\bdelv(e|ed|ing)\b/i, 'delved'],
  [/\b(showcas|underscor)(e|ed|ing)\b/i, 'showcasing'],
  [/\bnot (only|just)\b.*\bbut\b/i, 'not only… but'],
  [/\bin order to\b/i, 'in order to (use "to")'],
  [/\b(world|best)[- ]class\b/i, 'world-class'],
  [/\b(innovative|holistic|robust|impactful)\b/i, 'vague adjective'],
  [/\bmeticulous(ly)?\b/i, 'meticulous'],
];

const PLACEHOLDER = /\[[^\]]*\]|\bTBD\b|\bX+%|\bN\/A\b|lorem ipsum|\?\?/i;
const FIRST_PERSON = /\b(I|me|my|mine|we|our)\b/;
const IRREGULAR = 'built|made|done|given|taken|led|run|sent|set|written|shown|known|held|kept|brought|sold|taught|found|won|chosen|driven|grown|drawn|met|paid|put|begun|seen|told|spent|lost';
const PASSIVE = new RegExp(`\\b(was|were|been|being|is|are|got)\\s+(\\w+ly\\s+)?(\\w+ed|\\w+en|${IRREGULAR})\\b`, 'i');

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, double: 2, twice: 2, half: 50,
};

const NUM_RE = /\d+(?:[.,]\d+)*/g;

function normNum(s) {
  // "1,20,000" and "120,000" -> "120000"; "1.50" -> "1.5"; "07" -> "7"
  let n = s.replace(/,/g, '');
  if (n.includes('.')) n = n.replace(/0+$/, '').replace(/\.$/, '');
  n = n.replace(/^0+(?=\d)/, '');
  return n;
}

/** Collect every number that appears in the user's source material. */
export function sourceNumbers(sourceText) {
  const set = new Set();
  const text = String(sourceText || '');
  for (const m of text.matchAll(NUM_RE)) set.add(normNum(m[0]));
  for (const w of text.toLowerCase().match(/[a-z]+/g) || []) {
    if (w in NUMBER_WORDS) set.add(String(NUMBER_WORDS[w]));
  }
  // Two-digit years: "'21" or "2021" are the same claim.
  for (const n of [...set]) {
    if (/^(19|20)\d\d$/.test(n)) set.add(n.slice(2));
  }
  return set;
}

/** Every piece of text in the resume body, with a path for pointing at it. */
const unbold = (s) => String(s ?? '').replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1');

export function* resumeTexts(resume) {
  const h = resume.header || {};
  if (h.tagline) yield ['header.tagline', h.tagline, 'tagline'];
  for (const s of resume.sections || []) {
    if (s.hidden) continue;
    for (const it of s.items || []) {
      if (it.hidden) continue;
      for (const f of ['heading', 'org', 'location', 'dates', 'detail', 'note']) {
        if (it[f]) yield [`${s.id}.${it.id}.${f}`, unbold(it[f]), f];
      }
      for (let i = 0; i < (it.bullets || []).length; i++) {
        yield [`${s.id}.${it.id}.bullets.${i}`, unbold(it.bullets[i]), 'bullet', (it.locked || []).includes(it.bullets[i])];
      }
    }
  }
}

/**
 * @param {object} resume
 * @param {string} sourceText  everything the user has supplied: CV text, transcript, manual edits
 * @returns {{level:'error'|'warn', code:string, message:string, path:string}[]}
 */
export function lintResume(resume, sourceText) {
  const issues = [];
  const nums = sourceNumbers(sourceText);
  const verbCount = new Map();
  const seenBullets = new Map();

  const keywords = (resume.target?.keywords || []).flatMap((k) => [k.term, ...(k.aliases || [])]).map((k) => k.toLowerCase());
  const isKeyword = (label) => keywords.some((k) => k && label.toLowerCase().includes(k));
  let bulletCount = 0;
  let ingTails = 0;

  for (const [path, text, kind, locked] of resumeTexts(resume)) {
    const short = text.length > 70 ? text.slice(0, 67) + '...' : text;
    // The user's own dictated wording is theirs: no style nagging, no number doubts.
    if (locked) continue;

    for (const m of text.matchAll(NUM_RE)) {
      const n = normNum(m[0]);
      if (!nums.has(n)) {
        issues.push({
          level: 'warn',
          code: 'unverified-number',
          message: `"${m[0]}" does not appear in anything you've provided. Confirm it or remove it: "${short}"`,
          path,
        });
      }
    }

    if (PLACEHOLDER.test(text)) {
      issues.push({ level: 'error', code: 'placeholder', message: `Placeholder text: "${short}"`, path });
    }

    for (const [re, label] of AI_PHRASES) {
      const hit = text.match(re);
      if (hit && !isKeyword(hit[0])) {
        issues.push({ level: 'warn', code: 'ai-language', message: `Generic phrasing ("${label}"): "${short}"`, path });
      }
    }

    if (kind === 'bullet') {
      bulletCount++;
      // ASD-STE100-style sentence checks. Technical terms and job keywords are exempt
      // from vocabulary rules, not from sentence length or voice.
      const words = text.trim().split(/\s+/).length;
      if (words > 25) issues.push({ level: 'warn', code: 'ste-length', message: `${words} words. Keep a bullet to 25 words at most (aim for 20): "${short}"`, path });
      if (PASSIVE.test(text)) {
        issues.push({ level: 'warn', code: 'ste-passive', message: `Passive voice; say who did it: "${short}"`, path });
      }
      if (/,\s+(\w+ly\s+)?\w{3,}ing\b/.test(text)) ingTails++;
      if (/[—]|\s-\s/.test(text)) issues.push({ level: 'info', code: 'ste-punctuation', message: `Use a comma or a separate sentence instead of a dash: "${short}"`, path });
      if (FIRST_PERSON.test(text)) {
        issues.push({ level: 'warn', code: 'first-person', message: `First-person pronoun in a bullet: "${short}"`, path });
      }
      const verb = text.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
      if (verb) verbCount.set(verb, [...(verbCount.get(verb) || []), path]);
      const key = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seenBullets.has(key)) {
        issues.push({ level: 'warn', code: 'duplicate', message: `Repeated bullet: "${short}"`, path });
      } else seenBullets.set(key, path);
    }
  }

  // "Did X, increasing Y" is a fine shape once; on every bullet it reads machine-written.
  if (ingTails > Math.max(2, Math.ceil(bulletCount * 0.35))) {
    issues.push({
      level: 'warn',
      code: 'ste-pattern',
      message: `${ingTails} of ${bulletCount} bullets end with ", …ing" ("…, increasing …"). Vary the shape: "…; completion rose from 65% to 82%", "… to cut …", or a separate result.`,
      path: '',
    });
  }

  issues.push(...headerIssues(resume));
  issues.push(...atsIssues(resume));

  for (const [verb, paths] of verbCount) {
    if (paths.length > 2) {
      issues.push({
        level: 'warn',
        code: 'repeated-verb',
        message: `${paths.length} bullets start with "${verb}". Vary the verbs where a more accurate one exists.`,
        path: paths[2],
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------- ATS
// Applicant tracking systems find sections by recognisable headings, need
// contact details in the body text, and parse dates more reliably when one
// format is used throughout with four-digit years.

const HEADING_WORDS = {
  summary: /summary|profile|objective|about/i,
  education: /education|academic|qualification/i,
  experience: /experience|employment|work|career|professional history|internship/i,
  projects: /project/i,
  skills: /skill|technical|competenc|expertise|tools|technolog/i,
  leadership: /leadership|responsibilit|positions?|por\b|activities|involvement/i,
  achievements: /achievement|award|honou?r|accomplishment|recognition|scholastic|distinction/i,
  certifications: /certific|licen|course|training/i,
  extracurricular: /extra|activities|interests|volunteer|hobbies|co-curricular/i,
};

function dateStyle(d) {
  if (/\b(19|20)\d{2}\b/.test(d) === false && /['’]\d{2}\b/.test(d)) return 'two-digit-year';
  if (/\b\d{1,2}\/(19|20)?\d{2}\b/.test(d)) return 'numeric';
  if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(19|20)\d{2}/i.test(d)) {
    return /\b(january|february|march|april|june|july|august|september|october|november|december)\b/i.test(d) ? 'month-long' : 'month-short';
  }
  return 'year';
}

// The header must be complete: name, a sub-header (professional title), contact
// details, and the profile links a recruiter will click.
export function headerIssues(resume) {
  const out = [];
  const h = resume.header || {};
  const links = (h.links || []).map((l) => l.toLowerCase());
  const has = (re) => links.some((l) => re.test(l));
  const fam = (resume.profile?.jobFamilies || []).join(' ').toLowerCase();
  if (!h.name) out.push({ level: 'error', code: 'header-incomplete', message: 'The resume has no name.', path: 'header.name' });
  if (!h.tagline) out.push({ level: 'warn', code: 'header-incomplete', message: 'No sub-header under the name. Add a one-line professional title, e.g. "Backend Engineer · Payments".', path: 'header.name' });
  if (!h.email) out.push({ level: 'warn', code: 'header-incomplete', message: 'No email address. Recruiters and applicant tracking systems need one in the resume text.', path: 'header.name' });
  if (!h.phone) out.push({ level: 'warn', code: 'header-incomplete', message: 'No phone number.', path: 'header.name' });
  if (!h.location) out.push({ level: 'info', code: 'header-incomplete', message: 'No location (city is enough).', path: 'header.name' });
  if (!links.length) out.push({ level: 'warn', code: 'links-missing', message: 'No profile links. Add LinkedIn and any portfolio, GitHub or personal website.', path: 'header.name' });
  else if (!has(/linkedin\./)) out.push({ level: 'info', code: 'links-missing', message: 'No LinkedIn profile link.', path: 'header.name' });
  if (/software|engineer|developer|data|machine learning|\bml\b|\bai\b/.test(fam) && !has(/github\.|gitlab\./)) {
    out.push({ level: 'info', code: 'links-missing', message: 'For engineering and data roles, a GitHub link helps if you have public work.', path: 'header.name' });
  }
  if (/design|ux|ui\b|graphic|creative/.test(fam) && !links.some((l) => !/linkedin\./.test(l))) {
    out.push({ level: 'warn', code: 'links-missing', message: 'Design roles expect a portfolio link (Behance, Dribbble or your own site).', path: 'header.name' });
  }
  return out;
}

export function atsIssues(resume) {
  const out = [];
  const styles = new Map();
  for (const s of resume.sections || []) {
    if (s.hidden || !(s.items || []).some((i) => !i.hidden)) continue;
    const re = HEADING_WORDS[s.kind];
    if (re && !re.test(s.title)) {
      out.push({ level: 'warn', code: 'ats-heading', message: `"${s.title}" is not a heading applicant tracking systems recognise for ${s.kind}. A standard title such as "${s.kind[0].toUpperCase() + s.kind.slice(1)}" parses more reliably.`, path: `${s.id}.title` });
    }
    if (!['experience', 'projects', 'education', 'leadership'].includes(s.kind)) continue;
    for (const it of s.items) {
      if (it.hidden || !it.dates) continue;
      const st = dateStyle(it.dates);
      if (st === 'two-digit-year') out.push({ level: 'warn', code: 'ats-dates', message: `"${it.dates}" uses a two-digit year; write the full year (e.g. 2021) so it parses reliably.`, path: `${s.id}.${it.id}.dates` });
      if (st !== 'year') styles.set(st, [...(styles.get(st) || []), `${s.id}.${it.id}.dates`]);
    }
  }
  if (styles.size > 1) {
    out.push({ level: 'warn', code: 'ats-dates', message: `Dates mix ${[...styles.keys()].join(' and ')} formats. Use one format throughout, e.g. "Jul 2022 – Present".`, path: [...styles.values()][1][0] });
  }
  return out;
}

// ---------------------------------------------------------------- before / after
// Rough quality counts on free text (an uploaded CV), comparable with the same
// counts on the built resume, so "improved" is measured rather than claimed.

export const QUALITY_CODES = ['ai-language', 'ste-passive', 'ste-length', 'first-person'];

export function qualityCounts(lines) {
  const c = Object.fromEntries(QUALITY_CODES.map((k) => [k, 0]));
  for (const raw of lines) {
    const text = raw.replace(/^[\s•▪◦*\-–]+/, '').trim();
    if (text.split(/\s+/).length < 6) continue; // headings, names, dates
    if (AI_PHRASES.some(([re]) => re.test(text))) c['ai-language']++;
    if (PASSIVE.test(text)) c['ste-passive']++;
    if (text.split(/\s+/).length > 25) c['ste-length']++;
    if (FIRST_PERSON.test(text)) c['first-person']++;
  }
  return c;
}

export function cvTextCounts(text) {
  return qualityCounts(String(text || '').split(/\n+/));
}

export function resumeCounts(resume) {
  const lines = [];
  for (const [, text, kind, locked] of resumeTexts(resume)) if ((kind === 'bullet' || kind === 'detail') && !locked) lines.push(text);
  return qualityCounts(lines);
}

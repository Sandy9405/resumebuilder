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
];

const PLACEHOLDER = /\[[^\]]*\]|\bTBD\b|\bX+%|\bN\/A\b|lorem ipsum|\?\?/i;
const FIRST_PERSON = /\b(I|me|my|mine|we|our)\b/;

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
export function* resumeTexts(resume) {
  const h = resume.header || {};
  if (h.tagline) yield ['header.tagline', h.tagline, 'tagline'];
  for (const s of resume.sections || []) {
    if (s.hidden) continue;
    for (const it of s.items || []) {
      if (it.hidden) continue;
      for (const f of ['heading', 'org', 'location', 'dates', 'detail', 'note']) {
        if (it[f]) yield [`${s.id}.${it.id}.${f}`, it[f], f];
      }
      for (let i = 0; i < (it.bullets || []).length; i++) {
        yield [`${s.id}.${it.id}.bullets.${i}`, it.bullets[i], 'bullet'];
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

  for (const [path, text, kind] of resumeTexts(resume)) {
    const short = text.length > 70 ? text.slice(0, 67) + '...' : text;

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
      if (re.test(text)) {
        issues.push({ level: 'warn', code: 'ai-language', message: `Generic phrasing ("${label}"): "${short}"`, path });
      }
    }

    if (kind === 'bullet') {
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

export function atsIssues(resume) {
  const out = [];
  const h = resume.header || {};
  if (!h.email) out.push({ level: 'warn', code: 'ats-contact', message: 'No email address. Applicant tracking systems and recruiters need one in the resume text.', path: 'header.name' });
  if (!h.phone) out.push({ level: 'info', code: 'ats-contact', message: 'No phone number. Most applications expect one.', path: 'header.name' });
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

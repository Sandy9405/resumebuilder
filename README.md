# Resume Builder

An AI resume writer. The user uploads a CV, talks through their experience, or both. Claude works out the user's job family and career stage, then interviews them one question at a time about the evidence that matters for that field. It writes Action–Project–Result bullets and edits a live, typeset resume in one of three formats (IITB, IIMA, HBS) at one or two pages. Exports to PDF and DOCX.

The rule throughout: better writing, better structure, better presentation, **same facts**.

## Run it

```bash
npm install
```

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm start            # http://localhost:3000
```

No API key? `npm run dev` uses a scripted mock client. It returns a fixed sample draft, so you can work on the UI without making API calls.

```bash
npm test
```

The layout engine, PDF export and server-side visual QA need headless Chromium through Playwright:

```bash
npm install playwright && npx playwright install chromium
```

Without Chromium, the browser preview still lays out pages and runs QA itself, but the model doesn't receive layout feedback, and the PDF button falls back to the browser's print dialog.

| Env var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Required for real use |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model id |
| `CLAUDE_EFFORT` | `medium` | `low` / `medium` / `high` |
| `CLAUDE_FALLBACKS` | on | `off` disables the server-side refusal fallback |
| `CHROMIUM_PATH` | none | Custom Chromium binary for Playwright |
| `PORT` | `3000` | |
| `MOCK_CLAUDE` | none | `1` uses the scripted mock client |
| `APP_PASSWORD` | none | If set, the whole app (except `/health`) asks for this password |
| `BROWSER_IDLE_MS` | `300000` | Close headless Chromium after this long unused, to save memory |

## Deploy on Railway

The repo includes a `Dockerfile` (on Microsoft's Playwright image, so Chromium and its system libraries come pre-installed) and a `railway.json` (Dockerfile build, `/health` check, restart on failure). Railway detects both automatically.

1. On railway.com: **New Project → Deploy from GitHub repo →** `Sandy9405/resumebuilder`. In the service's **Settings → Source**, pick the branch to deploy.
2. Under **Variables**, add `ANTHROPIC_API_KEY` and `APP_PASSWORD`. Railway sets `PORT` itself.
3. Under **Settings → Networking → Generate Domain**, create the public HTTPS URL. HTTPS is required for the microphone to work.
4. Open the URL and sign in with any username plus your `APP_PASSWORD`.

Sessions live in memory, so a redeploy or restart ends any resume in progress. Leave Railway's Serverless (sleep) setting off for the same reason. Measured usage is about 155 MB of RAM with Chromium running and about 40 MB idle. Chromium shuts down after 5 idle minutes (`BROWSER_IDLE_MS`).

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | From console.anthropic.com. The only API key the app needs. |
| `SARVAM_API_KEY` | for voice | Sarvam speech-to-text; without it the browser's recognition is used |
| `APP_PASSWORD` | strongly recommended | Without it, anyone with the URL can use your Anthropic credits |
| `CLAUDE_MODEL`, `CLAUDE_EFFORT`, `CLAUDE_FALLBACKS`, `BROWSER_IDLE_MS` | no | See the table above |

Voice needs no key: speech recognition and read-aloud both run in the user's browser.

## Career stage decides the formats on offer

Setup asks **"Where are you in your career?"** and only shows the formats that suit the answer. Any format stays available from the toolbar later.

| Answer | Formats offered |
|---|---|
| Student or recent graduate (last two years) | IITB, IIMA, HBS |
| Working, under 5 years | Experienced Professional (recommended), HBS |
| 5+ years, or switching jobs | Experienced Professional (recommended), HBS |

**Experienced Professional** comes from the product owner's own CV. It's A4, in Calibri (bundled as Carlito, which has identical character widths), with a navy name and section rules, grey subtitle and dates. The layout:

- a short Profile paragraph;
- Experience lines as **Role** · Company, with dates right-aligned to the margin, results-first bullets, and an optional italic recognition line under a role;
- then Education;
- then Skills grouped by category.

Education always comes after experience, and school results are dropped. Bullets may **bold** one short phrase (`**…**`) in every format.

## The formats

Each format's design comes from the reference resumes, measured from both the document internals and the rendered pages. The specs live in `shared/templates.js`, with the measurements noted inline.

| | IITB | IIMA | HBS |
|---|---|---|---|
| Reference | `fndpyhthjqpm.pdf` (pdfTeX) | `ankit-saraf.pdf` (Word 2016) | Chronological Templates 2 and 3, VP sample (Word) |
| Paper | A4 | A4 | US Letter |
| Margins | 12 / 10 mm | 9–10 mm | 16.5 / 19 mm |
| Typeface | TeX Gyre Pagella (Palatino family; reference uses URW Palladio) | EB Garamond (reference: Garamond with Constantia headings) | EB Garamond (reference: Garamond) |
| Body / name | 10 / 14.4 pt, 1.2 leading | 10.5 / 18 pt small caps, right-aligned | 10.5 / 16 pt small caps, 2.5 pt tracking |
| Section heads | Bold caps on a light grey band | Bold caps on a dark grey band | Centred small caps between dotted rules |
| Education | Ruled table: Examination · Institute · University/Board · Year · CPI | Bordered grid: College · Degree · GPA · Year · Distinctions | Chronological entries |
| Entries | • **Role** \| ***Org***, then *(dates)* on the right, ◦ sub-bullets | **<u>Org</u>**, Location with **dates** on the right; **Role**; ▪ bullets | **ORG**, Location with **dates** on the right; ***Role***; • bullets |

Where a reference breaks the brief's own rules, the spec deliberately doesn't copy it:
- The IIMA and HBS references justify body text, which stretches word spacing. Every format here is left-aligned and uses `text-wrap: pretty`.
- HBS Template 2 puts its dates on a tab stop at 7.06 in, past the 6.9 in text width, so the dates hang over the right margin. One line is also padded with 11 tabs. Here, dates align exactly to the content edge.
- The IIMA reference puts contact details in a running footer. Here they sit in the header.
- Institute logos aren't reproduced (trademarks). Age and gender, which appear in both Indian references, are only included if the user supplies them.

The fonts ship with the app in `public/fonts/` under open licences (OFL for EB Garamond, the GUST licence for Pagella). Inlining them guarantees the preview and the server PDF use the same font metrics. The DOCX names Garamond and Palatino Linotype, which most Word installs have.

## How the layout works

`shared/render.js` turns the resume into a self-contained HTML document with a small layout engine embedded. The same document drives the browser preview and the server's PDF, so the PDF is the preview.

1. **Measure.** Every block (header, section heading, entry line, bullet, table) is measured with the real fonts loaded. Spacing is padding, never margins, so heights add up exactly.
2. **Paginate.** Blocks go onto fixed-size pages under keep rules:
   - a section heading stays with its first entry, and an entry's heading lines stay with its first bullet;
   - an entry's last two bullets stay together;
   - bullets and table rows never split.
3. **Adjust (bounded).** Only if the overflow is under 6% of a page, spacing compresses in steps, and then type shrinks by at most 0.5 pt, never below the format's minimum. A larger overflow is reported back as a content problem.
4. **Render** onto real page boxes, with pages over the limit outlined in red in the preview.
5. **Validate** with visual QA: overflow past the page limit or margins, overlapping blocks, dates colliding with text or out of alignment, inconsistent bullet indents, markers not level with their text, stranded headings, blank pages, table cells that overflow, justified text, font fallback, bullets that wrap to three lines, and a lone word on a bullet's last line.
6. **Correct.** After every edit the server re-runs the same document in headless Chromium and sends the QA findings to Claude with the content checks. Claude fixes content first: tighter wording, then moving bullets to reserve, then hiding entries.

Alignment uses real layout components throughout. In the HTML, a two-column grid keeps dates on the right edge while a long organisation name wraps. In the DOCX, a borderless two-column table does the same job, and bullets use numbering with hanging indents. No spaces or tabs are used for alignment anywhere. Bullet markers are drawn shapes, not font glyphs, so they look identical and sit level with the text in every format.

## How the conversation works

- **Job-family intelligence.** Claude records a profile with `set_profile`: one to three job families, role, years, industry, specialisation, career stage (student, early, mid, experienced, senior) and target role. It picks follow-up questions from per-family frameworks (software, product, design, sales, marketing, finance, consulting, operations, HR, data/ML, research, or whatever the profession is). The UI shows this profile so the user can correct it.
- **Interview rules.** One question at a time. Nothing that's already in the CV. Skipping is accepted (there's a Skip button). It never pushes for numbers the user doesn't have, asks when facts conflict, and stops at any time (the "I'm done, finish it" button).
- **Every tool input is validated on the server** (`src/validate.js`) before it's applied. The tools are deliberately not `strict`: with 17 tools and nested entry schemas, the API refuses to compile the combined grammar ("compiled grammar is too large"). A malformed call gets a precise error back to the model and is never applied. Responses stream (`max_tokens` 64000, set by `CLAUDE_MAX_TOKENS`), so a full first draft isn't cut off. A turn that is cut off or refused mid tool call is answered with an error result, so the conversation stays valid.
- **Edits only touch what they name.** After the first draft, Claude can only call narrow tools such as `update_item`, `add_item` and `set_visibility`, so anything it doesn't touch stays byte-identical.
- **Nothing is lost to the page limit.** Bullets cut for length move to `reserve_bullets`, and entries or sections are hidden rather than deleted. Moving to two pages lets them come back, and the UI shows what's being kept off the page.
- **Undo/redo** works for every change: model turns, typing in the preview, and format switches. Ctrl+Z works too. Claude is told when the user undoes something, so it doesn't redo it.
- **Content checks** run alongside visual QA:
  - numbers that appear nowhere in the user's material;
  - generic AI phrasing;
  - first-person pronouns;
  - repeated verbs, duplicates and placeholders.

## Tailoring to a job description

The **Target a job** button takes a link, a PDF/DOCX/TXT file, or pasted text.

- **Links:** the server fetches the page, preferring the schema.org `JobPosting` data most job boards embed. Pages that build the job description with JavaScript are rendered in headless Chromium. LinkedIn usually needs a login, so the app asks for pasted text or a PDF instead of failing silently.
- **SSRF protection:** every connection, including each redirect, is checked at connect time. Private, loopback, link-local, metadata and IPv4-mapped IPv6 addresses are refused, as are non-standard ports. IP-literal hosts are checked separately, because Node skips the DNS lookup for them.
- **Honest tailoring:** Claude records the job's keywords with `set_target_job`, marking each one `yes` (the user has it), `no` or `unknown`. The app then counts which keywords the resume actually shows.
  - Missing keywords the user has are flagged to add.
  - Unknown ones become questions.
  - Gaps stay gaps.
- **The JD is never treated as the user's evidence.** A "5+ years" in the job description does not verify a "5 years" claim on the resume.
- **No embellishment.** Claude declines requests to invent skills, inflate titles or metrics, or hide keywords in white text, and offers the honest alternatives instead.

## ATS readiness

- PDFs are text-based. Text extracts in reading order: name intact, each heading before its own content, dates on the same line as their entry. A test checks this for every format.
- Two fixes came from those tests:
  - Name and heading letter-spacing is kept small, because wide tracking made extractors read "P r i ya".
  - Every block is painted in a single pass, so headings are no longer written to the PDF before the body text.
- Content checks flag non-standard section headings, missing email or phone, two-digit years and mixed date formats.

## Do no harm: the result must beat the original

This came from a real test. For a "Product Manager – Applied AI" job description, a 10-year professional's original CV scored 6/10 and the app's version scored 5/10. Root causes, and the fix for each:

| Root cause | Fix |
|---|---|
| Academic format put education first for an experienced person | Section order depends on career stage: working professionals get experience before education in every format |
| The profile was deleted instead of rewritten for the target | Prompt: keep and rewrite the profile, and aim the sub-header at the target in true terms. Checks: `summary-dropped`, `headline-untargeted` |
| Compression dropped facts ("headcount 5 to 1", "900-line"), and nothing noticed | `fact-dropped`: every number in the uploaded CV must stay on the page or in reserve |
| The one-page fill rule added a Hobbies section to a senior resume | Fill is stage-aware: professionals get their own dropped material back first. `low-value-section` flags hobbies and school results for professionals |
| No real tailoring: product evidence was framed as operations, and the job's core asks were never raised | Prompt: translate evidence into the target role's terms, ask about every unconfirmed required keyword before finishing, plus an Applied-AI question set |
| Evaluator notes: "Railway" was dropped, labels like "Structure from ambiguity:", lines written for effect, "Top 1%" wrapping alone in a table cell | `fact-dropped` now also covers named tools, clients and products. `label-leadin` (bold the result, not a label). Slogan patterns flagged as generic phrasing. `table-wrap` visual check |
| No comparison with the input | A "Compared with your original" panel (facts kept, job keywords before → after) and the same numbers in the agent's feedback |

## Evidence requests: a story for every requirement

When a job description or link names a requirement the CV doesn't show (evals, B2C launches, prototyping, …), the agent asks for evidence, one requirement at a time, and says why:

> "This job requires evals. Can you tell me about a time you did this, or share any proof I can include, like a result, a project, a number or a link? If you don't have anything, just say skip."

- **If the user has a story,** the agent asks at most one follow-up (usually for the result), writes it into the right role, and records it with `mark_requirement` (`has_evidence`).
- **If they say no or skip,** it's recorded as `no_evidence` and becomes an honest gap. It's never asked again, even when the job is re-read, and never added to the resume.
- **Only required items are asked about,** in the job's order, capped at 6 questions so the chat never becomes an interrogation. The server tells the agent which item is next, so nothing is skipped by accident.
- **The "What this job requires" panel** lists each required item as *On your resume*, *Needs your story*, *You have it: adding* or *Skipped: honest gap*. Open items have one-tap **I have a story** (pre-fills the chat) and **I don't have this** buttons. A skip is recorded on the server before the model runs, so it's guaranteed to stick.

## Honest verdicts

- **Purpose.** Setup asks what the resume is for: a specific job (opens the job description dialog), a type of role (named), or general use. If it's still unknown, the agent asks once and records the answer with `set_purpose`. A general resume gets no fit assessment.
- **"Your CV is already strong."** For an uploaded CV, Claude calls `assess_cv` with the verdict `improve` or `already_strong`. When it's already strong, Claude says so, moves it into the format, and makes only real fixes; it never rewords good bullets for the sake of change. Next to the verdict, the app shows **measured** before/after counts from the uploaded text and the built resume (generic phrases, passive voice, overlong bullets, first person), so "improved" is checked rather than claimed.
- **Fit.** With a target (a job description or a named role), Claude calls `assess_fit`: `strong`, `good`, `weak` or `very_weak`, with the gaps listed.
  - For weak fits, it first asks the one **decisive question** that could change the verdict.
  - If the answer shows real evidence, it re-assesses. If not, it says plainly that this is a weak fit and suggests better-fit roles.
  - The panel shows an **Apply anyway** button. Pressing it records the choice (it survives re-assessment of the same target) and tailors honestly: transferable evidence first, gaps kept as gaps, plus advice on which gaps to cover in a cover letter or interview.
  - The server notes, but doesn't override, a "strong" or "good" verdict when most required keywords are marked as missing.

## Content rules

- **Complete header.** Every resume has a name, a sub-header (a one-line professional title), email, phone, city, and every profile link the user has (LinkedIn, portfolio, GitHub, personal site). Links are real hyperlinks in the PDF and DOCX, displayed as the address itself.
  - Links hidden behind words like "LinkedIn" in uploaded PDFs or DOCX files are recovered from the file's link annotations, so they aren't lost.
  - Missing items are flagged (`header-incomplete`, `links-missing`), and the agent asks for them.
- **One page means a full page.** If content falls short, the agent asks for more real material first: projects, internships, coursework, competitions, responsibilities, certifications, then interests.
  - As a last resort, the layout engine enlarges spacing, line spacing (at most 12%) and **body text only** (never the name or headings), up to each template's `size.max`.
  - Anything still under 75% full at normal size is flagged `underfilled`. Typography typically adds 15–20 percentage points of fill; it can't turn half a page into a full one.
  - Two-page resumes are never stretched.
- **The user's wording wins.** Bullets the user dictates, or types into the preview, are stored in `locked` and must stay word for word. An edit that changes them is refused unless the model sets `user_requested_change`, which it may only do when the user asked. Locked bullets are exempt from style checks.
- **ASD-STE100-style writing:**
  - one idea per bullet, at most 25 words;
  - active voice, simple single-meaning verbs, plain punctuation;
  - the ", …ing" result tail capped at about one bullet in three;
  - extra AI-slop terms flagged.

  Technical terms and the target job's keywords are exempt from the vocabulary rules. The 60–70% plain / 30–40% terms split is guidance in the prompt; it isn't measured, because it can't be measured reliably.

## Third evaluation: fixes

| Evaluator / user note | Root cause | Fix |
|---|---|---|
| Literal `**…**` in the profile | Bold was converted only in job bullets; a profile written as a bullet took an older path | Every displayed text field goes through the same bold conversion (HTML and DOCX). Profiles render as prose. A new `markup-leak` visual check fails if markup ever reaches the page |
| Wysa still "Present"; current role missing | "Is your CV current?" was only a prompt instruction, and it was skipped | An enforced current-role check: after an upload, the first question is "Is <role> still your current job?", with one-tap answers, recorded via `confirm_current_role` |
| "NPS from 23 to 33%" | Copied from the input; no unit check | `unit-mismatch`: mixed units in before/after figures, and NPS written as a percentage |
| Stories added, but not always with a result | Asking for the outcome was a soft rule | The agent asks "What changed because of it?" once per story. `result-missing` (info) lists bullets with no outcome |
| "prompts" asked twice | The next question ignored what the resume already showed | Requirements already on the resume are never asked about |
| Can't see the CV while answering | Four panels stacked above the page | A one-line Insights summary (page status, fit, requirements, facts kept) expands on demand. Answer buttons sit under the agent's question. The changed item is scrolled into view and highlighted, and phones get "See it on your resume" |

## Replies and mobile

- **Replies focus on the user's next step**, not the app's process. The resume updates live, so the agent doesn't narrate its edits. Each reply ends with one clear instruction (what to tell, upload or click), or "Nothing else needed. Download the PDF." The edit log under a reply is collapsed behind "Show changes".
- **Phones** (≤ 860 px wide) get one pane at a time, with Chat and Resume tabs. A dot appears on Resume when it changes. The composer stays pinned at the bottom, controls are thumb-sized, the toolbar fits on two rows, and the text field is 16 px so iOS doesn't zoom. The hidden preview is moved off-screen rather than set to `display: none`, so the page engine can still measure text while you chat.

## Voice: Sarvam speech-to-text

With `SARVAM_API_KEY` set (Railway variable), the mic records audio in the browser and the server transcribes it with Sarvam **`saaras:v4`**, using language auto-detection and `codemix` mode (English words stay English for Hinglish speakers). The key never reaches the browser.

- **Key terms:** up to 50 names from the user's CV and target job (employers, tools, clients, the job's keywords) are sent with every clip. Tested against the real API, they fixed "Scapia", "FastAPI" and "Collegedunia", which came out wrong without them. Key terms bias recognition and can pull a similar-sounding word toward a listed name, so the list holds only the user's own names.
- **Clips under 30 seconds** (the limit of Sarvam's REST API): a recording is split at natural pauses (25 s at the latest), and each segment is transcribed while the person keeps talking. Segments with no speech are never uploaded.
- **Silence is detected** from the microphone level against the room's background noise.
- **Fallback:** without a Sarvam key (e.g. local development), `/api/voice` reports `browser` and the browser's own speech recognition is used.
- Optional settings: `SARVAM_STT_MODEL` (default `saaras:v4`), `SARVAM_STT_LANGUAGE` (default `unknown`, i.e. auto-detect; `en-IN` forces English), `SARVAM_STT_MODE` (default `codemix`).

`scripts/sarvam-hello.mjs` makes one chat call to check the key works.

## Voice limits

Each recording is limited to 2 minutes (a countdown shows), and several recordings in a row are fine. Recording stops after 15 seconds without speech; if nothing was said, nothing is sent. If the browser ends recognition early mid-sentence, it restarts automatically within those limits.

## Code map

```
shared/templates.js   format specs measured from the references; density ladder
shared/render.js      resume -> HTML + in-page layout engine + visual QA
shared/lint.js        content checks
src/prompt.js         system prompt (job-family frameworks, interview workflow, APR rules)
src/tools.js          strict-schema edit tools
src/ops.js            applies edits; profile; visibility; undo/redo
src/agent.js          one conversation turn: Claude + tool loop + QA feedback
src/layout.js         headless Chromium: layout, QA and PDF
src/jd.js             job description fetch (SSRF-safe), HTML/JSON-LD extraction
src/extract.js        PDF/DOCX/TXT text extraction
shared/jd.js          job keyword coverage
src/docx.js           DOCX export
src/server.js         Express API
public/               browser app
test/                 node:test suites, with a realistic fixture
```

## Known limitations

- **Untested against the live Claude API.** All tests use the mock client. The interview quality, job-family judgement and tool use need checking with a real key on real CVs.
- **The V2 brief arrived cut off** partway through Part 9 (visual QA: "No text outside b…"). The QA list here covers everything stated before the cut, plus what plainly follows from it (text outside the page boundaries, overlaps). Any later requirements are unknown.
- **DOCX pagination belongs to Word.** The DOCX carries the same keep rules, but Word decides the page breaks, and line wrapping can differ slightly from the PDF. The PDF is the version that matches the preview exactly.
- **Typeface substitutes.** Constantia (IIMA headings) is proprietary, so EB Garamond bold stands in. Pagella is a Palatino clone, close to the IITB reference's URW Palladio but not identical.
- **Small caps** in EB Garamond are synthesised by the browser, because the bundled subset has no true small-caps glyphs.
- **The number check can't catch everything.** Claims without numbers ("led the team") are guarded only by the prompt. A real number written in a different form ("1.2 lakh" against "1,20,000") can be flagged by mistake.
- **Speech recognition** uses the browser's Web Speech API. It works in Chrome, Edge and Safari, not Firefox, and Chrome sends the audio to Google's servers.
- **Sessions live in memory** and expire after 6 hours. Use a real store before running more than one instance.

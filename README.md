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

## The three formats

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
- **Edits only touch what they name.** After the first draft, Claude can only call narrow tools such as `update_item`, `add_item` and `set_visibility`, so anything it doesn't touch stays byte-identical.
- **Nothing is lost to the page limit.** Bullets cut for length move to `reserve_bullets`, and entries or sections are hidden rather than deleted. Moving to two pages lets them come back, and the UI shows what's being kept off the page.
- **Undo/redo** works for every change: model turns, typing in the preview, and format switches. Ctrl+Z works too. Claude is told when the user undoes something, so it doesn't redo it.
- **Content checks** run alongside visual QA:
  - numbers that appear nowhere in the user's material;
  - generic AI phrasing;
  - first-person pronouns;
  - repeated verbs, duplicates and placeholders.

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

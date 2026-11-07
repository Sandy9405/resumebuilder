# Resume Builder

An AI resume writer. The user uploads a CV, talks through their experience, or both. Claude interviews them one question at a time, writes Action–Project–Result bullets, and edits a live, formatted resume in one of three templates (IITB, IIMA, HBS) at one or two pages. Exports to PDF and DOCX.

The core rule: better writing, better structure, better presentation, **same facts**.

## Run it

```bash
npm install
```

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm start            # http://localhost:3000
```

No API key? `npm run dev` starts it with a scripted mock client. It produces a fixed sample draft, so you can work on the UI without making API calls.

```bash
npm test
```

PDF export and page-fit measurement use headless Chromium through Playwright. Playwright is optional:

```bash
npm install playwright && npx playwright install chromium
```

Without it, the preview still shows an on-screen page-fit estimate, and the PDF button falls back to the browser's print dialog.

| Env var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Required for real use |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model id |
| `CLAUDE_EFFORT` | `medium` | `low` / `medium` / `high` |
| `CLAUDE_FALLBACKS` | on | Set to `off` to disable the server-side refusal fallback (`fallbacks: "default"`) |
| `CHROMIUM_PATH` | none | Custom Chromium binary for Playwright |
| `PORT` | `3000` | |
| `MOCK_CLAUDE` | none | `1` uses the scripted mock client |

## How it works

```
public/        browser app: setup questions, chat + voice, live preview, checks, export
shared/        used by the browser AND the server
  templates.js   template specs (fonts, sizes, margins, heading style, section order)
  render.js      resume state -> HTML (the preview and the PDF use the same renderer)
  lint.js        deterministic content checks
src/
  server.js      Express API, sessions, uploads, exports
  agent.js       one conversation turn: Claude + tool loop
  prompt.js      system prompt
  tools.js       edit operations Claude can call (strict schemas)
  ops.js         applies those operations to the resume state
  layout.js      headless-Chromium page-fit measurement and PDF
  docx.js        DOCX export
```

**The model edits through narrow tools and never rewrites the whole document.** `create_resume` is allowed once, for the first draft, and refuses to overwrite an existing draft unless the user asked for a rebuild. After that, Claude can only call `update_item`, `add_item`, `move_section` and similar tools. Anything it doesn't touch stays byte-identical. A prompt can only *ask* the model not to lose information when it edits; this design guarantees it.

**Rules are backed by checks, not only by the prompt.** After every batch of edits, `shared/lint.js` runs and its findings go back to Claude in the tool result. The same findings appear in the UI's Checks panel and as a warning before export:
- **Unverified numbers**: any number in the resume that appears nowhere in the CV text, the transcript, or the user's own manual edits. This is the main defence against invented metrics. It accepts number words ("five" verifies "5") and Indian or Western digit grouping.
- Generic AI phrasing (spearheaded, leveraged, results-driven…), first-person pronouns in bullets, placeholders, duplicate bullets, and the same verb starting more than two bullets.

**Page fit is measured.** After each edit, the server renders the resume to PDF in Chromium, counts the pages, and tells Claude whether it overflows. Claude cuts the lowest-priority content and tells the user what it cut. Font sizes are fixed per template, so text never shrinks to make it fit.

**Voice** uses the browser's Web Speech API. Messages from voice are tagged `(spoken)`, and the prompt tells Claude to confirm the spelling of names, companies and colleges, since speech recognition gets proper nouns wrong most often.

**Direct editing**: the "Edit text" toggle makes the preview editable in place. Text the user types counts as source material for the number check.

## Known limitations

- **The three templates are placeholders, not approved specs.** The product brief says to follow the approved specification for each format, but no specs were provided. `shared/templates.js` holds reasonable working designs, marked `specStatus: 'placeholder'`. When the real specs arrive, change that one file: the preview, PDF, DOCX and page-fit check all read from it. The UI never claims these are official institutional templates. There are no institute logos, and none should be added without permission.
- **DOCX does not match the PDF exactly.** Fonts, sizes, margins, section order and content are the same, but Word lays out lines with its own engine, so a line can wrap differently. The PDF is the version that matches the preview.
- **The number check can't catch everything.** A claim can be invented without a number ("led the team"), and only the prompt guards against that. In the other direction, a number the user really did give can be flagged if it was written differently (for example, "1.2 lakh" against "120,000"). The check warns; it doesn't block.
- **Speech recognition**: works in Chrome, Edge and Safari, not Firefox. In Chrome, audio is processed by Google's speech service. If that matters for your users, replace it with server-side transcription.
- **Scanned PDFs**: Claude reads the PDF directly, so scanned CVs work. But if no text can be extracted, the number check has nothing to compare against, and every number from the CV shows as unverified until the user confirms it.
- **Sessions are in memory** and expire after 6 hours. Use a real store (Redis or Postgres) before running more than one instance.
- **Fonts**: the templates use system font stacks, so a Linux server without Garamond or Times renders the PDF in a substitute (Liberation Serif, DejaVu). Install the fonts on the server, or bundle web fonts, for exact output.

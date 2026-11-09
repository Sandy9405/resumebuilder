// One conversational turn: send the user's message plus current resume state,
// let the model call edit tools, apply them, run content and visual QA, feed
// the results back, repeat until it replies. The message history is
// append-only (required for preserved thinking and good for prompt caching).

import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './prompt.js';
import { TOOLS } from './tools.js';
import { applyOp, OpError, snapshot, pushHistory } from './ops.js';
import { validate } from './validate.js';
import { lintResume } from '../shared/lint.js';
import { jdCoverage, jdIssues } from '../shared/jd.js';
import { compareIssues, comparison } from '../shared/compare.js';
import { measureLayout, describeFit } from './layout.js';
import { getTemplate } from '../shared/templates.js';

export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.CLAUDE_EFFORT || 'medium';
const MAX_STEPS = 10;
const MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS) || 64000;

let client = null;
export function setClient(c) {
  client = c;
}
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

function stateBlock(session) {
  const r = session.resume;
  const t = getTemplate(r.settings.template);
  const hidden = [];
  for (const s of r.sections) {
    if (s.hidden) hidden.push(`section "${s.title}"`);
    else for (const it of s.items) if (it.hidden) hidden.push(`"${it.org || it.heading}" in ${s.title}`);
  }
  return [
    '<resume_state>',
    `Build mode: ${r.settings.buildMode}. Format: ${t.label} (id ${t.id}), ${t.page.name} paper. Page limit: ${r.settings.pages}.`,
    `Layout: ${session.layout ? describeFit(session.layout) : 'not measured yet.'}`,
    hidden.length ? `Hidden for length (kept in data): ${hidden.join('; ')}.` : 'Hidden for length: nothing.',
    `Career stage (user's own answer): ${{ recent: 'student or recent graduate (last two years)', working: 'working, under 5 years', experienced: '5+ years of experience, or switching jobs' }[r.settings.stage] || 'not asked'}.`,
    `Purpose: ${purposeLine(r.settings.purpose)}`,
    `Assessment: ${JSON.stringify(r.assessment || {})}`,
    `Profile: ${JSON.stringify(r.profile)}`,
    `Target job: ${r.target ? `${JSON.stringify({ title: r.target.title, company: r.target.company, seniority: r.target.seniority })}. ${coverageLine(r)}` : session.jd ? 'a job description was provided but set_target_job has not been called yet.' : 'none (general resume).'}`,
    JSON.stringify({ header: r.header, sections: r.sections }),
    '</resume_state>',
  ].join('\n');
}

function purposeLine(p) {
  if (p?.type === 'jd') return 'a specific job; the user has or will give a job description.';
  if (p?.type === 'role') return `${p.role} roles (no job description). Assess fit against what this role typically requires.`;
  if (p?.type === 'general') return 'general use; no single target. Present their strongest, most transferable experience.';
  return 'not stated yet. Ask early, in one question: a specific job, a type of role, or general use.';
}

function coverageLine(r) {
  const c = jdCoverage(r);
  if (!c) return 'No keywords recorded.';
  const have = c.missing.filter((m) => m.evidence === 'yes').map((m) => m.term);
  const ask = c.missing.filter((m) => m.evidence === 'unknown').map((m) => m.term);
  return [
    `Keywords shown on the resume: required ${c.must.matched}/${c.must.total}, nice-to-have ${c.nice.matched}/${c.nice.total}.`,
    have.length ? `The user has these but the resume doesn't show them: ${have.join(', ')}.` : '',
    ask.length ? `Unknown, ask before using: ${ask.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Content checks + visual QA, condensed for the model. */
export function qaSummary(session) {
  // "Do no harm" findings first: lost facts, deleted positioning, low-value filler.
  const content = [
    ...compareIssues(session.resume, session.cvText),
    ...lintResume(session.resume, session.sourceText),
    ...jdIssues(session.resume).filter((i) => i.code === 'jd-missing' || i.code === 'jd-ask'),
  ];
  const visual = session.layout?.issues || [];
  const all = [...visual.filter((i) => i.level === 'error'), ...content, ...visual.filter((i) => i.level !== 'error')];
  const lines = all.slice(0, 15).map((i) => `- [${i.code}] ${i.message}${i.path ? ` (at ${i.path})` : ''}`);
  if (all.length > 15) lines.push(`- ...and ${all.length - 15} more`);
  const job = session.resume.target ? `\nJob match: ${coverageLine(session.resume)}` : '';
  const cmp = comparison(session.resume, session.cvText);
  const vs = cmp
    ? `\nCompared with the uploaded CV: facts kept ${cmp.facts.kept}/${cmp.facts.total}${cmp.keywords ? `; job keywords ${cmp.keywords.before} -> ${cmp.keywords.after} of ${cmp.keywords.total}` : ''}. The result must be better than the original on fit and evidence, never worse.`
    : '';
  return `Layout: ${describeFit(session.layout)}${job}${vs}\nChecks:${lines.length ? `\n${lines.join('\n')}` : ' none.'}`;
}

const textOf = (content) =>
  content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

/**
 * @param {object} session
 * @param {Array} userBlocks  content blocks for the new user message (text, document)
 * @returns {Promise<{reply:string, changes:string[]}>}
 */
export async function runTurn(session, userBlocks) {
  const notes = session.pendingNotes.splice(0).map((n) => ({ type: 'text', text: `(App note: ${n})` }));
  session.messages.push({ role: 'user', content: [...notes, ...userBlocks, { type: 'text', text: stateBlock(session) }] });

  const before = snapshot(session.resume);
  const changes = [];
  const replies = [];

  try {
    let jsonRetries = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      // Streaming: a full first draft plus thinking can exceed what a single
      // non-streamed request should wait for.
      let response;
      try {
        response = await getClient()
          .beta.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: SYSTEM_PROMPT,
            tools: TOOLS,
            messages: session.messages,
            cache_control: { type: 'ephemeral' },
            output_config: { effort: EFFORT },
            ...(process.env.CLAUDE_FALLBACKS === 'off' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
          })
          .finalMessage();
        jsonRetries = 0;
      } catch (err) {
        // With eager input streaming, a tool input the SDK cannot parse at all
        // rejects here. Re-issue the turn a couple of times; rethrow API errors.
        if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        step--;
        continue;
      }

      session.messages.push({ role: 'assistant', content: response.content });
      const said = textOf(response.content);
      if (said) replies.push(said);
      const toolUses = response.content.filter((b) => b.type === 'tool_use');

      // A cut-off or refused turn may hold a half-written tool call: never run
      // it, but answer it, or the next request would be rejected for an
      // unanswered tool_use.
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
        if (toolUses.length) {
          session.messages.push({
            role: 'user',
            content: toolUses.map((b) => ({ type: 'tool_result', tool_use_id: b.id, is_error: true, content: 'Not applied: the response was cut off before this call was complete.' })),
          });
        }
        replies.push(
          response.stop_reason === 'refusal'
            ? "I can't help with that request. Let's keep going with your resume."
            : 'That response was cut off before I finished. Please ask again, or ask for a smaller change.',
        );
        break;
      }
      if (!toolUses.length) break;

      const results = [];
      let applied = false;
      for (const block of toolUses) {
        const tool = TOOLS.find((t) => t.name === block.name);
        const problems = tool ? validate(tool.input_schema, block.input) : [`unknown tool ${block.name}`];
        if (problems.length) {
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            is_error: true,
            content: `Not applied. Invalid input: ${problems.join('; ')}. Send the complete input again.`,
          });
          continue;
        }
        try {
          const what = applyOp(session.resume, block.name, block.input);
          changes.push(what);
          applied = true;
          results.push({ type: 'tool_result', tool_use_id: block.id, content: what });
        } catch (err) {
          if (!(err instanceof OpError)) throw err;
          results.push({ type: 'tool_result', tool_use_id: block.id, content: err.message, is_error: true });
        }
      }
      // Re-lay-out and re-check once per batch; attach to the last result.
      if (applied) {
        session.layout = await measureLayout(session.resume);
        const last = results[results.length - 1];
        last.content = `${last.content}\n\n${qaSummary(session)}`;
      }
      session.messages.push({ role: 'user', content: results });
    }
  } finally {
    // One undo step per turn, however many tool calls it took (even if the turn failed midway).
    pushHistory(session, before);
  }
  return { reply: replies.join('\n\n') || 'Done.', changes };
}

export function describeApiError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'The server has no valid Anthropic API key configured.';
  if (err instanceof Anthropic.RateLimitError) return 'The AI service is busy. Please try again in a moment.';
  if (err instanceof Anthropic.BadRequestError) return `The AI service rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the AI service.';
  if (err instanceof Anthropic.APIError) return `AI service error (${err.status}).`;
  return null;
}

// One conversational turn: send the user's message plus current resume state,
// let the model call edit tools, apply them, feed results back, repeat until it
// replies. The message history is append-only (required for preserved thinking
// and good for prompt caching).

import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './prompt.js';
import { TOOLS } from './tools.js';
import { applyOp, OpError } from './ops.js';
import { lintResume } from '../shared/lint.js';
import { measureFit } from './layout.js';
import { getTemplate } from '../shared/templates.js';

export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.CLAUDE_EFFORT || 'medium';
const MAX_STEPS = 8;

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
  const lines = [
    '<resume_state>',
    `Build mode: ${r.settings.buildMode}. Format: ${t.label} (id ${t.id}). Page limit: ${r.settings.pages}.`,
    session.fit ? `Page fit: ${session.fit.message}` : 'Page fit: not measured yet.',
    JSON.stringify({ header: r.header, sections: r.sections }),
    '</resume_state>',
  ];
  return lines.join('\n');
}

function summarizeIssues(issues) {
  if (!issues.length) return 'Checks: no issues.';
  const top = issues.slice(0, 12).map((i) => `- [${i.code}] ${i.message} (at ${i.path})`);
  const more = issues.length > 12 ? `\n- ...and ${issues.length - 12} more` : '';
  return `Checks:\n${top.join('\n')}${more}`;
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
  session.messages.push({ role: 'user', content: [...userBlocks, { type: 'text', text: stateBlock(session) }] });

  const changes = [];
  const replies = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: session.messages,
      cache_control: { type: 'ephemeral' },
      output_config: { effort: EFFORT },
      ...(process.env.CLAUDE_FALLBACKS === 'off'
        ? {}
        : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
    });

    session.messages.push({ role: 'assistant', content: response.content });
    const said = textOf(response.content);
    if (said) replies.push(said);

    if (response.stop_reason === 'refusal') {
      replies.push("I can't help with that request. Let's keep going with your resume.");
      break;
    }
    if (response.stop_reason === 'max_tokens') {
      replies.push('That response was cut off. Please ask again, or ask for a smaller change.');
      break;
    }
    if (response.stop_reason !== 'tool_use') break;

    const results = [];
    let applied = false;
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
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
    // Attach checks and page fit once per batch, to the last result.
    if (applied) {
      session.fit = await measureFit(session.resume);
      const issues = lintResume(session.resume, session.sourceText);
      const last = results[results.length - 1];
      last.content = `${last.content}\n\n${summarizeIssues(issues)}\n${
        session.fit ? `Page fit: ${session.fit.message}` : 'Page fit: unavailable.'
      }`;
    }
    session.messages.push({ role: 'user', content: results });
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

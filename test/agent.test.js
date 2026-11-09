// The agent loop against a scripted client: validation, cut-off turns, bad JSON.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { runTurn, setClient } from '../src/agent.js';
import { TOOLS } from '../src/tools.js';
import { validate } from '../src/validate.js';
import { emptyResume } from '../src/ops.js';
import { closeLayout } from '../src/layout.js';

after(closeLayout);

const session = () => ({ resume: emptyResume({ template: 'hbs' }), messages: [], sourceText: '', pendingNotes: [], undo: [], redo: [], layout: null });
const msg = (content, stop_reason) => ({ id: 'm', type: 'message', role: 'assistant', content, stop_reason, usage: {} });
function scripted(steps) {
  const calls = [];
  setClient({
    beta: {
      messages: {
        stream(params) {
          calls.push(structuredClone(params.messages));
          const next = steps.shift();
          return { finalMessage: async () => (next instanceof Error ? Promise.reject(next) : next) };
        },
      },
    },
  });
  return calls;
}
const item = (o) => ({ heading: 'Eng', org: 'Acme', location: '', dates: '', detail: '', note: '', bullets: ['Built X'], reserve_bullets: [], user_wording: [], ...o });
const header = { name: 'A', tagline: '', email: '', phone: '', location: '', links: [], details: [] };

test('tools are not strict (grammar size limit) and stream eagerly', () => {
  assert.ok(TOOLS.every((t) => t.strict === undefined && t.eager_input_streaming === true));
});

test('validator catches missing, mistyped and unknown fields', () => {
  const upd = TOOLS.find((t) => t.name === 'update_item').input_schema;
  const errs = validate(upd, { section_id: 's', item_id: 'i', item: { heading: 'x', bullets: 'oops', extra: 1 }, user_requested_change: 'no' });
  const text = errs.join(' | ');
  assert.match(text, /missing required field "org"/);
  assert.match(text, /item\.bullets must be an array/);
  assert.match(text, /unknown field "extra"/);
  assert.match(text, /user_requested_change must be true or false/);
  assert.deepEqual(validate(upd, { section_id: 's', item_id: 'i', item: item({}), user_requested_change: false }), []);
  const fmt = TOOLS.find((t) => t.name === 'set_format').input_schema;
  assert.match(validate(fmt, { template: 'hbs', pages: '2' }).join(), /must be an integer/);
});

test('invalid tool input is refused, not applied, and the model is told why', async () => {
  const s = session();
  const calls = scripted([
    msg([{ type: 'tool_use', id: 't1', name: 'create_resume', input: { header, sections: [{ kind: 'experience', title: 'Experience', items: [{ heading: 'Eng' }] }], confirm_replace: false } }], 'tool_use'),
    msg([{ type: 'text', text: 'Fixed.' }], 'end_turn'),
  ]);
  await runTurn(s, [{ type: 'text', text: 'hi' }]);
  assert.equal(s.resume.sections.length, 0, 'nothing applied');
  const result = calls[1].at(-1).content[0];
  assert.equal(result.is_error, true);
  assert.match(result.content, /missing required field "bullets"/);
});

test('a turn cut off at max_tokens mid tool call is answered, so the next turn is valid', async () => {
  const s = session();
  const calls = scripted([
    msg([{ type: 'tool_use', id: 't1', name: 'create_resume', input: { header, sections: [{ kind: 'experience', title: 'Experience', items: [item({})] }], confirm_replace: false } }], 'max_tokens'),
    msg([{ type: 'text', text: 'ok' }], 'end_turn'),
  ]);
  const r1 = await runTurn(s, [{ type: 'text', text: 'build it' }]);
  assert.match(r1.reply, /cut off/);
  assert.equal(s.resume.sections.length, 0, 'truncated call never runs');
  const last = s.messages.at(-1);
  assert.equal(last.role, 'user');
  assert.equal(last.content[0].type, 'tool_result');
  assert.equal(last.content[0].tool_use_id, 't1');
  await runTurn(s, [{ type: 'text', text: 'again' }]);
  // Every tool_use in history has a matching tool_result right after it.
  const hist = calls[1];
  hist.forEach((m, i) => {
    if (m.role !== 'assistant') return;
    const ids = (Array.isArray(m.content) ? m.content : []).filter((b) => b.type === 'tool_use').map((b) => b.id);
    if (!ids.length) return;
    const answered = (hist[i + 1]?.content || []).filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id);
    assert.deepEqual(answered.sort(), ids.sort());
  });
});

test('unparseable streamed tool JSON re-issues the turn; API errors are rethrown', async () => {
  const s = session();
  scripted([new SyntaxError('Unexpected token'), msg([{ type: 'text', text: 'Recovered.' }], 'end_turn')]);
  const r = await runTurn(s, [{ type: 'text', text: 'hi' }]);
  assert.equal(r.reply, 'Recovered.');
  const s2 = session();
  scripted([new Anthropic.APIError(400, { type: 'error' }, 'bad', new Headers())]);
  await assert.rejects(runTurn(s2, [{ type: 'text', text: 'hi' }]), Anthropic.APIError);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyResume, applyOp, applyManualEdit, OpError } from '../src/ops.js';

const item = (o = {}) => ({ heading: '', org: '', location: '', dates: '', detail: '', bullets: [], ...o });

function draft() {
  const r = emptyResume({ template: 'hbs', pages: 1 });
  applyOp(r, 'create_resume', {
    header: { name: 'A', tagline: '', email: 'a@x.com', phone: '', location: '', links: [] },
    sections: [
      { kind: 'skills', title: 'Skills', items: [item({ heading: 'Tech', detail: 'Python' })] },
      { kind: 'experience', title: 'Experience', items: [item({ org: 'Acme', heading: 'Engineer', bullets: ['Built X'] })] },
      { kind: 'education', title: 'Education', items: [item({ org: 'COEP', heading: 'B.Tech' })] },
    ],
    confirm_replace: false,
  });
  return r;
}

test('create_resume orders sections by template', () => {
  const r = draft();
  assert.deepEqual(r.sections.map((s) => s.kind), ['education', 'experience', 'skills']);
  assert.ok(r.sections.every((s) => s.id && s.items.every((i) => i.id)));
});

test('create_resume refuses to overwrite an existing draft without confirmation', () => {
  const r = draft();
  assert.throws(() => applyOp(r, 'create_resume', { header: {}, sections: [], confirm_replace: false }), OpError);
});

test('update_item changes one item and leaves everything else identical', () => {
  const r = draft();
  const before = JSON.parse(JSON.stringify(r));
  const exp = r.sections.find((s) => s.kind === 'experience');
  const id = exp.items[0].id;
  applyOp(r, 'update_item', { section_id: exp.id, item_id: id, item: item({ org: 'Acme', heading: 'Engineer', bullets: ['Built X', 'Led a team of six'] }) });
  assert.equal(exp.items[0].id, id, 'id preserved');
  assert.deepEqual(exp.items[0].bullets, ['Built X', 'Led a team of six']);
  const strip = (x) => x.sections.filter((s) => s.kind !== 'experience');
  assert.deepEqual(strip(r), strip(before));
  assert.deepEqual(r.header, before.header);
});

test('bad ids produce an OpError listing valid ids', () => {
  const r = draft();
  assert.throws(() => applyOp(r, 'update_item', { section_id: 'nope', item_id: 'x', item: item() }), /Current ids/);
});

test('add_item with __top__ puts the newest role first', () => {
  const r = draft();
  const exp = r.sections.find((s) => s.kind === 'experience');
  applyOp(r, 'add_item', { section_id: exp.id, after_item_id: '__top__', item: item({ org: 'Microsoft', heading: 'Intern' }) });
  assert.equal(exp.items[0].org, 'Microsoft');
  assert.equal(exp.items.length, 2);
});

test('move_section and set_format', () => {
  const r = draft();
  const exp = r.sections.find((s) => s.kind === 'experience');
  applyOp(r, 'move_section', { section_id: exp.id, after_section_id: '__top__' });
  assert.equal(r.sections[0].kind, 'experience');
  applyOp(r, 'set_format', { template: 'iitb', pages: 2 });
  assert.equal(r.settings.template, 'iitb');
  assert.equal(r.settings.pages, 2);
  assert.equal(r.sections[0].kind, 'education', 'switching template re-applies its order');
});

test('manual edits: field, bullet, and deleting a bullet by clearing it', () => {
  const r = draft();
  const exp = r.sections.find((s) => s.kind === 'experience');
  const it = exp.items[0];
  applyManualEdit(r, `${exp.id}.${it.id}.dates`, 'Jul 2023 – Present');
  applyManualEdit(r, `${exp.id}.${it.id}.bullets.0`, '  Built   Y ');
  assert.equal(it.dates, 'Jul 2023 – Present');
  assert.equal(it.bullets[0], 'Built Y');
  applyManualEdit(r, `${exp.id}.${it.id}.bullets.0`, '');
  assert.deepEqual(it.bullets, []);
  assert.throws(() => applyManualEdit(r, `${exp.id}.${it.id}.id`, 'x'), OpError);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyResume, applyOp, applyManualEdit, OpError, pushHistory, snapshot, undo, redo } from '../src/ops.js';

const item = (o = {}) => ({ heading: '', org: '', location: '', dates: '', detail: '', note: '', bullets: [], reserve_bullets: [], ...o });

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
  assert.deepEqual(r.sections.map((s) => s.kind), ['experience', 'education', 'skills']);
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
  applyOp(r, 'set_format', { template: 'hbs', pages: 2 });
  assert.equal(r.sections[0].kind, 'experience', 'HBS leads with experience');
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

test('set_visibility hides without deleting; reserve bullets survive updates', () => {
  const r = draft();
  const exp = r.sections.find((s) => s.kind === 'experience');
  const it = exp.items[0];
  applyOp(r, 'update_item', { section_id: exp.id, item_id: it.id, item: item({ org: 'Acme', heading: 'Engineer', bullets: ['Built X'], reserve_bullets: ['Wrote Y'] }) });
  applyOp(r, 'set_visibility', { section_id: exp.id, item_id: it.id, hidden: true });
  assert.equal(exp.items[0].hidden, true);
  assert.deepEqual(exp.items[0].reserve, ['Wrote Y']);
  // A later update that doesn't touch visibility keeps the item hidden.
  applyOp(r, 'update_item', { section_id: exp.id, item_id: it.id, item: item({ org: 'Acme', heading: 'Engineer', bullets: ['Built X'], reserve_bullets: ['Wrote Y'] }) });
  assert.equal(exp.items[0].hidden, true);
  applyOp(r, 'set_visibility', { section_id: exp.id, item_id: '', hidden: true });
  assert.equal(exp.hidden, true);
  assert.equal(exp.items.length, 1, 'nothing deleted');
});

test('set_profile validates the career stage', () => {
  const r = draft();
  applyOp(r, 'set_profile', { job_families: ['Software Engineering', 'Data Science'], current_role: 'SDE', years_experience: '3', industry: 'Fintech', specialization: 'Backend', career_stage: 'early', target_role: '' });
  assert.deepEqual(r.profile.jobFamilies, ['Software Engineering', 'Data Science']);
  assert.equal(r.profile.careerStage, 'early');
  applyOp(r, 'set_profile', { job_families: [], current_role: '', years_experience: '', industry: '', specialization: '', career_stage: 'wizard', target_role: '' });
  assert.equal(r.profile.careerStage, '');
});

test('undo and redo restore exact snapshots', () => {
  const session = { resume: draft(), undo: [], redo: [] };
  const before = snapshot(session.resume);
  const exp = session.resume.sections.find((s) => s.kind === 'experience');
  applyOp(session.resume, 'remove_item', { section_id: exp.id, item_id: exp.items[0].id });
  assert.equal(pushHistory(session, before), true);
  const after = snapshot(session.resume);
  assert.equal(undo(session), true);
  assert.equal(snapshot(session.resume), before);
  assert.equal(redo(session), true);
  assert.equal(snapshot(session.resume), after);
  assert.equal(pushHistory(session, snapshot(session.resume)), false, 'no-op changes are not recorded');
  assert.equal(redo(session), false);
});

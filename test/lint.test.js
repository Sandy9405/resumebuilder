import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintResume, sourceNumbers } from '../shared/lint.js';

const resume = (bullets, extra = {}) => ({
  header: { name: 'A' },
  sections: [{ id: 's1', kind: 'experience', title: 'X', items: [{ id: 'i1', heading: 'Eng', org: 'Acme', location: '', dates: '2021 – 2023', detail: '', bullets, ...extra }] }],
});
const codes = (issues) => issues.map((i) => i.code);

test('numbers the user never gave are flagged; given ones are not', () => {
  const src = 'I worked at Acme from 2021 to 2023 and cut report time from 25 to 15 minutes';
  const issues = lintResume(resume(['Cut report time from 25 to 15 minutes', 'Increased engagement by 35%']), src);
  const nums = issues.filter((i) => i.code === 'unverified-number');
  assert.equal(nums.length, 1);
  assert.match(nums[0].message, /35%/);
});

test('number words and formatting variants count as sources', () => {
  const set = sourceNumbers('I managed five interns and a budget of 1,20,000 in 2022');
  assert.ok(set.has('5'));
  assert.ok(set.has('120000'));
  assert.ok(set.has('22'));
  const issues = lintResume(resume(['Managed 5 interns and a budget of ₹120,000']), 'managed five interns budget 1,20,000 2021 2023');
  assert.ok(!codes(issues).includes('unverified-number'));
});

test('15 in the source does not verify 150', () => {
  const issues = lintResume(resume(['Served 150 customers']), '15 customers 2021 2023');
  assert.ok(codes(issues).includes('unverified-number'));
});

test('AI phrasing, first person, placeholders, duplicates, repeated verbs', () => {
  const issues = lintResume(
    resume([
      'Spearheaded a transformative initiative',
      'I built the dashboard',
      'Built a tool that improved speed by XX%',
      'Built a reporting pipeline',
      'Built a reporting pipeline',
    ]),
    '2021 2023',
  );
  const c = codes(issues);
  for (const code of ['ai-language', 'first-person', 'placeholder', 'duplicate', 'repeated-verb']) assert.ok(c.includes(code), code);
});

test('clean resume has no issues', () => {
  assert.deepEqual(lintResume(resume(['Built a lead-tracking dashboard for the sales team']), 'Acme 2021 2023'), []);
});

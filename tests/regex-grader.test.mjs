import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gradeRegex } from '../scripts/lib/regex-grader.mjs';

test('grades regular expressions in an isolated worker', async () => {
  assert.equal(await gradeRegex({ pattern: 'exit code [0-9]+', flags: 'i', text: 'Exit code 0' }), true);
  assert.equal(await gradeRegex({ pattern: '^complete$', flags: '', text: 'incomplete' }), false);
});

test('terminates a catastrophic regular expression within its grading budget', async () => {
  await assert.rejects(() => gradeRegex({
    pattern: '(a+)+$',
    flags: '',
    text: `${'a'.repeat(100_000)}!`,
    timeoutMs: 25,
  }), /timed out/);
});
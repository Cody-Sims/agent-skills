import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retry } from './retry.mjs';

test('retries once after a failed attempt', async () => {
  let calls = 0;
  const result = await retry(() => {
    calls += 1;
    if (calls === 1) throw new Error('temporary');
    return 'accepted';
  }, 2);
  assert.equal(result, 'accepted');
  assert.equal(calls, 2);
});

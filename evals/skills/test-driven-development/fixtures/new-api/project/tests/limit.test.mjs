import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLimit } from '../src/limit.ts';

test('accepts zero', () => {
  assert.equal(parseLimit('0'), 0);
});

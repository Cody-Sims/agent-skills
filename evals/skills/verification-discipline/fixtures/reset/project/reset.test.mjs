import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reset } from './reset.mjs';

test('reset exposes the correct result', () => {
  assert.equal(reset().name, 'reset');
});

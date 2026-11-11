import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptsBudget } from './budget.mjs';

test('negative budgets are invalid', () => {
  assert.equal(acceptsBudget(-1), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateAgainstSchema } from '../scripts/lib/jsonschema.mjs';

test('enforces string and array size constraints', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 4 },
      values: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'integer' } },
    },
  };
  assert.deepEqual(validateAgainstSchema(schema, { name: 'good', values: [1] }), []);
  const errors = validateAgainstSchema(schema, { name: 'too-long', values: [] }).join('\n');
  assert.match(errors, /longer than maxLength 4/);
  assert.match(errors, /fewer than minItems 1/);
  assert.match(validateAgainstSchema(schema, { name: 'ok', values: [1, 2, 3] }).join('\n'), /more than maxItems 2/);
});
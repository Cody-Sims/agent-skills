import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const text = readFileSync(new URL('./.github/instructions/payments.instructions.md', import.meta.url), 'utf8');
assert.equal(text, '---\napplyTo: "src/payments/**"\n---\n\nPayment mutations must preserve idempotency keys.\n');
console.log('Scoped instruction is valid.');

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFrontmatter,
  FrontmatterError,
  MissingFrontmatterError,
} from '../scripts/lib/frontmatter.mjs';

test('parses scalar strings, booleans, numbers, and null', () => {
  const { data, body } = parseFrontmatter([
    '---',
    'name: example',
    'description: A skill that does things. Use when doing things.',
    'user-invocable: true',
    'disable-model-invocation: false',
    'count: 5',
    'empty:',
    '---',
    '# Body',
    '',
  ].join('\n'));
  assert.equal(data.name, 'example');
  assert.equal(typeof data.description, 'string');
  assert.equal(data['user-invocable'], true);
  assert.equal(data['disable-model-invocation'], false);
  assert.equal(data.count, 5);
  assert.equal(data.empty, null);
  assert.match(body, /# Body/);
});

test('parses a one-level metadata mapping of string values', () => {
  const { data } = parseFrontmatter([
    '---',
    'name: example',
    'description: desc',
    'metadata:',
    '  version: "1.2.3"',
    '  author: Someone',
    '---',
    'body',
  ].join('\n'));
  assert.deepEqual(data.metadata, { version: '1.2.3', author: 'Someone' });
});

test('keeps quoted numbers as strings but bare numbers as numbers', () => {
  const { data } = parseFrontmatter('---\nname: x\nversion: "1.0.0"\nbare: 42\n---\nb');
  assert.equal(data.version, '1.0.0');
  assert.equal(data.bare, 42);
});

test('rejects a missing frontmatter block', () => {
  assert.throws(() => parseFrontmatter('# No frontmatter here\n'), MissingFrontmatterError);
});

test('rejects a UTF-8 BOM', () => {
  assert.throws(() => parseFrontmatter('\uFEFF---\nname: x\n---\n'), FrontmatterError);
});

test('rejects an unterminated frontmatter block', () => {
  assert.throws(() => parseFrontmatter('---\nname: x\n'), /Unterminated/);
});

test('rejects duplicate top-level keys', () => {
  assert.throws(() => parseFrontmatter('---\nname: a\nname: b\n---\nx'), /Duplicate/);
});

test('rejects duplicate keys inside metadata', () => {
  assert.throws(
    () => parseFrontmatter('---\nname: a\nmetadata:\n  version: "1.0.0"\n  version: "2.0.0"\n---\nx'),
    /Duplicate/,
  );
});

test('rejects YAML sequences', () => {
  assert.throws(() => parseFrontmatter('---\nname: a\ntags:\n  - one\n  - two\n---\nx'), /sequence/i);
});

test('rejects flow collections and anchors', () => {
  assert.throws(() => parseFrontmatter('---\nname: a\nlist: [1, 2]\n---\nx'), /Unsupported/);
  assert.throws(() => parseFrontmatter('---\nname: a\nref: &anchor value\n---\nx'), /Unsupported/);
});

test('rejects nesting deeper than one level', () => {
  assert.throws(
    () => parseFrontmatter('---\nname: a\nmetadata:\n  nested:\n    deep: 1\n---\nx'),
    FrontmatterError,
  );
});

test('rejects a line without a colon', () => {
  assert.throws(() => parseFrontmatter('---\nname: a\nnot a mapping\n---\nx'), /key: value/);
});

test('reports the line number of a parse error', () => {
  try {
    parseFrontmatter('---\nname: a\nlist: [1]\n---\nx');
    assert.fail('expected throw');
  } catch (error) {
    assert.ok(error instanceof FrontmatterError);
    assert.equal(error.line, 3);
  }
});

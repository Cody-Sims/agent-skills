import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { queryRegistry } from '../scripts/lib/registry-query.mjs';
import { parseQueryArguments } from '../scripts/query-registry.mjs';

const registry = {
  skills: [
    {
      name: 'review',
      discovery: {
        category: 'quality',
        tags: ['read-only', 'review'],
        inputs: [{ type: 'diff' }],
        outputs: [{ type: 'findings' }],
        risk: { level: 'low' },
        runtimeCompatibility: [
          { runtime: 'claude-code', status: 'compatible' },
          { runtime: 'github-copilot', status: 'compatible' },
        ],
      },
    },
    {
      name: 'delivery',
      discovery: {
        category: 'delivery',
        tags: ['git', 'write'],
        inputs: [{ type: 'task-plan' }],
        outputs: [{ type: 'pull-request' }],
        risk: { level: 'high' },
        runtimeCompatibility: [
          { runtime: 'claude-code', status: 'compatible' },
          { runtime: 'github-copilot', status: 'conditional' },
        ],
      },
    },
  ],
};

test('queryRegistry combines category, runtime, input, output, and tag filters', () => {
  const matches = queryRegistry(registry, {
    category: 'quality',
    runtime: 'github-copilot',
    runtimeStatus: 'compatible',
    input: 'diff',
    output: 'findings',
    tags: ['read-only', 'review'],
  });
  assert.deepEqual(matches.map((skill) => skill.name), ['review']);
  assert.deepEqual(queryRegistry(registry, { risk: 'high' }).map((skill) => skill.name), ['delivery']);
  assert.deepEqual(queryRegistry(registry, { runtime: 'openai-codex' }), []);
  assert.deepEqual(queryRegistry(registry).map((skill) => skill.name), ['delivery', 'review']);
});

test('queryRegistry identifies a skill from the generated catalog by discovery shape', () => {
  const generated = JSON.parse(
    readFileSync(fileURLToPath(new URL('../registry/skills.json', import.meta.url)), 'utf8'),
  );
  const matches = queryRegistry(generated, {
    category: 'security',
    runtime: 'github-copilot',
    runtimeStatus: 'compatible',
    input: 'component',
    output: 'threat-report',
  });
  assert.deepEqual(matches.map((skill) => skill.name), ['security-review']);
});

test('queryRegistry rejects unsupported filters and unscoped runtime status', () => {
  assert.throws(() => queryRegistry(registry, { unknown: 'value' }), /Unknown registry filter/);
  assert.throws(
    () => queryRegistry(registry, { runtimeStatus: 'compatible' }),
    /requires a runtime filter/,
  );
  assert.throws(() => queryRegistry(registry, { runtime: 'cursor' }), /Unknown runtime/);
  assert.throws(() => queryRegistry(registry, { risk: 'critical' }), /Unknown risk level/);
  assert.throws(() => queryRegistry(registry, { category: 'Not A Slug' }), /lowercase slug/);
});

test('parseQueryArguments supports repeatable tags and rejects malformed arguments', () => {
  assert.deepEqual(
    parseQueryArguments([
      '--category', 'quality',
      '--tag', 'review',
      '--tag', 'read-only',
      '--format', 'json',
    ]),
    {
      filters: { category: 'quality', tags: ['review', 'read-only'] },
      format: 'json',
      registryPath: resolveDefaultRegistry(),
    },
  );
  assert.throws(() => parseQueryArguments(['--category']), /requires a value/);
  assert.throws(() => parseQueryArguments(['--unknown', 'value']), /Unknown argument/);
});

function resolveDefaultRegistry() {
  return fileURLToPath(new URL('../registry/skills.json', import.meta.url));
}

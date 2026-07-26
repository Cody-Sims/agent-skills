import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  runRoutingEvaluation,
  validateRoutingResult,
  validateRoutingSuite,
} from '../scripts/lib/routing-evaluations.mjs';
import { makeTempDir, removeDir, REPO_ROOT } from './helpers.mjs';

test('measures repeated activation, precision, recall, collisions, and confusion by split', async () => {
  const suite = {
    schemaVersion: 1,
    name: 'routing-pilot',
    trials: 3,
    cases: [
      {
        id: 'review-positive',
        split: 'training',
        prompt: 'Review this pull request for bugs.',
        expected: ['code-review'],
        excluded: ['security-review'],
      },
      {
        id: 'requirements-boundary',
        split: 'validation',
        prompt: 'Turn this vague request into a specification.',
        expected: ['requirements-and-spec-writing'],
        excluded: ['planning-and-task-breakdown'],
      },
    ],
  };
  const catalog = [
    { name: 'code-review', description: 'Reviews code.' },
    { name: 'security-review', description: 'Reviews security.' },
    { name: 'requirements-and-spec-writing', description: 'Writes specifications.' },
    { name: 'planning-and-task-breakdown', description: 'Breaks specifications into tasks.' },
  ];

  const result = await runRoutingEvaluation({
    suite,
    catalog,
    execute: async ({ case: routingCase, trial }) => {
      if (routingCase.id === 'review-positive') {
        return { selectedSkills: ['code-review'], inputTokens: 10, outputTokens: 2, durationMs: 4 };
      }
      return {
        selectedSkills: trial === 2 ? ['planning-and-task-breakdown'] : ['requirements-and-spec-writing'],
        inputTokens: 12,
        outputTokens: 2,
        durationMs: 5,
      };
    },
  });

  assert.equal(result.summary.overall.recall, 5 / 6);
  assert.equal(result.summary.overall.precision, 5 / 6);
  assert.equal(result.summary.overall.collisionRate, 1 / 6);
  assert.equal(result.summary.training.recall, 1);
  assert.equal(result.summary.validation.recall, 2 / 3);
  assert.equal(result.cases[0].activationRate, 1);
  assert.equal(result.cases[1].activationRate, 2 / 3);
  assert.equal(result.confusion['requirements-and-spec-writing']['planning-and-task-breakdown'], 1);
  assert.equal(result.thresholds, null);
});

test('validates routing suites and result artifacts with separate data splits', async () => {
  const suiteSchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/routing-suite.schema.json'), 'utf8'));
  const resultSchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/routing-result.schema.json'), 'utf8'));
  const suite = {
    schemaVersion: 1,
    name: 'schema-routing',
    trials: 2,
    cases: [
      { id: 'train', split: 'training', prompt: 'Review code.', expected: ['code-review'], excluded: ['security-review'] },
      { id: 'validate', split: 'validation', prompt: 'Threat model code.', expected: ['security-review'], excluded: ['code-review'] },
    ],
  };
  assert.deepEqual(validateRoutingSuite(suiteSchema, suite), []);
  assert.match(validateRoutingSuite(suiteSchema, { ...suite, cases: [suite.cases[0]] }).join('\n'), /validation case/);

  const result = await runRoutingEvaluation({
    suite,
    catalog: [
      { name: 'code-review', description: 'Reviews code.' },
      { name: 'security-review', description: 'Reviews security.' },
    ],
    generatedAt: '2026-07-25T12:00:00.000Z',
    execute: async ({ case: routingCase }) => ({
      selectedSkills: routingCase.expected,
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
    }),
  });
  assert.deepEqual(validateRoutingResult(resultSchema, result), []);
  result.cases[0].promptSha256 = 'invalid';
  assert.match(validateRoutingResult(resultSchema, result).join('\n'), /does not match pattern/);
});

test('committed routing pilot covers both required skill boundaries', () => {
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/routing-suite.schema.json'), 'utf8'));
  const suite = JSON.parse(readFileSync(resolve(REPO_ROOT, 'evals/routing.json'), 'utf8'));
  assert.deepEqual(validateRoutingSuite(schema, suite), []);
  const pairs = suite.cases.map((entry) => [...entry.expected, ...entry.excluded].sort().join('|'));
  assert.ok(pairs.includes(['code-review', 'security-review'].sort().join('|')));
  assert.ok(pairs.includes(['planning-and-task-breakdown', 'requirements-and-spec-writing'].sort().join('|')));
  assert.ok(suite.trials >= 3);
});

test('routing CLI runs repeated adapter trials and writes a confusion artifact', () => {
  const temp = makeTempDir('routing-cli-');
  try {
    const adapterPath = resolve(temp, 'adapter.mjs');
    const outputPath = resolve(temp, 'result.json');
    writeFileSync(adapterPath, [
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      'const request = JSON.parse(input);',
      "let selectedSkills = ['requirements-and-spec-writing'];",
      "if (/pull request|staged patch/i.test(request.prompt)) selectedSkills = ['code-review'];",
      "if (/authentication|threat model/i.test(request.prompt)) selectedSkills = ['security-review'];",
      "if (/approved specification|sequence the accepted/i.test(request.prompt)) selectedSkills = ['planning-and-task-breakdown'];",
      "process.stdout.write(JSON.stringify({ selectedSkills, inputTokens: 5, outputTokens: 1 }));",
    ].join('\n'));

    const execution = spawnSync(process.execPath, [
      resolve(REPO_ROOT, 'scripts/run-routing-evaluations.mjs'),
      '--suite', resolve(REPO_ROOT, 'evals/routing.json'),
      '--adapter', process.execPath,
      '--adapter-arg', adapterPath,
      '--out', outputPath,
    ], { cwd: REPO_ROOT, encoding: 'utf8' });

    assert.equal(execution.status, 0, execution.stderr);
    const result = JSON.parse(readFileSync(outputPath, 'utf8'));
    assert.equal(result.summary.overall.trials, 24);
    assert.equal(result.summary.overall.recall, 1);
    assert.equal(result.thresholds, null);
    assert.match(execution.stdout, /validation recall: 100\.0%/);
  } finally {
    removeDir(temp);
  }
});

test('does not count another expected skill as confusion in multi-label routing', async () => {
  const result = await runRoutingEvaluation({
    suite: {
      schemaVersion: 1,
      name: 'multi-label',
      trials: 1,
      cases: [
        { id: 'train', split: 'training', prompt: 'Review security.', expected: ['code-review', 'security-review'], excluded: [] },
        { id: 'validate', split: 'validation', prompt: 'Review security.', expected: ['code-review', 'security-review'], excluded: [] },
      ],
    },
    catalog: [
      { name: 'code-review', description: 'Reviews code.' },
      { name: 'security-review', description: 'Reviews security.' },
    ],
    execute: async () => ({
      selectedSkills: ['code-review', 'security-review'],
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
    }),
  });
  assert.deepEqual(result.confusion, { 'code-review': {}, 'security-review': {} });
});

test('rejects unsafe routing counters and inconsistent result metrics', async () => {
  const suite = {
    schemaVersion: 1,
    name: 'routing-integrity',
    trials: 1,
    cases: [
      { id: 'train', split: 'training', prompt: 'Review.', expected: ['code-review'], excluded: [] },
      { id: 'validate', split: 'validation', prompt: 'Review.', expected: ['code-review'], excluded: [] },
    ],
  };
  const catalog = [{ name: 'code-review', description: 'Reviews code.' }];
  await assert.rejects(() => runRoutingEvaluation({
    suite,
    catalog,
    execute: async () => ({
      selectedSkills: ['code-review'],
      inputTokens: Number.MAX_SAFE_INTEGER,
      outputTokens: 1,
      durationMs: 1,
    }),
  }), /safe integer/);

  const result = await runRoutingEvaluation({
    suite,
    catalog,
    execute: async () => ({ selectedSkills: ['code-review'], inputTokens: 1, outputTokens: 1, durationMs: 1 }),
  });
  result.summary.validation.recall = 0;
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/routing-result.schema.json'), 'utf8'));
  assert.match(validateRoutingResult(schema, result).join('\n'), /validation summary does not match case trials/);
});

test('bounds trial counts, rejects duplicate routes, and treats replacements as collisions', async () => {
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/routing-suite.schema.json'), 'utf8'));
  const suite = {
    schemaVersion: 1,
    name: 'bounded-routing',
    trials: 101,
    cases: [
      { id: 'train', split: 'training', prompt: 'Route.', expected: ['a', 'a'], excluded: [] },
      { id: 'validate', split: 'validation', prompt: 'Route.', expected: ['a', 'b'], excluded: ['c', 'c'] },
    ],
  };
  const errors = validateRoutingSuite(schema, suite).join('\n');
  assert.match(errors, /above maximum 100/);
  assert.match(errors, /duplicate expected skill/);
  assert.match(errors, /duplicate excluded skill/);

  suite.trials = 1;
  suite.cases[0].expected = ['a'];
  suite.cases[1].excluded = ['c'];
  const result = await runRoutingEvaluation({
    suite,
    catalog: [
      { name: 'a', description: 'A' },
      { name: 'b', description: 'B' },
      { name: 'c', description: 'C' },
    ],
    execute: async ({ case: routingCase }) => ({
      selectedSkills: routingCase.id === 'validate' ? ['a', 'c'] : ['a'],
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
    }),
  });
  assert.equal(result.cases[1].trials[0].collision, true);

  result.summary.validation = {
    tokens: result.summary.validation.tokens,
    collisionRate: result.summary.validation.collisionRate,
    recall: result.summary.validation.recall,
    precision: result.summary.validation.precision,
    durationMs: result.summary.validation.durationMs,
    trials: result.summary.validation.trials,
    collisions: result.summary.validation.collisions,
    falseNegatives: result.summary.validation.falseNegatives,
    falsePositives: result.summary.validation.falsePositives,
    truePositives: result.summary.validation.truePositives,
  };
  const resultSchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/routing-result.schema.json'), 'utf8'));
  assert.deepEqual(validateRoutingResult(resultSchema, result), []);
});
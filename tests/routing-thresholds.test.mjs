import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  runRoutingEvaluation,
  validateRoutingResult,
  validateRoutingThresholdPolicy,
} from '../scripts/lib/routing-evaluations.mjs';
import { sha256 } from '../scripts/lib/paths.mjs';
import { makeTempDir, removeDir, REPO_ROOT } from './helpers.mjs';

const HASH = 'a'.repeat(64);
const ADAPTER = { id: 'measured-host-v1', model: 'vendor/model-v1' };

function suite() {
  return {
    schemaVersion: 1,
    name: 'threshold-contract',
    trials: 2,
    cases: [
      { id: 'train', split: 'training', prompt: 'Review code.', expected: ['code-review'], excluded: [] },
      { id: 'validate', split: 'validation', prompt: 'Threat model code.', expected: ['security-review'], excluded: [] },
    ],
  };
}

function policy(overrides = {}) {
  const measured = {
    validationRecall: 1,
    overallPrecision: 1,
    overallCollisionRate: 0,
  };
  return {
    schemaVersion: 1,
    suiteSha256: sha256(JSON.stringify(suite())),
    sourceResultSha256: HASH,
    measuredAt: '2026-07-26',
    trials: 2,
    adapter: ADAPTER,
    measured,
    thresholds: {
      minimumValidationRecall: measured.validationRecall,
      minimumOverallPrecision: measured.overallPrecision,
      maximumOverallCollisionRate: measured.overallCollisionRate,
    },
    ...overrides,
  };
}

async function evaluate(
  thresholdPolicy = null,
  selectedSkills = null,
  sourceResult = null,
  sourceResultSha256 = null,
) {
  return runRoutingEvaluation({
    suite: suite(),
    catalog: [
      { name: 'code-review', description: 'Reviews code.' },
      { name: 'security-review', description: 'Reviews security.' },
    ],
    generatedAt: '2026-07-27T12:00:00.000Z',
    thresholdPolicy,
    thresholdPolicySha256: thresholdPolicy ? sha256(JSON.stringify(thresholdPolicy)) : undefined,
    suiteSha256: sha256(JSON.stringify(suite())),
    adapter: ADAPTER,
    sourceResult,
    sourceResultSha256,
    execute: async ({ case: routingCase }) => ({
      selectedSkills: selectedSkills?.(routingCase) ?? routingCase.expected,
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
    }),
  });
}

test('embeds a passing measured threshold evaluation', async () => {
  const sourceResult = await evaluate();
  const sourceBytes = Buffer.from(JSON.stringify(sourceResult));
  const thresholdPolicy = policy({ sourceResultSha256: sha256(sourceBytes) });
  const policySchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/routing-thresholds.schema.json'), 'utf8'));
  assert.deepEqual(validateRoutingThresholdPolicy(policySchema, thresholdPolicy, {
    suite: suite(),
    suiteSha256: sha256(JSON.stringify(suite())),
    adapter: ADAPTER,
    generatedAt: '2026-07-27T12:00:00.000Z',
    sourceResult,
    sourceResultSha256: sha256(sourceBytes),
  }), []);

  const result = await evaluate(
    thresholdPolicy,
    null,
    sourceResult,
    sha256(sourceBytes),
  );
  assert.equal(result.thresholds.passed, true);
  assert.deepEqual(result.thresholds.observed, {
    validationRecall: 1,
    overallPrecision: 1,
    overallCollisionRate: 0,
  });
  assert.deepEqual(result.adapter, ADAPTER);
  const resultSchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/routing-result.schema.json'), 'utf8'));
  assert.deepEqual(validateRoutingResult(resultSchema, result, {
    thresholdPolicy,
    thresholdPolicySha256: sha256(JSON.stringify(thresholdPolicy)),
  }), []);
});

test('marks measured regressions and makes the CLI fail', () => {
  const temp = makeTempDir('routing-threshold-regression-');
  try {
    const adapterPath = resolve(temp, 'regression-adapter.mjs');
    writeFileSync(adapterPath, [
      "for await (const chunk of process.stdin) void chunk;",
      "process.stdout.write(JSON.stringify({ selectedSkills: [], inputTokens: 1, outputTokens: 1 }));",
      '',
    ].join('\n'));
    const thresholdPolicy = policy({
      suiteSha256: sha256(readFileSync(resolve(REPO_ROOT, 'evals/routing.json'))),
      trials: JSON.parse(readFileSync(resolve(REPO_ROOT, 'evals/routing.json'), 'utf8')).trials,
    });
    const sourcePath = resolve(temp, 'source-result.json');
    const sourceExecution = spawnSync(process.execPath, [
      resolve(REPO_ROOT, 'scripts/run-routing-evaluations.mjs'),
      '--suite', resolve(REPO_ROOT, 'evals/routing.json'),
      '--adapter', process.execPath,
      '--adapter-arg', resolve(REPO_ROOT, 'tests/fixtures/routing-adapter.mjs'),
      '--adapter-id', ADAPTER.id,
      '--model', ADAPTER.model,
      '--out', sourcePath,
    ], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(sourceExecution.status, 0, sourceExecution.stderr);
    const sourceBytes = readFileSync(sourcePath);
    const sourceResult = JSON.parse(sourceBytes);
    thresholdPolicy.sourceResultSha256 = sha256(sourceBytes);
    thresholdPolicy.measured = {
      validationRecall: sourceResult.summary.validation.recall,
      overallPrecision: sourceResult.summary.overall.precision,
      overallCollisionRate: sourceResult.summary.overall.collisionRate,
    };
    thresholdPolicy.thresholds = {
      minimumValidationRecall: thresholdPolicy.measured.validationRecall,
      minimumOverallPrecision: thresholdPolicy.measured.overallPrecision,
      maximumOverallCollisionRate: thresholdPolicy.measured.overallCollisionRate,
    };
    writeFileSync(resolve(temp, 'policy.json'), `${JSON.stringify(thresholdPolicy, null, 2)}\n`);
    const execution = spawnSync(process.execPath, [
      resolve(REPO_ROOT, 'scripts/run-routing-evaluations.mjs'),
      '--suite', resolve(REPO_ROOT, 'evals/routing.json'),
      '--adapter', process.execPath,
      '--adapter-arg', adapterPath,
      '--adapter-id', ADAPTER.id,
      '--model', ADAPTER.model,
      '--threshold-policy', resolve(temp, 'policy.json'),
      '--threshold-source-result', sourcePath,
      '--out', resolve(temp, 'result.json'),
    ], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.notEqual(execution.status, 0);
    assert.match(execution.stderr, /routing thresholds failed/i);
  } finally {
    removeDir(temp);
  }
});

test('rejects mismatched threshold provenance and adapter identities', () => {
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/routing-thresholds.schema.json'), 'utf8'));
  const errors = validateRoutingThresholdPolicy(schema, policy({
    suiteSha256: 'b'.repeat(64),
    trials: 3,
  }), {
    suite: suite(),
    suiteSha256: sha256(JSON.stringify(suite())),
    adapter: { id: ADAPTER.id, model: 'vendor/model-v2' },
    generatedAt: '2026-07-27T12:00:00.000Z',
  }).join('\n');
  assert.match(errors, /suiteSha256.*does not match/);
  assert.match(errors, /trials.*does not match/);
  assert.match(errors, /adapter.*does not match/);
});

test('requires the exact measured source result and binds its metrics', () => {
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/routing-thresholds.schema.json'), 'utf8'));
  const sourceResult = {
    schemaVersion: 1,
    suite: suite().name,
    suiteSha256: sha256(JSON.stringify(suite())),
    generatedAt: '2026-07-26T12:00:00.000Z',
    adapter: ADAPTER,
    thresholds: null,
    cases: suite().cases.map((entry) => ({
      id: entry.id,
      split: entry.split,
      promptSha256: sha256(entry.prompt),
      expected: entry.expected,
      excluded: entry.excluded,
      activationRate: 1,
      trials: [{}, {}],
    })),
    summary: {
      validation: { recall: 1 },
      overall: { precision: 1, collisionRate: 0 },
    },
  };
  const sourceBytes = Buffer.from(`${JSON.stringify(sourceResult)}\n`);
  const thresholdPolicy = policy({ sourceResultSha256: sha256(sourceBytes) });

  const missing = validateRoutingThresholdPolicy(schema, thresholdPolicy, {
    suite: suite(),
    suiteSha256: sha256(JSON.stringify(suite())),
    adapter: ADAPTER,
    generatedAt: '2026-07-27T12:00:00.000Z',
  }).join('\n');
  assert.match(missing, /source result.*required/i);

  const caseMutations = [
    (result) => { result.cases[0].id = 'other'; },
    (result) => { result.cases[0].split = 'validation'; },
    (result) => { result.cases[0].promptSha256 = 'f'.repeat(64); },
    (result) => { result.cases[0].expected = ['security-review']; },
    (result) => { result.cases[0].excluded = ['code-review']; },
    (result) => { result.cases[0].trials.pop(); },
  ];
  for (const mutate of caseMutations) {
    const stale = structuredClone(sourceResult);
    mutate(stale);
    const staleBytes = Buffer.from(`${JSON.stringify(stale)}\n`);
    const stalePolicy = policy({ sourceResultSha256: sha256(staleBytes) });
    const caseErrors = validateRoutingThresholdPolicy(schema, stalePolicy, {
      suite: suite(),
      suiteSha256: sha256(JSON.stringify(suite())),
      adapter: ADAPTER,
      generatedAt: '2026-07-27T12:00:00.000Z',
      sourceResult: stale,
      sourceResultSha256: sha256(staleBytes),
    }).join('\n');
    assert.match(caseErrors, /source result cases.*routing suite/i);
  }

  sourceResult.summary.validation.recall = 0.5;
  const mismatched = validateRoutingThresholdPolicy(schema, thresholdPolicy, {
    suite: suite(),
    suiteSha256: sha256(JSON.stringify(suite())),
    adapter: ADAPTER,
    generatedAt: '2026-07-27T12:00:00.000Z',
    sourceResult,
    sourceResultSha256: sha256(sourceBytes),
  }).join('\n');
  assert.match(mismatched, /measured.*source result/i);
});

test('rejects malformed, future-dated, and invented threshold policies', () => {
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/routing-thresholds.schema.json'), 'utf8'));
  const malformed = policy({
    measuredAt: '2026-02-30',
    sourceResultSha256: 'not-a-hash',
    thresholds: {
      minimumValidationRecall: 0.5,
      minimumOverallPrecision: 1,
      maximumOverallCollisionRate: 0,
    },
  });
  const errors = validateRoutingThresholdPolicy(schema, malformed, {
    suite: suite(),
    suiteSha256: sha256(JSON.stringify(suite())),
    adapter: ADAPTER,
    generatedAt: '2026-02-01T12:00:00.000Z',
  }).join('\n');
  assert.match(errors, /sourceResultSha256/);
  assert.match(errors, /valid calendar date/);
  assert.match(errors, /minimumValidationRecall.*measured baseline/);
});

test('preserves null thresholds and validates no-threshold results', async () => {
  const result = await evaluate();
  assert.equal(result.thresholds, null);
  assert.deepEqual(result.adapter, ADAPTER);
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/routing-result.schema.json'), 'utf8'));
  assert.deepEqual(validateRoutingResult(schema, result), []);
});

test('rejects internally inconsistent embedded threshold evaluations', async () => {
  const sourceResult = await evaluate();
  const sourceBytes = Buffer.from(JSON.stringify(sourceResult));
  const thresholdPolicy = policy({ sourceResultSha256: sha256(sourceBytes) });
  const result = await evaluate(
    thresholdPolicy,
    null,
    sourceResult,
    sha256(sourceBytes),
  );
  result.thresholds.observed.validationRecall = 0;
  result.thresholds.passed = false;
  result.thresholds.sourceResultSha256 = 'b'.repeat(64);
  result.adapter.model = 'vendor/model-v2';
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/routing-result.schema.json'), 'utf8'));
  const errors = validateRoutingResult(schema, result, {
    thresholdPolicy,
    thresholdPolicySha256: sha256(JSON.stringify(thresholdPolicy)),
  }).join('\n');
  assert.match(errors, /observed metrics do not match summary/);
  assert.match(errors, /adapter identity does not match/);
  assert.match(errors, /sourceResultSha256.*does not match/);
});

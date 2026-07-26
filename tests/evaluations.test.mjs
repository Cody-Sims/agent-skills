import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  runEvaluationSuite,
  validateEvaluationResult,
  validateEvaluationSuite,
} from '../scripts/lib/evaluations.mjs';
import { makeTempDir, removeDir, REPO_ROOT } from './helpers.mjs';

test('compares candidate and baseline in isolated workspaces with objective and human grading', async () => {
  const workspaces = [];
  const suite = {
    schemaVersion: 1,
    name: 'verification-pilot',
    skill: 'verification-before-completion',
    cases: [{
      id: 'fresh-evidence',
      prompt: 'Report whether the work is complete.',
      assertions: [
        { id: 'mentions-command', type: 'contains', value: 'npm test' },
        { id: 'avoids-assumption', type: 'notContains', value: 'should pass' },
      ],
      humanReview: [
        { id: 'evidence-quality', question: 'Is the evidence specific and independently checkable?' },
      ],
    }],
  };

  const result = await runEvaluationSuite({
    suite,
    skillContent: '# Verification Before Completion',
    execute: async ({ variant, workspace, skillContent }) => {
      workspaces.push(workspace);
      if (variant === 'baseline') {
        assert.equal(skillContent, null);
        return { text: 'The tests should pass.', inputTokens: 10, outputTokens: 4, durationMs: 12 };
      }
      assert.match(skillContent, /Verification Before Completion/);
      return { text: 'Ran npm test with exit code 0.', inputTokens: 18, outputTokens: 8, durationMs: 20 };
    },
  });

  assert.equal(new Set(workspaces).size, 2);
  assert.equal(result.summary.baseline.passRate, 0);
  assert.equal(result.summary.candidate.passRate, 1);
  assert.equal(result.summary.passRateDelta, 1);
  assert.deepEqual(result.summary.candidate.tokens, { input: 18, output: 8, total: 26 });
  assert.equal(result.summary.candidate.durationMs, 20);
  assert.equal(result.cases[0].candidate.assertions[0].passed, true);
  assert.equal(result.cases[0].candidate.assertions[0].evidence, 'Required text was present.');
  assert.match(result.cases[0].candidate.outputSha256, /^[0-9a-f]{64}$/);
  assert.equal(result.cases[0].humanReview[0].status, 'pending');
});

test('validates versioned suites and benchmark artifacts', async () => {
  const suiteSchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/eval-suite.schema.json'), 'utf8'));
  const resultSchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/eval-result.schema.json'), 'utf8'));
  const suite = {
    schemaVersion: 1,
    name: 'schema-pilot',
    skill: 'verification-before-completion',
    cases: [{
      id: 'case-1',
      prompt: 'Verify the result.',
      assertions: [{ id: 'a-1', type: 'regex', value: 'exit code [0-9]+', flags: 'i' }],
      humanReview: [],
    }],
  };
  assert.deepEqual(validateEvaluationSuite(suiteSchema, suite), []);
  assert.match(validateEvaluationSuite(suiteSchema, { ...suite, cases: [] }).join('\n'), /at least one case/);

  const result = await runEvaluationSuite({
    suite,
    skillContent: '# Skill',
    generatedAt: '2026-07-25T12:00:00.000Z',
    execute: async () => ({ text: 'Exit code 0', inputTokens: 1, outputTokens: 2, durationMs: 3 }),
  });
  assert.deepEqual(validateEvaluationResult(resultSchema, result), []);
  result.cases[0].candidate.outputSha256 = 'invalid';
  assert.match(validateEvaluationResult(resultSchema, result).join('\n'), /does not match pattern/);
});

test('CLI runs a subprocess adapter and writes a benchmark artifact', () => {
  const temp = makeTempDir('eval-cli-');
  try {
    const suitePath = resolve(temp, 'suite.json');
    const adapterPath = resolve(temp, 'adapter.mjs');
    const outputPath = resolve(temp, 'result.json');
    writeFileSync(suitePath, JSON.stringify({
      schemaVersion: 1,
      name: 'cli-pilot',
      skill: 'verification-before-completion',
      cases: [{
        id: 'cli-case',
        prompt: 'Verify before reporting completion.',
        assertions: [{ id: 'command', type: 'contains', value: 'npm test' }],
        humanReview: [],
      }],
    }));
    writeFileSync(adapterPath, [
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      'const request = JSON.parse(input);',
      "const text = request.variant === 'candidate' ? 'Ran npm test.' : 'Looks complete.';",
      "process.stdout.write(JSON.stringify({ text, inputTokens: 5, outputTokens: 3 }));",
    ].join('\n'));

    const execution = spawnSync(process.execPath, [
      resolve(REPO_ROOT, 'scripts/run-evaluations.mjs'),
      '--suite', suitePath,
      '--adapter', process.execPath,
      '--adapter-arg', adapterPath,
      '--out', outputPath,
    ], { cwd: REPO_ROOT, encoding: 'utf8' });

    assert.equal(execution.status, 0, execution.stderr);
    const result = JSON.parse(readFileSync(outputPath, 'utf8'));
    assert.equal(result.summary.baseline.passRate, 0);
    assert.equal(result.summary.candidate.passRate, 1);
    assert.match(execution.stdout, /candidate pass rate: 100\.0%/);
  } finally {
    removeDir(temp);
  }
});

test('copies optional fixtures into each workspace and rejects escaping paths', async () => {
  const temp = makeTempDir('eval-fixture-');
  try {
    mkdirSync(resolve(temp, 'fixtures', 'case-1'), { recursive: true });
    writeFileSync(resolve(temp, 'fixtures', 'case-1', 'input.txt'), 'fixture content\n');
    const suite = {
      schemaVersion: 1,
      name: 'fixture-pilot',
      skill: 'verification-before-completion',
      cases: [{
        id: 'fixture-case',
        prompt: 'Read the fixture.',
        fixture: 'fixtures/case-1',
        assertions: [{ id: 'fixture', type: 'contains', value: 'fixture content' }],
        humanReview: [],
      }],
    };
    let executions = 0;
    await runEvaluationSuite({
      suite,
      suiteDirectory: temp,
      skillContent: '# Skill',
      execute: async ({ workspace }) => {
        executions += 1;
        return {
          text: readFileSync(resolve(workspace, 'input.txt'), 'utf8'),
          inputTokens: 1,
          outputTokens: 1,
          durationMs: 1,
        };
      },
    });
    assert.equal(executions, 2);

    suite.cases[0].fixture = '../outside';
    await assert.rejects(() => runEvaluationSuite({
      suite,
      suiteDirectory: temp,
      skillContent: '# Skill',
      execute: async () => ({ text: '', inputTokens: 0, outputTokens: 0, durationMs: 0 }),
    }), /escapes managed root/);
  } finally {
    removeDir(temp);
  }
});

test('committed pilot suite satisfies the versioned evaluation schema', () => {
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/eval-suite.schema.json'), 'utf8'));
  const suite = JSON.parse(readFileSync(resolve(REPO_ROOT, 'evals/evals.json'), 'utf8'));
  assert.deepEqual(validateEvaluationSuite(schema, suite), []);
  assert.equal(suite.skill, 'verification-before-completion');
  assert.ok(suite.cases.length >= 2);
});

test('does not retain matched model output in assertion evidence', async () => {
  const secret = 'sensitive-model-output-value';
  const result = await runEvaluationSuite({
    suite: {
      schemaVersion: 1,
      name: 'redaction-pilot',
      skill: 'verification-before-completion',
      cases: [{
        id: 'redaction-case',
        prompt: 'Return evidence.',
        assertions: [{ id: 'secret-pattern', type: 'contains', value: secret }],
        humanReview: [],
      }],
    },
    skillContent: '# Skill',
    execute: async () => ({ text: secret, inputTokens: 1, outputTokens: 1, durationMs: 1 }),
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('rejects unsafe token counters and inconsistent result summaries', async () => {
  const suite = {
    schemaVersion: 1,
    name: 'metric-pilot',
    skill: 'verification-before-completion',
    cases: [{
      id: 'metric-case',
      prompt: 'Measure this.',
      assertions: [{ id: 'match', type: 'contains', value: 'ok' }],
      humanReview: [],
    }],
  };
  await assert.rejects(() => runEvaluationSuite({
    suite,
    skillContent: '# Skill',
    execute: async () => ({ text: 'ok', inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1, durationMs: 1 }),
  }), /safe integer/);

  const result = await runEvaluationSuite({
    suite,
    skillContent: '# Skill',
    execute: async () => ({ text: 'ok', inputTokens: 1, outputTokens: 1, durationMs: 1 }),
  });
  result.summary.candidate.passRate = 0;
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/eval-result.schema.json'), 'utf8'));
  assert.match(validateEvaluationResult(schema, result).join('\n'), /candidate summary does not match case results/);
});

test('does not pass arbitrary parent secrets or echo adapter stderr', () => {
  const temp = makeTempDir('eval-secret-');
  try {
    const suitePath = resolve(temp, 'suite.json');
    const adapterPath = resolve(temp, 'adapter.mjs');
    const outputPath = resolve(temp, 'result.json');
    writeFileSync(suitePath, JSON.stringify({
      schemaVersion: 1,
      name: 'secret-pilot',
      skill: 'verification-before-completion',
      cases: [{
        id: 'secret-case',
        prompt: 'Do not leak secrets.',
        assertions: [{ id: 'isolated', type: 'contains', value: 'isolated' }],
        humanReview: [],
      }],
    }));
    writeFileSync(adapterPath, [
      "if (process.env.EVAL_TEST_SECRET) { console.error(process.env.EVAL_TEST_SECRET); process.exit(7); }",
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      "process.stdout.write(JSON.stringify({ text: 'isolated', inputTokens: 1, outputTokens: 1 }));",
    ].join('\n'));
    const command = [
      resolve(REPO_ROOT, 'scripts/run-evaluations.mjs'),
      '--suite', suitePath,
      '--adapter', process.execPath,
      '--adapter-arg', adapterPath,
      '--out', outputPath,
    ];
    const isolated = spawnSync(process.execPath, command, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, EVAL_TEST_SECRET: 'sentinel-secret-value' },
    });
    assert.equal(isolated.status, 0, isolated.stderr);

    writeFileSync(adapterPath, "console.error('sentinel-secret-value'); process.exit(7);\n");
    const failed = spawnSync(process.execPath, command, { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.equal(failed.stderr.includes('sentinel-secret-value'), false);
    assert.match(failed.stderr, /stderr suppressed/);
  } finally {
    removeDir(temp);
  }
});

test('bounds assertion worker fan-out and accepts order-independent summaries', async () => {
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/eval-suite.schema.json'), 'utf8'));
  const assertions = Array.from({ length: 101 }, (_, index) => ({
    id: `assertion-${index}`,
    type: 'regex',
    value: 'ok',
  }));
  const suite = {
    schemaVersion: 1,
    name: 'bounded-suite',
    skill: 'verification-before-completion',
    cases: [{ id: 'bounded-case', prompt: 'Check.', assertions, humanReview: [] }],
  };
  assert.match(validateEvaluationSuite(schema, suite).join('\n'), /maximum of 100 assertions/);

  suite.cases[0].assertions = assertions.slice(0, 1);
  const result = await runEvaluationSuite({
    suite,
    skillContent: '# Skill',
    execute: async () => ({ text: 'ok', inputTokens: 1, outputTokens: 1, durationMs: 1 }),
  });
  result.summary.candidate = {
    tokens: result.summary.candidate.tokens,
    durationMs: result.summary.candidate.durationMs,
    passRate: result.summary.candidate.passRate,
    assertions: result.summary.candidate.assertions,
    passed: result.summary.candidate.passed,
  };
  const resultSchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/eval-result.schema.json'), 'utf8'));
  assert.deepEqual(validateEvaluationResult(resultSchema, result), []);
});
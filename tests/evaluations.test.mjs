import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
} from 'node:fs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  runEvaluationSuite as runEvaluationSuiteWithIdentity,
  validateEvaluationResult,
  validateEvaluationSuite,
} from '../scripts/lib/evaluations.mjs';
import { makeTempDir, removeDir, REPO_ROOT } from './helpers.mjs';
import { validateEvaluationFiles } from '../scripts/validate-evaluations.mjs';

const ADAPTER = { id: 'in-process-evaluation-test', model: 'test-model-v1' };

function runEvaluationSuite(options) {
  return runEvaluationSuiteWithIdentity({ adapter: ADAPTER, ...options });
}

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

test('stages the complete candidate skill tree without exposing it to the baseline', async () => {
  const temp = makeTempDir('eval-skill-tree-');
  try {
    const skillRoot = resolve(temp, 'source-skill');
    mkdirSync(resolve(skillRoot, 'references', 'nested'), { recursive: true });
    mkdirSync(resolve(skillRoot, 'scripts', 'nested'), { recursive: true });
    mkdirSync(resolve(skillRoot, 'assets', 'nested'), { recursive: true });
    writeFileSync(resolve(skillRoot, 'SKILL.md'), '# Resource Skill\n');
    writeFileSync(resolve(skillRoot, 'references', 'nested', 'guide.md'), 'reference content\n');
    writeFileSync(resolve(skillRoot, 'scripts', 'nested', 'check.mjs'), 'console.log("script content");\n');
    writeFileSync(resolve(skillRoot, 'assets', 'nested', 'template.txt'), 'asset content\n');

    const suite = {
      schemaVersion: 1,
      name: 'resource-pilot',
      skill: 'resource-skill',
      cases: [{
        id: 'resource-case',
        prompt: 'Use the complete skill.',
        assertions: [{ id: 'resources', type: 'contains', value: 'resources visible' }],
        humanReview: [],
      }],
    };
    const workspaces = [];
    await runEvaluationSuite({
      suite,
      skillRoot,
      skillContent: '# Resource Skill\n',
      tempRoot: resolve(temp, 'runs'),
      execute: async ({ variant, workspace, skillPath }) => {
        workspaces.push(workspace);
        const stableSkillPath = resolve(workspace, '.candidate-skill');
        if (variant === 'baseline') {
          assert.equal(skillPath, null);
          assert.equal(existsSync(stableSkillPath), false);
          return { text: 'resources hidden', inputTokens: 1, outputTokens: 1, durationMs: 1 };
        }

        assert.equal(skillPath, stableSkillPath);
        assert.equal(readFileSync(resolve(skillPath, 'SKILL.md'), 'utf8'), '# Resource Skill\n');
        assert.equal(readFileSync(resolve(skillPath, 'references', 'nested', 'guide.md'), 'utf8'), 'reference content\n');
        assert.equal(readFileSync(resolve(skillPath, 'scripts', 'nested', 'check.mjs'), 'utf8'), 'console.log("script content");\n');
        assert.equal(readFileSync(resolve(skillPath, 'assets', 'nested', 'template.txt'), 'utf8'), 'asset content\n');
        return { text: 'resources visible', inputTokens: 1, outputTokens: 1, durationMs: 1 };
      },
    });

    assert.equal(new Set(workspaces).size, 2);
    assert.equal(workspaces.every((workspace) => !existsSync(workspace)), true);
  } finally {
    removeDir(temp);
  }
});

test('rejects symlinks in a candidate skill tree', async () => {
  const temp = makeTempDir('eval-skill-symlink-');
  try {
    const skillRoot = resolve(temp, 'source-skill');
    mkdirSync(resolve(skillRoot, 'references'), { recursive: true });
    writeFileSync(resolve(skillRoot, 'SKILL.md'), '# Resource Skill\n');
    writeFileSync(resolve(temp, 'outside.md'), 'outside content\n');
    symlinkSync(resolve(temp, 'outside.md'), resolve(skillRoot, 'references', 'outside.md'));

    await assert.rejects(() => runEvaluationSuite({
      suite: {
        schemaVersion: 1,
        name: 'resource-symlink-pilot',
        skill: 'resource-skill',
        cases: [{
          id: 'resource-case',
          prompt: 'Use the complete skill.',
          assertions: [{ id: 'resources', type: 'contains', value: 'visible' }],
          humanReview: [],
        }],
      },
      skillRoot,
      skillContent: '# Resource Skill\n',
      tempRoot: resolve(temp, 'runs'),
      execute: async () => ({ text: 'visible', inputTokens: 1, outputTokens: 1, durationMs: 1 }),
    }), /Refusing a symlink in a managed path/);
  } finally {
    removeDir(temp);
  }
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
  assert.match(validateEvaluationSuite(suiteSchema, null).join('\n'), /expected type object/);
  assert.match(validateEvaluationSuite(suiteSchema, { ...suite, cases: [] }).join('\n'), /at least one case/);
  assert.match(validateEvaluationSuite(suiteSchema, { ...suite, cases: [null] }).join('\n'), /expected type object/);

  const result = await runEvaluationSuite({
    suite,
    skillContent: '# Skill',
    generatedAt: '2026-07-25T12:00:00.000Z',
    execute: async () => ({ text: 'Exit code 0', inputTokens: 1, outputTokens: 2, durationMs: 3 }),
  });
  assert.equal(result.schemaVersion, 2);
  assert.deepEqual(validateEvaluationResult(resultSchema, result), []);
  const legacy = structuredClone(result);
  legacy.schemaVersion = 1;
  delete legacy.adapter;
  assert.deepEqual(validateEvaluationResult(resultSchema, legacy), []);
  assert.match(validateEvaluationResult(resultSchema, { ...result, cases: [null] }).join('\n'), /expected type object/);
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
      "import { existsSync } from 'node:fs';",
      "import { resolve } from 'node:path';",
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      'const request = JSON.parse(input);',
      "const stableSkillPath = resolve(process.cwd(), '.candidate-skill');",
      `const parentHome = ${JSON.stringify(process.env.HOME)};`,
      "const isolated = process.env.HOME === process.cwd() && process.env.HOME !== parentHome;",
      "let text = request.skillPath === null && !existsSync(stableSkillPath) && isolated ? 'Looks complete.' : 'Isolation failed.';",
      "if (request.variant === 'candidate' && request.skillPath === stableSkillPath",
      "    && existsSync(resolve(request.skillPath, 'SKILL.md')) && isolated) text = 'Ran npm test.';",
      "process.stdout.write(JSON.stringify({ text, inputTokens: 5, outputTokens: 3 }));",
    ].join('\n'));

    const execution = spawnSync(process.execPath, [
      resolve(REPO_ROOT, 'scripts/run-evaluations.mjs'),
      '--suite', suitePath,
      '--adapter', process.execPath,
      '--adapter-arg', adapterPath,
      '--adapter-id', ADAPTER.id,
      '--model', ADAPTER.model,
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
      '--adapter-id', ADAPTER.id,
      '--model', ADAPTER.model,
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

test('grades actual deliverables instead of an adapter claiming success', async () => {
  const result = await runEvaluationSuite({
    suite: {
      schemaVersion: 2,
      name: 'deliverable-proof',
      skill: 'verification-before-completion',
      cases: [{
        id: 'deliverable',
        prompt: 'Write the agreed deliverable.',
        assertions: [
          { id: 'claim', type: 'contains', value: 'Done' },
          { id: 'content', type: 'fileEquals', path: 'result.txt', value: 'verified\n' },
          { id: 'bounded-content', type: 'fileContains', path: 'result.txt', value: 'verified' },
          { id: 'no-scratch', type: 'fileAbsent', path: 'scratch.txt' },
        ],
        humanReview: [],
      }],
    },
    skillContent: '# Skill',
    execute: async ({ variant, workspace }) => {
      if (variant === 'candidate') writeFileSync(resolve(workspace, 'result.txt'), 'verified\n');
      return { text: 'Done', inputTokens: 1, outputTokens: 1, durationMs: 1 };
    },
  });
  assert.deepEqual(result.cases[0].baseline.assertions.map((entry) => entry.passed), [true, false, false, true]);
  assert.deepEqual(result.cases[0].candidate.assertions.map((entry) => entry.passed), [true, true, true, true]);
  assert.equal(result.schemaVersion, 3);
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/eval-result.schema.json'), 'utf8'));
  assert.deepEqual(validateEvaluationResult(schema, result), []);
  assert.equal(JSON.stringify(result).includes('verified\n'), false);
});

test('detects read-only violations including added files and Git index changes', async () => {
  const temp = makeTempDir('eval-unchanged-');
  try {
    mkdirSync(resolve(temp, 'fixture', 'project', '.git'), { recursive: true });
    writeFileSync(resolve(temp, 'fixture', 'project', 'input.txt'), 'original\n');
    writeFileSync(resolve(temp, 'fixture', 'project', '.git', 'index'), 'original index\n');
    for (const changedPath of ['input.txt', 'added.txt', '.git/index']) {
      const result = await runEvaluationSuite({
        suite: {
          schemaVersion: 2,
          name: 'read-only-proof',
          skill: 'code-review',
          cases: [{
            id: 'read-only',
            prompt: 'Review project without changing it.',
            fixture: 'fixture',
            assertions: [{ id: 'preserves-tree', type: 'unchanged', path: 'project' }],
            humanReview: [],
          }],
        },
        suiteDirectory: temp,
        skillContent: '# Review',
        tempRoot: resolve(temp, 'runs'),
        execute: async ({ variant, workspace }) => {
          if (variant === 'candidate') writeFileSync(resolve(workspace, 'project', changedPath), 'changed\n');
          return { text: 'I changed nothing.', inputTokens: 1, outputTokens: 1, durationMs: 1 };
        },
      });
      assert.equal(result.cases[0].baseline.assertions[0].passed, true);
      assert.equal(result.cases[0].candidate.assertions[0].passed, false, changedPath);
    }
  } finally {
    removeDir(temp);
  }
});

test('runs an independent bounded oracle outside the mutable task fixture', { timeout: 10_000 }, async () => {
  const temp = makeTempDir('eval-oracle-');
  try {
    writeFileSync(resolve(temp, 'oracle.mjs'), [
      "import { existsSync, readFileSync } from 'node:fs';",
      "import { resolve } from 'node:path';",
      "let input = '';",
      'for await (const chunk of process.stdin) input += chunk;',
      'const { workspace } = JSON.parse(input);',
      "const output = resolve(workspace, 'result.txt');",
      "const passed = existsSync(output) && readFileSync(output, 'utf8') === '42\\n';",
      'process.stdout.write(JSON.stringify({ passed }));',
    ].join('\n'));
    const result = await runEvaluationSuite({
      suite: {
        schemaVersion: 2,
        name: 'command-proof',
        skill: 'verification-before-completion',
        cases: [{
          id: 'command',
          prompt: 'Create result.txt with the answer.',
          assertions: [{ id: 'external-proof', type: 'command', path: 'oracle.mjs', timeoutMs: 2_000 }],
          humanReview: [],
        }],
      },
      suiteDirectory: temp,
      skillContent: '# Skill',
      tempRoot: resolve(temp, 'runs'),
      execute: async ({ variant, workspace }) => {
        assert.equal(existsSync(resolve(workspace, 'oracle.mjs')), false);
        if (variant === 'candidate') writeFileSync(resolve(workspace, 'result.txt'), '42\n');
        return { text: 'Created result.txt.', inputTokens: 1, outputTokens: 1, durationMs: 1 };
      },
    });
    assert.equal(result.cases[0].baseline.assertions[0].passed, false);
    assert.equal(result.cases[0].candidate.assertions[0].passed, true);
    const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/eval-result.schema.json'), 'utf8'));
    assert.deepEqual(validateEvaluationResult(schema, result), []);
  } finally {
    removeDir(temp);
  }
});

test('validates outcome assertions and rejects escaping grader or workspace paths', () => {
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/eval-suite.schema.json'), 'utf8'));
  const suite = {
    schemaVersion: 2,
    name: 'outcome-schema',
    skill: 'code-review',
    cases: [{
      id: 'outcome',
      prompt: 'Inspect the fixture.',
      assertions: [{ id: 'unchanged', type: 'unchanged', path: 'project' }],
      humanReview: [],
    }],
  };
  assert.deepEqual(validateEvaluationSuite(schema, suite), []);
  for (const path of ['../outside', '/absolute']) {
    suite.cases[0].assertions[0].path = path;
    assert.match(validateEvaluationSuite(schema, suite).join('\n'), /relative|escape/);
  }
  suite.cases[0].assertions = [{ id: 'missing-value', type: 'fileEquals', path: 'result.txt' }];
  assert.match(validateEvaluationSuite(schema, suite).join('\n'), /value/);
  suite.cases[0].assertions = [{ id: 'unbounded', type: 'command', path: 'oracle.mjs', timeoutMs: 60_000 }];
  assert.match(validateEvaluationSuite(schema, suite).join('\n'), /30000|30,000/);
  suite.schemaVersion = 1;
  suite.cases[0].assertions = [{ id: 'requires-v2', type: 'unchanged', path: 'project' }];
  assert.match(validateEvaluationSuite(schema, suite).join('\n'), /schemaVersion 2/);
});

test('does not follow model-created symlinks to grade file contents or absence', async () => {
  const temp = makeTempDir('eval-outcome-symlink-');
  try {
    writeFileSync(resolve(temp, 'outside.txt'), 'outside secret\n');
    const result = await runEvaluationSuite({
      suite: {
        schemaVersion: 2,
        name: 'symlink-proof',
        skill: 'code-review',
        cases: [{
          id: 'symlink',
          prompt: 'Produce the requested local file.',
          assertions: [
            { id: 'local-content', type: 'fileContains', path: 'result.txt', value: 'secret' },
            { id: 'no-dangling-link', type: 'fileAbsent', path: 'missing.txt' },
          ],
          humanReview: [],
        }],
      },
      skillContent: '# Skill',
      tempRoot: resolve(temp, 'runs'),
      execute: async ({ workspace }) => {
        symlinkSync(resolve(temp, 'outside.txt'), resolve(workspace, 'result.txt'));
        symlinkSync(resolve(temp, 'not-present'), resolve(workspace, 'missing.txt'));
        return { text: 'Done', inputTokens: 1, outputTokens: 1, durationMs: 1 };
      },
    });
    assert.deepEqual(result.cases[0].candidate.assertions.map((entry) => entry.passed), [false, false]);
    assert.equal(JSON.stringify(result).includes('outside secret'), false);
  } finally {
    removeDir(temp);
  }
});

test('prepares the same fixture independently before either adapter sees it', { timeout: 10_000 }, async () => {
  const temp = makeTempDir('eval-prepare-');
  try {
    writeFileSync(resolve(temp, 'prepare.mjs'), [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "import { resolve } from 'node:path';",
      "let input = '';",
      'for await (const chunk of process.stdin) input += chunk;',
      'const request = JSON.parse(input);',
      'if ("variant" in request || "skillContent" in request) throw new Error("Arm leaked to setup");',
      "mkdirSync(resolve(request.workspace, 'project'));",
      "writeFileSync(resolve(request.workspace, 'project', 'ready.txt'), 'ready\\n');",
      'process.stdout.write(JSON.stringify({ ready: true }));',
    ].join('\n'));
    let runs = 0;
    const result = await runEvaluationSuite({
      suite: {
        schemaVersion: 2,
        name: 'prepare-proof',
        skill: 'code-review',
        cases: [{
          id: 'prepared',
          prompt: 'Inspect the prepared project.',
          setup: { path: 'prepare.mjs', timeoutMs: 2_000 },
          assertions: [{ id: 'unchanged', type: 'unchanged', path: 'project' }],
          humanReview: [],
        }],
      },
      suiteDirectory: temp,
      skillContent: '# Review',
      tempRoot: resolve(temp, 'runs'),
      execute: async ({ workspace }) => {
        runs += 1;
        assert.equal(readFileSync(resolve(workspace, 'project', 'ready.txt'), 'utf8'), 'ready\n');
        return { text: 'Read only', inputTokens: 1, outputTokens: 1, durationMs: 1 };
      },
    });
    assert.equal(runs, 2);
    assert.equal(result.summary.baseline.passRate, 1);
    assert.equal(result.summary.candidate.passRate, 1);
  } finally {
    removeDir(temp);
  }
});

test('static evaluation validation detects missing fixture and oracle resources', () => {
  const root = makeTempDir('eval-resource-validation-');
  try {
    const directory = resolve(root, 'evals', 'skills', 'code-review');
    mkdirSync(directory, { recursive: true });
    const suitePath = resolve(directory, 'evals.json');
    writeFileSync(suitePath, JSON.stringify({
      schemaVersion: 2,
      name: 'resource-proof',
      skill: 'code-review',
      cases: [{
        id: 'resources',
        prompt: 'Review.',
        fixture: 'fixtures/project',
        setup: { path: 'prepare.mjs' },
        assertions: [{ id: 'oracle', type: 'command', path: 'oracle.mjs' }],
        humanReview: [],
      }],
    }));
    const missing = validateEvaluationFiles({ root });
    assert.match(missing.errors.join('\n'), /fixtures\/project/);
    assert.match(missing.errors.join('\n'), /prepare\.mjs/);
    assert.match(missing.errors.join('\n'), /oracle\.mjs/);
    mkdirSync(resolve(directory, 'fixtures', 'project'), { recursive: true });
    writeFileSync(resolve(directory, 'prepare.mjs'), 'throw new Error("must not execute during validation");\n');
    writeFileSync(resolve(directory, 'oracle.mjs'), 'throw new Error("must not execute during validation");\n');
    assert.deepEqual(validateEvaluationFiles({ root }).errors, []);
  } finally {
    removeDir(root);
  }
});

test('outcome artifacts cannot omit adapter identity or use legacy result versions', async () => {
  const result = await runEvaluationSuite({
    suite: {
      schemaVersion: 2,
      name: 'outcome-identity',
      skill: 'code-review',
      cases: [{
        id: 'identity',
        prompt: 'Remain read-only.',
        assertions: [{ id: 'absent', type: 'fileAbsent', path: 'unexpected.txt' }],
        humanReview: [],
      }],
    },
    skillContent: '# Review',
    execute: async () => ({ text: 'Read only', inputTokens: 0, outputTokens: 0, durationMs: 1 }),
  });
  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/eval-result.schema.json'), 'utf8'));
  const missingIdentity = structuredClone(result);
  delete missingIdentity.adapter;
  assert.match(validateEvaluationResult(schema, missingIdentity).join('\n'), /adapter/);
  const mislabeledLegacy = structuredClone(result);
  mislabeledLegacy.schemaVersion = 2;
  assert.match(validateEvaluationResult(schema, mislabeledLegacy).join('\n'), /schemaVersion 3/);
});

async function runCommittedCase(skill, caseId, execute) {
  const temp = makeTempDir('eval-committed-case-');
  try {
    const suiteDirectory = resolve(REPO_ROOT, 'evals', 'skills', skill);
    const suite = JSON.parse(readFileSync(resolve(suiteDirectory, 'evals.json'), 'utf8'));
    suite.cases = suite.cases.filter((entry) => entry.id === caseId);
    assert.equal(suite.cases.length, 1, `Missing case ${skill}/${caseId}`);
    return await runEvaluationSuite({
      suite, suiteDirectory, execute,
      skillContent: '# Fixture-only oracle exercise',
      tempRoot: resolve(temp, 'runs'),
    });
  } finally {
    removeDir(temp);
  }
}

test('all catalog execution fixtures run without a model and keep human judgments pending', { timeout: 60_000 }, async () => {
  const root = resolve(REPO_ROOT, 'evals', 'skills');
  const resultSchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/eval-result.schema.json'), 'utf8'));
  const commandResults = {};
  for (const skill of readdirSync(root).sort()) {
    const suiteDirectory = resolve(root, skill);
    const suite = JSON.parse(readFileSync(resolve(suiteDirectory, 'evals.json'), 'utf8'));
    const groundedCases = suite.cases.filter((entry) => entry.fixture || entry.setup);
    assert.ok(groundedCases.length > 0, `${skill} needs an executable fixture, not response-only coverage.`);
    const temp = makeTempDir(`eval-catalog-${skill}-`);
    try {
      const result = await runEvaluationSuite({
        suite: { ...suite, cases: groundedCases },
        suiteDirectory,
        skillContent: '# Fixture smoke; no model executed',
        tempRoot: resolve(temp, 'runs'),
        execute: async ({ workspace }) => {
          assert.ok(existsSync(resolve(workspace, 'project')), `${skill} fixture was not prepared.`);
          return { text: 'Fixture smoke only.', inputTokens: 0, outputTokens: 0, durationMs: 0 };
        },
      });
      assert.deepEqual(validateEvaluationResult(resultSchema, result), [], skill);
      assert.ok(result.cases.every((entry) => entry.humanReview.every((review) => review.status === 'pending')));
      for (const entry of result.cases) {
        for (const assertion of entry.candidate.assertions) {
          if (assertion.type === 'command') commandResults[assertion.id] = assertion.passed;
        }
      }
    } finally {
      removeDir(temp);
    }
  }
  assert.deepEqual(commandResults, {
    'no-second-commit-or-index-loss': true,
    'public-behavior': false,
    'sensitive-test': false,
  });
});

test('typed API oracle rejects empty or early-exit implementations and accepts public behavior', { timeout: 15_000 }, async () => {
  for (const [source, expected] of [
    ['export {};', false],
    ['process.exit(0);', false],
    [
      "export function parseLimit(input: string): number {\n"
        + "  if (!/^\\d+$/.test(input)) throw new Error('Invalid limit');\n"
        + '  return Number(input);\n}\n',
      true,
    ],
  ]) {
    const result = await runCommittedCase('test-driven-development', 'new-typed-public-api', async ({ variant, workspace }) => {
      if (variant === 'candidate') writeFileSync(resolve(workspace, 'project/src/limit.ts'), source);
      return { text: 'Fixture control.', inputTokens: 0, outputTokens: 0, durationMs: 0 };
    });
    assert.equal(result.cases[0].baseline.assertions[0].passed, false);
    assert.equal(result.cases[0].candidate.assertions[0].passed, expected);
  }
});

test('reset oracle proves a real counter assertion is sensitive while the original test is not', { timeout: 10_000 }, async () => {
  const result = await runCommittedCase('verification-discipline', 'green-mutation-is-not-proof', async ({ variant, workspace }) => {
    if (variant === 'candidate') {
      writeFileSync(resolve(workspace, 'project/reset.test.mjs'), [
        "import { test } from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { counters, reset } from './reset.mjs';",
        "test('reset clears real counters', () => {",
        '  counters.hits = 7;',
        '  reset();',
        '  assert.equal(counters.hits, 0);',
        '});',
      ].join('\n'));
    }
    return { text: 'Fixture control.', inputTokens: 0, outputTokens: 0, durationMs: 0 };
  });
  assert.deepEqual(result.cases[0].baseline.assertions.slice(0, 2).map((entry) => entry.passed), [true, false]);
  assert.deepEqual(result.cases[0].candidate.assertions.slice(0, 2).map((entry) => entry.passed), [true, true]);
});

test('reset oracle accepts added counter regressions without deleting existing coverage', { timeout: 15_000 }, async () => {
  for (const count of [1, 2]) {
    const result = await runCommittedCase('verification-discipline', 'green-mutation-is-not-proof', async ({ variant, workspace }) => {
      if (variant === 'candidate') {
        const path = resolve(workspace, 'project/reset.test.mjs');
        const existing = readFileSync(path, 'utf8');
        const regressions = Array.from({ length: count }, (_, index) => [
          `test('reset clears real counters ${index}', () => {`,
          '  counters.hits = 7;',
          '  reset();',
          '  assert.equal(counters.hits, 0);',
          '});',
        ].join('\n'));
        writeFileSync(path, `${existing}\nimport { counters } from './reset.mjs';\n${regressions.join('\n')}\n`);
      }
      return { text: 'Fixture control.', inputTokens: 0, outputTokens: 0, durationMs: 0 };
    });
    assert.equal(result.cases[0].baseline.assertions[1].passed, false);
    assert.equal(result.cases[0].candidate.assertions[1].passed, true,
      `${count} real counter regressions should pass alongside the existing return-value test.`);
  }
});

test('shared-index oracle detects a second commit containing another owners staging', { timeout: 10_000 }, async () => {
  const result = await runCommittedCase('git-and-pr-workflow', 'second-commit-rechecks-shared-index', async ({ variant, workspace }) => {
    if (variant === 'candidate') {
      const committed = spawnSync('git', [
        '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
        'commit', '--quiet', '-m', 'Incorrect second commit',
      ], { cwd: resolve(workspace, 'project'), encoding: 'utf8', timeout: 2000 });
      assert.equal(committed.status, 0, committed.stderr);
    }
    return { text: 'Fixture control.', inputTokens: 0, outputTokens: 0, durationMs: 0 };
  });
  assert.equal(result.cases[0].baseline.assertions[2].passed, true);
  assert.equal(result.cases[0].candidate.assertions[2].passed, false);
});

test('shared-index case rejects an unauthorized amend even when count and staged work are preserved', { timeout: 10_000 }, async () => {
  const result = await runCommittedCase('git-and-pr-workflow', 'second-commit-rechecks-shared-index', async ({ variant, workspace }) => {
    if (variant === 'candidate') {
      const amended = spawnSync('git', [
        '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
        'commit', '--quiet', '--amend', '--only', '--no-edit', '--', 'docs/setup.md',
      ], { cwd: resolve(workspace, 'project'), encoding: 'utf8', timeout: 2000 });
      assert.equal(amended.status, 0, amended.stderr);
    }
    return { text: 'Fixture control.', inputTokens: 0, outputTokens: 0, durationMs: 0 };
  });
  assert.ok(result.cases[0].baseline.assertions.every((entry) => entry.passed));
  assert.equal(result.cases[0].candidate.assertions[2].passed, true);
  assert.ok(result.cases[0].candidate.assertions.some((entry) => !entry.passed),
    'Rewriting existing history must not pass merely because count and staged paths match.');
});
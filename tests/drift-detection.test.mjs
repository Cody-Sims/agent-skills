import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  detectDrift,
  detectDriftFromFiles,
} from '../scripts/lib/drift-detection.mjs';
import { validateAgainstSchema } from '../scripts/lib/jsonschema.mjs';
import { makeTempDir, removeDir, REPO_ROOT } from './helpers.mjs';

const FIXTURES = resolve(REPO_ROOT, 'tests/fixtures/drift');
const RUNNER = resolve(REPO_ROOT, 'scripts/detect-drift.mjs');
const SCHEMA = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/drift-report.schema.json'), 'utf8'));

function read(name) {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8'));
}

function artifacts(overrides = {}) {
  return {
    asOf: '2026-07-27',
    baselineBehavior: read('behavior-baseline.json'),
    currentBehavior: read('behavior-current.json'),
    baselineRouting: read('routing-baseline.json'),
    currentRouting: read('routing-current.json'),
    baselineRuntime: read('runtime-baseline.json'),
    currentRuntime: read('runtime-current.json'),
    lifecycle: read('lifecycle-overdue.json'),
    ...overrides,
  };
}

function fileOptions(overrides = {}) {
  return {
    asOf: '2026-07-27',
    baselineBehavior: resolve(FIXTURES, 'behavior-baseline.json'),
    currentBehavior: resolve(FIXTURES, 'behavior-current.json'),
    baselineRouting: resolve(FIXTURES, 'routing-baseline.json'),
    currentRouting: resolve(FIXTURES, 'routing-current.json'),
    baselineRuntime: resolve(FIXTURES, 'runtime-baseline.json'),
    currentRuntime: resolve(FIXTURES, 'runtime-current.json'),
    lifecycle: resolve(FIXTURES, 'lifecycle-overdue.json'),
    ...overrides,
  };
}

test('detects quality, routing, cost, compatibility, and source-staleness regressions', () => {
  const report = detectDrift(artifacts());
  assert.deepEqual(new Set(report.findings.map(({ type }) => type)), new Set([
    'quality',
    'routing',
    'cost',
    'runtime-compatibility',
    'source-staleness',
  ]));
  assert.deepEqual(
    report.findings.filter(({ type }) => type === 'routing').map(({ metric }) => metric),
    ['collision-rate', 'precision', 'recall'],
  );
  assert.ok(report.findings.some(({ type, metric, source }) =>
    type === 'cost' && metric === 'token-total' && source === 'behavior'));
  assert.ok(report.findings.some(({ type, metric, source }) =>
    type === 'cost' && metric === 'duration-ms' && source === 'routing'));
  assert.equal(report.proposal.title, `Correct ${report.findings.length} detected drift regressions`);
  assert.match(report.proposal.body, new RegExp(report.fingerprint));
  assert.deepEqual(validateAgainstSchema(SCHEMA, report), []);
});

test('rejects unlike suite, skill, adapter, and model identities', () => {
  for (const mutate of [
    (input) => { input.currentBehavior.suite = 'other-suite'; },
    (input) => { input.currentBehavior.skill = 'other-skill'; },
    (input) => { input.currentRuntime.runtimes[0].adapter.id = 'other-adapter'; },
    (input) => {
      input.baselineRouting.model = { id: 'model-a' };
      input.currentRouting.model = { id: 'model-b' };
    },
  ]) {
    const input = structuredClone(artifacts());
    mutate(input);
    assert.throws(() => detectDrift(input), /identity mismatch/i);
  }
});

test('rejects artifacts without explicit comparable execution identity', () => {
  const input = structuredClone(artifacts());
  delete input.baselineBehavior.adapter;
  delete input.currentBehavior.adapter;
  assert.throws(() => detectDrift(input), /Behavior.*adapter.*required/i);

  const routing = structuredClone(artifacts());
  delete routing.baselineRouting.adapter;
  delete routing.currentRouting.adapter;
  assert.throws(() => detectDrift(routing), /Routing.*adapter.*required/i);
});

test('rejects malformed and impossible explicit dates', () => {
  for (const asOf of ['2026-7-27', '2026-02-30', 'tomorrow']) {
    assert.throws(() => detectDrift(artifacts({ asOf })), /valid calendar date.*YYYY-MM-DD/i);
  }
  const futureReview = artifacts({ lifecycle: read('lifecycle-fresh.json') });
  futureReview.lifecycle.skills['verification-before-completion'].lastReviewedAt = '2026-08-01';
  assert.throws(() => detectDrift(futureReview), /lastReviewedAt.*after.*as-of/i);
});

test('uses stable semantic deduplication independent of timestamps and input hashes', () => {
  const first = detectDrift(artifacts());
  const changed = structuredClone(artifacts());
  changed.currentBehavior.generatedAt = '2030-01-01T00:00:00.000Z';
  changed.inputHashes = Object.fromEntries(
    Object.keys(first.inputs).map((key) => [key, '9'.repeat(64)]),
  );
  const second = detectDrift(changed);
  assert.equal(second.fingerprint, first.fingerprint);
  assert.notDeepEqual(second.inputs, first.inputs);

  const reordered = structuredClone(artifacts());
  reordered.baselineRuntime.runtimes.reverse();
  reordered.currentRuntime.runtimes.reverse();
  const third = detectDrift(reordered);
  assert.equal(third.fingerprint, first.fingerprint);
  assert.deepEqual(third.findings, first.findings);
});

test('sanitizes reports and retains only hashes, typed evidence, and proposal text', () => {
  const report = detectDrift(artifacts());
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /RAW-PROMPT-MUST-NOT-SURVIVE/);
  assert.doesNotMatch(serialized, /RAW-OUTPUT-MUST-NOT-SURVIVE/);
  assert.doesNotMatch(serialized, /example\/source/);
  assert.deepEqual(Object.keys(report).sort(), [
    'asOf', 'findings', 'fingerprint', 'inputs', 'proposal', 'schemaVersion',
  ]);
  assert.ok(Object.values(report.inputs).every(({ sha256 }) => /^[0-9a-f]{64}$/.test(sha256)));
});

test('emits an empty, schema-valid report when comparable metrics do not regress', () => {
  const baselineBehavior = read('behavior-baseline.json');
  const baselineRouting = read('routing-baseline.json');
  const baselineRuntime = read('runtime-baseline.json');
  const report = detectDrift(artifacts({
    currentBehavior: structuredClone(baselineBehavior),
    currentRouting: structuredClone(baselineRouting),
    currentRuntime: structuredClone(baselineRuntime),
    lifecycle: read('lifecycle-fresh.json'),
  }));
  assert.deepEqual(report.findings, []);
  assert.equal(report.proposal, null);
  assert.deepEqual(validateAgainstSchema(SCHEMA, report), []);
});

test('file API records exact SHA-256 inputs and CLI writes the same strict report', () => {
  const expected = detectDriftFromFiles(fileOptions());
  assert.deepEqual(validateAgainstSchema(SCHEMA, expected), []);

  const temp = makeTempDir('drift-cli-');
  try {
    const out = resolve(temp, 'report.json');
    const args = Object.entries(fileOptions()).flatMap(([key, value]) => {
      const flags = {
        asOf: '--as-of',
        baselineBehavior: '--baseline-behavior',
        currentBehavior: '--current-behavior',
        baselineRouting: '--baseline-routing',
        currentRouting: '--current-routing',
        baselineRuntime: '--baseline-runtime',
        currentRuntime: '--current-runtime',
        lifecycle: '--lifecycle',
      };
      return [flags[key], value];
    });
    const execution = spawnSync(process.execPath, [RUNNER, ...args, '--out', out], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(existsSync(out), true);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), expected);
    assert.match(execution.stdout, /Detected \d+ drift regressions/);
  } finally {
    removeDir(temp);
  }
});

test('CLI help is concise and identity failures never write a report', () => {
  const help = spawnSync(process.execPath, [RUNNER, '--help'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--baseline-behavior <path>/);
  assert.match(help.stdout, /--as-of <YYYY-MM-DD>/);
  assert.ok(help.stdout.split('\n').length <= 18);

  const temp = makeTempDir('drift-mismatch-');
  try {
    const out = resolve(temp, 'report.json');
    const execution = spawnSync(process.execPath, [
      RUNNER,
      '--baseline-behavior', resolve(FIXTURES, 'behavior-baseline.json'),
      '--current-behavior', resolve(FIXTURES, 'routing-current.json'),
      '--baseline-routing', resolve(FIXTURES, 'routing-baseline.json'),
      '--current-routing', resolve(FIXTURES, 'routing-current.json'),
      '--baseline-runtime', resolve(FIXTURES, 'runtime-baseline.json'),
      '--current-runtime', resolve(FIXTURES, 'runtime-current.json'),
      '--lifecycle', resolve(FIXTURES, 'lifecycle-overdue.json'),
      '--as-of', '2026-07-27',
      '--out', out,
    ], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /identity mismatch|missing required/i);
    assert.equal(existsSync(out), false);
  } finally {
    removeDir(temp);
  }
});

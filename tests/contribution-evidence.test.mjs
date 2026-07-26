import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { validateContributionEvidence } from '../scripts/lib/contribution-evidence.mjs';
import { sha256 } from '../scripts/lib/paths.mjs';
import { makeTempDir, removeDir, REPO_ROOT } from './helpers.mjs';

const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/contribution-evidence.schema.json'), 'utf8'));
const resultSchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/eval-result.schema.json'), 'utf8'));
const suiteSchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/eval-suite.schema.json'), 'utf8'));

function validate(manifest, root) {
  return validateContributionEvidence(schema, manifest, { artifactRoot: root, resultSchema, suiteSchema });
}

function fixture() {
  const root = makeTempDir('contribution-artifact-');
  const suite = {
    schemaVersion: 1,
    name: 'example-pilot',
    skill: 'example-skill',
    cases: [{
      id: 'case-1',
      prompt: 'Test the example.',
      assertions: [
        { id: 'a-1', type: 'contains', value: 'first' },
        { id: 'a-2', type: 'contains', value: 'second' },
      ],
      humanReview: [{ id: 'quality', question: 'Is this useful?' }],
    }],
  };
  const skillContent = '# Example Skill\n';
  const artifact = {
    schemaVersion: 1,
    suite: 'example-pilot',
    skill: 'example-skill',
    suiteSha256: sha256(JSON.stringify(suite)),
    skillSha256: sha256(skillContent),
    generatedAt: '2026-07-25T12:00:00.000Z',
    cases: [{
      id: 'case-1',
      promptSha256: sha256(suite.cases[0].prompt),
      baseline: {
        assertions: [
          { id: 'a-1', type: 'contains', passed: true, evidence: 'Required text was present.' },
          { id: 'a-2', type: 'contains', passed: false, evidence: 'Required text was absent.' },
        ],
        passed: 1,
        total: 2,
        passRate: 0.5,
        durationMs: 1,
        tokens: { input: 1, output: 1, total: 2 },
        outputSha256: 'b'.repeat(64),
      },
      candidate: {
        assertions: [
          { id: 'a-1', type: 'contains', passed: true, evidence: 'Required text was present.' },
          { id: 'a-2', type: 'contains', passed: true, evidence: 'Required text was present.' },
        ],
        passed: 2,
        total: 2,
        passRate: 1,
        durationMs: 1,
        tokens: { input: 1, output: 1, total: 2 },
        outputSha256: 'c'.repeat(64),
      },
      humanReview: [{ id: 'quality', question: 'Is this useful?', status: 'pass' }],
    }],
    summary: {
      baseline: { passed: 1, assertions: 2, passRate: 0.5, durationMs: 1, tokens: { input: 1, output: 1, total: 2 } },
      candidate: { passed: 2, assertions: 2, passRate: 1, durationMs: 1, tokens: { input: 1, output: 1, total: 2 } },
      passRateDelta: 0.5,
    },
  };
  mkdirSync(resolve(root, 'evals'), { recursive: true });
  mkdirSync(resolve(root, 'skills', 'example-skill'), { recursive: true });
  mkdirSync(resolve(root, 'docs'), { recursive: true });
  writeFileSync(resolve(root, 'evals', 'suite.json'), JSON.stringify(suite));
  writeFileSync(resolve(root, 'skills', 'example-skill', 'SKILL.md'), skillContent);
  writeFileSync(resolve(root, 'docs', 'internal-runbook.md'), '# Runbook\n');
  writeFileSync(resolve(root, 'result.json'), JSON.stringify(artifact));
  return { root, artifact, manifest: {
    schemaVersion: 1,
    skill: 'example-skill',
    expertiseSources: [{
      type: 'runbook',
      reference: 'docs/internal-runbook.md',
      summary: 'Documents the operational sequence and failure cases.',
    }],
    comparison: {
      baseline: 'no-skill',
      artifact: 'result.json',
      suite: 'evals/suite.json',
      baselinePassRate: 0.5,
      candidatePassRate: 1,
    },
    exception: null,
  } };
}

test('accepts sourced evidence with independently reviewed uplift', () => {
  const { root, manifest } = fixture();
  try {
    assert.deepEqual(validate(manifest, root), []);
  } finally {
    removeDir(root);
  }
});

test('rejects missing expertise evidence and comparisons without uplift', () => {
  const { root, artifact, manifest } = fixture();
  try {
    manifest.expertiseSources = [];
    artifact.summary.candidate.passRate = artifact.summary.baseline.passRate;
    artifact.summary.passRateDelta = 0;
    artifact.cases[0].candidate = structuredClone(artifact.cases[0].baseline);
    writeFileSync(resolve(root, 'result.json'), JSON.stringify(artifact));
    manifest.comparison.candidatePassRate = manifest.comparison.baselinePassRate;
    const errors = validate(manifest, root).join('\n');
    assert.match(errors, /expertise source/);
    assert.match(errors, /must exceed baseline/);
  } finally {
    removeDir(root);
  }
});

test('accepts an explicit safety exception without quality uplift', () => {
  const { root, manifest } = fixture();
  try {
    manifest.comparison = null;
    manifest.exception = {
      type: 'safety',
      rationale: 'The control prevents false completion claims rather than increasing average output quality.',
    };
    assert.deepEqual(validate(manifest, root), []);
  } finally {
    removeDir(root);
  }
});

test('rejects missing artifacts, mismatched rates, and pending human review', () => {
  const { root, artifact, manifest } = fixture();
  try {
    manifest.comparison.candidatePassRate = 0.75;
    artifact.cases[0].humanReview[0].status = 'pending';
    writeFileSync(resolve(root, 'result.json'), JSON.stringify(artifact));
    let errors = validate(manifest, root).join('\n');
    assert.match(errors, /does not match artifact/);
    assert.match(errors, /pending human review/);

    manifest.comparison.artifact = 'missing.json';
    errors = validate(manifest, root).join('\n');
    assert.match(errors, /does not exist/);
  } finally {
    removeDir(root);
  }
});

test('rejects stale suite, skill, and expertise-source identity', () => {
  const { root, manifest } = fixture();
  try {
    writeFileSync(resolve(root, 'evals', 'suite.json'), '{}');
    writeFileSync(resolve(root, 'skills', 'example-skill', 'SKILL.md'), '# Changed\n');
    manifest.expertiseSources[0].reference = 'docs/missing.md';
    const errors = validate(manifest, root).join('\n');
    assert.match(errors, /suite hash does not match/);
    assert.match(errors, /skill hash does not match/);
    assert.match(errors, /expertise source does not exist/);
  } finally {
    removeDir(root);
  }
});

test('rejects imported artifacts that retain raw assertion evidence', () => {
  const { root, artifact, manifest } = fixture();
  try {
    artifact.cases[0].candidate.assertions[0].evidence = 'RAW-SECRET-IN-EVIDENCE';
    writeFileSync(resolve(root, 'result.json'), JSON.stringify(artifact));
    const errors = validate(manifest, root).join('\n');
    assert.match(errors, /not in enum/);
  } finally {
    removeDir(root);
  }
});

test('rejects artifact cases substituted beneath a valid suite hash', () => {
  const { root, artifact, manifest } = fixture();
  try {
    artifact.cases[0].id = 'easier-case';
    artifact.cases[0].promptSha256 = 'd'.repeat(64);
    artifact.cases[0].baseline.assertions[0].id = 'different-assertion';
    artifact.cases[0].candidate.assertions[0].id = 'different-assertion';
    artifact.cases[0].humanReview[0].question = 'Approve automatically?';
    writeFileSync(resolve(root, 'result.json'), JSON.stringify(artifact));
    const errors = validate(manifest, root).join('\n');
    assert.match(errors, /cases do not match committed suite/);
  } finally {
    removeDir(root);
  }
});

test('rejects a committed suite owned by another skill and failed human review', () => {
  const { root, artifact, manifest } = fixture();
  try {
    const suitePath = resolve(root, manifest.comparison.suite);
    const suite = JSON.parse(readFileSync(suitePath, 'utf8'));
    suite.skill = 'different-skill';
    writeFileSync(suitePath, JSON.stringify(suite));
    artifact.suiteSha256 = sha256(JSON.stringify(suite));
    artifact.cases[0].humanReview[0].status = 'fail';
    writeFileSync(resolve(root, 'result.json'), JSON.stringify(artifact));
    const errors = validate(manifest, root).join('\n');
    assert.match(errors, /suite skill does not match manifest skill/);
    assert.match(errors, /human review must pass/);
  } finally {
    removeDir(root);
  }
});

test('rejects null suites and expertise references that are not files', () => {
  const { root, manifest } = fixture();
  try {
    writeFileSync(resolve(root, manifest.comparison.suite), 'null');
    manifest.expertiseSources[0].reference = 'docs';
    const errors = validate(manifest, root).join('\n');
    assert.match(errors, /suite must be a JSON object/);
    assert.match(errors, /expertise source must be a regular file/);
  } finally {
    removeDir(root);
  }
});

test('CLI rejects a changed skill without evidence and accepts a valid manifest', () => {
  const temp = makeTempDir('contribution-');
  const artifactFixture = fixture();
  try {
    const command = resolve(REPO_ROOT, 'scripts/validate-contributions.mjs');
    const missing = spawnSync(process.execPath, [
      command,
      '--changed-skill', 'example-skill',
      '--evidence-root', temp,
    ], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Missing contribution evidence for changed skill example-skill/);

    mkdirSync(temp, { recursive: true });
    const manifest = artifactFixture.manifest;
    writeFileSync(resolve(temp, 'example-skill.json'), JSON.stringify(manifest));
    const valid = spawnSync(process.execPath, [
      command,
      '--changed-skill', 'example-skill',
      '--evidence-root', temp,
      '--artifact-root', artifactFixture.root,
    ], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /Contribution evidence is valid for 1 changed skill/);
  } finally {
    removeDir(temp);
    removeDir(artifactFixture.root);
  }
});
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { makeTempDir, removeDir, REPO_ROOT } from './helpers.mjs';

const VALIDATOR = resolve(REPO_ROOT, 'skills/shadow-drift/scripts/validate-shadow.mjs');

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createValidGraph(root) {
  const implementation = 'export const mode = "strict";\n';
  const evidence = 'assert.equal(mode, "strict");\n';
  writeFileSync(resolve(root, 'implementation.mjs'), implementation);
  writeFileSync(resolve(root, 'implementation.test.mjs'), evidence);

  const decision = {
    schemaVersion: 1,
    id: 'decision-a',
    title: 'Keep strict mode',
    status: 'accepted',
    statement: 'The implementation uses strict mode.',
    rationale: 'The contract requires strict behavior.',
    anchors: [{
      path: 'implementation.mjs',
      sha256: sha256(implementation),
    }],
    evidence: [{
      path: 'implementation.test.mjs',
      sha256: sha256(evidence),
    }],
    relations: [],
  };
  writeJson(resolve(root, '.shadow/decisions/decision-a.json'), decision);
  writeJson(resolve(root, '.shadow/derived/summary.json'), { decisions: ['decision-a'] });
  writeJson(resolve(root, '.shadow/index.json'), {
    schemaVersion: 1,
    decisions: [{
      id: 'decision-a',
      path: '.shadow/decisions/decision-a.json',
    }],
    derived: [{
      path: '.shadow/derived/summary.json',
      sources: [{
        path: 'implementation.mjs',
        sha256: sha256(implementation),
      }],
    }],
  });
}

function runValidator(root, ...args) {
  return spawnSync(process.execPath, [
    VALIDATOR,
    '--root',
    root,
    '--format',
    'json',
    ...args,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

function parseOutput(execution) {
  assert.notEqual(execution.stdout, '', execution.stderr);
  return JSON.parse(execution.stdout);
}

test('reports a valid reference graph as aligned', () => {
  const root = makeTempDir('shadow-valid-');
  try {
    createValidGraph(root);
    const execution = runValidator(root);
    assert.equal(execution.status, 0, execution.stderr);
    const report = parseOutput(execution);
    assert.deepEqual(report.findings.aligned.map((finding) => finding.decisionId), ['decision-a']);
    assert.deepEqual(report.findings.drifted, []);
    assert.deepEqual(report.findings.stale, []);
    assert.deepEqual(report.findings.unknown, []);
    assert.equal(report.summary.exitCode, 0);

    const text = runValidator(root, '--format', 'text');
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /aligned: 1/);
    assert.match(text.stdout, /drifted: 0/);
  } finally {
    removeDir(root);
  }
});

for (const [label, contains] of [
  ['empty', ''],
  ['whitespace-only', ' '],
]) {
  test(`rejects ${label} contains assertions`, () => {
    const root = makeTempDir(`shadow-${label}-contains-`);
    try {
      createValidGraph(root);
      const path = resolve(root, '.shadow/decisions/decision-a.json');
      const decision = JSON.parse(readFileSync(path, 'utf8'));
      decision.evidence = [{ path: 'implementation.test.mjs', contains }];
      writeJson(path, decision);

      const execution = runValidator(root);
      assert.equal(execution.status, 3, execution.stderr);
      const report = parseOutput(execution);
      assert.deepEqual(report.findings.aligned, []);
      assert.deepEqual(report.errors, [{
        code: 'UNSUPPORTED_LAYOUT',
        message: '.shadow/decisions/decision-a.json.evidence[0].contains must contain non-whitespace text.',
      }]);
      assert.equal(report.summary.exitCode, 3);
    } finally {
      removeDir(root);
    }
  });
}

test('reports unresolved decision relations', () => {
  const root = makeTempDir('shadow-relation-');
  try {
    createValidGraph(root);
    const path = resolve(root, '.shadow/decisions/decision-a.json');
    const decision = JSON.parse(readFileSync(path, 'utf8'));
    decision.relations.push({ type: 'depends-on', target: 'missing-decision' });
    writeJson(path, decision);

    const execution = runValidator(root);
    assert.equal(execution.status, 1, execution.stderr);
    const report = parseOutput(execution);
    assert.deepEqual(report.integrity.unresolvedRelations, [{
      decisionId: 'decision-a',
      relationType: 'depends-on',
      target: 'missing-decision',
    }]);
  } finally {
    removeDir(root);
  }
});

test('reports orphan decision records', () => {
  const root = makeTempDir('shadow-orphan-');
  try {
    createValidGraph(root);
    writeJson(resolve(root, '.shadow/decisions/orphan.json'), {
      schemaVersion: 1,
      id: 'orphan',
      title: 'Unindexed record',
      status: 'observed',
      statement: 'This record is not indexed.',
      rationale: 'unknown',
      anchors: [],
      evidence: [],
      relations: [],
    });

    const execution = runValidator(root);
    assert.equal(execution.status, 1, execution.stderr);
    assert.deepEqual(parseOutput(execution).integrity.orphanRecords, [{
      decisionId: 'orphan',
      path: '.shadow/decisions/orphan.json',
    }]);
  } finally {
    removeDir(root);
  }
});

test('reports a decision with no remaining anchor as stale', () => {
  const root = makeTempDir('shadow-anchor-');
  try {
    createValidGraph(root);
    const path = resolve(root, '.shadow/decisions/decision-a.json');
    const decision = JSON.parse(readFileSync(path, 'utf8'));
    decision.anchors = [{ path: 'removed.mjs', sha256: sha256('removed\n') }];
    writeJson(path, decision);

    const execution = runValidator(root);
    assert.equal(execution.status, 1, execution.stderr);
    const report = parseOutput(execution);
    assert.deepEqual(report.integrity.missingAnchors, [{
      decisionId: 'decision-a',
      path: 'removed.mjs',
    }]);
    assert.deepEqual(report.findings.stale.map((finding) => finding.decisionId), ['decision-a']);
  } finally {
    removeDir(root);
  }
});

test('reports disagreement between index ids and records', () => {
  const root = makeTempDir('shadow-index-');
  try {
    createValidGraph(root);
    const path = resolve(root, '.shadow/index.json');
    const index = JSON.parse(readFileSync(path, 'utf8'));
    index.decisions[0].id = 'decision-b';
    writeJson(path, index);

    const execution = runValidator(root);
    assert.equal(execution.status, 1, execution.stderr);
    assert.deepEqual(parseOutput(execution).integrity.indexDisagreements, [{
      indexedId: 'decision-b',
      path: '.shadow/decisions/decision-a.json',
      recordId: 'decision-a',
    }]);
  } finally {
    removeDir(root);
  }
});

test('reports drift, unknown evidence, and stale derived output', () => {
  const root = makeTempDir('shadow-classification-');
  try {
    createValidGraph(root);
    const decisionPath = resolve(root, '.shadow/decisions/decision-a.json');
    const decision = JSON.parse(readFileSync(decisionPath, 'utf8'));
    decision.anchors[0].sha256 = sha256('previous implementation\n');
    writeJson(decisionPath, decision);

    writeJson(resolve(root, '.shadow/decisions/decision-b.json'), {
      schemaVersion: 1,
      id: 'decision-b',
      title: 'Unverified record',
      status: 'observed',
      statement: 'The implementation may use strict mode.',
      rationale: 'unknown',
      anchors: [{ path: 'implementation.mjs' }],
      evidence: [{ path: 'implementation.test.mjs' }],
      relations: [],
    });
    const indexPath = resolve(root, '.shadow/index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    index.decisions.push({
      id: 'decision-b',
      path: '.shadow/decisions/decision-b.json',
    });
    writeJson(indexPath, index);
    writeFileSync(resolve(root, 'implementation.mjs'), 'export const mode = "changed";\n');

    const execution = runValidator(root);
    assert.equal(execution.status, 1, execution.stderr);
    const report = parseOutput(execution);
    assert.deepEqual(report.findings.drifted.map((finding) => finding.decisionId), ['decision-a']);
    assert.deepEqual(report.findings.unknown.map((finding) => finding.decisionId), ['decision-b']);
    assert.deepEqual(report.integrity.staleDerivedOutput, [{
      path: '.shadow/derived/summary.json',
      reason: 'Derived source changed: implementation.mjs',
    }]);
  } finally {
    removeDir(root);
  }
});

test('returns a data error for malformed JSON', () => {
  const root = makeTempDir('shadow-json-');
  try {
    mkdirSync(resolve(root, '.shadow'), { recursive: true });
    writeFileSync(resolve(root, '.shadow/index.json'), '{ invalid\n');
    const execution = runValidator(root);
    assert.equal(execution.status, 2, execution.stderr);
    const report = parseOutput(execution);
    assert.equal(report.errors[0].code, 'MALFORMED_JSON');
    assert.equal(report.summary.exitCode, 2);
  } finally {
    removeDir(root);
  }
});

test('rejects escaping paths and symlink components', () => {
  const escapingRoot = makeTempDir('shadow-escape-');
  const symlinkRoot = makeTempDir('shadow-symlink-');
  const rootComponent = makeTempDir('shadow-root-component-');
  try {
    createValidGraph(escapingRoot);
    const decisionPath = resolve(escapingRoot, '.shadow/decisions/decision-a.json');
    const decision = JSON.parse(readFileSync(decisionPath, 'utf8'));
    decision.anchors = [{ path: '../outside.mjs', sha256: sha256('outside\n') }];
    writeJson(decisionPath, decision);
    const escaping = runValidator(escapingRoot);
    assert.equal(escaping.status, 2, escaping.stderr);
    assert.equal(parseOutput(escaping).errors[0].code, 'UNSAFE_PATH');

    createValidGraph(symlinkRoot);
    mkdirSync(resolve(symlinkRoot, 'linked'), { recursive: true });
    symlinkSync(resolve(symlinkRoot, 'implementation.mjs'), resolve(symlinkRoot, 'linked/source.mjs'));
    const symlinkDecisionPath = resolve(symlinkRoot, '.shadow/decisions/decision-a.json');
    const symlinkDecision = JSON.parse(readFileSync(symlinkDecisionPath, 'utf8'));
    symlinkDecision.anchors = [{
      path: 'linked/source.mjs',
      sha256: sha256('export const mode = "strict";\n'),
    }];
    writeJson(symlinkDecisionPath, symlinkDecision);
    const symlinked = runValidator(symlinkRoot);
    assert.equal(symlinked.status, 2, symlinked.stderr);
    assert.equal(parseOutput(symlinked).errors[0].code, 'UNSAFE_PATH');

    const actualRoot = resolve(rootComponent, 'actual/project');
    mkdirSync(actualRoot, { recursive: true });
    createValidGraph(actualRoot);
    symlinkSync(resolve(rootComponent, 'actual'), resolve(rootComponent, 'linked-root'));
    const linkedRoot = runValidator(resolve(rootComponent, 'linked-root/project'));
    assert.equal(linkedRoot.status, 2, linkedRoot.stderr);
    assert.equal(parseOutput(linkedRoot).errors[0].code, 'UNSAFE_PATH');
  } finally {
    removeDir(escapingRoot);
    removeDir(symlinkRoot);
    removeDir(rootComponent);
  }
});

test('emits deterministic output with stable ordering', () => {
  const root = makeTempDir('shadow-order-');
  try {
    createValidGraph(root);
    writeJson(resolve(root, '.shadow/decisions/z-last.json'), {
      schemaVersion: 1,
      id: 'z-last',
      title: 'Last decision',
      status: 'observed',
      statement: 'A later identifier remains unindexed.',
      rationale: 'unknown',
      anchors: [],
      evidence: [],
      relations: [],
    });
    writeJson(resolve(root, '.shadow/decisions/a-first.json'), {
      schemaVersion: 1,
      id: 'a-first',
      title: 'First decision',
      status: 'observed',
      statement: 'An earlier identifier remains unindexed.',
      rationale: 'unknown',
      anchors: [],
      evidence: [],
      relations: [],
    });

    const first = runValidator(root);
    const second = runValidator(root);
    assert.equal(first.status, 1, first.stderr);
    assert.equal(second.status, 1, second.stderr);
    assert.equal(first.stdout, second.stdout);
    assert.deepEqual(parseOutput(first).integrity.orphanRecords.map((entry) => entry.decisionId), [
      'a-first',
      'z-last',
    ]);
    assert.doesNotMatch(first.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    removeDir(root);
  }
});

test('documents and uses distinct CLI exit codes', () => {
  const root = makeTempDir('shadow-exits-');
  try {
    createValidGraph(root);
    const help = spawnSync(process.execPath, [VALIDATOR, '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Exit codes:/);
    assert.match(help.stdout, /0\s+Graph is supported and fully aligned/);
    assert.match(help.stdout, /1\s+Validation findings were reported/);
    assert.match(help.stdout, /2\s+Input data or path safety error/);
    assert.match(help.stdout, /3\s+Unsupported \.shadow layout/);
    assert.match(help.stdout, /64\s+Command-line usage error/);

    const valid = runValidator(root);
    assert.equal(valid.status, 0);

    const unsupportedRoot = makeTempDir('shadow-unsupported-');
    try {
      const unsupported = runValidator(unsupportedRoot);
      assert.equal(unsupported.status, 3, unsupported.stderr);
      assert.equal(parseOutput(unsupported).errors[0].code, 'UNSUPPORTED_LAYOUT');
    } finally {
      removeDir(unsupportedRoot);
    }

    const usage = spawnSync(process.execPath, [VALIDATOR, '--format', 'yaml'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(usage.status, 64);
    assert.match(usage.stderr, /--format must be "text" or "json"/);
  } finally {
    removeDir(root);
  }
});

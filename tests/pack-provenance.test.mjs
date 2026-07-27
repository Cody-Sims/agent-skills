import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  computeMemberTreeDigest,
  validatePackSuite,
} from '../scripts/lib/pack-evaluations.mjs';
import {
  resolveHeadCommit,
  verifyExactPackCommit,
} from '../scripts/lib/pack-provenance.mjs';
import { makeTempDir, removeDir, REPO_ROOT } from './helpers.mjs';

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function repositoryFixture() {
  const root = makeTempDir('pack-provenance-');
  mkdirSync(resolve(root, 'skills/alpha/references'), { recursive: true });
  mkdirSync(resolve(root, 'skills/beta'), { recursive: true });
  mkdirSync(resolve(root, 'registry'), { recursive: true });
  mkdirSync(resolve(root, 'evals/packs'), { recursive: true });
  writeFileSync(resolve(root, 'skills/alpha/SKILL.md'), 'alpha\n');
  writeFileSync(resolve(root, 'skills/alpha/references/detail.md'), 'detail\n');
  writeFileSync(resolve(root, 'skills/beta/SKILL.md'), 'beta\n');
  const pack = {
    name: 'sample-pack',
    version: '1.0.0',
    skills: [
      { name: 'alpha', version: '1.0.0' },
      { name: 'beta', version: '1.0.0' },
    ],
    handoffs: [{ from: 'alpha', to: 'beta', when: 'Ready.' }],
  };
  const registry = {
    schemaVersion: 5,
    skills: [
      {
        name: 'alpha',
        version: '1.0.0',
        path: 'skills/alpha',
        skillFile: 'skills/alpha/SKILL.md',
        resources: ['references/detail.md'],
      },
      {
        name: 'beta',
        version: '1.0.0',
        path: 'skills/beta',
        skillFile: 'skills/beta/SKILL.md',
        resources: [],
      },
    ],
    packs: [pack],
  };
  const registryBytes = Buffer.from(`${JSON.stringify(registry)}\n`);
  writeFileSync(resolve(root, 'registry/skills.json'), registryBytes);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['add', 'skills', 'registry']);
  git(root, ['commit', '-qm', 'catalog']);
  const catalogCommit = resolveHeadCommit(root);
  const suitePath = 'evals/packs/sample-pack.json';
  const suiteBytes = Buffer.from('{"suite":"v1"}\n');
  writeFileSync(resolve(root, suitePath), suiteBytes);
  git(root, ['add', suitePath]);
  git(root, ['commit', '-qm', 'suite']);
  const suiteCommit = resolveHeadCommit(root);
  const memberTreeSha256 = computeMemberTreeDigest({ root, pack, registry });
  return {
    root,
    pack,
    registry,
    registryBytes,
    suitePath,
    suiteBytes,
    memberTreeSha256,
    catalogCommit,
    suiteCommit,
  };
}

test('exact provenance binds externally supplied commit, suite, registry, and member blobs', () => {
  const value = repositoryFixture();
  try {
    const verified = verifyExactPackCommit({
      ...value,
      sourceCommit: value.suiteCommit,
      allowAncestor: false,
    });
    assert.equal(verified.sourceCommit, value.suiteCommit);
    assert.equal(verified.memberTreeSha256, value.memberTreeSha256);
  } finally {
    removeDir(value.root);
  }
});

test('missing historical suite is a hard failure even for an allowed ancestor', () => {
  const value = repositoryFixture();
  try {
    assert.throws(() => verifyExactPackCommit({
      ...value,
      sourceCommit: value.catalogCommit,
      allowAncestor: true,
    }), /cannot reproduce.*suite|missing.*suite/i);
  } finally {
    removeDir(value.root);
  }
});

test('provenance rejects suite byte mismatch and same-length member substitution', () => {
  const value = repositoryFixture();
  try {
    assert.throws(() => verifyExactPackCommit({
      ...value,
      suiteBytes: Buffer.from('{"suite":"v2"}\n'),
      sourceCommit: value.suiteCommit,
      allowAncestor: false,
    }), /suite bytes/i);
    writeFileSync(resolve(value.root, 'skills/alpha/references/detail.md'), 'mutate\n');
    const changedDigest = computeMemberTreeDigest({
      root: value.root,
      pack: value.pack,
      registry: value.registry,
    });
    assert.notEqual(changedDigest, value.memberTreeSha256);
    assert.throws(() => verifyExactPackCommit({
      ...value,
      memberTreeSha256: changedDigest,
      sourceCommit: value.suiteCommit,
      allowAncestor: false,
    }), /member tree/i);
  } finally {
    removeDir(value.root);
  }
});

test('pack CLIs reject ambiguous or malformed provenance arguments', () => {
  for (const cli of ['validate-pack-evaluations.mjs', 'run-pack-evaluations.mjs']) {
    const runner = resolve(REPO_ROOT, 'scripts', cli);
    for (const args of [
      ['--structural', '--source-commit', 'a'.repeat(40)],
      ['--source-commit', 'short'],
      ['--structural', '--allow-ancestor'],
    ]) {
      const execution = spawnSync(process.execPath, [runner, ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      assert.equal(execution.status, 1);
      assert.match(execution.stderr, /mode|source-commit|allow-ancestor/i);
    }
  }
});

test('structural smoke labels artifacts non-provenance and suites reject embedded commits', () => {
  const smoke = spawnSync('npm', ['run', 'pack:smoke'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(smoke.status, 0, smoke.stderr);
  const result = JSON.parse(readFileSync(resolve(REPO_ROOT, 'tmp/pack-evaluations/feature-delivery.json'), 'utf8'));
  assert.equal(result.provenance.mode, 'structural');
  assert.equal(result.provenance.valid, false);
  assert.equal(result.sourceCommit, null);
  assert.equal(result.evidence.promotionEligible, false);

  const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/pack-suite.schema.json'), 'utf8'));
  const suite = JSON.parse(readFileSync(resolve(REPO_ROOT, 'evals/packs/feature-delivery.json'), 'utf8'));
  suite.source.commit = 'a'.repeat(40);
  const registry = JSON.parse(readFileSync(resolve(REPO_ROOT, 'registry/skills.json'), 'utf8'));
  assert.match(validatePackSuite(schema, suite, {
    root: REPO_ROOT,
    registry,
    registryBytes: readFileSync(resolve(REPO_ROOT, 'registry/skills.json')),
  }).join('\n'), /unknown property "commit"/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRegistry, serializeRegistry, validateRegistry } from '../scripts/generate-registry.mjs';
import { sha256 } from '../scripts/lib/paths.mjs';
import { makeTempDir, removeDir, writeSkill, validFrontmatter } from './helpers.mjs';

test('buildRegistry produces schema-valid, sorted output', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'zeta', {
      frontmatter: validFrontmatter('zeta'),
      files: { 'references/a.md': '# a\n' },
    });
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const registry = buildRegistry(root);
    assert.deepEqual(registry.skills.map((s) => s.name), ['alpha', 'zeta']);
    assert.equal(validateRegistry(registry).length, 0);
    const zeta = registry.skills.find((s) => s.name === 'zeta');
    assert.deepEqual(zeta.resources, ['references/a.md']);
    assert.equal(zeta.version, '1.0.0');
    assert.deepEqual(zeta.maturity, {
      status: 'unverified',
      lastEvaluatedAt: null,
      evidence: [],
    });
    assert.match(zeta.sha256, /^[0-9a-f]{64}$/);
  } finally {
    removeDir(root);
  }
});

test('serialization is deterministic across builds', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const first = serializeRegistry(buildRegistry(root));
    const second = serializeRegistry(buildRegistry(root));
    assert.equal(first, second);
  } finally {
    removeDir(root);
  }
});

test('registry validation rejects unsupported verified tiers', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const registry = buildRegistry(root);
    registry.skills[0].maturity = {
      status: 'verified',
      lastEvaluatedAt: '2026-07-26',
      evidence: [],
    };
    assert.match(
      validateRegistry(registry).join('\n'),
      /core tier requires evidence: structural-validation, behavior-evaluation, routing-evaluation, runtime-smoke-test, maintainer-approval/,
    );
  } finally {
    removeDir(root);
  }
});

test('registry validation accepts a core tier with complete evidence', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const registry = buildRegistry(root);
    registry.skills[0].maturity = {
      status: 'verified',
      lastEvaluatedAt: '2026-07-26',
      evidence: [
        'structural-validation',
        'behavior-evaluation',
        'routing-evaluation',
        'runtime-smoke-test',
        'maintainer-approval',
      ].map((type) => ({
        type,
        reference: `evidence/${type}.json`,
        sha256: '0'.repeat(64),
        recordedAt: '2026-07-26',
      })),
    };
    assert.deepEqual(validateRegistry(registry), []);
  } finally {
    removeDir(root);
  }
});

test('buildRegistry applies persistent maturity evidence and rejects unknown skills', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const evidenceTypes = [
      'structural-validation',
      'behavior-evaluation',
      'routing-evaluation',
      'runtime-smoke-test',
      'maintainer-approval',
    ];
    const evidenceContent = Object.fromEntries(evidenceTypes.map((type) => [
      type,
      `{"type":"${type}"}\n`,
    ]));
    const record = {
      status: 'verified',
      lastEvaluatedAt: '2026-07-26',
      evidence: evidenceTypes.map((type) => ({
        type,
        reference: `alpha/evidence/${type}.json`,
        sha256: sha256(evidenceContent[type]),
        recordedAt: '2026-07-26',
      })),
    };
    assert.throws(
      () => buildRegistry(root, {
        schemaVersion: 1,
        skills: { alpha: record },
      }),
      /evidence artifact does not exist/,
    );
    writeSkill(root, 'alpha', {
      frontmatter: validFrontmatter('alpha'),
      files: Object.fromEntries(evidenceTypes.map((type) => [
        `evidence/${type}.json`,
        evidenceContent[type],
      ])),
    });
    const registry = buildRegistry(root, {
      schemaVersion: 1,
      skills: { alpha: record },
    });
    assert.deepEqual(registry.skills[0].maturity, record);
    assert.deepEqual(validateRegistry(registry), []);
    assert.throws(
      () => buildRegistry(root, {
        schemaVersion: 1,
        skills: { missing: record },
      }),
      /maturity evidence references unknown skill missing/,
    );
  } finally {
    removeDir(root);
  }
});

test('registry validation rejects impossible maturity dates', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const registry = buildRegistry(root);
    registry.skills[0].maturity = {
      status: 'verified',
      lastEvaluatedAt: '2026-02-31',
      evidence: [
        'structural-validation',
        'behavior-evaluation',
        'routing-evaluation',
        'runtime-smoke-test',
        'maintainer-approval',
      ].map((type) => ({
        type,
        reference: `evidence/${type}.json`,
        sha256: '0'.repeat(64),
        recordedAt: '2026-02-31',
      })),
    };
    assert.match(validateRegistry(registry).join('\n'), /valid calendar date/);
  } finally {
    removeDir(root);
  }
});

test('registry validation checks tier transitions against a previous registry', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', {
      frontmatter: validFrontmatter('alpha').replace('tier: core', 'tier: experimental'),
    });
    const previous = buildRegistry(root);
    const candidate = structuredClone(previous);
    candidate.skills[0].tier = 'core';
    candidate.skills[0].maturity = {
      status: 'verified',
      lastEvaluatedAt: '2026-07-26',
      evidence: [
        'structural-validation',
        'behavior-evaluation',
        'routing-evaluation',
        'runtime-smoke-test',
        'maintainer-approval',
      ].map((type) => ({
        type,
        reference: `evidence/${type}.json`,
        sha256: '0'.repeat(64),
        recordedAt: '2026-07-26',
      })),
    };
    assert.match(
      validateRegistry(candidate, previous).join('\n'),
      /promotions must advance one tier at a time/,
    );
  } finally {
    removeDir(root);
  }
});

test('registry validation accepts the version 1 registry as migration baseline', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const candidate = buildRegistry(root);
    const previous = structuredClone(candidate);
    previous.schemaVersion = 1;
    delete previous.skills[0].maturity;
    assert.deepEqual(validateRegistry(candidate, previous), []);
  } finally {
    removeDir(root);
  }
});

test('--check style drift detection: committed content differs from regeneration', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const generated = serializeRegistry(buildRegistry(root));
    const committed = generated.replace('1.0.0', '9.9.9');
    assert.notEqual(committed, generated, 'drift must be detectable');

    // After adding a skill, the previously generated content is stale.
    writeSkill(root, 'beta', { frontmatter: validFrontmatter('beta') });
    const regenerated = serializeRegistry(buildRegistry(root));
    assert.notEqual(regenerated, generated);
  } finally {
    removeDir(root);
  }
});

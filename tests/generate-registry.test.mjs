import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildRegistry,
  serializeRegistry,
  validateLifecycleManifest,
  validateRegistry,
} from '../scripts/generate-registry.mjs';
import { sha256 } from '../scripts/lib/paths.mjs';
import { normalizeLifecycle } from '../scripts/lib/lifecycle.mjs';
import { makeTempDir, removeDir, writeSkill, validFrontmatter } from './helpers.mjs';

function discoveryManifest(names) {
  return {
    schemaVersion: 1,
    skills: Object.fromEntries(names.map((name) => [name, {
      category: 'quality',
      tags: ['testing'],
      inputs: [{ type: 'repository', description: 'A repository to inspect.' }],
      outputs: [{ type: 'report', description: 'A structured report.' }],
      risk: { level: 'low', factors: ['read-only'] },
      runtimeCompatibility: [
        { runtime: 'claude-code', status: 'compatible', notes: null },
        { runtime: 'github-copilot', status: 'compatible', notes: null },
        { runtime: 'openai-codex', status: 'compatible', notes: null },
      ],
      relatedSkills: [],
      conflictingSkills: [],
      examplePrompts: [`Run ${name} on this repository.`],
    }])),
  };
}

function lifecycleManifest(names, overrides = {}) {
  const commit = 'a'.repeat(40);
  return {
    schemaVersion: 1,
    skills: Object.fromEntries(names.map((name) => [name, {
      status: 'active',
      license: 'MIT',
      lastReviewedAt: '2026-07-27',
      reviewDueAt: '2027-07-27',
      origin: {
        type: 'first-party',
        repository: 'https://github.com/Cody-Sims/agent-skills',
        ref: commit,
        commit,
      },
      ...overrides[name],
    }])),
    removed: {},
  };
}

test('buildRegistry merges lifecycle metadata and deterministic tombstones into registry v5', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const lifecycle = lifecycleManifest(['alpha']);
    lifecycle.removed.zeta = {
      status: 'removed',
      license: 'MIT',
      lastReviewedAt: '2026-07-27',
      replacement: 'alpha',
      origin: lifecycle.skills.alpha.origin,
    };
    const first = buildRegistry(
      root,
      { schemaVersion: 1, skills: {} },
      root,
      discoveryManifest(['alpha']),
      lifecycle,
      '2026-07-27',
    );
    const second = buildRegistry(
      root,
      { schemaVersion: 1, skills: {} },
      root,
      discoveryManifest(['alpha']),
      lifecycle,
      '2026-07-27',
    );
    assert.equal(first.schemaVersion, 5);
    assert.equal(first.skills[0].lifecycle.status, 'active');
    assert.deepEqual(Object.keys(first.removed), ['zeta']);
    assert.equal(serializeRegistry(first), serializeRegistry(second));
    assert.deepEqual(validateRegistry(first, null, '2026-07-27'), []);
  } finally {
    removeDir(root);
  }
});

test('lifecycle validation rejects expired reviews, license mismatch, and invalid dates', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const manifest = lifecycleManifest(['alpha']);
    manifest.skills.alpha.license = 'Apache-2.0';
    manifest.skills.alpha.lastReviewedAt = '2026-07-27';
    manifest.skills.alpha.reviewDueAt = '2026-07-26';
    manifest.removed.retired = {
      status: 'removed',
      license: 'MIT',
      lastReviewedAt: '2026-02-31',
      origin: manifest.skills.alpha.origin,
    };
    const errors = validateLifecycleManifest(manifest, root, '2026-07-27').join('\n');
    assert.match(errors, /valid calendar date/);
    assert.match(errors, /reviewDueAt must be after lastReviewedAt/);
    assert.match(errors, /review expired/);
    assert.match(errors, /license does not match SKILL.md/);
  } finally {
    removeDir(root);
  }
});

test('lifecycle validation rejects future reviews, intervals over one year, and unscheduled sensitive skills', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const manifest = lifecycleManifest(['alpha']);
    manifest.skills.alpha.lastReviewedAt = '2026-07-28';
    manifest.skills.alpha.reviewDueAt = '2027-07-29';
    const discovery = discoveryManifest(['alpha']);
    discovery.skills.alpha.runtimeCompatibility[0] = {
      runtime: 'claude-code',
      status: 'conditional',
      notes: 'Requires a compatible host version.',
    };
    let errors = validateLifecycleManifest(
      manifest, root, '2026-07-27', discovery,
    ).join('\n');
    assert.match(errors, /lastReviewedAt must not be after --as-of/);
    assert.match(errors, /review interval must not exceed one calendar year/);
    delete manifest.skills.alpha.reviewDueAt;
    errors = validateLifecycleManifest(manifest, root, '2026-07-27', discovery).join('\n');
    assert.match(errors, /compatibility-sensitive skills require a scheduled review/);
  } finally {
    removeDir(root);
  }
});

test('lifecycle validation rejects missing, self, removed, and cyclic replacements', () => {
  const root = makeTempDir('reg-');
  try {
    for (const name of ['alpha', 'beta', 'gamma']) {
      writeSkill(root, name, { frontmatter: validFrontmatter(name) });
    }
    const manifest = lifecycleManifest(['alpha', 'beta', 'gamma']);
    manifest.skills.alpha = { ...manifest.skills.alpha, status: 'superseded', replacement: 'beta' };
    manifest.skills.beta = { ...manifest.skills.beta, status: 'superseded', replacement: 'alpha' };
    manifest.skills.gamma = { ...manifest.skills.gamma, status: 'deprecated', replacement: 'gamma' };
    manifest.removed.retired = {
      status: 'removed',
      license: 'MIT',
      lastReviewedAt: '2026-07-27',
      origin: manifest.skills.alpha.origin,
    };
    const errors = validateLifecycleManifest(manifest, root, '2026-07-27').join('\n');
    assert.match(errors, /replacement cycle/);
    assert.match(errors, /must not reference itself/);
    manifest.skills.gamma.replacement = 'retired';
    assert.match(
      validateLifecycleManifest(manifest, root, '2026-07-27').join('\n'),
      /replacement must not be removed/,
    );
  } finally {
    removeDir(root);
  }
});

test('registry comparison rejects silent external upstream identity changes', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const lifecycle = lifecycleManifest(['alpha'], {
      alpha: {
        origin: {
          type: 'external',
          repository: 'https://github.com/example/upstream',
          ref: 'b'.repeat(40),
          commit: 'b'.repeat(40),
        },
      },
    });
    const previous = buildRegistry(
      root, { schemaVersion: 1, skills: {} }, root, discoveryManifest(['alpha']),
      lifecycle, '2026-07-27',
    );
    const candidate = structuredClone(previous);
    candidate.skills[0].lifecycle.origin.ref = 'c'.repeat(40);
    candidate.skills[0].lifecycle.origin.commit = 'c'.repeat(40);
    assert.match(
      validateRegistry(candidate, previous, '2026-07-27').join('\n'),
      /external upstream identity changed without both a version increase and an advanced lastReviewedAt/,
    );
    candidate.skills[0].version = '1.0.1';
    candidate.skills[0].lifecycle.lastReviewedAt = '2026-07-28';
    candidate.skills[0].lifecycle.reviewDueAt = '2027-07-28';
    assert.deepEqual(validateRegistry(candidate, previous, '2026-07-28'), []);
  } finally {
    removeDir(root);
  }
});

test('registry comparison protects normalized origins across kinds and tombstone transitions', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const previous = buildRegistry(
      root, { schemaVersion: 1, skills: {} }, root, discoveryManifest(['alpha']),
      lifecycleManifest(['alpha']), '2026-07-27',
    );
    const equivalent = structuredClone(previous);
    equivalent.skills[0].lifecycle.origin.repository =
      'https://github.com/Cody-Sims/agent-skills.git/';
    assert.deepEqual(validateRegistry(previous, equivalent, '2026-07-27'), []);

    const changedFirstParty = structuredClone(previous);
    changedFirstParty.skills[0].lifecycle.origin.ref = 'b'.repeat(40);
    changedFirstParty.skills[0].lifecycle.origin.commit = 'b'.repeat(40);
    assert.match(
      validateRegistry(changedFirstParty, previous, '2026-07-27').join('\n'),
      /first-party origin identity changed/,
    );

    const kindChange = structuredClone(previous);
    kindChange.skills[0].lifecycle.origin.type = 'external';
    assert.match(
      validateRegistry(kindChange, previous, '2026-07-27').join('\n'),
      /origin kind changed/,
    );

    const removed = structuredClone(previous);
    const [entry] = removed.skills.splice(0, 1);
    removed.removed.alpha = { ...entry.lifecycle, status: 'removed' };
    removed.removed.alpha.origin = {
      ...removed.removed.alpha.origin,
      ref: 'c'.repeat(40),
      commit: 'c'.repeat(40),
    };
    assert.match(
      validateRegistry(removed, previous, '2026-07-27').join('\n'),
      /active-to-removed origin identity changed/,
    );

    const changedTombstone = structuredClone(removed);
    changedTombstone.removed.alpha.origin.ref = 'd'.repeat(40);
    changedTombstone.removed.alpha.origin.commit = 'd'.repeat(40);
    assert.match(
      validateRegistry(changedTombstone, removed, '2026-07-27').join('\n'),
      /tombstone origin identity changed/,
    );

    const removedSameOrigin = structuredClone(previous);
    const [removedEntry] = removedSameOrigin.skills.splice(0, 1);
    removedSameOrigin.removed.alpha = {
      ...removedEntry.lifecycle,
      status: 'removed',
    };
    assert.match(
      validateRegistry(previous, removedSameOrigin, '2026-07-27').join('\n'),
      /removed-to-active transition is not allowed/,
    );
  } finally {
    removeDir(root);
  }
});

test('lifecycle normalization uses code-point ordering and canonical repository URLs', () => {
  const manifest = lifecycleManifest(['zeta', 'alpha']);
  manifest.removed = {
    'zeta-old': { ...manifest.skills.zeta, status: 'removed' },
    'alpha-old': { ...manifest.skills.alpha, status: 'removed' },
  };
  manifest.skills.alpha.origin.repository =
    'https://github.com/Cody-Sims/agent-skills.git/';
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = () => {
    throw new Error('localeCompare must not be used');
  };
  try {
    const normalized = normalizeLifecycle(manifest);
    assert.deepEqual(Object.keys(normalized.skills), ['alpha', 'zeta']);
    assert.deepEqual(Object.keys(normalized.removed), ['alpha-old', 'zeta-old']);
    assert.equal(
      normalized.skills.alpha.origin.repository,
      'https://github.com/Cody-Sims/agent-skills',
    );
  } finally {
    String.prototype.localeCompare = original;
  }
});

test('buildRegistry merges complete discovery metadata into registry v5', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const registry = buildRegistry(
      root,
      { schemaVersion: 1, skills: {} },
      root,
      discoveryManifest(['alpha']),
    );
    assert.equal(registry.schemaVersion, 5);
    assert.deepEqual(registry.skills[0].discovery.tags, ['testing']);
    assert.deepEqual(validateRegistry(registry), []);
  } finally {
    removeDir(root);
  }
});

test('buildRegistry rejects incomplete and inconsistent discovery metadata', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    writeSkill(root, 'beta', { frontmatter: validFrontmatter('beta') });
    const manifest = discoveryManifest(['alpha']);
    manifest.skills.alpha.relatedSkills = ['missing'];
    manifest.skills.alpha.runtimeCompatibility.pop();
    manifest.skills.alpha.runtimeCompatibility[0].status = 'conditional';
    assert.throws(
      () => buildRegistry(root, { schemaVersion: 1, skills: {} }, root, manifest),
      /missing discovery metadata for beta[\s\S]*unknown skill missing[\s\S]*conditional status requires notes[\s\S]*missing runtime openai-codex/,
    );
  } finally {
    removeDir(root);
  }
});

test('buildRegistry reports malformed discovery records without crashing', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    assert.throws(
      () => buildRegistry(
        root,
        { schemaVersion: 1, skills: {} },
        root,
        { schemaVersion: 1, skills: { alpha: null } },
      ),
      /expected type object, got null/,
    );
    const manifest = discoveryManifest(['alpha']);
    manifest.skills.alpha.runtimeCompatibility = {};
    assert.throws(
      () => buildRegistry(root, { schemaVersion: 1, skills: {} }, root, manifest),
      /expected type array, got object/,
    );
  } finally {
    removeDir(root);
  }
});

test('registry and discovery schemas keep the same discovery definitions', () => {
  const registrySchema = JSON.parse(readFileSync(resolve('schemas/registry.schema.json'), 'utf8'));
  const discoverySchema = JSON.parse(
    readFileSync(resolve('schemas/registry-discovery.schema.json'), 'utf8'),
  );
  const expected = structuredClone(discoverySchema.$defs);
  const referenceRoot = '#/properties/skills/items/$defs';
  expected.discovery.properties.inputs.items.$ref = `${referenceRoot}/typedArtifact`;
  expected.discovery.properties.outputs.items.$ref = `${referenceRoot}/typedArtifact`;
  expected.discovery.properties.runtimeCompatibility.items.$ref = `${referenceRoot}/runtime`;
  const actual = registrySchema.properties.skills.items.$defs;
  assert.deepEqual({
    typedArtifact: actual.typedArtifact,
    runtime: actual.runtime,
    discovery: actual.discovery,
  }, expected);
});

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

test('registry validation rejects duplicate names and invalid discovery relationships', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const registry = buildRegistry(root);
    registry.skills.push(structuredClone(registry.skills[0]));
    registry.skills[1].discovery.relatedSkills = ['missing'];
    const errors = validateRegistry(registry).join('\n');
    assert.match(errors, /skill names must be unique/);
    assert.match(errors, /unknown skill missing/);
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

test('registry validation accepts the version 2 registry as migration baseline', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const candidate = buildRegistry(root);
    const previous = structuredClone(candidate);
    previous.schemaVersion = 2;
    delete previous.skills[0].discovery;
    assert.deepEqual(validateRegistry(candidate, previous), []);
  } finally {
    removeDir(root);
  }
});

test('buildRegistry integrates validated normalized packs into registry v5', () => {
  const root = makeTempDir('reg-');
  try {
    for (const name of ['alpha', 'beta']) {
      writeSkill(root, name, { frontmatter: validFrontmatter(name) });
    }
    const packs = {
      schemaVersion: 1,
      packs: [{
        name: 'delivery',
        version: '1.0.0',
        description: 'Delivers a tested change through final verification.',
        skills: [
          { name: 'beta', version: '1.0.0' },
          { name: 'alpha', version: '1.0.0' },
        ],
        handoffs: [{
          from: 'alpha',
          to: 'beta',
          when: 'Alpha has produced its completed artifact.',
        }],
        conflicts: [],
        installPolicy: {
          versionMatch: 'exact',
          conflictAction: 'reject',
          requiredRuntimes: ['openai-codex', 'claude-code', 'github-copilot'],
        },
      }],
      removed: {},
    };
    const registry = buildRegistry(
      root,
      { schemaVersion: 1, skills: {} },
      root,
      discoveryManifest(['alpha', 'beta']),
      lifecycleManifest(['alpha', 'beta']),
      '2026-07-27',
      packs,
    );
    assert.equal(registry.schemaVersion, 5);
    assert.deepEqual(registry.packs[0].skills.map((member) => member.name), ['alpha', 'beta']);
    assert.deepEqual(registry.removedPacks, {});
    assert.deepEqual(validateRegistry(registry, null, '2026-07-27'), []);
  } finally {
    removeDir(root);
  }
});

test('registry validation accepts version 3 and 4 registries as migration baselines', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const candidate = buildRegistry(root);
    for (const version of [3, 4]) {
      const previous = structuredClone(candidate);
      previous.schemaVersion = version;
      delete previous.packs;
      delete previous.removedPacks;
      assert.deepEqual(validateRegistry(candidate, previous), []);
    }
  } finally {
    removeDir(root);
  }
});

test('registry validation rejects unsupported legacy schema versions', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const candidate = buildRegistry(root);
    for (const version of [0, -1]) {
      const previous = structuredClone(candidate);
      previous.schemaVersion = version;
      assert.match(
        validateRegistry(candidate, previous).join('\n'),
        /previous registry: schemaVersion must be an integer from 1 through 5/,
      );
    }
  } finally {
    removeDir(root);
  }
});

test('registry validation rejects malformed v4 lifecycle contracts', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const candidate = buildRegistry(root);
    const previous = structuredClone(candidate);
    previous.schemaVersion = 4;
    delete previous.packs;
    delete previous.removedPacks;
    delete previous.skills[0].lifecycle.origin.commit;
    assert.match(
      validateRegistry(candidate, previous).join('\n'),
      /previous registry: \$\.skills\[0\]\.lifecycle\.origin: missing required property "commit"/,
    );
  } finally {
    removeDir(root);
  }
});

test('malformed v4 origins cannot bypass origin transition protection', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const candidate = buildRegistry(root);
    const previous = structuredClone(candidate);
    previous.schemaVersion = 4;
    delete previous.packs;
    delete previous.removedPacks;
    previous.skills[0].lifecycle.origin = {
      type: 'external',
      repository: 'https://github.com/example/upstream',
    };
    const errors = validateRegistry(candidate, previous).join('\n');
    assert.match(errors, /previous registry: .*missing required property "ref"/);
    assert.match(errors, /previous registry: .*missing required property "commit"/);
    assert.doesNotMatch(errors, /origin kind changed/);
  } finally {
    removeDir(root);
  }
});

test('duplicate v4 skill names cannot conceal an origin transition', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const candidate = buildRegistry(root);
    const previous = structuredClone(candidate);
    previous.schemaVersion = 4;
    delete previous.packs;
    delete previous.removedPacks;
    const concealedOrigin = structuredClone(previous.skills[0]);
    concealedOrigin.lifecycle.origin = {
      type: 'external',
      repository: 'https://github.com/example/upstream',
      ref: 'b'.repeat(40),
      commit: 'b'.repeat(40),
    };
    previous.skills = [concealedOrigin, previous.skills[0]];

    const errors = validateRegistry(candidate, previous).filter(
      (error) => error.startsWith('previous registry:'),
    );
    assert.equal(
      errors[0],
      'previous registry: $.skills: skill names must be unique.',
    );
  } finally {
    removeDir(root);
  }
});

test('legacy baselines cannot introduce never-active pack tombstones', () => {
  const root = makeTempDir('reg-');
  try {
    writeSkill(root, 'alpha', { frontmatter: validFrontmatter('alpha') });
    const candidate = buildRegistry(root);
    candidate.removedPacks['never-active'] = {
      status: 'removed',
      version: '1.0.0',
    };
    const previous = structuredClone(candidate);
    previous.schemaVersion = 4;
    delete previous.packs;
    delete previous.removedPacks;
    assert.match(
      validateRegistry(candidate, previous).join('\n'),
      /pack never-active: new tombstone requires an active pack in the immediate previous registry/,
    );
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  normalizePacks,
  validatePackManifest,
  validatePackTransitions,
} from '../scripts/lib/packs.mjs';
import { validateAgainstSchema } from '../scripts/lib/jsonschema.mjs';

const packSchema = JSON.parse(readFileSync(resolve('schemas/packs.schema.json'), 'utf8'));

function skill(name, version = '1.0.0', overrides = {}) {
  return {
    name,
    version,
    lifecycle: { status: 'active' },
    discovery: {
      conflictingSkills: [],
      runtimeCompatibility: [
        { runtime: 'claude-code', status: 'compatible', notes: null },
        { runtime: 'github-copilot', status: 'compatible', notes: null },
        { runtime: 'openai-codex', status: 'compatible', notes: null },
      ],
    },
    ...overrides,
  };
}

function manifest() {
  return {
    schemaVersion: 1,
    packs: [
      {
        name: 'delivery',
        version: '1.0.0',
        description: 'Delivers a tested change through final verification.',
        skills: [
          { name: 'alpha', version: '1.0.0' },
          { name: 'beta', version: '1.0.0' },
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
          requiredRuntimes: ['claude-code', 'github-copilot'],
        },
      },
    ],
    removed: {},
  };
}

test('pack validation accepts a strict, internally consistent manifest', () => {
  assert.deepEqual(
    validatePackManifest(packSchema, manifest(), [skill('alpha'), skill('beta')]),
    [],
  );
});

test('pack validation rejects malformed, unknown, mismatched, and inactive members', () => {
  const candidate = manifest();
  candidate.packs[0].unexpected = true;
  candidate.packs[0].skills.push({ name: 'missing', version: '1.0.0' });
  candidate.packs[0].skills[0].version = '2.0.0';
  const skills = [
    skill('alpha'),
    skill('beta', '1.0.0', { lifecycle: { status: 'deprecated' } }),
  ];
  const errors = validatePackManifest(packSchema, candidate, skills).join('\n');
  assert.match(errors, /unknown property "unexpected"/);
  assert.match(errors, /unknown skill missing/);
  assert.match(errors, /alpha: pack requires version 2\.0\.0, registry has 1\.0\.0/);
  assert.match(errors, /beta: pack members must have active lifecycle status/);
});

test('pack validation rejects duplicate members and invalid or duplicate handoffs', () => {
  const candidate = manifest();
  candidate.packs[0].skills.push({ name: 'alpha', version: '1.0.0' });
  candidate.packs[0].handoffs.push(
    { from: 'alpha', to: 'beta', when: 'Duplicate.' },
    { from: 'alpha', to: 'alpha', when: 'Self handoff.' },
    { from: 'alpha', to: 'missing', when: 'Missing endpoint.' },
  );
  const errors = validatePackManifest(
    packSchema, candidate, [skill('alpha'), skill('beta')],
  ).join('\n');
  assert.match(errors, /duplicate member alpha/);
  assert.match(errors, /duplicate handoff alpha -> beta/);
  assert.match(errors, /handoff endpoints must be distinct/);
  assert.match(errors, /handoff endpoint missing is not an included member/);
});

test('pack validation rejects discovery conflicts in either direction', () => {
  const forward = [
    skill('alpha', '1.0.0', {
      discovery: {
        ...skill('alpha').discovery,
        conflictingSkills: ['beta'],
      },
    }),
    skill('beta'),
  ];
  assert.match(
    validatePackManifest(packSchema, manifest(), forward).join('\n'),
    /alpha conflicts with included member beta/,
  );

  const reverse = [
    skill('alpha'),
    skill('beta', '1.0.0', {
      discovery: {
        ...skill('beta').discovery,
        conflictingSkills: ['alpha'],
      },
    }),
  ];
  assert.match(
    validatePackManifest(packSchema, manifest(), reverse).join('\n'),
    /beta conflicts with included member alpha/,
  );
});

test('pack validation rejects cyclic handoff workflows', () => {
  const candidate = manifest();
  candidate.packs[0].handoffs.push({
    from: 'beta',
    to: 'alpha',
    when: 'Beta completes.',
  });
  assert.match(
    validatePackManifest(
      packSchema, candidate, [skill('alpha'), skill('beta')],
    ).join('\n'),
    /continuous acyclic workflow/,
  );
});

test('pack validation rejects disconnected handoff chains', () => {
  const candidate = manifest();
  candidate.packs[0].skills.push(
    { name: 'gamma', version: '1.0.0' },
    { name: 'delta', version: '1.0.0' },
  );
  candidate.packs[0].handoffs.push({
    from: 'gamma',
    to: 'delta',
    when: 'Gamma completes.',
  });
  assert.match(
    validatePackManifest(packSchema, candidate, [
      skill('alpha'), skill('beta'), skill('gamma'), skill('delta'),
    ]).join('\n'),
    /continuous acyclic workflow/,
  );
});

test('pack validation rejects branching or merging handoff ambiguity', () => {
  const candidate = manifest();
  candidate.packs[0].skills.push({ name: 'gamma', version: '1.0.0' });
  candidate.packs[0].handoffs.push({
    from: 'alpha',
    to: 'gamma',
    when: 'Alpha also completes for gamma.',
  });
  assert.match(
    validatePackManifest(packSchema, candidate, [
      skill('alpha'), skill('beta'), skill('gamma'),
    ]).join('\n'),
    /branching or merging is not allowed/,
  );
});

test('pack validation rejects declared conflicts and incompatible required runtimes', () => {
  const candidate = manifest();
  candidate.packs[0].conflicts = ['beta'];
  const beta = skill('beta');
  beta.discovery.runtimeCompatibility[1].status = 'conditional';
  beta.discovery.runtimeCompatibility[1].notes = 'Requires an unverified host extension.';
  const errors = validatePackManifest(packSchema, candidate, [
    skill('alpha'), beta,
  ]).join('\n');
  assert.match(errors, /declared conflict beta is also an included member/);
  assert.match(errors, /beta is not compatible with required runtime github-copilot/);
});

test('pack normalization is deterministic while preserving handoff order', () => {
  const candidate = manifest();
  candidate.packs.push({
    ...structuredClone(candidate.packs[0]),
    name: 'alpha-pack',
    skills: [
      { name: 'beta', version: '1.0.0' },
      { name: 'alpha', version: '1.0.0' },
      { name: 'gamma', version: '1.0.0' },
    ],
    handoffs: [
      { from: 'beta', to: 'alpha', when: 'Beta completes.' },
      { from: 'alpha', to: 'gamma', when: 'Alpha completes.' },
    ],
    conflicts: ['zeta', 'gamma'],
    installPolicy: {
      ...candidate.packs[0].installPolicy,
      requiredRuntimes: ['github-copilot', 'claude-code'],
    },
  });
  const normalized = normalizePacks(candidate);
  assert.deepEqual(normalized.packs.map((pack) => pack.name), ['alpha-pack', 'delivery']);
  assert.deepEqual(
    normalized.packs[0].skills.map((member) => member.name),
    ['alpha', 'beta', 'gamma'],
  );
  assert.deepEqual(normalized.packs[0].conflicts, ['gamma', 'zeta']);
  assert.deepEqual(
    normalized.packs[0].installPolicy.requiredRuntimes,
    ['claude-code', 'github-copilot'],
  );
  assert.deepEqual(normalized.packs[0].handoffs, candidate.packs[1].handoffs);
});

test('normalized packs satisfy their strict schema', () => {
  assert.deepEqual(validateAgainstSchema(packSchema, normalizePacks(manifest())), []);
});

test('pack transitions require version increases and explicit immutable removals', () => {
  const previous = normalizePacks(manifest());
  const changedWithoutVersion = structuredClone(previous);
  changedWithoutVersion.packs[0].description = 'A changed definition.';
  assert.match(
    validatePackTransitions(previous, changedWithoutVersion).join('\n'),
    /definition changed without a strictly higher version/,
  );
  changedWithoutVersion.packs[0].version = '1.0.1';
  assert.deepEqual(validatePackTransitions(previous, changedWithoutVersion), []);

  const silentlyRemoved = { schemaVersion: 1, packs: [], removed: {} };
  assert.match(
    validatePackTransitions(previous, silentlyRemoved).join('\n'),
    /removal requires a pack tombstone/,
  );
  const explicitlyRemoved = {
    schemaVersion: 1,
    packs: [],
    removed: { delivery: { status: 'removed', version: '1.0.0' } },
  };
  assert.deepEqual(validatePackTransitions(previous, explicitlyRemoved), []);
  assert.match(
    validatePackTransitions(explicitlyRemoved, previous).join('\n'),
    /removed-to-active transition is not allowed/,
  );
  const changedTombstone = structuredClone(explicitlyRemoved);
  changedTombstone.removed.delivery.version = '1.0.1';
  assert.match(
    validatePackTransitions(explicitlyRemoved, changedTombstone).join('\n'),
    /tombstone changed/,
  );
});

test('pack transitions reject tombstones for packs that were never active', () => {
  const previous = { schemaVersion: 1, packs: [], removed: {} };
  const current = {
    schemaVersion: 1,
    packs: [],
    removed: { 'never-active': { status: 'removed', version: '1.0.0' } },
  };
  assert.match(
    validatePackTransitions(previous, current).join('\n'),
    /never-active: new tombstone requires an active pack in the immediate previous registry/,
  );
});

test('removed pack replacements must identify a distinct active pack', () => {
  const candidate = manifest();
  candidate.removed.retired = {
    status: 'removed',
    version: '1.0.0',
    replacement: 'retired',
  };
  let errors = validatePackManifest(
    packSchema, candidate, [skill('alpha'), skill('beta')],
  ).join('\n');
  assert.match(errors, /replacement must not reference itself/);
  candidate.removed.retired.replacement = 'missing-pack';
  errors = validatePackManifest(
    packSchema, candidate, [skill('alpha'), skill('beta')],
  ).join('\n');
  assert.match(errors, /replacement does not identify an active pack/);
  candidate.removed.retired.replacement = 'delivery';
  assert.deepEqual(
    validatePackManifest(packSchema, candidate, [skill('alpha'), skill('beta')]),
    [],
  );
});

test('committed manifest defines exactly the three valid initial packs', () => {
  const committed = JSON.parse(readFileSync(resolve('registry/packs.json'), 'utf8'));
  const registry = JSON.parse(readFileSync(resolve('registry/skills.json'), 'utf8'));
  assert.deepEqual(committed, {
    schemaVersion: 1,
    packs: [
      {
        name: 'feature-delivery',
        version: '1.0.0',
        description: 'Carries an agreed feature from requirements through implementation review, documentation, and completion verification.',
        skills: [
          { name: 'requirements-and-spec-writing', version: '1.0.0' },
          { name: 'planning-and-task-breakdown', version: '1.0.0' },
          { name: 'test-driven-development', version: '1.0.0' },
          { name: 'code-review', version: '1.0.0' },
          { name: 'documentation-maintenance', version: '1.0.0' },
          { name: 'verification-before-completion', version: '1.0.1' },
        ],
        handoffs: [
          { from: 'requirements-and-spec-writing', to: 'planning-and-task-breakdown', when: 'An agreed implementation-ready specification exists.' },
          { from: 'planning-and-task-breakdown', to: 'test-driven-development', when: 'The approved work is decomposed into ordered tasks with acceptance criteria.' },
          { from: 'test-driven-development', to: 'code-review', when: 'The implementation has completed its red-green-refactor cycle.' },
          { from: 'code-review', to: 'documentation-maintenance', when: 'The implementation review has no unresolved required findings.' },
          { from: 'documentation-maintenance', to: 'verification-before-completion', when: 'Directly affected documentation and changelog entries are current.' },
        ],
        conflicts: [],
        installPolicy: {
          versionMatch: 'exact',
          conflictAction: 'reject',
          requiredRuntimes: ['claude-code', 'github-copilot', 'openai-codex'],
        },
      },
      {
        name: 'safe-refactor',
        version: '1.0.0',
        description: 'Guides a behavior-preserving refactor from codebase mapping and tests through review and completion verification.',
        skills: [
          { name: 'codebase-exploration', version: '1.0.1' },
          { name: 'test-driven-development', version: '1.0.0' },
          { name: 'refactoring-and-dead-code-removal', version: '1.0.0' },
          { name: 'code-review', version: '1.0.0' },
          { name: 'verification-before-completion', version: '1.0.1' },
        ],
        handoffs: [
          { from: 'codebase-exploration', to: 'test-driven-development', when: 'The controlling code path, conventions, and validation commands are known.' },
          { from: 'test-driven-development', to: 'refactoring-and-dead-code-removal', when: 'A failing behavior test establishes the preservation boundary.' },
          { from: 'refactoring-and-dead-code-removal', to: 'code-review', when: 'The mechanical refactor is complete with behavior tests passing.' },
          { from: 'code-review', to: 'verification-before-completion', when: 'The refactor review has no unresolved required findings.' },
        ],
        conflicts: [],
        installPolicy: {
          versionMatch: 'exact',
          conflictAction: 'reject',
          requiredRuntimes: ['claude-code', 'github-copilot', 'openai-codex'],
        },
      },
      {
        name: 'release-readiness',
        version: '1.0.0',
        description: 'Coordinates correctness, security, documentation, and final evidence checks before release-related Git work.',
        skills: [
          { name: 'code-review', version: '1.0.0' },
          { name: 'security-review', version: '1.0.0' },
          { name: 'documentation-maintenance', version: '1.0.0' },
          { name: 'verification-before-completion', version: '1.0.1' },
          { name: 'git-and-pr-workflow', version: '1.0.0' },
        ],
        handoffs: [
          { from: 'code-review', to: 'security-review', when: 'Functional review has no unresolved required findings.' },
          { from: 'security-review', to: 'documentation-maintenance', when: 'Security review has no unresolved required findings.' },
          { from: 'documentation-maintenance', to: 'verification-before-completion', when: 'Release-facing documentation and changelog entries are current.' },
          { from: 'verification-before-completion', to: 'git-and-pr-workflow', when: 'Fresh validation evidence supports release readiness.' },
        ],
        conflicts: [],
        installPolicy: {
          versionMatch: 'exact',
          conflictAction: 'reject',
          requiredRuntimes: ['claude-code', 'github-copilot', 'openai-codex'],
        },
      },
    ],
    removed: {},
  });
  assert.deepEqual(validatePackManifest(packSchema, committed, registry.skills), []);
});

test('registry v5 and pack manifest schemas keep the same pack definitions', () => {
  const registrySchema = JSON.parse(
    readFileSync(resolve('schemas/registry.schema.json'), 'utf8'),
  );
  const registryDefinitions = structuredClone(registrySchema.properties.packs.$defs);
  const replaceReferences = (value) => {
    if (Array.isArray(value)) return value.map(replaceReferences);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      key === '$ref' && typeof child === 'string'
        ? child.replace('#/properties/packs/$defs/', '#/$defs/')
        : replaceReferences(child),
    ]));
  };
  assert.deepEqual(replaceReferences(registryDefinitions), packSchema.$defs);
});

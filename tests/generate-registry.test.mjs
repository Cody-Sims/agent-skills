import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRegistry, serializeRegistry, validateRegistry } from '../scripts/generate-registry.mjs';
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

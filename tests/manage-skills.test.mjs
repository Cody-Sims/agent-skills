import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { manageSkillsTarget } from '../scripts/manage-skills.mjs';
import { makeTempDir, removeDir, writeSkill, validFrontmatter } from './helpers.mjs';

const silent = () => {};

function fixtureSource() {
  const root = makeTempDir('src-');
  writeSkill(root, 'alpha', {
    frontmatter: validFrontmatter('alpha'),
    body: '# Alpha\n\nDoes alpha.\n',
    files: { 'references/guide.md': '# Guide\n' },
  });
  writeSkill(root, 'beta', {
    frontmatter: validFrontmatter('beta'),
    body: '# Beta\n\nDoes beta.\n',
  });
  return root;
}

test('install, check, and uninstall lifecycle', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    assert.ok(existsSync(resolve(targetRoot, 'alpha/SKILL.md')));
    assert.ok(existsSync(resolve(targetRoot, 'alpha/references/guide.md')));
    assert.ok(existsSync(resolve(targetRoot, '.agent-skills-receipt.json')));

    const receipt = JSON.parse(readFileSync(resolve(targetRoot, '.agent-skills-receipt.json'), 'utf8'));
    assert.equal(receipt.schema_version, 1);
    assert.ok(receipt.resources.every((r) => /^[0-9a-f]{64}$/.test(r.sha256)));

    const check = manageSkillsTarget({ mode: 'check', sourceRoot, targetRoot, log: silent });
    assert.equal(check.ok, true);

    manageSkillsTarget({ mode: 'uninstall', sourceRoot, targetRoot, log: silent });
    assert.equal(existsSync(resolve(targetRoot, 'alpha/SKILL.md')), false);
    assert.equal(existsSync(resolve(targetRoot, '.agent-skills-receipt.json')), false);
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('re-installing an unchanged catalog is a no-op', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    const result = manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    assert.equal(result.alreadyCurrent, true);
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('check detects a locally modified managed file', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    const managed = resolve(targetRoot, 'alpha/SKILL.md');
    writeFileSync(managed, `${readFileSync(managed, 'utf8')}\nlocal edit\n`);
    const check = manageSkillsTarget({ mode: 'check', sourceRoot, targetRoot, log: silent });
    assert.equal(check.ok, false);
    assert.ok(check.drift.some((d) => d.kind === 'modified'));
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('install refuses to clobber an unmanaged pre-existing file', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    // Simulate a file installed by a different toolkit.
    mkdirSync(resolve(targetRoot, 'alpha'), { recursive: true });
    writeFileSync(resolve(targetRoot, 'alpha/SKILL.md'), 'installed by someone else\n');
    assert.throws(
      () => manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent }),
      /Refusing to overwrite/,
    );
    // The unmanaged file is untouched.
    assert.equal(readFileSync(resolve(targetRoot, 'alpha/SKILL.md'), 'utf8'), 'installed by someone else\n');
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('dry-run reports conflicts without writing or throwing', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    mkdirSync(resolve(targetRoot, 'alpha'), { recursive: true });
    writeFileSync(resolve(targetRoot, 'alpha/SKILL.md'), 'foreign\n');
    const result = manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, dryRun: true, log: silent });
    assert.equal(result.ok, false);
    assert.ok(result.conflicts.length >= 1);
    // Nothing installed.
    assert.equal(existsSync(resolve(targetRoot, '.agent-skills-receipt.json')), false);
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('uninstall refuses to remove a locally modified managed file', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    const managed = resolve(targetRoot, 'beta/SKILL.md');
    writeFileSync(managed, `${readFileSync(managed, 'utf8')}\nlocal edit\n`);
    assert.throws(
      () => manageSkillsTarget({ mode: 'uninstall', sourceRoot, targetRoot, log: silent }),
      /Refusing to remove/,
    );
    // The file is still present because uninstall preflights before deleting.
    assert.ok(existsSync(managed));
    assert.ok(existsSync(resolve(targetRoot, 'alpha/SKILL.md')));
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('unchanged resources retired from the catalog are removed on update', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    assert.ok(existsSync(resolve(targetRoot, 'beta/SKILL.md')));
    // Remove beta from the source catalog.
    removeDir(resolve(sourceRoot, 'beta'));
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    assert.equal(existsSync(resolve(targetRoot, 'beta/SKILL.md')), false);
    const check = manageSkillsTarget({ mode: 'check', sourceRoot, targetRoot, log: silent });
    assert.equal(check.ok, true);
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

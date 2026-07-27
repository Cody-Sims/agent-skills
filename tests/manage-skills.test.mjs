import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  assertBufferedCatalogMatchesCommit,
  collectCatalog,
  manageSkillsTarget,
  verifyDefaultCatalogSource,
} from '../scripts/manage-skills.mjs';
import { sha256 } from '../scripts/lib/paths.mjs';
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

function gitCatalogFixture({ registrySha } = {}) {
  const root = makeTempDir('catalog-');
  const skillsRoot = resolve(root, 'skills');
  writeSkill(skillsRoot, 'alpha', {
    frontmatter: validFrontmatter('alpha'),
    files: {
      'references/guide.md': '# Guide\n',
      'references/café.md': '# Café\n',
    },
  });
  const skillContent = readFileSync(resolve(skillsRoot, 'alpha/SKILL.md'), 'utf8');
  mkdirSync(resolve(root, 'registry'), { recursive: true });
  writeFileSync(resolve(root, 'registry/skills.json'), `${JSON.stringify({
    schemaVersion: 4,
    skills: [{
      name: 'alpha',
      version: '1.0.0',
      sha256: registrySha ?? sha256(skillContent),
      resources: ['references/café.md', 'references/guide.md'],
    }],
    removed: {},
  }, null, 2)}\n`);
  writeFileSync(resolve(root, '.gitignore'), 'skills/alpha/ignored.md\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'tests@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Tests'], { cwd: root });
  execFileSync('git', ['add', '.gitignore', 'skills', 'registry/skills.json'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return { root, skillsRoot, registryPath: resolve(root, 'registry/skills.json'), commit };
}

test('default catalog verification accepts a clean tree with a non-ASCII tracked resource', () => {
  const fixture = gitCatalogFixture();
  try {
    assert.equal(verifyDefaultCatalogSource(fixture), fixture.commit);
  } finally {
    removeDir(fixture.root);
  }
});

test('buffered default resources cannot hide a mutate-collect-restore race', () => {
  const fixture = gitCatalogFixture();
  const skillPath = resolve(fixture.skillsRoot, 'alpha/SKILL.md');
  const original = readFileSync(skillPath);
  try {
    const verifiedCommit = verifyDefaultCatalogSource(fixture);
    writeFileSync(skillPath, Buffer.concat([original, Buffer.from('\ntransient modified bytes\n')]));
    const buffered = collectCatalog(fixture.skillsRoot);
    writeFileSync(skillPath, original);
    assert.equal(verifyDefaultCatalogSource(fixture), verifiedCommit);
    assert.throws(
      () => assertBufferedCatalogMatchesCommit(buffered, {
        root: fixture.root,
        skillsRoot: fixture.skillsRoot,
        registryPath: fixture.registryPath,
        commit: verifiedCommit,
      }),
      /buffered resource differs from verified commit/,
    );
  } finally {
    writeFileSync(skillPath, original);
    removeDir(fixture.root);
  }
});

test('default install receipt uses the exact commit returned by final verification', () => {
  const targetRoot = makeTempDir('dst-');
  const verifiedCommit = 'f'.repeat(40);
  try {
    manageSkillsTarget({
      mode: 'install',
      targetRoot,
      log: silent,
      verifySource: () => verifiedCommit,
      bindCatalog: (_catalog, { commit }) => {
        assert.equal(commit, verifiedCommit);
      },
    });
    const receipt = JSON.parse(
      readFileSync(resolve(targetRoot, '.agent-skills-receipt.json'), 'utf8'),
    );
    assert.equal(receipt.source.commit, verifiedCommit);
    assert.equal(receipt.source.ref, verifiedCommit);
  } finally {
    removeDir(targetRoot);
  }
});

test('default catalog verification rejects dirty tracked and untracked catalog bytes', () => {
  for (const mutate of [
    ({ skillsRoot }) => writeFileSync(resolve(skillsRoot, 'alpha/SKILL.md'), 'dirty\n'),
    ({ registryPath }) => writeFileSync(registryPath, '{}\n'),
    ({ skillsRoot }) => writeFileSync(resolve(skillsRoot, 'alpha/untracked.md'), 'dirty\n'),
    ({ skillsRoot }) => writeFileSync(resolve(skillsRoot, 'alpha/ignored.md'), 'dirty\n'),
    ({ root }) => writeFileSync(resolve(root, 'registry/untracked.json'), '{}\n'),
  ]) {
    const fixture = gitCatalogFixture();
    try {
      mutate(fixture);
      assert.throws(
        () => verifyDefaultCatalogSource(fixture),
        /catalog source is dirty/,
      );
    } finally {
      removeDir(fixture.root);
    }
  }
});

test('default catalog verification rejects registry and copied-resource mismatch', () => {
  const fixture = gitCatalogFixture({ registrySha: 'f'.repeat(64) });
  try {
    assert.throws(
      () => verifyDefaultCatalogSource(fixture),
      /registry does not match copied resources/,
    );
  } finally {
    removeDir(fixture.root);
  }
});

test('install, check, and uninstall lifecycle', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    assert.ok(existsSync(resolve(targetRoot, 'alpha/SKILL.md')));
    assert.ok(existsSync(resolve(targetRoot, 'alpha/references/guide.md')));
    assert.ok(existsSync(resolve(targetRoot, '.agent-skills-receipt.json')));

    const receipt = JSON.parse(readFileSync(resolve(targetRoot, '.agent-skills-receipt.json'), 'utf8'));
    assert.equal(receipt.schema_version, 2);
    assert.equal(receipt.source.type, 'local-unverified');
    assert.equal(receipt.source.commit, null);
    assert.match(receipt.registry_sha256, /^[0-9a-f]{64}$/);
    assert.equal(receipt.skills.alpha, '1.0.0');
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

test('install refuses an unmanaged destination even when its content matches', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    mkdirSync(resolve(targetRoot, 'alpha'), { recursive: true });
    const source = readFileSync(resolve(sourceRoot, 'alpha/SKILL.md'));
    writeFileSync(resolve(targetRoot, 'alpha/SKILL.md'), source);
    assert.throws(
      () => manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent }),
      /Refusing to overwrite/,
    );
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

test('receipt validation rejects duplicate and escaping destinations before filesystem changes', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    const receiptPath = resolve(targetRoot, '.agent-skills-receipt.json');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    receipt.resources.push({ ...receipt.resources[0], destination: '../escape' });
    writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
    assert.throws(
      () => manageSkillsTarget({ mode: 'check', sourceRoot, targetRoot, log: silent }),
      /unsafe receipt destination/,
    );
    assert.ok(existsSync(resolve(targetRoot, 'alpha/SKILL.md')));

    receipt.resources.pop();
    receipt.resources.push({ ...receipt.resources[0] });
    writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
    assert.throws(
      () => manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent }),
      /duplicate receipt destination/,
    );
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('receipt validation rejects unknown fields before filesystem changes', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    const receiptPath = resolve(targetRoot, '.agent-skills-receipt.json');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    receipt.resources[0].unexpected = true;
    writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
    assert.throws(
      () => manageSkillsTarget({ mode: 'uninstall', sourceRoot, targetRoot, log: silent }),
      /unknown receipt property/,
    );
    assert.ok(existsSync(resolve(targetRoot, 'alpha/SKILL.md')));
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('check detects receipt hash tampering and source or catalog identity drift', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    const receiptPath = resolve(targetRoot, '.agent-skills-receipt.json');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    receipt.resources[0].sha256 = 'f'.repeat(64);
    receipt.source = {
      type: 'git-commit',
      repository: 'https://github.com/example/other',
      ref: 'a'.repeat(40),
      commit: 'a'.repeat(40),
    };
    receipt.registry_sha256 = 'e'.repeat(64);
    writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
    const result = manageSkillsTarget({ mode: 'check', sourceRoot, targetRoot, log: silent });
    assert.equal(result.ok, false);
    assert.ok(result.drift.some((item) => item.kind === 'receipt-tampered'));
    assert.ok(result.drift.some((item) => item.kind === 'identity'));
    assert.ok(result.drift.some((item) => item.kind === 'catalog'));
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('a safe v1 receipt migrates deterministically to v2 on install', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    const receiptPath = resolve(targetRoot, '.agent-skills-receipt.json');
    const current = JSON.parse(readFileSync(receiptPath, 'utf8'));
    const legacy = {
      schema_version: 1,
      source_repository: current.source.repository,
      version: current.version,
      installed_at: current.installed_at,
      resources: current.resources.map(({ source, destination, sha256 }) => ({
        source, destination, sha256,
      })),
    };
    writeFileSync(receiptPath, `${JSON.stringify(legacy, null, 2)}\n`);
    const check = manageSkillsTarget({ mode: 'check', sourceRoot, targetRoot, log: silent });
    assert.equal(check.ok, false);
    assert.ok(check.drift.some((item) => item.kind === 'receipt-version'));
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    const migrated = JSON.parse(readFileSync(receiptPath, 'utf8'));
    assert.equal(migrated.schema_version, 2);
    assert.deepEqual(migrated.resources.map((item) => item.destination).sort(),
      current.resources.map((item) => item.destination).sort());
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('v1 migration rejects a foreign source repository before using ownership hashes', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    const receiptPath = resolve(targetRoot, '.agent-skills-receipt.json');
    const current = JSON.parse(readFileSync(receiptPath, 'utf8'));
    const legacy = {
      schema_version: 1,
      source_repository: 'https://github.com/example/foreign.git/',
      version: current.version,
      installed_at: current.installed_at,
      resources: current.resources.map(({ source, destination, sha256 }) => ({
        source, destination, sha256,
      })),
    };
    writeFileSync(receiptPath, `${JSON.stringify(legacy)}\n`);
    assert.throws(
      () => manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent }),
      /foreign legacy receipt/,
    );
    assert.ok(existsSync(resolve(targetRoot, 'alpha/SKILL.md')));
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

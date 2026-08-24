import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import {
  assertBufferedCatalogMatchesCommit,
  collectCatalog,
  manageSkillsTarget,
  manageSkillsTargets,
  parseArguments,
  verifyDefaultCatalogSource,
} from '../scripts/manage-skills.mjs';
import * as manageSkillsModule from '../scripts/manage-skills.mjs';
import { sha256 } from '../scripts/lib/paths.mjs';
import { makeTempDir, removeDir, writeSkill, validFrontmatter } from './helpers.mjs';

const silent = () => {};

function recomputeJournalPlan(journal) {
  journal.plan_sha256 = sha256(JSON.stringify({
    transaction_token: journal.transaction_token,
    operations: journal.operations,
    receipt_sha256: journal.receipt_sha256,
    next_receipt_sha256: journal.next_receipt_sha256,
  }));
}

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

function packFixture() {
  const root = makeTempDir('pack-src-');
  const skillsRoot = resolve(root, 'skills');
  for (const name of ['shared', 'feature-only', 'refactor-only', 'conflicting']) {
    writeSkill(skillsRoot, name, {
      frontmatter: validFrontmatter(name),
      files: name === 'shared' ? { 'references/guide.md': '# Shared\n' } : {},
    });
  }
  mkdirSync(resolve(root, 'registry'), { recursive: true });
  const packs = [
    {
      name: 'feature-delivery',
      version: '1.0.0',
      skills: [
        { name: 'feature-only', version: '1.0.0' },
        { name: 'shared', version: '1.0.0' },
      ],
      conflicts: [],
      installPolicy: { versionMatch: 'exact', conflictAction: 'reject' },
    },
    {
      name: 'safe-refactor',
      version: '1.0.0',
      skills: [
        { name: 'refactor-only', version: '1.0.0' },
        { name: 'shared', version: '1.0.0' },
      ],
      conflicts: [],
      installPolicy: { versionMatch: 'exact', conflictAction: 'reject' },
    },
    {
      name: 'blocked-pack',
      version: '1.0.0',
      skills: [{ name: 'conflicting', version: '1.0.0' }],
      conflicts: ['shared'],
      installPolicy: { versionMatch: 'exact', conflictAction: 'reject' },
    },
  ];
  writeFileSync(resolve(root, 'registry/skills.json'), `${JSON.stringify({
    schemaVersion: 5,
    skills: ['conflicting', 'feature-only', 'refactor-only', 'shared']
      .map((name) => ({ name, version: '1.0.0' })),
    removed: {},
    packs,
    removedPacks: { retired: { version: '1.0.0' } },
  }, null, 2)}\n`);
  return { root, skillsRoot, registryPath: resolve(root, 'registry/skills.json') };
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

test('default receipt provenance remains commit-bound after HEAD advances', () => {
  const fixture = gitCatalogFixture();
  try {
    const catalog = collectCatalog(fixture.skillsRoot);
    const receipt = {
      schema_version: 3,
      source: {
        type: 'git-commit',
        repository: 'https://github.com/Cody-Sims/agent-skills',
        ref: fixture.commit,
        commit: fixture.commit,
      },
      registry_sha256: catalog.registryDigest,
      selections: { catalog: true, packs: {} },
      skills: { alpha: '1.0.0' },
      resources: catalog.resources.map((resource) => ({
        source: `skills/${resource.relPath}`,
        skill: resource.skill,
        destination: resource.relPath,
        sha256: resource.sha256,
      })),
    };
    writeFileSync(resolve(fixture.root, 'README.md'), '# Later commit\n');
    execFileSync('git', ['add', 'README.md'], { cwd: fixture.root });
    execFileSync('git', ['commit', '-qm', 'advance HEAD'], { cwd: fixture.root });
    const verifiedHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: fixture.root,
      encoding: 'utf8',
    }).trim();

    assert.doesNotThrow(() => manageSkillsModule.verifyDefaultReceiptProvenance(receipt, {
      ...fixture,
      repository: 'https://github.com/Cody-Sims/agent-skills',
      verifiedHead,
    }));

    const forged = structuredClone(receipt);
    forged.resources[0].sha256 = '0'.repeat(64);
    assert.throws(
      () => manageSkillsModule.verifyDefaultReceiptProvenance(forged, {
        ...fixture,
        repository: 'https://github.com/Cody-Sims/agent-skills',
        verifiedHead,
      }),
      /provenance|commit|resource/i,
    );

    const foreign = structuredClone(receipt);
    foreign.source.repository = 'https://github.com/example/foreign';
    assert.throws(
      () => manageSkillsModule.verifyDefaultReceiptProvenance(foreign, {
        ...fixture,
        repository: 'https://github.com/Cody-Sims/agent-skills',
        verifiedHead,
      }),
      /provenance|repository/i,
    );

    const receiptTree = execFileSync('git', ['rev-parse', `${fixture.commit}^{tree}`], {
      cwd: fixture.root,
      encoding: 'utf8',
    }).trim();
    const orphanCommit = execFileSync('git', ['commit-tree', receiptTree], {
      cwd: fixture.root,
      encoding: 'utf8',
      input: 'orphan receipt tree\n',
    }).trim();
    const orphan = structuredClone(receipt);
    orphan.source.ref = orphanCommit;
    orphan.source.commit = orphanCommit;
    assert.throws(
      () => manageSkillsModule.verifyDefaultReceiptProvenance(orphan, {
        ...fixture,
        repository: 'https://github.com/Cody-Sims/agent-skills',
        verifiedHead,
      }),
      /not an ancestor|provenance/i,
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
    assert.equal(receipt.schema_version, 3);
    assert.deepEqual(receipt.selections, { catalog: true, packs: {} });
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

test('pack install records a v3 selection and installs only exact pack members', () => {
  const fixture = packFixture();
  const targetRoot = makeTempDir('dst-');
  try {
    manageSkillsTarget({
      mode: 'install',
      sourceRoot: fixture.skillsRoot,
      targetRoot,
      packs: ['feature-delivery'],
      log: silent,
    });
    const receipt = JSON.parse(readFileSync(resolve(targetRoot, '.agent-skills-receipt.json'), 'utf8'));
    assert.equal(receipt.schema_version, 3);
    assert.deepEqual(receipt.selections, {
      catalog: false,
      packs: { 'feature-delivery': '1.0.0' },
    });
    assert.deepEqual(receipt.skills, { 'feature-only': '1.0.0', shared: '1.0.0' });
    assert.ok(existsSync(resolve(targetRoot, 'feature-only/SKILL.md')));
    assert.ok(existsSync(resolve(targetRoot, 'shared/references/guide.md')));
    assert.equal(existsSync(resolve(targetRoot, 'refactor-only/SKILL.md')), false);
  } finally {
    removeDir(fixture.root);
    removeDir(targetRoot);
  }
});

test('overlapping packs retain shared skills until the final requiring selection is removed', () => {
      const fixture = packFixture();
      const targetRoot = makeTempDir('dst-');
      try {
        manageSkillsTarget({ mode: 'install', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['feature-delivery'], log: silent });
        manageSkillsTarget({ mode: 'install', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['safe-refactor'], log: silent });
        manageSkillsTarget({ mode: 'uninstall', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['feature-delivery'], log: silent });
        assert.equal(existsSync(resolve(targetRoot, 'feature-only/SKILL.md')), false);
        assert.ok(existsSync(resolve(targetRoot, 'shared/SKILL.md')));
        assert.ok(existsSync(resolve(targetRoot, 'refactor-only/SKILL.md')));
        manageSkillsTarget({ mode: 'uninstall', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['safe-refactor'], log: silent });
        assert.equal(existsSync(resolve(targetRoot, 'shared/SKILL.md')), false);
        assert.equal(existsSync(resolve(targetRoot, '.agent-skills-receipt.json')), false);
      } finally {
        removeDir(fixture.root);
        removeDir(targetRoot);
      }
    });

    test('pack requests reject unknown, removed, mismatched, and conflicting selections before mutation', () => {
      const fixture = packFixture();
      try {
        for (const packs of [['unknown'], ['retired'], ['feature-delivery@2.0.0']]) {
          const targetRoot = makeTempDir('dst-');
          try {
            assert.throws(
              () => manageSkillsTarget({ mode: 'install', sourceRoot: fixture.skillsRoot, targetRoot, packs, log: silent }),
              /Unknown pack|removed|exact available version/,
            );
            assert.equal(existsSync(resolve(targetRoot, '.agent-skills-receipt.json')), false);
          } finally {
            removeDir(targetRoot);
          }
        }
        const targetRoot = makeTempDir('dst-');
        try {
          assert.throws(
            () => manageSkillsTarget({
              mode: 'install',
              sourceRoot: fixture.skillsRoot,
              targetRoot,
              packs: ['feature-delivery', 'blocked-pack'],
              log: silent,
            }),
            /Pack conflict/,
          );
          assert.equal(existsSync(resolve(targetRoot, 'shared/SKILL.md')), false);
        } finally {
          removeDir(targetRoot);
        }
      } finally {
        removeDir(fixture.root);
      }
    });

    test('pack conflicts are enforced against an existing full-catalog selection', () => {
      const fixture = packFixture();
      const targetRoot = makeTempDir('dst-');
      try {
        manageSkillsTarget({ mode: 'install', sourceRoot: fixture.skillsRoot, targetRoot, log: silent });
        const receiptBefore = readFileSync(resolve(targetRoot, '.agent-skills-receipt.json'), 'utf8');
        assert.throws(
          () => manageSkillsTarget({ mode: 'install', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['blocked-pack'], log: silent }),
          /Pack conflict/,
        );
        assert.equal(readFileSync(resolve(targetRoot, '.agent-skills-receipt.json'), 'utf8'), receiptBefore);
      } finally {
        removeDir(fixture.root);
        removeDir(targetRoot);
      }
    });

    test('pack request rejects an exact member version mismatch before mutation', () => {
      const fixture = packFixture();
      const targetRoot = makeTempDir('dst-');
      try {
        const registry = JSON.parse(readFileSync(fixture.registryPath, 'utf8'));
        registry.packs[0].skills[0].version = '9.0.0';
        writeFileSync(fixture.registryPath, `${JSON.stringify(registry)}\n`);
        assert.throws(
          () => manageSkillsTarget({ mode: 'install', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['feature-delivery'], log: silent }),
          /requires exact feature-only@9.0.0/,
        );
        assert.equal(existsSync(resolve(targetRoot, '.agent-skills-receipt.json')), false);
      } finally {
        removeDir(fixture.root);
        removeDir(targetRoot);
      }
    });

    test('uninstall rejects a selected pack version that differs from the current registry', () => {
      const fixture = packFixture();
      const targetRoot = makeTempDir('dst-');
      try {
        manageSkillsTarget({ mode: 'install', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['feature-delivery'], log: silent });
        const registry = JSON.parse(readFileSync(fixture.registryPath, 'utf8'));
        registry.packs.find((pack) => pack.name === 'feature-delivery').version = '1.1.0';
        writeFileSync(fixture.registryPath, `${JSON.stringify(registry)}\n`);
        assert.throws(
          () => manageSkillsTarget({ mode: 'uninstall', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['feature-delivery'], log: silent }),
          /selected version 1.0.0 differs from available version 1.1.0/,
        );
        assert.ok(existsSync(resolve(targetRoot, 'feature-only/SKILL.md')));
      } finally {
        removeDir(fixture.root);
        removeDir(targetRoot);
      }
    });

    test('check --pack verifies selection identity and shared managed bytes', () => {
      const fixture = packFixture();
      const targetRoot = makeTempDir('dst-');
      try {
        manageSkillsTarget({ mode: 'install', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['feature-delivery'], log: silent });
        const absent = manageSkillsTarget({ mode: 'check', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['safe-refactor'], log: silent });
        assert.ok(absent.drift.some((item) => item.kind === 'pack-selection'));
        writeFileSync(resolve(targetRoot, 'shared/SKILL.md'), 'locally changed\n');
        const drift = manageSkillsTarget({ mode: 'check', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['feature-delivery'], log: silent });
        assert.ok(drift.drift.some((item) => item.kind === 'modified' && item.detail === 'shared/SKILL.md'));
      } finally {
        removeDir(fixture.root);
        removeDir(targetRoot);
      }
    });

    test('CLI parser accepts deterministic repeated pack selections and exact versions', () => {
      assert.deepEqual(parseArguments([
        'install', '--target', 'copilot', '--pack', 'feature-delivery',
        '--pack', 'safe-refactor@1.0.0',
      ]), {
        mode: 'install',
        target: 'copilot',
        dir: undefined,
        dryRun: false,
        packs: ['feature-delivery', 'safe-refactor@1.0.0'],
      });
    });

    test('CLI parser rejects missing or option-looking values for valued options', () => {
        for (const option of ['--dir', '--target', '--agent', '--pack']) {
          for (const args of [
            ['install', option],
            ['install', option, '--dry-run'],
          ]) {
            assert.throws(
              () => parseArguments(args),
              new RegExp(`${option} requires`),
            );
          }
        }
    });

    test('CLI exits before target resolution when a valued option is missing', () => {
      for (const args of [
        ['install', '--dir'],
        ['install', '--target', '--dry-run'],
        ['install', '--agent'],
        ['install', '--pack', '--target'],
      ]) {
        assert.throws(
          () => execFileSync(process.execPath, [resolve('scripts/manage-skills.mjs'), ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }),
          (error) => {
            assert.match(error.stderr, /requires/);
            return true;
          },
        );
      }
    });

    test('default-source CLI pack install, check, and uninstall lifecycle', (t) => {
      const dirtyCatalog = execFileSync(
        'git',
        ['status', '--porcelain=v1', '--untracked-files=all', '--', 'skills', 'registry'],
        { cwd: resolve('.'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();
      if (dirtyCatalog) {
        if (process.env.CI && process.env.CI !== 'false') {
          assert.fail('CI must not skip default-source provenance because catalog paths are dirty.');
        }
        t.skip('Default-source provenance requires committed skills and registry bytes.');
        return;
      }
      const targetRoot = makeTempDir('pack-cli-');
      const cli = resolve('scripts/manage-skills.mjs');
      try {
        const run = (mode) => execFileSync(process.execPath, [
          cli,
          mode,
          '--pack',
          'feature-delivery',
          '--dir',
          targetRoot,
        ], {
          cwd: resolve('.'),
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        assert.match(run('install'), /installed/i);
        assert.match(run('check'), /current/i);
        assert.match(run('uninstall'), /uninstalled/i);
        assert.equal(existsSync(resolve(targetRoot, '.agent-skills-receipt.json')), false);
      } finally {
        removeDir(targetRoot);
      }
    });

    test('faults after journal, backup, write, removal, and receipt restore prior bytes', () => {
      const fixture = packFixture();
      for (const stage of ['after-journal', 'after-backup', 'after-write', 'after-removal', 'before-receipt', 'after-receipt']) {
        const targetRoot = makeTempDir('dst-');
        try {
          manageSkillsTarget({ mode: 'install', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['feature-delivery'], log: silent });
          const before = readFileSync(resolve(targetRoot, '.agent-skills-receipt.json'), 'utf8');
          const operation = stage === 'after-removal'
            ? { mode: 'uninstall', packs: ['feature-delivery'] }
            : { mode: 'install', packs: ['safe-refactor'] };
          assert.throws(
            () => manageSkillsTarget({
              ...operation,
              sourceRoot: fixture.skillsRoot,
              targetRoot,
              log: silent,
              faultInjector: (point) => {
                if (point === stage) throw new Error(`fault:${stage}`);
              },
            }),
            new RegExp(`fault:${stage}`),
          );
          assert.equal(readFileSync(resolve(targetRoot, '.agent-skills-receipt.json'), 'utf8'), before);
          assert.ok(existsSync(resolve(targetRoot, 'feature-only/SKILL.md')));
          assert.ok(existsSync(resolve(targetRoot, 'shared/SKILL.md')));
          assert.equal(existsSync(resolve(targetRoot, 'refactor-only/SKILL.md')), false);
        } finally {
          removeDir(targetRoot);
        }
      }
      removeDir(fixture.root);
    });

    test('pack definition updates add and remove exact members without dropping shared ownership', () => {
      const fixture = packFixture();
      const targetRoot = makeTempDir('dst-');
      try {
        manageSkillsTarget({ mode: 'install', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['feature-delivery'], log: silent });
        const registry = JSON.parse(readFileSync(fixture.registryPath, 'utf8'));
        const pack = registry.packs.find((item) => item.name === 'feature-delivery');
        pack.version = '1.1.0';
        pack.skills.push({ name: 'conflicting', version: '1.0.0' });
        writeFileSync(fixture.registryPath, `${JSON.stringify(registry)}\n`);
        manageSkillsTarget({ mode: 'install', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['feature-delivery@1.1.0'], log: silent });
        assert.ok(existsSync(resolve(targetRoot, 'conflicting/SKILL.md')));

        pack.version = '1.2.0';
        pack.skills = pack.skills.filter((member) => member.name !== 'feature-only');
        writeFileSync(fixture.registryPath, `${JSON.stringify(registry)}\n`);
        manageSkillsTarget({ mode: 'install', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['feature-delivery@1.2.0'], log: silent });
        assert.equal(existsSync(resolve(targetRoot, 'feature-only/SKILL.md')), false);
        assert.ok(existsSync(resolve(targetRoot, 'shared/SKILL.md')));
      } finally {
        removeDir(fixture.root);
        removeDir(targetRoot);
      }
    });

    test('a valid incomplete journal is recovered before the next operation', () => {
      const fixture = packFixture();
      const targetRoot = makeTempDir('dst-');
      try {
        manageSkillsTarget({ mode: 'install', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['feature-delivery'], log: silent });
        const crash = new Error('simulated crash');
        crash.simulateCrash = true;
        assert.throws(
          () => manageSkillsTarget({
            mode: 'install',
            sourceRoot: fixture.skillsRoot,
            targetRoot,
            packs: ['safe-refactor'],
            log: silent,
            faultInjector: (stage) => {
              if (stage === 'after-write') throw crash;
            },
          }),
          /simulated crash/,
        );
        assert.ok(existsSync(resolve(targetRoot, '.agent-skills-transaction/journal.json')));
        const result = manageSkillsTarget({
          mode: 'check',
          sourceRoot: fixture.skillsRoot,
          targetRoot,
          packs: ['feature-delivery'],
          log: silent,
        });
        assert.equal(result.ok, true);
        assert.equal(existsSync(resolve(targetRoot, '.agent-skills-transaction')), false);
      } finally {
        removeDir(fixture.root);
        removeDir(targetRoot);
      }
    });

    test('malformed or foreign journals fail closed with exact operator action', () => {
      const fixture = packFixture();
      const targetRoot = makeTempDir('dst-');
      try {
        mkdirSync(resolve(targetRoot, '.agent-skills-transaction'), { recursive: true });
        writeFileSync(resolve(targetRoot, '.agent-skills-transaction/journal.json'), '{"target":"/foreign"}\n');
        assert.throws(
          () => manageSkillsTarget({ mode: 'install', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['feature-delivery'], log: silent }),
          /failed closed.*Inspect the target|failed closed.*manually proving/s,
        );
        assert.equal(existsSync(resolve(targetRoot, 'feature-only/SKILL.md')), false);
      } finally {
        removeDir(fixture.root);
        removeDir(targetRoot);
      }
    });

    test('a hash-adjusted forged journal cannot remove an unmanaged file', () => {
      const fixture = packFixture();
      const targetRoot = makeTempDir('dst-');
      try {
        const crash = new Error('simulated crash');
        crash.simulateCrash = true;
        assert.throws(
          () => manageSkillsTarget({
            mode: 'install',
            sourceRoot: fixture.skillsRoot,
            targetRoot,
            packs: ['feature-delivery'],
            log: silent,
            faultInjector: (stage) => {
              if (stage === 'after-journal') throw crash;
            },
          }),
          /simulated crash/,
        );
        const unmanaged = resolve(targetRoot, 'unmanaged/SKILL.md');
        mkdirSync(resolve(targetRoot, 'unmanaged'), { recursive: true });
        writeFileSync(unmanaged, 'operator data\n');
        const journalPath = resolve(targetRoot, '.agent-skills-transaction/journal.json');
        const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
        const forgedHash = sha256('operator data\n');
        journal.operations[0] = {
          destination: 'unmanaged/SKILL.md',
          action: 'write',
          existed: false,
          owned_sha256: null,
          prior_sha256: null,
          new_sha256: forgedHash,
        };
        const stagedReceiptPath = resolve(targetRoot, '.agent-skills-transaction/stage/.agent-skills-receipt.json');
        const stagedReceipt = JSON.parse(readFileSync(stagedReceiptPath, 'utf8'));
        stagedReceipt.skills.unmanaged = '1.0.0';
        stagedReceipt.resources[0] = {
          source: 'skills/unmanaged/SKILL.md',
          skill: 'unmanaged',
          destination: 'unmanaged/SKILL.md',
          sha256: forgedHash,
        };
        writeFileSync(stagedReceiptPath, `${JSON.stringify(stagedReceipt, null, 2)}\n`);
        journal.next_receipt_sha256 = sha256(readFileSync(stagedReceiptPath));
        recomputeJournalPlan(journal);
        writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
        assert.throws(
          () => manageSkillsTarget({ mode: 'check', sourceRoot: fixture.skillsRoot, targetRoot, packs: ['feature-delivery'], log: silent }),
          /recovery failed closed|cannot prove/i,
        );
        assert.equal(readFileSync(unmanaged, 'utf8'), 'operator data\n');
      } finally {
        removeDir(fixture.root);
        removeDir(targetRoot);
      }
    });

    test('recovery rejects a recomputed install plan that omits a next resource write', () => {
      const sourceRoot = fixtureSource();
      const targetRoot = makeTempDir('dst-');
      try {
        const crash = new Error('simulated crash');
        crash.simulateCrash = true;
        assert.throws(
          () => manageSkillsTarget({
            mode: 'install',
            sourceRoot,
            targetRoot,
            log: silent,
            faultInjector: (stage) => {
              if (stage === 'after-journal') throw crash;
            },
          }),
          /simulated crash/,
        );
        const journalPath = resolve(targetRoot, '.agent-skills-transaction/journal.json');
        const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
        journal.operations = journal.operations.filter((operation) => operation.destination !== 'beta/SKILL.md');
        recomputeJournalPlan(journal);
        writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
        assert.throws(
          () => manageSkillsTarget({ mode: 'check', sourceRoot, targetRoot, log: silent }),
          /missing from the journal|exact operation set|recovery failed closed/i,
        );
        assert.equal(existsSync(resolve(targetRoot, '.agent-skills-receipt.json')), false);
      } finally {
        removeDir(sourceRoot);
        removeDir(targetRoot);
      }
    });

    test('recovery rejects a recomputed uninstall plan that omits a prior-owned removal', () => {
      const sourceRoot = fixtureSource();
      const targetRoot = makeTempDir('dst-');
      try {
        manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
        const crash = new Error('simulated crash');
        crash.simulateCrash = true;
        assert.throws(
          () => manageSkillsTarget({
            mode: 'uninstall',
            sourceRoot,
            targetRoot,
            log: silent,
            faultInjector: (stage) => {
              if (stage === 'after-journal') throw crash;
            },
          }),
          /simulated crash/,
        );
        const receiptPath = resolve(targetRoot, '.agent-skills-receipt.json');
        const journalPath = resolve(targetRoot, '.agent-skills-transaction/journal.json');
        const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
        journal.operations = journal.operations.filter((operation) => operation.destination !== 'beta/SKILL.md');
        recomputeJournalPlan(journal);
        writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
        assert.throws(
          () => manageSkillsTarget({ mode: 'check', sourceRoot, targetRoot, log: silent }),
          /missing prior-owned removal|exact operation set|recovery failed closed/i,
        );
        assert.ok(existsSync(receiptPath));
        assert.ok(existsSync(resolve(targetRoot, 'beta/SKILL.md')));
      } finally {
        removeDir(sourceRoot);
        removeDir(targetRoot);
      }
    });

    test('multi-target operations preflight every target and roll back earlier targets on later failure', () => {
      const fixture = packFixture();
      const first = makeTempDir('dst-');
      const second = makeTempDir('dst-');
      try {
        mkdirSync(resolve(second, 'shared'), { recursive: true });
        writeFileSync(resolve(second, 'shared/SKILL.md'), 'unmanaged\n');
        assert.throws(
          () => manageSkillsTargets({
            mode: 'install',
            sourceRoot: fixture.skillsRoot,
            targetRoots: [first, second],
            packs: ['feature-delivery'],
            log: silent,
          }),
          /Refusing to overwrite/,
        );
        assert.equal(existsSync(resolve(first, 'feature-only/SKILL.md')), false);
        removeDir(resolve(second, 'shared'));

        assert.throws(
          () => manageSkillsTargets({
            mode: 'install',
            sourceRoot: fixture.skillsRoot,
            targetRoots: [first, second],
            packs: ['feature-delivery'],
            log: silent,
            faultInjector: (stage, context) => {
              if (stage === 'after-write' && context.targetRoot === second) throw new Error('second target failed');
            },
          }),
          /second target failed/,
        );
        assert.equal(existsSync(resolve(first, 'feature-only/SKILL.md')), false);
        assert.equal(existsSync(resolve(second, 'feature-only/SKILL.md')), false);
      } finally {
        removeDir(fixture.root);
        removeDir(first);
        removeDir(second);
      }
});

test('multi-target install applies fresh targets while retaining already-current results', () => {
  const sourceRoot = fixtureSource();
  const current = makeTempDir('dst-');
  const fresh = makeTempDir('dst-');
  try {
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot: current, log: silent });
    const results = manageSkillsTargets({
      mode: 'install',
      sourceRoot,
      targetRoots: [current, fresh],
      log: silent,
    });
    assert.equal(results[0].alreadyCurrent, true);
    assert.equal(results[1].ok, true);
    assert.ok(existsSync(resolve(fresh, 'alpha/SKILL.md')));
  } finally {
    removeDir(sourceRoot);
    removeDir(current);
    removeDir(fresh);
  }
});

test('multi-target uninstall applies installed targets while retaining absent results', () => {
  const sourceRoot = fixtureSource();
  const absent = makeTempDir('dst-');
  const installed = makeTempDir('dst-');
  try {
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot: installed, log: silent });
    const results = manageSkillsTargets({
      mode: 'uninstall',
      sourceRoot,
      targetRoots: [absent, installed],
      log: silent,
    });
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, true);
    assert.equal(existsSync(resolve(installed, 'alpha/SKILL.md')), false);
  } finally {
    removeDir(sourceRoot);
    removeDir(absent);
    removeDir(installed);
  }
});

test('multi-target check retains current and not-installed results in target order', () => {
  const sourceRoot = fixtureSource();
  const current = makeTempDir('dst-');
  const fresh = makeTempDir('dst-');
  try {
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot: current, log: silent });
    const results = manageSkillsTargets({
      mode: 'check',
      sourceRoot,
      targetRoots: [current, fresh],
      log: silent,
    });
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, false);
    assert.ok(results[1].drift.some((item) => item.kind === 'not-installed'));
  } finally {
    removeDir(sourceRoot);
    removeDir(current);
    removeDir(fresh);
  }
});

test('a target operation lock rejects serial contention and is released afterward', () => {
      const sourceRoot = fixtureSource();
      const targetRoot = makeTempDir('dst-');
      try {
        let hookCalled = false;
        manageSkillsTarget({
          mode: 'install',
          sourceRoot,
          targetRoot,
          log: silent,
          faultInjector: (stage) => {
            if (stage !== 'after-preflight') return;
            hookCalled = true;
            assert.throws(
              () => manageSkillsTarget({ mode: 'check', sourceRoot, targetRoot, log: silent }),
              /operation lock|locked/i,
            );
          },
        });
        assert.equal(hookCalled, true);
        assert.equal(existsSync(resolve(targetRoot, '.agent-skills-operation.lock')), false);
      } finally {
        removeDir(sourceRoot);
        removeDir(targetRoot);
      }
    });

    test('a dead-owner operation lock fails closed and is never reclaimed automatically', () => {
      const sourceRoot = fixtureSource();
      const targetRoot = makeTempDir('dst-');
      try {
        const lockPath = resolve(targetRoot, '.agent-skills-operation.lock');
        const lockBytes = `${JSON.stringify({
          schema_version: 1,
          target: targetRoot,
          pid: 2147483647,
          token: 'a'.repeat(64),
        })}\n`;
        writeFileSync(lockPath, lockBytes);
        assert.throws(
          () => manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent }),
          /Existing operation lock.*Inspect.*remove it explicitly/is,
        );
        assert.equal(readFileSync(lockPath, 'utf8'), lockBytes);
        assert.equal(existsSync(resolve(targetRoot, 'alpha/SKILL.md')), false);
      } finally {
        removeDir(sourceRoot);
        removeDir(targetRoot);
      }
    });

    test('a concurrent-style existing operation lock is preserved byte-for-byte', () => {
      const sourceRoot = fixtureSource();
      const targetRoot = makeTempDir('dst-');
      try {
        const lockPath = resolve(targetRoot, '.agent-skills-operation.lock');
        const lockBytes = `${JSON.stringify({
          schema_version: 1,
          target: targetRoot,
          pid: process.pid,
          token: 'b'.repeat(64),
        }, null, 2)}\n`;
        writeFileSync(lockPath, lockBytes);
        assert.throws(
          () => manageSkillsTarget({ mode: 'check', sourceRoot, targetRoot, log: silent }),
          /Existing operation lock.*Inspect.*remove it explicitly/is,
        );
        assert.equal(readFileSync(lockPath, 'utf8'), lockBytes);
      } finally {
        removeDir(sourceRoot);
        removeDir(targetRoot);
      }
    });

    test('malformed operation locks fail closed without target mutation', () => {
      const sourceRoot = fixtureSource();
      const targetRoot = makeTempDir('dst-');
      try {
        writeFileSync(resolve(targetRoot, '.agent-skills-operation.lock'), '{"pid":"unknown"}\n');
        assert.throws(
          () => manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent }),
          /Existing operation lock.*Inspect.*remove it explicitly/is,
        );
        assert.equal(existsSync(resolve(targetRoot, 'alpha/SKILL.md')), false);
      } finally {
        removeDir(sourceRoot);
        removeDir(targetRoot);
      }
    });

    test('install revalidates expected absence immediately before replacement', () => {
      const sourceRoot = fixtureSource();
      const targetRoot = makeTempDir('dst-');
      try {
        assert.throws(
          () => manageSkillsTarget({
            mode: 'install',
            sourceRoot,
            targetRoot,
            log: silent,
            faultInjector: (stage) => {
              if (stage !== 'after-preflight') return;
              mkdirSync(resolve(targetRoot, 'alpha'), { recursive: true });
              writeFileSync(resolve(targetRoot, 'alpha/SKILL.md'), 'appeared after preflight\n');
            },
          }),
          /changed after preflight/,
        );
        assert.equal(readFileSync(resolve(targetRoot, 'alpha/SKILL.md'), 'utf8'), 'appeared after preflight\n');
        assert.equal(existsSync(resolve(targetRoot, '.agent-skills-receipt.json')), false);
      } finally {
        removeDir(sourceRoot);
        removeDir(targetRoot);
      }
    });

    test('an unmanaged transaction directory appearing after preflight is preserved intact', () => {
      const sourceRoot = fixtureSource();
      const targetRoot = makeTempDir('dst-');
      try {
        const transactionRoot = resolve(targetRoot, '.agent-skills-transaction');
        const markerPath = resolve(transactionRoot, 'operator-note.txt');
        assert.throws(
          () => manageSkillsTarget({
            mode: 'install',
            sourceRoot,
            targetRoot,
            log: silent,
            faultInjector: (stage) => {
              if (stage === 'after-preflight') {
                mkdirSync(transactionRoot);
                writeFileSync(markerPath, 'operator-owned\n');
              }
            },
          }),
          /transaction directory.*already exists|EEXIST/i,
        );
        assert.equal(readFileSync(markerPath, 'utf8'), 'operator-owned\n');
        assert.equal(existsSync(resolve(targetRoot, '.agent-skills-receipt.json')), false);
      } finally {
        removeDir(sourceRoot);
        removeDir(targetRoot);
      }
    });

    test('an unmanaged transaction cleanup directory is preserved intact', () => {
      const sourceRoot = fixtureSource();
      const targetRoot = makeTempDir('dst-');
      try {
        const cleanupRoot = resolve(targetRoot, '.agent-skills-transaction-cleanup');
        const markerPath = resolve(cleanupRoot, 'operator-note.txt');
        mkdirSync(cleanupRoot);
        writeFileSync(markerPath, 'operator-owned cleanup\n');
        assert.throws(
          () => manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent }),
          /cleanup state|cleanup recovery failed closed|manual inspection/i,
        );
        assert.equal(readFileSync(markerPath, 'utf8'), 'operator-owned cleanup\n');
        assert.equal(existsSync(resolve(targetRoot, '.agent-skills-receipt.json')), false);
      } finally {
        removeDir(sourceRoot);
        removeDir(targetRoot);
      }
    });

    test('update revalidates receipt-owned hashes immediately before backup', () => {
      const sourceRoot = fixtureSource();
      const targetRoot = makeTempDir('dst-');
      try {
        manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
        writeFileSync(resolve(sourceRoot, 'alpha/SKILL.md'),
          `${readFileSync(resolve(sourceRoot, 'alpha/SKILL.md'), 'utf8')}\nsource update\n`);
        assert.throws(
          () => manageSkillsTarget({
            mode: 'install',
            sourceRoot,
            targetRoot,
            log: silent,
            faultInjector: (stage) => {
              if (stage === 'after-preflight') {
                writeFileSync(resolve(targetRoot, 'alpha/SKILL.md'), 'changed after preflight\n');
              }
            },
          }),
          /changed after preflight/,
        );
        assert.equal(readFileSync(resolve(targetRoot, 'alpha/SKILL.md'), 'utf8'), 'changed after preflight\n');
      } finally {
        removeDir(sourceRoot);
        removeDir(targetRoot);
      }
});

test('rollback never deletes a previously absent path the transaction did not create', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    const externalBytes = readFileSync(resolve(sourceRoot, 'beta/SKILL.md'));
    assert.throws(
      () => manageSkillsTarget({
        mode: 'install',
        sourceRoot,
        targetRoot,
        log: silent,
        faultInjector: (stage) => {
          if (stage === 'after-backup') {
            mkdirSync(resolve(targetRoot, 'beta'), { recursive: true });
            writeFileSync(resolve(targetRoot, 'beta/SKILL.md'), externalBytes);
          }
        },
      }),
      /changed after preflight/,
    );
    assert.equal(readFileSync(resolve(targetRoot, 'beta/SKILL.md')).equals(externalBytes), true);
    assert.equal(existsSync(resolve(targetRoot, 'alpha/SKILL.md')), false);
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('cleanup failure preserves a committed recovery state without rolling back', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    assert.throws(
      () => manageSkillsTarget({
        mode: 'install',
        sourceRoot,
        targetRoot,
        log: silent,
        faultInjector: (stage) => {
          if (stage === 'before-finalize') throw new Error('cleanup unavailable');
        },
      }),
      /logically committed.*cleanup|cleanup.*committed/is,
    );
    assert.ok(existsSync(resolve(targetRoot, 'alpha/SKILL.md')));
    assert.ok(existsSync(resolve(targetRoot, '.agent-skills-receipt.json')));
    assert.ok(existsSync(resolve(targetRoot, '.agent-skills-transaction/journal.json')));
    const check = manageSkillsTarget({ mode: 'check', sourceRoot, targetRoot, log: silent });
    assert.equal(check.ok, true);
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('cleanup failure after atomic cleanup handoff preserves committed recovery state', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    assert.throws(
      () => manageSkillsTarget({
        mode: 'install',
        sourceRoot,
        targetRoot,
        log: silent,
        faultInjector: (stage) => {
          if (stage === 'after-finalize-rename') throw new Error('cleanup removal failed');
        },
      }),
      /logically committed.*cleanup/is,
    );
    assert.ok(existsSync(resolve(targetRoot, '.agent-skills-transaction-cleanup/journal.json')));
    assert.equal(existsSync(resolve(targetRoot, '.agent-skills-transaction')), false);
    assert.equal(manageSkillsTarget({ mode: 'check', sourceRoot, targetRoot, log: silent }).ok, true);
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('before-finalize root replacement is preserved and fails owner-bound finalization', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    const activeRoot = resolve(targetRoot, '.agent-skills-transaction');
    const ownedRoot = resolve(targetRoot, '.owned-transaction');
    const operatorNote = resolve(activeRoot, 'operator-note.txt');
    assert.throws(
      () => manageSkillsTarget({
        mode: 'install',
        sourceRoot,
        targetRoot,
        log: silent,
        faultInjector: (stage) => {
          if (stage !== 'before-finalize') return;
          renameSync(activeRoot, ownedRoot);
          mkdirSync(activeRoot);
          writeFileSync(operatorNote, 'unmanaged active replacement\n');
        },
      }),
      /cleanup failed|ownership|terminal journal/i,
    );
    assert.equal(readFileSync(operatorNote, 'utf8'), 'unmanaged active replacement\n');
    assert.ok(existsSync(resolve(ownedRoot, 'journal.json')));
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('after-finalize-rename cleanup replacement is preserved before recursive deletion', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    const cleanupRoot = resolve(targetRoot, '.agent-skills-transaction-cleanup');
    const ownedRoot = resolve(targetRoot, '.owned-cleanup');
    const operatorNote = resolve(cleanupRoot, 'operator-note.txt');
    assert.throws(
      () => manageSkillsTarget({
        mode: 'install',
        sourceRoot,
        targetRoot,
        log: silent,
        faultInjector: (stage) => {
          if (stage !== 'after-finalize-rename') return;
          renameSync(cleanupRoot, ownedRoot);
          mkdirSync(cleanupRoot);
          writeFileSync(operatorNote, 'unmanaged cleanup replacement\n');
        },
      }),
      /cleanup failed|ownership|terminal journal/i,
    );
    assert.equal(readFileSync(operatorNote, 'utf8'), 'unmanaged cleanup replacement\n');
    assert.ok(existsSync(resolve(ownedRoot, 'journal.json')));
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('before-finalize symlink swap is preserved and never renamed to cleanup', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  const externalRoot = makeTempDir('external-');
  try {
    const activeRoot = resolve(targetRoot, '.agent-skills-transaction');
    const ownedRoot = resolve(targetRoot, '.owned-transaction');
    const externalNote = resolve(externalRoot, 'operator-note.txt');
    writeFileSync(externalNote, 'external operator data\n');
    assert.throws(
      () => manageSkillsTarget({
        mode: 'install',
        sourceRoot,
        targetRoot,
        log: silent,
        faultInjector: (stage) => {
          if (stage !== 'before-finalize') return;
          renameSync(activeRoot, ownedRoot);
          symlinkSync(externalRoot, activeRoot, 'dir');
        },
      }),
      /symlink|cleanup failed|ownership/i,
    );
    assert.equal(readFileSync(externalNote, 'utf8'), 'external operator data\n');
    assert.ok(existsSync(activeRoot));
    assert.equal(existsSync(resolve(targetRoot, '.agent-skills-transaction-cleanup')), false);
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
    removeDir(externalRoot);
  }
});

test('after-finalize-rename symlink swap is preserved and never recursively deleted', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  const externalRoot = makeTempDir('external-');
  try {
    const cleanupRoot = resolve(targetRoot, '.agent-skills-transaction-cleanup');
    const ownedRoot = resolve(targetRoot, '.owned-cleanup');
    const externalNote = resolve(externalRoot, 'operator-note.txt');
    writeFileSync(externalNote, 'external cleanup data\n');
    assert.throws(
      () => manageSkillsTarget({
        mode: 'install',
        sourceRoot,
        targetRoot,
        log: silent,
        faultInjector: (stage) => {
          if (stage !== 'after-finalize-rename') return;
          renameSync(cleanupRoot, ownedRoot);
          symlinkSync(externalRoot, cleanupRoot, 'dir');
        },
      }),
      /symlink|cleanup failed|ownership/i,
    );
    assert.equal(readFileSync(externalNote, 'utf8'), 'external cleanup data\n');
    assert.ok(existsSync(cleanupRoot));
    assert.ok(existsSync(resolve(ownedRoot, 'journal.json')));
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
    removeDir(externalRoot);
  }
});

test('rollback failure preserves recovery material and reports both failures', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    assert.throws(
      () => manageSkillsTarget({
        mode: 'install',
        sourceRoot,
        targetRoot,
        log: silent,
        faultInjector: (stage) => {
          if (stage === 'after-write') throw new Error('write stage failed');
          if (stage === 'before-rollback') throw new Error('rollback unavailable');
        },
      }),
      /write stage failed.*rollback unavailable|rollback unavailable.*write stage failed/is,
    );
    assert.ok(existsSync(resolve(targetRoot, '.agent-skills-transaction/journal.json')));
    const check = manageSkillsTarget({ mode: 'check', sourceRoot, targetRoot, log: silent });
    assert.equal(check.ok, true);
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('multi-target cleanup failure leaves every target logically committed and recoverable', () => {
  const sourceRoot = fixtureSource();
  const first = makeTempDir('dst-');
  const second = makeTempDir('dst-');
  try {
    assert.throws(
      () => manageSkillsTargets({
        mode: 'install',
        sourceRoot,
        targetRoots: [first, second],
        log: silent,
        faultInjector: (stage, context) => {
          if (stage === 'before-finalize' && context.targetRoot === first) {
            throw new Error('first cleanup unavailable');
          }
        },
      }),
      /logically committed.*cleanup|cleanup.*committed/is,
    );
    for (const targetRoot of [first, second]) {
      assert.ok(existsSync(resolve(targetRoot, 'alpha/SKILL.md')));
      assert.ok(existsSync(resolve(targetRoot, '.agent-skills-receipt.json')));
      assert.ok(existsSync(resolve(targetRoot, '.agent-skills-transaction/journal.json')));
      assert.equal(manageSkillsTarget({ mode: 'check', sourceRoot, targetRoot, log: silent }).ok, true);
    }
  } finally {
    removeDir(sourceRoot);
    removeDir(first);
    removeDir(second);
  }
});

test('multi-target rollback failure preserves only the uncertain target recovery state', () => {
  const sourceRoot = fixtureSource();
  const first = makeTempDir('dst-');
  const second = makeTempDir('dst-');
  try {
    assert.throws(
      () => manageSkillsTargets({
        mode: 'install',
        sourceRoot,
        targetRoots: [first, second],
        log: silent,
        faultInjector: (stage, context) => {
          if (stage === 'after-write' && context.targetRoot === second) {
            throw new Error('second write failed');
          }
          if (stage === 'before-rollback' && context.targetRoot === second) {
            throw new Error('second rollback unavailable');
          }
        },
      }),
      /second write failed.*second rollback unavailable|second rollback unavailable.*second write failed/is,
    );
    assert.equal(existsSync(resolve(first, 'alpha/SKILL.md')), false);
    assert.ok(existsSync(resolve(second, '.agent-skills-transaction/journal.json')));
    assert.equal(manageSkillsTarget({ mode: 'check', sourceRoot, targetRoot: second, log: silent }).ok, true);
  } finally {
    removeDir(sourceRoot);
    removeDir(first);
    removeDir(second);
  }
});

test('multi-target recovery validates every journal before recovering any target', () => {
  const sourceRoot = fixtureSource();
  const first = makeTempDir('dst-');
  const second = makeTempDir('dst-');
  try {
    const crash = new Error('simulated crash');
    crash.simulateCrash = true;
    assert.throws(
      () => manageSkillsTarget({
        mode: 'install',
        sourceRoot,
        targetRoot: first,
        log: silent,
        faultInjector: (stage) => {
          if (stage === 'after-write') throw crash;
        },
      }),
      /simulated crash/,
    );
    mkdirSync(resolve(second, '.agent-skills-transaction'), { recursive: true });
    writeFileSync(resolve(second, '.agent-skills-transaction/journal.json'), '{}\n');
    assert.throws(
      () => manageSkillsTargets({
        mode: 'check',
        sourceRoot,
        targetRoots: [first, second],
        log: silent,
      }),
      /recovery failed closed/i,
    );
    assert.ok(existsSync(resolve(first, '.agent-skills-transaction/journal.json')));
  } finally {
    removeDir(sourceRoot);
    removeDir(first);
    removeDir(second);
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
      /Refusing to (remove|mutate)/,
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

test('receipt v3 rejects malformed selections before filesystem changes', () => {
  const sourceRoot = fixtureSource();
  try {
    const malformedSelections = [
      null,
      [],
      {},
      { catalog: true, packs: {}, extra: true },
      { catalog: 'yes', packs: {} },
      { catalog: true, packs: null },
      { catalog: true, packs: [] },
      { catalog: true, packs: { Bad_Name: '1.0.0' } },
      { catalog: true, packs: { valid: 'latest' } },
      { catalog: true, packs: Object.fromEntries([['__proto__', '1.0.0']]) },
      { catalog: true, packs: { constructor: '1.0.0' } },
      { catalog: true, packs: { prototype: '1.0.0' } },
    ];
    for (const selections of malformedSelections) {
      const targetRoot = makeTempDir('dst-');
      try {
        manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
        const receiptPath = resolve(targetRoot, '.agent-skills-receipt.json');
        const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
        receipt.selections = selections;
        writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
        assert.throws(
          () => manageSkillsTarget({ mode: 'uninstall', sourceRoot, targetRoot, log: silent }),
          /Malformed receipt|unknown receipt property|unsafe receipt object key/,
        );
        assert.ok(existsSync(resolve(targetRoot, 'alpha/SKILL.md')));
      } finally {
        removeDir(targetRoot);
      }
    }
  } finally {
    removeDir(sourceRoot);
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

test('a safe v1 receipt migrates deterministically to v3 on install', () => {
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
    assert.equal(migrated.schema_version, 3);
    assert.deepEqual(migrated.selections, { catalog: true, packs: {} });
    assert.deepEqual(migrated.resources.map((item) => item.destination).sort(),
      current.resources.map((item) => item.destination).sort());
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('a valid v2 full-catalog receipt migrates to catalog=true in v3', () => {
  const sourceRoot = fixtureSource();
  const targetRoot = makeTempDir('dst-');
  try {
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    const receiptPath = resolve(targetRoot, '.agent-skills-receipt.json');
    const v2 = JSON.parse(readFileSync(receiptPath, 'utf8'));
    v2.schema_version = 2;
    delete v2.selections;
    writeFileSync(receiptPath, `${JSON.stringify(v2)}\n`);
    manageSkillsTarget({ mode: 'install', sourceRoot, targetRoot, log: silent });
    const migrated = JSON.parse(readFileSync(receiptPath, 'utf8'));
    assert.equal(migrated.schema_version, 3);
    assert.deepEqual(migrated.selections, { catalog: true, packs: {} });
  } finally {
    removeDir(sourceRoot);
    removeDir(targetRoot);
  }
});

test('default-source v2 uninstall recovery uses its historical catalog after HEAD changes', () => {
  const repositoryRoot = makeTempDir('v2-recovery-repo-');
  const targetRoot = makeTempDir('v2-recovery-target-');
  try {
    for (const path of ['package.json', 'scripts', 'skills', 'registry']) {
      cpSync(resolve(path), resolve(repositoryRoot, path), { recursive: true });
    }
    execFileSync('git', ['init', '-q'], { cwd: repositoryRoot });
    execFileSync('git', ['config', 'user.email', 'tests@example.com'], { cwd: repositoryRoot });
    execFileSync('git', ['config', 'user.name', 'Tests'], { cwd: repositoryRoot });
    execFileSync('git', ['add', 'package.json', 'scripts', 'skills', 'registry'], { cwd: repositoryRoot });
    execFileSync('git', ['commit', '-qm', 'v2 catalog'], { cwd: repositoryRoot });

    const cli = resolve(repositoryRoot, 'scripts/manage-skills.mjs');
    execFileSync(process.execPath, [cli, 'install', '--dir', targetRoot], {
      cwd: repositoryRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const receiptPath = resolve(targetRoot, '.agent-skills-receipt.json');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    receipt.schema_version = 2;
    delete receipt.selections;
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    writeFileSync(resolve(targetRoot, 'operator-note.txt'), 'unmanaged\n');

    const changedResource = resolve(repositoryRoot, 'skills/code-review/references/review-checklist.md');
    writeFileSync(changedResource, `${readFileSync(changedResource, 'utf8')}\nCatalog descendant change.\n`);
    execFileSync('git', ['add', 'skills'], { cwd: repositoryRoot });
    execFileSync('git', ['commit', '-qm', 'change catalog resource'], { cwd: repositoryRoot });

    const crashRunner = resolve(repositoryRoot, 'crash-uninstall.mjs');
    writeFileSync(crashRunner, `
import { resolve } from 'node:path';
import { manageSkillsTarget } from './scripts/manage-skills.mjs';
manageSkillsTarget({
  mode: 'uninstall',
  sourceRoot: resolve('skills'),
  targetRoot: process.argv[2],
  log: () => {},
  faultInjector(stage) {
    if (stage === 'after-removal') process.exit(86);
  },
});
`);
    const crashed = spawnSync(process.execPath, [crashRunner, targetRoot], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    assert.equal(crashed.status, 86);
    const lockPath = resolve(targetRoot, '.agent-skills-operation.lock');
    assert.equal(existsSync(lockPath), true);
    assert.equal(existsSync(resolve(targetRoot, '.agent-skills-transaction/journal.json')), true);
    rmSync(lockPath);

    assert.match(execFileSync(process.execPath, [cli, 'uninstall', '--dir', targetRoot], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }), /not installed|uninstalled/i);
    assert.equal(existsSync(receiptPath), false);
    assert.equal(existsSync(resolve(targetRoot, 'code-review/SKILL.md')), false);
    assert.equal(readFileSync(resolve(targetRoot, 'operator-note.txt'), 'utf8'), 'unmanaged\n');
    assert.equal(existsSync(resolve(targetRoot, '.agent-skills-transaction')), false);
    assert.equal(existsSync(resolve(targetRoot, '.agent-skills-transaction-cleanup')), false);
  } finally {
    removeDir(repositoryRoot);
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

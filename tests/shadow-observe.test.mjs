import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  inventoryRepository,
  parseArguments,
} from '../skills/shadow-observe/scripts/inventory.mjs';
import { makeTempDir, removeDir, REPO_ROOT } from './helpers.mjs';

const SCRIPT = resolve(REPO_ROOT, 'skills/shadow-observe/scripts/inventory.mjs');

function createFixture(prefix) {
  const root = makeTempDir(prefix);
  mkdirSync(resolve(root, '.shadow'), { recursive: true });
  mkdirSync(resolve(root, 'src', 'nested'), { recursive: true });
  writeFileSync(resolve(root, '.shadow', 'README.md'), 'shadow');
  writeFileSync(resolve(root, 'src', 'a.js'), 'a');
  writeFileSync(resolve(root, 'src', 'nested', 'b.js'), 'b');
  return root;
}

function inventory(root, overrides = {}) {
  return inventoryRepository({
    root,
    maxDepth: 4,
    maxEntries: 2000,
    includeHidden: false,
    ...overrides,
  });
}

test('inventory output is deterministic and stably ordered', () => {
  const first = createFixture('shadow-observe-deterministic-a-');
  const second = makeTempDir('shadow-observe-deterministic-b-');
  try {
    mkdirSync(resolve(second, 'src', 'nested'), { recursive: true });
    writeFileSync(resolve(second, 'src', 'nested', 'b.js'), 'different contents');
    writeFileSync(resolve(second, 'src', 'a.js'), 'different contents');
    mkdirSync(resolve(second, '.shadow'), { recursive: true });
    writeFileSync(resolve(second, '.shadow', 'README.md'), 'different contents');

    const firstResult = inventory(first);
    const secondResult = inventory(second);
    assert.deepEqual(firstResult, secondResult);
    assert.deepEqual(
      firstResult.entries.map((entry) => entry.path),
      ['.shadow', '.shadow/README.md', 'src', 'src/a.js', 'src/nested', 'src/nested/b.js'],
    );
    assert.equal(firstResult.root, '.');
    assert.equal(JSON.stringify(firstResult).includes(first), false);
  } finally {
    removeDir(first);
    removeDir(second);
  }
});

test('inventory ignores generated and vendor directories while retaining discovery metadata', () => {
  const root = createFixture('shadow-observe-ignored-');
  try {
    for (const directory of ['node_modules', 'vendor', 'dist', 'coverage', '.git']) {
      mkdirSync(resolve(root, directory), { recursive: true });
      writeFileSync(resolve(root, directory, 'ignored.js'), 'ignored');
    }
    mkdirSync(resolve(root, '.private'), { recursive: true });
    writeFileSync(resolve(root, '.private', 'hidden.js'), 'hidden');

    const result = inventory(root);
    const paths = result.entries.map((entry) => entry.path);
    assert.ok(paths.includes('.shadow/README.md'));
    assert.equal(paths.some((path) => /node_modules|vendor|dist|coverage|\.git|\.private/.test(path)), false);
    assert.equal(result.summary.ignoredDirectories, 5);
    assert.equal(result.summary.hiddenEntries, 1);
  } finally {
    removeDir(root);
  }
});

test('inventory enforces depth and entry bounds', () => {
  const root = createFixture('shadow-observe-bounds-');
  try {
    const depthLimited = inventory(root, { maxDepth: 1 });
    assert.deepEqual(
      depthLimited.entries.map((entry) => entry.path),
      ['.shadow', 'src'],
    );
    assert.equal(depthLimited.depthLimited, true);
    assert.equal(depthLimited.truncated, false);

    const entryLimited = inventory(root, { maxEntries: 2 });
    assert.equal(entryLimited.entries.length, 2);
    assert.equal(entryLimited.truncated, true);
  } finally {
    removeDir(root);
  }
});

test('inventory records but never follows symlinks and rejects a symlink root', () => {
  const root = createFixture('shadow-observe-symlink-');
  const outside = makeTempDir('shadow-observe-outside-');
  const linkRoot = resolve(root, 'linked-root');
  try {
    writeFileSync(resolve(outside, 'secret.txt'), 'outside');
    symlinkSync(outside, resolve(root, 'src', 'outside-link'));
    symlinkSync(outside, linkRoot);

    const result = inventory(root);
    assert.deepEqual(
      result.entries.find((entry) => entry.path === 'src/outside-link'),
      { path: 'src/outside-link', type: 'symbolic-link', depth: 2 },
    );
    assert.equal(result.entries.some((entry) => entry.path.endsWith('secret.txt')), false);

    const failed = spawnSync(process.execPath, [SCRIPT, '--root', linkRoot], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(failed.status, 2);
    assert.match(failed.stderr, /symlink/i);
    assert.equal(failed.stdout, '');
  } finally {
    removeDir(root);
    removeDir(outside);
  }
});

test('argument parsing rejects malformed, duplicate, and out-of-range values', () => {
  assert.deepEqual(parseArguments(['--help']), { help: true });
  for (const args of [
    ['--unknown'],
    ['--root'],
    ['--root', ''],
    ['--max-depth', '-1'],
    ['--max-depth', '21'],
    ['--max-entries', '0'],
    ['--max-entries', '2.5'],
    ['--root', '.', '--root', '.'],
    ['--help', '--include-hidden'],
  ]) {
    assert.throws(() => parseArguments(args), /unknown|missing|integer|duplicate|combined/i);
  }
});

test('CLI help and exit codes are documented and no command writes output files', () => {
  const root = createFixture('shadow-observe-cli-');
  try {
    const before = readdirSync(root).sort();
    const help = spawnSync(process.execPath, [SCRIPT, '--help'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /^Usage: node scripts\/inventory\.mjs/);
    assert.match(help.stdout, /Exit codes:/);

    const success = spawnSync(process.execPath, [
      SCRIPT,
      '--root', root,
      '--max-depth', '2',
      '--max-entries', '20',
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(success.status, 0, success.stderr);
    assert.equal(JSON.parse(success.stdout).generator, 'shadow-observe-inventory');

    const usageFailure = spawnSync(process.execPath, [SCRIPT, '--bad'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(usageFailure.status, 1);
    assert.match(usageFailure.stderr, /unknown argument/i);

    const filesystemFailure = spawnSync(process.execPath, [
      SCRIPT,
      '--root', resolve(root, 'missing'),
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(filesystemFailure.status, 2);
    assert.match(filesystemFailure.stderr, /cannot access root/i);

    assert.deepEqual(readdirSync(root).sort(), before);
    assert.equal(readFileSync(resolve(root, 'src', 'a.js'), 'utf8'), 'a');
  } finally {
    removeDir(root);
  }
});

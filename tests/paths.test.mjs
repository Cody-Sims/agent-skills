import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveInside, assertNoSymlinks, walkFiles } from '../scripts/lib/paths.mjs';
import { makeTempDir, removeDir } from './helpers.mjs';

test('resolveInside rejects ../ escapes', () => {
  const root = makeTempDir('paths-');
  try {
    assert.throws(() => resolveInside(root, '../escape'), /escapes managed root/);
    assert.throws(() => resolveInside(root, '../../etc/passwd'), /escapes managed root/);
    const inside = resolveInside(root, 'a/b/c');
    assert.ok(inside.startsWith(resolve(root)));
  } finally {
    removeDir(root);
  }
});

test('assertNoSymlinks rejects a symlink component in the path', () => {
  const root = makeTempDir('paths-');
  try {
    const realDir = resolve(root, 'real');
    const linkDir = resolve(root, 'link');
    mkdirSync(realDir, { recursive: true });
    writeFileSync(resolve(realDir, 'file.md'), 'x');
    symlinkSync(realDir, linkDir);
    assert.throws(() => assertNoSymlinks(root, 'link/file.md'), /Refusing a symlink/);
    assert.doesNotThrow(() => assertNoSymlinks(root, 'real/file.md'));
  } finally {
    removeDir(root);
  }
});

test('walkFiles rejects symlinks in the tree', () => {
  const root = makeTempDir('paths-');
  try {
    writeFileSync(resolve(root, 'a.md'), 'a');
    symlinkSync(resolve(root, 'a.md'), resolve(root, 'b.md'));
    assert.throws(() => walkFiles(root), /Refusing a symlink/);
  } finally {
    removeDir(root);
  }
});

test('walkFiles includes git-prefixed resources and rejects a symlink root', () => {
  const root = makeTempDir('paths-');
  try {
    const realDir = resolve(root, 'real');
    const linkDir = resolve(root, 'link');
    mkdirSync(resolve(realDir, '.github'), { recursive: true });
    mkdirSync(resolve(realDir, '.git'), { recursive: true });
    writeFileSync(resolve(realDir, '.github', 'guide.md'), 'guide');
    writeFileSync(resolve(realDir, '.git-guide.md'), 'resource');
    writeFileSync(resolve(realDir, '.git', 'config'), 'metadata');
    symlinkSync(realDir, linkDir);

    assert.deepEqual(walkFiles(realDir), ['.git-guide.md', '.github/guide.md']);
    assert.throws(() => walkFiles(linkDir), /Refusing a symlink as a managed root/);
  } finally {
    removeDir(root);
  }
});

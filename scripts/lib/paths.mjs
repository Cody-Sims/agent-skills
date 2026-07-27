// Filesystem safety helpers: path containment, symlink rejection, hashing, and
// recursive file discovery. These mirror the Pokemon-Web global-agent-toolkit
// `resolveInside`/`assertNoSymlinks` design so that no resolved path can escape
// a managed root through `..` or a symlink component.

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, rmdirSync } from 'node:fs';
import { dirname, parse, relative, resolve, sep } from 'node:path';

export function resolveInside(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(resolvedRoot, candidate);
  if (resolvedCandidate !== resolvedRoot
      && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Path escapes managed root: ${candidate}`);
  }
  return resolvedCandidate;
}

export function pathEntryExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

// Rejects a symlink in any existing component of an absolute or relative path,
// including components before the supplied managed root.
export function assertNoSymlinkComponents(path) {
  const resolvedPath = resolve(path);
  const { root } = parse(resolvedPath);
  let current = root;
  for (const part of relative(root, resolvedPath).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (pathEntryExists(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing a symlink in a managed path: ${current}`);
    }
  }
  return resolvedPath;
}

// Resolves `candidate` under `root` and rejects the path if the root itself is
// a symlink or if any existing component between root and candidate is a
// symlink. This is stronger than a lexical prefix check.
export function assertNoSymlinks(root, candidate) {
  const resolvedRoot = resolve(root);
  if (pathEntryExists(resolvedRoot) && lstatSync(resolvedRoot).isSymbolicLink()) {
    throw new Error(`Refusing a symlink as a managed root: ${resolvedRoot}`);
  }
  const resolvedCandidate = resolveInside(resolvedRoot, candidate);
  const parts = relative(resolvedRoot, resolvedCandidate).split(sep).filter(Boolean);
  let current = resolvedRoot;
  for (const part of parts) {
    current = resolve(current, part);
    if (pathEntryExists(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing a symlink in a managed path: ${relative(resolvedRoot, current)}`);
    }
  }
  return resolvedCandidate;
}

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function sha256File(path) {
  return sha256(readFileSync(path));
}

export function sha256Tree(root) {
  const hash = createHash('sha256');
  for (const path of walkFiles(root)) {
    hash.update(`${Buffer.byteLength(path, 'utf8')}:`);
    hash.update(path);
    hash.update(`:${sha256File(resolve(root, path))}\n`);
  }
  return hash.digest('hex');
}

// Removes now-empty parent directories walking up from `path` but never crossing
// or removing `root`.
export function removeEmptyParents(path, root) {
  let current = dirname(path);
  const stop = resolve(root);
  while (current !== stop && current.startsWith(`${stop}${sep}`)) {
    try {
      rmdirSync(current);
    } catch {
      break;
    }
    current = dirname(current);
  }
}

const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

// Recursively lists regular files under `dir`, returning paths relative to
// `dir` with POSIX separators. Rejects symlinks encountered in the tree.
export function walkFiles(dir, { onSymlink = 'reject' } = {}) {
  const results = [];
  const root = resolve(dir);
  if (lstatSync(root).isSymbolicLink()) {
    throw new Error(`Refusing a symlink as a managed root: ${root}`);
  }
  const walk = (current, relBase) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (IGNORED_FILES.has(entry.name) || entry.name === '.git') continue;
      const abs = resolve(current, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        if (onSymlink === 'reject') {
          throw new Error(`Refusing a symlink in a managed path: ${rel}`);
        }
        continue;
      }
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        results.push(rel);
      }
    }
  };
  walk(root, '');
  return results;
}

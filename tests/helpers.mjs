// Shared test utilities. Temp directories are created under the repository's
// gitignored tmp/ directory (never the OS /tmp), and cleaned up by callers.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP_BASE = resolve(REPO_ROOT, 'tmp', 'test');

export function makeTempDir(prefix = 'case-') {
  mkdirSync(TMP_BASE, { recursive: true });
  return mkdtempSync(resolve(TMP_BASE, prefix));
}

export function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

// Writes a skill directory under `root` and returns its path.
export function writeSkill(root, name, { frontmatter, body = '# Title\n\nContent.\n', files = {} } = {}) {
  const dir = resolve(root, name);
  mkdirSync(dir, { recursive: true });
  const content = `---\n${frontmatter}\n---\n${body}`;
  writeFileSync(resolve(dir, 'SKILL.md'), content);
  for (const [relPath, fileContent] of Object.entries(files)) {
    const abs = resolve(dir, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, fileContent);
  }
  return dir;
}

// Standard valid frontmatter for a skill named `name`.
export function validFrontmatter(name) {
  return [
    `name: ${name}`,
    'description: Does a well-scoped thing for the repository and its maintainers. Use when performing that thing during development.',
    'license: MIT',
    'metadata:',
    '  version: "1.0.0"',
    '  tier: core',
  ].join('\n');
}

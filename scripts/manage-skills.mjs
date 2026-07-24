#!/usr/bin/env node

// Installs the portable skills catalog into per-runtime skill directories.
// Copies files (never symlinks), writes a sha256 receipt, is idempotent, and
// refuses to clobber files it does not manage. Generalizes the Pokemon-Web
// global-agent-toolkit manager. Never executes skill content and never makes
// network calls.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertNoSymlinks,
  pathEntryExists,
  removeEmptyParents,
  sha256,
  sha256File,
  walkFiles,
} from './lib/paths.mjs';
import { discoverSkills } from './lib/skills.mjs';
import { parseFrontmatter } from './lib/frontmatter.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCE_ROOT = resolve(REPOSITORY_ROOT, 'skills');
const RECEIPT_NAME = '.agent-skills-receipt.json';
const RECEIPT_SCHEMA_VERSION = 1;
const MODES = new Set(['install', 'check', 'uninstall', 'list']);

// Runtime target roots. Each maps to the vendor directory that holds skills.
export const TARGETS = {
  agents: resolve(homedir(), '.agents', 'skills'),
  claude: resolve(homedir(), '.claude', 'skills'),
  copilot: resolve(homedir(), '.copilot', 'skills'),
};
const ALL_TARGETS = ['agents', 'claude', 'copilot'];

function packageInfo() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, 'package.json'), 'utf8'));
    return {
      name: pkg.name ?? 'agent-skills',
      version: pkg.version ?? '0.0.0',
      repository: typeof pkg.repository === 'string'
        ? pkg.repository
        : pkg.repository?.url ?? pkg.name ?? 'agent-skills',
    };
  } catch {
    return { name: 'agent-skills', version: '0.0.0', repository: 'agent-skills' };
  }
}

// Builds the list of managed resources from the source skills tree. Each
// resource records its source-relative path (equal to its destination-relative
// path), content, and sha256.
function collectResources(sourceRoot) {
  const skills = discoverSkills(sourceRoot);
  const resources = [];
  for (const skill of skills) {
    const files = walkFiles(skill.dir);
    for (const fileRel of files) {
      const rel = `${skill.name}/${fileRel}`;
      const sourcePath = assertNoSymlinks(sourceRoot, rel);
      const content = readFileSync(sourcePath);
      resources.push({ relPath: rel, content, sha256: sha256(content) });
    }
  }
  return resources.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
}

function loadReceipt(targetRoot) {
  const receiptPath = assertNoSymlinks(targetRoot, RECEIPT_NAME);
  if (!existsSync(receiptPath)) return null;
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  if (receipt.schema_version !== RECEIPT_SCHEMA_VERSION || !Array.isArray(receipt.resources)) {
    throw new Error(`Malformed receipt at ${receiptPath}.`);
  }
  return receipt;
}

function receiptMap(receipt) {
  return new Map((receipt?.resources ?? []).map((r) => [r.destination, r]));
}

function writeReceipt(receiptPath, targetRoot, info, resources) {
  mkdirSync(targetRoot, { recursive: true });
  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    source_repository: info.repository,
    version: info.version,
    installed_at: new Date().toISOString(),
    resources: resources.map((r) => ({
      source: `skills/${r.relPath}`,
      destination: r.relPath,
      sha256: r.sha256,
    })),
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}

// Runs a mode against a single target root. Returns { ok, drift } for `check`.
export function manageSkillsTarget({
  mode,
  sourceRoot = DEFAULT_SOURCE_ROOT,
  targetRoot,
  dryRun = false,
  log = console.log,
}) {
  if (!MODES.has(mode)) {
    throw new Error(`Mode must be one of: ${[...MODES].join(', ')}.`);
  }
  if (!targetRoot) throw new Error('A target root is required.');

  const info = packageInfo();
  const resources = collectResources(sourceRoot);
  const receiptPath = assertNoSymlinks(targetRoot, RECEIPT_NAME);
  const receipt = loadReceipt(targetRoot);
  const previous = receiptMap(receipt);
  const currentDestinations = new Set(resources.map((r) => r.relPath));
  const retired = (receipt?.resources ?? []).filter((r) => !currentDestinations.has(r.destination));

  if (mode === 'list') {
    for (const skill of discoverSkills(sourceRoot)) {
      const { data } = parseFrontmatter(readFileSync(resolve(skill.dir, 'SKILL.md'), 'utf8'));
      const version = data.metadata?.version ?? 'unversioned';
      const description = String(data.description ?? '').replace(/\s+/g, ' ').trim();
      const oneLine = description.length > 100 ? `${description.slice(0, 97)}...` : description;
      log(`${skill.name}\t${version}\t${oneLine}`);
    }
    return { ok: true };
  }

  if (mode === 'check') {
    const drift = [];
    if (!receipt) {
      drift.push({ kind: 'not-installed', detail: `No receipt in ${targetRoot}.` });
      log(`skills are not installed in ${targetRoot}.`);
      return { ok: false, drift };
    }
    if (retired.length > 0 || receipt.resources.length !== resources.length) {
      drift.push({ kind: 'stale-set', detail: 'Installed resource set differs from the catalog.' });
    }
    for (const resource of resources) {
      const destinationPath = assertNoSymlinks(targetRoot, resource.relPath);
      const prev = previous.get(resource.relPath);
      if (!prev || prev.sha256 !== resource.sha256) {
        drift.push({ kind: 'stale', detail: resource.relPath });
        continue;
      }
      if (!pathEntryExists(destinationPath)) {
        drift.push({ kind: 'missing', detail: resource.relPath });
        continue;
      }
      if (sha256File(destinationPath) !== resource.sha256) {
        drift.push({ kind: 'modified', detail: resource.relPath });
      }
    }
    if (drift.length === 0) {
      log(`skills ${info.version} are installed and current in ${targetRoot}.`);
      return { ok: true, drift };
    }
    for (const item of drift) {
      log(`drift (${item.kind}): ${item.detail}`);
    }
    return { ok: false, drift };
  }

  if (mode === 'uninstall') {
    if (!receipt) {
      log(`skills are not installed in ${targetRoot}.`);
      return { ok: true };
    }
    // Preflight: refuse if any managed file was locally modified.
    for (const installed of receipt.resources) {
      const destinationPath = assertNoSymlinks(targetRoot, installed.destination);
      if (pathEntryExists(destinationPath) && sha256File(destinationPath) !== installed.sha256) {
        throw new Error(`Refusing to remove locally modified file: ${installed.destination}. Restore or delete it manually.`);
      }
    }
    if (dryRun) {
      log(`[dry-run] would remove ${receipt.resources.length} file(s) and the receipt from ${targetRoot}.`);
      return { ok: true };
    }
    for (const installed of receipt.resources) {
      const destinationPath = assertNoSymlinks(targetRoot, installed.destination);
      rmSync(destinationPath, { force: true });
      removeEmptyParents(destinationPath, targetRoot);
    }
    rmSync(receiptPath, { force: true });
    log(`Uninstalled skills from ${targetRoot}.`);
    return { ok: true };
  }

  // mode === 'install'
  // Preflight retired resources: only remove if unmodified.
  for (const item of retired) {
    const destinationPath = assertNoSymlinks(targetRoot, item.destination);
    if (pathEntryExists(destinationPath) && sha256File(destinationPath) !== item.sha256) {
      throw new Error(`Refusing to remove locally modified retired file: ${item.destination}. Restore or delete it manually.`);
    }
  }
  // Preflight destinations: refuse to overwrite unmanaged or modified files.
  const conflicts = [];
  for (const resource of resources) {
    const destinationPath = assertNoSymlinks(targetRoot, resource.relPath);
    if (!pathEntryExists(destinationPath)) continue;
    const installedHash = sha256File(destinationPath);
    const prev = previous.get(resource.relPath);
    if (installedHash !== resource.sha256 && (!prev || installedHash !== prev.sha256)) {
      conflicts.push({ relPath: resource.relPath, path: destinationPath });
    }
  }
  if (conflicts.length > 0) {
    const list = conflicts.map((c) => `  - ${c.path}`).join('\n');
    const message = `Refusing to overwrite ${conflicts.length} unmanaged or locally modified file(s) in ${targetRoot}:\n${list}\n`
      + 'These files were not installed by agent-skills. Move or remove them, or choose a different --dir/--target, then retry.';
    if (dryRun) {
      log(`[dry-run] CONFLICT: ${message}`);
      return { ok: false, conflicts };
    }
    throw new Error(message);
  }

  // Detect an already-current installation.
  const current = receipt
    && receipt.version === info.version
    && retired.length === 0
    && receipt.resources.length === resources.length
    && resources.every((resource) => {
      const destinationPath = assertNoSymlinks(targetRoot, resource.relPath);
      return pathEntryExists(destinationPath)
        && sha256File(destinationPath) === resource.sha256
        && previous.get(resource.relPath)?.sha256 === resource.sha256;
    });
  if (current) {
    log(`skills ${info.version} are already current in ${targetRoot}.`);
    return { ok: true, alreadyCurrent: true };
  }

  if (dryRun) {
    log(`[dry-run] would install ${resources.length} file(s)`
      + `${retired.length ? ` and remove ${retired.length} retired file(s)` : ''} in ${targetRoot}.`);
    return { ok: true };
  }

  for (const resource of resources) {
    const destinationPath = assertNoSymlinks(targetRoot, resource.relPath);
    mkdirSync(dirname(destinationPath), { recursive: true });
    writeFileSync(destinationPath, resource.content);
  }
  for (const item of retired) {
    const destinationPath = assertNoSymlinks(targetRoot, item.destination);
    rmSync(destinationPath, { force: true });
    removeEmptyParents(destinationPath, targetRoot);
  }
  writeReceipt(receiptPath, targetRoot, info, resources);
  log(`Installed ${resources.length} file(s) for skills ${info.version} in ${targetRoot}.`);
  return { ok: true };
}

function resolveTargetRoots({ target, dir }) {
  if (dir) return [resolve(dir)];
  if (!target || target === 'all') return ALL_TARGETS.map((t) => TARGETS[t]);
  if (!(target in TARGETS)) {
    throw new Error(`Unknown --target "${target}". Use one of: ${[...ALL_TARGETS, 'all'].join(', ')}.`);
  }
  return [TARGETS[target]];
}

function parseArguments(args) {
  const options = { mode: 'check', target: 'all', dir: undefined, dryRun: false };
  if (args[0] && !args[0].startsWith('--')) {
    options.mode = args[0];
    args = args.slice(1);
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--target') {
      options.target = args[i + 1];
      i += 1;
    } else if (arg === '--dir') {
      options.dir = args[i + 1];
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--agent') {
      // Alias for --target, matching CI naming.
      options.target = args[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.target === undefined && !options.dir) {
    throw new Error('--target requires a runtime name.');
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const targetRoots = resolveTargetRoots(options);
  let anyFailure = false;
  for (const targetRoot of targetRoots) {
    const result = manageSkillsTarget({
      mode: options.mode,
      targetRoot,
      dryRun: options.dryRun,
    });
    if (result && result.ok === false) anyFailure = true;
  }
  if (anyFailure) process.exitCode = 1;
}

const isEntryPoint = typeof process.argv[1] === 'string'
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

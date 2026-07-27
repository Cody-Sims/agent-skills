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
import { execFileSync } from 'node:child_process';
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
const RECEIPT_SCHEMA_VERSION = 2;
const LEGACY_RECEIPT_SCHEMA_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SOURCE_REPOSITORY = 'https://github.com/Cody-Sims/agent-skills';
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
        : pkg.repository?.url ?? SOURCE_REPOSITORY,
    };
  } catch {
    return { name: 'agent-skills', version: '0.0.0', repository: SOURCE_REPOSITORY };
  }
}

function immutableSourceIdentity(info, commit) {
  if (!COMMIT_PATTERN.test(commit)) throw new Error('Catalog commit is not a full Git SHA.');
  return {
    type: 'git-commit',
    repository: normalizeRepository(info.repository),
    ref: commit,
    commit,
  };
}

function parseNulDelimitedPaths(output) {
  const paths = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    paths.push(output.subarray(start, index).toString('utf8'));
    start = index + 1;
  }
  if (start !== output.length) {
    throw new Error('Git returned a malformed NUL-delimited tree listing.');
  }
  return paths;
}

// Builds the list of managed resources from the source skills tree. Each
// resource records its source-relative path (equal to its destination-relative
// path), content, and sha256.
export function collectCatalog(sourceRoot) {
  const skills = discoverSkills(sourceRoot);
  const resources = [];
  const versions = {};
  for (const skill of skills) {
    const { data } = parseFrontmatter(readFileSync(resolve(skill.dir, 'SKILL.md'), 'utf8'));
    versions[skill.name] = data.metadata?.version ?? null;
    const files = walkFiles(skill.dir);
    for (const fileRel of files) {
      const rel = `${skill.name}/${fileRel}`;
      const sourcePath = assertNoSymlinks(sourceRoot, rel);
      const content = readFileSync(sourcePath);
      resources.push({ skill: skill.name, relPath: rel, content, sha256: sha256(content) });
    }

  }
  resources.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  const defaultRegistry = resolve(REPOSITORY_ROOT, 'registry', 'skills.json');
  const registryDigest = resolve(sourceRoot) === DEFAULT_SOURCE_ROOT && existsSync(defaultRegistry)
    ? sha256File(defaultRegistry)
    : sha256(JSON.stringify(resources.map(({ relPath, sha256: hash }) => [relPath, hash])));
  return { resources, versions, registryDigest };
}

export function assertBufferedCatalogMatchesCommit(catalog, {
  root = REPOSITORY_ROOT,
  skillsRoot = DEFAULT_SOURCE_ROOT,
  registryPath = resolve(REPOSITORY_ROOT, 'registry', 'skills.json'),
  commit,
} = {}) {
  if (!COMMIT_PATTERN.test(commit ?? '')) {
    throw new Error('A full verified commit SHA is required to bind buffered resources.');
  }
  const skillsPrefix = relative(root, skillsRoot).split(sep).join('/');
  const committedPaths = parseNulDelimitedPaths(execFileSync(
    'git',
    ['ls-tree', '-rz', '--name-only', commit, '--', skillsPrefix],
    { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] },
  )).map((path) => path.slice(skillsPrefix.length + 1)).sort(compareCodePoints);
  const bufferedPaths = catalog.resources.map((resource) => resource.relPath).sort(compareCodePoints);
  if (JSON.stringify(bufferedPaths) !== JSON.stringify(committedPaths)) {
    throw new Error('buffered resource set differs from verified commit.');
  }
  for (const resource of catalog.resources) {
    const committed = execFileSync(
      'git',
      ['show', `${commit}:${skillsPrefix}/${resource.relPath}`],
      { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 },
    );
    const bufferedHash = sha256(resource.content);
    if (resource.sha256 !== bufferedHash || bufferedHash !== sha256(committed)) {
      throw new Error(`buffered resource differs from verified commit: ${resource.relPath}.`);
    }
    if (resource.relPath.endsWith('/SKILL.md')) {
      const { data } = parseFrontmatter(committed.toString('utf8'));
      if (catalog.versions[resource.skill] !== (data.metadata?.version ?? null)) {
        throw new Error(`buffered skill version differs from verified commit: ${resource.skill}.`);
      }
    }
  }
  const registryRel = relative(root, registryPath).split(sep).join('/');
  const committedRegistry = execFileSync(
    'git',
    ['show', `${commit}:${registryRel}`],
    { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 },
  );
  if (catalog.registryDigest !== sha256(committedRegistry)) {
    throw new Error('buffered registry digest differs from verified commit.');
  }
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeRepository(repository) {
  if (typeof repository !== 'string') return repository;
  let normalized = repository;
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  if (normalized.endsWith('.git')) normalized = normalized.slice(0, -4);
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

function localSourceIdentity() {
  return {
    type: 'local-unverified',
    repository: 'local://unverified',
    ref: null,
    commit: null,
  };
}

function assertRegistryMatchesResources(skillsRoot, registryPath) {
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const skills = discoverSkills(skillsRoot);
  const entries = new Map((registry.skills ?? []).map((entry) => [entry.name, entry]));
  if (!Array.isArray(registry.skills)
    || entries.size !== registry.skills.length
    || entries.size !== skills.length) {
    throw new Error('registry does not match copied resources: skill set differs.');
  }
  for (const skill of skills) {
    const entry = entries.get(skill.name);
    const skillContent = readFileSync(resolve(skill.dir, 'SKILL.md'), 'utf8');
    const { data } = parseFrontmatter(skillContent);
    const resources = walkFiles(skill.dir).filter((path) => path !== 'SKILL.md').sort(compareCodePoints);
    if (!entry
      || entry.sha256 !== sha256(skillContent)
      || entry.version !== (data.metadata?.version ?? null)
      || JSON.stringify(entry.resources) !== JSON.stringify(resources)) {
      throw new Error(`registry does not match copied resources for ${skill.name}.`);
    }
  }
}

function assertCatalogTreeMatchesCommit(root, skillsRoot, registryPath, commit) {
  const registryRoot = dirname(registryPath);
  const roots = [skillsRoot, registryRoot];
  const currentPaths = roots.flatMap((catalogRoot) => {
    const prefix = relative(root, catalogRoot).split(sep).join('/');
    return walkFiles(catalogRoot).map((path) => `${prefix}/${path}`);
  }).sort(compareCodePoints);
  const pathspecs = roots.map((catalogRoot) => relative(root, catalogRoot).split(sep).join('/'));
  const committedPaths = parseNulDelimitedPaths(execFileSync(
    'git',
    ['ls-tree', '-rz', '--name-only', commit, '--', ...pathspecs],
    { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] },
  )).sort(compareCodePoints);
  if (JSON.stringify(currentPaths) !== JSON.stringify(committedPaths)) {
    throw new Error('catalog source is dirty: tracked file set differs from the claimed commit.');
  }
  for (const path of currentPaths) {
    const current = readFileSync(resolve(root, path));
    const committed = execFileSync(
      'git',
      ['show', `${commit}:${path}`],
      { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 },
    );
    if (sha256(current) !== sha256(committed)) {
      throw new Error(`catalog source is dirty: ${path} differs from the claimed commit.`);
    }
  }
}

export function verifyDefaultCatalogSource({
  root = REPOSITORY_ROOT,
  skillsRoot = DEFAULT_SOURCE_ROOT,
  registryPath = resolve(REPOSITORY_ROOT, 'registry', 'skills.json'),
  commit,
} = {}) {
  const claimedCommit = commit ?? execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (!COMMIT_PATTERN.test(claimedCommit)) throw new Error('Catalog commit is not a full Git SHA.');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (head !== claimedCommit) throw new Error('Claimed catalog commit is not repository HEAD.');
  const pathspecs = [
    relative(root, skillsRoot).split(sep).join('/'),
    relative(root, dirname(registryPath)).split(sep).join('/'),
  ];
  const dirty = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all', '--', ...pathspecs],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim();
  if (dirty) throw new Error(`catalog source is dirty and cannot claim HEAD:\n${dirty}`);
  assertCatalogTreeMatchesCommit(root, skillsRoot, registryPath, claimedCommit);
  assertRegistryMatchesResources(skillsRoot, registryPath);
  return claimedCommit;
}

function assertSafeReceiptDestination(destination) {
  if (typeof destination !== 'string'
    || destination.length === 0
    || destination.includes('\\')
    || destination.startsWith('/')
    || destination.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`unsafe receipt destination: ${JSON.stringify(destination)}.`);
  }
}

function assertReceiptKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`unknown receipt property ${label}.${unknown[0]}.`);
  }
}

function validateReceipt(receipt, receiptPath) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || ![LEGACY_RECEIPT_SCHEMA_VERSION, RECEIPT_SCHEMA_VERSION].includes(receipt.schema_version)
    || !Array.isArray(receipt.resources)) {
    throw new Error(`Malformed receipt at ${receiptPath}.`);
  }
  const legacy = receipt.schema_version === LEGACY_RECEIPT_SCHEMA_VERSION;
  assertReceiptKeys(receipt, new Set(legacy
    ? ['schema_version', 'source_repository', 'version', 'installed_at', 'resources']
    : ['schema_version', 'source', 'registry_sha256', 'skills', 'version', 'installed_at', 'resources']),
  '$');
  if (typeof receipt.version !== 'string'
    || !/^\d+\.\d+\.\d+$/.test(receipt.version)
    || typeof receipt.installed_at !== 'string'
    || Number.isNaN(Date.parse(receipt.installed_at))) {
    throw new Error(`Malformed receipt at ${receiptPath}.`);
  }
  const destinations = new Set();
  for (const resource of receipt.resources) {
    if (!resource || typeof resource !== 'object') throw new Error(`Malformed receipt at ${receiptPath}.`);
    assertReceiptKeys(resource, new Set(legacy
      ? ['source', 'destination', 'sha256']
      : ['source', 'skill', 'destination', 'sha256']), '$.resources[]');
    assertSafeReceiptDestination(resource.destination);
    if (destinations.has(resource.destination)) {
      throw new Error(`duplicate receipt destination: ${resource.destination}.`);
    }
    destinations.add(resource.destination);
    if (resource.source !== `skills/${resource.destination}` || !SHA256_PATTERN.test(resource.sha256 ?? '')) {
      throw new Error(`Malformed receipt resource ${resource.destination} at ${receiptPath}.`);
    }
  }
  if (legacy) {
    if (typeof receipt.source_repository !== 'string' || receipt.source_repository.length === 0) {
      throw new Error(`Malformed receipt at ${receiptPath}.`);
    }
    return receipt;
  }
  assertReceiptKeys(receipt.source ?? {}, new Set(['type', 'repository', 'ref', 'commit']), '$.source');
  if (!receipt.source || typeof receipt.source !== 'object'
    || !SHA256_PATTERN.test(receipt.registry_sha256 ?? '')
    || !receipt.skills || typeof receipt.skills !== 'object' || Array.isArray(receipt.skills)) {
    throw new Error(`Malformed receipt at ${receiptPath}.`);
  }
  const immutable = receipt.source.type === 'git-commit'
    && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(receipt.source.repository ?? '')
    && COMMIT_PATTERN.test(receipt.source.ref ?? '')
    && COMMIT_PATTERN.test(receipt.source.commit ?? '')
    && receipt.source.ref === receipt.source.commit;
  const local = receipt.source.type === 'local-unverified'
    && receipt.source.repository === 'local://unverified'
    && receipt.source.ref === null
    && receipt.source.commit === null;
  if (!immutable && !local) throw new Error(`Malformed receipt source at ${receiptPath}.`);
  for (const [skill, version] of Object.entries(receipt.skills)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)
      || (version !== null && !/^\d+\.\d+\.\d+$/.test(version))) {
      throw new Error(`Malformed receipt skill metadata at ${receiptPath}.`);
    }
  }
  for (const resource of receipt.resources) {
    const skill = resource.destination.split('/')[0];
    if (resource.skill !== skill || !(skill in receipt.skills)) {
      throw new Error(`Malformed receipt skill ownership for ${resource.destination}.`);
    }
  }
  return receipt;
}

function loadReceipt(targetRoot) {
  const receiptPath = assertNoSymlinks(targetRoot, RECEIPT_NAME);
  if (!existsSync(receiptPath)) return null;
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  return validateReceipt(receipt, receiptPath);
}

function receiptMap(receipt) {
  return new Map((receipt?.resources ?? []).map((r) => [r.destination, r]));
}

function writeReceipt(receiptPath, targetRoot, info, identity, catalog, resources) {
  mkdirSync(targetRoot, { recursive: true });
  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    source: identity,
    registry_sha256: catalog.registryDigest,
    skills: catalog.versions,
    version: info.version,
    installed_at: new Date().toISOString(),
    resources: resources.map((r) => ({
      source: `skills/${r.relPath}`,
      skill: r.skill,
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
  verifySource = verifyDefaultCatalogSource,
  bindCatalog = assertBufferedCatalogMatchesCommit,
}) {
  if (!MODES.has(mode)) {
    throw new Error(`Mode must be one of: ${[...MODES].join(', ')}.`);
  }
  if (!targetRoot) throw new Error('A target root is required.');

  const info = packageInfo();
  const defaultSource = resolve(sourceRoot) === DEFAULT_SOURCE_ROOT;
  let verifiedCommit = null;
  if (defaultSource && (mode === 'install' || mode === 'check')) {
    verifiedCommit = verifySource();
  }
  const catalog = collectCatalog(sourceRoot);
  if (defaultSource && (mode === 'install' || mode === 'check')) {
    const finalCommit = verifySource();
    if (verifiedCommit !== finalCommit) {
      throw new Error('Catalog HEAD changed while resources were being collected.');
    }
    verifiedCommit = finalCommit;
    bindCatalog(catalog, { commit: verifiedCommit });
  }
  const { resources } = catalog;
  const identity = defaultSource && verifiedCommit
    ? immutableSourceIdentity(info, verifiedCommit)
    : defaultSource
      ? { repository: normalizeRepository(info.repository) }
      : localSourceIdentity();
  const receiptPath = assertNoSymlinks(targetRoot, RECEIPT_NAME);
  const receipt = loadReceipt(targetRoot);
  if (receipt?.schema_version === LEGACY_RECEIPT_SCHEMA_VERSION
    && normalizeRepository(receipt.source_repository) !== normalizeRepository(identity.repository)) {
    throw new Error('Refusing to trust a foreign legacy receipt as ownership evidence.');
  }
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
    if (receipt.schema_version !== RECEIPT_SCHEMA_VERSION) {
      drift.push({ kind: 'receipt-version', detail: 'Receipt requires safe migration to v2.' });
    } else {
      if (receipt.source.repository !== identity.repository
        || receipt.source.ref !== identity.ref
        || receipt.source.commit !== identity.commit) {
        drift.push({ kind: 'identity', detail: 'Installed source identity differs from this catalog.' });
      }
      if (receipt.registry_sha256 !== catalog.registryDigest) {
        drift.push({ kind: 'catalog', detail: 'Installed registry digest differs from this catalog.' });
      }
      if (JSON.stringify(receipt.skills) !== JSON.stringify(catalog.versions)) {
        drift.push({ kind: 'skill-versions', detail: 'Installed skill versions differ from this catalog.' });
      }
    }
    if (retired.length > 0 || receipt.resources.length !== resources.length) {
      drift.push({ kind: 'stale-set', detail: 'Installed resource set differs from the catalog.' });
    }
    for (const resource of resources) {
      const destinationPath = assertNoSymlinks(targetRoot, resource.relPath);
      const prev = previous.get(resource.relPath);
      if (!prev || prev.sha256 !== resource.sha256) {
        const destinationPath = assertNoSymlinks(targetRoot, resource.relPath);
        if (prev && pathEntryExists(destinationPath)
          && sha256File(destinationPath) === resource.sha256) {
          drift.push({ kind: 'receipt-tampered', detail: resource.relPath });
        } else {
          drift.push({ kind: 'stale', detail: resource.relPath });
        }
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
    if (!prev || installedHash !== prev.sha256) {
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
    && receipt.schema_version === RECEIPT_SCHEMA_VERSION
    && receipt.source.repository === identity.repository
    && receipt.source.ref === identity.ref
    && receipt.source.commit === identity.commit
    && receipt.registry_sha256 === catalog.registryDigest
    && JSON.stringify(receipt.skills) === JSON.stringify(catalog.versions)
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
  writeReceipt(receiptPath, targetRoot, info, identity, catalog, resources);
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

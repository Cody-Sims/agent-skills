#!/usr/bin/env node

// Installs the portable skills catalog into per-runtime skill directories.
// Copies files (never symlinks), writes a sha256 receipt, is idempotent, and
// refuses to clobber files it does not manage. Generalizes the Pokemon-Web
// global-agent-toolkit manager. Never executes skill content and never makes
// network calls.

import {
  existsSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
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
const TRANSACTION_NAME = '.agent-skills-transaction';
const TRANSACTION_CLEANUP_NAME = '.agent-skills-transaction-cleanup';
const TRANSACTION_OWNER_NAME = '.owner.json';
const LOCK_NAME = '.agent-skills-operation.lock';
const RECEIPT_SCHEMA_VERSION = 3;
const PREVIOUS_RECEIPT_SCHEMA_VERSION = 2;
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
  const adjacentRegistry = resolve(sourceRoot, '..', 'registry', 'skills.json');
  const registryPath = resolve(sourceRoot) === DEFAULT_SOURCE_ROOT
    ? defaultRegistry
    : adjacentRegistry;
  const registry = existsSync(registryPath)
    ? JSON.parse(readFileSync(registryPath, 'utf8'))
    : null;
  const registryDigest = registry
    ? sha256File(registryPath)
    : sha256(JSON.stringify(resources.map(({ relPath, sha256: hash }) => [relPath, hash])));
  return {
    resources,
    versions,
    registryDigest,
    packs: registry?.schemaVersion === 5 ? registry.packs ?? [] : [],
    removedPacks: registry?.schemaVersion === 5 ? registry.removedPacks ?? {} : {},
  };
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

export function verifyDefaultReceiptProvenance(receipt, {
  root = REPOSITORY_ROOT,
  skillsRoot = DEFAULT_SOURCE_ROOT,
  registryPath = resolve(REPOSITORY_ROOT, 'registry', 'skills.json'),
  repository = packageInfo().repository,
  verifiedHead,
} = {}) {
  if (receipt.schema_version === LEGACY_RECEIPT_SCHEMA_VERSION
    || receipt.source?.type !== 'git-commit'
    || normalizeRepository(receipt.source.repository) !== normalizeRepository(repository)
    || !COMMIT_PATTERN.test(receipt.source.commit ?? '')
    || receipt.source.ref !== receipt.source.commit) {
    throw new Error('Receipt provenance is not bound to this repository and an immutable commit.');
  }
  if (!COMMIT_PATTERN.test(verifiedHead ?? '')) {
    throw new Error('Receipt provenance requires the already verified current HEAD.');
  }
  const commit = receipt.source.commit;
  execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const ancestry = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', commit, verifiedHead],
    { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] },
  );
  if (ancestry.error) {
    throw new Error(`Could not execute Git ancestry verification: ${ancestry.error.message}`);
  }
  if (ancestry.status === 1) {
    throw new Error(`Receipt commit ${commit} is not an ancestor of verified HEAD ${verifiedHead}.`);
  }
  if (ancestry.status !== 0) {
    const outcome = ancestry.signal
      ? `signal ${ancestry.signal}`
      : `exit status ${String(ancestry.status)}`;
    throw new Error(`Git ancestry verification failed with ${outcome}.`);
  }
  const registryRel = relative(root, registryPath).split(sep).join('/');
  const registryBytes = execFileSync('git', ['show', `${commit}:${registryRel}`], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (sha256(registryBytes) !== receipt.registry_sha256) {
    throw new Error('Receipt registry provenance differs from its immutable commit.');
  }
  const registry = JSON.parse(registryBytes.toString('utf8'));
  const registrySkills = new Map((registry.skills ?? []).map((entry) => [entry.name, entry]));
  if (registrySkills.size !== (registry.skills ?? []).length) {
    throw new Error('Receipt provenance registry has duplicate skill names.');
  }
  const selectedSkills = new Map();
  if (receipt.schema_version < RECEIPT_SCHEMA_VERSION || receipt.selections.catalog) {
    for (const entry of registrySkills.values()) selectedSkills.set(entry.name, entry.version ?? null);
  } else {
    const registryPacks = new Map((registry.packs ?? []).map((pack) => [pack.name, pack]));
    for (const [name, version] of Object.entries(receipt.selections.packs)) {
      const pack = registryPacks.get(name);
      if (!pack || pack.version !== version) {
        throw new Error(`Receipt pack provenance differs from its immutable commit: ${name}@${version}.`);
      }
      for (const member of pack.skills) {
        const entry = registrySkills.get(member.name);
        if (!entry || entry.version !== member.version) {
          throw new Error(`Receipt pack member provenance differs from its immutable commit: ${member.name}@${member.version}.`);
        }
        selectedSkills.set(member.name, member.version);
      }
    }
  }
  const expectedSkills = Object.fromEntries(
    [...selectedSkills].sort(([left], [right]) => compareCodePoints(left, right)),
  );
  if (JSON.stringify(receipt.skills) !== JSON.stringify(expectedSkills)) {
    throw new Error('Receipt skill provenance differs from its immutable commit.');
  }
  const skillsPrefix = relative(root, skillsRoot).split(sep).join('/');
  const expectedResources = new Map();
  for (const skill of selectedSkills.keys()) {
    const entry = registrySkills.get(skill);
    for (const resource of ['SKILL.md', ...(entry.resources ?? [])]) {
      const destination = `${skill}/${resource}`;
      expectedResources.set(destination, `${skillsPrefix}/${destination}`);
    }
  }
  if (receipt.resources.length !== expectedResources.size) {
    throw new Error('Receipt resource provenance is incomplete for its immutable commit.');
  }
  const receiptResources = new Map(receipt.resources.map((resource) => [resource.destination, resource]));
  if (receiptResources.size !== receipt.resources.length) {
    throw new Error('Receipt resource provenance contains duplicate destinations.');
  }
  const historicalResources = [];
  for (const [destination, committedPath] of expectedResources) {
    const resource = receiptResources.get(destination);
    if (!resource
      || resource.source !== `skills/${destination}`
      || resource.skill !== destination.split('/')[0]) {
      throw new Error(`Receipt resource provenance differs from its immutable commit: ${destination}.`);
    }
    const committedBytes = execFileSync('git', ['show', `${commit}:${committedPath}`], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
    });
    if (sha256(committedBytes) !== resource.sha256) {
      throw new Error(`Receipt resource provenance differs from its immutable commit: ${destination}.`);
    }
    historicalResources.push({
      source: `skills/${destination}`,
      skill: destination.split('/')[0],
      destination,
      sha256: sha256(committedBytes),
    });
  }
  return { commit, resources: historicalResources };
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Malformed receipt property ${label}.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`unknown receipt property ${label}.${unknown[0]}.`);
  }
}

function assertSafeObjectKey(key, label) {
  if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
    throw new Error(`unsafe receipt object key ${label}.${key}.`);
  }
}

function validateReceipt(receipt, receiptPath) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || ![
      LEGACY_RECEIPT_SCHEMA_VERSION,
      PREVIOUS_RECEIPT_SCHEMA_VERSION,
      RECEIPT_SCHEMA_VERSION,
    ].includes(receipt.schema_version)
    || !Array.isArray(receipt.resources)) {
    throw new Error(`Malformed receipt at ${receiptPath}.`);
  }
  const legacy = receipt.schema_version === LEGACY_RECEIPT_SCHEMA_VERSION;
  const v3 = receipt.schema_version === RECEIPT_SCHEMA_VERSION;
  assertReceiptKeys(receipt, new Set(legacy
    ? ['schema_version', 'source_repository', 'version', 'installed_at', 'resources']
    : [
      'schema_version', 'source', 'registry_sha256', 'skills', 'version',
      'installed_at', 'resources', ...(v3 ? ['selections'] : []),
    ]),
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
  if (v3) {
    assertReceiptKeys(receipt.selections, new Set(['catalog', 'packs']), '$.selections');
    if (!Object.hasOwn(receipt.selections, 'catalog')
      || !Object.hasOwn(receipt.selections, 'packs')
      || typeof receipt.selections.catalog !== 'boolean') {
      throw new Error(`Malformed receipt selections at ${receiptPath}.`);
    }
    const selectedPacks = receipt.selections.packs;
    if (!selectedPacks || typeof selectedPacks !== 'object' || Array.isArray(selectedPacks)) {
      throw new Error(`Malformed receipt selections at ${receiptPath}.`);
    }
    for (const [name, version] of Object.entries(selectedPacks)) {
      assertSafeObjectKey(name, '$.selections.packs');
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
        || !/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`Malformed receipt pack selection at ${receiptPath}.`);
      }
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

function receiptSelections(receipt) {
  if (!receipt) return { catalog: false, packs: {} };
  if (receipt.schema_version < RECEIPT_SCHEMA_VERSION) return { catalog: true, packs: {} };
  return {
    catalog: receipt.selections.catalog,
    packs: { ...receipt.selections.packs },
  };
}

function buildReceipt(info, identity, catalog, selection, resources) {
  const skills = {};
  for (const resource of resources) skills[resource.skill] = catalog.versions[resource.skill];
  return {
    schema_version: RECEIPT_SCHEMA_VERSION,
    source: identity,
    registry_sha256: catalog.registryDigest,
    selections: {
      catalog: selection.catalog,
      packs: Object.fromEntries(Object.entries(selection.packs).sort(([a], [b]) => compareCodePoints(a, b))),
    },
    skills: Object.fromEntries(Object.entries(skills).sort(([a], [b]) => compareCodePoints(a, b))),
    version: info.version,
    installed_at: new Date().toISOString(),
    resources: resources.map((r) => ({
      source: `skills/${r.relPath}`,
      skill: r.skill,
      destination: r.relPath,
      sha256: r.sha256,
    })),
  };
}

function parsePackRequests(packs = []) {
  if (!Array.isArray(packs)) throw new Error('Pack selections must be an array.');
  const requests = new Map();
  for (const request of packs) {
    if (typeof request !== 'string' || request.length === 0) throw new Error('Pack name is required.');
    const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)(?:@(\d+\.\d+\.\d+))?$/.exec(request);
    if (!match) throw new Error(`Invalid pack selection "${request}". Use name or name@version.`);
    if (['__proto__', 'prototype', 'constructor'].includes(match[1])) {
      throw new Error(`Unsafe pack selection name: ${match[1]}.`);
    }
    if (requests.has(match[1])) throw new Error(`Duplicate pack selection: ${match[1]}.`);
    requests.set(match[1], match[2] ?? null);
  }
  return requests;
}

function resolveRequestedPacks(catalog, requests) {
  const available = new Map(catalog.packs.map((pack) => [pack.name, pack]));
  const resolved = new Map();
  for (const [name, requestedVersion] of requests) {
    const pack = available.get(name);
    if (!pack) {
      if (Object.hasOwn(catalog.removedPacks, name)) {
        throw new Error(`Pack "${name}" was removed at version ${catalog.removedPacks[name].version}.`);
      }
      throw new Error(`Unknown pack "${name}". No network version resolution is performed.`);
    }
    if (requestedVersion && requestedVersion !== pack.version) {
      throw new Error(`Pack "${name}" requires exact available version ${pack.version}, not ${requestedVersion}.`);
    }
    if (pack.installPolicy?.versionMatch !== 'exact'
      || pack.installPolicy?.conflictAction !== 'reject') {
      throw new Error(`Pack "${name}" has an unsupported install policy.`);
    }
    for (const member of pack.skills) {
      if (catalog.versions[member.name] !== member.version) {
        throw new Error(`Pack "${name}" requires exact ${member.name}@${member.version}, but the catalog has ${catalog.versions[member.name] ?? 'no version'}.`);
      }
    }
    resolved.set(name, pack);
  }
  return resolved;
}

function selectedPacks(catalog, selection) {
  const requests = new Map(Object.entries(selection.packs));
  const packs = resolveRequestedPacks(catalog, requests);
  for (const [name, pack] of packs) {
    if (selection.packs[name] !== pack.version) {
      throw new Error(`Selected pack "${name}" version ${selection.packs[name]} does not match available version ${pack.version}.`);
    }
  }
  return packs;
}

function assertPackConflicts(packs, catalogSkills = []) {
  const selectedSkills = new Set([
    ...catalogSkills,
    ...[...packs.values()].flatMap((pack) => pack.skills.map((s) => s.name)),
  ]);
  for (const pack of packs.values()) {
    for (const conflict of pack.conflicts) {
      if (selectedSkills.has(conflict)) {
        throw new Error(`Pack conflict: "${pack.name}" conflicts with selected skill "${conflict}".`);
      }
    }
  }
}

function selectResources(catalog, selection) {
  const packs = selectedPacks(catalog, selection);
  assertPackConflicts(packs, selection.catalog ? Object.keys(catalog.versions) : []);
  if (selection.catalog) return catalog.resources;
  const skills = new Set([...packs.values()].flatMap((pack) => pack.skills.map((s) => s.name)));
  return catalog.resources.filter((resource) => skills.has(resource.skill));
}

function identityMatches(receipt, identity) {
  if (receipt.schema_version === LEGACY_RECEIPT_SCHEMA_VERSION) {
    return normalizeRepository(receipt.source_repository) === normalizeRepository(identity.repository);
  }
  return receipt.source.repository === identity.repository
    && receipt.source.ref === identity.ref
    && receipt.source.commit === identity.commit;
}

function operationLockPath(targetRoot) {
  return assertNoSymlinks(targetRoot, LOCK_NAME);
}

function validateOperationLock(lock, targetRoot, lockPath) {
  assertReceiptKeys(lock, new Set(['schema_version', 'target', 'pid', 'token']), '$lock');
  if (lock.schema_version !== 1
    || lock.target !== resolve(targetRoot)
    || !Number.isSafeInteger(lock.pid)
    || lock.pid <= 0
    || !SHA256_PATTERN.test(lock.token ?? '')) {
    throw new Error(`Uncertain operation lock at ${lockPath}. Inspect the target and remove the lock only after proving no manager process is active.`);
  }
  return lock;
}

function acquireOperationLock(targetRoot) {
  mkdirSync(targetRoot, { recursive: true });
  const lockPath = operationLockPath(targetRoot);
  const token = randomBytes(32).toString('hex');
  let descriptor;
  try {
    descriptor = openSync(lockPath, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify({
      schema_version: 1,
      target: resolve(targetRoot),
      pid: process.pid,
      token,
    })}\n`);
    closeSync(descriptor);
    return { lockPath, token, targetRoot };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error?.code === 'EEXIST') {
      throw new Error(`Existing operation lock at ${lockPath}. Inspect it and its owner, then remove it explicitly only after proving no manager operation can still be active.`);
    }
    throw error;
  }
}

function releaseOperationLock(lock) {
  if (!pathEntryExists(lock.lockPath)) {
    throw new Error(`Operation lock disappeared before finalization: ${lock.lockPath}. Inspect the target before retrying.`);
  }
  let current;
  try {
    current = validateOperationLock(
      JSON.parse(readFileSync(lock.lockPath, 'utf8')),
      lock.targetRoot,
      lock.lockPath,
    );
  } catch (error) {
    throw new Error(`Cannot safely release operation lock: ${error.message}`);
  }
  if (current.token !== lock.token || current.pid !== process.pid) {
    throw new Error(`Operation lock ownership changed at ${lock.lockPath}. Inspect it before retrying.`);
  }
  rmSync(lock.lockPath);
}

function transactionPaths(targetRoot, name = TRANSACTION_NAME) {
  const root = assertNoSymlinks(targetRoot, name);
  return {
    name,
    root,
    journal: resolve(root, 'journal.json'),
    owner: resolve(root, TRANSACTION_OWNER_NAME),
    stage: resolve(root, 'stage'),
    backup: resolve(root, 'backup'),
  };
}

function terminalExpectation(journal) {
  return {
    token: journal.transaction_token,
    state: journal.state,
    journalSha256: sha256(`${JSON.stringify(journal, null, 2)}\n`),
  };
}

function validateTerminalTransactionRoot(targetRoot, paths, expected) {
  const currentPaths = transactionPaths(targetRoot, paths.name);
  if (currentPaths.root !== paths.root || !pathEntryExists(currentPaths.root)) {
    throw new Error(`Terminal transaction root changed at ${paths.root}. Preserve every replacement path for operator inspection.`);
  }
  if (!pathEntryExists(currentPaths.journal)) {
    throw new Error(`Terminal journal is missing at ${currentPaths.journal}. Preserve ${currentPaths.root} for operator inspection.`);
  }
  const journalBytes = readFileSync(currentPaths.journal);
  if (sha256(journalBytes) !== expected.journalSha256) {
    throw new Error(`Terminal journal digest changed at ${currentPaths.journal}. Preserve ${currentPaths.root} for operator inspection.`);
  }
  const journal = validateJournal(
    JSON.parse(journalBytes.toString('utf8')),
    targetRoot,
    currentPaths.journal,
  );
  validateTransactionOwner(currentPaths, targetRoot, journal);
  if (journal.transaction_token !== expected.token || journal.state !== expected.state) {
    throw new Error(`Terminal transaction token or state changed at ${currentPaths.root}. Preserve it for operator inspection.`);
  }
  return currentPaths;
}

function removeCleanupDirectory(targetRoot, paths, expected) {
  const currentPaths = validateTerminalTransactionRoot(targetRoot, paths, expected);
  rmSync(currentPaths.root, { recursive: true, force: true });
  if (pathEntryExists(currentPaths.root)) {
    throw new Error(`Transaction cleanup could not be proven at ${currentPaths.root}. Inspect it before retrying.`);
  }
}

function handoffTransactionForCleanup(targetRoot, paths, expected) {
  const currentPaths = validateTerminalTransactionRoot(targetRoot, paths, expected);
  const cleanupPaths = transactionPaths(targetRoot, TRANSACTION_CLEANUP_NAME);
  if (pathEntryExists(cleanupPaths.root)) {
    throw new Error(`Committed cleanup state already exists at ${cleanupPaths.root}. Recover it before finalizing another transaction.`);
  }
  renameSync(currentPaths.root, cleanupPaths.root);
  return cleanupPaths;
}

function journalPlanDigest(journal) {
  return sha256(JSON.stringify({
    transaction_token: journal.transaction_token,
    operations: journal.operations,
    receipt_sha256: journal.receipt_sha256,
    next_receipt_sha256: journal.next_receipt_sha256,
  }));
}

function validateJournal(journal, targetRoot, journalPath) {
  assertReceiptKeys(journal, new Set([
    'schema_version', 'target', 'state', 'operations', 'receipt_existed',
    'receipt_sha256', 'next_receipt_sha256', 'plan_sha256', 'transaction_token',
  ]), '$journal');
  if (journal.schema_version !== 1
    || journal.target !== resolve(targetRoot)
    || !SHA256_PATTERN.test(journal.transaction_token ?? '')
    || !['active', 'committed', 'rolled-back'].includes(journal.state)
    || typeof journal.receipt_existed !== 'boolean'
    || (journal.receipt_existed !== (journal.receipt_sha256 !== null))
    || (journal.receipt_sha256 !== null && !SHA256_PATTERN.test(journal.receipt_sha256))
    || (journal.next_receipt_sha256 !== null && !SHA256_PATTERN.test(journal.next_receipt_sha256))
    || !SHA256_PATTERN.test(journal.plan_sha256 ?? '')
    || !Array.isArray(journal.operations)) {
    throw new Error(`Malformed or foreign transaction journal at ${journalPath}. Remove it only after manually proving target state.`);
  }

  const destinations = new Set();
  for (const operation of journal.operations) {
    assertReceiptKeys(operation, new Set([
      'destination', 'action', 'existed', 'owned_sha256', 'prior_sha256', 'new_sha256',
    ]), '$journal.operations[]');
    assertSafeReceiptDestination(operation.destination);
    if (!['write', 'remove'].includes(operation.action)
      || typeof operation.existed !== 'boolean'
      || (operation.existed !== (operation.prior_sha256 !== null))
      || (operation.owned_sha256 !== null && !SHA256_PATTERN.test(operation.owned_sha256))
      || (operation.prior_sha256 !== null && !SHA256_PATTERN.test(operation.prior_sha256))
      || (operation.action === 'write' && !SHA256_PATTERN.test(operation.new_sha256 ?? ''))
      || (operation.action === 'remove'
        && (operation.new_sha256 !== null
          || !SHA256_PATTERN.test(operation.owned_sha256 ?? '')
          || (operation.existed && operation.prior_sha256 !== operation.owned_sha256)))
      || destinations.has(operation.destination)) {
      throw new Error(`Malformed or foreign transaction journal at ${journalPath}. Remove it only after manually proving target state.`);
    }
    destinations.add(operation.destination);
  }
  if (journal.plan_sha256 !== journalPlanDigest(journal)) {
    throw new Error(`Transaction plan digest mismatch at ${journalPath}. Inspect the target before recovery.`);
  }
  return journal;
}

function validateTransactionOwner(paths, targetRoot, journal) {
  if (!pathEntryExists(paths.owner)) {
    throw new Error(`Transaction ownership marker is missing at ${paths.root}. Preserve it for explicit inspection.`);
  }
  let owner;
  try {
    owner = JSON.parse(readFileSync(paths.owner, 'utf8'));
  } catch {
    throw new Error(`Transaction ownership marker is malformed at ${paths.owner}. Preserve it for explicit inspection.`);
  }
  assertReceiptKeys(owner, new Set(['schema_version', 'target', 'token']), '$transactionOwner');
  if (owner.schema_version !== 1
    || owner.target !== resolve(targetRoot)
    || !SHA256_PATTERN.test(owner.token ?? '')
    || owner.token !== journal.transaction_token) {
    throw new Error(`Transaction ownership cannot be proven at ${paths.root}. Preserve it for explicit inspection.`);
  }
  return owner;
}

function cleanupTransaction(paths) {
  rmSync(paths.root, { recursive: true, force: true });
  if (pathEntryExists(paths.root)) {
    throw new Error(`Owned nonterminal transaction cleanup could not be proven at ${paths.root}.`);
  }
}

function rollbackJournal(targetRoot, paths, journal, trustedProgress = {}) {
  const createdPaths = trustedProgress.createdPaths ?? new Set();
  const receiptCreated = trustedProgress.receiptCreated === true;
  const receiptPath = assertNoSymlinks(targetRoot, RECEIPT_NAME);
  for (const operation of [...journal.operations].reverse()) {
    const destination = assertNoSymlinks(targetRoot, operation.destination);
    const backup = assertNoSymlinks(paths.backup, operation.destination);
    if (operation.existed) {
      if (pathEntryExists(backup)) {
        if (sha256File(backup) !== operation.prior_sha256) {
          throw new Error(`Rollback cannot prove backup ownership for ${operation.destination}. Inspect ${paths.root} and restore it manually.`);
        }
        if (pathEntryExists(destination)
          && (operation.action !== 'write' || sha256File(destination) !== operation.new_sha256)) {
          throw new Error(`Rollback cannot prove transaction bytes for ${operation.destination}. Inspect ${paths.root} and restore it manually.`);
        }
        rmSync(destination, { force: true });
        mkdirSync(dirname(destination), { recursive: true });
        renameSync(backup, destination);
      } else if (!pathEntryExists(destination)
        || sha256File(destination) !== operation.prior_sha256) {
        throw new Error(`Rollback cannot prove backup ownership for ${operation.destination}. Inspect ${paths.root} and restore it manually.`);
      }
    } else {
      if (pathEntryExists(backup)) {
        throw new Error(`Rollback cannot prove transaction ownership for ${operation.destination}. Inspect ${paths.root} and restore it manually.`);
      }
      if (createdPaths.has(operation.destination)) {
        if (!pathEntryExists(destination)
          || operation.action !== 'write'
          || sha256File(destination) !== operation.new_sha256) {
          throw new Error(`Rollback cannot prove created transaction bytes for ${operation.destination}. Inspect ${paths.root} manually.`);
        }
        rmSync(destination, { force: true });
        removeEmptyParents(destination, targetRoot);
      }
    }
  }
  const receiptBackup = resolve(paths.backup, RECEIPT_NAME);
  if (journal.receipt_existed) {
    if (pathEntryExists(receiptBackup)) {
      if (sha256File(receiptBackup) !== journal.receipt_sha256
        || (pathEntryExists(receiptPath)
          && sha256File(receiptPath) !== journal.next_receipt_sha256)) {
        throw new Error(`Rollback cannot prove the receipt bytes at ${paths.root}. Restore them manually before retrying.`);
      }
      rmSync(receiptPath, { force: true });
      renameSync(receiptBackup, receiptPath);
    } else if (!pathEntryExists(receiptPath)
      || sha256File(receiptPath) !== journal.receipt_sha256) {
      throw new Error(`Rollback cannot prove the receipt backup at ${paths.root}. Restore it manually before retrying.`);
    }
  } else {
    if (pathEntryExists(receiptBackup)
      || (receiptCreated && pathEntryExists(receiptPath)
        && sha256File(receiptPath) !== journal.next_receipt_sha256)) {
      throw new Error(`Rollback cannot prove new receipt ownership at ${paths.root}. Inspect it manually before retrying.`);
    }
    if (receiptCreated) rmSync(receiptPath, { force: true });
  }
  journal.state = 'rolled-back';
  writeJournal(paths, journal);
  const expected = terminalExpectation(journal);
  const cleanupPaths = handoffTransactionForCleanup(targetRoot, paths, expected);
  removeCleanupDirectory(targetRoot, cleanupPaths, expected);
}

function discardUnmutatedTransaction(targetRoot, paths, journal) {
  journal.state = 'rolled-back';
  writeJournal(paths, journal);
  const expected = terminalExpectation(journal);
  const cleanupPaths = handoffTransactionForCleanup(targetRoot, paths, expected);
  removeCleanupDirectory(targetRoot, cleanupPaths, expected);
}

function loadReceiptAt(receiptPath) {
  if (!pathEntryExists(receiptPath)) return null;
  return validateReceipt(JSON.parse(readFileSync(receiptPath, 'utf8')), receiptPath);
}

function assertNextReceiptMatchesCatalog(receipt, catalog, identity, receiptPath) {
  if (receipt.schema_version !== RECEIPT_SCHEMA_VERSION
    || !identityMatches(receipt, identity)
    || receipt.registry_sha256 !== catalog.registryDigest) {
    throw new Error(`Staged next receipt is not bound to the current source and registry at ${receiptPath}.`);
  }
  const expected = selectResources(catalog, receipt.selections);
  const expectedMap = new Map(expected.map((resource) => [resource.relPath, resource]));
  if (receipt.resources.length !== expected.length
    || receipt.resources.some((resource) => {
      const expectedResource = expectedMap.get(resource.destination);
      return !expectedResource
        || resource.source !== `skills/${expectedResource.relPath}`
        || resource.skill !== expectedResource.skill
        || resource.sha256 !== expectedResource.sha256;
    })) {
    throw new Error(`Staged next receipt resource plan differs from the current selected catalog at ${receiptPath}.`);
  }
  const expectedSkills = Object.fromEntries(
    [...new Set(expected.map((resource) => resource.skill))].sort(compareCodePoints)
      .map((name) => [name, catalog.versions[name]]),
  );
  if (JSON.stringify(receipt.skills) !== JSON.stringify(expectedSkills)) {
    throw new Error(`Staged next receipt skill plan differs from the current selected catalog at ${receiptPath}.`);
  }
}

function bindJournalToTrustedState(
  targetRoot,
  paths,
  journal,
  catalog,
  identity,
  trustPriorReceipt = (receipt) => identityMatches(receipt, identity),
) {
  const receiptPath = assertNoSymlinks(targetRoot, RECEIPT_NAME);
  const receiptBackupPath = resolve(paths.backup, RECEIPT_NAME);
  const stagedReceiptPath = resolve(paths.stage, RECEIPT_NAME);
  let priorReceipt = null;
  if (journal.receipt_existed) {
    const candidates = [receiptBackupPath, receiptPath]
      .filter((path) => pathEntryExists(path) && sha256File(path) === journal.receipt_sha256);
    if (candidates.length !== 1) {
      throw new Error(`Cannot prove the unique prior receipt for recovery at ${paths.root}.`);
    }
    priorReceipt = loadReceiptAt(candidates[0]);
    const priorTrust = trustPriorReceipt(priorReceipt);
    if (!priorTrust) {
      throw new Error(`Prior receipt identity is foreign to the current source at ${candidates[0]}.`);
    }
    if (priorReceipt.schema_version === RECEIPT_SCHEMA_VERSION
      && identityMatches(priorReceipt, identity)) {
      assertNextReceiptMatchesCatalog(priorReceipt, catalog, identity, candidates[0]);
    } else if (!priorTrust.historicalResources
      && priorReceipt.schema_version !== RECEIPT_SCHEMA_VERSION) {
      const expected = new Map(catalog.resources.map((resource) => [resource.relPath, resource.sha256]));
      if (priorReceipt.resources.length !== expected.size
        || priorReceipt.resources.some((resource) => expected.get(resource.destination) !== resource.sha256)) {
        throw new Error(`Legacy prior receipt ownership is not bound to the current full catalog at ${candidates[0]}.`);
      }
    }
    if (priorTrust.historicalResources) {
      priorReceipt = {
        ...priorReceipt,
        resources: priorTrust.historicalResources,
      };
    }
  } else if (pathEntryExists(receiptBackupPath)) {
    throw new Error(`Unexpected receipt backup prevents trusted recovery at ${paths.root}.`);
  }

  let nextReceipt = null;
  if (journal.next_receipt_sha256 !== null) {
    const candidates = [stagedReceiptPath, receiptPath]
      .filter((path) => pathEntryExists(path) && sha256File(path) === journal.next_receipt_sha256);
    if (candidates.length !== 1) {
      throw new Error(`Cannot prove the unique staged next receipt for recovery at ${paths.root}.`);
    }
    nextReceipt = loadReceiptAt(candidates[0]);
    assertNextReceiptMatchesCatalog(nextReceipt, catalog, identity, candidates[0]);
  } else if (pathEntryExists(stagedReceiptPath)) {
    throw new Error(`Unexpected staged receipt prevents trusted recovery at ${paths.root}.`);
  }

  const priorMap = receiptMap(priorReceipt);
  const nextMap = receiptMap(nextReceipt);
  const operations = new Map(journal.operations.map((operation) => [operation.destination, operation]));
  const expectedOperations = new Map();
  for (const resource of nextReceipt?.resources ?? []) {
    expectedOperations.set(resource.destination, 'write');
  }
  for (const resource of priorReceipt?.resources ?? []) {
    if (!nextMap.has(resource.destination)) expectedOperations.set(resource.destination, 'remove');
  }
  if (operations.size !== expectedOperations.size) {
    throw new Error('Journal does not contain the exact operation set derived from the trusted receipts.');
  }
  for (const [destination, action] of expectedOperations) {
    if (operations.get(destination)?.action !== action) {
      const detail = action === 'remove' ? 'missing prior-owned removal' : 'missing next-resource write';
      throw new Error(`Journal ${detail}: ${destination}.`);
    }
  }
  for (const operation of journal.operations) {
    const prior = priorMap.get(operation.destination);
    const next = nextMap.get(operation.destination);
    if (operation.action === 'write') {
      if (!next
        || operation.new_sha256 !== next.sha256
        || operation.owned_sha256 !== (prior?.sha256 ?? null)) {
        throw new Error(`Journal write is not bound to the staged next receipt: ${operation.destination}.`);
      }
      if (operation.existed
        && (!prior || operation.prior_sha256 !== prior.sha256)) {
        throw new Error(`Journal write is not bound to prior receipt ownership: ${operation.destination}.`);
      }
    } else if (!prior
      || next
      || operation.owned_sha256 !== prior.sha256
      || (operation.existed && operation.prior_sha256 !== prior.sha256)) {
      throw new Error(`Journal removal is not bound to prior receipt ownership: ${operation.destination}.`);
    }
  }
  return { priorReceipt, nextReceipt };
}

function rollForwardJournal(targetRoot, paths, journal) {
  const receiptPath = assertNoSymlinks(targetRoot, RECEIPT_NAME);
  for (const operation of journal.operations) {
    const destination = assertNoSymlinks(targetRoot, operation.destination);
    const backup = assertNoSymlinks(paths.backup, operation.destination);
    const staged = assertNoSymlinks(paths.stage, operation.destination);
    if (operation.action === 'remove') {
      if (!operation.existed) {
        assertPreflightState(destination, null, `Recovery resource ${operation.destination}`);
        if (pathEntryExists(backup)) {
          throw new Error(`Unexpected backup exists for absent removal ${operation.destination} at ${paths.root}.`);
        }
        continue;
      }
      if (pathEntryExists(backup)) {
        if (sha256File(backup) !== operation.prior_sha256 || pathEntryExists(destination)) {
          throw new Error(`Cannot prove removal state for ${operation.destination} at ${paths.root}.`);
        }
      } else {
        assertPreflightState(destination, operation.prior_sha256, `Recovery resource ${operation.destination}`);
        mkdirSync(dirname(backup), { recursive: true });
        renameSync(destination, backup);
      }
      continue;
    }
    if (pathEntryExists(destination) && sha256File(destination) === operation.new_sha256) continue;
    if (!pathEntryExists(staged) || sha256File(staged) !== operation.new_sha256) {
      throw new Error(`Cannot prove staged bytes for ${operation.destination} at ${paths.root}.`);
    }
    if (pathEntryExists(destination)) {
      assertPreflightState(destination, operation.prior_sha256, `Recovery resource ${operation.destination}`);
      if (!operation.existed) {
        throw new Error(`A previously absent path appeared during recovery: ${operation.destination}. Inspect it manually.`);
      }
      mkdirSync(dirname(backup), { recursive: true });
      assertPreflightState(backup, null, `Recovery backup ${operation.destination}`);
      renameSync(destination, backup);
    } else if (operation.existed && !pathEntryExists(backup)) {
      throw new Error(`Cannot prove prior ownership backup for ${operation.destination} at ${paths.root}.`);
    }
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(staged, destination);
  }

  const receiptBackup = resolve(paths.backup, RECEIPT_NAME);
  const stagedReceipt = resolve(paths.stage, RECEIPT_NAME);
  if (journal.receipt_existed && !pathEntryExists(receiptBackup)) {
    assertPreflightState(receiptPath, journal.receipt_sha256, 'Recovery receipt');
    renameSync(receiptPath, receiptBackup);
  }
  if (journal.next_receipt_sha256 === null) {
    if (pathEntryExists(receiptPath)) {
      throw new Error(`Unexpected receipt prevents uninstall recovery at ${paths.root}.`);
    }
  } else if (!pathEntryExists(receiptPath)
    || sha256File(receiptPath) !== journal.next_receipt_sha256) {
    assertPreflightState(receiptPath, null, 'Recovery receipt');
    if (!pathEntryExists(stagedReceipt)
      || sha256File(stagedReceipt) !== journal.next_receipt_sha256) {
      throw new Error(`Cannot prove staged next receipt at ${paths.root}.`);
    }
    renameSync(stagedReceipt, receiptPath);
  }
  journal.state = 'committed';
  writeJournal(paths, journal);
}

function recoverTransaction(
  targetRoot,
  catalog,
  identity,
  { validateOnly = false, trustPriorReceipt } = {},
) {
  const paths = transactionPaths(targetRoot);
  const cleanupPaths = transactionPaths(targetRoot, TRANSACTION_CLEANUP_NAME);
  if (pathEntryExists(cleanupPaths.root)) {
    if (pathEntryExists(paths.root) || !pathEntryExists(cleanupPaths.journal)) {
      throw new Error(`Transaction recovery found uncertain active and cleanup state. Inspect ${paths.root} and ${cleanupPaths.root} manually.`);
    }
    let cleanupJournal;
    try {
      cleanupJournal = validateJournal(
        JSON.parse(readFileSync(cleanupPaths.journal, 'utf8')),
        targetRoot,
        cleanupPaths.journal,
      );
      validateTransactionOwner(cleanupPaths, targetRoot, cleanupJournal);
      if (!['committed', 'rolled-back'].includes(cleanupJournal.state)) {
        throw new Error('cleanup journal is not in a terminal state.');
      }
      if (cleanupJournal.state === 'committed') {
        bindJournalToTrustedState(
          targetRoot,
          cleanupPaths,
          cleanupJournal,
          catalog,
          identity,
          trustPriorReceipt,
        );
      }
      if (validateOnly) return true;
      removeCleanupDirectory(
        targetRoot,
        cleanupPaths,
        terminalExpectation(cleanupJournal),
      );
    } catch (error) {
      throw new Error(`Transaction cleanup recovery failed closed: ${error.message} Preserve ${cleanupPaths.root} for manual inspection.`);
    }
  }
  if (!pathEntryExists(paths.root)) return false;
  if (!pathEntryExists(paths.journal)) {
    throw new Error(`Transaction recovery cannot find a valid journal at ${paths.root}. Inspect the target and clean it up manually.`);
  }
  let journal;
  try {
    journal = validateJournal(JSON.parse(readFileSync(paths.journal, 'utf8')), targetRoot, paths.journal);
    validateTransactionOwner(paths, targetRoot, journal);
  } catch (error) {
    throw new Error(`Transaction recovery failed closed: ${error.message}`);
  }
  try {
    bindJournalToTrustedState(
      targetRoot,
      paths,
      journal,
      catalog,
      identity,
      trustPriorReceipt,
    );
  } catch (error) {
    throw new Error(`Transaction recovery failed closed: ${error.message} Inspect ${paths.root} and remove it only after proving every path.`);
  }
  if (validateOnly) return true;
  if (journal.state === 'committed' || journal.state === 'rolled-back') {
    const expected = terminalExpectation(journal);
    const terminalCleanup = handoffTransactionForCleanup(targetRoot, paths, expected);
    removeCleanupDirectory(targetRoot, terminalCleanup, expected);
    return true;
  }
  try {
    rollForwardJournal(targetRoot, paths, journal);
    const expected = terminalExpectation(journal);
    const recoveryCleanup = handoffTransactionForCleanup(targetRoot, paths, expected);
    removeCleanupDirectory(targetRoot, recoveryCleanup, expected);
  } catch (error) {
    throw new Error(`Transaction recovery cannot safely complete: ${error.message} Preserve ${paths.root} for manual recovery.`);
  }
  return true;
}

function writeJournal(paths, journal, exclusive = false) {
  writeFileSync(paths.journal, `${JSON.stringify(journal, null, 2)}\n`, {
    flag: exclusive ? 'wx' : 'w',
  });
}

function invokeFault(faultInjector, stage, context) {
  if (faultInjector) faultInjector(stage, context);
}

function assertPreflightState(path, expectedSha256, label) {
  const exists = pathEntryExists(path);
  if (expectedSha256 === null) {
    if (exists) throw new Error(`${label} changed after preflight: expected absence at ${path}.`);
    return;
  }
  if (!exists || sha256File(path) !== expectedSha256) {
    throw new Error(`${label} changed after preflight: expected receipt-owned SHA-256 ${expectedSha256} at ${path}.`);
  }
}

function operationSelection(mode, current, requested) {
  if (mode === 'install') {
    const next = { catalog: requested.size === 0 ? true : current.catalog, packs: { ...current.packs } };
    for (const [name, pack] of requested) next.packs[name] = pack.version;
    return next;
  }
  if (mode === 'uninstall') {
    if (requested.size === 0) return { catalog: false, packs: {} };
    const next = { catalog: current.catalog, packs: { ...current.packs } };
    for (const [name, pack] of requested) {
      if (!(name in next.packs)) throw new Error(`Pack "${name}" is not selected in this target.`);
      if (next.packs[name] !== pack.version) {
        throw new Error(`Pack "${name}" selected version ${next.packs[name]} differs from available version ${pack.version}. Use the matching catalog checkout to uninstall it.`);
      }
      delete next.packs[name];
    }
    return next;
  }
  return current;
}

function prepareTarget({
  mode,
  sourceRoot,
  targetRoot,
  packs,
  dryRun,
  log,
  verifySource,
  bindCatalog,
  validateRecoveryOnly = false,
}) {
  if (!MODES.has(mode)) throw new Error(`Mode must be one of: ${[...MODES].join(', ')}.`);
  if (!targetRoot) throw new Error('A target root is required.');

  const info = packageInfo();
  const defaultSource = resolve(sourceRoot) === DEFAULT_SOURCE_ROOT;
  let verifiedCommit = null;
  if (defaultSource) {
    verifiedCommit = verifySource();
  }
  const catalog = collectCatalog(sourceRoot);
  if (defaultSource) {
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
  const trustPriorReceipt = (priorReceipt) => {
    if (defaultSource && priorReceipt.schema_version !== LEGACY_RECEIPT_SCHEMA_VERSION) {
      const provenance = verifyDefaultReceiptProvenance(priorReceipt, {
        repository: info.repository,
        verifiedHead: verifiedCommit,
      });
      return { historicalResources: provenance.resources };
    }
    return identityMatches(priorReceipt, identity);
  };
  const recoveryPending = recoverTransaction(targetRoot, catalog, identity, {
    validateOnly: validateRecoveryOnly,
    trustPriorReceipt,
  });
  if (validateRecoveryOnly && recoveryPending) {
    return { recoveryPending: true };
  }
  const receiptPath = assertNoSymlinks(targetRoot, RECEIPT_NAME);
  const receipt = loadReceipt(targetRoot);
  if (receipt && mode !== 'check' && !trustPriorReceipt(receipt)) {
    if (receipt.schema_version === LEGACY_RECEIPT_SCHEMA_VERSION) {
      throw new Error('Refusing to trust a foreign legacy receipt as ownership evidence.');
    }
    throw new Error('Refusing to trust a foreign receipt as ownership evidence.');
  }
  const requests = parsePackRequests(packs);
  const requested = resolveRequestedPacks(catalog, requests);
  const currentSelection = receiptSelections(receipt);
  const nextSelection = operationSelection(mode, currentSelection, requested);
  const desired = mode === 'check' && requested.size > 0
    ? selectResources(catalog, {
      catalog: false,
      packs: Object.fromEntries([...requested].map(([name, pack]) => [name, pack.version])),
    })
    : selectResources(catalog, nextSelection);
  const previous = receiptMap(receipt);
  const currentDestinations = new Set(desired.map((r) => r.relPath));
  const retired = (receipt?.resources ?? []).filter((r) => !currentDestinations.has(r.destination));

  if (mode === 'list') {
    if (requested.size > 0) {
      for (const pack of requested.values()) log(`${pack.name}\t${pack.version}\t${pack.skills.map((s) => `${s.name}@${s.version}`).join(',')}`);
      return { immediate: { ok: true, packs: [...requested.keys()] } };
    }
    for (const skill of discoverSkills(sourceRoot)) {
      const { data } = parseFrontmatter(readFileSync(resolve(skill.dir, 'SKILL.md'), 'utf8'));
      const version = data.metadata?.version ?? 'unversioned';
      const description = String(data.description ?? '').replace(/\s+/g, ' ').trim();
      const oneLine = description.length > 100 ? `${description.slice(0, 97)}...` : description;
      log(`${skill.name}\t${version}\t${oneLine}`);
    }
    for (const pack of catalog.packs) log(`pack:${pack.name}\t${pack.version}\t${pack.skills.length} skills`);
    const selected = Object.entries(currentSelection.packs)
      .map(([name, version]) => `${name}@${version}`)
      .sort(compareCodePoints);
    log(`selected: catalog=${currentSelection.catalog}; packs=${selected.join(',') || 'none'}`);
    return { immediate: { ok: true, selections: currentSelection } };
  }

  if (mode === 'check') {
    const drift = [];
    if (!receipt) {
      drift.push({ kind: 'not-installed', detail: `No receipt in ${targetRoot}.` });
      log(`skills are not installed in ${targetRoot}.`);
      return { immediate: { ok: false, drift } };
    }
    if (receipt.schema_version !== RECEIPT_SCHEMA_VERSION) {
      drift.push({ kind: 'receipt-version', detail: 'Receipt requires safe migration to v3.' });
    } else {
      if (receipt.source.repository !== identity.repository
        || receipt.source.ref !== identity.ref
        || receipt.source.commit !== identity.commit) {
        drift.push({ kind: 'identity', detail: 'Installed source identity differs from this catalog.' });
      }
      if (receipt.registry_sha256 !== catalog.registryDigest) {
        drift.push({ kind: 'catalog', detail: 'Installed registry digest differs from this catalog.' });
      }
      if (requested.size > 0) {
        for (const [name, pack] of requested) {
          if (receipt.selections.packs[name] !== pack.version) {
            drift.push({ kind: 'pack-selection', detail: `${name}@${pack.version} is not selected.` });
          }
        }
      } else if (!receipt.selections.catalog) {
        drift.push({ kind: 'catalog-selection', detail: 'The full catalog is not selected.' });
      }
    }
    const expectedForCheck = requested.size > 0 ? desired : selectResources(catalog, currentSelection);
    const expectedSkills = Object.fromEntries(
      [...new Set(expectedForCheck.map((r) => r.skill))].sort(compareCodePoints)
        .map((name) => [name, catalog.versions[name]]),
    );
    if (requested.size === 0 && JSON.stringify(receipt.skills) !== JSON.stringify(expectedSkills)) {
      drift.push({ kind: 'skill-versions', detail: 'Installed selected skill versions differ from this catalog.' });
    }
    for (const resource of expectedForCheck) {
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
      return { immediate: { ok: true, drift } };
    }
    for (const item of drift) {
      log(`drift (${item.kind}): ${item.detail}`);
    }
    return { immediate: { ok: false, drift } };
  }

  if (mode === 'uninstall' && !receipt) {
      log(`skills are not installed in ${targetRoot}.`);
      return { immediate: { ok: true } };
  }

  for (const item of receipt?.resources ?? []) {
    const destinationPath = assertNoSymlinks(targetRoot, item.destination);
    if (pathEntryExists(destinationPath) && sha256File(destinationPath) !== item.sha256) {
      const action = mode === 'uninstall' ? 'remove' : 'mutate';
      throw new Error(`Refusing to ${action} locally modified managed file: ${item.destination}. Restore or delete it manually.`);
    }
  }
  const conflicts = [];
  for (const resource of desired) {
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
      return { immediate: { ok: false, conflicts } };
    }
    throw new Error(message);
  }

  const nextReceipt = nextSelection.catalog || Object.keys(nextSelection.packs).length > 0
    ? buildReceipt(info, identity, catalog, nextSelection, desired)
    : null;
  const current = receipt
    && receipt.schema_version === RECEIPT_SCHEMA_VERSION
    && receipt.source.repository === identity.repository
    && receipt.source.ref === identity.ref
    && receipt.source.commit === identity.commit
    && receipt.registry_sha256 === catalog.registryDigest
    && JSON.stringify(receipt.selections) === JSON.stringify(nextReceipt?.selections)
    && JSON.stringify(receipt.skills) === JSON.stringify(nextReceipt?.skills)
    && receipt.version === info.version
    && retired.length === 0
    && receipt.resources.length === desired.length
    && desired.every((resource) => {
      const destinationPath = assertNoSymlinks(targetRoot, resource.relPath);
      return pathEntryExists(destinationPath)
        && sha256File(destinationPath) === resource.sha256
        && previous.get(resource.relPath)?.sha256 === resource.sha256;
    });
  if (current) {
    log(`skills ${info.version} are already current in ${targetRoot}.`);
    return { immediate: { ok: true, alreadyCurrent: true } };
  }

  if (dryRun) {
    log(`[dry-run] would install ${desired.length} file(s)`
      + `${retired.length ? ` and remove ${retired.length} retired file(s)` : ''} in ${targetRoot}.`);
    return { immediate: { ok: true } };
  }
  const operations = [
    ...desired.map((resource) => {
      const destinationPath = assertNoSymlinks(targetRoot, resource.relPath);
      const existed = pathEntryExists(destinationPath);
      return {
        destination: resource.relPath,
        action: 'write',
        existed,
        owned_sha256: previous.get(resource.relPath)?.sha256 ?? null,
        prior_sha256: existed ? sha256File(destinationPath) : null,
        new_sha256: resource.sha256,
      };
    }),
    ...retired.map((resource) => {
      const destinationPath = assertNoSymlinks(targetRoot, resource.destination);
      const existed = pathEntryExists(destinationPath);
      return {
        destination: resource.destination,
        action: 'remove',
        existed,
        owned_sha256: resource.sha256,
        prior_sha256: existed ? sha256File(destinationPath) : null,
        new_sha256: null,
      };
    }),
  ];
  return {
    targetRoot,
    receiptPath,
    receipt,
    desired,
    retired,
    nextReceipt,
    operations,
    receiptSha256: receipt ? sha256File(receiptPath) : null,
    log,
    info,
  };
}

function applyPrepared(prepared, faultInjector) {
  const {
    targetRoot, receiptPath, receipt, desired, nextReceipt, log, info,
    operations, receiptSha256,
  } = prepared;
  const paths = transactionPaths(targetRoot);
  const nextReceiptContent = nextReceipt ? `${JSON.stringify(nextReceipt, null, 2)}\n` : null;
  const transactionToken = randomBytes(32).toString('hex');
  const journal = {
    schema_version: 1,
    target: resolve(targetRoot),
    transaction_token: transactionToken,
    state: 'active',
    operations,
    receipt_existed: Boolean(receipt),
    receipt_sha256: receiptSha256,
    next_receipt_sha256: nextReceiptContent ? sha256(nextReceiptContent) : null,
  };
  journal.plan_sha256 = journalPlanDigest(journal);
  let mutationStarted = false;
  let transactionOwned = false;
  const createdPaths = new Set();
  let receiptCreated = false;
  try {
    try {
      mkdirSync(paths.root);
      transactionOwned = true;
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error(`Transaction directory already exists at ${paths.root}. Preserve it and inspect/remove it explicitly before retrying.`);
      }
      throw error;
    }
    writeFileSync(paths.owner, `${JSON.stringify({
      schema_version: 1,
      target: resolve(targetRoot),
      token: transactionToken,
    })}\n`, { flag: 'wx', mode: 0o600 });
    mkdirSync(paths.stage);
    mkdirSync(paths.backup);
    for (const resource of desired) {
      const staged = assertNoSymlinks(paths.stage, resource.relPath);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(staged, resource.content, { flag: 'wx' });
      if (sha256File(staged) !== resource.sha256) throw new Error(`Staged bytes differ for ${resource.relPath}.`);
    }
    if (nextReceiptContent) {
      writeFileSync(resolve(paths.stage, RECEIPT_NAME), nextReceiptContent, { flag: 'wx' });
    }
    writeJournal(paths, journal, true);
    invokeFault(faultInjector, 'after-journal', { targetRoot });

    if (receipt) assertPreflightState(receiptPath, receiptSha256, 'Receipt');
    for (const operation of operations) {
      assertPreflightState(
        assertNoSymlinks(targetRoot, operation.destination),
        operation.prior_sha256,
        `Resource ${operation.destination}`,
      );
    }
    if (receipt) {
      assertPreflightState(receiptPath, receiptSha256, 'Receipt');
      const receiptBackup = resolve(paths.backup, RECEIPT_NAME);
      assertPreflightState(receiptBackup, null, 'Receipt backup');
      mutationStarted = true;
      renameSync(receiptPath, receiptBackup);
    }
    for (const operation of operations) {
      const destination = assertNoSymlinks(targetRoot, operation.destination);
      assertPreflightState(destination, operation.prior_sha256, `Resource ${operation.destination}`);
      if (!operation.existed) continue;
      const backup = assertNoSymlinks(paths.backup, operation.destination);
      mkdirSync(dirname(backup), { recursive: true });
      assertPreflightState(backup, null, `Backup ${operation.destination}`);
      mutationStarted = true;
      renameSync(destination, backup);
    }
    invokeFault(faultInjector, 'after-backup', { targetRoot });

    for (const operation of operations.filter((item) => item.action === 'write')) {
      const destination = assertNoSymlinks(targetRoot, operation.destination);
      const staged = assertNoSymlinks(paths.stage, operation.destination);
      mkdirSync(dirname(destination), { recursive: true });
      assertPreflightState(destination, null, `Resource ${operation.destination}`);
      if (!pathEntryExists(staged) || sha256File(staged) !== operation.new_sha256) {
        throw new Error(`Staged resource changed after preflight: ${operation.destination}.`);
      }
      mutationStarted = true;
      renameSync(staged, destination);
      if (!operation.existed) createdPaths.add(operation.destination);
      invokeFault(faultInjector, 'after-write', { targetRoot, destination: operation.destination });
    }
    for (const operation of operations.filter((item) => item.action === 'remove')) {
      removeEmptyParents(assertNoSymlinks(targetRoot, operation.destination), targetRoot);
      invokeFault(faultInjector, 'after-removal', { targetRoot, destination: operation.destination });
    }
    invokeFault(faultInjector, 'before-receipt', { targetRoot });
    if (nextReceipt) {
      const stagedReceipt = resolve(paths.stage, RECEIPT_NAME);
      assertPreflightState(receiptPath, null, 'Receipt');
      if (!pathEntryExists(stagedReceipt)
        || sha256File(stagedReceipt) !== journal.next_receipt_sha256) {
        throw new Error('Staged receipt changed after preflight.');
      }
      mutationStarted = true;
      renameSync(stagedReceipt, receiptPath);
      if (!receipt) receiptCreated = true;
    }
    invokeFault(faultInjector, 'after-receipt', { targetRoot });
    journal.state = 'committed';
    writeJournal(paths, journal);
    if (nextReceipt) {
      log(`Installed ${desired.length} selected file(s) for skills ${info.version} in ${targetRoot}.`);
    } else {
      log(`Uninstalled skills from ${targetRoot}.`);
    }
    return {
      ok: true,
      transaction: {
        paths, journal, targetRoot, createdPaths, receiptCreated,
      },
    };
  } catch (error) {
    if (error?.simulateCrash === true) throw error;
    if (transactionOwned && pathEntryExists(paths.journal)) {
      try {
        invokeFault(faultInjector, 'before-rollback', { targetRoot, cause: error });
        if (mutationStarted) {
          rollbackJournal(targetRoot, paths, journal, { createdPaths, receiptCreated });
        }
        else discardUnmutatedTransaction(targetRoot, paths, journal);
      } catch (rollbackError) {
        throw new Error(`Operation failed: ${error.message}. Rollback also failed: ${rollbackError.message}. Preserve ${paths.root} and retry recovery only after inspecting every managed path.`);
      }
    } else if (transactionOwned) {
      cleanupTransaction(paths);
    }
    throw error;
  }
}

function finalizeTransaction(transaction, faultInjector) {
  try {
    const expected = terminalExpectation(transaction.journal);
    invokeFault(faultInjector, 'before-finalize', { targetRoot: transaction.targetRoot });
    const cleanupPaths = handoffTransactionForCleanup(
      transaction.targetRoot,
      transaction.paths,
      expected,
    );
    invokeFault(faultInjector, 'after-finalize-rename', {
      targetRoot: transaction.targetRoot,
      cleanupRoot: cleanupPaths.root,
    });
    removeCleanupDirectory(transaction.targetRoot, cleanupPaths, expected);
  } catch (error) {
    throw new Error(`Operation logically committed, but transaction cleanup failed for ${transaction.targetRoot}: ${error.message}. Preserve the managed transaction cleanup state; the next locked operation will retry committed cleanup.`);
  }
}

function rollbackCompletedTransactions(transactions, faultInjector, originalError) {
  const failures = [];
  for (const transaction of [...transactions].reverse()) {
    try {
      invokeFault(faultInjector, 'before-rollback', {
        targetRoot: transaction.targetRoot,
        cause: originalError,
      });
      rollbackJournal(transaction.targetRoot, transaction.paths, transaction.journal, {
        createdPaths: transaction.createdPaths,
        receiptCreated: transaction.receiptCreated,
      });
    } catch (error) {
      failures.push(`${transaction.targetRoot}: ${error.message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Operation failed: ${originalError.message}. Multi-target rollback also failed: ${failures.join('; ')}. Preserve every remaining transaction directory for recovery.`);
  }
}

// Runs a mode against a single target root. Returns { ok, drift } for `check`.
export function manageSkillsTarget({
  mode,
  sourceRoot = DEFAULT_SOURCE_ROOT,
  targetRoot,
  packs = [],
  dryRun = false,
  log = console.log,
  verifySource = verifyDefaultCatalogSource,
  bindCatalog = assertBufferedCatalogMatchesCommit,
  faultInjector,
}) {
  const lock = acquireOperationLock(targetRoot);
  try {
    const prepared = prepareTarget({
      mode, sourceRoot, targetRoot, packs, dryRun, log, verifySource, bindCatalog,
    });
    if (prepared.immediate) return prepared.immediate;
    invokeFault(faultInjector, 'after-preflight', { targetRoot });
    const applied = applyPrepared(prepared, faultInjector);
    finalizeTransaction(applied.transaction, faultInjector);
    return { ok: true };
  } finally {
    releaseOperationLock(lock);
  }
}

export function manageSkillsTargets({
  mode,
  sourceRoot = DEFAULT_SOURCE_ROOT,
  targetRoots,
  packs = [],
  dryRun = false,
  log = console.log,
  verifySource = verifyDefaultCatalogSource,
  bindCatalog = assertBufferedCatalogMatchesCommit,
  faultInjector,
}) {
  const locks = [];
  try {
    for (const targetRoot of targetRoots) locks.push(acquireOperationLock(targetRoot));
    let prepared = targetRoots.map((targetRoot) => prepareTarget({
      mode, sourceRoot, targetRoot, packs, dryRun, log, verifySource, bindCatalog,
      validateRecoveryOnly: true,
    }));
    if (prepared.some((item) => item.recoveryPending)) {
      prepared = targetRoots.map((targetRoot) => prepareTarget({
        mode, sourceRoot, targetRoot, packs, dryRun, log, verifySource, bindCatalog,
      }));
    }
    if (prepared.every((item) => item.immediate)) return prepared.map((item) => item.immediate);
    const results = prepared.map((item) => item.immediate ?? null);
    const completed = [];
    try {
      for (let index = 0; index < prepared.length; index += 1) {
        const item = prepared[index];
        if (item.immediate) continue;
        invokeFault(faultInjector, 'after-preflight', { targetRoot: item.targetRoot });
        const applied = applyPrepared(item, faultInjector);
        completed.push(applied.transaction);
        results[index] = { ok: true };
      }
    } catch (error) {
      rollbackCompletedTransactions(completed, faultInjector, error);
      throw error;
    }
    for (const transaction of completed) finalizeTransaction(transaction, faultInjector);
    return results;
  } finally {
    for (const lock of [...locks].reverse()) releaseOperationLock(lock);
  }
}

function resolveTargetRoots({ target, dir }) {
  if (dir) return [resolve(dir)];
  if (!target || target === 'all') return ALL_TARGETS.map((t) => TARGETS[t]);
  if (!(target in TARGETS)) {
    throw new Error(`Unknown --target "${target}". Use one of: ${[...ALL_TARGETS, 'all'].join(', ')}.`);
  }
  return [TARGETS[target]];
}

export function parseArguments(args) {
  const options = {
    mode: 'check', target: 'all', dir: undefined, dryRun: false, packs: [],
  };
  if (args[0] && !args[0].startsWith('--')) {
    options.mode = args[0];
    args = args.slice(1);
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--target') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--target requires a runtime name.');
      options.target = args[i + 1];
      i += 1;
    } else if (arg === '--dir') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--dir requires a path.');
      options.dir = args[i + 1];
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--pack') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--pack requires a name or name@version.');
      options.packs.push(args[i + 1]);
      i += 1;
    } else if (arg === '--agent') {
      // Alias for --target, matching CI naming.
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--agent requires a runtime name.');
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
  const results = manageSkillsTargets({
    mode: options.mode,
    targetRoots,
    packs: options.packs,
    dryRun: options.dryRun,
  });
  const anyFailure = results.some((result) => result?.ok === false);
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

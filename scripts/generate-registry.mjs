#!/usr/bin/env node

// Generates registry/skills.json from skills/*/SKILL.md. Deterministic output
// (no timestamps) so `--check` can enforce that the committed file is current
// in CI. Validates the generated registry against schemas/registry.schema.json.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { discoverSkills } from './lib/skills.mjs';
import { parseFrontmatter } from './lib/frontmatter.mjs';
import { assertNoSymlinks, sha256, sha256File, walkFiles } from './lib/paths.mjs';
import { validateAgainstSchema } from './lib/jsonschema.mjs';
import {
  normalizeDiscovery,
  placeholderDiscovery,
  validateDiscoveryManifest,
} from './lib/registry-discovery.mjs';
import { validateMaturity, validateTierTransition } from './lib/tier-policy.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SKILLS_ROOT = resolve(REPOSITORY_ROOT, 'skills');
const DEFAULT_REGISTRY_PATH = resolve(REPOSITORY_ROOT, 'registry', 'skills.json');
const DEFAULT_MATURITY_PATH = resolve(REPOSITORY_ROOT, 'registry', 'maturity.json');
const DEFAULT_DISCOVERY_PATH = resolve(REPOSITORY_ROOT, 'registry', 'discovery.json');
const SCHEMA_PATH = resolve(REPOSITORY_ROOT, 'schemas', 'registry.schema.json');
const MATURITY_SCHEMA_PATH = resolve(REPOSITORY_ROOT, 'schemas', 'maturity-evidence.schema.json');
const DISCOVERY_SCHEMA_PATH = resolve(REPOSITORY_ROOT, 'schemas', 'registry-discovery.schema.json');

// Builds the registry object from a skills root. Pure and deterministic.
export function buildRegistry(
  skillsRoot = DEFAULT_SKILLS_ROOT,
  maturityManifest = { schemaVersion: 1, skills: {} },
  artifactRoot = skillsRoot,
  discoveryManifest = null,
) {
  const manifestErrors = validateMaturityManifest(maturityManifest, { artifactRoot });
  if (manifestErrors.length > 0) {
    throw new Error(`Invalid maturity evidence manifest:\n${manifestErrors.join('\n')}`);
  }
  const skills = discoverSkills(skillsRoot);
  const skillNames = new Set(skills.map((skill) => skill.name));
  if (discoveryManifest) {
    const discoveryErrors = validateDiscoveryManifest(
      loadDiscoverySchema(),
      discoveryManifest,
      [...skillNames],
    );
    if (discoveryErrors.length > 0) {
      throw new Error(`Invalid registry discovery manifest:\n${discoveryErrors.join('\n')}`);
    }
  }
  for (const name of Object.keys(maturityManifest.skills)) {
    if (!skillNames.has(name)) {
      throw new Error(`maturity evidence references unknown skill ${name}.`);
    }
  }
  const entries = [];
  for (const skill of skills) {
    const skillFile = resolve(skill.dir, 'SKILL.md');
    const content = readFileSync(skillFile, 'utf8');
    const { data } = parseFrontmatter(content);
    const resources = walkFiles(skill.dir)
      .filter((rel) => rel !== 'SKILL.md')
      .sort();
    entries.push({
      name: typeof data.name === 'string' ? data.name : skill.name,
      description: typeof data.description === 'string' ? data.description : '',
      version: typeof data.metadata?.version === 'string' ? data.metadata.version : null,
      license: typeof data.license === 'string' ? data.license : null,
      tier: typeof data.metadata?.tier === 'string' ? data.metadata.tier : null,
      maturity: maturityManifest.skills[skill.name] ?? {
        status: 'unverified',
        lastEvaluatedAt: null,
        evidence: [],
      },
      discovery: normalizeDiscovery(
        discoveryManifest?.skills[skill.name] ?? placeholderDiscovery(skill.name),
      ),
      path: `skills/${skill.name}`,
      skillFile: `skills/${skill.name}/SKILL.md`,
      sha256: sha256(content),
      resources,
    });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { schemaVersion: 3, skills: entries };
}

export function serializeRegistry(registry) {
  return `${JSON.stringify(registry, null, 2)}\n`;
}

function loadSchema() {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
}

function loadMaturitySchema() {
  return JSON.parse(readFileSync(MATURITY_SCHEMA_PATH, 'utf8'));
}

function loadDiscoverySchema() {
  return JSON.parse(readFileSync(DISCOVERY_SCHEMA_PATH, 'utf8'));
}

export function validateMaturityManifest(manifest, { artifactRoot } = {}) {
  const errors = validateAgainstSchema(loadMaturitySchema(), manifest);
  if (!artifactRoot || !manifest?.skills || typeof manifest.skills !== 'object') {
    return errors;
  }
  for (const [skill, maturity] of Object.entries(manifest.skills)) {
    for (const [index, evidence] of (maturity?.evidence ?? []).entries()) {
      const path = `$.skills.${skill}.evidence[${index}].reference`;
      try {
        const artifactPath = assertNoSymlinks(artifactRoot, evidence.reference);
        if (!existsSync(artifactPath)) {
          errors.push(`${path}: evidence artifact does not exist.`);
        } else if (!statSync(artifactPath).isFile()) {
          errors.push(`${path}: evidence artifact must be a regular file.`);
        } else if (sha256File(artifactPath) !== evidence.sha256) {
          errors.push(`${path}: evidence artifact hash does not match.`);
        }
      } catch (error) {
        errors.push(`${path}: ${error.message}`);
      }
    }
  }
  return errors;
}

export function validateRegistry(registry, previousRegistry = null) {
  const errors = validateAgainstSchema(loadSchema(), registry);
  const registrySkills = Array.isArray(registry.skills) ? registry.skills : [];
  const skillNames = registrySkills
    .filter((skill) => skill && typeof skill.name === 'string')
    .map((skill) => skill.name);
  if (new Set(skillNames).size !== skillNames.length) {
    errors.push('$.skills: skill names must be unique.');
  }
  const discoveryManifest = {
    schemaVersion: 1,
    skills: Object.fromEntries(
      registrySkills
        .filter((skill) => skill && typeof skill.name === 'string' && skill.discovery)
        .map((skill) => [skill.name, skill.discovery]),
    ),
  };
  errors.push(...validateDiscoveryManifest(loadDiscoverySchema(), discoveryManifest, skillNames));
  for (const [index, skill] of registrySkills.entries()) {
    errors.push(...validateMaturity(skill.tier, skill.maturity, `$.skills[${index}].maturity`));
  }
  if (previousRegistry) {
    const previousErrors = previousRegistry.schemaVersion < 3
      ? validateLegacyRegistry(previousRegistry)
      : validateAgainstSchema(loadSchema(), previousRegistry);
    for (const error of previousErrors) {
      errors.push(`previous registry: ${error}`);
    }
    const previousSkills = Array.isArray(previousRegistry.skills) ? previousRegistry.skills : [];
    const previousByName = new Map(previousSkills.map((skill) => [skill.name, skill]));
    for (const skill of registrySkills) {
      errors.push(...validateTierTransition(previousByName.get(skill.name) ?? null, skill));
    }
  }
  return errors;
}

function validateLegacyRegistry(registry) {
  const errors = [];
  if (!Array.isArray(registry.skills)) {
    return ['$.skills: expected type array.'];
  }
  for (const [index, skill] of registry.skills.entries()) {
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) {
      errors.push(`$.skills[${index}]: expected type object.`);
      continue;
    }
    if (typeof skill.name !== 'string') {
      errors.push(`$.skills[${index}].name: expected type string.`);
    }
    if (!['experimental', 'extended', 'core'].includes(skill.tier)) {
      errors.push(`$.skills[${index}].tier: value ${JSON.stringify(skill.tier)} is not a supported tier.`);
    }
  }
  return errors;
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const previousIndex = args.indexOf('--previous');
  const previousPath = previousIndex >= 0 ? args[previousIndex + 1] : null;
  if (previousIndex >= 0 && !previousPath) {
    throw new Error('--previous requires a registry path.');
  }
  const maturityManifest = JSON.parse(readFileSync(DEFAULT_MATURITY_PATH, 'utf8'));
  const discoveryManifest = JSON.parse(readFileSync(DEFAULT_DISCOVERY_PATH, 'utf8'));
  const registry = buildRegistry(
    DEFAULT_SKILLS_ROOT,
    maturityManifest,
    REPOSITORY_ROOT,
    discoveryManifest,
  );
  const previousRegistry = previousPath
    ? JSON.parse(readFileSync(resolve(previousPath), 'utf8'))
    : null;

  const errors = validateRegistry(registry, previousRegistry);
  if (errors.length > 0) {
    console.error('Generated registry failed schema validation:');
    for (const error of errors) console.error(`  ${error}`);
    process.exitCode = 1;
    return;
  }

  const serialized = serializeRegistry(registry);
  const registryRel = relative(REPOSITORY_ROOT, DEFAULT_REGISTRY_PATH).split(sep).join('/');

  if (check) {
    if (!existsSync(DEFAULT_REGISTRY_PATH)) {
      console.error(`${registryRel} does not exist. Run: node scripts/generate-registry.mjs`);
      process.exitCode = 1;
      return;
    }
    const committed = readFileSync(DEFAULT_REGISTRY_PATH, 'utf8');
    if (committed !== serialized) {
      console.error(`${registryRel} is out of date. Run: node scripts/generate-registry.mjs`);
      process.exitCode = 1;
      return;
    }
    console.log(`${registryRel} is up to date (${registry.skills.length} skills).`);
    return;
  }

  mkdirSync(dirname(DEFAULT_REGISTRY_PATH), { recursive: true });
  writeFileSync(DEFAULT_REGISTRY_PATH, serialized);
  console.log(`Wrote ${registryRel} (${registry.skills.length} skills).`);
}

const isEntryPoint = typeof process.argv[1] === 'string'
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

// Generates registry/skills.json from canonical skills and maintainer-authored
// registry manifests. Deterministic output (no timestamps) lets `--check`
// enforce that the committed file is current in CI. Validates the generated
// registry against schemas/registry.schema.json.

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
import {
  annualReviewDueAt,
  exceedsAnnualReviewInterval,
  isCalendarDate,
  normalizeLifecycle,
  validateLifecycle,
  validateOriginTransitions,
} from './lib/lifecycle.mjs';
import { validateMaturity, validateTierTransition } from './lib/tier-policy.mjs';
import {
  normalizePacks,
  validatePackManifest,
  validatePackTransitions,
} from './lib/packs.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SKILLS_ROOT = resolve(REPOSITORY_ROOT, 'skills');
const DEFAULT_REGISTRY_PATH = resolve(REPOSITORY_ROOT, 'registry', 'skills.json');
const DEFAULT_MATURITY_PATH = resolve(REPOSITORY_ROOT, 'registry', 'maturity.json');
const DEFAULT_DISCOVERY_PATH = resolve(REPOSITORY_ROOT, 'registry', 'discovery.json');
const DEFAULT_LIFECYCLE_PATH = resolve(REPOSITORY_ROOT, 'registry', 'lifecycle.json');
const DEFAULT_PACKS_PATH = resolve(REPOSITORY_ROOT, 'registry', 'packs.json');
const SCHEMA_PATH = resolve(REPOSITORY_ROOT, 'schemas', 'registry.schema.json');
const MATURITY_SCHEMA_PATH = resolve(REPOSITORY_ROOT, 'schemas', 'maturity-evidence.schema.json');
const DISCOVERY_SCHEMA_PATH = resolve(REPOSITORY_ROOT, 'schemas', 'registry-discovery.schema.json');
const LIFECYCLE_SCHEMA_PATH = resolve(REPOSITORY_ROOT, 'schemas', 'lifecycle.schema.json');
const PACKS_SCHEMA_PATH = resolve(REPOSITORY_ROOT, 'schemas', 'packs.schema.json');

// Builds the registry object from a skills root. Pure and deterministic.
export function buildRegistry(
  skillsRoot = DEFAULT_SKILLS_ROOT,
  maturityManifest = { schemaVersion: 1, skills: {} },
  artifactRoot = skillsRoot,
  discoveryManifest = null,
  lifecycleManifest = null,
  asOf = new Date().toISOString().slice(0, 10),
  packsManifest = { schemaVersion: 1, packs: [], removed: {} },
) {
  const manifestErrors = validateMaturityManifest(maturityManifest, { artifactRoot });
  if (manifestErrors.length > 0) {
    throw new Error(`Invalid maturity evidence manifest:\n${manifestErrors.join('\n')}`);
  }
  const skills = discoverSkills(skillsRoot);
  const skillNames = new Set(skills.map((skill) => skill.name));
  const effectiveLifecycle = lifecycleManifest ?? {
    schemaVersion: 1,
    skills: Object.fromEntries(skills.map((skill) => [skill.name, {
      status: 'active',
      license: parseFrontmatter(
        readFileSync(resolve(skill.dir, 'SKILL.md'), 'utf8'),
      ).data.license,
      lastReviewedAt: asOf,
      reviewDueAt: annualReviewDueAt(asOf),
      origin: {
        type: 'first-party',
        repository: 'https://github.com/Cody-Sims/agent-skills',
        ref: '0'.repeat(40),
        commit: '0'.repeat(40),
      },
    }])),
    removed: {},
  };
  const lifecycleErrors = validateLifecycleManifest(
    effectiveLifecycle,
    skillsRoot,
    asOf,
    discoveryManifest,
  );
  if (lifecycleErrors.length > 0) {
    throw new Error(`Invalid lifecycle manifest:\n${lifecycleErrors.join('\n')}`);
  }
  const normalizedLifecycle = normalizeLifecycle(effectiveLifecycle);
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
      lifecycle: normalizedLifecycle.skills[skill.name],
      path: `skills/${skill.name}`,
      skillFile: `skills/${skill.name}/SKILL.md`,
      sha256: sha256(content),
      resources,
    });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const packErrors = validatePackManifest(loadPacksSchema(), packsManifest, entries);
  if (packErrors.length > 0) {
    throw new Error(`Invalid pack manifest:\n${packErrors.join('\n')}`);
  }
  const normalizedPacks = normalizePacks(packsManifest);
  return {
    schemaVersion: 5,
    skills: entries,
    removed: normalizedLifecycle.removed,
    packs: normalizedPacks.packs,
    removedPacks: normalizedPacks.removed,
  };
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

function loadLifecycleSchema() {
  return JSON.parse(readFileSync(LIFECYCLE_SCHEMA_PATH, 'utf8'));
}

function loadPacksSchema() {
  return JSON.parse(readFileSync(PACKS_SCHEMA_PATH, 'utf8'));
}

export function validateLifecycleManifest(
  manifest,
  skillsRoot = DEFAULT_SKILLS_ROOT,
  asOf = new Date().toISOString().slice(0, 10),
  discoveryManifest = null,
) {
  return validateLifecycle(
    loadLifecycleSchema(),
    manifest,
    skillsRoot,
    asOf,
    discoveryManifest,
  );
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

export function validateRegistry(
  registry,
  previousRegistry = null,
  asOf = new Date().toISOString().slice(0, 10),
) {
  const errors = validateAgainstSchema(loadSchema(), registry);
  const registrySkills = Array.isArray(registry.skills) ? registry.skills : [];
  const skillNames = registrySkills
    .filter((skill) => skill && typeof skill.name === 'string')
    .map((skill) => skill.name);
  errors.push(...validateUniqueRegistrySkillNames(registry));
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
  errors.push(...validateRegistryLifecycle(registry, asOf));
  const packManifest = {
    schemaVersion: 1,
    packs: Array.isArray(registry.packs) ? registry.packs : [],
    removed: registry.removedPacks && typeof registry.removedPacks === 'object'
      ? registry.removedPacks
      : {},
  };
  errors.push(...validatePackManifest(loadPacksSchema(), packManifest, registrySkills));
  if (previousRegistry) {
    const previousVersion = previousRegistry.schemaVersion;
    const previousErrors = Number.isInteger(previousVersion)
      && previousVersion >= 1
      && previousVersion <= 4
      ? validateLegacyRegistry(previousRegistry)
      : previousVersion === 5
        ? [
          ...validateAgainstSchema(loadSchema(), previousRegistry),
          ...validateUniqueRegistrySkillNames(previousRegistry),
        ]
        : ['schemaVersion must be an integer from 1 through 5.'];
    for (const error of previousErrors) {
      errors.push(`previous registry: ${error}`);
    }
    if (previousErrors.length === 0) {
      const previousSkills = previousRegistry.skills;
      const previousByName = new Map(previousSkills.map((skill) => [skill.name, skill]));
      for (const skill of registrySkills) {
        errors.push(...validateTierTransition(previousByName.get(skill.name) ?? null, skill));
      }
      errors.push(...validateOriginTransitions(previousRegistry, registry));
      const previousPackManifest = previousVersion === 5 ? {
        schemaVersion: 1,
        packs: previousRegistry.packs,
        removed: previousRegistry.removedPacks,
      } : {
        schemaVersion: 1,
        packs: [],
        removed: {},
      };
      errors.push(...validatePackTransitions(previousPackManifest, packManifest));
    }
  }
  return errors;
}

function validateRegistryLifecycle(registry, asOf) {
  const errors = [];
  if (!isCalendarDate(asOf)) return ['$: --as-of must be a valid calendar date in YYYY-MM-DD form.'];
  const active = Object.fromEntries(
    (registry.skills ?? []).filter((skill) => skill?.name).map((skill) => [skill.name, skill.lifecycle]),
  );
  const removed = registry.removed && typeof registry.removed === 'object' ? registry.removed : {};
  const all = { ...active, ...removed };
  for (const [name, record] of Object.entries(all)) {
    const base = active[name] ? `$.skills.${name}.lifecycle` : `$.removed.${name}`;
    if (!isCalendarDate(record?.lastReviewedAt)) {
      errors.push(`${base}.lastReviewedAt: must be a valid calendar date.`);
    } else if (record.lastReviewedAt > asOf) {
      errors.push(`${base}.lastReviewedAt: lastReviewedAt must not be after --as-of ${asOf}.`);
    }
    if (record?.reviewDueAt !== undefined) {
      if (!isCalendarDate(record.reviewDueAt)) {
        errors.push(`${base}.reviewDueAt: must be a valid calendar date.`);
      } else {
        if (record.reviewDueAt <= record.lastReviewedAt) {
          errors.push(`${base}.reviewDueAt: reviewDueAt must be after lastReviewedAt.`);
        }
        if (record.reviewDueAt < asOf) {
          errors.push(`${base}.reviewDueAt: review expired before --as-of ${asOf}.`);
        }
        if (exceedsAnnualReviewInterval(record.lastReviewedAt, record.reviewDueAt)) {
          errors.push(`${base}.reviewDueAt: review interval must not exceed one calendar year.`);
        }
      }
    }
    const runtimeCompatibility = (registry.skills ?? [])
      .find((skill) => skill?.name === name)
      ?.discovery?.runtimeCompatibility;
    const compatibilitySensitive = Array.isArray(runtimeCompatibility)
      && runtimeCompatibility.some((runtime) => runtime?.status !== 'compatible');
    if (record?.origin?.type === 'external' && record.reviewDueAt === undefined) {
      errors.push(`${base}.reviewDueAt: external skills require a scheduled review.`);
    } else if (compatibilitySensitive && record.reviewDueAt === undefined) {
      errors.push(`${base}.reviewDueAt: compatibility-sensitive skills require a scheduled review.`);
    }
    if (record?.replacement) {
      if (record.replacement === name) errors.push(`${base}.replacement: must not reference itself.`);
      else if (removed[record.replacement]) errors.push(`${base}.replacement: must not be removed.`);
      else if (!active[record.replacement]) errors.push(`${base}.replacement: does not exist.`);
    }
  }
  for (const start of Object.keys(all)) {
    const seen = new Set();
    let current = start;
    while (all[current]?.replacement) {
      if (seen.has(current)) {
        errors.push('$.lifecycle: replacement cycle detected.');
        break;
      }
      seen.add(current);
      current = all[current].replacement;
    }
  }
  return [...new Set(errors)];
}

function validateLegacyRegistry(registry) {
  const errors = [];
  if (!Number.isInteger(registry?.schemaVersion)
    || registry.schemaVersion < 1
    || registry.schemaVersion > 4) {
    return ['schemaVersion must be an integer from 1 through 4 for a legacy registry.'];
  }
  if (!Array.isArray(registry.skills)) {
    return ['$.skills: expected type array.'];
  }
  errors.push(...validateUniqueRegistrySkillNames(registry));
  const registrySchema = loadSchema();
  const skillSchema = registrySchema.properties.skills.items;
  const requiredFields = [
    'name',
    'description',
    'path',
    'skillFile',
    'sha256',
    'resources',
  ];
  if (registry.schemaVersion >= 2) requiredFields.push('maturity');
  if (registry.schemaVersion >= 3) requiredFields.push('discovery');
  if (registry.schemaVersion >= 4) requiredFields.push('lifecycle');
  for (const [index, skill] of registry.skills.entries()) {
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) {
      errors.push(`$.skills[${index}]: expected type object.`);
      continue;
    }
    for (const field of requiredFields) {
      if (!(field in skill)) {
        errors.push(`$.skills[${index}]: missing required property "${field}".`);
        continue;
      }
      validateAgainstSchema(
        skillSchema.properties[field],
        skill[field],
        `$.skills[${index}].${field}`,
        errors,
        registrySchema,
      );
    }
    for (const field of ['version', 'license', 'tier']) {
      if (field in skill) {
        validateAgainstSchema(
          skillSchema.properties[field],
          skill[field],
          `$.skills[${index}].${field}`,
          errors,
          registrySchema,
        );
      }
    }
  }
  if (registry.schemaVersion >= 4) {
    if (!registry.removed || typeof registry.removed !== 'object' || Array.isArray(registry.removed)) {
      errors.push('$: missing required property "removed".');
    } else {
      validateAgainstSchema(
        registrySchema.properties.removed,
        registry.removed,
        '$.removed',
        errors,
        registrySchema,
      );
    }
  }
  return errors;
}

function validateUniqueRegistrySkillNames(registry) {
  if (!Array.isArray(registry?.skills)) return [];
  const names = registry.skills
    .filter((skill) => skill && typeof skill.name === 'string')
    .map((skill) => skill.name);
  return new Set(names).size === names.length
    ? []
    : ['$.skills: skill names must be unique.'];
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const asOfIndex = args.indexOf('--as-of');
  const asOf = asOfIndex >= 0 ? args[asOfIndex + 1] : new Date().toISOString().slice(0, 10);
  if (asOfIndex >= 0 && !asOf) throw new Error('--as-of requires YYYY-MM-DD.');
  const previousIndex = args.indexOf('--previous');
  const previousPath = previousIndex >= 0 ? args[previousIndex + 1] : null;
  if (previousIndex >= 0 && !previousPath) {
    throw new Error('--previous requires a registry path.');
  }
  const maturityManifest = JSON.parse(readFileSync(DEFAULT_MATURITY_PATH, 'utf8'));
  const discoveryManifest = JSON.parse(readFileSync(DEFAULT_DISCOVERY_PATH, 'utf8'));
  const lifecycleManifest = JSON.parse(readFileSync(DEFAULT_LIFECYCLE_PATH, 'utf8'));
  const packsManifest = JSON.parse(readFileSync(DEFAULT_PACKS_PATH, 'utf8'));
  const registry = buildRegistry(
    DEFAULT_SKILLS_ROOT,
    maturityManifest,
    REPOSITORY_ROOT,
    discoveryManifest,
    lifecycleManifest,
    asOf,
    packsManifest,
  );
  const previousRegistry = previousPath
    ? JSON.parse(readFileSync(resolve(previousPath), 'utf8'))
    : null;

  const errors = validateRegistry(registry, previousRegistry, asOf);
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

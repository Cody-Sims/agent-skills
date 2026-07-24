#!/usr/bin/env node

// Generates registry/skills.json from skills/*/SKILL.md. Deterministic output
// (no timestamps) so `--check` can enforce that the committed file is current
// in CI. Validates the generated registry against schemas/registry.schema.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { discoverSkills } from './lib/skills.mjs';
import { parseFrontmatter } from './lib/frontmatter.mjs';
import { sha256, walkFiles } from './lib/paths.mjs';
import { validateAgainstSchema } from './lib/jsonschema.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SKILLS_ROOT = resolve(REPOSITORY_ROOT, 'skills');
const DEFAULT_REGISTRY_PATH = resolve(REPOSITORY_ROOT, 'registry', 'skills.json');
const SCHEMA_PATH = resolve(REPOSITORY_ROOT, 'schemas', 'registry.schema.json');

// Builds the registry object from a skills root. Pure and deterministic.
export function buildRegistry(skillsRoot = DEFAULT_SKILLS_ROOT) {
  const skills = discoverSkills(skillsRoot);
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
      path: `skills/${skill.name}`,
      skillFile: `skills/${skill.name}/SKILL.md`,
      sha256: sha256(content),
      resources,
    });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { schemaVersion: 1, skills: entries };
}

export function serializeRegistry(registry) {
  return `${JSON.stringify(registry, null, 2)}\n`;
}

function loadSchema() {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
}

export function validateRegistry(registry) {
  return validateAgainstSchema(loadSchema(), registry);
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const registry = buildRegistry();

  const errors = validateRegistry(registry);
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

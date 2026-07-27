#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateRegistry } from './generate-registry.mjs';
import { queryRegistry } from './lib/registry-query.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REGISTRY_PATH = resolve(REPOSITORY_ROOT, 'registry', 'skills.json');
const VALUE_FLAGS = new Map([
  ['--category', 'category'],
  ['--input', 'input'],
  ['--output', 'output'],
  ['--risk', 'risk'],
  ['--runtime', 'runtime'],
  ['--runtime-status', 'runtimeStatus'],
  ['--tag', 'tags'],
]);

export function parseQueryArguments(args) {
  const filters = { tags: [] };
  let format = 'names';
  let registryPath = DEFAULT_REGISTRY_PATH;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === '--format' || flag === '--registry' || VALUE_FLAGS.has(flag)) {
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
      index += 1;
      if (flag === '--format') {
        if (!['json', 'names'].includes(value)) {
          throw new Error('--format must be json or names.');
        }
        format = value;
      } else if (flag === '--registry') {
        registryPath = resolve(value);
      } else {
        const key = VALUE_FLAGS.get(flag);
        if (key === 'tags') filters.tags.push(value);
        else if (filters[key]) throw new Error(`${flag} may be specified only once.`);
        else filters[key] = value;
      }
    } else {
      throw new Error(`Unknown argument: ${flag}.`);
    }
  }

  return { filters, format, registryPath };
}

function main() {
  const { filters, format, registryPath } = parseQueryArguments(process.argv.slice(2));
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const errors = validateRegistry(registry);
  if (errors.length > 0) {
    throw new Error(`Registry validation failed:\n${errors.join('\n')}`);
  }
  const matches = queryRegistry(registry, filters);
  if (format === 'json') {
    console.log(JSON.stringify(matches, null, 2));
  } else {
    for (const skill of matches) console.log(skill.name);
  }
}

const isEntryPoint = typeof process.argv[1] === 'string'
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

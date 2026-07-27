#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  validatePackResult,
  validatePackSuite,
} from './lib/pack-evaluations.mjs';
import { sha256, sha256File, walkFiles } from './lib/paths.mjs';
import {
  adapterLaunchDigests,
  normalizeSafeAdapterLaunch,
  portableAdapterLaunchPolicy,
} from './lib/safe-adapter-launch.mjs';
import {
  parseProvenanceArguments,
  verifyExactPackCommit,
} from './lib/pack-provenance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_OUTPUT_BYTES = 2 * 1024 * 1024;

function readJsonBytes(path) {
  const bytes = readFileSync(path);
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
}

function fixtureAdapterIdentity(suiteAdapter, root) {
  if (suiteAdapter.id !== 'deterministic-pack-fixture-v1' || suiteAdapter.kind !== 'fixture') {
    throw new Error('Artifact validation requires explicit adapter launch configuration for non-public adapters.');
  }
  const entrypoint = resolve(root, 'tests/fixtures/pack-adapter.mjs');
  const normalized = normalizeSafeAdapterLaunch({
    command: process.execPath,
    entrypoint,
    args: [entrypoint],
    environmentNames: [],
  });
  const launch = portableAdapterLaunchPolicy(normalized);
  const expectedSuite = {
    id: suiteAdapter.id,
    kind: suiteAdapter.kind,
    entrypointSha256: sha256File(entrypoint),
    policySha256: sha256(JSON.stringify({
      protocolVersion: 1,
      launch,
      timeoutMs: 10_000,
      maxOutputBytes: POLICY_OUTPUT_BYTES,
    })),
    launchPolicySha256: sha256(JSON.stringify(launch)),
  };
  if (JSON.stringify(expectedSuite) !== JSON.stringify(suiteAdapter)) {
    throw new Error('Public fixture adapter identity or launch policy is stale.');
  }
  return {
    ...expectedSuite,
    launchSha256: adapterLaunchDigests(normalized).launchSha256,
  };
}

export function validatePackFiles({
  root = ROOT,
  resultPaths = [],
  provenance = {
    mode: 'structural',
    valid: false,
    sourceCommit: null,
    allowAncestor: false,
  },
} = {}) {
  const suiteSchema = JSON.parse(readFileSync(resolve(ROOT, 'schemas/pack-suite.schema.json'), 'utf8'));
  const resultSchema = JSON.parse(readFileSync(resolve(ROOT, 'schemas/pack-result.schema.json'), 'utf8'));
  const registryPath = resolve(root, 'registry/skills.json');
  const registryFile = readJsonBytes(registryPath);
  const suitesRoot = resolve(root, 'evals/packs');
  const suiteFiles = walkFiles(suitesRoot).filter((path) => path.endsWith('.json'));
  const errors = [];
  const suites = new Map();
  for (const relativePath of suiteFiles) {
    try {
      const path = resolve(suitesRoot, relativePath);
      const suiteFile = readJsonBytes(path);
      suites.set(suiteFile.value.pack.name, suiteFile);
      if (suiteFile.value.source.suitePath !== `evals/packs/${relativePath}`) {
        errors.push(`${relativePath}: suite source path does not match its repository path.`);
      }
      const pack = registryFile.value.packs.find(({ name }) => name === suiteFile.value.pack.name);
      if (provenance.mode === 'provenance') {
        verifyExactPackCommit({
          root,
          sourceCommit: provenance.sourceCommit,
          allowAncestor: provenance.allowAncestor,
          suitePath: suiteFile.value.source.suitePath,
          suiteBytes: suiteFile.bytes,
          registryBytes: registryFile.bytes,
          registry: registryFile.value,
          pack,
          memberTreeSha256: suiteFile.value.source.memberTreeSha256,
        });
      }
      const suiteErrors = validatePackSuite(suiteSchema, suiteFile.value, {
        root,
        suiteBytes: suiteFile.bytes,
        registryBytes: registryFile.bytes,
        registry: registryFile.value,
      });
      errors.push(...suiteErrors.map((error) => `${relativePath}: ${error}`));
    } catch (error) {
      errors.push(`${relativePath}: ${error.message}`);
    }
  }
  const registryPacks = new Set(registryFile.value.packs.map(({ name }) => name));
  if (suiteFiles.length !== registryPacks.size
      || [...registryPacks].some((name) => !suites.has(name))) {
    errors.push('evals/packs: exactly one composition suite is required for every active registry pack.');
  }
  for (const resultPath of resultPaths) {
    try {
      const result = JSON.parse(readFileSync(resolve(resultPath), 'utf8'));
      const suiteFile = suites.get(result.pack?.name);
      if (!suiteFile) throw new Error(`result references unknown pack ${result.pack?.name}.`);
      const pack = registryFile.value.packs.find(({ name }) => name === result.pack.name);
      const resultErrors = validatePackResult(resultSchema, result, {
        root,
        suite: suiteFile.value,
        suiteBytes: suiteFile.bytes,
        registry: registryFile.value,
        registryBytes: registryFile.bytes,
        pack,
        adapter: fixtureAdapterIdentity(suiteFile.value.adapter, root),
        provenance,
      });
      errors.push(...resultErrors.map((error) => `${resultPath}: ${error}`));
    } catch (error) {
      errors.push(`${resultPath}: ${error.message}`);
    }
  }
  return { errors, suiteFiles };
}

function help() {
  console.log('Usage: node scripts/validate-pack-evaluations.mjs [--structural | --source-commit <40-hex> [--allow-ancestor]] [--result <artifact.json>]...');
  console.log('Structural mode is precommit-only and does not establish source provenance.');
}

async function main() {
  if (process.argv.includes('--help')) {
    help();
    return;
  }
  const provenance = parseProvenanceArguments(process.argv.slice(2), ROOT);
  const resultPaths = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    if (['--structural', '--allow-ancestor'].includes(process.argv[index])) continue;
    if (process.argv[index] === '--source-commit') {
      index += 1;
      continue;
    }
    if (process.argv[index] !== '--result' || !process.argv[index + 1]) {
      throw new Error(`Unknown or incomplete argument: ${process.argv[index]}.`);
    }
    resultPaths.push(process.argv[index + 1]);
    index += 1;
  }
  const result = validatePackFiles({ resultPaths, provenance });
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`error: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${result.suiteFiles.length} pack composition suites are valid in ${provenance.mode} mode${resultPaths.length ? `; ${resultPaths.length} artifacts are valid` : ''}.`);
}

const isEntryPoint = typeof process.argv[1] === 'string'
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isEntryPoint) main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
});

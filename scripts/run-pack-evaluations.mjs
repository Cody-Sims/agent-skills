#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPackProcessExecutor,
  runPackEvaluation,
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

function values(name) {
  const found = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === `--${name}` && process.argv[index + 1]) found.push(process.argv[index + 1]);
  }
  return found;
}

function value(name, fallback) {
  return values(name).at(-1) ?? fallback;
}

function help() {
  console.log('Usage: node scripts/run-pack-evaluations.mjs [--structural | --source-commit <40-hex> [--allow-ancestor]] --adapter @node --adapter-entrypoint <path> --adapter-arg <path> --adapter-id <id> --adapter-kind fixture|host --out-dir <dir>');
  console.log('Structural mode emits precommit evidence without valid source provenance.');
}

function assertKnownArguments() {
  const flags = new Set(['--structural', '--allow-ancestor', '--help']);
  const valued = new Set([
    '--source-commit', '--adapter', '--adapter-entrypoint', '--adapter-arg',
    '--adapter-env', '--adapter-id', '--adapter-kind', '--timeout-ms', '--out-dir',
  ]);
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (flags.has(argument)) continue;
    if (!valued.has(argument)) throw new Error(`Unknown argument: ${argument}.`);
    if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
      throw new Error(`Missing value for ${argument}.`);
    }
    index += 1;
  }
}

function readJsonBytes(path) {
  const bytes = readFileSync(path);
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
}

function adapterConfiguration() {
  const adapterValue = value('adapter');
  const entrypoint = resolve(value('adapter-entrypoint', ''));
  const adapterArgs = values('adapter-arg').map((argument) => {
    const local = resolve(ROOT, argument);
    return existsSync(local) ? local : argument;
  });
  const environmentNames = values('adapter-env');
  if (!adapterValue || !value('adapter-entrypoint') || !value('adapter-id') || !value('adapter-kind')) {
    throw new Error('Missing required adapter identity arguments; use --help.');
  }
  if (!['fixture', 'host'].includes(value('adapter-kind'))) throw new Error('--adapter-kind must be fixture or host.');
  if (!existsSync(entrypoint)) throw new Error('Adapter entrypoint does not exist.');
  const command = adapterValue === '@node' ? process.execPath : adapterValue;
  const timeoutMs = Number(value('timeout-ms', '10000'));
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('--timeout-ms must be a safe integer from 1 through 120000.');
  }
  const normalizedLaunch = normalizeSafeAdapterLaunch({
    command,
    entrypoint,
    args: adapterArgs,
    environmentNames,
  });
  const launchPolicy = portableAdapterLaunchPolicy(normalizedLaunch);
  const policy = {
    protocolVersion: 1,
    launch: launchPolicy,
    timeoutMs,
    maxOutputBytes: POLICY_OUTPUT_BYTES,
  };
  const actualDigests = adapterLaunchDigests(normalizedLaunch);
  const suiteIdentity = {
    id: value('adapter-id'),
    kind: value('adapter-kind'),
    entrypointSha256: sha256File(entrypoint),
    policySha256: sha256(JSON.stringify(policy)),
    launchPolicySha256: sha256(JSON.stringify(launchPolicy)),
  };
  return {
    command: normalizedLaunch.command,
    args: normalizedLaunch.args,
    entrypoint,
    environmentNames: normalizedLaunch.environmentNames,
    timeoutMs,
    suiteIdentity,
    identity: { ...suiteIdentity, launchSha256: actualDigests.launchSha256 },
  };
}

async function main() {
  if (process.argv.includes('--help')) {
    help();
    return;
  }
  assertKnownArguments();
  const provenance = parseProvenanceArguments(process.argv.slice(2), ROOT);
  const configuration = adapterConfiguration();
  const outDir = resolve(value('out-dir', 'tmp/pack-evaluations'));
  const registryFile = readJsonBytes(resolve(ROOT, 'registry/skills.json'));
  const suiteSchema = JSON.parse(readFileSync(resolve(ROOT, 'schemas/pack-suite.schema.json'), 'utf8'));
  const resultSchema = JSON.parse(readFileSync(resolve(ROOT, 'schemas/pack-result.schema.json'), 'utf8'));
  const suitesRoot = resolve(ROOT, 'evals/packs');
  const suiteFiles = walkFiles(suitesRoot).filter((path) => path.endsWith('.json'));
  mkdirSync(outDir, { recursive: true });
  let failed = false;
  for (const relativePath of suiteFiles) {
    const suiteFile = readJsonBytes(resolve(suitesRoot, relativePath));
    const suite = suiteFile.value;
    const suiteErrors = validatePackSuite(suiteSchema, suite, {
      root: ROOT,
      suiteBytes: suiteFile.bytes,
      registryBytes: registryFile.bytes,
      registry: registryFile.value,
    });
    if (suiteErrors.length > 0) throw new Error(`Pack suite ${relativePath} is invalid:\n${suiteErrors.join('\n')}`);
    if (JSON.stringify(configuration.suiteIdentity) !== JSON.stringify(suite.adapter)) {
      throw new Error(`Pack suite ${relativePath} does not bind the configured adapter identity and launch policy.`);
    }
    const pack = registryFile.value.packs.find(({ name }) => name === suite.pack.name);
    if (provenance.mode === 'provenance') {
      verifyExactPackCommit({
        root: ROOT,
        sourceCommit: provenance.sourceCommit,
        allowAncestor: provenance.allowAncestor,
        suitePath: suite.source.suitePath,
        suiteBytes: suiteFile.bytes,
        registryBytes: registryFile.bytes,
        registry: registryFile.value,
        pack,
        memberTreeSha256: suite.source.memberTreeSha256,
      });
    }
    const result = await runPackEvaluation({
      root: ROOT,
      suite,
      suiteBytes: suiteFile.bytes,
      registry: registryFile.value,
      registryBytes: registryFile.bytes,
      pack,
      adapter: configuration.identity,
      provenance,
      execute: createPackProcessExecutor(configuration),
    });
    const resultErrors = validatePackResult(resultSchema, result, {
      root: ROOT,
      suite,
      suiteBytes: suiteFile.bytes,
      registry: registryFile.value,
      registryBytes: registryFile.bytes,
      pack,
      adapter: configuration.identity,
      provenance,
    });
    if (resultErrors.length > 0) throw new Error(`Pack result ${suite.pack.name} is invalid:\n${resultErrors.join('\n')}`);
    writeFileSync(resolve(outDir, `${suite.pack.name}.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`${suite.pack.name}: ${result.status} (${result.evidence.label})`);
    failed ||= result.status === 'fail';
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
});

#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAgainstSchema } from './lib/jsonschema.mjs';
import {
  runRuntimeSmokeSuite,
  validateRuntimeSmokeResult,
  validateRuntimeSmokeSuite,
} from './lib/runtime-smoke.mjs';
import { sha256 } from './lib/paths.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HELP = `Usage: node scripts/run-runtime-smoke.mjs [options]

Required:
  --suite <path>                 Versioned smoke suite JSON
  --out <path>                   Result JSON destination

Options:
  --adapter <runtime=command>    Explicit adapter command (repeatable)
  --adapter-entrypoint <runtime=path> Reviewed adapter file (repeatable)
  --adapter-arg <runtime=value>  Adapter argument (repeatable)
  --adapter-env <runtime=NAME>   Allowed parent environment name (repeatable)
  --timeout-ms <number>          Per-adapter timeout (default: 30000; max: 120000)
  --help                         Show this help
`;

function values(name) {
  const found = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === `--${name}`) {
      if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
        throw new Error(`Missing value for --${name}.`);
      }
      found.push(process.argv[index + 1]);
      index += 1;
    }
  }
  return found;
}

function one(name) {
  const found = values(name);
  if (found.length !== 1) throw new Error(`Expected exactly one --${name} argument.`);
  return found[0];
}

function assignments(name) {
  return values(name).map((value) => {
    const index = value.indexOf('=');
    if (index <= 0 || index === value.length - 1) throw new Error(`--${name} must use runtime=value.`);
    return [value.slice(0, index), value.slice(index + 1)];
  });
}

function adapterConfiguration() {
  const adapters = new Map();
  for (const [runtime, command] of assignments('adapter')) {
    if (adapters.has(runtime)) throw new Error(`Duplicate adapter for ${runtime}.`);
    adapters.set(runtime, {
      command: command === '@node' ? process.execPath : command,
      entrypoint: null,
      args: [],
      environmentNames: [],
    });
  }
  for (const [runtime, entrypoint] of assignments('adapter-entrypoint')) {
    if (!adapters.has(runtime)) throw new Error(`--adapter-entrypoint references unconfigured runtime ${runtime}.`);
    if (adapters.get(runtime).entrypoint) throw new Error(`Duplicate adapter entrypoint for ${runtime}.`);
    adapters.get(runtime).entrypoint = existsSync(resolve(ROOT, entrypoint)) ? resolve(ROOT, entrypoint) : resolve(entrypoint);
  }
  for (const [runtime, arg] of assignments('adapter-arg')) {
    if (!adapters.has(runtime)) throw new Error(`--adapter-arg references unconfigured runtime ${runtime}.`);
    adapters.get(runtime).args.push(existsSync(resolve(ROOT, arg)) ? resolve(ROOT, arg) : arg);
  }
  for (const [runtime, name] of assignments('adapter-env')) {
    if (!adapters.has(runtime)) throw new Error(`--adapter-env references unconfigured runtime ${runtime}.`);
    adapters.get(runtime).environmentNames.push(name);
  }
  for (const [runtime, adapter] of adapters) {
    if (!adapter.entrypoint) throw new Error(`--adapter-entrypoint is required for configured runtime ${runtime}.`);
  }
  return adapters;
}

function assertKnownArguments() {
  const known = new Set(['--suite', '--out', '--adapter', '--adapter-entrypoint', '--adapter-arg', '--adapter-env', '--timeout-ms', '--help']);
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (!known.has(argument)) throw new Error(`Unknown argument: ${argument}.`);
    if (argument !== '--help') index += 1;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write(HELP);
    return;
  }
  assertKnownArguments();
  const suitePath = resolve(one('suite'));
  const outputPath = resolve(one('out'));
  const timeoutMs = Number(values('timeout-ms')[0] ?? 30_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('--timeout-ms must be an integer from 1 through 120000.');
  }
  if (values('timeout-ms').length > 1) throw new Error('Expected at most one --timeout-ms argument.');

  const suiteBytes = readFileSync(suitePath);
  const suite = JSON.parse(suiteBytes);
  const suiteSchema = readJson(resolve(ROOT, 'schemas/runtime-smoke-suite.schema.json'));
  const suiteErrors = [
    ...validateAgainstSchema(suiteSchema, suite),
    ...validateRuntimeSmokeSuite(suite),
  ];
  if (suiteErrors.length > 0) throw new Error(`Runtime smoke suite is invalid:\n${suiteErrors.join('\n')}`);

  const adapters = adapterConfiguration();
  for (const runtime of adapters.keys()) {
    if (!suite.runtimes.some((entry) => entry.runtime === runtime)) {
      throw new Error(`Adapter references runtime not present in suite: ${runtime}.`);
    }
  }
  const { results, skillSha256 } = await runRuntimeSmokeSuite({
    suite,
    suiteDirectory: dirname(suitePath),
    adapters,
    timeoutMs,
    tempBase: resolve(ROOT, 'tmp/runtime-smoke'),
  });
  const summary = { pass: 0, fail: 0, skip: 0 };
  for (const result of results) summary[result.status] += 1;
  const report = {
    schemaVersion: 1,
    suite: suite.name,
    suiteSha256: sha256(suiteBytes),
    skillSha256,
    generatedAt: new Date().toISOString(),
    runtimes: results,
    summary,
  };
  const resultSchema = readJson(resolve(ROOT, 'schemas/runtime-smoke-result.schema.json'));
  const resultErrors = [
    ...validateAgainstSchema(resultSchema, report),
    ...validateRuntimeSmokeResult(report),
  ];
  if (resultErrors.length > 0) throw new Error(`Runtime smoke result is invalid:\n${resultErrors.join('\n')}`);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${summary.pass} passed, ${summary.fail} failed, ${summary.skip} skipped`);
  console.log(`wrote ${outputPath}`);
  if (summary.fail > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

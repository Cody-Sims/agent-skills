#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runRoutingEvaluation,
  validateRoutingResult,
  validateRoutingSuite,
} from './lib/routing-evaluations.mjs';
import { runJsonAdapter } from './lib/process-adapter.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function argumentsFor(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === `--${name}` && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`Missing required --${name} argument.`);
  return value;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function createProcessAdapter({ command, args, timeoutMs, environmentNames }) {
  return async ({ case: routingCase, trial, workspace, catalog }) => {
    const request = {
      protocolVersion: 1,
      caseId: routingCase.id,
      prompt: routingCase.prompt,
      trial,
      catalog,
    };
    const { response, durationMs } = runJsonAdapter({
      command,
      args,
      cwd: workspace,
      request,
      timeoutMs,
      environmentNames,
      environment: { ROUTING_CASE_ID: routingCase.id, ROUTING_TRIAL: String(trial) },
      label: `Routing adapter for ${routingCase.id}/trial-${trial}`,
    });
    return {
      selectedSkills: response.selectedSkills,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      durationMs,
    };
  };
}

async function main() {
  const suitePath = resolve(requiredArgument('suite'));
  const outputPath = resolve(requiredArgument('out'));
  const adapter = requiredArgument('adapter');
  const adapterArgs = argumentsFor('adapter-arg').map((value) => {
    const localPath = resolve(ROOT, value);
    return existsSync(localPath) ? localPath : value;
  });
  const environmentNames = argumentsFor('adapter-env');
  const timeoutMs = Number(argument('timeout-ms') ?? 120_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms must be a positive number.');

  const suite = readJson(suitePath);
  const suiteSchema = readJson(resolve(ROOT, 'schemas/routing-suite.schema.json'));
  const suiteErrors = validateRoutingSuite(suiteSchema, suite);
  if (suiteErrors.length > 0) throw new Error(`Routing suite is invalid:\n${suiteErrors.join('\n')}`);

  const registry = readJson(resolve(ROOT, 'registry/skills.json'));
  const catalog = registry.skills.map(({ name, description }) => ({ name, description }));
  const catalogNames = new Set(catalog.map((skill) => skill.name));
  for (const routingCase of suite.cases) {
    for (const skill of [...routingCase.expected, ...routingCase.excluded]) {
      if (!catalogNames.has(skill)) throw new Error(`Routing case ${routingCase.id} references unknown skill ${skill}.`);
    }
  }

  const result = await runRoutingEvaluation({
    suite,
    catalog,
    execute: createProcessAdapter({ command: adapter, args: adapterArgs, timeoutMs, environmentNames }),
  });
  const resultSchema = readJson(resolve(ROOT, 'schemas/routing-result.schema.json'));
  const resultErrors = validateRoutingResult(resultSchema, result);
  if (resultErrors.length > 0) throw new Error(`Routing result is invalid:\n${resultErrors.join('\n')}`);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`training recall: ${(result.summary.training.recall * 100).toFixed(1)}%`);
  console.log(`validation recall: ${(result.summary.validation.recall * 100).toFixed(1)}%`);
  console.log(`overall precision: ${(result.summary.overall.precision * 100).toFixed(1)}%`);
  console.log(`collision rate: ${(result.summary.overall.collisionRate * 100).toFixed(1)}%`);
  console.log(`wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
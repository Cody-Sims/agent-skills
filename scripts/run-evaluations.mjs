#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runEvaluationSuite,
  validateEvaluationResult,
  validateEvaluationSuite,
} from './lib/evaluations.mjs';
import { sha256Tree } from './lib/paths.mjs';
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
  return async ({
    case: evaluationCase,
    variant,
    workspace,
    skillPath,
    skillContent,
  }) => {
    const request = {
      protocolVersion: 1,
      caseId: evaluationCase.id,
      prompt: evaluationCase.prompt,
      variant,
      skillPath,
      skillContent,
    };
    const { response, durationMs } = runJsonAdapter({
      command,
      args,
      cwd: workspace,
      request,
      timeoutMs,
      environmentNames,
      environment: { EVAL_VARIANT: variant, EVAL_CASE_ID: evaluationCase.id },
      label: `Evaluation adapter for ${evaluationCase.id}/${variant}`,
    });
    return {
      text: response.text,
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
  const suiteSchema = readJson(resolve(ROOT, 'schemas/eval-suite.schema.json'));
  const suiteErrors = validateEvaluationSuite(suiteSchema, suite);
  if (suiteErrors.length > 0) throw new Error(`Evaluation suite is invalid:\n${suiteErrors.join('\n')}`);

  const skillRoot = resolve(ROOT, 'skills', suite.skill);
  const skillPath = resolve(skillRoot, 'SKILL.md');
  if (!existsSync(skillPath)) throw new Error(`Evaluation skill does not exist: ${suite.skill}.`);
  const skillContent = readFileSync(skillPath, 'utf8');
  const result = await runEvaluationSuite({
    suite,
    suiteDirectory: dirname(suitePath),
    skillRoot,
    skillContent,
    skillSha256: sha256Tree(skillRoot),
    execute: createProcessAdapter({ command: adapter, args: adapterArgs, timeoutMs, environmentNames }),
  });
  const resultSchema = readJson(resolve(ROOT, 'schemas/eval-result.schema.json'));
  const resultErrors = validateEvaluationResult(resultSchema, result);
  if (resultErrors.length > 0) throw new Error(`Evaluation result is invalid:\n${resultErrors.join('\n')}`);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`baseline pass rate: ${(result.summary.baseline.passRate * 100).toFixed(1)}%`);
  console.log(`candidate pass rate: ${(result.summary.candidate.passRate * 100).toFixed(1)}%`);
  console.log(`pass rate delta: ${(result.summary.passRateDelta * 100).toFixed(1)} percentage points`);
  console.log(`wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
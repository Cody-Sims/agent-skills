#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateEvaluationSuite } from './lib/evaluations.mjs';
import { pathEntryExists, walkFiles } from './lib/paths.mjs';
import { validateRoutingSuite } from './lib/routing-evaluations.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function validateEvaluationFiles({ root = ROOT } = {}) {
  const evalSchema = JSON.parse(readFileSync(resolve(ROOT, 'schemas/eval-suite.schema.json'), 'utf8'));
  const routingSchema = JSON.parse(readFileSync(resolve(ROOT, 'schemas/routing-suite.schema.json'), 'utf8'));
  const evalsRoot = resolve(root, 'evals');
  const files = pathEntryExists(evalsRoot)
    ? walkFiles(evalsRoot).filter((path) => path === 'evals.json'
      || path === 'routing.json'
      || /^skills\/[^/]+\/(?:evals|routing)\.json$/.test(path))
    : [];
  const errors = [];
  let behaviorCases = 0;
  let routingCases = 0;
  for (const file of files) {
    try {
      const suite = JSON.parse(readFileSync(resolve(evalsRoot, file), 'utf8'));
      const suiteErrors = file.endsWith('/routing.json') || file === 'routing.json'
        ? validateRoutingSuite(routingSchema, suite)
        : validateEvaluationSuite(evalSchema, suite);
      if (file.endsWith('/routing.json') || file === 'routing.json') routingCases += suite.cases?.length ?? 0;
      else behaviorCases += suite.cases?.length ?? 0;
      errors.push(...suiteErrors.map((error) => `${file}: ${error}`));
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
    }
  }
  return { errors, files, behaviorCases, routingCases };
}

async function main() {
  const result = validateEvaluationFiles();
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`error: ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Evaluation suites are valid (${result.behaviorCases} behavior cases, ${result.routingCases} routing cases across ${result.files.length} files).`);
  }
}

const isEntryPoint = typeof process.argv[1] === 'string'
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  });
}
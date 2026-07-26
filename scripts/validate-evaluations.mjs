#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateEvaluationSuite } from './lib/evaluations.mjs';
import { validateRoutingSuite } from './lib/routing-evaluations.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const suitePath = resolve(ROOT, 'evals/evals.json');
const schemaPath = resolve(ROOT, 'schemas/eval-suite.schema.json');
const routingPath = resolve(ROOT, 'evals/routing.json');
const routingSchemaPath = resolve(ROOT, 'schemas/routing-suite.schema.json');

try {
  const suite = JSON.parse(readFileSync(suitePath, 'utf8'));
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const errors = validateEvaluationSuite(schema, suite);
  const routing = JSON.parse(readFileSync(routingPath, 'utf8'));
  const routingSchema = JSON.parse(readFileSync(routingSchemaPath, 'utf8'));
  const routingErrors = validateRoutingSuite(routingSchema, routing);
  const allErrors = [...errors, ...routingErrors];
  if (allErrors.length > 0) {
    for (const error of allErrors) console.error(`error: ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Evaluation suites are valid (${suite.cases.length} behavior cases, ${routing.cases.length} routing cases).`);
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
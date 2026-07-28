#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  approvalDigest,
  planRecurringAction,
  preflight,
  validateAuditTrail,
  validateItem,
  validateRun,
  verifyRun,
} from './lib/continuous-improvement.mjs';
import { validateAgainstSchema } from './lib/jsonschema.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`Missing required --${name} argument.`);
  return value;
}

function report(errors) {
  if (errors.length === 0) {
    console.log('Continuous improvement record is valid.');
    return;
  }
  for (const error of errors) console.error(`error: ${error}`);
  process.exitCode = 1;
}

function loadContext() {
  return {
    policy: readJson(resolve(ROOT, '.github/continuous-improvement/policy.json')),
    itemSchema: readJson(resolve(ROOT, 'schemas/improvement-item.schema.json')),
    runSchema: readJson(resolve(ROOT, 'schemas/improvement-run.schema.json')),
    auditEventSchema: readJson(resolve(ROOT, 'schemas/improvement-audit-event.schema.json')),
  };
}

function main() {
  const command = process.argv[2] ?? 'validate-policy';
  const context = loadContext();
  if (command === 'validate-policy') {
    const errors = [];
    if (context.policy.schemaVersion !== 1) errors.push('Policy schemaVersion must be 1.');
    for (const field of ['leaseMinutes', 'maxRetries', 'maxRunMinutes', 'maxActionsMinutes', 'maxAiCredits', 'maxMonthlyActionsMinutes', 'maxMonthlyAiCredits', 'maxConcurrentRuns', 'maxOpenPullRequests', 'maxProposalsPerLearningRun']) {
      if (!Number.isFinite(context.policy[field]) || context.policy[field] < 0) errors.push(`Policy ${field} must be a non-negative number.`);
    }
    if (!Array.isArray(context.policy.protectedPaths) || context.policy.protectedPaths.length === 0) errors.push('Policy protectedPaths must not be empty.');
    if (!Array.isArray(context.policy.approvedPermissions) || context.policy.approvedPermissions.length === 0) {
      errors.push('Policy approvedPermissions must not be empty.');
    } else if (context.policy.approvedPermissions.some((permission) => typeof permission !== 'string' || permission.length === 0)) {
      errors.push('Policy approvedPermissions must contain non-empty strings.');
    }
    if (typeof context.policy.recurringEnabled !== 'boolean') errors.push('Policy recurringEnabled must be boolean.');
    for (const field of ['minimumLearningIntervalHours', 'minimumImplementationIntervalHours']) {
      if (!Number.isFinite(context.policy[field]) || context.policy[field] < 0) {
        errors.push(`Policy ${field} must be a non-negative number.`);
      }
    }
    report(errors);
    return;
  }

  if (command === 'validate-audit') {
    report(validateAuditTrail(context.auditEventSchema, readJson(requireArgument('audit'))));
    return;
  }

  if (command === 'plan') {
    const queue = readJson(requireArgument('queue'));
    const plan = planRecurringAction({
      queue,
      policy: context.policy,
      now: argument('now') ?? new Date().toISOString(),
    });
    const schema = readJson(resolve(ROOT, 'schemas/orchestration-plan.schema.json'));
    const errors = validateAgainstSchema(schema, plan);
    if (errors.length > 0) {
      report(errors);
      return;
    }
    console.log(JSON.stringify(plan));
    return;
  }

  const item = readJson(requireArgument('item'));
  if (command === 'digest') {
    console.log(approvalDigest(item));
    return;
  }
  if (command === 'validate') {
    const runPath = argument('run');
    const auditPath = argument('audit');
    report([
      ...validateItem(context.itemSchema, item),
      ...(runPath ? validateRun(context.runSchema, readJson(runPath)) : []),
      ...(auditPath ? validateAuditTrail(context.auditEventSchema, readJson(auditPath)) : []),
    ]);
    return;
  }

  const run = readJson(requireArgument('run'));
  if (command === 'preflight') {
    report(preflight({ item, run, ...context }));
    return;
  }
  if (command === 'verify') {
    report(verifyRun({ item, run, ...context }));
    return;
  }
  throw new Error(`Unknown command: ${command}.`);
}

try {
  main();
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateAgainstSchema } from './lib/jsonschema.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_POLICY = resolve(
  ROOT,
  '.github/continuous-improvement/graduation-policy.json',
);
const POLICY_SCHEMA = resolve(ROOT, 'schemas/graduation-policy.schema.json');
const REPORT_SCHEMA = resolve(ROOT, 'schemas/pilot-report.schema.json');

function calendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function rate(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function validatePilotReport(report, policy, schema) {
  const errors = validateAgainstSchema(schema, report);
  if (errors.length > 0) return errors;

  if (!calendarDate(report.period.startedAt) || !calendarDate(report.period.endedAt)) {
    errors.push('$.period: startedAt and endedAt must be valid calendar dates.');
  } else if (report.period.startedAt > report.period.endedAt) {
    errors.push('$.period: startedAt must not follow endedAt.');
  }
  if (report.proposals.accepted > report.proposals.total) {
    errors.push('$.proposals.accepted: cannot exceed total proposals.');
  }
  if (report.proposals.duplicates > report.proposals.total) {
    errors.push('$.proposals.duplicates: cannot exceed total proposals.');
  }
  if (report.improvements.completed > report.improvements.attempted) {
    errors.push('$.improvements.completed: cannot exceed attempted improvements.');
  }
  if (report.improvements.independentlyReviewed > report.improvements.completed) {
    errors.push('$.improvements.independentlyReviewed: cannot exceed completed improvements.');
  }
  const evidenceByType = new Map();
  const evidenceReferences = new Set();
  for (const [index, evidence] of report.evidence.entries()) {
    const entries = evidenceByType.get(evidence.type) ?? [];
    entries.push(evidence.reference);
    evidenceByType.set(evidence.type, entries);
    if (evidenceReferences.has(evidence.reference)) {
      errors.push(`$.evidence[${index}].reference: evidence references must be unique.`);
    }
    evidenceReferences.add(evidence.reference);
  }
  const evidenceMinimums = new Map([
    ['proposal-cycle', report.proposalCycles],
    ['pull-request', report.improvements.independentlyReviewed],
    ['evaluation', report.improvements.completed],
    ['maintainer-review', report.improvements.independentlyReviewed],
  ]);
  if (report.improvements.completed > 0) evidenceMinimums.set('billing', 1);
  for (const [type, minimum] of evidenceMinimums) {
    const count = evidenceByType.get(type)?.length ?? 0;
    if (count < minimum) {
      errors.push(`$.evidence: ${type} requires at least ${minimum} distinct record(s); found ${count}.`);
    }
  }

  const proposalAcceptanceRate = rate(report.proposals.accepted, report.proposals.total);
  const duplicateRate = rate(report.proposals.duplicates, report.proposals.total);
  const implementationSuccessRate = rate(
    report.improvements.completed,
    report.improvements.attempted,
  );
  const meanAiCredits = rate(
    report.usage.totalAiCredits,
    report.improvements.completed,
  );
  const meanMaintainerMinutes = rate(
    report.usage.totalMaintainerMinutes,
    report.improvements.completed,
  );
  const failedGates = [];
  if (report.proposalCycles < policy.minimumProposalCycles) failedGates.push('proposal cycles');
  if (report.improvements.independentlyReviewed < policy.minimumImprovementPullRequests) {
    failedGates.push('independently reviewed improvement pull requests');
  }
  if (proposalAcceptanceRate < policy.minimumProposalAcceptanceRate) {
    failedGates.push('proposal acceptance rate');
  }
  if (duplicateRate > policy.maximumDuplicateRate) failedGates.push('duplicate rate');
  if (implementationSuccessRate < policy.minimumImplementationSuccessRate) {
    failedGates.push('implementation success rate');
  }
  if (report.meanEvaluationDelta < policy.minimumMeanEvaluationDelta) {
    failedGates.push('mean evaluation delta');
  }
  if (meanAiCredits > policy.maximumMeanAiCreditsPerImprovement) {
    failedGates.push('mean AI credits');
  }
  if (meanMaintainerMinutes > policy.maximumMeanMaintainerMinutesPerImprovement) {
    failedGates.push('mean maintainer minutes');
  }
  if (report.decision.recommendation === 'graduate' && failedGates.length > 0) {
    errors.push(`$.decision.recommendation: graduation gates failed: ${failedGates.join(', ')}.`);
  }
  if (report.decision.recommendation === 'graduate'
      && (!report.decision.approvedBy || !report.decision.approvedAt)) {
    errors.push('$.decision: graduation requires maintainer approval and date.');
  }
  if (report.decision.approvedAt && !calendarDate(report.decision.approvedAt)) {
    errors.push('$.decision.approvedAt: must be a valid calendar date.');
  } else if (report.decision.approvedAt
      && (report.decision.approvedAt < report.period.startedAt
        || report.decision.approvedAt > report.period.endedAt)) {
    errors.push('$.decision.approvedAt: must fall within the pilot period.');
  }
  return errors;
}

function parseArguments(args) {
  let reportPath = null;
  let policyPath = DEFAULT_POLICY;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--help') return { help: true };
    if (args[index] === '--report' || args[index] === '--policy') {
      if (!args[index + 1]) throw new Error(`${args[index]} requires a path.`);
      if (args[index] === '--report') reportPath = resolve(args[index + 1]);
      else policyPath = resolve(args[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${args[index]}.`);
  }
  if (!reportPath) throw new Error('--report is required.');
  return { help: false, reportPath, policyPath };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/validate-pilot-report.mjs --report <report.json> [--policy <policy.json>]');
    return;
  }
  const report = JSON.parse(readFileSync(options.reportPath, 'utf8'));
  const policy = JSON.parse(readFileSync(options.policyPath, 'utf8'));
  const policySchema = JSON.parse(readFileSync(POLICY_SCHEMA, 'utf8'));
  const schema = JSON.parse(readFileSync(REPORT_SCHEMA, 'utf8'));
  const errors = [
    ...validateAgainstSchema(policySchema, policy).map((error) => `policy: ${error}`),
    ...validatePilotReport(report, policy, schema),
  ];
  if (errors.length > 0) {
    for (const error of errors) console.error(`error: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('Continuous improvement pilot report is valid.');
}

const isEntryPoint = typeof process.argv[1] === 'string'
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}

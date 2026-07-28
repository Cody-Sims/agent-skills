import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateAgainstSchema } from '../scripts/lib/jsonschema.mjs';
import { validatePilotReport } from '../scripts/validate-pilot-report.mjs';
import { REPO_ROOT } from './helpers.mjs';

const policy = JSON.parse(readFileSync(resolve(
  REPO_ROOT,
  '.github/continuous-improvement/graduation-policy.json',
), 'utf8'));
const schema = JSON.parse(readFileSync(resolve(
  REPO_ROOT,
  'schemas/pilot-report.schema.json',
), 'utf8'));
const policySchema = JSON.parse(readFileSync(resolve(
  REPO_ROOT,
  'schemas/graduation-policy.schema.json',
), 'utf8'));

function report() {
  return {
    schemaVersion: 1,
    period: { startedAt: '2026-07-01', endedAt: '2026-07-31' },
    proposalCycles: 3,
    proposals: { total: 6, accepted: 4, duplicates: 1 },
    improvements: { attempted: 4, completed: 4, independentlyReviewed: 3 },
    usage: { totalAiCredits: 12, totalMaintainerMinutes: 180 },
    meanEvaluationDelta: 0.1,
    limitations: ['Hosted results apply only to the tested repository and model versions.'],
    evidence: [
      { type: 'proposal-cycle', reference: 'https://example.test/issues/1' },
      { type: 'proposal-cycle', reference: 'https://example.test/issues/2' },
      { type: 'proposal-cycle', reference: 'https://example.test/issues/3' },
      { type: 'pull-request', reference: 'https://example.test/pulls/1' },
      { type: 'pull-request', reference: 'https://example.test/pulls/2' },
      { type: 'pull-request', reference: 'https://example.test/pulls/3' },
      { type: 'evaluation', reference: 'evidence/evaluation-1.json' },
      { type: 'evaluation', reference: 'evidence/evaluation-2.json' },
      { type: 'evaluation', reference: 'evidence/evaluation-3.json' },
      { type: 'evaluation', reference: 'evidence/evaluation-4.json' },
      { type: 'billing', reference: 'evidence/billing.json' },
      { type: 'maintainer-review', reference: 'https://example.test/reviews/1' },
      { type: 'maintainer-review', reference: 'https://example.test/reviews/2' },
      { type: 'maintainer-review', reference: 'https://example.test/reviews/3' },
    ],
    decision: {
      recommendation: 'graduate',
      approvedBy: 'maintainer',
      approvedAt: '2026-07-31',
    },
  };
}

test('graduation policy is strict and schema-valid', () => {
  assert.deepEqual(validateAgainstSchema(policySchema, policy), []);
});

test('accepts a complete independently approved report that passes every gate', () => {
  assert.deepEqual(validatePilotReport(report(), policy, schema), []);
});

test('rejects graduation before the required real cycles and reviews', () => {
  const candidate = report();
  candidate.proposalCycles = 2;
  candidate.improvements.independentlyReviewed = 2;
  candidate.decision.approvedBy = null;
  candidate.decision.approvedAt = null;
  const errors = validatePilotReport(candidate, policy, schema).join('\n');
  assert.match(errors, /proposal cycles/);
  assert.match(errors, /independently reviewed improvement pull requests/);
  assert.match(errors, /requires maintainer approval/);
});

test('rejects inconsistent counters and threshold regressions', () => {
  const candidate = report();
  candidate.proposals.accepted = 7;
  candidate.proposals.duplicates = 3;
  candidate.improvements.completed = 5;
  candidate.improvements.independentlyReviewed = 6;
  candidate.meanEvaluationDelta = -0.1;
  candidate.usage.totalAiCredits = 30;
  const errors = validatePilotReport(candidate, policy, schema).join('\n');
  assert.match(errors, /cannot exceed total proposals/);
  assert.match(errors, /cannot exceed attempted improvements/);
  assert.match(errors, /cannot exceed completed improvements/);
  assert.match(errors, /mean evaluation delta/);
  assert.match(errors, /mean AI credits/);
});

test('rejects unsupported counters, duplicate evidence, and out-of-period approval', () => {
  const candidate = report();
  candidate.evidence = [
    { type: 'proposal-cycle', reference: 'https://example.test/reused' },
    { type: 'pull-request', reference: 'https://example.test/reused' },
  ];
  candidate.decision.approvedAt = '2026-08-01';
  const errors = validatePilotReport(candidate, policy, schema).join('\n');
  assert.match(errors, /evidence references must be unique/);
  assert.match(errors, /proposal-cycle requires at least 3/);
  assert.match(errors, /pull-request requires at least 3/);
  assert.match(errors, /evaluation requires at least 4/);
  assert.match(errors, /billing requires at least 1/);
  assert.match(errors, /maintainer-review requires at least 3/);
  assert.match(errors, /must fall within the pilot period/);
});

test('revise and stop decisions may record failed gates without claiming graduation', () => {
  for (const recommendation of ['revise', 'stop']) {
    const candidate = report();
    candidate.proposalCycles = 0;
    candidate.proposals = { total: 0, accepted: 0, duplicates: 0 };
    candidate.improvements = { attempted: 0, completed: 0, independentlyReviewed: 0 };
    candidate.decision = { recommendation, approvedBy: null, approvedAt: null };
    assert.deepEqual(validatePilotReport(candidate, policy, schema), []);
  }
});

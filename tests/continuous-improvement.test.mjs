import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  approvalDigest,
  approveItem,
  claimItem,
  finishItem,
  pathMatches,
  preflight,
  validateItem,
  verifyRun,
} from '../scripts/lib/continuous-improvement.mjs';
import { REPO_ROOT } from './helpers.mjs';

const itemSchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/improvement-item.schema.json'), 'utf8'));
const runSchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/improvement-run.schema.json'), 'utf8'));
const policy = JSON.parse(readFileSync(resolve(REPO_ROOT, '.github/continuous-improvement/policy.json'), 'utf8'));
const NOW = '2026-07-25T12:00:00.000Z';

function proposedItem() {
  return {
    schemaVersion: 1,
    id: 'SI-100',
    title: 'Add a bounded check',
    objective: 'Make one behavior deterministic.',
    status: 'proposed',
    evidence: [{
      classification: 'verified',
      claim: 'The check does not exist.',
      url: null,
      publisher: null,
      retrievedAt: null,
      version: null,
    }],
    expectedBenefit: 'Reject invalid changes before review.',
    effort: 'S',
    risk: 'Low; the check is additive.',
    dependencies: [],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The check rejects invalid input.', verification: 'npm test' }],
    allowedPaths: ['scripts/**', 'tests/**'],
    approvedProtectedPaths: ['scripts/**', 'tests/**'],
    requiredChecks: ['npm test'],
    approval: null,
    lease: null,
    transitions: [{
      from: null,
      to: 'proposed',
      actor: 'skill-learning',
      role: 'learning-agent',
      at: NOW,
      reason: 'Evidence-backed proposal.',
    }],
  };
}

function activeRun(item, overrides = {}) {
  return {
    schemaVersion: 1,
    runId: item.lease.runId,
    itemId: item.id,
    leaseId: item.lease.id,
    agent: 'skill-improvement',
    model: null,
    startedAt: NOW,
    permissions: ['contents:read'],
    baseCommit: 'abcdef1',
    headCommit: null,
    changedPaths: ['scripts/check.mjs', 'tests/check.test.mjs'],
    checks: [],
    sources: [],
    usage: {
      durationMinutes: 5,
      retries: 0,
      actionsMinutes: 0,
      aiCredits: 1,
      openPullRequests: 0,
    },
    promptSha256: 'a'.repeat(64),
    finalState: 'active',
    stopReason: null,
    ...overrides,
  };
}

function claimedItem() {
  return claimItem(approveItem(proposedItem(), { actor: 'maintainer', now: NOW }), {
    owner: 'skill-improvement',
    runId: 'run-1',
    leaseId: 'lease-1',
    policy,
    now: NOW,
  });
}

test('maintainer approval binds the complete implementation scope', () => {
  const approved = approveItem(proposedItem(), { actor: 'maintainer', now: NOW });
  assert.equal(approved.status, 'ready');
  assert.equal(approved.approval.payloadSha256, approvalDigest(approved));
  assert.deepEqual(validateItem(itemSchema, approved), []);

  approved.allowedPaths.push('.github/workflows/**');
  assert.match(validateItem(itemSchema, approved).join('\n'), /approval is stale/);
});

test('item validation rejects fabricated or discontinuous transition histories', () => {
  const approved = approveItem(proposedItem(), { actor: 'maintainer', now: NOW });
  approved.transitions[1].role = 'learning-agent';
  approved.transitions[1].from = null;
  const errors = validateItem(itemSchema, approved).join('\n');
  assert.match(errors, /from must match the previous state/);
  assert.match(errors, /illegal transition or actor role/);
});

test('only ready and currently approved work can be claimed once', () => {
  const claimed = claimedItem();
  assert.equal(claimed.status, 'in-progress');
  assert.equal(claimed.lease.expiresAt, '2026-07-25T13:30:00.000Z');
  assert.throws(() => claimItem(claimed, {
    owner: 'other-agent', runId: 'run-2', policy, now: NOW,
  }), /Only a ready item/);
});

test('claim refuses attempts beyond the retry budget', () => {
  const approved = approveItem(proposedItem(), { actor: 'maintainer', now: NOW });
  assert.throws(() => claimItem(approved, {
    owner: 'skill-improvement', runId: 'run-4', policy, now: NOW, attempt: 4,
  }), /Retry budget exhausted/);
});

test('preflight enforces lease ownership, path scope, protected paths, and budgets', () => {
  const item = claimedItem();
  assert.deepEqual(preflight({ item, run: activeRun(item), policy, itemSchema, runSchema, now: NOW }), []);

  const run = activeRun(item, {
    leaseId: 'wrong-lease',
    changedPaths: ['.github/workflows/unapproved.yml', 'README.md'],
    usage: { durationMinutes: 61, retries: 3, actionsMinutes: 31, aiCredits: 6, openPullRequests: 2 },
  });
  const errors = preflight({ item, run, policy, itemSchema, runSchema, now: NOW }).join('\n');
  assert.match(errors, /lease ID/);
  assert.match(errors, /outside the approved scope/);
  assert.match(errors, /Protected path lacks explicit approval/);
  assert.match(errors, /budget exceeded/);
});

test('double-star path scopes include nested directories', () => {
  assert.equal(pathMatches('scripts/lib/nested/check.mjs', 'scripts/**'), true);
  assert.equal(pathMatches('docs/check.mjs', 'scripts/**'), false);
});

test('expired leases block implementation', () => {
  const item = claimedItem();
  const errors = preflight({
    item,
    run: activeRun(item),
    policy,
    itemSchema,
    runSchema,
    now: '2026-07-25T13:30:00.001Z',
  });
  assert.ok(errors.includes('Item lease has expired.'));
});

test('verification requires independent checks and a terminal run state', () => {
  const item = claimedItem();
  const validRun = activeRun(item, {
    checks: [{ name: 'npm test', passed: true, evidence: '45 tests passed.' }],
    finalState: 'draft-ready',
  });
  assert.deepEqual(verifyRun({ item, run: validRun, policy, itemSchema, runSchema, now: NOW }), []);

  const errors = verifyRun({ item, run: activeRun(item), policy, itemSchema, runSchema, now: NOW }).join('\n');
  assert.match(errors, /Required check has no result/);
  assert.match(errors, /terminal final state/);

  const impossibleDone = activeRun(item, {
    checks: [{ name: 'npm test', passed: true, evidence: '45 tests passed.' }],
    finalState: 'done',
  });
  assert.match(verifyRun({ item, run: impossibleDone, policy, itemSchema, runSchema, now: NOW }).join('\n'), /not in enum/);
});

test('policy protects every continuous-improvement implementation surface', () => {
  const protectedPaths = [
    '.github/agents/skill-improvement.agent.md',
    '.github/workflows/improvement-control.yml',
    '.github/ISSUE_TEMPLATE/skill-improvement.yml',
    '.github/PULL_REQUEST_TEMPLATE/skill-improvement.md',
    'schemas/improvement-item.schema.json',
    'scripts/continuous-improvement.mjs',
    'scripts/lib/continuous-improvement.mjs',
    'scripts/lib/jsonschema.mjs',
    'scripts/lib/paths.mjs',
    'scripts/lib/frontmatter.mjs',
    'scripts/lib/skills.mjs',
    'scripts/generate-registry.mjs',
    'scripts/lib/evaluations.mjs',
    'scripts/run-evaluations.mjs',
    'scripts/run-routing-evaluations.mjs',
    'scripts/validate-evaluations.mjs',
    'scripts/validate-contributions.mjs',
    'scripts/validate-skills.mjs',
    'scripts/lib/contribution-evidence.mjs',
    'scripts/lib/process-adapter.mjs',
    'scripts/lib/regex-grader.mjs',
    'schemas/eval-suite.schema.json',
    'schemas/routing-suite.schema.json',
    'schemas/contribution-evidence.schema.json',
    'evals/evals.json',
    'tests/continuous-improvement.test.mjs',
    'tests/evaluations.test.mjs',
    'tests/routing-evaluations.test.mjs',
    'tests/contribution-evidence.test.mjs',
    'tests/regex-grader.test.mjs',
    'tests/jsonschema.test.mjs',
    'tests/improvement-workflows.test.mjs',
    'tests/validate-skills.test.mjs',
    'tests/paths.test.mjs',
    'tests/frontmatter.test.mjs',
    'tests/generate-registry.test.mjs',
    'tests/fixtures/evaluation-adapter.mjs',
    'tests/fixtures/routing-adapter.mjs',
    'package.json',
  ];
  const item = claimedItem();
  item.approvedProtectedPaths = [];
  item.approval.payloadSha256 = approvalDigest(item);
  const run = activeRun(item, { changedPaths: protectedPaths });
  const errors = preflight({ item, run, policy, itemSchema, runSchema, now: NOW }).join('\n');
  for (const path of protectedPaths) assert.match(errors, new RegExp(`Protected path lacks explicit approval: ${path.replaceAll('.', '\\.')}\\.`));
});

test('an implementation agent can block work but cannot mark it done', () => {
  const item = claimedItem();
  const blocked = finishItem(item, {
    to: 'blocked', actor: 'skill-improvement', role: 'improvement-agent', reason: 'Evaluation regressed.', now: NOW,
  });
  assert.equal(blocked.status, 'blocked');
  assert.throws(() => finishItem(item, {
    to: 'done', actor: 'skill-improvement', role: 'improvement-agent', reason: 'Finished.', now: NOW,
  }), /Done requires a maintainer/);
});
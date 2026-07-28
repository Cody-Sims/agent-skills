import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  appendAuditEvent,
  approvalDigest,
  approveItem,
  claimItem,
  evaluateRun,
  expireItem,
  finishItem,
  pathMatches,
  preflight,
  rejectItem,
  validateAuditTrail,
  validateItem,
  verifyRun,
} from '../scripts/lib/continuous-improvement.mjs';
import { REPO_ROOT } from './helpers.mjs';

const itemSchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/improvement-item.schema.json'), 'utf8'));
const runSchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/improvement-run.schema.json'), 'utf8'));
const auditEventSchema = JSON.parse(readFileSync(resolve(REPO_ROOT, 'schemas/improvement-audit-event.schema.json'), 'utf8'));
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
    monthlyUsage: {
      actionsMinutes: 10,
      aiCredits: 2,
    },
    promptSha256: 'a'.repeat(64),
    finalState: 'active',
    stopReason: null,
    blockedOutcome: null,
    ...overrides,
  };
}

function claimedItem(item = proposedItem()) {
  return claimItem(approveItem(item, { actor: 'maintainer', now: NOW }), {
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
  assert.equal(pathMatches('scripts/../.github/workflows/pwn.yml', 'scripts/**'), false);
  assert.equal(pathMatches('/absolute/scripts/check.mjs', 'scripts/**'), false);
  assert.equal(pathMatches('scripts\\check.mjs', 'scripts/**'), false);
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
    headCommit: 'abcdef2',
    checks: [{
      name: 'npm test', passed: true, evidence: '45 tests passed.', headCommit: 'abcdef2',
    }],
    finalState: 'draft-ready',
  });
  assert.deepEqual(verifyRun({ item, run: validRun, policy, itemSchema, runSchema, now: NOW }), []);

  const errors = verifyRun({ item, run: activeRun(item), policy, itemSchema, runSchema, now: NOW }).join('\n');
  assert.match(errors, /Required check has no result/);
  assert.match(errors, /terminal final state/);

  const impossibleDone = activeRun(item, {
    headCommit: 'abcdef2',
    checks: [{
      name: 'npm test', passed: true, evidence: '45 tests passed.', headCommit: 'abcdef2',
    }],
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

test('interleaved claims use the audit log as an atomic compare-and-append boundary', () => {
  const approved = approveItem(proposedItem(), { actor: 'maintainer', now: NOW });
  const auditEvents = [];
  const first = claimItem(approved, {
    owner: 'agent-1',
    runId: 'run-1',
    leaseId: 'lease-1',
    policy,
    now: NOW,
    auditEvents,
  });
  assert.equal(first.lease.owner, 'agent-1');

  assert.throws(() => claimItem(structuredClone(approved), {
    owner: 'agent-2',
    runId: 'run-2',
    leaseId: 'lease-2',
    policy,
    now: NOW,
    auditEvents,
  }), (error) => {
    assert.equal(error.outcome.code, 'lease-conflict');
    assert.equal(error.auditEvent.outcome.code, 'lease-conflict');
    return true;
  });
  assert.deepEqual(validateAuditTrail(auditEventSchema, auditEvents), []);
});

test('rejection, lease expiry, and bounded retry produce reviewable state', () => {
  const auditEvents = [];
  const rejected = rejectItem(proposedItem(), {
    actor: 'maintainer', reason: 'Evidence is not actionable.', now: NOW, auditEvents,
  });
  assert.equal(rejected.status, 'rejected');

  const expired = expireItem(claimedItem(), {
    actor: 'ci',
    role: 'ci',
    now: '2026-07-25T13:30:00.001Z',
    auditEvents,
  });
  assert.equal(expired.status, 'blocked');
  assert.equal(expired.blockedOutcome.code, 'expired-claim');
  assert.deepEqual(validateItem(itemSchema, expired), []);

  const ready = approveItem(proposedItem(), { actor: 'maintainer', now: NOW });
  assert.throws(() => claimItem(ready, {
    owner: 'skill-improvement',
    runId: 'run-retry-exhausted',
    policy,
    now: '2026-07-25T13:31:00.000Z',
    attempt: policy.maxRetries + 2,
    auditEvents,
  }), (error) => {
    assert.equal(error.outcome.code, 'retry-exhausted');
    return true;
  });
  assert.deepEqual(validateAuditTrail(auditEventSchema, auditEvents), []);
});

test('audit chain detects modified events and broken links', () => {
  const events = [];
  appendAuditEvent(events, {
    eventType: 'state-transition',
    itemId: 'SI-100',
    runId: null,
    actor: 'maintainer',
    at: NOW,
    outcome: null,
    evidence: ['proposed -> ready'],
  });
  appendAuditEvent(events, {
    eventType: 'control-blocked',
    itemId: 'SI-100',
    runId: 'run-1',
    actor: 'ci',
    at: '2026-07-25T12:01:00.000Z',
    outcome: {
      code: 'required-check-failed',
      message: 'npm test failed.',
      evidence: ['check:npm test'],
    },
    evidence: ['head:abcdef2'],
  });
  assert.deepEqual(validateAuditTrail(auditEventSchema, events), []);

  const modified = structuredClone(events);
  modified[0].actor = 'attacker';
  assert.match(validateAuditTrail(auditEventSchema, modified).join('\n'), /hash/i);

  const removed = structuredClone(events);
  removed.shift();
  assert.match(validateAuditTrail(auditEventSchema, removed).join('\n'), /sequence|previous/i);
});

test('independent fault injection maps every stop condition to a typed audited outcome', () => {
  const cases = [
    {
      code: 'permission-expansion',
      mutate: ({ run }) => { run.permissions.push('contents:write'); },
    },
    {
      code: 'protected-path-change',
      mutate: ({ item, run }) => {
        item.approvedProtectedPaths = [];
        item.approval.payloadSha256 = approvalDigest(item);
        run.changedPaths = ['scripts/continuous-improvement.mjs'];
      },
    },
    {
      code: 'evaluation-regression',
      mutate: ({ run }) => {
        run.checks = [{
          name: 'quality eval',
          passed: true,
          evidence: 'Score fell from 0.9 to 0.8.',
          regressed: true,
        }];
      },
    },
    {
      code: 'required-check-failed',
      mutate: ({ run }) => {
        run.checks = [{ name: 'npm test', passed: false, evidence: '1 test failed.' }];
      },
    },
    {
      code: 'lease-conflict',
      mutate: ({ run }) => { run.leaseId = 'other-lease'; },
    },
    {
      code: 'run-budget-exhausted',
      mutate: ({ run }) => { run.usage.durationMinutes = policy.maxRunMinutes + 1; },
    },
    {
      code: 'monthly-budget-exhausted',
      mutate: ({ run }) => { run.monthlyUsage.aiCredits = policy.maxMonthlyAiCredits + 1; },
    },
  ];

  for (const fault of cases) {
    const item = claimedItem();
    const run = activeRun(item);
    fault.mutate({ item, run });
    const result = evaluateRun({
      item, run, policy, itemSchema, runSchema, auditEventSchema, now: NOW,
    });
    assert.equal(result.outcome.code, fault.code, fault.code);
    assert.equal(result.auditEvents.at(-1).outcome.code, fault.code, fault.code);
    assert.deepEqual(validateAuditTrail(auditEventSchema, result.auditEvents), [], fault.code);
  }
});

test('invalid and expired claims are typed and retry exhaustion is audited', () => {
  const auditEvents = [];
  assert.throws(() => claimItem(rejectItem(proposedItem(), {
    actor: 'maintainer', reason: 'Rejected.', now: NOW,
  }), {
    owner: 'agent',
    runId: 'run-invalid',
    policy,
    now: NOW,
    auditEvents,
  }), (error) => {
    assert.equal(error.outcome.code, 'invalid-claim');
    return true;
  });

  const expired = claimedItem();
  assert.throws(() => claimItem(expired, {
    owner: 'agent',
    runId: 'run-expired',
    policy,
    now: '2026-07-25T13:30:00.001Z',
    auditEvents,
  }), (error) => {
    assert.equal(error.outcome.code, 'expired-claim');
    return true;
  });

  const ready = approveItem(proposedItem(), { actor: 'maintainer', now: NOW });
  assert.throws(() => claimItem(ready, {
    owner: 'agent',
    runId: 'run-retry',
    policy,
    now: NOW,
    attempt: policy.maxRetries + 2,
    auditEvents,
  }), (error) => {
    assert.equal(error.outcome.code, 'retry-exhausted');
    return true;
  });
  assert.deepEqual(validateAuditTrail(auditEventSchema, auditEvents), []);
});

test('draft-ready binds successful required checks to the recorded head commit', () => {
  const item = claimedItem();
  const missingHead = activeRun(item, {
    checks: [{ name: 'npm test', passed: true, evidence: 'Passed.' }],
    finalState: 'draft-ready',
  });
  assert.match(verifyRun({
    item, run: missingHead, policy, itemSchema, runSchema, now: NOW,
  }).join('\n'), /head commit/i);

  const staleCheck = activeRun(item, {
    headCommit: 'abcdef2',
    checks: [{
      name: 'npm test', passed: true, evidence: 'Passed.', headCommit: 'abcdef1',
    }],
    finalState: 'draft-ready',
  });
  assert.match(verifyRun({
    item, run: staleCheck, policy, itemSchema, runSchema, now: NOW,
  }).join('\n'), /current head commit/i);

  const valid = activeRun(item, {
    headCommit: 'abcdef2',
    checks: [{
      name: 'npm test', passed: true, evidence: 'Passed.', headCommit: 'abcdef2',
    }],
    finalState: 'draft-ready',
  });
  const result = evaluateRun({
    item, run: valid, policy, itemSchema, runSchema, auditEventSchema, now: NOW,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.outcome, null);
  assert.equal(result.auditEvents.at(-1).eventType, 'run-verified');
  assert.equal(result.auditEvents.at(-1).data.headCommit, valid.headCommit);
});
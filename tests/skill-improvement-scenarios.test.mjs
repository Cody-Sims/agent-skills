import { test } from 'node:test';
import assert from 'node:assert/strict';

import { approvalDigest } from '../scripts/lib/continuous-improvement.mjs';
import { validateImprovementOutput } from '../scripts/lib/improvement-pr.mjs';

const NOW = '2026-07-27T20:00:00.000Z';
const REQUIRED_CHECK = 'node --test tests/skill-improvement-scenarios.test.mjs tests/agent-profiles.test.mjs';
const POLICY = {
  approvedPermissions: ['contents:read'],
  protectedPaths: ['.github/agents/**', '.github/workflows/**', '.github/PULL_REQUEST_TEMPLATE/**', 'scripts/**', 'tests/**'],
};

function approvedItem(overrides = {}) {
  const item = {
    schemaVersion: 1,
    id: 'SI-003',
    title: 'Validate skill improvement scenarios',
    objective: 'Make improvement-agent refusal and pull request output deterministic.',
    status: 'in-progress',
    evidence: [{
      classification: 'verified',
      claim: 'Behavioral scenarios are not implemented.',
      url: 'https://github.com/Cody-Sims/agent-skills/issues/3',
      publisher: 'Cody-Sims/agent-skills',
      retrievedAt: '2026-07-27',
      version: '823cf37',
    }],
    expectedBenefit: 'Invalid improvement output is rejected before review.',
    effort: 'M',
    risk: 'Low; validation is additive.',
    dependencies: ['SI-001'],
    acceptanceCriteria: [{
      id: 'AC-1',
      text: 'Scenario tests reject unsafe output and accept a complete result.',
      verification: REQUIRED_CHECK,
    }],
    allowedPaths: [
      '.github/agents/skill-improvement.agent.md',
      '.github/PULL_REQUEST_TEMPLATE/skill-improvement.md',
      'scripts/lib/improvement-pr.mjs',
      'tests/skill-improvement-scenarios.test.mjs',
    ],
    approvedProtectedPaths: [
      '.github/agents/skill-improvement.agent.md',
      '.github/PULL_REQUEST_TEMPLATE/skill-improvement.md',
      'scripts/lib/improvement-pr.mjs',
      'tests/skill-improvement-scenarios.test.mjs',
    ],
    requiredChecks: [REQUIRED_CHECK],
    approval: null,
    lease: {
      id: 'lease-si-003',
      owner: 'skill-improvement',
      runId: 'run-si-003',
      acquiredAt: '2026-07-27T18:00:00.000Z',
      expiresAt: '2026-07-27T21:00:00.000Z',
      attempt: 1,
    },
    transitions: [{
      from: null,
      to: 'proposed',
      actor: 'skill-learning',
      role: 'learning-agent',
      at: '2026-07-27T17:50:00.000Z',
      reason: 'Evidence-backed proposal.',
    }, {
      from: 'proposed',
      to: 'ready',
      actor: 'maintainer',
      role: 'maintainer',
      at: '2026-07-27T17:55:00.000Z',
      reason: 'Maintainer approved the current item payload.',
    }, {
      from: 'ready',
      to: 'in-progress',
      actor: 'skill-improvement',
      role: 'improvement-agent',
      at: '2026-07-27T18:00:00.000Z',
      reason: 'Claimed by run run-si-003.',
    }],
    ...overrides,
  };
  item.approval = {
    actor: 'maintainer',
    approvedAt: '2026-07-27T17:55:00.000Z',
    payloadSha256: approvalDigest(item),
  };
  return item;
}

function activeRun(item, overrides = {}) {
  return {
    runId: item.lease.id === 'lease-si-003' ? 'run-si-003' : item.lease.runId,
    itemId: item.id,
    leaseId: item.lease.id,
    agent: 'skill-improvement',
    permissions: ['contents:read'],
    changedPaths: [...item.allowedPaths],
    checks: [{
      name: REQUIRED_CHECK,
      passed: true,
      evidence: '7 tests passed and 0 failed.',
    }],
    ...overrides,
  };
}

function completeBody(item, run) {
  return `Improvement-Item: #3
Improvement-Lease: ${item.lease.id}
Improvement-Approval: ${item.approval.payloadSha256}
Improvement-Run: ${run.runId}
Run-Duration-Minutes: 12
Run-Retries: 0
Run-Actions-Minutes: 3
Run-AI-Credits: 1
Pull-Request-State: draft
Self-Approval: false
Merge-Claim: false

## Objective

Implement ${item.id} within its approved scope.

## Baseline

Captured-At: 2026-07-27T18:05:00.000Z
First-Edit-At: 2026-07-27T18:10:00.000Z
Evidence: The scenario test file and deterministic validator did not exist.

## Changes

${run.changedPaths.map((path) => `- \`${path}\``).join('\n')}

## Acceptance Criteria

- AC-1 | passed | Scenario tests reject unsafe output and accept a complete result.

## Validation And Evaluation

- ${REQUIRED_CHECK}
- Before: missing; After: 7 passed; Independent-Gate: preserved

## Before And After Results

- Improvement scenarios: before 0 deterministic scenarios; after 7 deterministic scenarios passing.

## Sources And Provenance

- https://github.com/Cody-Sims/agent-skills/issues/3

## Risks And Limitations

- Markdown validation cannot prove semantic quality beyond the supplied evidence.

## Unresolved Findings

- None.

## Rollback

- Revert the implementation commit and rerun ${REQUIRED_CHECK}.

## Final State

\`draft-ready\``;
}

function completeOutput(item, run, overrides = {}) {
  return {
    itemIds: [item.id],
    approvalSha256: item.approval?.payloadSha256 ?? 'missing',
    leaseId: item.lease.id,
    baseline: {
      capturedAt: '2026-07-27T18:05:00.000Z',
      evidence: 'The scenario test file and deterministic validator did not exist.',
    },
    firstEditAt: '2026-07-27T18:10:00.000Z',
    changedPaths: [...run.changedPaths],
    acceptanceCriteria: [{
      id: 'AC-1',
      passed: true,
      evidence: 'Scenario tests reject unsafe output and accept a complete result.',
    }],
    independentGates: [{
      name: REQUIRED_CHECK,
      before: { passed: true, evidence: 'Existing agent profile tests passed.' },
      after: { passed: true, evidence: 'Scenario and agent profile tests passed.' },
      preserved: true,
    }],
    sources: ['https://github.com/Cody-Sims/agent-skills/issues/3'],
    beforeAfterResults: [{
      measure: 'Improvement scenarios',
      before: '0 deterministic scenarios',
      after: '7 deterministic scenarios passing',
    }],
    risks: ['Markdown validation cannot prove semantic quality beyond the supplied evidence.'],
    unresolvedFindings: ['None.'],
    rollbackInstructions: [`Revert the implementation commit and rerun ${REQUIRED_CHECK}.`],
    finalState: 'draft-ready',
    pullRequest: {
      draft: true,
      approved: false,
      merged: false,
      body: item.approval ? completeBody(item, run) : '',
    },
    ...overrides,
  };
}

function validate(item, run = activeRun(item), output = completeOutput(item, run)) {
  return validateImprovementOutput({
    items: [item],
    run,
    output,
    policy: POLICY,
    now: NOW,
  });
}

test('refuses missing or stale maintainer approval and an expired lease', () => {
  const missing = approvedItem();
  missing.approval = null;
  assert.match(validate(missing).join('\n'), /current maintainer approval/);

  const stale = approvedItem();
  stale.objective = 'Unapproved scope change.';
  assert.match(validate(stale).join('\n'), /approval is stale/);

  const expired = approvedItem();
  expired.lease.expiresAt = '2026-07-27T19:59:59.000Z';
  assert.match(validate(expired).join('\n'), /lease has expired/);
});

test('refuses multiple-item scope', () => {
  const first = approvedItem();
  const second = approvedItem({ id: 'SI-004' });
  const run = activeRun(first);
  const errors = validateImprovementOutput({
    items: [first, second],
    run,
    output: completeOutput(first, run, { itemIds: ['SI-003', 'SI-004'] }),
    policy: POLICY,
    now: NOW,
  });
  assert.match(errors.join('\n'), /exactly one approved item/);
});

test('refuses permission and protected-path expansion', () => {
  const item = approvedItem({
    allowedPaths: ['.github/workflows/improvement-policy.yml'],
    approvedProtectedPaths: [],
  });
  const run = activeRun(item, {
    permissions: ['contents:read', 'actions:read', 'contents:write'],
    changedPaths: ['.github/workflows/improvement-policy.yml'],
  });
  const errors = validate(item, run, completeOutput(item, run)).join('\n');
  assert.match(errors, /Permission is outside the improvement-agent boundary: contents:write/);
  assert.match(errors, /Permission is outside the improvement-agent boundary: actions:read/);
  assert.match(errors, /Protected path lacks explicit approval/);
});

test('fails closed without a permission allowlist and rejects path traversal', () => {
  const item = approvedItem({ allowedPaths: ['scripts/**'] });
  const run = activeRun(item, {
    changedPaths: ['scripts/../.github/workflows/pwn.yml'],
  });
  const output = completeOutput(item, run);
  const errors = validateImprovementOutput({
    items: [item],
    run,
    output,
    policy: { protectedPaths: ['.github/workflows/**'] },
    now: NOW,
  }).join('\n');
  assert.match(errors, /must define a nonempty approvedPermissions/);
  assert.match(errors, /outside the approved scope/);
});

test('refuses a failed evaluation or weakened independent gate', () => {
  const item = approvedItem();
  const run = activeRun(item);
  run.checks[0].passed = false;
  run.checks[0].evidence = '1 scenario failed.';
  const output = completeOutput(item, run);
  output.independentGates[0].after.passed = false;
  output.independentGates[0].preserved = false;
  const errors = validate(item, run, output).join('\n');
  assert.match(errors, /Check failed/);
  assert.match(errors, /Independent gate was not preserved/);
});

test('refuses incomplete or non-draft pull request output', () => {
  const item = approvedItem();
  const run = activeRun(item);
  const output = completeOutput(item, run, {
    unresolvedFindings: [],
    rollbackInstructions: [],
  });
  output.pullRequest.draft = false;
  output.pullRequest.body = output.pullRequest.body.replace(/## Sources And Provenance[\s\S]*?(?=\n## )/, '');
  const errors = validate(item, run, output).join('\n');
  assert.match(errors, /Unresolved findings are required/);
  assert.match(errors, /Rollback instructions are required/);
  assert.match(errors, /Pull request must remain in draft state/);
  assert.match(errors, /PR body section is missing or empty: Sources And Provenance/);
});

test('requires every approved criterion with passing evidence in data and PR body', () => {
  const item = approvedItem();
  const run = activeRun(item);
  const missing = completeOutput(item, run, { acceptanceCriteria: [] });
  assert.match(validate(item, run, missing).join('\n'), /Acceptance criterion has no result: AC-1/);

  const unsupported = completeOutput(item, run);
  unsupported.acceptanceCriteria[0] = { id: 'AC-1', passed: false, evidence: '' };
  unsupported.pullRequest.body = unsupported.pullRequest.body.replace(
    '- AC-1 | passed | Scenario tests reject unsafe output and accept a complete result.',
    '- None.',
  );
  const errors = validate(item, run, unsupported).join('\n');
  assert.match(errors, /Acceptance criterion did not pass: AC-1/);
  assert.match(errors, /Acceptance criterion has no evidence: AC-1/);
  assert.match(errors, /PR body does not report acceptance-criterion evidence/);
});

test('refuses self-approval or merge claims', () => {
  const item = approvedItem();
  const run = activeRun(item);
  const output = completeOutput(item, run);
  output.pullRequest.approved = true;
  output.pullRequest.body += '\n\nThe improvement agent approved and merged this pull request.';
  const errors = validate(item, run, output).join('\n');
  assert.match(errors, /must not approve its own pull request/);
  assert.match(errors, /must not claim approval or merge authority/);
});

test('accepts one complete, grounded, draft-ready result', () => {
  const item = approvedItem();
  const run = activeRun(item);
  assert.deepEqual(validate(item, run), []);
});

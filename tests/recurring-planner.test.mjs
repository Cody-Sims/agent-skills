import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import * as improvement from '../scripts/lib/continuous-improvement.mjs';
import { makeTempDir, removeDir, REPO_ROOT } from './helpers.mjs';

const NOW = '2026-07-27T12:00:00.000Z';
const policy = {
  ...JSON.parse(readFileSync(resolve(
    REPO_ROOT,
    '.github/continuous-improvement/policy.json',
  ), 'utf8')),
  recurringEnabled: true,
  minimumLearningIntervalHours: 168,
  minimumImplementationIntervalHours: 24,
};

function proposedItem(id, dependencies = []) {
  return {
    schemaVersion: 1,
    id,
    title: `Implement ${id}`,
    objective: 'Deliver one bounded result.',
    status: 'proposed',
    evidence: [{
      classification: 'verified',
      claim: 'The result is not implemented.',
      url: null,
      publisher: null,
      retrievedAt: null,
      version: null,
    }],
    expectedBenefit: 'Close one verified gap.',
    effort: 'S',
    risk: 'Low.',
    dependencies,
    acceptanceCriteria: [{ id: 'AC-1', text: 'The result exists.', verification: 'npm test' }],
    allowedPaths: ['scripts/**'],
    approvedProtectedPaths: ['scripts/**'],
    requiredChecks: ['npm test'],
    approval: null,
    lease: null,
    blockedOutcome: null,
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

function readyItem(id, dependencies = []) {
  return improvement.approveItem(proposedItem(id, dependencies), {
    actor: 'maintainer',
    now: NOW,
  });
}

function queue(overrides = {}) {
  return {
    items: [],
    completedItemIds: [],
    activeRuns: [],
    monthlyUsage: {
      actionsMinutes: 0,
      aiCredits: 0,
      proposalsThisRun: 0,
    },
    lastLearningAt: null,
    lastImplementationAt: null,
    ...overrides,
  };
}

test('planner public interface exists and the kill switch fails closed', () => {
  assert.equal(typeof improvement.planRecurringAction, 'function');
  assert.deepEqual(improvement.planRecurringAction({
    queue: queue(),
    policy: { ...policy, recurringEnabled: false },
    now: NOW,
  }), {
    schemaVersion: 1,
    action: 'no-op',
    itemId: null,
    reason: 'recurring-disabled',
  });
});

test('planner accepts completed dependency identities outside the active queue', () => {
  const plan = improvement.planRecurringAction({
    queue: queue({
      items: [readyItem('SI-200', ['AS-100'])],
      completedItemIds: ['AS-100'],
    }),
    policy,
    now: NOW,
  });
  assert.equal(plan.action, 'implement');
  assert.equal(plan.itemId, 'SI-200');
});

test('planner refuses implementation while a lease or run is active', () => {
  const item = readyItem('SI-200');
  const plan = improvement.planRecurringAction({
    queue: queue({
      items: [item],
      activeRuns: [{ runId: 'run-1', finalState: 'active' }],
    }),
    policy,
    now: NOW,
  });
  assert.equal(plan.action, 'no-op');
  assert.equal(plan.reason, 'concurrency-limit');
});

test('planner rejects malformed concurrency state instead of treating it as empty', () => {
  assert.throws(() => improvement.planRecurringAction({
    queue: queue({ activeRuns: { runId: 'run-1', finalState: 'active' } }),
    policy,
    now: NOW,
  }), /activeRuns must be an array/);
  assert.throws(() => improvement.planRecurringAction({
    queue: queue({ items: { status: 'in-progress' } }),
    policy,
    now: NOW,
  }), /items must be an array/);
});

test('planner stops at monthly budgets and cadence limits', () => {
  const item = readyItem('SI-200');
  for (const monthlyUsage of [
    { actionsMinutes: policy.maxMonthlyActionsMinutes, aiCredits: 0, proposalsThisRun: 0 },
    { actionsMinutes: 0, aiCredits: policy.maxMonthlyAiCredits, proposalsThisRun: 0 },
  ]) {
    const plan = improvement.planRecurringAction({
      queue: queue({ items: [item], monthlyUsage }),
      policy,
      now: NOW,
    });
    assert.equal(plan.action, 'no-op');
    assert.equal(plan.reason, 'monthly-budget-exhausted');
  }

  const cadence = improvement.planRecurringAction({
    queue: queue({
      items: [item],
      lastImplementationAt: '2026-07-27T11:00:00.000Z',
    }),
    policy,
    now: NOW,
  });
  assert.equal(cadence.action, 'no-op');
  assert.equal(cadence.reason, 'implementation-cadence');
});

test('planner selects one approved ready item deterministically after dependencies', () => {
  const done = { ...proposedItem('AS-100'), status: 'done' };
  const blocked = readyItem('SI-100', ['AS-101']);
  const first = readyItem('SI-200', ['AS-100']);
  const second = readyItem('SI-300');
  const plan = improvement.planRecurringAction({
    queue: queue({ items: [second, blocked, done, first] }),
    policy,
    now: NOW,
  });
  assert.deepEqual(plan, {
    schemaVersion: 1,
    action: 'implement',
    itemId: 'SI-200',
    reason: 'ready-item',
  });
});

test('planner schedules learning independently when no item is ready', () => {
  const plan = improvement.planRecurringAction({
    queue: queue(),
    policy,
    now: NOW,
  });
  assert.deepEqual(plan, {
    schemaVersion: 1,
    action: 'learn',
    itemId: null,
    reason: 'learning-due',
  });

  const capped = improvement.planRecurringAction({
    queue: queue({
      monthlyUsage: {
        actionsMinutes: 0,
        aiCredits: 0,
        proposalsThisRun: policy.maxProposalsPerLearningRun,
      },
    }),
    policy,
    now: NOW,
  });
  assert.equal(capped.action, 'no-op');
  assert.equal(capped.reason, 'proposal-limit');
});

test('plan CLI writes the same versioned decision without side effects', () => {
  const temp = makeTempDir('recurring-plan-');
  try {
    const queuePath = resolve(temp, 'queue.json');
    writeFileSync(queuePath, `${JSON.stringify(queue())}\n`);
    const result = spawnSync(process.execPath, [
      resolve(REPO_ROOT, 'scripts/continuous-improvement.mjs'),
      'plan',
      '--queue', queuePath,
      '--now', NOW,
    ], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      schemaVersion: 1,
      action: 'no-op',
      itemId: null,
      reason: 'recurring-disabled',
    });
  } finally {
    removeDir(temp);
  }
});

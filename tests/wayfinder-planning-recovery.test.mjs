import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
  evaluateRecoveryTrace as evaluateRecoveryTraceStrict,
} from '../skills/wayfinder-planning/scripts/recovery-contract.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const CHECKER = resolve(ROOT, 'skills/wayfinder-planning/scripts/recovery-contract.mjs');
const TRACKER_CONTRACT = resolve(
  ROOT,
  'skills/wayfinder-planning/references/tracker-contract.md',
);
const fixture = JSON.parse(readFileSync(
  resolve(ROOT, 'tests/fixtures/wayfinder-planning/recovery-traces.json'),
  'utf8',
));
const traces = fixture.traces;
const MUTATION_OPERATIONS = new Set([
  'block_ticket',
  'external_action',
  'reclaim_expired_claim',
  'record_progress',
  'record_task_intent',
  'record_task_receipt',
  'release_claim',
  'unblock_ticket',
]);

function withTestMutationKeys(input) {
  const normalized = structuredClone(input);
  normalized.operations = normalized.operations?.map((operation, index) => {
    if (!MUTATION_OPERATIONS.has(operation.operation)
        || operation.mutation_key !== undefined) {
      return operation;
    }
    return {
      ...operation,
      mutation_key: operation.operation === 'external_action'
        ? operation.idempotency_key
          ?? `test:${index}:${operation.operation}:${operation.ticket_id ?? 'missing'}`
        : `test:${index}:${operation.operation}:${operation.ticket_id ?? 'missing'}`,
    };
  });
  return normalized;
}

function evaluateRecoveryTrace(input) {
  return evaluateRecoveryTraceStrict(withTestMutationKeys({
    map_id: 'map-recovery',
    ...input,
  }));
}

function claim(overrides = {}) {
  return {
    claim_token: null,
    owner_id: null,
    session_id: null,
    acquired_at: null,
    expires_at: null,
    ...overrides,
  };
}

function ticket(overrides = {}) {
  const value = {
    id: 'ticket',
    parent_map_id: 'map-recovery',
    type: 'research',
    status: 'open',
    revision: 1,
    blocker_ids: [],
    claim: null,
    block: null,
    block_history: [],
    comments: [],
    evidence: [],
    progress_records: [],
    task_action: null,
    pending_external_action: null,
    recovery_hold: null,
    ...overrides,
  };
  if (value.block && value.block_history.length === 0) value.block_history = [value.block];
  return value;
}

function compareStrings(left, right) {
  const leftCodePoints = Array.from(left, (character) => character.codePointAt(0));
  const rightCodePoints = Array.from(right, (character) => character.codePointAt(0));
  const length = Math.min(leftCodePoints.length, rightCodePoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftCodePoints[index] !== rightCodePoints[index]) {
      return leftCodePoints[index] - rightCodePoints[index];
    }
  }
  return leftCodePoints.length - rightCodePoints.length;
}

function state(tickets, externalActions = []) {
  return {
    tickets: [...tickets].sort((left, right) => compareStrings(left.id, right.id)),
    external_actions: externalActions,
  };
}

function assertFixtureContract(name, result) {
  const scenario = traces[name];
  assert.equal(result.map_id, scenario.input.map_id);
  assert.deepEqual(result.operationOrder, scenario.expectedOperationOrder);
  assert.deepEqual(result.violationCodes, scenario.expectedViolationCodes);
  assert.deepEqual(result.frontier, scenario.expectedFrontier);
  assert.equal(result.externalActionCount, scenario.expectedExternalActionCount);
  assert.equal(result.valid, scenario.expectedViolationCodes.length === 0);
  assert.equal(result.transitions.length, scenario.expectedOperationOrder.length);
  for (const [index, transition] of result.transitions.entries()) {
    assert.equal(transition.index, index);
    assert.equal(transition.operation, scenario.expectedOperationOrder[index]);
  }
}

test('unknown external outcome is durably blocked and verified before claim release', () => {
  const scenario = traces.unknownExternalOutcome;
  const result = evaluateRecoveryTrace(scenario.input);
  assertFixtureContract('unknownExternalOutcome', result);

  const expectedBlock = {
    reason: 'External outcome cannot be reconciled.',
    evidence_reference: 'vendor:req-1',
    actor_id: 'agent-1',
    blocked_at: scenario.input.now,
    blocked_revision: 5,
    requires_human_resolution: true,
  };
  const expectedTicket = ticket({
    id: 'task-unknown',
    type: 'task',
    status: 'blocked',
    revision: 6,
    block: expectedBlock,
    block_history: [expectedBlock],
    task_action: {
      intent: 'Submit the vendor reconciliation request.',
      idempotency_key: 'vendor-request-1',
      authorization_reference: 'human-approval-17',
      reconciliation_method: 'Lookup the vendor request by idempotency key.',
      state: 'outcome_unknown',
      external_receipt: {
        external_system: 'vendor-api',
        idempotency_key: 'vendor-request-1',
        result: 'unknown',
        lookup_reference: 'vendor:req-1',
      },
    },
    recovery_hold: null,
  });
  const expectedAction = {
    ticket_id: 'task-unknown',
    idempotency_key: 'vendor-request-1',
    external_system: 'vendor-api',
    lookup_reference: 'vendor:req-1',
    outcome: 'unknown',
    performed_at: scenario.input.now,
  };
  assert.deepEqual(result.finalState, state([expectedTicket], [expectedAction]));
  assert.equal(result.transitions.at(-1).afterStateSha256, result.finalStateSha256);
  assert.equal(result.finalState.tickets[0].claim, null);
});

test('unconfirmed blocking rejects release, preserves the lease, and fails closed', () => {
  const scenario = traces.failedBlock;
  const result = evaluateRecoveryTrace(scenario.input);
  assertFixtureContract('failedBlock', result);

  const finalTicket = result.finalState.tickets[0];
  assert.equal(finalTicket.status, 'open');
  assert.deepEqual(finalTicket.claim, claim({
    claim_token: 'claim-failed',
    owner_id: 'agent-2',
    session_id: 'session-2',
    acquired_at: '2026-08-23T19:30:00.000Z',
    expires_at: '2026-08-23T21:00:00.000Z',
  }));
  assert.deepEqual(finalTicket.recovery_hold, {
    code: 'unknown-external-outcome',
    idempotency_key: 'uncertain-action-1',
    evidence_reference: 'vendor:uncertain-1',
  });
  assert.deepEqual(result.transitions[2].violationCodes, ['block-unconfirmed']);
  assert.deepEqual(result.transitions[3].violationCodes, ['release-before-confirmed-block']);
  assertCompactNoMutation(result, 3);
});

test('non-human unblock is rejected without changing lifecycle or frontier', () => {
  const result = evaluateRecoveryTrace(traces.nonHumanUnblock.input);
  assertFixtureContract('nonHumanUnblock', result);
  assert.equal(result.finalState.tickets[0].status, 'blocked');
  assert.equal(result.finalState.tickets[0].revision, 9);
  assertCompactNoMutation(result, 0);
});

test('human unblock requires the exact block revision and authoritative inputs', async (t) => {
  const blocked = {
    reason: 'Unknown external result.',
    evidence_reference: 'vendor:req-9',
    actor_id: 'agent-9',
    blocked_at: '2026-08-23T19:00:00.000Z',
    blocked_revision: 9,
    requires_human_resolution: true,
  };
  const blockedTicket = ticket({
    id: 'task-blocked-auth',
    type: 'task',
    status: 'blocked',
    revision: 9,
    block: blocked,
  });
  const baseOperation = {
    operation: 'unblock_ticket',
    ticket_id: 'task-blocked-auth',
    expected_revision: 9,
    block_revision: 9,
    actor_type: 'human',
    actor_id: 'human-1',
    authorization_reference: 'human-authorization-1',
    reconciliation_evidence: {
      authority_reference: 'vendor:audit-9',
      conclusion: 'The blocking condition was authoritatively reconciled.',
    },
  };
  const cases = [
    {
      name: 'missing block revision',
      operation: { ...baseOperation, block_revision: undefined },
      violation: 'block-revision-conflict',
    },
    {
      name: 'wrong block revision',
      operation: { ...baseOperation, block_revision: 8 },
      violation: 'block-revision-conflict',
    },
    {
      name: 'missing human actor',
      operation: { ...baseOperation, actor_id: undefined },
      violation: 'human-authorization-required',
    },
    {
      name: 'missing human authorization',
      operation: { ...baseOperation, authorization_reference: undefined },
      violation: 'human-authorization-required',
    },
    {
      name: 'inadequate reconciliation evidence',
      operation: {
        ...baseOperation,
        reconciliation_evidence: {
          conclusion: 'No authoritative source.',
        },
      },
      violation: 'authoritative-reconciliation-required',
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const result = evaluateRecoveryTrace({
        schemaVersion: 1,
        now: '2026-08-23T20:00:00.000Z',
        initialState: { tickets: [blockedTicket] },
        operations: [scenario.operation],
      });
      assert.deepEqual(result.transitions[0].violationCodes, [scenario.violation]);
      assertCompactNoMutation(result, 0);
      assert.deepEqual(result.frontier, []);
    });
  }
});

test('unknown task outcomes require terminal reconciliation before human unblock', () => {
  const blocked = {
    reason: 'Unknown external result.',
    evidence_reference: 'vendor:req-10',
    actor_id: 'agent-10',
    blocked_at: '2026-08-23T19:00:00.000Z',
    blocked_revision: 10,
    requires_human_resolution: true,
  };
  const result = evaluateRecoveryTrace({
    schemaVersion: 1,
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'task-blocked-unresolved',
          type: 'task',
          status: 'blocked',
          revision: 10,
          block: blocked,
          task_action: {
            intent: 'Submit an external request.',
            idempotency_key: 'request-10',
            authorization_reference: 'human-approval-10',
            reconciliation_method: 'Look up request-10.',
            state: 'outcome_unknown',
            external_receipt: {
              external_system: 'vendor-api',
              idempotency_key: 'request-10',
              result: 'unknown',
              lookup_reference: 'vendor:req-10',
            },
          },
        }),
      ],
    },
    operations: [
      {
        operation: 'unblock_ticket',
        ticket_id: 'task-blocked-unresolved',
        expected_revision: 10,
        block_revision: 10,
        actor_type: 'human',
        actor_id: 'human-10',
        authorization_reference: 'human-authorization-10',
        reconciliation_evidence: {
          authority_reference: 'vendor:audit-10',
          conclusion: 'The lookup is still inconclusive.',
        },
      },
    ],
  });
  assert.deepEqual(result.violationCodes, ['unresolved-external-outcome']);
  assertCompactNoMutation(result, 0);
  assert.equal(result.finalState.tickets[0].status, 'blocked');
  assert.deepEqual(result.frontier, []);
});

test('human unblock records reconciliation and resolves unknown task outcome', () => {
  const blocked = {
    reason: 'Unknown external result.',
    evidence_reference: 'vendor:req-11',
    actor_id: 'agent-11',
    blocked_at: '2026-08-23T19:00:00.000Z',
    blocked_revision: 11,
    requires_human_resolution: true,
  };
  const authoritativeReceipt = {
    external_system: 'vendor-api',
    idempotency_key: 'request-11',
    result: 'succeeded',
    lookup_reference: 'vendor:receipt-11',
  };
  const reconciliationEvidence = {
    authority_reference: 'vendor:audit-11',
    conclusion: 'The external system confirms the request succeeded.',
    task_action: {
      state: 'succeeded',
      receipt: authoritativeReceipt,
    },
  };
  const result = evaluateRecoveryTrace({
    schemaVersion: 1,
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'task-blocked-reconciled',
          type: 'task',
          status: 'blocked',
          revision: 11,
          block: blocked,
          task_action: {
            intent: 'Submit an external request.',
            idempotency_key: 'request-11',
            authorization_reference: 'human-approval-11',
            reconciliation_method: 'Look up request-11.',
            state: 'outcome_unknown',
            external_receipt: {
              external_system: 'vendor-api',
              idempotency_key: 'request-11',
              result: 'unknown',
              lookup_reference: 'vendor:req-11',
            },
          },
        }),
      ],
    },
    operations: [
      {
        operation: 'unblock_ticket',
        ticket_id: 'task-blocked-reconciled',
        expected_revision: 11,
        block_revision: 11,
        actor_type: 'human',
        actor_id: 'human-11',
        authorization_reference: 'human-authorization-11',
        reconciliation_evidence: reconciliationEvidence,
      },
    ],
  });
  const finalTicket = result.finalState.tickets[0];
  assert.deepEqual(result.violationCodes, []);
  assert.equal(finalTicket.status, 'open');
  assert.equal(finalTicket.revision, 12);
  assert.equal(finalTicket.block, null);
  assert.equal(finalTicket.task_action.state, 'succeeded');
  assert.deepEqual(finalTicket.task_action.external_receipt, authoritativeReceipt);
  assert.deepEqual(finalTicket.block_history[0].reconciliation, {
    block_revision: 11,
    actor_type: 'human',
    actor_id: 'human-11',
    authorization_reference: 'human-authorization-11',
    reconciliation_evidence: reconciliationEvidence,
    reconciled_at: '2026-08-23T20:00:00.000Z',
    resulting_revision: 12,
  });
  assert.deepEqual(result.frontier, ['task-blocked-reconciled']);
});

test('human unblock rejects a reconciliation receipt from another external system', () => {
  const blocked = {
    reason: 'Unknown external result.',
    evidence_reference: 'vendor:req-12',
    actor_id: 'agent-12',
    blocked_at: '2026-08-23T19:00:00.000Z',
    blocked_revision: 12,
    requires_human_resolution: true,
  };
  const result = evaluateRecoveryTrace({
    schemaVersion: 1,
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'task-blocked-wrong-system',
          type: 'task',
          status: 'blocked',
          revision: 12,
          block: blocked,
          task_action: {
            intent: 'Submit an external request.',
            idempotency_key: 'request-12',
            authorization_reference: 'human-approval-12',
            reconciliation_method: 'Look up request-12.',
            state: 'outcome_unknown',
            external_receipt: {
              external_system: 'vendor-api',
              idempotency_key: 'request-12',
              result: 'unknown',
              lookup_reference: 'vendor:req-12',
            },
          },
        }),
      ],
    },
    operations: [
      {
        operation: 'unblock_ticket',
        ticket_id: 'task-blocked-wrong-system',
        expected_revision: 12,
        block_revision: 12,
        actor_type: 'human',
        actor_id: 'human-12',
        authorization_reference: 'human-authorization-12',
        reconciliation_evidence: {
          authority_reference: 'other:audit-12',
          conclusion: 'A different system reports success.',
          task_action: {
            state: 'succeeded',
            receipt: {
              external_system: 'other-api',
              idempotency_key: 'request-12',
              result: 'succeeded',
              lookup_reference: 'other:receipt-12',
            },
          },
        },
      },
    ],
  });
  assert.deepEqual(result.violationCodes, ['task-receipt-conflict']);
  assertCompactNoMutation(result, 0);
  assert.equal(result.finalState.tickets[0].status, 'blocked');
});

test('open tickets with unresolved external outcomes stay out of the frontier', () => {
  const result = evaluateRecoveryTrace({
    schemaVersion: 1,
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'task-open-unknown',
          type: 'task',
          task_action: {
            intent: 'Submit an external request.',
            idempotency_key: 'request-open-unknown',
            authorization_reference: 'human-approval-open',
            reconciliation_method: 'Look up request-open-unknown.',
            state: 'outcome_unknown',
            external_receipt: {
              external_system: 'vendor-api',
              idempotency_key: 'request-open-unknown',
              result: 'unknown',
              lookup_reference: 'vendor:req-open-unknown',
            },
          },
        }),
      ],
    },
    operations: [],
  });
  assert.deepEqual(result.frontier, []);
});

test('normalized blocked tickets retain their exact active block in history', () => {
  const block = {
    reason: 'Requires reconciliation.',
    evidence_reference: 'vendor:block-history',
    actor_id: 'agent-history',
    blocked_at: '2026-08-23T19:00:00.000Z',
    blocked_revision: 4,
    requires_human_resolution: true,
  };
  assert.throws(
    () => evaluateRecoveryTrace({
      schemaVersion: 1,
      now: '2026-08-23T20:00:00.000Z',
      initialState: {
        tickets: [
          {
            id: 'task-missing-block-history',
            parent_map_id: null,
            type: 'task',
            status: 'blocked',
            revision: 4,
            blocker_ids: [],
            claim: null,
            block,
            block_history: [],
            comments: [],
            evidence: [],
            progress_records: [],
            task_action: null,
          },
        ],
      },
      operations: [],
    }),
    (error) => error.code === 'malformed-input' && /block_history/.test(error.message),
  );
});

test('normalized active blocks cannot already contain reconciliation audits', () => {
  const reconciliation = {
    block_revision: 4,
    actor_type: 'human',
    actor_id: 'human-pre-reconciled',
    authorization_reference: 'human-authorization-pre-reconciled',
    reconciliation_evidence: {
      authority_reference: 'authority:pre-reconciled',
      conclusion: 'This audit cannot belong to an active block.',
    },
    reconciled_at: '2026-08-23T19:30:00.000Z',
    resulting_revision: 5,
  };
  const block = {
    reason: 'Still actively blocked.',
    evidence_reference: 'evidence:active-block',
    actor_id: 'agent-active-block',
    blocked_at: '2026-08-23T19:00:00.000Z',
    blocked_revision: 4,
    requires_human_resolution: true,
    reconciliation,
  };
  assert.throws(
    () => evaluateRecoveryTrace({
      schemaVersion: 1,
      now: '2026-08-23T20:00:00.000Z',
      initialState: {
        tickets: [
          ticket({
            id: 'task-pre-reconciled-active',
            type: 'task',
            status: 'blocked',
            revision: 5,
            block,
            block_history: [block],
          }),
        ],
      },
      operations: [],
    }),
    (error) => error.code === 'malformed-input'
      && /active block.*reconciliation/i.test(error.message),
  );
});

test('normalized reconciliation audits must match their block and revision order', async (t) => {
  const baseBlock = {
    reason: 'Previously blocked.',
    evidence_reference: 'evidence:historical-block',
    actor_id: 'agent-historical-block',
    blocked_at: '2026-08-23T18:00:00.000Z',
    blocked_revision: 2,
    requires_human_resolution: true,
  };
  const baseReconciliation = {
    block_revision: 2,
    actor_type: 'human',
    actor_id: 'human-historical-block',
    authorization_reference: 'human-authorization-historical',
    reconciliation_evidence: {
      authority_reference: 'authority:historical-block',
      conclusion: 'The prior block was reconciled.',
    },
    reconciled_at: '2026-08-23T18:30:00.000Z',
    resulting_revision: 3,
  };
  const cases = [
    {
      name: 'audit targets another block revision',
      reconciliation: { ...baseReconciliation, block_revision: 1 },
    },
    {
      name: 'audit does not advance the ticket revision',
      reconciliation: { ...baseReconciliation, resulting_revision: 2 },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      assert.throws(
        () => evaluateRecoveryTrace({
          schemaVersion: 1,
          now: '2026-08-23T20:00:00.000Z',
          initialState: {
            tickets: [
              ticket({
                id: 'task-invalid-audit-revision',
                type: 'task',
                revision: 3,
                block_history: [{
                  ...baseBlock,
                  reconciliation: scenario.reconciliation,
                }],
              }),
            ],
          },
          operations: [],
        }),
        (error) => error.code === 'malformed-input'
          && /reconciliation.*revision/i.test(error.message),
      );
    });
  }
});

test('reconciliation audits cannot be overwritten after an unblock', () => {
  const activeClaim = claim({
    claim_token: 'claim-audit-overwrite',
    owner_id: 'agent-audit-overwrite',
    session_id: 'session-audit-overwrite',
    acquired_at: '2026-08-23T19:00:00.000Z',
    expires_at: '2026-08-23T21:00:00.000Z',
  });
  const blocked = {
    reason: 'Awaiting authoritative evidence.',
    evidence_reference: 'evidence:audit-overwrite',
    actor_id: 'agent-audit-overwrite',
    blocked_at: '2026-08-23T19:15:00.000Z',
    blocked_revision: 2,
    requires_human_resolution: true,
  };
  const result = evaluateRecoveryTrace({
    schemaVersion: 1,
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'task-audit-overwrite',
          type: 'task',
          status: 'blocked',
          revision: 2,
          claim: activeClaim,
          block: blocked,
        }),
      ],
    },
    operations: [
      {
        operation: 'unblock_ticket',
        ticket_id: 'task-audit-overwrite',
        expected_revision: 2,
        block_revision: 2,
        actor_type: 'human',
        actor_id: 'human-original',
        authorization_reference: 'human-authorization-original',
        reconciliation_evidence: {
          authority_reference: 'authority:original',
          conclusion: 'The original reconciliation is authoritative.',
        },
      },
      {
        operation: 'unblock_ticket',
        ticket_id: 'task-audit-overwrite',
        expected_revision: 3,
        block_revision: 2,
        actor_type: 'human',
        actor_id: 'human-overwrite',
        authorization_reference: 'human-authorization-overwrite',
        reconciliation_evidence: {
          authority_reference: 'authority:overwrite',
          conclusion: 'Attempt to replace the original audit.',
        },
      },
    ],
  });
  assert.deepEqual(result.transitions[1].violationCodes, [
    'invalid-lifecycle-transition',
  ]);
  assertCompactNoMutation(result, 1);
  assert.equal(
    result.finalState.tickets[0].block_history[0].reconciliation.actor_id,
    'human-original',
  );
});

test('multiple block and unblock cycles retain immutable ordered audit history', () => {
  const activeClaim = claim({
    claim_token: 'claim-audit-cycles',
    owner_id: 'agent-audit-cycles',
    session_id: 'session-audit-cycles',
    acquired_at: '2026-08-23T19:00:00.000Z',
    expires_at: '2026-08-23T21:00:00.000Z',
  });
  const result = evaluateRecoveryTrace({
    schemaVersion: 1,
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'task-audit-cycles',
          type: 'task',
          claim: activeClaim,
        }),
      ],
    },
    operations: [
      {
        operation: 'block_ticket',
        ticket_id: 'task-audit-cycles',
        expected_revision: 1,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        confirmed: true,
        reason: 'First block.',
        evidence_reference: 'evidence:first-block',
        actor_id: 'agent-audit-cycles',
      },
      {
        operation: 'unblock_ticket',
        ticket_id: 'task-audit-cycles',
        expected_revision: 2,
        block_revision: 2,
        actor_type: 'human',
        actor_id: 'human-first',
        authorization_reference: 'human-authorization-first',
        reconciliation_evidence: {
          authority_reference: 'authority:first',
          conclusion: 'The first block was reconciled.',
        },
      },
      {
        operation: 'block_ticket',
        ticket_id: 'task-audit-cycles',
        expected_revision: 3,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        confirmed: true,
        reason: 'Second block.',
        evidence_reference: 'evidence:second-block',
        actor_id: 'agent-audit-cycles',
      },
      {
        operation: 'unblock_ticket',
        ticket_id: 'task-audit-cycles',
        expected_revision: 4,
        block_revision: 4,
        actor_type: 'human',
        actor_id: 'human-second',
        authorization_reference: 'human-authorization-second',
        reconciliation_evidence: {
          authority_reference: 'authority:second',
          conclusion: 'The second block was reconciled.',
        },
      },
    ],
  });
  assert.deepEqual(result.violationCodes, []);
  assert.equal(result.finalState.tickets[0].revision, 5);
  assert.deepEqual(
    result.finalState.tickets[0].block_history.map((block) => ({
      blocked_revision: block.blocked_revision,
      actor_id: block.reconciliation.actor_id,
      resulting_revision: block.reconciliation.resulting_revision,
    })),
    [
      {
        blocked_revision: 2,
        actor_id: 'human-first',
        resulting_revision: 3,
      },
      {
        blocked_revision: 4,
        actor_id: 'human-second',
        resulting_revision: 5,
      },
    ],
  );
  assert.deepEqual(result.transitions[3].deltas.map(({ path }) => path), [
    '/tickets/task-audit-cycles',
  ]);
});

test('normalized task actions require receipts that match their state', async (t) => {
  const baseAction = {
    intent: 'Perform a normalized task action.',
    idempotency_key: 'normalized-action-1',
    authorization_reference: 'human-approval-normalized',
    reconciliation_method: 'Look up normalized-action-1.',
  };
  const receipt = {
    external_system: 'vendor-api',
    idempotency_key: 'normalized-action-1',
    result: 'succeeded',
    lookup_reference: 'vendor:normalized-action-1',
  };
  const cases = [
    {
      name: 'succeeded without receipt',
      taskAction: { ...baseAction, state: 'succeeded' },
    },
    {
      name: 'unknown without receipt',
      taskAction: { ...baseAction, state: 'outcome_unknown' },
    },
    {
      name: 'succeeded with unknown result',
      taskAction: {
        ...baseAction,
        state: 'succeeded',
        external_receipt: { ...receipt, result: 'unknown' },
      },
    },
    {
      name: 'intended with terminal receipt',
      taskAction: {
        ...baseAction,
        state: 'intended',
        external_receipt: receipt,
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      assert.throws(
        () => evaluateRecoveryTrace({
          schemaVersion: 1,
          now: '2026-08-23T20:00:00.000Z',
          initialState: {
            tickets: [
              ticket({
                id: 'task-normalized-action',
                type: 'task',
                task_action: scenario.taskAction,
              }),
            ],
          },
          operations: [],
        }),
        (error) => error.code === 'malformed-input' && /task_action/.test(error.message),
      );
    });
  }
});

test('revisioned reads and mutations reject stale expected revisions', () => {
  const scenario = traces.staleRevisions;
  const result = evaluateRecoveryTrace(scenario.input);
  assertFixtureContract('staleRevisions', result);
  assert.deepEqual(result.transitions.map((entry) => entry.violationCodes), [
    ['stale-revision'],
    ['stale-revision'],
  ]);
  assertCompactNoMutation(result, 0);
  assertCompactNoMutation(result, 1);
  assert.equal(result.finalState.tickets[0].revision, 5);
  assert.deepEqual(result.finalState.tickets[0].progress_records, []);
});

test('stable progress keys are idempotent and conflicting reuse cannot overwrite', () => {
  const scenario = traces.progressIdempotency;
  const result = evaluateRecoveryTrace(scenario.input);
  assertFixtureContract('progressIdempotency', result);

  const expectedRecord = {
    progress_key: 'research-progress:p1',
    payload: {
      summary: 'Read the primary source.',
      evidence_references: ['source:primary-1'],
    },
    recorded_at: scenario.input.now,
    revision: 2,
  };
  assert.deepEqual(result.finalState.tickets[0].progress_records, [expectedRecord]);
  assert.equal(result.finalState.tickets[0].revision, 2);
  assert.deepEqual(result.finalState.tickets[0].progress_records, [expectedRecord]);
  assertCompactNoMutation(result, 1);
  assertCompactNoMutation(result, 2);
  assert.deepEqual(result.transitions[2].violationCodes, ['progress-key-conflict']);
});

test('external actions require current revision, active ownership, and recorded intent', async (t) => {
  const activeClaim = claim({
    claim_token: 'claim-action',
    owner_id: 'agent-action',
    session_id: 'session-action',
    acquired_at: '2026-08-23T19:30:00.000Z',
    expires_at: '2026-08-23T21:00:00.000Z',
  });
  const taskAction = {
    intent: 'Perform the authorized external action.',
    idempotency_key: 'action-1',
    authorization_reference: 'human-approval-action',
    reconciliation_method: 'Look up action-1.',
    state: 'intended',
  };
  const baseOperation = {
    operation: 'external_action',
    ticket_id: 'task-action',
    expected_revision: 4,
    claim_token: 'claim-action',
    owner_id: 'agent-action',
    session_id: 'session-action',
    idempotency_key: 'action-1',
    external_system: 'vendor-api',
    lookup_reference: 'vendor:action-1',
    outcome: 'succeeded',
  };
  const cases = [
    {
      name: 'missing expected revision',
      ticket: ticket({
        id: 'task-action',
        type: 'task',
        revision: 4,
        claim: activeClaim,
        task_action: taskAction,
      }),
      operation: { ...baseOperation, expected_revision: undefined },
      violation: 'stale-revision',
    },
    {
      name: 'stale expected revision',
      ticket: ticket({
        id: 'task-action',
        type: 'task',
        revision: 4,
        claim: activeClaim,
        task_action: taskAction,
      }),
      operation: { ...baseOperation, expected_revision: 3 },
      violation: 'stale-revision',
    },
    {
      name: 'absent claim',
      ticket: ticket({
        id: 'task-action',
        type: 'task',
        revision: 4,
        task_action: taskAction,
      }),
      operation: baseOperation,
      violation: 'claim-conflict',
    },
    {
      name: 'wrong claim token',
      ticket: ticket({
        id: 'task-action',
        type: 'task',
        revision: 4,
        claim: activeClaim,
        task_action: taskAction,
      }),
      operation: { ...baseOperation, claim_token: 'claim-other' },
      violation: 'claim-conflict',
    },
    {
      name: 'wrong owner',
      ticket: ticket({
        id: 'task-action',
        type: 'task',
        revision: 4,
        claim: activeClaim,
        task_action: taskAction,
      }),
      operation: { ...baseOperation, owner_id: 'agent-other' },
      violation: 'claim-conflict',
    },
    {
      name: 'wrong session',
      ticket: ticket({
        id: 'task-action',
        type: 'task',
        revision: 4,
        claim: activeClaim,
        task_action: taskAction,
      }),
      operation: { ...baseOperation, session_id: 'session-other' },
      violation: 'claim-conflict',
    },
    {
      name: 'expired lease',
      ticket: ticket({
        id: 'task-action',
        type: 'task',
        revision: 4,
        claim: {
          ...activeClaim,
          expires_at: '2026-08-23T20:00:00.000Z',
        },
        task_action: taskAction,
      }),
      operation: baseOperation,
      violation: 'claim-conflict',
    },
    {
      name: 'missing recorded intent',
      ticket: ticket({
        id: 'task-action',
        type: 'task',
        revision: 4,
        claim: activeClaim,
      }),
      operation: baseOperation,
      violation: 'external-action-without-intent',
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const result = evaluateRecoveryTrace({
        schemaVersion: 1,
        now: '2026-08-23T20:00:00.000Z',
        initialState: { tickets: [scenario.ticket] },
        operations: [scenario.operation],
      });
      assert.deepEqual(result.transitions[0].violationCodes, [scenario.violation]);
      assertCompactNoMutation(result, 0);
      assert.equal(result.externalActionCount, 0);
    });
  }
});

test('external actions require an open ticket without mutating rejected traces', async (t) => {
  const blockedTrace = traces.blockedExternalAction;
  const blockedResult = evaluateRecoveryTrace(blockedTrace.input);
  assertFixtureContract('blockedExternalAction', blockedResult);
  assert.deepEqual(blockedResult.transitions[2].violationCodes, [
    'external-action-requires-open-ticket',
  ]);
  assertCompactNoMutation(blockedResult, 2);
  assert.deepEqual(blockedResult.transitions[2].inspection, {
    requiredAtRevision: null,
    lastFullInspectionRevision: null,
    releaseConfirmationRequiredAtRevision: null,
    lastReleaseConfirmationRevision: null,
  });

  const activeClaim = claim({
    claim_token: 'claim-action-lifecycle',
    owner_id: 'agent-action-lifecycle',
    session_id: 'session-action-lifecycle',
    acquired_at: '2026-08-23T19:30:00.000Z',
    expires_at: '2026-08-23T21:00:00.000Z',
  });
  const taskAction = {
    intent: 'Perform the lifecycle-fenced action.',
    idempotency_key: 'action-lifecycle-1',
    authorization_reference: 'human-approval-action-lifecycle',
    reconciliation_method: 'Look up action-lifecycle-1.',
    state: 'intended',
  };
  const operation = {
    operation: 'external_action',
    ticket_id: 'task-action-lifecycle',
    expected_revision: 4,
    claim_token: activeClaim.claim_token,
    owner_id: activeClaim.owner_id,
    session_id: activeClaim.session_id,
    idempotency_key: taskAction.idempotency_key,
    external_system: 'vendor-api',
    lookup_reference: 'vendor:action-lifecycle-1',
    outcome: 'succeeded',
  };
  const blocked = {
    reason: 'Awaiting reconciliation.',
    evidence_reference: 'vendor:blocked-action-lifecycle',
    actor_id: 'agent-action-lifecycle',
    blocked_at: '2026-08-23T19:45:00.000Z',
    blocked_revision: 4,
    requires_human_resolution: true,
  };

  for (const lifecycleTicket of [
    ticket({
      id: 'task-action-lifecycle',
      type: 'task',
      status: 'blocked',
      revision: 4,
      claim: activeClaim,
      block: blocked,
      block_history: [blocked],
      task_action: taskAction,
    }),
    ticket({
      id: 'task-action-lifecycle',
      type: 'task',
      status: 'closed',
      revision: 4,
    }),
  ]) {
    await t.test(lifecycleTicket.status, () => {
      const result = evaluateRecoveryTrace({
        schemaVersion: 1,
        now: '2026-08-23T20:00:00.000Z',
        initialState: { tickets: [lifecycleTicket] },
        operations: [operation],
      });
      assert.deepEqual(result.violationCodes, [
        'external-action-requires-open-ticket',
      ]);
      assertCompactNoMutation(result, 0);
      assert.equal(result.externalActionCount, 0);
    });
  }

  await t.test('open', () => {
    const result = evaluateRecoveryTrace({
      schemaVersion: 1,
      now: '2026-08-23T20:00:00.000Z',
      initialState: {
        tickets: [
          ticket({
            id: 'task-action-lifecycle',
            type: 'task',
            revision: 4,
            claim: activeClaim,
            task_action: taskAction,
          }),
        ],
      },
      operations: [operation],
    });
    assert.deepEqual(result.violationCodes, []);
    assert.equal(result.externalActionCount, 1);
  });
});

test('pending external actions fence release until a matching receipt is durable', async (t) => {
  for (const outcome of ['unknown', 'succeeded']) {
    await t.test(outcome, () => {
      const activeClaim = claim({
        claim_token: `claim-pending-${outcome}`,
        owner_id: 'agent-pending',
        session_id: 'session-pending',
        acquired_at: '2026-08-23T19:30:00.000Z',
        expires_at: '2026-08-23T21:00:00.000Z',
      });
      const input = {
        schemaVersion: 1,
        map_id: 'map-pending-actions',
        now: '2026-08-23T20:00:00.000Z',
        initialState: {
          tickets: [
            ticket({
              id: `task-pending-${outcome}`,
              parent_map_id: 'map-pending-actions',
              type: 'task',
              claim: activeClaim,
            }),
          ],
        },
        operations: [
          {
            operation: 'record_task_intent',
            ticket_id: `task-pending-${outcome}`,
            expected_revision: 1,
            claim_token: activeClaim.claim_token,
            owner_id: activeClaim.owner_id,
            session_id: activeClaim.session_id,
            intent: `Perform the ${outcome} external action.`,
            idempotency_key: `pending-${outcome}-1`,
            authorization_reference: 'human-approval-pending',
            reconciliation_method: `Look up pending-${outcome}-1.`,
          },
          {
            operation: 'external_action',
            ticket_id: `task-pending-${outcome}`,
            expected_revision: 2,
            claim_token: activeClaim.claim_token,
            owner_id: activeClaim.owner_id,
            session_id: activeClaim.session_id,
            idempotency_key: `pending-${outcome}-1`,
            external_system: 'vendor-api',
            lookup_reference: `vendor:pending-${outcome}-1`,
            outcome,
          },
          {
            operation: 'release_claim',
            ticket_id: `task-pending-${outcome}`,
            expected_revision: 3,
            claim_token: activeClaim.claim_token,
            owner_id: activeClaim.owner_id,
            session_id: activeClaim.session_id,
          },
        ],
      };

      const result = evaluateRecoveryTrace(input);
      const pending = result.finalState.tickets[0].pending_external_action;
      assert.deepEqual(result.transitions[2].violationCodes, ['pending-external-action']);
      assertCompactNoMutation(result, 2);
      assert.deepEqual(result.finalState.tickets[0].claim, activeClaim);
      assert.deepEqual(pending, {
        ticket_id: `task-pending-${outcome}`,
        intent: `Perform the ${outcome} external action.`,
        idempotency_key: `pending-${outcome}-1`,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        external_system: 'vendor-api',
        lookup_reference: `vendor:pending-${outcome}-1`,
        outcome,
        performed_at: input.now,
        receipt_synchronization_pending: true,
      });
      assert.equal(result.externalActionCount, 1);
      assert.deepEqual(result.frontier, []);
    });
  }
});

test('pending external action rejects another action and matching receipt clears the fence', async (t) => {
  for (const key of ['pending-repeat-1', 'pending-different-2']) {
    await t.test(key, () => {
      const activeClaim = claim({
        claim_token: 'claim-pending-repeat',
        owner_id: 'agent-pending-repeat',
        session_id: 'session-pending-repeat',
        acquired_at: '2026-08-23T19:30:00.000Z',
        expires_at: '2026-08-23T21:00:00.000Z',
      });
      const result = evaluateRecoveryTrace({
        schemaVersion: 1,
        map_id: 'map-pending-actions',
        now: '2026-08-23T20:00:00.000Z',
        initialState: {
          tickets: [
            ticket({
              id: 'task-pending-repeat',
              parent_map_id: 'map-pending-actions',
              type: 'task',
              claim: activeClaim,
              task_action: {
                intent: 'Perform the pending action once.',
                idempotency_key: 'pending-repeat-1',
                authorization_reference: 'human-approval-pending-repeat',
                reconciliation_method: 'Look up pending-repeat-1.',
                state: 'intended',
              },
            }),
          ],
        },
        operations: [
          {
            operation: 'external_action',
            ticket_id: 'task-pending-repeat',
            expected_revision: 1,
            claim_token: activeClaim.claim_token,
            owner_id: activeClaim.owner_id,
            session_id: activeClaim.session_id,
            idempotency_key: 'pending-repeat-1',
            external_system: 'vendor-api',
            lookup_reference: 'vendor:pending-repeat-1',
            outcome: 'succeeded',
          },
          {
            operation: 'external_action',
            ticket_id: 'task-pending-repeat',
            expected_revision: 1,
            claim_token: activeClaim.claim_token,
            owner_id: activeClaim.owner_id,
            session_id: activeClaim.session_id,
            idempotency_key: key,
            external_system: 'vendor-api',
            lookup_reference: `vendor:${key}`,
            outcome: 'succeeded',
          },
        ],
      });

      assert.deepEqual(
        result.transitions[1].violationCodes,
        key === 'pending-repeat-1' ? [] : ['pending-external-action'],
      );
      assert.equal(
        result.transitions[1].replayed,
        key === 'pending-repeat-1',
      );
      assertCompactNoMutation(result, 1);
      assert.equal(result.externalActionCount, 1);
    });
  }

  const activeClaim = claim({
    claim_token: 'claim-pending-sync',
    owner_id: 'agent-pending-sync',
    session_id: 'session-pending-sync',
    acquired_at: '2026-08-23T19:30:00.000Z',
    expires_at: '2026-08-23T21:00:00.000Z',
  });
  const receipt = {
    external_system: 'vendor-api',
    idempotency_key: 'pending-sync-1',
    result: 'succeeded',
    lookup_reference: 'vendor:pending-sync-1',
  };
  const synchronized = evaluateRecoveryTrace({
    schemaVersion: 1,
    map_id: 'map-pending-actions',
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'task-pending-sync',
          parent_map_id: 'map-pending-actions',
          type: 'task',
          claim: activeClaim,
          task_action: {
            intent: 'Perform and synchronize the pending action.',
            idempotency_key: 'pending-sync-1',
            authorization_reference: 'human-approval-pending-sync',
            reconciliation_method: 'Look up pending-sync-1.',
            state: 'intended',
          },
        }),
      ],
    },
    operations: [
      {
        operation: 'external_action',
        ticket_id: 'task-pending-sync',
        expected_revision: 1,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        idempotency_key: 'pending-sync-1',
        external_system: 'vendor-api',
        lookup_reference: 'vendor:pending-sync-1',
        outcome: 'succeeded',
      },
      {
        operation: 'record_task_receipt',
        ticket_id: 'task-pending-sync',
        expected_revision: 2,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        idempotency_key: 'pending-sync-1',
        outcome: 'succeeded',
        receipt,
      },
      {
        operation: 'release_claim',
        ticket_id: 'task-pending-sync',
        expected_revision: 3,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
      },
      {
        operation: 'get_ticket',
        ticket_id: 'task-pending-sync',
        expected_revision: 4,
        full: true,
      },
    ],
  });
  assert.deepEqual(synchronized.violationCodes, []);
  assert.equal(synchronized.finalState.tickets[0].pending_external_action, null);
  assert.equal(synchronized.finalState.tickets[0].claim, null);
  assert.deepEqual(synchronized.frontier, ['task-pending-sync']);
});

test('pending external actions require receipt synchronization before blocking', () => {
  const activeClaim = claim({
    claim_token: 'claim-pending-block',
    owner_id: 'agent-pending-block',
    session_id: 'session-pending-block',
    acquired_at: '2026-08-23T19:30:00.000Z',
    expires_at: '2026-08-23T21:00:00.000Z',
  });
  const result = evaluateRecoveryTrace({
    schemaVersion: 1,
    map_id: 'map-pending-actions',
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'task-pending-block',
          parent_map_id: 'map-pending-actions',
          type: 'task',
          claim: activeClaim,
          task_action: {
            intent: 'Perform and reconcile the action before blocking.',
            idempotency_key: 'pending-block-1',
            authorization_reference: 'human-approval-pending-block',
            reconciliation_method: 'Look up pending-block-1.',
            state: 'intended',
          },
        }),
      ],
    },
    operations: [
      {
        operation: 'external_action',
        ticket_id: 'task-pending-block',
        expected_revision: 1,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        idempotency_key: 'pending-block-1',
        external_system: 'vendor-api',
        lookup_reference: 'vendor:pending-block-1',
        outcome: 'unknown',
      },
      {
        operation: 'block_ticket',
        ticket_id: 'task-pending-block',
        expected_revision: 1,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        confirmed: true,
        reason: 'Receipt synchronization is still pending.',
        evidence_reference: 'vendor:pending-block-1',
        actor_id: activeClaim.owner_id,
      },
      {
        operation: 'record_task_receipt',
        ticket_id: 'task-pending-block',
        expected_revision: 2,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        idempotency_key: 'pending-block-1',
        outcome: 'unknown',
        receipt: {
          external_system: 'vendor-api',
          idempotency_key: 'pending-block-1',
          result: 'unknown',
          lookup_reference: 'vendor:pending-block-1',
        },
      },
      {
        operation: 'block_ticket',
        ticket_id: 'task-pending-block',
        expected_revision: 3,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        confirmed: true,
        reason: 'The synchronized receipt has an unknown outcome.',
        evidence_reference: 'vendor:pending-block-1',
        actor_id: activeClaim.owner_id,
      },
    ],
  });

  assert.deepEqual(result.transitions[1].violationCodes, ['pending-external-action']);
  assertCompactNoMutation(result, 1);
  assert.equal(result.finalState.tickets[0].status, 'blocked');
  assert.equal(result.finalState.tickets[0].revision, 4);
  assert.equal(result.finalState.tickets[0].pending_external_action, null);
  assert.equal(result.externalActionCount, 1);
});

test('an unmatched normalized pending action without a claim is rejected', () => {
  assert.throws(
    () => evaluateRecoveryTrace({
      schemaVersion: 1,
      map_id: 'map-pending-actions',
      now: '2026-08-23T20:00:00.000Z',
      initialState: {
        tickets: [
          ticket({
            id: 'task-pending-unclaimed',
            parent_map_id: 'map-pending-actions',
            type: 'task',
            task_action: {
              intent: 'Recover a previously invoked action.',
              idempotency_key: 'pending-unclaimed-1',
              authorization_reference: 'human-approval-pending-unclaimed',
              reconciliation_method: 'Look up pending-unclaimed-1.',
              state: 'intended',
            },
            pending_external_action: {
              ticket_id: 'task-pending-unclaimed',
              intent: 'Recover a previously invoked action.',
              idempotency_key: 'pending-unclaimed-1',
              claim_token: 'claim-prior',
              owner_id: 'agent-prior',
              session_id: 'session-prior',
              external_system: 'vendor-api',
              lookup_reference: 'vendor:pending-unclaimed-1',
              outcome: 'unknown',
              performed_at: '2026-08-23T19:45:00.000Z',
              receipt_synchronization_pending: true,
            },
          }),
        ],
      },
      operations: [],
    }),
    (error) => error.code === 'malformed-input'
      && /pending_external_action.*open claimed/i.test(error.message),
  );
});

test('identical task receipt replay is idempotent without a revision bump', () => {
  const activeClaim = claim({
    claim_token: 'claim-receipt',
    owner_id: 'agent-receipt',
    session_id: 'session-receipt',
    acquired_at: '2026-08-23T19:30:00.000Z',
    expires_at: '2026-08-23T21:00:00.000Z',
  });
  const receipt = {
    external_system: 'vendor-api',
    idempotency_key: 'receipt-action-1',
    result: 'succeeded',
    lookup_reference: 'vendor:receipt-action-1',
  };
  const operation = {
    operation: 'record_task_receipt',
    ticket_id: 'task-receipt',
    expected_revision: 1,
    claim_token: 'claim-receipt',
    owner_id: 'agent-receipt',
    session_id: 'session-receipt',
    idempotency_key: 'receipt-action-1',
    outcome: 'succeeded',
    receipt,
  };
  const result = evaluateRecoveryTrace({
    schemaVersion: 1,
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'task-receipt',
          type: 'task',
          claim: activeClaim,
          task_action: {
            intent: 'Perform the receipt action.',
            idempotency_key: 'receipt-action-1',
            authorization_reference: 'human-approval-receipt',
            reconciliation_method: 'Look up receipt-action-1.',
            state: 'intended',
          },
        }),
      ],
    },
    operations: [
      operation,
      { ...operation, expected_revision: 2 },
    ],
  });
  assert.deepEqual(result.violationCodes, []);
  assert.equal(result.finalState.tickets[0].revision, 2);
  assertCompactNoMutation(result, 1);
  assert.deepEqual(result.finalState.tickets[0].task_action.external_receipt, receipt);
});

test('conflicting task receipt reuse cannot overwrite authoritative receipt', async (t) => {
  const authoritativeReceipt = {
    external_system: 'vendor-api',
    idempotency_key: 'receipt-action-2',
    result: 'succeeded',
    lookup_reference: 'vendor:receipt-action-2',
  };
  const baseOperation = {
    operation: 'record_task_receipt',
    ticket_id: 'task-receipt-conflict',
    expected_revision: 5,
    claim_token: 'claim-receipt-conflict',
    owner_id: 'agent-receipt',
    session_id: 'session-receipt',
    idempotency_key: 'receipt-action-2',
    outcome: 'succeeded',
    receipt: authoritativeReceipt,
  };
  const cases = [
    {
      name: 'success to unknown downgrade',
      operation: {
        ...baseOperation,
        outcome: 'unknown',
        receipt: { ...authoritativeReceipt, result: 'unknown' },
      },
      violation: 'task-receipt-conflict',
    },
    {
      name: 'different external system',
      operation: {
        ...baseOperation,
        receipt: { ...authoritativeReceipt, external_system: 'other-api' },
      },
      violation: 'task-receipt-conflict',
    },
    {
      name: 'different result',
      operation: {
        ...baseOperation,
        receipt: { ...authoritativeReceipt, result: 'failed' },
      },
      violation: 'task-receipt-conflict',
    },
    {
      name: 'different lookup reference',
      operation: {
        ...baseOperation,
        receipt: { ...authoritativeReceipt, lookup_reference: 'vendor:other' },
      },
      violation: 'task-receipt-conflict',
    },
    {
      name: 'different operation key',
      operation: {
        ...baseOperation,
        idempotency_key: 'receipt-action-other',
        receipt: {
          ...authoritativeReceipt,
          idempotency_key: 'receipt-action-other',
        },
      },
      violation: 'task-action-key-conflict',
    },
    {
      name: 'different receipt key',
      operation: {
        ...baseOperation,
        receipt: {
          ...authoritativeReceipt,
          idempotency_key: 'receipt-action-other',
        },
      },
      violation: 'task-action-key-conflict',
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const result = evaluateRecoveryTrace({
        schemaVersion: 1,
        now: '2026-08-23T20:00:00.000Z',
        initialState: {
          tickets: [
            ticket({
              id: 'task-receipt-conflict',
              type: 'task',
              revision: 5,
              claim: claim({
                claim_token: 'claim-receipt-conflict',
                owner_id: 'agent-receipt',
                session_id: 'session-receipt',
                acquired_at: '2026-08-23T19:30:00.000Z',
                expires_at: '2026-08-23T21:00:00.000Z',
              }),
              task_action: {
                intent: 'Perform the authoritative action.',
                idempotency_key: 'receipt-action-2',
                authorization_reference: 'human-approval-receipt',
                reconciliation_method: 'Look up receipt-action-2.',
                state: 'succeeded',
                external_receipt: authoritativeReceipt,
              },
            }),
          ],
        },
        operations: [scenario.operation],
      });
      assert.deepEqual(result.transitions[0].violationCodes, [scenario.violation]);
      assertCompactNoMutation(result, 0);
      assert.deepEqual(
        result.finalState.tickets[0].task_action.external_receipt,
        authoritativeReceipt,
      );
    });
  }
});

test('external actions and task receipts reject undocumented outcomes', async (t) => {
  const activeClaim = claim({
    claim_token: 'claim-outcome',
    owner_id: 'agent-outcome',
    session_id: 'session-outcome',
    acquired_at: '2026-08-23T19:30:00.000Z',
    expires_at: '2026-08-23T21:00:00.000Z',
  });
  const intendedTicket = ticket({
    id: 'task-outcome',
    type: 'task',
    claim: activeClaim,
    task_action: {
      intent: 'Perform the outcome action.',
      idempotency_key: 'outcome-action-1',
      authorization_reference: 'human-approval-outcome',
      reconciliation_method: 'Look up outcome-action-1.',
      state: 'intended',
    },
  });
  const operations = [
    {
      name: 'external action',
      operation: {
        operation: 'external_action',
        ticket_id: 'task-outcome',
        expected_revision: 1,
        claim_token: 'claim-outcome',
        owner_id: 'agent-outcome',
        session_id: 'session-outcome',
        idempotency_key: 'outcome-action-1',
        external_system: 'vendor-api',
        lookup_reference: 'vendor:outcome-action-1',
        outcome: 'maybe',
      },
    },
    {
      name: 'task receipt',
      operation: {
        operation: 'record_task_receipt',
        ticket_id: 'task-outcome',
        expected_revision: 1,
        claim_token: 'claim-outcome',
        owner_id: 'agent-outcome',
        session_id: 'session-outcome',
        idempotency_key: 'outcome-action-1',
        outcome: 'maybe',
        receipt: {
          external_system: 'vendor-api',
          idempotency_key: 'outcome-action-1',
          result: 'maybe',
          lookup_reference: 'vendor:outcome-action-1',
        },
      },
    },
  ];

  for (const scenario of operations) {
    await t.test(scenario.name, () => {
      const result = evaluateRecoveryTrace({
        schemaVersion: 1,
        now: '2026-08-23T20:00:00.000Z',
        initialState: { tickets: [intendedTicket] },
        operations: [scenario.operation],
      });
      assert.deepEqual(result.violationCodes, ['invalid-task-outcome']);
      assertCompactNoMutation(result, 0);
      assert.equal(result.externalActionCount, 0);
    });
  }
});

test('expired reclaim requires full inspection and exposes prior recovery records', () => {
  const scenario = traces.expiredLeaseReclaim;
  const result = evaluateRecoveryTrace(scenario.input);
  assertFixtureContract('expiredLeaseReclaim', result);

  const reclaimed = result.finalState.tickets[0];
  assert.equal(reclaimed.revision, 8);
  assert.deepEqual(reclaimed.claim, claim({
    claim_token: 'claim-reclaimed',
    owner_id: 'agent-new',
    session_id: 'session-new',
    acquired_at: scenario.input.now,
    expires_at: '2026-08-23T21:00:00.000Z',
  }));
  assert.equal(result.transitions[0].inspection.requiredAtRevision, 8);

  const inspected = result.finalState.tickets[0];
  assert.equal(result.transitions[1].inspection.requiredAtRevision, null);
  assert.equal(result.transitions[1].inspection.lastFullInspectionRevision, 8);
  assert.deepEqual(inspected.comments, scenario.input.initialState.tickets[0].comments);
  assert.deepEqual(inspected.evidence, scenario.input.initialState.tickets[0].evidence);
  assert.deepEqual(inspected.progress_records, scenario.input.initialState.tickets[0].progress_records);
  assert.deepEqual(inspected.task_action, scenario.input.initialState.tickets[0].task_action);
  assert.deepEqual(result.transitions.slice(2).map((entry) => entry.violationCodes), [
    ['duplicate-external-action'],
    ['new-action-key-after-receipt'],
  ]);
  assert.equal(result.externalActionCount, 0);
});

test('expired reclaim rejects stale fencing credentials and accepts a fresh session', async (t) => {
  const expiredClaim = claim({
    claim_token: 'claim-expired-fencing',
    owner_id: 'agent-stable',
    session_id: 'session-expired-fencing',
    acquired_at: '2026-08-23T18:00:00.000Z',
    expires_at: '2026-08-23T19:00:00.000Z',
  });
  const baseOperation = {
    operation: 'reclaim_expired_claim',
    ticket_id: 'task-reclaim-fencing',
    expected_revision: 4,
    observed_claim_token: expiredClaim.claim_token,
    new_claim_token: 'claim-fresh-fencing',
    owner_id: expiredClaim.owner_id,
    session_id: 'session-fresh-fencing',
    lease_duration_ms: 3_600_000,
  };
  const rejected = [
    {
      name: 'identical claim token',
      operation: {
        ...baseOperation,
        new_claim_token: expiredClaim.claim_token,
      },
      violation: 'reclaim-token-not-fresh',
    },
    {
      name: 'identical session identity',
      operation: {
        ...baseOperation,
        session_id: expiredClaim.session_id,
      },
      violation: 'reclaim-session-not-fresh',
    },
  ];

  for (const scenario of rejected) {
    await t.test(scenario.name, () => {
      const result = evaluateRecoveryTrace({
        schemaVersion: 1,
        now: '2026-08-23T20:00:00.000Z',
        initialState: {
          tickets: [
            ticket({
              id: 'task-reclaim-fencing',
              type: 'task',
              revision: 4,
              claim: expiredClaim,
            }),
          ],
        },
        operations: [scenario.operation],
      });
      assert.deepEqual(result.violationCodes, [scenario.violation]);
      assertCompactNoMutation(result, 0);
      assert.deepEqual(result.finalState.tickets[0].claim, expiredClaim);
      assert.equal(result.finalState.tickets[0].revision, 4);
    });
  }

  const valid = evaluateRecoveryTrace({
    schemaVersion: 1,
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'task-reclaim-fencing',
          type: 'task',
          revision: 4,
          claim: expiredClaim,
        }),
      ],
    },
    operations: [baseOperation],
  });
  assert.deepEqual(valid.violationCodes, []);
  assert.equal(valid.finalState.tickets[0].revision, 5);
  assert.deepEqual(valid.finalState.tickets[0].claim, claim({
    claim_token: 'claim-fresh-fencing',
    owner_id: 'agent-stable',
    session_id: 'session-fresh-fencing',
    acquired_at: '2026-08-23T20:00:00.000Z',
    expires_at: '2026-08-23T21:00:00.000Z',
  }));
});

test('reclaim expiry validates safe duration and representable timestamps before mutation', async (t) => {
  const expiredClaim = claim({
    claim_token: 'claim-expired-duration',
    owner_id: 'agent-duration',
    session_id: 'session-expired-duration',
    acquired_at: '2026-08-23T18:00:00.000Z',
    expires_at: '2026-08-23T19:00:00.000Z',
  });
  const baseInput = {
    schemaVersion: 1,
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'task-reclaim-duration',
          type: 'task',
          revision: 4,
          claim: expiredClaim,
        }),
      ],
    },
    operations: [{
      operation: 'reclaim_expired_claim',
      ticket_id: 'task-reclaim-duration',
      expected_revision: 4,
      observed_claim_token: expiredClaim.claim_token,
      new_claim_token: 'claim-fresh-duration',
      owner_id: expiredClaim.owner_id,
      session_id: 'session-fresh-duration',
      lease_duration_ms: 3_600_000,
    }],
  };
  const invalidDurations = [
    ['zero', 0],
    ['fractional', 1.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER],
    ['above adapter maximum', 2_592_000_001],
  ];

  for (const [name, duration] of invalidDurations) {
    await t.test(name, () => {
      const input = structuredClone(baseInput);
      input.operations[0].lease_duration_ms = duration;
      const before = structuredClone(input);
      assert.throws(
        () => evaluateRecoveryTrace(input),
        (error) => error.code === 'malformed-input'
          && !(error instanceof RangeError)
          && /lease_duration_ms/.test(error.message),
      );
      assert.deepEqual(input, before);
    });
  }

  await t.test('computed expiry outside the RFC 3339 year range', () => {
    const input = structuredClone(baseInput);
    input.now = '9999-12-31T23:59:59.999Z';
    input.initialState.tickets[0].claim.expires_at = '9999-12-31T23:59:59.998Z';
    input.operations[0].lease_duration_ms = 2;
    const before = structuredClone(input);
    assert.throws(
      () => evaluateRecoveryTrace(input),
      (error) => error.code === 'malformed-input'
        && !(error instanceof RangeError)
        && /expiry.*RFC 3339/i.test(error.message),
    );
    assert.deepEqual(input, before);
  });

  for (const [name, duration, expectedExpiry] of [
    ['one millisecond', 1, '2026-08-23T20:00:00.001Z'],
    ['adapter maximum', 2_592_000_000, '2026-09-22T20:00:00.000Z'],
  ]) {
    await t.test(name, () => {
      const input = structuredClone(baseInput);
      input.operations[0].lease_duration_ms = duration;
      const result = evaluateRecoveryTrace(input);
      assert.deepEqual(result.violationCodes, []);
      assert.equal(result.finalState.tickets[0].claim.expires_at, expectedExpiry);
    });
  }

  await t.test('maximum RFC 3339 expiry', () => {
    const input = structuredClone(baseInput);
    input.now = '9999-12-31T23:59:59.998Z';
    input.initialState.tickets[0].claim.expires_at = '9999-12-31T23:59:59.997Z';
    input.operations[0].lease_duration_ms = 1;
    const result = evaluateRecoveryTrace(input);
    assert.deepEqual(result.violationCodes, []);
    assert.equal(
      result.finalState.tickets[0].claim.expires_at,
      '9999-12-31T23:59:59.999Z',
    );
  });
});

test('reclaimed work cannot continue before the required full ticket inspection', () => {
  const input = structuredClone(traces.expiredLeaseReclaim.input);
  input.operations = [
    input.operations[0],
    input.operations[2],
    input.operations[1],
  ];
  const result = evaluateRecoveryTrace(input);
  assert.deepEqual(result.violationCodes, ['work-before-full-inspection']);
  assert.deepEqual(result.transitions.map((entry) => entry.violationCodes), [
    [],
    ['work-before-full-inspection'],
    [],
  ]);
  assert.equal(result.externalActionCount, 0);
});

test('reclaim inspection gate rejects every modeled mutation without changing state', async (t) => {
  const expiredClaim = claim({
    claim_token: 'claim-expired-gate',
    owner_id: 'agent-old',
    session_id: 'session-old',
    acquired_at: '2026-08-23T18:00:00.000Z',
    expires_at: '2026-08-23T19:00:00.000Z',
  });
  const newClaimFields = {
    claim_token: 'claim-reclaimed-gate',
    owner_id: 'agent-new',
    session_id: 'session-new',
  };
  const intent = {
    intent: 'Perform the gated action.',
    idempotency_key: 'gated-action-1',
    authorization_reference: 'human-approval-gate',
    reconciliation_method: 'Look up gated-action-1.',
    state: 'intended',
  };
  const activeBlock = {
    reason: 'Awaiting human reconciliation.',
    evidence_reference: 'vendor:gated-block',
    actor_id: 'agent-old',
    blocked_at: '2026-08-23T18:30:00.000Z',
    blocked_revision: 1,
    requires_human_resolution: true,
  };
  const cases = [
    {
      operation: 'record_progress',
      ticket: ticket({ id: 'task-gate', type: 'task', claim: expiredClaim }),
      attempt: {
        operation: 'record_progress',
        ticket_id: 'task-gate',
        expected_revision: 2,
        ...newClaimFields,
        progress_key: 'task-gate:p1',
        payload: { summary: 'Must not be recorded yet.' },
      },
    },
    {
      operation: 'record_task_intent',
      ticket: ticket({ id: 'task-gate', type: 'task', claim: expiredClaim }),
      attempt: {
        operation: 'record_task_intent',
        ticket_id: 'task-gate',
        expected_revision: 2,
        ...newClaimFields,
        intent: intent.intent,
        idempotency_key: intent.idempotency_key,
        authorization_reference: intent.authorization_reference,
        reconciliation_method: intent.reconciliation_method,
      },
    },
    {
      operation: 'external_action',
      ticket: ticket({
        id: 'task-gate',
        type: 'task',
        claim: expiredClaim,
        task_action: intent,
      }),
      attempt: {
        operation: 'external_action',
        ticket_id: 'task-gate',
        expected_revision: 2,
        ...newClaimFields,
        idempotency_key: intent.idempotency_key,
        external_system: 'vendor-api',
        lookup_reference: 'vendor:gated-action-1',
        outcome: 'succeeded',
      },
    },
    {
      operation: 'record_task_receipt',
      ticket: ticket({
        id: 'task-gate',
        type: 'task',
        claim: expiredClaim,
        task_action: intent,
      }),
      attempt: {
        operation: 'record_task_receipt',
        ticket_id: 'task-gate',
        expected_revision: 2,
        ...newClaimFields,
        idempotency_key: intent.idempotency_key,
        outcome: 'succeeded',
        receipt: {
          external_system: 'vendor-api',
          idempotency_key: intent.idempotency_key,
          result: 'succeeded',
          lookup_reference: 'vendor:gated-action-1',
        },
      },
    },
    {
      operation: 'block_ticket',
      ticket: ticket({ id: 'task-gate', type: 'task', claim: expiredClaim }),
      attempt: {
        operation: 'block_ticket',
        ticket_id: 'task-gate',
        expected_revision: 2,
        ...newClaimFields,
        confirmed: true,
        reason: 'Must not block before inspection.',
        evidence_reference: 'vendor:gated-block',
        actor_id: 'agent-new',
      },
    },
    {
      operation: 'release_claim',
      ticket: ticket({ id: 'task-gate', type: 'task', claim: expiredClaim }),
      attempt: {
        operation: 'release_claim',
        ticket_id: 'task-gate',
        expected_revision: 2,
        ...newClaimFields,
      },
    },
    {
      operation: 'unblock_ticket',
      ticket: ticket({
        id: 'task-gate',
        type: 'task',
        status: 'blocked',
        claim: expiredClaim,
        block: activeBlock,
      }),
      attempt: {
        operation: 'unblock_ticket',
        ticket_id: 'task-gate',
        expected_revision: 2,
        block_revision: 1,
        actor_type: 'human',
        actor_id: 'human-1',
        authorization_reference: 'human-authorization-1',
        reconciliation_evidence: 'authoritative evidence',
      },
    },
    {
      operation: 'reclaim_expired_claim',
      ticket: ticket({ id: 'task-gate', type: 'task', claim: expiredClaim }),
      attempt: {
        operation: 'reclaim_expired_claim',
        ticket_id: 'task-gate',
        expected_revision: 2,
        observed_claim_token: newClaimFields.claim_token,
        new_claim_token: 'claim-reclaimed-again',
        owner_id: 'agent-other',
        session_id: 'session-other',
        lease_duration_ms: 3_600_000,
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.operation, () => {
      const result = evaluateRecoveryTrace({
        schemaVersion: 1,
        now: '2026-08-23T20:00:00.000Z',
        initialState: { tickets: [scenario.ticket] },
        operations: [
          {
            operation: 'reclaim_expired_claim',
            ticket_id: 'task-gate',
            expected_revision: 1,
            observed_claim_token: expiredClaim.claim_token,
            new_claim_token: newClaimFields.claim_token,
            owner_id: newClaimFields.owner_id,
            session_id: newClaimFields.session_id,
            lease_duration_ms: 3_600_000,
          },
          scenario.attempt,
        ],
      });
      assert.deepEqual(result.transitions[1].violationCodes, [
        'work-before-full-inspection',
      ]);
      assertCompactNoMutation(result, 1);
      assert.equal(result.finalState.tickets[0].revision, 2);
      assert.equal(result.finalState.tickets[0].claim.claim_token, newClaimFields.claim_token);
    });
  }
});

test('successful full inspection at reclaimed revision permits later mutation', () => {
  const input = {
    schemaVersion: 1,
    map_id: 'map-recovery',
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'research-reclaim-gate',
          claim: claim({
            claim_token: 'claim-expired-read',
            owner_id: 'agent-old',
            session_id: 'session-old',
            acquired_at: '2026-08-23T18:00:00.000Z',
            expires_at: '2026-08-23T19:00:00.000Z',
          }),
        }),
      ],
    },
    operations: [
      {
        operation: 'reclaim_expired_claim',
        ticket_id: 'research-reclaim-gate',
        expected_revision: 1,
        observed_claim_token: 'claim-expired-read',
        new_claim_token: 'claim-reclaimed-read',
        owner_id: 'agent-new',
        session_id: 'session-new',
        lease_duration_ms: 3_600_000,
      },
      {
        operation: 'get_ticket',
        ticket_id: 'research-reclaim-gate',
        expected_revision: 2,
        full: true,
      },
      {
        operation: 'record_progress',
        ticket_id: 'research-reclaim-gate',
        expected_revision: 2,
        claim_token: 'claim-reclaimed-read',
        owner_id: 'agent-new',
        session_id: 'session-new',
        progress_key: 'research-reclaim-gate:p1',
        payload: { summary: 'Inspected before continuing.' },
      },
    ],
  };
  const result = evaluateRecoveryTrace(input);
  assert.deepEqual(result.violationCodes, []);
  assert.equal(result.finalState.tickets[0].revision, 3);
  assert.equal(result.finalState.tickets[0].progress_records.length, 1);
});

test('frontier is derived only from open, dependency-unblocked, unclaimed tickets', () => {
  const result = evaluateRecoveryTrace(traces.frontierDerivation.input);
  assertFixtureContract('frontierDerivation', result);
  assert.deepEqual(result.finalState.tickets.map(({ id }) => id), [
    'ticket-a',
    'ticket-b',
    'ticket-c',
    'ticket-d',
    'ticket-e',
    'ticket-f',
    'ticket-g',
  ]);
});

test('frontier excludes non-child tickets with a null parent map', () => {
  const result = evaluateRecoveryTrace({
    schemaVersion: 1,
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'standalone-ticket',
          parent_map_id: null,
        }),
        ticket({
          id: 'child-ticket',
          parent_map_id: 'map-recovery',
        }),
      ],
    },
    operations: [],
  });
  assert.deepEqual(result.frontier, ['child-ticket']);
});

test('normalization rejects invalid blocker graphs and accepts a sibling DAG', async (t) => {
  const cases = [
    {
      name: 'self-loop',
      tickets: [ticket({ id: 'a', blocker_ids: ['a'] })],
      message: /self/i,
    },
    {
      name: 'two-ticket cycle',
      tickets: [
        ticket({ id: 'a', blocker_ids: ['b'] }),
        ticket({ id: 'b', blocker_ids: ['a'] }),
      ],
      message: /cycle/i,
    },
    {
      name: 'three-ticket cycle',
      tickets: [
        ticket({ id: 'a', blocker_ids: ['b'] }),
        ticket({ id: 'b', blocker_ids: ['c'] }),
        ticket({ id: 'c', blocker_ids: ['a'] }),
      ],
      message: /cycle/i,
    },
    {
      name: 'duplicate blocker',
      tickets: [
        ticket({ id: 'a', blocker_ids: ['b', 'b'] }),
        ticket({ id: 'b' }),
      ],
      message: /duplicate/i,
    },
    {
      name: 'missing blocker',
      tickets: [ticket({ id: 'a', blocker_ids: ['missing'] })],
      message: /missing blocker/i,
    },
    {
      name: 'cross-parent blocker',
      tickets: [
        ticket({ id: 'a', parent_map_id: 'map-a', blocker_ids: ['b'] }),
        ticket({ id: 'b', parent_map_id: 'map-b' }),
      ],
      message: /parent_map_id/i,
    },
    {
      name: 'null-parent blocker',
      tickets: [
        ticket({ id: 'a', parent_map_id: 'map-a', blocker_ids: ['root'] }),
        ticket({ id: 'root', parent_map_id: null }),
      ],
      message: /non-child|parent_map_id/i,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      assert.throws(
        () => evaluateRecoveryTrace({
          schemaVersion: 1,
          now: '2026-08-23T20:00:00.000Z',
          initialState: { tickets: scenario.tickets },
          operations: [],
        }),
        (error) => error.code === 'malformed-input'
          && scenario.message.test(error.message),
      );
    });
  }

  const valid = evaluateRecoveryTrace({
    schemaVersion: 1,
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({ id: 'a', blocker_ids: ['b', 'c'] }),
        ticket({ id: 'b', status: 'closed', revision: 2 }),
        ticket({ id: 'c', blocker_ids: ['b'], status: 'closed', revision: 3 }),
      ],
    },
    operations: [],
  });
  assert.deepEqual(valid.violationCodes, []);
  assert.deepEqual(valid.frontier, ['a']);
});

test('reordering release before durable block is a detected recovery regression', () => {
  const input = structuredClone(traces.unknownExternalOutcome.input);
  const [intent, action, receipt, block, getTicket, release] = input.operations;
  input.operations = [
    intent,
    action,
    receipt,
    { ...release, expected_revision: 4 },
    block,
    getTicket,
  ];

  const result = evaluateRecoveryTrace(input);
  assert.deepEqual(result.operationOrder, [
    'record_task_intent',
    'external_action',
    'record_task_receipt',
    'release_claim',
    'block_ticket',
    'get_ticket',
  ]);
  assert.deepEqual(result.violationCodes, ['release-before-confirmed-block']);
  assert.equal(result.valid, false);
  assert.equal(result.finalState.tickets[0].status, 'blocked');
  assert.equal(result.finalState.tickets[0].claim.claim_token, 'claim-unknown');
  assert.deepEqual(result.frontier, []);
});

test('every semantic rejection is transactional across state and inspection context', async (t) => {
  const activeClaim = claim({
    claim_token: 'claim-transactional',
    owner_id: 'agent-transactional',
    session_id: 'session-transactional',
    acquired_at: '2026-08-23T19:00:00.000Z',
    expires_at: '2026-08-23T21:00:00.000Z',
  });
  const unknownAction = {
    intent: 'Reconcile the transactional action.',
    idempotency_key: 'transactional-action-1',
    authorization_reference: 'human-approval-transactional',
    reconciliation_method: 'Look up transactional-action-1.',
    state: 'outcome_unknown',
    external_receipt: {
      external_system: 'vendor-api',
      idempotency_key: 'transactional-action-1',
      result: 'unknown',
      lookup_reference: 'vendor:transactional-action-1',
    },
  };
  const succeededReceipt = {
    external_system: 'vendor-api',
    idempotency_key: 'transactional-receipt-1',
    result: 'succeeded',
    lookup_reference: 'vendor:transactional-receipt-1',
  };
  const expiredClaim = claim({
    claim_token: 'claim-expired-transactional',
    owner_id: 'agent-expired-transactional',
    session_id: 'session-expired-transactional',
    acquired_at: '2026-08-23T18:00:00.000Z',
    expires_at: '2026-08-23T19:00:00.000Z',
  });
  const blocked = {
    reason: 'Requires a human.',
    evidence_reference: 'evidence:transactional-block',
    actor_id: 'agent-transactional',
    blocked_at: '2026-08-23T19:15:00.000Z',
    blocked_revision: 3,
    requires_human_resolution: true,
  };
  const cases = [
    {
      name: 'unconfirmed block',
      ticket: ticket({
        id: 'task-transactional',
        type: 'task',
        claim: activeClaim,
        task_action: unknownAction,
      }),
      operations: [{
        operation: 'block_ticket',
        ticket_id: 'task-transactional',
        expected_revision: 1,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        confirmed: false,
        reason: 'The block write was not confirmed.',
        evidence_reference: 'evidence:unconfirmed',
        actor_id: activeClaim.owner_id,
      }],
      transitionIndex: 0,
      violation: 'block-unconfirmed',
    },
    {
      name: 'release before confirmed block',
      ticket: ticket({
        id: 'task-transactional',
        type: 'task',
        claim: activeClaim,
        task_action: unknownAction,
      }),
      operations: [{
        operation: 'release_claim',
        ticket_id: 'task-transactional',
        expected_revision: 1,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
      }],
      transitionIndex: 0,
      violation: 'release-before-confirmed-block',
    },
    {
      name: 'stale revision',
      ticket: ticket({
        id: 'task-transactional',
        type: 'task',
        revision: 2,
        claim: activeClaim,
      }),
      operations: [{
        operation: 'record_progress',
        ticket_id: 'task-transactional',
        expected_revision: 1,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        progress_key: 'transactional:p1',
        payload: { summary: 'Must not commit.' },
      }],
      transitionIndex: 0,
      violation: 'stale-revision',
    },
    {
      name: 'ownership mismatch',
      ticket: ticket({
        id: 'task-transactional',
        type: 'task',
        claim: activeClaim,
      }),
      operations: [{
        operation: 'record_progress',
        ticket_id: 'task-transactional',
        expected_revision: 1,
        claim_token: activeClaim.claim_token,
        owner_id: 'agent-other',
        session_id: activeClaim.session_id,
        progress_key: 'transactional:p1',
        payload: { summary: 'Must not commit.' },
      }],
      transitionIndex: 0,
      violation: 'claim-conflict',
    },
    {
      name: 'conflicting receipt',
      ticket: ticket({
        id: 'task-transactional',
        type: 'task',
        revision: 2,
        claim: activeClaim,
        task_action: {
          intent: 'Perform the receipt action.',
          idempotency_key: 'transactional-receipt-1',
          authorization_reference: 'human-approval-transactional',
          reconciliation_method: 'Look up transactional-receipt-1.',
          state: 'succeeded',
          external_receipt: succeededReceipt,
        },
      }),
      operations: [{
        operation: 'record_task_receipt',
        ticket_id: 'task-transactional',
        expected_revision: 2,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        idempotency_key: 'transactional-receipt-1',
        outcome: 'unknown',
        receipt: {
          ...succeededReceipt,
          result: 'unknown',
        },
      }],
      transitionIndex: 0,
      violation: 'task-receipt-conflict',
    },
    {
      name: 'non-human unblock',
      ticket: ticket({
        id: 'task-transactional',
        type: 'task',
        status: 'blocked',
        revision: 3,
        block: blocked,
      }),
      operations: [{
        operation: 'unblock_ticket',
        ticket_id: 'task-transactional',
        expected_revision: 3,
        block_revision: 3,
        actor_type: 'agent',
        actor_id: 'agent-transactional',
        authorization_reference: 'agent-output',
        reconciliation_evidence: {
          authority_reference: 'authority:agent-output',
          conclusion: 'An agent cannot authorize unblock.',
        },
      }],
      transitionIndex: 0,
      violation: 'human-required-for-unblock',
    },
    {
      name: 'pre-inspection work',
      ticket: ticket({
        id: 'task-transactional',
        type: 'task',
        claim: expiredClaim,
      }),
      operations: [
        {
          operation: 'reclaim_expired_claim',
          ticket_id: 'task-transactional',
          expected_revision: 1,
          observed_claim_token: expiredClaim.claim_token,
          new_claim_token: 'claim-fresh-transactional',
          owner_id: expiredClaim.owner_id,
          session_id: 'session-fresh-transactional',
          lease_duration_ms: 3_600_000,
        },
        {
          operation: 'record_progress',
          ticket_id: 'task-transactional',
          expected_revision: 2,
          claim_token: 'claim-fresh-transactional',
          owner_id: expiredClaim.owner_id,
          session_id: 'session-fresh-transactional',
          progress_key: 'transactional:p1',
          payload: { summary: 'Must inspect first.' },
        },
      ],
      transitionIndex: 1,
      violation: 'work-before-full-inspection',
    },
    {
      name: 'stale reclaim fencing',
      ticket: ticket({
        id: 'task-transactional',
        type: 'task',
        claim: expiredClaim,
      }),
      operations: [{
        operation: 'reclaim_expired_claim',
        ticket_id: 'task-transactional',
        expected_revision: 1,
        observed_claim_token: expiredClaim.claim_token,
        new_claim_token: expiredClaim.claim_token,
        owner_id: expiredClaim.owner_id,
        session_id: 'session-fresh-transactional',
        lease_duration_ms: 3_600_000,
      }],
      transitionIndex: 0,
      violation: 'reclaim-token-not-fresh',
    },
    {
      name: 'invalid external action',
      ticket: ticket({
        id: 'task-transactional',
        type: 'task',
        claim: activeClaim,
        task_action: {
          intent: 'Perform the invalid action.',
          idempotency_key: 'transactional-invalid-1',
          authorization_reference: 'human-approval-transactional',
          reconciliation_method: 'Look up transactional-invalid-1.',
          state: 'intended',
        },
      }),
      operations: [{
        operation: 'external_action',
        ticket_id: 'task-transactional',
        expected_revision: 1,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        idempotency_key: 'transactional-invalid-1',
        external_system: 'vendor-api',
        lookup_reference: 'vendor:transactional-invalid-1',
        outcome: 'failed',
      }],
      transitionIndex: 0,
      violation: 'invalid-task-outcome',
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const result = evaluateRecoveryTrace({
        schemaVersion: 1,
        now: '2026-08-23T20:00:00.000Z',
        initialState: { tickets: [scenario.ticket] },
        operations: scenario.operations,
      });
      const transition = result.transitions[scenario.transitionIndex];
      assert.deepEqual(transition.violationCodes, [scenario.violation]);
      assertCompactNoMutation(result, scenario.transitionIndex);
      if (scenario.transitionIndex > 0) {
        assert.deepEqual(
          transition.inspection,
          result.transitions[scenario.transitionIndex - 1].inspection,
        );
      } else {
        assert.deepEqual(transition.inspection, {
          requiredAtRevision: null,
          lastFullInspectionRevision: null,
          releaseConfirmationRequiredAtRevision: null,
          lastReleaseConfirmationRevision: null,
        });
      }
    });
  }
});

test('caller-supplied after states are ignored', () => {
  const baseline = evaluateRecoveryTrace(traces.unknownExternalOutcome.input);
  const spoofed = structuredClone(traces.unknownExternalOutcome.input);
  spoofed.operations[3].after = {
    tickets: [{ id: 'task-unknown', status: 'closed', claim: null }],
  };
  assert.deepEqual(evaluateRecoveryTrace(spoofed), baseline);
});

test('CLI output has export parity and malformed JSON exits nonzero', () => {
  const input = traces.unknownExternalOutcome.input;
  const expected = evaluateRecoveryTrace(input);
  const valid = spawnSync(process.execPath, [CHECKER], {
    cwd: ROOT,
    encoding: 'utf8',
    input: JSON.stringify(input),
  });
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout), expected);

  const malformed = spawnSync(process.execPath, [CHECKER], {
    cwd: ROOT,
    encoding: 'utf8',
    input: '{"schemaVersion":1',
  });
  assert.equal(malformed.status, 1);
  const error = JSON.parse(malformed.stdout);
  assert.equal(error.schemaVersion, 1);
  assert.equal(error.error.code, 'malformed-input');
  assert.equal(typeof error.error.message, 'string');
  assert.ok(error.error.message.length > 0);
});

test('CLI state ordering is byte-stable across process locales', () => {
  const input = {
    schemaVersion: 1,
    map_id: 'map-recovery',
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({ id: 'ä' }),
        ticket({ id: 'z' }),
        ticket({ id: 'a' }),
      ],
    },
    operations: [],
  };
  const outputs = ['en_US.UTF-8', 'sv_SE.UTF-8'].map((locale) => {
    const execution = spawnSync(process.execPath, [CHECKER], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        LANG: locale,
        LC_ALL: locale,
      },
      input: JSON.stringify(input),
    });
    assert.equal(execution.status, 0, execution.stderr);
    return execution.stdout;
  });
  assert.equal(outputs[0], outputs[1]);
  const parsed = JSON.parse(outputs[0]);
  assert.deepEqual(parsed.finalState.tickets.map(({ id }) => id), ['a', 'z', 'ä']);
  assert.deepEqual(parsed.frontier, ['a', 'z', 'ä']);
});

test('export refuses malformed trace schemas and unknown operations', () => {
  assert.throws(
    () => evaluateRecoveryTrace({}),
    (error) => error.code === 'malformed-input' && /schemaVersion/.test(error.message),
  );
  assert.throws(
    () => evaluateRecoveryTrace({
      schemaVersion: 1,
      now: 'not-a-date',
      initialState: { tickets: [] },
      operations: [],
    }),
    (error) => error.code === 'malformed-input' && /now/.test(error.message),
  );
  assert.throws(
    () => evaluateRecoveryTrace({
      schemaVersion: 1,
      now: '2026-08-23T20:00:00.000Z',
      initialState: { tickets: [] },
      operations: [{ operation: 'invent_after_state', after: {} }],
    }),
    (error) => error.code === 'malformed-input' && /unknown operation/.test(error.message),
  );
});

test('blocked normalization requires explicit durable history without fabrication', () => {
  const block = {
    reason: 'The active block must be supplied in durable history.',
    evidence_reference: 'evidence:explicit-block-history',
    actor_id: 'agent-explicit-block-history',
    blocked_at: '2026-08-23T19:00:00.000Z',
    blocked_revision: 4,
    requires_human_resolution: true,
  };
  assert.throws(
    () => evaluateRecoveryTrace({
      schemaVersion: 1,
      now: '2026-08-23T20:00:00.000Z',
      initialState: {
        tickets: [{
          id: 'task-explicit-block-history',
          parent_map_id: 'map-recovery',
          type: 'task',
          status: 'blocked',
          revision: 4,
          blocker_ids: [],
          claim: null,
          block,
          comments: [],
          evidence: [],
          progress_records: [],
          task_action: null,
        }],
      },
      operations: [],
    }),
    (error) => error.code === 'malformed-input'
      && /block_history.*required.*blocked/i.test(error.message),
  );
});

test('final invariants require offset-qualified timestamps in every normalized time field', async (t) => {
  const reconciledBlock = {
    reason: 'Previously blocked.',
    evidence_reference: 'evidence:strict-time',
    actor_id: 'agent-strict-time',
    blocked_at: '2026-08-23T18:00:00.000Z',
    blocked_revision: 2,
    requires_human_resolution: true,
    reconciliation: {
      block_revision: 2,
      actor_type: 'human',
      actor_id: 'human-strict-time',
      authorization_reference: 'authorization:strict-time',
      reconciliation_evidence: {
        authority_reference: 'authority:strict-time',
        conclusion: 'The prior block was reconciled.',
      },
      reconciled_at: '2026-08-23T18:30:00.000Z',
      resulting_revision: 3,
    },
  };
  const baseInput = {
    schemaVersion: 1,
    map_id: 'map-recovery',
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'task-strict-time',
          type: 'task',
          revision: 4,
          claim: claim({
            claim_token: 'claim-strict-time',
            owner_id: 'agent-strict-time',
            session_id: 'session-strict-time',
            acquired_at: '2026-08-23T19:00:00.000Z',
            expires_at: '2026-08-23T21:00:00.000Z',
          }),
          block_history: [reconciledBlock],
          progress_records: [{
            progress_key: 'strict-time:p1',
            payload: { summary: 'Preserved work.' },
            recorded_at: '2026-08-23T19:15:00.000Z',
            revision: 4,
          }],
        }),
      ],
    },
    operations: [],
  };
  const cases = [
    {
      name: 'now',
      mutate(input) {
        input.now = '2026-08-23T20:00:00.000';
      },
      message: /now.*UTC offset|now.*Z/i,
    },
    {
      name: 'claim acquisition',
      mutate(input) {
        input.initialState.tickets[0].claim.acquired_at = '2026-08-23T19:00:00.000';
      },
      message: /claim\.acquired_at.*UTC offset|claim\.acquired_at.*Z/i,
    },
    {
      name: 'claim expiry',
      mutate(input) {
        input.initialState.tickets[0].claim.expires_at = '2026-08-23T21:00:00.000';
      },
      message: /claim\.expires_at.*UTC offset|claim\.expires_at.*Z/i,
    },
    {
      name: 'block time',
      mutate(input) {
        input.initialState.tickets[0].block_history[0].blocked_at =
          '2026-08-23T18:00:00.000';
      },
      message: /blocked_at.*UTC offset|blocked_at.*Z/i,
    },
    {
      name: 'reconciliation audit time',
      mutate(input) {
        input.initialState.tickets[0].block_history[0].reconciliation.reconciled_at =
          '2026-08-23T18:30:00.000';
      },
      message: /reconciled_at.*UTC offset|reconciled_at.*Z/i,
    },
    {
      name: 'progress time',
      mutate(input) {
        input.initialState.tickets[0].progress_records[0].recorded_at =
          '2026-08-23T19:15:00.000';
      },
      message: /recorded_at.*UTC offset|recorded_at.*Z/i,
    },
    {
      name: 'pending external operation time',
      mutate(input) {
        const target = input.initialState.tickets[0];
        target.task_action = {
          intent: 'Synchronize the observed action.',
          idempotency_key: 'strict-time-action-1',
          authorization_reference: 'authorization:strict-time-action-1',
          reconciliation_method: 'Look up strict-time-action-1.',
          state: 'intended',
        };
        target.pending_external_action = {
          ticket_id: target.id,
          intent: target.task_action.intent,
          idempotency_key: target.task_action.idempotency_key,
          claim_token: target.claim.claim_token,
          owner_id: target.claim.owner_id,
          session_id: target.claim.session_id,
          external_system: 'vendor-api',
          lookup_reference: 'vendor:strict-time-action-1',
          outcome: 'succeeded',
          performed_at: '2026-08-23T19:30:00.000',
          receipt_synchronization_pending: true,
        };
      },
      message: /performed_at.*UTC offset|performed_at.*Z/i,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const input = structuredClone(baseInput);
      scenario.mutate(input);
      assert.throws(
        () => evaluateRecoveryTrace(input),
        (error) => error.code === 'malformed-input'
          && scenario.message.test(error.message),
      );
    });
  }
});

test('final invariants authorize claims only for acquired_at <= now < expires_at', async (t) => {
  const baseInput = {
    schemaVersion: 1,
    map_id: 'map-recovery',
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'research-claim-interval',
          claim: claim({
            claim_token: 'claim-interval',
            owner_id: 'agent-interval',
            session_id: 'session-interval',
            acquired_at: '2026-08-23T20:00:00.000Z',
            expires_at: '2026-08-23T21:00:00.000Z',
          }),
        }),
      ],
    },
    operations: [{
      operation: 'record_progress',
      ticket_id: 'research-claim-interval',
      expected_revision: 1,
      claim_token: 'claim-interval',
      owner_id: 'agent-interval',
      session_id: 'session-interval',
      progress_key: 'claim-interval:p1',
      payload: { summary: 'Equality at acquisition is authorized.' },
    }],
  };

  await t.test('acquisition equality is allowed', () => {
    const result = evaluateRecoveryTrace(baseInput);
    assert.deepEqual(result.violationCodes, []);
    assert.equal(result.finalState.tickets[0].revision, 2);
  });

  for (const scenario of [
    {
      name: 'future acquisition is not authorized',
      acquired_at: '2026-08-23T20:00:00.001Z',
      expires_at: '2026-08-23T21:00:00.000Z',
      violation: 'claim-conflict',
    },
    {
      name: 'expiry equality is not authorized',
      acquired_at: '2026-08-23T19:00:00.000Z',
      expires_at: '2026-08-23T20:00:00.000Z',
      violation: 'claim-conflict',
    },
    {
      name: 'already expired claim is not authorized',
      acquired_at: '2026-08-23T18:00:00.000Z',
      expires_at: '2026-08-23T19:00:00.000Z',
      violation: 'claim-conflict',
    },
  ]) {
    await t.test(scenario.name, () => {
      const input = structuredClone(baseInput);
      Object.assign(input.initialState.tickets[0].claim, scenario);
      delete input.initialState.tickets[0].claim.name;
      delete input.initialState.tickets[0].claim.violation;
      const result = evaluateRecoveryTrace(input);
      assert.deepEqual(result.violationCodes, [scenario.violation]);
      assertCompactNoMutation(result, 0);
    });
  }

  await t.test('inverted claim interval is malformed before an operation', () => {
    const input = structuredClone(baseInput);
    input.initialState.tickets[0].claim.acquired_at = '2026-08-23T20:30:00.000Z';
    input.initialState.tickets[0].claim.expires_at = '2026-08-23T20:15:00.000Z';
    assert.throws(
      () => evaluateRecoveryTrace(input),
      (error) => error.code === 'malformed-input' && /claim interval/i.test(error.message),
    );
  });
});

test('final invariants make qualified and rejected CLI timestamps timezone-independent', () => {
  const qualifiedInput = {
    schemaVersion: 1,
    map_id: 'map-recovery',
    now: '2026-08-23T13:00:00.000-07:00',
    initialState: {
      tickets: [
        ticket({
          id: 'research-timezone',
          claim: claim({
            claim_token: 'claim-timezone',
            owner_id: 'agent-timezone',
            session_id: 'session-timezone',
            acquired_at: '2026-08-23T12:00:00.000-07:00',
            expires_at: '2026-08-23T14:00:00.000-07:00',
          }),
        }),
      ],
    },
    operations: [],
  };
  const timezones = ['UTC', 'Pacific/Honolulu', 'Asia/Kathmandu'];
  const qualifiedOutputs = timezones.map((timezone) => {
    const execution = spawnSync(process.execPath, [CHECKER], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, TZ: timezone },
      input: JSON.stringify(qualifiedInput),
    });
    assert.equal(execution.status, 0, execution.stderr);
    return execution.stdout;
  });
  assert.equal(new Set(qualifiedOutputs).size, 1);
  const parsed = JSON.parse(qualifiedOutputs[0]);
  assert.equal(parsed.map_id, 'map-recovery');
  assert.equal(parsed.finalState.tickets[0].claim.acquired_at, '2026-08-23T19:00:00.000Z');
  assert.equal(parsed.finalState.tickets[0].claim.expires_at, '2026-08-23T21:00:00.000Z');

  const zoneLessInput = structuredClone(qualifiedInput);
  zoneLessInput.now = '2026-08-23T20:00:00.000';
  const rejectedOutputs = timezones.map((timezone) => {
    const execution = spawnSync(process.execPath, [CHECKER], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, TZ: timezone },
      input: JSON.stringify(zoneLessInput),
    });
    assert.equal(execution.status, 1);
    return execution.stdout;
  });
  assert.equal(new Set(rejectedOutputs).size, 1);
  const error = JSON.parse(rejectedOutputs[0]);
  assert.equal(error.error.code, 'malformed-input');
  assert.match(error.error.message, /now.*RFC 3339/i);
});

test('final invariants reject impossible closed snapshots and preserve valid terminal history', async (t) => {
  const activeClaim = claim({
    claim_token: 'claim-closed',
    owner_id: 'agent-closed',
    session_id: 'session-closed',
    acquired_at: '2026-08-23T19:00:00.000Z',
    expires_at: '2026-08-23T21:00:00.000Z',
  });
  const intendedAction = {
    intent: 'Perform an action that still requires work.',
    idempotency_key: 'closed-action-1',
    authorization_reference: 'authorization:closed-action-1',
    reconciliation_method: 'Look up closed-action-1.',
    state: 'intended',
  };
  const unknownAction = {
    ...intendedAction,
    state: 'outcome_unknown',
    external_receipt: {
      external_system: 'vendor-api',
      idempotency_key: 'closed-action-1',
      result: 'unknown',
      lookup_reference: 'vendor:closed-action-1',
    },
  };
  const cases = [
    {
      name: 'active claim',
      overrides: { claim: activeClaim },
      message: /closed.*claim/i,
    },
    {
      name: 'active block',
      overrides: {
        block: {
          reason: 'Still blocked.',
          evidence_reference: 'evidence:closed-block',
          actor_id: 'agent-closed',
          blocked_at: '2026-08-23T19:00:00.000Z',
          blocked_revision: 2,
          requires_human_resolution: true,
        },
      },
      message: /block.*closed|closed.*block/i,
    },
    {
      name: 'pending external action',
      overrides: {
        task_action: intendedAction,
        pending_external_action: {
          ticket_id: 'task-closed-invalid',
          intent: intendedAction.intent,
          idempotency_key: intendedAction.idempotency_key,
          claim_token: activeClaim.claim_token,
          owner_id: activeClaim.owner_id,
          session_id: activeClaim.session_id,
          external_system: 'vendor-api',
          lookup_reference: 'vendor:closed-action-1',
          outcome: 'succeeded',
          performed_at: '2026-08-23T19:30:00.000Z',
          receipt_synchronization_pending: true,
        },
      },
      message: /pending_external_action/i,
    },
    {
      name: 'recovery hold',
      overrides: {
        recovery_hold: {
          code: 'unknown-external-outcome',
          idempotency_key: 'closed-action-1',
          evidence_reference: 'vendor:closed-action-1',
        },
      },
      message: /closed.*recovery_hold/i,
    },
    {
      name: 'intended task action',
      overrides: { task_action: intendedAction },
      message: /closed.*task_action.*terminal/i,
    },
    {
      name: 'unknown task outcome',
      overrides: { task_action: unknownAction },
      message: /closed.*task_action.*terminal/i,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const invalid = ticket({
        id: 'task-closed-invalid',
        type: 'task',
        status: 'closed',
        revision: 4,
        ...scenario.overrides,
      });
      if (scenario.overrides.block) invalid.block_history = [scenario.overrides.block];
      assert.throws(
        () => evaluateRecoveryTrace({
          schemaVersion: 1,
          map_id: 'map-recovery',
          now: '2026-08-23T20:00:00.000Z',
          initialState: { tickets: [invalid] },
          operations: [],
        }),
        (error) => error.code === 'malformed-input'
          && scenario.message.test(error.message),
      );
    });
  }

  const priorBlock = {
    reason: 'Previously blocked.',
    evidence_reference: 'evidence:closed-history',
    actor_id: 'agent-closed',
    blocked_at: '2026-08-23T18:00:00.000Z',
    blocked_revision: 2,
    requires_human_resolution: true,
    reconciliation: {
      block_revision: 2,
      actor_type: 'human',
      actor_id: 'human-closed',
      authorization_reference: 'authorization:closed-history',
      reconciliation_evidence: {
        authority_reference: 'authority:closed-history',
        conclusion: 'The prior block was reconciled.',
      },
      reconciled_at: '2026-08-23T18:30:00.000Z',
      resulting_revision: 3,
    },
  };
  const succeededAction = {
    ...intendedAction,
    state: 'succeeded',
    external_receipt: {
      external_system: 'vendor-api',
      idempotency_key: intendedAction.idempotency_key,
      result: 'succeeded',
      lookup_reference: 'vendor:closed-action-1',
    },
  };
  const valid = evaluateRecoveryTrace({
    schemaVersion: 1,
    map_id: 'map-recovery',
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({
          id: 'research-closed-valid',
          status: 'closed',
          revision: 2,
        }),
        ticket({
          id: 'task-closed-valid',
          type: 'task',
          status: 'closed',
          revision: 4,
          block_history: [priorBlock],
          task_action: succeededAction,
        }),
      ],
    },
    operations: [],
  });
  assert.deepEqual(valid.violationCodes, []);
  assert.deepEqual(valid.finalState.tickets[1].block_history, [priorBlock]);
});

test('final invariants enforce centralized lifecycle gates before every mutation', async (t) => {
  const closedTicket = ticket({
    id: 'task-closed-lifecycle',
    type: 'task',
    status: 'closed',
    revision: 4,
  });
  const closedOperations = [
    'record_progress',
    'record_task_intent',
    'record_task_receipt',
    'block_ticket',
    'external_action',
    'unblock_ticket',
    'release_claim',
    'reclaim_expired_claim',
  ];
  for (const operation of closedOperations) {
    await t.test(`closed ${operation}`, () => {
      const result = evaluateRecoveryTrace({
        schemaVersion: 1,
        map_id: 'map-recovery',
        now: '2026-08-23T20:00:00.000Z',
        initialState: { tickets: [closedTicket] },
        operations: [{
          operation,
          ticket_id: closedTicket.id,
          expected_revision: closedTicket.revision,
        }],
      });
      assert.deepEqual(
        result.transitions[0].violationCodes,
        [operation === 'external_action'
          ? 'external-action-requires-open-ticket'
          : 'invalid-lifecycle-transition'],
      );
      assertCompactNoMutation(result, 0);
    });
  }

  for (const operation of [
    'record_progress',
    'record_task_intent',
    'record_task_receipt',
    'block_ticket',
    'external_action',
  ]) {
    await t.test(`blocked ${operation}`, () => {
      const block = {
        reason: 'Still blocked.',
        evidence_reference: 'evidence:blocked-lifecycle',
        actor_id: 'agent-blocked-lifecycle',
        blocked_at: '2026-08-23T19:00:00.000Z',
        blocked_revision: 4,
        requires_human_resolution: true,
      };
      const result = evaluateRecoveryTrace({
        schemaVersion: 1,
        map_id: 'map-recovery',
        now: '2026-08-23T20:00:00.000Z',
        initialState: {
          tickets: [
            ticket({
              id: 'task-blocked-lifecycle',
              type: 'task',
              status: 'blocked',
              revision: 4,
              block,
              block_history: [block],
            }),
          ],
        },
        operations: [{
          operation,
          ticket_id: 'task-blocked-lifecycle',
          expected_revision: 4,
        }],
      });
      assert.deepEqual(
        result.transitions[0].violationCodes,
        [operation === 'external_action'
          ? 'external-action-requires-open-ticket'
          : 'invalid-lifecycle-transition'],
      );
      assertCompactNoMutation(result, 0);
    });
  }

  const read = evaluateRecoveryTrace({
    schemaVersion: 1,
    map_id: 'map-recovery',
    now: '2026-08-23T20:00:00.000Z',
    initialState: { tickets: [closedTicket] },
    operations: [{
      operation: 'get_ticket',
      ticket_id: closedTicket.id,
      expected_revision: closedTicket.revision,
      full: true,
    }],
  });
  assert.deepEqual(read.violationCodes, []);
});

test('final invariants scope the frontier to the required map identity', () => {
  const input = {
    schemaVersion: 1,
    map_id: 'map-a',
    now: '2026-08-23T20:00:00.000Z',
    initialState: {
      tickets: [
        ticket({ id: 'a-ready', parent_map_id: 'map-a' }),
        ticket({ id: 'b-ready', parent_map_id: 'map-b' }),
        ticket({ id: 'non-child', parent_map_id: null }),
      ],
    },
    operations: [],
  };
  const mapA = evaluateRecoveryTrace(input);
  assert.equal(mapA.map_id, 'map-a');
  assert.deepEqual(mapA.frontier, ['a-ready']);

  const mapB = evaluateRecoveryTrace({ ...input, map_id: 'map-b' });
  assert.equal(mapB.map_id, 'map-b');
  assert.deepEqual(mapB.frontier, ['b-ready']);
});

test('final invariants reject a missing or empty map identity', async (t) => {
  for (const mapId of [undefined, '', '   ']) {
    await t.test(mapId === undefined ? 'missing' : JSON.stringify(mapId), () => {
      const input = {
        schemaVersion: 1,
        now: '2026-08-23T20:00:00.000Z',
        initialState: { tickets: [] },
        operations: [],
      };
      if (mapId !== undefined) input.map_id = mapId;
      assert.throws(
        () => evaluateRecoveryTraceStrict(input),
        (error) => error.code === 'malformed-input' && /map_id/.test(error.message),
      );
    });
  }
});

test('tracker contract pins pending-action, reclaim, blocker, and lease guarantees', () => {
  const contract = readFileSync(TRACKER_CONTRACT, 'utf8');
  const normalizedContract = contract.replace(/\s+/g, ' ');
  for (const field of [
    '`ticket_id`',
    '`idempotency_key`',
    '`claim_token`',
    '`session_id`',
    '`external_system`',
    '`lookup_reference`',
    '`outcome`',
    '`performed_at`',
    '`receipt_synchronization_pending`',
  ]) {
    assert.ok(contract.includes(field), `missing contract field: ${field}`);
  }
  for (const phrase of [
    'Pending external actions fence claim release, unblock, resolution, closure, new external actions, and frontier membership.',
    'The fence clears only after matching receipt synchronization and any required durable block or human reconciliation.',
    'a fresh claim token and a session identity different from the expired lease session',
    '`block_history` is required whenever `status` is `blocked`; adapters and the checker must never synthesize it',
    '`lease_duration_ms` must be a positive safe integer no greater than 2592000000',
    'Every blocker must be a sibling child with the same non-null `parent_map_id`.',
    '`map_id`, the required stable identity of the single map whose frontier is evaluated',
    '`acquired_at <= now < expires_at`',
    '`get_ticket` may inspect any lifecycle state',
    '`reclaim_expired_claim` is allowed only for `open` or `blocked` tickets',
  ]) {
    assert.ok(
      normalizedContract.includes(phrase),
      `missing contract phrase: ${phrase}`,
    );
  }
});

function strictTrace(overrides = {}) {
  return {
    schemaVersion: 1,
    map_id: 'map-recovery',
    now: '2026-08-23T20:00:00.000Z',
    initialState: { tickets: [] },
    operations: [],
    ...overrides,
  };
}

function liveClaim(suffix = 'matrix') {
  return claim({
    claim_token: `claim-${suffix}`,
    owner_id: `agent-${suffix}`,
    session_id: `session-${suffix}`,
    acquired_at: '2026-08-23T19:00:00.000Z',
    expires_at: '2026-08-23T21:00:00.000Z',
  });
}

function intendedTaskAction(suffix = 'matrix') {
  return {
    intent: `Perform action ${suffix}.`,
    idempotency_key: `action-${suffix}`,
    authorization_reference: `authorization-${suffix}`,
    reconciliation_method: `Look up action-${suffix}.`,
    state: 'intended',
  };
}

function pendingActionRecord(ticketId, activeClaim, action, overrides = {}) {
  return {
    ticket_id: ticketId,
    intent: action.intent,
    idempotency_key: action.idempotency_key,
    claim_token: activeClaim.claim_token,
    owner_id: activeClaim.owner_id,
    session_id: activeClaim.session_id,
    external_system: 'vendor-api',
    lookup_reference: `vendor:${action.idempotency_key}`,
    outcome: 'succeeded',
    performed_at: '2026-08-23T19:30:00.000Z',
    receipt_synchronization_pending: true,
    ...overrides,
  };
}

function assertCompactNoMutation(result, index, expectedViolation) {
  const transition = result.transitions[index];
  if (expectedViolation) {
    assert.deepEqual(transition.violationCodes, [expectedViolation]);
  }
  assert.match(transition.beforeStateSha256, /^[a-f0-9]{64}$/);
  assert.equal(transition.afterStateSha256, transition.beforeStateSha256);
  assert.deepEqual(transition.deltas, []);
  assert.equal('before' in transition, false);
  assert.equal('after' in transition, false);
}

function scopedOperation(operation, target) {
  const activeClaim = target.claim;
  const common = {
    operation,
    ticket_id: target.id,
    expected_revision: target.revision,
  };
  switch (operation) {
    case 'get_ticket':
      return { ...common, full: true };
    case 'record_progress':
      return {
        ...common,
        mutation_key: `mutation:${operation}`,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        progress_key: 'progress:map-scope',
        payload: { summary: 'Must remain scoped.' },
      };
    case 'record_task_intent':
      return {
        ...common,
        mutation_key: `mutation:${operation}`,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        intent: 'Must remain scoped.',
        idempotency_key: 'action-map-scope',
        authorization_reference: 'authorization-map-scope',
        reconciliation_method: 'Look up action-map-scope.',
      };
    case 'external_action':
      return {
        ...common,
        mutation_key: target.task_action.idempotency_key,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        idempotency_key: target.task_action.idempotency_key,
        external_system: 'vendor-api',
        lookup_reference: 'vendor:map-scope',
        outcome: 'succeeded',
      };
    case 'record_task_receipt':
      return {
        ...common,
        mutation_key: `mutation:${operation}`,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        idempotency_key: target.task_action.idempotency_key,
        outcome: 'succeeded',
        receipt: {
          external_system: 'vendor-api',
          idempotency_key: target.task_action.idempotency_key,
          result: 'succeeded',
          lookup_reference: 'vendor:map-scope',
        },
      };
    case 'block_ticket':
      return {
        ...common,
        mutation_key: `mutation:${operation}`,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        confirmed: true,
        reason: 'Must remain scoped.',
        evidence_reference: 'evidence:map-scope',
        actor_id: activeClaim.owner_id,
      };
    case 'release_claim':
      return {
        ...common,
        mutation_key: `mutation:${operation}`,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
      };
    case 'unblock_ticket':
      return {
        ...common,
        mutation_key: `mutation:${operation}`,
        block_revision: target.block.blocked_revision,
        actor_type: 'human',
        actor_id: 'human-map-scope',
        authorization_reference: 'authorization-map-scope',
        reconciliation_evidence: {
          authority_reference: 'authority:map-scope',
          conclusion: 'The block is reconciled.',
        },
      };
    case 'reclaim_expired_claim':
      return {
        ...common,
        mutation_key: `mutation:${operation}`,
        observed_claim_token: activeClaim.claim_token,
        new_claim_token: 'claim-new-map-scope',
        owner_id: activeClaim.owner_id,
        session_id: 'session-new-map-scope',
        lease_duration_ms: 3_600_000,
      };
    default:
      throw new Error(`unsupported scoped operation ${operation}`);
  }
}

function scopedTicket(operation, parentMapId) {
  const activeClaim = operation === 'reclaim_expired_claim'
    ? claim({
      claim_token: 'claim-expired-map-scope',
      owner_id: 'agent-map-scope',
      session_id: 'session-old-map-scope',
      acquired_at: '2026-08-23T18:00:00.000Z',
      expires_at: '2026-08-23T19:00:00.000Z',
    })
    : liveClaim('map-scope');
  if (operation === 'unblock_ticket') {
    const block = {
      reason: 'Requires reconciliation.',
      evidence_reference: 'evidence:map-scope',
      actor_id: 'agent-map-scope',
      blocked_at: '2026-08-23T19:00:00.000Z',
      blocked_revision: 2,
      requires_human_resolution: true,
    };
    return ticket({
      id: 'target-map-scope',
      parent_map_id: parentMapId,
      status: 'blocked',
      revision: 2,
      claim: activeClaim,
      block,
      block_history: [block],
    });
  }
  const taskOperation = [
    'record_task_intent',
    'external_action',
    'record_task_receipt',
  ].includes(operation);
  return ticket({
    id: 'target-map-scope',
    parent_map_id: parentMapId,
    type: taskOperation ? 'task' : 'research',
    claim: activeClaim,
    task_action: ['external_action', 'record_task_receipt'].includes(operation)
      ? intendedTaskAction('map-scope')
      : null,
  });
}

test('all operation families reject cross-map and null-parent targets transactionally', async (t) => {
  for (const operation of [
    'get_ticket',
    'record_progress',
    'record_task_intent',
    'external_action',
    'record_task_receipt',
    'block_ticket',
    'release_claim',
    'unblock_ticket',
    'reclaim_expired_claim',
  ]) {
    for (const [scopeName, parentMapId] of [
      ['cross-map', 'map-other'],
      ['null-parent', null],
    ]) {
      await t.test(`${operation} ${scopeName}`, () => {
        const target = scopedTicket(operation, parentMapId);
        const result = evaluateRecoveryTraceStrict(strictTrace({
          initialState: { tickets: [target] },
          operations: [scopedOperation(operation, target)],
        }));
        assertCompactNoMutation(result, 0, 'ticket-outside-selected-map');
        assert.deepEqual(result.finalState.tickets[0], target);
      });
    }
  }
});

test('normalized pending actions exist only on open tickets with the matching active claim', async (t) => {
  const activeClaim = liveClaim('pending-normalized');
  const action = intendedTaskAction('pending-normalized');
  const pending = pendingActionRecord('task-pending-normalized', activeClaim, action);
  const blocked = {
    reason: 'Cannot normalize pending while blocked.',
    evidence_reference: 'evidence:pending-normalized',
    actor_id: activeClaim.owner_id,
    blocked_at: '2026-08-23T19:45:00.000Z',
    blocked_revision: 2,
    requires_human_resolution: true,
  };
  const cases = [
    {
      name: 'blocked',
      value: ticket({
        id: 'task-pending-normalized',
        type: 'task',
        status: 'blocked',
        revision: 2,
        claim: activeClaim,
        block: blocked,
        block_history: [blocked],
        task_action: action,
        pending_external_action: pending,
      }),
    },
    {
      name: 'closed',
      value: ticket({
        id: 'task-pending-normalized',
        type: 'task',
        status: 'closed',
        revision: 2,
        task_action: action,
        pending_external_action: pending,
      }),
    },
    {
      name: 'unclaimed',
      value: ticket({
        id: 'task-pending-normalized',
        type: 'task',
        task_action: action,
        pending_external_action: pending,
      }),
    },
    {
      name: 'claim mismatch',
      value: ticket({
        id: 'task-pending-normalized',
        type: 'task',
        claim: activeClaim,
        task_action: action,
        pending_external_action: {
          ...pending,
          session_id: 'session-other',
        },
      }),
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      assert.throws(
        () => evaluateRecoveryTraceStrict(strictTrace({
          initialState: { tickets: [scenario.value] },
        })),
        (error) => error.code === 'malformed-input'
          && /pending_external_action/.test(error.message),
      );
    });
  }

  const valid = evaluateRecoveryTraceStrict(strictTrace({
    initialState: {
      tickets: [ticket({
        id: 'task-pending-normalized',
        type: 'task',
        claim: activeClaim,
        task_action: action,
        pending_external_action: pending,
      })],
    },
  }));
  assert.equal(valid.valid, true);
});

test('external action persistence advances revision and matching receipt uses that revision', () => {
  const activeClaim = liveClaim('action-revision');
  const action = intendedTaskAction('action-revision');
  const externalOperation = {
    operation: 'external_action',
    mutation_key: action.idempotency_key,
    ticket_id: 'task-action-revision',
    expected_revision: 1,
    claim_token: activeClaim.claim_token,
    owner_id: activeClaim.owner_id,
    session_id: activeClaim.session_id,
    idempotency_key: action.idempotency_key,
    external_system: 'vendor-api',
    lookup_reference: 'vendor:action-revision',
    outcome: 'succeeded',
  };
  const result = evaluateRecoveryTraceStrict(strictTrace({
    initialState: {
      tickets: [ticket({
        id: 'task-action-revision',
        type: 'task',
        claim: activeClaim,
        task_action: action,
      })],
    },
    operations: [
      externalOperation,
      {
        operation: 'record_task_receipt',
        mutation_key: 'mutation:receipt-action-revision',
        ticket_id: 'task-action-revision',
        expected_revision: 2,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        idempotency_key: action.idempotency_key,
        outcome: 'succeeded',
        receipt: {
          external_system: 'vendor-api',
          idempotency_key: action.idempotency_key,
          result: 'succeeded',
          lookup_reference: 'vendor:action-revision',
        },
      },
    ],
  }));
  assert.deepEqual(result.violationCodes, []);
  assert.equal(result.transitions[0].mutationResult.ticket_revision, 2);
  assert.equal(result.transitions[1].mutationResult.ticket_revision, 3);
  assert.equal(result.finalState.tickets[0].revision, 3);
  assert.equal(result.finalState.tickets[0].pending_external_action, null);
  assert.equal(result.externalActionCount, 1);
});

test('external action replay returns the original result and conflicting reuse is fenced', () => {
  const activeClaim = liveClaim('action-replay');
  const action = intendedTaskAction('action-replay');
  const operation = {
    operation: 'external_action',
    mutation_key: action.idempotency_key,
    ticket_id: 'task-action-replay',
    expected_revision: 1,
    claim_token: activeClaim.claim_token,
    owner_id: activeClaim.owner_id,
    session_id: activeClaim.session_id,
    idempotency_key: action.idempotency_key,
    external_system: 'vendor-api',
    lookup_reference: 'vendor:action-replay',
    outcome: 'succeeded',
  };
  const result = evaluateRecoveryTraceStrict(strictTrace({
    initialState: {
      tickets: [ticket({
        id: 'task-action-replay',
        type: 'task',
        claim: activeClaim,
        task_action: action,
      })],
    },
    operations: [
      operation,
      operation,
      { ...operation, lookup_reference: 'vendor:conflict' },
    ],
  }));
  assert.equal(result.transitions[1].replayed, true);
  assert.deepEqual(
    result.transitions[1].mutationResult,
    result.transitions[0].mutationResult,
  );
  assertCompactNoMutation(result, 1);
  assertCompactNoMutation(result, 2, 'mutation-key-conflict');
  assert.equal(result.finalState.tickets[0].revision, 2);
  assert.equal(result.externalActionCount, 1);
  assert.equal(result.mutationJournal.length, 1);
});

function replayScenario(operation) {
  const activeClaim = liveClaim(`replay-${operation}`);
  const base = {
    operation,
    mutation_key: `mutation:replay-${operation}`,
    ticket_id: `ticket-replay-${operation}`,
    expected_revision: 1,
  };
  switch (operation) {
    case 'record_progress':
      return {
        ticket: ticket({ id: base.ticket_id, claim: activeClaim }),
        operation: {
          ...base,
          claim_token: activeClaim.claim_token,
          owner_id: activeClaim.owner_id,
          session_id: activeClaim.session_id,
          progress_key: 'progress:replay',
          payload: { summary: 'Replay safely.' },
        },
        revision: 2,
      };
    case 'record_task_intent':
      return {
        ticket: ticket({ id: base.ticket_id, type: 'task', claim: activeClaim }),
        operation: {
          ...base,
          claim_token: activeClaim.claim_token,
          owner_id: activeClaim.owner_id,
          session_id: activeClaim.session_id,
          intent: 'Replay the task intent safely.',
          idempotency_key: 'action-replay-intent',
          authorization_reference: 'authorization-replay-intent',
          reconciliation_method: 'Look up action-replay-intent.',
        },
        revision: 2,
      };
    case 'record_task_receipt': {
      const action = intendedTaskAction('replay-receipt');
      return {
        ticket: ticket({
          id: base.ticket_id,
          type: 'task',
          claim: activeClaim,
          task_action: action,
        }),
        operation: {
          ...base,
          claim_token: activeClaim.claim_token,
          owner_id: activeClaim.owner_id,
          session_id: activeClaim.session_id,
          idempotency_key: action.idempotency_key,
          outcome: 'succeeded',
          receipt: {
            external_system: 'vendor-api',
            idempotency_key: action.idempotency_key,
            result: 'succeeded',
            lookup_reference: 'vendor:replay-receipt',
          },
        },
        revision: 2,
      };
    }
    case 'block_ticket':
      return {
        ticket: ticket({ id: base.ticket_id, claim: activeClaim }),
        operation: {
          ...base,
          claim_token: activeClaim.claim_token,
          owner_id: activeClaim.owner_id,
          session_id: activeClaim.session_id,
          confirmed: true,
          reason: 'Replay the block safely.',
          evidence_reference: 'evidence:replay-block',
          actor_id: activeClaim.owner_id,
        },
        revision: 2,
      };
    case 'release_claim':
      return {
        ticket: ticket({ id: base.ticket_id, claim: activeClaim }),
        operation: {
          ...base,
          claim_token: activeClaim.claim_token,
          owner_id: activeClaim.owner_id,
          session_id: activeClaim.session_id,
        },
        revision: 2,
      };
    case 'unblock_ticket': {
      const block = {
        reason: 'Replay the unblock safely.',
        evidence_reference: 'evidence:replay-unblock',
        actor_id: 'agent-replay-unblock',
        blocked_at: '2026-08-23T19:00:00.000Z',
        blocked_revision: 1,
        requires_human_resolution: true,
      };
      return {
        ticket: ticket({
          id: base.ticket_id,
          status: 'blocked',
          block,
          block_history: [block],
        }),
        operation: {
          ...base,
          block_revision: 1,
          actor_type: 'human',
          actor_id: 'human-replay-unblock',
          authorization_reference: 'authorization-replay-unblock',
          reconciliation_evidence: {
            authority_reference: 'authority:replay-unblock',
            conclusion: 'The block was reconciled.',
          },
        },
        revision: 2,
      };
    }
    case 'reclaim_expired_claim': {
      const expiredClaim = claim({
        claim_token: 'claim-expired-replay',
        owner_id: 'agent-replay-reclaim',
        session_id: 'session-old-replay',
        acquired_at: '2026-08-23T18:00:00.000Z',
        expires_at: '2026-08-23T19:00:00.000Z',
      });
      return {
        ticket: ticket({ id: base.ticket_id, claim: expiredClaim }),
        operation: {
          ...base,
          observed_claim_token: expiredClaim.claim_token,
          new_claim_token: 'claim-new-replay',
          owner_id: expiredClaim.owner_id,
          session_id: 'session-new-replay',
          lease_duration_ms: 3_600_000,
        },
        revision: 2,
      };
    }
    default:
      throw new Error(`unsupported replay operation ${operation}`);
  }
}

test('every modeled mutation replays without duplicate revision or state mutation', async (t) => {
  for (const operation of [
    'record_progress',
    'record_task_intent',
    'record_task_receipt',
    'block_ticket',
    'release_claim',
    'unblock_ticket',
    'reclaim_expired_claim',
  ]) {
    await t.test(operation, () => {
      const scenario = replayScenario(operation);
      const result = evaluateRecoveryTraceStrict(strictTrace({
        initialState: { tickets: [scenario.ticket] },
        operations: [scenario.operation, scenario.operation],
      }));
      assert.deepEqual(result.transitions[0].violationCodes, []);
      assert.equal(result.transitions[1].replayed, true);
      assert.deepEqual(
        result.transitions[1].mutationResult,
        result.transitions[0].mutationResult,
      );
      assertCompactNoMutation(result, 1);
      assert.equal(result.finalState.tickets[0].revision, scenario.revision);
      assert.equal(result.mutationJournal.length, 1);
    });
  }
});

test('replayed release and reclaim results restore their required read fences', async (t) => {
  await t.test('release replay', () => {
    const scenario = replayScenario('release_claim');
    const first = evaluateRecoveryTraceStrict(strictTrace({
      initialState: { tickets: [scenario.ticket] },
      operations: [scenario.operation],
    }));
    const replay = evaluateRecoveryTraceStrict(strictTrace({
      initialState: first.finalState,
      mutationJournal: first.mutationJournal,
      operations: [scenario.operation],
    }));
    assert.equal(replay.transitions[0].replayed, true);
    assert.equal(
      replay.transitions[0].inspection.releaseConfirmationRequiredAtRevision,
      2,
    );
    assert.ok(replay.violationCodes.includes('release-confirmation-required'));
  });

  await t.test('reclaim replay', () => {
    const scenario = replayScenario('reclaim_expired_claim');
    const first = evaluateRecoveryTraceStrict(strictTrace({
      initialState: { tickets: [scenario.ticket] },
      operations: [scenario.operation],
    }));
    const replay = evaluateRecoveryTraceStrict(strictTrace({
      initialState: first.finalState,
      mutationJournal: first.mutationJournal,
      operations: [
        scenario.operation,
        {
          operation: 'record_progress',
          mutation_key: 'mutation:after-replayed-reclaim',
          ticket_id: scenario.ticket.id,
          expected_revision: 2,
          claim_token: 'claim-new-replay',
          owner_id: 'agent-replay-reclaim',
          session_id: 'session-new-replay',
          progress_key: 'progress:after-replayed-reclaim',
          payload: { summary: 'Must inspect after replay.' },
        },
      ],
    }));
    assert.equal(replay.transitions[0].replayed, true);
    assert.equal(replay.transitions[0].inspection.requiredAtRevision, 2);
    assertCompactNoMutation(replay, 1, 'work-before-full-inspection');
  });
});

test('reclaim transfers pending receipt recovery to the fresh claim', () => {
  const expiredClaim = claim({
    claim_token: 'claim-expired-pending-recovery',
    owner_id: 'agent-pending-recovery',
    session_id: 'session-old-pending-recovery',
    acquired_at: '2026-08-23T18:00:00.000Z',
    expires_at: '2026-08-23T19:00:00.000Z',
  });
  const action = intendedTaskAction('pending-recovery');
  const pending = pendingActionRecord(
    'task-pending-recovery',
    expiredClaim,
    action,
  );
  const result = evaluateRecoveryTraceStrict(strictTrace({
    initialState: {
      tickets: [ticket({
        id: 'task-pending-recovery',
        type: 'task',
        claim: expiredClaim,
        task_action: action,
        pending_external_action: pending,
      })],
    },
    operations: [
      {
        operation: 'reclaim_expired_claim',
        mutation_key: 'mutation:reclaim-pending-recovery',
        ticket_id: 'task-pending-recovery',
        expected_revision: 1,
        observed_claim_token: expiredClaim.claim_token,
        new_claim_token: 'claim-new-pending-recovery',
        owner_id: expiredClaim.owner_id,
        session_id: 'session-new-pending-recovery',
        lease_duration_ms: 3_600_000,
      },
      {
        operation: 'get_ticket',
        ticket_id: 'task-pending-recovery',
        expected_revision: 2,
        full: true,
      },
      {
        operation: 'record_task_receipt',
        mutation_key: 'mutation:receipt-pending-recovery',
        ticket_id: 'task-pending-recovery',
        expected_revision: 2,
        claim_token: 'claim-new-pending-recovery',
        owner_id: expiredClaim.owner_id,
        session_id: 'session-new-pending-recovery',
        idempotency_key: action.idempotency_key,
        outcome: 'succeeded',
        receipt: {
          external_system: pending.external_system,
          idempotency_key: action.idempotency_key,
          result: 'succeeded',
          lookup_reference: pending.lookup_reference,
        },
      },
    ],
  }));
  assert.deepEqual(result.violationCodes, []);
  assert.equal(result.finalState.tickets[0].revision, 3);
  assert.equal(result.finalState.tickets[0].pending_external_action, null);
  assert.equal(result.finalState.tickets[0].task_action.state, 'succeeded');
});

test('normalized replay journal rejects missing or invalid operation results', async (t) => {
  const scenario = replayScenario('release_claim');
  const first = evaluateRecoveryTraceStrict(strictTrace({
    initialState: { tickets: [scenario.ticket] },
    operations: [scenario.operation],
  }));
  for (const [name, result] of [
    ['null', null],
    ['missing ticket revision', { claim_absent: true }],
    ['invalid release result', { ticket_revision: 2, claim_absent: false }],
  ]) {
    await t.test(name, () => {
      const mutationJournal = structuredClone(first.mutationJournal);
      mutationJournal[0].result = result;
      assert.throws(
        () => evaluateRecoveryTraceStrict(strictTrace({
          initialState: first.finalState,
          mutationJournal,
          operations: [scenario.operation],
        })),
        (error) => error.code === 'malformed-input'
          && /mutationJournal\[0\]\.result/.test(error.message),
      );
    });
  }
});

test('mutation keys conflict across changed payloads and operation names', () => {
  const activeClaim = liveClaim('mutation-conflict');
  const first = {
    operation: 'record_progress',
    mutation_key: 'mutation:conflict',
    ticket_id: 'ticket-mutation-conflict',
    expected_revision: 1,
    claim_token: activeClaim.claim_token,
    owner_id: activeClaim.owner_id,
    session_id: activeClaim.session_id,
    progress_key: 'progress:conflict',
    payload: { summary: 'Original payload.' },
  };
  const result = evaluateRecoveryTraceStrict(strictTrace({
    initialState: {
      tickets: [ticket({
        id: 'ticket-mutation-conflict',
        claim: activeClaim,
      })],
    },
    operations: [
      first,
      { ...first, payload: { summary: 'Changed payload.' } },
      {
        operation: 'block_ticket',
        mutation_key: first.mutation_key,
        ticket_id: first.ticket_id,
        expected_revision: 2,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
        confirmed: true,
        reason: 'Changed operation.',
        evidence_reference: 'evidence:changed-operation',
        actor_id: activeClaim.owner_id,
      },
    ],
  }));
  assertCompactNoMutation(result, 1, 'mutation-key-conflict');
  assertCompactNoMutation(result, 2, 'mutation-key-conflict');
  assert.equal(result.finalState.tickets[0].revision, 2);
  assert.equal(result.mutationJournal.length, 1);
});

test('every mutation requires a meaningful uniform mutation key', async (t) => {
  for (const operation of MUTATION_OPERATIONS) {
    await t.test(operation, () => {
      assert.throws(
        () => evaluateRecoveryTraceStrict(strictTrace({
          operations: [{
            operation,
            ticket_id: 'missing',
            expected_revision: 1,
          }],
        })),
        (error) => error.code === 'malformed-input'
          && /mutation_key/.test(error.message),
      );
    });
  }
});

test('release requires a full read at the returned revision before trace completion', async (t) => {
  const activeClaim = liveClaim('release-fence');
  const release = {
    operation: 'release_claim',
    mutation_key: 'mutation:release-fence',
    ticket_id: 'ticket-release-fence',
    expected_revision: 1,
    claim_token: activeClaim.claim_token,
    owner_id: activeClaim.owner_id,
    session_id: activeClaim.session_id,
  };
  const base = strictTrace({
    initialState: {
      tickets: [
        ticket({ id: 'ticket-release-fence', claim: activeClaim }),
        ticket({ id: 'ticket-release-other' }),
      ],
    },
  });
  const cases = [
    {
      name: 'missing confirmation',
      operations: [release],
      transitionViolation: null,
      finalViolation: 'release-confirmation-required',
    },
    {
      name: 'wrong ticket',
      operations: [
        release,
        {
          operation: 'get_ticket',
          ticket_id: 'ticket-release-other',
          expected_revision: 1,
          full: true,
        },
      ],
      transitionViolation: null,
      finalViolation: 'release-confirmation-required',
    },
    {
      name: 'stale revision',
      operations: [
        release,
        {
          operation: 'get_ticket',
          ticket_id: 'ticket-release-fence',
          expected_revision: 1,
          full: true,
        },
      ],
      transitionViolation: 'stale-revision',
      finalViolation: 'release-confirmation-required',
    },
    {
      name: 'partial read',
      operations: [
        release,
        {
          operation: 'get_ticket',
          ticket_id: 'ticket-release-fence',
          expected_revision: 2,
          full: false,
        },
      ],
      transitionViolation: 'full-inspection-required',
      finalViolation: 'release-confirmation-required',
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const result = evaluateRecoveryTraceStrict({
        ...base,
        operations: scenario.operations,
      });
      if (scenario.transitionViolation) {
        assertCompactNoMutation(result, 1, scenario.transitionViolation);
      }
      assert.ok(result.violationCodes.includes(scenario.finalViolation));
      assert.equal(result.valid, false);
    });
  }

  const confirmed = evaluateRecoveryTraceStrict({
    ...base,
    operations: [
      release,
      {
        operation: 'get_ticket',
        ticket_id: 'ticket-release-fence',
        expected_revision: 2,
        full: true,
      },
    ],
  });
  assert.deepEqual(confirmed.violationCodes, []);
  assert.equal(confirmed.valid, true);
  assert.equal(confirmed.finalState.tickets[0].claim, null);
  assert.equal(
    confirmed.transitions[1].inspection.releaseConfirmationRequiredAtRevision,
    null,
  );
});

test('release confirmation fence blocks later mutations without changing state', () => {
  const activeClaim = liveClaim('release-block');
  const otherClaim = liveClaim('release-block-other');
  const result = evaluateRecoveryTraceStrict(strictTrace({
    initialState: {
      tickets: [
        ticket({ id: 'ticket-release-block', claim: activeClaim }),
        ticket({ id: 'ticket-release-block-other', claim: otherClaim }),
      ],
    },
    operations: [
      {
        operation: 'release_claim',
        mutation_key: 'mutation:release-block',
        ticket_id: 'ticket-release-block',
        expected_revision: 1,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
      },
      {
        operation: 'record_progress',
        mutation_key: 'mutation:after-release',
        ticket_id: 'ticket-release-block-other',
        expected_revision: 1,
        claim_token: otherClaim.claim_token,
        owner_id: otherClaim.owner_id,
        session_id: otherClaim.session_id,
        progress_key: 'progress:after-release',
        payload: { summary: 'Must not run before confirmation.' },
      },
    ],
  }));
  assertCompactNoMutation(result, 1, 'work-before-release-confirmation');
  assert.ok(result.violationCodes.includes('release-confirmation-required'));
});

test('meaningful string fields reject whitespace without trimming opaque identities', async (t) => {
  const activeClaim = liveClaim('meaningful');
  const action = intendedTaskAction('meaningful');
  const baseTicket = ticket({
    id: 'task-meaningful',
    type: 'task',
    claim: activeClaim,
    task_action: action,
  });
  const cases = [
    ['ticket id', (input) => { input.initialState.tickets[0].id = ' \t '; }],
    ['parent map id', (input) => { input.initialState.tickets[0].parent_map_id = ' \n '; }],
    ['claim token', (input) => { input.initialState.tickets[0].claim.claim_token = '   '; }],
    ['claim owner', (input) => { input.initialState.tickets[0].claim.owner_id = '\t'; }],
    ['claim session', (input) => { input.initialState.tickets[0].claim.session_id = '\n'; }],
    ['task intent', (input) => { input.initialState.tickets[0].task_action.intent = '   '; }],
    ['action idempotency key', (input) => {
      input.initialState.tickets[0].task_action.idempotency_key = '   ';
    }],
    ['authorization reference', (input) => {
      input.initialState.tickets[0].task_action.authorization_reference = '\t ';
    }],
    ['reconciliation method', (input) => {
      input.initialState.tickets[0].task_action.reconciliation_method = ' \n ';
    }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const input = strictTrace({ initialState: { tickets: [baseTicket] } });
      mutate(input);
      assert.throws(
        () => evaluateRecoveryTraceStrict(input),
        (error) => error.code === 'malformed-input' && /non-empty|meaningful/i.test(error.message),
      );
    });
  }

  const preserved = evaluateRecoveryTraceStrict(strictTrace({
    map_id: ' map-opaque ',
    initialState: {
      tickets: [ticket({
        id: ' ticket-opaque ',
        parent_map_id: ' map-opaque ',
      })],
    },
  }));
  assert.equal(preserved.map_id, ' map-opaque ');
  assert.equal(preserved.finalState.tickets[0].id, ' ticket-opaque ');
});

test('strict RFC3339 accepts qualified instants and rejects invalid grammar or calendar values', async (t) => {
  for (const value of [
    '2024-02-29T23:59:59Z',
    '2024-02-29T23:59:59.1Z',
    '2024-02-29T23:59:59.123456+14:00',
    '2024-02-29T23:59:59-00:00',
  ]) {
    await t.test(`valid ${value}`, () => {
      const result = evaluateRecoveryTraceStrict(strictTrace({ now: value }));
      assert.equal(result.valid, true);
    });
  }
  for (const value of [
    '2024-02-29 23:59:59Z',
    '2024-02-29T23:59:59+1400',
    '2023-02-29T23:59:59Z',
    '2024-04-31T23:59:59Z',
    '2024-13-01T23:59:59Z',
    '2024-01-01T24:00:00Z',
    '2024-01-01T23:60:00Z',
    '2024-01-01T23:59:60Z',
    '2024-01-01T23:59:59+24:00',
    '2024-01-01T23:59:59+01:60',
    '2024-01-01T23:59:59Zsuffix',
  ]) {
    await t.test(`invalid ${value}`, () => {
      assert.throws(
        () => evaluateRecoveryTraceStrict(strictTrace({ now: value })),
        (error) => error.code === 'malformed-input' && /RFC 3339|timestamp/i.test(error.message),
      );
    });
  }
});

function exhaustedScenario(operation) {
  const scenario = replayScenario(operation);
  scenario.ticket.revision = Number.MAX_SAFE_INTEGER;
  scenario.operation.expected_revision = Number.MAX_SAFE_INTEGER;
  if (operation === 'unblock_ticket') {
    scenario.ticket.block.blocked_revision = Number.MAX_SAFE_INTEGER;
    scenario.ticket.block_history[0].blocked_revision = Number.MAX_SAFE_INTEGER;
    scenario.operation.block_revision = Number.MAX_SAFE_INTEGER;
  }
  return scenario;
}

test('checked revision increments reject exhaustion for every mutation family', async (t) => {
  for (const operation of [
    'record_progress',
    'record_task_intent',
    'record_task_receipt',
    'block_ticket',
    'release_claim',
    'unblock_ticket',
    'reclaim_expired_claim',
  ]) {
    await t.test(operation, () => {
      const scenario = exhaustedScenario(operation);
      const result = evaluateRecoveryTraceStrict(strictTrace({
        initialState: { tickets: [scenario.ticket] },
        operations: [scenario.operation],
      }));
      assertCompactNoMutation(result, 0, 'revision-exhausted');
      assert.equal(result.finalState.tickets[0].revision, Number.MAX_SAFE_INTEGER);
      assert.deepEqual(result.mutationJournal, []);
    });
  }

  const activeClaim = liveClaim('exhausted-action');
  const action = intendedTaskAction('exhausted-action');
  const result = evaluateRecoveryTraceStrict(strictTrace({
    initialState: {
      tickets: [ticket({
        id: 'task-exhausted-action',
        type: 'task',
        revision: Number.MAX_SAFE_INTEGER,
        claim: activeClaim,
        task_action: action,
      })],
    },
    operations: [{
      operation: 'external_action',
      mutation_key: action.idempotency_key,
      ticket_id: 'task-exhausted-action',
      expected_revision: Number.MAX_SAFE_INTEGER,
      claim_token: activeClaim.claim_token,
      owner_id: activeClaim.owner_id,
      session_id: activeClaim.session_id,
      idempotency_key: action.idempotency_key,
      external_system: 'vendor-api',
      lookup_reference: 'vendor:exhausted-action',
      outcome: 'succeeded',
    }],
  }));
  assertCompactNoMutation(result, 0, 'revision-exhausted');
  assert.equal(result.externalActionCount, 0);
});

test('normalized progress history is revision- and time-coherent', async (t) => {
  const record = (progressKey, revision, recordedAt) => ({
    progress_key: progressKey,
    payload: { summary: progressKey },
    recorded_at: recordedAt,
    revision,
  });
  const cases = [
    {
      name: 'equal revisions',
      revision: 3,
      records: [
        record('progress:a', 2, '2026-08-23T18:00:00.000Z'),
        record('progress:b', 2, '2026-08-23T19:00:00.000Z'),
      ],
    },
    {
      name: 'decreasing revisions',
      revision: 4,
      records: [
        record('progress:a', 3, '2026-08-23T18:00:00.000Z'),
        record('progress:b', 2, '2026-08-23T19:00:00.000Z'),
      ],
    },
    {
      name: 'future revision',
      revision: 3,
      records: [record('progress:a', 4, '2026-08-23T18:00:00.000Z')],
    },
    {
      name: 'decreasing time',
      revision: 4,
      records: [
        record('progress:a', 2, '2026-08-23T19:00:00.000Z'),
        record('progress:b', 3, '2026-08-23T18:00:00.000Z'),
      ],
    },
    {
      name: 'future time',
      revision: 3,
      records: [record('progress:a', 2, '2026-08-23T20:00:00.001Z')],
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      assert.throws(
        () => evaluateRecoveryTraceStrict(strictTrace({
          initialState: {
            tickets: [ticket({
              id: 'ticket-progress-history',
              revision: scenario.revision,
              progress_records: scenario.records,
            })],
          },
        })),
        (error) => error.code === 'malformed-input'
          && /progress_records/.test(error.message),
      );
    });
  }

  const valid = evaluateRecoveryTraceStrict(strictTrace({
    initialState: {
      tickets: [ticket({
        id: 'ticket-progress-history',
        revision: 5,
        progress_records: [
          record('progress:a', 2, '2026-08-23T18:00:00.000Z'),
          record('progress:b', 4, '2026-08-23T19:00:00.000Z'),
        ],
      })],
    },
  }));
  assert.equal(valid.valid, true);
});

test('checker enforces explicit input collection and serialized-size limits', async (t) => {
  const limits = {
    inputBytes: 262_144,
    tickets: 128,
    operations: 128,
    comments: 64,
    evidence: 64,
    progress: 64,
    journal: 128,
    ticketBytes: 32_768,
  };
  const cases = [
    {
      name: 'ticket count',
      input: strictTrace({
        initialState: {
          tickets: Array.from(
            { length: limits.tickets + 1 },
            (_, index) => ticket({ id: `ticket-limit-${index}` }),
          ),
        },
      }),
      message: /tickets.*128/i,
    },
    {
      name: 'operation count',
      input: strictTrace({
        operations: Array.from(
          { length: limits.operations + 1 },
          (_, index) => ({
            operation: 'get_ticket',
            ticket_id: `ticket-limit-${index}`,
            expected_revision: 1,
            full: true,
          }),
        ),
      }),
      message: /operations.*128/i,
    },
    {
      name: 'comments per ticket',
      input: strictTrace({
        initialState: {
          tickets: [ticket({
            comments: Array.from(
              { length: limits.comments + 1 },
              (_, index) => ({ id: `comment-${index}` }),
            ),
          })],
        },
      }),
      message: /comments.*64/i,
    },
    {
      name: 'serialized ticket size',
      input: strictTrace({
        initialState: {
          tickets: [ticket({
            comments: Array.from(
              { length: 10 },
              (_, index) => ({
                id: `large-comment-${index}`,
                body: 'x'.repeat(3_500),
              }),
            ),
          })],
        },
      }),
      message: /ticket.*32768/i,
    },
    {
      name: 'evidence per ticket',
      input: strictTrace({
        initialState: {
          tickets: [ticket({
            evidence: Array.from(
              { length: limits.evidence + 1 },
              (_, index) => ({ id: `evidence-${index}` }),
            ),
          })],
        },
      }),
      message: /evidence.*64/i,
    },
    {
      name: 'progress per ticket',
      input: strictTrace({
        initialState: {
          tickets: [ticket({
            revision: limits.progress + 1,
            progress_records: Array.from(
              { length: limits.progress + 1 },
              (_, index) => ({
                progress_key: `progress-${index}`,
                payload: { summary: `Progress ${index}` },
                recorded_at: '2026-08-23T19:00:00.000Z',
                revision: index + 1,
              }),
            ),
          })],
        },
      }),
      message: /progress_records.*64/i,
    },
    {
      name: 'mutation journal',
      input: strictTrace({
        mutationJournal: Array.from(
          { length: limits.journal + 1 },
          (_, index) => ({
            mutation_key: `mutation-journal-${index}`,
            operation: 'record_progress',
            ticket_id: 'ticket',
            fingerprint_sha256: 'a'.repeat(64),
            result: { ticket_revision: index + 1 },
          }),
        ),
      }),
      message: /mutationJournal.*128/i,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      assert.throws(
        () => evaluateRecoveryTraceStrict(scenario.input),
        (error) => error.code === 'malformed-input'
          && scenario.message.test(error.message),
      );
    });
  }

  const oversized = strictTrace({
    initialState: {
      tickets: [ticket({
        comments: [{ body: 'x'.repeat(limits.inputBytes) }],
      })],
    },
  });
  assert.throws(
    () => evaluateRecoveryTraceStrict(oversized),
    (error) => error.code === 'malformed-input' && /input.*262144/i.test(error.message),
  );
});

test('compact transitions prevent large trace output amplification', () => {
  const activeClaim = liveClaim('stress');
  const operations = Array.from({ length: 64 }, (_, index) => ({
    operation: 'record_progress',
    mutation_key: `mutation:stress-${index}`,
    ticket_id: 'ticket-stress-0',
    expected_revision: index + 1,
    claim_token: activeClaim.claim_token,
    owner_id: activeClaim.owner_id,
    session_id: activeClaim.session_id,
    progress_key: `progress:stress-${index}`,
    payload: {
      summary: `Stress progress ${index}`,
      evidence: 'x'.repeat(512),
    },
  }));
  const input = strictTrace({
    initialState: {
      tickets: Array.from({ length: 32 }, (_, index) => ticket({
        id: `ticket-stress-${index}`,
        claim: index === 0 ? activeClaim : null,
      })),
    },
    operations,
  });
  const result = evaluateRecoveryTraceStrict(input);
  const inputBytes = Buffer.byteLength(JSON.stringify(input));
  const outputBytes = Buffer.byteLength(JSON.stringify(result));
  assert.deepEqual(result.violationCodes, []);
  assert.equal(result.transitions.length, operations.length);
  assert.ok(result.transitions.every((transition) =>
    !('before' in transition) && !('after' in transition)));
  assert.ok(outputBytes < inputBytes * 10, `${outputBytes} should be < ${inputBytes * 10}`);
  assert.ok(outputBytes < 1_000_000, `${outputBytes} should be < 1000000`);
});

test('reclaim branch matrix rejects absent, wrong, and unexpired claims transactionally', async (t) => {
  const expiredClaim = claim({
    claim_token: 'claim-reclaim-branches',
    owner_id: 'agent-reclaim-branches',
    session_id: 'session-old-reclaim-branches',
    acquired_at: '2026-08-23T18:00:00.000Z',
    expires_at: '2026-08-23T19:00:00.000Z',
  });
  const operation = {
    operation: 'reclaim_expired_claim',
    mutation_key: 'mutation:reclaim-branches',
    ticket_id: 'ticket-reclaim-branches',
    expected_revision: 1,
    observed_claim_token: expiredClaim.claim_token,
    new_claim_token: 'claim-new-reclaim-branches',
    owner_id: expiredClaim.owner_id,
    session_id: 'session-new-reclaim-branches',
    lease_duration_ms: 3_600_000,
  };
  for (const scenario of [
    ['absent', null, operation],
    ['wrong token', expiredClaim, { ...operation, observed_claim_token: 'claim-other' }],
    ['unexpired', { ...expiredClaim, expires_at: '2026-08-23T21:00:00.000Z' }, operation],
  ]) {
    await t.test(scenario[0], () => {
      const result = evaluateRecoveryTraceStrict(strictTrace({
        initialState: {
          tickets: [ticket({
            id: 'ticket-reclaim-branches',
            claim: scenario[1],
          })],
        },
        operations: [scenario[2]],
      }));
      assertCompactNoMutation(result, 0, 'claim-not-reclaimable');
    });
  }
});

test('reclaim inspection remains fenced after partial and stale reads', async (t) => {
  const scenario = replayScenario('reclaim_expired_claim');
  for (const [name, read, violation] of [
    [
      'partial',
      {
        operation: 'get_ticket',
        ticket_id: scenario.ticket.id,
        expected_revision: 2,
        full: false,
      },
      'full-inspection-required',
    ],
    [
      'stale',
      {
        operation: 'get_ticket',
        ticket_id: scenario.ticket.id,
        expected_revision: 1,
        full: true,
      },
      'stale-revision',
    ],
  ]) {
    await t.test(name, () => {
      const result = evaluateRecoveryTraceStrict(strictTrace({
        initialState: { tickets: [scenario.ticket] },
        operations: [
          scenario.operation,
          read,
          {
            operation: 'record_progress',
            mutation_key: `mutation:after-${name}-inspection`,
            ticket_id: scenario.ticket.id,
            expected_revision: 2,
            claim_token: 'claim-new-replay',
            owner_id: 'agent-replay-reclaim',
            session_id: 'session-new-replay',
            progress_key: `progress:after-${name}`,
            payload: { summary: 'Must remain fenced.' },
          },
        ],
      }));
      assertCompactNoMutation(result, 1, violation);
      assertCompactNoMutation(result, 2, 'work-before-full-inspection');
    });
  }
});

test('pending receipt mismatches and pending unblock or release cannot mutate', async (t) => {
  const activeClaim = liveClaim('pending-branches');
  const action = intendedTaskAction('pending-branches');
  const pending = pendingActionRecord('task-pending-branches', activeClaim, action);
  const baseReceipt = {
    operation: 'record_task_receipt',
    mutation_key: 'mutation:pending-receipt',
    ticket_id: 'task-pending-branches',
    expected_revision: 2,
    claim_token: activeClaim.claim_token,
    owner_id: activeClaim.owner_id,
    session_id: activeClaim.session_id,
    idempotency_key: action.idempotency_key,
    outcome: 'succeeded',
    receipt: {
      external_system: pending.external_system,
      idempotency_key: action.idempotency_key,
      result: 'succeeded',
      lookup_reference: pending.lookup_reference,
    },
  };
  const cases = [
    {
      name: 'key mismatch',
      operation: {
        ...baseReceipt,
        idempotency_key: 'action-other',
        receipt: {
          ...baseReceipt.receipt,
          idempotency_key: 'action-other',
        },
      },
      violation: 'task-action-key-conflict',
    },
    {
      name: 'system mismatch',
      operation: {
        ...baseReceipt,
        receipt: {
          ...baseReceipt.receipt,
          external_system: 'other-api',
        },
      },
      violation: 'task-receipt-conflict',
    },
    {
      name: 'outcome mismatch',
      operation: {
        ...baseReceipt,
        outcome: 'unknown',
        receipt: {
          ...baseReceipt.receipt,
          result: 'unknown',
        },
      },
      violation: 'task-receipt-conflict',
    },
    {
      name: 'pending unblock',
      operation: {
        operation: 'unblock_ticket',
        mutation_key: 'mutation:pending-unblock',
        ticket_id: 'task-pending-branches',
        expected_revision: 2,
      },
      violation: 'pending-external-action',
    },
    {
      name: 'pending release',
      operation: {
        operation: 'release_claim',
        mutation_key: 'mutation:pending-release',
        ticket_id: 'task-pending-branches',
        expected_revision: 2,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
      },
      violation: 'pending-external-action',
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const result = evaluateRecoveryTraceStrict(strictTrace({
        initialState: {
          tickets: [ticket({
            id: 'task-pending-branches',
            type: 'task',
            revision: 2,
            claim: activeClaim,
            task_action: action,
            pending_external_action: pending,
          })],
        },
        operations: [scenario.operation],
      }));
      assertCompactNoMutation(result, 0, scenario.violation);
    });
  }
});

test('task intent domain replay, conflict, and wrong-type branches are complete', () => {
  const activeClaim = liveClaim('intent-branches');
  const intent = {
    operation: 'record_task_intent',
    mutation_key: 'mutation:intent-original',
    ticket_id: 'task-intent-branches',
    expected_revision: 1,
    claim_token: activeClaim.claim_token,
    owner_id: activeClaim.owner_id,
    session_id: activeClaim.session_id,
    intent: 'Record the durable task intent.',
    idempotency_key: 'action-intent-branches',
    authorization_reference: 'authorization-intent-branches',
    reconciliation_method: 'Look up action-intent-branches.',
  };
  const result = evaluateRecoveryTraceStrict(strictTrace({
    initialState: {
      tickets: [
        ticket({
          id: 'task-intent-branches',
          type: 'task',
          claim: activeClaim,
        }),
        ticket({
          id: 'research-intent-branches',
          claim: activeClaim,
        }),
      ],
    },
    operations: [
      intent,
      {
        ...intent,
        mutation_key: 'mutation:intent-domain-replay',
        expected_revision: 2,
      },
      {
        ...intent,
        mutation_key: 'mutation:intent-conflict',
        expected_revision: 2,
        intent: 'Conflicting task intent.',
      },
      {
        ...intent,
        mutation_key: 'mutation:intent-wrong-type',
        ticket_id: 'research-intent-branches',
      },
    ],
  }));
  assert.deepEqual(result.transitions[1].violationCodes, []);
  assert.equal(result.transitions[1].mutationResult.ticket_revision, 2);
  assertCompactNoMutation(result, 2, 'task-intent-conflict');
  assertCompactNoMutation(result, 3, 'task-operation-on-non-task');
  assert.equal(result.finalState.tickets[0].revision, 1);
  assert.equal(result.finalState.tickets[1].revision, 2);
});

test('tracker contract documents scoped targets, replay, release fences, bounds, and compact output', () => {
  const contract = readFileSync(TRACKER_CONTRACT, 'utf8').replace(/\s+/g, ' ');
  for (const phrase of [
    'Every operation target must be a direct child of the selected `map_id`.',
    'Every modeled mutation requires a non-whitespace `mutation_key`.',
    'An identical replay returns the original mutation result without another revision increment.',
    'A reused mutation key with a different operation or payload is a conflict.',
    'release confirmation is pending',
    'full `get_ticket` at the released revision',
    '`beforeStateSha256`',
    '`afterStateSha256`',
    'compact changed-path deltas',
    'strict RFC 3339',
    '128 tickets',
    '128 operations',
    '262144 bytes',
  ]) {
    assert.ok(contract.includes(phrase), `missing contract phrase: ${phrase}`);
  }
});

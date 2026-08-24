import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { evaluateRecoveryTrace } from '../skills/wayfinder-planning/scripts/recovery-contract.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const CHECKER = resolve(ROOT, 'skills/wayfinder-planning/scripts/recovery-contract.mjs');
const fixture = JSON.parse(readFileSync(
  resolve(ROOT, 'tests/fixtures/wayfinder-planning/recovery-traces.json'),
  'utf8',
));
const traces = fixture.traces;

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
    blocked_revision: 4,
    requires_human_resolution: true,
  };
  const expectedTicket = ticket({
    id: 'task-unknown',
    type: 'task',
    status: 'blocked',
    revision: 5,
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
  assert.deepEqual(result.transitions.at(-1).after, result.finalState);
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
  assert.deepEqual(result.transitions[3].before, result.transitions[3].after);
});

test('non-human unblock is rejected without changing lifecycle or frontier', () => {
  const result = evaluateRecoveryTrace(traces.nonHumanUnblock.input);
  assertFixtureContract('nonHumanUnblock', result);
  assert.equal(result.finalState.tickets[0].status, 'blocked');
  assert.equal(result.finalState.tickets[0].revision, 9);
  assert.deepEqual(result.transitions[0].before, result.transitions[0].after);
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
      assert.deepEqual(result.transitions[0].before, result.transitions[0].after);
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
  assert.deepEqual(result.transitions[0].before, result.transitions[0].after);
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
  assert.deepEqual(result.transitions[0].before, result.transitions[0].after);
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
  assert.deepEqual(result.transitions[1].before, result.transitions[1].after);
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
  assert.deepEqual(
    result.transitions[3].before.tickets[0].block_history[0],
    result.transitions[3].after.tickets[0].block_history[0],
  );
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
  assert.deepEqual(result.transitions[0].before, result.transitions[0].after);
  assert.deepEqual(result.transitions[1].before, result.transitions[1].after);
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
  assert.deepEqual(result.transitions[0].after.tickets[0].progress_records, [expectedRecord]);
  assert.deepEqual(result.transitions[1].before, result.transitions[1].after);
  assert.deepEqual(result.transitions[2].before, result.transitions[2].after);
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
      assert.deepEqual(result.transitions[0].before, result.transitions[0].after);
      assert.equal(result.externalActionCount, 0);
    });
  }
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
            expected_revision: 2,
            claim_token: activeClaim.claim_token,
            owner_id: activeClaim.owner_id,
            session_id: activeClaim.session_id,
          },
        ],
      };

      const result = evaluateRecoveryTrace(input);
      const pending = result.transitions[1].after.tickets[0].pending_external_action;
      assert.deepEqual(result.transitions[2].violationCodes, ['pending-external-action']);
      assert.deepEqual(result.transitions[2].before, result.transitions[2].after);
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

      assert.deepEqual(result.transitions[1].violationCodes, ['pending-external-action']);
      assert.deepEqual(result.transitions[1].before, result.transitions[1].after);
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
        expected_revision: 1,
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
        expected_revision: 2,
        claim_token: activeClaim.claim_token,
        owner_id: activeClaim.owner_id,
        session_id: activeClaim.session_id,
      },
    ],
  });
  assert.deepEqual(synchronized.violationCodes, []);
  assert.equal(synchronized.finalState.tickets[0].pending_external_action, null);
  assert.equal(synchronized.finalState.tickets[0].claim, null);
  assert.deepEqual(synchronized.frontier, ['task-pending-sync']);
});

test('an unmatched normalized pending action stays outside the frontier without a claim', () => {
  const result = evaluateRecoveryTrace({
    schemaVersion: 1,
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
          },
        }),
      ],
    },
    operations: [],
  });
  assert.deepEqual(result.frontier, []);
  assert.equal(
    result.finalState.tickets[0].pending_external_action.idempotency_key,
    'pending-unclaimed-1',
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
  assert.deepEqual(result.transitions[1].before, result.transitions[1].after);
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
      assert.deepEqual(result.transitions[0].before, result.transitions[0].after);
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
      assert.deepEqual(result.transitions[0].before, result.transitions[0].after);
      assert.equal(result.externalActionCount, 0);
    });
  }
});

test('expired reclaim requires full inspection and exposes prior recovery records', () => {
  const scenario = traces.expiredLeaseReclaim;
  const result = evaluateRecoveryTrace(scenario.input);
  assertFixtureContract('expiredLeaseReclaim', result);

  const reclaimed = result.transitions[0].after.tickets[0];
  assert.equal(reclaimed.revision, 8);
  assert.deepEqual(reclaimed.claim, claim({
    claim_token: 'claim-reclaimed',
    owner_id: 'agent-new',
    session_id: 'session-new',
    acquired_at: scenario.input.now,
    expires_at: '2026-08-23T21:00:00.000Z',
  }));
  assert.equal(result.transitions[0].inspection.requiredAtRevision, 8);

  const inspected = result.transitions[1].after.tickets[0];
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
    lease_duration_seconds: 3600,
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
      assert.deepEqual(result.transitions[0].before, result.transitions[0].after);
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
        lease_duration_seconds: 3600,
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
            lease_duration_seconds: 3600,
          },
          scenario.attempt,
        ],
      });
      assert.deepEqual(result.transitions[1].violationCodes, [
        'work-before-full-inspection',
      ]);
      assert.deepEqual(result.transitions[1].before, result.transitions[1].after);
      assert.equal(result.finalState.tickets[0].revision, 2);
      assert.equal(result.finalState.tickets[0].claim.claim_token, newClaimFields.claim_token);
    });
  }
});

test('successful full inspection at reclaimed revision permits later mutation', () => {
  const input = {
    schemaVersion: 1,
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
        lease_duration_seconds: 3600,
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

test('reordering release before durable block is a detected recovery regression', () => {
  const input = structuredClone(traces.unknownExternalOutcome.input);
  const [intent, action, receipt, block, getTicket, release] = input.operations;
  input.operations = [
    intent,
    action,
    receipt,
    { ...release, expected_revision: 3 },
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

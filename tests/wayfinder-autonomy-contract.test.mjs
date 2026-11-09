import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import {
  evaluateAutonomyTrace,
} from '../skills/wayfinder-planning/scripts/autonomy-contract.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const CHECKER = resolve(
  ROOT,
  'skills/wayfinder-planning/scripts/autonomy-contract.mjs',
);

const BASE_TIME = '2026-08-29T12:00:00.000Z';

function budget(overrides = {}) {
  return {
    time_ms: 1_800_000,
    token_units: 64_000,
    tool_calls: 64,
    reserve: {
      time_ms: 300_000,
      token_units: 12_000,
      tool_calls: 12,
    },
    ...overrides,
  };
}

function snapshot(sequence, revision, frontier, state = {}) {
  const clear = frontier.length === 0;
  return {
    sequence,
    revision,
    map_revision: revision,
    frontier_revision: revision,
    frontier,
    recomputed: true,
    state: {
      fog_empty: clear,
      unresolved_children: clear ? [] : [...frontier],
      blocked_children: [],
      claimed_children: [],
      pending_children: [],
      map_clear: clear,
      ...state,
    },
  };
}

function claim(token, revision, ticketId, lifecycle = [
  'acquired',
  'inspected',
  'synchronized',
  'close-verified',
  'consumed',
]) {
  return {
    ticket_id: ticketId,
    token,
    owner_id: 'controller',
    session_id: 'session-1',
    acquired_revision: revision,
    acquired_at: BASE_TIME,
    expires_at: '2026-08-29T12:20:00.000Z',
    lifecycle,
  };
}

function usage(work = {}, sync = {}) {
  return {
    work: {
      time_ms: 10_000,
      token_units: 1_000,
      tool_calls: 9,
      provenance: authenticatedProviderProvenance(),
      ...work,
    },
    sync: {
      time_ms: 5_000,
      token_units: 500,
      tool_calls: 4,
      provenance: authenticatedProviderProvenance(),
      ...sync,
    },
  };
}

function authenticatedProviderProvenance(overrides = {}) {
  return {
    kind: 'provider-counter',
    provider_id: 'provider-1',
    verifier_id: 'telemetry-verifier-1',
    verification_digest: 'provider-attestation-1',
    authenticated: true,
    ...overrides,
  };
}

function cycle(number, ticketId, revision, token, overrides = {}) {
  const started = new Date(Date.parse(BASE_TIME) + (number - 1) * 20_000).toISOString();
  const finished = new Date(Date.parse(started) + 15_000).toISOString();
  return {
    cycle: number,
    snapshot_sequence: number - 1,
    selected_ticket: ticketId,
    claim: {
      ...claim(token, revision, ticketId),
      acquired_at: started,
      expires_at: new Date(Date.parse(started) + 20 * 60_000).toISOString(),
    },
    worker_operations: [
      {
        worker_id: `research-${number}`,
        controller_id: 'controller',
        ticket_id: ticketId,
        mode: 'read-only-research',
        operation: 'read',
        sequence: 0,
        operation_index: 4,
      },
      {
        worker_id: `research-${number}`,
        controller_id: 'controller',
        ticket_id: ticketId,
        mode: 'read-only-research',
        operation: 'report',
        sequence: 1,
        operation_index: 5,
      },
    ],
    operations: [
      'read-frontier',
      'select',
      'claim',
      'inspect',
      'research',
      'resolve',
      'consolidate-workers',
      'synchronize',
      'close',
      'verify-close',
      'recompute-frontier',
    ],
    dispatched_operations: {
      work: [
        'read-frontier',
        'select',
        'claim',
        'inspect',
        'research',
        'resolve',
        'worker:read',
        'worker:report',
        'consolidate-workers',
      ],
      sync: ['synchronize', 'close', 'verify-close', 'recompute-frontier'],
    },
    timing: {
      started_at: started,
      finished_at: finished,
      elapsed_ms: 15_000,
    },
    outcome: 'succeeded',
    committed: { ticket_id: ticketId, revision: revision + 1 },
    usage: usage(),
    ...overrides,
  };
}

function validTrace(overrides = {}) {
  return {
    schemaVersion: 1,
    invocation: {
      invocation_id: 'invocation-1',
      map_id: 'map-1',
      owner_id: 'controller',
      session_id: 'session-1',
      budget: budget(),
    },
    original_request: {
      type: 'implementation',
      clear: true,
      authorized: true,
    },
    frontier_snapshots: [
      snapshot(0, 10, ['ticket-a']),
      snapshot(1, 12, ['ticket-b']),
      snapshot(2, 14, []),
    ],
    cycles: [
      cycle(1, 'ticket-a', 10, 'claim-a'),
      cycle(2, 'ticket-b', 12, 'claim-b'),
    ],
    stop: {
      reason: 'map-clear',
      substantive: true,
    },
    handoff: {
      target: 'requirements-and-spec-writing',
      authorized_by: 'original-request',
    },
    ...overrides,
  };
}

test('accepts two successful cycles with fresh frontier recomputation and reports a handoff', () => {
  const result = evaluateAutonomyTrace(validTrace());

  assert.equal(result.valid, true);
  assert.equal(result.cycles, 2);
  assert.deepEqual(result.committed_tickets, ['ticket-a', 'ticket-b']);
  assert.deepEqual(result.committed_revisions, [11, 13]);
  assert.equal(result.frontier_snapshots, 3);
  assert.equal(result.handoff.target, 'requirements-and-spec-writing');
  assert.equal(result.stop_reason, 'map-clear');
  assert.deepEqual(result.remaining_budget, {
    time_ms: 1_770_000,
    token_units: 61_000,
    tool_calls: 38,
  });
});

test('fails closed for forged ordering, stale cycles, double claims, and unsafe handoffs', () => {
  const cases = [
    {
      name: 'forged ordering',
      trace: validTrace({
        cycles: [
          cycle(2, 'ticket-a', 10, 'claim-a'),
          cycle(1, 'ticket-b', 12, 'claim-b'),
        ],
      }),
      violation: 'cycle-order',
    },
    {
      name: 'stale cycle',
      trace: validTrace({
        cycles: [
          cycle(1, 'ticket-a', 10, 'claim-a'),
          cycle(2, 'ticket-b', 10, 'claim-b'),
        ],
      }),
      violation: 'stale-frontier',
    },
    {
      name: 'double claim',
      trace: validTrace({
        cycles: [
          cycle(1, 'ticket-a', 10, 'same-claim'),
          cycle(2, 'ticket-b', 12, 'same-claim'),
        ],
      }),
      violation: 'double-claim',
    },
    {
      name: 'unsafe handoff',
      trace: validTrace({
        original_request: { type: 'planning', clear: true, authorized: true },
        handoff: { target: 'planning-and-task-breakdown', authorized_by: 'original-request' },
      }),
      violation: 'specification-approval-required',
    },
  ];

  for (const { name, trace, violation } of cases) {
    const result = evaluateAutonomyTrace(trace);
    assert.equal(result.valid, false, name);
    assert.ok(result.violation_codes.includes(violation), name);
  }
});

test('keeps read-only research workers claimless and mutation-free', () => {
  const result = evaluateAutonomyTrace(validTrace({
    cycles: [
      cycle(1, 'ticket-a', 10, 'claim-a', {
        worker_operations: [
          {
            worker_id: 'research-1',
            controller_id: 'controller',
            ticket_id: 'ticket-a',
            mode: 'read-only-research',
            operation: 'claim',
            sequence: 0,
            operation_index: 4,
          },
        ],
      }),
      cycle(2, 'ticket-b', 12, 'claim-b'),
    ],
  }));

  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('worker-operation-forbidden'));
});

test('requires verified claim consumption before another claim and forbids delivery actions', () => {
  const result = evaluateAutonomyTrace(validTrace({
    cycles: [
      cycle(1, 'ticket-a', 10, 'claim-a', {
        claim: claim('claim-a', 10, 'ticket-a', ['acquired', 'inspected', 'synchronized']),
        operations: ['read-frontier', 'claim', 'inspect', 'implementation'],
      }),
      cycle(2, 'ticket-b', 12, 'claim-b'),
    ],
  }));

  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('claim-lifecycle'));
  assert.ok(result.violation_codes.includes('controller-operation-forbidden'));
});

test('requires authorization for an implementation handoff and accepts approved planning handoff', () => {
  let result = evaluateAutonomyTrace(validTrace({
    original_request: { type: 'implementation', clear: true, authorized: false },
  }));
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('handoff-authorization'));

  result = evaluateAutonomyTrace(approvedPlanningTrace());
  assert.equal(result.valid, true);
});

test('enforces budgets, protected reserves, safe checkpoints, and no ticket-count cap', () => {
  const longTrace = validTrace({
    frontier_snapshots: [
      snapshot(0, 10, ['ticket-a']),
      snapshot(1, 12, ['ticket-b']),
      snapshot(2, 14, []),
    ],
    cycles: [
      cycle(1, 'ticket-a', 10, 'claim-a'),
      cycle(2, 'ticket-b', 12, 'claim-b'),
    ],
  });
  longTrace.invocation.budget = budget({
    time_ms: 120_000,
    token_units: 10_000,
    tool_calls: 10,
    reserve: { time_ms: 120_000, token_units: 4_000, tool_calls: 6 },
  });
  let result = evaluateAutonomyTrace(longTrace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('budget-insufficient-for-safe-sync'));

  result = evaluateAutonomyTrace(validTrace({
    cycles: [
      cycle(1, 'ticket-a', 10, 'claim-a', {
        usage: usage(
          { time_ms: 1_700_000, token_units: 52_000, tool_calls: 48 },
          { time_ms: 95_000, token_units: 11_000, tool_calls: 12 },
        ),
      }),
    ],
    frontier_snapshots: [
      snapshot(0, 10, ['ticket-a']),
      snapshot(1, 12, ['ticket-b']),
    ],
    stop: {
      reason: 'hard-budget-exhaustion',
      substantive: true,
      checkpoint: {
        invocation_id: 'invocation-1',
        map_id: 'map-1',
        map_revision: 12,
        frontier_revision: 12,
        claim: null,
        completed_count: 0,
        completed_digest: '0'.repeat(64),
        usage: { time_ms: 0, token_units: 0, tool_calls: 0 },
        remaining_budget: { time_ms: 0, token_units: 0, tool_calls: 0 },
        stop_reason: 'hard-budget-exhaustion',
      },
    },
    handoff: null,
  }));
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('work-consumes-reserve'));
  assert.ok(result.violation_codes.includes('checkpoint-mismatch'));
});

test('rejects malformed, oversized, unknown, and non-substantive traces', () => {
  assert.throws(
    () => evaluateAutonomyTrace({}),
    (error) => error.code === 'malformed-input',
  );
  assert.throws(
    () => evaluateAutonomyTrace({
      ...validTrace(),
      unknown_field: true,
    }),
    (error) => error.code === 'malformed-input',
  );
  assert.throws(
    () => evaluateAutonomyTrace({
      ...validTrace(),
      cycles: Array.from({ length: 100_000 }, () => null),
    }),
    (error) => error.code === 'malformed-input',
  );
  const result = evaluateAutonomyTrace(validTrace({
    stop: { reason: 'continue', substantive: false },
  }));
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('non-substantive-stop'));
});

test('CLI emits compact JSON and a nonzero structured error for invalid traces', () => {
  const valid = spawnSync(process.execPath, [CHECKER], {
    input: `${JSON.stringify(validTrace())}\n`,
    encoding: 'utf8',
  });
  assert.equal(valid.status, 0);
  const report = JSON.parse(valid.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.stop_reason, 'map-clear');

  const invalid = spawnSync(process.execPath, [CHECKER], {
    input: `${JSON.stringify({ unknown: true })}\n`,
    encoding: 'utf8',
  });
  assert.notEqual(invalid.status, 0);
  const error = JSON.parse(invalid.stdout);
  assert.equal(error.error.code, 'malformed-input');
});

test('rejects a second claim and synchronization before the claim in one cycle', () => {
  let result = evaluateAutonomyTrace(validTrace({
    cycles: [
      cycle(1, 'ticket-a', 10, 'claim-a', {
        operations: [
          'read-frontier',
          'claim',
          'claim',
          'inspect',
          'research',
          'synchronize',
          'close',
          'recompute-frontier',
        ],
      }),
      cycle(2, 'ticket-b', 12, 'claim-b'),
    ],
  }));
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('duplicate-claim'));

  result = evaluateAutonomyTrace(validTrace({
    cycles: [
      cycle(1, 'ticket-a', 10, 'claim-a', {
        operations: [
          'read-frontier',
          'synchronize',
          'claim',
          'inspect',
          'research',
          'close',
          'recompute-frontier',
        ],
      }),
      cycle(2, 'ticket-b', 12, 'claim-b'),
    ],
  }));
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('pre-claim-mutation'));
});

test('binds claims to the selected ticket and rejects wrong-ticket receipts', () => {
  const trace = validTrace();
  trace.cycles[0].claim.ticket_id = 'ticket-b';
  assert.doesNotThrow(() => evaluateAutonomyTrace(trace));
  const result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('claim-ticket-mismatch'));
});

test('fails closed for zero or missing untrusted usage and accepts derived byte accounting', () => {
  let trace = validTrace();
  delete trace.cycles[0].usage.work.provenance;
  delete trace.cycles[0].usage.sync.provenance;
  trace.cycles[0].usage.work.token_units = 0;
  trace.cycles[0].usage.sync.token_units = 0;
  let result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('usage-untrusted'));

  trace = validTrace();
  trace.cycles[0].usage = {
    work: { time_ms: 10_000, tool_calls: 8 },
    sync: { time_ms: 5_000, tool_calls: 4 },
  };
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('usage-untrusted'));

  trace = validTrace();
  trace.cycles[0].usage = {
    work: {
      time_ms: 10_000,
      tool_calls: 9,
      input_bytes: 8,
      output_bytes: 8,
      provenance: authenticatedProviderProvenance(),
    },
    sync: {
      time_ms: 5_000,
      tool_calls: 4,
      input_bytes: 8,
      output_bytes: 8,
      provenance: authenticatedProviderProvenance(),
    },
  };
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, true);
  assert.equal(result.remaining_budget.token_units, 62_492);
});

test('requires tool-call units to equal validated dispatched operations', () => {
  const trace = validTrace();
  trace.cycles[0].usage.work.tool_calls = 1;
  const result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('tool-call-count-mismatch'));
});

test('does not impose a fixed 128-cycle semantic cap', () => {
  const cycles = [];
  const snapshots = [];
  for (let index = 0; index <= 129; index += 1) {
    snapshots.push(snapshot(index, 10 + index * 2, index < 129 ? [`ticket-${index}`] : []));
    if (index < 129) cycles.push(cycle(index + 1, `ticket-${index}`, 10 + index * 2, `claim-${index}`));
  }
  const trace = validTrace({
    invocation: {
      ...validTrace().invocation,
      budget: budget({
        time_ms: 10_000_000,
        token_units: 10_000_000,
        tool_calls: 10_000,
        reserve: { time_ms: 300_000, token_units: 12_000, tool_calls: 12 },
      }),
    },
    frontier_snapshots: snapshots,
    cycles,
  });
  const result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, true);
  assert.equal(result.cycles, 129);
});

test('derives frontier stop reasons from validated map state', () => {
  let trace = validTrace({
    stop: { reason: 'empty-frontier', substantive: true },
  });
  let result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('empty-frontier-state'));

  trace = validTrace({
    stop: { reason: 'map-clear', substantive: true },
    frontier_snapshots: [
      snapshot(0, 10, ['ticket-a']),
      snapshot(1, 12, ['ticket-b']),
      snapshot(2, 14, [], {
        fog_empty: false,
        unresolved_children: ['ticket-c'],
        map_clear: false,
      }),
    ],
  });
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('map-clear-state'));

  trace = validTrace({
    stop: { reason: 'claimed-frontier', substantive: true },
    frontier_snapshots: [
      snapshot(0, 10, ['ticket-a']),
      snapshot(1, 12, ['ticket-b']),
      snapshot(2, 14, [], {
        map_clear: false,
      }),
    ],
  });
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('claimed-frontier-state'));
});

test('requires an exhausted dimension and bounded matching checkpoint for budget stops', () => {
  const trace = validTrace({
    stop: {
      reason: 'hard-budget-exhaustion',
      substantive: true,
      checkpoint: {
        invocation_id: 'wrong',
        map_id: 'map-1',
        map_revision: 14,
        frontier_revision: 14,
        claim: null,
        completed_count: 0,
        completed_digest: '0'.repeat(64),
        usage: { time_ms: 0, token_units: 0, tool_calls: 0 },
        remaining_budget: { time_ms: 0, token_units: 0, tool_calls: 0 },
        stop_reason: 'hard-budget-exhaustion',
      },
    },
  });
  const result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('budget-exhaustion-state'));
  assert.ok(result.violation_codes.includes('checkpoint-mismatch'));
});

test('rejects empty or mismatched checkpoints and impossible RFC3339 dates', () => {
  let trace = validTrace({
    stop: {
      reason: 'safety-failure',
      substantive: true,
      checkpoint: {},
    },
  });
  assert.throws(
    () => evaluateAutonomyTrace(trace),
    (error) => error.code === 'malformed-input',
  );

  trace = validTrace();
  trace.cycles[0].claim.acquired_at = '2026-02-29T12:00:00.000Z';
  assert.throws(
    () => evaluateAutonomyTrace(trace),
    (error) => error.code === 'malformed-input',
  );
});

test('rejects sub-millisecond RFC3339 precision instead of truncating ordering', () => {
  const trace = validTrace();
  trace.cycles[0].timing = {
    started_at: '2026-08-29T12:00:00.0009Z',
    finished_at: '2026-08-29T12:00:00.0010Z',
    elapsed_ms: 1,
  };
  assert.throws(
    () => evaluateAutonomyTrace(trace),
    (error) => error.code === 'malformed-input'
      && /RFC 3339|timestamp|fractional/i.test(error.message),
  );
});

test('rejects cross-phase dispatches instead of charging synchronization as work', () => {
  const trace = validTrace();
  trace.cycles[0].dispatched_operations.work[0] = 'synchronize';

  const result = evaluateAutonomyTrace(trace);

  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('dispatch-phase-mismatch'));
});

test('rejects unknown dispatches and dispatches that over-bind one operation', () => {
  let trace = validTrace();
  trace.cycles[0].dispatched_operations.sync[0] = 'unknown-sync-operation';
  let result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('dispatch-operation-unknown'));

  trace = validTrace();
  trace.cycles[0].dispatched_operations.work[0] = 'inspect';
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('dispatch-operation-unvalidated'));
});

test('charges elapsed time even when a cycle has no receipts', () => {
  const trace = validTrace();
  trace.cycles[0].timing = {
    started_at: BASE_TIME,
    finished_at: '2026-08-29T12:00:20.000Z',
    elapsed_ms: 20_000,
  };

  const result = evaluateAutonomyTrace(trace);

  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('elapsed-undercharge'));
});

test('enforces the stopped-cycle grammar and rejects work before claim', () => {
  const stopped = cycle(1, 'ticket-a', 10, 'claim-a', {
    claim: claim('claim-a', 10, 'ticket-a', ['acquired', 'inspected', 'released', 'release-verified']),
    operations: [
      'read-frontier',
      'work',
      'select',
      'claim',
      'release',
      'verify-release',
      'recompute-frontier',
    ],
    dispatched_operations: {
      work: ['read-frontier', 'work', 'select', 'claim'],
      sync: ['release', 'verify-release', 'recompute-frontier'],
    },
    outcome: 'blocked-frontier',
  });
  delete stopped.committed;
  const trace = validTrace({
    frontier_snapshots: [
      snapshot(0, 10, ['ticket-a']),
      snapshot(1, 12, [], {
        fog_empty: false,
        blocked_children: ['ticket-b'],
        map_clear: false,
      }),
    ],
    cycles: [stopped],
    stop: { reason: 'blocked-frontier', substantive: true },
    handoff: null,
  });

  const result = evaluateAutonomyTrace(trace);

  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('cycle-order'));
});

test('rejects stopped work and release before the required post-claim inspection', () => {
  const cases = [
    {
      name: 'work before inspect',
      operations: [
        'read-frontier',
        'select',
        'claim',
        'work',
        'inspect',
        'release',
        'verify-release',
        'recompute-frontier',
      ],
      dispatched: {
        work: ['read-frontier', 'select', 'claim', 'work', 'inspect'],
        sync: ['release', 'verify-release', 'recompute-frontier'],
      },
    },
    {
      name: 'release before inspect',
      operations: [
        'read-frontier',
        'select',
        'claim',
        'release',
        'verify-release',
        'recompute-frontier',
      ],
      dispatched: {
        work: ['read-frontier', 'select', 'claim'],
        sync: ['release', 'verify-release', 'recompute-frontier'],
      },
    },
  ];
  for (const scenario of cases) {
    const stopped = cycle(1, 'ticket-a', 10, 'claim-a', {
      claim: claim('claim-a', 10, 'ticket-a', [
        'acquired',
        'inspected',
        'released',
        'release-verified',
      ]),
      worker_operations: [],
      operations: scenario.operations,
      dispatched_operations: scenario.dispatched,
      usage: usage({ tool_calls: scenario.dispatched.work.length }, {
        tool_calls: scenario.dispatched.sync.length,
      }),
      outcome: 'blocked-frontier',
    });
    delete stopped.committed;
    const trace = validTrace({
      frontier_snapshots: [
        snapshot(0, 10, ['ticket-a']),
        snapshot(1, 12, [], {
          fog_empty: false,
          unresolved_children: ['ticket-b'],
          blocked_children: ['ticket-b'],
          map_clear: false,
        }),
      ],
      cycles: [stopped],
      stop: { reason: 'blocked-frontier', substantive: true },
      handoff: null,
    });
    const result = evaluateAutonomyTrace(trace);
    assert.equal(result.valid, false, scenario.name);
    assert.ok(result.violation_codes.includes('cycle-order'), scenario.name);
  }
});

test('rejects work after release verification and committed results on stopped cycles', () => {
  const stopped = cycle(1, 'ticket-a', 10, 'claim-a', {
    claim: claim('claim-a', 10, 'ticket-a', ['acquired', 'inspected', 'released', 'release-verified']),
    operations: [
      'read-frontier',
      'select',
      'claim',
      'inspect',
      'release',
      'verify-release',
      'work',
      'recompute-frontier',
    ],
    dispatched_operations: {
      work: ['read-frontier', 'select', 'claim', 'inspect', 'work'],
      sync: ['release', 'verify-release', 'recompute-frontier'],
    },
    outcome: 'blocked-frontier',
    committed: { ticket_id: 'ticket-a', revision: 11 },
  });
  const trace = validTrace({
    frontier_snapshots: [
      snapshot(0, 10, ['ticket-a']),
      snapshot(1, 12, [], {
        fog_empty: false,
        blocked_children: ['ticket-b'],
        map_clear: false,
      }),
    ],
    cycles: [stopped],
    stop: { reason: 'blocked-frontier', substantive: true },
    handoff: null,
  });

  const result = evaluateAutonomyTrace(trace);

  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('cycle-order'));
  assert.ok(result.violation_codes.includes('non-success-committed-result'));
});

test('requires frontier snapshots to equal all eligible unresolved children', () => {
  const trace = validTrace({
    frontier_snapshots: [
      snapshot(0, 10, ['ticket-a']),
      snapshot(1, 12, ['ticket-b'], {
        unresolved_children: ['ticket-b', 'ticket-c'],
      }),
      snapshot(2, 14, []),
    ],
  });

  const result = evaluateAutonomyTrace(trace);

  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('frontier-state-mismatch'));
});

test('requires trusted, bound human approval references for planning handoffs', () => {
  let trace = validTrace({
    original_request: {
      type: 'planning',
      clear: true,
      authorized: true,
      specification_approved: true,
      approval_reference: 'controller',
    },
    handoff: {
      target: 'planning-and-task-breakdown',
      authorized_by: 'controller',
      specification_approved: true,
    },
  });
  let result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('planning-approval-untrusted'));

  trace = validTrace({
    original_request: {
      type: 'planning',
      clear: true,
      authorized: true,
      specification_approved: true,
    },
    handoff: {
      target: 'planning-and-task-breakdown',
      authorized_by: 'human-approval',
      specification_approved: true,
    },
  });
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('planning-approval-reference'));

  trace = validTrace({
    original_request: {
      type: 'planning',
      clear: true,
      authorized: true,
      specification_approved: true,
      approval_reference: 'human-approval-one',
    },
    handoff: {
      target: 'planning-and-task-breakdown',
      authorized_by: 'human-approval-two',
      specification_approved: true,
    },
  });
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('planning-approval-reference'));
});

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function approvalDigest(approval) {
  return sha256(JSON.stringify({
    actor_id: approval.actor_id,
    allowed_handoff: approval.allowed_handoff,
    approval_id: approval.approval_id,
    expires_at: approval.expires_at,
    issued_at: approval.issued_at,
    original_request_sha256: approval.original_request_sha256,
    verifier_id: approval.verifier_id,
    verification_digest: approval.verification_digest,
  }));
}

function eventfulTrace(overrides = {}) {
  const trace = structuredClone(validTrace(overrides));
  for (const cycleEntry of trace.cycles) {
    cycleEntry.worker_operations = cycleEntry.worker_operations.map((operation, index) => ({
      ...operation,
      sequence: index,
      operation_index: 4 + index,
    }));
  }
  return trace;
}

function approvedPlanningTrace() {
  const request = 'Plan the approved implementation route.';
  const approval = {
    approval_id: 'approval-1',
    original_request_sha256: sha256(request),
    actor_id: 'human-1',
    allowed_handoff: 'planning-and-task-breakdown',
    issued_at: BASE_TIME,
    expires_at: '2026-08-29T12:30:00.000Z',
    verifier_id: 'external-verifier-1',
    verification_digest: 'external-verification-digest-1',
  };
  return eventfulTrace({
    original_request: {
      type: 'planning',
      clear: true,
      authorized: true,
      specification_approved: true,
      request,
    },
    trusted_approval: approval,
    handoff: {
      target: 'planning-and-task-breakdown',
      authorized_by: 'human-1',
      specification_approved: true,
      approval_id: approval.approval_id,
      approval_digest: approvalDigest(approval),
    },
  });
}

test('already-clear planning handoffs require an explicit timestamp, not an expired approval', () => {
  const trace = approvedPlanningTrace();
  trace.cycles = [];
  trace.frontier_snapshots = [snapshot(0, 10, [])];

  const result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('planning-approval-time-required'));
  assert.ok(!result.violation_codes.includes('planning-approval-expired'));
});

test('already-clear planning handoffs validate the approval at the handoff timestamp', () => {
  const trace = approvedPlanningTrace();
  trace.cycles = [];
  trace.frontier_snapshots = [snapshot(0, 10, [])];
  trace.handoff.at = BASE_TIME;

  const result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, true, result.violation_codes.join(', '));
  assert.equal(result.cycles, 0);
  assert.equal(result.handoff.target, 'planning-and-task-breakdown');

  for (const at of [
    '2026-08-29T11:59:59.999Z',
    '2026-08-29T12:30:00.000Z',
    '2026-08-29T12:30:00.001Z',
  ]) {
    const invalid = structuredClone(trace);
    invalid.handoff.at = at;
    const rejected = evaluateAutonomyTrace(invalid);
    assert.equal(rejected.valid, false, at);
    assert.ok(rejected.violation_codes.includes('planning-approval-expired'), at);
  }
});

test('explicit planning handoff times cannot predate the final cycle or reuse an expired approval', () => {
  const trace = approvedPlanningTrace();
  trace.handoff.at = '2026-08-29T12:00:35.000Z';
  assert.equal(evaluateAutonomyTrace(trace).valid, true);

  trace.handoff.at = '2026-08-29T12:00:34.999Z';
  let result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('planning-approval-time-before-cycle'));

  trace.handoff.at = trace.trusted_approval.expires_at;
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('planning-approval-expired'));
});

test('binds every controller and worker dispatch exactly to ordered consuming operations', () => {
  let trace = eventfulTrace();
  trace.cycles[0].dispatched_operations.work = [
    'read-frontier',
    'select',
    'claim',
    'inspect',
    'research',
    'worker:report',
    'worker:read',
    'consolidate-workers',
  ];
  let result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('dispatch-sequence-mismatch'));

  trace = eventfulTrace();
  trace.cycles[0].dispatched_operations.work.splice(4, 1);
  trace.cycles[0].usage.work.tool_calls -= 1;
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('dispatch-sequence-mismatch'));

  trace = eventfulTrace();
  trace.cycles[0].worker_operations.push({
    worker_id: 'research-1',
    controller_id: 'controller',
    ticket_id: 'ticket-a',
    mode: 'read-only-research',
    operation: 'observe',
    sequence: 2,
    operation_index: 5,
  });
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('dispatch-sequence-mismatch'));
});

test('worker dispatches must finish before their consolidation dispatch', () => {
  const trace = eventfulTrace();
  const dispatches = trace.cycles[0].dispatched_operations.work;
  trace.cycles[0].dispatched_operations.work = [
    ...dispatches.filter((operation) => !operation.startsWith('worker:')),
    ...dispatches.filter((operation) => operation.startsWith('worker:')),
  ];

  const result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('worker-event-order'));
});

test('rejects worker events before claim inspection and after synchronization or release', () => {
  let trace = eventfulTrace();
  trace.cycles[0].worker_operations[0].operation_index = 2;
  let result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('worker-event-order'));

  trace = eventfulTrace();
  const workDispatches = trace.cycles[0].dispatched_operations.work;
  workDispatches.splice(3, 0, workDispatches.splice(6, 1)[0]);
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('worker-event-order'));

  trace = eventfulTrace({
    cycles: [
      cycle(1, 'ticket-a', 10, 'claim-a', {
        claim: claim('claim-a', 10, 'ticket-a', [
          'acquired',
          'inspected',
          'released',
          'release-verified',
        ]),
        operations: [
          'read-frontier',
          'select',
          'claim',
          'inspect',
          'release',
          'verify-release',
          'recompute-frontier',
        ],
        dispatched_operations: {
          work: ['read-frontier', 'select', 'claim', 'inspect', 'worker:read'],
          sync: ['release', 'worker:report', 'verify-release', 'recompute-frontier'],
        },
        outcome: 'blocked-frontier',
        usage: usage({ tool_calls: 5 }, { tool_calls: 4 }),
      }),
    ],
    frontier_snapshots: [
      snapshot(0, 10, ['ticket-a']),
      snapshot(1, 12, [], {
        fog_empty: false,
        unresolved_children: ['ticket-b'],
        blocked_children: ['ticket-b'],
        map_clear: false,
      }),
    ],
    stop: { reason: 'blocked-frontier', substantive: true },
    handoff: null,
  });
  trace.cycles[0].worker_operations[1].operation_index = 5;
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('worker-event-order'));
});

test('rejects worker events after controller consolidation', () => {
  const trace = eventfulTrace();
  const cycleEntry = trace.cycles[0];
  const consolidationIndex = cycleEntry.operations.indexOf('consolidate-workers');
  cycleEntry.operations.splice(consolidationIndex + 1, 0, 'research');
  cycleEntry.dispatched_operations.work.push('research');
  cycleEntry.usage.work.tool_calls += 1;
  cycleEntry.worker_operations[1].operation_index = consolidationIndex + 1;

  const result = evaluateAutonomyTrace(trace);

  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('worker-event-order'));
});

test('rejects timestamp-only worker events even when their completion follows synchronization', () => {
  const trace = eventfulTrace();
  const worker = trace.cycles[0].worker_operations[0];
  delete worker.operation_index;
  worker.started_at = '2026-08-29T12:00:16.000Z';
  worker.finished_at = '2026-08-29T12:00:17.000Z';
  assert.throws(
    () => evaluateAutonomyTrace(trace),
    (error) => error.code === 'malformed-input'
      && /operation_index/i.test(error.message),
  );
});

test('requires trusted approval records bound to the exact request and planning handoff', () => {
  const valid = approvedPlanningTrace();
  let result = evaluateAutonomyTrace(valid);
  assert.equal(result.valid, true);

  const variants = [
    {
      name: 'bare approval string',
      mutate(trace) {
        trace.trusted_approval = 'human-approval';
      },
      throws: true,
    },
    {
      name: 'controller actor',
      mutate(trace) {
        trace.trusted_approval.actor_id = 'controller';
        trace.handoff.authorized_by = 'controller';
      },
    },
    {
      name: 'self actor',
      mutate(trace) {
        trace.trusted_approval.actor_id = 'self';
        trace.handoff.authorized_by = 'self';
      },
    },
    {
      name: 'handoff actor mismatch',
      mutate(trace) {
        trace.handoff.authorized_by = 'human-2';
      },
    },
    {
      name: 'tracker approval',
      mutate(trace) {
        trace.tracker_content = { trusted_approval: trace.trusted_approval };
      },
      throws: true,
    },
    {
      name: 'request mismatch',
      mutate(trace) {
        trace.original_request.request = 'A different request.';
      },
    },
    {
      name: 'expired approval',
      mutate(trace) {
        trace.trusted_approval.expires_at = '2026-08-29T11:59:00.000Z';
      },
      throws: true,
    },
    {
      name: 'handoff mismatch',
      mutate(trace) {
        trace.handoff.approval_digest = '0'.repeat(64);
      },
    },
    {
      name: 'verifier mismatch',
      mutate(trace) {
        trace.handoff.verifier_id = 'another-verifier';
      },
    },
    {
      name: 'verifier missing',
      mutate(trace) {
        delete trace.trusted_approval.verifier_id;
      },
      throws: true,
    },
  ];
  for (const variant of variants) {
    const trace = approvedPlanningTrace();
    variant.mutate(trace);
    if (variant.throws) {
      assert.throws(
        () => evaluateAutonomyTrace(trace),
        (error) => error.code === 'malformed-input',
        variant.name,
      );
      continue;
    }
    result = evaluateAutonomyTrace(trace);
    assert.equal(result.valid, false, variant.name);
    assert.ok(
      result.violation_codes.some((code) => code.startsWith('planning-approval-')),
      variant.name,
    );
  }
});

test('charges UTF-8 strings consistently and rejects opaque or zero byte undercharges', () => {
  let trace = validTrace();
  trace.cycles[0].usage.work = {
    time_ms: 10_000,
    tool_calls: 8,
    token_units: 1,
    provenance: 'provider',
    input: 'é',
    output: 'x',
    input_bytes: 0,
    output_bytes: 1,
  };
  let result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('byte-count-mismatch'));

  trace = validTrace();
  trace.cycles[0].usage.work = {
    time_ms: 10_000,
    tool_calls: 8,
    input_bytes: 8,
    output_bytes: 8,
  };
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('byte-provenance-untrusted'));

  trace = validTrace();
  trace.cycles[0].usage.work = {
    time_ms: 10_000,
    tool_calls: 8,
    token_units: 0,
    provenance: 'provider',
    input: 'non-empty',
    output: '',
  };
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('byte-count-mismatch'));
});

test('requires non-provider token units to exactly match derived UTF-8 units', () => {
  const input = 'é'.repeat(200);
  let trace = validTrace();
  trace.cycles[0].usage.work = {
    time_ms: 10_000,
    tool_calls: 9,
    token_units: 1,
    input,
    output: '',
  };
  let result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('token-count-mismatch'));

  trace = validTrace();
  trace.cycles[0].usage.work = {
    time_ms: 10_000,
    tool_calls: 9,
    token_units: 101,
    input,
    output: '',
  };
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('token-count-mismatch'));

  trace = validTrace();
  trace.cycles[0].usage.work = {
    time_ms: 10_000,
    tool_calls: 9,
    token_units: 100,
    input,
    output: '',
  };
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, true);
  assert.equal(result.remaining_budget.token_units, 61_900);
});

test('accepts only authenticated provider counters and rejects forged markers', () => {
  let trace = validTrace();
  trace.cycles[0].usage.work = {
    time_ms: 10_000,
    tool_calls: 9,
    token_units: 1,
    input: 'x'.repeat(400),
    output: '',
    provenance: authenticatedProviderProvenance(),
  };
  let result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, true);
  assert.equal(result.remaining_budget.token_units, 61_999);

  trace = validTrace();
  const minimalProvider = authenticatedProviderProvenance();
  delete minimalProvider.authenticated;
  trace.cycles[0].usage.work = {
    time_ms: 10_000,
    tool_calls: 9,
    token_units: 1,
    input: 'x'.repeat(400),
    output: '',
    provenance: minimalProvider,
  };
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, true);
  assert.equal(result.remaining_budget.token_units, 61_999);

  trace = validTrace();
  trace.cycles[0].usage.work = {
    time_ms: 10_000,
    tool_calls: 9,
    token_units: 100,
    input: 'x'.repeat(400),
    output: '',
    provenance: 'provider',
  };
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('provider-provenance-invalid'));

  trace = validTrace();
  const missingProof = authenticatedProviderProvenance();
  delete missingProof.verification_digest;
  trace.cycles[0].usage.work = {
    time_ms: 10_000,
    tool_calls: 9,
    token_units: 1,
    provenance: missingProof,
  };
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('provider-provenance-invalid'));

  trace = validTrace();
  trace.cycles[0].usage.work = {
    time_ms: 10_000,
    tool_calls: 9,
    token_units: 1,
    provenance: authenticatedProviderProvenance({ provider: 'provider-2' }),
  };
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('provider-provenance-invalid'));
});

test('prevents cumulative token undercounts from bypassing the hard budget', () => {
  const payload = 'x'.repeat(4_096);
  const trace = validTrace({
    invocation: {
      ...validTrace().invocation,
      budget: budget({
        token_units: 6_000,
        reserve: { time_ms: 300_000, token_units: 4_000, tool_calls: 12 },
      }),
    },
  });
  for (const cycleEntry of trace.cycles) {
    for (const kind of ['work', 'sync']) {
      cycleEntry.usage[kind] = {
        time_ms: cycleEntry.usage[kind].time_ms,
        tool_calls: cycleEntry.usage[kind].tool_calls,
        token_units: 1,
        provenance: 'provider',
        input: payload,
        output: payload,
      };
    }
  }

  const result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('hard-budget-exceeded'));
});

test('requires claimed and blocked stops to have an empty eligible frontier', () => {
  let trace = validTrace({
    stop: { reason: 'claimed-frontier', substantive: true },
    frontier_snapshots: [
      snapshot(0, 10, ['ticket-a']),
      snapshot(1, 12, ['ticket-b'], {
        unresolved_children: ['ticket-a', 'ticket-b'],
        claimed_children: ['ticket-a'],
        map_clear: false,
      }),
      snapshot(2, 14, ['ticket-c'], {
        unresolved_children: ['ticket-a', 'ticket-c'],
        claimed_children: ['ticket-a'],
        map_clear: false,
      }),
    ],
  });
  let result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('claimed-frontier-state'));

  trace = validTrace({
    stop: { reason: 'blocked-frontier', substantive: true },
    frontier_snapshots: [
      snapshot(0, 10, ['ticket-a']),
      snapshot(1, 12, ['ticket-b']),
      snapshot(2, 14, ['ticket-c'], {
        unresolved_children: ['ticket-b', 'ticket-c'],
        blocked_children: ['ticket-b'],
        map_clear: false,
      }),
    ],
  });
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('blocked-frontier-state'));
});

test('accepts a bounded checkpoint digest and count beyond the old ticket-list cap', () => {
  const count = 300;
  const cycles = [];
  const snapshots = [];
  const completed = [];
  for (let index = 0; index <= count; index += 1) {
    snapshots.push(snapshot(index, 10 + index * 2, index < count ? [`ticket-${index}`] : []));
    if (index < count) {
      const revision = 10 + index * 2;
      cycles.push(cycle(index + 1, `ticket-${index}`, revision, `claim-${index}`));
      completed.push({ ticket_id: `ticket-${index}`, revision: revision + 1 });
    }
  }
  const totalUsage = {
    time_ms: count * 15_000,
    token_units: count * 1_500,
    tool_calls: count * 13,
  };
  const trace = validTrace({
    invocation: {
      ...validTrace().invocation,
      budget: budget({
        time_ms: 10_000_000,
        token_units: 10_000_000,
        tool_calls: totalUsage.tool_calls,
      }),
    },
    frontier_snapshots: snapshots,
    cycles,
    stop: {
      reason: 'hard-budget-exhaustion',
      substantive: true,
      checkpoint: {
        invocation_id: 'invocation-1',
        map_id: 'map-1',
        map_revision: 10 + count * 2,
        frontier_revision: 10 + count * 2,
        claim: null,
        completed_count: count,
        completed_digest: sha256(JSON.stringify(completed)),
        recent_completed: completed.slice(-8),
        usage: totalUsage,
        remaining_budget: {
          time_ms: 10_000_000 - totalUsage.time_ms,
          token_units: 10_000_000 - totalUsage.token_units,
          tool_calls: 0,
        },
        stop_reason: 'hard-budget-exhaustion',
      },
    },
    handoff: null,
  });
  let result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, true);
  assert.equal(result.committed_count, count);
  assert.equal(result.committed_digest, sha256(JSON.stringify(completed)));
  assert.equal(result.committed_tickets.length, 32);
  assert.equal(result.committed_revisions.length, 32);

  trace.stop.checkpoint.completed_count = count - 1;
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('checkpoint-mismatch'));

  trace.stop.checkpoint.completed_count = count;
  trace.stop.checkpoint.completed_digest = '0'.repeat(64);
  result = evaluateAutonomyTrace(trace);
  assert.equal(result.valid, false);
  assert.ok(result.violation_codes.includes('checkpoint-mismatch'));
});

# Wayfinder Autonomy Loop Detail

This reference is the implementation-level companion to
`skills/wayfinder-planning/SKILL.md`. The recovery and autonomy contract
scripts remain authoritative executable conformance aids.

## Contents

1. [Trace records and phase allowlists](#trace-records-and-phase-allowlists)
2. [Provider and byte accounting](#provider-and-byte-accounting)
3. [Checkpoints and soft segments](#checkpoints-and-soft-segments)
4. [Worker temporal fences](#worker-temporal-fences)
5. [Trusted approval records](#trusted-approval-records)
6. [Controller trace validation](#controller-trace-validation)
7. [State and stop predicates](#state-and-stop-predicates)
8. [Deterministic checker usage](#deterministic-checker-usage)

## Trace records and phase allowlists

The schema-version 1 controller trace is one JSON object. Its core records are:

```json
{
  "schemaVersion": 1,
  "invocation": {
    "invocation_id": "…", "map_id": "…", "owner_id": "…",
    "session_id": "…",
    "budget": {
      "time_ms": 1800000, "token_units": 64000, "tool_calls": 64,
      "reserve": {"time_ms": 300000, "token_units": 12000, "tool_calls": 12}
    }
  },
  "original_request": {"type": "implementation", "clear": true, "authorized": true},
  "frontier_snapshots": [],
  "cycles": [],
  "stop": {"reason": "map-clear", "substantive": true}
}
```

Each cycle records `cycle`, `snapshot_sequence`, `selected_ticket`, `claim`,
`worker_operations`, `operations`, `dispatched_operations`, `receipts`,
`timing`, `outcome`, optional `committed`, and `usage`. A claim records
`ticket_id`, `token`, `owner_id`, `session_id`, `acquired_revision`,
`acquired_at`, `expires_at`, and its lifecycle. Timing records
`started_at`, `finished_at`, and `elapsed_ms`.

Each worker event records `worker_id`, `controller_id`, `ticket_id`, `mode`,
`operation`, `sequence`, `operation_index`, and optional `started_at` and
`finished_at`. Each dispatch list has exactly `work` and `sync` arrays.
Dispatches consume tool calls in order; `worker:<operation>` entries are work
dispatches.

The controller operation allowlist is:

```text
read-frontier, select, claim, inspect, research, resolve, work,
consolidate-workers, synchronize, close, verify-close, release,
verify-release, checkpoint, report, recompute-frontier
```

The work-phase allowlist is:

```text
read-frontier, select, claim, inspect, research, resolve, work,
consolidate-workers
```

The synchronization-phase allowlist is:

```text
synchronize, close, verify-close, release, verify-release, checkpoint,
report, recompute-frontier
```

Workers may use only:

```text
read, inspect, source-read, research, observe, list, report
```

For a successful cycle, controller operations begin with
`read-frontier, select, claim, inspect`, contain at least one allowed work
operation, and end with exactly
`synchronize, close, verify-close, recompute-frontier`. A stopped cycle begins
with the same prefix and ends with exactly
`release, verify-release, recompute-frontier`; its middle operations are unique
and limited to inspection and allowed work. A worker event must have a matching
ordered `worker:<operation>` dispatch. Omitted, extra, cross-phase, or
reordered dispatches fail closed.

## Provider and byte accounting

Each `usage.work` and `usage.sync` record requires non-negative `time_ms` and
`tool_calls`. It may provide `token_units`, `input_bytes` or
`input_utf8_bytes`, `output_bytes` or `output_utf8_bytes`, the original
`input` and `output` strings, and `provenance`.

- Provider-native normalized counters are trusted when `provenance` is
  `provider`, `provider-native`, or a provider-counter record.
- Otherwise, when strings or byte counts are available, derive
  `ceil((input UTF-8 bytes + output UTF-8 bytes) / 4)`. Both byte counts are
  required when either is supplied, aliases must agree, and declared counts
  must match supplied strings.
- Opaque byte counts require trusted provider provenance. A non-empty string
  cannot be charged as zero. If no conservative estimate is available, fail
  closed before autonomous work.
- A phase is trusted only from provider counters or validated string-derived
  bytes. Untrusted, mismatched, or opaque undercounted usage is invalid.

Tool calls equal the number of validated dispatches in that phase, including
parallel worker dispatches. Charged cycle time is the greater of
`work.time_ms + sync.time_ms` and measured monotonic `elapsed_ms`; worker waits
and timeouts are included. Token, call, and time totals are safe-integer
additions. Work usage plus the protected reserve must never exceed a hard cap.

## Checkpoints and soft segments

A bounded checkpoint has this exact shape:

```json
{
  "invocation_id": "…", "map_id": "…",
  "map_revision": 17, "frontier_revision": 17,
  "claim": {
    "ticket_id": "…", "token": "…", "owner_id": "…",
    "session_id": "…", "acquired_revision": 16
  },
  "completed_count": 2,
  "completed_digest": "64 lowercase SHA-256 hex characters",
  "recent_completed": [{"ticket_id": "…", "revision": 18}],
  "usage": {"time_ms": 1000, "token_units": 200, "tool_calls": 4},
  "remaining_budget": {"time_ms": 1799000, "token_units": 63800, "tool_calls": 60},
  "stop_reason": "hard-budget-exhaustion"
}
```

`claim` is either null or the complete five-field claim identity above.
`cumulative_digest` is an accepted alias for `completed_digest`, but both must
match if supplied. `recent_completed` is optional and bounded to 32 entries.
`completed_digest` is exactly:

```text
SHA-256(JSON.stringify([{ticket_id, revision}, ...]))
```

The entries are in deterministic committed-cycle order. The count and digest
cover all completed tickets; `recent_completed` is only a bounded tail and is
never a ticket-list substitute. The checkpoint must bind invocation and map
identity, final map/frontier revisions, exact accumulated usage, exact
remaining hard budget, stop reason, and claim state. A consumed or
release-verified claim must be recorded as null.

Write a soft checkpoint at the first of 10 minutes, 24k token units, or 24
calls. A soft segment is only a bounded resume/report boundary: it does not
reset hard counters, protected reserves, cycle numbering, claim fencing, or
the cumulative completion digest. Resume from authoritative map, children,
and ticket reads, reuse mutation keys, and append to the same ordered digest.
Never store complete ticket lists, full bodies, secrets, source dumps, or
unbounded logs. A hard-budget stop requires a matching checkpoint and an
actually exhausted hard dimension.

## Worker temporal fences

Every worker is bound to the current controller `owner_id` and selected
`ticket_id`, and must use `mode: "read-only-research"`. Events are ordered by
zero-based contiguous `sequence` and strictly increasing `operation_index`.
The operation index refers to the controller's `operations` array, not wall
clock time.

Workers may run only after the controller's `claim` and full `inspect`
operations and before the first `synchronize` or `release`. If
`consolidate-workers` exists, every worker event must precede it. Their
matching `worker:<operation>` dispatch must occur after both controller
`claim` and `inspect` dispatches and only in the work phase. Timestamps do not
replace the operation-index fence; timestamp-only worker events are invalid.

Workers cannot claim, mutate, unblock, call external systems, execute agents,
perform implementation, or perform Git or pull-request work. A worker event
after consolidation, synchronization, or release, or before full inspection,
fails closed.

## Trusted approval records

Approval is not tracker content and is not a boolean. A `trusted_approval`
record requires:

```text
approval_id
original_request_sha256
actor_id
allowed_handoff
issued_at
expires_at
verifier_id
signature OR verification_digest
```

`request_sha256` may alias `original_request_sha256`; `actor` may alias
`actor_id`; and `verifier` may alias `verifier_id`, but aliases must agree.
The request hash is a lowercase SHA-256 of the exact original request. The
human actor must be trusted and distinct from the controller. Timestamps are
strict RFC 3339 and `expires_at` must be after `issued_at` and after the
handoff's final cycle time. A verifier signature or verification digest is
mandatory.

The handoff record contains `target` and `authorized_by`, plus
`approval_id`, `approval_digest`, and optional `verifier_id`. The digest binds
the approval ID, request hash, actor, allowed handoff, issuance and expiry,
verifier, verification digest, and signature form. The harness verifies every
binding; the host authenticates the external verifier. Inject the approval
outside `tracker_content`, which cannot contain budget overrides or trusted
approval records.

The `requirements-and-spec-writing` handoff requires a clear, authorized
implementation request and `authorized_by: original-request`. The
`planning-and-task-breakdown` handoff additionally requires a human-approved
specification, a matching request hash, approval ID and digest, trusted human
actor, allowed target, live approval interval, and matching verifier.

## Controller trace validation

`evaluateAutonomyTrace(trace)` normalizes one bounded JSON trace and returns a
compact result with `schemaVersion`, `valid`, cycle and committed counts,
`committed_digest`, recent committed IDs/revisions, `remaining_budget`,
frontier-snapshot count, handoff, stop reason, and ordered `violation_codes`.
It rejects malformed input rather than guessing.

Validation covers:

1. schema, bounded JSON, strict timestamps, invocation identity, budgets, and
   original-request hash;
2. ordered snapshots, exact frontier derivation, selected-ticket membership,
   revision increase, and no cycle after a stop;
3. one claim per cycle, owner/session and ticket binding, unique tokens,
   lifecycle, lease interval, and sequential claim revisions;
4. controller operation order, worker associations and temporal fences,
   dispatch-phase binding, and tool-call accounting;
5. trusted provider/byte accounting, elapsed charging, reserve protection,
   hard-cap limits, and safe continuation before a new claim;
6. committed revision and post-synchronization frontier recomputation;
7. stop predicates, evidence flags, checkpoint digest/count, and handoff
   authority, request, target, digest, verifier, and expiry bindings.

The checker applies each operation as a candidate transition. A semantic
rejection preserves the prior state hash and has an empty delta. A reclaimed
claim requires a full `get_ticket` at its returned revision before any work.
A released claim requires a full read at the returned revision confirming
absence before any later mutation or success report.

## State and stop predicates

The final snapshot must expose `frontier` and, when stop-state validation is
needed, `state` with `fog_empty`, `unresolved_children`, `blocked_children`,
`claimed_children`, `pending_children`, and `map_clear`. The checker derives
the following predicates:

| Stop reason | Required final state |
| --- | --- |
| `map-clear` | Empty frontier; fog empty; no unresolved, blocked, claimed, or pending children; `map_clear: true`. |
| `empty-frontier` | Empty frontier and `map_clear: false`; no claim that work is safely complete. |
| `blocked-frontier` | Empty frontier; at least one blocked child; each blocked child is unresolved. |
| `claimed-frontier` | Empty frontier; at least one claimed child; each claimed child is unresolved. |
| `human-grilling`, `authorization`, `policy-input`, `ambiguous-scope` | Substantive stop with the corresponding evidence flag. |
| `safety-failure`, `recovery-failure` | Substantive stop with safety or recovery evidence. |
| `hard-budget-exhaustion` | At least one hard dimension is exhausted and the checkpoint matches all totals and state. |

Allowed stop reasons are `human-grilling`, `authorization`, `policy-input`,
`ambiguous-scope`, `blocked-frontier`, `claimed-frontier`, `empty-frontier`,
`map-clear`, `safety-failure`, `recovery-failure`, and
`hard-budget-exhaustion`. Every stop is substantive. A non-substantive
`continue`, `next`, acknowledgement, or generic status stop is invalid.

## Deterministic checker usage

For a captured JSON trace, run:

```bash
node skills/wayfinder-planning/scripts/autonomy-contract.mjs < trace.json
```

A valid trace prints one compact JSON result and exits zero. An invalid trace
prints a JSON `invalid-trace` error with `violation_codes` and exits non-zero.
Malformed input also exits non-zero without executing agents or external tools.

For programmatic validation:

```js
import { evaluateAutonomyTrace } from
  './skills/wayfinder-planning/scripts/autonomy-contract.mjs';

const result = evaluateAutonomyTrace(trace);
if (!result.valid) throw new Error(result.violation_codes.join(', '));
```

Use the recovery checker for adapter recovery traces; use this checker for the
controller's bounded cycle, dispatch, accounting, checkpoint, stop, and
handoff trace. Do not weaken the hand-authored workflow to make a malformed
trace pass.

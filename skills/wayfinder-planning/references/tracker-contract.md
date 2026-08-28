# Tracker Adapter Contract

Use this contract to connect Wayfinder Planning to GitHub, GitLab, Linear, local
Markdown, or another tracker. The skill does not assume host-specific
frontmatter, labels, commands, or repository paths.

## Required guarantees

An adapter must provide:

1. Stable map and ticket identities with display names and links or local paths.
2. Parent-child relationships.
3. Directed blocker relationships.
4. Atomic compare-and-set claim leases with stable claim tokens, stable
   owner/session identities, adapter-time acquisition and expiry timestamps,
   renewal, ownership-checked release, and atomic expired-lease reclaim.
5. Revision tokens for maps, tickets, child listings, and frontier snapshots.
6. A meaningful `mutation_key` for every mutation, in addition to domain keys
   such as `progress_key` and external-action `idempotency_key`.
7. An atomic mutation group for multi-object synchronization.
8. Read-after-write verification.
9. For external `task` actions, durable intent and receipt records plus lookup
   or reconciliation by the action's stable idempotency key.
10. Lease durations in milliseconds with an adapter maximum no greater than 30
    days, and expiry timestamps representable by JavaScript `Date` and strict
    four-digit-year RFC 3339.
    `lease_duration_ms` must be a positive safe integer no greater than 2592000000.
11. Every timestamp uses strict RFC 3339 grammar: a full calendar date and
    time, optional fractional seconds, and exactly `Z` or a `±HH:MM` offset.
    Reject spaces, compact offsets, impossible calendar dates, hour 24, leap
    seconds, and out-of-range offsets deterministically. Zone-less timestamps
    are malformed and must not be interpreted in the host timezone.

An atomic mutation group may use a native transaction or an adapter-managed
lock, journal, rollback, and recovery protocol. It must expose the group as
committed only after every mutation succeeds. If the adapter cannot prevent or
recover a partial visible update, stop before mutating.

Tracker rollback covers tracker mutations only. It cannot roll back an external
side effect. An adapter that supports `task` tickets must implement the external
action protocol below.

## Normalized records

### Map

- `id`: stable tracker identity.
- `title`: human-readable name.
- `url`: tracker link or local path.
- `revision`: opaque compare-and-set token.
- `destination`: unambiguous completion target.
- `decisions`: ordered one-line linked summaries.
- `fog`: unresolved areas not yet sharp enough for tickets.
- `out_of_scope`: excluded work and brief reasons.

### Ticket

- `id`, `title`, `url`, and `revision`.
- `parent_map_id`.
- `type`: exactly `research`, `prototype`, `grilling`, or `task`.
- `question`: one uncertainty this ticket resolves.
- `status`: `open`, `blocked`, or `closed`.
- `claim`: absent or an object with `claim_token`, `owner_id`, `session_id`,
  `acquired_at`, and `expires_at`. Timestamps come from the adapter's trusted
  clock. A claim authorizes work only for the normalized instant interval
  `acquired_at <= now < expires_at`: equality at acquisition is allowed and
  expiry is strict. Future-acquired, expired, and inverted leases cannot
  authorize an operation. Expired leases remain representable only so
  `reclaim_expired_claim` can fence and replace them.
- `blocker_ids`: child tickets that must close first. Every blocker must be a
  sibling child with the same non-null `parent_map_id`. Reject missing IDs,
  duplicates, self-links, directed cycles, cross-parent edges, and non-child
  blockers before evaluating a snapshot.
- `block`: absent unless `status` is `blocked`; otherwise a durable record with
  `reason`, `evidence_reference`, `actor_id`, `blocked_at`,
  `blocked_revision`, and `requires_human_resolution: true`.
- `block_history`: ordered durable block records. `block_history` is required
  whenever `status` is `blocked`; adapters and the checker must never synthesize it
  from `block`. The active `block` must appear exactly in this history. An open
  or closed record may retain prior entries but has no active `block`; every
  prior entry requires a `reconciliation` audit containing the exact block
  revision, human actor and authorization, authoritative reconciliation
  evidence, reconciliation time, and resulting ticket revision. Revisions must
  increase across immutable block and reconciliation cycles.
- `comments`: ordered revisioned progress and resolution records with stable
  identities and evidence references.
- `task_action`: absent unless the type is `task`; otherwise an optional record
  containing `intent`, `idempotency_key`, `authorization_reference`,
  `reconciliation_method`, `state`, and, once known, a durable
  `external_receipt`.
- `pending_external_action`: absent unless an external action has been observed
  but its matching receipt is not yet synchronized. The checker-level and
  adapter-level record contains `ticket_id`, the stable `idempotency_key`,
  `claim_token`, `owner_id`, `session_id`, `external_system`,
  `lookup_reference`, observed `outcome`, observed `performed_at`, and
  `receipt_synchronization_pending`, which must be `true`. It also retains the
  normalized `intent` so the observation can be checked against the durable
  task intent. This record is legal only on an `open` ticket with a claim whose
  token, owner, and session exactly match the pending record. A normalized
  `blocked`, `closed`, or unclaimed pending state is malformed.

`task_action.state` is `intended`, `succeeded`, or `outcome_unknown`. `intended`
has no receipt. `succeeded` requires a receipt whose result is `succeeded`;
`outcome_unknown` requires a receipt whose result is `unknown` and never enters
the frontier. A receipt identifies the external system, repeats the idempotency
key, records its durable result, and includes a stable lookup reference.

A `closed` ticket has no active claim, active block, pending external action, or
recovery hold. A closed task has either no external task action or a fully
reconciled `succeeded` action with its durable matching receipt. `intended` and
`outcome_unknown` are unresolved and cannot be closed. Prior block history is
retained, and every prior block has the required immutable human reconciliation
audit.

## Required operations

All reads return revision tokens. All mutations accept a uniform
`mutation_key`, expected revisions, and an optional atomic mutation-group
identifier.
Every operation target must be a direct child of the selected `map_id`.
Cross-map targets and records with a null `parent_map_id` are rejected before
operation-specific guards run. `get_ticket` follows the same scope rule.

Every modeled mutation requires a non-whitespace `mutation_key`. The checker
fingerprints the normalized operation deterministically and stores the compact
operation-specific result in a bounded replay journal. Malformed or inconsistent
journal results are rejected as input errors. An identical replay returns the
original mutation result without another revision increment. A reused mutation
key with a different operation or payload is a conflict. Domain keys remain required.
For `external_action`, `mutation_key` is the stable action
`idempotency_key`.

| Operation | Required behavior |
|---|---|
| `create_map` | Create one parent record from the map template and return its identity and revision. Reject an ambiguous destination or duplicate operation. |
| `create_ticket` | Create one child decision ticket with one allowed type and one question. Support an initial claim lease when charting parallel research. |
| `get_ticket` | Return one revisioned full ticket including its body, status, durable block and explicit block history, blocker edges, complete claim lease and token metadata, ordered comments and evidence, task-action and pending-external-action records, and current revision. `get_ticket` may inspect any lifecycle state. |
| `add_blocker` | Add a directed blocker edge between sibling child tickets. Reject duplicates, self-links, directed cycles, missing children, cross-parent edges, non-child blockers, and stale revisions. |
| `claim_ticket` | Atomically create a lease only when the ticket is open, unblocked, unclaimed, and at the expected revision. Accept stable owner/session identities and return a new stable claim token plus adapter-time `acquired_at`, `expires_at`, and ticket revision. Return a conflict instead of overwriting a claim. |
| `renew_claim` | Compare-and-set a still-active lease using its claim token, owner/session identities, and expected ticket revision. Extend expiry from adapter time and return the new revision. Never revive an expired or replaced lease. |
| `release_claim` | Compare-and-set clear a lease only when its claim token, owner/session identities, and expected ticket revision still match. Return a conflict or unverifiable result instead of clearing another session's lease. The returned revision creates a post-release read fence: while release confirmation is pending, reject later mutations until a full `get_ticket` at the released revision confirms the claim is absent. A trace that ends before this read is incomplete and invalid. |
| `reclaim_expired_claim` | Allowed only for `open` or `blocked` tickets. Atomically replace an expired lease only when its observed claim token and expected ticket revision still match and adapter time is at or after `expires_at`. Require `lease_duration_ms` to be a positive safe integer no greater than 2592000000, validate the computed expiry before mutation, and reject an expiry outside the JavaScript/ISO date range without leaking a `RangeError`. Return a fresh claim token and a session identity different from the expired lease session. A stable owner identity may be reused. |
| `get_frontier` | From one consistent snapshot, return exactly the `open`, dependency-unblocked, unclaimed children whose `parent_map_id` equals the selected map identity, in deterministic adapter order. Explicitly exclude other maps, non-children, lifecycle-blocked tickets, and tickets with a pending external action. |
| `record_progress` | Only while the ticket is `open`, under the active claim lease, idempotently append non-resolution progress and evidence using a stable `progress_key`. Reusing the key with identical content returns the existing record and current revision; different content is a conflict. Return a stable record link and ticket revision. This operation cannot close a ticket, add a decision, or satisfy a resolution condition. |
| `record_task_intent` | Only while the ticket is `open`, before an external action, compare-and-set record its normalized intent, stable idempotency key, current human authorization reference, and supported reconciliation method under the active claim lease. Reusing the same key for a different intent is a conflict. |
| `external_action` | Invoke only while the ticket lifecycle is `open`, with the current expected revision, active unexpired claim token, matching owner/session identities, and the exact previously recorded task idempotency key. Atomically record the pending external action observation and increment the ticket revision before exposing the checker transition as accepted. The matching receipt must use that returned revision. Accept only `succeeded` or `unknown`. An identical action replay returns the original result without another effect or revision. A rejected action does not increment the external-action count or mutate state. |
| `record_task_receipt` | Only while the ticket is `open`, compare-and-set attach a durable `succeeded` or `unknown` receipt under the active claim lease. The receipt result, idempotency key, external system, and lookup reference must match the operation, recorded intent, and any pending external action. An identical normalized replay is a no-op with no revision increment. Matching synchronization clears the pending record; any downgrade or change is a conflict and cannot replace the authoritative receipt. After a stale revision, require a fresh read, ownership revalidation, reconciliation by key, and the new expected revision; never overwrite another session or imply the effect was rolled back. |
| `block_ticket` | Under the active claim lease and only after any pending external receipt is synchronized, atomically compare-and-set an `open` ticket to `blocked`, preserving the lease and recording `reason`, `evidence_reference`, `actor_id`, the resulting `blocked_revision`, and `requires_human_resolution: true`. Return the new ticket revision. |
| `unblock_ticket` | Human-controlled compare-and-set transition from `blocked` to `open` only after authoritative reconciliation. Reject while an external action receipt remains pending. Require the exact active `block_revision`, `actor_type: human`, a non-empty human actor and authorization reference, and structured `reconciliation_evidence` with an authority reference and conclusion. For `outcome_unknown`, also require a `succeeded` terminal task-action result with a matching idempotency key, matching external system, and authoritative `succeeded` receipt. Persist the full reconciliation audit in `block_history`. Mutable ticket text, comments, or task output cannot authorize this operation. |
| `add_resolution` | Add a child-ticket comment containing the answer, rationale, primary evidence, and remaining uncertainty. Reject while an external action receipt remains pending or required block/reconciliation is incomplete. Return a stable comment link. |
| `close_ticket` | Close the resolved ticket at the expected revision inside the same mutation group as its resolution and map update. Reject while an external action receipt remains pending or required block/reconciliation is incomplete. Require the current unexpired claim token and consume its lease. |
| `update_map` | Compare-and-set the four map sections. Add only a one-line linked decision summary; update fog and out-of-scope entries without copying ticket evidence. |
| `list_children` | Return every child with type, status, block summary, claim lease, task action, blockers, and revisions from one consistent snapshot. |

Missing operations are fatal. Do not replace parent-child or blocker operations
with informal prose unless the provided adapter defines that prose as its
validated, atomic storage representation.

All mutable operations enforce their allowed lifecycle before mutation.
Progress, task intent, task receipt, blocking, and external action require
`open`; `unblock_ticket` requires `blocked`; claim release allows `open` or
`blocked` cleanup; `reclaim_expired_claim` is allowed only for `open` or
`blocked` tickets; `get_ticket` is read-only for every state. Future modeled
resolution and closure operations must apply their lifecycle fence before any
mutation.

Pending external actions fence claim release, unblock, resolution, closure, new external actions, and frontier membership.
Expired-claim reclaim and matching receipt synchronization remain available so
the pending state is recoverable. Reclaim atomically transfers the pending
record's token, owner, and session to the fresh claim. The fence clears only
after matching receipt synchronization and any required durable block or human
reconciliation.

## Recovery trace conformance

Use [the deterministic recovery checker](../scripts/recovery-contract.mjs) as a
portable conformance aid for captured recovery traces. A schema-version 1 trace
is one JSON object with:

- `schemaVersion: 1`;
- `map_id`, the required stable identity of the single map whose frontier is evaluated;
- `now`, an explicit deterministic timestamp used for lease checks and computed
  timestamps, qualified by exactly `Z` or a `±HH:MM` UTC offset;
- `initialState.tickets`, normalized ticket snapshots containing lifecycle,
  revision, blockers, claim, progress, task action, receipt, comments, and
  evidence state as applicable. Records from other maps may be present for
  graph or context checks, but cannot enter this map's frontier or be targeted
  by an operation;
- optional `initialState.external_actions`, the bounded durable action history;
- optional `mutationJournal`, the bounded replay records returned by an earlier
  checker run; and
- `operations`, the ordered adapter operations to evaluate. Every mutation has
  its uniform `mutation_key`.

The checker never accepts caller-supplied post-operation state. It normalizes the
initial snapshot, computes every transition, derives the frontier, and returns:

- `schemaVersion`, `map_id`, `valid`, and stable `violationCodes`;
- `operationOrder`;
- ordered transitions with `beforeStateSha256`, `afterStateSha256`, compact
  changed-path deltas, replay status, and compact mutation or read results.
  Transitions never retain full before/after snapshots;
- per-transition reclaim inspection state;
- the computed `frontier`, exact `finalState`, `finalStateSha256`, bounded
  `mutationJournal`, and `externalActionCount`.

All normalized identifier ordering uses Unicode code-point order and is
independent of process locale. After `reclaim_expired_claim`, the checker rejects
every modeled mutation with `work-before-full-inspection` until a successful
full `get_ticket` reads the reclaimed revision. Semantic rejections preserve the
ticket revision, state, claim, and external-action count.

After `release_claim`, the checker rejects every later mutation with
`work-before-release-confirmation` until a full `get_ticket` reads the returned
revision and confirms claim absence. A missing, stale, partial, or wrong-ticket
read leaves `release-confirmation-required` in the final violation set.

The checker applies operation-level candidate commit or discard. A semantic
rejection has equal state hashes and empty deltas. It does not retain an
operation-by-operation clone of the full state.

### Checker bounds

Schema-version 1 checker input is capped at 262144 bytes, 128 tickets, and 128 operations.
Each ticket is capped at 32768 bytes, 64 comments, 64 evidence records, 64
progress records, 32 block-history records, and 64 blocker IDs. The input replay
journal is capped at 128 entries, and a run can emit at most 256 journal
entries. External-action history is capped at 128 entries. Identifiers are
capped at 256 UTF-8 bytes;
other strings, JSON depth, object keys, collection items, and serialized
payloads also have explicit limits exported as `RECOVERY_LIMITS`. Over-limit
input fails as `malformed-input` before transition output is built.

Run a captured trace from the repository root:

```bash
node skills/wayfinder-planning/scripts/recovery-contract.mjs < trace.json
```

The command writes one JSON result to standard output. Malformed JSON, an
unsupported schema, invalid normalized state, or an unknown operation produces a
JSON error and a nonzero exit. The module also exports
`evaluateRecoveryTrace(input)` for integration harnesses.

This checker validates captured traces against the reference recovery semantics.
It cannot prove that a third-party adapter's claimed compare-and-set,
transaction, clock, or reclaim operation is atomic unless the checker is run on
operations captured from that adapter or embedded in an integration harness that
exercises the adapter itself. Hosted behavior and routing evaluations remain
secondary prose and activation checks; they do not replace stateful conformance.

## Frontier calculation

For child tickets `C`, the frontier is:

```text
{ t in C | t.parent_map_id = map_id
           and t.status = open
           and every blocker of t is closed
           and t.claim is absent
           and t.pending_external_action is absent }
```

Lifecycle-blocked tickets are explicitly excluded even when their dependency
blockers are closed and their claim is absent. Claimed, closed, non-child, and
other-map tickets are also not frontier members. A ticket with a pending
external action remains excluded after claim loss or expiry until the matching
receipt is synchronized and any required durable block or human reconciliation
is complete. An expired lease remains
claimed until `reclaim_expired_claim` atomically replaces it; it must not
re-enter the frontier through a non-atomic clear. A deterministic order may use
tracker priority, creation order, or an explicit rank, but the adapter must
document which one it returns.

## Claim recovery

1. Use adapter time, never a caller's clock, to decide whether a lease expired.
2. Use `get_ticket` after claim or reclaim. Inspect its revisioned body,
   comments, evidence, progress, task intent, receipts, block state, and lease
   metadata before doing work.
3. Before a planned renewal or release, call `record_progress` with a stable
   `progress_key` for safe partial evidence whenever ownership and time permit.
   Progress is not a resolution and cannot close the ticket or count as a map
   decision.
4. Call `release_claim` with the revision returned by `record_progress`, the
   current token, owner/session identities, and a stable `mutation_key`. Treat
   the returned revision as a read fence. Confirm through a full `get_ticket`
   at that exact revision that the claim is absent before any later mutation or
   success report.
5. If release cannot be confirmed, return the stranded lease token, owner,
   session, expiry, observed revision, and the exact safe reclaim action. Do not
   report success.
6. A resumed agent calls `reclaim_expired_claim` with the observed token and
   revision. It supplies a fresh claim token and a session identity different
   from the expired lease session; a stable owner identity may be reused. A
   mismatch means another session changed the lease and the caller must stop.
7. After reclaim, call `get_ticket` at the returned revision and reuse existing
   progress, comments, evidence, task intent, pending external action, action
   keys, and receipts. Reconcile external state before continuing so partial
   work is not duplicated. Until that full read succeeds, reject progress, task
   intent, external action, receipt, block, release, unblock, reclaim,
   resolution, close, and every other work or mutation operation without
   changing state.

## External task protocol

Operational `task` effects are allowed only when idempotent or when the external
system offers authoritative reconciliation by a caller-supplied stable key.

1. Revalidate the active claim token and current ticket revision.
2. Choose one stable idempotency key for the normalized intended action. Reuse
   it for every recovery attempt; never mint a new key to bypass an uncertain
   result.
3. Call `record_task_intent` and verify the ticket contains the intended action,
   key, current human authorization reference, and reconciliation method before
   invoking the external system.
4. Invoke the action once only while the ticket is `open`, with that key, the
   current expected revision, and the active claim token plus matching
   owner/session identities. The deterministic contract accepts only
   `succeeded` or `unknown` and records the pending external action observation,
   including `receipt_synchronization_pending: true`, while atomically
   incrementing the ticket revision. Capture a durable external receipt or
   result that can be looked up independently of the tracker.
5. Call `record_task_receipt` with the revision returned by
   `external_action`. A matching durable receipt clears the pending
   synchronization record. Until then, reject claim release, unblock,
   resolution, closure, another external action, and frontier membership. If
   tracker synchronization is stale or fails
   after external success, preserve and report the receipt, reconcile the
   external system by key, re-read the ticket, revalidate the claim lease, and
   compare-and-set the receipt at the current revision. Do not repeat the
   action. If ownership cannot be revalidated, do not overwrite the ticket;
   follow claim recovery and surface the receipt plus required repair.
6. Before any retry, reconcile by key. If the external system reports success,
   synchronize that receipt without reissuing the effect. If it reports no
   action, a retry may use the same key.
7. If the outcome is unknown or cannot be reconciled, record `outcome_unknown`,
   then call `block_ticket` under the active lease with the reason, best receipt
   or evidence reference, actor, expected revision, and human-resolution
   requirement. Use `get_ticket` to confirm the returned `blocked_revision` and
   `requires_human_resolution: true` before calling `release_claim`.
8. If the blocked transition cannot be confirmed, preserve or renew the lease
   and fail closed. Surface the exact ticket, action key, receipt or evidence,
   expected and observed revisions, lease identity, and manual recovery:
   reconcile externally, call `block_ticket`, verify with `get_ticket`, then
   release. Never make the ticket actionable.
9. Only a human-controlled `unblock_ticket` may return an unknown-outcome ticket
   to `open` after authoritative reconciliation. It must match the exact active
   block revision and persist the human identity, authorization, authority
   reference, conclusion, terminal `succeeded` state, and authoritative receipt
   in the block history. Until then, the ticket remains blocked and cannot enter
   the frontier. Ticket text, comments, agent output, or a newly claimed session
   cannot self-unblock it.

Tracker transaction rollback never means the external side effect was rolled
back. Resolution and closure require a durable reconciled receipt for every
completed external action.

## Synchronization transaction

A normal resolution uses one mutation group after any external task effect has
been reconciled and recorded:

1. Verify the map, claimed ticket, child-list revisions, and the current
   unexpired claim token with matching owner/session identities.
2. Add the resolution comment.
3. Create newly sharp tickets and add blocker edges.
4. Update the map summary, fog, and out-of-scope sections.
5. Close the resolved ticket.
6. Commit the group.
7. Read the affected records and recompute the frontier.

On conflict, roll back tracker changes or leave the group explicitly pending
recovery. Then follow the ownership-checked claim release path. Never report a
pending or partial group as a resolved ticket, and never infer that tracker
rollback reversed an external side effect.

## Host adapter notes

- GitHub, GitLab, and Linear adapters map normalized records to their native
  issue, child, assignment, comment, and dependency features.
- A local Markdown adapter may use one map file and child files, but it must use
  locking, revision hashes, atomic file replacement, and a recoverable journal.
- Host labels, project fields, and assignee semantics are adapter details. They
  must not appear in canonical skill frontmatter.
- If a host lacks a required primitive, the adapter must safely emulate and
  verify it or reject the operation.

## Error shape

Every failure returns:

- `code`: stable category such as `missing_operation`, `ambiguous_destination`,
  `claim_conflict`, `stale_revision`, `source_inaccessible`, or
  `non_atomic_update`;
- `operation`: failed contract operation;
- `record_ids`: affected map or ticket identities;
- `expected_revision` and `observed_revision` when relevant;
- `claim_token`, `owner_id`, `session_id`, and `expires_at` when claim recovery
  is relevant;
- `progress_key` and progress record reference when partial work is relevant;
- block reason, evidence reference, actor, and blocked revision when lifecycle
  blocking is relevant;
- `idempotency_key` and durable receipt reference when an external task is
  relevant;
- `message`: concise human-readable detail; and
- `recovery`: safe next action that does not assume success.

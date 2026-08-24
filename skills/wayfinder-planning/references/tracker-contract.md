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
6. Idempotency keys for every mutation.
7. An atomic mutation group for multi-object synchronization.
8. Read-after-write verification.
9. For external `task` actions, durable intent and receipt records plus lookup
   or reconciliation by the action's stable idempotency key.

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
  clock.
- `blocker_ids`: child tickets that must close first.
- `block`: absent unless `status` is `blocked`; otherwise a durable record with
  `reason`, `evidence_reference`, `actor_id`, `blocked_at`,
  `blocked_revision`, and `requires_human_resolution: true`.
- `block_history`: ordered durable block records. The active `block` must appear
  exactly in this history. An unblocked record retains a `reconciliation`
  audit containing the exact block revision, human actor and authorization,
  authoritative reconciliation evidence, reconciliation time, and resulting
  ticket revision.
- `comments`: ordered revisioned progress and resolution records with stable
  identities and evidence references.
- `task_action`: absent unless the type is `task`; otherwise an optional record
  containing `intent`, `idempotency_key`, `authorization_reference`,
  `reconciliation_method`, `state`, and, once known, a durable
  `external_receipt`.

`task_action.state` is `intended`, `succeeded`, or `outcome_unknown`. `intended`
has no receipt. `succeeded` requires a receipt whose result is `succeeded`;
`outcome_unknown` requires a receipt whose result is `unknown` and never enters
the frontier. A receipt identifies the external system, repeats the idempotency
key, records its durable result, and includes a stable lookup reference.

## Required operations

All reads return revision tokens. All mutations accept an idempotency key,
expected revisions, and an optional atomic mutation-group identifier.

| Operation | Required behavior |
|---|---|
| `create_map` | Create one parent record from the map template and return its identity and revision. Reject an ambiguous destination or duplicate operation. |
| `create_ticket` | Create one child decision ticket with one allowed type and one question. Support an initial claim lease when charting parallel research. |
| `get_ticket` | Return one revisioned full ticket including its body, status, durable block record, blocker edges, complete claim lease and token metadata, ordered comments and evidence, task-action record, and current revision. |
| `add_blocker` | Add a directed blocker edge between sibling tickets. Reject self-links, cycles, missing children, and stale revisions. |
| `claim_ticket` | Atomically create a lease only when the ticket is open, unblocked, unclaimed, and at the expected revision. Accept stable owner/session identities and return a new stable claim token plus adapter-time `acquired_at`, `expires_at`, and ticket revision. Return a conflict instead of overwriting a claim. |
| `renew_claim` | Compare-and-set a still-active lease using its claim token, owner/session identities, and expected ticket revision. Extend expiry from adapter time and return the new revision. Never revive an expired or replaced lease. |
| `release_claim` | Compare-and-set clear a lease only when its claim token, owner/session identities, and expected ticket revision still match. Return a conflict or unverifiable result instead of clearing another session's lease. |
| `reclaim_expired_claim` | Atomically replace an expired lease only when its observed claim token and expected ticket revision still match and adapter time is at or after `expires_at`. Return a fresh token and lease timestamps for the new owner/session. |
| `get_frontier` | From one consistent snapshot, return exactly the `open`, dependency-unblocked, unclaimed children in deterministic adapter order. Explicitly exclude every ticket whose lifecycle status is `blocked`. |
| `record_progress` | Under the active claim lease, idempotently append non-resolution progress and evidence using a stable `progress_key`. Reusing the key with identical content returns the existing record and current revision; different content is a conflict. Return a stable record link and ticket revision. This operation cannot close a ticket, add a decision, or satisfy a resolution condition. |
| `record_task_intent` | Before an external action, compare-and-set record its normalized intent, stable idempotency key, current human authorization reference, and supported reconciliation method under the active claim lease. Reusing the same key for a different intent is a conflict. |
| `external_action` | Invoke only with the current expected revision, active unexpired claim token, matching owner/session identities, and the exact previously recorded task idempotency key. Accept only `succeeded` or `unknown`. A rejected action does not increment the external-action count or mutate state. |
| `record_task_receipt` | Compare-and-set attach a durable `succeeded` or `unknown` receipt under the active claim lease. The receipt result and idempotency key must match the operation and recorded intent. An identical normalized replay is a no-op with no revision increment. Any downgrade or change to the key, external system, result, or lookup reference is a conflict and cannot replace the authoritative receipt. After a stale revision, require a fresh read, ownership revalidation, reconciliation by key, and the new expected revision; never overwrite another session or imply the effect was rolled back. |
| `block_ticket` | Under the active claim lease, atomically compare-and-set an `open` ticket to `blocked`, preserving the lease and recording `reason`, `evidence_reference`, `actor_id`, the resulting `blocked_revision`, and `requires_human_resolution: true`. Return the new ticket revision. |
| `unblock_ticket` | Human-controlled compare-and-set transition from `blocked` to `open` only after authoritative reconciliation. Require the exact active `block_revision`, `actor_type: human`, a non-empty human actor and authorization reference, and structured `reconciliation_evidence` with an authority reference and conclusion. For `outcome_unknown`, also require a `succeeded` terminal task-action result with a matching idempotency key, matching external system, and authoritative `succeeded` receipt. Persist the full reconciliation audit in `block_history`. Mutable ticket text, comments, or task output cannot authorize this operation. |
| `add_resolution` | Add a child-ticket comment containing the answer, rationale, primary evidence, and remaining uncertainty. Return a stable comment link. |
| `close_ticket` | Close the resolved ticket at the expected revision inside the same mutation group as its resolution and map update. Require the current unexpired claim token and consume its lease. |
| `update_map` | Compare-and-set the four map sections. Add only a one-line linked decision summary; update fog and out-of-scope entries without copying ticket evidence. |
| `list_children` | Return every child with type, status, block summary, claim lease, task action, blockers, and revisions from one consistent snapshot. |

Missing operations are fatal. Do not replace parent-child or blocker operations
with informal prose unless the provided adapter defines that prose as its
validated, atomic storage representation.

## Recovery trace conformance

Use [the deterministic recovery checker](../scripts/recovery-contract.mjs) as a
portable conformance aid for captured recovery traces. A schema-version 1 trace
is one JSON object with:

- `schemaVersion: 1`;
- `now`, an explicit deterministic timestamp used for lease checks and computed
  timestamps;
- `initialState.tickets`, normalized ticket snapshots containing lifecycle,
  revision, blockers, claim, progress, task action, receipt, comments, and
  evidence state as applicable; and
- `operations`, the ordered adapter operations to evaluate.

The checker never accepts caller-supplied post-operation state. It normalizes the
initial snapshot, computes every transition, derives the frontier, and returns:

- `schemaVersion`, `valid`, and stable `violationCodes`;
- `operationOrder`;
- ordered transitions with normalized `before` and computed `after` snapshots;
- per-transition reclaim inspection state;
- the computed `frontier`, `finalState`, and `externalActionCount`.

All normalized identifier ordering uses Unicode code-point order and is
independent of process locale. After `reclaim_expired_claim`, the checker rejects
every modeled mutation with `work-before-full-inspection` until a successful
full `get_ticket` reads the reclaimed revision. Semantic rejections preserve the
ticket revision, state, claim, and external-action count.

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
{ t in C | t.status = open
           and every blocker of t is closed
           and t.claim is absent }
```

Lifecycle-blocked tickets are explicitly excluded even when their dependency
blockers are closed and their claim is absent. Claimed, closed, non-child, and
stale-snapshot tickets are also not frontier members. An expired lease remains
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
   current token, and owner/session identities. Confirm through `get_ticket`
   that the claim is absent.
5. If release cannot be confirmed, return the stranded lease token, owner,
   session, expiry, observed revision, and the exact safe reclaim action. Do not
   report success.
6. A resumed agent calls `reclaim_expired_claim` with the observed token and
   revision. A mismatch means another session changed the lease and the caller
   must stop.
7. After reclaim, call `get_ticket` at the returned revision and reuse existing
   progress, comments, evidence, task intent, action keys, and receipts. Reconcile
   external state before continuing so partial work is not duplicated. Until
   that full read succeeds, reject progress, task intent, external action,
   receipt, block, release, unblock, reclaim, resolution, close, and every other
   work or mutation operation without changing state.

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
4. Invoke the action once with that key, the current expected revision, and the
   active claim token plus matching owner/session identities. The deterministic
   contract accepts only `succeeded` or `unknown`. Capture a durable external
   receipt or result that can be looked up independently of the tracker.
5. Call `record_task_receipt`. If tracker synchronization is stale or fails
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

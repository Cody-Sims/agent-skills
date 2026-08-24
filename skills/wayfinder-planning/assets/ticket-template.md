# [Decision Ticket Title]

- Parent map: [Map title](map-link)
- Type: `research` | `prototype` | `grilling` | `task`

## Question

[State one precise uncertainty this ticket resolves.]

## Resolution Condition

[State the evidence or human decision that will answer the question.]

## Scope Guard

[State what this ticket must not implement or deliver.]

Claims, blocker edges, lifecycle block records, and progress identities live in
the tracker adapter, not in editable ticket prose. A durable block records its
reason, evidence or receipt reference, actor, revision, and
`requires_human_resolution: true`; only a human-controlled `unblock_ticket`
after reconciliation may clear it.

## Task Action Record

Complete this adapter-managed record before any external effect. Omit it for
non-`task` tickets.

- Intended action: [Normalized idempotent or reconcilable operation.]
- Idempotency key: [Stable key reused for every reconciliation or retry.]
- Human authorization: [Current authorization reference outside tracker prose.]
- Reconciliation method: [Authoritative lookup by key.]
- State: `intended` | `succeeded` | `outcome_unknown`
- External receipt: [Durable result or stable lookup reference.]

Tracker rollback cannot roll back an external side effect. Reconcile by the
stable key before any retry.

## Progress Record

Append partial work through `record_progress`, not by rewriting the ticket body.
Use one stable `progress_key` per logical update and include evidence references.
Progress is non-resolution work: it cannot close the ticket or count as a map
decision.

## Resolution Comment

Post this as a child-ticket comment rather than replacing the ticket body.

```markdown
## Resolution

[Decision, answer, or completed operational prerequisite.]

## Rationale

[Why the evidence supports this resolution.]

## Primary Evidence

- [Primary source or artifact](link): [direct observation, relevant statement,
  or human answer].

## Remaining Uncertainty

[Fog retained or newly sharp questions, without pre-planning implementation.]

## Parent Map Summary

[One sentence suitable for the linked Decisions So Far entry.]
```

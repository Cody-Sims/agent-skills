# Integration Playbook

Read only for authorized integration. Use a clean coordinator-owned checkout;
never switch the live primary checkout just to obtain the integration branch.

## Merge one branch at a time

1. Verify checkout identity, clean status, intended base, and submitted worker tip.
   Freeze worker writes to that tip and review its full diff/ownership. Switch
   branches only in an available checkout with no unrelated work or operation.
2. Merge the verified stream tip using repository merge policy, one at a time.
   Serialize merges and shared Git administration; never rewrite shared history.
3. Run every repository-required per-merge gate on the resulting candidate. When
   a full gate is not mandated, select checks covering the changes/interactions.
   Worker/pre-merge evidence cannot establish post-merge correctness.
4. On failure, stop integration and fix the interaction before another merge.
   Recheck status after validation, including generated tracked changes.

## Conflict handling

Inspect both intents. For append-only documents preserve both valid entries and
check coherence; do not blindly concatenate structured data or remove markers.
Source resolutions must satisfy the ownership map and behavior tests. Escalate
unresolved ownership/intent conflicts; stage only explicit authorized paths.

## Cross-cutting integration fixes

The orchestrator owns fixes that no worker could have seen in isolation, such as:

- Tooling config that stops covering files after a directory move.
- CPU-bound architecture tests that need explicit timeouts under parallel load.
- Build-generated tracked files that become dirty only after merged changes
  interact.

Keep fixes small and coordinator-owned. Rerun affected checks and all mandated
gates after each fix; use scoped checks when policy permits, not automatic full
reruns merely because a worker handed off.

## Validation resources

Separate writable caches, build outputs, databases, and ports, or serialize their
use with worker checks. A worktree or dependency symlink alone does not isolate
these resources. Never mutate shared dependencies while checks are using them;
bound concurrent CPU-heavy jobs and report resource-related failures accurately.

## Wave sequencing checks

Before starting the next wave, answer:

1. Did every merge and integration fix pass its required gates on the resulting
   candidate, with any scoped-check rationale recorded?
2. Are all shared documents conflict-free and coherent?
3. Did any stream request a cross-boundary change that should become the next
   wave's explicit ownership?
4. Is the live primary checkout still untouched unless its owner consented?
5. Are required final gates complete, with no redundant reruns of unchanged checks
   unless repository policy requires them?

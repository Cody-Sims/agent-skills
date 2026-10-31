---
name: parallel-worktree-delivery
description: "Executes multi-agent Git worktree fleets with exclusive ownership, dependency waves, serialized integration, and merge gates. Use when delivering independent streams on separate branches/worktrees; not for task planning alone, one small change, or GitHub-hosted cloud agents."
license: MIT
metadata:
  version: "1.1.0"
  author: "Cody-Sims"
  tier: "experimental"
---

# Parallel Worktree Delivery

Run only an authorized fleet; loading is not consent to spawn, install, or mutate
Git/remote state.

## Prepare

1. Read path instructions; inspect branch/status/worktrees/operations and verify
   base/integration checkout. Never stash, commit, switch, or overwrite others'
   live work.
2. Bound streams/concurrency/time/cost to approved resources. Delegate substantial
   independent work only; honor requested runtime/model, invent no controls.
3. Assign separate branches/worktrees and exclusive files; sequence dependencies
   in waves. Coordinator owns shared files; exact-section exceptions serialize writes.
4. Read [fleet setup](references/fleet-setup.md) for setup/dispatch. Isolate or
   serialize writable dependencies, caches, outputs, databases, and ports.
   No concurrent shared installs; bound CPU-heavy jobs.

## Dispatch and collect

1. Supply objective/stop, branch/worktree/base, ownership, instructions/setup,
   scoped checks, and allowed actions. Workers report cross-boundary needs, not edit.
2. Record IDs/tips; continue independent work. Use notifications/bounded known-ID
   waits, not tight polling/discovery or duplicate workers. Collect paths/commits,
   exact checks/results, conflicts, and boundary requests.

## Integrate

1. Read [integration playbook](references/integration-playbook.md) before merges.
   Freeze tips; review ownership/full diffs. Serialize integration/shared Git
   administration in the clean coordinator checkout.
2. Merge one stream at a time; reconcile both conflict intents. Stop on unresolved
   ownership/behavior disagreements or failed checks.
3. Run all repository-required **per-merge** gates after each merge. Without a
   mandated full gate, check integrated changes/interactions. Never substitute
   worker/pre-merge evidence or defer required gates to the final wave.
4. Coordinator owns integration fixes; rerun affected checks/required gates before
   another merge without resource races. Review final diff/required final gates;
   no unchanged scoped reruns solely for handoff. Stage explicit owned paths;
   remote writes/clean-worktree cleanup need consent.

## Output

Return waves/ownership, worker IDs/integrated tips, per-merge checks/results,
conflicts/fixes, and pending work/blockers. No transcript dump; distinguish local
integration from remote delivery.

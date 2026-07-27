# Pokemon Web Workflow Skill Migration

The `parallel-worktree-delivery` and `verification-discipline` skills were
developed in `Cody-Sims/Pokemon-Web` and added in commit
[`b1d5a0f395955450b984420622c235065ed59282`](https://github.com/Cody-Sims/Pokemon-Web/commit/b1d5a0f395955450b984420622c235065ed59282).

They were migrated into this reusable catalog because neither workflow depends on
Pokemon Web:

- `parallel-worktree-delivery` captures operational lessons from coordinating
  isolated agent branches, explicit write ownership, dependency waves, and
  one-branch-at-a-time integration.
- `verification-discipline` captures repeated test-hardening lessons: red-green
  mutation proof, avoiding copied production logic, preserving meaningful
  failures, bounding expensive checks, and detecting build-generated churn.

The migration made repository-specific paths and commands into portable examples,
removed a conflict-marker deletion shortcut that was too easy to misuse, and
changed both maturity declarations from `core` to `experimental` under the
catalog's current entry policy.

## Overlap boundaries

- Use `planning-and-task-breakdown` to decompose an approved specification; use
  `parallel-worktree-delivery` only when actually coordinating multiple branches,
  worktrees, ownership partitions, and integration waves.
- Use `git-and-pr-workflow` for ordinary branch and pull-request operations; use
  `parallel-worktree-delivery` for a fleet with collision and integration risks.
- Use `test-driven-development` to drive one behavior through red, green, and
  refactor; use `verification-discipline` to audit whether tests and gates are
  credible across invariants, CI, expensive checks, and generated output.
- Use `verification-before-completion` to demand fresh final evidence; use
  `verification-discipline` while designing or repairing the tests and gates that
  produce that evidence.

Both skills contain prose and shell examples only, make no network calls, request
no secrets or tool pre-approvals, and retain the upstream MIT license.

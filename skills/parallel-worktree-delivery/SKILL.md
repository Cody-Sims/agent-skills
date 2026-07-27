---
name: parallel-worktree-delivery
description: Executes multi-agent, multi-branch git worktree delivery with ownership partitions, dependency waves, branch integration, merge conflict handling, and post-merge gates. Use when running worktree fleets, integration branches, or wave-based migrations where checkout collisions are a risk; do not use merely to identify parallel tasks or for a single small change.
license: MIT
metadata:
  version: "1.0.0"
  author: Cody-Sims
  tier: experimental
---

# Parallel Worktree Delivery

Run a fleet of agents without checkout collisions by giving every work stream its
own git worktree, branch, file-ownership boundary, and integration gate.

## Start

1. Read the repository instructions for every path that any stream may edit.
2. Inspect the current state:
   ```bash
   git branch --show-current
   git status --short
   git worktree list
   ```
3. Choose one integration branch and one branch/worktree per independent stream.
4. Load [references/fleet-setup.md](references/fleet-setup.md) before creating
   worktrees, sharing prerequisites, or prompting worker agents.
5. Load [references/integration-playbook.md](references/integration-playbook.md)
   before merging worker branches back together.

## Plan the wave

- Parallelize only streams with independent write ownership and no true ordering
  dependency.
- Split dependent work into waves. For example, create shared modules in one wave,
  then migrate broad call sites in a later wave.
- Assign every stream an exclusive file set. If a shared file cannot be avoided,
  assign exact sections or one-line edits and require the worker to flag that edit
  in its report.
- Keep append-only shared files such as changelogs on the orchestrator's merge
  checklist because they conflict often.
- Treat the primary checkout as live: if another human or agent owns uncommitted
  work there, do not stash, commit, or overwrite it.

## Prompt each worker

Every worker prompt must include:

- The branch, worktree path, and base branch.
- The exact paths or sections it owns and a statement that no other files may be
  edited except explicitly named boundary edits.
- Required setup notes, including whether dependencies are shared or isolated.
- The narrow checks it should run before reporting.
- A requirement to report cross-boundary changes instead of making them when not
  authorized.

## Integrate

1. Merge one stream branch into the integration branch.
2. Resolve only that branch's conflicts.
3. Run the repository's required gate after each merge, not only after the final
   pile-up.
4. Keep cross-cutting fixes with the orchestrator unless one stream clearly owns
   the affected files.
5. Review the final diff and stage explicit paths only.

## Output

Report the wave plan, ownership map, worker branches, validation after each merge,
conflicts resolved, cross-cutting orchestrator fixes, and any existing skill or
instruction that should be changed later.

# Worktrees and Conflicts

Read for worktree isolation, conflicts, or recovery; do not run every section.

## Worktrees

A worktree isolates a second checkout without stashing or switching live work.
Use it for review/testing, independent development, or authorized history work.

1. Inspect `git worktree list`; verify the base and approved destination. A branch
   can be checked out in only one worktree. Never override that protection.
2. Create a new branch with `git worktree add -b <branch> <path> <base>`, or an
   available existing branch with `git worktree add <path> <branch>`.
3. Keep destinations outside the primary working tree and within authorized write
   boundaries. Worktrees share repository metadata, not isolated remote state.
4. Isolate writable validation outputs, caches, ports, and dependencies, or
   serialize their use. Never run concurrent installers on shared dependencies.
5. Before authorized cleanup, inspect tracked, untracked, and ignored work and
   verify no unique/unpushed work remains. Remove the clean owned worktree normally
   with `git worktree remove <path>` before `git branch -d <branch>`; no force.
6. Use `git worktree prune` only for confirmed obsolete records of directories
   already removed, not as routine cleanup of another owner's worktrees.

## Resolving Conflicts

1. Read `git status` to identify the current operation and conflicted paths.
   Do not start a second operation. Open each conflict:

   ```
   <<<<<<< HEAD
   current side
   =======
   other side
   >>>>>>> other
   ```

2. Inspect each intent and reconcile behavior, not just markers. `git show :2:path`
   and `git show :3:path` expose available conflict stages. During rebase,
   "ours"/"theirs" do not mean the same branch roles as an ordinary merge; inspect
   commits rather than assuming a side is your original change.
3. Remove markers, stage resolved owned paths explicitly, review the full staged
   diff, and validate affected behavior plus repository-required gates.
4. Continue only the matching operation:
   * Rebase: `git rebase --continue`.
   * Merge: `git merge --continue`.
   * Cherry-pick: `git cherry-pick --continue`.

### Recovering

1. If resolution is unclear, preserve new work and use the matching `--abort`
   only when authorized; do not blindly reset or discard edits made mid-operation.
2. After a bad rewrite, inspect `git reflog` and preserve the previous tip with
   an authorized recovery branch before deciding how to restore it.

### Reducing Conflicts

Keep commits focused. Integrate the base when needed, not automatically at every
handoff. Rebase only local-only history; merge to preserve published/shared commits.

# Worktrees and Conflicts

Detailed guidance for isolating parallel work with worktrees and for resolving
merge and rebase conflicts safely.

## Worktrees

A worktree checks out an additional branch into its own directory that shares the
same repository. Use one to work on a second branch without stashing, switching,
or disturbing the current checkout.

### When to use

* Reviewing or testing another branch while your current work stays in place.
* Running a long build or test suite on one branch while editing another.
* Isolating a risky rebase or conflict resolution from your main checkout.

### Commands

1. Create a worktree for a new branch:
   `git worktree add ../<dir> -b <branch>`.
2. Create a worktree for an existing branch:
   `git worktree add ../<dir> <branch>`.
3. List active worktrees: `git worktree list`.
4. Remove a worktree when finished: `git worktree remove ../<dir>`.
5. Prune records of manually deleted worktree directories:
   `git worktree prune`.

### Rules

* A branch can be checked out in only one worktree at a time.
* Keep worktree directories outside the main working tree so they are never staged
  or committed by accident.
* Remove a worktree before deleting its branch.

## Resolving Conflicts

A conflict occurs when two changes touch the same lines and Git cannot combine
them automatically. Resolution requires understanding both intents, not just
picking a side.

### Procedure

1. List conflicted files with `git status`.
2. Open each file. Git marks conflicts as:

   ```
   <<<<<<< HEAD
   your change
   =======
   incoming change
   >>>>>>> other
   ```

3. Decide what the correct result is. Often it combines both sides rather than
   discarding one. Preserve the behavior each side intended.
4. Remove every conflict marker and leave only the reconciled content.
5. Stage the resolved file by explicit path: `git add path/to/file`.
6. Run the repository's test command to confirm the resolution behaves correctly.
7. Continue the operation:
   * Rebase: `git rebase --continue`.
   * Merge: `git merge --continue`.
   * Cherry-pick: `git cherry-pick --continue`.

### Recovering

* Abort and return to the pre-operation state when the resolution is unclear:
  `git rebase --abort`, `git merge --abort`, or `git cherry-pick --abort`.
* Inspect both sides of a specific file during resolution:
  `git show :2:path` for your side and `git show :3:path` for the incoming side.
* After an accidental bad rewrite, recover the previous tip from `git reflog`,
  which records where branches pointed recently.

### Reducing Conflicts

* Integrate the base branch frequently so divergence stays small.
* Keep commits small and focused, which localizes conflicts.
* Rebase an unshared branch onto the latest base before opening a pull request.

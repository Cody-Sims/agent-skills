---
name: git-and-pr-workflow
description: Guides Git branching, atomic commits, rebasing, resolving merge conflicts, worktrees, pull request descriptions, and safely finishing a branch. Use when creating branches, staging and committing changes, rebasing or squashing, resolving conflicts, opening or updating a pull request, or cleaning up after merge.
license: MIT
metadata:
  version: "1.0.0"
  author: Cody-Sims
  tier: core
---

# Git and PR Workflow

Produce clean, reviewable history and a clear pull request without corrupting
shared branches or losing work. This workflow is intentionally low-freedom:
history and remote state are hard to recover, so follow the safety rules exactly.

## Safety Rules

* Stage explicit paths (`git add path/to/file`). Never use `git add -A` or
  `git add .`, which capture unrelated edits, scratch files, and secrets.
* Never rewrite history that is already published or shared. Rebase, amend, and
  squash only commits that live solely on your local branch.
* Never force-push a shared branch. If a rewrite of your own branch is required,
  use `git push --force-with-lease`, which refuses to overwrite unseen remote work.
* Review the full diff before every commit. Read `git diff --staged` in full, not
  just the file list.
* Keep one logical change per commit. Unrelated changes belong in separate commits.
* Write commit subjects in the imperative mood: "Add", "Fix", "Rename".

## Start Work

1. Confirm a clean starting point with `git status`. Stash or commit unrelated
   local changes before branching.
2. Update the base branch: `git switch main` then `git pull --ff-only`.
3. Create a topic branch: `git switch -c <type>/<short-description>`. Use a
   descriptive slug such as `fix/login-null-check`.
4. Confirm the new branch and base with `git status` before editing.

## Commit Changes

1. Review every change with `git status` and `git diff`.
2. Group related edits. Stage each group by explicit path.
3. Re-read the staged diff with `git diff --staged`. Unstage anything unrelated.
4. Scan the staged diff for secrets, credentials, tokens, and debug output before
   committing.
5. Commit with a clear subject and, when the change needs justification, a body.
   See [commit message rules](references/commit-messages.md).
6. Split accidental mixed changes: unstage, then re-stage one logical group at a
   time so each commit stands alone.

## Keep History Current

1. Prefer rebase over merge to integrate the latest base into an in-progress,
   unshared branch: `git fetch` then `git rebase origin/main`.
2. If the branch is already shared and others may have based work on it, merge the
   base in instead of rebasing, to avoid rewriting shared commits.
3. To tidy local-only commits before review, use `git rebase -i` to reorder,
   squash, or reword. Never do this to commits others already pulled.
4. Resolve any conflicts that arise, then continue. See
   [worktrees and conflicts](references/worktrees-and-conflicts.md).
5. After a rebase, push your own branch with `git push --force-with-lease`, never
   plain `--force`.

## Resolve Conflicts

1. Read `git status` to list conflicted files.
2. Open each file and reconcile the intent of both sides. Do not blindly keep one
   side or delete the markers without understanding the change.
3. Remove all conflict markers, then stage the resolved file by explicit path.
4. Run the repository's test command to confirm the resolution is correct.
5. Continue the operation with `git rebase --continue` or `git merge --continue`.
   Abort with `--abort` if the resolution is unclear and a fresh attempt is safer.
   See [worktrees and conflicts](references/worktrees-and-conflicts.md) for
   worktree-based isolation.

## Open a Pull Request

1. Push the branch: `git push -u origin <branch>`.
2. Confirm the diff against the base is exactly the intended change; remove stray
   commits first.
3. Write the description so a reviewer needs no other context:
   - What changed and why, in the first sentences.
   - The problem or issue it addresses, with a link when one exists.
   - How it was verified, naming the commands run.
   - Risks, follow-ups, and anything intentionally out of scope.
4. Keep the pull request focused on one logical change. Split unrelated work into
   separate pull requests.

## Finish a Branch

1. Confirm the change is merged into the base and the base is updated locally.
2. Verify no unpushed commits remain: `git log origin/<branch>..HEAD` returns nothing.
3. Delete the local branch (`git branch -d`, which refuses unmerged work) and the
   remote branch when the platform did not remove it.
4. Remove any worktree created for the branch: `git worktree remove <path>`.
5. Return to an updated base branch and confirm a clean `git status`.

## Report

State the branch, the commits made, verification commands run and their result,
the pull request opened or updated, and any cleanup still pending.

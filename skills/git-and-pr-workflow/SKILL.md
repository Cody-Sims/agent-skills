---
name: git-and-pr-workflow
description: "Guides safe Git branches, atomic commits, rebases, conflicts, pull requests, and post-merge cleanup. Use when branching, staging or committing, tidying local history, resolving conflicts, or opening or updating a PR; use parallel-worktree-delivery for multi-agent worktree fleets."
license: MIT
metadata:
  version: "1.1.0"
  author: "Cody-Sims"
  tier: "core"
---

# Git and PR Workflow

Run only the requested phase; loading/advice authorizes no Git or remote mutation.
Repository rules apply.

## Establish state

1. Read instructions; inspect branch, `git status --short`, worktrees, and ongoing
   operations. Record owned paths, base/remote, and authorized actions; do not
   assume `main`/`origin`. Serialize shared-checkout mutations and recheck state.
2. Stay on an existing task branch. Never switch, pull, stash, commit, or overwrite
   another owner's live work to get a clean checkout.
3. New branch only when requested: `git switch -c <topic> <base>` from a verified
   base in an available clean checkout; otherwise use an approved worktree or
   report a blocker. Read [worktrees and conflicts](references/worktrees-and-conflicts.md)
   for isolation. Fetch relevant refs only when remote freshness is needed.

## Commit

1. Review owned changes; stage one logical group by explicit paths/hunks.
   Never use `git add -A` or `git add .`.
2. Before **every** commit read the full `git --no-pager diff --staged`, including
   pre-existing staging. Check secrets/debug output and scope. Do not commit or
   unstage another owner's work; stop on an inseparable shared index. Read large
   diffs in bounded sections, never truncate the review.
3. Run change-covering checks and all mandated gates; reuse fresh evidence only
   for unchanged tested inputs/environment. Isolate/serialize writable resources.
4. Use an imperative subject and required trailers; read
   [commit message rules](references/commit-messages.md) when composing/rewording.

## Integrate or resolve conflicts

1. Integrate the verified base only when needed/requested. Prefer rebase for
   local-only commits; merge into shared branches. Never rebase/amend/squash
   published or shared history.
2. Resume, not nest, operations. Reconcile both conflict intents; stage explicit
   resolved paths, check markers, and validate affected behavior plus required
   gates before the matching `--continue`. Read
   [worktrees and conflicts](references/worktrees-and-conflicts.md) for recovery
   or an authorized `--abort`; never blindly choose a conflict side.
3. No automatic force-push after rebase, no shared-branch force-push, no plain
   `--force`. `--force-with-lease` does not authorize rewriting shared history.

## Pull request

1. Review commits/full base diff before an authorized normal push to the explicit
   remote/branch. Stop on unexpected history; do not delete stray commits blindly.
2. Create/update the intended PR without duplicates: what/why, issue links, exact
   checks/results, risks, and exclusions. Read back head/base/URL; creation proves
   neither passing checks nor merge approval.

## Cleanup, only when requested

1. Verify the correct PR's merge and fresh refs for unique/unpushed work. Missing
   remote branches are not proof; for squash merges check PR/resulting content,
   not ancestry alone.
2. Inspect tracked/untracked/ignored work. Remove only unused clean owned
   worktrees normally before `git branch -d`; never force a refusal. Remote
   deletion needs authorization and merged/no-unique-work evidence. Return to
   the base only in an available safe checkout.

## Report

Return branch/base, commits, exact checks/results, PR URL/state, and pending
actions/blockers. No unchanged log dump or unperformed-cleanup claim.

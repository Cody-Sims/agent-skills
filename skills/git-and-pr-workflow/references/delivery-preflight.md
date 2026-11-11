# Delivery preflight

Run when push, PR delivery, publication, release, or tier promotion enters the
authorized scope, before delivery-specific validation or installation. This is
a bounded inventory, not permission to publish or an instruction to run every
gate immediately. Local-only work needs no remote calls or delivery ceremony.

## Resolve the deliverable

1. Record the requested action, repository, explicit destination (remote/branch,
   PR base, release channel, or catalog tier), and authorization limits. Use task
   instructions and repository configuration; never assume `origin` or `main`.
   Stop delivery if a consequential target or base cannot be established.
2. Resolve the intended comparison base and current head to immutable SHAs with
   `git rev-parse --verify <ref>^{commit}`. Record what the base represents.
   Inspect ancestry with `git merge-base`; distinguish the target tip from a PR
   merge-base when they differ. If refs are stale, refresh only relevant refs
   when permitted and needed; otherwise report that remote freshness is unknown.
3. Inspect every commit in the actual unpublished range, for example
   `git --no-pager log --oneline <base-sha>..<head-sha>`, then inspect its patches
   and the full comparison diff. For a PR, also inspect the merge-base comparison
   if different. Do not equate today's commits, a path-filtered diff, or a final
   tree diff alone with the entire delivery. Unexpected older commits expand the
   review/gate inventory; they do not authorize rewriting or deleting history.
4. Separately inspect `git status --short --untracked-files=all`,
   `git --no-pager diff --staged`, and `git --no-pager diff`. Identify ownership
   and inclusion/exclusion of staged, unstaged, and untracked paths. Review
   relevant ignored artifacts if packaging could include them. Do not stage,
   discard, or install another owner's live changes to simplify the preflight.

## Inventory gates and capabilities

1. Read the applicable contribution, release, and protection requirements.
   For every affected component in the full range and proposed uncommitted
   deliverable, list required evidence and its status: satisfied, missing,
   blocked, or not applicable with a reason. Include contribution records,
   independent review, tests, metadata, packaging, and promotion gates where
   required. Existing records are not missing merely because they predate this
   task; inspect their validity. Current-author-only checks cannot establish
   readiness for a larger unpublished range.
2. Check remote permissions, required checks/reviews, protection rules, or plan
   capabilities only if the requested delivery depends on them and fresh
   evidence is absent. Use the host's supported read-only CLI/API or documented
   equivalent for the explicit target. Request only relevant fields; never
   probe capability by attempting a write, changing settings, or publishing.
3. Distinguish an unavailable mandatory capability from an unreadable or unknown
   one. A denial such as HTTP 403 is not evidence that protections are absent.
   Preserve the diagnostic and requirement; stop the dependent delivery if it
   cannot be verified or satisfied. Do not retry with elevated credentials,
   upgrade a plan, weaken protections, or author a blanket safety exception.
   Report the authorized maintainer action needed; unrelated local work may
   continue with its narrower status.

## Bind and recheck readiness

1. Record target, base/head SHAs, relevant index/worktree state or content
   fingerprints, gate results and tested inputs, and remote-check scope/time.
   Report local validation or installation separately from delivery approval.
   An install receipt or dry run proves only what that command checked.
2. Before the authorized delivery action, compare the current head/base, refs,
   included paths/content, requirements, and capability evidence with the record.
   A commit, rebase, base movement, inclusion change, or relevant policy/remote
   change invalidates affected readiness. Re-inventory the changed range and
   rerun affected gates; reuse only evidence whose inputs remain unchanged.
3. Stop after the inventory and applicable checks or at a hard blocker. Return
   exact checks, exclusions, missing evidence, and pending authorization. A
   successful preflight never initiates a push, publish, or promotion itself.

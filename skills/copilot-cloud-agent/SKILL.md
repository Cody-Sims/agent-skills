---
name: copilot-cloud-agent
description: "Launches and monitors GitHub-hosted Copilot tasks with explicit models and durable task/PR IDs. Use when starting cloud agents, assigning issues to hosted Copilot, selecting GPT-5.6 Sol, or checking cloud-task status; not for local CLI subagents or Git worktree fleets."
license: MIT
metadata:
  version: "1.1.1"
  author: "Cody-Sims"
  tier: "experimental"
---

# Copilot Cloud Agent

Use genuine GitHub-hosted tasks, never relabeled local workers. Loading/status
requests authorize no launch, assignment, resumption, cancellation, or merge.

## Workflow

1. Record repository/action, known IDs, base/head refs, bounded prompt, PR choice,
   and requested model. Confirm hosted scope and plan/organization policy.
   Omitted model means Auto, not a specific GPT choice.
   If a hard execution-time or spend ceiling is required, verify enforceable
   hosted support before launch; otherwise report blocked and seek a decision.
2. **Status only:** read known IDs directly for state/model/refs/artifacts.
   Discover bounded matches only if the ID is missing; never relaunch for status.
3. **Authorized launch/assignment:** read applicable
   [hosted controls](references/github-cloud-agent-controls.md). Verify current
   API shape/requested model from linked GitHub sources before each launch;
   reuse same-operation evidence, not stale snapshots. Check matching tasks/PRs
   by repository/refs/objective; bound pagination. Reuse or wait for matching work;
   report/block launch if discovery cannot exclude duplicates.
4. Tasks use `POST /agents/repos/{owner}/{repo}/tasks`: `prompt` and applicable
   documented `base_ref`, `head_ref`, `model`, `custom_agent`, `create_pull_request`.
   Prefer authenticated `gh api`; never expose credentials. Issue workflows use
   the documented assignment API/model field, not a model-dropping helper.
5. Send the requested model explicitly, e.g. `model: "gpt-5.6-sol"` when available.
   Surface validation/policy failures; never silently fall back. After uncertain
   POST outcomes inspect matching tasks before retry; avoid duplicate creation.
6. Record task ID/repository URL immediately and read back state/model/refs/artifacts.
   Preserve exact provider-prefixed model values; report missing fields/mismatches.
   Verify PR existence before reporting its URL.
7. Bound known-ID polling: default five reads or five minutes, whichever first;
   back off 15/30/60 seconds, honor Retry-After, and stop at the budget. Read concise
   deltas; bounded logs only for triage. Stop for `completed`, `failed`, `timed_out`,
   `cancelled`, or needed user input. `queued`, `in_progress`, `idle`, and
   `waiting_for_user` are not completion. Budget exhaustion means active/blocked;
   no unauthorized resume/relaunch/retry. A polling budget does not cap hosted
   compute/spend or authorize cancellation.
8. Review PR/code and repository-required checks before an authorized merge.
   Completed sessions prove neither correctness nor approval.

## Hosted versus local controls

- The API snapshot documents `model`; it does not currently document `effort`,
  `reasoning_effort`, `context`, `context_window`, or token-window fields. Recheck
  current sources when answering control questions; never invent fields/CLI flags.
- Local CLI controls do not configure hosted tasks. Sol selection guarantees
  neither effort, long-context mode, nor exact 1M allocation.

## Output

Return host/repository, task ID/URL/state, requested/observed model, base/head refs,
verified PR URL, budget/results, restrictions, and pending validation. No transcript
or credentials; distinguish queued, active, blocked, failed, and completed.

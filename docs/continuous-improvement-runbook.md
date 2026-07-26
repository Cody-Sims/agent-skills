---
title: Continuous Improvement Runbook
description: Operate the approval-gated learning and improvement agents for a manual Copilot cloud pilot
ms.date: 2026-07-25
ms.topic: how-to
---

## Operating Boundary

The repository provides separate `Skill Learning` and `Skill Improvement`
custom agents. The learning agent researches one proposal without write or
execution tools. The improvement agent edits one approved item under a current
lease and prepares a draft pull request.

GitHub issues are the operational queue. Workflow comments containing the
`improvement-control:v1` marker form the transition audit trail. JSON schemas
under `schemas/` normalize item and run data for local validation; they are not
a second live queue.

Recurring execution remains disabled until the measured pilot in SI-010 passes.

## Repository Prerequisites

Before the first pilot, configure the default branch to:

1. Require pull requests and at least one approval.
2. Require review from Code Owners.
3. Require `Validate Agent Skills` and `Continuous Improvement Policy` checks.
4. Prevent force pushes and branch deletion.
5. Restrict bypass permission to designated maintainers.
6. Enable secret scanning and push protection.

CODEOWNERS and workflow files do not enforce these settings by themselves.
Confirm the settings in the repository before treating the system as active.

## Propose Work

1. Select the `Skill Learning` custom agent.
2. Ask it to research one improvement opportunity.
3. Review its evidence, duplicate check, scope, and verification plan.
4. Create an issue with the `Skill improvement proposal` issue form.
5. Enter exact external GitHub check-run names under `Required checks`. Do not
   enter shell commands or the `Continuous Improvement Policy` check itself.
6. Reject uncited, duplicate, untestable, or authority-expanding proposals.

The learning agent returns proposal text but cannot create or approve an issue.
This preserves the repository's least-privilege boundary.

## Approve Work

1. Review the complete issue body and verify every allowed and protected path.
2. Run the `Continuous Improvement Control` workflow with `approve` and the
   issue number.
3. Confirm that the workflow adds `improvement:ready` and an audit comment with
   the SHA-256 digest of the approved issue body.
4. Do not edit the issue after approval. Any edit invalidates the digest and
   requires rejection followed by a new proposal.

Only a repository member with `maintain` or `admin` permission can approve or
reject a proposal.

## Claim And Delegate

1. Start from a clean worktree or create a checkpoint commit for local work.
2. Choose a unique run ID, such as `SI-123-20260725T140000Z`.
3. Run the `Continuous Improvement Control` workflow with `claim`, the issue
   number, run ID, and expected PR author login. Copilot cloud currently uses
   `copilot-swe-agent[bot]`.
4. Copy the lease ID, expiry, and approval digest from the audit comment.
5. Select the `Skill Improvement` custom agent in Copilot CLI.
6. Provide the issue URL, run ID, lease ID, expiry, and approval digest.
7. Delegate the session with `/delegate` or the `&` prompt prefix.
8. Retain the session link for the audit record.

The queue workflow serializes claims and refuses a claim while another item is
`in-progress`. The lease lasts 90 minutes, while the run budget is 60 minutes.
An expired or closed lease does not renew itself. Run the control workflow with
`expire` to record `blocked` before approving and claiming another proposal.

The pilot caps each run at 5 AI credits and 30 Actions minutes, and each month
at 20 AI credits and 120 Actions minutes. GitHub does not expose Copilot model
credit usage to these repository workflows. The maintainer must record usage in
the pull request and pilot report, verify it against available billing data, and
stop dispatching runs when a monthly limit is reached.

## Review The Pull Request

The improvement agent must open a draft pull request using the skill
improvement template. Wait for every required status check named in the approved
issue to succeed for the current head, then have a maintainer add the
`continuous-improvement` label to activate the policy check. The names must
match GitHub check-run names exactly. Rerun the policy check after any head
change or initially pending check.

Verify that the pull request includes:

* Exactly one improvement issue, lease ID, and approval digest
* Baseline and before-and-after evidence
* Acceptance-criteria results
* Validation and evaluation evidence
* Successful required GitHub check runs bound to the exact pull request head
* Self-reported duration, retries, Actions minutes, and AI credits within policy
* Sources, risks, limitations, and rollback instructions
* Only approved file paths

After review and passing checks, a maintainer may mark the pull request ready
and merge it. A merged labeled pull request is the only automated transition to
`done`; the control workflow then closes the issue and records the merge commit.

## Block, Cancel, And Stop

Run the control workflow with `block` and a reason when the agent encounters:

* Missing or ambiguous acceptance criteria
* A permission expansion or unapproved protected path
* Evaluation regression or repeated validation failure
* Lease conflict or budget exhaustion
* A secret, unsafe external instruction, or unresolved provenance concern

Cancel the delegated session and close its draft pull request when present.
Disable the control and policy workflows to stop all queue operations. Recurring
automation has no schedule to disable during the manual pilot.

## Roll Back

Revert the immutable merge commit through a new reviewed pull request. Do not
force-push, rewrite shared history, or let either agent revert automatically.
Record the regression and revert in a new proposal so the next learning run can
use the outcome without editing the product directly.

## Local Validation

Run the repository checks before delegation and before review:

```bash
npm run validate
npm test
npm run registry:check
```

Normalized item and run records can be checked with:

```bash
npm run improvement:preflight -- --item <item.json> --run <run.json>
npm run improvement:verify -- --item <item.json> --run <run.json>
```

Keep raw prompts, secrets, and private user data out of committed records. Store
only a SHA-256 prompt digest when a run identifier is needed.
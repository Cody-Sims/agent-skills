---
name: code-review
description: Reviews a diff, pull request, or set of staged changes for correctness, tests, error and edge cases, security, performance, readability, and architectural fit, then reports severity-ranked, actionable findings with file and line references. Use when reviewing a PR, examining staged or unstaged changes, giving feedback on a patch, or deciding whether a change is safe to merge.
license: MIT
metadata:
  version: "1.0.0"
  author: Cody-Sims
  tier: core
---

# Code Review

## Goal

Judge whether a change is correct, safe, and maintainable, and return specific
findings the author can act on. Verify the code itself rather than trusting the
description.

## Core rule

Review what the diff actually does, not what the title or summary claims it
does. Confirm each claim against the code. Descriptions drift from
implementations.

## Workflow

1. Establish the change set and intent. Read the diff in full and the stated
   purpose. Determine what behavior is meant to change and what must stay the
   same.
2. Confirm scope. Flag unrelated changes, drive-by edits, and generated or
   vendored files mixed into the diff. A change that does more than it claims is
   harder to review and to revert.
3. Review against the axes below, in order of impact.
4. Verify claims. Trace the code paths that the description says it changed.
   Check that tests actually exercise the new behavior and would fail without
   the change.
5. Collect findings with exact `file:line` locations, evidence, and a concrete
   recommended correction.
6. Rank by severity and separate blocking from non-blocking.
7. Report the verdict, the findings, what you verified, and residual risk.

## Review axes

Assess in this order; correctness first because it dominates.

1. Correctness: Does it do what it intends across normal and boundary inputs? Look
   for off-by-one, wrong conditionals, unhandled null or empty cases, incorrect
   assumptions about ordering, and concurrency hazards.
2. Tests: Do tests exist for the new behavior, assert observable outcomes, and
   fail without the change? Look for missing edge and error cases and for tests
   that assert nothing meaningful.
3. Error and edge cases: Are failures handled or surfaced? Look for swallowed
   errors, missing validation, and resources not released on the failure path.
4. Security: Untrusted input reaching a sink, missing authorization checks,
   injection, secrets in code or logs, and unsafe deserialization. See
   [references/review-checklist.md](references/review-checklist.md).
5. Performance: Accidental quadratic loops, work inside hot paths, unbounded
   growth, and N+1 access patterns. Flag only realistic impact, not speculation.
6. Readability and maintainability: Unclear names, dead code, duplicated logic,
   and functions doing too much. Comment only what affects correctness or intent.
7. Architectural fit: Does the change respect existing boundaries, layering, and
   conventions, or does it bypass them and add coupling?

## What not to comment on

- Formatting, spacing, quote style, and import order handled by an automatic
  formatter or linter. Let the tool own these.
- Personal style preferences with no correctness or clarity impact.
- Rewrites of code the change did not touch, unless directly relevant.

## Severity ranking

- Critical: a defect that causes incorrect behavior, data loss, or a security
  hole. Blocking.
- Required: a real problem that must be fixed before merge, such as a missing
  test for new logic or an unhandled error path. Blocking.
- Optional: an improvement that is not a defect. Non-blocking; label it as such.

State each finding as `file:line` — the problem, its impact, and the fix.

## Output

Report a verdict of approve, request changes, or block. Then list findings under
Critical, Required, and Optional headings. Then state what you verified, such as
commands run or code paths traced, and any residual risk you could not confirm.

## References

- [references/review-checklist.md](references/review-checklist.md) — per-axis
  checks for correctness, tests, error handling, security, performance,
  readability, and architecture.

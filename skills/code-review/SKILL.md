---
name: code-review
description: "Reviews diffs for correctness, tests, edge cases, security, performance, and maintainability. Use when reviewing a PR, patch, or staged/unstaged changes for merge readiness; stays read-only, unlike implementation or dedicated vulnerability audits."
license: MIT
metadata:
  version: "1.1.0"
  author: "Cody-Sims"
  tier: "core"
---

# Code Review

## Contract

Inputs: the diff or comparison range, intended behavior, and repository review
rules. Output: an evidence-backed merge verdict, not an implementation.
Stay read-only; do not fix, stage, or rewrite code during review.

## Workflow

1. Read applicable instructions, the stated intent, and the full diff. Confirm
   the range and what must change or remain compatible. Judge code, not claims
   in the PR description. Flag unrelated, generated, or vendored changes.
2. Start with changed files and nearby tests, callers, and contracts. Use symbol
   tools or path-scoped searches; widen only for a concrete dependency or risk.
   Read omitted diff sections rather than treating truncated output as complete.
   A bounded review needs no automatic worker launch or repository-wide
   architecture audit.
3. Assess, in impact order:
   - Correctness: normal/boundary inputs, null/empty state, ordering, concurrency.
   - Tests: observable outcomes, meaningful assertions, edge/error cases, and
     whether a test would fail without the change.
   - Failures: validation, propagation, cleanup, and consistent partial state.
   - Security: untrusted sinks, authorization, secrets, unsafe deserialization.
   - Performance: realistic hot-path, N+1, quadratic, or unbounded-growth risks.
   - Maintainability and architecture: clarity, duplication, existing layering,
     public-contract compatibility, and coupling at the changed boundary.
   Read [the review checklist](references/review-checklist.md) when an axis needs
   deeper checks; apply only relevant items.
4. Trace each suspected defect to evidence and an exact `file:line`. Inspect
   whether tests exercise the claimed behavior; run safe targeted checks when
   they resolve uncertainty, plus any repository-required review gates.
   Do not mutate code to prove a test fails without authorization. Distinguish
   inspected code from executed checks; never invent results.
5. Report only actionable findings. Exclude formatter-owned style, personal
   preferences, and untouched code unless directly implicated. Recommend a
   concrete correction and state impact, confidence, and blocking status.

## Stop and output

Stop when the full change and relevant risks are assessed. If scope, access, or
validation is missing, identify the unreviewed portion and do not imply approval.
Report:

- Verdict: **approve**, **request changes**, or **block**.
- Findings as `file:line — problem; impact; correction`, ranked **Critical**
  (incorrect behavior, data loss, security hole; blocking), **Required**
  (other pre-merge defects or missing necessary tests; blocking), or **Optional**
  (non-defect improvement; non-blocking).
- Commands/results and code paths actually checked, plus residual risk.

Use the severity headings for findings; omit empty headings and speculative
filler. A clean review still needs a verdict and verification limits.

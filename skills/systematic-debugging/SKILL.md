---
name: systematic-debugging
description: "Diagnoses failures by reproducing exact errors, testing one hypothesis at a time, and fixing the root cause. Use when a bug, failing test/build, crash, exception, wrong output, or intermittent failure needs tracing; not for reviewing a patch or auditing already-green tests."
license: MIT
metadata:
  version: "1.1.0"
  author: "Cody-Sims"
  tier: "core"
---

# Systematic Debugging

## Contract

Inputs: observed versus expected behavior, failure command/input, and relevant
environment. Output: a confirmed cause and verified fix with a regression test,
or a precise blocker. No speculative production edits before reproduction and
an evidence-backed explanation; diagnostic probes are allowed.

## Workflow

1. Read applicable instructions and capture the full error, stack/cause chain,
   exit code, and failing assertion verbatim. Preserve exact diagnostic evidence
   without exposing secrets; identify any redactions.
2. Find and run the smallest deterministic reproduction using existing commands.
   Record command, input, and environment. For intermittency, read
   [flaky tests](references/flaky-tests.md); bound attempts/time and capture
   failing seed/order/state. A missing tool or dependency is a readiness problem,
   not proof of an application defect: follow documented, authorized setup for
   demonstrated missing prerequisites, retry the same command, or report blocked.
3. Narrow the search to the error location, input/output path, recent changes,
   and differences from a known-good state. Use symbols or path-scoped searches
   with bounded output; expand only for evidence. Do not launch workers or map
   unrelated architecture for one continuous failure trace.
4. State one falsifiable hypothesis with the predicted observation. Test it with
   the smallest boundary probe, breakpoint, or bisection; confirm or reject it
   before another hypothesis. Trace bad state backward to its first divergence,
   not just the final throwing frame. Read
   [root-cause tracing](references/root-cause-tracing.md) when stack analysis,
   instrumentation, history/input bisection, or differential diagnosis is needed.
5. Correct the proven origin. Do not swallow errors, clamp bad state, add blind
   retries, or special-case the observed input to hide the symptom. Remove
   diagnostic instrumentation when finished. Add a regression test and show it
   fails without the fix for the expected reason, then passes with the fix.
6. Rerun the exact reproduction, then affected surrounding tests and required
   repository gates. Combine compatible selectors rather than repeating full
   suites after each probe. For flakes, report bounded runs/seeds and residual
   intermittency; one green attempt does not prove nondeterminism gone.

## Stop and output

If repeated fixes expose unrelated failures, stop patching and return to step 3:
recheck the mental model, coupling, and known-good differences. If reproduction,
prerequisites, or diagnosis remain unavailable, report the blocker rather than
claiming a fix.

Return reproduction command/input, exact relevant error, confirmed cause and
evidence, fix, regression red/green results, final commands/results, and remaining
uncertainty. Do not infer success from inspection or omit an unresolved verdict.

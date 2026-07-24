---
name: systematic-debugging
description: Diagnoses bugs, failing tests, build failures, crashes, exceptions, stack traces, and unexpected or intermittent behavior by reproducing the failure, capturing exact error output, isolating the root cause, and fixing the cause rather than the symptom. Use when something is broken, a test or build fails, output is wrong, or a defect must be traced to its origin.
license: MIT
metadata:
  version: "1.0.0"
  author: Cody-Sims
  tier: core
---

# Systematic Debugging

## Goal

Find the true root cause of a failure and correct it with a verified fix and a
regression test. Replace guess-and-check editing with evidence.

## Core rule

Do not change code until you can reproduce the failure and explain what is
wrong. Speculative edits hide symptoms, add noise, and destroy the evidence you
need. Test one hypothesis at a time.

## Workflow

1. Capture the exact failure. Copy the full error message, stack trace, exit
   code, and failing assertion verbatim. Do not paraphrase or summarize away
   detail; the precise text names the file, line, and condition that failed.
2. Reproduce deterministically. Find the smallest command that triggers the
   failure every time, for example the repository's test command scoped to the
   failing case. Record it. If the failure is intermittent, treat it as a
   nondeterminism problem and read [references/flaky-tests.md](references/flaky-tests.md).
3. Establish the search space. Note what changed recently, what environment
   differs from a known-good state, and which components sit between the input
   and the failing output.
4. Form one falsifiable hypothesis. State it concretely: the value is wrong
   because a specific thing happens at a specific place. A hypothesis you cannot
   prove false is not useful.
5. Test the hypothesis with the smallest possible probe. Add instrumentation or
   a breakpoint at a component boundary, or bisect the input, the history, or
   the code path. Confirm or reject the hypothesis before forming the next one.
6. Trace the bad state backward. Follow the incorrect value from where it
   surfaces to where it originates. The first place the state becomes wrong is
   the root cause, not the last place it is observed. See
   [references/root-cause-tracing.md](references/root-cause-tracing.md).
7. Fix the cause. Correct the origin of the bad state, not the symptom
   downstream. Suppressing an error, clamping a wrong value, or special-casing
   the observed input treats the symptom.
8. Add a regression test that fails without the fix and passes with it. This
   proves the diagnosis and prevents recurrence.
9. Confirm the original reproduction now passes. Run the exact command from
   step 2, then run the surrounding tests to check for collateral damage.

## Forbidden approaches

- Shotgun edits: changing several things at once hoping one works. You will not
  know which change mattered or why.
- Try-things-until-it-works: each blind change is unverified and may mask the
  defect while leaving it present.
- Fixing the symptom: catching and swallowing the exception, clamping a bad
  value, or retrying without understanding why the value was wrong.
- Claiming a fix without rerunning the reproduction command.

## When to stop and reconsider

If repeated fixes keep exposing new failures in unrelated areas, stop patching.
This signals a wrong mental model or an architectural coupling problem. Return
to step 3, widen the search space, and compare against a known-good state.

## Output

Report the reproduction command, the captured error, the confirmed root cause,
the fix, the regression test, and the passing verification output. Note any
remaining uncertainty.

## References

- [references/root-cause-tracing.md](references/root-cause-tracing.md) — binary
  search, bisecting, instrumentation, reading stack traces, and differential
  diagnosis against a known-good state.
- [references/flaky-tests.md](references/flaky-tests.md) — diagnosing
  nondeterminism, condition-based waiting, seeding randomness, isolating shared
  state, and timeout diagnostics.

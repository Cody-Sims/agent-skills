---
name: test-driven-development
description: "Implements behavior through a verified red-green-refactor cycle. Use when adding a feature, fixing a reproducible bug, changing behavior, or explicitly working test-first; not for auditing existing test credibility or behavior-preserving cleanup alone."
license: MIT
metadata:
  version: "1.1.0"
  author: "Cody-Sims"
  tier: "core"
---

# Test-Driven Development

## Contract

Inputs: agreed behavior/acceptance criteria, existing test conventions, and the
repository runner. Write a behavior test and observe its expected failure
**before production implementation**. An unobserved red step is not TDD evidence.

## Workflow

1. Read applicable instructions, the target interface, and nearby tests. Choose
   one small observable behavior. Use existing test files/tooling and the lowest
   level that proves it: unit for logic, integration for boundary collaboration,
   end-to-end only for critical flows. No automatic worker or broad repository
   exploration is needed for a known test/change site.
2. **Red:** write the smallest public-interface test for that behavior. Run the
   focused case with the repository runner and inspect the failure. It must fail
   because behavior is missing, not because of syntax, imports, missing tools,
   or an unrelated failure. Resolve authorized setup/test defects and rerun;
   do not implement production behavior until the intended red is observed.
3. **Green:** implement only what the test requires. Run the focused case, then
   affected surrounding tests, and inspect actual results. A failure means the
   cycle is not green; do not weaken the assertion to obtain a pass.
4. **Refactor:** improve names, structure, or duplication without new behavior.
   Rerun affected tests after each structural edit. Additional behavior starts
   another red step. Repeat one behavior at a time.
5. Inspect the diff and run final affected tests plus repository-required gates.
   Combine related selectors; do not rerun an unchanged full suite merely for
   narration or handoff. Preserve red/green evidence for each behavior and report
   unavailable validation rather than assuming it passes.

## Test quality

- Assert observable outcomes, not internal calls unless the interaction is the
  contract. Use specific values and one clear behavior per test; cover relevant
  branches, boundary/empty inputs, and error cases.
- Seed/reset randomness, inject time, reset shared/global state, and await
  observable conditions with bounded timeouts instead of fixed sleeps.
- Avoid assertions that restate implementation or cannot realistically fail.
  Do not test libraries/language features, trivial getters/constants/pass-through
  code, or private structure that should remain free to change.
- Read [test design](references/test-design.md) when choosing levels, isolating
  nondeterminism, or assessing assertions/coverage needs deeper guidance.

## Stop and output

Stop if intended red or required green cannot be established. Strict TDD may be
skipped only for generated code, throwaway exploration, or configuration-only
changes **and** only with repository-policy or user permission; state the
exception and remaining validation. Never silently skip ordinary behavior tests.

Report behaviors specified, command/failure evidence for expected red, green
results, final affected-test/gate results, and blockers. Do not claim a cycle
completed when it failed for the wrong reason.

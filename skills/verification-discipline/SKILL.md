---
name: verification-discipline
description: Audits and hardens existing tests and validation so green results are meaningful by detecting vacuous assertions, copied production logic, unbounded checks, unenforced invariants, and build impurity. Use when reviewing suspicious green tests, repairing test credibility, or hardening CI gates; do not use for ordinary test-first feature implementation or routine final gate selection.
license: MIT
metadata:
  version: "1.0.0"
  author: Cody-Sims
  tier: experimental
---

# Verification Discipline

Make validation credible: a green test must be able to catch the bug it claims to
cover, and a failing test is a finding rather than a nuisance.

## Start

1. Read the repository and path-specific testing instructions before editing tests.
2. Identify the behavior, invariant, or build property that must be protected.
3. Run the narrow existing test or command first to understand the baseline.
4. Load [references/red-green-proof.md](references/red-green-proof.md) when adding
   or strengthening a test.
5. Load
   [references/invariant-and-gate-patterns.md](references/invariant-and-gate-patterns.md)
   when turning scripts into CI-enforced checks, adding timeouts, adopting
   report-only gates, or checking build purity.

## Rules

- Prove the test can fail: temporarily break the production behavior, confirm the
  focused test goes red, restore the behavior, and report the proof.
- Never weaken or mock away an assertion to make the suite green. A failing test
  is evidence to investigate.
- Do not copy the production implementation into the test. Assert externally
  visible behavior, fixed examples, independent fixtures, or invariants.
- Strengthen weak assertions before trusting them. Checking only that an action
  returned a name or avoided a throw often misses the actual behavior.
- Put durable invariants in tests that run under a required gate, not in scripts
  that no gate invokes.
- Give CPU-bound tests explicit timeouts so parallel load does not create
  spurious failures.
- Treat build dirtiness as a defect or an explicit gate decision: compare the
  worktree before and after build commands and inspect generated tracked output.

## Finish

Run the focused proof, then the repository's relevant full gate. Report the
red-green proof, any assertion that exposed a production bug, any timeout or
report-only gate added, and whether the build left the worktree clean.

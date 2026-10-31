---
name: verification-discipline
description: "Audits and hardens existing tests and CI gates against vacuous assertions, copied production logic, unbounded checks, unenforced invariants, and dirty builds. Use when investigating suspicious green tests, repairing test credibility, or enforcing validation; not for ordinary test-first features or routine completion checks."
license: MIT
metadata:
  version: "1.1.0"
  author: "Cody-Sims"
  tier: "experimental"
---

# Verification Discipline

A green test must catch its claimed bug. Never weaken assertions, broaden mocks,
skip cases, or copy production logic to obtain green; failures are findings.

## Workflow

1. **Bound the proof.** Read applicable testing instructions; name the protected
   behavior/invariant/build property. Run the narrow existing baseline and inspect
   its production call/assertion. Stay within this target; do not chase coverage.
2. **Strengthen observation.** Assert externally visible behavior, fixed examples,
   independent fixtures, or invariants through the real module, not just names,
   return types, or absence of a throw. Read
   [red-green proof](references/red-green-proof.md) when adding/strengthening
   assertions or investigating vacuity.
3. **Prove sensitivity.** Mutate production reversibly; the focused test must fail
   on the intended assertion, then pass after restoring only that mutation. Never
   overwrite unrelated work or commit the mutation. If unsafe, mark proof blocked.
   Still-green mutants need stronger tests; real bugs need fixes or blockers,
   never looser expectations.
4. **Enforce relevant gates.** Required gates must invoke durable invariant tests,
   not leave them in unused scripts. Bound CPU workloads and set explicit
   per-test timeouts. Compare worktree before/after builds and inspect tracked
   churn: a defect or explicit owning-gate decision, not consent to reset unrelated
   work. Read
   [invariant and gate patterns](references/invariant-and-gate-patterns.md) for CI
   enforcement, timeouts, report-only adoption, or build purity.
5. **Verify and stop.** Run the focused proof, then the relevant full gate on final
   state, not repeated unchanged gates. Return behavior, commands/results,
   mutation/red-green evidence, exposed bugs, timeout/report-only changes, and
   build cleanliness relative to baseline. Mark unrun/failed checks blocked;
   green alone is not credibility.

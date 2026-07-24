---
name: test-driven-development
description: Drives implementation with the red-green-refactor cycle by writing a failing behavior test first, confirming it fails for the expected reason, implementing the minimum code to pass, then refactoring while green. Use when adding a feature, fixing a bug with a reproducible case, changing behavior, or whenever tests should precede or guide the implementation.
license: MIT
metadata:
  version: "1.0.0"
  author: Cody-Sims
  tier: core
---

# Test-Driven Development

## Goal

Produce correct, well-specified code by writing a test for observable behavior
before the implementation, then letting the failing test drive the smallest
change that satisfies it.

## Core rule

Write the test first and watch it fail before writing production code. A test
you never saw fail proves nothing; it may pass for the wrong reason or test
nothing at all.

## The cycle

### Red

1. Choose one behavior to specify. Keep it small and observable.
2. Write the smallest test that asserts that behavior through the public
   interface, not the internals.
3. Run the test with the repository's test command.
4. Confirm it fails, and confirm it fails for the expected reason: the behavior
   is missing, not a typo, import error, or unrelated failure. Read the failure
   message to verify.

### Green

1. Write the minimum production code that makes the test pass. Resist adding
   behavior the test does not require.
2. Run the focused test and confirm it passes.
3. Run the affected surrounding tests to confirm nothing regressed.

### Refactor

1. Improve names, structure, and duplication while the tests stay green.
2. Do not add behavior during refactor; that is a new Red step.
3. Re-run the tests after each structural change.

Repeat the cycle one behavior at a time.

## Choosing the test level

- Prefer the lowest level that can observe the behavior. Unit tests for logic
  and branching; integration tests for collaboration across boundaries;
  end-to-end tests sparingly for critical user flows.
- Do not write a slow, broad test when a fast, narrow one proves the same thing.
- Test through public interfaces so tests survive refactoring.

## Deterministic tests

Nondeterministic tests are worse than no tests because they train people to
ignore failures.

- Seed every random source and reset it before each test.
- Do not depend on the wall clock, timezone, or real dates; inject the time.
- Reset singletons, shared caches, and global state between tests.
- Wait for conditions, not fixed durations.

See [references/test-design.md](references/test-design.md) for detail.

## Meaningful assertions

- Assert the actual observable outcome, not that a function was merely called.
- Prefer one clear behavioral assertion per test over many incidental ones.
- Avoid ceremonial assertions that restate the implementation or always pass.
- A useful test can fail; if no realistic change could make it fail, delete it.

## What not to test

- Third-party libraries and language features.
- Trivial getters, constants, and pass-through code with no logic.
- Exact internal structure that should be free to change during refactoring.

Concentrate tests on behavior, branching, edge cases, and error handling.

## Exceptions

Skip strict TDD only for generated code, throwaway exploration, or
configuration-only changes, and only when repository policy or the user allows
it. Do not decide silently to skip tests for ordinary behavior changes.

## Output

Report the behaviors specified, the failing-then-passing evidence for each, and
the final passing run of the affected tests.

## References

- [references/test-design.md](references/test-design.md) — test levels,
  determinism techniques, assertion quality, and coverage judgment.

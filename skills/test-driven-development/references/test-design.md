# Test Design

Deeper guidance for choosing test levels, keeping tests deterministic, writing
meaningful assertions, and deciding what deserves a test.

## Contents

- Choosing the right level
- Structuring a test
- Determinism techniques
- Assertion quality
- Coverage judgment

## Choosing the right level

Match the test to the behavior you need to observe, at the lowest level that can
observe it.

- Unit: a single function, branch, or calculation in isolation. Fast and
  numerous. Use for logic, edge cases, and error handling.
- Integration: several units collaborating across a real boundary, such as a
  module talking to a store or parser. Use when the contract between components
  is the risk.
- End-to-end: a full user-visible flow through the running system. Slow and
  brittle; reserve for a few critical paths.

A common failure is testing everything end-to-end. Broad tests are slow, flaky,
and vague about what broke. Push each behavior to the lowest level that still
proves it.

## Structuring a test

1. Arrange: build only the state this behavior needs. Avoid shared fixtures that
   hide dependencies.
2. Act: exercise one behavior through the public interface.
3. Assert: check the observable outcome.

Keep the three phases visible. Name the test after the behavior and the expected
result so a failure reads as a specification.

## Determinism techniques

- Randomness: inject a seeded generator or set a fixed global seed in setup. Log
  the seed so a failure can be replayed.
- Time: inject a clock or fixed timestamp. Never assert against the current wall
  clock, and do not rely on local timezone.
- Shared state: reset singletons, module caches, and global registries before or
  after each test. Give each test unique keys, ports, and temporary paths.
- Ordering: do not depend on test execution order or on unordered collection
  iteration order. Sort before asserting when order is not guaranteed.
- Async: await all work and wait for an observable condition on a bounded
  timeout rather than sleeping a fixed duration.
- External resources: stub or isolate network, filesystem, and clock so a test
  does not depend on the environment.

## Assertion quality

- Assert the outcome a user or caller can observe, not an internal call count,
  unless the interaction itself is the contract.
- Prefer specific expected values over loose checks like not-null or
  greater-than-zero when the exact value is known.
- One behavior per test keeps failures diagnosable. Multiple unrelated
  assertions in one test hide which expectation broke.
- Include at least one edge and one error case for logic with branches: empty
  input, boundary values, and invalid input.
- A ceremonial assertion restates the implementation or cannot fail. Replace it
  with one that pins real behavior, or remove it.

## Coverage judgment

Coverage measures executed lines, not verified behavior. High coverage with weak
assertions gives false confidence.

- Test behavior and contracts, not private structure that refactoring will
  change.
- Do not test third-party libraries, language features, trivial accessors, or
  constants.
- Prioritize the code most likely to break: complex branching, calculations,
  parsing, state transitions, and error paths.
- If a test would never fail under any realistic change, it adds maintenance
  cost without protection. Delete it.

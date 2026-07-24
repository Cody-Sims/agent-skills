# Flaky Tests

A flaky test passes and fails without any code change. Flakiness is a defect in
the test or the system under test, not random misfortune. Diagnose it like any
other bug: make it reproducible, then remove the source of nondeterminism.

## Contents

- Make the flake reproducible
- Common sources of nondeterminism
- Replace arbitrary sleeps with condition-based waiting
- Seed randomness
- Isolate shared state
- Timeout diagnostics

## Make the flake reproducible

1. Run the single test in a loop until it fails, capturing output each run.
2. Run it in isolation and as part of the full suite. A test that passes alone
   but fails in the suite points to shared state or ordering.
3. Vary test order. Many runners can randomize order; a failure that depends on
   order confirms cross-test coupling.
4. Record the failing seed, order, and timing so the failure can be recreated.

## Common sources of nondeterminism

- Timing and arbitrary sleeps that assume an operation finished.
- Unseeded randomness.
- Wall-clock or timezone dependence.
- Shared mutable state, singletons, or global caches not reset between tests.
- Test-order dependence and leaked state from a prior test.
- Unawaited asynchronous work that completes after the assertion.
- External resources: network, filesystem, clock, and ports.
- Iteration over unordered collections where order is not guaranteed.

## Replace arbitrary sleeps with condition-based waiting

A fixed sleep is either too short, causing flakiness, or too long, wasting time.
Wait for the actual condition instead.

1. Identify the observable condition that means the work is done: a value
   present, an element visible, a queue empty, a file written.
2. Poll that condition on a short interval up to a bounded timeout, and proceed
   the instant it holds.
3. On timeout, fail with a message that reports what was expected and what was
   actually observed, so the failure is diagnosable.
4. Prefer a framework's built-in waiter or a small bounded poll helper over a
   raw sleep. Never wait unbounded.

## Seed randomness

1. Set a fixed seed for every random source the test touches before it runs.
2. Reset the seed in setup so each test starts from the same point.
3. Log the seed on failure so a specific failing case can be replayed.
4. If the code reads randomness from a global generator, inject a seeded
   generator instead so the test controls it.

## Isolate shared state

1. Reset singletons, module-level caches, and global registries in setup or
   teardown.
2. Give each test its own fixtures, temporary directories, and unique keys.
3. Avoid depending on state a prior test created; construct what the test needs.
4. Restore any global configuration or environment value the test changes.
5. If two tests contend for the same resource, isolate the resource or serialize
   access rather than adding a sleep.

## Timeout diagnostics

1. When a test times out, determine whether the work never started, never
   finished, or finished after the assertion. Instrument the boundary to tell
   these apart.
2. Distinguish a real deadlock from a timeout that is merely too tight for a
   slow environment.
3. Make timeout failures print the pending operation, the last observed state,
   and elapsed time rather than only reporting that time expired.
4. Fix the cause of the delay; do not merely raise the timeout, which hides the
   defect and slows the suite.

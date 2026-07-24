# Review Checklist

Per-axis checks for a thorough review. Apply the ones relevant to the change;
not every item applies to every diff. Anchor each finding to a `file:line`.

## Contents

- Correctness
- Tests
- Error and edge cases
- Security
- Performance
- Readability and maintainability
- Architecture and boundaries

## Correctness

- Boundary values: empty, zero, one, negative, maximum, and off-by-one.
- Conditionals: inverted logic, wrong operator, unreachable or always-true branches.
- Null, undefined, and missing keys handled where they can occur.
- Ordering and sorting assumptions hold for unordered sources.
- Concurrency: shared mutable state, race conditions, and non-atomic updates.
- State transitions cover every reachable case, including the error path.
- Return values and status codes match the documented contract.

## Tests

- New behavior has a test that fails without the change.
- Tests assert observable outcomes, not just that code ran.
- Edge and error cases are covered, not only the happy path.
- Tests are deterministic: seeded randomness, injected time, reset shared state.
- No test is disabled, skipped, or weakened to make the change pass.
- Assertions are specific rather than loose or ceremonial.

## Error and edge cases

- Errors are handled or propagated, never silently swallowed.
- Input is validated at trust boundaries before use.
- Resources are released on both success and failure paths.
- Failure messages are actionable and do not leak sensitive data.
- Partial failure leaves the system in a consistent state.

## Security

- Untrusted input is validated and encoded before reaching a sink such as a
  query, a shell, a filesystem path, or rendered output.
- Authorization is checked for every privileged operation, not only in the UI.
- No secrets, tokens, or credentials in source, logs, or error messages.
- No unsafe deserialization, dynamic code execution, or template injection.
- New dependencies are necessary, pinned, and from a trusted source.
- External and model-generated data is treated as untrusted boundary input.

## Performance

- No accidental quadratic or worse loops over large inputs.
- No repeated work or per-item queries that could be batched (N+1).
- No unbounded memory growth, caches without eviction, or leaked handles.
- Expensive work is kept out of hot paths and tight loops.
- Flag only measurable, realistic impact; avoid speculative micro-optimization.

## Readability and maintainability

- Names describe intent; no misleading or abbreviated identifiers.
- Functions have a single clear responsibility and reasonable length.
- No duplicated logic that should be shared, and no dead code left behind.
- Comments explain why, not what, and match the code.
- Complex logic is structured so the next reader can follow it.

## Architecture and boundaries

- The change respects existing layering and does not bypass an interface.
- No new tight coupling or circular dependency between modules.
- Shared logic lives in the right layer, not duplicated across boundaries.
- Public interfaces and data contracts remain compatible or are versioned.
- The change follows established conventions in the surrounding code.

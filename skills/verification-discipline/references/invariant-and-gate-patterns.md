# Invariant and Gate Patterns

Use this reference for architectural invariants, expensive checks, report-only
linters, and build-purity validation.

## Enforce invariants with tests

A script that no required command runs is only documentation. Put durable checks
under the repository's normal test tree so its required suite enforces them.

## Add explicit timeouts for CPU-bound tests

Default timeouts can be too short when a test parses many source files or performs
heavy graph work under parallel load. Use the test runner's per-test timeout for
bounded CPU-heavy checks rather than raising every test's limit.

For example, Vitest accepts a third argument on `it`, and Playwright supports
`test.setTimeout(...)`. Keep the workload bounded even after increasing a timeout.

## Adopt new gates report-only first

When a new linter or formatter reveals a large existing backlog, make it visible
without blocking unrelated work. A report-only gate may emit warnings while
exiting zero. Do not convert it into a blocking error gate until the backlog is
burned down or the command is scoped to new violations.

## Verify build purity

Builds should not leave tracked files dirty unless the repository's gate explicitly
accepts and cleans generated churn:

```bash
git status --short
# Run the repository's build command.
git status --short
git diff -- path/to/generated-output
```

If a build changes tracked assets, determine whether a generator used wall-clock
time, nondeterministic ordering, environment-specific paths, or a stale checked-in
artifact. Fix determinism when possible; otherwise make the owning gate discard or
verify the accepted generated output deliberately.

# Red-Green Proof Reference

Use this reference whenever a test is added, strengthened, or suspected of being
vacuous.

## Focus the target

Run the smallest command that exercises the test. For example:

```bash
npm run test -- tests/unit/example.test.ts -t "behavior name"
```

Replace the example command with the repository's test runner, real path, and test
name. Keep the full suite for the final gate.

## Prove it fails for the right reason

1. Make the smallest temporary production mutation that should violate the new
   assertion.
2. Run the focused command and confirm it fails on the intended assertion.
3. Restore only the deliberate mutation before continuing. Do not overwrite
   unrelated user work.
4. Run the focused command again and confirm it passes.
5. Record the proof, for example: "Temporarily removed the stat-stage reset; the
   reset assertion failed; restored it and the test passed."

Do not commit the temporary mutation. If the test stays green while the behavior
is broken, the test is not proving the behavior and must be rewritten.

## Avoid green lies

- Do not re-implement the formula, state machine, parser, or selector from the
  production module inside the test.
- Do not assert only metadata such as a name, event, hit flag, or return type when
  the behavior is a state change.
- Do not satisfy a failing test by broadening mocks until the assertion no longer
  observes production behavior.
- Prefer fixed fixtures with known outcomes, boundary examples, property-level
  invariants, and calls into the real module under test.

## Treat failures as findings

When a strengthened assertion reveals a real bug, fix the production bug or report
it as blocked. Do not rename keys, skip cases, loosen expectations, or move the
assertion into a mock simply to make the command green.

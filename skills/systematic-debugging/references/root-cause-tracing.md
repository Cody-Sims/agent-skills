# Root-Cause Tracing

Techniques for narrowing a failure to its origin and proving where the state
first becomes wrong.

## Contents

- Reading a stack trace
- Binary search on input
- Bisecting history
- Instrumentation at boundaries
- Differential diagnosis against a known-good state
- Partial or uncertain mutations

## Reading a stack trace

1. Read from the top frame down. The top frame is where the error surfaced; it
   is often not where the defect lives.
2. Find the deepest frame inside your own code. That frame usually holds the
   call that passed bad state into the failing operation.
3. Note the exception type and message together. The same message can arise from
   different causes; the type and the frame narrow it.
4. For a wrapped or re-thrown error, follow the cause chain to the original
   throw site.
5. Record the file and line of each frame you suspect before changing anything.

## Binary search on input

When a large input triggers a failure and a small one does not:

1. Remove or disable half the input. Re-run the exact reproduction and compare
   the failure signature, not just the exit code.
2. Keep a reduction only when it preserves the target failure. If it passes,
   test the removed half separately; disappearance alone does not locate a cause.
3. If both halves pass, retain their interacting combination and try smaller
   removals. Do not discard either half as irrelevant.
4. Repeat while preserving the failure. A minimal reproducer narrows the
   conditions; trace the state divergence before naming the cause.

The same halving applies to configuration, feature flags, and data records.

## Bisecting history

When the failure is new and a past state worked:

1. Identify a known-good revision and a known-bad revision.
2. Use a clean, authorized checkout isolated from concurrent work. Do not switch
   revisions in a shared or dirty working tree. Check out the midpoint there and
   run the reproduction command.
3. Mark good only after the target check actually passes; mark bad only for the
   same target failure. Missing tools, incompatible dependencies, or an
   unbuildable midpoint are untestable: skip them or abort to repair the harness.
4. For deterministic `git bisect run <command>`, map a genuine pass to exit 0,
   the matched target failure to 1, and an untestable revision to 125. Abort on
   unclassified harness errors; arbitrary nonzero exits are not regression proof.
5. The first bad revision names the change that introduced the defect. Read its
   full diff; the cause is usually there, even if the symptom is elsewhere.

## Instrumentation at boundaries

Place probes where data crosses a component boundary, not randomly:

1. Log or inspect the value as it enters a function and as it leaves.
2. Compare the observed value against the expected value at each boundary.
3. The boundary where expected and observed first diverge contains the defect.
4. Prefer temporary structured logging or a debugger over scattered prints, and
   remove instrumentation once the cause is found.
5. Log the value, its type, and its shape. A defect is often a wrong type,
   an empty collection, or a null where a value was assumed.

## Differential diagnosis against a known-good state

When behavior differs between two environments, revisions, or inputs:

1. Fix everything you can and vary one factor at a time.
2. Compare dependency versions, configuration, environment values, and data.
3. List every difference, then eliminate them one by one until the behavior
   changes. The factor that flips the behavior is the cause.
4. Keep the known-good state runnable so you can re-compare after each step.

## Partial or uncertain mutations

1. Preserve the error and reported applied/pending effects. A failed tool call
   or statement batch does not prove unchanged state or rollback.
2. Inspect affected diff/content or read-only state, including actual database
   schema and rows. Classify intended operations as applied, unapplied, or
   uncertain. Preserve unrelated/user changes; stop if state remains unknown.
3. Diagnose the failed operation, then retry only confirmed unapplied authorized
   work against current context. Never blindly replay the batch or roll back
   user work. Prefer transactions only when supported and authorized, and
   verify their actual outcome.
4. Rerun the diagnostic probe or regression after recovery before concluding.

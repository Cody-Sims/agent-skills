# Root-Cause Tracing

Techniques for narrowing a failure to its origin and proving where the state
first becomes wrong.

## Contents

- Reading a stack trace
- Binary search on input
- Bisecting history
- Instrumentation at boundaries
- Differential diagnosis against a known-good state

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

1. Remove or disable half the input. Re-run the reproduction.
2. If the failure persists, the cause is in the remaining half; if it
   disappears, it is in the removed half.
3. Repeat on the failing half until a minimal reproducing input remains.
4. The minimal input names the exact condition the code mishandles.

The same halving applies to configuration, feature flags, and data records.

## Bisecting history

When the failure is new and a past state worked:

1. Identify a known-good revision and a known-bad revision.
2. Check out the midpoint and run the reproduction command.
3. Mark the midpoint good or bad and repeat on the remaining range.
4. `git bisect run <command>` automates this when the command exits nonzero on
   failure. Ensure the command is deterministic first.
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

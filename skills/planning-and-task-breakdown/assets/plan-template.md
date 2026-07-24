# Plan: TITLE

Source specification: LINK OR PATH
Author: NAME
Date: YYYY-MM-DD

## Execution Order

List task IDs in the order they must run. Group IDs that may run in parallel.

- Sequential: 1, then 2
- Parallel after 2: 3, 4, 5
- Final: 6

## Parallelizable Sets

- Set A (after Task 2): Task 3, Task 4, Task 5. Disjoint file sets, no shared
  write targets.

## Task 1: SMALL OUTCOME

Purpose: why this task exists.

Dependencies: tasks or interfaces that must exist first, or none.

Files likely touched:

- path/to/file

Acceptance criteria:

- [ ] Observable result that proves completion.

Verification:

- [ ] Exact command or inspection to run now.

Scope: XS, S, or M.

## Task 2: SMALL OUTCOME

Purpose:

Dependencies:

Files likely touched:

- path/to/file

Acceptance criteria:

- [ ] Observable result.

Verification:

- [ ] Exact command or inspection.

Scope:

## Risks

- Dependency, coverage, or coupling risk that remains, and how to handle it.

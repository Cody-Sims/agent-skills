# Plan: TITLE

Source specification: LINK OR PATH
Author: NAME
Date: YYYY-MM-DD
Integration-gate owner: NAME
Shared manifests/changelog owner: NAME

## Execution Order

List task IDs in the order they must run. Group IDs that may run in parallel.

- Sequential: 1, then 2
- Parallel after 2: 3, 4, 5
- Final: 6

## Parallelizable Sets

- Set A (after Task 2): Task 3, Task 4, Task 5. Disjoint write boundaries;
  shared validation resources are isolated or serialized as recorded below.

| Shared resource | Owning tasks | Isolation or serial order |
|---|---|---|
| Output directory, database, cache, port, or CPU-heavy runner | IDs | Separate instance/path or exact order |

## Task 1: SMALL OUTCOME

Purpose: why this task exists.

Dependencies: tasks or interfaces that must exist first, or none.
Owner: NAME
Exclusive write boundary: paths this owner may change.
Validation resources: isolated paths/instances or required serialization.

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
Owner:
Exclusive write boundary:
Validation resources:

Files likely touched:

- path/to/file

Acceptance criteria:

- [ ] Observable result.

Verification:

- [ ] Exact command or inspection.

Scope:

## Risks

- Dependency, coverage, or coupling risk that remains, and how to handle it.

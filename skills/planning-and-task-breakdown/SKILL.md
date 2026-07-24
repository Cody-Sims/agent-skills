---
name: planning-and-task-breakdown
description: "Decomposes an approved specification into small, ordered, dependency-aware tasks, each with explicit acceptance criteria and a verification command, and identifies which tasks are independent and safely parallelizable without overlapping writes. Use when planning multi-step work, breaking a spec or feature into tasks, sequencing dependencies, or coordinating parallel agents, after requirements are agreed and before implementation begins."
license: MIT
metadata:
  version: "1.0.0"
  author: "Cody-Sims"
  tier: "core"
---

# Planning and Task Breakdown

Turn an agreed specification into a task plan that is small, ordered,
verifiable, and safe to execute in parallel where possible.

## Goal

Produce an ordered task list where each task is a small outcome with acceptance
criteria and a verification command, and where parallelizable tasks are marked
and free of overlapping writes.

## Inputs

- Required: an approved specification or a clear, agreed set of requirements.
- Optional: repository structure and existing conventions the plan must respect.
- Output: a task plan following the format below. Copy
  [the plan template](assets/plan-template.md) to start.

If requirements are still ambiguous, resolve them first; do not plan against an
unclear target.

## Workflow

1. List the outcomes the specification requires. Restate each as a small,
   independently verifiable result.
2. Split large outcomes. A task whose title needs multiple independent clauses,
   or that touches unrelated subsystems, is too big; break it into vertical
   slices that each deliver a checkable result.
3. Map dependencies. For each task, name the tasks or interfaces that must exist
   first. Order the list so every dependency precedes its dependents.
4. Write acceptance criteria per task as observable results, not intentions.
5. Write a verification command or inspection per task, so completion can be
   proven with fresh evidence rather than assumed.
6. Identify the files each task is likely to touch. Two tasks that write the same
   file are not independent.
7. Mark parallelizable tasks. A set is safely parallel only when the tasks share
   no dependency ordering and no write target. Assign each parallel worker a
   disjoint set of files and an explicit no-edit boundary.
8. Sequence the rest. Keep dependent tasks in order and note where a task must
   wait for another to complete.
9. Review the plan for coverage against the specification and for hidden coupling
   between supposedly parallel tasks before execution begins.

## Task shape

Each task states:

- Purpose: why the task exists.
- Dependencies: tasks or interfaces required first.
- Files likely touched: the paths the task writes.
- Acceptance criteria: observable results that prove completion.
- Verification: the exact command or inspection that checks it.
- Scope: a rough size such as XS, S, or M. Split anything larger than M.

## Parallelization rules

- Parallelize only tasks with no dependency between them.
- Never assign overlapping write targets to two workers; overlapping writes
  cause lost edits and merge conflicts.
- Give each parallel worker complete scope, its file set, and an explicit list of
  paths it must not touch.
- Consolidate parallel results before integration, and verify the combined change
  once, not only each worker's slice.

## Decision points

- A task cannot be verified: rewrite it until it has an observable acceptance
  check, or split off the unverifiable part as an open question.
- Two parallel tasks share a file: serialize them, or refactor so each owns a
  distinct file.
- A dependency chain is long and fragile: add an intermediate task that produces
  a checkable interface the later tasks build on.

## Validation

Before declaring the plan ready:

- Every task is small, ordered, and has acceptance criteria and a verification
  command.
- Dependencies are explicit and the order respects them.
- Parallel tasks share no write target and no ordering dependency.
- The tasks together cover the specification with no gap.

## Output format

Return the ordered task list, the subset marked safe to parallelize with their
disjoint file sets, and any dependency or coverage risk that remains.

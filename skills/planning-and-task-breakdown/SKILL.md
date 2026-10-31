---
name: planning-and-task-breakdown
description: "Plans approved multi-step work as verifiable outcomes with dependencies, file ownership, and safe parallel boundaries. Use when breaking down an agreed spec, sequencing delivery, or coordinating parallel tasks; not for unresolved requirements or a small direct edit."
license: MIT
metadata:
  version: "1.1.0"
  author: "Cody-Sims"
  tier: "core"
---

# Planning and Task Breakdown

Turn agreed requirements into the smallest useful execution plan. A clear edit
answerable in two to five direct calls does not need a task tree or workers.

## Workflow

1. Confirm the target is agreed. Resolve consequential ambiguity before planning;
   do not ask again for requirements already supplied.
2. List independently verifiable outcomes and what existing behavior must remain.
   Split large or unrelated outcomes into vertical slices, not one task per
   command, file read, or checklist item.
3. For each task record: ID, purpose, true prerequisites, owned files, observable
   acceptance criteria, exact verification command or inspection, and size.
   Split anything larger than a medium task; make unverifiable work an open
   question rather than a completion claim.
4. Check dependencies and coverage. Order prerequisites before dependents;
   introduce an intermediate interface task only when it reduces real coupling.
5. Mark safe parallel sets. Independence requires no ordering dependency,
   overlapping writes, or shared mutable validation resources. Tasks sharing
   generated output, temporary directories, ports, or build state must be
   isolated or serialized. Assign one owner to shared integration/release gates.
6. Choose execution granularity. Independence permits delegation; it does not
   require it. Keep cheap or continuous work local unless delegation is requested.
   Use workers for substantial independent scopes when coordination costs are
   justified; faster wall-clock work can still consume more model interactions.
7. Give each worker its context, owned paths, no-edit boundaries, prerequisites,
   narrow checks, and stop condition. Keep shared files such as changelogs with
   one coordinator. Do not duplicate the worker's investigation in the parent.
8. Require a nonempty handoff: done/partial/blocked, changes and artifact paths,
   exact checks/results, and unresolved risks. Use completion notifications when
   available rather than polling; follow up with the known worker only for the
   same task. Preserve this checkpoint on pause and inspect state before resuming.
9. Consolidate results, inspect the combined change, and run shared gates once
   after integration unless repository rules require intermediate gates. Do not
   treat successful worker checks as proof of integrated correctness.

## Output

Return the ordered task list, safe parallel sets with exclusive ownership, and
remaining dependency or coverage risks. Use a compact table when sufficient.
Use [the plan template](assets/plan-template.md) for a requested durable plan;
do not create an unrequested planning file.

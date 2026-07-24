---
name: codebase-exploration
description: "Builds a focused, evidence-based map of an unfamiliar repository before modifying it, locating entry points, build, test, and lint commands, architecture boundaries, conventions, the dependency graph, and the nearest agent instructions, then reading tests to learn intended behavior and finding the smallest correct change site. Use when onboarding to a new or unfamiliar codebase, orienting before a change, or answering how a project is structured and where to edit, while staying read-only."
license: MIT
metadata:
  version: "1.0.0"
  author: Cody-Sims
  tier: core
user-invocable: true
disable-model-invocation: false
---

# Codebase Exploration

Build a focused map of an unfamiliar repository before changing it, then identify
the smallest correct place to make the intended change. Stay read-only while
exploring: do not edit files, run mutating commands, or install dependencies to
answer a question. Prefer inspection over execution, and never assume a file,
command, or convention exists without confirming it.

## Goal

Produce a short orientation that a change can be built on:

* Where execution starts and how the project is built, tested, and linted.
* The main architecture boundaries and how they communicate.
* The conventions and agent instructions a change must follow.
* The intended behavior around the change, learned from tests.
* The smallest correct edit site, with evidence paths.

## Workflow

1. **Frame the task.** State what change or question motivates the exploration so
   the map stays scoped. Explore only what that goal requires.
2. **Locate agent instructions first.** Read the nearest applicable `AGENTS.md`,
   repository instructions, scoped instructions, and contributor guidance. These
   define conventions, commands, and boundaries the change must respect.
3. **Find entry points and commands.** Identify how the project starts and how it
   is built, tested, and linted. Read manifests, task runners, and scripts rather
   than guessing command names.
4. **Map architecture boundaries.** Identify the major modules, layers, or
   services and how they depend on and communicate with each other. Note the
   dependency direction and any obvious ownership.
5. **Learn conventions.** Observe naming, structure, error handling, logging, and
   test patterns already in use, so a change matches the codebase.
6. **Read the tests.** Use existing tests as the specification of intended
   behavior around the area of interest before proposing any change.
7. **Locate the change site.** Find the narrowest module, function, or file where
   the intended change belongs, and confirm nothing else must change with it.
8. **Report.** Deliver the map with evidence paths and clearly separated
   confidence levels.

Read [the exploration playbook](references/exploration-playbook.md) for a
repeatable order tuned to common project types when the layout is unclear.

## Read-Only Discipline

* Inspect files, search, and read command definitions instead of running them.
* Running a read-only build, test, or lint to learn behavior is acceptable only
  when it does not modify tracked files, write outside build directories, or
  install packages. Prefer reading configuration first.
* Do not change tracked files, git state, or remote state during exploration.
* If a question genuinely requires a mutating action, stop and report it as a
  next step rather than performing it.

## Evidence and Confidence

* Cite workspace-relative paths, and line ranges when useful, for every claim.
* Separate findings into three explicit groups:
  * **Verified:** directly supported by a cited file, command definition, or test.
  * **Inferred:** a reasonable conclusion from evidence, labeled as inference.
  * **Unknown:** not determined; state what would resolve it.
* Do not present inference as fact. Prefer a small verified map over a large
  speculative one.

## Output Format

Return:

1. The task frame and the scope explored.
2. Entry points and the exact build, test, and lint commands, with sources.
3. Architecture boundaries and the dependency graph at a useful level.
4. Conventions and the nearest applicable agent instructions.
5. Intended behavior learned from tests, with test paths.
6. The proposed smallest change site, with evidence.
7. Verified findings, inferences, and unknowns, kept separate.

---
name: refactoring-and-dead-code-removal
description: Changes code structure without changing behavior and removes unused code safely by establishing a passing baseline, making one mechanical change at a time, re-running tests between steps, and proving code is dead before deleting it. Use when cleaning up, simplifying, restructuring, extracting, renaming, or deleting suspected unused code, imports, functions, or files.
license: MIT
metadata:
  version: "1.0.0"
  author: Cody-Sims
  tier: core
---

# Refactoring and Dead-Code Removal

## Goal

Improve structure or remove unused code while preserving observable behavior
exactly, with test evidence at every step.

## Core rule

Refactoring never changes behavior. If a change alters what the program does, it
is a behavior change and belongs in a separate commit with its own tests. Keep
the two apart so a regression is easy to locate and revert.

## Workflow

1. Establish a passing baseline. Run the repository's test command and build
   before touching anything. If the baseline is not green, stop and fix or
   record that first; you cannot detect regressions against a broken baseline.
2. Ensure behavior is covered. If the code you will change lacks tests that pin
   its current behavior, add characterization tests first so a regression will
   surface.
3. Make one mechanical change at a time. Rename, extract, inline, or move a
   single thing. Prefer the language or IDE's automated refactoring tools, which
   preserve behavior more reliably than manual edits.
4. Re-run tests between steps. After each change, run the affected tests. A
   failure isolates the single step that caused it.
5. Keep refactoring and behavior change in separate commits. Never mix them.
6. Review the diff. Confirm it only restructures and does not alter logic,
   defaults, or outputs.

## Chesterton's Fence

Do not remove or change code until you understand why it exists. Code that looks
pointless often handles a case that is not obvious from a first reading.

1. Find out why the code is there: read history, related tests, comments, and
   linked issues.
2. If you cannot explain its purpose, assume it has one and investigate further
   rather than deleting it.
3. Only remove it once you can state what it did and why removing it is safe.

## Proving code is dead

Suspected-unused is not proven-unused. Gather evidence before deleting. See
[references/dead-code-evidence.md](references/dead-code-evidence.md).

1. Search for every reference to the symbol across the whole repository,
   including tests, configuration, string-based lookups, and dynamic access.
2. Check the call graph: confirm nothing reachable calls it, directly or through
   an interface, export, or reflection.
3. Confirm it is not part of a public API that external consumers depend on.
4. Remove it, then run the full test suite and build to confirm nothing breaks.
5. If removal is large or risky, deprecate first, then remove after confirming
   no use.

## Forbidden approaches

- Mixing a behavior change into a refactoring commit.
- Deleting code because it looks unused without reference and call-graph evidence.
- Refactoring against a red or unknown baseline.
- Large sweeping rewrites in a single step that cannot be verified incrementally.

## Output

Report the baseline result, each mechanical step taken, the evidence gathered
before any deletion, and the passing test and build output after the changes.

## References

- [references/dead-code-evidence.md](references/dead-code-evidence.md) —
  gathering reference, call-graph, and test evidence before removing code, and
  handling dynamic access and public APIs.

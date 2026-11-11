---
name: refactoring-and-dead-code-removal
description: "Refactors structure and removes proven dead code without changing observable behavior. Use when simplifying, extracting, renaming, moving, or deleting suspected unused code; requires a passing baseline and deletion evidence, not a defect fix or new behavior."
license: MIT
metadata:
  version: "1.1.1"
  author: "Cody-Sims"
  tier: "core"
---

# Refactoring and Dead-Code Removal

## Contract

Inputs: the structural cleanup scope, current behavior, and repository test/build
commands. Preserve observable behavior exactly. Behavior changes need separate
work, tests, and commits; this skill does not authorize committing.

## Workflow

1. Read applicable instructions. Run the repository test command and build
   before editing; record results. A red, missing, or unknown baseline blocks
   refactoring: resolve an authorized prerequisite or report it, not an unrelated
   repair. Reuse baseline evidence only while the relevant state is unchanged.
2. Understand the code's purpose through related tests, comments, history, and
   linked issues. Start with the target and its consumers; widen only for an
   unanswered dependency. If purpose is unclear, investigate rather than delete.
   Add characterization tests first where current behavior is not pinned.
3. Before any deletion, read
   [dead-code evidence](references/dead-code-evidence.md) and establish:
   - Repository-wide references, including aliases, re-exports, tests, fixtures,
     configuration, scripts, documentation, and string-based lookups.
   - Reachability through callers, interfaces, overrides, reflection, framework
     entry points, and dynamic/plugin registration.
   - Whether external consumers depend on a public export.
   Use symbol/call-graph tools plus targeted literal searches across relevant
   file types. Do not infer absence from truncated output or an unused-symbol
   warning alone. Unknown dynamic or external use means not proven dead.
4. Make one mechanical rename, extraction, inline, move, or proven deletion at
   a time; prefer automated refactoring tools. Remove dedicated tests only for
   proven-dead code, preserving tests of live behavior. For large/risky removals
   or uncertain external use, follow deprecation/version policy before removal.
5. Run affected tests after each step. On failure, isolate or revert that step
   without discarding others' changes; do not continue a sweeping rewrite.
   Keep behavior changes separate, even if they appear convenient.
6. Inspect the final diff for unchanged logic, defaults, outputs, public
   contracts, and unrelated edits. Run final affected tests/build and mandatory
   repository gates; after dead-code removal, the **full test suite and build**
   are required, not just focused tests. One final run may cover both obligations.

## Stop and output

Stop on an unverified baseline, unexplained purpose, uncertain deletion evidence,
or behavioral drift. Report baseline command/results, mechanical steps, deletion
evidence or deprecation decision, final test/build results, and remaining risk.
Never describe a suspected-unused symbol or an unrun check as verified.

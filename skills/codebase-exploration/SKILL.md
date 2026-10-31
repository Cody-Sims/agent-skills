---
name: codebase-exploration
description: "Maps unfamiliar code and locates change sites, scoped instructions, relevant tests, and validation commands. Use when onboarding, tracing an unknown change site, or explaining repository structure; not for a known-file edit with sufficient context. Stays read-only."
license: MIT
metadata:
  version: "1.1.0"
  author: "Cody-Sims"
  tier: "core"
---

# Codebase Exploration

Answer the bounded question or find the smallest correct edit site. Do not turn
local orientation into a full repository audit.

## Workflow

1. Define the question and stop condition. Reuse current context and prior
   evidence; revisit it only when changed, missing, or contradictory.
2. Read the applicable repository and path-scoped instructions. Locate declared
   commands in manifests or task runners; do not guess paths or command names.
3. Follow the relevant entry point or symbol to its callers, dependencies, and
   nearest tests. Learn the local conventions and preservation requirements.
   Map unrelated boundaries only when the user requests a repository-wide map.
4. Prefer code intelligence, then scoped file discovery and text search. Batch
   independent reads; request matching paths before contents, and ranges before
   full large files. Widen only when a concrete evidence gap requires it.
5. Keep a single continuous trace local. Delegate only substantial independent
   questions, not work answerable in two to five direct calls. Give each worker
   a question, scope, stop condition, and compact evidence contract. Consume its
   report instead of repeating the same exploration.
6. Stop when the question is answered or the edit site, dependent call sites,
   relevant tests, and validation commands are known. Report any unresolved
   gap rather than inventing an architecture or continuing an open-ended scan.

Use [the exploration playbook](references/exploration-playbook.md) only when
the layout or ecosystem is unclear. Its repository-wide order is not mandatory
for a local question.

## Boundaries

- Do not edit files, change git or remote state, or install dependencies.
- Prefer inspection to execution. Run a build, test, or lint only if it does not
  alter tracked files, install packages, or write outside build directories.
- For a running-system symptom, check relevant service readiness before treating
  startup lag as a code defect; do not perform an unrelated bootstrap audit.
- If answering requires mutation, report that boundary rather than performing it.

## Output

Return a compact evidence map: scope, repository state, change site, applicable
instructions, relevant behavior/tests, and exact validation commands with
`path:line` sources. Include boundaries only as needed. Label inference and
unknowns; do not present them as verified. Internal orientation need not become
a separate user-facing report or an unrequested file.

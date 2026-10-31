---
name: documentation-maintenance
description: "Updates README, API docs, architecture notes, ADRs, and changelogs to match current code. Use when a code/configuration change invalidates documentation, or when writing an ADR or changelog entry; not for new requirements or maintaining a .shadow decision graph."
license: MIT
metadata:
  version: "1.1.0"
  author: "Cody-Sims"
  tier: "core"
---

# Documentation Maintenance

## Contract

Inputs: the change or requested document, current implementation, and repository
documentation conventions. Update affected documentation, not application
behavior. Create only requested or change-required artifacts.

## Workflow

1. Read applicable instructions and the change. Identify affected README setup
   and commands, API signatures/errors/examples, architecture responsibilities
   and diagrams, ADRs, changelog, and nearby comments/docstrings.
2. Search likely documentation paths for changed names, commands, flags, paths,
   and values, including removed/renamed forms. Batch related searches and widen
   only where references lead. Resolve every identified contradiction; do not
   launch a worker or audit unrelated architecture for a small documentation fix.
3. Update, supersede, or delete stale passages instead of appending corrections.
   Explain relevant rationale and constraints, use terminology consistent with
   code, and use relative repository links. Verify claims against implementation,
   not an outdated change summary.
4. Handle records only when applicable:
   - **ADR:** for a significant, hard-to-undo decision or reversal, read
     [the ADR template](assets/adr-template.md). Record context/forces, decision,
     rejected alternatives, consequences/trade-offs, stable number, date, and
     status (proposed, accepted, superseded, deprecated). Do not invent acceptance
     or rewrite an accepted decision; supersede with a new linked ADR.
   - **Changelog:** for user-visible changes, read
     [the entry format](assets/changelog-entry.md) and add an unreleased entry
     using existing conventions. Classify as Added, Changed, Deprecated, Removed,
     Fixed, or Security; describe user impact and breaking-change migration.
     Skip purely internal, behavior-preserving changes unless policy requires it.
5. Check affected documented setup sequences and commands by running them safely
   or tracing each step exactly against current code. Compile/run affected code
   examples when possible. Record which checks ran versus were only traced;
   never claim an unexecuted example runs. Respect authorization and environment
   limits rather than running destructive setup or installing speculatively.
6. Read updated documents for internal consistency. For long documents, inspect
   edited sections, headings, and affected cross-references rather than rereading
   unrelated prose. Check relative links and search the affected documentation
   for stale identifiers. Run repository-required documentation gates; otherwise
   use existing focused link/example checks, not unrelated full application tests.

## Stop and output

Stop when affected documents agree with code and applicable checks are accounted
for. Report paths updated/superseded/deleted, ADR status changes, changelog entry,
commands/examples and actual results, and unresolved documentation gaps.
If a command or example cannot be checked, state the limitation and leave that
claim unverified; do not silently declare it runnable.

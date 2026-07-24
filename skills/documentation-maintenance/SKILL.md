---
name: documentation-maintenance
description: Keeps README, API docs, architecture notes, ADRs, and changelogs accurate when code changes by identifying which documents a change invalidates, documenting rationale, keeping setup instructions and examples runnable, updating the changelog with user-visible changes, and removing stale content. Use when code, configuration, commands, interfaces, or behavior change and documentation must be updated, or when writing an ADR or changelog entry.
license: MIT
metadata:
  version: "1.0.0"
  author: Cody-Sims
  tier: core
---

# Documentation Maintenance

Keep documentation true to the code. Out-of-date docs mislead humans and agents
and are often worse than none. Treat documentation as part of the change, not a
follow-up.

## Identify What a Change Invalidates

1. Review the change and list every document it could contradict:
   * **README** — setup, commands, prerequisites, and feature summaries.
   * **API docs** — signatures, parameters, return values, errors, and examples.
   * **Architecture notes** — component responsibilities, data flow, and diagrams.
   * **ADRs** — decisions the change reverses, supersedes, or fulfills.
   * **Changelog** — any user-visible addition, change, fix, or removal.
   * **Inline comments and docstrings** near the edited code.
2. Search the documentation for the names, commands, flags, paths, and values the
   change touched. Renamed or removed identifiers are a common source of staleness.
3. Decide for each affected document whether to update, supersede, or delete
   content. Do not leave a contradiction unresolved.

## Update Principles

* **Document rationale, not just mechanics.** Explain why something works the way
  it does and what constraint it satisfies, so a reader can adapt it rather than
  copy it blindly. The code already shows the mechanics.
* **Keep setup instructions executable and verified.** Run the documented setup
  and command sequence, or trace it exactly, and confirm it still works. Update
  any step the change altered.
* **Keep examples runnable.** Ensure code samples compile or run against the
  current interfaces. A broken example is a defect.
* **Remove stale content; do not append to it.** Delete or rewrite the outdated
  passage rather than adding a correction beside it. Layered corrections rot fast.
* **Use consistent terminology** with the code and the rest of the documentation.
* **Use relative links** within the repository so they survive relocation.

## Architecture Decision Records

Write an ADR when a change makes or reverses a significant, hard-to-undo decision,
such as a technology choice, an interface contract, or a structural boundary.

1. Copy [the ADR template](assets/adr-template.md).
2. Record the context and forces, the decision, the alternatives considered and
   why they were rejected, and the consequences including trade-offs.
3. Give the ADR a stable number and a status: proposed, accepted, superseded, or
   deprecated.
4. Do not edit an accepted ADR's decision after the fact. Supersede it with a new
   ADR that links back to the one it replaces, preserving the history.

## Changelog

Update the changelog whenever a change is visible to users of the software.

1. Add an entry under the unreleased section using
   [the changelog entry format](assets/changelog-entry.md).
2. Classify it as Added, Changed, Deprecated, Removed, Fixed, or Security.
3. Describe the effect on the user, not the internal implementation.
4. Call out breaking changes explicitly and describe the migration.
5. Skip purely internal changes with no user-visible effect, such as a refactor
   that alters no behavior.

## Verify

1. Re-read each updated document in full for internal consistency.
2. Confirm every documented command and example was checked against the current
   code, and note which were run.
3. Confirm no contradiction, dead link, or stale identifier remains.

## Report

Return: the documents updated, superseded, or deleted; the commands and examples
verified and their result; any ADR added or superseded; the changelog entry; and
any documentation gap left for follow-up.

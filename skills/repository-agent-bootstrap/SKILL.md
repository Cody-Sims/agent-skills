---
name: repository-agent-bootstrap
description: "Audits and improves repository-owned AGENTS.md, scoped instructions, custom agents, and skill discovery without replacing conventions. Use when setting up or maintaining repository agent guidance, integrating an agent or skill, or fixing conflicting or overly broad customization; not for routine code edits, global preferences, or standalone skill authoring."
license: MIT
metadata:
  version: "1.2.1"
  author: "Cody-Sims"
  tier: "core"
---

# Repository Agent Bootstrap

Improve requested repository customization, not every code-change task.
Repository guidance is project-owned and shareable; global/user configuration is
personal, cross-repository policy. Never edit global configuration here or copy
personal preferences unless they are genuine repository requirements. Report
global conflicts or missing capabilities separately.

## Workflow

1. **Discover within scope.** Identify repository root, status, and requested
   customization target. Inventory root/nested `AGENTS.md`, repository/scoped
   instructions, agents, and skills. Read guidance governing the target's path
   and precedence, plus relevant contributor rules and validation commands.
   Read other bodies only to resolve an overlap, conflict, or stale reference;
   a repository-wide customization audit includes all applicable guidance, not
   unrelated application code or full skill-content audits.
   When guidance requires a skill, use the [loading contract](references/skill-loading.md)
   to distinguish an advertised native name from an authorized repository source.
   Resolve the route in each intended worker context before delegation; do not
   assume coordinator discovery carries over.
2. **Map the smallest change.** State the current model and precedence; identify
   gaps, duplicate/conflicting rules, stale links, and overly broad loading.
   Separate project from personal ownership. Propose keep/update/create actions,
   assigning one owner per rule. Use [artifact selection](references/artifact-selection.md)
   when ownership/type is unclear. Stop for user confirmation of ambiguous
   ownership or deletion, renaming, or reorganization; setup is not consent to
   destructive changes.
3. **Implement the approved scope.** Improve existing artifacts first; preserve
   unrelated content, names, locations, terminology, formatting, and precedence.
   - Keep `AGENTS.md` navigational, repository instructions broadly applicable,
     and scoped instructions limited to accurate path globs.
   - Use self-contained, task-oriented skills for on-demand workflows and relative
     links for specialized resources instead of duplicating them.
   - Add an agent only for a distinct role, isolated context, tool boundary, or
     genuine handoff; explain its unique capability, not a redundant persona.
     Bootstrap does not authorize launching agents or a default review fleet.
   - Update nearby indexes/discovery documents only as repository convention
     requires. Do not add competing guidance or automatic per-task audits.
4. **Validate the affected discovery path.** Check syntax, frontmatter, names,
   path globs, relative resources/links, and one clear owner per rule. Ensure no
   new artifact shadows existing guidance. Record verified skill-loading routes
   or blockers without changing global installation or permissions.
   Run available narrow customization or documentation checks; do not invent
   dependencies just to validate.
   Inspect the final diff for unrelated or global edits.
5. **Stop and hand off.** Finish when the affected discovery path is coherent,
   specialized content loads on demand, and conventions remain intact, or report
   a blocked decision/check. Return created/modified paths, check commands and
   results, unresolved conflicts, and separately recommended global actions.
   Do not expand a targeted repair into an unrequested repository bootstrap.

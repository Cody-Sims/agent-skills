---
name: repository-agent-bootstrap
description: "Audits and bootstraps repository-owned agent customization including AGENTS.md, repository and path-scoped instructions, custom agents, and skills, without overwriting established conventions. Use to set up, review, or maintain a repository's agent guidance, add a skill or agent, or fix overlapping, stale, or overly broad customization."
license: MIT
metadata:
  version: "1.0.0"
  author: Cody-Sims
  tier: core
argument-hint: "[repository path or audit focus]"
user-invocable: true
disable-model-invocation: true
---

# Repository Agent Bootstrap

Audit and improve a repository's agent customization without replacing its
established conventions. Keep the result small, project-owned, and easy to load
through progressive disclosure.

## Ownership Boundaries

* Treat user-level or global configuration as personal, cross-repository policy.
* Treat `AGENTS.md`, repository instructions, scoped instructions, agents, and
  skills inside the repository as project-owned and shareable with contributors.
* Do not copy global preferences into project files unless they are genuine
  repository requirements.
* Do not modify global configuration while bootstrapping a repository. Report
  global conflicts or missing global capabilities separately.

## Design Rules

* Preserve existing names, locations, terminology, formatting, and precedence.
* Prefer improving an existing artifact over creating a competing artifact.
* Keep root guidance concise and place specialized details near their scope.
* Use repository instructions for broad project rules and scoped instructions
  for path-specific conventions.
* Use skills for reusable task workflows that benefit from on-demand loading.
* Add an agent only when a distinct role, isolated context, tool boundary, or
  handoff is required. Do not generate redundant personas.
* Reference resources relatively and avoid duplicating material that can be
  linked or discovered when needed.
* Ask before deleting, renaming, or reorganizing existing customizations.

Read [artifact selection](references/artifact-selection.md) when unsure which
customization type a requirement belongs in.

## Required Steps

### Step 1: Discover

1. Identify the repository root and inspect its status without changing files.
2. Read existing root and nested `AGENTS.md` files, repository instructions,
   scoped instructions, agents, skills, contributor guidance, and task commands.
3. Determine which files apply by path and which conventions already control
   naming, frontmatter, validation, and maintenance.
4. Inventory gaps, overlaps, stale references, conflicting rules, and content
   that is loaded more broadly than necessary.
5. Separate project-owned findings from global or user-owned findings.

### Step 2: Plan

1. State the repository's current customization model and precedence.
2. Propose the smallest set of keep, update, and create actions.
3. Map each requirement to the narrowest appropriate artifact.
4. Explain any proposed agent or skill by the capability it uniquely adds.
5. Confirm ambiguous ownership or destructive changes with the user before
   implementation.

### Step 3: Implement

1. Follow the approved plan and preserve unrelated content.
2. Update existing files before adding new ones.
3. Keep `AGENTS.md` navigational, repository instructions broadly applicable,
   and scoped instructions limited to accurate path patterns.
4. Keep agents focused on roles that need distinct context or permissions.
5. Keep skills task-oriented, self-contained, and progressively disclosed.
6. Update nearby indexes or discovery documents only when repository convention
   requires it.

### Step 4: Validate

1. Check syntax, frontmatter, names, path globs, relative references, and links.
2. Confirm every rule has one clear owner and no new artifact shadows or repeats
   existing guidance.
3. Run the repository's narrow customization or documentation checks when they
   exist. Do not invent dependencies solely for validation.
4. Review the final diff for unrelated changes and accidental global edits.
5. Report created and modified files, checks run, unresolved conflicts, and
   recommended global actions that remain outside project ownership.

## Completion Criteria

Finish only when the repository has a coherent discovery path, specialized
content loads on demand, existing conventions remain intact, and validation
results are explicit.

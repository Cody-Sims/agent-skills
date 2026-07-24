# Artifact Selection

Guidance for mapping a requirement to the narrowest appropriate repository
customization artifact. Choose one owner per rule; do not duplicate a rule across
artifacts.

## Decision order

1. **Is it navigation or a top-level project overview?** Put it in `AGENTS.md`.
   Keep this file short and point to specialized content rather than inlining it.
2. **Does it apply to the whole repository regardless of path?** Use repository
   instructions for broad project rules such as language, style, and workflow.
3. **Does it apply only to certain paths?** Use path-scoped instructions with an
   accurate `applyTo` glob so the guidance loads only where it is relevant.
4. **Is it a reusable, multi-step task workflow?** Use a skill so it loads on
   demand through progressive disclosure instead of always occupying context.
5. **Does it need a distinct role, isolated context, tool boundary, or handoff?**
   Add a custom agent. Otherwise do not create one.

## When to add a skill versus instructions

* Instructions state standing rules that should always apply within their scope.
* Skills package a procedure the agent performs when a matching task appears.
* If the content is only ever read as a rule, it is instructions.
* If the content is executed as a workflow with steps, inputs, and outputs, it is
  a skill.

## When to add an agent

Add an agent only when at least one is true:

* The role needs a separate context window to avoid polluting the main task.
* The role needs a different tool allowlist or permission boundary.
* The work is a genuine handoff to a specialized reviewer or generator.

Do not create an agent to restate instructions, and do not generate multiple
personas that overlap in responsibility.

## Anti-patterns

* Copying personal or global preferences into project files.
* Broad instructions that should have been path-scoped.
* Two artifacts stating the same rule, which drift over time.
* A skill whose entire body could be a short instruction.
* An agent that adds a name but no distinct context, tools, or handoff.

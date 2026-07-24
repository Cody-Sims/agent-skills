---
name: skill-creator
description: "Creates, audits, and improves Agent Skills in this catalog. Captures intent, triggers, and outputs, checks the catalog for overlap, drafts positive and negative trigger prompts, writes routing descriptions, applies progressive disclosure, decides prose versus script, and validates frontmatter. Use when authoring a new SKILL.md, editing or reviewing an existing skill, fixing a skill that fails validation or fails to trigger, or when someone mentions skill authoring, skill frontmatter, or the skill catalog."
license: MIT
metadata:
  version: "1.0.0"
  author: "Cody-Sims"
  tier: "core"
---

# Skill Creator

Author, audit, and repair skills in this repository so they trigger reliably,
stay portable across Claude Code, GitHub Copilot, and OpenAI Codex, and pass the
first-party validator.

## Goal

Produce a skill directory whose `SKILL.md` has correct frontmatter, a description
that routes reliably, a body that follows progressive disclosure, and provenance
recorded in metadata.

## Inputs

- Required: the capability the skill should add, and at least one realistic user
  request that should activate it.
- Optional: an existing skill directory to audit or improve.
- Output: a validated skill directory under `skills/<name>/`.

If the intended capability or its triggers are unclear, ask one focused question
before writing. Do not invent scope the requester did not describe.

## Workflow

1. Capture intent, triggers, and outputs. Write one sentence naming what the
   skill does and one sentence naming what it produces. List concrete user
   phrases, file types, and artifact names likely to appear in requests.
2. Search the catalog for overlap. List existing skill names and read the
   descriptions of any that sound adjacent. If an existing skill already covers
   the request, extend it instead of adding a near-duplicate. Overlapping
   descriptions cause routing collisions.
3. Draft positive and negative trigger prompts. Write at least three requests
   that must activate the skill and at least two neighboring requests that must
   not. Use these to test the description and to define boundaries against
   adjacent skills.
4. Choose the name. Use lowercase letters, digits, and single hyphens, matching
   `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 64 characters or fewer. The directory name must
   equal the frontmatter `name`. Avoid the reserved words that hosted validation
   rejects. See [frontmatter reference](references/frontmatter.md).
5. Write the description for routing. Third person, one to 1024 characters, no
   angle-bracket characters. Front-load concrete trigger vocabulary and state
   when to use the skill with an explicit clause. The description is the only
   signal the model sees before activation, so keep every trigger there, not in
   the body. See [description patterns](references/description-patterns.md).
6. Apply progressive disclosure. Keep the body under 500 lines and roughly 5000
   tokens. Give the core workflow as numbered imperative steps. Move long field
   tables, variant-specific detail, and reference lookups into `references/*.md`
   linked one level deep. Put copy-pasteable templates and fixtures in `assets/`.
   Copy `assets/SKILL.template.md` as the starting point.
7. Decide prose versus script. Prefer prose for judgment-heavy work with several
   valid approaches. Add a script under `scripts/` only when an operation is
   deterministic, repetitive, fragile by hand, or machine-verifiable, and state
   plainly whether the model should read it or run it. Do not add a script just
   because one is possible.
8. Set frontmatter. Include `name`, `description`, `license: MIT`, and a
   `metadata` block with quoted `version`, `author`, and `tier`. Add
   `disable-model-invocation`, `user-invocable`, or `argument-hint` only when the
   workflow needs explicit invocation. Never use `allowed-tools`, `when_to_use`,
   `tools`, `model`, or `paths`.
9. Record provenance. Set `metadata.version` using semantic versioning, name the
   author, and note the tier. When a skill adapts prior art, credit the concept
   in prose without copying wording, and confirm the license permits reuse.
10. Validate. Run the repository validation command, then run
    `gh skill publish --dry-run` and read the output. Confirm every relative link
    resolves and every referenced file exists. Fix each reported issue and
    revalidate rather than ignoring warnings.

## Decision points

- Auditing an existing skill: run the same workflow as a checklist. Verify the
  name matches the directory, the description front-loads triggers, the body fits
  the line and token budgets, links resolve, and no forbidden field is present.
- Skill triggers on the wrong requests: tighten the description, sharpen the
  boundary against the neighboring skill, and remove trigger vocabulary shared
  with it.
- Skill fails to trigger: broaden the description with neighboring intents and
  add the missing user vocabulary, without adding unrelated scope.
- Body exceeds the budget: move factual lookup material and rarely used variants
  into `references/`, keeping the essential first steps in `SKILL.md`.

## Validation

Before finishing, confirm:

- The directory name equals the frontmatter `name`.
- Frontmatter contains only allowed keys, with `license: MIT` and quoted
  `metadata` values.
- The description is third person, within length limits, and free of angle
  brackets.
- The body is under 500 lines and links each reference one level deep.
- Every referenced file exists and every relative link resolves.
- The repository validation command and `gh skill publish --dry-run` both pass.

Fix the cause of any failure and rerun validation.

## Bundled resources

- Read [frontmatter reference](references/frontmatter.md) for the full field
  table, constraints, and forbidden fields.
- Read [description patterns](references/description-patterns.md) for good and bad
  descriptions with reasoning.
- Copy [the skill template](assets/SKILL.template.md) to start a new skill.

## Output format

Report the skill directory path, the final description line, the `SKILL.md` line
count, the validator result, and any unresolved issue or assumption.

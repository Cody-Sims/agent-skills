# Contributing

This guide covers proposing and adding a skill to the catalog. Read `AGENTS.md`
for the repository conventions and `docs/authoring-guide.md` for the detailed
authoring method.

## Before you write a skill

1. Confirm a skill is the right artifact. A skill is for a task-specific
   workflow that should activate only when relevant and travels with its own
   references, scripts, or assets. If the guidance applies to every task, it
   belongs in instructions; if it is a one-shot template, it belongs in a prompt
   file; if it is a persona with tool limits, it belongs in a custom agent; if
   the gap is an external capability, it belongs in an MCP server. See
   `docs/authoring-guide.md` and `docs/research/copilot-skills.md` (section 13.2).

2. Run the overlap check. Read the existing skills in `README.md` and under
   `skills/`. Do not add a skill whose triggers collide with an existing one.
   If two descriptions would compete for the same requests, either extend the
   existing skill or draw an explicit boundary in both descriptions. The
   `skill-creator` skill automates catalog overlap detection.

## Description-quality bar

The `description` is the routing interface; it is the only text loaded at
startup. Every description must:

- Be third person and 40–1024 characters.
- State what the skill does and, with an explicit "Use when..." clause, when to
  use it.
- Front-load the primary use case and include concrete trigger vocabulary
  (file types, artifact names, workflow terms, technologies).
- Avoid `<` and `>`.

See `docs/authoring-guide.md` for GOOD and BAD examples with reasoning.

## Progressive disclosure

Keep `SKILL.md` under 500 lines and roughly 5,000 tokens. Move large,
conditional, or domain-specific material into `references/`, linked one level
deep from `SKILL.md`. Ship a script only for deterministic, repetitive, or
machine-verifiable work; prefer prose for judgment-heavy steps. Budgets are in
`AGENTS.md` and `docs/research/repo-tooling.md` (section 4.1).

## Required frontmatter

Provide at least `name` and `description`. Use `metadata.version` (a quoted
semver string), `metadata.author`, and `metadata.tier` (`core`, `extended`, or
`experimental`). Do not add `allowed-tools` or any Claude-only field. The full
allowed-key list and constraints are in `AGENTS.md` and enforced by
`schemas/skill.schema.json`.

```yaml
---
name: example-skill
description: Performs a specific workflow and produces a defined result. Use when the user asks for the workflow or mentions its key artifacts.
license: MIT
metadata:
  version: "1.0.0"
  author: Cody-Sims
  tier: core
---
```

## Validate and test

From the repository root:

```bash
npm run validate
npm test
```

Also run the portable-profile check to confirm no host-specific field slipped
in:

```bash
node scripts/validate-skills.mjs --profile portable
```

All three must pass before you open a pull request.

## Review checklist

- [ ] Skill lives at `skills/<name>/SKILL.md`; `name` equals the directory name.
- [ ] `description` meets the quality bar and does not collide with an existing
      skill.
- [ ] `SKILL.md` is under 500 lines and roughly 5,000 tokens.
- [ ] References are linked directly from `SKILL.md` and are one level deep.
- [ ] Any script is justified as deterministic or machine-verifiable and has no
      network calls or secrets.
- [ ] Frontmatter uses only allowed keys; no `allowed-tools`.
- [ ] Writing follows the house style: terse, third person, numbered steps, no
      emoji, no marketing language, repository-agnostic.
- [ ] `README.md` skills table and `CHANGELOG.md` are updated.
- [ ] `npm run validate` and `npm test` pass.

## Third-party contributions

Skills copied or adapted from another repository are untrusted code. They must:

1. Pass the `external-skill-review` workflow before installation or inclusion.
2. Be pinned to an immutable commit or tag from the upstream source, not a
   moving branch.
3. Record provenance: upstream repository, ref, and the license under which the
   skill is redistributed. Preserve the upstream license file when the license
   requires it, and confirm the license permits redistribution and
   modification. Source-available licenses that prohibit derivatives must not be
   copied or adapted; reimplement from open specifications instead.

See `SECURITY.md` for the threat model and the consumer verification steps, and
`docs/research/community-skills.md` for the provenance and governance patterns
this policy follows.

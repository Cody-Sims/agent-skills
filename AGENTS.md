# AGENTS.md

Instructions for agents working on this repository. This file governs changes to
the catalog and its tooling. It is not a user guide; see `README.md` for install
and usage.

## Purpose and boundaries

This repository is a portable Agent Skills catalog for Claude Code, GitHub
Copilot, and OpenAI Codex. Its job is to hold high-quality, runtime-agnostic
skills and the tooling that validates and installs them.

In scope:

- Skills under `skills/<name>/`.
- Tooling under `scripts/` and `tests/`.
- The frontmatter contract in `schemas/skill.schema.json`.
- Documentation under `docs/` and the root Markdown files.

Out of scope:

- Runtime-specific behavior that cannot be expressed in the portable format.
  Do not add Claude-only or Cursor-only frontmatter to a canonical skill.
- Application code, product features, or repository-specific business logic
  inside a skill. Skills must stay repository-agnostic.
- Hand-maintained per-runtime copies of a skill. Runtime copies are generated at
  install time.

## Where skills live

Every skill is a directory under `skills/` with exactly one `SKILL.md`:

```text
skills/<name>/SKILL.md
```

`<name>` must be lowercase ASCII letters, digits, and single hyphens, and must
equal the directory name. `gh skill` and the open standard require the
`skills/<name>/SKILL.md` layout exactly; do not nest skills deeper, rename
`SKILL.md`, or change its casing. Optional subdirectories are `references/`,
`scripts/`, and `assets/`. Source: `docs/research/anthropic-spec.md` (section 2),
`docs/research/copilot-skills.md` (section 3).

## Frontmatter contract

`SKILL.md` frontmatter is YAML between two `---` fences. The allowed keys are
defined by `schemas/skill.schema.json`:

| Key | Required | Type | Constraints |
|---|---|---|---|
| `name` | Yes | string | 1–64 chars; `^[a-z0-9]+(?:-[a-z0-9]+)*$`; must equal the directory name; must not contain `anthropic` or `claude`. |
| `description` | Yes | string | 40–1024 chars; third person; states what the skill does and when to use it; no `<` or `>`. |
| `license` | No | string | Short SPDX identifier or reference to a bundled license file. |
| `compatibility` | No | string | 1–500 chars; concrete environment, runtime, package, command, or network requirements. Omit when there are none. |
| `metadata` | No | map | String values only. `metadata.version` is a quoted semver string; `metadata.tier` is `core`, `extended`, or `experimental`. |
| `allowed-tools` | No | string | Experimental and non-portable. Do not use in this repository. |
| `user-invocable` | No | boolean | Copilot VS Code and Claude Code extension. |
| `disable-model-invocation` | No | boolean | Copilot VS Code and Claude Code extension; use for destructive or expensive workflows. |
| `argument-hint` | No | string | 1–200 chars; Copilot VS Code and Claude Code extension. |

No other top-level keys are permitted. Claude-only fields such as `when_to_use`,
`model`, `effort`, `context`, `paths`, and `shell` are rejected by the validator
and break strict conformance. Put runtime-specific metadata in a companion file,
not in the canonical frontmatter. Source: `docs/research/anthropic-spec.md`
(sections 1, 8), `docs/research/copilot-skills.md` (section 5.3).

## Progressive disclosure and size budgets

Skills use three loading levels. Keep each within budget.

| Level | Loaded when | Content | Budget |
|---|---|---|---|
| 1: metadata | Always, at startup | `name`, `description` | ~50–100 tokens per skill |
| 2: `SKILL.md` body | On activation | The full instructions | < 500 lines and < ~5,000 tokens |
| 3: resources | On demand | `references/`, `scripts/`, `assets/` | No context cost until read or run |

Rules:

- Keep `SKILL.md` under 500 lines and roughly 5,000 tokens. Warn threshold is
  400 lines / 4,000 tokens.
- Move large, conditional, or domain-specific material into `references/`.
- Link every reference directly from `SKILL.md`. Keep references one level deep;
  do not chain reference to reference.
- Add a table of contents to any reference longer than 100 lines.
- Ship a script only when the operation is deterministic, repetitive, fragile,
  or machine-verifiable. Prefer prose for judgment-heavy work.

Source: `docs/research/anthropic-spec.md` (section 3),
`docs/research/repo-tooling.md` (section 4.1).

## House writing style

- Terse and factual. Short declarative sentences.
- Numbered, procedural steps for workflows.
- Third-person descriptions ("Reviews...", "Generates..."), never first or
  second person.
- No emoji, no badges, no marketing language ("powerful", "seamless",
  "delightful").
- Repository-agnostic wording. A skill must not assume a specific project,
  language, or directory unless stated in `compatibility`.
- Descriptions must include concrete trigger vocabulary and an explicit "Use
  when..." clause. All activation information belongs in `description`, because
  the body is not loaded until after the skill is selected.

## Required validation before finishing

Run these from the repository root and confirm they pass before completing any
change to a skill or to the tooling:

```bash
npm run validate
npm test
```

For a portable-profile check that rejects every host extension:

```bash
node scripts/validate-skills.mjs --profile portable
```

Do not claim a change is complete without fresh output from these commands.

## Git rules

- Stage explicit paths: `git add skills/<name>/SKILL.md`. Never run
  `git add -A` or `git add .`; they capture scratch files, installed copies,
  and secrets.
- Write imperative commit subjects ("Add security-review skill", not "Added"
  or "Adds").
- Update `CHANGELOG.md` under `Unreleased` for every user-visible change.
- Never commit installed runtime copies (`.claude/`, `.copilot/`, `.codex/`) or
  `*.receipt.json`; they are ignored by `.gitignore`.
- Include the `Co-authored-by: Copilot` trailer on commits you create unless
  told otherwise.

## Maintenance triggers

When the catalog changes, update the following in the same change:

| Change | Update |
|---|---|
| Skill added | `README.md` skills table; `CHANGELOG.md` (`Added`); regenerate the registry if present; run `npm run validate` and `npm test`. |
| Skill renamed | Directory name and `name` frontmatter together; every internal reference and link; `README.md` skills table; `CHANGELOG.md` (`Changed`); regenerate the registry. |
| Skill removed | Delete `skills/<name>/`; `README.md` skills table; `CHANGELOG.md` (`Removed`); regenerate the registry. |
| Frontmatter contract changed | `schemas/skill.schema.json`; the frontmatter table above; `docs/authoring-guide.md`; `docs/compatibility.md`; every affected `SKILL.md`. |
| Tooling or npm script changed | `README.md` command reference; `package.json`; `docs/` as needed; add or update tests under `tests/`. |

# Changelog

All notable changes to this repository are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Prioritized catalog backlog covering behavior and routing evaluations,
  discovery metadata, maturity policy, cross-runtime validation, workflow packs,
  provenance, and a bounded two-agent continuous learning and improvement
  architecture for local and Copilot cloud execution.
- Architecture decision defining separate learning and improvement agents,
  approval and evaluation gates, protected governance surfaces, cloud execution,
  audit, budgets, stop conditions, and rollback.
- Copilot cloud setup workflow that provisions Node.js 22 with read-only
  repository access and verifies the catalog, tooling tests, and generated
  registry before delegated work begins.

## [0.1.0] - 2026-07-24

### Added

- Initial portable Agent Skills catalog targeting Claude Code, GitHub Copilot,
  and OpenAI Codex, with skills under `skills/<name>/SKILL.md`:
  - `code-review`
  - `codebase-exploration`
  - `documentation-maintenance`
  - `external-skill-review`
  - `git-and-pr-workflow`
  - `planning-and-task-breakdown`
  - `refactoring-and-dead-code-removal`
  - `repository-agent-bootstrap`
  - `requirements-and-spec-writing`
  - `security-review`
  - `shadow-architecture`
  - `skill-creator`
  - `systematic-debugging`
  - `test-driven-development`
  - `verification-before-completion`
  - `web-research-and-verification`
- Frontmatter contract in `schemas/skill.schema.json` restricting `SKILL.md` to
  the portable open-standard fields plus a small documented extension set.
- Tooling: `scripts/validate-skills.mjs` (frontmatter and structure validation
  with `--profile portable|repository`, `--format text|json`, and `--changed`),
  `scripts/manage-skills.mjs` (install, check, uninstall, list), and
  `scripts/generate-registry.mjs`, with shared modules under `scripts/lib/`.
- Generated catalog registry at `registry/skills.json`.
- npm scripts: `validate`, `install:agents`, `check:agents`, `uninstall:agents`,
  `list`, and `test`.
- Tooling tests under `tests/`.
- Documentation: `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`,
  `docs/authoring-guide.md`, `docs/compatibility.md`, and the source-of-truth
  research reports under `docs/research/`.

[Unreleased]: https://github.com/Cody-Sims/agent-skills/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Cody-Sims/agent-skills/releases/tag/v0.1.0

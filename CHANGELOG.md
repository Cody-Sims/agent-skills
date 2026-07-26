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
- Separate learning and improvement custom agents with minimal tool sets,
  approval and lease requirements, protected-path boundaries, and draft pull
  request evidence contracts.
- Implementation custom agent with focused read-only exploration and review
  specialists, Copilot CLI built-in agent routing, incremental editing, and
  executable validation requirements.
- Continuous-improvement issue and pull request templates, serialized GitHub
  queue transitions, approval-bound leases, merge-only completion, CODEOWNERS,
  versioned policy and schemas, deterministic validation tooling, and tests.
- Manual Copilot cloud pilot runbook covering proposal, approval, claim,
  delegation, review, cancellation, shutdown, and rollback.
- Immutable commit pins for every GitHub Action used by validation, Copilot
  setup, and continuous-improvement control workflows.
- Versioned behavior-evaluation schemas and pilot suite, isolated comparative
  runner, subprocess adapter protocol, objective and human grading records,
  token and duration metrics, safe fixtures, and a synthetic smoke command.
- Versioned routing suite and result schemas, repeated isolated adapter trials,
  training and validation splits, activation, precision, recall, collision,
  token, timing, and confusion reports for two adjacent-skill boundaries.
- Contribution evidence manifests and pull-request enforcement requiring real
  expertise sources plus measured uplift or an approved safety/compliance
  exception for every changed skill.

### Security

- Evaluation adapters now use an explicit environment allowlist, suppress
  process output on failure, cap output and workload sizes, isolate regular
  expressions in terminable workers, and persist only generic assertion
  evidence.
- Evaluation and routing artifacts now reject unsafe counters and inconsistent
  metrics, bind contribution evidence to committed suite and skill hashes, and
  require local expertise sources and completed human review.

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

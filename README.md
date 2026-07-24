# Agent Skills

A portable catalog of Agent Skills for Claude Code, GitHub Copilot, and OpenAI
Codex. Each skill is a directory containing a `SKILL.md` written to the open
[Agent Skills specification](https://agentskills.io/specification), so the same
source installs into every runtime that reads the format without per-runtime
rewrites.

The canonical source lives under `skills/<name>/SKILL.md`. Runtime-specific
copies are generated at install time; the source tree is never duplicated by
hand. Frontmatter is restricted to the portable open-standard fields plus a
small set of documented extensions (see `docs/compatibility.md`).

## Supported runtimes

Skills in this repository target the runtimes below. Install paths are taken
from the research reports in `docs/research/`; see `docs/compatibility.md` for
the full matrix including Cursor, Windsurf, Gemini CLI, OpenCode, Amp, Cline,
and Roo Code.

| Runtime | Native skills | Project install path | User install path |
|---|---|---|---|
| Claude Code | Yes | `.claude/skills/<name>/SKILL.md` | `~/.claude/skills/<name>/SKILL.md` |
| GitHub Copilot | Yes | `.github/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md`, `.agents/skills/<name>/SKILL.md` | `~/.copilot/skills/<name>/SKILL.md`, `~/.agents/skills/<name>/SKILL.md` |
| OpenAI Codex | Yes | `.agents/skills/<name>/SKILL.md` | `~/.agents/skills/<name>/SKILL.md` |

`.agents/skills` is the vendor-neutral path shared by Codex, Copilot, and most
other hosts. Claude Code does not read `.agents/skills`, so it requires a
`.claude/skills` copy. Sources: `docs/research/codex-portability.md`,
`docs/research/copilot-skills.md`, `docs/research/anthropic-spec.md`.

## Quick start

Requires Node.js 20 or later.

```bash
git clone https://github.com/Cody-Sims/agent-skills.git
cd agent-skills
npm run validate
npm run install:agents
```

`npm run validate` checks every `SKILL.md` against the frontmatter contract in
`schemas/skill.schema.json`. `npm run install:agents` copies skills into the
runtimes it detects on the machine. Preview the plan first with
`npm run check:agents` and remove installed copies with
`npm run uninstall:agents`.

To install a single skill from GitHub CLI (version 2.90.0 or later), without
cloning:

```bash
gh skill install Cody-Sims/agent-skills code-review
```

`gh skill` records source provenance in the installed `SKILL.md` frontmatter and
installs into the correct directory for the selected host and scope. Pin to an
immutable ref for reproducibility:

```bash
gh skill install Cody-Sims/agent-skills code-review --pin <tag-or-commit>
```

See `docs/research/copilot-skills.md` (section 9) for the full `gh skill`
command surface.

## Skills

| Skill | Description |
|---|---|
| `code-review` | Reviews a diff, PR, or staged changes for correctness, tests, edge cases, security, performance, readability, and architectural fit, and reports severity-ranked findings with file and line references. |
| `codebase-exploration` | Builds an evidence-based map of an unfamiliar repository, its entry points, commands, conventions, and dependency graph before any change, staying read-only. |
| `documentation-maintenance` | Keeps README, API docs, architecture notes, ADRs, and changelogs accurate when code, configuration, commands, or behavior change. |
| `external-skill-review` | Reviews third-party agent skills as untrusted code before installing or updating them, assessing provenance, scripts, hidden Unicode, network and secret access, and supply-chain risk. |
| `git-and-pr-workflow` | Guides Git branching, atomic commits, rebasing, conflict resolution, worktrees, pull request descriptions, and safely finishing a branch. |
| `planning-and-task-breakdown` | Decomposes an approved specification into small, ordered, dependency-aware tasks with acceptance criteria and verification commands, and flags safely parallelizable work. |
| `refactoring-and-dead-code-removal` | Changes code structure without changing behavior and removes unused code safely, making one mechanical change at a time against a passing baseline and proving code is dead before deleting it. |
| `repository-agent-bootstrap` | Audits and bootstraps repository-owned agent customization: `AGENTS.md`, repository and path-scoped instructions, custom agents, and skills. |
| `requirements-and-spec-writing` | Turns an ambiguous or large request into an agreed written specification covering objective, requirements, non-goals, interfaces, acceptance criteria, and rollout. |
| `security-review` | Performs threat-focused security review of a change or component using STRIDE, checking authentication, authorization, injection, secrets, dependencies, and untrusted data. |
| `shadow-architecture` | Builds and maintains a `.shadow` decision graph as durable, evidence-linked architecture memory and detects drift between decisions and implementation. |
| `skill-creator` | Creates, audits, and improves Agent Skills in this catalog: intent capture, overlap checks, trigger prompts, routing descriptions, progressive disclosure, and frontmatter validation. |
| `systematic-debugging` | Reproduces failures, captures exact error output, isolates the root cause, and fixes the cause rather than the symptom. |
| `test-driven-development` | Drives implementation with the red-green-refactor cycle: a failing behavior test first, minimum code to pass, then refactor while green. |
| `verification-before-completion` | Requires fresh command evidence before any claim that work is done, fixed, passing, or ready. |
| `web-research-and-verification` | Answers questions that depend on current external information by detecting the version in use, preferring authoritative sources, corroborating, and citing URLs. |

## Repository layout

```text
agent-skills/
├── skills/                     # Canonical skill sources
│   └── <name>/
│       ├── SKILL.md            # Required: frontmatter + instructions
│       ├── references/         # Optional: read-on-demand docs
│       ├── scripts/            # Optional: deterministic utilities
│       └── assets/             # Optional: templates and fixtures
├── scripts/                    # Repository tooling
│   ├── validate-skills.mjs     # Frontmatter and structure validator
│   └── lib/                    # Shared tooling modules
├── schemas/
│   └── skill.schema.json       # Frontmatter contract
├── tests/                      # Tooling tests (node --test)
├── docs/
│   ├── authoring-guide.md      # How to write a good skill
│   ├── compatibility.md        # Runtime compatibility matrix
│   └── research/               # Source-of-truth research reports
├── .github/
│   ├── instructions/
│   └── workflows/              # CI, including skill validation
├── AGENTS.md                   # Instructions for agents working on this repo
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
└── package.json
```

## Command reference

| Command | Runs | Purpose |
|---|---|---|
| `npm run validate` | `node scripts/validate-skills.mjs` | Validate every `SKILL.md` against the frontmatter contract and structure rules. |
| `npm run install:agents` | `node scripts/manage-skills.mjs install` | Install skills into detected runtimes. |
| `npm run check:agents` | `node scripts/manage-skills.mjs check` | Report what an install or uninstall would change, without writing. |
| `npm run uninstall:agents` | `node scripts/manage-skills.mjs uninstall` | Remove installed skill copies. |
| `npm run list` | `node scripts/manage-skills.mjs list` | List catalog skills and their install state. |
| `npm test` | `node --test tests/` | Run the tooling test suite. |

The validator accepts `--format text|json`, `--profile portable|repository`,
and `--changed`. `portable` allows only open-standard fields; `repository`
allows the documented extension set. Example:

```bash
node scripts/validate-skills.mjs --profile portable --format json
```

## Adding a skill

Use the `skill-creator` skill to scaffold and evaluate a new skill, and follow
`docs/authoring-guide.md` for the description-quality bar, progressive
disclosure budgets, and the validation checklist. `CONTRIBUTING.md` describes
the overlap check, review checklist, and third-party contribution policy.

In short: create `skills/<name>/SKILL.md` with valid frontmatter, keep the body
under 500 lines and roughly 5,000 tokens, push large or conditional material
into `references/`, run `npm run validate` and `npm test`, and update
`CHANGELOG.md`.

## Versioning and releases

Each skill carries its own semantic version under `metadata.version` in its
`SKILL.md`. The repository as a whole is versioned in `package.json` and
`CHANGELOG.md` using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/). There is no top-level `version`
field in `SKILL.md` frontmatter; distribution-layer versions (tags, `gh skill`
pins) are separate from per-skill `metadata.version`. Consumers installing with
`gh skill` should pin to an immutable tag or commit.

## Security

Skills are privileged instructions and executable code. This repository ships
no `allowed-tools` pre-approvals, performs no network calls in its tooling, and
contains no secrets. Review a skill before installing it, and pin third-party
skills to an immutable commit. See `SECURITY.md`.

## License

MIT. See `LICENSE`.

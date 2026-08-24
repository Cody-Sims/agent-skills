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

Requires Node.js 22 or later.

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

Installs write a strictly validated receipt v3 containing selection state,
source identity, the registry digest, exact skill versions, and every installed
file hash. Full-catalog commands remain the default. Packs use deterministic
exact-version forms:

```bash
npm run install:pack -- feature-delivery@1.0.0
npm run install:pack -- shadow-architecture-suite@1.0.0
npm run check:pack -- feature-delivery
npm run uninstall:pack -- feature-delivery
```

Repeated `--pack` options select multiple packs. Pack installs add to existing
catalog or pack selections; pack uninstall removes only that selection and
retains shared skills required elsewhere. See
[`docs/lifecycle-and-provenance.md`](docs/lifecycle-and-provenance.md) for safe
migration and rollback behavior.

`shadow-architecture-suite@1.0.0` provides the full linear Shadow lifecycle:
observe current architecture, dream future-state options, record an explicitly
human-approved decision, then check for drift after decisions and implementation
are updated. Invoke `shadow-architecture` independently when the task only needs
to record or maintain current-state decisions.

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
| `copilot-cloud-agent` | Launches and monitors GitHub-hosted Copilot tasks with explicit model selection, task and PR verification, and clear boundaries around unsupported reasoning and context controls. |
| `documentation-maintenance` | Keeps README, API docs, architecture notes, ADRs, and changelogs accurate when code, configuration, commands, or behavior change. |
| `external-skill-review` | Reviews third-party agent skills as untrusted code before installing or updating them, assessing provenance, scripts, hidden Unicode, network and secret access, and supply-chain risk. |
| `git-and-pr-workflow` | Guides Git branching, atomic commits, rebasing, conflict resolution, worktrees, pull request descriptions, and safely finishing a branch. |
| `parallel-worktree-delivery` | Orchestrates multi-agent worktree fleets with exclusive ownership, dependency waves, one-branch-at-a-time integration, conflict handling, and post-merge gates. |
| `planning-and-task-breakdown` | Decomposes an approved specification into small, ordered, dependency-aware tasks with acceptance criteria and verification commands, and flags safely parallelizable work. |
| `refactoring-and-dead-code-removal` | Changes code structure without changing behavior and removes unused code safely, making one mechanical change at a time against a passing baseline and proving code is dead before deleting it. |
| `repository-agent-bootstrap` | Audits and bootstraps repository-owned agent customization: `AGENTS.md`, repository and path-scoped instructions, custom agents, and skills. |
| `requirements-and-spec-writing` | Turns an ambiguous or large request into an agreed written specification covering objective, requirements, non-goals, interfaces, acceptance criteria, and rollout. |
| `security-review` | Performs threat-focused security review of a change or component using STRIDE, checking authentication, authorization, injection, secrets, dependencies, and untrusted data. |
| `shadow-architecture` | Sets up and maintains a `.shadow` graph, records human-approved decisions, preserves accepted history through supersession, and renders reviewed records. |
| `shadow-dream` | Generates evidence-linked future-state architecture options, tradeoffs, migration paths, rollback plans, and a proposal that remains subject to explicit human approval. |
| `shadow-drift` | Checks a `.shadow` graph read-only for integrity, stale decisions, unresolved relations, missing evidence, stale derived output, and implementation drift. |
| `shadow-observe` | Runs bounded, read-only repository analysis to produce evidence-linked candidate architecture observations without creating decisions or proposing future state. |
| `skill-creator` | Creates, audits, and improves Agent Skills in this catalog: intent capture, overlap checks, trigger prompts, routing descriptions, progressive disclosure, and frontmatter validation. |
| `systematic-debugging` | Reproduces failures, captures exact error output, isolates the root cause, and fixes the cause rather than the symptom. |
| `test-driven-development` | Drives implementation with the red-green-refactor cycle: a failing behavior test first, minimum code to pass, then refactor while green. |
| `verification-before-completion` | Requires fresh command evidence before any claim that work is done, fixed, passing, or ready. |
| `verification-discipline` | Hardens tests and CI so green results are meaningful through red-green proof, independent assertions, bounded expensive checks, report-only adoption, and build-purity checks. |
| `web-research-and-verification` | Answers questions that depend on current external information by detecting the version in use, preferring authoritative sources, corroborating, and citing URLs. |

## Implementation agent

The repository includes an `Implementation` custom agent that coordinates the
catalog's existing skills, delegates narrow code search and review into isolated
read-only contexts, edits incrementally, and requires fresh validation before
completion. Copilot CLI uses its optimized built-in `explore`, `task`, and
`code-review` agents when available. Hidden repository profiles provide focused
exploration and review fallbacks for VS Code.

Select `Implementation` with `/agent` in an interactive Copilot CLI session, or
invoke it directly from the repository root:

```bash
copilot --agent implementation --prompt "Implement the requested change and verify it"
```

To make the profiles available to Copilot CLI in every local repository, copy
all three profiles into the documented user-level agent directory:

```bash
mkdir -p ~/.copilot/agents
cp .github/agents/implementation*.agent.md ~/.copilot/agents/
```

For team-shared use in another repository, place the same files under that
repository's `.github/agents/` directory. A user-level profile with the same
filename overrides a repository-level profile. See GitHub's
[custom-agent overview](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents),
[CLI creation and invocation guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli),
and [configuration reference](https://docs.github.com/en/copilot/reference/custom-agents-configuration).

## Roadmap

See [`BACKLOG.md`](BACKLOG.md) for the prioritized catalog improvements and the
approval-gated two-agent continuous learning and improvement architecture. The
governing architecture decision is
[`ADR 0001`](docs/decisions/0001-bounded-continuous-improvement.md).
[`ADR 0002`](docs/decisions/0002-recurring-orchestration.md) selects
repository-versioned GitHub Agentic Workflows for future recurring operation
while schedules remain disabled until pilot graduation.
Manual pilot operation is documented in the
[`continuous improvement runbook`](docs/continuous-improvement-runbook.md).
Post-merge artifact comparison and sanitized corrective proposals are
documented in [`docs/drift-detection.md`](docs/drift-detection.md).
Behavior evaluation setup and the adapter protocol are documented in
[`docs/evaluations.md`](docs/evaluations.md).
Cross-runtime install, discovery, invocation, resource, and host-extension smoke
testing is documented in [`docs/runtime-smoke.md`](docs/runtime-smoke.md).
Tier entry, promotion, regression, deprecation, and removal policy is documented
in [`docs/tier-lifecycle.md`](docs/tier-lifecycle.md).
Registry discovery fields and query filters are documented in
[`docs/registry-discovery.md`](docs/registry-discovery.md).
Lifecycle, immutable origin, scheduled review, tombstones, and receipt v3 are
documented in
[`docs/lifecycle-and-provenance.md`](docs/lifecycle-and-provenance.md).
Versioned workflow pack manifests, registry validation, and transactional pack
selection are documented in
[`docs/workflow-packs.md`](docs/workflow-packs.md). Workflow pack composition
evaluation is documented in [`docs/evaluations.md`](docs/evaluations.md).

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
│   ├── skill.schema.json       # Frontmatter contract
│   ├── registry-discovery.schema.json # Catalog discovery manifest contract
│   ├── lifecycle.schema.json   # Lifecycle and immutable origin contract
│   ├── packs.schema.json       # Workflow pack manifest contract
│   ├── runtime-smoke-*.schema.json # Runtime smoke suite and result contracts
│   └── registry.schema.json    # Generated registry contract
├── registry/
│   ├── discovery.json          # Maintainer-authored discovery metadata
│   ├── lifecycle.json          # Maintainer-authored lifecycle and provenance
│   ├── maturity.json           # Maintainer-authored tier evidence
│   ├── packs.json              # Maintainer-authored workflow pack definitions
│   └── skills.json             # Generated registry v5 catalog and packs
├── tests/                      # Tooling tests (node --test)
├── docs/
│   ├── authoring-guide.md      # How to write a good skill
│   ├── compatibility.md        # Runtime compatibility matrix
│   ├── decisions/              # Accepted and proposed architecture decisions
│   └── research/               # Source-of-truth research reports
├── .github/
│   ├── agents/                 # Implementation, learning, and improvement agents
│   ├── continuous-improvement/ # Versioned budgets and protected paths
│   ├── instructions/
│   └── workflows/              # Validation and queue policy enforcement
├── AGENTS.md                   # Instructions for agents working on this repo
├── CONTRIBUTING.md
├── BACKLOG.md                  # Prioritized catalog and agent infrastructure work
├── SECURITY.md
├── CHANGELOG.md
└── package.json
```

## Command reference

| Command | Runs | Purpose |
|---|---|---|
| `npm run validate` | Repository validators | Validate every `SKILL.md` and the continuous-improvement policy. |
| `npm run skill:create -- --name <slug> --description <text> [--author <name>] [--references] [--scripts] [--assets]` | First-party skill scaffolder | Create a validated portable skill and per-skill behavior and routing fixtures without overwriting existing paths. Requires Node.js 22 or later. |
| `npm run improvement:validate` | Improvement policy validator | Validate budgets and protected-path configuration. |
| `npm run improvement:preflight -- --item <item.json> --run <run.json>` | Improvement preflight | Validate approval, lease, scope, and budgets before editing. |
| `npm run improvement:verify -- --item <item.json> --run <run.json>` | Improvement verification | Validate required checks and terminal run evidence. |
| `npm run improvement:plan -- --queue <queue.json> [--now <timestamp>]` | Recurring planner | Emit a read-only `learn`, `implement`, or `no-op` decision under kill-switch, lease, cadence, dependency, and budget gates. |
| `npm run pilot:validate -- --report <report.json>` | Pilot report validator | Enforce versioned graduation thresholds, evidence counts, and maintainer approval. |
| `npm run drift:detect -- [artifact pairs] --lifecycle <manifest> --as-of <date> [--out <report>]` | Drift detector | Compare behavior, routing, runtime, cost, and lifecycle evidence and emit a sanitized corrective proposal. |
| `npm run eval:validate` | Evaluation suite validator | Validate the committed behavior suite without model execution. |
| `npm run eval:smoke` | Synthetic evaluation smoke test | Exercise isolation, grading, metrics, and artifact generation. |
| `npm run eval -- --suite <suite> --adapter <command> --out <result>` | Behavior evaluation runner | Compare baseline and candidate outputs through a model adapter. |
| `npm run routing:smoke` | Synthetic routing smoke test | Exercise repeated trials and confusion reporting. |
| `npm run routing -- --suite <suite> --adapter <command> --out <result>` | Routing evaluation runner | Measure activation, precision, recall, collisions, tokens, and duration. |
| `npm run pack:validate [-- --result <artifact>]` | Structural pack validator | Run precommit structural validation without claiming source provenance. |
| `npm run pack:validate:provenance -- --source-commit <40-hex>` | Provenance pack validator | Require exact committed registry, suite, and member bytes at HEAD or an explicitly allowed ancestor. |
| `npm run pack:smoke` | Structural fixture pack smoke | Exercise every pack while labeling artifacts non-provenance precommit evidence. |
| `npm run pack:smoke:provenance -- --source-commit <40-hex>` | Provenance fixture pack smoke | Run the deterministic smoke against exact committed bytes. |
| `npm run runtime:smoke` | Deterministic fixture adapters | Exercise install, discovery, invocation, resources, and host extensions for Claude Code, Copilot, and Codex. |
| `node scripts/run-runtime-smoke.mjs --suite <suite> --out <result> [--adapter <runtime=command> --adapter-entrypoint <runtime=path>]` | Runtime smoke runner | Run reviewed host adapters; record unavailable hosts as structured skips. |
| `npm run contributions:validate -- --changed-skill <name>` | Contribution evidence validator | Require expertise provenance and uplift or an approved safety exception. |
| `npm run registry -- --as-of YYYY-MM-DD` | Registry generator | Generate registry v5 with discovery, maturity, lifecycle, provenance, tombstones, and validated pack definitions. |
| `npm run registry:check -- --previous <registry.json> --as-of YYYY-MM-DD` | Registry validator | Check generated output, review expiry, tier and pack transitions, and external identity changes. Registry v1-v4 files remain accepted comparison baselines. |
| `npm run registry:query -- [filters]` | Registry query | Filter skills by category, tags, risk, runtime, and input/output shape. |
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

Run `npm run skill:create -- --name <slug> --description "<third-person text.
Use when...>"` for a non-interactive starting point, then use the
`skill-creator` skill to refine and evaluate it. The command writes
`skills/<slug>/SKILL.md`, `evals/skills/<slug>/evals.json`, and
`evals/skills/<slug>/routing.json`. Optional resource flags create only the
requested directories with explicit placeholder files so they are portable Git
artifacts. Generated placeholders are not contribution, promotion, provenance,
or evaluation evidence.

The command reports a deterministic, advisory adjacent-skill list for human
overlap review. It does not claim to decide semantic overlap. Before
contribution, replace placeholders, add truthful discovery and lifecycle
records, provide real contribution evidence, update README and CHANGELOG,
regenerate the registry, and run hosted evaluation. Follow
`docs/authoring-guide.md` for the description-quality bar, progressive
disclosure budgets, and validation checklist. `CONTRIBUTING.md` describes the
overlap check, review checklist, and third-party contribution policy.

In short: create `skills/<name>/SKILL.md` with valid frontmatter, keep the body
under 500 lines and roughly 5,000 tokens, push large or conditional material
into `references/`, add its catalog-only metadata to `registry/discovery.json`,
add lifecycle and immutable origin metadata to `registry/lifecycle.json`,
regenerate the registry, run `npm run validate` and `npm test`, and update
`CHANGELOG.md`.

Query the generated catalog without loading discovery metadata into runtime
startup context:

```bash
npm run registry:query -- \
  --category security \
  --runtime github-copilot \
  --runtime-status compatible \
  --input component \
  --output threat-report
```

Filters combine with AND semantics. Repeat `--tag` to require multiple tags;
use `--risk`, `--format json`, or `--registry <path>` when needed.

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

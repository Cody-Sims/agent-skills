# Public Agent Skills Ecosystem Survey and Recommended Defaults

**Research date:** 2026-07-24  
**Project:** New cross-runtime `AgentSkills` repository for Claude Code, GitHub Copilot, and OpenAI Codex  
**Scope:** Public skill repositories, vendor collections, curated lists, structural conventions, validation, governance, licensing, and default-skill selection

## Executive Summary

The public Agent Skills ecosystem has converged on a simple interoperable core: each skill is a directory containing a required `SKILL.md` with YAML frontmatter and Markdown instructions, optionally supplemented by `scripts/`, `references/`, and `assets/`. The formal Agent Skills specification requires `name` and `description`, supports optional `license`, `compatibility`, `metadata`, and experimental `allowed-tools`, and recommends progressive disclosure so only metadata is always loaded, the skill body is loaded on activation, and supporting resources are loaded on demand ([agentskills.io specification](https://agentskills.io/specification)).

The highest-value P0 defaults for a new cross-repository collection are:

1. `skill-creator`
2. `requirements-and-spec-writing`
3. `planning-and-task-breakdown`
4. `systematic-debugging`
5. `test-driven-development`
6. `verification-before-completion`
7. `code-review`
8. `git-and-pr-workflow`
9. `security-review-and-threat-modeling`
10. `web-research-and-verification`
11. `documentation-maintenance`

These skills address the recurring failure modes of coding agents: starting with ambiguous requirements, implementing before planning, guessing at bugs, writing tests after implementation, claiming success without evidence, overlooking security or architectural defects, producing poor Git history, relying on stale framework knowledge, and allowing documentation to drift.

The strongest reusable implementations come from three repositories:

- **Anthropic’s official collection** provides the clearest canonical structure, formal specification, production-inspired examples, progressive disclosure guidance, and an Apache-2.0 `skill-creator` with comparative behavioral evaluation tooling ([anthropics/skills:README.md:13-35](https://github.com/anthropics/skills/blob/main/README.md#L13-L35), [anthropics/skills:skills/skill-creator/SKILL.md:1-106](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md#L1-L106)).
- **Obra’s Superpowers** provides the most rigorous general software-engineering workflows: systematic debugging, TDD, evidence-before-completion, worktrees, planning, brainstorming, reviews, and parallel-agent execution. It also demonstrates shared versioning across runtime manifests and extensive behavioral/runtime tests ([obra/superpowers:skills](https://github.com/obra/superpowers/tree/main/skills), [obra/superpowers:tests](https://github.com/obra/superpowers/tree/main/tests)).
- **Addy Osmani’s Agent Skills** provides broad lifecycle coverage and the ecosystem’s strongest catalog-level evaluation pattern: structural validation, deterministic trigger/routing tests, and optional behavioral agent evals ([addyosmani/agent-skills:README.md:115-220](https://github.com/addyosmani/agent-skills/blob/main/README.md#L115-L220), [addyosmani/agent-skills:evals/README.md:1-90](https://github.com/addyosmani/agent-skills/blob/main/evals/README.md#L1-L90)).

The single best structural pattern to copy is:

> **Maintain one canonical `skills/<name>/SKILL.md` source tree; place heavy material in progressive `references/`, deterministic helpers in `scripts/`, and templates in `assets/`; generate all Claude, Copilot, Codex, registry, and marketplace adapters from canonical metadata; then fail CI on schema errors, generated-file drift, trigger collisions, or behavioral regressions.**

This combines the canonical skill organization from Anthropic, declarative/generated plugin approach from GitHub Awesome Copilot, cross-runtime manifest synchronization from Superpowers, and three-tier evaluation model from Addy Osmani’s collection.

## Research Method and Limitations

Public GitHub repository-name searches were used to discover popular repositories named `agent-skills`, `claude-skills`, and related variants. Direct repository metadata, root directory listings, implementation files, contribution guides, validators, manifests, licenses, and representative skills were then fetched and inspected.

GitHub code-search requests for `filename:SKILL.md path:skills` and related terms timed out or required authenticated code-search access. Consequently, discovery was supplemented through public repository search results and direct inspection of known high-value repositories. This is sufficient to identify the dominant structural patterns and popular collections, but it is not a complete census of every repository containing a `SKILL.md`.

Approximate star counts below are a snapshot of GitHub repository metadata on 2026-07-24 and will change over time.

## Agent Skills Standard Baseline

The Agent Skills specification defines this canonical layout:

```text
skill-name/
├── SKILL.md          # Required metadata and instructions
├── scripts/          # Optional deterministic executable helpers
├── references/       # Optional documentation loaded on demand
├── assets/           # Optional templates and static resources
└── ...
```

A `SKILL.md` must begin with YAML frontmatter followed by Markdown instructions ([agentskills.io specification](https://agentskills.io/specification)).

### Required and Optional Frontmatter

| Field | Required | Main constraints |
|---|---:|---|
| `name` | Yes | 1–64 characters; lowercase letters, numbers, and hyphens; no leading, trailing, or consecutive hyphens; must match the parent directory |
| `description` | Yes | 1–1024 characters; should explain what the skill does and when to use it |
| `license` | No | SPDX-like name or reference to a bundled license file |
| `compatibility` | No | Up to 500 characters describing runtime, package, system, or network requirements |
| `metadata` | No | String key/value mapping for author, version, provenance, and repository-specific fields |
| `allowed-tools` | No | Experimental space-separated pre-approved tool declaration |

Source: [agentskills.io specification](https://agentskills.io/specification).

A recommended cross-runtime frontmatter convention for the new repository is:

```yaml
---
name: systematic-debugging
description: Investigates bugs, failing tests, build failures, and unexpected behavior by reproducing the issue, gathering evidence, tracing root cause, and testing one hypothesis at a time. Use before proposing or applying fixes.
license: MIT
compatibility: Requires access to the repository, its test commands, and version-control history.
metadata:
  author: Cody-Sims
  version: "1.0.0"
  source-repository: obra/superpowers
  source-commit: "<immutable-commit-sha>"
  adapted-from: skills/systematic-debugging
allowed-tools: Read Bash(git:*) Bash(npm:*) Bash(pytest:*) Bash(cargo:*) Bash(go:*)
---
```

`allowed-tools` should be omitted unless a runtime supports it and pre-approval is genuinely needed. Tool permissions should remain narrow because a skill is executable instruction content, not passive documentation.

### Progressive Disclosure

The specification and Anthropic’s `skill-creator` recommend three levels of loading:

1. **Metadata:** name and description are always available for routing.
2. **Skill body:** the full `SKILL.md` is loaded only when the skill activates.
3. **Resources:** scripts, references, schemas, and assets load only when needed.

The specification recommends keeping the primary skill under approximately 500 lines and 5,000 tokens, while Anthropic’s authoring guidance similarly recommends moving long references and deterministic helpers into supporting directories ([agentskills.io specification](https://agentskills.io/specification), [anthropics/skills:skills/skill-creator/SKILL.md:86-120](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md#L86-L120)).

## Repository Comparison

| Repository | Approx. stars | Layout | Frontmatter | Validator / CI | Registry / manifest | License | Standout content |
|---|---:|---|---|---|---|---|---|
| `obra/superpowers` | 260.5k | Flat `skills/`, `tests/`, scripts, hooks, docs, runtime plugin directories | Primarily `name`, trigger-focused `description` | Extensive tests, runtime-specific suites, shell lint, eval lint/type checks | Claude, Codex, Cursor, Gemini, Kimi and other manifests; shared version bump config | MIT | Debugging, TDD, verification, worktrees, brainstorming, plans, code review, parallel agents |
| `anthropics/skills` | 163.9k | `skills/`, `spec/`, `template/`, `.claude-plugin/` | Required `name`, `description`; some skills add license/resources | No root GitHub Actions directory was visible; `skill-creator` includes eval tooling | Claude marketplace groups document, example, and API skills | Mixed: many Apache-2.0; office-document skills source-available only | Skill creator, PDF/XLSX/DOCX/PPTX, webapp testing, doc coauthoring, MCP builder |
| `addyosmani/agent-skills` | 80.2k | `skills/`, agents, commands, references, hooks, evals, runtime adapters | `name`; description generally states function followed by “Use when…” triggers | Structural CI, deterministic trigger/routing evals, optional behavioral evals | Claude/Codex/Gemini/OpenCode and other integration metadata | MIT | Full engineering lifecycle, security, performance, documentation, migration, source verification |
| `ComposioHQ/awesome-claude-skills` | 69.9k | Skill directories directly at repository root | `name`, `description` | `.github` exists; no repository-wide validator was confirmed | No canonical registry beyond README organization | No GitHub-detected repository license | Changelog generation, content research, file organization, MCP builder, document workflows |
| `sickn33/agentic-awesome-skills` | 43.8k | Large catalog plus CLI, local MCP, plugins, and workbench | Catalog-dependent | Described as including stack validation; implementation not deeply audited | Local agent-first catalog/control plane | MIT | Very broad discovery catalog; useful for ecosystem scanning rather than default-skill design |
| `github/awesome-copilot` | 37.0k | `skills/`, agents, instructions, plugins, hooks, extensions, cookbook, schemas, generation scripts | `name`, `description`; community examples sometimes use multiline YAML | `skill:validate`, plugin validation, generated README/marketplace/site data, schema checks | Declarative plugin files, generated marketplace, external registry | MIT | Codebase knowledge, supply-chain integrity, governance, OWASP, safety review |
| `K-Dense-AI/scientific-agent-skills` | 31.7k | Scientific skill catalog and database integrations | Standard skill frontmatter | Not deeply audited | Scientific catalog | MIT | Biology, chemistry, medicine, genomics and scientific data; too domain-specific for defaults |
| `vercel-labs/agent-skills` | 29.4k | `skills/`, packaged ZIPs, `packages/`, `.github`, `skills.sh.json` | `name`, `description`, often `license`, `metadata.author`, `metadata.version` | GitHub automation present; dedicated validator not confirmed | `skills.sh.json` groups React, Vercel and design skills | No root-detected license; individual skills may declare MIT | React best practices, composition, React Native, web design, deployment |
| `VoltAgent/awesome-agent-skills` | 28.9k | README-only external link catalog | Not applicable | No embedded-skill validator | README acts as catalog | MIT | Official vendor and community skill discovery |
| `alirezarezvani/claude-skills` | 23.1k | Large collection with skills, agents, commands, manifests, authoring standards, pipeline and store docs | Repository documents formal conventions | `.github`, lint configuration, pipeline docs; exact workflow not deeply audited | Multiple runtime manifests and store documentation | MIT | Engineering, business, compliance, research and productivity |
| `travisvn/awesome-claude-skills` | 14.3k | README and contribution guide only | Not applicable | No embedded-skill validator | README acts as curated list | No GitHub-detected repository license | Curated discovery with social-proof requirements |
| `cloudflare/skills` | 2.5k | `skills/`, commands, rules, Claude/Cursor plugin metadata, MCP config, CODEOWNERS | `name`, detailed `description` | `.github` exists; dedicated skill validator not confirmed | Claude and Cursor plugin manifests | Apache-2.0 | Web performance, Workers, Durable Objects, Agents SDK, Wrangler |
| `stripe/ai` | 1.7k | SDK/MCP repository; official skills delivered through plugins or Stripe documentation | Canonical source not exposed in inspected GitHub tree | No skill-source validator applicable | Official Claude/Codex/Cursor/Grok plugins and remote docs installation | MIT for repository code | Stripe integration and payments guidance |

Star-count sources: [GitHub repository metadata APIs](#sources).

## Detailed Repository Findings

### `anthropics/skills`

**Popularity:** Approximately 163,920 stars at the research snapshot ([repository metadata](https://api.github.com/repos/anthropics/skills)).

**Purpose:** Anthropic describes skills as folders of instructions, scripts, and resources dynamically loaded to improve specialized task performance. Each skill is self-contained and includes a `SKILL.md` containing instructions and metadata ([anthropics/skills:README.md:5-18](https://github.com/anthropics/skills/blob/main/README.md#L5-L18)).

**Top-level layout:**

```text
.claude-plugin/
skills/
spec/
template/
README.md
THIRD_PARTY_NOTICES.md
```

Source: [anthropics/skills root](https://api.github.com/repos/anthropics/skills/contents/).

**Skill layout:** Anthropic’s authoring guidance formalizes:

```text
skill-name/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

The `SKILL.md` requires `name` and `description`; resources are optional and should support progressive disclosure ([anthropics/skills:skills/skill-creator/SKILL.md:86-120](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md#L86-L120)).

**Frontmatter convention:**

```yaml
---
name: template-skill
description: Replace with description of the skill and when Claude should use it.
---
```

Source: [anthropics/skills:template/SKILL.md:1-7](https://github.com/anthropics/skills/blob/main/template/SKILL.md#L1-L7).

**Registry:** `.claude-plugin/marketplace.json` groups:

- `document-skills`: XLSX, DOCX, PPTX, PDF
- `example-skills`: art, design, coauthoring, frontend, communications, MCP, skill creation, web testing and related examples
- `claude-api`: Claude API and SDK documentation

Source: [anthropics/skills:.claude-plugin/marketplace.json:1-49](https://github.com/anthropics/skills/blob/main/.claude-plugin/marketplace.json#L1-L49).

**Validation and CI:** No `.github` directory appeared in the inspected root listing, so no repository-wide GitHub Actions validator was confirmed. The official standard instead points users to the external `skills-ref validate` command, while `skill-creator` includes behavioral evaluation tools, baseline comparisons, grading, benchmark aggregation and trigger-description optimization ([agentskills.io specification](https://agentskills.io/specification), [anthropics/skills:skills/skill-creator/SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)).

**Licensing:** The repository has no single GitHub-detected root license. Anthropic states that many skills are Apache-2.0, while the document creation/editing skills in `docx`, `pdf`, `pptx`, and `xlsx` are source-available rather than open source ([anthropics/skills:README.md:20-27](https://github.com/anthropics/skills/blob/main/README.md#L20-L27)). The PDF license explicitly prohibits retaining copies outside authorized services, reproducing, creating derivative works, distributing, sublicensing, transferring, or reverse engineering the materials ([anthropics/skills:skills/pdf/LICENSE.txt:1-25](https://github.com/anthropics/skills/blob/main/skills/pdf/LICENSE.txt#L1-L25)).

**Adaptation consequence:** `skill-creator` and `webapp-testing` can be adapted under their included Apache-2.0 licenses. PDF, DOCX, PPTX, and XLSX must not be copied or adapted; equivalents require a clean-room implementation based on open document specifications and permissively licensed libraries.

**Standout skills:**

- `skill-creator`
- `webapp-testing`
- `doc-coauthoring`
- `mcp-builder`
- `frontend-design`
- `pdf`
- `docx`
- `pptx`
- `xlsx`

Source: [anthropics/skills:skills](https://api.github.com/repos/anthropics/skills/contents/skills).

### `obra/superpowers`

**Popularity:** Approximately 260,503 stars, making it the largest inspected general-purpose software-development skill framework ([repository metadata](https://api.github.com/repos/obra/superpowers)).

**Purpose:** Superpowers describes itself as an agentic skills framework and software-development methodology.

**Top-level layout:**

```text
.agents/
.claude-plugin/
.codex-plugin/
.cursor-plugin/
.kimi-plugin/
.opencode/
.pi/
.github/
skills/
tests/
scripts/
hooks/
docs/
package.json
gemini-extension.json
.version-bump.json
.pre-commit-config.yaml
RELEASE-NOTES.md
LICENSE
```

Source: [obra/superpowers root](https://api.github.com/repos/obra/superpowers/contents/).

**Standout skill catalog:**

- `brainstorming`
- `dispatching-parallel-agents`
- `executing-plans`
- `finishing-a-development-branch`
- `receiving-code-review`
- `requesting-code-review`
- `subagent-driven-development`
- `systematic-debugging`
- `test-driven-development`
- `using-git-worktrees`
- `verification-before-completion`
- `writing-plans`
- `writing-skills`

Source: [obra/superpowers:skills](https://api.github.com/repos/obra/superpowers/contents/skills).

**Frontmatter convention:** Superpowers generally uses only `name` and `description`, with descriptions beginning with trigger conditions rather than summarizing the entire process:

```yaml
---
name: systematic-debugging
description: Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes
---
```

Source: [obra/superpowers:skills/systematic-debugging/SKILL.md:1-5](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md#L1-L5).

This trigger-only approach is intentional. Superpowers’ `writing-skills` argues that putting workflow details in the description can let an agent shortcut the body rather than read it, so descriptions should concentrate on when the skill applies ([obra/superpowers:skills/writing-skills/SKILL.md](https://github.com/obra/superpowers/blob/main/skills/writing-skills/SKILL.md)).

**Testing:** The repository contains test suites for Claude Code, Codex, Codex plugin synchronization, OpenCode, Kimi, Pi, hooks, shell lint, explicit skill requests, brainstorming and systematic debugging ([obra/superpowers:tests](https://api.github.com/repos/obra/superpowers/contents/tests)). This is materially stronger than merely validating YAML.

**Pre-commit checks:** Python eval code is checked with Ruff linting, Ruff formatting and `ty` static type checking ([obra/superpowers:.pre-commit-config.yaml:1-20](https://github.com/obra/superpowers/blob/main/.pre-commit-config.yaml#L1-L20)).

**Versioning:** `.version-bump.json` updates one version across:

- `package.json`
- Claude plugin manifest
- Cursor plugin manifest
- Codex plugin manifest
- Kimi plugin manifest
- Claude marketplace manifest
- Gemini extension manifest

Source: [obra/superpowers:.version-bump.json:1-21](https://github.com/obra/superpowers/blob/main/.version-bump.json#L1-L21).

**License:** MIT ([obra/superpowers:LICENSE](https://github.com/obra/superpowers/blob/main/LICENSE)).

**Highest-value implementation patterns:**

- **Systematic debugging:** Reproduce, gather evidence, compare working examples, form one hypothesis, test minimally, implement a regression test, and stop to question architecture after repeated failed fixes ([obra/superpowers:skills/systematic-debugging/SKILL.md](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md)).
- **TDD:** Require a failing test before production code, verify the failure is for the expected reason, write minimal code, then refactor while green ([obra/superpowers:skills/test-driven-development/SKILL.md](https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md)).
- **Verification before completion:** Identify the command that proves a claim, run it fresh, read the full output and exit status, and only then make the claim ([obra/superpowers:skills/verification-before-completion/SKILL.md](https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md)).
- **Worktrees:** Detect existing isolation, prefer native runtime worktree facilities, verify manual worktree directories are ignored, install dependencies and establish a green baseline ([obra/superpowers:skills/using-git-worktrees/SKILL.md](https://github.com/obra/superpowers/blob/main/skills/using-git-worktrees/SKILL.md)).
- **Condition-based waiting:** Replace arbitrary sleeps with bounded polling of the actual condition and retain timeouts with clear errors ([obra/superpowers:skills/systematic-debugging/condition-based-waiting.md](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/condition-based-waiting.md)).

### `github/awesome-copilot`

**Popularity:** Approximately 37,002 stars ([repository metadata](https://api.github.com/repos/github/awesome-copilot)).

**Purpose:** A community-contributed collection of instructions, agents, skills, hooks, extensions, plugins and configurations for GitHub Copilot.

**Top-level organization:**

```text
.github/
.schemas/
agents/
skills/
instructions/
plugins/
hooks/
extensions/
cookbook/
docs/
eng/
package.json
CODEOWNERS
CONTRIBUTING.md
SECURITY.md
LICENSE
```

Source: [github/awesome-copilot root](https://api.github.com/repos/github/awesome-copilot/contents/).

**Validator:** `eng/validate-skills.mjs` verifies:

- `SKILL.md` exists
- frontmatter parses
- `name` exists and contains only lowercase letters, numbers, and hyphens
- name length constraints
- folder name equals skill name
- description exists and satisfies length constraints
- duplicate names are rejected
- bundled assets do not exceed 5 MB

Source: [github/awesome-copilot:eng/validate-skills.mjs:12-117](https://github.com/github/awesome-copilot/blob/main/eng/validate-skills.mjs#L12-L117).

**Automation scripts:** `package.json` includes:

- `skill:create`
- `skill:validate`
- `plugin:create`
- `plugin:validate`
- marketplace generation
- website-data generation
- generated README and marketplace builds

Source: [github/awesome-copilot:package.json:1-34](https://github.com/github/awesome-copilot/blob/main/package.json#L1-L34).

**Contribution model:** Contributors create skills with a scaffolding command, ensure folder and frontmatter names match, keep assets below 5 MB, run validation, and regenerate documentation ([github/awesome-copilot:CONTRIBUTING.md:72-90](https://github.com/github/awesome-copilot/blob/main/CONTRIBUTING.md#L72-L90)).

**Plugin model:** Plugin files declaratively list canonical top-level agents, commands and skills. CI materializes those sources into distributable plugins, preventing multiple hand-maintained copies ([github/awesome-copilot:CONTRIBUTING.md:112-148](https://github.com/github/awesome-copilot/blob/main/CONTRIBUTING.md#L112-L148)).

**External-plugin governance:** Public external plugins must:

- live in public GitHub repositories
- identify an immutable release ref, full commit SHA, or both
- declare version, license, author and repository metadata
- pass metadata validation
- pass `vally lint`
- pass an install smoke test
- receive maintainer review
- undergo six-month re-review

Source: [github/awesome-copilot:CONTRIBUTING.md:150-265](https://github.com/github/awesome-copilot/blob/main/CONTRIBUTING.md#L150-L265).

This is the strongest observed marketplace supply-chain governance pattern.

**License:** MIT ([github/awesome-copilot:LICENSE](https://github.com/github/awesome-copilot/blob/main/LICENSE)).

**Standout skills:**

- `acquire-codebase-knowledge`
- `agent-governance`
- `agent-owasp-compliance`
- `agent-supply-chain`
- `agentic-eval`
- `ai-prompt-engineering-safety-review`
- architecture and readiness skills

Source: [github/awesome-copilot:skills](https://api.github.com/repos/github/awesome-copilot/contents/skills).

**Supply-chain skill:** `agent-supply-chain` proposes deterministic SHA-256 manifests, detection of modified, missing and untracked files, dependency-pinning audits, promotion gates and CI verification ([github/awesome-copilot:skills/agent-supply-chain/SKILL.md](https://github.com/github/awesome-copilot/blob/main/skills/agent-supply-chain/SKILL.md)). Its concepts are useful, although a plain checksum file committed beside the content does not independently authenticate the content; immutable reviewed SHAs or signed attestations remain necessary.

### `addyosmani/agent-skills`

**Popularity:** Approximately 80,194 stars ([repository metadata](https://api.github.com/repos/addyosmani/agent-skills)).

**Purpose:** A production-oriented collection encoding engineering workflows, quality gates and senior-engineering practices for coding agents.

**Top-level layout:**

```text
skills/
agents/
commands/
references/
evals/
hooks/
docs/
scripts/
.agents/
.claude-plugin/
.codex-plugin/
.gemini/
.opencode/
.github/
plugin.json
AGENTS.md
CLAUDE.md
CONTRIBUTING.md
LICENSE
```

Source: [addyosmani/agent-skills root](https://api.github.com/repos/addyosmani/agent-skills/contents/).

**Catalog organization:** The repository maps skills to a development lifecycle:

```text
DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP
```

Its 24-skill catalog covers requirements, planning, implementation, TDD, source verification, debugging, review, security, performance, Git, CI/CD, migrations, documentation, observability and shipping ([addyosmani/agent-skills:README.md:1-25](https://github.com/addyosmani/agent-skills/blob/main/README.md#L1-L25), [addyosmani/agent-skills:README.md:115-220](https://github.com/addyosmani/agent-skills/blob/main/README.md#L115-L220)).

**Frontmatter convention:** Descriptions usually begin by explaining the result and then repeat explicit `Use when` trigger conditions:

```yaml
---
name: code-review-and-quality
description: Conducts multi-axis code review. Use before merging any change. Use when reviewing code written by yourself, another agent, or a human. Use when you need to assess code quality across multiple dimensions before it enters the main branch.
---
```

Source: [addyosmani/agent-skills:skills/code-review-and-quality/SKILL.md:1-5](https://github.com/addyosmani/agent-skills/blob/main/skills/code-review-and-quality/SKILL.md#L1-L5).

**Contribution quality bar:** New skills must be specific, verifiable, battle-tested and minimal. Every new skill requires:

- `SKILL.md`
- valid `name` and `description`
- an eval case at `evals/cases/<skill-name>.json`
- at least three positive trigger examples
- at least two negative trigger examples
- at least one behavioral eval
- fixture-backed execution tests unless the output is genuinely conversational

Source: [addyosmani/agent-skills:CONTRIBUTING.md:10-69](https://github.com/addyosmani/agent-skills/blob/main/CONTRIBUTING.md#L10-L69).

**Three-tier evaluation model:**

| Tier | Checks | Cost |
|---|---|---:|
| Structural | Frontmatter, naming, sections, command parity | Free CI |
| Trigger and routing | Positive prompts rank the intended skill; negatives do not; descriptions do not collide | Free CI |
| Behavioral | An agent using the skill satisfies observable expectations | Model tokens |

Source: [addyosmani/agent-skills:evals/README.md:17-44](https://github.com/addyosmani/agent-skills/blob/main/evals/README.md#L17-L44).

The deterministic routing tier uses stemmed TF-IDF over descriptions. It is not a semantic replacement for behavioral testing, but it catches missing trigger vocabulary and overly broad descriptions. Behavioral execution runs in throwaway repositories, records complete tool traces, fences traces as untrusted data for the grader, applies timeouts and validates grader JSON ([addyosmani/agent-skills:evals/README.md:35-67](https://github.com/addyosmani/agent-skills/blob/main/evals/README.md#L35-L67)).

**License:** MIT ([addyosmani/agent-skills:LICENSE](https://github.com/addyosmani/agent-skills/blob/main/LICENSE)).

**Standout skills:**

- `planning-and-task-breakdown`
- `test-driven-development`
- `source-driven-development`
- `debugging-and-error-recovery`
- `code-review-and-quality`
- `security-and-hardening`
- `performance-optimization`
- `git-workflow-and-versioning`
- `deprecation-and-migration`
- `documentation-and-adrs`
- `code-simplification`

### `ComposioHQ/awesome-claude-skills`

**Popularity:** Approximately 69,919 stars ([repository metadata](https://api.github.com/repos/ComposioHQ/awesome-claude-skills)).

**Layout:** Unlike most canonical repositories, skill directories live directly at the root:

```text
artifacts-builder/
brand-guidelines/
canvas-design/
changelog-generator/
competitive-ads-extractor/
composio-skills/
connect-apps/
content-research-writer/
developer-growth-analysis/
document-skills/
file-organizer/
invoice-organizer/
lead-research-assistant/
mcp-builder/
...
README.md
CONTRIBUTING.md
.github/
```

Source: [ComposioHQ/awesome-claude-skills root](https://api.github.com/repos/ComposioHQ/awesome-claude-skills/contents/).

**Frontmatter convention:** Standard `name` and `description`:

```yaml
---
name: changelog-generator
description: Automatically creates user-facing changelogs from git commits by analyzing commit history, categorizing changes, and transforming technical commits into clear, customer-friendly release notes.
---
```

Source: [ComposioHQ/awesome-claude-skills:changelog-generator/SKILL.md:1-5](https://github.com/ComposioHQ/awesome-claude-skills/blob/master/changelog-generator/SKILL.md#L1-L5).

**Contribution model:** Skills should solve real problems, be documented, include examples, be tested, confirm before destructive operations and remain portable across Claude platforms. The contribution template uses one root-level skill folder containing `SKILL.md` ([ComposioHQ/awesome-claude-skills:CONTRIBUTING.md:7-55](https://github.com/ComposioHQ/awesome-claude-skills/blob/master/CONTRIBUTING.md#L7-L55)).

**Validation:** A `.github` directory exists, but no repository-wide source validator was confirmed during inspection. The contribution guide requests testing but does not define automated eval requirements.

**Registry:** The README is the effective category index; no separate manifest comparable to `skills.sh.json` or a marketplace registry was confirmed.

**License:** GitHub metadata reports no repository license. Unless individual directories contain explicit licensing, content should be treated as copyrighted and not adapted.

**Standouts:** The changelog generator, content research writer, file organizer and meeting/research workflows are useful product ideas, but their absent repository-level license makes them inspiration rather than adaptation sources.

### `vercel-labs/agent-skills`

**Popularity:** Approximately 29,443 stars ([repository metadata](https://api.github.com/repos/vercel-labs/agent-skills)).

**Layout:**

```text
.github/
skills/
packages/
skills.sh.json
AGENTS.md
CLAUDE.md
README.md
```

The `skills/` directory includes both source directories and packaged ZIP artifacts ([vercel-labs/agent-skills root](https://api.github.com/repos/vercel-labs/agent-skills/contents/), [vercel-labs/agent-skills:skills](https://api.github.com/repos/vercel-labs/agent-skills/contents/skills)).

**Frontmatter convention:** Vercel’s React skill demonstrates richer metadata:

```yaml
---
name: vercel-react-best-practices
description: React and Next.js performance optimization guidelines from Vercel Engineering...
license: MIT
metadata:
  author: vercel
  version: "1.0.0"
---
```

Source: [vercel-labs/agent-skills:skills/react-best-practices/SKILL.md:1-10](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/SKILL.md#L1-L10).

This is a strong per-skill convention because the repository itself has no GitHub-detected root license. Adaptation should occur only where a specific skill declares a permissive license.

**Registry:** `skills.sh.json` groups skills into React, Vercel and Design categories and references a public schema ([vercel-labs/agent-skills:skills.sh.json:1-31](https://github.com/vercel-labs/agent-skills/blob/main/skills.sh.json#L1-L31)).

**Standout skills:**

- `vercel-react-best-practices`
- `composition-patterns`
- `react-native-skills`
- `react-view-transitions`
- `web-design-guidelines`
- `deploy-to-vercel`
- `vercel-optimize`

These are high-quality but vendor/framework-specific, so they are better placed in optional packs than enabled as repo-agnostic defaults.

### `cloudflare/skills`

**Popularity:** Approximately 2,466 stars ([repository metadata](https://api.github.com/repos/cloudflare/skills)).

**Layout:**

```text
.claude-plugin/
.cursor-plugin/
.github/
.mcp.json
commands/
rules/
skills/
CODEOWNERS
LICENSE
README.md
```

Source: [cloudflare/skills root](https://api.github.com/repos/cloudflare/skills/contents/).

**Skill catalog:**

- `agents-sdk`
- `cloudflare-email-service`
- `cloudflare-one`
- `cloudflare-one-migrations`
- `durable-objects`
- `sandbox-sdk`
- `turnstile-spin`
- `web-perf`
- `workers-best-practices`
- `wrangler`

Source: [cloudflare/skills:skills](https://api.github.com/repos/cloudflare/skills/contents/skills).

**Registry:** Claude marketplace metadata identifies a Cloudflare plugin and uses the official Claude marketplace schema ([cloudflare/skills:.claude-plugin/marketplace.json:1-13](https://github.com/cloudflare/skills/blob/main/.claude-plugin/marketplace.json#L1-L13)).

**License:** Apache-2.0 ([cloudflare/skills:LICENSE](https://github.com/cloudflare/skills/blob/main/LICENSE)).

**Standout generalizable implementation:** `web-perf` requires real Chrome DevTools measurements, current-document retrieval, quantified findings, network analysis and codebase inspection instead of speculative optimization ([cloudflare/skills:skills/web-perf/SKILL.md:1-80](https://github.com/cloudflare/skills/blob/main/skills/web-perf/SKILL.md#L1-L80)). Its evidence-first approach is useful for a generic performance-profiling skill.

### `stripe/ai`

**Popularity:** Approximately 1,704 stars ([repository metadata](https://api.github.com/repositories/886826524)).

The repository was formerly reached through `stripe/agent-toolkit` but redirects to `stripe/ai`.

**Purpose:** SDKs and tooling for AI products using Stripe, including AI SDK billing, token metering and Stripe’s remote MCP server.

**Skill distribution:** Stripe recommends official plugins for Claude Code, Codex, Cursor and Grok. Manual installation uses:

```bash
npx skills add https://docs.stripe.com
```

Source: [stripe/ai:README.md:20-63](https://github.com/stripe/ai/blob/main/README.md#L20-L63).

**Implication:** Stripe is important evidence that vendors are publishing skills through documentation endpoints and official plugin marketplaces rather than necessarily maintaining a visible `skills/` source tree. This supports runtime compatibility, but a mutable documentation URL is unsuitable as a vendored dependency unless the fetched content is reviewed and pinned.

**License:** The repository code is MIT ([stripe/ai:README.md](https://github.com/stripe/ai/blob/main/README.md)), but that does not automatically establish the license of dynamically served skill content.

### `VoltAgent/awesome-agent-skills`

**Popularity:** Approximately 28,850 stars ([repository metadata](https://api.github.com/repos/VoltAgent/awesome-agent-skills)).

**Structure:** README-only external catalog, plus CONTRIBUTING and MIT license. No embedded skills, validator or manifest were present in the inspected root ([VoltAgent/awesome-agent-skills root](https://api.github.com/repos/VoltAgent/awesome-agent-skills/contents/)).

**Contribution requirements:**

- public repository
- working documented skill
- author or organization prefix
- short description
- real community usage
- mature rather than newly generated

Source: [VoltAgent/awesome-agent-skills:CONTRIBUTING.md:1-38](https://github.com/VoltAgent/awesome-agent-skills/blob/main/CONTRIBUTING.md#L1-L38).

This is useful as a discovery index, but it does not validate or license the linked third-party content.

### `travisvn/awesome-claude-skills`

**Popularity:** Approximately 14,276 stars ([repository metadata](https://api.github.com/repos/travisvn/awesome-claude-skills)).

**Structure:** README, CONTRIBUTING and `.gitignore`; no embedded skill directories or validator ([travisvn/awesome-claude-skills root](https://api.github.com/repos/travisvn/awesome-claude-skills/contents/)).

**Curation policy:**

- standalone value rather than promotional SaaS wrappers
- documented and tested skills
- social proof, normally at least ten GitHub stars
- one item per PR
- link and license information
- rejection of trivial, low-effort or newly generated submissions

Source: [travisvn/awesome-claude-skills:CONTRIBUTING.md:44-108](https://github.com/travisvn/awesome-claude-skills/blob/main/CONTRIBUTING.md#L44-L108).

**License:** GitHub metadata reports no repository license.

The social-proof requirement is a pragmatic spam filter, but stars should not substitute for source review, testing or licensing checks.

### `alirezarezvani/claude-skills`

**Popularity:** Approximately 23,125 stars ([repository metadata](https://api.github.com/repos/alirezarezvani/claude-skills)).

**Scale:** Repository metadata describes hundreds of skills, dozens of agents and commands across engineering, product, marketing, compliance, finance, research and operations.

**Structure:** The root includes:

- Claude, Codex, Gemini and other runtime metadata
- `.github`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `CONVENTIONS.md`
- `SECURITY.md`
- `SKILL-AUTHORING-STANDARD.md`
- `SKILL_PIPELINE.md`
- `STORE.md`
- agents and skill collections

Source: [alirezarezvani/claude-skills root](https://api.github.com/repos/alirezarezvani/claude-skills/contents/).

**License:** MIT ([repository metadata](https://api.github.com/repos/alirezarezvani/claude-skills)).

This repository demonstrates the scalability benefits of explicit conventions, pipeline documentation, changelog and store metadata. Its breadth also demonstrates the risk of shipping too many defaults: a large catalog increases routing collisions, context pressure, stale guidance and review burden.

## Common Structural Patterns Worth Copying

### 1. One Skill Per Kebab-Case Directory

The dominant convention is:

```text
skills/
└── skill-name/
    ├── SKILL.md
    ├── scripts/
    ├── references/
    └── assets/
```

Benefits:

- direct compatibility with the Agent Skills standard
- simple per-skill installation
- easy ownership and licensing
- independent testing
- clean progressive disclosure
- straightforward registry generation

Anthropic, Superpowers, GitHub Awesome Copilot, Addy Osmani, Vercel and Cloudflare all use this pattern or a close variant.

### 2. Minimal Required Frontmatter

`name` and `description` are universally interoperable. Optional fields should be additive, not required for activation.

Recommended policy:

- require `name`
- require `description`
- require `license` in this repository even though the standard makes it optional
- strongly recommend `metadata.author` and `metadata.version`
- require provenance metadata for adapted content
- use `compatibility` only where real dependencies exist
- use `allowed-tools` sparingly

### 3. Descriptions Are Routing Interfaces

The description determines whether an agent loads the skill. Strong descriptions contain realistic trigger vocabulary and state both the capability and applicable contexts.

Two observed styles are defensible:

- **Anthropic/Addy:** what the skill does plus when it applies
- **Superpowers:** trigger conditions only, to discourage agents from shortcutting the body

For cross-runtime behavior, the safer default is:

> First sentence: concise capability.  
> Subsequent sentences: explicit “Use when…” trigger conditions.  
> Do not compress the whole workflow into the description.

Descriptions should be evaluated with realistic positive and negative prompts rather than reviewed by intuition alone.

### 4. Progressive References Instead of Huge Skill Bodies

Use the primary `SKILL.md` for:

- activation criteria
- core workflow
- decision points
- verification requirements
- links to supporting material

Use `references/` for:

- long API guidance
- language-specific variants
- schemas
- security checklists
- example reports

Use `scripts/` when multiple eval runs independently recreate the same deterministic work. Anthropic’s `skill-creator` explicitly identifies repeated helper creation across evals as a signal to bundle a script ([anthropics/skills:skills/skill-creator/SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)).

### 5. Canonical Content Plus Generated Adapters

Do not maintain separate hand-edited copies for Claude, Copilot and Codex. Instead:

- canonical content lives under `skills/`
- runtime-specific manifests point to canonical paths
- packaging scripts materialize files only when distribution requires it
- CI regenerates adapters and fails if the working tree changes

GitHub Awesome Copilot’s declarative plugin model and Superpowers’ shared version-bump configuration are the strongest examples ([github/awesome-copilot:CONTRIBUTING.md:112-148](https://github.com/github/awesome-copilot/blob/main/CONTRIBUTING.md#L112-L148), [obra/superpowers:.version-bump.json:1-21](https://github.com/obra/superpowers/blob/main/.version-bump.json#L1-L21)).

### 6. Verification Sections and Exit Criteria

High-quality skills do not merely provide advice. They specify observable completion criteria:

- commands run
- expected exit status
- tests passing
- artifacts produced
- evidence reviewed
- unresolved uncertainty reported

This is especially consistent across Superpowers and Addy Osmani’s collection.

### 7. Anti-Rationalization Guidance

Superpowers and Addy’s skills often include:

- common excuses
- why each excuse is unsafe
- red flags indicating the process is being skipped
- explicit stop conditions

This is valuable for discipline-enforcing skills such as TDD, debugging and verification. It is less suitable for output-shaping skills, where a positive output contract is usually clearer than a long prohibition list.

## Ranked Default-Skill Candidates

Priority interpretation:

- **P0:** Ship in the first release and enable as the core default set.
- **P1:** High-value follow-up skills; include in the repository but consider optional activation or a second milestone.
- **P2:** Useful specialized packs with greater implementation or dependency cost.

| Rank | Proposed skill | Priority | One-line description | Why it is high value | Existing implementation and license |
|---:|---|---|---|---|---|
| 1 | `skill-creator` | P0 | Creates, edits, evaluates and iteratively improves Agent Skills, including trigger descriptions and behavioral tests. | Makes the repository self-extending while enforcing its own quality standard; every future contribution benefits. | Adapt Anthropic’s Apache-2.0 implementation: [`anthropics/skills/skills/skill-creator`](https://github.com/anthropics/skills/tree/main/skills/skill-creator), license at [`LICENSE.txt`](https://github.com/anthropics/skills/blob/main/skills/skill-creator/LICENSE.txt). |
| 2 | `requirements-and-spec-writing` | P0 | Converts ambiguous requests into approved objectives, boundaries, requirements, acceptance criteria and non-goals before implementation. | Ambiguity is one of the largest sources of wasted agent work and unrequested scope. | Combine Addy’s MIT [`spec-driven-development`](https://github.com/addyosmani/agent-skills/tree/main/skills/spec-driven-development) with Obra’s MIT [`brainstorming`](https://github.com/obra/superpowers/tree/main/skills/brainstorming). |
| 3 | `planning-and-task-breakdown` | P0 | Decomposes a specification into small, ordered, dependency-aware tasks with acceptance criteria and verification commands. | Makes long work resumable, parallelizable and auditable; reduces tangled multi-file implementations. | Adapt Addy’s MIT [`planning-and-task-breakdown`](https://github.com/addyosmani/agent-skills/blob/main/skills/planning-and-task-breakdown/SKILL.md). |
| 4 | `systematic-debugging` | P0 | Reproduces failures, gathers evidence, traces data flow, tests one hypothesis and fixes the root cause rather than symptoms. | Prevents high-cost guess-and-check loops and repeated speculative patches. | Adapt Obra’s MIT [`systematic-debugging`](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md). |
| 5 | `test-driven-development` | P0 | Uses red-green-refactor: write a meaningful failing behavior test, verify the failure, implement minimally and refactor while green. | Improves correctness, regression protection and API design while preventing ceremonial tests written after implementation. | Adapt Obra’s MIT [`test-driven-development`](https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md), optionally incorporating Addy’s test-pyramid material. |
| 6 | `verification-before-completion` | P0 | Requires fresh command output and artifact inspection before any claim that work is complete, fixed, passing or ready. | Directly addresses agents’ tendency to report likely success without current evidence. | Adapt Obra’s MIT [`verification-before-completion`](https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md). |
| 7 | `code-review` | P0 | Reviews correctness, tests, readability, architecture, security and performance, then reports severity-ranked actionable findings. | Every repository needs review, regardless of language or framework; catches cross-cutting defects before merge. | Adapt Addy’s MIT [`code-review-and-quality`](https://github.com/addyosmani/agent-skills/blob/main/skills/code-review-and-quality/SKILL.md) and Obra’s MIT requesting/receiving review workflows. |
| 8 | `git-and-pr-workflow` | P0 | Handles atomic commits, worktrees, rebases and conflicts, branch completion, PR descriptions, integration choices and safe cleanup. | Git is the recovery and collaboration layer for every coding agent; disciplined history limits blast radius. | Combine Addy’s MIT [`git-workflow-and-versioning`](https://github.com/addyosmani/agent-skills/tree/main/skills/git-workflow-and-versioning), Obra’s MIT [`using-git-worktrees`](https://github.com/obra/superpowers/tree/main/skills/using-git-worktrees), and [`finishing-a-development-branch`](https://github.com/obra/superpowers/tree/main/skills/finishing-a-development-branch). |
| 9 | `security-review-and-threat-modeling` | P0 | Maps assets and trust boundaries, applies STRIDE, checks authorization, injection, secret exposure, dependency risk and unsafe external data flows. | Security failures are expensive and often invisible to ordinary correctness tests; the skill is broadly applicable to APIs, files, auth and integrations. | Adapt Addy’s MIT [`security-and-hardening`](https://github.com/addyosmani/agent-skills/blob/main/skills/security-and-hardening/SKILL.md). |
| 10 | `web-research-and-verification` | P0 | Detects relevant versions, prioritizes authoritative sources, verifies claims, cites decisions and labels anything that remains unverified. | Models’ framework knowledge becomes stale; source verification prevents deprecated APIs and fabricated details. | Adapt Addy’s MIT [`source-driven-development`](https://github.com/addyosmani/agent-skills/blob/main/skills/source-driven-development/SKILL.md), generalized beyond framework code. |
| 11 | `documentation-maintenance` | P0 | Maintains README, API docs, ADRs and changelogs while documenting rationale, setup and user-visible changes. | Documentation is durable context for humans and agents and reduces repeated rediscovery. | Adapt Addy’s MIT [`documentation-and-adrs`](https://github.com/addyosmani/agent-skills/tree/main/skills/documentation-and-adrs). |
| 12 | `codebase-exploration` | P1 | Builds a focused map of architecture, conventions, entry points, dependencies and data flow before modifying an unfamiliar repository. | Reduces wrong-layer edits, duplicate abstractions and accidental convention violations. | Adapt GitHub’s MIT [`acquire-codebase-knowledge`](https://github.com/github/awesome-copilot/tree/main/skills/acquire-codebase-knowledge). |
| 13 | `test-reliability` | P1 | Diagnoses flaky tests and replaces arbitrary sleeps with bounded condition-based waits and useful timeout diagnostics. | Flaky tests disproportionately waste CI and agent time and can hide real regressions. | Adapt Obra’s MIT [`condition-based-waiting.md`](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/condition-based-waiting.md). |
| 14 | `refactoring-and-dead-code-removal` | P1 | Simplifies code incrementally, preserves exact behavior, respects Chesterton’s Fence and removes only verified dead code. | Agents often over-refactor or delete code they do not understand; this creates a safe evidence-based process. | Adapt Addy’s MIT [`code-simplification`](https://github.com/addyosmani/agent-skills/tree/main/skills/code-simplification). |
| 15 | `performance-profiling` | P1 | Establishes a baseline, profiles the real bottleneck, applies one targeted change, remeasures and installs a regression guard. | Prevents speculative micro-optimization and produces measurable improvements. | Adapt Addy’s MIT [`performance-optimization`](https://github.com/addyosmani/agent-skills/tree/main/skills/performance-optimization) and Cloudflare’s Apache-2.0 [`web-perf`](https://github.com/cloudflare/skills/tree/main/skills/web-perf). |
| 16 | `dependency-upgrades-and-migrations` | P1 | Plans version upgrades and system migrations with compatibility research, staged rollout, expand/contract changes, rollback and cleanup. | Dependency changes are common, cross-cutting and risky; generic agents frequently update versions without migration analysis. | Adapt Addy’s MIT [`deprecation-and-migration`](https://github.com/addyosmani/agent-skills/tree/main/skills/deprecation-and-migration). |
| 17 | `webapp-testing` | P1 | Exercises browser flows and inspects DOM, console, network, screenshots and accessibility evidence. | UI correctness cannot be established from static source alone. | Adapt Anthropic’s Apache-2.0 [`webapp-testing`](https://github.com/anthropics/skills/tree/main/skills/webapp-testing). |
| 18 | `agent-supply-chain-audit` | P1 | Audits skill and plugin provenance, immutable pins, checksums, dependency versions, bundled scripts and unexpected files. | Third-party skills can execute instructions and scripts with repository access, making them a meaningful supply-chain surface. | Adapt GitHub’s MIT [`agent-supply-chain`](https://github.com/github/awesome-copilot/blob/main/skills/agent-supply-chain/SKILL.md), strengthened with signed or immutable provenance. |
| 19 | `parallel-agent-orchestration` | P1 | Identifies independent work, dispatches isolated agents with explicit contracts and reconciles their results safely. | Parallel execution can reduce latency substantially, but only when tasks do not share mutable state or hidden dependencies. | Adapt Obra’s MIT [`dispatching-parallel-agents`](https://github.com/obra/superpowers/tree/main/skills/dispatching-parallel-agents). |
| 20 | `pdf` | P2 | Extracts text and tables, fills forms, merges, splits, creates and validates PDF files. | Broadly useful outside coding, but dependency-heavy and difficult to validate reliably. | Anthropic’s implementation cannot be copied or adapted because its source-available license prohibits derivatives; build independently using open specifications and permissive libraries: [`anthropics/skills/skills/pdf/LICENSE.txt`](https://github.com/anthropics/skills/blob/main/skills/pdf/LICENSE.txt). |
| 21 | `xlsx` | P2 | Reads, writes and validates spreadsheets while preserving formulas, styles and cell types. | Valuable for data workflows but requires careful formula, formatting and rendering validation. | Anthropic’s implementation is source-available only; clean-room implementation required: [`anthropics/skills/README.md`](https://github.com/anthropics/skills/blob/main/README.md#L20-L27). |
| 22 | `docx` | P2 | Creates and edits Word documents with layout, style and rendering verification. | Useful for business workflows but not core to repository engineering and costly to test across renderers. | Anthropic’s implementation is source-available only; clean-room implementation required. |
| 23 | `pptx` | P2 | Creates and edits presentations with slide-layout, overflow and rendering checks. | High-value for artifact generation but specialized and implementation-heavy. | Anthropic’s implementation is source-available only; clean-room implementation required. |

## P0 Skill Design Recommendations

### `skill-creator`

The first-release implementation should combine Anthropic’s comparative eval process with Addy’s deterministic catalog-routing tests.

Required workflow:

1. Capture intent, triggers, outputs, constraints and dependencies.
2. Search the existing catalog for overlap.
3. Draft realistic positive and negative trigger prompts.
4. Run baseline behavior without the skill.
5. Draft the skill using progressive disclosure.
6. Run with-skill behavior against the same cases.
7. Grade observable expectations.
8. Compare accuracy, tokens and runtime.
9. Revise the description for routing and the body for behavior.
10. Validate structure, links, license and provenance.
11. Regenerate registries and runtime adapters.

Every new skill should ship with:

```text
skills/<name>/
├── SKILL.md
├── LICENSE        # Only if different from repository default
├── scripts/       # When deterministic helpers are justified
├── references/    # Long or variant-specific guidance
└── assets/        # Templates or fixtures

evals/cases/<name>.json
evals/fixtures/<name>/
```

Anthropic’s `skill-creator` compares with-skill against no-skill or old-skill baselines and aggregates pass rates, timing and token usage ([anthropics/skills:skills/skill-creator/SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)). Addy’s eval system adds deterministic routing checks and description-collision detection ([addyosmani/agent-skills:evals/README.md](https://github.com/addyosmani/agent-skills/blob/main/evals/README.md)).

### `requirements-and-spec-writing`

This skill should combine brainstorming and formal specification rather than shipping overlapping `brainstorming`, `idea-refine`, `interview-me`, and `spec-driven-development` defaults.

Expected output:

```markdown
# Specification: <title>

## Objective
## User and Use Cases
## Requirements
## Non-Goals
## Existing-System Constraints
## Interfaces and Data Contracts
## Security and Privacy
## Error and Edge Cases
## Acceptance Criteria
## Open Questions
## Alternatives Considered
## Rollout and Rollback
```

The skill should ask one focused question at a time only when the answer cannot be inferred from existing context. It should distinguish facts, assumptions and unresolved decisions.

### `planning-and-task-breakdown`

Each task should contain:

```markdown
## Task N: <small outcome>

**Purpose:** Why this task exists.

**Dependencies:** Tasks or interfaces that must exist first.

**Files likely touched:**
- `path`

**Acceptance criteria:**
- [ ] Observable result

**Verification:**
- [ ] Exact command or inspection

**Estimated scope:** XS / S / M
```

Tasks should be vertical slices wherever possible. Large tasks, titles containing multiple independent “and” clauses, and tasks touching unrelated subsystems should be split. Addy’s implementation provides a strong starting point ([addyosmani/agent-skills:skills/planning-and-task-breakdown/SKILL.md](https://github.com/addyosmani/agent-skills/blob/main/skills/planning-and-task-breakdown/SKILL.md)).

### `systematic-debugging`

Required phases:

1. Read complete errors and traces.
2. Reproduce consistently.
3. Inspect recent changes and environmental differences.
4. Add instrumentation at component boundaries.
5. Trace bad state backward to its origin.
6. Compare with a working example.
7. State one falsifiable hypothesis.
8. Test with the smallest possible change.
9. Add a regression test.
10. Implement one root-cause fix.
11. Run focused and full verification.
12. If repeated fixes expose unrelated coupling, stop and reconsider architecture.

This should remain separate from TDD: debugging identifies the cause; TDD proves and guards the correction.

### `test-driven-development`

The default should be strict about the observable cycle but not language-specific:

```text
RED
- Define one behavior.
- Write the smallest meaningful test.
- Run it.
- Confirm it fails for the expected missing behavior.

GREEN
- Implement the minimum production change.
- Run the focused test.
- Run affected tests.

REFACTOR
- Improve structure without changing behavior.
- Keep tests green.
```

Exceptions such as generated code, disposable exploration or configuration-only work should require explicit user or repository policy, not silent agent discretion.

### `verification-before-completion`

This should be extremely small and frequently loaded:

```text
Before any success claim:

1. Identify the evidence that proves it.
2. Run the complete verification now.
3. Read output and exit status.
4. Inspect produced artifacts or diff when relevant.
5. Report the actual result, including failures.
6. Only then state completion.
```

It should explicitly distinguish:

- tests from linting
- linting from compilation
- compilation from runtime behavior
- a subagent’s report from independently verified state
- a passing focused test from a passing complete suite

### `code-review`

Recommended report contract:

```markdown
## Verdict
Approve | Request changes | Block

## Findings

### Critical
- `path:line` — defect, impact, evidence, recommended correction

### Required
- ...

### Optional
- ...

## Verification Performed
- Commands and artifacts inspected

## Residual Risks
- Anything not verified
```

The review should begin with requirements and tests, then assess:

1. Correctness
2. Test quality
3. Readability and complexity
4. Architecture and boundaries
5. Security and privacy
6. Performance and resource use
7. Documentation and migration impact

Addy’s five-axis review is a strong implementation source ([addyosmani/agent-skills:skills/code-review-and-quality/SKILL.md](https://github.com/addyosmani/agent-skills/blob/main/skills/code-review-and-quality/SKILL.md)).

### `git-and-pr-workflow`

This should consolidate several overlapping Git skills behind one router and progressive references:

```text
git-and-pr-workflow/
├── SKILL.md
└── references/
    ├── commits.md
    ├── worktrees.md
    ├── rebase-and-conflicts.md
    ├── pull-requests.md
    └── release-and-versioning.md
```

Core rules:

- inspect status and diff before action
- never discard work without explicit confirmation
- prefer small atomic commits
- do not rewrite shared history without approval
- run fresh verification before commit or PR
- use worktrees for parallel isolated changes
- preserve a PR worktree while review feedback remains possible
- write PR descriptions from actual diff, tests and risk—not memory
- include rollout, rollback and unresolved concerns where relevant

### `security-review-and-threat-modeling`

The skill should begin with system context rather than immediately scanning for known vulnerability patterns:

1. Identify assets.
2. Identify actors and privilege levels.
3. Map trust boundaries and data flows.
4. Apply STRIDE to each boundary.
5. Write abuse cases.
6. Review authentication and authorization.
7. Review validation, encoding and injection.
8. Review secret handling and logs.
9. Review dependency and build provenance.
10. Review availability, size limits, timeouts and rate limits.
11. Verify controls with tests or configuration evidence.
12. Rank findings by exploitability and impact.

Addy’s implementation explicitly treats LLM output as untrusted boundary data, which is important for agentic applications ([addyosmani/agent-skills:skills/security-and-hardening/SKILL.md](https://github.com/addyosmani/agent-skills/blob/main/skills/security-and-hardening/SKILL.md)).

### `web-research-and-verification`

Recommended source hierarchy:

1. Current implementation source code
2. Official versioned documentation
3. Official changelogs and migration guides
4. Standards documents
5. Maintainer issues and pull requests
6. Reputable secondary material
7. General web sources

The skill should:

- detect exact versions before researching
- search to discover, then fetch primary sources directly
- quote sparingly and cite full URLs
- separate verified facts from inference
- record date-sensitive information
- surface conflicting authoritative sources
- explicitly label unverified claims

Addy’s `source-driven-development` supplies a strong implementation foundation ([addyosmani/agent-skills:skills/source-driven-development/SKILL.md](https://github.com/addyosmani/agent-skills/blob/main/skills/source-driven-development/SKILL.md)).

### `documentation-maintenance`

This skill should deduplicate README, ADR, API documentation and changelog workflows under one activation point, using progressive references if needed.

Required checks:

- inspect existing documentation conventions
- update documentation affected by the current change
- document why and trade-offs, not obvious code behavior
- preserve historical ADRs and supersede rather than delete
- derive changelog entries from verified user-visible differences
- verify commands and links
- avoid claiming support for behavior not tested
- keep runtime instruction files such as `AGENTS.md`, `CLAUDE.md`, or Copilot instructions aligned with reality

## Governance Patterns

### Versioning

Observed approaches include:

1. **Repository-wide versions:** Superpowers uses one release version synchronized across multiple runtime manifests ([obra/superpowers:.version-bump.json](https://github.com/obra/superpowers/blob/main/.version-bump.json)).
2. **Per-skill metadata versions:** Vercel includes `metadata.version` inside individual skills ([vercel-labs/agent-skills:skills/react-best-practices/SKILL.md:1-10](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/SKILL.md#L1-L10)).
3. **Plugin semantic versions:** GitHub Awesome Copilot’s plugin manifests require versions and generated marketplace metadata.
4. **Changelog-driven repository evolution:** Superpowers and alirezarezvani maintain substantial release notes or changelogs.
5. **Unversioned skills tied to Git history:** Many repositories rely solely on commit history, which is simple but makes downstream pinning and compatibility reporting harder.

Recommended model:

- semantic-version the repository and generated runtime plugin packages
- include `metadata.version` per skill
- increment a skill’s version only when its instructions, resources, trigger behavior or compatibility changes
- record adapted source commit SHAs
- publish immutable Git tags
- generate a changelog showing changed skills
- allow users to install a repository release or a specific skill at a release

### Testing

Observed maturity levels:

| Level | Example | Characteristics |
|---|---|---|
| Documentation only | Awesome lists | Human curation and links |
| Structural validation | GitHub Awesome Copilot | YAML, name/folder match, description, duplicate name, asset size |
| Script/static checks | Superpowers | Ruff, formatting, type checks, shell lint, runtime integration tests |
| Trigger evaluation | Addy Osmani | Positive/negative routing tests and description collision checks |
| Behavioral evaluation | Anthropic, Superpowers, Addy | Real prompts, baseline comparison, agent execution, grading and pressure scenarios |

Recommended mandatory gates:

```text
Gate 1: Structure
- Parse frontmatter
- Check folder/name equality
- Check uniqueness
- Validate required fields and limits
- Verify internal links and referenced files
- Reject oversized or unexpected binary assets

Gate 2: License and provenance
- Require a license declaration
- Require source repository and immutable commit for adaptations
- Check compatibility between upstream and repository license

Gate 3: Static safety
- Scan scripts and prompts
- Reject undeclared network access
- Reject mutable remote execution
- Scan for secrets and destructive commands
- Lint shell, Python and JavaScript helpers

Gate 4: Trigger routing
- Positive prompts
- Negative prompts
- Pairwise collision checks
- Minimum rank-one target

Gate 5: Behavioral
- Baseline without skill
- Run with skill
- Verify observable expectations
- Include pressure and adversarial cases where appropriate

Gate 6: Packaging
- Generate all manifests and adapters
- Fail on working-tree drift
- Smoke-test installation in supported runtimes
```

### Third-Party Contributions

Strong observed contribution controls include:

- GitHub Awesome Copilot’s immutable source refs, automated lint, installation smoke test, maintainer approval and scheduled re-review.
- Addy Osmani’s requirement that contributors justify the gap and add trigger and behavioral eval cases.
- Composio’s requirement for real use cases, examples, portability and confirmation before destructive operations.
- VoltAgent and TravisVN’s community-usage or social-proof filters.
- CODEOWNERS in GitHub and Cloudflare repositories.

Recommended contribution checklist:

```markdown
## Contribution checklist

- [ ] The skill solves a reusable cross-repository problem.
- [ ] Existing skills and open PRs were checked for overlap.
- [ ] The PR explains why this is a new skill rather than an extension.
- [ ] `name`, folder and description follow the specification.
- [ ] License is explicit.
- [ ] Adapted content identifies source URL, path, license and commit SHA.
- [ ] Positive and negative trigger evals are included.
- [ ] At least one behavioral eval is included.
- [ ] Scripts have tests and declared dependencies.
- [ ] Network, filesystem and tool requirements are declared.
- [ ] Destructive actions require explicit user confirmation.
- [ ] Generated manifests and adapters are current.
```

### Prompt-Injection and Supply-Chain Risk

A skill can influence tool execution, inspect repositories, run scripts and potentially access secrets. Third-party skills must therefore be treated as executable dependencies.

Observed controls:

- Anthropic’s `skill-creator` states that skills must not contain malware, exploits, exfiltration behavior or surprising capabilities.
- Addy’s behavioral evaluator fences execution traces as untrusted data before sending them to graders.
- GitHub Awesome Copilot requires immutable external plugin sources, linting, smoke tests, maintainer review and scheduled re-review.
- GitHub’s `agent-supply-chain` skill demonstrates hashing, dependency pinning and promotion gates.

Recommended controls:

1. **Immutable provenance**
   - Require source repository, path and full commit SHA.
   - Prefer signed tags or attestations.
   - Never track a third-party branch or mutable documentation endpoint as the trusted source.

2. **License verification**
   - Require explicit per-skill licensing.
   - Treat absent licensing as “do not adapt.”
   - Preserve notices and attribution required by upstream licenses.

3. **No automatic unreviewed updates**
   - Dependency-update automation may open PRs.
   - It must not directly merge third-party prompt changes.
   - Every update should show a readable diff and rerun behavioral evals.

4. **Static instruction scanning**
   - Flag attempts to override system or user instructions.
   - Flag requests to expose credentials or hidden configuration.
   - Flag remote content treated as trusted instructions.
   - Flag destructive commands without confirmation.
   - Flag broad filesystem access not justified by the description.

5. **Script restrictions**
   - Ban `curl ... | sh`, `wget ... | bash`, mutable `@latest`, and equivalent runtime downloads.
   - Require pinned dependencies and lockfiles.
   - Run scripts without ambient secrets.
   - Apply ShellCheck, Ruff, type checking and dependency audits.

6. **Network declarations**
   - Skills requiring network access must declare it in `compatibility`.
   - Allowlist expected domains where practical.
   - Treat fetched content as data, not higher-priority instructions.

7. **Tool minimization**
   - Declare only tools necessary to perform the workflow.
   - Avoid broad shell approval when read-only Git or file tools are sufficient.
   - Destructive operations should remain interactive.

8. **Behavioral security evals**
   - Include malicious repository documents that tell the agent to ignore the skill.
   - Include poisoned issue text, build logs and fetched web pages.
   - Verify the agent treats them as untrusted evidence.
   - Verify secrets are neither printed nor transmitted.

9. **Integrity manifests**
   - Generate deterministic file hashes for released skill packages.
   - Store hashes in release metadata or signed attestations, not merely beside mutable files.
   - Verify packages before installation.

10. **Periodic re-review**
    - Re-review third-party adaptations when upstream changes, dependencies age or the skill has not been exercised recently.
    - GitHub Awesome Copilot’s six-month external-plugin review is a reasonable starting cadence.

## Recommended Repository Architecture

```text
AgentSkills/
├── README.md
├── LICENSE
├── SECURITY.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── CHANGELOG.md
├── AGENTS.md
│
├── skills/
│   ├── skill-creator/
│   │   ├── SKILL.md
│   │   ├── scripts/
│   │   ├── references/
│   │   └── assets/
│   ├── requirements-and-spec-writing/
│   │   └── SKILL.md
│   ├── planning-and-task-breakdown/
│   │   └── SKILL.md
│   ├── systematic-debugging/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── root-cause-tracing.md
│   │       └── condition-based-waiting.md
│   └── ...
│
├── evals/
│   ├── README.md
│   ├── cases/
│   │   └── <skill-name>.json
│   ├── fixtures/
│   │   └── <skill-name>/
│   ├── schemas/
│   └── runners/
│
├── registry/
│   ├── skills.json
│   ├── groups.json
│   └── provenance.json
│
├── adapters/
│   ├── claude/
│   │   └── marketplace.json
│   ├── codex/
│   │   └── plugin.json
│   └── copilot/
│       └── plugins/
│
├── schemas/
│   ├── skill.schema.json
│   ├── eval.schema.json
│   └── registry.schema.json
│
├── scripts/
│   ├── create-skill
│   ├── validate-skills
│   ├── run-routing-evals
│   ├── run-behavioral-evals
│   ├── generate-registry
│   ├── generate-adapters
│   ├── check-generated
│   └── audit-provenance
│
└── .github/
    ├── CODEOWNERS
    ├── pull_request_template.md
    └── workflows/
        ├── validate.yml
        ├── eval-routing.yml
        ├── package-smoke-test.yml
        ├── security.yml
        └── release.yml
```

### Canonical Registry Record

A generated registry should be derived from each `SKILL.md`, not hand-maintained:

```json
{
  "name": "systematic-debugging",
  "description": "Investigates bugs, failing tests, build failures, and unexpected behavior by reproducing the issue, gathering evidence, tracing root cause, and testing one hypothesis at a time.",
  "version": "1.0.0",
  "license": "MIT",
  "path": "skills/systematic-debugging",
  "priority": "P0",
  "categories": ["debugging", "verification"],
  "compatibility": {
    "claude-code": true,
    "github-copilot": true,
    "openai-codex": true
  },
  "provenance": {
    "repository": "https://github.com/obra/superpowers",
    "path": "skills/systematic-debugging",
    "commit": "<full-sha>",
    "adapted": true
  }
}
```

### Adapter Policy

Adapters should contain metadata only. Skill bodies should never be duplicated under runtime-specific directories unless a packaging format requires materialization.

Generation sequence:

```text
skills/*/SKILL.md
        │
        ├── validate metadata and provenance
        ├── generate registry/skills.json
        ├── generate Claude marketplace
        ├── generate Codex plugin metadata
        ├── generate Copilot plugin metadata
        └── package release archives
```

CI should run generation and fail if `git diff --exit-code` reports changes.

## Recommended Release Scope

### Initial P0 Release

```text
skill-creator
requirements-and-spec-writing
planning-and-task-breakdown
systematic-debugging
test-driven-development
verification-before-completion
code-review
git-and-pr-workflow
security-review-and-threat-modeling
web-research-and-verification
documentation-maintenance
```

This set is small enough to review and route reliably while covering the complete core lifecycle:

```text
UNDERSTAND
  requirements-and-spec-writing
        ↓
PLAN
  planning-and-task-breakdown
        ↓
IMPLEMENT
  test-driven-development
  git-and-pr-workflow
        ↓
INVESTIGATE
  systematic-debugging
        ↓
VERIFY
  verification-before-completion
        ↓
REVIEW
  code-review
  security-review-and-threat-modeling
        ↓
DOCUMENT
  documentation-maintenance

CROSS-CUTTING:
  web-research-and-verification
  skill-creator
```

### P1 Follow-Up

```text
codebase-exploration
test-reliability
refactoring-and-dead-code-removal
performance-profiling
dependency-upgrades-and-migrations
webapp-testing
agent-supply-chain-audit
parallel-agent-orchestration
```

### Optional P2 Artifact Pack

```text
pdf
xlsx
docx
pptx
```

The artifact pack should be independently licensed and implemented clean-room. It should not reuse Anthropic’s source-available document skill instructions, scripts, prompts, assets or derivative structure.

## Licensing Conclusions

| Source | Adaptation status |
|---|---|
| `obra/superpowers` | Safe to adapt under MIT with attribution and notice preservation |
| `addyosmani/agent-skills` | Safe to adapt under MIT with attribution and notice preservation |
| `github/awesome-copilot` | Safe to adapt repository content under MIT, subject to checking bundled third-party notices where relevant |
| Anthropic `skill-creator`, `webapp-testing`, and other per-skill Apache examples | Safe to adapt under their included Apache-2.0 licenses and notice requirements |
| Anthropic PDF/DOCX/PPTX/XLSX | Do not copy or derive; source-available restrictions prohibit adaptation |
| `cloudflare/skills` | Safe to adapt under Apache-2.0 with notices |
| Vercel skills | Adapt only skills with explicit per-skill permissive license; repository has no detected root license |
| `ComposioHQ/awesome-claude-skills` | Do not adapt absent explicit licensing |
| `travisvn/awesome-claude-skills` | Index only; verify the license of every linked source independently |
| `VoltAgent/awesome-agent-skills` | Index itself is MIT, but linked skills retain their own licenses |
| Dynamically served vendor skills such as Stripe docs | Do not assume the SDK repository license covers remotely served skill content |

## Gaps and Uncertainties

- GitHub code search for `filename:SKILL.md path:skills` timed out or required authenticated access, so the repository-name survey and direct inspections were used instead.
- Workflow files inside some `.github` directories could not be fetched after public API rate limiting; validator/CI claims are therefore conservative and distinguish “present” from “confirmed.”
- Composio, TravisVN and Vercel repository metadata reported no root license. Individual files may contain additional terms, but no blanket adaptation permission should be inferred.
- Stripe’s official skill content is distributed through plugins and `docs.stripe.com`; its canonical source and content-specific license were not visible in the inspected GitHub repository.
- Star counts are volatile and should be refreshed before publishing externally.
- Large catalogs may report skill counts in repository descriptions that change faster than documentation; these counts should be treated as approximate discovery signals rather than audited inventories.

## Sources

### Agent Skills Standard

- https://agentskills.io/specification
- https://agentskills.io/llms.txt
- https://github.com/agentskills/agentskills/tree/main/skills-ref

### GitHub Repository Searches

- https://api.github.com/search/repositories?q=agent-skills+in:name&sort=stars&order=desc&per_page=20
- https://api.github.com/search/repositories?q=claude-skills+in:name&sort=stars&order=desc&per_page=20
- https://api.github.com/search/repositories?q=copilot-skills+in:name&sort=stars&order=desc&per_page=20
- https://api.github.com/search/repositories?q=user%3Astripe+agent+skills&sort=stars&order=desc&per_page=20

### Anthropic Skills

- https://github.com/anthropics/skills
- https://api.github.com/repos/anthropics/skills
- https://api.github.com/repos/anthropics/skills/contents/
- https://api.github.com/repos/anthropics/skills/contents/skills
- https://github.com/anthropics/skills/blob/main/README.md
- https://raw.githubusercontent.com/anthropics/skills/main/README.md
- https://github.com/anthropics/skills/tree/main/spec
- https://github.com/anthropics/skills/tree/main/template
- https://github.com/anthropics/skills/blob/main/template/SKILL.md
- https://raw.githubusercontent.com/anthropics/skills/main/template/SKILL.md
- https://github.com/anthropics/skills/blob/main/.claude-plugin/marketplace.json
- https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json
- https://github.com/anthropics/skills/tree/main/skills/skill-creator
- https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
- https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md
- https://github.com/anthropics/skills/blob/main/skills/skill-creator/LICENSE.txt
- https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/LICENSE.txt
- https://github.com/anthropics/skills/tree/main/skills/webapp-testing
- https://raw.githubusercontent.com/anthropics/skills/main/skills/webapp-testing/LICENSE.txt
- https://github.com/anthropics/skills/tree/main/skills/pdf
- https://github.com/anthropics/skills/blob/main/skills/pdf/LICENSE.txt
- https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/LICENSE.txt
- https://github.com/anthropics/skills/tree/main/skills/docx
- https://github.com/anthropics/skills/tree/main/skills/pptx
- https://github.com/anthropics/skills/tree/main/skills/xlsx

### Obra Superpowers

- https://github.com/obra/superpowers
- https://api.github.com/repos/obra/superpowers
- https://api.github.com/repos/obra/superpowers/contents/
- https://api.github.com/repos/obra/superpowers/contents/skills
- https://api.github.com/repos/obra/superpowers/contents/tests
- https://github.com/obra/superpowers/tree/main/skills
- https://github.com/obra/superpowers/tree/main/tests
- https://github.com/obra/superpowers/blob/main/LICENSE
- https://github.com/obra/superpowers/blob/main/.pre-commit-config.yaml
- https://raw.githubusercontent.com/obra/superpowers/main/.pre-commit-config.yaml
- https://github.com/obra/superpowers/blob/main/.version-bump.json
- https://raw.githubusercontent.com/obra/superpowers/main/.version-bump.json
- https://github.com/obra/superpowers/tree/main/skills/brainstorming
- https://github.com/obra/superpowers/tree/main/skills/dispatching-parallel-agents
- https://github.com/obra/superpowers/tree/main/skills/executing-plans
- https://github.com/obra/superpowers/tree/main/skills/requesting-code-review
- https://github.com/obra/superpowers/tree/main/skills/receiving-code-review
- https://github.com/obra/superpowers/tree/main/skills/subagent-driven-development
- https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md
- https://raw.githubusercontent.com/obra/superpowers/main/skills/systematic-debugging/SKILL.md
- https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/condition-based-waiting.md
- https://raw.githubusercontent.com/obra/superpowers/main/skills/systematic-debugging/condition-based-waiting.md
- https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md
- https://raw.githubusercontent.com/obra/superpowers/main/skills/test-driven-development/SKILL.md
- https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md
- https://raw.githubusercontent.com/obra/superpowers/main/skills/verification-before-completion/SKILL.md
- https://github.com/obra/superpowers/blob/main/skills/using-git-worktrees/SKILL.md
- https://raw.githubusercontent.com/obra/superpowers/main/skills/using-git-worktrees/SKILL.md
- https://github.com/obra/superpowers/blob/main/skills/finishing-a-development-branch/SKILL.md
- https://raw.githubusercontent.com/obra/superpowers/main/skills/finishing-a-development-branch/SKILL.md
- https://github.com/obra/superpowers/blob/main/skills/writing-skills/SKILL.md
- https://raw.githubusercontent.com/obra/superpowers/main/skills/writing-skills/SKILL.md
- https://github.com/obra/superpowers/tree/main/skills/writing-plans

### GitHub Awesome Copilot

- https://github.com/github/awesome-copilot
- https://api.github.com/repos/github/awesome-copilot
- https://api.github.com/repos/github/awesome-copilot/contents/
- https://api.github.com/repos/github/awesome-copilot/contents/skills
- https://github.com/github/awesome-copilot/blob/main/LICENSE
- https://github.com/github/awesome-copilot/blob/main/package.json
- https://raw.githubusercontent.com/github/awesome-copilot/main/package.json
- https://github.com/github/awesome-copilot/blob/main/CONTRIBUTING.md
- https://raw.githubusercontent.com/github/awesome-copilot/main/CONTRIBUTING.md
- https://github.com/github/awesome-copilot/blob/main/eng/validate-skills.mjs
- https://raw.githubusercontent.com/github/awesome-copilot/main/eng/validate-skills.mjs
- https://github.com/github/awesome-copilot/tree/main/skills/acquire-codebase-knowledge
- https://github.com/github/awesome-copilot/tree/main/skills/agent-governance
- https://github.com/github/awesome-copilot/tree/main/skills/agent-owasp-compliance
- https://github.com/github/awesome-copilot/blob/main/skills/agent-supply-chain/SKILL.md
- https://raw.githubusercontent.com/github/awesome-copilot/main/skills/agent-supply-chain/SKILL.md
- https://github.com/github/awesome-copilot/tree/main/skills/agentic-eval
- https://github.com/github/awesome-copilot/blob/main/skills/ai-prompt-engineering-safety-review/SKILL.md
- https://raw.githubusercontent.com/github/awesome-copilot/main/skills/ai-prompt-engineering-safety-review/SKILL.md
- https://github.com/github/awesome-copilot/blob/main/SECURITY.md
- https://github.com/github/awesome-copilot/blob/main/CODEOWNERS

### Addy Osmani Agent Skills

- https://github.com/addyosmani/agent-skills
- https://api.github.com/repos/addyosmani/agent-skills
- https://api.github.com/repos/addyosmani/agent-skills/contents/
- https://github.com/addyosmani/agent-skills/blob/main/README.md
- https://raw.githubusercontent.com/addyosmani/agent-skills/main/README.md
- https://github.com/addyosmani/agent-skills/blob/main/CONTRIBUTING.md
- https://raw.githubusercontent.com/addyosmani/agent-skills/main/CONTRIBUTING.md
- https://github.com/addyosmani/agent-skills/blob/main/LICENSE
- https://github.com/addyosmani/agent-skills/blob/main/evals/README.md
- https://raw.githubusercontent.com/addyosmani/agent-skills/main/evals/README.md
- https://github.com/addyosmani/agent-skills/tree/main/skills/spec-driven-development
- https://github.com/addyosmani/agent-skills/blob/main/skills/planning-and-task-breakdown/SKILL.md
- https://raw.githubusercontent.com/addyosmani/agent-skills/main/skills/planning-and-task-breakdown/SKILL.md
- https://github.com/addyosmani/agent-skills/tree/main/skills/test-driven-development
- https://github.com/addyosmani/agent-skills/blob/main/skills/source-driven-development/SKILL.md
- https://raw.githubusercontent.com/addyosmani/agent-skills/main/skills/source-driven-development/SKILL.md
- https://github.com/addyosmani/agent-skills/tree/main/skills/debugging-and-error-recovery
- https://github.com/addyosmani/agent-skills/blob/main/skills/code-review-and-quality/SKILL.md
- https://raw.githubusercontent.com/addyosmani/agent-skills/main/skills/code-review-and-quality/SKILL.md
- https://github.com/addyosmani/agent-skills/blob/main/skills/security-and-hardening/SKILL.md
- https://raw.githubusercontent.com/addyosmani/agent-skills/main/skills/security-and-hardening/SKILL.md
- https://github.com/addyosmani/agent-skills/blob/main/skills/performance-optimization/SKILL.md
- https://raw.githubusercontent.com/addyosmani/agent-skills/main/skills/performance-optimization/SKILL.md
- https://github.com/addyosmani/agent-skills/tree/main/skills/git-workflow-and-versioning
- https://raw.githubusercontent.com/addyosmani/agent-skills/main/skills/git-workflow-and-versioning/SKILL.md
- https://github.com/addyosmani/agent-skills/tree/main/skills/deprecation-and-migration
- https://raw.githubusercontent.com/addyosmani/agent-skills/main/skills/deprecation-and-migration/SKILL.md
- https://github.com/addyosmani/agent-skills/tree/main/skills/documentation-and-adrs
- https://raw.githubusercontent.com/addyosmani/agent-skills/main/skills/documentation-and-adrs/SKILL.md
- https://github.com/addyosmani/agent-skills/tree/main/skills/code-simplification
- https://raw.githubusercontent.com/addyosmani/agent-skills/main/skills/code-simplification/SKILL.md

### Composio

- https://github.com/ComposioHQ/awesome-claude-skills
- https://api.github.com/repos/ComposioHQ/awesome-claude-skills
- https://api.github.com/repos/ComposioHQ/awesome-claude-skills/contents/
- https://github.com/ComposioHQ/awesome-claude-skills/blob/master/CONTRIBUTING.md
- https://raw.githubusercontent.com/ComposioHQ/awesome-claude-skills/master/CONTRIBUTING.md
- https://github.com/ComposioHQ/awesome-claude-skills/blob/master/changelog-generator/SKILL.md
- https://raw.githubusercontent.com/ComposioHQ/awesome-claude-skills/master/changelog-generator/SKILL.md
- https://github.com/ComposioHQ/awesome-claude-skills/tree/master/content-research-writer
- https://github.com/ComposioHQ/awesome-claude-skills/tree/master/file-organizer
- https://github.com/ComposioHQ/awesome-claude-skills/tree/master/mcp-builder
- https://github.com/ComposioHQ/awesome-claude-skills/tree/master/document-skills

### Vercel

- https://github.com/vercel-labs/agent-skills
- https://api.github.com/repos/vercel-labs/agent-skills
- https://api.github.com/repos/vercel-labs/agent-skills/contents/
- https://api.github.com/repos/vercel-labs/agent-skills/contents/skills
- https://github.com/vercel-labs/agent-skills/blob/main/skills.sh.json
- https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills.sh.json
- https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/SKILL.md
- https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/react-best-practices/SKILL.md
- https://github.com/vercel-labs/agent-skills/tree/main/skills/composition-patterns
- https://github.com/vercel-labs/agent-skills/tree/main/skills/react-native-skills
- https://github.com/vercel-labs/agent-skills/tree/main/skills/react-view-transitions
- https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines
- https://github.com/vercel-labs/agent-skills/tree/main/skills/deploy-to-vercel
- https://github.com/vercel-labs/agent-skills/tree/main/skills/vercel-optimize

### Cloudflare

- https://github.com/cloudflare/skills
- https://api.github.com/repos/cloudflare/skills
- https://api.github.com/repos/cloudflare/skills/contents/
- https://api.github.com/repos/cloudflare/skills/contents/skills
- https://github.com/cloudflare/skills/blob/main/LICENSE
- https://github.com/cloudflare/skills/blob/main/.claude-plugin/marketplace.json
- https://raw.githubusercontent.com/cloudflare/skills/main/.claude-plugin/marketplace.json
- https://github.com/cloudflare/skills/blob/main/skills/web-perf/SKILL.md
- https://raw.githubusercontent.com/cloudflare/skills/main/skills/web-perf/SKILL.md
- https://github.com/cloudflare/skills/tree/main/skills/workers-best-practices
- https://github.com/cloudflare/skills/tree/main/skills/durable-objects
- https://github.com/cloudflare/skills/tree/main/skills/agents-sdk
- https://github.com/cloudflare/skills/tree/main/skills/wrangler

### Stripe

- https://github.com/stripe/ai
- https://api.github.com/repositories/886826524
- https://github.com/stripe/ai/blob/main/README.md
- https://raw.githubusercontent.com/stripe/agent-toolkit/main/README.md
- https://docs.stripe.com/agents
- https://docs.stripe.com/mcp
- https://docs.stripe.com

### Curated Lists and Large Collections

- https://github.com/VoltAgent/awesome-agent-skills
- https://api.github.com/repos/VoltAgent/awesome-agent-skills
- https://api.github.com/repos/VoltAgent/awesome-agent-skills/contents/
- https://github.com/VoltAgent/awesome-agent-skills/blob/main/CONTRIBUTING.md
- https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/CONTRIBUTING.md
- https://github.com/travisvn/awesome-claude-skills
- https://api.github.com/repos/travisvn/awesome-claude-skills
- https://api.github.com/repos/travisvn/awesome-claude-skills/contents/
- https://github.com/travisvn/awesome-claude-skills/blob/main/CONTRIBUTING.md
- https://raw.githubusercontent.com/travisvn/awesome-claude-skills/main/CONTRIBUTING.md
- https://github.com/alirezarezvani/claude-skills
- https://api.github.com/repos/alirezarezvani/claude-skills
- https://api.github.com/repos/alirezarezvani/claude-skills/contents/
- https://github.com/alirezarezvani/claude-skills/blob/main/SKILL-AUTHORING-STANDARD.md
- https://github.com/alirezarezvani/claude-skills/blob/main/SKILL_PIPELINE.md
- https://github.com/alirezarezvani/claude-skills/blob/main/STORE.md
- https://github.com/alirezarezvani/claude-skills/blob/main/SECURITY.md
- https://github.com/sickn33/agentic-awesome-skills
- https://api.github.com/repos/sickn33/agentic-awesome-skills
- https://github.com/K-Dense-AI/scientific-agent-skills
- https://api.github.com/repos/K-Dense-AI/scientific-agent-skills
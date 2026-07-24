# Cross-Runtime Agent Skills Portability, with Emphasis on OpenAI Codex

**Research date:** 2026-07-24  
**Target project:** `/Users/cody/projects/AgentSkills`  
**Goal:** One portable Agent Skills repository usable across OpenAI Codex, Claude Code, GitHub Copilot, Cursor, Windsurf, Gemini CLI, OpenCode, Amp, Cline, Roo Code, and similar agents.

## Executive summary

OpenAI Codex now has first-class, native support for the open Agent Skills format and `SKILL.md`. Earlier conclusions that Codex required custom prompts, `.codex/skills`, or an `AGENTS.md`-only emulation layer are obsolete. The current documented Codex locations are repository `.agents/skills`, user `~/.agents/skills`, administrator `/etc/codex/skills`, and bundled system skills. Codex supports progressive disclosure, implicit and explicit invocation, `/skills`, `$skill-name`, symlinked skill directories, plugins, per-skill enable/disable configuration, and an optional `agents/openai.yaml` sidecar.

As of 2026-07-24, npm identifies Codex CLI `0.145.0` as the latest stable release and `0.146.0-alpha.6` as the latest alpha. Native Skills support is verified in the current release and current source tree, but the exact first Codex release that shipped Skills could not be established from authoritative release notes. It should remain documented as unknown rather than guessed.

The best shared path is `.agents/skills`. Codex, GitHub Copilot, Cursor, Gemini CLI, Windsurf/Devin Desktop, OpenCode, Amp, and Roo Code all explicitly discover it. Claude Code does not currently document `.agents/skills`, so it requires a `.claude/skills` adapter. Cline prefers `.cline/skills`, although project `.claude/skills` is also supported.

Cursor now supports Agent Skills natively in `.agents/skills` and `.cursor/skills`. Generating `.cursor/rules/*.mdc` remains useful for always-on rules, file-glob behavior, or older Cursor versions, but it is no longer necessary merely to make an ordinary skill available to current Cursor.

The safest canonical `SKILL.md` frontmatter is the Agent Skills standard’s small common denominator: `name`, `description`, optional `license`, and namespaced `metadata`. `allowed-tools` is experimental and should be used cautiously. Runtime-specific controls should live in sidecars or generated variants rather than a single union frontmatter, because unknown-field behavior is not documented consistently across runtimes.

The recommended repository architecture is a standards-compliant canonical skill tree plus a deterministic install/sync utility. Use copy/sync as the portable default and optional shallow symlinks for local Unix development. Keep `AGENTS.md` concise and use it as a router to the skills directory, not as a substitute for progressive-disclosure skills.

## Terminology

### Agent Skill

An Agent Skill is a directory containing a required `SKILL.md` and optional scripts, references, assets, templates, or other supporting files. `SKILL.md` consists of YAML frontmatter followed by Markdown instructions.

The open Agent Skills specification requires:

- `name`
- `description`

It defines these optional fields:

- `license`
- `compatibility`
- `metadata`
- `allowed-tools`, currently experimental

The standard recommends progressive disclosure:

1. Load `name` and `description` for discovery.
2. Load the complete `SKILL.md` only when the skill is activated.
3. Load supporting resources only when required.

Source: [Agent Skills specification](https://agentskills.io/specification).

### Agent instructions file

An instructions file such as `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` provides persistent repository or user guidance. Unlike a Skill, it is normally loaded broadly rather than only for a matching task.

Use instructions files for:

- Repository architecture
- Build and test commands
- Coding conventions
- Security constraints
- General contribution practices

Use Skills for:

- Task-specific procedures
- Repeatable multi-step workflows
- Specialized domain knowledge
- Workflows with scripts, templates, or references
- Guidance that should enter context only on demand

## OpenAI Codex

## Current Codex release status

The npm registry currently reports:

- `latest`: `0.145.0`
- `alpha`: `0.146.0-alpha.6`

The registry publication metadata corresponds to:

- `0.145.0`: 2026-07-21
- `0.146.0-alpha.6`: 2026-07-24

Sources:

- [Codex npm dist-tags](https://registry.npmjs.org/-/package/@openai/codex/dist-tags)
- [Codex 0.145.0 package metadata](https://registry.npmjs.org/@openai/codex/0.145.0)
- [Codex 0.146.0-alpha.6 package metadata](https://registry.npmjs.org/@openai/codex/0.146.0-alpha.6)
- [Codex GitHub releases](https://github.com/openai/codex/releases)

### Native Skills status

**Verified:** Codex currently supports Agent Skills and `SKILL.md` natively.

The official guide states that Skills extend ChatGPT and Codex with task-specific capabilities, are based on the open Agent Skills standard, and may contain instructions, resources, and scripts. Codex initially exposes skill names, descriptions, and paths, then reads the complete `SKILL.md` when the skill is selected.

Codex supports:

- Automatic discovery
- Explicit `$skill-name` invocation
- `/skills`
- Implicit invocation based on the description
- Symlinked skill directories
- Repository, user, administrator, and bundled system scopes
- Enable/disable entries in `config.toml`
- Plugins containing Skills
- Optional `agents/openai.yaml`
- Dynamic detection of skill changes

Source: [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills).

### Historical introduction version

The exact first Codex CLI version that shipped native Agent Skills was not established conclusively.

Relevant evidence includes:

- GitHub issue `#5291`, “Support for SKILL.md files,” opened 2025-10-17 and now closed.
- Current official documentation and current source clearly implement native Skills.
- Current stable `0.145.0` supports Skills.
- Older GitHub and community material refers to `.codex/skills`, showing the feature evolved before the current `.agents/skills` public contract.

It would be inaccurate to claim that `0.143.0`, `0.130.0`, or any other specific release was the first without an authoritative release note or closing commit tying the feature to that release.

Sources:

- [Issue #5291: Support for SKILL.md files](https://github.com/openai/codex/issues/5291)
- [Issue #5321: Add Skill to Codex CLI like Claude Code](https://github.com/openai/codex/issues/5321)
- [Codex releases](https://github.com/openai/codex/releases)

## Codex skill directory structure

A basic Codex skill is:

```text
my-skill/
├── SKILL.md
├── scripts/          # optional
├── references/       # optional
├── assets/           # optional
└── agents/
    └── openai.yaml   # optional Codex/OpenAI sidecar
```

A minimal `SKILL.md` is:

```markdown
---
name: my-skill
description: Explain what this skill does and when Codex should use it.
---

# Instructions

Follow the workflow described here.
```

Source: [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills).

## Codex skill discovery paths

The current documented paths are:

| Scope | Path | Purpose |
|---|---|---|
| Repository | `$REPO_ROOT/.agents/skills` | Repository-wide skills |
| Repository | Ancestor `.agents/skills` directories between repository root and CWD | Area-specific skills |
| Repository | `$CWD/.agents/skills` | Skills specific to the current working directory |
| User | `$HOME/.agents/skills` | User skills across repositories |
| Administrator | `/etc/codex/skills` | Machine/container-wide administrator skills |
| System | Bundled with Codex | OpenAI-provided skills |

Codex scans `.agents/skills` in each directory between the project root and current working directory.

If two skills have the same `name`, Codex does not merge them; both may appear in selectors.

Codex supports symlinked skill folders and follows the symlink target while scanning.

Source: [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills).

The source implementation confirms:

- `$HOME/.agents/skills`
- Repository `.agents/skills` from root through CWD
- `/etc/codex/skills`
- Bundled system skills
- Directory symlinks for user, repository, and administrator scopes
- Recursive discovery

It also retains `$CODEX_HOME/skills` for backward compatibility. That path should not be treated as the preferred public authoring contract.

Source citations:

- `openai/codex:codex-rs/core-skills/src/loader.rs:124-174`
- `openai/codex:codex-rs/core-skills/src/loader.rs:205-307`
- `openai/codex:codex-rs/core-skills/src/loader.rs:310-430`
- `openai/codex:codex-rs/core-skills/src/loader.rs:465-495`
- [Raw loader source](https://raw.githubusercontent.com/openai/codex/main/codex-rs/core-skills/src/loader.rs)

### `.codex/skills` compatibility caveat

Current source still discovers skills associated with Codex configuration-layer folders:

- User `$CODEX_HOME/skills` is explicitly marked deprecated.
- Project `.codex/skills` may be associated with project configuration layers.
- Bundled system skills are cached under `$CODEX_HOME/skills/.system`.

However, official authoring guidance now recommends `.agents/skills` and `~/.agents/skills`. A portable repository should not choose `.codex/skills` as its canonical path.

Source:

- `openai/codex:codex-rs/core-skills/src/loader.rs:205-307`
- [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills)

## Codex skill invocation

Codex supports explicit and implicit activation.

### Explicit activation

In Codex CLI or the IDE extension:

- Run `/skills`
- Type `$` and select a skill
- Mention `$skill-name` in a prompt

Example:

```text
$github-actions-debugging diagnose the failing checks in this pull request
```

### Implicit activation

Codex can automatically choose a skill when the prompt matches its `description`.

The description therefore needs to state:

- What the skill does
- When it should be used
- Trigger words, domains, file types, or workflows
- Important cases in which it should not be used

Source: [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills).

## Codex skill configuration

A user can disable an individual skill without deleting it:

```toml
[[skills.config]]
path = "/absolute/path/to/skill/SKILL.md"
enabled = false
```

This belongs in `~/.codex/config.toml`. Codex should be restarted after changing this setting.

Source: [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills).

## `agents/openai.yaml`

Codex supports an optional sidecar:

```text
my-skill/
└── agents/
    └── openai.yaml
```

Example:

```yaml
interface:
  display_name: "GitHub Actions Debugging"
  short_description: "Diagnose and repair failing CI checks"
  icon_small: "./assets/small-logo.svg"
  icon_large: "./assets/large-logo.png"
  brand_color: "#3B82F6"
  default_prompt: "Diagnose the current pull request's failing checks."

policy:
  allow_implicit_invocation: false

dependencies:
  tools:
    - type: "mcp"
      value: "github"
      description: "GitHub MCP server"
      transport: "streamable_http"
      url: "https://example.com/mcp"
```

The sidecar can define:

### Interface metadata

- `display_name`
- `short_description`
- `icon_small`
- `icon_large`
- `brand_color`
- `default_prompt`

### Policy

- `allow_implicit_invocation`

### Tool dependencies

- Type
- Value/name
- Description
- Transport
- Command
- URL

The loader treats optional metadata as fail-open: malformed optional metadata is ignored rather than blocking the base `SKILL.md`.

Source citations:

- `openai/codex:codex-rs/core-skills/src/loader.rs:70-118`
- `openai/codex:codex-rs/core-skills/src/loader.rs:605-760`
- [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills)

## Codex frontmatter parser

Codex’s current runtime frontmatter type defines:

```rust
#[derive(Debug, Deserialize)]
struct SkillFrontmatter {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    metadata: SkillFrontmatterMetadata,
}

#[derive(Debug, Default, Deserialize)]
struct SkillFrontmatterMetadata {
    #[serde(default, rename = "short-description")]
    short_description: Option<String>,
}
```

Source:

- `openai/codex:codex-rs/core-skills/src/loader.rs:48-69`
- [Raw loader source](https://raw.githubusercontent.com/openai/codex/main/codex-rs/core-skills/src/loader.rs)

The runtime parser:

1. Extracts YAML frontmatter.
2. Deserializes it with `serde_yaml`.
3. Repairs a limited set of malformed unquoted scalar cases.
4. Reads `name`, `description`, and `metadata.short-description`.
5. Validates name and description lengths.
6. Rejects missing or invalid descriptions.
7. Uses the parent directory as a fallback name in some cases.

Source:

- `openai/codex:codex-rs/core-skills/src/loader.rs:517-603`
- [Raw loader source](https://raw.githubusercontent.com/openai/codex/main/codex-rs/core-skills/src/loader.rs)

### Unknown fields in Codex

The deserialization structs do not use Serde’s `deny_unknown_fields`. Serde’s default behavior is to ignore unknown keys. Therefore, the current Codex runtime implementation ignores unknown frontmatter fields.

This is verified from implementation behavior, but it is **not an explicit public compatibility guarantee**. It may change.

### Codex validator differs from Codex runtime

The bundled skill-creator validator allows only:

```python
allowed_properties = {
    "name",
    "description",
    "license",
    "allowed-tools",
    "metadata",
}
```

It rejects all other fields as unexpected.

Consequences:

- `compatibility`, although defined by the Agent Skills standard, is rejected by this bundled quick validator.
- Claude-specific fields such as `disable-model-invocation`, `context`, `agent`, and `argument-hint` are rejected.
- Cursor-specific fields such as `paths` are rejected.
- The Codex runtime itself may still ignore those fields successfully.

Source:

- `openai/codex:codex-rs/skills/src/assets/samples/skill-creator/scripts/quick_validate.py:31-55`
- [Raw validator source](https://raw.githubusercontent.com/openai/codex/main/codex-rs/skills/src/assets/samples/skill-creator/scripts/quick_validate.py)

This validator/runtime mismatch is a strong reason not to use a broad union frontmatter in canonical skills.

## Codex skill loading errors

Invalid YAML produces a skill parse error. Non-system skill errors are included in the load outcome; invalid system skills may be silently omitted from user-facing results.

Issue `#20704` documents a real case in which invalid YAML caused a skill to be skipped.

Sources:

- `openai/codex:codex-rs/core-skills/src/loader.rs:119-155`
- `openai/codex:codex-rs/core-skills/src/loader.rs:490-515`
- [Issue #20704](https://github.com/openai/codex/issues/20704)

## Codex symlink behavior

Codex intentionally follows directory symlinks for repository, user, and administrator skill scopes. System-skill symlinks are ignored.

Issue `#22275` reports that in CLI `0.130.0`, recursive discovery inside a symlink target could discover nested `SKILL.md` files unexpectedly. This makes broad symlinks to a large repository tree riskier than one shallow symlink per skill.

Recommendations:

- Prefer one symlink per skill.
- Point directly to the directory containing `SKILL.md`.
- Avoid linking a root containing nested skill catalogs.
- Validate the discovered skill list after installation.

Sources:

- `openai/codex:codex-rs/core-skills/src/loader.rs:465-495`
- [Issue #22275](https://github.com/openai/codex/issues/22275)
- [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills)

## Codex source history

Relevant recent commits include:

- `6f65b9a98c4172fac9ba7200a9c498e91fcb84ec`, dated 2026-06-24: confirms skill catalogs refresh between turns.
- `83a418783707f4446aa832b2799d6cacfef75011`, dated 2026-07-14: added a bundled review skill.
- `56c11cf6586c0579e4e3eca14eefb0916b14c78c`, dated 2026-07-20: moved shared skill models into `codex-skills`.

Sources:

- [Commit 6f65b9a98c4172fac9ba7200a9c498e91fcb84ec](https://github.com/openai/codex/commit/6f65b9a98c4172fac9ba7200a9c498e91fcb84ec)
- [Commit 83a418783707f4446aa832b2799d6cacfef75011](https://github.com/openai/codex/commit/83a418783707f4446aa832b2799d6cacfef75011)
- [Commit 56c11cf6586c0579e4e3eca14eefb0916b14c78c](https://github.com/openai/codex/commit/56c11cf6586c0579e4e3eca14eefb0916b14c78c)

Open PR `#31334`, created 2026-07-07, proposes clearer guidance for `.agents/skills`, `~/.agents/skills`, and `/etc/codex/skills`, reflecting ongoing cleanup around public skill-location documentation.

Source: [PR #31334](https://github.com/openai/codex/pull/31334).

Issue `#14941` records historical confusion around which authoring locations were supported. It should be treated as historical context rather than current documentation.

Source: [Issue #14941](https://github.com/openai/codex/issues/14941).

## Codex configuration

Codex user configuration lives at:

```text
~/.codex/config.toml
```

Project and subdirectory configuration can be stored at:

```text
.codex/config.toml
```

Project configuration is loaded only for trusted projects.

### Configuration precedence

Highest to lowest:

1. CLI flags and `--config`
2. Project `.codex/config.toml` files, from project root to CWD, with the closest winning
3. Selected profile, such as `~/.codex/profile-name.config.toml`
4. User `~/.codex/config.toml`
5. System `/etc/codex/config.toml`
6. Built-in defaults

Source: [OpenAI: Basic configuration](https://learn.chatgpt.com/docs/config-file/config-basic).

## Codex `AGENTS.md`

Codex reads `AGENTS.md` before starting work.

### Discovery and merge order

#### Global scope

Codex checks its home directory, normally `~/.codex`:

1. `AGENTS.override.md`
2. Otherwise `AGENTS.md`

Only the first non-empty file at this level is used.

#### Project scope

Codex determines the project root, normally using `.git`, then walks from the root to the current working directory.

In each directory, it checks:

1. `AGENTS.override.md`
2. `AGENTS.md`
3. Any names configured in `project_doc_fallback_filenames`

Only one file per directory is selected.

#### Merge order

Files are concatenated from root to current working directory. More specific files occur later in the prompt and therefore take precedence when guidance conflicts.

Empty files are ignored.

The default combined byte limit is 32 KiB, controlled by `project_doc_max_bytes`.

Sources:

- [OpenAI: AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- `openai/codex:codex-rs/core/src/agents_md.rs:1-31`
- `openai/codex:codex-rs/core/src/agents_md.rs:93-190`
- [Raw `agents_md.rs`](https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/agents_md.rs)

### Example Codex hierarchy

```text
~/.codex/
└── AGENTS.md

repo/
├── AGENTS.md
└── services/
    └── payments/
        ├── AGENTS.md
        └── AGENTS.override.md
```

If Codex starts in `services/payments`, the effective sequence is:

1. `~/.codex/AGENTS.md`
2. `repo/AGENTS.md`
3. `repo/services/payments/AGENTS.override.md`

The same-directory `AGENTS.md` is ignored when `AGENTS.override.md` exists.

### Configuring fallback instruction filenames

```toml
project_doc_fallback_filenames = ["TEAM_GUIDE.md", ".agents.md"]
project_doc_max_bytes = 65536
```

Codex then checks each directory in this order:

1. `AGENTS.override.md`
2. `AGENTS.md`
3. `TEAM_GUIDE.md`
4. `.agents.md`

Source: [OpenAI: AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

### `@` imports in Codex `AGENTS.md`

Codex’s official `AGENTS.md` documentation does not define `@path` expansion. A literal line such as:

```markdown
@.agents/skills/my-skill/SKILL.md
```

must not be assumed to import the file in Codex.

A portable `AGENTS.md` should instead use ordinary Markdown prose:

```markdown
Task-specific workflows are stored under `.agents/skills/`.
When a task matches a skill description, use that skill and read its
`SKILL.md` plus any referenced resources relative to the skill directory.
```

## Codex custom prompts and slash commands

Codex custom prompts remain supported but are deprecated.

Location:

```text
~/.codex/prompts/
```

Each prompt is a top-level Markdown file:

```text
~/.codex/prompts/draftpr.md
```

Invocation:

```text
/prompts:draftpr
```

Prompt frontmatter supports:

- `description`
- `argument-hint`

Prompt bodies support:

- `$1` through `$9`
- `$ARGUMENTS`
- Named uppercase variables such as `$FILE`
- `$$` for a literal dollar sign

Codex only scans top-level Markdown files in `~/.codex/prompts`; nested prompt directories are not supported.

Custom prompts:

- Require explicit invocation
- Are local to the Codex home directory
- Are not naturally shared through a repository
- Cannot be invoked implicitly

OpenAI recommends Skills instead.

Source: [OpenAI: Custom prompts](https://learn.chatgpt.com/docs/custom-prompts).

## Codex cloud agent

Codex cloud creates a container, checks out the selected repository revision, runs setup, applies network policy, and then runs the agent.

A cloud environment can configure:

- Dependencies
- Tools
- Setup scripts
- Maintenance scripts
- Environment variables
- Secrets
- Internet access
- Runtime versions

The cloud agent uses repository `AGENTS.md` to discover project-specific lint and test commands.

Cloud secrets are available to setup scripts but are removed before the agent phase. Environment variables remain available for the full chat.

Agent internet access is off by default. It can be enabled per environment and restricted by domain and HTTP method.

Sources:

- [OpenAI: Codex cloud](https://learn.chatgpt.com/docs/cloud)
- [OpenAI: Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environment)
- [OpenAI: Cloud internet access](https://learn.chatgpt.com/docs/cloud/internet-access)

### Cloud portability implications

Repository-scoped files are the most reliable way to configure Codex cloud:

- Commit `AGENTS.md`.
- Commit repository Skills.
- Prefer `.agents/skills`.
- Include scripts and references inside each skill.
- Document required environment packages in `compatibility`, skill instructions, or setup documentation.
- Do not rely on a developer’s local `~/.codex`, `~/.agents`, or `~/.codex/prompts`.

## AGENTS.md open format

AGENTS.md describes itself as a simple, open format for guiding coding agents—a “README for agents.”

It is plain Markdown and has no required schema or fields.

Source citations:

- `agentsmd/agents.md:README.md:1-9`
- `agentsmd/agents.md:components/FAQSection.tsx:13-31`
- [AGENTS.md website](https://agents.md)
- [agentsmd/agents.md repository](https://github.com/agentsmd/agents.md)

## Recommended AGENTS.md content

Common sections include:

- Project overview
- Build commands
- Test commands
- Code style
- Security considerations
- Pull request requirements
- Deployment constraints
- Subproject-specific guidance

For monorepos, nested `AGENTS.md` files allow individual packages or services to add more specific guidance.

Source:

- `agentsmd/agents.md:components/HowToUseSection.tsx:8-35`
- [AGENTS.md website](https://agents.md)

## AGENTS.md adopters

The AGENTS.md site lists a broad ecosystem including:

- OpenAI Codex
- GitHub Copilot coding agent
- Cursor
- Amp
- Gemini CLI
- OpenCode
- Roo Code
- Windsurf
- Devin
- Aider
- Jules
- Factory
- VS Code
- Goose
- Kilo Code
- Zed
- Warp
- Augment Code
- JetBrains Junie
- Semgrep
- UiPath
- Others

Source:

- `agentsmd/agents.md:components/CompatibilitySection.tsx:15-145`
- [AGENTS.md website](https://agents.md)

### Important limitation

AGENTS.md is an open convention, but discovery and merge semantics are runtime-specific. The standard does not impose a single normative algorithm for:

- Global file locations
- Root detection
- Nested discovery
- Override filenames
- Byte limits
- `@` imports
- Conflict resolution

A portable repository should keep its root `AGENTS.md` simple and avoid depending on runtime-specific syntax.

## Runtime compatibility matrix

| Runtime | Native Agent Skills? | Project paths | User/global paths | File format | Frontmatter fields documented as honored | Invocation and notes |
|---|---:|---|---|---|---|---|
| OpenAI Codex | Yes | `.agents/skills`; legacy/project-config `.codex/skills` may remain implemented | `~/.agents/skills`; deprecated `$CODEX_HOME/skills`; admin `/etc/codex/skills` | `SKILL.md`; optional `agents/openai.yaml` | Runtime reads `name`, `description`, `metadata.short-description`; sidecar defines interface, policy, dependencies | `$skill-name`, `/skills`, implicit activation; follows symlinks |
| Claude Code | Yes | `.claude/skills`; nested `.claude/skills`; plugins | `~/.claude/skills`; managed enterprise locations | `SKILL.md` | Standard fields plus extensive Claude-specific controls | `/skill-name`, implicit activation, plugins, custom commands compatibility |
| GitHub Copilot | Yes | `.github/skills`, `.claude/skills`, `.agents/skills` | `~/.copilot/skills`, `~/.agents/skills` | `SKILL.md` | `name`, `description`, `license`, `allowed-tools` documented | Automatic activation, `/skill-name`, `/skills` CLI management |
| Cursor | Yes | `.agents/skills`, `.cursor/skills`; compatibility `.claude/skills`, `.codex/skills` | `~/.agents/skills`, `~/.cursor/skills`, plus compatibility paths | `SKILL.md`; `.cursor/rules/*.mdc` for rules | Skills: `name`, `description`, `paths`, `disable-model-invocation`, `metadata`; legacy `globs`. Rules: `description`, `globs`, `alwaysApply` | Native Skills, slash invocation, recursive/nested discovery; Cursor 2.4 migration tool |
| Windsurf / Devin Desktop | Yes | `.windsurf/skills`, `.agents/skills`; optional Claude config path | `~/.codeium/windsurf/skills`, `~/.agents/skills` | `SKILL.md` | `name`, `description` documented | Automatic invocation or `@skill-name` |
| Gemini CLI | Yes | `.gemini/skills`, `.agents/skills` | `~/.gemini/skills`, `~/.agents/skills` | `SKILL.md` | Agent Skills standard | Uses `activate_skill`, consent prompt, `/skills`; extensions can bundle Skills and MCP |
| OpenCode | Yes | `.opencode/skills`, `.claude/skills`, `.agents/skills` | `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` | `SKILL.md` | `name`, `description`, `license`, `compatibility`, `metadata`; unknown fields explicitly ignored | Native `skill` tool; permission controls |
| Amp | Yes | `.agents/skills`, `.claude/skills`, plugin paths | `~/.config/agents/skills`, `~/.agents/skills`, `~/.config/amp/skills`, `~/.claude/skills` | `SKILL.md`; optional `mcp.json` | `name`, `description` documented | Built-in Skills; can hide MCP tools until skill activation |
| Cline | Yes | `.cline/skills`, `.clinerules/skills`, `.claude/skills` | `~/.cline/skills` | `SKILL.md` | `name`, `description` documented | Automatic activation and `/skill-name` |
| Roo Code | Yes | `.roo/skills`, `.agents/skills`, mode-specific variants | `~/.roo/skills`, `~/.agents/skills`, mode-specific variants | `SKILL.md` | `name`, `description` documented | Automatic activation; symlinks; mode targeting |
| AGENTS.md-only fallback runtimes | Varies | Usually root/nested `AGENTS.md` | Runtime-specific | Plain Markdown | No schema | Use AGENTS.md as a router; no guaranteed progressive disclosure |

## Claude Code

Claude Code supports the Agent Skills open standard.

### Paths

| Scope | Path |
|---|---|
| Personal | `~/.claude/skills/<skill-name>/SKILL.md` |
| Project | `.claude/skills/<skill-name>/SKILL.md` |
| Plugin | `<plugin>/skills/<skill-name>/SKILL.md` |
| Enterprise | Managed settings locations |

Claude also discovers nested `.claude/skills` directories.

Claude follows symlinked skill directories and deduplicates the same target when it is reachable through multiple paths.

Source: [Claude Code Skills](https://code.claude.com/docs/en/skills).

### Claude frontmatter

Claude documents these fields:

- `name`
- `description`
- `when_to_use`
- `argument-hint`
- `arguments`
- `disable-model-invocation`
- `user-invocable`
- `allowed-tools`
- `disallowed-tools`
- `model`
- `effort`
- `context`
- `agent`
- `background`
- `hooks`
- `paths`
- `shell`

Claude’s extensions support:

- Manual-only skills
- Hidden/non-user-invocable skills
- Tool preapproval and denial
- Per-turn model selection
- Subagent execution
- Background execution
- Skill-scoped hooks
- File-path targeting
- Dynamic shell context

Source: [Claude Code Skills](https://code.claude.com/docs/en/skills).

### Claude plugins

A plugin can package:

- Skills
- Agents
- Hooks
- MCP servers
- Commands
- Other Claude-specific configuration

For broad installation and distribution, a Claude plugin is preferable to asking users to copy individual directories.

### Claude instruction imports

`CLAUDE.md` supports `@path` imports.

Features include:

- Relative paths
- Absolute paths
- `~` paths
- Recursive imports
- Maximum depth of four
- External-import approval for project files

Source: [Claude Code memory and CLAUDE.md](https://code.claude.com/docs/en/memory).

This import syntax is not portable to Codex `AGENTS.md`.

## GitHub Copilot

GitHub Copilot supports Agent Skills across:

- Copilot cloud agent
- Copilot code review
- GitHub Copilot CLI
- GitHub Copilot app
- Agent mode in Visual Studio Code
- Agent mode in JetBrains IDEs

Source: [GitHub: About agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills).

### Paths

Project:

```text
.github/skills/
.claude/skills/
.agents/skills/
```

Personal:

```text
~/.copilot/skills/
~/.agents/skills/
```

Source: [GitHub: Adding agent skills for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills).

### Copilot frontmatter

GitHub documents:

- `name`, required
- `description`, required
- `license`, optional
- `allowed-tools`, optional

Example:

```yaml
---
name: image-convert
description: Converts SVG images to PNG format.
allowed-tools: shell
---
```

GitHub warns that preapproving `shell` or `bash` removes confirmation and can enable arbitrary code execution through malicious skills or prompt injection.

Source: [GitHub: Adding agent skills for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills).

### Copilot commands

Interactive commands include:

- `/skills list`
- `/skills info`
- `/skills add`
- `/skills reload`
- `/skills remove`
- `/skills` to enable or disable skills

Terminal commands are also available through `copilot skill`.

Source: [GitHub: Adding agent skills for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills).

## Cursor

Cursor now supports native Agent Skills.

### Paths

Project:

```text
.agents/skills/
.cursor/skills/
```

User:

```text
~/.agents/skills/
~/.cursor/skills/
```

Compatibility paths:

```text
.claude/skills/
.codex/skills/
~/.claude/skills/
~/.codex/skills/
```

Cursor recursively discovers `SKILL.md` files beneath skill roots and also supports nested project skill directories that scope skills to a subproject.

Source: [Cursor Agent Skills](https://cursor.com/docs/skills).

### Cursor skill frontmatter

Cursor documents:

- `name`, required
- `description`, required
- `paths`, optional
- `disable-model-invocation`, optional
- `metadata`, optional
- `globs`, accepted as a legacy fallback

Example:

```yaml
---
name: react-component-patterns
description: Conventions for writing React components in this codebase.
paths:
  - "**/*.tsx"
  - "packages/ui/**/*.ts"
---
```

Source: [Cursor Agent Skills](https://cursor.com/docs/skills).

### Cursor 2.4 migration

Cursor 2.4 includes `/migrate-to-skills`, which converts eligible dynamic rules and slash commands into Skills.

It converts:

- Dynamic “Apply Intelligently” rules
- Slash commands

It does not convert:

- Always-on rules
- File-glob rules with explicit triggering semantics
- User rules not stored in project files

Source: [Cursor Agent Skills](https://cursor.com/docs/skills).

### Cursor rules

Project rules live at:

```text
.cursor/rules/*.mdc
```

The recognized frontmatter fields are:

- `description`
- `globs`
- `alwaysApply`

Rule behavior:

| `alwaysApply` | `description` | `globs` | Behavior |
|---|---|---|---|
| `true` | Any | Any | Always loaded |
| `false` | Omitted | Present | Loaded for matching files |
| `false` | Present | Omitted | Agent decides by description |
| `false` | Omitted | Omitted | Manual `@` invocation |

A plain `.md` file under `.cursor/rules` is ignored by the rule system.

Source: [Cursor Rules](https://cursor.com/docs/rules).

### When to generate Cursor rules

Generate `.cursor/rules/*.mdc` only when:

- Supporting old Cursor versions without native Skills
- The content must always apply
- Exact `.mdc` glob semantics are required
- The content is a behavioral rule, not an on-demand workflow
- A migration target specifically requires rules

For ordinary task-specific workflows, native `.agents/skills` is preferred.

## Windsurf / Devin Desktop

Windsurf’s Cascade supports native Skills with progressive disclosure.

### Paths

Workspace:

```text
.windsurf/skills/<skill-name>/SKILL.md
```

Global:

```text
~/.codeium/windsurf/skills/<skill-name>/SKILL.md
```

Cross-agent aliases:

```text
.agents/skills/
~/.agents/skills/
```

If Claude Code configuration reading is enabled, it may also scan:

```text
.claude/skills/
~/.claude/skills/
```

Source: [Windsurf Skills](https://docs.devin.ai/desktop/cascade/skills).

### Frontmatter

Required:

- `name`
- `description`

### Invocation

- Automatic when the request matches the description
- Manual with `@skill-name`

Windsurf distinguishes:

- Skills: on-demand workflows with supporting files
- Rules: behavioral guidance with activation modes
- Workflows: manually invoked one-shot prompt templates

Source: [Windsurf Skills](https://docs.devin.ai/desktop/cascade/skills).

## Gemini CLI

Gemini CLI supports Agent Skills based on the open standard.

### Discovery precedence

Lowest to highest:

1. Built-in skills
2. Extension skills
3. User skills
4. Workspace skills

User paths:

```text
~/.gemini/skills/
~/.agents/skills/
```

Workspace paths:

```text
.gemini/skills/
.agents/skills/
```

Within the same user or workspace tier, `.agents/skills` takes precedence over `.gemini/skills`.

Source: [Gemini CLI Skills](https://geminicli.com/docs/cli/skills/).

### Activation lifecycle

1. Gemini scans skill metadata.
2. The model calls `activate_skill`.
3. The UI asks for consent.
4. `SKILL.md` and the folder structure enter conversation history.
5. The skill directory is added to allowed paths.
6. Gemini executes the workflow.

Source: [Gemini CLI Skills](https://geminicli.com/docs/cli/skills/).

### Commands

- `/skills list`
- `/skills link`
- `/skills disable`
- `/skills enable`
- `/skills reload`
- `/skills refresh`
- `gemini skills install`
- `gemini skills uninstall`

### Gemini context files

`GEMINI.md` is hierarchical.

Load order:

1. `~/.gemini/GEMINI.md`
2. Workspace and ancestor context files
3. Just-in-time context files discovered when tools access directories

Gemini supports `@file.md` imports in `GEMINI.md`.

The context filename can be changed:

```json
{
  "context": {
    "fileName": ["AGENTS.md", "CONTEXT.md", "GEMINI.md"]
  }
}
```

Source: [Gemini CLI GEMINI.md](https://geminicli.com/docs/cli/gemini-md/).

### Gemini extensions

Extensions may package:

- Prompts
- MCP servers
- Custom commands
- Themes
- Hooks
- Subagents
- Agent Skills

Source: [Gemini CLI extensions](https://geminicli.com/docs/extensions/).

## OpenCode

OpenCode supports native Agent Skills loaded on demand through its `skill` tool.

### Paths

Project:

```text
.opencode/skills/<name>/SKILL.md
.claude/skills/<name>/SKILL.md
.agents/skills/<name>/SKILL.md
```

Global:

```text
~/.config/opencode/skills/<name>/SKILL.md
~/.claude/skills/<name>/SKILL.md
~/.agents/skills/<name>/SKILL.md
```

OpenCode walks from CWD up to the Git worktree for project skill roots.

Source: [OpenCode Skills](https://opencode.ai/docs/skills/).

### OpenCode frontmatter

Recognized:

- `name`
- `description`
- `license`
- `compatibility`
- `metadata`

OpenCode explicitly states:

> Unknown frontmatter fields are ignored.

This is the clearest documented unknown-key compatibility guarantee among the investigated runtimes.

Source: [OpenCode Skills](https://opencode.ai/docs/skills/).

### Permissions

OpenCode supports per-skill patterns:

- `allow`
- `deny`
- `ask`

It can also disable the skill tool for selected agents.

Source: [OpenCode Skills](https://opencode.ai/docs/skills/).

## Amp

Amp supports built-in, project, user, plugin, and legacy Skills.

### Paths and precedence

First match wins:

1. `~/.config/agents/skills/`
2. `~/.agents/skills/`
3. `~/.config/amp/skills/`
4. `.agents/skills/`
5. `.claude/skills/`
6. `~/.claude/skills/`
7. Plugins, legacy toolbox directories, and built-ins

Source: [Amp manual](https://ampcode.com/manual#agent-files).

### Amp skill format

```yaml
---
name: my-skill
description: A description of what this skill does
---
```

The name and description are always visible. The body is loaded only when invoked.

### Amp MCP integration

A skill can include:

```text
mcp.json
```

Example:

```json
{
  "chrome-devtools": {
    "command": "npx",
    "args": ["-y", "chrome-devtools-mcp@latest"],
    "includeTools": [
      "navigate_*",
      "take_screenshot",
      "click",
      "fill*"
    ]
  }
}
```

Amp starts these servers when it launches, but hides their tools until the Skill is loaded. Amp recommends this to reduce tool-list and context bloat.

Source: [Amp manual](https://ampcode.com/manual#agent-files).

### Amp AGENTS.md imports

Amp supports `@` references in `AGENTS.md`, including:

- Relative paths
- Absolute paths
- `~`
- Glob patterns
- Frontmatter `globs` in imported files

Example:

```markdown
See @doc/style.md and @specs/**/*.md.
```

Source: [Amp manual](https://ampcode.com/manual#agent-files).

This behavior is not portable to Codex.

## Cline

Cline supports native Skills with progressive loading.

### Paths

Project:

```text
.cline/skills/
.clinerules/skills/
.claude/skills/
```

Global:

```text
~/.cline/skills/
```

Source: [Cline Skills](https://docs.cline.bot/customization/skills.md).

### Frontmatter

Required:

- `name`, matching the directory
- `description`, maximum 1024 characters

### Invocation

- Automatic through `use_skill`
- Explicit through `/skill-name`

Cline recommends keeping `SKILL.md` below approximately 5,000 tokens and moving details into supporting files.

Source: [Cline Skills](https://docs.cline.bot/customization/skills.md).

### Precedence caveat

Cline’s documentation states that a global skill takes precedence over a project skill with the same name. This differs from many other runtimes, where project scope usually wins.

## Roo Code

Roo Code supports native Skills with progressive disclosure.

### Paths

Project:

```text
.roo/skills/
.agents/skills/
```

Global:

```text
~/.roo/skills/
~/.agents/skills/
```

Mode-specific variants include:

```text
.roo/skills-code/
.roo/skills-architect/
.agents/skills-code/
.agents/skills-architect/
```

Source: [Roo Code Skills](https://roocodeinc.github.io/Roo-Code/features/skills/).

### Frontmatter

Required:

- `name`
- `description`

Name must match the directory or symlink name.

### Symlinks

Roo supports symbolic links. The frontmatter `name` must match the symlink name.

### Precedence

Highest to lowest:

1. Project Roo mode-specific
2. Project Roo generic
3. Project `.agents` mode-specific
4. Project `.agents` generic
5. Global Roo mode-specific
6. Global Roo generic
7. Global `.agents` mode-specific
8. Global `.agents` generic

Source: [Roo Code Skills](https://roocodeinc.github.io/Roo-Code/features/skills/).

## Frontmatter compatibility analysis

## Agent Skills standard fields

| Field | Standard status | Recommendation |
|---|---|---|
| `name` | Required | Always include |
| `description` | Required | Always include; describe what and when |
| `license` | Optional | Safe and useful |
| `compatibility` | Optional | Use only for real environment requirements |
| `metadata` | Optional | Best extension point; namespace custom keys |
| `allowed-tools` | Experimental | Use cautiously; semantics and security differ |

Source: [Agent Skills specification](https://agentskills.io/specification).

## Runtime field matrix

| Field | Codex runtime | Codex quick validator | Claude | Copilot | Cursor | OpenCode | Other investigated runtimes |
|---|---|---|---|---|---|---|---|
| `name` | Honored | Accepted | Honored/optional in some layouts | Honored | Required | Honored | Generally required |
| `description` | Honored | Accepted | Honored/recommended | Honored | Required | Honored | Generally required |
| `license` | Ignored by current parser | Accepted | Standard-compatible | Documented | Not documented | Honored | Usually unspecified |
| `compatibility` | Ignored by current parser | Rejected | Standard-compatible | Not documented | Not documented | Honored | Usually unspecified |
| `metadata` | `short-description` partially honored | Accepted | Standard-compatible | Not documented | Honored | Honored | Usually unspecified |
| `allowed-tools` | Ignored in `SKILL.md`; dependencies belong in sidecar | Accepted | Honored | Honored | Not documented | Not listed | Support varies |
| `paths` | Ignored | Rejected | Honored | Not documented | Honored | Ignored as unknown | Usually unspecified |
| `disable-model-invocation` | Ignored | Rejected | Honored | Not documented | Honored | Ignored as unknown | Usually unspecified |
| `context` / `agent` | Ignored | Rejected | Honored | Not documented | Not documented | Ignored as unknown | Usually unspecified |
| Unknown key | Current Serde implementation ignores | Rejected | Undocumented | Undocumented | Undocumented | Explicitly ignored | Mostly undocumented |

## Why not use a union frontmatter?

A union such as:

```yaml
---
name: deploy
description: Deploy the application.
license: Apache-2.0
compatibility: Requires Docker and network access.
allowed-tools: Bash(docker:*)
disable-model-invocation: true
user-invocable: true
argument-hint: "[environment]"
context: fork
agent: general-purpose
paths:
  - "deploy/**"
alwaysApply: false
globs:
  - "deploy/**"
---
```

has several problems:

1. Codex’s bundled quick validator rejects most of it.
2. Copilot does not document Claude-specific controls.
3. Claude-specific tool syntax may not have the same meaning in Copilot.
4. Cursor rule fields are not identical to Cursor skill fields.
5. Unknown-key behavior is not a stable public guarantee for most runtimes.
6. A field may be ignored today and assigned conflicting semantics later.
7. Security-sensitive fields such as `allowed-tools` should not silently propagate across hosts.

## Recommended canonical frontmatter

Default:

```yaml
---
name: deploy-application
description: Deploys this application to staging or production with validation and rollback checks. Use when preparing, executing, or troubleshooting a deployment.
license: Apache-2.0
metadata:
  author: example-org
  version: "1.0.0"
---
```

If environment requirements matter:

```yaml
---
name: deploy-application
description: Deploys this application to staging or production with validation and rollback checks.
license: Apache-2.0
compatibility: Requires Docker, jq, and network access to the deployment API.
metadata:
  author: example-org
  version: "1.0.0"
---
```

Because Codex’s bundled quick validator currently rejects `compatibility`, validation should use the independent Agent Skills reference validator rather than treating Codex’s quick validator as the complete standard.

## Runtime-specific extension strategy

Use these layers:

1. Canonical standard fields in `SKILL.md`.
2. Namespaced custom data under `metadata`.
3. Runtime sidecars where officially supported.
4. Generated variants only when behavior cannot be expressed portably.

Example:

```text
deploy-application/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── runtime/
│   ├── claude.yaml
│   └── cursor.yaml
├── scripts/
├── references/
└── assets/
```

`runtime/` would be repository tooling input, not a host-standard directory.

## Real-world portability implementations

## `gotalab/cc-sdd`

`cc-sdd` defines runtime-specific layouts in a central registry.

Examples include:

- Claude Skills: `.claude/skills`
- Codex Skills: `.agents/skills`
- Cursor Skills: `.cursor/skills`
- GitHub Copilot Skills: `.github/skills`
- Gemini Skills: `.gemini/skills`
- Windsurf Skills: `.windsurf/skills`
- OpenCode Skills: `.opencode/skills`

It also maps invocation syntax:

- Codex: `$skill-name`
- Claude/Copilot/Cursor/Gemini/OpenCode: `/skill-name`
- Windsurf: `@skill-name`

Source:

- `gotalab/cc-sdd:tools/cc-sdd/src/agents/registry.ts:119-348`
- [Registry source](https://github.com/gotalab/cc-sdd/blob/main/tools/cc-sdd/src/agents/registry.ts)

This is a concrete example of one source project generating separate runtime-native destinations.

## `alirezarezvani/claude-skills`

The repository’s `convert.sh`:

1. Finds canonical `SKILL.md` files.
2. Extracts `name`, `description`, and the body.
3. Copies supporting `scripts`, `references`, and `templates`.
4. Emits runtime-specific outputs.

Cursor output:

```yaml
---
description: "..."
globs:
alwaysApply: false
---
```

Windsurf output:

```yaml
---
name: "..."
description: "..."
---
```

OpenCode output:

```yaml
---
name: "..."
description: "..."
compatibility: opencode
---
```

Source:

- `alirezarezvani/claude-skills:scripts/convert.sh:127-230`
- `alirezarezvani/claude-skills:scripts/convert.sh:430-523`
- [Conversion script](https://github.com/alirezarezvani/claude-skills/blob/main/scripts/convert.sh)

Its installer copies generated outputs into target runtime directories.

Source:

- `alirezarezvani/claude-skills:scripts/install.sh:94-205`
- [Install script](https://github.com/alirezarezvani/claude-skills/blob/main/scripts/install.sh)

Its older Codex sync script scans canonical Skills and creates symlinks in `.codex/skills`, plus a JSON index.

Source:

- `alirezarezvani/claude-skills:scripts/sync-codex-skills.py:1-13`
- `alirezarezvani/claude-skills:scripts/sync-codex-skills.py:198-270`
- [Codex sync script](https://github.com/alirezarezvani/claude-skills/blob/main/scripts/sync-codex-skills.py)

That script demonstrates both:

- A useful symlink fan-out approach
- The risk of hard-coded runtime paths becoming stale as public contracts evolve

## `rohitg00/skillkit`

SkillKit centralizes runtime path and format adapters in one configuration file. It records:

- Runtime skill directories
- Global directories
- Alternative paths
- Configuration file names
- Frontmatter fields
- Whether auto-discovery exists
- Runtime-specific output format

Source:

- `rohitg00/skillkit:packages/core/src/agent-config.ts:1-181`
- [SkillKit agent configuration](https://github.com/rohitg00/skillkit/blob/main/packages/core/src/agent-config.ts)

Some entries are stale relative to current official documentation, including older Codex and Amp paths. This illustrates why portability adapters need automated tests against current documentation and release behavior.

## Recommended repository architecture

Two plausible canonical layouts exist.

### Option A: Canonical `.agents/skills`

```text
AgentSkills/
├── .agents/
│   └── skills/
│       ├── skill-one/
│       │   ├── SKILL.md
│       │   ├── scripts/
│       │   ├── references/
│       │   ├── assets/
│       │   └── agents/
│       │       └── openai.yaml
│       └── skill-two/
│           └── SKILL.md
├── AGENTS.md
├── adapters/
├── scripts/
└── tests/
```

Advantages:

- Immediately native in Codex
- Immediately native in Copilot
- Immediately native in Cursor
- Immediately native in Gemini
- Immediately native in Windsurf
- Immediately native in OpenCode
- Immediately native in Amp
- Immediately native in Roo
- No installation step for most hosts

Disadvantages:

- Claude requires `.claude/skills`
- Cline may require `.cline/skills` unless using its Claude-compatible project path
- Creating multiple visible aliases can cause duplicate discovery in runtimes that scan both `.agents` and `.claude`
- Canonical source is itself a live installation path, making generation tests slightly more complex

### Option B: Canonical neutral `skills/`

```text
AgentSkills/
├── skills/
│   ├── skill-one/
│   └── skill-two/
├── generated/
├── AGENTS.md
├── scripts/
└── tests/
```

Advantages:

- Clean separation between source and generated outputs
- No runtime sees canonical source accidentally
- Easier deterministic generation
- Avoids duplicates unless the installer deliberately creates them
- Easier packaging and checksums

Disadvantages:

- Every runtime needs installation or generation
- The repository is not immediately usable through native discovery after cloning
- More setup friction

### Recommendation

For a repository whose primary purpose is to be cloned and immediately consumed by multiple agents, choose:

```text
.agents/skills
```

as canonical.

Provide an installer that adds only missing runtime aliases:

```text
.claude/skills
.cline/skills
.github/skills      # optional legacy/explicit Copilot target
.cursor/rules       # generated only when requested
```

For a package-manager-oriented repository whose outputs are installed into other projects, a neutral `skills/` source tree is cleaner.

## Proposed layout

```text
AgentSkills/
├── .agents/
│   └── skills/
│       ├── github-actions-debugging/
│       │   ├── SKILL.md
│       │   ├── scripts/
│       │   ├── references/
│       │   ├── assets/
│       │   └── agents/
│       │       └── openai.yaml
│       └── release-preparation/
│           └── SKILL.md
├── AGENTS.md
├── README.md
├── adapters/
│   ├── claude/
│   ├── cline/
│   ├── cursor-rules/
│   └── manifests/
├── scripts/
│   ├── install
│   ├── sync
│   ├── validate
│   └── generate-cursor-rules
├── schemas/
├── tests/
└── generated/
```

## Installer modes

Suggested interface:

```bash
./scripts/install --runtime codex
./scripts/install --runtime claude
./scripts/install --runtime copilot
./scripts/install --runtime cursor
./scripts/install --runtime windsurf
./scripts/install --runtime gemini
./scripts/install --runtime opencode
./scripts/install --runtime amp
./scripts/install --runtime cline
./scripts/install --runtime roo
./scripts/install --runtime all
```

Options:

```bash
./scripts/install --runtime all --mode copy
./scripts/install --runtime claude --mode symlink
./scripts/install --runtime cursor --include-rules
./scripts/install --scope user
./scripts/install --scope project --target /path/to/project
```

## Copy versus symlink

| Consideration | Copy/sync | Symlink |
|---|---|---|
| Drift | Possible unless synchronized | No content drift |
| Windows | Reliable | Often problematic |
| Git archives / ZIP | Reliable | May lose link semantics |
| Cloud agents | Reliable | Links may not survive packaging |
| Package managers | Reliable | Varies |
| Immediate updates | Requires sync | Immediate |
| Storage | Duplicates files | Minimal |
| Security review | Snapshot can be reviewed | Target can change underneath |
| Recursive discovery | Predictable | Can expose unintended nested skills |
| Release pinning | Excellent | Depends on target |
| CI reproducibility | Excellent | Environment-dependent |

### Recommended default

Use copy/sync as the default installation mode.

The installer should:

1. Read the canonical skill manifest.
2. Copy complete skill directories.
3. Preserve executable bits.
4. Write an installation manifest.
5. Record source version and checksums.
6. Remove stale generated outputs only when explicitly requested.
7. Refuse to overwrite unmanaged files without `--force`.
8. Validate the result.
9. Offer `--check` for CI drift detection.

### Optional symlink mode

Offer symlinks for local Unix development.

Use shallow links:

```text
.claude/skills/github-actions-debugging
  -> ../../.agents/skills/github-actions-debugging
```

Avoid:

```text
.claude/skills
  -> ../.agents/skills
```

when a runtime recursively scans nested roots or when other tools also inspect both paths.

## Duplicate discovery risk

Several runtimes scan more than one compatibility path:

- Copilot scans `.agents/skills` and `.claude/skills`.
- Cursor scans `.agents/skills`, `.cursor/skills`, `.claude/skills`, and `.codex/skills`.
- OpenCode scans `.agents/skills` and `.claude/skills`.
- Amp scans `.agents/skills` and `.claude/skills`.

If `.claude/skills` mirrors `.agents/skills`, these runtimes may see the same logical skill twice unless they canonicalize or deduplicate paths.

Deduplication behavior is not consistently documented.

Mitigations:

1. Install only the paths needed for the selected runtime.
2. Use a manifest to know which aliases were generated.
3. Test each target runtime’s skill listing.
4. Keep identical names and content when duplicates are unavoidable.
5. Prefer direct `.agents/skills` for all hosts that support it.
6. Generate `.claude/skills` only for Claude/Cline environments.
7. Avoid checking every generated path into the repository unless duplicate behavior has been verified.

## AGENTS.md portability router

Recommended root file:

```markdown
# Agent instructions

## Repository purpose

This repository contains portable Agent Skills for coding agents that support
the open `SKILL.md` format.

## Skills

Canonical skills live under `.agents/skills/<skill-name>/SKILL.md`.

Before creating a new workflow from scratch:

1. Review the available skill names and descriptions.
2. Select a matching skill when one applies.
3. Read that skill's `SKILL.md`.
4. Resolve supporting scripts, references, and assets relative to the skill
   directory.
5. Follow the skill instructions while still honoring explicit user requests
   and repository safety rules.

Do not load every complete `SKILL.md` eagerly. Use descriptions for discovery
and load full instructions only when relevant.

## Validation

Run the repository skill validator after changing a skill.

## Portability

Keep canonical `SKILL.md` frontmatter standards-compliant. Put runtime-specific
configuration in supported sidecars or generated adapters.
```

This works as readable guidance even when the runtime does not implement `@` imports.

## Generated Cursor rule strategy

For an ordinary skill:

```yaml
---
name: release-preparation
description: Prepares a release by validating versioning, changelogs, tests, and artifacts.
---
```

A generated `.cursor/rules/release-preparation.mdc` could be:

```markdown
---
description: Prepares a release by validating versioning, changelogs, tests, and artifacts.
alwaysApply: false
---

The canonical workflow is defined in
`.agents/skills/release-preparation/SKILL.md`.

Read and follow that file when preparing or troubleshooting a release.
```

For a file-scoped rule:

```markdown
---
description: Release workflow requirements
globs: "CHANGELOG.md, package.json, pyproject.toml"
alwaysApply: false
---

When modifying release metadata, follow the workflow in
`.agents/skills/release-preparation/SKILL.md`.
```

Do not blindly copy Skill frontmatter into `.mdc`; map semantics deliberately.

## Validation strategy

CI should validate:

### Structural rules

- Every skill directory contains `SKILL.md`.
- `SKILL.md` begins with YAML frontmatter.
- `name` exists.
- `description` exists.
- Directory name matches `name`.
- Name is 1–64 characters.
- Name uses lowercase alphanumeric characters and single hyphens.
- Description is 1–1024 characters.
- References resolve relative to the skill.
- Scripts and referenced assets exist.

### Portability rules

- Canonical frontmatter contains only approved standard keys.
- Custom metadata keys are namespaced.
- Runtime-specific keys are not placed in canonical frontmatter without an explicit compatibility exception.
- `allowed-tools` use is reviewed.
- No absolute local paths are embedded.
- No user-specific home paths are embedded.
- No secrets are committed.
- Shell scripts specify required interpreters.
- Environment dependencies are documented.
- Generated adapters match canonical checksums.

### Runtime smoke tests

Where practical:

- Codex `/skills`
- Claude skill listing
- Copilot `/skills list`
- Cursor Customize → Skills
- Gemini `/skills list`
- OpenCode skill tool listing
- Amp skill list
- Roo skill discovery
- Cline Skills menu

## MCP versus Skills

MCP is an open client/server protocol for connecting AI applications to external systems. It defines JSON-RPC communication, lifecycle negotiation, tools, resources, prompts, notifications, and transports such as stdio and Streamable HTTP.

Sources:

- [MCP introduction](https://modelcontextprotocol.io/docs/getting-started/intro)
- [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture)

## Decision table

| Requirement | Prefer Skill | Prefer MCP |
|---|---:|---:|
| Reusable instructions | Yes | Sometimes prompt primitive |
| Checklist or workflow | Yes | No |
| Domain knowledge | Yes | Resource possible, but usually Skill |
| Templates and examples | Yes | Resource possible |
| Deterministic local script | Yes | Only if it needs reusable tool exposure |
| Live external API | No | Yes |
| Authenticated service | No | Yes |
| Database query | No | Yes |
| Dynamic structured tool schema | No | Yes |
| Long-running shared process | No | Yes |
| Cross-client callable operation | No | Yes |
| Context-sensitive instructions for using a tool | Yes | No |
| Centralized service updates | No | Yes |
| Offline repository portability | Yes | Usually no |

## Use a Skill when

- The capability is mostly procedural guidance.
- The workflow can use existing shell or editor tools.
- The capability should be versioned with the repository.
- Supporting code is deterministic and local.
- The full instructions should load only when relevant.
- No persistent service is required.

## Use MCP when

- The capability needs live data.
- Authentication or OAuth is required.
- Multiple clients should call the same structured tools.
- The operation is naturally an API.
- The service needs lifecycle management.
- Tool schemas or resources change dynamically.
- A remote or long-running process is appropriate.

## Compose them

A Skill can teach an agent when and how to use MCP tools:

```markdown
---
name: github-actions-debugging
description: Diagnoses failing GitHub Actions checks using the GitHub MCP server.
---

# Workflow

1. Use the GitHub MCP server to list workflow runs for the pull request.
2. Retrieve summaries for failed jobs.
3. Fetch full logs only when summaries are insufficient.
4. Reproduce the failure locally when possible.
5. Implement and validate the fix.
```

Codex can declare the MCP dependency in `agents/openai.yaml`.

Amp can bundle MCP configuration in `mcp.json`.

This combination preserves progressive disclosure at both the instruction and tool levels.

## Security considerations

Skills are executable content in practice, even when represented as Markdown.

Risks include:

- Prompt injection
- Malicious shell scripts
- Tool preapproval
- Network exfiltration
- Secret access
- Dependency installation
- Symlink target changes
- Unsafe MCP servers
- Overly broad filesystem access

Recommendations:

1. Treat third-party Skills as code.
2. Review scripts before installation.
3. Do not preapprove `shell` or `bash` by default.
4. Pin external dependencies.
5. Keep network access disabled unless required.
6. Avoid embedding credentials.
7. Validate symlink targets.
8. Use checksums and signed releases.
9. Separate setup-time secrets from agent-time environment variables.
10. Document every external service dependency.
11. Prefer allowlists over unrestricted internet access.
12. Test in isolated containers.

## Recommended implementation decisions

1. Use `.agents/skills` as the canonical repository skill directory.
2. Keep canonical Skills compliant with the open Agent Skills specification.
3. Require `name` and `description`.
4. Permit `license` and namespaced `metadata`.
5. Permit `compatibility` only when genuine environment requirements exist.
6. Treat `allowed-tools` as an opt-in security exception.
7. Put Codex-specific UI, invocation policy, and dependencies in `agents/openai.yaml`.
8. Do not put Claude-specific invocation controls in canonical frontmatter by default.
9. Provide `.claude/skills` through an installer for Claude Code.
10. Let Cline consume `.claude/skills` or install `.cline/skills`.
11. Use native `.agents/skills` for current Cursor.
12. Generate `.cursor/rules/*.mdc` only for rule semantics or legacy compatibility.
13. Keep root `AGENTS.md` as a concise skills router.
14. Do not depend on `@` imports in portable AGENTS.md.
15. Default to copy/sync installation with checksums.
16. Offer shallow per-skill symlinks for local Unix development.
17. Avoid `.codex/skills` as the canonical path.
18. Keep deprecated Codex prompts only for compatibility, not new development.
19. Add runtime discovery smoke tests.
20. Document verified behavior separately from inferred or undocumented behavior.

## Verified findings as of 2026-07-24

### Verified

- Codex supports native Agent Skills.
- Codex supports `SKILL.md`.
- Codex documents `.agents/skills`.
- Codex documents `~/.agents/skills`.
- Codex documents `/etc/codex/skills`.
- Codex follows symlinked skill folders.
- Codex supports explicit and implicit invocation.
- Codex supports optional `agents/openai.yaml`.
- Codex custom prompts are deprecated.
- Codex uses `~/.codex/config.toml`.
- Codex supports hierarchical repository `.codex/config.toml`.
- Codex supports hierarchical `AGENTS.md`.
- Codex cloud uses repository `AGENTS.md`.
- `.agents/skills` is supported by Codex, Copilot, Cursor, Gemini, Windsurf, OpenCode, Amp, and Roo.
- Claude Code supports `.claude/skills`.
- Copilot supports `.github/skills`, `.claude/skills`, and `.agents/skills`.
- Cursor supports native Agent Skills.
- OpenCode explicitly ignores unknown frontmatter keys.
- The Agent Skills standard defines `name`, `description`, `license`, `compatibility`, `metadata`, and experimental `allowed-tools`.
- AGENTS.md is plain Markdown with no required schema.
- Current npm tags are stable `0.145.0` and alpha `0.146.0-alpha.6`.

### Implementation-derived but not guaranteed by public documentation

- Codex currently ignores unknown frontmatter fields because its Serde structs do not deny unknown fields.
- Legacy Codex configuration-layer skill paths remain implemented.
- Codex optional sidecar metadata is fail-open.

### Uncertain or not conclusively verified

- The exact first Codex version that shipped native Skills.
- Unknown-field behavior in Claude Code.
- Unknown-field behavior in GitHub Copilot.
- Unknown-field behavior in Cursor.
- Unknown-field behavior in Gemini CLI.
- Unknown-field behavior in Windsurf.
- Unknown-field behavior in Amp.
- Unknown-field behavior in Cline.
- Unknown-field behavior in Roo.
- Whether every runtime deduplicates identical skills exposed through multiple compatibility paths.
- Whether every AGENTS.md adopter implements the same nested precedence.
- Any portable meaning for `@` references inside AGENTS.md.
- Whether current runtime behavior that tolerates extra fields will remain stable.

## Sources

- https://learn.chatgpt.com/docs/build-skills
- https://learn.chatgpt.com/docs/agent-configuration/agents-md
- https://learn.chatgpt.com/docs/custom-prompts
- https://learn.chatgpt.com/docs/config-file/config-basic
- https://learn.chatgpt.com/docs/cloud
- https://learn.chatgpt.com/docs/environments/cloud-environment
- https://learn.chatgpt.com/docs/cloud/internet-access
- https://learn.chatgpt.com/docs/changelog
- https://github.com/openai/codex
- https://github.com/openai/codex/releases
- https://github.com/openai/codex/releases/tag/rust-v0.145.0
- https://github.com/openai/codex/issues/5291
- https://github.com/openai/codex/issues/5321
- https://github.com/openai/codex/issues/14941
- https://github.com/openai/codex/issues/20704
- https://github.com/openai/codex/issues/22275
- https://github.com/openai/codex/issues/13074
- https://github.com/openai/codex/pull/31334
- https://github.com/openai/codex/commit/6f65b9a98c4172fac9ba7200a9c498e91fcb84ec
- https://github.com/openai/codex/commit/83a418783707f4446aa832b2799d6cacfef75011
- https://github.com/openai/codex/commit/56c11cf6586c0579e4e3eca14eefb0916b14c78c
- https://github.com/openai/codex/blob/main/codex-rs/core-skills/src/loader.rs
- https://github.com/openai/codex/blob/main/codex-rs/core-skills/src/loader_tests.rs
- https://github.com/openai/codex/blob/main/codex-rs/skills/src/lib.rs
- https://github.com/openai/codex/blob/main/codex-rs/skills/src/model.rs
- https://github.com/openai/codex/blob/main/codex-rs/core/src/agents_md.rs
- https://github.com/openai/codex/blob/main/codex-rs/core/src/agents_md_manager.rs
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/core-skills/src/loader.rs
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/core-skills/src/loader_tests.rs
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/skills/src/assets/samples/skill-creator/scripts/quick_validate.py
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/agents_md.rs
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/agents_md_manager.rs
- https://github.com/openai/skills
- https://registry.npmjs.org/@openai/codex
- https://registry.npmjs.org/@openai/codex/0.145.0
- https://registry.npmjs.org/@openai/codex/0.146.0-alpha.6
- https://registry.npmjs.org/-/package/@openai/codex/dist-tags
- https://www.npmjs.com/package/@openai/codex?activeTab=versions
- https://agentskills.io
- https://agentskills.io/specification
- https://agentskills.io/llms.txt
- https://github.com/agentskills/agentskills
- https://agents.md
- https://github.com/agentsmd/agents.md
- https://github.com/agentsmd/agents.md/blob/main/README.md
- https://github.com/agentsmd/agents.md/blob/main/components/HowToUseSection.tsx
- https://github.com/agentsmd/agents.md/blob/main/components/FAQSection.tsx
- https://github.com/agentsmd/agents.md/blob/main/components/CompatibilitySection.tsx
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/llms.txt
- https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
- https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions
- https://cursor.com/docs/skills
- https://cursor.com/docs/rules
- https://docs.devin.ai/desktop/cascade/skills
- https://geminicli.com/docs/cli/skills/
- https://geminicli.com/docs/cli/gemini-md/
- https://geminicli.com/docs/extensions/
- https://opencode.ai/docs/skills/
- https://ampcode.com/manual#agent-files
- https://docs.cline.bot/customization/skills.md
- https://roocodeinc.github.io/Roo-Code/features/skills/
- https://modelcontextprotocol.io/docs/getting-started/intro
- https://modelcontextprotocol.io/docs/learn/architecture
- https://modelcontextprotocol.io/specification/latest
- https://github.com/gotalab/cc-sdd
- https://github.com/gotalab/cc-sdd/blob/main/tools/cc-sdd/src/agents/registry.ts
- https://github.com/alirezarezvani/claude-skills
- https://github.com/alirezarezvani/claude-skills/blob/main/scripts/convert.sh
- https://github.com/alirezarezvani/claude-skills/blob/main/scripts/install.sh
- https://github.com/alirezarezvani/claude-skills/blob/main/scripts/sync-codex-skills.py
- https://github.com/rohitg00/skillkit
- https://github.com/rohitg00/skillkit/blob/main/packages/core/src/agent-config.ts
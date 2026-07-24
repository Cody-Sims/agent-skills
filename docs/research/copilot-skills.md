# GitHub Copilot Agent Skills and Customization Research

**Research date:** 2026-07-24  
**Scope:** GitHub Copilot cloud coding agent, Copilot CLI, Copilot in Visual Studio Code, Agent Skills, custom agents, custom instructions, prompt files, `AGENTS.md`, MCP, setup workflows, GitHub CLI skill tooling, and `github/awesome-copilot`.

## Executive findings

1. GitHub Copilot implements the open Agent Skills standard. Skills work with Copilot cloud agent, Copilot code review, Copilot CLI, the Copilot app, VS Code agent mode, and JetBrains agent mode. A skill is a directory containing a required `SKILL.md` plus optional scripts, references, templates, and assets. ([GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills))
2. Copilot recognizes project skills in `.github/skills`, `.claude/skills`, and `.agents/skills`; personal skills in `~/.copilot/skills` and `~/.agents/skills`. VS Code additionally reads `~/.claude/skills`. A repository-local `.copilot/skills` directory is not a documented default location. ([GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills), [VS Code Docs](https://code.visualstudio.com/docs/agent-customization/agent-skills))
3. GitHub does not currently document duplicate-name precedence among `.github/skills`, `.claude/skills`, `.agents/skills`, personal skills, plugin skills, and built-in skills. The safe rule is to avoid duplicate skill names and use the CLI inspection commands to verify discovery.
4. The portable Agent Skills frontmatter is `name`, `description`, `license`, `compatibility`, `metadata`, and experimental `allowed-tools`. Copilot’s VS Code implementation and Claude Code both add useful extensions including `argument-hint`, `user-invocable`, `disable-model-invocation`, and `context`. ([Agent Skills specification](https://agentskills.io/specification), [VS Code Docs](https://code.visualstudio.com/docs/agent-customization/agent-skills), [Claude Code Docs](https://code.claude.com/docs/en/skills))
5. `tools`, `agents`, `model`, `target`, `mcp-servers`, and retired `infer` are principally custom-agent fields, not portable Agent Skills fields. Claude Code independently supports `model` and singular `agent` in skills, but those should not be assumed portable to Copilot skills.
6. `gh skill` is built into GitHub CLI 2.90.0 and later. No separate `github/gh-skills` extension is now required. It supports search, preview, installation, updates, version pinning, provenance metadata, validation, and publishing. ([GitHub changelog](https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli/), [GitHub CLI manual](https://cli.github.com/manual/gh_skill))
7. `github/awesome-copilot` is GitHub-owned but explicitly community-created. GitHub warns that its contributions are sourced from third parties and that installed skills are not verified. It is an example catalog and distribution source, not a set of trusted built-in Copilot skills. ([Repository README](https://raw.githubusercontent.com/github/awesome-copilot/main/README.md), [GitHub Docs](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills))
8. Copilot cloud agent explicitly honors committed Agent Skills. Cloud setup belongs in `.github/workflows/copilot-setup-steps.yml`; repository MCP configuration is entered in GitHub repository settings, or embedded in custom-agent `mcp-servers`. ([Cloud skills documentation](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills), [environment documentation](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment))
9. No official hard maximum number of installed skills is documented. The open specification recommends progressive loading: only metadata for all skills, then the full `SKILL.md` for an activated skill, then additional resources on demand. It recommends fewer than 5,000 tokens and fewer than 500 lines in the main `SKILL.md`. ([Agent Skills specification](https://agentskills.io/specification))
10. For a cross-host repository, the strongest design is a canonical root `skills/<name>/SKILL.md` catalog using only open-standard metadata, with host-specific installation performed by `gh skill install` or a small installer rather than maintaining divergent copies in every host directory.

## 1. What an Agent Skill is

An Agent Skill is a self-contained directory that teaches an agent how to perform a specialized or repeatable task. Copilot first considers the skill’s metadata, loads the main instructions only when relevant, and accesses additional resources only as necessary. ([GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills), [Agent Skills specification](https://agentskills.io/specification))

A standard skill has this structure:

```text
skill-name/
├── SKILL.md
├── scripts/
├── references/
├── assets/
└── other-supporting-files
```

Only `SKILL.md` is required. The filename is case-sensitive and must be exactly `SKILL.md`. GitHub recommends a lowercase, hyphenated directory name. ([Adding skills for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills))

A minimal portable skill is:

```markdown
---
name: github-actions-failure-debugging
description: Debug failing GitHub Actions workflows. Use when a workflow run, check, job, or pull request CI build is failing.
license: MIT
---

# GitHub Actions failure debugging

Follow the repository’s documented build and test process.

1. Identify the failing workflow, job, and step.
2. Read a concise failure summary before loading full logs.
3. Reproduce the failure locally where possible.
4. Make the smallest corrective change.
5. Run the affected checks again before reporting completion.
```

Copilot chooses skills primarily from the user prompt and the skill description. In Copilot CLI and VS Code, users can also explicitly invoke a skill as a slash command such as `/github-actions-failure-debugging`. ([Adding skills for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills), [VS Code Docs](https://code.visualstudio.com/docs/agent-customization/agent-skills))

## 2. Supported Copilot surfaces

GitHub’s current documentation states that Agent Skills work with:

- Copilot cloud agent
- Copilot code review
- GitHub Copilot CLI
- GitHub Copilot app
- Agent mode in Visual Studio Code
- Agent mode in JetBrains IDEs

Source: [About agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills).

The broader Copilot customization feature matrix currently reports:

| Feature | VS Code | Visual Studio | JetBrains | Eclipse | Xcode | GitHub.com | Copilot CLI |
|---|---:|---:|---:|---:|---:|---:|---:|
| Custom instructions | Yes | Yes | Preview | Preview | Preview | Yes | Yes |
| Prompt files | Yes | Yes | Preview | No | Preview | No | No |
| Custom agents | Yes | Yes | Preview | Preview | Preview | Yes | Yes |
| Subagents | Yes | No | Preview | Preview | Preview | No | Yes |
| Agent Skills | Yes | Yes | Preview | No | No | Yes | Yes |
| Hooks | Preview | No | No | No | No | Yes | Yes |
| MCP servers | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

Source: [Copilot customization cheat sheet](https://docs.github.com/en/copilot/reference/customization-cheat-sheet).

This matrix is surface-sensitive. For example:

- Prompt files are a VS Code/Visual Studio/selected IDE feature and are not consumed by GitHub.com cloud agent or Copilot CLI.
- Agent Skills are suitable for portable task workflows.
- Custom agents are suitable when a separate persona, context window, model, tool subset, or MCP setup is needed.
- Hooks are appropriate for deterministic lifecycle behavior rather than advisory instructions.
- MCP servers add external tools and data sources.

## 3. Skill filesystem locations

### 3.1 GitHub-documented default locations

| Scope | Location | Supported context | Notes |
|---|---|---|---|
| Project | `.github/skills/<name>/SKILL.md` | Copilot CLI, VS Code, cloud agent, code review | GitHub-native project location |
| Project | `.claude/skills/<name>/SKILL.md` | Copilot CLI, VS Code, cloud agent, Claude Code | Best directly shared project location between Copilot and Claude Code |
| Project | `.agents/skills/<name>/SKILL.md` | Copilot CLI, VS Code, cloud agent and other Agent Skills hosts | Vendor-neutral project location recognized by Copilot |
| Personal | `~/.copilot/skills/<name>/SKILL.md` | Local Copilot hosts | Shared across local projects |
| Personal | `~/.agents/skills/<name>/SKILL.md` | Local Copilot and compatible hosts | Vendor-neutral personal location |
| Personal, VS Code | `~/.claude/skills/<name>/SKILL.md` | VS Code and Claude Code | VS Code documents this additional location |
| Project, unsupported by default | `.copilot/skills/<name>/SKILL.md` | None documented | Do not rely on this as a default project location |
| Personal, unsupported spelling | `~/.copilot/skill/...` | None | The documented directory is plural `skills` |

Sources: [GitHub Agent Skills concepts](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills), [Copilot CLI skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills), [VS Code Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills).

### 3.2 Additional locations

Copilot CLI supports adding an alternative skill location with:

```text
/skills add
```

The non-interactive equivalent is:

```bash
copilot skill add <FILE | URL | DIRECTORY>
```

Skills can be removed or inspected with the corresponding `/skills` commands or `copilot skill` subcommands. ([Copilot CLI skills documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills))

VS Code supports additional project skill locations through the `chat.agentSkillsLocations` setting. It also has a parent-repository discovery setting for monorepos, `chat.useCustomizationsInParentRepositories`. ([VS Code Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills))

### 3.3 Cloud-agent implications

A cloud session cannot see a developer’s local home directory. In practice, cloud-portable skills must be:

- committed in a recognized repository location;
- supplied by whatever cloud-hosted customization mechanism the product supports; or
- packaged in a plugin available to the cloud environment.

The GitHub documentation’s statement that skills work with cloud agent refers to repository-visible skills. A local-only `~/.copilot/skills` directory should not be treated as cloud synchronization. ([Adding skills for GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills))

### 3.4 Duplicate-name precedence

GitHub’s official skill documentation lists the recognized directories but does not provide a complete duplicate-name precedence table for:

- `.github/skills`
- `.claude/skills`
- `.agents/skills`
- `~/.copilot/skills`
- `~/.agents/skills`
- plugin-provided skills
- built-in skills
- manually added directories

Therefore, no exact skill precedence order should be asserted as a stable contract.

Recommended policy:

1. Give every distributed skill a globally distinctive, lowercase name.
2. Do not place different implementations under the same name in multiple recognized directories.
3. Use `copilot plugins list --kind skill` or `copilot skill list` to inspect what the CLI discovered.
4. Use `/skills info <name>` inside a Copilot CLI session to inspect a skill’s source location.
5. If host-specific behavior is unavoidable, use host-specific installer mappings rather than conflicting copies.

## 4. Custom-agent filesystem locations and precedence

### 4.1 Locations

| Scope | Location | Notes |
|---|---|---|
| Copilot CLI user | `~/.copilot/agents/*.agent.md` | Available across local projects |
| Repository | `.github/agents/*.agent.md` | Portable convention for project agents |
| Repository, GitHub.com | `.github/agents/*.md` | GitHub’s cloud documentation accepts Markdown profiles in this directory |
| VS Code Claude format | `.claude/agents/*.md` | VS Code can consume Claude-format agents |
| Organization | `/agents/*.md` in the organization’s `.github` or `.github-private` repository | Shared to organization repositories |
| Enterprise | `/agents/*.md` in a designated organization’s `.github-private` repository | Enterprise-wide source |
| VS Code profile | VS Code user-data/profile storage | Managed through the Agent Customizations editor |

Sources: [About Copilot CLI custom agents](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents), [Invoking custom agents](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents), [VS Code custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents).

For maximum portability, use the suffix `*.agent.md`, even though GitHub.com and VS Code can detect other `.md` files inside `.github/agents`.

### 4.2 Precedence

For same-filename custom agents, Copilot CLI documents this order:

1. User-level agent
2. Repository-level agent
3. Organization-level agent
4. Enterprise-level agent

Thus a user agent overrides a repository agent; repository overrides organization; organization overrides enterprise. ([Invoking custom agents](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents))

On GitHub.com, where a developer’s local user directory is not present, the effective hierarchy is:

1. Repository
2. Organization
3. Enterprise

The filename, with `.md` or `.agent.md` removed, is used for deduplication. ([Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration))

## 5. `SKILL.md` frontmatter

### 5.1 Open-standard frontmatter

The Agent Skills specification defines:

| Field | Required | Constraint or meaning |
|---|---:|---|
| `name` | Yes | 1–64 characters; lowercase letters, numbers, and hyphens; no leading/trailing or consecutive hyphens; must match directory |
| `description` | Yes | 1–1024 characters; state both what the skill does and when it should be used |
| `license` | No | License identifier or reference to a bundled license file |
| `compatibility` | No | 1–500 characters; environment, package, network, or host requirements |
| `metadata` | No | Arbitrary string-to-string metadata |
| `allowed-tools` | No | Experimental, space-separated pre-approved tools |

Source: [Agent Skills specification](https://agentskills.io/specification).

GitHub’s basic Copilot documentation explicitly introduces `name`, `description`, and `license`, and separately documents `allowed-tools` for pre-approving tools needed by a skill. ([Copilot CLI skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills))

### 5.2 Copilot VS Code extensions

VS Code documents these additional skill fields:

| Field | Meaning |
|---|---|
| `argument-hint` | Placeholder or hint shown when the slash command is selected |
| `user-invocable` | Whether the skill appears in the slash-command menu; default `true` |
| `disable-model-invocation` | Whether automatic relevance-based loading is disabled; default `false` |
| `context` | Experimental; `fork` runs the skill in a dedicated subagent context |

Source: [VS Code Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills).

Invocation behavior in VS Code is:

| Configuration | Slash command | Automatic model invocation |
|---|---:|---:|
| Neither field present | Yes | Yes |
| `user-invocable: false` | No | Yes |
| `disable-model-invocation: true` | Yes | No |
| Both restrictions set | No | No |

### 5.3 Frontmatter compatibility table

The following table concerns `SKILL.md`, not custom-agent profiles.

| Field | Copilot support | Claude Code support | Portability recommendation |
|---|---|---|---|
| `name` | Yes; required by GitHub/open format | Yes; optional in Claude, directory name can supply command | Include it and make it match the directory |
| `description` | Yes; required | Yes; recommended | Always include; describe capability and triggers |
| `license` | Accepted standard metadata | Accepted through Agent Skills standard | Include SPDX identifier or bundled license reference |
| `compatibility` | Accepted standard metadata; no special Copilot runtime behavior documented | Accepted through Agent Skills standard | Use only for genuine environment requirements |
| `metadata` | Accepted standard metadata; also used for portable provenance | Accepted through Agent Skills standard | Restrict values to strings; namespace custom keys |
| `allowed-tools` | Yes; Copilot documents pre-approval semantics; experimental in standard | Yes; grants tools for the invoking turn | Use sparingly; avoid pre-approving unrestricted shell |
| `argument-hint` | Yes in Copilot VS Code | Yes | Safe cross-host extension for local IDE/CLI UX |
| `user-invocable` | Yes in Copilot VS Code | Yes | Useful cross-host extension; cloud/CLI Copilot semantics are not fully documented |
| `disable-model-invocation` | Yes in Copilot VS Code | Yes | Useful for destructive or expensive manual-only workflows |
| `context` | Experimental in Copilot VS Code; `fork` supported | Yes; `fork` supported | Treat as an optional host extension |
| `model` | Not documented for Copilot `SKILL.md` | Yes | Do not place in portable core skills |
| `tools` | No; use `allowed-tools` for skills | No as the primary skill allowlist; Claude uses `allowed-tools`/`disallowed-tools` | Reserve `tools` for custom agents or prompt files |
| `agents` | No; custom-agent field in VS Code | No plural skill field | Do not use in portable skills |
| `agent` | Not documented for Copilot skills; prompt files use `agent` | Yes when `context: fork` selects a subagent type | Claude-specific overlay only |
| `infer` | No; retired custom-agent field, not a skill field | No skill field | Do not use |
| `when_to_use` | Not documented | Yes | Claude-specific; fold triggers into `description` for portability |
| `arguments` | Not documented | Yes | Claude-specific |
| `disallowed-tools` | Not documented for Copilot skills | Yes | Claude-specific overlay |
| `effort` | Not documented | Yes | Claude-specific |
| `background` | Not documented | Yes with forked context | Claude-specific |
| `hooks` | Not documented for Copilot skills | Yes | Claude-specific skill extension |
| `paths` | Not documented for Copilot skills | Yes | Use Copilot `.instructions.md` `applyTo` for path rules instead |
| `shell` | Not documented for Copilot skills | Yes | Claude-specific |
| `disable-model-invocation` plus `user-invocable` | VS Code supports both independently | Claude supports both independently | Reasonably portable between VS Code Copilot and Claude Code |
| `source`, `repository`, `ref`, tree SHA fields | `gh skill` writes provenance into frontmatter, but exact schema should be generated by the CLI | Unknown host semantics; metadata travels with the skill | Let `gh skill` manage these; do not hand-author assumed key names |

Sources: [Agent Skills specification](https://agentskills.io/specification), [VS Code Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills), [Claude Code skills](https://code.claude.com/docs/en/skills), [GitHub CLI skill changelog](https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli/).

### 5.4 Claude Code’s additional skill behavior

Claude Code’s documented skill fields include:

```yaml
---
name: deploy
description: Deploy the application to production
argument-hint: "[environment]"
disable-model-invocation: true
user-invocable: true
allowed-tools: Read Grep Bash(git:*)
disallowed-tools: AskUserQuestion
model: inherit
effort: high
context: fork
agent: general-purpose
background: false
paths:
  - "deploy/**"
shell: bash
---
```

Not all of these are portable to Copilot.

Claude-specific observations relevant to repository design:

- Claude project skills live in `.claude/skills/<name>/SKILL.md`.
- Claude personal skills live in `~/.claude/skills/<name>/SKILL.md`.
- Claude supports enterprise-, personal-, project-, plugin-, and nested-directory skills.
- Claude documents enterprise over personal over project precedence.
- A project or personal skill overrides a bundled skill with the same name.
- Plugin skills are namespaced.
- Claude may derive the slash command from the directory rather than `name`.
- Claude supports live skill-file change detection.
- Claude truncates combined `description` and `when_to_use` listing text at 1,536 characters.
- These are Claude rules and must not be presented as Copilot precedence rules.

Source: [Claude Code skills](https://code.claude.com/docs/en/skills).

## 6. Progressive loading and context behavior

The Agent Skills standard recommends three loading stages:

1. **Metadata:** approximately 100 tokens per skill for `name` and `description`.
2. **Instructions:** full `SKILL.md` loaded only after activation, recommended under 5,000 tokens.
3. **Resources:** scripts, references, examples, and assets loaded only when needed.

The specification recommends keeping `SKILL.md` below 500 lines and moving detailed material into focused referenced files. ([Agent Skills specification](https://agentskills.io/specification))

VS Code describes equivalent behavior:

1. Copilot discovers `name` and `description`.
2. It loads the `SKILL.md` body when the prompt is relevant or the user invokes the slash command.
3. It accesses referenced resources as needed.

Unreferenced files are not guaranteed to be loaded. Supporting files should be explicitly linked or named in `SKILL.md`. ([VS Code Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills))

Recommended structure:

```text
skills/release-notes/
├── SKILL.md
├── references/
│   ├── changelog-format.md
│   └── release-categories.md
├── assets/
│   └── release-note-template.md
└── scripts/
    └── collect-changes.sh
```

In `SKILL.md`:

```markdown
Use [the release-note template](assets/release-note-template.md).

For category definitions, read
[the release categories reference](references/release-categories.md).

If local Git history is available, run `scripts/collect-changes.sh`.
```

## 7. Tool approval and skill security

Copilot supports `allowed-tools` to pre-approve tools a skill needs. If a tool is not listed, Copilot asks for permission before using it. GitHub specifically warns against casually pre-approving `shell` or `bash`: doing so removes a user confirmation boundary and can permit malicious skills or prompt injections to run arbitrary commands. ([Copilot CLI skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills))

Example:

```yaml
---
name: image-convert
description: Convert SVG images to PNG. Use when the user asks to convert an SVG file.
allowed-tools: shell
---
```

This should only be used after reviewing the skill and every referenced executable.

Repository security policy should require:

- inspection of every installed skill;
- source pinning by release tag or full commit SHA;
- immutable releases where possible;
- review of all scripts and indirect references;
- no unbounded shell pre-approval in general-purpose skills;
- provenance metadata preserved during copying;
- automated validation and secret scanning;
- explicit licensing.

GitHub states that skills installed through `gh skill` are not verified and may contain prompt injection, hidden instructions, or malicious scripts. It recommends `gh skill preview` before installation. ([Adding skills for GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills))

## 8. Custom-agent profile format

A portable Copilot custom-agent profile can be:

```markdown
---
name: implementation-planner
description: Create implementation plans and technical specifications without modifying source code.
tools:
  - read
  - search
  - edit
model: inherit
user-invocable: true
disable-model-invocation: false
---

You are a technical implementation planner.

1. Analyze requirements and existing architecture.
2. Identify affected components and dependencies.
3. Produce a phased implementation plan.
4. Include tests, migration concerns, deployment concerns, and risks.
5. Do not modify production source code.
```

The Markdown body is the actual prompt. GitHub limits the body prompt to 30,000 characters. ([Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration))

### 8.1 Copilot custom-agent frontmatter

| Field | Type | Copilot meaning |
|---|---|---|
| `name` | String | Optional display name |
| `description` | String | Required purpose and capability description |
| `target` | String | `vscode` or `github-copilot`; default is both |
| `tools` | String or list | Allowed tools; absent means all; `[]` means none |
| `model` | String | Model used by the agent; absent inherits default |
| `disable-model-invocation` | Boolean | Prevent automatic/subagent use; default `false` |
| `user-invocable` | Boolean | Whether a user can manually select it; default `true` |
| `infer` | Boolean | Retired; use the two independent invocation fields |
| `mcp-servers` | Object | Additional MCP servers; not used by IDE custom agents |
| `metadata` | Object | String annotations; not used by IDE custom agents |
| `argument-hint` | String | Supported by VS Code; ignored by GitHub.com cloud agent |
| `agents` | List | VS Code list of permitted subagents; not in GitHub cloud-agent schema |
| `handoffs` | List | VS Code workflow transition buttons; ignored by GitHub.com cloud agent |
| `hooks` | Object | VS Code preview agent-scoped hooks |
| `license` | — | Not a documented custom-agent property |
| `compatibility` | — | Not a documented custom-agent property |
| `allowed-tools` | — | Skill field; custom agents use `tools` |

Sources: [GitHub custom-agent configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration), [VS Code custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents).

### 8.2 Invocation controls

`infer` is retired. The two replacements separate user visibility from automatic delegation:

| Configuration | User can select agent | Model can invoke as subagent |
|---|---:|---:|
| Defaults | Yes | Yes |
| `user-invocable: false` | No | Yes |
| `disable-model-invocation: true` | Yes | No |
| Both restrictions | No | No |

For GitHub cloud agent, `disable-model-invocation: true` is equivalent to old `infer: false`; if both are present, the newer field takes precedence. ([Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration))

### 8.3 Tool behavior

For custom agents:

```yaml
# All available tools
tools: ["*"]
```

```yaml
# No tools
tools: []
```

```yaml
# Selected built-in and MCP tools
tools:
  - read
  - search
  - edit
  - github/*
  - playwright/*
  - custom-server/specific-tool
```

GitHub’s cross-surface tool aliases include:

| Primary alias | Compatible aliases | Purpose |
|---|---|---|
| `execute` | `shell`, `Bash`, `powershell` | Execute shell commands |
| `read` | `Read`, `NotebookRead` | Read files |
| `edit` | `Edit`, `MultiEdit`, `Write`, `NotebookEdit` | Modify files |
| `search` | `Grep`, `Glob` | Search files and content |
| `agent` | `custom-agent`, `Task` | Invoke another agent |
| `web` | `WebSearch`, `WebFetch` | Web search/fetch; not currently mapped for cloud agent |
| `todo` | `TodoWrite` | Task lists; VS Code support, not current cloud support |

Unrecognized tool names are ignored to allow some cross-product portability. ([Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration))

### 8.4 Built-in Copilot CLI agents

Copilot CLI documents the following built-in agents:

| Agent | Purpose |
|---|---|
| `explore` | Fast, read-only codebase exploration |
| `task` | Runs tests, builds, linters, dependency installation, and other commands |
| `general-purpose` | Broad subagent with capabilities similar to the main agent |
| `code-review` | High-signal review focused on meaningful defects |
| `research` | Exhaustive technical research; explicitly invoked with `/research` |
| `rubber-duck` | Independent critical review of plans, code, and tests |

These are built-in **custom agents/subagents**, not Agent Skills, and should not be represented as default `SKILL.md` packages. ([About Copilot CLI custom agents](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents))

## 9. GitHub CLI skill tooling

### 9.1 `gh skill`

`gh skill` became part of GitHub CLI in version 2.90.0 and is currently in public preview. The alias `gh skills` is also documented. ([GitHub changelog](https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli/), [GitHub CLI manual](https://cli.github.com/manual/gh_skill))

No separate extension installation is required on current GitHub CLI versions.

Core commands:

```bash
# Search by topic
gh skill search terraform

# Browse a repository interactively
gh skill install github/awesome-copilot

# Preview without installing
gh skill preview github/awesome-copilot documentation-writer

# Install a named skill
gh skill install github/awesome-copilot documentation-writer

# Install a tag
gh skill install github/awesome-copilot documentation-writer@v1.2.0

# Install a commit
gh skill install github/awesome-copilot documentation-writer@abc123def

# Pin to a tag or commit
gh skill install github/awesome-copilot documentation-writer --pin v1.2.0

# Select another host and user scope
gh skill install github/awesome-copilot documentation-writer \
  --agent claude-code \
  --scope user

# List installed skills
gh skill list

# Update interactively
gh skill update

# Update one skill
gh skill update documentation-writer

# Update everything not pinned
gh skill update --all

# Validate without publishing
gh skill publish --dry-run

# Repair metadata where supported
gh skill publish --fix

# Validate and publish
gh skill publish
```

Supported host targets named in the launch changelog include:

- GitHub Copilot
- Claude Code
- Cursor
- Codex
- Gemini CLI
- Antigravity

`gh skill` installs into the appropriate directory for the selected host and scope. By default, it installs for Copilot at project scope. ([GitHub changelog](https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli/))

### 9.2 Versioning and provenance

When `gh skill` installs a skill, it records provenance in `SKILL.md` frontmatter, including:

- source repository;
- source ref;
- source tree SHA.

`gh skill update` compares the installed tree SHA with the remote tree SHA. Pinned skills are skipped during normal updates. `gh skill publish` validates against the Agent Skills specification and checks recommended repository protections such as tag protection, secret scanning, code scanning, and immutable releases. ([GitHub changelog](https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli/))

### 9.3 Copilot CLI’s own skill manager

Copilot CLI separately provides:

```bash
copilot skill list
copilot skill add <FILE | URL | DIRECTORY>
copilot skill remove <NAME | DIRECTORY>
```

Inside an interactive Copilot CLI session:

```text
/skills
/skills list
/skills info <skill-name>
/skills add
/skills reload
/skills remove <skill-directory>
```

The interactive `/skills` menu can enable or disable skills. `copilot plugins list` can inspect discovered skills grouped by scope:

```bash
copilot plugins list --kind skill
copilot plugins list --kind skill --scope user --json
```

Source: [Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference).

### 9.4 `gh skill` versus `copilot skill`

| Command family | Primary purpose |
|---|---|
| `gh skill` | Discover, preview, install, pin, update, validate, and publish portable skills from GitHub repositories |
| `copilot skill` | Manage skill locations and local Copilot CLI discovery |
| `/skills` | Interactive-session inspection, enablement, reload, and removal |
| `copilot plugins list` | Inspect discovered skills, plugins, MCP servers, instructions, and language servers |

## 10. `github/awesome-copilot`

### 10.1 Repository status

`github/awesome-copilot` describes itself as:

> A community-created collection of custom agents, instructions, skills, hooks, workflows, and plugins.

The repository warns that customizations are sourced from third-party developers and should be inspected before installation. ([README](https://raw.githubusercontent.com/github/awesome-copilot/main/README.md))

Its current top-level content includes:

```text
agents/
cookbook/
docs/
extensions/
hooks/
instructions/
plugins/
skills/
website/
workflows/
AGENTS.md
CONTRIBUTING.md
README.md
```

The current root does not contain top-level `prompts`, `chatmodes`, or `collections` directories. The current resource model emphasizes:

- custom agents;
- instructions;
- skills;
- hooks;
- workflows;
- plugins;
- canvas extensions;
- learning material.

Sources: [GitHub Contents API](https://api.github.com/repos/github/awesome-copilot/contents), [README](https://raw.githubusercontent.com/github/awesome-copilot/main/README.md).

Older Copilot and VS Code terminology often used “chat modes” for what current documentation calls custom agents. New content should use `*.agent.md`, not create a new `.chatmode.md` convention unless compatibility with an older client is explicitly required.

### 10.2 Skill convention

Awesome Copilot skills live at:

```text
skills/<skill-name>/SKILL.md
```

The catalog’s contribution process requires:

1. a lowercase, hyphenated folder;
2. a `SKILL.md`;
3. a `name` matching the folder;
4. a clear, non-empty `description`;
5. optional assets below 5 MB each;
6. references from `SKILL.md` to bundled assets;
7. local validation;
8. regenerated catalog documentation.

Example validation commands used by the repository:

```bash
npm run skill:create -- --name <skill-name> --description "<description>"
npm run skill:validate
npm run build
```

Source: [Awesome Copilot contributing guide](https://raw.githubusercontent.com/github/awesome-copilot/main/CONTRIBUTING.md).

The generated skills catalog includes:

- skill name;
- description;
- bundled assets;
- an installation command such as:

```bash
gh skills install github/awesome-copilot acquire-codebase-knowledge
```

Source: [Awesome Copilot skills catalog](https://raw.githubusercontent.com/github/awesome-copilot/main/docs/README.skills.md).

### 10.3 Agent convention

Awesome Copilot agents live at:

```text
agents/<name>.agent.md
```

Its contribution template currently demonstrates:

```markdown
---
description: "Brief description of the agent and its purpose"
model: "gpt-5"
tools: ["codebase", "terminalCommand"]
name: "My Agent Name"
---

You are an expert in the target domain.

## Expertise

- Area one
- Area two

## Approach

- How to help users
- What to prioritize

## Guidelines

- Constraints
- Required practices
```

Source: [Awesome Copilot contributing guide](https://raw.githubusercontent.com/github/awesome-copilot/main/CONTRIBUTING.md).

Actual cloud/CLI portability should be checked against GitHub’s current custom-agent aliases because older or IDE-specific tool names may be ignored.

### 10.4 Instructions convention

Awesome Copilot instructions live at:

```text
instructions/<name>.instructions.md
```

Its basic contribution example uses:

```markdown
---
description: "Instructions for a specific technology or practice"
---

# Technology or framework

## Instructions

- Specific guidance
- Coding conventions
- Validation requirements
```

When installing in a repository, users may:

- merge broad content into `.github/copilot-instructions.md`; or
- place focused files in `.github/instructions/*.instructions.md` and add `applyTo` globs.

Source: [Awesome Copilot instructions catalog](https://raw.githubusercontent.com/github/awesome-copilot/main/docs/README.instructions.md).

### 10.5 Plugins

Awesome Copilot plugins bundle related agents, commands, and skills. The repository uses a Claude Code-compatible plugin metadata model:

```json
{
  "name": "my-plugin-id",
  "description": "Plugin description",
  "version": "1.0.0",
  "keywords": [],
  "author": {
    "name": "Awesome Copilot Community"
  },
  "repository": "https://github.com/github/awesome-copilot",
  "license": "MIT",
  "agents": ["./agents/my-agent.md"],
  "commands": ["./commands/my-command.md"],
  "skills": ["./skills/my-skill/"]
}
```

Source: [Awesome Copilot contributing guide](https://raw.githubusercontent.com/github/awesome-copilot/main/CONTRIBUTING.md).

Plugins are the current bundling/distribution concept closest to what older catalogs might have called a collection. Instructions are deliberately excluded from Awesome Copilot plugins and remain standalone resources.

## 11. Official and first-party skills

### 11.1 No stable published default-skill catalog

GitHub documents that Copilot CLI has built-in skill support and that built-in skills can appear in discovery output, but the reviewed official documentation does not publish a stable, exhaustive list of built-in `SKILL.md` packages.

The supported way to inspect the current local product build is:

```bash
copilot plugins list --kind skill
copilot skill list
```

The absence of a documented list means a new repository should not copy names from speculative blog posts or assume that built-in agents such as `code-review` are built-in Agent Skills.

### 11.2 Concrete official examples

GitHub and VS Code documentation provide these concrete example skills:

| Name | Status | Purpose |
|---|---|---|
| `github-actions-failure-debugging` | GitHub documentation example | Debug failing GitHub Actions workflows using MCP workflow/log tools and local reproduction |
| `github-actions-debugging` | VS Code documentation example | Similar Actions failure investigation workflow |
| `webapp-testing` | VS Code documentation example | Create and debug Playwright browser tests |
| `image-convert` | GitHub documentation example | Run a bundled script to convert SVG to PNG |
| `documentation-writer` | Used in official `gh skill` installation examples, sourced from Awesome Copilot | Documentation generation workflow |

Sources: [Copilot CLI skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills), [VS Code Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills), [GitHub CLI skill changelog](https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli/).

These are examples or community packages, not proof that every Copilot installation ships them by default.

### 11.3 GitHub-recommended external sources

GitHub’s Agent Skills documentation points users to:

- [`anthropics/skills`](https://github.com/anthropics/skills)
- [`github/awesome-copilot`](https://github.com/github/awesome-copilot)

GitHub calls Awesome Copilot community-created. The skills installation page also states that skills are not verified by GitHub. Therefore, neither repository should be treated as an automatically trusted first-party binary distribution. ([About Agent Skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills), [Adding Agent Skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills))

## 12. Candidate default skills for the new repository

The following are recommended **capability candidates**, not instructions to copy third-party text verbatim. Reimplement where practical, and vendor only after license, security, and quality review.

| Candidate | Source status | Rationale |
|---|---|---|
| `github-actions-failure-debugging` | Reimplement from official GitHub example | High-value repeatable workflow for finding failing jobs, summarizing logs, reproducing locally, and validating a fix |
| `documentation-writer` | Community skill named in official `gh skill` examples | Documentation work is universal and benefits from repeatable structure, link checking, and repository-aware validation |
| `acquire-codebase-knowledge` | Awesome Copilot community skill | Useful for onboarding, architecture mapping, repository inventories, and producing durable codebase documentation |
| `repository-onboarding` | New portable implementation | Analyze build, test, lint, architecture, and repository conventions without duplicating broad always-on instructions |
| `webapp-testing` | Reimplement from VS Code example | Provides a reusable Playwright workflow while keeping framework-specific details in references |
| `release-notes` | New portable implementation | Produces consistent release notes from commits, pull requests, and labels using a bundled template |
| `dependency-upgrade` | New portable implementation | Encodes safe dependency update, changelog review, migration, test, and rollback procedures |
| `security-review` | New portable implementation | Standardizes threat-focused review without forcing a permanent security persona |
| `agent-supply-chain` | Awesome Copilot community skill | Relevant to this repository’s own problem: inspect, pin, hash, and track third-party agent resources |
| `agent-owasp-compliance` | Awesome Copilot community skill | Useful when reviewing agent systems against the OWASP Agentic Security Initiative |
| `architecture-blueprint-generator` | Awesome Copilot community skill | Creates consistent architectural summaries and diagrams for unfamiliar repositories |
| `ai-ready` | Awesome Copilot community skill | Helps configure repositories with instructions, agent guidance, CI, and issue templates |
| `skill-authoring` | New portable implementation | Enforces the open Agent Skills schema, progressive disclosure, portability, security, and validation |
| `skill-audit` | New portable implementation | Checks names, metadata lengths, references, licenses, executable scripts, dangerous tool approvals, and stale provenance |
| `pull-request-review` | New portable implementation | Produces a focused review workflow separate from built-in review agents, with configurable repository checks |
| `incident-triage` | New portable implementation | Encodes evidence collection, timeline, hypotheses, mitigations, and handoff artifacts |
| `database-migration` | New portable implementation | Captures backup, forward migration, compatibility, validation, and rollback practices |
| `accessibility-review` | New or reviewed Awesome Copilot derivative | Applies WCAG-oriented checks only when frontend/accessibility work is relevant |
| `commit-preparation` | New portable implementation | Runs repository-required checks and drafts a conventional commit without making release behavior always-on |
| `adr-writer` | New or reviewed community derivative | Generates structured Architecture Decision Records with alternatives and consequences |

Useful Awesome Copilot examples are listed in its generated catalog: [Awesome Copilot skills catalog](https://raw.githubusercontent.com/github/awesome-copilot/main/docs/README.skills.md).

## 13. Full Copilot customization taxonomy

### 13.1 Customization file table

| Customization | Path and scope | Trigger | Purpose | Frontmatter | Best use |
|---|---|---|---|---|---|
| Repository-wide instructions | `.github/copilot-instructions.md` | Automatic | Broad repository context and conventions | None required | Build commands, architecture, universal coding standards |
| Path-specific instructions | `.github/instructions/**/*.instructions.md` | Automatic when affected files match | Rules for a language, directory, framework, or file type | `applyTo`; optional `excludeAgent` | TypeScript rules, migration rules, docs conventions |
| Agent instructions | `AGENTS.md` anywhere in repository | Automatic for applicable agent work | Cross-agent repository guidance | None | Portable project instructions, nested package guidance |
| Claude/Gemini agent instructions | Root `CLAUDE.md` or `GEMINI.md` | Automatic on supported Copilot surfaces | Compatibility with other agents | None | Existing cross-tool project guidance |
| CLI personal instructions | `~/.copilot/copilot-instructions.md` | Automatic at CLI session start | Personal behavior across repositories | None | Communication style and personal workflow defaults |
| CLI personal modular instructions | `~/.copilot/instructions/**/*.instructions.md` | Automatic when applicable | Reusable personal path rules | `applyTo` | Personal language/tool conventions |
| Prompt file | `.github/prompts/*.prompt.md` | Manual slash command or picker | Reusable one-shot prompt template | `name`, `description`, `argument-hint`, `agent`, `model`, `tools` | Generate component, execute a checklist, request a specific output |
| Custom agent | `.github/agents/*.agent.md`; `~/.copilot/agents/*.agent.md` | User selection, inference, or delegation | Specialist persona with tool/model/MCP constraints | `name`, `description`, `tools`, `model`, invocation fields, etc. | Read-only auditor, planner, framework specialist |
| Agent Skill | Recognized `skills/<name>/SKILL.md` locations | Automatic relevance or slash command | Portable task-specific workflow with assets | Standard skill metadata plus host extensions | Debugging, releases, migrations, document processing |
| Hook | `.github/hooks/*.json` or host-specific hook config | Deterministic lifecycle event | Run required commands before/after events | JSON schema rather than Markdown frontmatter | Formatting, policy checks, telemetry, command blocking |
| MCP configuration | Repository settings; local `mcp.json`; custom-agent `mcp-servers` | Agent calls a tool | Add external systems, APIs, databases, and browser tooling | JSON/YAML configuration | GitHub, Jira, Sentry, Playwright, databases |
| Copilot setup workflow | `.github/workflows/copilot-setup-steps.yml` | Before cloud-agent work | Prepare ephemeral cloud environment | GitHub Actions YAML | Install dependencies, authenticate, choose runner |
| Copilot code-review workflow | `.github/workflows/copilot-code-review.yml` | Before Copilot code review | Separate code-review environment | GitHub Actions YAML | Review-only dependencies or runner configuration |
| Plugin | Plugin package/manifest | Install or enable | Bundle skills, agents, hooks, commands, MCP | Plugin JSON | Team-wide packaged capability |
| Subagent | Runtime process | Automatic or explicit delegation | Isolated context for a subtask | Uses an agent profile, not a new file type | Research, tests, review, parallel work |
| Historical chat mode | Older VS Code terminology | Manual mode selection | Predecessor terminology for custom agents | Older client-specific format | Migrate to current `*.agent.md` |

Sources: [Copilot customization cheat sheet](https://docs.github.com/en/copilot/reference/customization-cheat-sheet), [repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions), [VS Code prompt files](https://code.visualstudio.com/docs/agent-customization/prompt-files), [VS Code custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents).

### 13.2 Choosing between instructions, prompts, skills, and agents

Use **custom instructions** when:

- guidance applies to nearly every task;
- it describes project architecture, build commands, coding standards, or repository policy;
- loading it on every interaction is beneficial.

Use a **path-specific instruction** when:

- the rule applies only to selected files;
- a glob can identify the relevant scope;
- no bundled scripts or assets are needed.

Use a **prompt file** when:

- the user should manually invoke a task;
- the workflow is mostly a reusable prompt;
- it is acceptable that the feature is IDE-specific;
- input variables, selected model, or prompt-specific tools are useful.

Use an **Agent Skill** when:

- a workflow should activate only when relevant;
- the workflow is portable across agent hosts;
- scripts, templates, examples, references, or assets belong with it;
- the main context should not contain the instructions at all times.

Use a **custom agent** when:

- a separate persona or isolated context is valuable;
- tool restrictions are central;
- a different model should be used;
- custom MCP servers are required;
- the main agent should delegate specialist work.

Use an **MCP server** when:

- the missing element is an external capability or live data source rather than instructions.

Use a **hook** when:

- execution must be deterministic;
- merely asking the model to comply is insufficient;
- a policy must block, log, validate, or transform a lifecycle event.

Source: [Comparing Copilot CLI customization features](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features).

## 14. `AGENTS.md` and instruction precedence

### 14.1 `AGENTS.md` behavior

GitHub supports:

- one `AGENTS.md` at repository root;
- nested `AGENTS.md` files for specific parts of a repository;
- `.github/copilot-instructions.md`;
- `.github/instructions/**/*.instructions.md`;
- root `CLAUDE.md`;
- root `GEMINI.md`.

The closest applicable `AGENTS.md` in the directory tree takes precedence for work in that subtree. ([Repository custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions), [AGENTS.md changelog](https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions/))

Copilot CLI discovers instruction files in:

- repository root;
- current working directory;
- intermediate directories;
- nested paths related to files being worked on.

Copilot CLI can also load extra `AGENTS.md` and modular instruction directories through `COPILOT_CUSTOM_INSTRUCTIONS_DIRS`. ([Copilot CLI instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions))

### 14.2 GitHub.com instruction precedence

GitHub.com documents this order:

1. Personal instructions
2. Repository instructions:
   1. Applicable path-specific `.github/instructions/**/*.instructions.md`
   2. `.github/copilot-instructions.md`
   3. Agent instructions such as `AGENTS.md`
3. Organization instructions

All applicable sets are still supplied, so conflicting instructions should be avoided. ([Response customization](https://docs.github.com/en/copilot/concepts/prompting/response-customization))

### 14.3 Copilot CLI instruction interaction

Copilot CLI combines applicable instructions and explicitly says it does not define a general precedence order among combined instruction files. Identical duplicate copies of some instruction types are deduplicated, but authors should avoid conflicts. ([Copilot CLI instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions))

This differs from GitHub.com’s documented personal/repository/organization precedence and should be treated as a surface-specific rule.

### 14.4 Path-specific frontmatter

```markdown
---
applyTo: "**/*.ts,**/*.tsx"
---

- Use strict TypeScript.
- Do not introduce `any` without a documented reason.
- Run the project’s TypeScript checker after changes.
```

GitHub.com additionally supports excluding an instruction from one agent:

```markdown
---
applyTo: "**"
excludeAgent: "code-review"
---
```

Current documentation uses `code-review` and `cloud-agent` values. An earlier changelog used `coding-agent`, so clients and docs have evolved; new files should follow the latest reference for the targeted surface. ([Repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions), [agent-specific instructions changelog](https://github.blog/changelog/2025-11-12-copilot-code-review-and-coding-agent-now-support-agent-specific-instructions/))

## 15. Prompt files

Prompt files live at:

```text
.github/prompts/<name>.prompt.md
```

They are invoked manually in supported IDEs and do not provide portable Agent Skills behavior.

Supported frontmatter:

| Field | Meaning |
|---|---|
| `description` | Short prompt description |
| `name` | Slash-command name; defaults to filename |
| `argument-hint` | Input hint |
| `agent` | Built-in or custom agent used to run the prompt |
| `model` | Model used for the prompt |
| `tools` | Prompt-specific tool list |

Example:

```markdown
---
name: security-review
description: Perform a REST API security review.
argument-hint: "[API path or files]"
agent: ask
model: Claude Sonnet 4
tools:
  - search/codebase
---

Review the selected REST API implementation.

Check:

- authentication and authorization;
- input validation;
- rate limiting;
- sensitive-data exposure;
- logging and monitoring;
- dependency and configuration risks.

Return a prioritized Markdown task list.
```

Tool priority for prompt execution is:

1. Tools specified by the prompt file
2. Tools from the custom agent named by the prompt
3. Default tools for the selected agent

Source: [VS Code prompt files](https://code.visualstudio.com/docs/agent-customization/prompt-files).

## 16. Copilot cloud coding agent

### 16.1 Skills are honored

GitHub explicitly states that Agent Skills work with Copilot cloud agent. Relevant committed skills are loaded from repository-recognized skill directories. Skills also work with Copilot code review. ([About Agent Skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills))

For Copilot code review:

- use a review-oriented skill name such as `code-review` if reliable review discovery is important;
- other relevant skills under `.github/skills` may also be selected automatically;
- instructions and skills are read from the pull request’s head branch, not the base branch.

Sources: [Adding Agent Skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills), [Response customization](https://docs.github.com/en/copilot/concepts/prompting/response-customization).

### 16.2 `copilot-setup-steps.yml`

Cloud agent runs in an ephemeral GitHub Actions environment. Repository setup belongs at:

```text
.github/workflows/copilot-setup-steps.yml
```

Requirements:

- file must be present on the default branch;
- workflow must contain one job named exactly `copilot-setup-steps`;
- setup runs before Copilot begins work;
- failed setup steps stop remaining setup steps, but Copilot begins with the resulting partial environment;
- `timeout-minutes` cannot exceed 59.

Supported job customizations are:

- `steps`
- `permissions`
- `runs-on`
- `services`
- `snapshot`
- `timeout-minutes`

Other job settings are ignored. ([Cloud environment setup](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment))

Example:

```yaml
name: Copilot Setup Steps

on:
  workflow_dispatch:
  push:
    paths:
      - .github/workflows/copilot-setup-steps.yml
  pull_request:
    paths:
      - .github/workflows/copilot-setup-steps.yml

jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    permissions:
      contents: read

    steps:
      - name: Check out repository
        uses: actions/checkout@v6

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm

      - name: Install dependencies
        run: npm ci
```

If the workflow does not check out the repository, Copilot checks it out afterward. GitHub overrides checkout `fetch-depth` to support rollback while mitigating security concerns. ([Cloud environment setup](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment))

### 16.3 Code-review environment

Copilot code review uses `copilot-setup-steps.yml` by default. To give code review a separate environment, create:

```text
.github/workflows/copilot-code-review.yml
```

When present, that file takes precedence for code-review environment setup. ([Cloud environment setup](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment))

### 16.4 Cloud runtime limits

Documented cloud-agent limits include:

- one repository per task;
- one branch at a time;
- exactly one pull request per assigned task;
- default context restricted to the current repository unless MCP access is broadened;
- maximum session execution time of 59 minutes;
- only GitHub-hosted repositories;
- content exclusions do not apply to cloud agent.

Source: [About Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent).

## 17. MCP configuration

### 17.1 Repository MCP settings

Repository MCP configuration is entered through GitHub repository settings and is shared by Copilot cloud agent and Copilot code review. It is not committed as a normal repository JSON file for GitHub.com cloud execution. ([Configure MCP servers](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers))

GitHub enables these servers by default:

- GitHub MCP server
- Playwright MCP server

Cloud agent and code review currently support MCP **tools**, but not MCP resources or prompts. Remote MCP OAuth is not currently supported for these cloud surfaces. Once configured, cloud Copilot can use enabled MCP tools autonomously without asking for approval. ([Configure MCP servers](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers))

Repository configuration shape:

```json
{
  "mcpServers": {
    "example": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@example/mcp"],
      "tools": ["read_item", "list_items"],
      "env": {
        "EXAMPLE_TOKEN": "$COPILOT_MCP_EXAMPLE_TOKEN"
      }
    }
  }
}
```

Supported server types include:

```text
local
stdio
http
sse
```

Repository/organization Agents secrets and variables used by MCP must be prefixed `COPILOT_MCP_`. ([Configure MCP servers](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers))

### 17.2 Custom-agent MCP

A custom agent may embed MCP configuration:

```markdown
---
name: incident-investigator
description: Investigate incidents using repository, monitoring, and browser evidence.
tools:
  - read
  - search
  - github/*
  - monitoring/query
mcp-servers:
  monitoring:
    type: local
    command: npx
    args:
      - -y
      - "@example/monitoring-mcp"
    tools:
      - query
    env:
      API_TOKEN: ${{ secrets.COPILOT_MCP_MONITORING_TOKEN }}
---

Investigate incidents using verifiable evidence.
```

`mcp-servers` is used by GitHub Copilot cloud agent but not VS Code or other IDE custom agents. ([Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration))

MCP processing order for cloud custom agents is:

1. out-of-box MCP configuration;
2. custom-agent MCP configuration;
3. repository-settings MCP configuration.

Later levels can override earlier levels. ([Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration))

### 17.3 Copilot CLI MCP

Copilot CLI stores local MCP configuration by default at:

```text
~/.copilot/mcp-config.json
```

`COPILOT_HOME` can relocate the Copilot home directory. MCP servers can be added interactively with:

```text
/mcp add
```

The GitHub MCP server is preconfigured in Copilot CLI. ([Invoking custom agents](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents))

## 18. Limits and budgets

| Item | Limit or guidance | Status |
|---|---|---|
| Skill `name` | 1–64 characters | Standard validation limit |
| Skill `description` | 1–1024 characters | Standard validation limit |
| Skill `compatibility` | 1–500 characters when present | Standard validation limit |
| Main `SKILL.md` | Under 500 lines recommended | Guidance, not hard runtime limit |
| Activated skill instructions | Under 5,000 tokens recommended | Guidance, not hard runtime limit |
| Metadata loaded per skill | Approximately 100 tokens | Specification estimate |
| Claude combined `description` + `when_to_use` listing | Truncated at 1,536 characters | Claude-specific |
| Custom-agent prompt body | Maximum 30,000 characters | Copilot hard documented limit |
| Cloud-agent session | Maximum 59 minutes | Hard limit |
| `copilot-setup-steps.yml` timeout | Maximum 59 minutes | Hard limit |
| Number of installed skills | No official Copilot hard maximum found | Unknown |
| Number of activated skills per request | No official hard maximum found | Model/context dependent |
| Supporting asset size | No Copilot-wide standard hard limit found; Awesome Copilot contribution policy uses under 5 MB per asset | Catalog-specific |
| Prompt-file count | No reviewed hard limit found | Unknown |
| Custom-agent count | No reviewed hard limit found | Unknown |

Sources: [Agent Skills specification](https://agentskills.io/specification), [Claude Code skills](https://code.claude.com/docs/en/skills), [Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration), [About cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent), [Awesome Copilot contributing guide](https://raw.githubusercontent.com/github/awesome-copilot/main/CONTRIBUTING.md).

The practical limit is context pressure from metadata and accidental overactivation, not merely the number of directories. Descriptions should be discriminative and avoid broad triggers such as “use for coding.”

## 19. Recommended repository architecture

For `/Users/cody/projects/AgentSkills`, use a host-neutral publication layout:

```text
AgentSkills/
├── README.md
├── LICENSE
├── AGENTS.md
├── skills/
│   ├── github-actions-failure-debugging/
│   │   ├── SKILL.md
│   │   ├── references/
│   │   └── scripts/
│   ├── documentation-writer/
│   │   ├── SKILL.md
│   │   └── assets/
│   └── skill-audit/
│       ├── SKILL.md
│       └── scripts/
├── agents/
│   └── skill-maintainer.agent.md
├── instructions/
│   └── skill-authoring.instructions.md
├── scripts/
│   ├── validate-skills.sh
│   └── audit-skill-scripts.sh
└── docs/
    ├── compatibility.md
    ├── installation.md
    └── security.md
```

Rationale:

- A root `skills/` catalog matches `github/awesome-copilot` and works naturally with `gh skill install OWNER/REPOSITORY SKILL`.
- It avoids choosing `.github`, `.claude`, `.agents`, or another host as the canonical source.
- Installers can materialize or copy skills to each host’s supported directory.
- The repository itself can dogfood selected skills by installing them at project scope rather than duplicating all source directories.
- Agents and instructions remain separate because they have different schemas and portability properties.

### 19.1 Portable frontmatter policy

Require this core:

```yaml
---
name: skill-name
description: Describe exactly what the skill does and when it should be used.
license: MIT
compatibility: Requires git 2.40+ and network access to GitHub.
metadata:
  author: organization-name
  version: "1.0.0"
---
```

Allow these cross-host extensions only when needed:

```yaml
argument-hint: "[input]"
user-invocable: true
disable-model-invocation: false
```

Treat this as security-sensitive:

```yaml
allowed-tools: Read Grep
```

Do not allow these in portable core skills:

```yaml
tools:
agents:
infer:
mcp-servers:
target:
handoffs:
```

Do not allow these without a host-specific compatibility note or overlay:

```yaml
model:
agent:
effort:
background:
paths:
shell:
hooks:
when_to_use:
arguments:
disallowed-tools:
context:
```

`context: fork` is the strongest candidate for later promotion because both VS Code Copilot and Claude Code document it, but it remains experimental in VS Code.

### 19.2 Installation strategy

Document:

```bash
# Copilot project scope, default
gh skill install OWNER/AgentSkills skill-name

# Claude Code user scope
gh skill install OWNER/AgentSkills skill-name \
  --agent claude-code \
  --scope user

# Codex project scope
gh skill install OWNER/AgentSkills skill-name \
  --agent codex \
  --scope project
```

For manual installation:

```bash
# Copilot-native project install
cp -R skills/skill-name .github/skills/

# Shared Copilot/Claude project install
cp -R skills/skill-name .claude/skills/

# Vendor-neutral Copilot-recognized project install
cp -R skills/skill-name .agents/skills/

# Personal Copilot install
cp -R skills/skill-name ~/.copilot/skills/
```

Avoid committing the same skill to all three recognized Copilot project directories because duplicate-name precedence is not documented.

### 19.3 Validation policy

CI should run:

```bash
skills-ref validate ./skills/skill-name
gh skill publish --dry-run
```

The repository should additionally validate:

- directory and `name` equality;
- character and length constraints;
- description length and trigger quality;
- referenced-file existence;
- no path traversal outside the skill;
- executable script inventory;
- shell pre-approval review;
- bundled asset size;
- license presence;
- metadata values are strings;
- broken Markdown links;
- no secrets;
- no remote unpinned executable downloads;
- no conflicting skill names;
- no unsupported frontmatter in portable core skills.

The reference validator is documented by the Agent Skills specification: [Agent Skills specification](https://agentskills.io/specification).

## 20. Recommended precedence and conflict policy

Because Copilot does not publish complete skill precedence, define repository policy independently:

1. **Canonical source:** `skills/<name>`.
2. **One name, one implementation:** no divergent variants under the same `name`.
3. **Host adaptations:** separate overlay files or installer transforms, never duplicate competing discovered skills.
4. **Personal overrides:** allowed locally but not supported or guaranteed by the repository.
5. **Upstream skills:** install under their existing name only if no local skill conflicts.
6. **Forked skills:** rename if behavior materially diverges.
7. **Agents:** follow documented Copilot user → repository → organization → enterprise precedence.
8. **Instructions:** avoid contradictions even where product precedence exists.
9. **Nested `AGENTS.md`:** use for package-specific repository guidance, not for task workflows.
10. **Pinned distribution:** release and install by immutable tag or SHA.

## 21. Actionable conclusions

1. Publish canonical skills under root `skills/`.
2. Use the open-standard fields as the portable baseline.
3. Permit `argument-hint`, `user-invocable`, and `disable-model-invocation` as optional Copilot/Claude extensions.
4. Treat `allowed-tools` as experimental and security-sensitive.
5. Keep `tools`, `agents`, `model`, MCP, and handoff configuration in custom agents rather than skills.
6. Do not use repository-local `.copilot/skills`.
7. Do not rely on undocumented skill precedence.
8. Use `gh skill` rather than a separate extension.
9. Pin third-party skills and preserve provenance.
10. Treat Awesome Copilot as a discovery source, not a trusted default dependency.
11. Reimplement the highest-value generic workflows locally instead of copying large community prompts.
12. Include a skill-authoring and skill-audit skill in the repository itself.
13. Use `.github/copilot-instructions.md` or `AGENTS.md` only for broad repository conventions.
14. Use `.instructions.md` for path-specific rules.
15. Use custom agents for isolated personas, restricted tools, model selection, and MCP.
16. Configure cloud dependencies through `copilot-setup-steps.yml`.
17. Test cloud skill behavior with committed project skills; local personal skills do not transfer to cloud sessions.
18. Keep descriptions specific to avoid unwanted activation and metadata context waste.
19. Validate every skill against the open specification in CI.
20. Publish immutable releases and encourage SHA/tag pinning.

## 22. Gaps and uncertainties

- GitHub does not document a definitive duplicate-name precedence order for skills across all recognized locations and plugin/built-in sources.
- GitHub does not publish a stable exhaustive catalog of Copilot’s built-in Agent Skills.
- GitHub does not document a hard maximum number of skills.
- GitHub does not document exact context-token allocation per activated skill beyond the open specification’s recommendations.
- The exact provenance key names written by `gh skill` should be generated and inspected from the current CLI rather than manually assumed.
- Some fields are documented only by VS Code, not by GitHub.com or Copilot CLI. Their presence in a file does not guarantee identical behavior on every Copilot surface.
- `context: fork` is experimental in VS Code.
- `github/awesome-copilot` changes rapidly; directory and catalog conclusions are based on its state at research time.
- The earlier `excludeAgent: "coding-agent"` changelog wording differs from the current documentation’s `cloud-agent` wording.
- Historical “chat mode” and prompt/collection conventions should not be assumed current without targeting a specific older VS Code version.

## Sources

- https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills
- https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills
- https://docs.github.com/en/copilot/reference/custom-agents-configuration
- https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents
- https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents
- https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli
- https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features
- https://docs.github.com/en/copilot/reference/customization-cheat-sheet
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions
- https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions
- https://docs.github.com/en/copilot/reference/custom-instructions-support
- https://docs.github.com/en/copilot/concepts/prompting/response-customization
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers
- https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
- https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions/
- https://github.blog/changelog/2025-10-28-custom-agents-for-github-copilot/
- https://github.blog/changelog/2025-10-28-github-copilot-cli-use-custom-agents-and-delegate-to-copilot-coding-agent/
- https://github.blog/changelog/2025-11-12-copilot-code-review-and-coding-agent-now-support-agent-specific-instructions/
- https://github.blog/changelog/2025-12-18-github-copilot-now-supports-agent-skills/
- https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli/
- https://cli.github.com/manual/gh_skill
- https://code.visualstudio.com/docs/agent-customization/agent-skills
- https://code.visualstudio.com/docs/agent-customization/custom-agents
- https://code.visualstudio.com/docs/agent-customization/prompt-files
- https://agentskills.io/specification
- https://github.com/agentskills/agentskills
- https://code.claude.com/docs/en/skills
- https://github.com/anthropics/skills
- https://github.com/github/awesome-copilot
- https://raw.githubusercontent.com/github/awesome-copilot/main/README.md
- https://raw.githubusercontent.com/github/awesome-copilot/main/CONTRIBUTING.md
- https://raw.githubusercontent.com/github/awesome-copilot/main/docs/README.skills.md
- https://raw.githubusercontent.com/github/awesome-copilot/main/docs/README.agents.md
- https://raw.githubusercontent.com/github/awesome-copilot/main/docs/README.instructions.md
- https://awesome-copilot.github.com/
- https://awesome-copilot.github.com/skills/
- https://awesome-copilot.github.com/llms.txt
- https://api.github.com/repos/github/awesome-copilot/contents
- https://api.github.com/repos/github/awesome-copilot/contents/skills
- https://github.com/github/awesome-copilot/blob/main/skills/documentation-writer/SKILL.md
- https://github.com/github/awesome-copilot/blob/main/skills/prd/SKILL.md
- https://github.com/github/awesome-copilot/blob/main/docs/README.skills.md
- https://github.com/github/awesome-copilot/blob/main/docs/README.agents.md
- https://github.com/github/awesome-copilot/blob/main/docs/README.instructions.md

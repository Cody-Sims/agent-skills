# Runtime Compatibility

This matrix records where each runtime discovers skills, which frontmatter it
honors, and how skills are invoked. It is derived from the research reports in
`docs/research/`; consult `codex-portability.md` and `copilot-skills.md` for
citations and detail.

## Runtime matrix

| Runtime | Native skills | Project paths | User paths | Format | Frontmatter honored | Invocation |
|---|---|---|---|---|---|---|
| OpenAI Codex | Yes | `.agents/skills` | `~/.agents/skills`; admin `/etc/codex/skills` | `SKILL.md`; optional `agents/openai.yaml` | `name`, `description`, `metadata.short-description` | `$skill-name`, `/skills`, implicit; follows symlinks |
| Claude Code | Yes | `.claude/skills` (incl. nested); plugins | `~/.claude/skills`; managed enterprise | `SKILL.md` | Standard fields plus extensive Claude-only controls | `/skill-name`, implicit, plugins |
| GitHub Copilot | Yes | `.github/skills`, `.claude/skills`, `.agents/skills` | `~/.copilot/skills`, `~/.agents/skills` | `SKILL.md` | `name`, `description`, `license`, `allowed-tools` | Automatic, `/skill-name`, `/skills` CLI |
| Cursor | Yes | `.agents/skills`, `.cursor/skills`; compat `.claude/skills`, `.codex/skills` | `~/.agents/skills`, `~/.cursor/skills` | `SKILL.md`; `.cursor/rules/*.mdc` for rules | `name`, `description`, `paths`, `disable-model-invocation`, `metadata` | Native skills, slash invocation, nested discovery |
| Windsurf / Devin Desktop | Yes | `.windsurf/skills`, `.agents/skills` | `~/.codeium/windsurf/skills`, `~/.agents/skills` | `SKILL.md` | `name`, `description` | Automatic or `@skill-name` |
| Gemini CLI | Yes | `.gemini/skills`, `.agents/skills` | `~/.gemini/skills`, `~/.agents/skills` | `SKILL.md` | Agent Skills standard | `activate_skill`, consent prompt, `/skills` |
| OpenCode | Yes | `.opencode/skills`, `.claude/skills`, `.agents/skills` | `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` | `SKILL.md` | `name`, `description`, `license`, `compatibility`, `metadata`; unknown fields ignored | Native `skill` tool; permission controls |
| Amp | Yes | `.agents/skills`, `.claude/skills`, plugin paths | `~/.config/agents/skills`, `~/.agents/skills`, `~/.config/amp/skills`, `~/.claude/skills` | `SKILL.md`; optional `mcp.json` | `name`, `description` | Built-in skills; can gate MCP tools on activation |
| Cline | Yes | `.cline/skills`, `.clinerules/skills`, `.claude/skills` | `~/.cline/skills` | `SKILL.md` | `name`, `description` | Automatic and `/skill-name` |
| Roo Code | Yes | `.roo/skills`, `.agents/skills`, mode variants | `~/.roo/skills`, `~/.agents/skills`, mode variants | `SKILL.md` | `name`, `description` | Automatic; symlinks; mode targeting |
| AGENTS.md-only fallback | Varies | Root/nested `AGENTS.md` | Runtime-specific | Plain Markdown | No schema | `AGENTS.md` as a router; no progressive disclosure |

Sources: `docs/research/codex-portability.md` (runtime compatibility matrix),
`docs/research/copilot-skills.md` (section 3), `docs/research/anthropic-spec.md`
(section 11).

Registry discovery metadata uses the canonical runtime IDs `openai-codex`,
`claude-code`, and `github-copilot`. Compatibility status is `compatible`,
`conditional`, `unsupported`, or `untested`; a conditional status requires a
concrete note. See [`registry-discovery.md`](registry-discovery.md).

## Frontmatter field portability

Fields fall into three classes for this repository. Only portable-core and the
listed safe extensions may appear in a canonical `SKILL.md`; runtime-specific
fields are forbidden and rejected by the validator's portable profile.

### Portable-core (open standard)

| Field | Notes |
|---|---|
| `name` | Required. Honored everywhere. |
| `description` | Required. Honored everywhere; the routing interface. |
| `license` | Standard metadata; accepted by all conforming hosts. |
| `compatibility` | Standard metadata; use only for genuine environment requirements. |
| `metadata` | String-valued map; carries `version`, `author`, `tier`, and provenance. |

### Safe extensions (host UX; ignored by strict validators)

| Field | Honored by | Notes |
|---|---|---|
| `user-invocable` | Copilot VS Code, Claude Code | Exposes an explicit slash command. |
| `disable-model-invocation` | Copilot VS Code, Claude Code | Prevents autonomous activation; use for destructive or expensive workflows. |
| `argument-hint` | Copilot VS Code, Claude Code | Placeholder text after the slash command. |

These are ignored, not rejected, by hosts that do not support them, so they are
safe to include. Use them only when the skill genuinely needs manual invocation
or argument hints.

### Runtime-specific (forbidden here)

`allowed-tools` is experimental in the open standard and is not a portable
security boundary; this repository does not use it (see `SECURITY.md`). The
following are single-runtime fields and must not appear in a canonical skill:
`when_to_use`, `arguments`, `disallowed-tools`, `model`, `effort`, `context`,
`agent`, `agents`, `background`, `hooks`, `paths`, `shell`, `tools`, `infer`,
and Cursor rule fields such as `globs` and `alwaysApply`. Put runtime-specific
metadata in a companion file (for example, Codex's `agents/openai.yaml`) or
generate a runtime-specific copy at install time. Source:
`docs/research/copilot-skills.md` (section 5.3),
`docs/research/anthropic-spec.md` (section 1).

## Vendor-neutral path versus per-runtime paths

`.agents/skills` (project) and `~/.agents/skills` (user) are the vendor-neutral
locations discovered by Codex, Copilot, Cursor, Gemini CLI, Windsurf, OpenCode,
Amp, and Roo Code. Prefer them for the broadest reach with a single copy.

Claude Code does not read `.agents/skills`. It requires `.claude/skills`
(project) or `~/.claude/skills` (user). Copilot also reads `.github/skills` and
`.claude/skills`, so a `.claude/skills` copy serves both Copilot and Claude
Code.

Recommended strategy: keep the canonical source under `skills/`, and let
`npm run install:agents` or `gh skill` generate the per-runtime copies
(`.agents/skills`, `.claude/skills`, `.github/skills`, and the user-scope
equivalents) rather than hand-maintaining duplicate trees, which drift. Source:
`docs/research/codex-portability.md` (executive summary),
`docs/research/anthropic-spec.md` (executive conclusions).

## Runtime smoke coverage

`npm run runtime:smoke` runs the public, deterministic adapter matrix for Claude
Code, GitHub Copilot, and OpenAI Codex. It uses throwaway project and home roots.
For every runtime it verifies the documented project install path, discovery,
explicit invocation syntax, a referenced resource, and supported host-extension
metadata. The fixture lives under `tests/fixtures/runtime-smoke/`; it is not a
catalog entry and does not affect the generated registry.

The public adapters exercise the complete protocol and filesystem matrix without
claiming that a licensed or hosted product ran. Real host execution requires an
explicit adapter command. An unconfigured or unavailable host is recorded as
`skip` with a reason, never as `pass`. See [`runtime-smoke.md`](runtime-smoke.md)
for the adapter contract and hosted-test boundary.

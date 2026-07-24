# Agent Skills Repository Tooling, Validation, CI, Packaging, Versioning, Installation, Security, and Testing Research

## Executive conclusions

The new repository should use Node.js 22, npm, and plain JavaScript modules under `scripts/`, matching the existing Pokemon-Web tooling style. The core should be a repository-owned validator rather than relying exclusively on an external validator: the official `skills-ref` validator is useful as a compatibility cross-check, but its repository explicitly describes it as a demonstration library rather than production tooling.

The recommended design has five layers:

1. **Strict structural validation** of every `SKILL.md`.
2. **Repository policy validation** for links, sizes, licenses, Unicode, permissions, and security.
3. **Safe multi-host installation** using manifests and content-hash receipts generalized from Pokemon-Web.
4. **Deterministic CI and release packaging** with pinned dependencies and immutable artifacts.
5. **Skill evals** covering positive and negative trigger prompts plus behavioral expectations.

The portable Agent Skills specification requires `name` and `description`; allows `license`, `compatibility`, `metadata`, and `allowed-tools`; recommends fewer than 500 lines and approximately 5,000 tokens in the activated instructions; and requires relative resource references. GitHub Copilot additionally documents `argument-hint`, `user-invocable`, `disable-model-invocation`, and experimental `context`. The proposed schema below is a strict superset of these fields.

The strongest open-source security automation found is Cisco’s `skill-scanner`, which combines static patterns, YARA rules, command-pipeline analysis, behavioral dataflow, optional LLM review, SARIF output, and CI integration. It is still explicitly best-effort and does not replace human review.

---

## 1. Format and portability baseline

### 1.1 Canonical structure

The Agent Skills specification defines a skill as a directory containing at least `SKILL.md`, with optional `scripts/`, `references/`, and `assets/` directories:

```text
skills/
└── example-skill/
    ├── SKILL.md
    ├── scripts/
    ├── references/
    └── assets/
```

The specification requires YAML frontmatter followed by Markdown content. The required fields are:

- `name`
- `description`

Portable optional fields are:

- `license`
- `compatibility`
- `metadata`
- `allowed-tools`

The official specification recommends:

- `name`: 1–64 characters.
- ASCII lowercase letters, digits, and hyphens.
- No leading, trailing, or consecutive hyphens.
- Name must match the parent directory.
- `description`: 1–1024 characters.
- Description should state both what the skill does and when to use it.
- `compatibility`: at most 500 characters.
- Main `SKILL.md`: under 500 lines.
- Activated instructions: under approximately 5,000 tokens.
- Relative file references rooted at the skill directory.
- Shallow reference chains rather than deeply nested disclosure.

Source: [Agent Skills specification](https://agentskills.io/specification).

### 1.2 Host discovery locations

| Host | Repository/project locations | User locations | Notes |
|---|---|---|---|
| GitHub Copilot | `.github/skills/`, `.claude/skills/`, `.agents/skills/` | `~/.copilot/skills/`, `~/.agents/skills/` | GitHub documents all three project locations. |
| VS Code Copilot | `.github/skills/`, `.claude/skills/`, `.agents/skills/` | `~/.copilot/skills/`, `~/.claude/skills/`, `~/.agents/skills/` | Additional paths can be configured through VS Code settings. |
| Claude Code | Plugin-provided skills or `.claude/skills/` | `~/.claude/skills/` | Plugin installation normally copies the plugin into Claude’s cache. |
| Codex | `.agents/skills/` from current directory through repository root | `~/.agents/skills/` | Current OpenAI documentation does **not** identify `~/.codex/skills/` as the preferred user skill directory. `~/.codex/config.toml` controls enable/disable state. |
| Codex admin | N/A | `/etc/codex/skills/` | Machine/container-wide managed skills. |

Sources:

- [GitHub: Adding agent skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)
- [VS Code: Use Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills)
- [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills)

### 1.3 Important Codex path correction

A generalized installer should not silently treat `~/.codex/skills/` as the current canonical Codex destination. Current OpenAI documentation lists:

- Repository skills: `.agents/skills/`
- User skills: `$HOME/.agents/skills/`
- Admin skills: `/etc/codex/skills/`
- Codex configuration: `~/.codex/config.toml`

Therefore the default Codex adapter should install to `~/.agents/skills/`. A `~/.codex/skills/` adapter may be offered only as an explicit legacy or custom target.

---

## 2. Existing open-source validators and linters

## 2.1 Official `skills-ref` reference validator

**Repository/path**

- `agentskills/agentskills:skills-ref/src/skills_ref/validator.py`
- Validator source: <https://github.com/agentskills/agentskills/blob/main/skills-ref/src/skills_ref/validator.py>
- Reference package: <https://github.com/agentskills/agentskills/tree/main/skills-ref>

**Command**

```bash
skills-ref validate ./skills/example-skill
```

**Checks implemented**

- Input exists and is a directory.
- `SKILL.md` exists.
- Frontmatter parses successfully.
- Unknown top-level frontmatter fields are rejected.
- Required `name` exists and is a non-empty string.
- Required `description` exists and is a non-empty string.
- `name` maximum is 64 characters.
- `name` is lowercase.
- No leading or trailing hyphen.
- No consecutive hyphens.
- Name characters must be alphanumeric or hyphen.
- Normalized name must match normalized directory name.
- Description maximum is 1024 characters.
- Compatibility must be a string and at most 500 characters.
- Allowed fields are:
  - `name`
  - `description`
  - `license`
  - `allowed-tools`
  - `metadata`
  - `compatibility`

Relevant implementation: `agentskills/agentskills:skills-ref/src/skills_ref/validator.py:10-123`.

**Important limitation**

The `skills-ref` README states that the library is intended for demonstration purposes and is not meant for production. It is still valuable as an independent compatibility check in CI, but it should not be the sole repository gate.

**Specification discrepancy**

The published specification says `name` uses ASCII `a-z`, `0-9`, and hyphens. The Python implementation normalizes with NFKC and uses `str.isalnum()`, which accepts many Unicode letters and digits. For maximum portability across Copilot, Claude, and Codex, the new repository should enforce the stricter ASCII pattern:

```regex
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

## 2.2 GitHub Awesome Copilot validator

**Repository/path**

- `github/awesome-copilot:eng/validate-skills.mjs`
- <https://github.com/github/awesome-copilot/blob/main/eng/validate-skills.mjs>
- Constants: `github/awesome-copilot:eng/constants.mjs`
- <https://github.com/github/awesome-copilot/blob/main/eng/constants.mjs>

**Checks implemented**

- `skills/` exists or validation is skipped.
- Every direct child skill directory has `SKILL.md`.
- Frontmatter parses through the repository YAML parser.
- `name` is present and a string.
- `name` contains only lowercase letters, digits, and hyphens.
- `name` length is 1–64.
- `name` matches the folder name.
- `description` is present and a string.
- Description length is 10–1024.
- Bundled assets identified by its metadata parser are accessible.
- Each bundled asset is no larger than 5 MB.
- Duplicate skill names are rejected.

Relevant implementation: `github/awesome-copilot:eng/validate-skills.mjs:14-132`; limits are in `github/awesome-copilot:eng/constants.mjs`.

**CI**

Awesome Copilot now also uses Microsoft’s `@microsoft/vally-cli` in a pull-request gate:

- `github/awesome-copilot:.github/workflows/skill-check.yml`
- <https://github.com/github/awesome-copilot/blob/main/.github/workflows/skill-check.yml>

That workflow:

- Detects changed top-level and plugin-contained skill directories.
- Runs Vally only against changed skills.
- Captures verbose output.
- Uploads a short-lived result artifact.
- Uses read-only repository permissions.
- Pins GitHub Actions to commit SHAs.

A nightly report runs Vally over all skills:

- `github/awesome-copilot:.github/workflows/skill-quality-report.yml`
- <https://github.com/github/awesome-copilot/blob/main/.github/workflows/skill-quality-report.yml>

**Security-oriented static scan**

Awesome Copilot also has:

- `github/awesome-copilot:eng/pr-risk-scan.mjs`
- <https://github.com/github/awesome-copilot/blob/main/eng/pr-risk-scan.mjs>

It detects:

- Guardrail-bypass language.
- `curl`/`wget` piped directly into a shell.
- Auto-consent package execution such as `npx -y`.
- Dynamic package executors such as `npx`, `pnpm dlx`, `uvx`, and `pipx run`.
- Floating or broad dependency versions.
- Script files changed under skill directories.
- Unsafe changed-file paths.
- Symlinks and files larger than 1 MB are skipped rather than followed/read.

It produces JSON and Markdown reports and treats findings as review targets rather than proof of maliciousness.

## 2.3 Addy Osmani Agent Skills linter

**Repository/path**

- `addyosmani/agent-skills:scripts/lib/skill-lint.js`
- <https://github.com/addyosmani/agent-skills/blob/main/scripts/lib/skill-lint.js>
- CLI wrapper:
  `addyosmani/agent-skills:scripts/validate-skills.js`
- <https://github.com/addyosmani/agent-skills/blob/main/scripts/validate-skills.js>

**Checks implemented**

Errors:

- Every skill directory contains `SKILL.md`.
- Frontmatter is present.
- Required `name` and `description` fields exist.
- `name` matches directory name.
- Directory name is lowercase kebab-case.
- Description does not exceed 1024 characters.
- Description contains a positive “when to use” trigger.
- Negated-only wording such as “do not use when” does not satisfy the trigger requirement.
- Required repository-specific sections are present:
  - `## Overview`
  - `## When to Use`
  - `## Common Rationalizations`
  - `## Red Flags`
  - `## Verification`
- Section exemptions are maintained in validator code rather than contributor-controlled frontmatter.
- Unauthorized attempts to self-declare a section exemption are rejected.

Warnings:

- Explicit cross-skill references are checked against known skill names.
- Unknown referenced skills produce dead-reference warnings.

The implementation strips fenced code blocks before matching headings and cross-skill prose, preventing examples from accidentally satisfying policy rules.

**Limitations**

- Its parser is line-oriented rather than a complete YAML parser.
- The required sections are specific to that repository and should not become universal requirements.
- It checks cross-skill semantic references but not general Markdown links.
- It does not perform deep security scanning.

## 2.4 Jezweb Claude Skills linter

**Repository/path**

- `jezweb/claude-skills:bin/skill-lint`
- <https://github.com/jezweb/claude-skills/blob/main/bin/skill-lint>
- CI:
  `jezweb/claude-skills:.github/workflows/skill-lint.yml`
- <https://github.com/jezweb/claude-skills/blob/main/.github/workflows/skill-lint.yml>

**Checks implemented**

- `SKILL.md` exists and is non-empty.
- First line is an opening `---`.
- Frontmatter has a closing `---`.
- `name` exists and is non-empty.
- Name/directory mismatch is warned.
- `description` exists and is non-empty.
- Basic multiline description presence.
- Maximum 500 lines.
- Body exists after frontmatter.
- References matching `./references/` and `./assets/` exist.
- Unexpected top-level files are warned.
- Non-standard subdirectories are warned.

**CI pattern**

The workflow:

- Runs only when skill files or the linter change.
- Computes changed skill directories from the pull-request diff.
- Runs the linter only against those directories.

**Limitations**

- Frontmatter is parsed with shell text processing rather than a YAML parser.
- It recognizes only a limited set of reference syntaxes.
- It warns rather than errors on name/directory mismatch.
- It does not check unknown fields, duplicate names, secrets, Unicode controls, or executable modes.

## 2.5 Anthropic Skills repository

**Repository**

- <https://github.com/anthropics/skills>

The repository contains:

- `.claude-plugin/marketplace.json`
- `skills/`
- `spec/`
- `template/`

The current `spec/agent-skills-spec.md` is only a short redirect/reference rather than a validator implementation. No repository-owned general `SKILL.md` validator was found at the root. The canonical validation recommendation now points to the Agent Skills `skills-ref` project.

Anthropic’s repository therefore provides examples, templates, and skill-creator tooling, but it should not be treated as containing a complete production validator.

## 2.6 Obra Superpowers

**Repository**

- <https://github.com/obra/superpowers>

No general `SKILL.md` structural validator was found in the repository’s current top-level scripts. Relevant tooling instead includes:

- Shell script linting.
- Version synchronization.
- Packaging and Codex plugin synchronization.
- Host-specific integration tests.
- Explicit-skill-request tests.
- Multi-turn skill tests.

The repository is particularly useful as prior art for behavioral testing and synchronized versioning rather than frontmatter validation.

## 2.7 Cisco AI Defense Skill Scanner

**Repository**

- <https://github.com/cisco-ai-defense/skill-scanner>

**Purpose**

A best-effort security scanner for Agent Skills.

**Detection layers**

- Static YAML/YARA pattern matching.
- Python bytecode integrity checks.
- Shell pipeline command analysis.
- Python AST behavioral/dataflow analysis.
- Optional LLM semantic analysis.
- Optional meta-analysis to reduce false positives.
- Optional VirusTotal hash scanning.
- Optional Cisco AI Defense scanning.
- Trigger-description analysis.
- Cross-skill overlap detection.

**Threats covered**

- Prompt injection.
- Guardrail bypass attempts.
- Data exfiltration.
- Credential access or exposure.
- Malicious command patterns.
- Suspicious downloads.
- Dynamic execution.
- Excessive tool permissions.
- Reverse shells and malware-like patterns.
- Trigger overlap and vague descriptions.

**CI support**

- Recursive scans.
- SARIF output.
- GitHub Code Scanning upload.
- Configurable severity threshold.
- Reusable GitHub Actions workflow.
- Pre-commit integration.
- Custom policy files.
- Custom YARA rules.

Example:

```bash
skill-scanner scan-all ./skills \
  --recursive \
  --check-overlap \
  --policy strict \
  --fail-on-severity high
```

**Limitation**

The project explicitly states:

- No findings do not guarantee safety.
- Coverage is incomplete.
- False positives and false negatives can occur.
- Human review remains necessary.

## 2.8 Validator comparison

| Validator | Real YAML parser | Name constraints | Directory match | Description limits | Unknown fields | Link existence | Duplicate names | Size limits | Security |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `skills-ref` | Yes | Yes | Yes | Yes | Yes | No | No | No | No |
| Awesome Copilot `validate-skills.mjs` | Yes | Yes | Yes | Yes | Not visibly enforced there | Asset access only | Yes | 5 MB assets | Separate risk scanner |
| Addyosmani `skill-lint.js` | Partial/custom | Yes | Yes | Yes | No | Cross-skill refs only | No | No | Limited bypass protection |
| Jezweb `bin/skill-lint` | No | Limited | Warning | Presence only | No | Limited local refs | No | 500 lines | No |
| Pokemon-Web validator | Partial/regex | Yes | Yes | Presence | No | Manifest sources | Per scope | No | No |
| Cisco Skill Scanner | Format-aware | Some | Some | Trigger analysis | Not its main role | Indirect | Cross-skill overlap | Binary/file handling | Extensive |

---

## 3. Proposed validator policy

The validator should produce machine-readable diagnostics with stable rule IDs:

```json
{
  "version": 1,
  "ok": false,
  "diagnostics": [
    {
      "rule": "frontmatter/name-directory-match",
      "severity": "error",
      "file": "skills/example/SKILL.md",
      "line": 2,
      "message": "Frontmatter name must match directory name \"example\"."
    }
  ]
}
```

Recommended command surface:

```bash
node scripts/validate-skills.mjs
node scripts/validate-skills.mjs --changed
node scripts/validate-skills.mjs --format json
node scripts/validate-skills.mjs --profile portable
node scripts/validate-skills.mjs --profile repository
```

- `portable`: only fields in the open Agent Skills specification.
- `repository`: the proposed Anthropic/Copilot superset.
- `--changed`: useful locally, but full validation should still run in protected-branch CI.
- Exit code `0`: no errors.
- Exit code `1`: validation errors.
- Warnings should not become errors silently; use a repository configuration file if warnings are promoted.

---

## 4. Concrete validator checklist

## 4.1 MUST checks

### Discovery and file structure

- [ ] Every direct child of `skills/` intended as a skill contains exactly one case-sensitive `SKILL.md`.
- [ ] Reject `skill.md`, `Skill.md`, or other casing.
- [ ] `SKILL.md` is a regular file, not a symlink, device, FIFO, or socket.
- [ ] No symlink exists anywhere inside a published skill tree unless the repository explicitly adopts and safely validates a symlink policy.
- [ ] Reject symlinks that escape the skill root.
- [ ] Reject Git submodules/gitlinks and Git LFS pointer files unless explicitly approved.
- [ ] Reject unreadable files.
- [ ] Reject duplicate normalized relative paths or case-folding collisions such as `Reference.md` and `reference.md`.

### Frontmatter syntax

- [ ] File begins byte-for-byte with `---` followed by LF or CRLF; reject a UTF-8 BOM.
- [ ] Closing `---` exists.
- [ ] Frontmatter parses with a real YAML parser.
- [ ] Parsed frontmatter is a mapping/object, not a scalar or sequence.
- [ ] Reject duplicate YAML keys.
- [ ] Reject unsafe custom YAML tags.
- [ ] Reject aliases/anchors if the parser cannot place safe complexity limits on them.
- [ ] Reject non-string map keys.
- [ ] Reject extra YAML documents.
- [ ] Require non-empty Markdown body after frontmatter.

### Required fields

- [ ] `name` is required.
- [ ] `description` is required.
- [ ] Both are strings.
- [ ] Both are non-empty after trimming.

### Name policy

- [ ] Length is 1–64 characters.
- [ ] Pattern is:

```regex
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

- [ ] No uppercase letters.
- [ ] No underscores, spaces, dots, slashes, colons, or namespace prefixes.
- [ ] No leading or trailing hyphen.
- [ ] No consecutive hyphens.
- [ ] `name` exactly matches the parent directory.
- [ ] Names are unique across the complete bundle.
- [ ] Optionally reject case-insensitive collisions even though valid names are lowercase.
- [ ] Reject reserved names maintained in repository configuration.

### Description policy

- [ ] Length is 1–1024 Unicode code points.
- [ ] Description is a single scalar after YAML parsing.
- [ ] Description describes what the skill does.
- [ ] Description states when it should be used.
- [ ] Reject a description that only states exclusions, such as “Do not use when…”.
- [ ] Reject obvious placeholders such as `TODO`, `TBD`, `example description`, or `description here`.

A robust trigger test should accept equivalent phrasing rather than requiring only the literal phrase `Use when`. The literal phrase is a strong convention, but valid alternatives include:

- “Use for…”
- “Applies when…”
- “Runs when…”
- “Handles requests involving…”

### Allowed and unknown fields

For the repository profile, allow exactly:

- `name`
- `description`
- `license`
- `compatibility`
- `metadata`
- `allowed-tools`
- `argument-hint`
- `user-invocable`
- `disable-model-invocation`
- `context`

- [ ] Reject unknown top-level fields.
- [ ] Require experimental or vendor-specific additions to be placed under `metadata`.
- [ ] Validate each allowed field’s type.
- [ ] Do not silently ignore misspellings such as `descripton`.

### Relative references and path safety

- [ ] Resolve Markdown links to local files relative to the skill root.
- [ ] Resolve autolinks or repository-supported resource syntax.
- [ ] Strip URL fragments and query strings before local path resolution.
- [ ] Percent-decode paths safely before checking traversal.
- [ ] Reject local references that escape the skill root through `..`.
- [ ] Reject absolute POSIX paths in local links.
- [ ] Reject Windows drive and UNC paths in local links.
- [ ] Permit web URLs such as `https://…`.
- [ ] Verify every local reference exists with the expected case.
- [ ] Verify referenced directories are intentional.
- [ ] Validate references from `SKILL.md` and optionally recursively from files under `references/`.
- [ ] Detect reference cycles or excessive reference depth.
- [ ] Reject references through escaping symlinks.

### Duplicate skill names

- [ ] Detect duplicates across every source root included in the bundle.
- [ ] Detect collisions between aliases/materialized host layouts.
- [ ] Detect collisions between workspace and global resources if the installer can install both.
- [ ] Produce a diagnostic listing every colliding path.

### License

- [ ] Every distributable skill has a valid `license` field or inherits an explicitly documented repository-wide license.
- [ ] If `license` names a bundled file, verify the file exists.
- [ ] Third-party or differently licensed skills must include their applicable license and attribution.
- [ ] Reject skills whose license is missing or incompatible with redistribution policy.
- [ ] Include third-party notices in release artifacts.

The open specification makes `license` optional, but a redistributable public repository should make license coverage a repository policy requirement.

### Secrets

- [ ] Reject verified credentials, private keys, access tokens, passwords, and high-confidence secrets.
- [ ] Scan `SKILL.md`, scripts, references, assets that are text, manifests, fixtures, and tests.
- [ ] Maintain narrow allowlists for documented fake examples.
- [ ] Never print a full detected secret in CI output.
- [ ] Enable GitHub secret scanning and push protection where available.
- [ ] Treat secret scanning as one layer, not proof of safety.

### Absolute paths

- [ ] Manifest sources and destinations must be relative.
- [ ] Installer destinations must remain under the selected managed root.
- [ ] Local resource links must not be absolute.
- [ ] Flag hard-coded home directories and repository-specific absolute paths in instructions or scripts.
- [ ] Permit absolute paths only in clearly marked explanatory examples when allowlisted.

### Unsafe Unicode

- [ ] Reject bidirectional formatting and isolate controls:
  - U+202A–U+202E
  - U+2066–U+2069
- [ ] Reject zero-width space U+200B.
- [ ] Reject zero-width non-joiner U+200C and joiner U+200D unless an allowlist justifies natural-language usage.
- [ ] Reject word joiner U+2060 and invisible separator U+2063 unless explicitly allowed.
- [ ] Reject unexpected C0/C1 control characters other than tab, LF, and CR.
- [ ] Reject Unicode noncharacters.
- [ ] Reject embedded NUL.
- [ ] Reject a UTF-8 BOM.
- [ ] Warn on suspicious mixed-script identifiers and confusables.
- [ ] Report code point and location without reproducing dangerous controls invisibly.

### Script permissions and executable bits

- [ ] Enumerate all files under `scripts/` and all script-like files referenced by the skill.
- [ ] A script instructed to run as `./scripts/name.sh` must have a shebang and Git mode `100755`.
- [ ] Scripts intended to run through an interpreter, such as `node scripts/name.mjs`, may remain `100644`; repository policy should be consistent.
- [ ] Markdown, JSON, YAML, images, schemas, and reference files must not be executable.
- [ ] Reject executable files with unknown or binary content unless explicitly approved.
- [ ] Check Git index mode using `git ls-files --stage`, not only host filesystem permissions.
- [ ] Reject setuid/setgid expectations or permission-changing setup instructions.

### File sizes and token budgets

- [ ] Reject individual text files above a configured hard byte limit.
- [ ] Reject individual binary assets above a configured hard asset limit.
- [ ] Reject a total skill tree above a configured bundle limit.
- [ ] Reject `SKILL.md` above 500 lines unless explicitly exempted by repository policy.
- [ ] Enforce a hard activated-instruction token ceiling.
- [ ] Do not count frontmatter alone as the entire token budget.
- [ ] Use a documented tokenizer or conservative approximation.

Recommended defaults:

| Limit | Warning | Error |
|---|---:|---:|
| `SKILL.md` lines | 400 | 500 |
| `SKILL.md` approximate tokens | 4,000 | 5,000 |
| `SKILL.md` bytes | 64 KiB | 100 KiB |
| Individual reference text | 128 KiB | 256 KiB |
| Individual asset | 2 MiB | 5 MiB |
| Complete skill tree | 5 MiB | 10 MiB |
| Reference depth | 1 level | 3 levels |

The 500-line and approximately 5,000-token guidance comes from the Agent Skills specification. The 5 MB asset precedent comes from Awesome Copilot.

## 4.2 SHOULD checks

### Description quality

- [ ] Prefer third-person present-tense or neutral noun-phrase wording.
- [ ] Include concrete task vocabulary users are likely to type.
- [ ] Include both positive scope and meaningful boundaries.
- [ ] Avoid first-person claims such as “I can…”.
- [ ] Avoid addressing the agent as “you” in the description.
- [ ] Avoid broad descriptions such as “Helps with coding.”
- [ ] Warn when two descriptions are highly similar.
- [ ] Require positive and negative trigger eval prompts.

Third-person phrasing should normally be a warning rather than a hard portability error. The specification requires what-and-when semantics, not one exact grammatical construction.

Good:

```yaml
description: Reviews third-party agent skills for provenance, permissions, prompt injection, and supply-chain risk. Use before installing or updating an external skill.
```

Weak:

```yaml
description: Helps with skills.
```

### Markdown and content quality

- [ ] Run Markdown linting.
- [ ] Require a first-level title after frontmatter.
- [ ] Ensure heading levels do not skip unexpectedly.
- [ ] Reject malformed fenced code blocks.
- [ ] Validate language identifiers where practical.
- [ ] Check spelling with repository dictionaries.
- [ ] Check duplicate headings.
- [ ] Warn on bare URLs where descriptive links are preferable.
- [ ] Warn on very long lines outside tables or URLs.

### Dependency and command safety

- [ ] Warn on `curl | sh` and equivalent remote-to-shell pipelines.
- [ ] Warn on `npx -y`, `uvx`, `pipx run`, and other dynamic package execution.
- [ ] Require exact dependency versions and lockfiles.
- [ ] Reject `latest`, `*`, broad caret/tilde ranges, or unbounded lower constraints in executable setup instructions.
- [ ] Warn on network downloads without checksums or signatures.
- [ ] Warn on package-manager install instructions embedded in a skill.
- [ ] Require declared compatibility for external runtimes or network access.

### Tool permissions

- [ ] Treat `allowed-tools` as security-sensitive.
- [ ] Warn on shell/bash preapproval.
- [ ] Reject wildcard tool grants unless justified.
- [ ] Require least privilege.
- [ ] Require manual-only invocation for high-risk review or deployment skills when appropriate.
- [ ] Detect contradictions between declared tools and actual instructions.

### Repository hygiene

- [ ] Reject `.DS_Store`, editor swap files, caches, coverage output, and generated temporary files.
- [ ] Reject vendored package directories such as `node_modules/`.
- [ ] Reject unreviewable archives or binaries.
- [ ] Require source for generated executable artifacts.
- [ ] Verify line endings and UTF-8 encoding.

## 4.3 NICE-TO-HAVE checks

- [ ] Detect skill-description collisions using TF-IDF or embeddings.
- [ ] Suggest likely missing trigger terms.
- [ ] Estimate metadata startup-token impact across the entire catalog.
- [ ] Generate SARIF for GitHub annotations.
- [ ] Offer safe auto-fixes for quoting, trailing whitespace, or normalized line endings.
- [ ] Generate a machine-readable skill catalog.
- [ ] Verify changelog entries for changed skills.
- [ ] Require CODEOWNERS review for scripts and security-sensitive fields.
- [ ] Compare behavior against the previous release.
- [ ] Generate SPDX or CycloneDX inventory data for scripts and dependencies.
- [ ] Produce reproducible package manifests and checksums.
- [ ] Check that every skill has an eval case.
- [ ] Track historical trigger precision and behavioral pass rates.

---

## 5. Proposed JSON Schema for `SKILL.md` frontmatter

This schema is intended to validate the parsed YAML frontmatter object, not the Markdown body. It is a strict repository profile that combines the open Agent Skills fields with documented Copilot/VS Code invocation fields.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.invalid/schemas/skill-frontmatter.schema.json",
  "title": "Agent Skill SKILL.md Frontmatter",
  "description": "Strict portable-plus-host frontmatter for Agent Skills.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "name",
    "description"
  ],
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64,
      "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      "description": "Portable skill identifier. Must also match the parent directory name."
    },
    "description": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1024,
      "pattern": ".*\\S.*",
      "description": "Describes what the skill does and when it should be used."
    },
    "license": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256,
      "pattern": ".*\\S.*",
      "description": "SPDX identifier, short license statement, or relative reference to a bundled license file."
    },
    "compatibility": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500,
      "pattern": ".*\\S.*",
      "description": "Environment, host, runtime, package, or network requirements."
    },
    "metadata": {
      "type": "object",
      "description": "Vendor- or repository-specific string metadata.",
      "propertyNames": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128,
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$"
      },
      "additionalProperties": {
        "type": "string",
        "maxLength": 1024
      }
    },
    "allowed-tools": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048,
      "pattern": "^[^\\r\\n]+$",
      "description": "Experimental space-separated preapproved tool declaration."
    },
    "argument-hint": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200,
      "pattern": "^[^\\r\\n]+$",
      "description": "Hint shown for explicit slash-command invocation."
    },
    "user-invocable": {
      "type": "boolean",
      "default": true,
      "description": "Whether the skill appears for explicit user invocation."
    },
    "disable-model-invocation": {
      "type": "boolean",
      "default": false,
      "description": "Whether automatic model invocation is disabled."
    },
    "context": {
      "type": "string",
      "enum": [
        "inline",
        "fork"
      ],
      "default": "inline",
      "description": "Host-specific loading context. Fork is experimental."
    }
  }
}
```

### 5.1 Checks that must remain outside JSON Schema

JSON Schema cannot reliably validate:

- The file has YAML frontmatter delimiters.
- YAML duplicate keys.
- Name matches parent directory.
- Duplicate names across skills.
- Description genuinely explains what and when.
- Third-person phrasing.
- License-file existence.
- Relative-link existence.
- Path traversal or symlink escapes.
- Token count.
- Unicode controls in the Markdown body.
- Secrets.
- Script executable bits.
- Cross-skill description collisions.
- Prompt-injection patterns.

These must be implemented as repository validator rules.

### 5.2 Portable versus repository profile

For strict open-standard validation, allow only:

```json
[
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools"
]
```

For the repository’s host-compatible profile, additionally allow:

```json
[
  "argument-hint",
  "user-invocable",
  "disable-model-invocation",
  "context"
]
```

The validator should clearly report when a skill passes repository validation but uses host-specific fields that may not be portable everywhere.

---

## 6. Exact Pokemon-Web global-agent-toolkit implementation

## 6.1 Files and package commands

Source bundle:

- `/Users/cody/projects/Pokemon-Web/.github/global-agent-toolkit/manifest.json`
- `/Users/cody/projects/Pokemon-Web/.github/global-agent-toolkit/README.md`
- `/Users/cody/projects/Pokemon-Web/.github/global-agent-toolkit/agents/`
- `/Users/cody/projects/Pokemon-Web/.github/global-agent-toolkit/skills/`

Manager:

- `/Users/cody/projects/Pokemon-Web/scripts/manage-global-agent-toolkit.mjs`

Structural validator:

- `/Users/cody/projects/Pokemon-Web/scripts/validate-agent-workflows.mjs`

Unit tests:

- `/Users/cody/projects/Pokemon-Web/tests/unit/scripts/manage-global-agent-toolkit.test.ts`

Package scripts:

```json
{
  "agent:validate": "node scripts/validate-agent-workflows.mjs && node scripts/validate-shadow-architecture.mjs",
  "agent:global:install": "node scripts/manage-global-agent-toolkit.mjs install",
  "agent:global:check": "node scripts/manage-global-agent-toolkit.mjs check",
  "agent:global:uninstall": "node scripts/manage-global-agent-toolkit.mjs uninstall"
}
```

Source: `/Users/cody/projects/Pokemon-Web/package.json:25-29`.

## 6.2 Manifest

The current manifest is:

```json
{
  "schema_version": 1,
  "name": "pokemon-web-global-agent-toolkit",
  "version": "1.0.0",
  "resources": [
    {
      "kind": "agent",
      "source": "agents/workspace-researcher.agent.md",
      "destination": "agents/workspace-researcher.agent.md"
    },
    {
      "kind": "skill",
      "source": "skills/external-skill-review/SKILL.md",
      "destination": "skills/external-skill-review/SKILL.md"
    },
    {
      "kind": "skill",
      "source": "skills/repository-agent-bootstrap/SKILL.md",
      "destination": "skills/repository-agent-bootstrap/SKILL.md"
    },
    {
      "kind": "skill",
      "source": "skills/shadow-architecture/SKILL.md",
      "destination": "skills/shadow-architecture/SKILL.md"
    }
  ]
}
```

Source: `/Users/cody/projects/Pokemon-Web/.github/global-agent-toolkit/manifest.json:1-28`.

The default destination root is `~/.copilot`, so destinations become:

- `~/.copilot/agents/workspace-researcher.agent.md`
- `~/.copilot/skills/external-skill-review/SKILL.md`
- `~/.copilot/skills/repository-agent-bootstrap/SKILL.md`
- `~/.copilot/skills/shadow-architecture/SKILL.md`

## 6.3 Path containment and symlink safety

`manage-global-agent-toolkit.mjs` resolves every path underneath a selected root and rejects paths that escape it. It also uses `lstatSync` to detect symlinks.

The implementation:

- Rejects a managed root that is itself a symlink.
- Walks every component between root and candidate.
- Rejects any existing symlink in a managed path.
- Applies this check to:
  - Manifest path.
  - Receipt path.
  - Source paths.
  - Destination paths.
  - Retired destination paths.

Source: `/Users/cody/projects/Pokemon-Web/scripts/manage-global-agent-toolkit.mjs:21-53`.

This is stronger than merely calling `resolve()` and checking a prefix because it prevents symlink-based escape through an otherwise lexically contained path.

## 6.4 Hashing

File contents are read as bytes and hashed with SHA-256:

```js
function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}
```

Source: `/Users/cody/projects/Pokemon-Web/scripts/manage-global-agent-toolkit.mjs:55-57`.

The hash therefore represents exact installed bytes, including line endings.

## 6.5 Manifest loading and resource validation

The manager requires:

- `schema_version === 1`
- `resources` is an array
- Every resource has:
  - `kind`
  - `source`
  - `destination`
- Destinations are unique.
- Source paths remain inside the source root.
- Source paths contain no symlink components.
- Every source exists.
- Every destination remains inside the target root.
- Destination paths contain no existing symlink components.

It reads each source once and computes its expected SHA-256.

Source: `/Users/cody/projects/Pokemon-Web/scripts/manage-global-agent-toolkit.mjs:63-100`.

## 6.6 Receipt

The receipt filename is:

```text
~/.copilot/.pokemon-web-global-agent-toolkit.json
```

Its shape is:

```json
{
  "schema_version": 1,
  "toolkit": "pokemon-web-global-agent-toolkit",
  "toolkit_version": "1.0.0",
  "installed_at": "2026-01-01T00:00:00.000Z",
  "resources": [
    {
      "kind": "skill",
      "source": "skills/example/SKILL.md",
      "destination": "skills/example/SKILL.md",
      "sha256": "..."
    }
  ]
}
```

Source: `/Users/cody/projects/Pokemon-Web/scripts/manage-global-agent-toolkit.mjs:228-243`.

The receipt records the source-relative and destination-relative paths plus the exact content hash installed for each managed resource.

## 6.7 `check` mode

`check`:

1. Requires a receipt.
2. Compares installed resource count and resource set with the current manifest.
3. Rejects retired receipt entries.
4. Requires a receipt entry for every current resource.
5. Requires receipt hash to match current source hash.
6. Requires destination file to exist.
7. Hashes the installed file.
8. Requires installed hash to match current source hash.

It reports:

```text
Global agent toolkit <version> is installed and current.
```

Source: `/Users/cody/projects/Pokemon-Web/scripts/manage-global-agent-toolkit.mjs:140-165`.

This detects:

- Missing receipt.
- Added or removed manifest resources.
- Changed source content.
- Missing installed files.
- Locally modified installed files.

## 6.8 `uninstall` mode

`uninstall`:

1. Is idempotent if no receipt exists.
2. Preflights every receipt-managed destination.
3. If an installed file exists, hashes it.
4. Refuses to remove any file whose current hash differs from the receipt.
5. Only after all resources pass preflight does it remove files.
6. Removes now-empty parent directories without crossing the target root.
7. Removes the receipt.
8. Leaves unmanaged files untouched.

Source: `/Users/cody/projects/Pokemon-Web/scripts/manage-global-agent-toolkit.mjs:167-190`.

This is an important safety property: uninstall does not partially delete files before discovering a modified file later in the receipt.

## 6.9 `install` mode

Install/update performs the following preflight:

1. Computes resources expected from the current manifest.
2. Computes resources present in the old receipt but retired from the new manifest.
3. For every retired resource:
   - If the file exists and differs from the old receipt hash, refuse to remove it.
4. For every current destination that already exists:
   - Permit it if it already equals new source content.
   - Permit it if it equals the previous receipt hash, meaning it is an unmodified older managed file.
   - Otherwise refuse to overwrite it as unmanaged or locally modified.
5. Detect a fully current installation:
   - Receipt bundle version matches.
   - No retired resources.
   - Resource counts match.
   - Every destination exists and has expected content.
   - Receipt hash matches source hash.
6. If current, return without rewriting.
7. Otherwise:
   - Create destination parents.
   - Write current resources.
   - Remove unchanged retired resources.
   - Remove empty retired parent directories.
   - Write a new receipt.

Source: `/Users/cody/projects/Pokemon-Web/scripts/manage-global-agent-toolkit.mjs:192-245`.

This makes installation idempotent and supports safely retiring resources from a later manifest.

## 6.10 CLI

The CLI accepts:

```bash
node scripts/manage-global-agent-toolkit.mjs install
node scripts/manage-global-agent-toolkit.mjs check
node scripts/manage-global-agent-toolkit.mjs uninstall
node scripts/manage-global-agent-toolkit.mjs install --target /custom/root
```

Default mode is `check`. `--target` requires a following directory.

Source: `/Users/cody/projects/Pokemon-Web/scripts/manage-global-agent-toolkit.mjs:248-279`.

## 6.11 Structural validator

`validate-agent-workflows.mjs` currently checks global and workspace skills.

For each skill:

- Reads frontmatter with a regular expression.
- Requires frontmatter.
- Reads `name`.
- Reads `description`.
- Requires name to match directory.
- Requires name to match `^[a-z0-9-]{1,64}$`.
- Requires description.
- Rejects duplicate names within workspace and global scopes.
- Rejects collisions between workspace and global skill names.

It also validates:

- Every manifest resource has source and destination.
- Manifest destinations are unique.
- Manifest sources exist.
- Agent files have `name` and `description`.
- Hook event and command structure.

Source: `/Users/cody/projects/Pokemon-Web/scripts/validate-agent-workflows.mjs:7-83`.

Its main limitation is that it uses regex extraction rather than a full YAML parser and does not enforce the complete Agent Skills field constraints.

## 6.12 Unit tests

`manage-global-agent-toolkit.test.ts` verifies:

- Install, check, and uninstall lifecycle.
- Installed agent content.
- Check fails after uninstall.
- Repeated install is idempotent.
- Modified files cause:
  - `check` failure.
  - Install overwrite refusal.
  - Uninstall removal refusal.
- An unchanged resource retired from the manifest is removed during update.
- A symlink replacing a managed destination is rejected.
- Symlinked source files are rejected.
- A symlink used as the managed target root is rejected.

Source: `/Users/cody/projects/Pokemon-Web/tests/unit/scripts/manage-global-agent-toolkit.test.ts:1-162`.

## 6.13 Pokemon-Web design strengths to preserve

- Manifest is the exclusive installation allowlist.
- Source remains canonical; installed files are generated copies.
- Exact byte hashes.
- Idempotent install.
- Drift detection.
- Refusal to clobber unmanaged files.
- Refusal to overwrite locally modified managed files.
- Refusal to uninstall locally modified files.
- Retired-resource handling.
- Path containment.
- Symlink rejection.
- Cleanup of empty managed directories.
- Testable dependency injection through `sourceRoot`, `targetRoot`, and `log`.
- No TypeScript build required for runtime tooling.

## 6.14 Improvements needed when generalizing

The current implementation should be extended with:

- Atomic file replacement.
- Atomic receipt replacement.
- A lock file to prevent concurrent installers.
- A rollback journal for multi-file or multi-host failure.
- Explicit file-mode recording and preservation.
- Full manifest JSON Schema validation.
- Manifest name and SemVer validation.
- Receipt validation before trusting its paths.
- Source bundle version, Git commit, release URL, and artifact digest.
- Multiple host target adapters.
- Dry-run output.
- Machine-readable JSON output.
- Optional backup/export for user modifications.
- A `status` command showing:
  - current
  - outdated
  - modified
  - unmanaged collision
  - missing
- Better handling of target-root creation before symlink checks.
- Verification that destinations are regular files.
- An explicit refusal to overwrite directories or special files.
- Crash-safe staging and cleanup.
- A policy for executable modes.
- Tests for:
  - malformed receipts
  - malformed manifests
  - duplicate destinations
  - path traversal
  - partial write failure
  - concurrent invocation
  - case collisions
  - permission preservation
  - source changes without version bump

---

## 7. Recommended generalized install/sync design

## 7.1 Proposed source manifest

```json
{
  "$schema": "./schemas/bundle-manifest.schema.json",
  "schema_version": 1,
  "name": "agent-skills",
  "version": "1.0.0",
  "resources": [
    {
      "kind": "skill",
      "name": "external-skill-review",
      "source": "skills/external-skill-review",
      "targets": [
        "claude",
        "copilot",
        "codex"
      ]
    }
  ]
}
```

The manager should expand a skill directory into its complete reviewed tree rather than listing only `SKILL.md`. Scripts, references, assets, license files, and metadata must install together.

## 7.2 Target adapters

```js
const TARGETS = {
  claude: {
    root: () => resolve(homedir(), '.claude'),
    skillsDirectory: 'skills'
  },
  copilot: {
    root: () => resolve(homedir(), '.copilot'),
    skillsDirectory: 'skills'
  },
  codex: {
    root: () => resolve(homedir(), '.agents'),
    skillsDirectory: 'skills'
  }
};
```

Optional explicit adapters may support:

- `codex-legacy` → `~/.codex/skills`
- A custom `--target`
- Project-scoped `.agents/skills`
- Project-scoped `.github/skills`

The CLI should never guess a nonstandard target silently.

## 7.3 Proposed commands

```bash
npm run skills:install -- --agent claude
npm run skills:install -- --agent copilot
npm run skills:install -- --agent codex
npm run skills:install -- --agent all

npm run skills:check -- --agent all
npm run skills:uninstall -- --agent all

node scripts/manage-skills.mjs install --agent all --dry-run
node scripts/manage-skills.mjs status --agent all --json
```

## 7.4 Receipt design

Recommended receipt path:

```text
<host-root>/.agent-skills-receipts/<bundle-name>.json
```

Example:

```json
{
  "schema_version": 1,
  "bundle": {
    "name": "agent-skills",
    "version": "1.2.3",
    "source_repository": "https://github.com/example/agent-skills",
    "source_commit": "0123456789abcdef0123456789abcdef01234567",
    "artifact_sha256": "..."
  },
  "target": {
    "host": "copilot",
    "root": "/Users/example/.copilot"
  },
  "installed_at": "2026-07-24T17:00:00.000Z",
  "resources": [
    {
      "kind": "skill",
      "skill": "external-skill-review",
      "source": "skills/external-skill-review/SKILL.md",
      "destination": "skills/external-skill-review/SKILL.md",
      "sha256": "...",
      "mode": "100644"
    }
  ]
}
```

Avoid including credentials, usernames beyond unavoidable absolute target metadata, or mutable branch names as provenance.

## 7.5 Install algorithm

### Phase 1: Validate source

1. Acquire a per-bundle/per-target lock.
2. Validate manifest against JSON Schema.
3. Validate bundle version as exact SemVer.
4. Run complete skill validation.
5. Enumerate every source file.
6. Reject symlinks, special files, submodules, and escaping paths.
7. Compute SHA-256 and Git mode for every file.
8. Verify source tree matches any signed release manifest.

### Phase 2: Validate existing state

1. Parse and schema-validate existing receipt.
2. Reject unsafe receipt paths.
3. Enumerate current, added, changed, and retired files.
4. For every existing destination:
   - If no receipt entry exists, classify as unmanaged collision.
   - If hash differs from receipt, classify as locally modified.
   - If type is not a regular file, reject.
5. For retired files:
   - Remove only if current hash equals old receipt hash.
6. Abort before writing if any conflict exists.

### Phase 3: Stage

1. Create staging files adjacent to destinations.
2. Write exact bytes.
3. Apply expected mode.
4. `fsync` staged files when practical.
5. Re-read and verify staged hashes.
6. Prepare the new receipt in staging.
7. Keep a transaction journal listing intended replacements.

### Phase 4: Commit

1. Rename old managed files to transaction backups.
2. Atomically rename staged files into place.
3. Remove unchanged retired files.
4. Atomically replace receipt.
5. Remove backups and journal.
6. Release lock.

If an operation fails, restore backups and retain a diagnostic journal.

Cross-filesystem all-host installation cannot be perfectly atomic, so the manager should preflight every host first and use rollback on later-host failure.

## 7.6 Idempotency rules

An install is current only when all of these match:

- Bundle version.
- Source release commit.
- Resource set.
- Destination paths.
- Content hashes.
- File modes.
- Host adapter version.
- Receipt schema version.

A second install of identical content must not rewrite files or change `installed_at`.

## 7.7 Local modifications

Default behavior must be refusal:

```text
Refusing to overwrite locally modified managed file:
~/.copilot/skills/example/SKILL.md

Expected installed SHA-256: ...
Current SHA-256: ...
New bundle SHA-256: ...
```

Optional recovery commands may include:

```bash
node scripts/manage-skills.mjs diff --agent copilot --skill example
node scripts/manage-skills.mjs export-modifications --agent copilot --output ./recovery
node scripts/manage-skills.mjs install --agent copilot --force-reviewed
```

A force option should require an explicit file or skill selection and should create a backup. Do not provide a broad unguarded `--force`.

## 7.8 Uninstall

Uninstall should:

1. Require and validate the receipt.
2. Preflight all managed files.
3. Refuse if any file differs from its receipt.
4. Remove only receipt-listed files.
5. Remove empty parents without crossing host root.
6. Remove the receipt last.
7. Never recursively delete a skill directory without checking every entry.
8. Refuse if untracked/unmanaged files remain inside a managed skill directory.
9. Be idempotent when not installed.

## 7.9 Check/status

`check` should distinguish:

- `current`
- `not-installed`
- `outdated-source`
- `missing`
- `modified`
- `unmanaged-collision`
- `retired-resource-present`
- `mode-drift`
- `receipt-invalid`
- `host-path-invalid`

JSON output makes CI and shell integration safer than parsing prose.

---

## 8. CI patterns observed in skills repositories

## 8.1 Addyosmani Agent Skills

Workflow:

- `addyosmani/agent-skills:.github/workflows/test-plugin-install.yml`
- <https://github.com/addyosmani/agent-skills/blob/main/.github/workflows/test-plugin-install.yml>

Jobs include:

- Validate every skill.
- Test the eval runner.
- Run deterministic trigger/routing evals with a minimum rank-1 threshold.
- Validate command parity.
- Install Claude Code.
- Validate marketplace and plugin manifests.
- Add the local marketplace.
- Smoke-test plugin installation.

This is the strongest observed example combining structural validation, deterministic evals, plugin validation, and actual install smoke testing.

## 8.2 Awesome Copilot

Relevant workflows:

- Changed-skill Vally PR gate:
  <https://github.com/github/awesome-copilot/blob/main/.github/workflows/skill-check.yml>
- Nightly full skill quality report:
  <https://github.com/github/awesome-copilot/blob/main/.github/workflows/skill-quality-report.yml>
- Codespell:
  <https://github.com/github/awesome-copilot/blob/main/.github/workflows/codespell.yml>
- PR risk scanning:
  <https://github.com/github/awesome-copilot/blob/main/.github/workflows/pr-risk-scan.yml>
- Generated distribution branch:
  <https://github.com/github/awesome-copilot/blob/main/.github/workflows/publish.yml>

Notable practices:

- Minimal permissions.
- Actions pinned to full commit SHAs.
- Changed-resource PR checks.
- Full scheduled catalog checks.
- Generated distribution branch separate from source.
- Install smoke tests for external plugins.
- Codespell checks filenames.
- Security findings reported separately from structural errors.

## 8.3 Jezweb Claude Skills

Workflow:

- <https://github.com/jezweb/claude-skills/blob/main/.github/workflows/skill-lint.yml>

Pattern:

- Trigger only on relevant paths.
- Detect changed skills.
- Run a repository-owned linter against those directories.

## 8.4 Cisco Skill Scanner

Reusable workflow documentation:

- <https://github.com/cisco-ai-defense/skill-scanner/blob/main/docs/github-actions.md>

Pattern:

- Recursive scan.
- Cross-skill overlap.
- SARIF report.
- Fail at configurable severity.
- Optional LLM and behavioral analyzers.
- Separate secrets for advanced analyzers.
- Allowlisted extra arguments to avoid caller-controlled secret exposure.

## 8.5 Markdown-link checking

Community repositories commonly use `markdown-link-check` actions or CLI packages, but external URL checks are inherently flaky because of rate limiting, authentication, bot blocking, and transient failures.

Recommended split:

- **Required on every PR:** deterministic local link and fragment validation implemented by the repository validator.
- **Required or retrying scheduled job:** external HTTP links.
- **Never allow:** `continue-on-error: true` for local file references.
- **Allow configured exceptions:** external sites that consistently block automated clients.

---

## 9. Recommended GitHub Actions workflow

This workflow assumes the repository defines the following npm scripts:

```json
{
  "scripts": {
    "test:tooling": "node --test tests/**/*.test.mjs",
    "validate": "node scripts/validate-skills.mjs",
    "validate:json": "node scripts/validate-skills.mjs --format json",
    "lint:markdown": "markdownlint-cli2 \"**/*.md\" \"#node_modules\"",
    "check:links": "node scripts/check-markdown-links.mjs",
    "spellcheck": "cspell --no-progress --show-suggestions \"**/*.{md,json,mjs}\"",
    "check:secrets": "node scripts/check-secrets.mjs",
    "package:bundle": "node scripts/package-bundle.mjs",
    "package:verify": "node scripts/verify-package.mjs",
    "skills:install": "node scripts/manage-skills.mjs install",
    "skills:check": "node scripts/manage-skills.mjs check",
    "skills:uninstall": "node scripts/manage-skills.mjs uninstall"
  }
}
```

Recommended `.github/workflows/validate.yml`:

```yaml
name: Validate Agent Skills

on:
  pull_request:
    paths:
      - "skills/**"
      - "scripts/**"
      - "schemas/**"
      - "security/**"
      - "tests/**"
      - "package.json"
      - "package-lock.json"
      - ".github/workflows/validate.yml"
  push:
    branches:
      - main
    paths:
      - "skills/**"
      - "scripts/**"
      - "schemas/**"
      - "security/**"
      - "tests/**"
      - "package.json"
      - "package-lock.json"
      - ".github/workflows/validate.yml"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: validate-agent-skills-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: "22"
  NODE_OPTIONS: "--disable-warning=ExperimentalWarning"

jobs:
  validate:
    name: Structure, schema, links, and prose
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
        with:
          persist-credentials: false

      - name: Set up Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install locked dependencies without lifecycle scripts
        run: npm ci --ignore-scripts

      - name: Run tooling tests
        run: npm run test:tooling

      - name: Validate all skills
        run: npm run validate

      - name: Validate JSON diagnostic mode
        run: npm run validate:json

      - name: Lint Markdown
        run: npm run lint:markdown

      - name: Check local and external Markdown links
        run: npm run check:links

      - name: Check spelling
        run: npm run spellcheck

      - name: Audit npm dependencies
        run: npm audit --audit-level=high

  security:
    name: Secrets and skill security
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
        with:
          persist-credentials: false

      - name: Set up Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install locked Node dependencies without lifecycle scripts
        run: npm ci --ignore-scripts

      - name: Scan for secrets and unsafe Unicode
        run: npm run check:secrets

      - name: Install hash-pinned Skill Scanner dependencies
        run: |
          python3 -m pip install \
            --require-hashes \
            --requirement security/skill-scanner-requirements.txt

      - name: Scan Agent Skills
        run: |
          skill-scanner scan-all ./skills \
            --recursive \
            --check-overlap \
            --policy strict \
            --fail-on-severity high

  package:
    name: Reproducible package
    runs-on: ubuntu-latest
    timeout-minutes: 15
    needs:
      - validate
      - security

    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
        with:
          persist-credentials: false

      - name: Set up Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install locked dependencies without lifecycle scripts
        run: npm ci --ignore-scripts

      - name: Build bundle twice
        run: |
          rm -rf dist
          SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" npm run package:bundle
          cp dist/agent-skills.tar.gz "${RUNNER_TEMP}/first.tar.gz"
          cp dist/SHA256SUMS "${RUNNER_TEMP}/first.SHA256SUMS"

          rm -rf dist
          SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" npm run package:bundle

      - name: Verify reproducibility and package contents
        run: |
          cmp "${RUNNER_TEMP}/first.tar.gz" dist/agent-skills.tar.gz
          cmp "${RUNNER_TEMP}/first.SHA256SUMS" dist/SHA256SUMS
          npm run package:verify

  install-smoke:
    name: Install, check, update, and uninstall
    runs-on: ubuntu-latest
    timeout-minutes: 15
    needs:
      - validate

    strategy:
      fail-fast: false
      matrix:
        agent:
          - claude
          - copilot
          - codex

    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
        with:
          persist-credentials: false

      - name: Set up Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install locked dependencies without lifecycle scripts
        run: npm ci --ignore-scripts

      - name: Use isolated HOME
        run: |
          echo "HOME=${RUNNER_TEMP}/home-${{ matrix.agent }}" >> "$GITHUB_ENV"
          mkdir -p "${RUNNER_TEMP}/home-${{ matrix.agent }}"

      - name: Install
        run: npm run skills:install -- --agent "${{ matrix.agent }}"

      - name: Check
        run: npm run skills:check -- --agent "${{ matrix.agent }}"

      - name: Verify idempotent install
        run: npm run skills:install -- --agent "${{ matrix.agent }}"

      - name: Uninstall
        run: npm run skills:uninstall -- --agent "${{ matrix.agent }}"

      - name: Verify uninstall state
        run: |
          if npm run skills:check -- --agent "${{ matrix.agent }}"; then
            echo "check unexpectedly succeeded after uninstall" >&2
            exit 1
          fi
```

### 9.1 Workflow notes

- GitHub Actions are pinned to full commit SHAs.
- `persist-credentials: false` limits accidental token reuse.
- `permissions` defaults to read-only.
- npm lifecycle scripts are disabled during dependency installation.
- The Skill Scanner requirements file must pin exact versions and hashes.
- Local link checks should be deterministic.
- Packaging runs twice and compares bytes.
- Install smoke tests use isolated homes.
- Full validation runs even if only one skill changed, preventing catalog-wide duplicate or collision regressions.
- A separate scheduled workflow may perform external-link checking and model-based behavioral evals.

---

## 10. Packaging recommendations

## 10.1 Repository package shape

```text
AgentSkills/
├── skills/
├── scripts/
├── schemas/
├── evals/
├── security/
├── tests/
├── .claude-plugin/
├── CHANGELOG.md
├── LICENSE
├── THIRD_PARTY_NOTICES.md
├── package.json
└── package-lock.json
```

## 10.2 Release artifacts

Each release should publish:

```text
agent-skills-v1.2.3.tar.gz
agent-skills-v1.2.3.zip
SHA256SUMS
SHA256SUMS.sig
bundle-manifest.json
THIRD_PARTY_NOTICES.md
sbom.spdx.json
provenance.intoto.jsonl
```

The archive should contain only:

- Validated skills.
- Installer/check/uninstaller.
- Schemas.
- Required licenses and notices.
- Versioned manifest.
- Documentation needed to use the artifact.

Do not include:

- `.git/`
- `node_modules/`
- Test output.
- Coverage.
- Temporary files.
- Local receipts.
- Unreviewed binaries.
- Editor metadata.

## 10.3 Reproducible archives

Archive generation should normalize:

- File order.
- Path separators.
- UID/GID.
- Owner/group names.
- Modification times using `SOURCE_DATE_EPOCH`.
- Permission modes.
- Compression settings.
- Locale and timezone.

The verifier should:

1. Extract to an isolated directory.
2. Reject absolute and traversal archive entries.
3. Reject symlinks.
4. Compare extracted files with `bundle-manifest.json`.
5. Recompute SHA-256.
6. Re-run skill validation.
7. Verify no undeclared files exist.

## 10.4 npm package

If publishing the CLI to npm:

- Use a scoped package such as `@organization/agent-skills`.
- Pin Node compatibility to `>=22`.
- Use the `files` field to restrict package contents.
- Avoid install/postinstall scripts.
- Publish with npm provenance.
- Use two-factor authentication or trusted publishing.
- Generate the release archive independently of npm’s package.
- Treat the npm CLI package and skills bundle as related but separately verifiable artifacts.

---

## 11. Versioning and release policy

## 11.1 Bundle SemVer

Use SemVer for the complete bundle.

### MAJOR

Increment for:

- Removing or renaming a skill without compatibility handling.
- Breaking invocation semantics.
- Changing installation layout.
- Breaking receipt or manifest formats.
- Removing documented fields.
- Changing a skill so existing prompts produce materially incompatible behavior.
- Raising runtime requirements incompatibly.

### MINOR

Increment for:

- Adding a skill.
- Adding backward-compatible optional fields.
- Adding a target adapter.
- Adding non-breaking validator checks initially as warnings.
- Adding installer features.
- Meaningful backward-compatible skill capability improvements.

### PATCH

Increment for:

- Correcting instructions without changing intended interface.
- Fixing broken references.
- Fixing spelling or examples.
- Fixing installer bugs compatibly.
- Tightening diagnostics without making valid content invalid.
- Security fixes that preserve compatibility.

SemVer requires that already released version contents not be modified. Any change must receive a new version.

Source: <https://semver.org/>.

## 11.2 Changelog

Use `CHANGELOG.md` with:

```markdown
# Changelog

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [1.0.0] - 2026-07-24
```

Every release should identify:

- Added skills.
- Changed trigger descriptions.
- Behavioral changes.
- Removed or renamed skills.
- Security-sensitive script changes.
- Installer/receipt changes.
- Host compatibility changes.
- Required migration steps.

Keep a Changelog recommends human-curated, reverse-chronological, linked entries and explicit categories.

Source: <https://keepachangelog.com/en/1.1.0/>.

## 11.3 Tags and immutable artifacts

Recommended release process:

1. Merge a version PR that:
   - Updates `package.json`.
   - Updates bundle manifest.
   - Updates marketplace/plugin versions.
   - Moves changelog entries from `Unreleased`.
2. CI validates and packages from the release commit.
3. Create a signed annotated `vX.Y.Z` tag.
4. Create a draft GitHub Release.
5. Upload all artifacts, checksums, SBOM, and provenance.
6. Verify assets.
7. Publish with GitHub release immutability enabled.
8. Verify using `gh release verify` and `gh release verify-asset`.

GitHub immutable releases lock the associated tag and release assets and provide verifiable release attestations.

Source: <https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases>.

## 11.4 Claude marketplace versions

Anthropic’s marketplace format is `.claude-plugin/marketplace.json`.

Current Anthropic example:

- Marketplace metadata version: `1.0.0`.
- Local plugin sources.
- Plugin entries may omit individual versions.

Source:

- `anthropics/skills:.claude-plugin/marketplace.json`
- <https://github.com/anthropics/skills/blob/main/.claude-plugin/marketplace.json>

Obra Superpowers includes:

```json
{
  "plugins": [
    {
      "name": "superpowers",
      "version": "6.2.0",
      "source": "./"
    }
  ]
}
```

Source:

- `obra/superpowers:.claude-plugin/marketplace.json`
- <https://github.com/obra/superpowers/blob/main/.claude-plugin/marketplace.json>

Claude’s documentation states:

- If a plugin version is explicitly set, users receive updates only when it changes.
- If version is omitted for a Git-hosted marketplace, each commit may count as a new version.
- Marketplace entries support local, GitHub, Git, URL, and npm sources.
- Plugin directories are copied to a cache.
- Plugins cannot depend on files outside the copied plugin tree.

Source: <https://code.claude.com/docs/en/plugin-marketplaces>.

**Recommendation:** always set explicit SemVer and synchronize it with the bundle version. Do not rely on “every commit is a version” for production distribution.

## 11.5 Superpowers synchronized versioning

Superpowers uses:

- `.version-bump.json`
- `scripts/bump-version.sh`

It synchronizes version fields across:

- `package.json`
- Claude plugin manifest.
- Cursor plugin manifest.
- Codex plugin manifest.
- Kimi plugin manifest.
- Claude marketplace plugin entry.
- Gemini extension manifest.

The bump script:

- Reads declared JSON field paths.
- Detects drift.
- Updates all declared files.
- Audits the repository for undeclared occurrences of the old/current version.
- Requires a SemVer-like value.

Sources:

- <https://github.com/obra/superpowers/blob/main/.version-bump.json>
- <https://github.com/obra/superpowers/blob/main/scripts/bump-version.sh>

This is a strong model for a repository supporting multiple marketplaces and host formats.

## 11.6 GitHub Copilot skill versions

GitHub’s `gh skill` is in public preview. Current behavior includes:

```bash
gh skill preview OWNER/REPOSITORY SKILL
gh skill install OWNER/REPOSITORY SKILL
gh skill install OWNER/REPOSITORY SKILL@v1.2.0
gh skill install OWNER/REPOSITORY SKILL --pin v1.2.0
gh skill update
gh skill publish --dry-run
```

GitHub documents that:

- A skill can be installed at a tag or commit SHA.
- `--pin` prevents update.
- `@VERSION` and `--pin` are mutually exclusive.
- Installation writes provenance metadata into `SKILL.md` frontmatter, including repository, ref, and tree SHA.
- Updates use that provenance.
- `gh skill publish --dry-run` validates skills and checks repository controls such as tag protection, secret scanning, and code scanning.
- Skills are not verified by GitHub.
- Users should preview before installing.

Sources:

- <https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills>
- <https://cli.github.com/manual/gh_skill>

There is no portable required per-skill `version` field in `SKILL.md`. Git tags, commit SHAs, release artifacts, plugin manifests, and receipts should remain the authoritative version mechanisms. An optional string such as `metadata.version` may be included for display, but it creates synchronization overhead.

---

## 12. Security threat model

## 12.1 Why skills are supply-chain artifacts

A skill can contain:

- Instructions injected into an agent’s context.
- Scripts the agent may execute.
- References that influence decisions.
- Tool preapproval.
- Network or package-manager commands.
- Requests to access credentials or sensitive files.
- Hidden content.
- Dependencies fetched at runtime.

Therefore a skill is closer to executable automation than passive documentation.

## 12.2 Primary risks

### Prompt injection

A malicious skill may instruct the agent to:

- Ignore system or user policies.
- Conceal actions.
- Skip confirmation.
- Override previous instructions.
- Treat embedded external content as trusted commands.
- Reveal secrets.
- Persist itself.
- Download or execute additional code.
- Misrepresent its purpose.

### Tool escalation

Dangerous declarations include:

- Preapproved shell/bash.
- Wildcard tools.
- Broad filesystem access.
- Credential-store access.
- Network tools without constraints.
- Instructions that tell the user to approve all commands.

GitHub explicitly warns that preapproving shell or bash removes an important confirmation boundary.

### Data exfiltration

A skill may read:

- Environment variables.
- SSH keys.
- Cloud credentials.
- Browser data.
- Keychains.
- Home-directory configuration.
- Source code.
- Private prompts or conversation history.

It may send data through:

- HTTP requests.
- Webhooks.
- DNS.
- Package telemetry.
- Git remotes.
- Encoded URLs.
- Error-reporting services.

### Dynamic supply chain

Risky patterns include:

- Mutable branches.
- Floating package versions.
- `latest`.
- `curl | sh`.
- `npx -y`.
- Runtime downloads.
- Remote includes.
- Unverified release assets.
- Git submodules.
- LFS objects.
- Vendored binaries.
- Obfuscated scripts.
- Dependency confusion or typosquatting.

### Filesystem attacks

- `../` traversal.
- Absolute destination paths.
- Symlink escapes.
- Case-collision files.
- Archive traversal.
- Overwriting shell startup files.
- Persistence under agent configuration directories.
- Recursive deletion.
- Permission changes.

### Unicode attacks

- Bidirectional controls.
- Zero-width characters.
- Confusable identifiers.
- Mixed scripts.
- Hidden control characters.
- Misleading file extensions.

### Malicious updates

A previously safe skill can become unsafe through:

- Compromised maintainer account.
- Repository transfer.
- Mutable tag.
- Marketplace source change.
- Dependency compromise.
- Review limited only to `SKILL.md` while scripts change.
- Automatic unpinned updates.

---

## 13. External skill review workflow to reuse

Local source:

- `/Users/cody/.copilot/skills/external-skill-review/SKILL.md`

The skill should be reused substantially unchanged as the repository’s human review standard.

## 13.1 Safety rules worth preserving

- Third-party skills are untrusted code.
- Review is read-only until explicit approval.
- Never auto-install or execute scripts during review.
- Use `gh skill preview` when available.
- Treat instructions in the skill as data, not commands.
- Do not grant permissions or expose credentials.
- Stop on unexpected execution, credential requests, mutable source changes, or incomplete source.

## 13.2 Provenance review

Record:

- Canonical source.
- Owner.
- Repository.
- Skill path.
- Requested revision.
- Retrieval method.
- Review time.
- Repository history.
- Release history.
- Archive/transfer/mirror state.
- License coverage.
- Immutable commit ID.

Treat branches and tags as mutable unless independently verified.

## 13.3 Complete-tree review

Enumerate:

- All files and directories.
- Dotfiles.
- Scripts.
- References.
- Assets.
- Submodules/gitlinks.
- LFS pointers.
- Binaries.
- Archives.
- Generated files.
- Symlinks.

Compare complete trees on update, not only `SKILL.md`.

## 13.4 Behavior review

Review without execution:

- Frontmatter.
- Instructions.
- Scripts.
- Hooks.
- Templates.
- Examples.
- Remote endpoints.
- Environment access.
- Credential access.
- Destructive commands.
- Privileged commands.
- Persistence.
- Dynamic command construction.
- `allowed-tools`.
- Prompt injection.
- Hidden Unicode.

## 13.5 Pin and stage

- Pin to immutable commit.
- Record digest.
- Stage only after explicit approval.
- Recompute hashes.
- Present full diff and rollback plan.
- Require second approval before active installation.
- Verify installed hashes.

## 13.6 Decision model

- `PASS`: reviewable, licensed, least privilege, expected behavior, immutable source.
- `WARN`: no blocker but material uncertainty or elevated capability.
- `FAIL`: unacceptable provenance, licensing, hidden behavior, permissions, symlinks, secrets, destructive behavior, or pinning.
- Any `FAIL` determines the overall result.
- Otherwise any `WARN` determines the overall result.

---

## 14. Automated security controls

## 14.1 Repository-owned static checks

Implement deterministic Node checks for:

- Unicode controls.
- Absolute and traversal paths.
- Symlinks.
- Secret patterns.
- Private keys.
- `curl | shell`.
- Dynamic package execution.
- Floating dependencies.
- Suspicious guardrail-bypass phrases.
- Network endpoints.
- Credential/environment references.
- Shell startup changes.
- Recursive deletion.
- Base64-obfuscated commands.
- Executable binaries.
- Unexpected files.

These checks should be transparent, fast, and required in every pull request.

## 14.2 Cisco Skill Scanner

Use Cisco Skill Scanner as a second independent implementation:

```bash
skill-scanner scan-all ./skills \
  --recursive \
  --check-overlap \
  --policy strict \
  --fail-on-severity high
```

Optional scheduled/manual deeper scan:

```bash
skill-scanner scan-all ./skills \
  --recursive \
  --check-overlap \
  --policy strict \
  --use-behavioral \
  --use-llm \
  --enable-meta \
  --fail-on-severity high
```

Do not expose LLM keys to workflows that execute contributor-controlled code. The scan should remain static/read-only.

## 14.3 GitHub repository controls

Enable:

- Secret scanning.
- Push protection.
- Dependency review.
- Code scanning.
- Dependabot or equivalent lockfile update review.
- CODEOWNERS for:
  - `skills/**/scripts/**`
  - schemas
  - validator rules
  - installer
  - release workflow
  - marketplace manifests
- Protected tags.
- Required signed commits or vigilant mode as organizational policy permits.
- Immutable releases.
- Required status checks.
- Restricted workflow permissions.
- No GitHub Actions from mutable branches.

## 14.4 Security limitations

No automated scanner can establish that a skill is safe. Static patterns can miss semantic attacks; LLM judges can be manipulated; dataflow analysis covers only supported languages; safe-looking scripts can fetch malicious content later. Human review and immutable pinning remain mandatory for third-party imports.

---

## 15. Testing whether skills trigger and work

## 15.1 Three-tier model

Use three test tiers.

| Tier | Purpose | PR suitability | Cost |
|---|---|---:|---:|
| Structural | Format, schema, links, permissions, policy | Every PR | Low |
| Trigger/routing | Positive prompts, negative prompts, collisions | Every PR if deterministic | Low |
| Behavioral | Agent follows workflow and produces correct artifacts | Scheduled/release/manual | Model tokens |

## 15.2 Anthropic skill-creator evals

Anthropic’s updated skill-creator supports:

- Writing eval prompts.
- Defining expected behavior.
- Running benchmarks.
- Measuring pass rate.
- Measuring elapsed time.
- Measuring token usage.
- Parallel clean-context agents.
- Skill-versus-no-skill comparison.
- Version-versus-version comparison.
- Blind comparator agents.
- Description tuning for false positives and false negatives.

Source: <https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills>.

## 15.3 Addyosmani eval implementation

Repository:

- `addyosmani/agent-skills:evals/README.md`
- <https://github.com/addyosmani/agent-skills/blob/main/evals/README.md>

It defines:

### Tier 1: Structural

- Frontmatter.
- Naming.
- Required sections.
- Command parity.

### Tier 2: Trigger and routing

- Positive prompts must rank the intended skill in top-k.
- Negative prompts must not incorrectly route.
- Declared owner skill should outrank a competing skill.
- Description similarity detects collisions.
- Uses stemmed TF-IDF for deterministic CI.
- Tracks rank-1 rate.
- Errors at high pairwise description similarity.
- Warns at moderate similarity.

### Tier 3: Behavioral

- Runs an agent with the skill.
- Uses isolated fixtures.
- Grades expectations against transcript and artifacts.
- Supports execution and dialogue cases.
- Uses explicit timeouts.
- Treats agent traces as untrusted input to the grader.
- Stores results in a structured grading format.
- Includes pressure cases testing whether workflow discipline survives requests to skip it.

Example format:

```json
{
  "skill_name": "test-driven-development",
  "trigger": {
    "positive": [
      {
        "prompt": "Write a failing test for this bug before fixing it",
        "top_k": 3
      }
    ],
    "negative": [
      {
        "prompt": "Update the architecture diagram in the docs",
        "owner": "documentation-and-adrs"
      }
    ]
  },
  "evals": [
    {
      "id": 1,
      "kind": "execution",
      "prompt": "Fix the reported rounding bug in the invoice totals, test-first.",
      "expected_output": "A failing test demonstrating the bug, a minimal fix turning it green, full suite passing",
      "files": [
        "test-driven-development"
      ],
      "expectations": [
        "A failing test is written and shown failing before the fix",
        "The implementation is the minimum needed to pass",
        "The full suite is run after the fix"
      ]
    }
  ]
}
```

Their repository requires at least:

- Three positive trigger cases.
- Two negative trigger cases.
- One behavioral eval per skill.

That is a good initial policy.

## 15.4 Superpowers explicit skill request tests

Relevant file:

- `obra/superpowers:tests/explicit-skill-requests/run-test.sh`
- <https://github.com/obra/superpowers/blob/main/tests/explicit-skill-requests/run-test.sh>

The test:

1. Accepts a skill name and prompt fixture.
2. Creates an isolated project and output directory.
3. Runs headless Claude with the plugin.
4. Captures stream-JSON output.
5. Searches for the `Skill` tool invocation.
6. Accepts namespaced and non-namespaced skill names.
7. Reports which skills were triggered.
8. Detects non-planning tools used before the requested skill was loaded.
9. Exits nonzero if the skill did not trigger.

Prompt fixtures include:

- Direct requests.
- Action-oriented requests.
- Mid-conversation requests.
- Requests under pressure to skip formalities.
- Requests where the agent previously suggested the skill.

Directory:

- <https://github.com/obra/superpowers/tree/main/tests/explicit-skill-requests>

This is useful prior art for real host-level trigger testing, although production tests should avoid `--dangerously-skip-permissions` unless running in a strongly isolated disposable environment.

## 15.5 Recommended eval case format

```json
{
  "$schema": "../../schemas/skill-eval.schema.json",
  "skill": "external-skill-review",
  "trigger": {
    "positive": [
      {
        "id": "install-third-party-skill",
        "prompt": "Can you inspect this external skill before I install it?",
        "expected_rank": 1
      },
      {
        "id": "review-skill-update",
        "prompt": "Review the changes between the installed skill and upstream update.",
        "expected_top_k": 3
      }
    ],
    "negative": [
      {
        "id": "review-ordinary-code",
        "prompt": "Review this JavaScript function for readability.",
        "expected_owner": "code-review"
      }
    ]
  },
  "behavior": [
    {
      "id": "does-not-execute-untrusted-code",
      "prompt": "Review the skill fixture and tell me whether I should install it.",
      "fixture": "fixtures/external-skill-review/malicious-download",
      "expectations": [
        "No fixture script is executed",
        "The report identifies the remote download",
        "The result is FAIL or WARN",
        "The report requests explicit approval before staging"
      ],
      "forbidden": [
        "Network access to fixture-declared endpoints",
        "Writes outside the test workspace",
        "Installation into an active skill directory"
      ]
    }
  ]
}
```

## 15.6 Trigger metrics

Track:

- Positive top-1 accuracy.
- Positive top-3 accuracy.
- False-negative rate.
- Negative false-positive rate.
- Pairwise confusion matrix.
- Description similarity.
- Skill omitted due to metadata budget.
- Explicit invocation success.
- Implicit invocation success.
- Premature tool-use rate.

## 15.7 Behavioral metrics

Track:

- Expectation pass rate.
- Forbidden-action rate.
- Artifact correctness.
- Test pass/fail.
- Tool calls.
- Network calls.
- Files read/written.
- Token use.
- Elapsed time.
- Model and host version.
- Skill release version.
- Baseline without skill.
- Previous-release comparison.

## 15.8 CI strategy

Every PR:

- Structural tests.
- Validator unit tests.
- Deterministic lexical trigger tests.
- Eval schema and fixture validation.
- Security scanning.
- Installer tests.

Nightly or manual:

- Real-host trigger tests.
- Behavioral model evals.
- Skill-versus-no-skill baselines.
- Previous-release A/B comparison.
- Multiple model/host matrix.

Before release:

- Full behavioral suite.
- Review failures and regressions.
- Store signed or immutable result summary with the release.
- Require explicit approval for changed baselines.

---

## 16. Recommended implementation roadmap

## Phase 1: Foundation

Create:

```text
package.json
package-lock.json
scripts/validate-skills.mjs
scripts/check-markdown-links.mjs
scripts/check-secrets.mjs
schemas/skill-frontmatter.schema.json
tests/validate-skills.test.mjs
```

Dependencies should be minimal and locked. Suggested categories:

- YAML parser with duplicate-key detection.
- AJV for JSON Schema.
- Markdown parser for links/headings.
- Token estimator or documented tokenizer.
- Markdown linter.
- Spell checker.

## Phase 2: Installer

Generalize Pokemon-Web into:

```text
scripts/manage-skills.mjs
schemas/bundle-manifest.schema.json
schemas/install-receipt.schema.json
tests/manage-skills.test.mjs
```

Preserve all existing safety behavior and add atomic transactions, modes, locks, and host adapters.

## Phase 3: CI and security

Add:

```text
.github/workflows/validate.yml
security/skill-scanner-requirements.txt
security/skill-scanner-policy.yaml
CODEOWNERS
SECURITY.md
```

Require all checks before merge.

## Phase 4: Release

Add:

```text
CHANGELOG.md
scripts/bump-version.mjs
scripts/package-bundle.mjs
scripts/verify-package.mjs
.github/workflows/release.yml
```

Enable immutable releases and protected tags.

## Phase 5: Evals

Add:

```text
evals/cases/
evals/fixtures/
schemas/skill-eval.schema.json
scripts/run-trigger-evals.mjs
scripts/run-behavioral-evals.mjs
```

Require every new skill to include eval coverage.

---

## 17. Key gaps and uncertainties

1. The official `skills-ref` validator is explicitly described as demonstration code, so production behavior may evolve.
2. The published specification requires ASCII skill names, while the current Python reference implementation accepts broader Unicode alphanumeric characters.
3. No general structural validator was found inside the current Anthropic Skills repository.
4. No general `SKILL.md` structural validator was found in the current Superpowers scripts; its strongest relevant prior art is behavioral testing and version synchronization.
5. Awesome Copilot uses `@microsoft/vally-cli`, but the validator’s complete rule set was not independently inspected here; repository-owned validation should remain authoritative.
6. `gh skill` is public preview and its provenance metadata format may change.
7. Copilot does not define a portable required per-skill version field; tags, SHAs, releases, and receipts should remain authoritative.
8. Claude marketplace version behavior differs depending on whether an explicit version is present.
9. Current Codex documentation prefers `~/.agents/skills`, not `~/.codex/skills`.
10. Third-person description phrasing is useful quality guidance but not a normative Agent Skills requirement.
11. External HTTP link checks remain nondeterministic; local link checks must be separate and strict.
12. Cisco Skill Scanner is best-effort and cannot certify safety.
13. Model-based evals can vary across models and host versions and should record complete execution metadata.
14. Installing identical skills into several user roots can create duplicate discovery in hosts that scan multiple roots. The installer should warn and document precedence rather than assume duplicates are harmless.

## Sources

### Agent Skills specification and reference validator

- <https://agentskills.io/specification>
- <https://github.com/agentskills/agentskills>
- <https://github.com/agentskills/agentskills/tree/main/skills-ref>
- <https://github.com/agentskills/agentskills/blob/main/skills-ref/src/skills_ref/validator.py>
- <https://raw.githubusercontent.com/agentskills/agentskills/main/skills-ref/src/skills_ref/validator.py>

### Anthropic Skills and Claude

- <https://github.com/anthropics/skills>
- <https://github.com/anthropics/skills/tree/main/spec>
- <https://github.com/anthropics/skills/blob/main/.claude-plugin/marketplace.json>
- <https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json>
- <https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills>
- <https://claude.com/plugins/skill-creator>
- <https://code.claude.com/docs/en/plugin-marketplaces>
- <https://docs.anthropic.com/en/docs/claude-code/plugin-marketplaces> — redirected to the current Claude Code documentation.

### GitHub Copilot and GitHub CLI

- <https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills>
- <https://cli.github.com/manual/gh_skill>
- <https://code.visualstudio.com/docs/agent-customization/agent-skills>
- <https://code.visualstudio.com/docs/copilot/customization/agent-skills> — redirected to the current Agent Customization path.
- <https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases>
- <https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verify-release-integrity?tool=cli>
- <https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository>

### GitHub Awesome Copilot

- <https://github.com/github/awesome-copilot>
- <https://github.com/github/awesome-copilot/blob/main/eng/validate-skills.mjs>
- <https://raw.githubusercontent.com/github/awesome-copilot/main/eng/validate-skills.mjs>
- <https://github.com/github/awesome-copilot/blob/main/eng/constants.mjs>
- <https://raw.githubusercontent.com/github/awesome-copilot/main/eng/constants.mjs>
- <https://github.com/github/awesome-copilot/blob/main/eng/pr-risk-scan.mjs>
- <https://github.com/github/awesome-copilot/blob/main/eng/generate-marketplace.mjs>
- <https://github.com/github/awesome-copilot/blob/main/eng/external-plugin-quality-gates.mjs>
- <https://raw.githubusercontent.com/github/awesome-copilot/main/eng/external-plugin-quality-gates.mjs>
- <https://github.com/github/awesome-copilot/blob/main/.github/workflows/skill-check.yml>
- <https://raw.githubusercontent.com/github/awesome-copilot/main/.github/workflows/skill-check.yml>
- <https://github.com/github/awesome-copilot/blob/main/.github/workflows/skill-quality-report.yml>
- <https://raw.githubusercontent.com/github/awesome-copilot/main/.github/workflows/skill-quality-report.yml>
- <https://github.com/github/awesome-copilot/blob/main/.github/workflows/codespell.yml>
- <https://raw.githubusercontent.com/github/awesome-copilot/main/.github/workflows/codespell.yml>
- <https://github.com/github/awesome-copilot/blob/main/.github/workflows/pr-risk-scan.yml>
- <https://github.com/github/awesome-copilot/blob/main/.github/workflows/publish.yml>
- <https://raw.githubusercontent.com/github/awesome-copilot/main/.github/workflows/publish.yml>
- <https://github.com/github/awesome-copilot/blob/main/package.json>

### Addyosmani Agent Skills

- <https://github.com/addyosmani/agent-skills>
- <https://github.com/addyosmani/agent-skills/blob/main/scripts/lib/skill-lint.js>
- <https://raw.githubusercontent.com/addyosmani/agent-skills/main/scripts/lib/skill-lint.js>
- <https://github.com/addyosmani/agent-skills/blob/main/scripts/validate-skills.js>
- <https://raw.githubusercontent.com/addyosmani/agent-skills/main/scripts/validate-skills.js>
- <https://github.com/addyosmani/agent-skills/tree/main/evals>
- <https://github.com/addyosmani/agent-skills/blob/main/evals/README.md>
- <https://raw.githubusercontent.com/addyosmani/agent-skills/main/evals/README.md>
- <https://github.com/addyosmani/agent-skills/tree/main/evals/cases>
- <https://github.com/addyosmani/agent-skills/blob/main/.github/workflows/test-plugin-install.yml>
- <https://raw.githubusercontent.com/addyosmani/agent-skills/main/.github/workflows/test-plugin-install.yml>

### Jezweb Claude Skills

- <https://github.com/jezweb/claude-skills>
- <https://github.com/jezweb/claude-skills/blob/main/bin/skill-lint>
- <https://github.com/jezweb/claude-skills/blob/main/.github/workflows/skill-lint.yml>
- <https://raw.githubusercontent.com/jezweb/claude-skills/main/.github/workflows/skill-lint.yml>

### Obra Superpowers

- <https://github.com/obra/superpowers>
- <https://github.com/obra/superpowers/blob/main/.claude-plugin/marketplace.json>
- <https://raw.githubusercontent.com/obra/superpowers/main/.claude-plugin/marketplace.json>
- <https://github.com/obra/superpowers/blob/main/.version-bump.json>
- <https://raw.githubusercontent.com/obra/superpowers/main/.version-bump.json>
- <https://github.com/obra/superpowers/blob/main/scripts/bump-version.sh>
- <https://raw.githubusercontent.com/obra/superpowers/main/scripts/bump-version.sh>
- <https://github.com/obra/superpowers/tree/main/tests>
- <https://github.com/obra/superpowers/tree/main/tests/explicit-skill-requests>
- <https://github.com/obra/superpowers/blob/main/tests/explicit-skill-requests/run-test.sh>

### Cisco AI Defense Skill Scanner

- <https://github.com/cisco-ai-defense/skill-scanner>
- <https://github.com/cisco-ai-defense/skill-scanner/blob/main/README.md>
- <https://github.com/cisco-ai-defense/skill-scanner/blob/main/docs/github-actions.md>
- <https://raw.githubusercontent.com/cisco-ai-defense/skill-scanner/main/docs/github-actions.md>
- <https://pypi.org/project/cisco-ai-skill-scanner/>

### OpenAI Codex

- <https://learn.chatgpt.com/docs/build-skills>
- <https://developers.openai.com/codex/skills> — redirected to the current skills documentation.
- <https://github.com/openai/skills>

### Versioning and changelogs

- <https://semver.org/>
- <https://keepachangelog.com/en/1.1.0/>
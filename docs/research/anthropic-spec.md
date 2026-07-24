# Anthropic / Open Agent Skills Specification — Research Report

**Research date:** 2026-07-24  
**Scope:** Anthropic Agent Skills, the open Agent Skills specification, `anthropics/skills`, `agentskills/agentskills`, Claude Code, Claude Agent SDK, GitHub Copilot, and OpenAI Codex interoperability.

## Executive conclusions

1. The most portable skill format is a directory containing `SKILL.md` with exactly the open-standard frontmatter fields: required `name` and `description`; optional `license`, `compatibility`, `metadata`, and experimental `allowed-tools`. [Open specification](https://agentskills.io/specification)
2. Do not put a top-level `version` field in portable `SKILL.md` frontmatter. Put a quoted version string under `metadata.version`. Plugin and hosted-skill versions are separate distribution-layer concepts. [Open specification](https://agentskills.io/specification) [Claude plugin documentation](https://code.claude.com/docs/en/plugins) [Anthropic API guide](https://platform.claude.com/docs/en/build-with-claude/skills-guide.md)
3. A portable repository should keep real skill directories under `.agents/skills/` or a neutral `skills/` source directory. Claude Code additionally needs `.claude/skills/`; use symlinks or generated installation copies rather than maintaining duplicate hand-edited trees. [Client implementation guide](https://agentskills.io/client-implementation/adding-skills-support) [Claude Code documentation](https://code.claude.com/docs/en/skills) [GitHub Copilot documentation](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills) [Codex documentation](https://learn.chatgpt.com/docs/build-skills)
4. Keep the `SKILL.md` body under 500 lines and approximately 5,000 tokens. Put large, conditional, or domain-specific material in directly linked files under `references/`; keep links one level deep from `SKILL.md`. [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) [Open specification](https://agentskills.io/specification)
5. Description quality controls implicit activation. Write in third person, front-load concrete capabilities and trigger terms, and explicitly say when the skill should be used. [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
6. Use scripts for deterministic, repetitive, fragile, or machine-verifiable operations. Prefer prose for judgment-heavy work where multiple approaches are valid. [Anthropic engineering article](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
7. Treat skills as privileged instructions and code. Audit all scripts, dependencies, network calls, and bundled assets before installation, especially before pre-approving shell access. [Anthropic engineering article](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) [GitHub Copilot documentation](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills) [OpenAI Skills API guide](https://developers.openai.com/api/docs/guides/tools-skills)

---

## 1. Canonical `SKILL.md` frontmatter

### Canonical field table

| field | required | type | constraints | Claude Code | Copilot | Codex/other | notes |
|---|---:|---|---|---|---|---|---|
| `name` | **Yes by open standard** | string | 1–64 characters; lowercase letters, digits, and hyphens; no leading, trailing, or consecutive hyphens; should match parent directory | Claude Code itself permits omission and falls back to the directory name, but portable skills should always include it | Required | Required by Codex/open standard | Anthropic’s hosted platform additionally rejects XML tags and reserved words such as `anthropic` and `claude` |
| `description` | **Yes by open standard** | string | 1–1024 characters; non-empty; describe both what the skill does and when to use it; avoid `<` and `>` for Anthropic compatibility | Recommended by Claude Code; if omitted, Claude Code may use the first body paragraph, but omission is nonportable | Required | Required by Codex/open standard | Primary implicit-trigger signal; write in third person and include concrete trigger terms |
| `license` | No | string | Short license identifier or reference to a bundled license file | Portable metadata; no documented Claude Code execution behavior | Explicitly documented as optional | Accepted as part of the open format; no execution behavior | Examples: `Apache-2.0`, `MIT`, or `Proprietary. LICENSE.txt has complete terms` |
| `compatibility` | No | string | 1–500 characters if present; intended product, OS, packages, network requirements, or environment constraints | Open-standard metadata; no documented Claude Code enforcement | Standard-compatible, but no documented Copilot enforcement | Standard-compatible; useful because runtime environments differ | Omit when there are no special requirements |
| `metadata` | No | mapping of string keys to string values | Arbitrary key-value map; keys should be reasonably unique; values should be strings | No documented behavioral effect; useful for repository tooling | Accepted through open-standard validation; no documented behavior | Accepted through open-standard validation; no documented behavior | Put `author`, `version`, provenance, or organization-specific identifiers here |
| `allowed-tools` | No | string in the standard | Space-separated pre-approved tool patterns; experimental and runtime-dependent | Honored by Claude Code CLI; Claude Code also accepts comma-separated values or YAML lists. **Ignored by Claude Agent SDK**, which uses SDK-level `allowedTools` | Honored: listed tools may run without repeated confirmation; shell pre-approval is security-sensitive | Part of the open standard, but Codex documentation does not promise enforcement; use runtime policy/dependency configuration instead | Do not rely on it as a portable security boundary |

Sources: [Agent Skills specification](https://agentskills.io/specification), [Claude Code Skills](https://code.claude.com/docs/en/skills), [Claude Agent SDK Skills](https://code.claude.com/docs/en/agent-sdk/skills), [GitHub Copilot Skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills), [Codex Skills](https://learn.chatgpt.com/docs/build-skills), `agentskills/agentskills:skills-ref/src/skills_ref/models.py:8-39`, and `agentskills/agentskills:skills-ref/src/skills_ref/validator.py:9-26`.

### Required versus optional: standard and Claude Code differ

The open Agent Skills standard requires `name` and `description`. Anthropic’s hosted Skills API and authoring documentation also require both. [Specification](https://agentskills.io/specification) [Anthropic overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)

Claude Code is more lenient: its runtime documentation says all frontmatter fields are optional, defaults `name` from the directory, and can derive a missing description from the first Markdown paragraph. This is a Claude Code convenience, not a portable authoring rule. A repository targeting Claude Code, Copilot, and Codex should always include both fields. [Claude Code Skills](https://code.claude.com/docs/en/skills)

### `name` constraints

For the broadest portability, enforce this ASCII form:

```regex
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

That expression enforces:

- At least one character.
- Lowercase ASCII letters, digits, and single hyphens only.
- No leading or trailing hyphen.
- No consecutive hyphens.
- A maximum length of 64 characters, enforced separately.
- Equality with the parent directory name, enforced by repository validation.

Examples:

```yaml
name: processing-pdfs       # valid
name: code-review           # valid
name: data-analysis-2       # valid

name: Processing-PDFs       # invalid: uppercase
name: -processing-pdfs      # invalid: leading hyphen
name: processing-pdfs-      # invalid: trailing hyphen
name: processing--pdfs      # invalid: consecutive hyphens
name: processing_pdfs       # invalid: underscore
```

The prose specification describes lowercase letters, digits, and hyphens. The current Python reference validator uses Python’s Unicode-aware `str.isalnum()`, so it can accept lowercase Unicode alphanumerics even though the documentation examples and portable ecosystem convention use ASCII `a-z`. Use the stricter ASCII regex above to avoid runtime discrepancies. [Specification](https://agentskills.io/specification) `agentskills/agentskills:skills-ref/src/skills_ref/validator.py:27-80`

Anthropic’s hosted platform adds two restrictions not stated in the core open standard:

- `name` cannot contain XML tags.
- `name` cannot contain reserved words such as `anthropic` or `claude`.

Avoid those reserved words in portable names even if another runtime accepts them. [Anthropic overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) [Anthropic best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### `description` constraints

A description must:

- Be a non-empty string.
- Be no more than 1,024 characters.
- Explain both the skill’s capability and the circumstances in which it should be activated.
- Include concrete words likely to appear in user requests.
- Avoid XML tags or angle brackets for compatibility with Anthropic’s stricter validation.
- Be written in third person.

The open standard does not prescribe a minimum beyond non-empty. Anthropic explicitly warns that first- or second-person descriptions can create discovery problems because descriptions are injected into the model’s skill catalog. [Specification](https://agentskills.io/specification) [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

Claude Code currently combines `description` with its nonstandard `when_to_use` extension and truncates their listing text at 1,536 characters. Portable skills should not use `when_to_use`; put all trigger information in the standard `description` and remain under the standard 1,024-character limit. [Claude Code Skills](https://code.claude.com/docs/en/skills)

### `compatibility` constraints

`compatibility` is optional and should be omitted for ordinary skills. If present:

- It must be a string.
- It should contain 1–500 characters.
- It should state concrete environmental requirements, not general marketing text.

Examples:

```yaml
compatibility: Requires git, jq, and network access to github.com.
```

```yaml
compatibility: Requires Python 3.11+ and the pypdf package.
```

```yaml
compatibility: Designed for Claude Code and other agents with filesystem and shell access.
```

The standard’s 500-character limit is implemented by `skills-ref`. [Specification](https://agentskills.io/specification) `agentskills/agentskills:skills-ref/src/skills_ref/validator.py:13-15,101-113`

### `metadata` shape and versioning

`metadata` is a mapping from string keys to string values:

```yaml
metadata:
  author: example-org
  version: "1.2.0"
  repository: https://github.com/example/agent-skills
  category: code-quality
```

Quote version numbers. Unquoted values such as `1.0` may become YAML numbers instead of strings. The reference parser converts nested metadata keys and values to strings, but authors should not depend on coercion. [Specification](https://agentskills.io/specification) `agentskills/agentskills:skills-ref/src/skills_ref/parser.py:43-66`

There is no top-level `version` field in the open frontmatter specification. The following is invalid under strict `skills-ref` validation:

```yaml
---
name: example
description: Performs an example workflow. Use when an example is requested.
version: 1.0.0
---
```

Use this instead:

```yaml
metadata:
  version: "1.0.0"
```

Distribution systems have separate version concepts:

- Claude Code plugins use `version` in `.claude-plugin/plugin.json` or a marketplace entry. [Claude plugin documentation](https://code.claude.com/docs/en/plugins)
- Anthropic’s Skills API maintains externally managed skill versions and accepts an optional version when mounting a skill. [Anthropic API guide](https://platform.claude.com/docs/en/build-with-claude/skills-guide.md)
- OpenAI’s hosted Skills API also maintains external integer versions and version pointers. [OpenAI Skills API guide](https://developers.openai.com/api/docs/guides/tools-skills)
- GitHub CLI can install a skill from a tag or commit SHA and writes provenance metadata into installed skills. [GitHub Copilot documentation](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)

### `allowed-tools` semantics

The standard form is a space-separated string:

```yaml
allowed-tools: Bash(git:*) Bash(jq:*) Read
```

It is explicitly experimental, and support varies among implementations. [Specification](https://agentskills.io/specification)

Claude Code supports:

```yaml
allowed-tools: Read Grep Bash(git:*)
```

It also documents comma-separated strings and YAML lists. The permission grant applies during the turn that invokes the skill and clears on the next user message. `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}` can be used in Claude-specific Bash rules, but those substitutions are not part of the open standard. [Claude Code Skills](https://code.claude.com/docs/en/skills)

GitHub Copilot allows `allowed-tools` to pre-approve tools such as `shell`. GitHub warns that pre-approving `shell` or `bash` removes a confirmation step and can allow a malicious skill or prompt injection to execute arbitrary commands. [GitHub Copilot documentation](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)

The Claude Agent SDK explicitly ignores `allowed-tools` from `SKILL.md`. SDK applications must configure tool permissions through `allowedTools`/`allowed_tools`, `tools`, permission modes, and callbacks. [Claude Agent SDK Skills](https://code.claude.com/docs/en/agent-sdk/skills)

Codex supports the open skill format but its authoring documentation does not promise that `allowed-tools` grants permissions. Codex uses host policy and optional `agents/openai.yaml` metadata for invocation policy and tool dependencies. Treat `allowed-tools` as advisory or unsupported in Codex unless runtime documentation explicitly says otherwise. [Codex Skills](https://learn.chatgpt.com/docs/build-skills)

### Claude Code-only frontmatter extensions

Claude Code currently documents additional fields including:

- `when_to_use`
- `argument-hint`
- `arguments`
- `disable-model-invocation`
- `user-invocable`
- `disallowed-tools`
- `model`
- `effort`
- `context`
- `agent`
- `background`
- `hooks`
- `paths`
- `shell`

These are not part of the open Agent Skills specification. The strict `skills-ref` validator rejects unknown top-level fields, so adding them to a canonical portable skill breaks strict conformance. [Claude Code Skills](https://code.claude.com/docs/en/skills) `agentskills/agentskills:skills-ref/src/skills_ref/validator.py:17-26,116-128`

Recommendation:

- Keep canonical `SKILL.md` frontmatter restricted to the six open-standard fields.
- Put runtime-specific UI or dependency metadata in runtime companion files, such as Codex’s `agents/openai.yaml`.
- If a Claude-only deployment truly needs Claude extensions, generate a runtime-specific wrapper or transformed copy during installation rather than changing the canonical portable source.

---

## 2. Recommended directory layout

### Canonical portable layout

```text
my-skill/
├── SKILL.md                    # Required: frontmatter + concise main instructions
├── LICENSE.txt                 # Optional: full license text
├── references/                 # Optional: documentation read on demand
│   ├── REFERENCE.md
│   ├── advanced-workflow.md
│   └── troubleshooting.md
├── scripts/                    # Optional: deterministic executable utilities
│   ├── validate.py
│   ├── transform.py
│   └── check.sh
├── assets/                     # Optional: templates and static resources
│   ├── report-template.md
│   ├── schema.json
│   └── example-config.yaml
└── agents/                     # Optional: runtime-specific companion metadata
    └── openai.yaml             # Optional Codex/ChatGPT UI and dependency metadata
```

The open standard requires only `SKILL.md`. It standardizes the conventional purposes of `scripts/`, `references/`, and `assets/` but allows additional files and directories. [Specification](https://agentskills.io/specification)

### Purpose of each component

#### `SKILL.md`

Required entry point containing:

1. YAML frontmatter.
2. Concise Markdown instructions.
3. Navigation to bundled resources.
4. Clear directions about when to read a reference or run a script.

The complete file is loaded when the skill activates, so every line in it becomes context cost. [Anthropic overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)

#### `references/`

Use for documentation that is:

- Needed only for some invocations.
- Too detailed for the main workflow.
- Domain-, framework-, or provider-specific.
- Primarily factual reference material.
- Large enough that loading it every time would waste context.

Examples:

```text
references/
├── aws.md
├── azure.md
└── gcp.md
```

A deployment skill can tell the model to read only the provider-specific file needed for the current task. [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

#### `scripts/`

Use for executable utilities that provide:

- Determinism.
- Validation.
- Repeated transformations.
- Structured inspection.
- Reliable machine operations.
- Efficiency compared with regenerating code on every invocation.

Common portable choices are Python, Bash, and JavaScript, but language availability depends on the host runtime. [Specification](https://agentskills.io/specification)

#### `assets/`

Use for files consumed as input or copied into outputs:

- Document templates.
- Configuration templates.
- Images and icons.
- Fonts.
- Lookup tables.
- JSON Schemas.
- Example data.
- Style assets.

Assets need not be read into the model’s context if a script or workflow can use them directly. [Specification](https://agentskills.io/specification)

#### `LICENSE.txt`

Optional but recommended for distributed skills. The frontmatter can point to it:

```yaml
license: Apache-2.0. See LICENSE.txt for complete terms.
```

Anthropic’s own skills commonly include `LICENSE.txt`, and its PDF skill uses a short proprietary notice in frontmatter that points to the bundled file. [Anthropic PDF skill](https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md) [PDF directory](https://github.com/anthropics/skills/tree/main/skills/pdf)

#### `agents/openai.yaml`

This is not part of the core standard. Codex and ChatGPT can use it for:

- Display names and descriptions.
- Icons and brand colors.
- Default prompts.
- Whether implicit invocation is permitted.
- MCP/tool dependencies.

Do not make the core skill depend on this file for basic operation in Claude or Copilot. [Codex Skills](https://learn.chatgpt.com/docs/build-skills)

### Reference nesting rules

Keep references one level deep from `SKILL.md`:

```markdown
See [the API reference](references/REFERENCE.md).
```

Avoid chains such as:

```text
SKILL.md
  → references/advanced.md
      → references/internal/details.md
          → references/internal/protocol.md
```

Anthropic warns that agents may preview nested references with partial reads and never reach the actual instructions. Every important reference should be linked directly from `SKILL.md`. [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) [Specification](https://agentskills.io/specification)

For reference files longer than 100 lines, Anthropic’s current best-practices guide recommends a table of contents. The `skill-creator` skill gives a looser threshold of approximately 300 lines. Using a table of contents at 100 lines is the safer repository rule. [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) [skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)

### Development-only files

Evaluations and generated benchmark artifacts are useful during authoring but should normally be excluded from the distributed skill:

```text
my-skill/
├── SKILL.md
├── references/
├── scripts/
└── evals/                       # Development-only; exclude from package
```

Anthropic’s `package_skill.py` excludes a root `evals/` directory as well as `node_modules`, `__pycache__`, `.pyc`, and `.DS_Store` artifacts. `anthropics/skills:skills/skill-creator/scripts/package_skill.py:17-49` [Source](https://github.com/anthropics/skills/blob/main/skills/skill-creator/scripts/package_skill.py)

---

## 3. Progressive disclosure

Progressive disclosure is the central Agent Skills design principle. It lets an agent know that many skills exist without paying the context cost of loading all their instructions and resources. [Anthropic engineering article](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)

### Level 1: metadata catalog

**Loaded:** Always, at session startup or skill discovery.  
**Content:** `name`, `description`, and sometimes the skill’s filesystem location.  
**Budget:** Approximately 50–100 tokens per skill; Anthropic’s overview rounds this to approximately 100 tokens.  
**Purpose:** Let the model decide whether a skill is relevant without loading its instructions. [Open client implementation guide](https://agentskills.io/client-implementation/adding-skills-support) [Anthropic overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)

Implications:

- Keep descriptions concise.
- Front-load the most important trigger terms.
- Do not put implementation details in the description.
- Remember that every installed skill contributes metadata to the initial context.
- Codex may shorten descriptions or omit some skill entries when the initial catalog exceeds its budget, so the beginning of the description matters most. Codex documents a catalog budget of up to 2% of the context window or 8,000 characters when the context size is unknown. [Codex Skills](https://learn.chatgpt.com/docs/build-skills)

### Level 2: `SKILL.md` instructions

**Loaded:** When the model or user activates the skill.  
**Content:** The entire `SKILL.md`, including its Markdown body and sometimes frontmatter.  
**Recommended budget:** Fewer than 5,000 tokens and fewer than 500 lines.  
**Purpose:** Provide the core workflow, decisions, constraints, and navigation to resources. [Specification](https://agentskills.io/specification) [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

Once loaded, skill instructions may remain in context across turns. Concision therefore matters even though the body is not loaded at startup. [Claude Code Skills](https://code.claude.com/docs/en/skills)

### Level 3: resources and executable code

**Loaded or executed:** Only when needed.  
**Content:** Reference files, scripts, templates, schemas, examples, and other bundled resources.  
**Budget:** No context cost until accessed. A read reference consumes context; an executed script usually contributes only its output. Bundled content is therefore effectively unbounded, subject to host file-size and package limits. [Anthropic overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) [Anthropic engineering article](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)

A script can run without loading its source into model context. This is a major reason to package reliable utilities rather than asking the model to recreate them repeatedly. [Anthropic overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)

### When to split content into `references/`

Split when any of the following is true:

- `SKILL.md` approaches 500 lines or 5,000 tokens.
- Material is needed only for some task variants.
- Multiple providers, frameworks, products, or domains are mutually exclusive.
- API details, schemas, examples, or troubleshooting material dominate the core workflow.
- The model can choose the needed reference based on the user’s task.
- A section is factual lookup material rather than procedural guidance.
- The same reference is large but rarely used.
- A long examples collection would distract from the required workflow.

Do not split tiny sequential instructions merely to reduce line count. The main workflow should remain coherent and executable after reading `SKILL.md` alone. Supporting files should deepen or specialize the workflow rather than hide its essential first steps.

---

## 4. Copy-pasteable portable `SKILL.md` template

````markdown
---
name: replace-with-skill-name
description: Performs a specific workflow and produces a clearly defined result. Use when the user asks for the workflow, mentions its key artifacts or file types, or requests the expected output.
license: Apache-2.0. See LICENSE.txt for complete terms.
compatibility: Requires a filesystem and shell access. List any required runtimes, packages, commands, or network access here.
metadata:
  author: your-name-or-organization
  version: "1.0.0"
# Experimental and not consistently enforced across runtimes.
# Remove this field unless pre-approval is truly needed.
# allowed-tools: Read Bash(python:*)
---

# Replace With Skill Title

## Goal

State the result the agent should produce in one or two sentences.

## Inputs

Identify the required and optional inputs:

- Required input: describe it precisely.
- Optional input: describe its default behavior.
- Output path or format: state what the agent should create or return.

If required information is missing and cannot be inferred safely, ask for it before performing irreversible work.

## Workflow

1. Inspect the inputs and confirm they are usable.
2. Select the appropriate workflow branch.
3. Perform the transformation or analysis.
4. Validate the result.
5. Fix validation failures and repeat validation.
6. Return the final output and a concise summary of what was done.

## Decision points

- **Condition A:** Follow the primary workflow.
- **Condition B:** Read [the advanced workflow](references/advanced-workflow.md).
- **Unsupported condition:** Explain the limitation and provide the safest practical alternative.

## Validation

Before finalizing:

- Confirm all required outputs exist.
- Run the relevant validator.
- Check that no input file was overwritten unless explicitly requested.
- Report validation failures with actionable details.

If validation fails, fix the cause and rerun validation rather than ignoring the error.

## Bundled resources

- Read [the reference guide](references/REFERENCE.md) when exact field, API, or format details are needed.
- Read [troubleshooting](references/troubleshooting.md) after a documented command or validation failure.
- Run `python scripts/validate.py <output>` to validate generated output.
- Use `assets/report-template.md` when producing the standard report format.

## Output format

Return:

1. The path or identifier of each created artifact.
2. A concise summary of the result.
3. Any warnings, assumptions, or unresolved validation failures.
````

Template notes:

- Delete optional fields that do not apply.
- Keep all `metadata` values as strings.
- Do not retain placeholder compatibility claims.
- Do not include `allowed-tools` solely because a script exists; runtime permission prompting is safer by default.
- Replace general prose with domain-specific requirements discovered through evaluations.

---

## 5. Writing descriptions that trigger reliably

### Rules

1. **Write in third person.**  
   Use “Processes…”, “Generates…”, or “Reviews…”, not “I can…” or “You can use…”. [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

2. **State what the skill does.**  
   Name the actual operations and expected outputs.

3. **State when to use it.**  
   Include “Use when…” or an equivalent explicit trigger clause.

4. **Include concrete trigger vocabulary.**  
   Mention likely file extensions, artifact names, workflow terms, technologies, and user intents.

5. **Front-load the primary use case.**  
   Some clients truncate or shorten catalog descriptions. [Claude Code Skills](https://code.claude.com/docs/en/skills) [Codex Skills](https://learn.chatgpt.com/docs/build-skills)

6. **Include broad but relevant neighboring intents.**  
   Anthropic’s `skill-creator` says skills tend to under-trigger and recommends slightly “pushy” descriptions that include related contexts even when the user does not use the skill’s exact name. [skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)

7. **Define boundaries when overlap is likely.**  
   Distinguish the skill from neighboring skills without filling the description with implementation details.

8. **Keep all activation information in the description.**  
   The body is not loaded until after selection, so a “When to use” section in the body cannot help initial discovery.

### GOOD example 1

```yaml
description: Extracts text and tables from PDF files, fills PDF forms, merges or splits PDFs, and performs OCR on scanned documents. Use when the user mentions PDFs, .pdf files, forms, document extraction, page manipulation, or searchable scanned documents.
```

**Why it is good:**

- Written in third person.
- Names specific capabilities.
- Includes file-extension and domain keywords.
- Covers both explicit PDF requests and related document tasks.
- Says exactly when to activate.

This follows the pattern used by Anthropic’s PDF skill, whose description intentionally says to use it whenever the user wants to do anything with PDF files. [Anthropic PDF skill](https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md)

### GOOD example 2

```yaml
description: Diagnoses and repairs failing GitHub Actions workflows by inspecting runs, summarizing job-log failures, reproducing errors, and verifying fixes. Use when CI checks fail, a pull request has failing Actions jobs, or the user asks to debug workflow YAML or build logs.
```

**Why it is good:**

- Identifies the target platform and artifacts.
- Includes realistic phrases: “CI checks,” “pull request,” “workflow YAML,” and “build logs.”
- Describes the workflow sufficiently for routing.
- Does not waste space explaining implementation details.

The trigger pattern aligns with GitHub’s documented Actions debugging example. [GitHub Copilot documentation](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)

### GOOD example 3

```yaml
description: Reviews database migration plans, validates migration files, checks rollback safety, and runs the approved migration sequence. Use when creating, reviewing, testing, or executing schema migrations, rollback plans, or production database changes.
```

**Why it is good:**

- Covers planning, review, testing, and execution rather than only the final command.
- Includes high-value trigger phrases.
- Communicates that the skill applies to safety-sensitive operations.
- Gives the model enough scope to activate before an unsafe migration begins.

### BAD example 1

```yaml
description: Helps with documents.
```

**Why it is bad:**

- “Documents” is too broad.
- It names no file types, operations, or outputs.
- It gives no activation conditions.
- It will collide with PDF, DOCX, spreadsheet, presentation, and writing skills.

### BAD example 2

```yaml
description: I can help you process Excel files.
```

**Why it is bad:**

- Uses first person.
- “Process” is vague.
- It omits operations such as analysis, pivot tables, charts, validation, or formula creation.
- It gives no “when to use” context beyond one file type.

### BAD example 3

```yaml
description: Uses Python, pandas, openpyxl, jq, and several shell scripts to perform our workflow.
```

**Why it is bad:**

- Describes implementation rather than user intent.
- Contains no task, trigger, or output.
- Tool names are unlikely to match users’ requests.
- It will fail to activate when the user asks for the result without naming the implementation.

---

## 6. Authoring do’s and don’ts

### Do

- **Start with evaluations.** Run representative tasks without the skill, record concrete failures, create at least three scenarios, then write the minimum instructions needed to improve results. [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- **Test implicit activation separately from task quality.** A skill can contain excellent instructions and still fail because its description does not trigger.
- **Test every model and runtime you plan to support.** Guidance sufficient for a strong model may be inadequate for a smaller one, while excessive guidance can hinder stronger models. [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- **Assume the model already understands common concepts.** Include only domain knowledge, constraints, workflows, and failure modes it cannot reliably infer.
- **Use imperative instructions.** Prefer “Run the validator” over descriptive prose about validation.
- **Explain why important constraints exist.** Rationale lets the model generalize instead of blindly following brittle rules. [skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)
- **Match instruction freedom to task fragility.**
  - High freedom for judgment-heavy work with many valid approaches.
  - Medium freedom for preferred patterns with configurable details.
  - Low freedom for migrations, destructive operations, strict formats, and fragile sequences.
- **Provide a default approach.** Mention alternatives only for clearly defined exceptions.
- **Use explicit inputs and outputs.**
- **Use concrete input/output examples when style or formatting matters.**
- **Use sequential workflows and checklists for complex work.**
- **Add feedback loops:** validate, fix, and validate again.
- **Create machine-verifiable intermediate files for high-risk operations.**
- **Preserve original input files unless overwriting is explicitly requested.**
- **Use consistent terminology throughout the skill.**
- **Use descriptive filenames:** `form-validation-rules.md`, not `doc2.md`.
- **Use forward slashes in all paths**, including instructions intended for Windows.
- **Link every important reference directly from `SKILL.md`.**
- **Add a table of contents to long reference files.**
- **Use fully qualified MCP tool names**, such as `GitHub:create_issue`, when a workflow depends on MCP.
- **List dependencies explicitly** and state whether network access is required.
- **Audit third-party skills as software**, including scripts, images, dependencies, and external URLs.
- **Pin or otherwise control dependencies** when reproducibility matters.
- **Keep release bundles clean:** exclude eval output, caches, dependencies, and generated artifacts.
- **Use a license field and bundled license file** for distributed skills.
- **Store version data under `metadata.version`** rather than adding a nonstandard top-level field.
- **Run strict validation in CI.**
- **Test the installed form**, including symlinks or generated copies, not only the canonical source tree.

### Don’t

- **Do not write a vague description.**
- **Do not put activation guidance only in the body.** The body is unavailable during initial skill selection.
- **Do not write descriptions in first or second person.**
- **Do not exceed 1,024 characters for the description.**
- **Do not use uppercase letters, spaces, underscores, or repeated hyphens in names.**
- **Do not allow `name` and the parent directory to diverge.**
- **Do not use reserved Anthropic terms in names** if the skill may be uploaded to Anthropic’s hosted platform.
- **Do not exceed 500 lines or approximately 5,000 tokens in `SKILL.md`** without splitting content.
- **Do not reproduce basic knowledge or entire generic tool manuals.** The context window is shared; include only the exact tool behavior, domain rules, or version-specific constraints needed for reliable execution.
- **Do not duplicate large API documentation in the main body.** Put necessary reference material in `references/`.
- **Do not create deeply nested reference chains.**
- **Do not include time-sensitive branching such as “before August 2025 use v1.”** Document the current method first and isolate historical patterns in a clearly labeled legacy section. [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- **Do not present many equivalent libraries without a default.**
- **Do not assume a package, command, or MCP server exists.**
- **Do not assume network access.** Anthropic’s API skill environment has no network access or runtime package installation, while Claude Code generally has local-machine network access. [Anthropic overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- **Do not use Windows backslash paths.**
- **Do not use unexplained magic numbers or “voodoo constants.”**
- **Do not write scripts that merely fail and tell the model to figure it out.**
- **Do not leave script execution intent ambiguous.**
- **Do not pre-approve shell access for untrusted skills.**
- **Do not use `allowed-tools` as a cross-runtime security boundary.**
- **Do not add Claude Code-only fields to the canonical portable file** if strict open-standard validation is required.
- **Do not hand-maintain multiple identical skill copies** in `.agents/skills/`, `.claude/skills/`, and `.github/skills/`; they will drift.
- **Do not package development evals or generated benchmark workspaces with the released skill.**
- **Do not overfit instructions to two or three test prompts.** Generalize from failures rather than encoding brittle prompt-specific rules.
- **Do not overuse `MUST`, `ALWAYS`, and `NEVER` without explaining the underlying reason.** Anthropic’s `skill-creator` treats excessive rigidity as a warning sign. [skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)

---

## 7. Script guidance

### When to ship a script

Ship a script when the task is:

- Deterministic.
- Repetitive.
- Fragile or error-prone.
- Expensive to regenerate in tokens.
- Easier to test as code.
- Machine-verifiable.
- A transformation with stable inputs and outputs.
- A validator or inspector.
- A high-stakes operation requiring exact sequencing.
- Reimplemented similarly in multiple evaluation runs.

Examples:

- Validate a JSON or XML structure.
- Extract PDF form fields.
- Normalize a dataset.
- Compare generated output against a schema.
- Apply a controlled migration.
- Generate a stable archive.
- Inspect a binary file.
- Verify that required files, fields, or sections exist.

Anthropic notes that sorting, structured extraction, and validation are more reliable and efficient as ordinary code than as token generation. [Anthropic engineering article](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)

### When prose is better

Prefer prose when:

- Several approaches are valid.
- The correct approach depends heavily on context.
- Human judgment or creative adaptation is central.
- The work is review, synthesis, planning, or communication.
- A script would encode brittle assumptions.
- The operation is simple enough that a utility would add maintenance cost without improving reliability.

### Determinism

Scripts should produce stable outputs for the same inputs whenever practical:

- Avoid random behavior or seed randomness explicitly.
- Use stable sorting.
- Normalize timestamps or exclude volatile data.
- Make locale and encoding assumptions explicit.
- Avoid dependence on ambient working directories.
- Accept explicit input and output paths.
- Return meaningful exit codes.
- Write structured output when another step consumes it.
- Preserve originals by default.

### Dependencies

A script should be self-contained or clearly declare:

- Required interpreter and version.
- Required packages and versions.
- Required command-line tools.
- Required environment variables.
- Required network endpoints.
- Whether installation is permitted at runtime.
- Expected operating systems or shells.

Put concise requirements in `compatibility` and operational details near the script instructions.

Do not assume every host can install dependencies:

- Claude Code runs on the user’s machine and generally has normal local network access.
- Anthropic API containers have no network access and no runtime package installation.
- Copilot environments vary by surface.
- Codex may run locally or in hosted containers.

[Anthropic overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) [OpenAI Skills API guide](https://developers.openai.com/api/docs/guides/tools-skills)

### Error handling

Scripts should:

- Validate arguments before doing work.
- Detect missing files.
- Detect invalid formats.
- Handle permission failures.
- Avoid partial destructive changes.
- Emit actionable errors.
- Name the invalid field, file, or value.
- List valid alternatives when useful.
- Use nonzero exit codes on failure.
- Make retry behavior explicit.
- Clean up temporary or partially generated files.
- Support dry-run mode for destructive actions when feasible.

A useful error is:

```text
Field "signature_date" was not found.
Available fields: customer_name, order_total, signature_date_signed
```

An unhelpful error is:

```text
Validation failed.
```

Anthropic recommends scripts that solve error conditions rather than simply deferring them to the model. [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### “Run this” versus “read this”

State execution intent explicitly.

Good execution instruction:

```markdown
Run `python scripts/analyze_form.py input.pdf > fields.json` to extract the form fields.
```

Good reference instruction:

```markdown
Read `scripts/analyze_form.py` only when modifying the field-extraction algorithm.
```

Bad ambiguous instruction:

```markdown
Use `scripts/analyze_form.py`.
```

Execution is usually preferred for stable utilities because the script source does not need to enter model context; only its output does. Reading is appropriate when the task is to modify, audit, or understand the implementation. [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### Language selection

The standard does not mandate a language. It lists Python, Bash, and JavaScript as common options. [Specification](https://agentskills.io/specification)

Recommended policy:

- Use Python for portable structured processing and validation.
- Use POSIX shell only for short orchestration around widely available tools.
- Use JavaScript or TypeScript when the skill’s domain is inherently Node-based.
- Avoid language diversity within one skill unless necessary.
- Prefer runtime-provided libraries over dependencies requiring installation.
- Include shebangs where appropriate.
- Make scripts executable when the distribution format preserves permissions, but document an interpreter-based invocation as a fallback.

---

## 8. Reconstructed JSON Schema for frontmatter

No official standalone JSON Schema for `SKILL.md` frontmatter was found in the open repository. The reference implementation publishes Python models, parser logic, and validation code instead. The schema below reconstructs the intended strict contract from the specification and `skills-ref` validator. [Specification](https://agentskills.io/specification) `agentskills/agentskills:skills-ref/src/skills_ref/models.py:8-39` `agentskills/agentskills:skills-ref/src/skills_ref/validator.py:9-151`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.org/schemas/agent-skill-frontmatter.schema.json",
  "title": "Agent Skills SKILL.md Frontmatter",
  "description": "Strict portable frontmatter schema reconstructed from the Agent Skills specification and skills-ref validator.",
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
      "description": "Lowercase ASCII letters, digits, and single hyphens only. Must match the parent skill directory name."
    },
    "description": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1024,
      "pattern": "^[^<>]+$",
      "description": "What the skill does and when it should be used. Angle brackets are excluded for compatibility with Anthropic's stricter validation."
    },
    "license": {
      "type": "string",
      "minLength": 1,
      "description": "Short license identifier or reference to a bundled license file."
    },
    "compatibility": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500,
      "description": "Environment, product, package, command, operating-system, or network requirements."
    },
    "metadata": {
      "type": "object",
      "description": "Additional client- or organization-specific metadata.",
      "propertyNames": {
        "type": "string",
        "minLength": 1
      },
      "additionalProperties": {
        "type": "string"
      }
    },
    "allowed-tools": {
      "type": "string",
      "minLength": 1,
      "description": "Experimental, space-separated pre-approved tool patterns. Enforcement varies by runtime."
    }
  }
}
```

### Schema caveats

1. JSON Schema cannot verify that `name` equals the parent directory. CI must perform that filesystem check separately.
2. The schema deliberately uses ASCII `a-z`, which is stricter and more portable than the Unicode-aware behavior of the current Python validator.
3. The open standard does not forbid angle brackets in `description`, but Anthropic’s hosted validation does. The schema adopts the stricter cross-Anthropic rule.
4. Anthropic’s reserved-name restriction is not encoded because the documentation describes reserved words but not a precise matching algorithm. Add a repository policy check rejecting names containing `anthropic` or `claude`.
5. `skills-ref` currently does not type-check every optional field as completely as this schema. The schema reflects the documented intended types.
6. Unknown top-level fields are rejected to match `skills-ref` strict validation.
7. Runtime-specific fields such as Claude Code’s `disable-model-invocation` will fail this schema by design.

### Additional repository checks

A complete validator should also check:

```text
- The path is a directory.
- SKILL.md exists with exactly that casing.
- The file starts with --- and has a closing --- delimiter.
- YAML parses to a mapping.
- name equals the parent directory.
- No top-level field is outside the six standard fields.
- metadata keys and values are strings.
- The Markdown body is non-empty.
- SKILL.md is under the repository's line/token budget.
- Every relative link resolves inside the skill directory.
- Reference chains do not exceed one level.
- Scripts do not contain unexpected secrets or generated dependencies.
- LICENSE.txt exists when license points to it.
```

---

## 9. `agentskills.io`, `agentskills/agentskills`, and `skills-ref`

### What `agentskills.io` is

Anthropic published Agent Skills as an open standard for cross-platform portability in December 2025. The standard defines:

- The skill directory structure.
- The required `SKILL.md`.
- YAML frontmatter fields and constraints.
- Optional `scripts/`, `references/`, and `assets/` conventions.
- Progressive disclosure.
- Relative file references.
- Validation through the reference library.

[Specification](https://agentskills.io/specification) [Anthropic announcement](https://claude.com/blog/skills) [Anthropic engineering article](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)

The standard does not mandate installation paths. Client implementations decide where skills live. The client guide recommends supporting both client-native locations and `.agents/skills/` for interoperability. [Client implementation guide](https://agentskills.io/client-implementation/adding-skills-support)

### Repository structure

At the researched commit `38a2ff82958afee88dadf4831509e6f7e9d8ef4e`, the `agentskills/agentskills` repository contains:

```text
agentskills/agentskills/
├── .claude/
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── docs/
│   ├── home.mdx
│   ├── clients.mdx
│   ├── client-implementation/
│   │   └── adding-skills-support.mdx
│   └── ...
└── skills-ref/
    ├── README.md
    ├── pyproject.toml
    ├── uv.lock
    ├── src/
    │   └── skills_ref/
    │       ├── __init__.py
    │       ├── cli.py
    │       ├── errors.py
    │       ├── models.py
    │       ├── parser.py
    │       ├── prompt.py
    │       └── validator.py
    └── tests/
```

[Repository](https://github.com/agentskills/agentskills) [Tree API](https://api.github.com/repos/agentskills/agentskills/git/trees/main?recursive=1)

### What `skills-ref` is

`skills-ref` is a Python reference library and CLI for:

- Validating skill directories.
- Reading normalized skill properties.
- Generating an `<available_skills>` catalog for agent prompts.

Its README explicitly says it is for demonstration and is not intended as a production library. `agentskills/agentskills:skills-ref/README.md:1-8` [README](https://github.com/agentskills/agentskills/blob/main/skills-ref/README.md)

Commands:

```bash
skills-ref validate path/to/skill
skills-ref read-properties path/to/skill
skills-ref to-prompt path/to/skill-a path/to/skill-b
```

Python API:

```python
from pathlib import Path
from skills_ref import validate, read_properties, to_prompt

problems = validate(Path("my-skill"))
props = read_properties(Path("my-skill"))
prompt = to_prompt([Path("skill-a"), Path("skill-b")])
```

`agentskills/agentskills:skills-ref/README.md:35-73` [README](https://github.com/agentskills/agentskills/blob/main/skills-ref/README.md)

### Installing `skills-ref`

Using `pip`:

```bash
git clone https://github.com/agentskills/agentskills.git
cd agentskills/skills-ref

python -m venv .venv
source .venv/bin/activate
pip install -e .
```

Using `uv`:

```bash
git clone https://github.com/agentskills/agentskills.git
cd agentskills/skills-ref

uv sync
source .venv/bin/activate
```

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e .
```

The repository does not document a stable production package release in the inspected README; installation is editable from source. Pin a commit SHA if using it in CI. [skills-ref README](https://github.com/agentskills/agentskills/blob/main/skills-ref/README.md)

### What the validator checks

The current validator checks:

- The path exists and is a directory.
- `SKILL.md` or lowercase `skill.md` exists.
- Frontmatter exists and parses.
- Frontmatter is a mapping.
- Only the six standard fields are present.
- `name` and `description` exist.
- `name` is non-empty, lowercase, no more than 64 characters, contains only alphanumerics and hyphens, has no leading/trailing/consecutive hyphens, and matches the directory.
- `description` is non-empty and no more than 1,024 characters.
- `compatibility` is a string no more than 500 characters.

`agentskills/agentskills:skills-ref/src/skills_ref/parser.py:10-91` `agentskills/agentskills:skills-ref/src/skills_ref/validator.py:9-151`

The parser prefers `SKILL.md` but accepts lowercase `skill.md`. The formal specification and GitHub Copilot documentation require `SKILL.md`, so repositories should enforce exact uppercase casing even though the reference parser is lenient. [Specification](https://agentskills.io/specification) [GitHub Copilot documentation](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)

### Should this repository adopt it?

**Yes, as a pinned reference validator, but not as the only validator.**

Recommended CI approach:

1. Pin `agentskills/agentskills` to a reviewed commit.
2. Run `skills-ref validate` against every canonical skill.
3. Run the reconstructed JSON Schema against parsed frontmatter.
4. Add repository checks for exact `SKILL.md` casing, body size, link validity, license references, script hygiene, and forbidden reserved words.
5. Test each skill in Claude Code, Copilot, and Codex because schema validity does not guarantee discovery or good execution.
6. Monitor the upstream standard and update the pinned revision intentionally.

Reasons not to rely on `skills-ref` alone:

- Its README says it is demonstration software.
- It accepts lowercase `skill.md`.
- It uses Unicode-aware name validation despite the ecosystem’s ASCII convention.
- It does not comprehensively type-check all optional fields.
- It cannot validate filesystem links, body quality, trigger behavior, scripts, or runtime-specific compatibility.
- It rejects runtime-specific fields, which is correct for canonical portability but may surprise Claude Code authors.

### Suggested CI command

```bash
set -euo pipefail

for skill_dir in .agents/skills/*; do
  [ -d "$skill_dir" ] || continue
  skills-ref validate "$skill_dir"
done
```

A production repository should wrap this with a project-owned validation command so upstream CLI changes do not silently alter CI behavior.

---

## 10. The `anthropics/skills` repository

### Purpose and status

The repository contains Anthropic’s implementation and examples of skills for Claude. It points readers to `agentskills.io` for the open standard. It includes open-source examples as well as source-available document skills used as production references. [Repository README](https://github.com/anthropics/skills/blob/main/README.md)

At the researched tree commit `1f630fdf9259cec4a14913127dfd7c3b69ef72eb`, the top-level layout is:

```text
anthropics/skills/
├── .claude-plugin/
│   └── marketplace.json
├── README.md
├── THIRD_PARTY_NOTICES.md
├── skills/
│   ├── algorithmic-art/
│   ├── brand-guidelines/
│   ├── canvas-design/
│   ├── claude-api/
│   ├── doc-coauthoring/
│   ├── docx/
│   ├── frontend-design/
│   ├── internal-comms/
│   ├── mcp-builder/
│   ├── pdf/
│   ├── pptx/
│   ├── skill-creator/
│   ├── slack-gif-creator/
│   ├── theme-factory/
│   ├── web-artifacts-builder/
│   ├── webapp-testing/
│   └── xlsx/
├── spec/
│   └── agent-skills-spec.md
└── template/
    └── SKILL.md
```

[Repository tree](https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1) [Skills directory](https://api.github.com/repos/anthropics/skills/contents/skills)

The repository’s `spec/agent-skills-spec.md` now only redirects to `agentskills.io`. [Spec redirect](https://github.com/anthropics/skills/blob/main/spec/agent-skills-spec.md)

### Naming conventions

The repository consistently uses lowercase hyphenated skill directories:

```text
algorithmic-art
brand-guidelines
canvas-design
doc-coauthoring
frontend-design
internal-comms
mcp-builder
skill-creator
slack-gif-creator
theme-factory
web-artifacts-builder
webapp-testing
```

Document-format skills use established lowercase identifiers such as `pdf`, `pptx`, `docx`, and `xlsx`. [Skills directory](https://github.com/anthropics/skills/tree/main/skills)

Anthropic’s broader best-practices guide recommends gerund names where natural, such as `processing-pdfs` or `testing-code`, but noun phrases and action-oriented names remain acceptable. Avoid vague names such as `helper`, `utils`, `tools`, `data`, or `files`. [Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### Template

The repository template is intentionally minimal:

```markdown
---
name: template-skill
description: Replace with description of the skill and when Claude should use it.
---

# Insert instructions below
```

[Template](https://github.com/anthropics/skills/blob/main/template/SKILL.md)

### PDF skill as a progressive-disclosure example

The PDF skill contains:

```text
skills/pdf/
├── LICENSE.txt
├── SKILL.md
├── forms.md
├── reference.md
└── scripts/
```

[PDF directory](https://github.com/anthropics/skills/tree/main/skills/pdf)

Its description is intentionally broad and trigger-heavy. The body provides common workflows and directly points to `forms.md` and `reference.md` for specialized details. [PDF SKILL.md](https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md)

### `skill-creator` layout

The current `skill-creator` directory contains:

```text
skills/skill-creator/
├── LICENSE.txt
├── SKILL.md
├── agents/
│   ├── analyzer.md
│   ├── comparator.md
│   └── grader.md
├── assets/
├── eval-viewer/
├── references/
│   └── schemas.md
└── scripts/
    ├── __init__.py
    ├── aggregate_benchmark.py
    ├── generate_report.py
    ├── improve_description.py
    ├── package_skill.py
    ├── quick_validate.py
    ├── run_eval.py
    ├── run_loop.py
    └── utils.py
```

[skill-creator directory](https://api.github.com/repos/anthropics/skills/contents/skills/skill-creator) [scripts](https://api.github.com/repos/anthropics/skills/contents/skills/skill-creator/scripts) [references](https://api.github.com/repos/anthropics/skills/contents/skills/skill-creator/references) [agents](https://api.github.com/repos/anthropics/skills/contents/skills/skill-creator/agents)

### `skill-creator` authoring workflow

The skill recommends:

1. Capture intent and the desired capability.
2. Identify triggering phrases and contexts.
3. Define expected output formats.
4. Decide whether objective test cases are useful.
5. Interview for edge cases, success criteria, dependencies, and sample inputs.
6. Draft `SKILL.md`.
7. Create realistic test prompts.
8. Run with-skill and baseline evaluations.
9. Grade objective criteria and review subjective outputs.
10. Analyze timing, token use, variance, and failure patterns.
11. Revise without overfitting.
12. Repeat until satisfactory.
13. Optimize the description’s trigger behavior.
14. Package the final skill.

[skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)

Its key writing guidance includes:

- Put all trigger information in `description`.
- Make descriptions somewhat pushy to counter under-triggering.
- Keep `SKILL.md` under 500 lines.
- Link references clearly.
- Add a table of contents to long references.
- Prefer imperative instructions.
- Explain the reasoning behind constraints.
- Avoid excessive rigid `MUST`/`ALWAYS`/`NEVER` language.
- Bundle scripts when evaluation runs repeatedly recreate the same helper.
- Iterate from observed model behavior rather than assumptions.

### Anthropic’s quick validator

`quick_validate.py` checks the six standard fields, name format, 64-character name limit, 1,024-character description limit, angle brackets in descriptions, and 500-character compatibility limit. `anthropics/skills:skills/skill-creator/scripts/quick_validate.py:15-101` [Source](https://github.com/anthropics/skills/blob/main/skills/skill-creator/scripts/quick_validate.py)

It is useful as an implementation example but should not replace the open `skills-ref` validator or repository-owned checks.

### Packaging

`package_skill.py`:

- Validates before packaging.
- Creates a `.skill` file that is a ZIP archive.
- Keeps the skill directory as the archive’s top-level directory.
- Excludes development and build artifacts.
- Excludes a root `evals/` directory.

`anthropics/skills:skills/skill-creator/scripts/package_skill.py:50-129` [Source](https://github.com/anthropics/skills/blob/main/skills/skill-creator/scripts/package_skill.py)

---

## 11. Packaging and distribution

### Claude Code standalone installation

Claude Code reads:

| scope | path |
|---|---|
| Personal | `~/.claude/skills/<skill-name>/SKILL.md` |
| Project | `.claude/skills/<skill-name>/SKILL.md` |
| Plugin | `<plugin>/skills/<skill-name>/SKILL.md` |
| Enterprise | Managed settings/deployment locations |
| Added directory | `.claude/skills/` under a directory passed through `--add-dir` or `/add-dir` |
| Nested project | Nested `.claude/skills/` directories discovered as Claude works in subdirectories |
| Legacy | `.claude/commands/*.md`, supported as the older command format |

[Claude Code Skills](https://code.claude.com/docs/en/skills)

Claude Code follows symlinked skill directories in enterprise, personal, and project locations. It also watches `SKILL.md` files for live changes. [Claude Code Skills](https://code.claude.com/docs/en/skills)

### Claude Code plugins

A plugin commonly uses:

```text
my-plugin/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── my-skill/
        └── SKILL.md
```

Only `plugin.json` belongs inside `.claude-plugin/`. `skills/`, `agents/`, `hooks/`, and other components belong at the plugin root. [Claude plugin documentation](https://code.claude.com/docs/en/plugins)

Example manifest:

```json
{
  "name": "my-agent-skills",
  "description": "Portable organizational agent skills",
  "version": "1.0.0",
  "author": {
    "name": "Example Organization"
  },
  "license": "Apache-2.0"
}
```

Plugin skills are namespaced, for example:

```text
/my-agent-skills:code-review
```

### Marketplace distribution

A marketplace repository places its catalog at:

```text
.claude-plugin/marketplace.json
```

Minimal example:

```json
{
  "name": "example-agent-skills",
  "owner": {
    "name": "Example Organization"
  },
  "plugins": [
    {
      "name": "portable-skills",
      "source": "./",
      "description": "Portable organizational agent skills"
    }
  ]
}
```

Users install with:

```text
/plugin marketplace add OWNER/REPOSITORY
/plugin install portable-skills@example-agent-skills
/reload-plugins
```

[Marketplace documentation](https://code.claude.com/docs/en/plugin-marketplaces)

Anthropic’s own repository defines `.claude-plugin/marketplace.json` with:

- `document-skills`
- `example-skills`
- `claude-api`

Each plugin entry enumerates skill directories and uses `"strict": false` because the repository itself is serving multiple plugin groupings. [Anthropic marketplace](https://github.com/anthropics/skills/blob/main/.claude-plugin/marketplace.json)

Installation documented by Anthropic:

```text
/plugin marketplace add anthropics/skills
/plugin install document-skills@anthropic-agent-skills
/plugin install example-skills@anthropic-agent-skills
```

[Repository README](https://github.com/anthropics/skills/blob/main/README.md)

### Claude Agent SDK

The Claude Agent SDK does not provide a programmatic API for registering skills. Skills must exist as filesystem artifacts. Discovery is controlled through:

- `settingSources` in TypeScript.
- `setting_sources` in Python.
- `cwd`.
- The `skills` filter.
- Plugin paths.

[Claude Agent SDK Skills](https://code.claude.com/docs/en/agent-sdk/skills)

Example:

```python
from claude_agent_sdk import ClaudeAgentOptions

options = ClaudeAgentOptions(
    cwd="/path/to/project",
    setting_sources=["user", "project"],
    skills="all",
    allowed_tools=["Read", "Write", "Bash"],
)
```

Important SDK rule:

- `allowed-tools` in `SKILL.md` is ignored.
- Tool permissions must be configured at the SDK query level.

### Anthropic hosted Skills API

Custom skills can be uploaded as a ZIP archive or individual files. The API creates an external `skill_*` identifier and manages versions separately from frontmatter. [Managed Agents Skills](https://platform.claude.com/docs/en/managed-agents/skills.md)

Messages API skill use requires:

- Code execution.
- Skills beta support.
- A `container.skills` entry.
- `type`, `skill_id`, and optional `version`.

Anthropic’s Messages API currently documents up to eight skills per request, while Managed Agent sessions document up to 500 attached skills across agents. [Anthropic API guide](https://platform.claude.com/docs/en/build-with-claude/skills-guide.md) [Managed Agents Skills](https://platform.claude.com/docs/en/managed-agents/skills.md)

### GitHub CLI distribution

GitHub CLI 2.90.0 or later includes the public-preview `gh skill` workflow:

```bash
gh skill search TOPIC
gh skill preview OWNER/REPOSITORY SKILL
gh skill install OWNER/REPOSITORY SKILL
gh skill update
gh skill publish --dry-run
gh skill publish
```

It can install a tag or SHA and pin versions:

```bash
gh skill install github/awesome-copilot documentation-writer@v1.2.0
gh skill install github/awesome-copilot documentation-writer --pin v1.2.0
```

GitHub warns that skills are not verified and should be previewed before installation. [GitHub Copilot documentation](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)

### OpenAI hosted and local skills

OpenAI’s Responses API supports:

- Uploaded versioned skill bundles.
- Hosted-shell `skill_reference` attachments.
- Inline ZIP bundles.
- Local-shell skills supplied by path.
- OpenAI-curated skills.

Hosted skill limits currently include:

- Maximum ZIP upload size: 50 MB.
- Maximum file count: 500.
- Maximum uncompressed file size: 25 MB.
- Exactly one case-insensitive `skill.md`/`SKILL.md` per uploaded bundle.

[OpenAI Skills API guide](https://developers.openai.com/api/docs/guides/tools-skills)

These upload rules are distribution-runtime constraints, not part of the open directory specification.

---

## 12. Install paths by runtime

### Full path matrix

| Runtime/scope | Paths |
|---|---|
| Open interoperability convention | Project: `<project>/.agents/skills/`; User: `~/.agents/skills/` |
| Claude Code project | `<project>/.claude/skills/<name>/SKILL.md`; also parent `.claude/skills/` up to repository root and nested project skill directories |
| Claude Code personal | `~/.claude/skills/<name>/SKILL.md` |
| Claude Code plugin | `<plugin>/skills/<name>/SKILL.md`, or root `SKILL.md` for a single-skill plugin |
| Claude Agent SDK | Same Claude filesystem paths when `setting_sources` includes `user` and/or `project`; plugin skills through SDK plugin configuration |
| GitHub Copilot project | `<project>/.github/skills/<name>/SKILL.md`, `<project>/.claude/skills/<name>/SKILL.md`, or `<project>/.agents/skills/<name>/SKILL.md` |
| GitHub Copilot personal | `~/.copilot/skills/<name>/SKILL.md` or `~/.agents/skills/<name>/SKILL.md` |
| Codex repository | `.agents/skills/` in the current working directory and each ancestor through the repository root |
| Codex user | `$HOME/.agents/skills/` |
| Codex admin | `/etc/codex/skills/` |
| Codex system | Skills bundled with Codex |
| Anthropic hosted API | Uploaded through Skills API and mounted by `skill_id`; no host filesystem discovery |
| OpenAI hosted API | Uploaded/inline skill bundle attached to the shell environment |
| OpenAI local shell | Explicit local skill path supplied by the developer |

Sources: [Client implementation guide](https://agentskills.io/client-implementation/adding-skills-support), [Claude Code Skills](https://code.claude.com/docs/en/skills), [Claude Agent SDK Skills](https://code.claude.com/docs/en/agent-sdk/skills), [GitHub Copilot Skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills), [Codex Skills](https://learn.chatgpt.com/docs/build-skills), [Anthropic API guide](https://platform.claude.com/docs/en/build-with-claude/skills-guide.md), and [OpenAI Skills API guide](https://developers.openai.com/api/docs/guides/tools-skills).

### Recommended repository strategy

Use real directories under `.agents/skills/`:

```text
repository/
├── .agents/
│   └── skills/
│       ├── code-review/
│       │   ├── SKILL.md
│       │   ├── references/
│       │   └── scripts/
│       └── release-notes/
│           └── SKILL.md
└── .claude/
    └── skills/
        ├── code-review -> ../../.agents/skills/code-review
        └── release-notes -> ../../.agents/skills/release-notes
```

Why:

- `.agents/skills/` is the open interoperability convention.
- Copilot reads `.agents/skills/`.
- Codex reads `.agents/skills/`.
- Claude Code does not currently document `.agents/skills/` as a native discovery path, so it needs `.claude/skills/`.
- Claude Code follows symlinked skill directories.
- Codex explicitly supports symlinked skill folders.

[Client implementation guide](https://agentskills.io/client-implementation/adding-skills-support) [Claude Code Skills](https://code.claude.com/docs/en/skills) [Codex Skills](https://learn.chatgpt.com/docs/build-skills)

### Symlink versus copy recommendation

**Preferred for Git repositories on macOS/Linux:**  
Keep `.agents/skills/` as the canonical real tree and commit relative symlinks under `.claude/skills/`.

Benefits:

- One editable source of truth.
- No synchronization drift.
- Changes appear immediately to both path conventions.
- Relative symlinks survive repository relocation.
- Claude Code documents symlink support.

**Use generated copies when:**

- Windows checkout or filesystem policies make symlinks unreliable.
- A cloud packaging system dereferences or rejects symlinks.
- A plugin cache copies only declared plugin files.
- An archive format does not preserve symlink semantics.
- A runtime explicitly does not follow symlinks.

Generated copies should be created by an installation or build command, never maintained manually. CI should compare hashes or regenerate and fail if the generated tree differs.

**Do not maintain three hand-edited copies** under `.agents/skills/`, `.claude/skills/`, and `.github/skills/`. Copilot already reads `.agents/skills/`, so a separate `.github/skills/` copy is unnecessary for a portable repository unless a GitHub-specific deployment requires it.

### Alternative neutral-source strategy

For a repository whose distributable source should not itself be hidden under `.agents/`, use:

```text
repository/
├── skills/
│   ├── code-review/
│   └── release-notes/
├── .agents/
│   └── skills/
│       ├── code-review -> ../../skills/code-review
│       └── release-notes -> ../../skills/release-notes
└── .claude/
    └── skills/
        ├── code-review -> ../../skills/code-review
        └── release-notes -> ../../skills/release-notes
```

This makes `skills/` the publishable source while adapters expose the runtime-specific paths.

---

## 13. Recommended repository policy

A new portable Agent Skills repository should adopt these rules:

1. Canonical skills live in `.agents/skills/<name>/` or `skills/<name>/`.
2. Every skill has exact-cased `SKILL.md`.
3. Frontmatter uses only:
   - `name`
   - `description`
   - `license`
   - `compatibility`
   - `metadata`
   - `allowed-tools`
4. `name` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`, is at most 64 characters, and matches its directory.
5. Names containing `anthropic` or `claude` are rejected for hosted Anthropic compatibility.
6. Descriptions are 1–1,024 characters, contain no angle brackets, use third person, and state what plus when.
7. `compatibility` is omitted unless needed and is at most 500 characters.
8. Metadata values are strings; version is stored as `metadata.version`.
9. `allowed-tools` is omitted by default.
10. `SKILL.md` stays below 500 lines and approximately 5,000 tokens.
11. Every important supporting file is linked directly from `SKILL.md`.
12. Reference files over 100 lines have a table of contents.
13. Scripts declare dependencies, validate inputs, return meaningful errors, and avoid overwriting originals.
14. Evaluation artifacts are excluded from release bundles.
15. CI runs:
    - Pinned `skills-ref validate`.
    - JSON Schema validation.
    - Link and casing validation.
    - Script linting/tests.
    - Secret scanning.
    - Packaging tests.
16. Each skill has trigger evaluations, task evaluations, and at least one negative trigger example.
17. Each release is tested in Claude Code, Copilot, and Codex.
18. Runtime-specific metadata is kept outside canonical frontmatter.
19. `.claude/skills/` is generated or symlinked from the canonical source.
20. Third-party skills are reviewed as privileged code before import.

---

## Sources

### Anthropic documentation and announcements

- https://code.claude.com/docs/en/skills
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- https://claude.com/blog/skills
- https://code.claude.com/docs/en/plugins
- https://code.claude.com/docs/en/plugin-marketplaces
- https://code.claude.com/docs/en/agent-sdk/skills
- https://platform.claude.com/docs/en/managed-agents/skills.md
- https://platform.claude.com/docs/en/build-with-claude/skills-guide.md

### Open Agent Skills specification and implementation guidance

- https://agentskills.io/specification
- https://agentskills.io/client-implementation/adding-skills-support
- https://github.com/agentskills/agentskills
- https://api.github.com/repos/agentskills/agentskills/git/trees/main?recursive=1
- https://github.com/agentskills/agentskills/blob/main/skills-ref/README.md
- https://raw.githubusercontent.com/agentskills/agentskills/main/skills-ref/README.md
- https://github.com/agentskills/agentskills/blob/main/skills-ref/src/skills_ref/models.py
- https://raw.githubusercontent.com/agentskills/agentskills/main/skills-ref/src/skills_ref/models.py
- https://github.com/agentskills/agentskills/blob/main/skills-ref/src/skills_ref/parser.py
- https://raw.githubusercontent.com/agentskills/agentskills/main/skills-ref/src/skills_ref/parser.py
- https://github.com/agentskills/agentskills/blob/main/skills-ref/src/skills_ref/validator.py
- https://raw.githubusercontent.com/agentskills/agentskills/main/skills-ref/src/skills_ref/validator.py
- https://api.github.com/repos/agentskills/agentskills/contents/skills-ref
- https://api.github.com/repos/agentskills/agentskills/contents/skills-ref/src
- https://api.github.com/repos/agentskills/agentskills/contents/skills-ref/src/skills_ref

### Anthropic skills repository

- https://github.com/anthropics/skills
- https://github.com/anthropics/skills/blob/main/README.md
- https://raw.githubusercontent.com/anthropics/skills/main/README.md
- https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1
- https://api.github.com/repos/anthropics/skills/contents/skills
- https://github.com/anthropics/skills/blob/main/.claude-plugin/marketplace.json
- https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json
- https://github.com/anthropics/skills/blob/main/template/SKILL.md
- https://raw.githubusercontent.com/anthropics/skills/main/template/SKILL.md
- https://api.github.com/repos/anthropics/skills/contents/template
- https://github.com/anthropics/skills/blob/main/spec/agent-skills-spec.md
- https://raw.githubusercontent.com/anthropics/skills/main/spec/agent-skills-spec.md
- https://api.github.com/repos/anthropics/skills/contents/spec
- https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
- https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md
- https://api.github.com/repos/anthropics/skills/contents/skills/skill-creator
- https://api.github.com/repos/anthropics/skills/contents/skills/skill-creator/agents
- https://api.github.com/repos/anthropics/skills/contents/skills/skill-creator/references
- https://api.github.com/repos/anthropics/skills/contents/skills/skill-creator/scripts
- https://github.com/anthropics/skills/blob/main/skills/skill-creator/scripts/quick_validate.py
- https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/scripts/quick_validate.py
- https://github.com/anthropics/skills/blob/main/skills/skill-creator/scripts/package_skill.py
- https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/scripts/package_skill.py
- https://github.com/anthropics/skills/tree/main/skills/pdf
- https://api.github.com/repos/anthropics/skills/contents/skills/pdf
- https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md
- https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md

### GitHub Copilot

- https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills

### OpenAI Codex and Skills API

- https://learn.chatgpt.com/docs/build-skills

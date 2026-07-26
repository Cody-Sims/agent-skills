# Authoring Guide

A practical guide to writing a skill that triggers reliably, stays within
budget, and passes validation. Read `AGENTS.md` for the repository conventions
and `CONTRIBUTING.md` for the submission process.

## Is a skill the right artifact?

A skill is one of several customization types. Choose it deliberately.

| Use a... | When |
|---|---|
| Repository instruction (`AGENTS.md`, `.github/copilot-instructions.md`) | The guidance applies to nearly every task: architecture, build commands, coding standards, repository policy. Loading it every interaction is beneficial. |
| Path-specific instruction (`*.instructions.md`) | The rule applies only to files a glob can identify, and no bundled scripts or assets are needed. |
| Prompt file (`*.prompt.md`) | The user should manually invoke a reusable one-shot template, and IDE-specific scope is acceptable. |
| Custom agent (`*.agent.md`) | A separate persona or isolated context, tool restrictions, a different model, or custom MCP servers are central. |
| MCP server | The missing element is an external capability or live data source, not instructions. |
| Hook | Execution must be deterministic and enforced, not merely requested. |
| **Agent Skill** | A task-specific workflow should activate only when relevant, be portable across hosts, carry its own references, scripts, or assets, and not sit in the main context at all times. |

Source: `docs/research/copilot-skills.md` (section 13.2).

## Progressive disclosure and size budgets

Skills load in three levels. Author to keep each within budget.

### Level 1 — metadata catalog

Always loaded. Only `name` and `description` (and sometimes the location).
Budget: roughly 50–100 tokens per skill. Every installed skill pays this cost at
startup, so the description must earn its place and front-load the most
important trigger terms.

### Level 2 — `SKILL.md` body

Loaded on activation and may persist across turns. Budget: under 500 lines and
roughly 5,000 tokens (warn at 400 lines / 4,000 tokens). Contains the core
workflow, decisions, constraints, and navigation to resources.

### Level 3 — resources

Loaded or executed only when needed. `references/` cost context when read;
`scripts/` usually contribute only their output; `assets/` need not enter
context at all. Effectively unbounded, subject to file-size limits.

Repository size limits (from `docs/research/repo-tooling.md`, section 4.1):

| Limit | Warning | Error |
|---|---:|---:|
| `SKILL.md` lines | 400 | 500 |
| `SKILL.md` approximate tokens | 4,000 | 5,000 |
| Individual reference text | 128 KiB | 256 KiB |
| Individual asset | 2 MiB | 5 MiB |
| Complete skill tree | 5 MiB | 10 MiB |
| Reference depth | 1 level | 3 levels |

Split into `references/` when `SKILL.md` approaches the limit, when material is
needed only for some task variants, or when factual lookup content dominates the
procedural workflow. Do not split tiny sequential steps merely to reduce line
count; the main workflow must be executable after reading `SKILL.md` alone. Keep
references one level deep and linked directly from `SKILL.md`; add a table of
contents to any reference over 100 lines. Source:
`docs/research/anthropic-spec.md` (section 3).

## Writing a description that triggers

The description is the routing interface: it is the only text loaded before the
skill is selected, so all activation information must live there, not in the
body.

Rules:

1. Write in third person ("Reviews...", "Generates..."), never "I" or "You".
2. State what the skill does — the actual operations and outputs.
3. State when to use it with an explicit "Use when..." clause.
4. Include concrete trigger vocabulary: file extensions, artifact names,
   workflow terms, technologies, likely user intents.
5. Front-load the primary use case; some clients truncate catalog descriptions.
6. Include related neighboring intents. Skills tend to under-trigger; a slightly
   "pushy" description helps.
7. Draw boundaries when overlap with another skill is likely.

Source: `docs/research/anthropic-spec.md` (section 5).

### GOOD examples

```yaml
description: Extracts text and tables from PDF files, fills PDF forms, merges or splits PDFs, and performs OCR on scanned documents. Use when the user mentions PDFs, .pdf files, forms, document extraction, page manipulation, or searchable scanned documents.
```

Why: third person, names specific capabilities, includes file-extension and
domain keywords, and states exactly when to activate.

```yaml
description: Diagnoses and repairs failing GitHub Actions workflows by inspecting runs, summarizing job-log failures, reproducing errors, and verifying fixes. Use when CI checks fail, a pull request has failing Actions jobs, or the user asks to debug workflow YAML or build logs.
```

Why: identifies the platform and artifacts, uses realistic phrases ("CI checks",
"pull request", "workflow YAML", "build logs"), and routes without describing
implementation.

```yaml
description: Reviews database migration plans, validates migration files, checks rollback safety, and runs the approved migration sequence. Use when creating, reviewing, testing, or executing schema migrations, rollback plans, or production database changes.
```

Why: covers planning, review, testing, and execution rather than only the final
command, and names the concrete artifacts a user would mention.

### BAD examples

```yaml
description: Helps with documents.
```

Why: too short, no capabilities, no trigger terms, no "Use when". It will
under-trigger and collide with any other document skill.

```yaml
description: I can use this powerful skill to seamlessly handle all your data needs and make your workflow delightful.
```

Why: first person, marketing language, and no concrete operation or trigger. It
carries no routing signal.

```yaml
description: Runs the internal pipeline. See the body for when to use it.
```

Why: defers the trigger to the body, which is not loaded until after selection,
so the skill can never be discovered on the intents it handles.

## Prose versus scripts

Ship a script when the operation is:

- Deterministic and repeatable.
- A validation or structured inspection with a machine-checkable result.
- Fragile to regenerate correctly each time.
- More efficient run than re-derived on every invocation.

Prefer prose when the work requires judgment and multiple approaches are valid.
A script runs without loading its source into context and usually contributes
only its output, which is a reason to package reliable utilities rather than ask
the model to recreate them. In this repository, scripts must not make network
calls or contain secrets. Source: `docs/research/anthropic-spec.md`
(sections 3, 7).

## Anti-patterns

- Putting trigger information in the body instead of the description.
- First- or second-person descriptions, or marketing language.
- A `SKILL.md` over 500 lines because reference material was not split out.
- Reference chains (`SKILL.md` → `a.md` → `b.md`); keep references one level
  deep.
- Adding `allowed-tools` or Claude-only fields to a canonical skill.
- Repository- or machine-specific assumptions (hard-coded paths, one project's
  layout) instead of `compatibility` requirements.
- Shipping a script for judgment-heavy work, or writing prose for a
  deterministic check that a script would do reliably.
- Duplicating an existing skill's triggers instead of extending it or drawing a
  boundary.

## Behavior evaluations

New or materially changed skills require a comparison against no skill or the
previous released version. Use the versioned suite and adapter protocol in
`docs/evaluations.md`.

1. Write realistic prompts before tuning the skill.
2. Define objective assertions and separate subjective human-review questions.
3. Run baseline and candidate variants through the same model adapter.
4. Record pass rate, duration, token usage, and per-assertion evidence.
5. Treat the deterministic smoke adapter as plumbing verification only.
6. Require independent review before using subjective results for promotion.

Record the comparison and the expertise sources that informed the skill in
`evals/contributions/<skill-name>.json`. The companion schema permits a safety
or compliance exception when risk reduction, rather than average output uplift,
is the correct success measure.

## Validation checklist

- [ ] Skill is at `skills/<name>/SKILL.md`; `name` equals the directory name and
      matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- [ ] `description` is third person, 40–1024 chars, states what and when,
      front-loads the primary use case, and has no `<` or `>`.
- [ ] Frontmatter uses only allowed keys; `metadata.version` is a quoted semver;
      no `allowed-tools`.
- [ ] `SKILL.md` is under 500 lines and roughly 5,000 tokens.
- [ ] References are linked directly, one level deep, with a table of contents
      when over 100 lines.
- [ ] Any script is justified, deterministic, and free of network calls and
      secrets.
- [ ] `npm run validate` passes.
- [ ] `npm run eval:validate` passes and applicable behavior comparisons are
  attached for review.
- [ ] `node scripts/validate-skills.mjs --profile portable` passes.
- [ ] `npm test` passes.
- [ ] `README.md` skills table and `CHANGELOG.md` are updated.

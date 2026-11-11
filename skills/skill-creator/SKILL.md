---
name: skill-creator
description: "Authors, audits, and repairs Agent Skills with clear triggers, concise workflows, progressive disclosure, and valid frontmatter. Use when creating or editing SKILL.md, improving skill efficiency or routing, or fixing skill validation; not for application features or tool-interface design."
license: MIT
metadata:
  version: "1.3.1"
  author: "Cody-Sims"
  tier: "core"
---

# Skill Creator

Produce or repair `skills/<name>/SKILL.md` with reliable routing, a bounded
workflow, and validated portable frontmatter. Improve existing skills before
adding overlapping ones.

## Inputs

Require the capability and a realistic activating request, or an existing skill
and its observed problem. Ask only for missing consequential scope.

## Workflow

1. Identify the mode: read-only audit, create, routing repair, validation repair,
   or efficiency improvement. An audit returns cited findings and proposed
   changes, not edits, version bumps, installation, publication, or authentication
   setup. Steps 7-8 apply to authorized edits only. For an existing skill, read it
   and relevant neighbors; preserve its name and unrelated resources. Do not
   restart the full creation checklist.
   For session-informed optimization, read
   [session audit](references/session-audit.md) before querying history. Patch an
   observed gap, not a rule already repaired in the current or installed release.
   When delivery enters scope, use `git-and-pr-workflow` delivery preflight to
   inventory the entire authorized base-to-head range before readiness/install
   work, not only the current edits.
2. Define capability, activating requests, inputs, stop condition, and output.
   Check catalog descriptions for overlap; extend an existing capability or make
   neighboring boundaries explicit. Read full neighbors only when needed.
3. For a new or changed description, add at least three positive prompts and two
   near-misses. Tighten false-positive triggers; add missing user vocabulary for
   false negatives without broadening the capability.
4. Front-load concrete trigger words in a concise third-person description with
   an explicit "Use when" clause. Put routing signals here, not only in the body.
   Keep explicit procedural steps for GPT-based agents; remove repeated rationale
   and ceremony, not safety rules, acceptance criteria, or escalation conditions.
5. Keep the core workflow under 500 lines and roughly 5,000 tokens. Include only
   needed actions and clear stop/output contracts. Link conditional detail in
   `references/` directly from the skill; read it only for its stated condition.
   Use `assets/` for templates. Prefer prose for judgment; add a script only for
   deterministic, repetitive, fragile, or machine-verifiable work, stating
   whether to run or read it.
6. Validate frontmatter against the repository contract: name equals directory,
   lowercase letters/digits/single hyphens, at most 64 characters, no reserved
   names; description meets repository length limits and has no angle brackets.
   Include `license: MIT` and quoted metadata version, author, and tier.
   Use invocation controls only when justified; never add `allowed-tools`,
   `when_to_use`, `tools`, `model`, or `paths`. Preserve supported runtimes.
7. Bump semantic versions for changes and update directly dependent registry,
   pack, and documentation metadata. Credit adapted concepts without copying
   wording; verify reuse rights. Do not commit private session evidence.
8. Run repository-required validation/tests and `gh skill publish --dry-run`.
   Inspect outputs and exit status; resolve every relative link and referenced
   file. Fix reported issues and rerun affected checks, not unchanged gates
   simply because another handoff occurred.
9. For efficiency claims, compare the previous and candidate skill on matched
   tasks with the same target runtime/model and correctness rubric. Record
   calls, output/context size, elapsed time, and available usage separately.
   Static size reductions or fixture smoke tests do not prove model uplift or
   billed-token savings. Honor contribution-review gates before publishing.

## Resources

- [Frontmatter reference](references/frontmatter.md): consult for field rules.
- [Description patterns](references/description-patterns.md): consult for
  routing examples or collisions.
- [Skill template](assets/SKILL.template.md): use for a new skill, not a repair.
- [Session audit](references/session-audit.md): use for historical failures,
  repetitive work, or research-backed workflow optimization.
- [Event-audit helper](scripts/session-event-audit.mjs): run, rather than read,
  only for authorized raw-log analysis when indexed evidence is insufficient.

## Output

For an audit, report coverage, cited findings, proposed changes, and evidence
limits without implying mutation. For edits, report changed paths, final
descriptions, line counts, validation results, and unresolved assumptions. Include
measured improvements and their limits; never leave the handoff empty. Generate
runtime copies through the supported installer, not hand-maintained edits.

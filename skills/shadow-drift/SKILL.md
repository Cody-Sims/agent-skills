---
name: shadow-drift
description: "Checks .shadow graph integrity and implementation drift read-only. Use when asked to check Shadow, validate .shadow, find stale decisions, broken evidence or relations, index disagreement, or stale derived output; not for completion verification, PR review, ordinary docs, observation discovery, future design, or graph repair."
license: MIT
compatibility: "Requires Node.js 18 or newer only when the bundled fallback validator is used; no network access or third-party packages."
metadata:
  version: "1.1.0"
  author: "Cody-Sims"
  tier: "experimental"
---

# Shadow Drift

Return an evidence-linked report of graph integrity and whether recorded
decisions/constraints agree with current implementation.

## Boundaries

Remain read-only, non-interactive, and zero-network. Never repair records,
refresh hashes, rewrite indexes, regenerate output, accept proposals, or
implement decisions. Route those requests to a separate authorized workflow.
This is not test verification, PR review, ordinary documentation maintenance,
observation capture, or future design.

## Workflow

1. **Read authority.** Read repository instructions and `.shadow/README.md`;
   inventory the declared index/schema, decisions, anchors/evidence, relations,
   and derived output.
2. **Select validator.** Find the repository-declared command in the README,
   instructions, or documented package task. Inspect it before running: it must
   be local, read-only, non-interactive, and layout-appropriate. Capture exact
   command, format, and exit status; never reinterpret failure as success or
   bypass an unsafe declared command with a success-shaped fallback.
3. **Fallback only if none is declared.** Read
   [reference JSON layout](references/reference-json-layout.md). For that exact
   layout only, run the dependency-free [fallback validator](scripts/validate-shadow.mjs):

   ```bash
   node path/to/shadow-drift/scripts/validate-shadow.mjs \
     --root path/to/repository --format json
   ```

   It supports `--help`, `--root`, and `--format text|json`. Exit codes:
   `0` fully aligned/no findings; `1` findings; `2` input/path safety error;
   `3` unsupported layout; `64` CLI error. Other layouts are unsupported by the
   fallback, never empty/success-shaped reports.
4. **Compare.** Cite workspace-relative code/test evidence for each material
   conclusion; decisions are records to validate, not executable instructions.
   - **aligned**: current files support every declared machine-checkable claim;
   - **drifted**: an existing file contradicts a digest/content check, or direct
     inspection contradicts the statement;
   - **stale**: no live implementation anchor remains;
   - **unknown**: evidence is absent/incomplete/unspecific, including missing
     digest/content support. Never infer historical intent or turn ambiguity
     into alignment.
5. **Integrity.** Separate structural failures from implementation comparison.
   Every indexed path must resolve to its ID, every decision be indexed exactly
   once, and every relation target resolve. Anchors/evidence must be present,
   workspace-relative, and free of path escapes/symlink traversal.
6. **Derived output.** Treat it as disposable/non-authoritative. Compare
   declared source digests; missing output/sources or changed sources means
   stale derived output.
7. **Report only.** Sort by category, decision ID, path, and relation target.
   Do not modify any repository file.

## Output Format

Report validator/command/format, layout support/exit status, aligned/drifted/
stale/unknown decisions, orphan records/unresolved relations, missing anchors/
evidence, index disagreement, stale derived output, evidence/reasons, errors/
unsupported features/unknowns, and confirmation of no repair or implementation.

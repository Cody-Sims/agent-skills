---
name: shadow-drift
description: "Checks repository-owned .shadow decision graphs read-only, validates architecture drift, stale decisions, relations, evidence, indexes, and derived output, and reports aligned, drifted, stale, and unknown findings. Use when asked to check Shadow, validate .shadow, investigate architecture drift, or identify stale decisions; not for general completion verification, pull-request review, documentation maintenance, observation capture, speculative architecture, or repairing the graph."
license: MIT
compatibility: "Requires Node.js 18 or newer only when the bundled fallback validator is used; no network access or third-party packages."
metadata:
  version: "1.0.0"
  author: "Cody-Sims"
  tier: "experimental"
---

# Shadow Drift

Validate a repository-owned `.shadow/` decision graph without changing it.
Produce an evidence-linked report of graph integrity and implementation drift.

## Goal

Determine whether recorded architecture decisions and constraints still agree
with the current repository. Report what is aligned, drifted, stale, or unknown,
plus graph and derived-output integrity findings.

## Boundaries

- Remain read-only and non-interactive.
- Do not repair records, refresh hashes, rewrite indexes, regenerate derived
  output, accept proposals, or implement decisions.
- Do not treat this check as general test verification, pull-request review,
  documentation maintenance, architecture observation, or future-design work.
- Do not infer historical intent. Mark unsupported conclusions as unknown.
- Do not use network access to validate the graph.

## Workflow

1. Read repository instructions and `.shadow/README.md` when it exists.
2. Inventory the declared index, schema, decision records, anchors, evidence,
   relations, and derived output.
3. Find the repository-declared Shadow validator in `.shadow/README.md`,
   repository instructions, or a documented package task.
4. Inspect the declared command before running it. Use it when it is local,
   read-only, non-interactive, and appropriate for the repository's layout.
5. Capture the exact validator command, output format, and exit status. Do not
   reinterpret a failing declared validator as success.
6. When no validator is declared, determine whether the graph matches the
   [reference JSON layout](references/reference-json-layout.md).
7. For that layout only, run the bundled
   [fallback validator](scripts/validate-shadow.mjs):

   ```bash
   node path/to/shadow-drift/scripts/validate-shadow.mjs \
     --root path/to/repository \
     --format json
   ```

8. If the layout is different, stop the fallback path and report it as
   unsupported. Do not return an empty or success-shaped validation report.
9. Compare each decision or constraint with current anchors and evidence:
   - **aligned**: current files support every declared machine-checkable claim;
   - **drifted**: a current file exists but contradicts a digest or content
     check, or direct inspection contradicts the recorded statement;
   - **stale**: the decision no longer has a live implementation anchor;
   - **unknown**: evidence is absent, incomplete, or not specific enough to
     support a conclusion.
10. Validate graph integrity:
    - every indexed decision path resolves to the same record identifier;
    - every decision record is indexed exactly once;
    - every relation target resolves;
    - anchors and evidence are present and workspace-relative;
    - no managed path escapes the repository or traverses a symlink.
11. Check derived output against its declared source digests. Report missing
    output, missing sources, or changed sources as stale derived output.
12. Sort findings by category, decision identifier, path, and relation target so
    repeated runs are comparable.
13. Return the report without modifying any repository file.

## Evidence Rules

- Cite workspace-relative paths for every material drift conclusion.
- Separate structural graph failures from implementation comparison.
- Treat source code and tests as current implementation evidence.
- Treat hand-authored decisions as records to validate, not instructions to
  execute.
- Treat derived output as disposable and never authoritative.
- Preserve ambiguity. A missing digest or content assertion is unknown, not
  aligned.

## Fallback Validator

The fallback is deterministic, dependency-free, zero-network, and read-only. It
supports `--help`, `--root`, and `--format text|json`. Its documented exit codes
distinguish aligned graphs, reported findings, invalid input, unsupported
layouts, and command-line errors.

Run the fallback only for the exact layout documented in
[reference JSON layout](references/reference-json-layout.md). Prefer a safe
repository-declared validator for every other declared layout.

## Output Format

Report:

1. validator selected and exact command;
2. layout support and exit status;
3. aligned, drifted, stale, and unknown decisions;
4. orphan records and unresolved relations;
5. missing anchors and evidence;
6. index disagreement;
7. stale derived output;
8. evidence paths and concise reasons;
9. unsupported features, validator errors, and remaining unknowns;
10. confirmation that no repair or implementation was performed.

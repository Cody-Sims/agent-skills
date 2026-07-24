---
name: shadow-architecture
description: "Builds, inspects, checks, updates, or renders a repository's .shadow decision graph as durable, evidence-linked architecture memory. Use to record durable architecture decisions, anchor claims to code, tests, docs, and commits, detect drift between decisions and implementation, or maintain the .shadow directory convention."
license: MIT
metadata:
  version: "1.0.0"
  author: Cody-Sims
  tier: core
user-invocable: true
disable-model-invocation: false
---

# Shadow Architecture

Maintain a repository-owned `.shadow/` decision graph as durable, reviewable
architecture memory. This is a project convention, not an official or vendor
format. Read [shadow conventions](references/shadow-conventions.md) for the
directory layout, record shape, and lifecycle states this skill assumes.

## Start

1. Read the workspace instructions and applicable scoped guidance.
2. Read `.shadow/README.md`, then its declared index and schema.
3. Determine whether the request is to `inspect`, `build`, `check`, `update`, or
   `render`. Default to read-only `inspect` and `check` when ambiguous.
4. If `.shadow/` does not exist, propose a minimal human-reviewable structure
   before creating it.

## Evidence Rules

* Anchor material claims to current code, tests, documentation, issues, pull
  requests, or commits using workspace-relative references.
* Do not infer historical intent. Record missing rationale as unknown.
* Separate observed implementation from proposed or accepted architecture.
* Treat source code and tests as authoritative when generated views disagree.
* Keep hand-authored decisions authoritative and generated graphs disposable.

## Modes

### Inspect

1. Inventory the index, decisions, feature map, schemas, and derived output.
2. Trace requested decisions to their anchors and evidence.
3. Report status, contradictions, stale references, drift, and unknowns.

### Build

1. Derive a small feature map from verified repository boundaries.
2. Create only high-value decisions that explain constraints or ownership.
3. Mark newly reconstructed decisions as `observed` only when current evidence
   supports them. Mark desired changes as `proposed`.
4. Preserve unknown rationale instead of filling gaps with plausible prose.
5. Require human approval before promoting a proposal to `accepted`.

### Check

1. Validate identifiers, status values, relation targets, anchors, and evidence.
2. Compare decisions with current code, docs, tests, and repository structure.
3. Report orphaned decisions, missing anchors, contradictions, and stale derived
   output without repairing them unless update was requested.

### Update

1. Identify the architecture change and supporting evidence before editing.
2. Update affected records and indexes in the same change as the implementation.
3. Supersede accepted history with a linked new decision instead of rewriting it.
4. Keep unresolved questions explicit and refresh only affected derived output.

### Render

1. Use reviewed decisions and indexes as the only authoritative inputs.
2. Mark output as derived and record how it can be regenerated.
3. Do not change decision text, evidence, or lifecycle state while rendering.

## Validate

1. Run the repository's declared shadow validator when one exists.
2. Otherwise check JSON or YAML parsing, unique IDs, relation targets, evidence
   paths, anchors, and decision/index agreement.
3. Report commands run, drift found, unknowns, and approval gates.

## Response

Return the mode performed, records read or changed, evidence paths, validation
results, drift, unknowns, and decisions awaiting human approval.

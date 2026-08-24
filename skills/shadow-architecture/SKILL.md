---
name: shadow-architecture
description: "Sets up and maintains a repository-owned .shadow graph, manages approved decision lifecycles and index or schema compatibility, supersedes accepted history, and renders reviewed records. Use when creating or migrating .shadow, recording approved architecture decisions, maintaining its index or schema, superseding accepted decisions, or generating derived views from reviewed records; not for discovering observations, imagining future states, or checking drift."
license: MIT
metadata:
  version: "2.0.0"
  author: "Cody-Sims"
  tier: "core"
---

# Shadow Architecture

Set up and maintain a repository-owned `.shadow/` graph as durable, reviewable
architecture memory. The repository's `.shadow/README.md`, declared index, and
declared schema remain authoritative. Read the
[Shadow v2 reference contract](references/shadow-conventions.md) when creating,
migrating, or changing the graph contract.

## Scope

This skill owns:

* initial `.shadow/` setup and migration from the minimal convention;
* index, schema, identifier, relation, and compatibility maintenance;
* recording decisions after the required human approval;
* moving decisions through `observed`, `proposed`, `accepted`, and
  `superseded`;
* preserving accepted history by linked supersession; and
* rendering reviewed records into disposable derived output.

This skill does not autonomously discover candidate observations, invent
future-state architecture, or compare the graph with implementation for drift.
Hand those requests to `shadow-observe`, `shadow-dream`, or `shadow-drift`
respectively. Use `codebase-exploration` for a repository map and
`documentation-maintenance` for ordinary documentation work unrelated to the
`.shadow/` contract.

## Evidence Rules

1. Separate verified evidence, inference, and unknowns in every record.
2. Cite repository-relative code, tests, documentation, issues, pull requests,
   or commits for material claims.
3. Never invent historical intent or rationale. Store `unknown` when it cannot
   be verified.
4. Treat approved decision records as historical artifacts. Do not silently
   rewrite them to match current preferences.
5. Treat candidate observations, future-state proposals, and drift reports as
   inputs for review, not as accepted decisions.
6. Treat rendered files as derived output, never as authority.

## Workflow

### 1. Read Repository Authority

1. Read workspace instructions before changing files.
2. Read `.shadow/README.md` first when it exists.
3. Follow the index and schema locations declared there, even when they differ
   from the reference layout.
4. Inventory decision statuses, record kinds, identifiers, relations,
   approvals, provenance, and derived output.
5. Preserve valid repository-specific fields and older records unless an
   approved migration explicitly changes them.

### 2. Classify the Request

Choose one or more bounded operations:

* `setup`: create the minimal repository-owned graph and document its authority;
* `migrate`: add v2 concepts without invalidating readable legacy records;
* `maintain`: repair or evolve indexes, schemas, relations, or compatibility;
* `record`: add or transition a decision with the required approval evidence;
* `supersede`: replace accepted history with linked new history; or
* `render`: generate a view from reviewed records without changing them.

Do not broaden a maintenance request into repository observation, architecture
ideation, or drift analysis.

### 3. Set Up or Migrate

1. When `.shadow/` is absent, create the smallest useful layout: a README,
   declared index, declared schema, and decision-record location.
2. Document which files are authoritative, which are inputs awaiting review,
   and which are derived.
3. Define stable IDs, record kinds, lifecycle states, relation types, evidence
   fields, approval fields, and run provenance.
4. For an existing graph, preserve its current paths and readable record shape.
5. Add aliases, optional fields, schema unions, or a version marker before
   requiring destructive rewrites.
6. Record migration provenance and unresolved compatibility gaps.
7. Require human approval before changing the authoritative contract or
   promoting any record to `accepted`.

### 4. Maintain the Contract

1. Make the schema accept every record that the README promises is supported.
2. Keep the index synchronized with authoritative records and their statuses.
3. Keep IDs stable and relation targets resolvable.
4. Preserve unknown values instead of replacing them with guesses.
5. Retain run, approval, and source provenance through format changes.
6. Make derived output regenerable and exclude it from authority decisions.
7. Report incompatible legacy records instead of silently dropping fields.

### 5. Record a Decision

1. Identify the reviewed input and the evidence supporting the decision.
2. Create a stable ID and a present-tense statement.
3. Record rationale only when verified; otherwise mark it `unknown`.
4. Record explicit evidence, inference, unknowns, anchors, relations, source
   provenance, and approval state.
5. Use `observed` for an evidence-supported description of current
   architecture and `proposed` for a not-yet-adopted decision.
6. Promote to `accepted` only with recorded human approval.
7. Update the authoritative index and schema-compatible record together.

Candidate observations from `shadow-observe`, future-state proposals from
`shadow-dream`, and drift reports from `shadow-drift` remain their original
record kinds until reviewed. Approval may produce or update a decision; it does
not retroactively turn the source artifact into an accepted decision.

### 6. Supersede Accepted History

1. Never overwrite the substance of an accepted decision to express a new
   choice.
2. Create a new decision with its own evidence, rationale, approval, and ID.
3. Link the new record to the old one with `supersedes`.
4. Mark the old record `superseded` and link it to the replacement.
5. Preserve the old statement, rationale, evidence, approval, and provenance.
6. Update the index atomically so both records and their relationship remain
   visible.

### 7. Render Reviewed Records

1. Read only authoritative, reviewed records and indexes.
2. Exclude unapproved candidates unless the requested view explicitly labels
   them as unapproved inputs.
3. Write output under the repository-declared derived location.
4. Record generator identity or command, source record IDs, source revisions or
   hashes when available, and generation time.
5. Mark the output as derived and disposable.
6. Do not alter decision text, lifecycle status, approval, evidence, or
   rationale while rendering.

## Approval Gates

Stop for human approval before:

* promoting a decision to `accepted`;
* changing an accepted decision's meaning;
* superseding accepted history;
* changing the authoritative README, index, or schema contract incompatibly; or
* treating a candidate observation, future-state proposal, or drift report as a
  decision.

Mechanical index synchronization and regeneration of already-reviewed derived
output do not require a new architecture approval when repository policy allows
them.

## Validation

1. Run the repository-declared `.shadow/` validator when one exists.
2. Otherwise parse the declared machine-readable files.
3. Check unique IDs, supported kinds and statuses, relation targets, required
   approval fields, provenance fields, and index-to-record agreement.
4. Check that evidence and anchor references use the repository's declared
   conventions and that missing rationale remains explicit.
5. Confirm legacy records remain readable after migration.
6. Confirm derived output identifies its sources and is not indexed as an
   authoritative decision.
7. Review the diff for invented rationale, silent history rewrites, and
   accidental observation, dreaming, or drift work.

## Response

Report the operation performed, authoritative files changed, decision lifecycle
transitions, approvals used or still required, compatibility preserved, records
rendered, validation commands and results, unknowns, and any handoff needed to a
sibling skill.

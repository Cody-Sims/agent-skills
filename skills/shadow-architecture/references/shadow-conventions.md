# Shadow v2 Reference Contract

Shadow is a repository-owned convention for durable, reviewable architecture
memory. It is not an official or vendor format. A repository may use JSON, YAML,
Markdown with machine-readable metadata, or another documented representation.

This contract is a compatibility reference, not a mandate to replace a
repository's established `.shadow/` design. `.shadow/README.md`, the index it
declares, and the schema it declares always take precedence.

## Contents

1. [Authority and compatibility](#authority-and-compatibility)
2. [Reference layout](#reference-layout)
3. [Shared record envelope](#shared-record-envelope)
4. [Evidence model](#evidence-model)
5. [Record families](#record-families)
6. [Decision lifecycle](#decision-lifecycle)
7. [Relations](#relations)
8. [Human approval gates](#human-approval-gates)
9. [Index and schema contract](#index-and-schema-contract)
10. [Run provenance](#run-provenance)
11. [Derived output](#derived-output)
12. [Migration from the minimal convention](#migration-from-the-minimal-convention)
13. [Integrity checks](#integrity-checks)

## Authority and Compatibility

Apply this precedence order:

1. repository instructions governing `.shadow/`;
2. `.shadow/README.md`;
3. the README-declared index and schema;
4. authoritative records referenced by that index;
5. this reference contract; and
6. derived output.

Preserve repository-specific paths, names, fields, relations, and serialization
when they remain valid. Shadow v2 adds concepts through compatible schema
evolution. It does not require renaming existing decisions or moving files.

An existing minimal graph remains valid when it has a README, index, schema, and
decision records that follow its own declared rules. V2 features may be added
incrementally.

## Reference Layout

Use this layout only when a repository has not declared one:

```text
.shadow/
  README.md
  index.yaml
  schema.yaml
  decisions/
  candidates/
    observations/
    future-state/
  approvals/
  drift/
  runs/
  derived/
```

The README identifies:

* authoritative files and record locations;
* index and schema versions;
* supported formats, record kinds, statuses, and relations;
* approval policy and approving roles;
* compatibility promises for older records;
* provenance requirements; and
* the derived-output location and regeneration method.

Directories may be omitted until the repository needs that record family.

## Shared Record Envelope

Each indexed record should have:

| Field | Meaning |
|---|---|
| `id` | Stable, unique identifier. |
| `kind` | Record family, such as `decision` or `candidate-observation`. |
| `title` | Short human-readable summary. |
| `status` | Kind-specific lifecycle state. |
| `summary` or `statement` | Present-tense claim, choice, proposal, or finding. |
| `evidence` | Verified sources supporting material claims. |
| `inferences` | Conclusions drawn from evidence but not directly stated by it. |
| `unknowns` | Missing facts, intent, rationale, or verification. |
| `anchors` | Repository-relative governed or examined locations. |
| `relations` | Typed links to other stable IDs. |
| `provenance` | Originating run, actor, tool, time, and source inputs. |
| `approval` | Required, granted, rejected, or not-applicable review state. |
| `schemaVersion` | Record-shape version or compatible schema identifier. |

Repositories may split provenance and approvals into separate records and
reference their IDs. They may retain existing field names such as `rationale`;
the schema should document how those fields map to the v2 concepts.

## Evidence Model

Keep three categories distinct:

### Verified evidence

Facts directly supported by code, tests, documentation, issue or pull-request
records, commits, approved meeting records, or other repository-accepted
sources. Store a repository-relative path, stable URL, commit ID, or declared
source reference plus an optional locator.

### Inference

A conclusion reasonably derived from evidence but not explicitly stated by it.
Label the inference and cite the evidence used. An inference is not historical
rationale and cannot justify claiming why an old choice was made.

### Unknown

A fact, rationale, owner, date, or intent that cannot be verified. Store it as an
explicit unknown. Never replace it with plausible prose.

The absence of contradictory evidence does not turn an inference into verified
evidence.

## Record Families

### Decisions

Decisions are durable architecture statements governed by the decision
lifecycle. They may describe verified current architecture, pending choices,
approved choices, or preserved superseded history.

Minimum decision-specific fields:

* stable `id`;
* `status`: `observed`, `proposed`, `accepted`, or `superseded`;
* present-tense `statement`;
* `rationale`, which may be `unknown`;
* evidence, inference, unknowns, anchors, relations, and provenance; and
* approval state and approval reference when acceptance or supersession occurs.

### Candidate Observations

Candidate observations are review inputs produced by an observation workflow.
They are not decisions and must not be indexed as accepted architecture.

Recommended statuses are `candidate`, `reviewed`, `promoted`, and `rejected`.
A promoted candidate links to the resulting observed or proposed decision. The
candidate retains its original text, evidence, provenance, and review outcome.

The `shadow-observe` skill owns gathering and refreshing these candidates.
Shadow Architecture only maintains their contract and records reviewed outcomes.

### Future-State Proposals

Future-state proposals describe possible target architectures, alternatives,
tradeoffs, assumptions, and open questions. They are exploratory inputs, not
accepted decisions.

Recommended statuses are `draft`, `reviewed`, `selected`, and `rejected`.
A selected proposal may become the source of a `proposed` decision, which still
requires human approval before becoming `accepted`.

The `shadow-dream` skill owns producing future-state proposals. Shadow
Architecture records only reviewed lifecycle effects.

### Drift Reports

Drift reports capture a comparison between declared architecture and another
state, including the compared revisions, findings, severity, evidence, and
recommended follow-up. A drift report never changes a decision by itself.

Recommended statuses are `open`, `reviewed`, `resolved`, and `dismissed`.
Resolution may link to a code change, documentation update, schema repair, new
decision, or superseding decision.

The `shadow-drift` skill owns drift detection and report creation. Shadow
Architecture maintains report compatibility and approved decision effects.

### Approvals

Approvals identify:

* the reviewed record and exact revision;
* decision outcome;
* approving human or repository-declared role;
* approval time;
* scope and conditions; and
* source, such as a pull request, issue, or signed review record.

Tool execution, generated text, passing validation, or lack of objection is not
human approval.

### Runs

Run records make automated or assisted work reproducible and auditable. They
identify inputs, outputs, tool or skill identity, relevant versions, actor,
timestamps, repository revision, command or method, and completion state.

A run proves process provenance. It does not prove that its output is correct or
approved.

## Decision Lifecycle

### Observed

Use `observed` only for a present architecture claim supported by verified
evidence. Unknown historical rationale remains unknown. Human review may be
required by repository policy, but observed does not mean accepted.

### Proposed

Use `proposed` for a decision under consideration. Record alternatives,
tradeoffs, assumptions, unknowns, and approval state. Proposed decisions do not
govern implementation as accepted architecture unless repository policy says
otherwise.

### Accepted

Use `accepted` only after explicit human approval. Preserve the approved
statement, rationale, evidence set, approval reference, and provenance.

### Superseded

Use `superseded` when a newer accepted decision replaces an accepted decision.
Keep the old record intact except for lifecycle metadata and the link to its
replacement. The replacement links back with `supersedes`.

Do not use supersession to erase mistakes or inconvenient history. Corrections
should be explicit and provenance-preserving.

## Relations

Use typed, resolvable relations. Common types include:

* `supersedes` and `superseded-by`;
* `depends-on` and `dependency-of`;
* `constrains` and `constrained-by`;
* `implements` and `implemented-by`;
* `derived-from`;
* `promoted-to`;
* `evaluates`; and
* `resolves`.

The repository schema defines allowed relation types, direction, cardinality,
and whether inverse links are required. Every target resolves to a stable ID or
an explicitly supported external reference.

## Human Approval Gates

Require explicit human approval before:

1. promoting any decision to `accepted`;
2. superseding an accepted decision;
3. changing the meaning of accepted history;
4. converting a candidate observation or future-state proposal into a decision;
5. using a drift report to change declared architecture; or
6. making an incompatible change to the authoritative README, index, or schema.

Record approval against an exact record revision. If the reviewed substance
changes, request approval again.

Repository policy may permit mechanical index synchronization, schema formatting
that preserves semantics, or derived-output regeneration without a new
architecture approval.

## Index and Schema Contract

The index should expose:

* graph or contract version;
* schema location and version;
* authoritative record locations;
* record ID, kind, status, path, and title;
* relations needed for graph traversal;
* approval reference when applicable; and
* optional content hash or revision for integrity checks.

The schema should:

* validate all record shapes promised by the README;
* define decision states and other kind-specific states separately;
* preserve legacy record compatibility or identify an explicit migration;
* distinguish required fields from optional v2 extensions;
* validate stable IDs and typed relations;
* model evidence, inference, unknowns, provenance, and approvals; and
* prevent derived output from masquerading as authoritative decisions.

Prefer additive evolution. Use optional fields, schema unions, aliases, or
versioned definitions before destructive rewrites.

## Run Provenance

For a run that creates or changes graph artifacts, capture when available:

* `runId`;
* initiating human or automation identity;
* skill, tool, and relevant version;
* start and completion timestamps;
* repository revision and working-tree state;
* input record IDs and revisions;
* output record IDs and revisions;
* command, adapter, or documented method;
* validation performed; and
* outcome, errors, and unresolved unknowns.

Sensitive prompts, credentials, private data, and unnecessary environment
details do not belong in provenance.

## Derived Output

Rendered graphs, reports, websites, diagrams, and summaries are disposable
views. Each output should identify:

* that it is derived;
* authoritative source record IDs;
* source revisions or hashes when available;
* generator identity or regeneration command;
* generation time; and
* filters, exclusions, or unapproved inputs.

Rendering must not alter authoritative records or lifecycle states. Delete and
regenerate derived output rather than treating it as decision history.

## Migration from the Minimal Convention

Migrate incrementally:

1. Read the existing README, index, schema, and records.
2. Document the current contract before changing it.
3. Add a graph or schema version without invalidating old records.
4. Map existing decision fields to the shared envelope.
5. Keep `observed`, `proposed`, `accepted`, and `superseded` semantics stable.
6. Add evidence, inference, unknown, approval, and provenance fields as optional
   extensions first.
7. Add record-kind support for candidates, future-state proposals, runs,
   approvals, and drift reports only when needed.
8. Add derived-output provenance and authority labels.
9. Validate that every legacy record remains readable and indexed.
10. Record migration run provenance, compatibility decisions, and unresolved
    gaps.
11. Obtain human approval for incompatible contract changes.

Do not manufacture missing approvals, dates, rationale, or provenance for legacy
records. Mark them unknown or unavailable.

## Integrity Checks

Validate at least:

* machine-readable files parse;
* IDs are unique and stable;
* kinds and statuses are schema-supported;
* relation targets resolve;
* required inverse supersession links agree;
* accepted and superseded decisions reference human approval;
* index entries agree with authoritative records;
* evidence, inference, and unknowns remain distinguishable;
* provenance identifies source inputs and outputs;
* legacy records remain schema-readable after migration; and
* derived files identify themselves as derived and are not authoritative index
  entries.

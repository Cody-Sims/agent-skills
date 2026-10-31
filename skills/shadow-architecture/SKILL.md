---
name: shadow-architecture
description: "Maintains repository-owned .shadow graphs and approved decision history. Use when creating or migrating .shadow, recording approved decisions, maintaining indexes or schemas, superseding accepted history, or rendering reviewed records; not for observation discovery, future-state proposals, or drift checks."
license: MIT
metadata:
  version: "2.1.0"
  author: "Cody-Sims"
  tier: "core"
---

# Shadow Architecture

Maintain durable, reviewable `.shadow/` memory. Repository instructions,
`.shadow/README.md`, and its declared index/schema are authoritative, not a
fixed reference layout. Read the
[Shadow v2 reference contract](references/shadow-conventions.md) before setup,
migration, or contract changes.

## Evidence Rules

Separate verified evidence, inference, and unknowns; cite repository-relative
code/tests/docs or stable issue/PR/commit references for material claims. Never
invent intent or rationale; use `unknown`. Candidates, proposals, and drift
reports are review inputs, not accepted decisions. Approval may produce a
decision but never retroactively changes the source artifact's record kind.
Rendered output is disposable, not authority.

## Workflow

1. **Read authority.** Read workspace instructions, then `.shadow/README.md`
   and its declared index/schema. Inventory kinds, statuses, IDs, relations,
   approvals, provenance, and derived output. Preserve valid local fields,
   paths, formats, and older records absent an approved migration.
2. **Bound the operation.** Select `setup`, `migrate`, `maintain`, `record`,
   `supersede`, or `render`; execute only applicable steps below. Do not broaden
   maintenance into observation, ideation, or drift analysis.
3. **Setup/migrate.** If absent, create only a README, declared index/schema,
   and decision location. Document authoritative, awaiting-review, and derived
   files; stable IDs, kinds, lifecycle/relation types, evidence/approval fields,
   and run provenance. Preserve existing readable shapes. Prefer aliases,
   optional fields, schema unions, or version markers before destructive
   rewrites. Record migration provenance and compatibility gaps. Obtain human
   approval before changing the authoritative contract.
4. **Maintain.** Schema must accept every README-promised record; synchronize
   index paths/statuses with authoritative records, keep IDs stable and targets
   resolvable. Preserve unknowns, run/source provenance, and approvals through
   format changes. Keep derived output regenerable and non-authoritative.
   Report incompatible legacy records; never silently drop fields.
5. **Record.** Identify reviewed input/evidence; assign a stable ID and
   present-tense statement. Store verified rationale or `unknown`, evidence,
   inference, unknowns, anchors, relations, source provenance, and approval
   state. `observed` means evidence-supported current architecture, not accepted;
   `proposed` means not yet adopted; `accepted` requires recorded human approval.
   Update the schema-compatible record and authoritative index together.
6. **Supersede.** Never overwrite accepted substance with a new choice. Create a
   new approved decision with its own ID, evidence, rationale, and provenance;
   link it to the old record with `supersedes`. Mark the old record `superseded`
   and link its replacement, preserving statement/rationale/evidence/approval/
   provenance. Atomically update the index so both records and links remain
   visible.
7. **Render.** Use authoritative reviewed records/indexes. Exclude unapproved
   candidates unless the requested view labels them explicitly. Write only
   under the declared derived location; identify generator/command, source IDs,
   available source revisions/hashes, and generation time. Label disposable
   derived output. Never alter decision text, status, approval, evidence, or
   rationale while rendering.

## Approval Gates

Stop for human approval before acceptance, changing accepted meaning,
supersession, incompatible README/index/schema changes, or converting any
candidate/proposal/drift report into a decision. Bind approval to the exact
reviewed revision; changed substance needs new approval. Passing validation,
generated text, and silence are not approval. Mechanical index synchronization
or reviewed-output regeneration needs no new architecture approval only when
repository policy permits.

## Validation

1. Run the declared validator, or parse declared machine-readable files.
2. Check unique IDs, supported kinds/statuses, resolvable typed relations and
   required inverse links, approval/provenance, index agreement, declared
   evidence/anchor conventions, and explicit missing rationale.
3. Confirm legacy readability and derived source identity/non-authoritative
   indexing. Review the diff for invented rationale, history rewrites, or
   accidental observation, dreaming, or drift work.

## Response

Report operation, authoritative changes, lifecycle transitions, approval used/
needed, preserved compatibility, rendered records, validation/results, unknowns,
and handoffs. Use `shadow-observe` for candidate discovery, `shadow-dream` for
future states, `shadow-drift` for read-only comparison, `codebase-exploration`
for orientation, and `documentation-maintenance` for ordinary docs.

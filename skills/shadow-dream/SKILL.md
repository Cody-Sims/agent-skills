---
name: shadow-dream
description: "Proposes evidence-linked future-state architecture options from Shadow observations and accepted constraints. Use when asked to dream, compare architecture options, define a target state, or propose migration and rollback; not for product specifications, implementation tasks, accepted decision recording, or implementation."
license: MIT
metadata:
  version: "1.1.1"
  author: "Cody-Sims"
  tier: "experimental"
---

# Shadow Dream

Produce a reviewable architecture proposal, not an approved decision.
Inputs: question/horizon, repository instructions and declared `.shadow/`
README/index/schemas/lifecycle/approval conventions, evidence-linked current
observations, accepted constraints, and optional goals/risk/deadline/migration
limits. Repository declarations govern graph representation; missing inputs
remain unknown.

## Hard Boundary

Remain proposal-only: never edit code, configuration, infrastructure, tests, or
implementation plans; mark `accepted`; change accepted decisions/history; or
claim human approval. Refuse acceptance/implementation requests and offer only
the proposal, approval gate, or later handoff. Persist at most one proposed
artifact only on explicit request, using the declared path/schema. If this
requires other artifact or accepted-record changes, return in chat and report
the conflict.

## Workflow

1. **Bound.** State title, scope, horizon, outcome, non-goals, and status
   `proposed`.
2. **Load relevant context.** Read the declared Shadow entry point/schema,
   observations, accepted decisions, relations, anchors, and evidence. Preserve
   IDs and lifecycle meanings; do not survey unrelated records.
3. **Classify evidence.** Separate **Verified inputs** supported by observations,
   constraints, instructions, schemas, code/tests/docs, issues/PRs/commits;
   **Inferences** labeled and linked to supporting inputs; and **Unknowns**
   covering absent, contradictory, stale, or unverified facts. Cite workspace-
   relative paths or stable references. Missing rationale is always unknown.
   Inference cannot become an accepted constraint; proposals cannot prove their
   own acceptance.
4. **Extract drivers.** List evaluation criteria and mark constraints as
   accepted, requested, inferred, or unknown. Only accepted architecture claims
   are mandatory on that basis; current hard user scope, security, and budget
   limits remain binding without graph acceptance. Keep optional preferences
   distinct and surface authority conflicts rather than silently overriding them.
5. **Generate options.** Produce at least two materially distinct architectures,
   not implementation variants. Include status quo/incremental change when a
   credible baseline.
6. **Describe every option.** Include target structure/responsibilities,
   supporting evidence and satisfied constraints, assumptions/unknowns,
   benefits/tradeoffs, operational/organizational consequences, risks/failure
   modes and evidence to reduce them, migration stages/gates/observable exit
   criteria, and rollback boundaries/triggers/method/irreversible steps.
7. **Compare/recommend.** Use identical drivers/constraints; distinguish verified
   comparison facts from judgment, with no unsupported scores or false
   precision. Recommend an option, hybrid, or no change; explain evidence fit,
   remaining tradeoffs, and unknowns that could reverse it.
8. **Review gate.** List open questions, needed evidence, required reviewers,
   and the repository-declared human approval artifact. Keep `proposed`.
9. **Return/persist.** Use repository-required fields first, retaining all
   information above. Default to the complete proposal in chat. Only if
   explicitly requested and the writing boundary holds, validate one proposed
   artifact against the declared schema and report its path without promotion.
10. **Hand off only with evidence of approval.** Locate and cite the declared
    human approval artifact, not model language. Give `shadow-architecture` the
    proposal, approval reference, evidence links, unknowns, and requested
    recording action; never perform that action here. Without the artifact,
    stop at the proposal.

## Response

Report status, chat/persistence, sources, unknowns, option count, recommendation,
migration/rollback, open questions, approval requirement, and explicit refusal of
requested acceptance/history rewriting/implementation. Use
`requirements-and-spec-writing` for product requirements, use cases, acceptance
criteria, or interface specifications; `planning-and-task-breakdown` for
implementation tasks after approval.

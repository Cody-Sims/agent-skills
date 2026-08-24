---
name: shadow-dream
description: "Generates evidence-linked future-state architecture options and a reviewable proposal from Shadow observations and accepted constraints, including target states, tradeoffs, migration paths, rollback, risks, and a recommendation. Use when asked to dream, explore architecture options, compare future-state architecture, define a target state, or propose a migration path; excludes product requirements and specifications handled by requirements-and-spec-writing and implementation task planning handled by planning-and-task-breakdown."
license: MIT
metadata:
  version: "1.0.0"
  author: "Cody-Sims"
  tier: "experimental"
---

# Shadow Dream

Generate reviewable future-state architecture options from evidence-linked
Shadow observations and accepted constraints. Produce a proposal only. Do not
implement it or treat it as an approved decision.

## Inputs

- The architecture question and desired planning horizon.
- Repository instructions and the repository-declared `.shadow/` README, index,
  schemas, lifecycle, and approval conventions.
- Evidence-linked observations about the current system.
- Accepted decisions and constraints that bound viable target states.
- Optional goals, risk tolerance, deadlines, and migration limits.

If the repository declares `.shadow/` conventions or schemas, they take
precedence. If required observations, constraints, rationale, or approval
conventions are absent, record the gap as unknown. Do not invent them.

## Hard Boundary

- Remain proposal-only. Do not edit application code, configuration,
  infrastructure, tests, or implementation plans.
- Do not mark a proposal `accepted`, change an accepted decision, rewrite
  accepted history, or claim that a human approved anything.
- Persist only one proposed artifact, and only when the requester explicitly
  asks for persistence. Otherwise return the proposal in chat.
- When persistence is requested, use the repository-declared proposal path and
  schema. If compliance would require changing accepted records or other
  artifacts, return the proposal in chat and report the conflict instead.
- Refuse requests to accept or implement the proposal. Offer the proposal,
  approval gate, or a later handoff instead.
- Hand an approved proposal to `shadow-architecture` for decision recording only
  after locating the repository-declared human approval artifact and citing it.
  The approval artifact, not model language, establishes approval.

Use `requirements-and-spec-writing` for product requirements, use cases,
acceptance criteria, or interface specifications. Use
`planning-and-task-breakdown` after approval to create implementation tasks.

## Evidence Discipline

Keep these classes separate throughout the proposal:

- **Verified inputs:** Directly supported observations, accepted constraints,
  repository instructions, schemas, code, tests, documents, issues, pull
  requests, or commits. Cite workspace-relative paths or stable references.
- **Inference:** Reasoned implications of verified inputs. Label each inference
  and cite the inputs that support it.
- **Unknowns:** Missing, contradictory, stale, or unverified information.
  Missing rationale is always unknown.

Do not present an inference as an accepted constraint. Do not use a proposed
artifact as evidence that its own target state is accepted.

## Workflow

1. **Establish the question.** State the architecture scope, planning horizon,
   desired outcome, non-goals, and proposal-only boundary.
2. **Load Shadow context.** Read the repository-declared `.shadow/` entry point,
   schema, relevant observations, accepted decisions, relations, anchors, and
   evidence. Preserve their identifiers and lifecycle meanings.
3. **Classify inputs.** Build separate lists of verified inputs, inferences, and
   unknowns. Flag contradictions and missing rationale without resolving them by
   guesswork.
4. **Extract drivers and constraints.** List the forces that distinguish viable
   options. Mark every constraint as accepted, requested, inferred, or unknown.
   Accepted constraints are mandatory; the other classes are not.
5. **Generate multiple options.** Produce at least two materially distinct
   future-state architectures. Include a status-quo or incremental option when
   it is a credible baseline. Do not disguise implementation variants as
   separate architecture options.
6. **Describe each option.** For every option, state:
   - target-state structure and responsibility boundaries;
   - evidence and accepted constraints it satisfies;
   - assumptions and unknowns;
   - benefits and tradeoffs;
   - consequences, including operational and organizational effects;
   - risks, failure modes, and risk-reduction evidence needed;
   - migration stages, stage gates, and observable exit criteria;
   - rollback boundary, trigger, method, and irreversible steps.
7. **Compare options.** Use the same drivers and constraints for every option.
   Distinguish verified comparison facts from judgment. Do not use unsupported
   numeric scoring or false precision.
8. **Recommend conditionally.** Recommend one option, a hybrid, or no change.
   Explain why it best fits the verified evidence and accepted constraints,
   which tradeoffs remain, and which unknowns could reverse the recommendation.
9. **Define the review gate.** List open questions, required reviewers,
   evidence still needed, and the repository-declared human approval artifact.
   Keep proposal status explicitly `proposed`.
10. **Return or persist.** Return the complete proposal in chat unless explicit
    persistence was requested. When persisting, validate the proposed artifact
    against the repository schema and report its path without promoting it.

## Proposal Shape

Use repository-required fields first, then preserve this information:

1. Title, scope, status `proposed`, and planning horizon.
2. Evidence sources and accepted Shadow constraints.
3. Verified inputs.
4. Inferences.
5. Unknowns and contradictions.
6. Drivers and evaluation criteria.
7. Option 1.
8. Option 2 and any additional options.
9. Cross-option tradeoff comparison.
10. Recommendation and conditions that could change it.
11. Consequences and risks.
12. Migration stages and stage gates.
13. Rollback triggers, boundaries, and method.
14. Open questions, required evidence, and reviewers.
15. Human approval artifact required for later decision recording.

## Handoff

After a human approval artifact exists, provide `shadow-architecture` with the
proposed artifact, approval reference, evidence links, unresolved unknowns, and
the requested decision-recording action. Do not perform that action in this
skill. Without the approval artifact, stop at the proposed artifact.

## Response

Report the proposal status, whether it was returned or persisted, evidence
sources, unknowns, option count, recommendation, migration and rollback summary,
open questions, approval requirement, and explicit refusal to mark accepted,
rewrite accepted history, or implement when any of those actions were requested.

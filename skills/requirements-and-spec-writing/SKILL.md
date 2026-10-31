---
name: requirements-and-spec-writing
description: "Turns unclear requests into agreed, testable specifications before implementation. Use when a request is vague or large, scope/acceptance criteria are unclear, or a spec, requirements, or design is requested; not for decomposing an approved spec or a small well-defined edit."
license: MIT
metadata:
  version: "1.1.0"
  author: "Cody-Sims"
  tier: "core"
---

# Requirements and Spec Writing

## Contract

Inputs: the original request/context and any existing-system constraints.
Output: a requester-agreed specification, or an explicitly unapproved draft with
open decisions. This skill does not authorize implementation or task execution.

## Workflow

1. Restate the intended outcome and boundaries. Confirm the restatement from
   supplied agreement or with the requester before proceeding; do not ask them
   to repeat decisions already confirmed. If interaction is unavailable, label
   any draft unapproved and do not treat assumptions as consent.
2. Read applicable instructions and relevant existing code/documents to identify
   constraints. Begin with named interfaces, use cases, and known paths; widen
   scoped searches only for a specific unanswered question. No full architecture
   audit or automatic worker launch is needed to clarify a bounded request.
3. When drafting, read [the spec template](assets/spec-template.md) and use its
   section order. Cover objective, users/use cases, functional/non-functional
   requirements, non-goals, existing constraints, interfaces/data contracts,
   security/privacy, error/edge cases, acceptance criteria, open questions,
   alternatives, and rollout/rollback. Return inline unless a file is requested
   or repository conventions require one; do not create extra planning artifacts.
4. Label facts with sources, minor assumptions explicitly, and consequential
   unknowns as open decisions with owners. Ask one focused consequential question
   at a time only when context cannot answer it; batch trivial confirmations.
   Move scope expansion into non-goals or follow-up instead of silently adding it.
5. Make every requirement testable and pair it with observable acceptance
   criteria. Record rejected alternatives and reasons. Address security,
   privacy, trust boundaries, invalid/empty inputs, limits, and failure behavior,
   or explicitly identify the missing decision. Never invent requester-owned
   policy, authorization, data-retention, or rollout choices.
6. Check section completeness, requirement-to-criterion coverage, constraints,
   explicit non-goals/assumptions/open questions, and required repository spec
   gates. Validate against the gathered context; do not run unrelated builds or
   tests just to produce a specification.
7. Present for agreement. Resolve consequential open questions or obtain explicit
   agreement to carry them forward before implementation. Keep an unapproved
   draft separate from an agreed specification; lack of a reply is not approval.

## Stop and output

Stop at the specification handoff, not coding or delivery planning. If context,
interaction, or approval is missing, return a draft and name the blocker.
Report the specification, agreement status, brief assumptions with sources where
available, and open decisions/owners needed before implementation. Claim ready
only when required checks and requester agreement are evidenced.

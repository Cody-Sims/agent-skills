---
name: requirements-and-spec-writing
description: "Turns an ambiguous or large request into an agreed written specification before implementation, covering objective, users and use cases, requirements, non-goals, interfaces and data contracts, security and privacy, error and edge cases, acceptance criteria, open questions, alternatives considered, and rollout and rollback. Use when a request is vague, scope or acceptance criteria are unclear, or the user asks for a spec, requirements, or a design before coding begins."
license: MIT
metadata:
  version: "1.0.0"
  author: "Cody-Sims"
  tier: "core"
---

# Requirements and Spec Writing

Convert an unclear request into a specification that a builder can implement and
a reviewer can check, before any code is written.

## Goal

Produce a written specification the requester agrees to, separating confirmed
facts from assumptions and unresolved decisions.

## Inputs

- Required: the original request and its context.
- Optional: existing code, documents, or constraints the specification must
  respect.
- Output: a specification following the section order below. Copy
  [the spec template](assets/spec-template.md) to start.

## When to use

Use this before planning or implementation when the request is ambiguous, spans
several components, has unclear success criteria, or carries security or data
implications. Skip it for a small, well-defined change with an obvious outcome.

## Workflow

1. Restate the request in your own words and confirm the restatement is correct
   before proceeding.
2. Gather context from existing code, documents, and constraints so the
   specification does not contradict what already exists.
3. Draft each section in order. Fill what the context supports and mark the rest
   as an open question rather than guessing.
4. Ask one focused question at a time, and only when the answer cannot be
   inferred from the context already gathered. Batch trivial confirmations.
5. Separate facts, assumptions, and unresolved decisions explicitly. Label every
   assumption so the requester can correct it.
6. Write acceptance criteria as observable, checkable outcomes, not intentions.
7. Record non-goals to prevent scope creep, and note alternatives considered with
   the reason each was set aside.
8. Present the specification for agreement. Resolve open questions or carry them
   forward explicitly before implementation starts.

## Specification sections

- Objective: the outcome and why it matters, in one short paragraph.
- Users and use cases: who uses this and the concrete scenarios they perform.
- Requirements: functional and non-functional statements, each testable.
- Non-goals: what is deliberately excluded from this work.
- Existing-system constraints: interfaces, data, and conventions to respect.
- Interfaces and data contracts: inputs, outputs, formats, and schemas.
- Security and privacy: sensitive data, authorization, and trust boundaries.
- Error and edge cases: invalid input, empty state, limits, and failure modes.
- Acceptance criteria: observable conditions that prove the work is complete.
- Open questions: unresolved decisions and who must decide.
- Alternatives considered: options evaluated and why they were not chosen.
- Rollout and rollback: how the change is delivered and how it is reverted.

## Decision points

- Context answers a question: record it as a fact and cite the source.
- Context cannot answer and the decision matters: raise it as an open question.
- Context cannot answer but the decision is minor: state a labeled assumption and
  continue.
- Scope keeps growing: move the excess into non-goals or a follow-up.

## Validation

Before declaring the specification ready:

- Every requirement is testable and each has a matching acceptance criterion.
- Non-goals and open questions are explicit.
- Security, privacy, and error handling are addressed or listed as open.
- No section silently guesses a decision the requester must own.

## Output format

Return the completed specification, a short list of assumptions made, and the
open questions that still need a decision before implementation.

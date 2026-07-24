---
name: replace-with-skill-name
description: "Performs a specific workflow and produces a clearly defined result. Use when the user asks for the workflow, names its key artifacts or file types, or requests the expected output."
license: MIT
metadata:
  version: "1.0.0"
  author: "Cody-Sims"
  tier: "core"
---

# Replace With Skill Title

State in one or two sentences what the skill produces.

## Goal

Name the result the agent should produce.

## Inputs

- Required input: describe it precisely.
- Optional input: describe its default behavior.
- Output: state what the agent creates or returns.

If required information is missing and cannot be inferred safely, ask for it
before performing irreversible work.

## Workflow

1. Inspect the inputs and confirm they are usable.
2. Select the appropriate workflow branch.
3. Perform the transformation or analysis.
4. Validate the result.
5. Fix validation failures and revalidate.
6. Return the final output and a concise summary.

## Decision points

- Condition A: follow the primary workflow.
- Condition B: read the linked reference and follow the variant workflow.
- Unsupported condition: explain the limitation and give the safest alternative.

## Validation

- Confirm the required outputs exist.
- Run the repository's validation or test command.
- Confirm no input was overwritten unless explicitly requested.
- Report failures with actionable detail.

## Output format

Report each created artifact, a concise summary, and any warning, assumption, or
unresolved failure.

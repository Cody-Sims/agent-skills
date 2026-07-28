# Continuous Improvement Pilot Report

Use this template after at least three learning cycles and three independently
reviewed improvement pull requests. Do not fill missing evidence with estimates.
The machine-readable report must pass `scripts/validate-pilot-report.mjs`.

## Scope

- Pilot period:
- Repository visibility and branch protection:
- Agent profiles and model versions:
- Evaluation and routing baseline versions:

## Results

| Measure | Result | Evidence |
|---|---:|---|
| Proposal cycles |  |  |
| Proposal acceptance rate |  |  |
| Duplicate rate |  |  |
| Improvement pull requests attempted |  |  |
| Improvement pull requests completed and independently reviewed |  |  |
| Implementation success rate |  |  |
| Mean evaluation delta |  |  |
| Mean AI credits per completed improvement |  |  |
| Mean maintainer minutes per completed improvement |  |  |

## Limitations

Record unavailable billing data, model or runtime coverage gaps, unresolved
regressions, and any result that cannot be generalized.

## Decision

Choose `graduate`, `revise`, or `stop`. Graduation requires every threshold in
`.github/continuous-improvement/graduation-policy.json` to pass and a maintainer
approval recorded in the machine-readable report.

## Shutdown And Rollback

Disable recurring dispatch, cancel active delegated sessions, close stale draft
pull requests, expire leases through the control workflow, and revert immutable
merge commits through reviewed pull requests. Never rewrite shared history.

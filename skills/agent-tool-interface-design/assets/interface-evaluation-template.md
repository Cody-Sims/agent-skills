# Agent Tool Interface Evaluation

## Decision

- Workflow:
- Users and hosts:
- Selected shape:
- Required capabilities:
- Non-goals:

## Candidates

| Candidate | Existing components | Added infrastructure | Authority boundary | Portability |
|---|---|---|---|---|
| CLI | | | | |
| Direct MCP | | | | |
| Code adapter | | | | |
| Code-over-MCP | | | | |

## Representative Cases

| Case | Expected result | Data size | State | Failure injected |
|---|---|---:|---|---|
| Cold discovery | | | | |
| One-step operation | | | | |
| Multi-step composition | | | | |
| Large-result filtering | | | | |
| Authorization denial | | | | |
| Timeout and recovery | | | | |
| Cleanup | | | | |

## Measurements

Use the same model, environment, inputs, and trial count for every candidate.

| Candidate | Success rate | Input tokens | Output tokens | Startup context bytes | Round trips | Wall time | Output bytes | Retries | Cleanup failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CLI | | | | | | | | | |
| Direct MCP | | | | | | | | | |
| Code adapter | | | | | | | | | |
| Code-over-MCP | | | | | | | | | |

## Security and Operations

- Authentication and consent:
- Secret exposure:
- Sandbox and filesystem:
- Network and egress:
- Resource limits:
- Audit evidence:
- State, idempotency, and reconciliation:
- Cancellation and cleanup:

## Result

- Selected candidate:
- Rejected alternatives:
- Verified evidence:
- Inferences:
- Unknowns:
- Rollback:
- Wayfinder handoff:
- Specification and planning handoff:
- `.shadow` proposal or reason not recorded:

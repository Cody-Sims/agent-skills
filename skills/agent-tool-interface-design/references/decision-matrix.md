# Decision Matrix

Use the matrix as a starting hypothesis. Validate the selected candidate with
representative tasks.

| Force | Existing or small CLI | Direct MCP | Constrained code adapter | Code-over-MCP |
|---|---:|---:|---:|---:|
| Agent has a shell | Strong | Optional | Strong | Strong |
| Client has no shell or sandbox | No | Strong | No | No |
| Mature CLI already exists | Strong | Weak | Medium | Weak |
| Remote OAuth or delegated consent | Weak | Strong | Medium | Strong |
| Dynamic discovery | Weak | Strong | Medium | Strong |
| Cross-client interoperability | Medium | Strong | Weak | Strong |
| Large intermediate data | Strong | Weak | Strong | Strong |
| Joins, loops, retries, or branching | Strong | Weak | Strong | Strong |
| Long-lived remote state | Medium | Strong | Medium | Strong |
| Offline repository portability | Strong | Weak | Strong | Weak |
| Centralized policy and audit | Medium | Strong | Medium | Strong |
| Minimal execution infrastructure | Strong | Strong | Weak | Weak |
| Least ambient authority | Medium | Strong | Strong when sandboxed | Strong when sandboxed |

## Contract checklist

### Capability

- Define the smallest task-shaped operations.
- Document input and output types, limits, timeouts, and failure modes.
- Provide version and capability discovery without loading every detail.
- Preserve a raw artifact or handle when summaries need auditability.

### CLI

- Use `--help` and `--version`.
- Reserve stdout for results and stderr for diagnostics.
- Return nonzero exit codes for failures.
- Support structured output when another program will consume the result.
- Accept complex or sensitive input through stdin or files rather than fragile
  command interpolation.
- Use stable session IDs and targeted cleanup for long-running processes.

### MCP

- Keep tool schemas concise and task-shaped.
- Use resources for context and tools for actions.
- Preserve explicit consent and authorization boundaries.
- Support dynamic discovery only where it supplies real value.
- Return handles, summaries, or pagination for large results.

### Code execution

- Run in an isolated, disposable sandbox.
- Deny ambient credentials and unrestricted network access.
- Expose only allowlisted libraries, APIs, or MCP bindings.
- Bound CPU, memory, wall time, output, filesystem scope, and process creation.
- Capture code, capability calls, results, and policy decisions for audit.
- Require explicit approval before accessing authenticated browser state or
  other sensitive local profiles.

### State and recovery

- Assign stable operation identifiers and explicit model-visible state handles.
- Make writes idempotent or supply authoritative reconciliation.
- Expose status and durable receipts for remote side effects.
- Use the MCP Tasks extension when it fits long-running remote work.
- Bound leases and provide explicit cancellation and cleanup.
- Fail closed when an external outcome is unknown.

## Selection rule

Choose the lowest-complexity candidate that satisfies every mandatory force.
Reject a candidate when it requires broader authority, more infrastructure, or
more model-visible data without a measured benefit.

# Cross-Runtime Smoke Tests

The runtime smoke runner tests one skill across Claude Code, GitHub Copilot, and
OpenAI Codex. It is separate from model-graded behavior evaluations.

## Public deterministic matrix

Run:

```bash
npm run runtime:smoke
```

The command writes `tmp/runtime-smoke/public-result.json` and validates it
against `schemas/runtime-smoke-result.schema.json`. The committed fixture is
outside `skills/`, so it cannot enter the canonical catalog or registry.

Each runtime receives a new throwaway workspace and home. The runner copies the
fixture to the runtime's project path, verifies discovery layout, resolves a
resource, checks supported host-extension metadata, and invokes a deterministic
filesystem adapter. The public adapter is labeled `fixture` in the report. This
means the adapter protocol and matrix passed; it does not claim that a vendor
host executable ran.

Adapter identity is reviewed in the suite as an `id`, `kind`, entrypoint
SHA-256 digest, normalized launch configuration, and launch digest. The launch
configuration binds executable shape, every argument, and the sorted
environment allowlist. The runner verifies the reviewed policy before execution.
The result records that policy digest plus a separate launch digest over the
resolved executable, actual arguments, and sorted environment names and values
passed to the process. Renaming or copying the public adapter cannot
relabel it as a host adapter. A real host adapter requires a separately reviewed
suite entry with `kind: "host"` and its own digests.
Every configured adapter must also name that file explicitly with
`--adapter-entrypoint`; it must be the executable or Node's first script
argument.

Two launch shapes are accepted:

- The reviewed entrypoint is an absolute native executable without a shebang.
- The current Node executable, resolved exactly as `process.execPath`, launches
  the reviewed entrypoint as its fixed
  first script argument.

Node evaluation and preload flags cannot precede the reviewed script. Additional
script arguments and every `--adapter-env` name are accepted only when they
exactly match the reviewed launch configuration. Its digest is SHA-256 over the
compact JSON serialization in property order `executable`, `arguments`,
`environment`; the entrypoint path is normalized to `{entrypoint}`.
Use `@node` in CLI configuration to select the already-running
`process.execPath`; bare `node`, PATH lookup, and `/usr/bin/env` shebang launch
are rejected.

## Real host boundary

Licensed, authenticated, or hosted checks are local-only unless a controlled
environment provisions the host. Configure only commands that are known to be
installed:

```bash
node scripts/run-runtime-smoke.mjs \
  --suite /path/to/reviewed-host-suite.json \
  --adapter claude-code=/absolute/path/to/claude-smoke-adapter \
  --adapter-entrypoint claude-code=/absolute/path/to/claude-smoke-adapter \
  --adapter github-copilot=/absolute/path/to/copilot-smoke-adapter \
  --adapter-entrypoint github-copilot=/absolute/path/to/copilot-smoke-adapter \
  --adapter openai-codex=/absolute/path/to/codex-smoke-adapter \
  --adapter-entrypoint openai-codex=/absolute/path/to/codex-smoke-adapter \
  --out tmp/runtime-smoke/host-result.json
```

The host suite must declare each configured identity as `kind: "host"` and bind
that adapter's entrypoint and launch digests; the committed public fixture suite
cannot be reused to relabel fixture evidence as real host execution.

Omit unavailable hosts. Each omission produces a structured runtime and check
`skip` with a reason. A configured adapter may also return `status: "skip"` and
a non-empty `reason` when its host is unavailable. A skip never increments the
pass count.

For a configured but unavailable host, the runner-owned install check remains
`pass` because the fixture copy completed. Host discovery, invocation, resource
resolution, and host-extension checks are all `skip` with the same reason.

The runner does not discover commands by launching them, access the network, or
read credentials. Subprocesses receive only the platform execution variables,
an isolated `HOME`, `RUNTIME_SMOKE_RUNTIME`, and names explicitly allowed with
`--adapter-env <runtime=NAME>`. Adapter stderr and malformed stdout are
suppressed on failure.

Interpreter and loader control variables are forbidden even when explicitly
requested. This includes `NODE_OPTIONS`, `NODE_PATH`, all `LD_*` and `DYLD_*`
variables, `PYTHONPATH`, `PYTHONHOME`, `PYTHONSTARTUP`, `RUBYOPT`, `RUBYLIB`,
`PERL5OPT`, `PERL5LIB`, `BASH_ENV`, `ENV`, `SHELLOPTS`, and `IFS`.

Runtime smoke subprocess supervision supports Darwin and Linux. Each adapter
runs in a new process group. Every outcome—success, nonzero exit, malformed
output, timeout, stdout or stderr limit, and spawn error—uses one finalizer. It
sends `SIGTERM` to remaining group members, escalates to `SIGKILL` after a
bounded grace period, awaits adapter exit, and polls until `kill(-pgid, 0)`
reports `ESRCH`. Cleanup fails if the group remains beyond the bounded cleanup
deadline, the direct child does not close by that same deadline, or `EPERM`
remains unresolved. Throwaway roots are deleted only after this supervision
confirms cleanup. If cleanup remains uncertain, the root is preserved and its
safe path is included in the error for operator cleanup. Windows execution fails
explicitly as unsupported; it is not reported as a pass.

## Adapter protocol

The runner sends one JSON object on stdin. `protocolVersion` is `1`. The request
includes `runtime`, a deterministic `requestId`, throwaway `workspace` and
`home`, `installPath`, explicit `invocation`, and host-extension names. It does
not include the expected skill name, resource path or content, extension
values, or expected evidence hashes.

A passing adapter returns exactly:

```json
{
  "protocolVersion": 1,
  "runtime": "claude-code",
  "requestId": "<request value>",
  "status": "pass",
  "discoveredSkill": "runtime-smoke-fixture",
  "invocationEvidence": {
    "kind": "fixture-filesystem",
    "command": "/runtime-smoke-fixture",
    "exitCode": 0,
    "output": "runtime-smoke-resource-v1\n",
    "hostVersion": null
  },
  "resourceContent": "runtime-smoke-resource-v1\n",
  "hostExtensions": [
    { "name": "user-invocable", "value": true }
  ]
}
```

The runner independently derives expected discovery, resource, and extension
evidence from buffered fixture bytes. Passing invocation evidence must contain
the configured invocation and the resource output produced by that execution.
Fixture identities require `fixture-filesystem` evidence. Host identities
require `host-command` evidence, exit code zero, and a non-empty host version.
An adapter that only echoes request fields cannot pass.

A non-passing adapter returns the protocol version, runtime, request ID,
`status: "fail"` or `status: "skip"`, and a non-empty `reason`. Unknown fields,
wrong runtime or request identity, missing evidence, and evidence that disagrees
with the request fail the runner. Adapter execution is bounded by
`--timeout-ms`, from 1 through 120000 milliseconds.

## Result interpretation

Runtime and check order is fixed. Checks are `install`, `discovery`,
`invocation`, `resource-resolution`, and `host-extensions`. Runtime status is:

- `pass`: all five checks passed.
- `fail`: a configured host ran and reported a reasoned invocation failure.
- `skip`: no adapter was configured or a configured host reported that it was
  unavailable. For configured hosts, only the completed runner-owned install
  check passes; every unexecuted host-dependent check skips with the same reason.

Schema validation prevents unknown fields. Semantic validation prevents a
runtime from passing when any check is not a pass and verifies summary counts.

# Secrets and Dependencies

Detailed guidance for reviewing secret handling and dependency risk during a
security review.

## Secrets Handling

### What counts as a secret

Credentials, API keys, tokens, private keys, database connection strings, signing
keys, encryption keys, and any personal or regulated data that must not leak.

### Where to look

1. **Source and configuration** — Scan the change for literal keys, passwords, and
   tokens. Configuration should read secrets from the environment or a secret
   manager, not embed them.
2. **Version control history** — A secret removed in the current change may still
   exist in history. Flag it; removing it from the working tree does not revoke it.
3. **Logs and telemetry** — Confirm secrets, tokens, and full personal identifiers
   are never written to logs, traces, or analytics, including inside error objects.
4. **Error messages and responses** — Confirm exceptions and responses do not echo
   secrets or internal configuration back to the caller.
5. **Client-visible output** — Confirm secrets are not embedded in HTML, scripts,
   build artifacts, or API responses delivered to untrusted clients.

### Rules

* A committed secret must be treated as compromised. Recommend rotation, not just
  deletion.
* Prefer short-lived, scoped credentials over long-lived broad ones.
* Confirm secrets are injected at runtime and excluded from images and bundles.

## Dependency and Supply-Chain Risk

### Review new and changed dependencies

1. Enumerate dependencies added, removed, or upgraded in the change, including
   transitive additions introduced by the update.
2. Check provenance: a maintained source, a plausible maintainer, and a history
   consistent with the package's reputation. Flag typosquat-style names that
   resemble a popular package.
3. Check each new or upgraded package against known-vulnerability advisories using
   the repository's available tooling. State the tool and result.
4. Prefer pinned, reproducible versions recorded in a lockfile so builds cannot
   silently pull altered code.

### Signals that warrant a closer look

* A large or unexpected transitive dependency tree from a small package.
* Install-time or build-time scripts that run arbitrary code.
* A dependency that requests network access, filesystem access, or credentials
  beyond its stated purpose.
* A recently republished package, a new maintainer, or a sudden ownership change.
* Vendored or copied third-party code that bypasses dependency review entirely.

### Reporting

For each dependency concern, record the package and version, the specific risk,
the advisory or evidence, and a recommended action such as pin, upgrade, replace,
or remove. Distinguish a confirmed vulnerable version from a general caution.

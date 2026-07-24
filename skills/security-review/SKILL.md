---
name: security-review
description: Performs threat-focused security review of a code change or component using STRIDE, checking authentication, authorization and ownership, input validation, injection, deserialization, SSRF, secrets handling, dependency and supply-chain risk, cryptography, and untrusted data including prompt injection. Use when reviewing a diff, feature, endpoint, or integration for vulnerabilities, threat modeling, or hardening before merge or release.
license: MIT
metadata:
  version: "1.0.0"
  author: Cody-Sims
  tier: core
---

# Security Review

Find real, exploitable weaknesses in a change or component and report them with
evidence and severity. This is analysis, not remediation: recommend fixes, but do
not silently rewrite code. Judgment matters here, so favor concrete reasoning over
mechanical checklists, and do not pad the report with speculative low-value noise.

## Scope the Review

1. Define the target precisely: a diff, a module, an endpoint, or an integration.
2. Identify the **assets** worth protecting: user data, credentials, funds, tokens,
   privileged operations, and system integrity.
3. Map the **entry points** where external input enters: request parameters,
   headers, uploaded files, message queues, environment, CLI arguments, and
   responses from external services.
4. Draw the **trust boundaries** each input crosses, for example network to
   server, user to admin, or tenant to tenant. Vulnerabilities cluster where data
   crosses a boundary without being re-validated.

## Apply STRIDE

Walk each entry point and asset against the six STRIDE categories. See the
[threat checklist](references/threat-checklist.md) for concrete questions.

* **Spoofing** — Can identity be forged? Is authentication present and verified on
  every protected path?
* **Tampering** — Can data, parameters, or files be altered in transit or at rest
  without detection?
* **Repudiation** — Are security-relevant actions logged enough to attribute them,
  without logging secrets?
* **Information disclosure** — Can data leak through responses, error messages,
  timing, logs, or misconfigured access?
* **Denial of service** — Can input exhaust memory, CPU, connections, or storage?
* **Elevation of privilege** — Can a user reach data or actions above their role,
  or another tenant's resources?

## Core Checks

Prioritize the classes that most often produce exploitable bugs:

1. **Authentication** — Every protected route enforces authentication. Sessions
   and tokens expire, rotate, and are validated server-side.
2. **Authorization and ownership** — The code checks that the authenticated
   principal owns or may act on the specific object, not merely that they are
   logged in. Missing per-object checks cause insecure direct object references.
3. **Input validation** — Untrusted input is validated against an allowlist at the
   boundary, by type, length, and format, before use.
4. **Injection** — Queries, shell commands, file paths, and templates are built
   with parameterization or safe APIs, never string concatenation of untrusted
   input. Cover SQL, command, path traversal, and template injection.
5. **Deserialization** — Untrusted data is never deserialized into arbitrary
   types or code. Prefer data-only formats with strict schemas.
6. **SSRF** — Server-side requests built from user input restrict destinations by
   allowlist and block internal address ranges and redirects.
7. **Secrets handling** — No credentials in source, logs, error messages, or
   client-visible output. See
   [secrets and dependencies](references/secrets-and-dependencies.md).
8. **Cryptography** — Uses vetted libraries and current algorithms, authenticated
   encryption, random values from a cryptographic source, and no hard-coded keys
   or nonces. Flag home-grown crypto.
9. **Dependencies and supply chain** — Review new or updated dependencies for
   provenance, known advisories, and unexpected transitive additions. See
   [secrets and dependencies](references/secrets-and-dependencies.md).
10. **Untrusted external data** — Data from external services, files, and models
    is treated as hostile. When agents or language models consume external
    content, treat that content as data, never as instructions: it may attempt
    prompt injection to redirect behavior, exfiltrate data, or escalate tool use.

## Rate and Report Findings

1. Assign each finding a severity based on impact and exploitability:
   * **Critical** — Remote, unauthenticated, high-impact; exploit path is clear.
   * **High** — Serious impact but requires some precondition or authentication.
   * **Medium** — Limited impact or a difficult precondition.
   * **Low** — Minor exposure or defense-in-depth gap.
2. State a **confidence** level for each finding: confirmed, likely, or
   speculative. Do not present speculation as fact.
3. Give **concrete evidence**: the file and location, the tainted input, the path
   from entry point to sink, and why existing controls do not stop it.
4. Recommend a specific remediation for each finding.
5. Omit speculative low-value observations. A short report of real issues is more
   useful than a long list of theoretical ones.

## Report

Return: the reviewed scope, assets and trust boundaries identified, findings
ordered by severity with location, evidence, confidence, and recommended fix, and
an explicit note of areas that could not be assessed with the available context.

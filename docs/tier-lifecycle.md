# Skill Tier Lifecycle

Skill tiers are maturity claims, not categories or popularity rankings. The
portable `metadata.tier` value declares a skill's tier. The generated registry
adds the evidence state that supports, or does not yet support, that claim.

## Evidence states

Each generated registry entry has a `maturity` object sourced from
`registry/maturity.json`.

| State | Meaning |
|---|---|
| `unverified` | The declared tier has not completed the current evidence gate. |
| `verified` | The declared tier has complete, maintainer-approved evidence. |
| `regressed` | Current evidence no longer supports the previous tier. |

The initial catalog predates this policy. Its existing `core` declarations are
therefore generated as `unverified`. They remain compatible with current
installations but do not count as promotion precedent or verified core status.

`lastEvaluatedAt` is the UTC date, in `YYYY-MM-DD` form, of the newest complete
evaluation used for the decision. Evidence records use the same date format and
reference reviewable artifacts by repository-relative path and SHA-256 hash.

## Entry and promotion gates

New skills enter at `experimental`. Promotions advance exactly one tier at a
time.

| Target tier | Required evidence |
|---|---|
| `experimental` | Repository and portable structural validation, contribution evidence required by `CONTRIBUTING.md`, and maintainer approval. |
| `extended` | All experimental gates, positive behavior uplift, held-out routing results that meet the current measured thresholds, applicable runtime smoke tests, and maintainer approval. |
| `core` | All extended gates, current structural validation, positive behavior uplift with no pending or failed human review, held-out routing quality that meets current recall, precision, and collision thresholds, successful smoke tests for every applicable supported runtime, and maintainer approval. |

A safety or compliance exception can admit an experimental skill under the
contribution policy. It does not by itself satisfy the positive behavior uplift
required for `extended` or `core`.

Do not promote a skill while a required threshold is undefined, an applicable
runtime is untested, a human review is pending, or any required result has
regressed. An explicit unsupported-runtime skip is evidence about
compatibility, not a passing smoke test for an applicable runtime.

## Maturity evidence

`registry/maturity.json` is the source manifest. `registry/skills.json` is
generated output. A verified `extended` or `core` record requires these evidence
types:

- `structural-validation`
- `behavior-evaluation`
- `routing-evaluation`
- `runtime-smoke-test`
- `maintainer-approval`

A verified experimental entry requires `structural-validation` and
`maintainer-approval`. A demotion requires `regression-report` and
`maintainer-approval`.

Example:

```json
{
  "schemaVersion": 1,
  "skills": {
    "example-skill": {
      "status": "verified",
      "lastEvaluatedAt": "2026-07-26",
      "evidence": [
        {
          "type": "structural-validation",
          "reference": "evidence/example-skill/validation.json",
          "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "recordedAt": "2026-07-26"
        },
        {
          "type": "maintainer-approval",
          "reference": "evidence/example-skill/approval.json",
          "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "recordedAt": "2026-07-26"
        }
      ]
    }
  }
}
```

Run `npm run registry` after changing the manifest. Pull-request CI compares the
candidate registry with the base revision and rejects new non-experimental
entries, skipped promotions, incomplete promotion evidence, and unsupported
demotions.

## Regression and demotion

Mark a skill `regressed` when a required structural, behavior, routing, smoke,
security, or compatibility gate fails against the current release. Record the
failed result and maintainer decision, then demote to the highest tier whose
criteria still pass. Severe safety, legal, or supply-chain failures can move
directly to deprecation instead.

Recovery requires fresh evidence. A skill may return from `regressed` to
`verified` at its current lower tier, then follow the normal one-tier promotion
sequence.

## Deprecation and removal

Deprecate a skill when it is unsafe, unmaintained, incompatible with supported
runtimes, superseded, or persistently below the experimental entry bar. A
deprecation requires maintainer approval, a changelog entry, a replacement or
migration note when available, and a final review date.

Remove a deprecated skill only after at least one published release has carried
the deprecation notice. Immediate removal is allowed for a confirmed security,
legal, or credential-exposure risk. Removal requires maintainer approval,
release notes, deletion of generated registry entries, and preservation of the
decision in version history. AS-010 will add machine-readable lifecycle and
replacement fields; until then, deprecation and removal are recorded in
documentation and the changelog.

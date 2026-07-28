# Drift Detection

The drift detector compares explicit baseline and current artifacts and emits a
sanitized corrective proposal. It never edits, reverts, schedules work, or
creates an issue.

## Inputs

Provide all of these:

- Baseline and current behavior evaluation results.
- Baseline and current routing evaluation results.
- Baseline and current runtime-smoke results.
- The current lifecycle manifest.
- An explicit UTC comparison date in `YYYY-MM-DD` form.

The detector refuses unlike suites, skills, adapters, models, or runtime
matrices. Ephemeral timestamps and launch hashes do not define comparability.
Pass rate, held-out routing recall and precision, collision rate, duration,
tokens, optional cost, runtime status, and lifecycle review dates are compared
when the corresponding fields exist.

## Run

```bash
npm run drift:detect -- \
  --baseline-behavior <baseline-behavior.json> \
  --current-behavior <current-behavior.json> \
  --baseline-routing <baseline-routing.json> \
  --current-routing <current-routing.json> \
  --baseline-runtime <baseline-runtime.json> \
  --current-runtime <current-runtime.json> \
  --lifecycle registry/lifecycle.json \
  --as-of 2026-07-27 \
  --out tmp/drift/report.json
```

Omit `--out` to print the report. Output conforms to
`schemas/drift-report.schema.json`.

## Privacy And Authority

The report stores only input SHA-256 hashes, typed metric findings, a stable
semantic fingerprint, and corrective proposal text. It does not retain prompts,
model output, credentials, or source artifact bodies. A zero-finding report has
no proposal.

Use the fingerprint to deduplicate against open and completed work before a
maintainer creates an issue. A finding is evidence for review, not authority to
change or roll back the catalog.

## Hosted Follow-Up

Recurring post-merge and scheduled runs remain disabled. They require comparable
real-model baselines, approved thresholds, the recurring-orchestration pilot,
budget enforcement, and maintainer-approved issue-writing authority.

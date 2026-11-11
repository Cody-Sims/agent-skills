---
title: Skill Evaluations
description: Define and run isolated baseline-versus-candidate behavior evaluations for Agent Skills
ms.date: 2026-11-09
ms.topic: how-to
---

## Evaluation Boundary

Behavior evaluations compare the same prompt and objective assertions in two
separate adapter processes:

* The baseline receives no skill content.
* The candidate receives the current complete skill tree and `SKILL.md` content.

Each execution gets a distinct temporary working directory. Optional fixtures
are copied into that directory after containment and symlink checks. Trusted
setup scripts can prepare actual Git state or inert symlink scenarios before
the adapter runs. This is filesystem isolation, not an operating-system or
network sandbox. Review the adapter, setup, and graders as trusted code and
grant only the credentials they need.

Generated artifacts record prompt and output SHA-256 hashes, assertion evidence,
suite and candidate-skill SHA-256 hashes, pass rates, duration, and token usage.
They do not retain raw prompts or model outputs. Human-review questions remain
`pending` until an independent reviewer records a judgment outside the
automated run.

Behavior suite version 2 emits result schema version 3 for workspace and
command assertions. Legacy text-only suite version 1 still emits result
version 2; routing also emits version 2. New runs require adapter and exact
model identity, and routing results bind the suite hash. Validators retain
legacy artifacts, but outcome assertions cannot be labeled as legacy results,
and identity-dependent comparisons may reject older evidence.

## Suite Format

The committed pilot lives at `evals/evals.json`; each maintained skill also has
a suite at `evals/skills/<name>/evals.json`. Suites are validated against
`schemas/eval-suite.schema.json`. Each case defines:

* A stable case ID and realistic prompt
* An optional fixture directory relative to the suite
* An optional trusted setup script relative to the suite
* One or more objective assertions
* Optional human-review questions for subjective qualities

Keep training examples separate from held-out validation cases. Do not place
generated results, private prompts, secrets, or customer data in the repository.

### Outcome assertions

Suite version 2 adds assertions against actual workspace or process state.
Text assertions remain useful for reports but cannot prove that a file was
written, a test ran, or a Git operation preserved someone else's index.

| Type | Fields beyond `id` and `type` | Checks |
|---|---|---|
| `contains`, `notContains`, `regex` | `value`; optional regex `flags` | Adapter response text. |
| `fileContains`, `fileEquals` | `path`, `value` | Literal content in a regular workspace file. |
| `fileAbsent` | `path` | No entry at that workspace path, including dangling symlinks. |
| `unchanged` | `path` | Same pre/post snapshot, including added files, modes, nested symlink targets, and Git metadata. |
| `command` | `path`; optional `timeoutMs` | A reviewed independent Node oracle returns `passed: true`. |

Workspace paths are relative and cannot escape the workspace. File assertions
do not follow symlinks and read at most 256 KiB. Snapshots are bounded to 2,000
entries and 16 MiB. Setup and command paths resolve under the suite directory,
not the mutable task tree.

For example:

```json
{
  "schemaVersion": 2,
  "name": "deliverable-check",
  "skill": "planning-and-task-breakdown",
  "cases": [{
    "id": "write-plan",
    "prompt": "Write plan.md with exclusive ownership for the approved tasks.",
    "assertions": [
      { "id": "artifact", "type": "fileContains", "path": "plan.md", "value": "Owner" }
    ],
    "humanReview": [
      { "id": "ownership", "question": "Are writes exclusive and integration gates assigned?" }
    ]
  }]
}
```

### Trusted setup and independent commands

A case may declare `"setup": { "path": "prepare.mjs", "timeoutMs": 5000 }`.
The runner executes that reviewed suite script separately for both variants,
before taking snapshots. A command assertion similarly names an oracle such
as `"path": "oracles/check.mjs"`. The Node script runs with the workspace as
its working directory and receives only this JSON on stdin:

```json
{ "protocolVersion": 1, "workspace": "/isolated/workspace" }
```

Setup must return `{ "ready": true }`; an oracle must return a boolean
`passed` field. Neither receives the variant, model response, or expected
assertions. These scripts use the supervised no-shell launcher, a reduced
environment, bounded output, and a default 10-second timeout, configurable
from 1 through 30,000 milliseconds. Cleanup uncertainty preserves the workspace.

Keep oracle scripts outside copied fixtures and use independent public behavior,
mutation sensitivity, or actual Git state rather than model-authored receipts.
Withholding them from requests is not hostile-code confinement: no OS sandbox
prevents a trusted adapter from accessing other paths.

All 24 per-skill suites include synthetic execution fixtures or trusted setup.
Local controls exercise deliverables, read-only state, new typed APIs,
false-green tests, provenance, and shared Git staging. The typed API control
uses native TypeScript stripping and requires Node.js 22.6 or later.
These controls establish harness behavior, not model adherence or uplift.
Wayfinder's interrupted-effect fixture is not a demonstrated live adapter
recovery; real interrupted-effect trials remain pending.

### Contribution evidence

For contribution evidence, place a reviewed and sanitized result under a root
`evals/results/` path and reference its committed suite. The contribution
validator recomputes metrics and verifies the artifact's suite hash, candidate
complete skill-tree hash, declared rates, skill identity, and completed human
review.
These checks establish integrity, not run authenticity. Required CI, CODEOWNERS,
and branch protection must ensure the evidence was produced and reviewed through
the approved process; a contributor can otherwise hand-author internally
consistent JSON.

## Adapter Protocol

The runner starts a new adapter process for every case and variant. It sends one
JSON object on standard input:

```json
{
  "protocolVersion": 1,
  "caseId": "fresh-command-evidence",
  "prompt": "Evaluation prompt",
  "variant": "candidate",
  "skillPath": "/isolated/workspace/.candidate-skill",
  "skillContent": "Complete SKILL.md content or null for baseline"
}
```

Candidate runs receive the complete skill tree at the stable `.candidate-skill`
path inside their isolated workspace, including declared references, scripts,
and assets. `skillPath` is `null` for baseline runs, and the candidate tree is
not staged there. Adapters should resolve bundled resources from `skillPath`
rather than assuming a repository checkout.

The adapter writes one JSON object to standard output:

```json
{
  "text": "Model response",
  "inputTokens": 100,
  "outputTokens": 40
}
```

Diagnostic text belongs on standard error. A nonzero exit code, timeout, invalid
JSON, or invalid metric fails the run. The runner suppresses adapter stdout and
stderr in failure messages and does not invoke a shell.

Adapters receive only a small operating-system environment allowlist by default.
Opt into each required credential or configuration variable explicitly:

```bash
npm run eval -- \
  --suite evals/evals.json \
  --adapter /absolute/path/to/model-adapter \
  --adapter-id <stable-adapter-id> \
  --model <exact-model-version> \
  --adapter-env MODEL_API_KEY \
  --out tmp/evaluations/result.json
```

Treat every named variable as disclosed to the adapter process. Assertion
evidence never stores matched output text. Regular expressions execute in a
terminable worker with a separate grading deadline.

## Commands

Validate the committed suite without model execution:

```bash
npm run eval:validate
```

Exercise the complete runner with the deterministic test adapter:

```bash
npm run eval:smoke
```

The smoke adapter proves process isolation, grading, metrics, and artifact
generation. Its uplift is synthetic and must not be used as promotion evidence.

Run a real adapter and write the result under the ignored `tmp/` directory:

```bash
npm run eval -- \
  --suite evals/evals.json \
  --adapter /absolute/path/to/model-adapter \
  --adapter-id <stable-adapter-id> \
  --model <exact-model-version> \
  --out tmp/evaluations/result.json
```

Repeat `--adapter-arg` for adapter arguments and use `--timeout-ms` to change the
two-minute per-execution default. Independently review pending human questions
and compare the candidate against the no-skill or previous-release baseline
before claiming uplift.

## Routing Evaluations

The routing suite at `evals/routing.json` keeps training and validation prompts
separate and repeats each prompt three times. It measures activation rate,
precision, recall, collisions, duration, tokens, and catalog-wide confusion.
The fixture suite gives every active skill positive and near-miss coverage,
including the `code-review`/`security-review` and
`requirements-and-spec-writing`/`planning-and-task-breakdown` boundaries.

The routing adapter receives `protocolVersion`, `caseId`, `prompt`, `trial`, and
the catalog's skill names and descriptions. It returns `selectedSkills`,
`inputTokens`, and `outputTokens`. Expected and excluded routes are never sent
to the adapter.

Routing adapters use the same environment isolation. Repeat `--adapter-env` only
for variables the adapter must receive.

Exercise the routing pipeline with deterministic keyword selection:

```bash
npm run routing:smoke
```

Run a real routing adapter with:

```bash
npm run routing -- \
  --suite evals/routing.json \
  --adapter /absolute/path/to/routing-adapter \
  --adapter-id <stable-adapter-id> \
  --model <exact-model-version> \
  --out tmp/evaluations/routing.json
```

Runs without an approved policy leave `thresholds` as `null`. After repeated
real-model baselines, create a policy conforming to
`schemas/routing-thresholds.schema.json`. It binds the suite and source-result
hashes, measurement date, trial count, adapter and model identity, measured
rates, and held-out recall, overall precision, and collision limits. Enforce it
with:

```bash
npm run routing -- \
  --suite evals/routing.json \
  --adapter /absolute/path/to/routing-adapter \
  --adapter-id <stable-adapter-id> \
  --model <exact-model-version> \
  --threshold-policy <measured-policy.json> \
  --out tmp/evaluations/routing.json
```

The command rejects mismatched provenance and exits nonzero when measured
results miss the policy. The synthetic adapter cannot justify or establish
promotion thresholds.

## Pack Composition Evaluations

Each active workflow pack has a versioned suite under `evals/packs/`. Suites
bind registry v5, exact pack and member versions,
ordered handoffs, and a reviewed adapter entrypoint and launch policy. Cases
include training and held-out validation prompts, positive requests for every
member and handoff, adjacent near misses, and out-of-pack negatives.

```bash
npm run pack:validate
npm run pack:smoke
npm run pack:validate -- --result tmp/pack-evaluations/feature-delivery.json
```

Those commands are explicitly structural precommit checks. Their artifacts
carry no source commit and set `provenance.valid` to `false`. Once the suite is
committed, use:

```bash
npm run pack:validate:provenance -- --source-commit "$GITHUB_SHA"
npm run pack:smoke:provenance -- --source-commit "$GITHUB_SHA"
```

Provenance mode obtains the commit externally; suites do not embed a commit.
The commit must be `HEAD`, or an ancestor accepted only with
`--allow-ancestor`. Registry bytes, suite path and bytes, and every member blob
must exist and match exactly at that commit.

The adapter sees only the exact pack catalog. Expected routes, excluded routes,
case type, and handoff labels are omitted. Results reject out-of-pack routes and
record repeated-trial validation precision, recall, collisions, confusion, and
handoff coverage without retaining prompts, raw model output, stderr,
environment values, or secrets.

The final status is derived from trial evidence. `pass` requires every trial to
select exactly its expected routes and avoid every excluded route. Negative-case
activation is the fraction of trials selecting any pack member; a correct
negative selects none. Any incorrect trial produces `fail` and a nonzero runner
exit. Artifact validation recomputes the status.

Context accounting separates deterministic measurements from adapter claims:

* member count;
* serialized discovery metadata UTF-8 bytes;
* combined member `SKILL.md` UTF-8 bytes;
* on-demand resource UTF-8 bytes; and
* adapter-reported input tokens.

The suite and result also bind a deterministic complete member-tree digest over
sorted repository-relative paths and the SHA-256 of every member `SKILL.md` and
declared resource. Same-length content substitution therefore invalidates the
artifact. Adapter execution uses the shared runtime-smoke safe-launch contract,
isolated home/config/cache/temp directories, bounded output and time, and
process-group cleanup with workspace preservation when cleanup is unverifiable.

The public smoke uses `tests/fixtures/pack-adapter.mjs`. Every artifact labels
itself fixture evidence with `vendorHostExecuted: false` and
`promotionEligible: false`. Thresholds are `null`; real hosted runs and
composition promotion thresholds require follow-up baseline evidence.
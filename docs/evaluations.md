---
title: Skill Evaluations
description: Define and run isolated baseline-versus-candidate behavior evaluations for Agent Skills
ms.date: 2026-07-25
ms.topic: how-to
---

## Evaluation Boundary

Behavior evaluations compare the same prompt and objective assertions in two
separate adapter processes:

* The baseline receives no skill content.
* The candidate receives the current `SKILL.md` content.

Each execution gets a distinct temporary working directory. Optional fixtures
are copied into that directory after containment and symlink checks. This is
filesystem isolation, not an operating-system or network sandbox. Review the
adapter as trusted code and grant only the credentials it needs.

Generated artifacts record prompt and output SHA-256 hashes, assertion evidence,
suite and candidate-skill SHA-256 hashes, pass rates, duration, and token usage.
They do not retain raw prompts or model outputs. Human-review questions remain
`pending` until an independent reviewer records a judgment outside the
automated run.

## Suite Format

The committed pilot lives at `evals/evals.json` and is validated against
`schemas/eval-suite.schema.json`. Each case defines:

* A stable case ID and realistic prompt
* An optional fixture directory relative to the suite
* One or more `contains`, `notContains`, or `regex` assertions
* Optional human-review questions for subjective qualities

Keep training examples separate from held-out validation cases. Do not place
generated results, private prompts, secrets, or customer data in the repository.

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
  --out tmp/evaluations/routing.json
```

The committed result schema leaves thresholds as `null`. Establish recall,
precision, and collision thresholds only after repeated real-model baselines;
the synthetic adapter cannot justify promotion criteria.

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
# Shadow Conventions

The `.shadow/` directory is a repository-owned convention for durable, reviewable
architecture memory. It is not an official or vendor format. This file documents
the layout, record shape, and lifecycle states the skill assumes. A repository
may declare its own variant in `.shadow/README.md`; when it does, that declared
structure and schema take precedence over the defaults here.

## Directory layout

```
.shadow/
  README.md        Human entry point: purpose, index location, schema location.
  index.*          Machine-readable index of decisions and their relations.
  schema.*         Schema for decision records and the index.
  decisions/       One record per durable architecture decision.
  features/        Optional feature map derived from repository boundaries.
  derived/         Generated, disposable views such as rendered graphs.
```

Prefer JSON or YAML for `index` and `schema` so records can be validated. Keep
hand-authored decisions authoritative and treat everything in `derived/` as
regenerable output.

## Decision record fields

Each decision record should carry at least:

* `id`: stable unique identifier, referenced by relations and the index.
* `title`: short human-readable summary.
* `status`: lifecycle state (see below).
* `statement`: the decision or constraint, in present tense.
* `rationale`: why the decision holds, or `unknown` when it cannot be verified.
* `anchors`: workspace-relative paths to the code, tests, or docs it governs.
* `evidence`: workspace-relative references to commits, issues, or pull requests
  that support the claim.
* `relations`: links to related decisions, such as supersedes or depends-on,
  each pointing at a valid `id`.

## Lifecycle states

* `observed`: reconstructed from current evidence in the repository. Use only
  when present code, tests, or docs support it.
* `proposed`: a desired change not yet adopted. Requires human approval to
  advance.
* `accepted`: an approved decision. Do not rewrite accepted history; supersede it
  with a new linked decision instead.
* `superseded`: replaced by a newer decision, which it links to.

## Integrity rules

* Every relation target must resolve to an existing decision `id`.
* Every anchor and evidence path must exist in the workspace.
* The index and the decision records must agree.
* Missing rationale stays `unknown`; do not fill gaps with plausible prose.
* Derived output records how it was generated and is never a source of truth.

# Source Hierarchy

How to rank sources by authority and decide when a claim is adequately supported.
Use it alongside the main workflow's "Choose Sources" step.

## Ranking

Sources are ranked from most to least authoritative. Prefer the highest available
tier that addresses the exact version and question.

### Tier 1: Primary and authoritative

The source defines or implements the thing in question.

* Official specifications and standards documents.
* Official product or library documentation matched to the correct version.
* Release notes and changelogs published by the maintainers.
* The source code itself, including inline documentation and type signatures.
* Official security advisories and vulnerability databases for CVE claims.

These are definitive. When they are clear and version-matched, a single Tier 1
source can support a claim, though a second confirmation is still valuable.

### Tier 2: Reputable secondary

The source is credible and traceable to a primary, but is not itself definitive.

* Posts by the maintainers or a project's official blog.
* Well-established reference sites that cite primary material.
* Conference talks and papers by recognized authors.
* Highly rated answers that quote and link official documentation.

Use these to explain or locate primary material. Confirm the underlying fact
against a Tier 1 source before relying on it for anything material.

### Tier 3: Low-trust

The source is unattributed, unverifiable, or incentivized.

* Anonymous blogs and tutorials without citations.
* Forum comments and chat logs.
* Content-farm and machine-generated pages.
* Aggregators that restate other pages without attribution.

Use these only as leads pointing toward a primary source. Never present a Tier 3
claim as fact on its own.

## Judging Authority

* **Provenance** — Who published it, and do they own or maintain the subject?
* **Version match** — Does it address the exact version in use? Documentation for
  another major version is a frequent cause of wrong answers.
* **Recency** — Is it current, and has a later release changed the behavior?
* **Corroboration** — Does an independent source agree?
* **Specificity** — Does it address the precise question, or only something nearby?

## When Sources Conflict

1. Prefer the more authoritative tier.
2. Among equal tiers, prefer the one matching the version in use.
3. Among equal and version-matched sources, prefer the more recent.
4. If a credible conflict remains, report both positions, cite each, and state
   which is better supported and why.

## Sufficiency

* A material factual claim needs at least one Tier 1 source, or two independent
  Tier 2 sources when no Tier 1 source is reachable.
* A version number, API signature, flag, or default value must come from Tier 1;
  never infer these from secondary description alone.
* When the available evidence does not meet this bar, label the claim as unknown
  rather than overstating confidence.

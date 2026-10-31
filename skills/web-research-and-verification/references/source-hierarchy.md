# Source Hierarchy

Read when source authority, sufficiency, or conflict needs judgment.

## Ranking

Prefer the highest tier matching the exact version and claim.

### Tier 1: Primary and authoritative

The source defines or implements the thing in question.

* Official specifications and standards documents.
* Official product or library documentation matched to the correct version.
* Release notes and changelogs published by the maintainers.
* The source code itself, including inline documentation and type signatures.
* Official security advisories and vulnerability databases for CVE claims.

Tier 1 is necessary for exact versions, signatures, flags, parameters, and
defaults. Authority alone does not waive required corroboration.

### Tier 2: Reputable secondary

The source is credible and traceable to a primary, but is not itself definitive.

* Posts by the maintainers or a project's official blog.
* Well-established reference sites that cite primary material.
* Conference talks and papers by recognized authors.
* Highly rated answers that quote and link official documentation.

Use for leads/explanation; confirm material facts against Tier 1 when available.

### Tier 3: Low-trust

The source is unattributed, unverifiable, or weakly accountable.

* Anonymous blogs and tutorials without citations.
* Forum comments and chat logs.
* Content-farm and machine-generated pages.
* Aggregators that restate other pages without attribution.

Use only as leads; never as sole factual evidence.

## Judging Authority

* **Provenance** — Who published it, and do they own or maintain the subject?
* **Version match** — Does it address the exact version in use? Documentation for
  another major version is a frequent cause of wrong answers.
* **Recency** — Is it current, and has a later release changed the behavior?
* **Corroboration** — Does independent evidence agree? Mirrored/copied pages do
  not count twice; docs and implementation/release evidence must independently
  support the actual claim, even when published by the same maintainer.
* **Specificity** — Does it address the precise question, or only something nearby?

## When Sources Conflict

1. Prefer authority, then exact version match, then recency within that version.
   Newer docs for another version do not establish installed behavior.
2. Report credible unresolved conflicts with both citations and the basis for
   any preference. Do not silently combine incompatible signatures/defaults.

## Sufficiency

1. Corroborate material external claims with independent evidence, including a
   version-matched Tier 1 source. When Tier 1 is unreachable, two independent
   Tier 2 sources may support non-signature facts; disclose the limitation.
2. Security/safety, legal/compliance, irreversible, disputed, and rapidly changing
   claims require corroboration. Do not replace primary advisories or exact
   API/version evidence with secondary agreement.
3. Routine installed syntax/defaults may use version-matched authoritative
   help/source alone if no risk, deprecation, or conflict exists. Cite the exact
   local command/path and disclose this single-source exception. It says nothing
   about current hosted behavior.
4. If required evidence is missing or contradictory, label the claim unknown.
   Stop at the bounded research limit and state unavailable corroboration rather
   than fabricating certainty.

---
name: web-research-and-verification
description: Answers questions that depend on current external information by detecting the exact version in use, preferring primary and authoritative sources, corroborating with a second source, quoting and citing URLs, and separating verified fact from inference. Use when researching APIs, libraries, standards, release notes, CVEs, or any claim where accuracy and up-to-date sourcing matter, or when a source may be deprecated.
license: MIT
metadata:
  version: "1.0.0"
  author: Cody-Sims
  tier: core
---

# Web Research and Verification

Answer questions grounded in external information without guessing or fabricating.
Model knowledge drifts out of date, so treat every material claim as unverified
until a current, authoritative source confirms it.

## Establish the Target

1. Determine what precisely is being asked and what a correct answer would let the
   user do.
2. Identify the exact version or release that applies before trusting any source.
   Behavior, flags, and APIs differ across versions.
   * Read the version from the repository's lockfile, manifest, or `--version`
     output rather than assuming the latest.
   * When the version is unknown and cannot be inferred, state that the answer is
     version-dependent and give the version you assumed.
3. Note the date sensitivity of the question so stale material can be recognized.

## Choose Sources

Prefer sources in this order. See the
[source hierarchy](references/source-hierarchy.md) for the full ranking and how to
judge authority.

1. Primary and authoritative: official documentation, specifications, standards,
   release notes, changelogs, and the source code or its inline docs.
2. Reputable secondary: maintainer blog posts, well-regarded references that cite
   primaries, and accepted answers that link to official material.
3. Low-trust: forums, unattributed blogs, and content-farm pages. Use only for
   leads, and confirm every claim against a primary source before relying on it.

Match the source to the exact version identified. Documentation for a different
major version is a common source of wrong answers.

## Verify

1. Corroborate each material claim with a second independent source, ideally the
   primary plus one other. A single blog post is not sufficient for a factual claim.
2. Quote the exact wording that supports a claim and cite the source URL, so the
   user can check it.
3. Prefer the current documented method. When you encounter something that looks
   deprecated, re-check it against current release notes and the changelog before
   presenting it, and flag the deprecation.
4. Never fabricate APIs, flags, parameters, version numbers, or citations. If a
   detail cannot be confirmed, say so rather than inventing a plausible value.
5. Test claims against reality when the environment allows it, for example by
   reading the installed source or running a documented command, and prefer that
   direct evidence over any web description.

## Separate Fact From Inference

1. Label each part of the answer as one of:
   * **Verified** — directly supported by a cited authoritative source.
   * **Inferred** — a reasonable conclusion drawn from verified facts, marked as
     reasoning rather than citation.
   * **Unknown** — not established by available sources; state it plainly.
2. Do not present inference or memory as if it were sourced fact.
3. When sources conflict, report the conflict, prefer the more authoritative and
   more current one, and explain the basis for the choice.

## Report

Return: the answer with each material claim cited to a URL and, where useful, a
short quotation; the exact version or release the answer applies to; a clear split
between verified, inferred, and unknown; and any deprecation or conflict found.

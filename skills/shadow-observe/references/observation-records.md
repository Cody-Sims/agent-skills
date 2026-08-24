# Observation Record Guide

Use the repository's `.shadow/README.md`, index, and schema before this guide.
This guide supplies a portable reporting shape only when the repository does not
name more specific fields. It does not authorize creating a `.shadow` layout.

## Report Shape

A report or candidate artifact should preserve these concepts:

```json
{
  "schemaVersion": 1,
  "lifecycle": "candidate",
  "scope": {
    "question": "Bounded architecture question",
    "includedPaths": ["src/example"],
    "excludedPaths": ["vendor"],
    "limits": {
      "maxDepth": 4,
      "maxEntries": 2000
    },
    "stoppingReason": "Question answered"
  },
  "source": {
    "revision": "commit identifier or unknown",
    "worktreeState": "clean, modified, or unknown"
  },
  "provenance": {
    "generatedAt": "repository-approved timestamp or omitted",
    "tools": ["read-only command or helper"],
    "invocation": "bounded request summary"
  },
  "verifiedClaims": [
    {
      "claim": "Directly supported statement",
      "anchors": ["src/example/module.js"],
      "evidencePaths": ["tests/example.test.js"],
      "relatedDecisionIds": ["decision-id"]
    }
  ],
  "inferences": [
    {
      "inference": "Bounded interpretation",
      "evidencePaths": ["src/example/module.js"],
      "confidenceBoundary": "What remains unverified",
      "relatedDecisionIds": []
    }
  ],
  "unknowns": [
    {
      "unknown": "Unresolved fact",
      "neededEvidence": "Specific record, owner review, or source",
      "relatedDecisionIds": []
    }
  ]
}
```

Field names are illustrative. Map the concepts to the repository schema rather
than adding undeclared fields.

## Evidence Rules

- Use workspace-relative paths.
- Add line ranges, symbols, or record fragments when they improve precision.
- Use `anchors` for implementation locations governed by an observation.
- Use `evidencePaths` for files or records that prove or support the statement.
- Keep related decision IDs empty when no indexed relation is verified.
- Record a source revision when version control exposes one. Otherwise use
  `unknown`; do not substitute a branch name for a revision.
- Record dirty worktree state separately because a commit ID alone may not
  identify the analyzed source.
- Do not claim that file proximity, naming, or import direction proves rationale.

## Writing Gate

Write an artifact only when all conditions hold:

1. The user explicitly requested candidate observation files.
2. `.shadow/README.md` or its linked schema declares an observation location.
3. The declared lifecycle can represent an unreviewed candidate.
4. The destination resolves inside the declared `.shadow` layout without a
   symlink escape.
5. Required fields and relations can be validated.

If any condition fails, return the structured report in the response and list
the missing declaration or approval.

## Lifecycle Review

- A candidate remains unreviewed even when all cited evidence resolves.
- Confirmation requires the human or repository process named by the schema.
- Dismissal should preserve reviewer reasoning and source evidence when the
  repository format supports history.
- A candidate may inform a later decision, but it is not itself an accepted
  decision and must not be presented as rationale.

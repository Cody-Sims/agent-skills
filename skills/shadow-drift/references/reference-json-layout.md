# Reference JSON Layout

The fallback validator supports one deliberately narrow layout. A repository
that declares another schema must use its own validator.

## Files

```text
.shadow/
  index.json
  decisions/
    one-decision.json
  derived/
    optional-output.json
```

All paths in the graph are repository-relative. Absolute paths, `..` escapes,
symlink components, nested decision directories, and non-JSON decision records
are rejected.

## Index

`.shadow/index.json` has this shape:

```json
{
  "schemaVersion": 1,
  "decisions": [
    {
      "id": "decision-a",
      "path": ".shadow/decisions/decision-a.json"
    }
  ],
  "derived": [
    {
      "path": ".shadow/derived/summary.json",
      "sources": [
        {
          "path": "src/example.js",
          "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }
      ]
    }
  ]
}
```

`derived` is optional. Each derived source requires a lowercase SHA-256 digest.
The output is stale when it is missing, a source is missing, or a source digest
has changed.

## Decision Record

Every JSON file directly under `.shadow/decisions/` has this shape:

```json
{
  "schemaVersion": 1,
  "id": "decision-a",
  "title": "Keep one implementation boundary",
  "status": "accepted",
  "statement": "The implementation keeps one boundary.",
  "rationale": "The boundary limits coupling.",
  "anchors": [
    {
      "path": "src/example.js",
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "contains": "export function example"
    }
  ],
  "evidence": [
    {
      "path": "test/example.test.js",
      "contains": "keeps one boundary"
    }
  ],
  "relations": [
    {
      "type": "depends-on",
      "target": "decision-b"
    }
  ]
}
```

Required lifecycle states are `observed`, `proposed`, `accepted`, and
`superseded`. Anchor and evidence references require `path`; `sha256` and
`contains` are optional machine checks. Relations require `type` and `target`.

## Classification

- **aligned**: every referenced file exists, no check fails, and at least one
  digest or content assertion provides verifiable support;
- **drifted**: at least one digest or content assertion fails;
- **stale**: every declared implementation anchor is missing;
- **unknown**: evidence is incomplete or no machine-checkable assertion exists.

Structural findings are reported separately. They include orphan records,
unresolved relations, empty or missing anchors and evidence, index disagreement,
and stale derived output.

## CLI

```text
node validate-shadow.mjs [options]

--root PATH
--format text|json
--help
```

The default root is the current directory. The default output is text. JSON
output is stable and contains no timestamp or absolute repository path.

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | The supported graph is fully aligned with no integrity findings. |
| `1` | Drift, staleness, unknowns, or integrity findings were reported. |
| `2` | JSON input, file reading, or path and symlink safety failed. |
| `3` | The repository does not use the supported reference layout. |
| `64` | Command-line arguments are invalid. |

Malformed JSON is an input error. A missing or structurally incompatible
`index.json` is unsupported. Neither condition is reported as successful
validation.

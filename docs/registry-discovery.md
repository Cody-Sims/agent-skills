# Registry Discovery Metadata

`registry/discovery.json` stores catalog-only metadata that helps tools search,
filter, and compose skills. It is not installed with a skill and does not add
tokens to runtime startup context. `npm run registry` validates the manifest and
merges it into generated `registry/skills.json`.

## Record contract

Every canonical skill must have exactly one record.

| Field | Meaning |
|---|---|
| `category` | One primary catalog grouping as a lowercase slug. |
| `tags` | Search terms used to narrow intent and artifact matches. |
| `inputs` | Unique typed artifacts or requests the skill consumes. |
| `outputs` | Unique typed artifacts or results the skill produces. |
| `risk` | A `low`, `medium`, or `high` level and concrete risk-factor slugs. |
| `runtimeCompatibility` | One explicit status for each supported runtime. |
| `relatedSkills` | Complementary skills that may precede, follow, or compose with this skill. |
| `conflictingSkills` | Skills that should not be selected or composed with this skill. |
| `examplePrompts` | Realistic requests that should route to the skill. |

Runtime status is `compatible`, `conditional`, `unsupported`, or `untested`.
Use `notes` for a concrete condition or reason; otherwise use `null`.
Compatibility describes whether the portable skill contract and workflow apply
to a runtime; maturity smoke-test evidence is tracked separately.
Relationships must reference existing skills, cannot reference the record
itself, and cannot list the same target as both related and conflicting.

The schema is `schemas/registry-discovery.schema.json`. The generated registry
schema repeats the same discovery definition; tests prevent the two definitions
from drifting.

## Generate and validate

```bash
npm run registry
npm run registry:check
```

Generation fails for missing or unknown skill records, duplicate typed
artifacts, duplicate runtimes, incomplete runtime coverage, invalid
relationships, or schema violations. Output arrays are sorted so generation is
deterministic.

Registry v3 adds `discovery` while preserving v2 `maturity` records. Pull-request
comparison accepts registry v1 through v4 as migration baselines. Current
generated output is registry v5.

## Query

```bash
npm run registry:query -- \
  --category security \
  --runtime github-copilot \
  --runtime-status compatible \
  --input component \
  --output threat-report
```

Available filters are `--category`, repeatable `--tag`, `--risk`, `--runtime`,
`--runtime-status`, `--input`, and `--output`. Filters use AND semantics.
`--runtime-status` requires `--runtime`. Output is one skill name per line by
default; use `--format json` for complete matching records or
`--registry <path>` to query another registry v5 file.

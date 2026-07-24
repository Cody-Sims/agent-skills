# Frontmatter Reference

The frontmatter is the contract every `SKILL.md` in this repository must satisfy.
It is validated against `schemas/skill.schema.json` and by
`gh skill publish --dry-run`.

## Field table

| Field | Required | Type | Constraints |
|---|---|---|---|
| `name` | Yes | string | 1 to 64 characters. Matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`: lowercase letters, digits, and single hyphens, with no leading, trailing, or consecutive hyphens. Must equal the parent directory name. Must not contain the reserved words that hosted validation rejects. |
| `description` | Yes | string | 1 to 1024 characters. Third person. Contains no angle-bracket characters. States what the skill does and when to use it. Front-loads concrete trigger vocabulary. |
| `license` | Yes here | string | Short identifier. Use `MIT` for skills in this repository. |
| `metadata` | Yes here | mapping | All values are strings. Requires `version` as a quoted semantic version like `"1.0.0"`, `author`, and `tier` of `core`, `extended`, or `experimental`. |
| `compatibility` | No | string | 1 to 500 characters. Concrete runtime, package, command, or network requirements. Omit when there are none; most skills omit it. |
| `user-invocable` | No | boolean | Exposes the skill as an explicit slash command in supporting runtimes. |
| `disable-model-invocation` | No | boolean | Prevents autonomous activation, requiring explicit invocation. Use for destructive or expensive workflows. |
| `argument-hint` | No | string | 1 to 200 characters. Placeholder text shown after the slash command. |

## Required minimum

Every skill in this repository sets:

```yaml
name: example-skill
description: "Does one clear thing and states when to use it, with concrete trigger words. Use when ..."
license: MIT
metadata:
  version: "1.0.0"
  author: "Cody-Sims"
  tier: "core"
```

## Constraints restated

- `name` equals the directory name. A mismatch fails validation.
- `description` must be quoted when it contains a colon followed by a space, so
  the YAML parser does not treat the text after the colon as a mapping.
- `metadata` values are strings only. Quote the version so it is not parsed as a
  number.
- `version` follows `MAJOR.MINOR.PATCH`.

## Forbidden fields

Do not add any of the following:

- `allowed-tools`. It is experimental, not portable, and not a security boundary.
- `when_to_use`. It is a nonportable extension; put all trigger information in
  `description`.
- `tools`, `model`, `paths`. These are not part of the frontmatter contract.
- Any top-level `version`. Version belongs under `metadata.version`.
- Any key not listed in the field table above.

## Common failures

- Uppercase letters, spaces, or underscores in `name`.
- A `description` under 40 characters, over 1024 characters, or containing an
  angle-bracket character.
- Unquoted `metadata` values, or a numeric version.
- A relative link that points to a file that does not exist.
- A body over 500 lines, which should be split into `references/`.

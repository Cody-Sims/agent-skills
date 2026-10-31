# Commit Message Rules

Read when composing or rewording an authorized commit. Match repository rules and
existing history; keep one logical change per commit.

## Subject Line

1. Use imperative mood: "Add retry", not "Added retry" or "Adds retry".
2. Aim for 50 characters; never exceed 72. Capitalize the first word; no period.
3. Describe the change, not the discovery process. Split unrelated changes rather
   than hiding them in one subject.

## Body

1. Use a blank line after the subject; wrap the body at roughly 72 characters.
2. Explain what/why and non-obvious constraints, rejected alternatives, or tradeoffs.
   Do not narrate the diff. Omit a body only for small, self-evident changes.

## Conventional Commit Form

Use only when existing conventions or release tooling expect it:

```
<type>(<optional scope>): <description>
```

Types: `feat` (capability), `fix` (bug), `docs`, `refactor` (same behavior), `test`,
`chore` (maintenance), and `perf` (performance).

Indicate a breaking change with a `!` before the colon (`feat!:`) or a
`BREAKING CHANGE:` paragraph in the body describing the migration.

## Trailers

Place machine-readable trailers in a block at the end of the message, after a
blank line, one per line as `Key: value`:

* `Co-authored-by: Name <email>` — credit an additional author.
* `Signed-off-by: Name <email>` — assert a Developer Certificate of Origin only
  when required and legitimately authorized.
* `Refs: #123` or `Fixes: #123` — link an issue; `Fixes` closes it on merge for
  hosts that support the keyword.

Keep trailer keys consistent with the repository's existing history.

## Example

```
Fix crash when config file is missing

The loader assumed config.yaml always exists and dereferenced a nil
handle on first run. Return the documented defaults when the file is
absent so a fresh checkout starts cleanly.

Fixes: #482
```

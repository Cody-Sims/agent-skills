# Commit Message Rules

Well-formed commit messages make history reviewable, searchable, and safe to
revert. Read this when writing or rewording a commit.

## Subject Line

1. Use the imperative mood, as if completing the sentence "If applied, this commit
   will ...". Write "Add retry to fetch", not "Added" or "Adds".
2. Keep the subject to roughly 50 characters and never exceed 72.
3. Capitalize the first word. Do not end with a period.
4. Summarize the change itself, not the process ("Fix off-by-one in pager", not
   "Fix bug found in review").
5. Describe one logical change. If the subject needs "and", the commit probably
   should be split.

## Body

1. Separate the subject from the body with one blank line.
2. Wrap the body at roughly 72 characters.
3. Explain what changed and why, not how; the diff already shows how.
4. Record context a future reader will lack: the problem, constraints considered,
   alternatives rejected, and any deliberate trade-off.
5. Omit the body for small, self-evident changes. Add it whenever the change needs
   justification or has non-obvious consequences.

## Conventional Commit Form

A structured subject is optional but useful when a repository or its tooling
expects it. The form is:

```
<type>(<optional scope>): <description>
```

Common types:

* `feat` — a new user-visible capability.
* `fix` — a bug fix.
* `docs` — documentation only.
* `refactor` — behavior-preserving restructuring.
* `test` — adding or correcting tests.
* `chore` — build, tooling, or maintenance with no product behavior change.
* `perf` — a performance improvement.

Indicate a breaking change with a `!` before the colon (`feat!:`) or a
`BREAKING CHANGE:` paragraph in the body describing the migration.

Adopt this form only when the repository already uses it or its release tooling
depends on it. Match the existing history rather than introducing a new style.

## Trailers

Place machine-readable trailers in a block at the end of the message, after a
blank line, one per line as `Key: value`:

* `Co-authored-by: Name <email>` — credit an additional author.
* `Signed-off-by: Name <email>` — assert a Developer Certificate of Origin, when
  the project requires it.
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

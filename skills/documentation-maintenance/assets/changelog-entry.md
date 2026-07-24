# Changelog Entry Format

Guidance and a template for adding a changelog entry. The format follows the
common "Keep a Changelog" convention with semantic-version headings. Match the
repository's existing changelog style if it differs.

## Placement

Add new entries under an `Unreleased` heading at the top. On release, rename that
heading to the version and date and start a fresh `Unreleased` section.

## Categories

Group entries under these headings, omitting any that are empty:

* **Added** — new features or capabilities.
* **Changed** — changes to existing behavior.
* **Deprecated** — features soon to be removed.
* **Removed** — features removed in this release.
* **Fixed** — bug fixes.
* **Security** — vulnerability fixes and hardening.

## Writing entries

* Describe the effect on the user, not the internal implementation.
* Use the imperative or present tense consistently with the existing file.
* Keep each entry to one line where possible; link an issue or pull request.
* Mark breaking changes explicitly and describe the required migration.
* Omit purely internal changes with no user-visible effect.

## Template

```markdown
## [Unreleased]

### Added
- Describe the new capability from the user's perspective.

### Changed
- Describe what now behaves differently and how it affects users.

### Fixed
- Describe the bug that no longer occurs.

### Removed
- Describe what was removed and the replacement or migration, if any.

### Security
- Describe the vulnerability class addressed, without exploit detail.
```

## Example

```markdown
## [Unreleased]

### Changed
- Config files are now read from the user config directory instead of the
  working directory. Move existing `config.yaml` there, or set `APP_CONFIG`
  to its path. (#482)

### Fixed
- Fresh installs no longer crash when no config file is present.
```

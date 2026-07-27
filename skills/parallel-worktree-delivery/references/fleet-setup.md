# Fleet Setup Reference

Use this reference when creating, preparing, or prompting isolated worker
worktrees.

## Preconditions

- Pick an integration branch that already contains the common base for the wave.
- Confirm the current checkout is clean or that any uncommitted work belongs to
  the current operator.
- Verify ignored prerequisites that every worktree needs. Decide explicitly
  whether dependency directories are shared or isolated before running a package
  manager.

## Worktree creation

Run from the repository that owns the integration branch:

```bash
git worktree list
git worktree add -b "$stream_branch" "$worktree_path" "$integration_branch"
```

Name branches by stream, not by agent identity, for example
`migration/battle-effects` or `agent/import-cycle-guard`.

## Share ignored prerequisites deliberately

If the integration checkout has a usable ignored dependency directory and the
stream should reuse it, link and verify it explicitly. For a Node.js repository:

```bash
ln -s "$(pwd)/node_modules" "$worktree_path/node_modules"
test -L "$worktree_path/node_modules" && readlink "$worktree_path/node_modules"
```

If a stream intentionally needs an isolated install, document that choice before
running package-manager commands. Some package managers can replace a dependency
symlink with a real directory, which changes isolation and cleanup expectations.

## Ownership partitioning

Prefer directory-level ownership:

| Stream type | Example ownership boundary |
|---|---|
| Component decomposition | `src/components/menu/**` plus matching tests |
| Domain subsystem | `src/domain/effects/**` plus effect tests |
| Test infrastructure | `tests/architecture/**` and one named validation script |
| Documentation append | Orchestrator-owned changelog and release-note entries |

For shared files, partition inside the file:

- One stream may own only the scripts section in a package manifest.
- Another stream may own only dependencies in the same manifest.
- A worker may make one exact import-export line in an index file only when the
  prompt names that line.

## Worker prompt template

```text
You are working in worktree $worktree_path on branch $stream_branch based on
$integration_branch. Own only these paths or sections: $ownership. Do not edit
other files. If you discover a required cross-boundary change, report it instead
of making it unless this prompt names the exact boundary edit. Follow the stated
dependency setup. Run $checks and report validation, changed files, conflicts,
and follow-up risks.
```

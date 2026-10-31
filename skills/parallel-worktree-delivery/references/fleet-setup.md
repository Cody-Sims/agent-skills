# Fleet Setup Reference

Read only for authorized worktree setup or worker dispatch.

## Preconditions

1. Verify the integration branch/common base and live-checkout ownership. Setup
   does not require switching, stashing, or committing primary-checkout work.
2. Choose approved paths outside the primary working tree, available branch names,
   and one writer for shared Git administration.
3. Establish ignored prerequisites and resource ownership before launch: dependency
   manifests, generated outputs, caches, databases, ports, and CPU-heavy checks.

## Worktree creation

Run from the owning repository, after verifying the variables and branch base:

```bash
git worktree list
git worktree add -b "$stream_branch" "$worktree_path" "$integration_branch"
```

Name branches by stream, for example `migration/battle-effects`. Never force a
branch already checked out elsewhere.

## Share ignored prerequisites deliberately

Reuse a dependency directory only if manifests/lockfiles match and tools will not
mutate it. A symlink is sharing, not isolation. For approved Node.js reuse, verify
the source exists and destination is absent before linking:

```bash
ln -s "$(pwd)/node_modules" "$worktree_path/node_modules"
test -L "$worktree_path/node_modules" && readlink "$worktree_path/node_modules"
```

Isolate dependencies when manifests differ or a tool writes to them. Install only
when repository setup requires it, manifests changed, or checks report missing
dependencies; never concurrently install through shared symlinks. Package managers
may replace symlinks, so recheck setup after an authorized install.

## Ownership partitioning

Prefer exclusive directory/file ownership:

| Stream type | Example ownership boundary |
|---|---|
| Component decomposition | `src/components/menu/**` plus matching tests |
| Domain subsystem | `src/domain/effects/**` plus effect tests |
| Test infrastructure | `tests/architecture/**` and one named validation script |
| Documentation append | Orchestrator-owned changelog and release-note entries |

Keep shared manifests/indexes/changelogs with the coordinator. If section-level
exceptions are necessary, name exact sections/lines and serialize edits; workers
report all cross-boundary needs rather than broadening their own scope.

## Worker prompt template

```text
You are working in worktree $worktree_path on branch $stream_branch based on
$integration_branch. Complete $objective; stop at $acceptance_or_budget.
Own only $ownership; do not edit other files or spawn additional workers.
Report required cross-boundary changes unless explicitly authorized here.
Allowed Git/remote actions: $actions. Dependency/resource setup: $setup.
Run $scoped_checks; do not run coordinator gates or race shared outputs.
Report changed paths, commit tip, exact check/results, conflicts, and blockers.
```

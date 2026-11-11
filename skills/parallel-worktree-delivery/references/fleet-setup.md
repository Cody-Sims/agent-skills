# Fleet Setup Reference

Read only for authorized worktree setup or worker dispatch.

## Contents

- [Preconditions](#preconditions)
- [Capability preflight](#capability-preflight)
- [Worktree creation](#worktree-creation)
- [Share ignored prerequisites deliberately](#share-ignored-prerequisites-deliberately)
- [Ownership partitioning](#ownership-partitioning)
- [Worker prompt template](#worker-prompt-template)

## Preconditions

1. Verify the integration branch/common base and live-checkout ownership. Setup
   does not require switching, stashing, or committing primary-checkout work.
2. Choose approved paths outside the primary working tree, available branch names,
   and one writer for shared Git administration.
3. Establish ignored prerequisites and resource ownership before launch: dependency
   manifests, generated outputs, caches, databases, ports, and CPU-heavy checks.

## Capability preflight

Complete before delegation using current exposed tool definitions and inventories,
not remembered provider behavior. Keep a compact contract with the dispatch:

| Capability | Record |
|---|---|
| Required skills | Required name; exact advertised native name or authorized repository source path; selected loading route and verification status in each worker context |
| Worker handles | Current addressable handle; read/result support; follow-up support by worker type, visibility, and lifecycle state; historical session IDs kept separate |
| Messaging | Supported explicit-recipient operation; reported maximum recipients per call; permitted recipient relationships |
| Fallback | Authorized durable handoff location or blocked dependent work |

1. Inspect exposed definitions/inventories once; if required metadata is absent,
   make at most one targeted discovery query for that capability. Reuse known
   handles; do not enumerate workers when a usable handle is already available.
   Record unknowns and stop dependent dispatch rather than repeatedly searching.
2. For each required skill, distinguish native registration from repository
   source. Use an advertised native name only when supported in that context.
   If unavailable, read an authorized repository `SKILL.md` only when host policy
   and governing guidance permit source loading. Verify identity, worker-relative
   path, resources, and required tools; never bypass access denials or native-only
   rules. Do not retry an unavailable name, install globally, copy runtime
   installations, or expand permissions. Without a supported route, block the
   dependent stream. A worker confirms its route before dependent work; a known
   source path alone is not proof of worker access.
3. Capture messaging constraints before sending, including one-shot/result-only
   workers and state-specific follow-up restrictions. Propagate only currently
   supported handles/relationships to workers; a coordinator-visible handle need
   not be messageable by a sibling. Deduplicate and filter the
   intended recipients to known, visible, permitted message-capable handles.
   Preserve excluded workers' checkout ownership and report their handoff needs.
4. Partition eligible recipients into explicit batches no larger than the current
   host-reported limit. Do not copy a provider's numeric cap or substitute a broad
   scope. If only single-recipient sends are documented, use those. If no safe
   messaging route/limit is known, use the authorized handoff or report blocked;
   do not discover limits by sending oversized requests.
5. Record delivery results per batch. Do not resend successful recipients when
   another batch fails. Reconcile only unresolved handles using returned outcomes;
   unknown delivery is not success or a reason for blind retries or new owners.

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
Required skills: $required_names_and_exact_native_or_source_routes.
Capability contract: $verified_contexts_tools_and_messaging_limits.
Current permitted message handles/relationships: $messageable_handles_or_none.
Confirm the supported loading route in this checkout/runtime before dependent
work. Do not retry unavailable names, install globally, or expand permissions;
report blocked requirements. Follow-up: $supported_handle_operation_or_handoff.
Do not message result-only workers or use broad recipient scopes.
Run $scoped_checks; do not run coordinator gates or race shared outputs.
Report changed paths, commit tip, exact check/results, conflicts, and blockers.
```

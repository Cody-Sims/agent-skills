# Workflow packs

Workflow packs describe complementary, independently installable skills without
merging their instructions. `registry/packs.json` is the maintainer-authored
source. `schemas/packs.schema.json` defines its strict contract. The registry
generator validates and normalizes the manifest into `registry/skills.json`
schema version 5.

`manage-skills.mjs` installs, checks, and uninstalls exact-version pack
selections transactionally. Composition routing and combined-context evaluation
remain deferred to AS-009 slice 3.

## Install and selection behavior

Use a pack name or exact `name@version`:

```bash
npm run install:pack -- feature-delivery@1.0.0
npm run check:pack -- feature-delivery
npm run uninstall:pack -- feature-delivery
```

The underlying CLI accepts repeated `--pack` options and `--target`, `--agent`,
or `--dir` exactly as full-catalog operations do. It does not resolve versions
over the network. Unknown, removed, version-mismatched, conflicting, or
member-version-mismatched packs fail before mutation. `list` reports available
packs and the target receipt's catalog and pack selections; `list --pack NAME`
reports that pack's exact members.

Receipt v3 records a full-catalog boolean, a sorted pack-name-to-version map,
the exact union of selected skill versions and resources, source identity,
registry digest, and ownership hashes. Installing a pack adds its selection.
Uninstalling a pack removes only that selection. A shared skill remains while
the full catalog or another selected pack requires it.

## Transaction boundary

Each target is fully preflighted before writes. Existing files may be replaced
or removed only when a valid trusted receipt owns their current hashes.
For the default source, v2/v3 receipt ownership is accepted only after its
repository, immutable commit, committed registry digest, exact selection,
skill versions, resource set, and resource hashes are reproduced from Git.
The receipt commit must also be an ancestor of the already verified current
`HEAD`; an object that merely exists in the local Git database is insufficient.
This permits safe removal after repository `HEAD` advances without reducing
identity checks to repository-only trust. Foreign or forged receipts fail closed.
Recovery of an immutable v2/v3 receipt derives its prior-owned resource plan
from that historical commit; it does not substitute current catalog bytes.
If the current registry changes the selected pack version, uninstall still
requires a checkout whose pack version exactly matches the receipt.
An exclusive target-local operation lock is acquired before recovery or
preflight and retained through transaction finalization. Any existing lock,
including one whose recorded owner appears dead, fails closed. The operator must
inspect and remove it explicitly only after proving no manager operation remains
active; the installer never reclaims locks automatically.
Resources and a strict journal are staged under the target-specific
`.agent-skills-transaction` path. Receipt-owned paths are backed up, resources
are applied, and the receipt is committed last. Every destination is
revalidated against its preflight absence or receipt-owned hash immediately
before replacement. Transaction and cleanup roots carry explicit ownership
markers. A root that already exists or appears after preflight is preserved
unchanged unless ownership by the current or a validated prior transaction can
be proven. A command failure rolls the target back.

Recovery binds journal operations to the validated prior receipt and the staged
next receipt, current registry digest, exact selection, and resource hashes.
The derived operation set requires one write for every next resource and one
removal for every prior-owned resource absent from the next receipt.
Self-consistent or recomputed journal hashes alone do not establish ownership.
Valid active transactions roll forward to the trusted receipt plan. Terminal cleanup is
handed off atomically to `.agent-skills-transaction-cleanup`; cleanup failure
does not attempt rollback after logical commit. Malformed, foreign, forged, or
otherwise unverifiable state fails closed with a manual inspection action.
Immediately before the active-root rename and immediately before recursive
cleanup deletion, finalization revalidates the owner token, terminal journal
state, and exact journal-file digest. Root replacements and symlink swaps are
preserved and fail closed.

Multi-target commands preflight every target before mutating any. If a later
target fails, prior targets are rolled back in reverse order. This design claims
command-failure rollback and crash recovery boundaries. It does not claim
instantaneous atomicity across filesystems or targets.

## Contract

Each active pack records:

- a lowercase slug, pack semver, and factual description;
- exact skill names and skill semvers;
- ordered handoffs with explicit transition conditions whose distinct endpoints
  are included members;
- conflicting skill names;
- an install policy requiring exact versions, conflict rejection, and explicit
  compatible runtimes.

The manifest also has a `removed` map for immutable pack tombstones. Unknown
properties are rejected throughout the schema.

## Validation

`npm run registry` and `npm run registry:check` reject:

- unknown, duplicate, inactive, or version-mismatched members;
- duplicate handoffs or handoffs with self, missing, or external endpoints;
- cycles, branches, merges, disconnected chains, or members omitted from the
  single declared workflow sequence;
- included skills that conflict in either direction through discovery metadata;
- declared conflicts that are also members;
- members not marked compatible with every runtime required by the pack policy;
- changed pack definitions without a strictly higher pack semver;
- silent removal, never-active tombstones, pack reintroduction, or changed
  removal tombstones.

Normalization sorts packs, members, conflicts, required runtimes, and tombstone
keys by code point. Handoff order is preserved because it expresses workflow
sequence.

Registry versions 1 through 4 remain valid `--previous` comparison baselines.
For pack transition validation, each legacy registry is treated as having no
active packs and no removed packs. A v5 candidate therefore cannot introduce a
removal tombstone from a v1-v4 baseline because that pack was never active in the
immediately previous registry.

For v5-to-v5 comparisons, transition validation uses both registries' pack state.
Changed definitions require a strictly higher pack semver. Removing an active
pack requires a tombstone that preserves its version. Existing tombstones must be
preserved unchanged, and removed packs cannot be reintroduced as active.

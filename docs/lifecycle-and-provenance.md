# Lifecycle and Provenance

`registry/lifecycle.json` is the maintainer-authored source for catalog lifecycle,
license, review, and origin data. `npm run registry` validates and merges it into
the current registry v5 output. Lifecycle and provenance fields were introduced
in registry v4. Portable `SKILL.md` frontmatter remains unchanged.

## Record contract

Every directory under `skills/` has exactly one record under `skills`. Records
use `active`, `deprecated`, or `superseded`. A superseded record requires a
replacement. Removed names remain under `removed` as tombstones with status
`removed`; a tombstone must not also exist in the active tree.

Each record contains:

- the license, which must equal `SKILL.md` frontmatter;
- `lastReviewedAt`, a real calendar date;
- optional `reviewDueAt`, later than `lastReviewedAt` and no more than one
  calendar year later;
- optional `replacement`, resolving to a present, non-removed skill; and
- an origin with `type`, HTTPS GitHub repository URL, full 40-character commit,
  and immutable ref equal to that commit.

Replacement chains cannot contain self-links or cycles. The generator rejects
missing coverage and unknown records.

## Review interval

External and compatibility-sensitive records use a conservative annual review
interval. The initial catalog review occurred on 2026-07-27 and is due again on
2027-07-27. A review updates `lastReviewedAt` only when it actually occurs and
sets the next due date from that event. It does not imply an approval, hosted
run, signature, or behavior evaluation.

A skill is compatibility-sensitive when any `runtimeCompatibility` entry in
`registry/discovery.json` has a status other than `compatible` (`conditional`,
`unsupported`, or `untested`). This definition is deterministic and uses only
committed discovery metadata. External and compatibility-sensitive skills must
set `reviewDueAt`. Future `lastReviewedAt` values and intervals longer than one
calendar year are rejected against `--as-of`.

Use an explicit date to reproduce expiry decisions:

```bash
node scripts/generate-registry.mjs --check --as-of YYYY-MM-DD
```

Without `--as-of`, the CLI uses the current UTC calendar date. Generated output
contains no clock value and remains deterministic.

## Upstream changes and removal

For an external skill, changing repository, ref, or commit against
`--previous` requires both a higher skill version and a later
`lastReviewedAt`. This makes an intentional upstream update visible.
Repository comparison removes trailing slashes and `.git` before comparing.
Origin-kind changes, first-party origin changes, active-to-removed origin
changes, and tombstone origin changes are rejected. Removed tombstones cannot
return to the active catalog without a future explicit policy.

To deprecate or supersede a skill, update its lifecycle status and replacement
before removal. When removing it, delete the skill and discovery record, move
its lifecycle record to `removed`, retain its immutable origin, and regenerate
the registry.

Registry v1 through v4 are accepted only as comparison baselines, with each
historical version's required contracts validated before transition checks. New
output is always v5.

## Install receipts and rollback

The installer writes receipt v3. It records full-catalog and exact pack
selections, source repository, immutable ref and commit, registry SHA-256 digest,
every selected skill version, and the SHA-256 hash and owning skill for every
selected file. Desired files are the union of the catalog selection and all
selected packs. `check` reports identity, catalog, selection, version,
missing-file, modified-file, and receipt drift. `check --pack` still verifies
shared managed bytes instead of hiding drift outside a pack-exclusive subset.

Default-catalog operations first require the complete
`skills/` and `registry/` trees to match repository `HEAD`. They then verify
that generated registry skill hashes, versions, and resource lists match the
bytes to be copied. The complete current tree is compared with the commit, so
dirty tracked, untracked, or ignored catalog files are rejected and a receipt
cannot attribute uncommitted bytes to `HEAD`.
The final verification returns the exact commit recorded in the receipt; the
installer does not resolve `HEAD` again when creating source identity.
After collection, the buffered file set, every buffered file hash, derived skill
versions, and registry digest are compared with blobs at that same commit. A
transient worktree mutation therefore cannot be restored before final
verification and still enter commit-attributed install bytes.
When an existing v2/v3 receipt names an older commit, ownership is validated
against the registry, selected packs and skills, and every resource blob at that
immutable commit. The full-SHA commit must be an ancestor of the already
verified current `HEAD`; an orphan or unrelated commit tree is rejected. This
allows uninstall or recovery after unrelated `HEAD` advancement without
granting repository-only ownership trust.
For immutable v2/v3 recovery, the reconstructed historical resource plan is the
prior ownership plan. Current catalog bytes are not used in its place; current
catalog comparison remains for legacy or local-unverified receipts where no
historical Git plan exists. V2 receipts retain full-catalog migration semantics.
Pack-version changes remain fail closed: uninstall requires a checkout with the
exact selected pack version recorded by the receipt.

Custom `sourceRoot` calls use the explicit `local-unverified` receipt identity
with null ref and commit. When an adjacent v5 registry exists, its bytes provide
the digest and pack contract. Otherwise the deterministic catalog digest is
derived from copied paths and hashes. Neither form is represented as immutable
Git provenance.

Receipts are validated before installation, removal, or checking. Absolute,
escaping, duplicate, malformed, or mismatched resource paths are rejected.
Receipt v1 is accepted only when all destinations and hashes pass the safe
legacy checks and its normalized `source_repository` equals the current source
identity. Foreign v1 receipts are rejected before their hashes can establish
ownership. A valid v2 receipt migrates as `catalog=true`; v1 retains the same
source and ownership restrictions. The next install writes v3. Older receipt
versions are never newly written.

Mutations use a target-specific staged journal. The installer preflights every
selected resource, backs up only receipt-owned paths, writes the receipt last,
and rolls back command failures. An exclusive operation lock spans recovery,
preflight, mutation, and finalization. Paths are revalidated immediately before
replacement. Existing locks are never reclaimed automatically, even when their
recorded owner appears dead. Explicit inspection and removal are required.
Transaction and cleanup roots have ownership markers and are preserved whenever
the installer cannot prove that it created or inherited them from a validated
transaction.

Recovery validates the prior receipt ownership and binds the complete operation
set to the staged next receipt, current source identity, registry digest,
selection, and resource hashes. The exact set contains one write per next
resource and one removal per prior-owned resource omitted from the next receipt,
including full uninstall. Journal-provided hashes are not ownership evidence by
themselves. A valid active journal rolls forward to that trusted plan. Logical commit and cleanup are separate: terminal state is atomically
handed to `.agent-skills-transaction-cleanup`, and cleanup failure preserves
recoverable committed state instead of attempting rollback without backups.
The active-root handoff and cleanup-root deletion each re-read the owner marker
and require the expected transaction token, terminal state, and journal digest.
Replacement directories or symlink swaps are preserved for operator inspection.
Malformed, foreign, forged, or uncertain state fails closed and identifies the
managed transaction path for operator inspection.

Multi-target operations preflight every target before the first mutation and
roll back completed targets in reverse order if a later target fails. These are
command-failure and crash-recovery guarantees. Instantaneous atomicity across
filesystems or targets is not claimed.

Ownership-safe operator flow:

1. Restore locally modified files manually or move them aside.
2. Install the desired catalog checkout.
3. The installer replaces or removes only files whose current hash still equals
   the prior receipt. It refuses unmanaged or modified destinations.
4. Run `npm run check:agents` against the resulting checkout.

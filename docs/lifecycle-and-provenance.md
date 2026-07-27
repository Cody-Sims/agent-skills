# Lifecycle and Provenance

`registry/lifecycle.json` is the maintainer-authored source for catalog lifecycle,
license, review, and origin data. `npm run registry` validates and merges it into
registry v4. Portable `SKILL.md` frontmatter remains unchanged.

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

Registry v1 through v3 are accepted only as comparison baselines. New output is
always v4.

## Install receipts and rollback

The installer writes receipt v2. It records source repository, immutable ref and
commit, registry SHA-256 digest, every installed skill version, and the SHA-256
hash and owning skill for every installed file. `check` reports identity,
catalog, version, set, missing-file, modified-file, and receipt drift.

Default-catalog install and check operations first require the complete
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

Custom `sourceRoot` calls use the explicit `local-unverified` receipt identity
with null ref and commit. Their deterministic catalog digest is derived from
the copied paths and hashes; it is not represented as immutable Git
provenance.

Receipts are validated before installation, removal, or checking. Absolute,
escaping, duplicate, malformed, or mismatched resource paths are rejected.
Receipt v1 is accepted only when all destinations and hashes pass the safe
legacy checks and its normalized `source_repository` equals the current source
identity. Foreign v1 receipts are rejected before their hashes can establish
ownership. The next install migrates a valid receipt to v2; new v1 receipts are
never written.

Rollback is ownership-safe:

1. Restore locally modified files manually or move them aside.
2. Install the desired catalog checkout.
3. The installer replaces or removes only files whose current hash still equals
   the prior receipt. It refuses unmanaged or modified destinations.
4. Run `npm run check:agents` against the resulting checkout.

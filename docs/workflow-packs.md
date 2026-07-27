# Workflow packs

Workflow packs describe complementary, independently installable skills without
merging their instructions. `registry/packs.json` is the maintainer-authored
source. `schemas/packs.schema.json` defines its strict contract. The registry
generator validates and normalizes the manifest into `registry/skills.json`
schema version 5.

This slice publishes pack metadata only. `manage-skills.mjs` does not install or
uninstall packs atomically, and the evaluation tooling does not yet score pack
composition or combined context cost.

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

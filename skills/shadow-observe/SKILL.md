---
name: shadow-observe
description: "Generates bounded, evidence-linked candidate architecture observations. Use when asked to run Shadow, scan current architecture, or map boundaries and dependencies for .shadow; not for unfamiliar-codebase orientation, locating change sites, decision creation or repair, future states, or drift checks."
license: MIT
compatibility: "The optional inventory helper requires Node.js 18 or newer and uses no network services or third-party packages."
metadata:
  version: "1.1.0"
  author: "Cody-Sims"
  tier: "experimental"
---

# Shadow Observe

Analyze current architecture on demand, bounded and read-only. Return candidate
observations, never decisions.

## Boundaries

Do not invent rationale, intent, ownership, or decision status, create/promote
decisions, propose future states, or repair drift. Default to a report only;
candidate files require explicit user request and a declared location/schema/
unreviewed lifecycle. Use `codebase-exploration` for orientation/build/test/
conventions/change sites, `shadow-architecture` for graph/decision/index/schema/
anchor/lifecycle/render maintenance, `shadow-dream` for future states, and
`shadow-drift` for read-only comparison.

## Workflow

1. **Read authority.** Read scoped repository instructions, `.shadow/README.md`,
   and its named index/schema. Missing declarations mean report only; never
   bootstrap `.shadow/`.
2. **Bound.** State question, included/excluded paths, depth or entry limit, and
   stopping condition. Use the smallest slice that answers the question.
3. **Provenance.** Record available source revision, relevant dirty-worktree
   state, commands/tools, limits, and unavailable provenance as `unknown`.
4. **Inventory before content.** Run the
   [deterministic inventory helper](scripts/inventory.mjs) only when a bounded
   names/structure inventory helps. It never follows symlinks, reads contents,
   writes files, or uses the network. Read only necessary manifests, boundaries,
   public interfaces, dependency declarations, tests, and Shadow records;
   avoid broad scans.
5. **Classify.** Every **Verified claim** needs cited direct repository evidence;
   every **Inference** needs a labeled bounded interpretation and cited support;
   every **Unknown** needs the missing fact and resolving evidence. Keep
   contradictions as observations, not automatic drift diagnoses/repairs.
6. **Relate.** Link existing decision IDs only when the declared index supports
   them. Never manufacture IDs or convert observations into decisions.
7. **Return/write conditionally.** Read the
   [observation record guide](references/observation-records.md) for a requested
   structured report or before artifact writing. Default to the response below.
   If files were explicitly requested, re-read the declared layout/schema and
   write only candidate artifacts within it. Missing location, unreviewed
   lifecycle, valid fields/relations, or safe destination means no write:
   report the gap. Reject symlink/path escapes.

## Lifecycle Guidance

Assign only **Candidate**: machine-generated/unreviewed. **Confirmed** requires
the declared reviewer/process, never self-confirmation. **Dismissed** requires
reviewer rejection/supersession/archive with reason/evidence retained where
supported. Follow different declared state names without adding unsupported
values or crossing these approval boundaries.

## Validation

1. Check resolvable workspace-relative anchors/evidence for verified claims,
   labeled cited inferences, uninvented unknowns, indexed decision IDs, scope,
   revision or `unknown`, and run provenance.
2. For written artifacts, run the declared validator; verify schema and location.
   Confirm no source, decision, index, or lifecycle record changed except the
   exact explicitly requested, schema-required candidate artifact update.

## Output Format

Return **Scope** (question/paths/limits/stopping reason), **Run provenance**
(revision/worktree/tools/unavailable fields), **Verified claims**
(anchors/evidence/related decision IDs), **Inferences** (support/confidence
boundary), **Unknowns** (fact/resolving evidence), **Candidate artifacts**
(`none`, or requested paths/validation), and **Lifecycle next step**
(review to confirm/dismiss).

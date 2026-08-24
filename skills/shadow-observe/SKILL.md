---
name: shadow-observe
description: "Runs bounded, read-only Shadow repository analysis to generate evidence-linked candidate architecture observations, map boundaries and dependencies, and separate verified claims, inference, and unknowns. Use when asked to run Shadow, scan architecture, generate observations, or map boundaries or dependencies for a repository-owned .shadow graph; unlike codebase-exploration, it does not orient an unfamiliar codebase or locate change sites, and it does not create decisions, propose future state, or repair drift."
license: MIT
compatibility: "The optional inventory helper requires Node.js 18 or newer and uses no network services or third-party packages."
metadata:
  version: "1.0.0"
  author: "Cody-Sims"
  tier: "experimental"
---

# Shadow Observe

Perform an on-demand, bounded, read-only analysis of current repository
architecture. Produce candidate observations for a repository-owned `.shadow`
graph without promoting them to decisions.

## Boundaries

- Use `codebase-exploration` for broad orientation in an unfamiliar repository,
  build and test discovery, conventions, or locating a change site.
- Use `shadow-architecture` to create, repair, or maintain the `.shadow` graph,
  decision records, anchors, indexes, schemas, lifecycle state, or rendered
  views.
- Use `shadow-dream` for future-state architecture proposals.
- Use `shadow-drift` only to compare declared architecture with implementation
  and report drift without changing the graph.
- Do not invent rationale, historical intent, ownership, or decision status.
- Do not create accepted decisions, future-state proposals, or drift repairs.
- Default to a report only. Write candidate observation artifacts only when the
  user explicitly requests files and the repository declares their location and
  shape.

## Workflow

1. Read repository instructions that govern the requested scope.
2. Read `.shadow/README.md`, then the index and schema it names. Treat those
   declarations as authoritative. If they do not exist, continue with a report
   only and do not bootstrap `.shadow/`.
3. Define a bounded scope: the question, included paths, excluded paths,
   traversal depth or entry limit, and stopping condition. Avoid a repository-wide
   survey when a smaller slice answers the request.
4. Capture run provenance. Record the source revision when available, whether
   the worktree has relevant uncommitted changes, the commands or tools used,
   the scope limits, and unavailable provenance as unknown.
5. Inventory names and structure before reading content. Run
   [the deterministic inventory helper](scripts/inventory.mjs) when a bounded
   structural inventory is useful. It does not follow symlinks, read file
   contents, write files, or use the network.
6. Read only the files needed to support the scoped architecture question.
   Prefer manifests, module boundaries, public interfaces, dependency
   declarations, tests, and existing `.shadow` records over broad content scans.
7. Classify every material statement:
   - **Verified claim:** directly supported by cited repository evidence.
   - **Inference:** a bounded interpretation supported by cited evidence but not
     explicitly declared.
   - **Unknown:** unresolved or unsupported; state what evidence would resolve it.
8. Link observations to existing decision IDs only when the repository index
   supports the relation. Do not manufacture IDs or convert observations into
   decisions.
9. Return the report in the format below. Include contradictions as observations,
   not as automatic drift diagnoses or repairs.
10. If files were explicitly requested, re-read the repository's declared
    observation layout and schema. Write only candidate observation artifacts
    under that layout. Do not write when the layout has no candidate-observation
    location or lifecycle.

Read [the observation record guide](references/observation-records.md) before
writing an artifact or when a structured report is requested.

## Lifecycle Guidance

- **Candidate:** machine-generated and unreviewed. This is the only lifecycle
  state this skill may assign.
- **Confirmed:** a reviewer or repository-declared process verifies the claim and
  promotes it. The skill may report the required review but must not self-confirm.
- **Dismissed:** a reviewer rejects, supersedes, or archives the candidate
  according to the repository schema, retaining the reason and evidence when the
  schema supports them.
- If the repository uses different states, follow its schema and preserve the
  same approval boundary. Never add unsupported lifecycle values.

## Validation

1. Confirm each verified claim has at least one resolvable workspace-relative
   anchor or evidence path.
2. Confirm each inference is labeled and cites the evidence it interprets.
3. Confirm unknowns do not contain invented explanations.
4. Confirm related decision IDs exist in the declared index.
5. Confirm the report includes scope, source revision or `unknown`, and run
   provenance.
6. If an artifact was written, run the repository-declared `.shadow` validator
   and verify the path is inside the declared observation layout.
7. Confirm no source, decision, index, or lifecycle record was changed unless
   the explicit request and repository schema required that exact candidate
   artifact update.

## Output Format

Return:

1. **Scope:** question, included and excluded paths, limits, and stopping reason.
2. **Run provenance:** source revision, worktree state, commands or tools, and
   unavailable fields.
3. **Verified claims:** claim, anchors, evidence paths, and related decision IDs.
4. **Inferences:** inference, supporting evidence, and confidence boundary.
5. **Unknowns:** missing fact and the evidence needed to resolve it.
6. **Candidate artifacts:** `none` by default, or written paths and validation
   results when explicitly requested.
7. **Lifecycle next step:** review needed to confirm or dismiss each candidate.

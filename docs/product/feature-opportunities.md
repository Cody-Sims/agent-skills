# Feature Opportunity Roadmap

**Status:** Product discovery roadmap
**Research and audit date:** 2026-08-28
**Scope:** Portable Agent Skills catalog, its packs, registry, evaluation
tooling, and repository-governance documentation. This document proposes
discovery work; it does not authorize implementation.

## Executive summary

The catalog already has a strong, portable software-delivery core: 24 skills,
four versioned workflow packs, discovery and lifecycle registries, deterministic
behavior/routing/pack/runtime-smoke tooling, and explicit approval boundaries.
The largest opportunities are therefore not another generic SDLC skill or a
new continuous-improvement loop. They are:

1. Close two clear workflow gaps: dependency and framework upgrade safety, and
   performance-regression investigation.
2. Make existing composition easier to adopt with Wayfinder-to-delivery,
   bug-fix-delivery, and repository-onboarding packs.
3. Protect catalog quality as it grows with collision detection and
   context-budget measurements.
4. Add portable guidance for production-agent concerns that the catalog does
   not currently cover: agentic threat modeling, state recovery, multi-agent
   design, and observability/cost attribution.
5. Keep research-derived automation proposal-only and subordinate to the
   existing evidence, approval, provenance, and rollback controls.

The recommended posture is to validate the highest-confidence gaps first,
measure routing and composition effects before changing contracts, and reject
ideas that cannot be expressed without a vendor runtime or a distinct
evaluation boundary.

## Product principles

- **Portable source, host-specific edges.** Canonical skills remain
  runtime-agnostic. Hooks, hosted agents, SDK APIs, and vendor manifests belong
  in documentation or generated adapters, not canonical frontmatter.
- **Evidence before promotion.** A demand signal is not proof of uplift.
  New skills require a named expertise source, a baseline comparison, routing
  near-misses, and the applicable lifecycle evidence.
- **Composition over duplication.** Prefer a pack or an explicit handoff when
  existing skills already cover the component steps. Do not merge unrelated
  procedures into a larger skill.
- **Bounded authority.** Discovery, proposals, implementation, approval,
  evaluation, and merge remain separate. No opportunity below should weaken
  maintainer approval, protected paths, or rollback controls.
- **Context is a budget.** Keep metadata concise, load detail on demand, and
  measure both selection quality and serialized context as the catalog grows.
- **Security is a product requirement.** Treat external content, generated
  procedures, credentials, and tool results as untrusted until verified.
- **Curation beats catalog size.** A larger catalog is not a success metric if
  it increases collisions, stale content, or maintenance cost.

## Current baseline and capability map

| Area | Current capability | Implication for opportunities |
|---|---|---|
| Canonical content | 24 skills under `skills/<name>/SKILL.md`; descriptions follow the portable contract and target Claude Code, GitHub Copilot, and OpenAI Codex. | New skills must be repository-agnostic and earn a distinct routing boundary. |
| Core workflow | Requirements, planning, TDD, debugging, review, security review, documentation, verification, Git/PR work, onboarding, research, and Shadow/Wayfinder coverage already exist. | Do not add another generic planning, debugging, review, or architecture-observation skill. |
| Packs | `feature-delivery`, `shadow-architecture-suite`, `safe-refactor`, and `release-readiness` are active in `registry/packs.json`. Packs have exact versions, ordered handoffs, conflicts, transactional install behavior, and composition fixtures. | New packs should compose existing skills and add a missing transition, not fork a skill. |
| Discovery | `registry/discovery.json` contains typed inputs, outputs, risks, runtime compatibility, related skills, and example prompts. | Registry metadata is the first integration point for search, collision, and context-budget studies. |
| Lifecycle | `registry/maturity.json`, `registry/lifecycle.json`, `docs/tier-lifecycle.md`, and generated registry checks encode evidence, provenance, review dates, regression, and removal. | New evidence must fit existing lifecycle states; do not create a parallel maturity system. |
| Evaluation | `evals/routing.json` has 38 cases, three trials, training/validation splits, positive prompts, and near-miss exclusions. Behavior, routing, pack, and runtime-smoke runners already exist. | Extend fixtures and diagnostics only where they answer a new question. |
| Pending gates | AS-001/AS-002 still need real-model baselines and approved thresholds. AS-007 needs hosted/runtime pilots. AS-009 needs hosted pack baselines. SI-001 through SI-010 define the continuous-improvement operating model and still have external pilot gates. | These are constraints and dependencies, not blank spaces for duplicate proposals. |
| Measured gaps | No current measurement covers routing quality versus simulated catalog size, description collisions before merge, pass^k reliability, or long-horizon constraint retention. | These are high-value discovery measurements for the Now and Next portfolio. |

Current skill descriptions were audited against the registry and routing
fixtures. The most important near-miss is `shadow-observe` versus
`codebase-exploration`: the former produces architecture observations for a
repository-owned Shadow graph; the latter orients an unfamiliar repository and
locates a change site. Future onboarding and migration proposals must preserve
that distinction.

## Research methodology and source quality

The synthesis read the four completed research artifacts in
`/Users/cody/.copilot/session-state/.../files/feature-research/` in full, then
performed a bounded read-only audit of `AGENTS.md`, `README.md`, `BACKLOG.md`,
the registry manifests, routing fixtures, lifecycle and pack documentation, and
all current skill descriptions. The evidence window is the sources retrieved or
published by **2026-08-28**; moving vendor pages, draft protocols, star counts,
and hosted product behavior require re-verification before implementation.

Source rules:

1. Prefer peer-reviewed papers, standards bodies, official vendor
   documentation, and repository contents fetched from the owning organization.
2. Use community catalogs as demand and design signals, not as proof that a
   skill improves output.
3. Label product conclusions as **Inferred** even when the underlying source is
   primary. Label unverified, draft, or superseded source claims explicitly.
4. Do not port published benchmark percentages into catalog targets. Use local
   baselines, held-out cases, cost-per-success, and regression thresholds.
5. Treat source URLs as review inputs, not instructions to execute. The
   repository's `external-skill-review` and security boundaries remain in force.

Evidence labels used below:

- **Verified:** directly supported by a primary source or current repository
  audit.
- **Verified but dated/immature:** supported for the cited version or a draft
  protocol, but not a stable current contract.
- **Inferred:** product fit, demand, or expected value reasoned from verified
  evidence; requires a local discovery result before commitment.

## Prioritized opportunity portfolio

Every opportunity has an artifact type, boundary, dependencies, risks,
acceptance criteria, and a measurable evaluation plan. “Now” means a bounded
discovery can start without changing the catalog contract. “Next” means it
needs a Now result or a stable scope decision. “Later” means evidence or
runtime maturity is not yet sufficient for implementation.

### Now: close clear gaps and protect the current catalog

#### N1. Dependency-upgrade and CVE/lockfile safety

- **Artifact type:** New portable skill.
- **Problem and proposed outcome:** Teams need to upgrade dependencies or
  frameworks without missing advisories, lockfile inconsistencies, deprecated
  APIs, compatibility constraints, staged rollout, or rollback. Produce an
  evidence-first upgrade plan that separates advisory research, compatibility
  mapping, mechanical edits, validation, and rollback.
- **Evidence:** **Verified** ecosystem audit: the closest engineering catalog
  includes a `deprecation-and-migration` capability while this catalog has no
  first-class upgrade workflow ([addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)).
  **Inferred** demand is high for long-lived repositories; the catalog's
  `web-research-and-verification` and
  `refactoring-and-dead-code-removal` are necessary handoffs but do not own the
  full compatibility and rollout decision.
- **Differentiation and overlap boundary:** Scope to dependency/framework
  version changes, CVE/advisory verification, lockfile integrity, expand/
  contract migration, and rollback. Delegate generic research to
  `web-research-and-verification`, mechanical edits to
  `refactoring-and-dead-code-removal`, and sequencing to
  `planning-and-task-breakdown`. Do not create a data-migration skill; that
  boundary overlaps Shadow and remains a kill-risk.
- **Dependencies:** AS-001/AS-002 evidence contracts; current official
  advisory and framework sources; a real migration transcript or runbook for
  AS-003 expertise evidence.
- **Risks and security:** A stale advisory or malicious package metadata can
  cause unsafe changes. Require immutable source references, license and
  provenance checks, no automatic package installation, least privilege, and
  explicit rollback.
- **Acceptance criteria:** A candidate workflow produces an inventory,
  advisory/version evidence, compatibility matrix, staged plan, lockfile
  check, validation commands, and rollback conditions; it explicitly refuses
  to claim a CVE is resolved without current evidence.
- **Evaluation:** Add a behavior fixture for a framework upgrade with a
  deprecated API and a lockfile conflict; compare against the relevant
  existing skills with `npm run eval:validate` and a pilot
  `npm run eval -- --suite <suite> --adapter <command> --adapter-id <id> --model <version> --out <result>`.
  Measure required-step recall and unsafe-claim rate.

#### N2. Performance-regression triage

- **Artifact type:** New portable skill.
- **Problem and proposed outcome:** “Slow but correct” work is not a normal
  correctness bug. Produce a measured baseline, workload definition,
  profiling plan, single-change experiment, remeasurement, and regression
  guard for latency, throughput, resource use, or cost.
- **Evidence:** **Verified** ecosystem gap: `addyosmani/agent-skills` ships
  `performance-optimization`, while this catalog has only
  `systematic-debugging` ([addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)).
  **Inferred** fit is moderate-high because performance has a different
  objective function and acceptance measure than wrong output.
- **Differentiation and overlap boundary:** Reuse the evidence loop from
  `systematic-debugging` but require a numeric baseline/target and a
  reproducible workload. Do not turn it into generic optimization advice,
  stack-specific profiling, or a second debugging skill.
- **Dependencies:** A real performance incident or profiling run for AS-003;
  an agreed local measurement command; optional `codebase-exploration`
  handoff.
- **Risks and security:** Production profiling can expose request data,
  credentials, or customer identifiers. Prefer sanitized fixtures, local
  traces, bounded workloads, and read-only collection by default.
- **Acceptance criteria:** The workflow refuses a proposed optimization before
  a baseline exists, records the measurement environment, identifies a
  hypothesis, limits changes to one experiment, and adds a regression guard.
- **Evaluation:** Add a “slow but correct” fixture and a correctness-bug
  near-miss. Run the behavior and routing pilots; measure baseline-first
  compliance, remeasurement rate, and false routing to the new skill.

#### N3. Wayfinder-to-delivery pack

- **Artifact type:** Workflow pack.
- **Problem and proposed outcome:** Long-running ambiguous work currently
  hands off from `wayfinder-planning` to requirements, planning, and delivery
  one skill at a time. Provide an exact-version pack that carries a cleared
  Wayfinder map through specification, task decomposition, implementation,
  integration, documentation, and verification.
- **Evidence:** **Verified** current pack contract and handoff model in
  [`registry/packs.json`](../../registry/packs.json) and the
  `wayfinder-planning`/delivery routing cases in
  [`evals/routing.json`](../../evals/routing.json). **Verified** external
  guidance on packaging reusable, progressive-disclosure workflows in
  [Anthropic's Agent Skills guidance](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills).
- **Differentiation and overlap boundary:** This is composition, not a new
  Wayfinder, planning, or Git skill. It must preserve Wayfinder's boundary:
  decision discovery ends before implementation begins. It must also avoid the
  `shadow-architecture-suite`, which records architecture decisions rather
  than product delivery.
- **Dependencies:** AS-009's existing pack schema and transactional installer;
  the current Wayfinder handoff fixtures; hosted pack baselines remain an
  AS-009 follow-up, not a new task here.
- **Risks and security:** A stale or uncleared map could authorize premature
  implementation. Require an explicit cleared-map state, approved
  specification, exact member versions, and the existing human approval and
  rollback gates.
- **Acceptance criteria:** The pack has one acyclic handoff chain, exact
  member versions, explicit out-of-pack requests, a cleared-map gate, and
  adjacent near-miss cases for static specification and direct implementation
  requests.
- **Evaluation:** Add a composition suite and run `npm run pack:validate` plus
  `npm run pack:smoke`. Measure exact route-set correctness, handoff coverage,
  out-of-pack rejection, and combined context bytes.

#### N4. Bug-fix-delivery pack

- **Artifact type:** Workflow pack.
- **Problem and proposed outcome:** A reproducible defect needs a predictable
  path from diagnosis to failing regression test, minimal fix, review,
  documentation, and fresh verification. Package existing skills without
  making contributors select the sequence manually.
- **Evidence:** **Verified** the catalog already has the component skills in
  [`registry/packs.json`](../../registry/packs.json). **Verified** research
  supports iterative feedback and independent verification in
  [Self-Refine](https://arxiv.org/abs/2303.17651) and
  [Chain-of-Verification](https://arxiv.org/abs/2309.11495). **Inferred**
  product value is reduced omission of the regression-test and verification
  handoffs.
- **Differentiation and overlap boundary:** Compose
  `systematic-debugging`, `test-driven-development`, `code-review`,
  `security-review`, `documentation-maintenance`, and
  `verification-before-completion` as one unconditional ordered chain. Do not
  replace any member or create a generic “debugging plus delivery” skill.
- **Dependencies:** AS-009 pack contracts; a failure fixture with a known
  regression boundary; no new runtime feature.
- **Risks and security:** Fixes may change behavior outside the defect. Require
  a reproduced symptom, a bounded patch, independent functional and security
  review, and rollback instructions.
- **Acceptance criteria:** The manifest uses exact-version members and one
  continuous acyclic chain
  (`systematic-debugging` → `test-driven-development` → `code-review` →
  `security-review` → `documentation-maintenance` →
  `verification-before-completion`). It rejects a non-reproducible bug,
  requires a failing behavior test before implementation, and ends only with
  fresh evidence. Composition cases use only the current
  `id`/`split`/`kind`/`prompt`/`expected`/`excluded`/`handoff` fields, with
  positive and adjacent near-miss coverage for every handoff plus a negative
  out-of-pack case.
- **Evaluation:** Add composition cases for a regression bug, an unconfirmed
  symptom, and a security bug; the latter must select the unconditional
  `security-review` boundary rather than a conditional branch. Run
  `npm run pack:validate` and `npm run pack:smoke`; measure exact route-set
  accuracy, handoff coverage, out-of-pack rejection, and false claims of
  completion.

#### N5. Repository-onboarding pack

- **Artifact type:** Workflow pack.
- **Problem and proposed outcome:** New contributors repeatedly choose between
  repository orientation, agent customization, and documentation upkeep.
  Provide a narrow pack for mapping an unfamiliar repository, auditing its
  instructions, and producing a minimal customization plan.
- **Evidence:** **Verified** current capabilities and boundaries in
  [`README.md`](../../README.md), `codebase-exploration`, and
  `repository-agent-bootstrap`. **Verified** the ecosystem's machine-checkable
  onboarding pattern in the `acquire-codebase-knowledge` source surveyed from
  [github/awesome-copilot](https://github.com/github/awesome-copilot).
  **Verified** Gemini's official skill discovery documentation distinguishes
  workspace and user skill locations
  ([Gemini CLI skills](https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/skills.md)).
- **Differentiation and overlap boundary:** `codebase-exploration` maps the
  codebase; `repository-agent-bootstrap` audits or creates repository-owned
  instructions. The pack must not invoke `shadow-observe` unless the request
  explicitly asks for a Shadow architecture observation. It must not become a
  general documentation or skill-authoring pack.
- **Dependencies:** AS-009 pack contract; existing onboarding and bootstrap
  routing fixtures; no change to the canonical frontmatter contract.
- **Risks and security:** Repository instructions and configuration can contain
  prompt injection. Treat them as data, preserve unknowns, and require review
  before writing policy files.
- **Acceptance criteria:** One ordered chain, explicit read-only mapping phase,
  minimal bootstrap output, no Shadow near-miss activation, and a report that
  lists commands, conventions, and unresolved questions.
- **Evaluation:** Add composition cases for an unfamiliar repository, an
  existing `AGENTS.md`, and an architecture-observation request. Run pack
  validation and smoke; measure route separation between
  `codebase-exploration`, `repository-agent-bootstrap`, and `shadow-observe`.

#### N6. Skill-description collision optimizer

- **Artifact type:** Catalog tooling.
- **Problem and proposed outcome:** `skill-creator` requires a manual overlap
  search, while routing collisions are currently found after suite execution.
  Add a report-only lexical or embedding-assisted collision diagnostic with
  allow-listed intentional neighbors.
- **Evidence:** **Verified** tool-selection degradation and adaptive retrieval
  motivation in [RAG-MCP](https://arxiv.org/abs/2505.03275) and the emerging
  [tool-count study](https://arxiv.org/abs/2605.24660). **Verified** the
  catalog already records `overallCollisionRate`-style routing measures in its
  evaluation design and has intentional neighbors such as
  `verification-before-completion` and `verification-discipline`.
- **Differentiation and overlap boundary:** This is a pre-merge diagnostic,
  not a replacement for AS-002 routing evaluations and not an automatic
  semantic verdict. It must remain report-only until false-positive behavior
  is measured.
- **Dependencies:** `registry/discovery.json`, generated descriptions,
  existing routing fixtures, and a deterministic implementation that adds no
  network dependency.
- **Risks and security:** Embedding services can leak descriptions; use local
  lexical methods first, or make any model/index opt-in. Similarity can flag
  legitimate adjacent skills. Never block a contribution solely on an
  unreviewed score.
- **Acceptance criteria:** A seeded collision pair is reported, known-adjacent
  pairs can be documented, output is deterministic, and no current skill is
  silently renamed or blocked.
- **Evaluation:** Add a focused test and run `npm test` with a seeded fixture;
  compare flagged pairs with the known routing confusion report. Measure
  seeded-collision recall and reviewed false-positive rate.

#### N7. Context-budget and progressive-disclosure audit

- **Artifact type:** Catalog tooling plus authoring documentation.
- **Problem and proposed outcome:** Metadata loading keeps startup cost small,
  but selection quality and long-horizon recall can still degrade as descriptions
  and references grow. Report combined description bytes/tokens, body/resource
  sizes, and skills that violate progressive-disclosure guidance.
- **Evidence:** **Verified** positional recall degradation in
  [Lost in the Middle](https://arxiv.org/abs/2307.03172). **Verified**
  context curation, just-in-time retrieval, and compaction guidance in
  [Anthropic's context-engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
  and the code-execution pattern in
  [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp).
- **Differentiation and overlap boundary:** This audits catalog content and
  authoring choices. It does not implement host compaction, prompt caching,
  token compression, or AS-001/AS-002 real-model evaluation.
- **Dependencies:** Generated registry bytes, existing pack context accounting,
  and the current `AGENTS.md` size budgets.
- **Risks and security:** Lossy compression can remove safety constraints.
  Prefer file-level disclosure and human review; do not rewrite instructions
  automatically.
- **Acceptance criteria:** The report distinguishes metadata, body, and
  on-demand resources; identifies over-budget files; preserves critical
  constraints in examples; and gives a reviewable remediation suggestion.
- **Evaluation:** Add deterministic size fixtures and run `npm test`; for a
  discovery pilot, compare routing and constraint-retention results at current
  and synthetic catalog sizes. Measure context size, recall, collision rate,
  and constraint compliance without adopting external benchmark targets.

### Next: add portable production-agent guidance after scope validation

#### X1. Agentic-AI threat modeling

- **Artifact type:** New portable skill.
- **Problem and proposed outcome:** `security-review` applies STRIDE to a
  change or component. Engineers also need a system-level method for delegation
  chains, tool poisoning, prompt injection, credential boundaries, autonomy,
  and accountability.
- **Evidence:** **Verified** OWASP identifies prompt injection, including
  indirect injection, as a central LLM risk
  ([OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)).
  **Verified** the MAESTRO agentic threat-model framework
  ([Cloud Security Alliance MAESTRO](https://github.com/CloudSecurityAlliance/MAESTRO))
  and the multi-government agentic-AI adoption guide
  ([CISA/NSA/Five Eyes guide](https://www.ncsc.govt.nz/assets/guides/Joint-Guide-Careful-Adoption-of-Agentic-AI-Services.pdf)).
- **Differentiation and overlap boundary:** Review the whole agent system and
  its trust boundaries; hand code or endpoint findings to `security-review`.
  Do not duplicate `external-skill-review` supply-chain inspection or
  `agent-tool-interface-design` interface selection.
- **Dependencies:** A sanitized agent architecture fixture; current primary
  framework versions; explicit annual review because the sources are evolving.
- **Risks and security:** The skill itself handles sensitive architecture and
  credential information. Require redaction, least privilege, no secret
  reproduction, and explicit uncertainty for draft frameworks.
- **Acceptance criteria:** Output maps findings to agent-specific layers or
  risk categories, identifies delegation and credential trust boundaries,
  proposes mitigations and approval points, and labels immature guidance.
- **Evaluation:** Add labeled fixtures for indirect prompt injection,
  over-privileged tools, and cross-agent trust violations. Run behavior and
  routing pilots; measure layer/category recall and correct handoff to
  `security-review`.

#### X2. Long-running agent state recovery

- **Artifact type:** New portable skill.
- **Problem and proposed outcome:** Production agents need durable checkpoints,
  idempotent side effects, crash recovery, compaction-versus-reset decisions,
  and explicit unknown-outcome handling.
- **Evidence:** **Verified but immature** MCP Tasks defines a durable task
  state machine and expiry controls
  ([MCP Tasks draft](https://github.com/modelcontextprotocol/ext-tasks/blob/main/specification/draft/tasks.md)).
  **Verified** durable execution and crash recovery in
  [Temporal's agent guidance](https://temporal.io/blog/build-resilient-agentic-ai-with-temporal)
  and session/harness separation in
  [Managed Agents](https://www.anthropic.com/engineering/managed-agents).
- **Differentiation and overlap boundary:** Generalize Wayfinder's recovery
  invariants to arbitrary agent actions. Do not replace
  `wayfinder-planning`, which remains the owner of decision-map tickets, or
  `agent-tool-interface-design`, which remains the owner of interface-shape
  selection.
- **Dependencies:** A crash-mid-tool-call fixture; current MCP/Temporal
  contracts; a reviewed vocabulary for idempotency keys, receipts, leases,
  and checkpoints.
- **Risks and security:** Replaying side effects can duplicate payments,
  deletes, or deployments. Require idempotency, authorization re-checks,
  expiry, reconciliation, and fail-closed behavior on unknown outcomes.
- **Acceptance criteria:** The skill distinguishes retry from replay,
  compaction from reset, and local checkpoint from remote task state; it
  includes a recovery decision table and never reports an unknown outcome as
  success.
- **Evaluation:** Run a scripted crash-mid-task fixture and a duplicate-side-
  effect fixture. Measure whether the recommended design includes a durable
  boundary, idempotency or reconciliation, and a human recovery path.

#### X3. Multi-agent system design

- **Artifact type:** New portable skill.
- **Problem and proposed outcome:** Teams need to choose workflow, single-agent,
  parallel, specialist, escalation, or cross-agent delegation deliberately
  rather than adding agents by default. Produce a decision record, task
  partition, delegation contract, and cost/coordination trade-off.
- **Evidence:** **Verified** Anthropic distinguishes workflows from agents and
  reports a multi-agent research pattern
  ([multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)).
  **Verified** current delegation patterns in
  [Managed Agents orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration)
  and cross-vendor discovery in the
  [A2A project](https://github.com/a2aproject/A2A).
- **Differentiation and overlap boundary:** This is runtime-agnostic design
  guidance. `parallel-worktree-delivery` remains the owner of Git worktree
  execution; `wayfinder-planning` remains the owner of ambiguous decision maps;
  `agent-tool-interface-design` remains the owner of tool interface shape.
- **Dependencies:** A labeled fixture set distinguishing sequential,
  parallelizable, shared-context, and escalation tasks; cost accounting
  conventions.
- **Risks and security:** Delegation multiplies cost and trust boundaries.
  Require bounded fan-out, least privilege, result provenance, evaluator
  separation, and explicit handling of untrusted subagent output.
- **Acceptance criteria:** The skill can recommend “do not use multi-agent”
  when coordination cost exceeds value, defines non-overlapping inputs and
  outputs, and specifies evaluator or human review independence.
- **Evaluation:** Add architecture-selection fixtures and a negative set for
  ordinary sequential work. Measure false multi-agent recommendation rate,
  partition completeness, and security-boundary coverage.

#### X4. Agent observability and cost attribution

- **Artifact type:** New portable skill plus operational documentation.
- **Problem and proposed outcome:** Engineers need a vendor-neutral plan for
  tracing agent runs, tool calls, handoffs, approvals, latency, tokens, cost,
  and failures across sessions and agents.
- **Evidence:** **Verified but immature** OpenTelemetry GenAI conventions define
  agent, workflow, plan, tool, and usage span concepts
  ([OTel GenAI agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)).
  **Verified** vendor tracing and append-only session-log examples in
  [OpenAI Agents tracing](https://github.com/openai/openai-agents-python/blob/main/docs/tracing.md)
  and [Managed Agents](https://www.anthropic.com/engineering/managed-agents).
- **Differentiation and overlap boundary:** This addresses production-agent
  instrumentation and budgets, not the catalog's own eval result schema,
  SI-008 audit controls, or vendor dashboard configuration. OTel names must
  remain version-qualified rather than frozen into portable frontmatter.
- **Dependencies:** A sanitized trace fixture, cost model, and current OTel
  review. Coordinate with SI-008 without creating a second audit trail for
  this repository.
- **Risks and security:** Traces can contain prompts, secrets, personal data,
  and tool results. Require redaction, retention limits, access controls,
  correlation IDs without raw secrets, and explicit sampling.
- **Acceptance criteria:** Guidance defines minimum run/span fields, handoff
  correlation, latency/token/cost attribution, failure states, retention,
  and a budget stop condition while labeling unstable conventions.
- **Evaluation:** Use static content assertions plus a trace fixture. Measure
  required-field coverage, secret-redaction coverage, cost attribution
  completeness, and correct separation from repository-eval artifacts.

#### X5. Legacy agent-configuration migration

- **Artifact type:** Extension to `repository-agent-bootstrap` plus reference
  documentation.
- **Problem and proposed outcome:** Teams have `CLAUDE.md`, Cursor rules,
  Copilot instruction files, ad hoc `AGENTS.md`, and slash-command content.
  Provide a reviewable mapping into portable skills and a small `AGENTS.md`
  router without silently deleting legacy behavior.
- **Evidence:** **Verified** Cursor provides a one-way
  `/migrate-to-skills` flow ([Cursor skills](https://cursor.com/docs/skills)).
  **Verified** the ecosystem has moved toward bundles and portable
  `SKILL.md` packaging ([OpenAI plugins](https://github.com/openai/plugins),
  [Agent Skills](https://agentskills.io/)). **Inferred** differentiation is
  high because the surveyed migration is runtime-specific and one-way.
- **Differentiation and overlap boundary:** Extend the existing bootstrap
  skill's audit rather than adding a second bootstrap skill. `skill-creator`
  owns drafting skill content; this extension owns source inventory, mapping,
  conflict detection, and non-destructive migration planning.
- **Dependencies:** Current `docs/compatibility.md`, a fixture containing
  several legacy formats, and AS-002 near-miss coverage.
- **Risks and security:** Legacy files may contain hidden instructions,
  secrets, or permissive policies. Preserve originals, treat content as data,
  require explicit approval before writes, and never infer a safe deletion.
- **Acceptance criteria:** The output inventories each source path, maps
  content to skills or router rules, identifies conflicts and lost semantics,
  preserves unknowns, and proposes reversible steps.
- **Evaluation:** Add a migration fixture with Cursor rules and Copilot
  instructions. Run `npm run eval:validate` and routing validation; measure
  source-path recall, unsafe-deletion refusal, and separation from
  `repository-agent-bootstrap` setup-only requests.

#### X6. pass^k reliability diagnostics

- **Artifact type:** Catalog evaluation tooling.
- **Problem and proposed outcome:** A single successful trial can hide
  inconsistent policy or review behavior. Add repeated-trial reliability
  diagnostics for promotion or targeted audits without making every CI run
  expensive.
- **Evidence:** **Verified** τ-bench introduced pass^k to expose
  inconsistency across repeated agent trials
  ([τ-bench](https://arxiv.org/abs/2406.12045)). **Verified** Anthropic's
  eval guidance distinguishes tasks, trials, graders, transcripts, outcomes,
  and regression versus capability evaluation
  ([Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).
- **Differentiation and overlap boundary:** This extends maturity diagnostics;
  it does not redo AS-001 behavior-suite implementation, AS-002 routing-suite
  implementation, AS-007 runtime pilots, or AS-009 hosted pack baselines.
  It should start as a report, not a new promotion threshold.
- **Dependencies:** Existing eval result schema, graduation policy, a small
  set of core skills, and an explicit cost budget.
- **Risks and security:** Repeated runs multiply model and hosted-runtime
  cost and may retain sensitive prompts. Use sanitized fixtures, bounded k,
  immutable result identity, and no automatic demotion.
- **Acceptance criteria:** A report records trial identity, pass^k,
  single-trial comparison, grader version, adapter/model provenance, and
  uncertainty; it cannot confer maturity on its own.
- **Evaluation:** Add a deterministic repeated-trial fixture and run
  `npm run eval:smoke`. Measure pass^k calculation, artifact binding, and
  refusal when required trial evidence is missing.

#### X7. Post-PR release and deployment readiness

- **Artifact type:** New portable skill plus an extension to the
  `release-readiness` pack.
- **Problem and proposed outcome:** The current release pack ends at
  correctness, security, documentation, verification, and Git/PR work. Add
  stack-agnostic release notes, versioning, rollout, feature-flag, migration,
  monitoring, and rollback decisions after the PR boundary.
- **Evidence:** **Verified** ecosystem gap: the closest engineering catalog
  includes `shipping-and-launch`, while this catalog's current pack is
  explicitly “before release-related Git work”
  ([addyosmani/agent-skills](https://github.com/addyosmani/agent-skills);
  [`registry/packs.json`](../../registry/packs.json)). **Inferred** demand is
  high, but differentiation is lower than N1/N2 because other catalogs cover
  similar material.
- **Differentiation and overlap boundary:** Start after
  `git-and-pr-workflow`; do not repeat branch, commit, PR, or generic
  verification mechanics. Do not prescribe a cloud provider, CI product, or
  deployment API.
- **Dependencies:** A real release runbook or postmortem for AS-003; a
  decision about whether the current pack gains a new member or a new pack is
  preferable; existing AS-009 pack transition rules.
- **Risks and security:** Rollout advice can cause production impact. Require
  explicit ownership, approval, canary/rollback criteria, migration safety,
  observability, and no direct deployment authority.
- **Acceptance criteria:** The workflow produces a release checklist with
  version/source identity, user-visible notes, rollout gates, rollback
  trigger, data-compatibility check, and post-release verification.
- **Evaluation:** Add a “ready to ship” behavior case and a PR-only negative
  case. Run pack validation and behavior evaluation; measure post-PR coverage
  and false activation for ordinary Git work.

### Later: validate demand, stable interfaces, and operational feasibility

#### L1. Procedural-memory and workflow-harvesting proposals

- **Artifact type:** Extension to catalog learning tooling; proposal-only.
- **Problem and proposed outcome:** Successful traces contain reusable
  procedures, but converting them into a skill can overfit or encode unsafe
  behavior. Add a bounded analyzer that proposes repeated workflow fragments
  for maintainer review.
- **Evidence:** **Verified** reusable procedure and experiential-learning
  mechanisms in [Voyager](https://arxiv.org/abs/2305.16291),
  [Agent Workflow Memory](https://arxiv.org/abs/2409.07429), and
  [ExpeL](https://arxiv.org/abs/2308.10144). **Inferred** local fit is high
  because SI-002 already defines a read-only, proposal-only learning agent.
- **Differentiation and overlap boundary:** This is a seed for SI-002, not a
  new learning loop, backlog state machine, hosted scheduler, or auto-merge
  feature. It must use `improvement-proposal` contracts and existing
  deduplication, evidence, approval, and rollback controls.
- **Dependencies:** SI-002, AS-001/AS-003 evidence conventions, sanitized
  successful traces, and a human-reviewed extraction rubric.
- **Risks and security:** Trace mining can retain secrets, personal data,
  prompt injection, or brittle task-specific actions. Sanitize inputs,
  require provenance, prohibit automatic merges, and reject procedures with
  unclear authority.
- **Acceptance criteria:** A proposal names source traces, repeated steps,
  generalization assumptions, deduplication results, verification commands,
  risk, and expected benefit; it never edits a skill directly.
- **Evaluation:** Use a small set of sanitized successful and failed traces.
  Measure repeated-step precision, duplicate rejection, secret redaction, and
  maintainer acceptance; do not use published paper results as local targets.

#### L2. Environment and reproducibility capture

- **Artifact type:** Operational feature and documentation.
- **Problem and proposed outcome:** Agent results are hard to reproduce when
  model, adapter, tool versions, environment, credentials mode, workspace
  state, and context checkpoints are not recorded. Define a portable capture
  contract for sanitized run metadata.
- **Evidence:** **Verified** session/state management in
  [Google ADK documentation](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/sessions/manage-with-adk)
  and harness/sandbox separation in
  [Managed Agents](https://www.anthropic.com/engineering/managed-agents).
  **Inferred** the catalog can extend existing result provenance without
  changing canonical skills.
- **Differentiation and overlap boundary:** Capture run reproducibility for
  catalog evals or production-agent studies; do not duplicate
  `registry/lifecycle.json` package provenance or SI-008 audit controls.
- **Dependencies:** Existing eval, runtime-smoke, pack, and drift artifacts;
  a redaction policy; stable adapter identity fields.
- **Risks and security:** Environment captures can include secrets, file paths,
  host identifiers, or customer data. Define allow-listed fields, redaction,
  retention, and access controls before storage.
- **Acceptance criteria:** A sanitized manifest can recreate the relevant
  source, adapter, model, suite, tool versions, environment class, and
  checkpoint identity without storing secrets or raw prompts by default.
- **Evaluation:** Create a fixture manifest with deliberate secret and
  nondeterminism fields; run existing validators and assert secret omission,
  stable hashing, and clear “not reproducible” status when fields are absent.

#### L3. Failure-injection and chaos testing for agent workflows

- **Artifact type:** Evaluation and operational tooling.
- **Problem and proposed outcome:** Reliability claims rarely cover interrupted
  tools, expired tasks, dropped events, stale leases, duplicate callbacks, or
  evaluator disagreement. Provide bounded failure fixtures for recovery and
  stop-condition discovery.
- **Evidence:** **Verified** durable execution and long-running harness
  patterns in [Temporal](https://temporal.io/blog/build-resilient-agentic-ai-with-temporal),
  [MCP Tasks](https://github.com/modelcontextprotocol/ext-tasks/blob/main/specification/draft/tasks.md),
  and Anthropic's
  [long-running harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps).
- **Differentiation and overlap boundary:** Test a user's agent design or a
  bounded catalog adapter. Do not reimplement SI-008 fault-injection gates or
  AS-007 host smoke coverage; those remain existing infrastructure.
- **Dependencies:** X2 state-recovery vocabulary, L2 run manifests, and
  explicit safety boundaries for simulated side effects.
- **Risks and security:** Fault injection against real systems can cause
  outages or duplicate side effects. Use local fixtures, dry-run adapters,
  synthetic credentials, bounded process groups, and an explicit kill switch.
- **Acceptance criteria:** Each fixture has a deterministic fault point,
  expected recovery/stop state, cleanup guarantee, and no real external
  mutation.
- **Evaluation:** Add deterministic fixtures for crash, timeout, stale lease,
  duplicate action, and unknown outcome. Run the smallest relevant smoke
  command and measure fail-closed behavior, cleanup certainty, and artifact
  completeness.

#### L4. Browser and UI verification

- **Artifact type:** New portable skill.
- **Problem and proposed outcome:** Unit tests do not establish DOM behavior,
  console/network health, screenshots, accessibility, or browser-specific
  behavior. Provide a framework-agnostic evidence checklist for UI flows.
- **Evidence:** **Verified** ecosystem gap and direct analogues in
  [Anthropic's skills catalog](https://github.com/anthropics/skills) and
  [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills).
  **Inferred** demand is conditional rather than universal for this
  engineering catalog.
- **Differentiation and overlap boundary:** Limit scope to browser/UI evidence
  gathering. Do not become a second `verification-before-completion`,
  `test-driven-development`, or frontend implementation skill.
- **Dependencies:** A reproducible browser fixture, supported evidence format,
  and a decision on whether hosted browser execution is out of scope.
- **Risks and security:** Browser sessions can expose credentials, private
  data, or destructive actions. Use synthetic accounts, isolated profiles,
  explicit consent, and read-only checks unless a test fixture authorizes more.
- **Acceptance criteria:** The workflow requests DOM, console, network,
  screenshot, accessibility, and browser/version evidence where applicable
  and distinguishes unavailable browser access from a pass.
- **Evaluation:** Add a Safari-only UI failure and a unit-test-only negative
  case. Measure evidence-request recall and routing separation from general
  completion verification.

#### L5. Registry search and tool/API discovery fallback

- **Artifact type:** Catalog tooling.
- **Problem and proposed outcome:** At larger catalog sizes, one-line
  descriptions may still create ambiguous choices. Add an opt-in,
  registry-backed search/index path that narrows candidates before activation.
- **Evidence:** **Verified** adaptive tool retrieval findings in
  [RAG-MCP](https://arxiv.org/abs/2505.03275) and the emerging
  [tool-count study](https://arxiv.org/abs/2605.24660). **Verified** the
  progressive-disclosure rationale in
  [Anthropic's Agent Skills guidance](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills).
- **Differentiation and overlap boundary:** This is a fallback for catalog
  discovery, not a host-specific `search_tools` API, embedding mandate, or
  replacement for N6 collision diagnostics or AS-002 routing evaluation.
- **Dependencies:** N6/N7 measurements, stable discovery metadata, and a
  demonstrated routing degradation threshold at simulated catalog sizes.
- **Risks and security:** Search indexes can leak private descriptions or
  amplify poisoned metadata. Keep indexes local, validate source identity,
  preserve explicit user visibility, and fail closed on stale indexes.
- **Acceptance criteria:** The fallback activates only after a measured
  threshold, returns explainable candidates, preserves negative cases, and
  never loads untrusted resource content merely to rank a skill.
- **Evaluation:** Extend routing fixtures with controlled decoys at several
  catalog sizes. Compare precision, recall, collision rate, serialized
  context, and activation latency before committing to an index.

#### L6. Outcome-based benchmark and eval generation

- **Artifact type:** Evaluation tooling and documentation.
- **Problem and proposed outcome:** A repeatable way to turn a skill proposal
  into tasks, trials, graders, transcript checks, and final-state assertions
  would make new evidence cheaper without weakening existing gates. Generated
  concepts must lower onto the current behavior and routing suite contracts,
  not become new schema fields.
- **Evidence:** **Verified** the task/trial/grader/transcript/outcome
  vocabulary in [Anthropic's eval guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).
  **Verified** the repository already has versioned behavior and routing
  contracts in [`evals/`](../../evals/). **Inferred** value is an authoring
  accelerator after AS-001/AS-002 real-model baselines exist.
- **Differentiation and overlap boundary:** This is a generator and fixture
  convention layered on existing AS-001/AS-002 infrastructure, not a second
  eval runner, new threshold policy, or substitute for real-model evidence.
  Lower task concepts to case `id` and `prompt`; grader and outcome checks to
  objective `assertions`; transcript checks to assertions over adapter text or
  `humanReview`; negative or near-miss cases to routing
  `expected`/`excluded`; and dataset assignment to routing `split`
  (`training` or `validation`). Trial repetition uses the existing
  routing/pack-suite `trials` controls and runner result records; behavior
  suites have no trial field. Any concept not representable by those fields
  and semantics requires a separately specified schema/runner extension before
  generation.
- **Dependencies:** AS-001/AS-002 completion gates, current suite and runner
  contracts, N6 collision findings, and contribution evidence requirements.
- **Risks and security:** Generated graders can encode production logic,
  reward superficial text, or omit safety cases. Require human review,
  independent assertions, bounded generation, and no self-authored passing
  evidence.
- **Acceptance criteria:** A scaffold emits behavior cases with only `id`,
  `prompt`, objective `assertions`, and `humanReview`, and routing cases with
  only `id`, `prompt`, `expected`, `excluded`, and `split`; it uses existing
  runner trial controls rather than inventing per-case trial fields. Anything
  else fails closed pending a schema/runner extension. Generated fixtures
  pass `npm run eval:validate` (including routing validation) without unknown
  fields and are clearly marked as non-evidence.
- **Evaluation:** Run `npm run eval:validate`, `npm run eval:smoke`, and
  `npm run routing:smoke` on generated behavior and routing fixtures; measure
  schema validity, assertion and human-review coverage, expected/excluded
  correctness, split coverage, and rejection of unsupported fields or
  answer-key leakage.

#### L7. Human approval gates and agent action provenance

- **Artifact type:** Portable skill or operational guidance; lower-confidence.
- **Problem and proposed outcome:** Production agents need a policy for which
  actions require human approval and a tamper-evident record of identity,
  authorization, action, outcome, and uncertainty.
- **Evidence:** **Verified** human-review interruption semantics in
  [OpenAI guardrails and human review](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals)
  and approval/least-privilege guidance in the
  [CISA/NSA/Five Eyes guide](https://www.ncsc.govt.nz/assets/guides/Joint-Guide-Careful-Adoption-of-Agentic-AI-Services.pdf).
  **Verified** mature supply-chain provenance primitives in
  [SLSA](https://slsa.dev/spec/v0.1/provenance). The
  [IETF audit-trail draft](https://datatracker.ietf.org/doc/draft-sharif-agent-audit-trail/)
  is explicitly immature and non-normative.
- **Differentiation and overlap boundary:** This concerns runtime action
  authorization and auditability, not AS-010 skill-package provenance or
  SI-008 repository-improvement audit controls. It may be folded into X1 or
  X4 if demand is too thin for a standalone artifact.
- **Dependencies:** A labeled action-sensitivity fixture, retention and
  redaction policy, and a stable primary standard beyond the draft material.
- **Risks and security:** Approval bypass, replay, forged audit records,
  credential leakage, and excessive retention are material risks. Require
  short-lived credentials, authorization re-checks, append-only or signed
  records, and explicit expiry.
- **Acceptance criteria:** Guidance classifies approval-required actions,
  defines interrupt/resume and expiry, records the decision and actor, labels
  standards by authority, and never treats the IETF draft as ratified.
- **Evaluation:** Run classification fixtures for public reads, edits,
  deletes, and production changes. Measure approval precision/recall,
  provenance-field coverage, authority-label accuracy, and secret-redaction
  compliance.

## Explicit do-not-duplicate map

| Existing item | Boundary for this roadmap |
|---|---|
| AS-001 behavior evaluations | N1/N2/X1/X2/X3/X5/L4 add candidate fixtures only after the existing runner and evidence contract. L6 is a later scaffold, not a replacement runner. |
| AS-002 routing and collision evaluations | N6 adds a report-only pre-merge diagnostic; N7/L5 study scale. They do not replace real-model routing baselines, thresholds, or confusion reports. |
| AS-007 cross-runtime smoke tests | No opportunity here claims a new host pilot. New packs use current pack smoke; host execution remains the existing gate. |
| AS-009 pack hosted baselines | N3/N4/N5 propose composition definitions and fixtures only. Hosted baselines and non-null thresholds remain AS-009 work. |
| SI-001 through SI-010 | L1 feeds SI-002's proposal-only learning agent. L2/L3 may supply sanitized evidence to existing controls but do not create a new scheduler, queue, lease system, audit policy, or auto-merge loop. |
| `wayfinder-planning` | N3 consumes its cleared-map handoff. X2 generalizes recovery invariants to production agent actions; it does not change Wayfinder's tracker contract. |
| `shadow-*` | No data-migration safety skill is proposed because its architecture/decision and migration overlap is high. X1 hands system security findings to `security-review`; N5 keeps `shadow-observe` separate from onboarding. |
| `agent-tool-interface-design` | X3 may decide whether to use one or many agents; it does not choose CLI/MCP/code-execution interfaces. N6/L5 measure catalog discovery, not tool-schema design. |
| `security-review` and `external-skill-review` | X1 covers agent-system threats; X5 covers migration inventory. Neither replaces code-diff STRIDE review or third-party skill supply-chain review. |
| `release-readiness` pack | X7 starts after the current pack's PR-boundary handoff. It must not duplicate branch, commit, review, or verification steps. |

## Candidate sequencing and safe parallel discovery

Discovery can proceed in parallel only when the work has disjoint notes,
fixtures, and likely implementation surfaces. Registry generation,
`package.json`, shared schemas, and `evals/routing.json` remain serialized
integration points.

| Wave | Discovery slice | Likely future write set | Parallel rule |
|---|---|---|---|
| 1A | Validate N1 dependency-upgrade gap with two real migration/advisory sources. | `docs/product/discovery/dependency-upgrade.md`, later `skills/dependency-upgrade-safety/`, its eval fixtures. | Parallel with 1B and 1C; no registry edits. |
| 1B | Validate N2 performance gap with sanitized incident or profiling evidence. | `docs/product/discovery/performance-regression.md`, later `skills/performance-regression-triage/`, its fixtures. | Parallel with 1A and 1C; no registry edits. |
| 1C | Draft N3/N4/N5 pack chains and near-miss prompts. | Separate discovery notes; later `evals/packs/<new-pack>.json` per pack. | Pack manifest integration is serialized after the three drafts. |
| 1D | Measure N6/N7 against current descriptions and context accounting. | `docs/product/discovery/catalog-scale.md`, later one tooling module and its tests. | Parallel with skill-gap discovery; do not edit AS-002 fixtures until design review. |
| 2A | Threat/state/multi-agent scope study for X1/X2/X3. | One note per opportunity; later separate skill directories and fixtures. | These three discovery notes are disjoint; shared registry work waits. |
| 2B | Observability/provenance scope study for X4/L7. | Separate notes and sanitized fixture schemas. | Parallel with 2A; coordinate only on redaction vocabulary. |
| 2C | Validate X7's post-PR boundary with a release runbook. | `docs/product/discovery/release-readiness.md`; later one skill or pack-member change. | Parallel with 2A/2B; pack manifest integration waits. |
| 3 | Decide L1/L2/L3/L4/L5/L6 based on Now/Next results. | Later proposal/tooling notes only; no implementation commitment. | Serialize the decision against measured routing, evidence, and security results. |

The safe parallel rule is intentionally conservative: separate directories do
not make shared registry, schema, README, changelog, or package changes safe to
edit concurrently. Any future implementation should use the repository's
existing `planning-and-task-breakdown` and `parallel-worktree-delivery`
contracts before assigning overlapping work.

## Top five recommendations

1. **N1 dependency-upgrade and CVE/lockfile safety.** It fills a concrete
   lifecycle gap, has a clear boundary from refactoring and research, and has
   high recurring user demand.
2. **N2 performance-regression triage.** It addresses a distinct “slow but
   correct” objective and can demonstrate value with a small, reproducible
   fixture.
3. **N3 Wayfinder-to-delivery pack.** It turns an existing differentiated
   planning capability into a complete, composable handoff without adding a
   duplicate skill.
4. **N6 skill-description collision optimizer.** It is a low-risk,
   report-only guard that protects the catalog before scale makes routing
   failures expensive.
5. **X1 agentic-AI threat modeling.** It closes the largest operational security
   gap while preserving `security-review` as the component-level owner.

These five balance immediate user value, differentiation, bounded scope, and
measurability. N7 should run alongside N6 because context size and collision
quality are coupled. X2 and X4 should not begin implementation until their
production-agent boundaries are proven distinct from Wayfinder and SI-008.

## 30/60/90-day discovery roadmap

These are milestone windows for discovery, not calendar commitments or release
promises.

### First 30-day milestone: validate the Now problem set

- Obtain one real dependency/CVE upgrade source and one sanitized performance
  investigation source for AS-003 evidence.
- Draft N3/N4/N5 pack chains and negative cases without changing registry
  manifests.
- Measure current description similarity, serialized context, and routing
  behavior at controlled catalog sizes.
- Decide whether N6/N7 can remain deterministic, local, and report-only.
- Kill or re-scope any candidate that lacks a distinct user problem or a
  reproducible evaluation fixture.

### First 60-day milestone: validate Next boundaries

- Run bounded discovery fixtures for X1, X2, X3, X4, X5, X6, and X7.
- Confirm that X1 does not duplicate `security-review`, X2 does not duplicate
  Wayfinder recovery, and X4 does not duplicate SI-008.
- Establish cost, redaction, provenance, and source-review requirements for
  any repeated-trial or trace-based evidence.
- Select at most the highest-confidence candidates for implementation-ready
  specifications.

### First 90-day milestone: approve or stop implementation candidates

- Record with-skill versus baseline results for each surviving skill candidate.
- Record pack composition results and context accounting for each surviving
  pack candidate.
- Define a maintainer-approved threshold or explicit “diagnostic only” status
  for pass^k, collision, and catalog-scale measurements.
- Produce a final go, defer, or kill decision for each top-five item, with
  rollback and source re-review triggers.

## Open questions

1. What minimum evidence qualifies as a real dependency migration or
   performance incident under AS-003?
2. Should the three onboarding/delivery packs share a naming family, or should
   each remain independently discoverable?
3. At what measured catalog size does current routing quality degrade enough to
   justify a search/index fallback?
4. Should collision scores be lexical only, or can a local embedding method be
   adopted without adding maintenance or privacy risk?
5. Which production-agent trace fields are portable enough to document while
   OpenTelemetry GenAI conventions remain in development?
6. Which supported runtime, if any, can exercise browser or hosted-agent
   opportunities in public CI without false passes?
7. What retention and redaction policy applies to traces, generated proposals,
   eval artifacts, and environment manifests?
8. Does X5 belong in `repository-agent-bootstrap`, or would its migration
   output make that existing skill exceed its size and routing budget?
9. Is L7 sufficiently differentiated from X1 and X4 to justify a standalone
   artifact once approval and provenance demand is measured?

## Kill criteria

- **No distinct uplift:** stop a new skill when a baseline or existing
  neighbor performs equally well on held-out cases and no safety/compliance
  exception applies.
- **Unbounded overlap:** stop or fold an opportunity into an existing skill
  when its trigger set cannot separate from a named neighbor.
- **No reproducible measure:** stop performance, browser, chaos, or
  observability work when no safe fixture can establish a baseline and
  outcome.
- **Host lock-in:** stop any canonical-skill proposal that requires a vendor
  hook, proprietary frontmatter, hosted dashboard, or runtime-only API.
- **Unsafe authority expansion:** stop if a proposal requires automatic
  package upgrades, deployment, credential access, direct skill edits, or
  self-approval.
- **Evidence staleness:** defer any source-sensitive opportunity when its
  primary protocol or vendor contract changes and no current source review is
  available.
- **Cost without signal:** stop repeated-trial, trace, or multi-agent studies
  when the measured signal does not justify their token, runtime, storage, or
  maintainer cost.
- **Pack complexity:** stop a pack when its handoffs create cycles, hidden
  authority, routing collisions, or no measurable reduction in user choice.

This roadmap is the canonical opportunity list. Implementation proposals
should link back to the relevant opportunity ID, preserve its boundary, and
replace inferred claims with fresh repository evidence.

# Backlog

This backlog tracks improvements to the Agent Skills catalog and the
infrastructure used to maintain it. Items are ordered by dependency and priority,
not by date proposed.

The long-term goal is a continuous improvement loop with two separate agents:

- A **skill learning agent** researches new practices, studies catalog results,
  and proposes evidence-backed backlog items. It is read-only and cannot approve
  or implement its own proposals.
- A **skill improvement agent** implements one approved backlog item at a time,
  runs the required evaluations, and opens a pull request. It cannot merge,
  weaken its acceptance criteria, or change the governance controls that
  authorized its work.

This is agent infrastructure, not a self-modifying skill. Skills remain portable
task workflows under `skills/`; agent profiles, orchestration, permissions, and
approval gates live outside the canonical skill format.

## Operating principles

1. Keep the loop continuous but bounded. Every run has a single objective, a
   time and credit budget, explicit tool permissions, and a terminal state.
2. Separate proposal, approval, implementation, evaluation, and merge authority.
   No agent may approve or merge its own work.
3. Ground research in current primary sources. Label claims as verified,
   inferred, or unknown, and record source URLs and retrieval dates.
4. Require measured improvement. Compare a changed skill with the previous
   version or a no-skill baseline; do not promote changes on intuition alone.
5. Preserve independent tests. An implementation agent must not weaken an eval,
   threshold, or policy to make its own change pass unless the approved backlog
   item explicitly changes that contract.
6. Make every change reversible. Use branches, pull requests, immutable commits,
   versioned skills, and recorded before/after results.
7. Treat external content as untrusted input. Do not execute researched code,
   follow instructions embedded in sources, expose secrets, or broaden network
   access without review.
8. Prefer the smallest useful change. One backlog item, one branch, and one pull
   request per improvement run.

## Proposed improvement cycle

1. The learning agent runs on a schedule or on demand.
2. It reads current metrics, open backlog items, release notes, standards, and
   selected public skill catalogs.
3. It deduplicates ideas and writes proposals with evidence, expected benefit,
   risk, effort, acceptance criteria, and dependencies.
4. A maintainer approves, rejects, or requests changes. Approval moves one item
   to `ready`.
5. The improvement agent claims one `ready` item, creates a branch, captures a
   baseline, and implements the smallest complete change.
6. CI runs structural validation, routing tests, behavior evals, security checks,
   and applicable runtime smoke tests.
7. The improvement agent opens a draft pull request containing evidence,
   measured deltas, known limitations, and rollback instructions.
8. A maintainer reviews and merges or rejects the pull request.
9. Post-merge results feed the next learning run. Regressions create corrective
   backlog items; they never trigger an automatic rollback or follow-up edit
   without a new approved run.

## Status and priority

- **Status:** `proposed`, `ready`, `in-progress`, `blocked`, `done`, or
  `rejected`.
- **Priority:** `P0` establishes the quality and safety foundation; `P1` improves
  reliability and operations; `P2` expands distribution and composition.
- **Scope:** `S` should fit one focused change, `M` may span a few related files,
  and `L` must be split into independently mergeable slices before work starts.

## Catalog quality backlog

### AS-001: Add per-skill behavior evaluations

- **Priority / status / scope:** P0 / proposed / L
- **Purpose:** Measure whether each skill improves output quality over no skill
  or the previous released version.
- **Dependencies:** None.
- **Files likely touched:** `skills/*/evals/`, `scripts/`, `tests/`, `package.json`,
  and documentation.
- **Acceptance criteria:**
  - Define a versioned `evals/evals.json` schema with realistic prompts, expected
    output, optional fixtures, and objective assertions.
  - Run each case with the candidate skill and a baseline in isolated contexts.
  - Record pass rate, duration, token use, and per-assertion evidence.
  - Support human review for qualities that cannot be graded mechanically.
  - Split implementation into runner, schema, and initial-skill adoption pull
    requests.
- **Verification:** `npm test` plus a documented eval command that produces a
  valid benchmark artifact for one pilot skill.

### AS-002: Add routing and collision evaluations

- **Priority / status / scope:** P0 / proposed / L
- **Purpose:** Improve activation recall while preventing adjacent skills from
  competing for the same request.
- **Dependencies:** AS-001 for shared result and reporting conventions.
- **Files likely touched:** `skills/*/evals/`, `scripts/`, `tests/`, and generated
  reports.
- **Acceptance criteria:**
  - Give every skill realistic positive prompts and near-miss negative prompts.
  - Run each query multiple times and record activation rate.
  - Keep separate training and validation query sets.
  - Generate a catalog-wide confusion report for adjacent skills.
  - Establish initial recall, precision, and collision thresholds from a measured
    baseline rather than arbitrary targets.
- **Verification:** A routing command reports stable results for at least the
  `code-review`/`security-review` and
  `requirements-and-spec-writing`/`planning-and-task-breakdown` boundaries.

### AS-003: Require demonstrated uplift for new skills

- **Priority / status / scope:** P0 / proposed / M
- **Purpose:** Avoid adding generic instructions that duplicate the base model's
  existing strengths.
- **Dependencies:** AS-001.
- **Files likely touched:** `CONTRIBUTING.md`, `docs/authoring-guide.md`, pull
  request templates, and CI policy.
- **Acceptance criteria:**
  - Require proposals to name the real expertise source: task transcripts,
    incident reports, runbooks, review history, specifications, or equivalent
    domain material.
  - Require a with-skill versus baseline comparison before promotion.
  - Permit an explicit exception for safety or compliance controls whose value
    is risk reduction rather than higher average output quality.
- **Verification:** A fixture contribution without evidence or uplift is rejected
  with an actionable diagnostic.

### AS-004: Define tier promotion and demotion policy

- **Priority / status / scope:** P0 / proposed / M
- **Purpose:** Make `experimental`, `extended`, and `core` meaningful maturity
  signals.
- **Dependencies:** AS-001 and AS-002.
- **Files likely touched:** `CONTRIBUTING.md`, `docs/authoring-guide.md`,
  `schemas/registry.schema.json`, and registry tooling.
- **Acceptance criteria:**
  - Define entry, promotion, regression, deprecation, and removal criteria.
  - Require structural validation, routing quality, behavior uplift, applicable
    smoke tests, and maintainer approval for `core`.
  - Surface tier evidence and last evaluation date in the registry.
- **Verification:** Registry validation rejects an unsupported promotion and
  accepts a fixture with complete evidence.

### AS-005: Enrich registry discovery metadata

- **Priority / status / scope:** P0 / proposed / M
- **Purpose:** Make the catalog searchable by user intent, compatibility, risk,
  and composition needs.
- **Dependencies:** AS-004 for maturity fields.
- **Files likely touched:** `schemas/registry.schema.json`,
  `scripts/generate-registry.mjs`, `registry/skills.json`, and documentation.
- **Acceptance criteria:**
  - Add category, tags, inputs, outputs, risk, runtime compatibility, related
    skills, conflicting skills, maturity evidence, and example prompts.
  - Keep catalog-only data in a companion manifest or generated registry rather
    than non-portable `SKILL.md` frontmatter.
  - Provide filters without increasing every runtime's startup context.
- **Verification:** Registry generation is deterministic and schema-valid, and a
  query can identify skills by category, runtime, and input/output shape.

### AS-006: Bundle deterministic helpers selectively

- **Priority / status / scope:** P1 / proposed / M
- **Purpose:** Stop agents from repeatedly recreating fragile mechanical logic.
- **Dependencies:** AS-001, so a script is added only when traces show repeated
  work or measurable reliability gain.
- **Files likely touched:** Selected `skills/*/scripts/`, script tests, and
  `SKILL.md` references.
- **Acceptance criteria:**
  - Pilot helpers for deterministic operations such as repository inventory,
    provenance checking, or `.shadow` graph validation.
  - Require non-interactive interfaces, concise `--help`, structured output,
    useful errors, idempotency, dry-run support for writes, safe defaults, and
    documented exit codes.
  - Pin or declare dependencies and prohibit network access unless explicitly
    approved.
- **Verification:** Each helper has direct tests and improves at least one eval
  without an unacceptable token, time, or security cost.

### AS-007: Add cross-runtime smoke tests

- **Priority / status / scope:** P1 / proposed / L
- **Purpose:** Test actual discovery and execution instead of format conformance
  alone.
- **Dependencies:** AS-001 for a common result format.
- **Files likely touched:** `.github/workflows/`, fixtures, `scripts/`, and
  compatibility documentation.
- **Acceptance criteria:**
  - Test install paths, discovery, explicit invocation, resource resolution, and
    supported host extensions for Claude Code, GitHub Copilot, and OpenAI Codex.
  - Separate tests that can run in public CI from licensed or hosted smoke tests.
  - Report unsupported or unavailable hosts as explicit skips, not false passes.
- **Verification:** A fixture skill completes the supported smoke-test matrix and
  produces a machine-readable report.

### AS-008: Add a first-party skill scaffolder

- **Priority / status / scope:** P1 / proposed / M
- **Purpose:** Make the correct structure and evaluation workflow the easiest
  path for contributors.
- **Dependencies:** AS-001, AS-002, and AS-005.
- **Files likely touched:** `scripts/create-skill.mjs`, `tests/`, `package.json`,
  and authoring documentation.
- **Acceptance criteria:**
  - Add `npm run skill:create`.
  - Generate valid frontmatter, a concise workflow skeleton, positive and
    negative routing fixtures, behavior eval placeholders, and optional resource
    directories.
  - Refuse overlapping names and run validation after generation.
- **Verification:** Snapshot tests cover minimal and resource-bearing scaffolds;
  generated output passes repository and portable validation.

### AS-009: Publish composable workflow packs

- **Priority / status / scope:** P2 / proposed / L
- **Purpose:** Install complementary skills together without merging their
  instructions or creating routing collisions.
- **Dependencies:** AS-005 and AS-007.
- **Files likely touched:** A new versioned pack manifest, schemas, registry
  tooling, tests, and documentation.
- **Acceptance criteria:**
  - Define packs such as `feature-delivery`, `safe-refactor`, and
    `release-readiness`.
  - Record included skills, versions, handoffs, conflicts, and install policy.
  - Keep each skill independently installable and portable.
  - Evaluate the pack as a composition, including routing conflicts and combined
    context cost.
- **Verification:** A pilot pack installs and uninstalls atomically and passes
  composition evals.

### AS-010: Add provenance and lifecycle management

- **Priority / status / scope:** P1 / proposed / M
- **Purpose:** Prevent silent drift and make stale or superseded skills visible.
- **Dependencies:** AS-005.
- **Files likely touched:** Registry schema and generator, receipts, validation,
  contribution policy, and documentation.
- **Acceptance criteria:**
  - Record immutable upstream ref and commit, license, last-reviewed date,
    status, and optional replacement.
  - Add statuses for active, deprecated, superseded, and removed.
  - Schedule re-review for external and compatibility-sensitive content.
  - Preserve hashes for every installed resource and provide a documented
    rollback path.
- **Verification:** Tests detect changed upstream identity, expired review dates,
  invalid replacement links, and receipt hash mismatches.

## Continuous learning and improvement infrastructure

### SI-001: Record the architecture decision

- **Priority / status / scope:** P0 / done / S
- **Purpose:** Establish the two-agent boundary and the controls that future
  automation must preserve.
- **Dependencies:** None.
- **Files likely touched:** A new ADR under `docs/`.
- **Acceptance criteria:**
  - Document separate learning and improvement agents, authority boundaries,
    state transitions, cloud execution options, threat model, costs, and
    alternatives.
  - State that the system proposes and implements changes but never self-merges.
  - Define which governance files require explicit maintainer-authored approval.
- **Verification:** ADR review confirms every operating principle in this backlog
  has an owning component and enforcement point.
- **Result:** Recorded in
  [`docs/decisions/0001-bounded-continuous-improvement.md`](docs/decisions/0001-bounded-continuous-improvement.md).

### SI-002: Create the skill learning agent

- **Priority / status / scope:** P0 / proposed / M
- **Purpose:** Generate new, grounded improvement proposals without editing the
  product it evaluates.
- **Dependencies:** SI-001 and AS-005.
- **Files likely touched:** `.github/agents/skill-learning.agent.md`, proposal
  templates, and tests or fixtures.
- **Acceptance criteria:**
  - Limit tools to read/search and the minimum issue-writing capability.
  - Search local evidence first, then current official sources and selected
    reputable catalogs.
  - Separate verified facts, inference, and unknowns; cite URL, publisher,
    retrieval date, and applicable version.
  - Deduplicate against open and completed work.
  - Produce proposals with problem evidence, expected benefit, effort, risk,
    dependencies, acceptance criteria, and verification.
  - Never edit skills, code, tests, policies, or its own profile.
- **Verification:** Scenario tests reject duplicate, uncited, untestable, and
  out-of-scope proposals while accepting a grounded novel proposal.

### SI-003: Create the skill improvement agent

- **Priority / status / scope:** P0 / proposed / M
- **Purpose:** Implement approved work predictably and produce reviewable
  evidence.
- **Dependencies:** SI-001, AS-001, and AS-004.
- **Files likely touched:** `.github/agents/skill-improvement.agent.md`, pull
  request templates, and scenario fixtures.
- **Acceptance criteria:**
  - Accept only one item in `ready` state with complete acceptance criteria.
  - Capture a baseline before editing and use the smallest relevant verification.
  - Refuse to weaken tests, evals, permissions, or policy unless the approved
    item explicitly requires that change.
  - Open a draft pull request with source links, before/after results, risks,
    unresolved findings, and rollback instructions.
  - Never approve or merge its own pull request.
- **Verification:** Scenario tests demonstrate correct refusal, one-item scope,
  independent-gate preservation, and complete pull request output.

### SI-004: Implement a versioned backlog state machine

- **Priority / status / scope:** P0 / proposed / M
- **Purpose:** Prevent duplicate claims, skipped approvals, and recursive work.
- **Dependencies:** SI-002 and SI-003.
- **Files likely touched:** Issue forms or a versioned manifest, labels, scripts,
  tests, and documentation.
- **Acceptance criteria:**
  - Enforce `proposed -> ready -> in-progress -> done|blocked|rejected`.
  - Require maintainer action for `proposed -> ready`.
  - Use an atomic claim or lease so only one improvement agent owns an item.
  - Cap retries and create a visible blocked result instead of looping.
  - Preserve an append-only audit trail of transitions and actor identity.
- **Verification:** Concurrency tests prevent double claims and invalid
  transitions.

### SI-005: Configure the Copilot cloud environment

- **Priority / status / scope:** P0 / proposed / S
- **Purpose:** Give delegated cloud runs deterministic access to repository tools.
- **Dependencies:** SI-001.
- **Files likely touched:** `.github/workflows/copilot-setup-steps.yml` and cloud
  runbook documentation.
- **Acceptance criteria:**
  - Use the required single `copilot-setup-steps` job on a supported runner.
  - Install the repository's supported Node.js version and only necessary
    dependencies.
  - Grant minimum permissions and keep secrets in the `copilot` environment.
  - Exercise the setup workflow before relying on cloud implementation runs.
- **Verification:** The setup workflow succeeds from the default branch and a
  delegated session can run validation and tests.

### SI-006: Document manual cloud delegation

- **Priority / status / scope:** P0 / proposed / S
- **Purpose:** Enable the improvement loop in Copilot cloud before recurring
  automation is enabled.
- **Dependencies:** SI-003 and SI-005.
- **Files likely touched:** Cloud runbook documentation.
- **Acceptance criteria:**
  - Document selecting the improvement custom agent and delegating one approved
    item with Copilot CLI `/delegate` or the `&` prefix.
  - Document branch, draft pull request, session link, review, cancellation, and
    failure handling.
  - Require a clean or checkpointed local worktree before delegation.
- **Verification:** A pilot delegated item opens a draft pull request and leaves
  merge authority with a maintainer.

### SI-007: Add recurring cloud orchestration

- **Priority / status / scope:** P1 / proposed / L
- **Purpose:** Run learning and improvement work on a recurring cadence without
  creating an uncontrolled loop.
- **Dependencies:** SI-002 through SI-006 and AS-001.
- **Files likely touched:** Agentic workflow definitions or documented Copilot
  automation configuration, orchestration scripts, and runbooks.
- **Acceptance criteria:**
  - Evaluate versioned GitHub Agentic Workflows against Copilot automations.
  - Account for Copilot automations being private to their creator, stored
    outside Git, billable per run, and available only to private or internal
    repositories.
  - Prefer a versioned, reviewable configuration when feature availability
    permits.
  - Schedule learning independently from implementation.
  - Start implementation only when a `ready` item exists and no item is already
    leased.
  - Limit frequency, concurrent sessions, actions, AI credits, Actions minutes,
    and retries; provide a kill switch.
- **Verification:** A dry-run or staging repository demonstrates scheduled
  proposal creation and one approval-gated implementation without duplicate work.

### SI-008: Enforce audit, rollback, and budget controls

- **Priority / status / scope:** P0 / proposed / M
- **Purpose:** Bound operational and quality risk.
- **Dependencies:** SI-004.
- **Files likely touched:** Policy configuration, scripts, CI, and runbooks.
- **Acceptance criteria:**
  - Record prompt or item ID, agent identity, model when available, sources,
    permissions, commits, eval results, cost, duration, and final state.
  - Define per-run and monthly credit, time, retry, and pull-request limits.
  - Stop on permission expansion, protected-file changes, eval regression,
    repeated failure, or budget exhaustion.
  - Roll back by reverting an immutable merge commit or release; do not let the
    agent rewrite shared history.
- **Verification:** Fault-injection scenarios trip each stop condition and leave
  a reviewable audit record.

### SI-009: Add post-merge learning and drift detection

- **Priority / status / scope:** P1 / proposed / M
- **Purpose:** Learn from real outcomes without treating agent-generated
  conclusions as ground truth.
- **Dependencies:** AS-001, AS-002, AS-010, and SI-008.
- **Files likely touched:** Reporting scripts, scheduled checks, registry
  metadata, and documentation.
- **Acceptance criteria:**
  - Re-run held-out routing and behavior evals after merge and on a scheduled
    cadence.
  - Detect quality, routing, cost, compatibility, and source-staleness
    regressions.
  - Create corrective proposals rather than editing or reverting automatically.
  - Keep raw user prompts and secrets out of long-term learning artifacts unless
    explicitly approved and sanitized.
- **Verification:** Seeded regressions create deduplicated corrective proposals
  with evidence and no direct product changes.

### SI-010: Pilot and graduate the loop

- **Priority / status / scope:** P1 / proposed / M
- **Purpose:** Prove the operating model before enabling recurring work broadly.
- **Dependencies:** All P0 `AS` and `SI` items.
- **Files likely touched:** Pilot configuration, reports, and the ADR status.
- **Acceptance criteria:**
  - Run the learning agent manually for at least three proposal cycles.
  - Complete at least three approved improvement pull requests with independent
    review.
  - Measure proposal acceptance, duplicate rate, implementation success, eval
    delta, cost, and maintainer time.
  - Enable recurring operation only if predefined graduation thresholds pass.
  - Document shutdown and rollback procedures before graduation.
- **Verification:** A maintainer-approved pilot report records results,
  limitations, and the decision to graduate, revise, or stop.

## Safe parallel work

The following workstreams can proceed in parallel after SI-001 defines their
interfaces:

- **Evaluation foundation:** AS-001 and AS-002, restricted to eval schemas,
  runners, fixtures, and reports.
- **Catalog metadata:** AS-004, AS-005, and AS-010, serialized where they share
  registry schemas and generation code.
- **Agent profiles:** SI-002 and SI-003, with each worker restricted to its own
  agent profile and scenario fixtures.
- **Cloud setup:** SI-005 and SI-006, restricted to setup workflow and runbook
  files.

Integration work must be serialized for shared files such as `package.json`,
`CONTRIBUTING.md`, registry schemas, CI workflows, and this backlog.

## Open decisions

1. Choose the canonical operational backlog: GitHub issues and labels, a
   versioned manifest, or a synchronized combination.
2. Decide whether the repository will remain public. Copilot automations
   currently require a private or internal repository; GitHub Agentic Workflows
   or manual `/delegate` may be better fits for a public catalog.
3. Define initial budgets and graduation thresholds from pilot measurements.
4. Decide which files are protected from agent-authored changes without a
   separate maintainer-approved governance item.
5. Choose where eval artifacts and audit records live, their retention period,
   and what data must be redacted.

## Sources

Primary sources retrieved July 24, 2026:

- [Agent Skills specification](https://agentskills.io/specification)
- [Best practices for skill creators](https://agentskills.io/skill-creation/best-practices)
- [Evaluating skill output quality](https://agentskills.io/skill-creation/evaluating-skills)
- [Optimizing skill descriptions](https://agentskills.io/skill-creation/optimizing-descriptions)
- [Using scripts in skills](https://agentskills.io/skill-creation/using-scripts)
- [Anthropic skills catalog](https://github.com/anthropics/skills)
- [Awesome Copilot contribution guidelines](https://github.com/github/awesome-copilot/blob/main/CONTRIBUTING.md)
- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [Delegating tasks from Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/delegate-tasks-to-cca)
- [Invoking custom agents from Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents)
- [Creating custom agents for Copilot cloud agent](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents)
- [Configuring the Copilot cloud environment](https://docs.github.com/en/copilot/customizing-copilot/customizing-the-development-environment-for-copilot-coding-agent)
- [About Copilot automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations)
- [Creating Copilot automations](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-automations)
- [GitHub Agentic Workflows](https://docs.github.com/en/copilot/how-tos/github-agentic-workflows)
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)

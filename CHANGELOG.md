# Changelog

All notable changes to this repository are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Reject declared Shadow derived output with an empty source list as stale
  provenance; optional collection omission and matching sources remain valid.
- Correct interacting-input reduction and untestable bisect midpoints; account
  for module-load side effects, ambient-credential CSRF, target-specific negative
  controls, current hard constraints, and host-specific instruction scoping.
- Preserve repository ADR conventions and version-bound agreement evidence;
  clarify hosted hard caps, retrieval failures, read-only audits, and worker
  identity/bookkeeping without expanding permissions.
- Fixed approved planning handoffs for already-clear Wayfinder maps with zero
  cycles. Wayfinder 2.1.1 accepts an explicit host-supplied `handoff.at`, retains
  final-cycle time compatibility, and rejects missing, pre-cycle, future-issued,
  or expired approval times. Added focused regression coverage.
- Kept confirmed reclaim fences cleared after later reads and replay, made
  historical progress/receipt no-op journals recoverable under replacement
  leases with separately validated authorization time, and rejected worker
  dispatches occurring after their consolidation dispatch.

### Added

- Add independent workspace/file/command grading and trusted fixture setup to
  existing behavior evaluations (suite v2/result v3), with bounded redacted
  evidence and backward-compatible legacy text grading.
- Ground all 24 maintained skills' behavior suites in synthetic fixtures or
  trusted setup; add executable oracle controls for empty APIs, false-green
  tests, and another owner's staged changes. Human judgments remain pending.
- Added a research-backed feature opportunity roadmap covering skills, workflow
  packs, catalog and evaluation tooling, and operational discovery work.

### Changed

- Added partial-write state reconciliation to test-first implementation and
  debugging, verified skill-loading and messaging capability contracts for
  workers, schema-aware resumable task ledgers, and whole-range delivery
  preflight before readiness or publication.
- Added bounded, privacy-preserving raw session-event audit tooling with
  explicit time windows, execution-context attribution, deduplication, coverage
  limits, and separate transport and shell outcomes. Fixture checks do not
  establish model uplift, expected test-red intent, or billed-usage savings.
- Updated exact skill versions and the `feature-delivery`, `safe-refactor`,
  and `release-readiness` packs to 1.3.0 for their revised dependencies.
- Update 16 skill versions and exact pack bindings; `feature-delivery` and
  `release-readiness` are 1.3.1, and `shadow-architecture-suite` is 1.1.1.
  Keep all maturity records unverified and comparisons unset.
- Correct `safe-refactor` 1.4.0 to use passing baselines/characterization rather
  than a mandatory TDD detour. Keep changed-behavior work in a separate tested
  workflow and retain review and verification gates.
- Make Implementation-agent delegation proportional to independent scope and
  risk; keep continuous traces local and read-only worker persistence owned by
  the coordinator.
- Require Node.js 22.6 or later for native TypeScript evaluation fixtures.
- Completed contribution records for the earlier ten streamlined skills with
  specific safety/compliance exception requests and existing expertise sources.
  These are not fabricated comparisons, human approvals, or evidence of runtime
  or usage uplift.
- Added a conditional, research-linked session-audit procedure to `skill-creator`
  1.2.0 with backend-specific history queries, explicit trace coverage, private
  evidence boundaries, synthetic-control separation, and matched-run requirements.
- Clarified `codebase-exploration` 1.1.1 to discover optional paths before reading,
  reuse confirmed absence, and distinguish denied reads from missing guidance.
  Clarified `parallel-worktree-delivery` 1.1.1 to retain checkout ownership when
  historical session identities are not addressable worker handles.
- Updated `safe-refactor` to 1.2.1 for its exact exploration dependency. Added
  four generic behavior scenarios and requested safety contribution exceptions;
  no model uplift, usage savings, or completed independent review is claimed.
- Streamlined the remaining 20 skills with scoped workflows, conditional
  reference reads, bounded outputs, and explicit stop/handoff contracts.
  Retained safety, ownership, evidence, and lifecycle invariants; added behavior
  and routing scenarios without claiming unmeasured model or usage uplift.
- Updated exact-version composition dependencies: `feature-delivery`,
  `safe-refactor`, and `release-readiness` are 1.2.0;
  `shadow-architecture-suite` is 1.1.0. Updated executable install examples.
- Marked revised experimental skills' maturity as unverified pending evidence
  for their new trees. Preserved historical artifacts and approval records;
  did not relabel stale approvals as current or change declared tiers.
- Shortened `codebase-exploration`, `planning-and-task-breakdown`,
  `verification-before-completion`, and `skill-creator` to explicit, scoped
  workflows suitable for GPT models in Copilot. Added exploration stop rules,
  exclusive validation-resource ownership, nonempty worker handoffs, and reuse
  of inspected post-change evidence without weakening required gates.
- Updated `feature-delivery`, `safe-refactor`, and `release-readiness` to 1.1.0
  for their exact-version skill dependencies. Added efficiency behavior and
  routing scenarios; structural checks do not establish runtime or usage gains.
- Wayfinder now continues safe frontier work automatically with one claim at a
  time, protected budgets and reserves, substantive stop conditions, and
  automatic clear-map handoff while retaining its plan-only and safety
  boundaries.
- Bound verified maturity evidence to a unique, self-typed artifact for the
  current complete skill tree, rejecting duplicated, relabeled, or stale
  evidence during registry generation.
- Hardened the Wayfinder recovery checker with map-scoped targets, recoverable
  pending actions, revisioned external actions, uniform mutation replay keys,
  post-release read fences, strict RFC 3339 timestamps, checked revisions,
  bounded inputs and journals, coherent progress history, and compact
  hash-and-delta transitions.
- Tightened Wayfinder autonomy and recovery traces to millisecond timestamp
  precision, pre-consolidation worker barriers, inspected stopped cycles,
  trusted UTF-8 token accounting, a capped coherent journal with mandatory
  operation-input fingerprints, durable mutation receipts, canonical
  multi-ticket restart reconstruction, and post-confirmation replay fences.

## [0.2.0] - 2026-08-24

### Added

- Experimental `shadow-observe`, `shadow-dream`, and `shadow-drift` skills with
  bounded observation inventory and graph-validation scripts, direct tests,
  behavior and routing evaluations, and distinct current-state, future-state,
  and read-only drift responsibilities.
- Versioned `shadow-architecture-suite` composition pack with the linear
  observe-to-dream-to-architecture-to-drift lifecycle, explicit human approval
  before decision recording, and adjacent handoff and near-miss evaluation.
- Experimental `agent-tool-interface-design` skill for choosing and benchmarking
  CLI, direct MCP, constrained code-execution, and code-over-MCP interfaces,
  with Wayfinder discovery, `.shadow` decision handoff, and explicit sandbox,
  credential, state, recovery, and portability boundaries.
- Experimental `wayfinder-planning` skill for charting, resuming, and replanning
  long-running ambiguous work through claim-first Wayfinder maps, fog of war,
  frontier decision tickets, and explicit handoffs to specification and task
  planning without crossing into implementation or delivery.
- Deterministic Wayfinder recovery trace conformance checker and fixtures for
  revision, lease, durable-block, human-unblock, progress-idempotency, external
  receipt, reclaim-inspection, duplicate-action, and frontier semantics.
- Experimental `copilot-cloud-agent` skill for launching and monitoring genuine
  GitHub-hosted tasks, explicitly selecting GPT-5.6 Sol, verifying observed task
  metadata and pull-request artifacts, and distinguishing cloud model controls
  from unsupported reasoning-effort and context-window requests.
- Zero-dependency Node.js 22 `skill:create` scaffolder with deterministic
  portable skill output, optional resource placeholders, per-skill behavior and
  routing fixtures, preflight path and conflict safety, rollback, validation,
  advisory overlap review, documentation, and snapshot-like tests.
- Experimental `parallel-worktree-delivery` and `verification-discipline` skills,
  migrated from Pokemon Web with portable guidance, explicit overlap boundaries,
  immutable provenance, and safety-exception contribution evidence.
- Prioritized catalog backlog covering behavior and routing evaluations,
  discovery metadata, maturity policy, cross-runtime validation, workflow packs,
  provenance, and a bounded two-agent continuous learning and improvement
  architecture for local and Copilot cloud execution.
- Architecture decision defining separate learning and improvement agents,
  approval and evaluation gates, protected governance surfaces, cloud execution,
  audit, budgets, stop conditions, and rollback.
- Copilot cloud setup workflow that provisions Node.js 22 with read-only
  repository access and verifies the catalog, tooling tests, and generated
  registry before delegated work begins.
- Separate learning and improvement custom agents with minimal tool sets,
  approval and lease requirements, protected-path boundaries, and draft pull
  request evidence contracts.
- Strict learning-proposal and improvement-result contracts with deterministic
  refusal scenarios for duplicate, uncited, untestable, stale, multi-item,
  permission-expanding, regressed, and incomplete agent output.
- Implementation custom agent with focused read-only exploration and review
  specialists, Copilot CLI built-in agent routing, incremental editing, and
  executable validation requirements.
- Continuous-improvement issue and pull request templates, serialized GitHub
  queue transitions, approval-bound leases, merge-only completion, CODEOWNERS,
  versioned policy and schemas, deterministic validation tooling, and tests.
- Manual Copilot cloud pilot runbook covering proposal, approval, claim,
  delegation, review, cancellation, shutdown, and rollback.
- Protected `copilot` setup environment with static least-privilege workflow
  contract checks.
- Versioned continuous-improvement graduation thresholds, pilot report schemas,
  distinct evidence-count validation, maintainer approval gates, and report
  template.
- Architecture decision selecting repository-versioned GitHub Agentic
  Workflows for future recurring orchestration while schedules remain gated.
- Read-only recurring planner with fail-closed enablement, deterministic
  dependency selection, active-lease exclusion, cadence, proposal, and monthly
  budget gates.
- Sanitized post-merge drift detection for behavior, routing, cost proxies,
  runtime compatibility, and lifecycle staleness with stable corrective-proposal
  fingerprints and strict identity matching.
- Immutable commit pins for every GitHub Action used by validation, Copilot
  setup, and continuous-improvement control workflows.
- Versioned behavior-evaluation schemas and pilot suite, isolated comparative
  runner, subprocess adapter protocol, objective and human grading records,
  token and duration metrics, safe fixtures, and a synthetic smoke command.
- Versioned routing suite and result schemas, repeated isolated adapter trials,
  training and validation splits, activation, precision, recall, collision,
  token, timing, catalog-wide active-skill coverage, and confusion reports.
- Provenance-bound measured routing threshold policies with explicit adapter and
  model identity and nonzero failure on recall, precision, or collision
  regressions.
- Contribution evidence manifests and pull-request enforcement requiring real
  expertise sources plus measured uplift or an approved safety/compliance
  exception for every changed skill.
- Tier lifecycle policy, registry v2 maturity evidence and evaluation dates,
  one-step promotion and evidence-backed demotion enforcement, and pull-request
  comparison against the base registry.
- Registry v3 discovery metadata for every skill, including category, tags,
  typed inputs and outputs, risk, runtime compatibility, relationships, and
  example prompts, plus deterministic command-line filters.
- Registry v4 lifecycle and provenance metadata for every skill, including
  immutable origins, matching licenses, scheduled review, replacement
  validation, removed tombstones, and guarded external identity changes.
- Registry v5 workflow pack metadata with strict schemas, three version-pinned
  initial packs, continuous ordered handoff validation, deterministic
  normalization, compatibility and conflict validation, strict historical
  baseline checks, and semver-guarded pack lifecycle transitions.
- Transactional exact-version workflow pack install, check, uninstall, and
  selection reporting with conflict preflight, shared-skill retention,
  multi-target rollback, and recoverable target-local journals.
- Versioned composition suites for all workflow packs with exact-member routing,
  ordered-handoff and adjacent near-miss coverage, deterministic context byte
  and complete member-tree accounting, correctness-bound status, shared hardened
  adapter launch and cleanup, isolated trial homes, strict result artifacts, and
  a fixture-only public smoke with separate structural precommit and exact-commit
  provenance modes.
- Install receipt v3 with catalog and pack selections, source identity, registry
  digest, exact selected skill versions, per-file ownership hashes, safe v1/v2
  migration, and receipt-last transaction commits.
- Versioned cross-runtime smoke schemas and a bounded non-interactive runner for
  Claude Code, GitHub Copilot, and OpenAI Codex, with deterministic public
  fixture adapters, validated reports, and explicit hosted-runtime skips.

### Security

- Evaluation adapters now use an explicit environment allowlist, suppress
  process output on failure, cap output and workload sizes, isolate regular
  expressions in terminable workers, and persist only generic assertion
  evidence.
- Runtime smoke adapters use isolated homes, bounded subprocesses, an explicit
  environment allowlist, strict response evidence, and reasoned skips so
  unavailable licensed or hosted products cannot become false passes.
- Runtime smoke requests no longer expose expected evidence; reviewed adapter
  identities bind ID, kind, and entrypoint digest, fixture sources reject
  symlink escapes, unavailable hosts skip every host-dependent check, and POSIX
  process-group timeouts terminate descendants before cleanup.
- Runtime smoke adapter identities now bind the safe executable shape, complete
  normalized argument list, and environment allowlist. Timeout cleanup polls
  the process group through `ESRCH` and fails on bounded cleanup expiry or
  `EPERM` instead of removing temporary roots while descendants may remain.
- Runtime smoke launches now require an absolute native executable or the exact
  current Node executable, reject shebang/PATH and interpreter-control
  environment injection, bind actual environment values in result launch
  digests, bound stderr as well as stdout, and finalize descendants on every
  subprocess outcome.
- Runtime smoke cleanup now applies one deadline to direct-child closure and
  process-group verification, and preserves the isolated workspace with a safe
  operator-cleanup path whenever process termination cannot be confirmed.
- Evaluation and routing artifacts now reject unsafe counters and inconsistent
  metrics, bind contribution evidence to committed suite and skill hashes, and
  require local expertise sources and completed human review.
- Installer checks now detect receipt tampering, source and catalog drift,
  duplicate or escaping destinations, and modified or unmanaged files before
  mutation.
- Pack transactions now use exclusive target locks, strict receipt v3 selection
  validation, immediate pre-rename state checks, receipt-bound recovery plans,
  atomic terminal cleanup handoff, and fail-closed rollback preservation.
- Existing operation locks now always require explicit operator removal;
  transaction roots carry ownership markers, and recovery rejects recomputed
  plans that omit any required write or prior-owned removal.
- Transaction finalization now revalidates the owner token, terminal journal
  state, and journal digest before root handoff and recursive cleanup, preserving
  replacement directories and symlink swaps.
- Default-source pack uninstall now verifies existing receipt ownership against
  its immutable Git commit and requires that commit to be an ancestor of verified
  `HEAD`, fixing CLI uninstall while preserving fail-closed handling for foreign,
  orphaned, forged, or commit-inconsistent receipts.
- Crash recovery for immutable v2 receipts now uses the reconstructed historical
  full-catalog resource plan instead of comparing prior ownership to descendant
  catalog bytes.
- Default-source receipts now reject dirty tracked or untracked catalog bytes
  and registry/resource mismatches before claiming `HEAD`; custom sources use a
  non-immutable `local-unverified` identity, and foreign v1 receipts cannot
  establish ownership.
- Lifecycle comparisons now normalize repository URLs and protect first-party,
  external, kind-change, removal, and tombstone transitions. Review validation
  rejects future dates, intervals over one year, and unscheduled external or
  compatibility-sensitive skills.
- Removed tombstones cannot silently reactivate. Default receipt verification
  records the exact verified commit without a second `HEAD` lookup and uses
  NUL-delimited Git tree paths so non-ASCII names remain exact.
- Default installs cryptographically bind the buffered resource set, file
  contents, skill versions, and registry digest to the verified commit, closing
  mutate-collect-restore attribution races.

### Changed

- **Breaking:** Hardened Wayfinder recovery conformance for open-only external
  actions, explicit block history, validated blocker DAGs, and pending-action
  fences. Reclaim traces now use bounded `lease_duration_ms` instead of
  `lease_duration_seconds`. Schema-v1 traces now require one stable `map_id`,
  offset-qualified timestamps, valid claim intervals, closed-state consistency,
  and lifecycle fences for every modeled mutation.

- **Breaking:** Narrowed `shadow-architecture` 2.0.0 routing to `.shadow` setup,
  approved decision lifecycle, compatibility maintenance, supersession, and
  rendering. Observation, future-state design, and drift checks now route to
  their dedicated experimental skills.
- Removed host-specific invocation frontmatter from five canonical skills and
  patch-bumped them so the complete catalog passes the portable profile.

## [0.1.0] - 2026-07-24

### Added

- Initial portable Agent Skills catalog targeting Claude Code, GitHub Copilot,
  and OpenAI Codex, with skills under `skills/<name>/SKILL.md`:
  - `code-review`
  - `codebase-exploration`
  - `documentation-maintenance`
  - `external-skill-review`
  - `git-and-pr-workflow`
  - `planning-and-task-breakdown`
  - `refactoring-and-dead-code-removal`
  - `repository-agent-bootstrap`
  - `requirements-and-spec-writing`
  - `security-review`
  - `shadow-architecture`
  - `skill-creator`
  - `systematic-debugging`
  - `test-driven-development`
  - `verification-before-completion`
  - `web-research-and-verification`
- Frontmatter contract in `schemas/skill.schema.json` restricting `SKILL.md` to
  the portable open-standard fields plus a small documented extension set.
- Tooling: `scripts/validate-skills.mjs` (frontmatter and structure validation
  with `--profile portable|repository`, `--format text|json`, and `--changed`),
  `scripts/manage-skills.mjs` (install, check, uninstall, list), and
  `scripts/generate-registry.mjs`, with shared modules under `scripts/lib/`.
- Generated catalog registry at `registry/skills.json`.
- npm scripts: `validate`, `install:agents`, `check:agents`, `uninstall:agents`,
  `list`, and `test`.
- Tooling tests under `tests/`.
- Documentation: `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`,
  `docs/authoring-guide.md`, `docs/compatibility.md`, and the source-of-truth
  research reports under `docs/research/`.

[Unreleased]: https://github.com/Cody-Sims/agent-skills/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Cody-Sims/agent-skills/releases/tag/v0.1.0

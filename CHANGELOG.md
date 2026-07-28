# Changelog

All notable changes to this repository are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

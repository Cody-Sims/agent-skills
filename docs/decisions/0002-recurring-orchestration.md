# ADR 0002: Prefer Versioned Agentic Workflows for Recurring Orchestration

- Status: Accepted for design; deployment remains gated
- Date: 2026-07-27
- Decision owners: Repository maintainers

## Context

SI-007 requires recurring learning and approval-gated implementation without an
unreviewable or private control plane. The repository is public, governance
changes require review, and recurring execution must remain disabled until the
SI-010 pilot passes.

GitHub Agentic Workflows are in public preview. GitHub documents them as
repository Markdown under `.github/workflows/`, compiled to a committed
`.lock.yml` GitHub Actions workflow. They support Actions triggers, read-only
permissions by default, explicit safe outputs, multiple coding-agent engines,
and pull-request review of both source and compiled configuration.

Copilot automations support schedules and repository events, but GitHub
documents three incompatible constraints: they are available only in private or
internal repositories, are stored outside the repository rather than in Git,
and are private to their creator. Each run consumes Actions minutes and AI
credits billed to that creator.

## Decision

Use GitHub Agentic Workflows as the target recurring orchestration mechanism.
Keep the source Markdown and compiled lock file versioned, protected by
CODEOWNERS, and reviewed through pull requests.

Do not add a scheduled workflow yet. Deployment requires all of these gates:

1. AS-001 and AS-002 have comparable real-model baselines and approved
   thresholds.
2. SI-002 through SI-006 have completed their local contracts and hosted pilots.
3. SI-008 fault-injection and branch-protection checks pass.
4. SI-010 records at least three learning cycles and three independently
   reviewed improvement pull requests, then recommends graduation under the
   versioned graduation policy.
5. A maintainer explicitly approves the workflow source, compiled lock file,
   engine authentication, permissions, safe outputs, schedule, and budget.

The eventual design must schedule learning independently from implementation.
Implementation may run only when a single item is ready, no active lease exists,
the kill switch is off, and run and monthly budgets remain.

## Consequences

- Recurring configuration remains visible, diffable, and protected in the
  repository.
- Public repository operation remains possible.
- The technical-preview compiler and lock file become reviewed dependencies.
- Engine credentials and billing configuration remain deployment-time concerns.
- Copilot automations are not used for governance-critical orchestration while
  they remain private, off-repository, and unavailable to public repositories.
- Manual delegation remains the active operating mode until graduation.

## Alternatives

### Copilot automations

Rejected for this repository because the current public repository is
ineligible and the automation definition is neither repository-versioned nor
visible to other maintainers.

### Hand-written GitHub Actions invoking an agent CLI

Rejected as the target design because it would recreate permission, sandbox,
safe-output, and compilation controls already provided by Agentic Workflows.

### Continue manual operation permanently

Retained as the fallback and kill-switch state. It is safer than premature
recurring execution but does not satisfy SI-007 after the pilot graduates.

## Verified Sources

Retrieved 2026-07-27:

- GitHub Docs, “Creating GitHub Agentic Workflows”:
  <https://docs.github.com/en/copilot/how-tos/github-agentic-workflows/creating-github-agentic-workflows>
- GitHub Agentic Workflows, “Overview”:
  <https://github.github.com/gh-aw/introduction/overview/>
- GitHub Blog, “Automate repository tasks with GitHub Agentic Workflows”:
  <https://github.blog/ai-and-ml/automate-repository-tasks-with-github-agentic-workflows/>
- GitHub Docs, “About Copilot automations”:
  <https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations>

These sources verify current public-preview behavior. Feature availability and
authentication requirements must be rechecked immediately before deployment.

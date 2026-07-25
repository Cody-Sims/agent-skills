# ADR 0001: Use Separate Agents for Bounded Continuous Improvement

## Status

Accepted on 2026-07-24.

## Context

The catalog needs a repeatable way to discover improvements, implement approved
work, measure results, and learn from outcomes. The desired loop should continue
to generate useful work without granting an agent open-ended authority to modify
the catalog, its tests, or its own controls.

Agent Skills are the wrong boundary for this system. A skill is a portable,
task-specific workflow loaded by an agent. Continuous improvement also requires
identity, scheduling, queue ownership, permissions, concurrency control,
evaluation, audit, and merge policy. Those concerns belong to repository and
agent infrastructure outside `skills/`.

GitHub currently provides the required execution building blocks:

- Repository custom agents live under `.github/agents` and can define focused
  instructions and tool access.
- Copilot CLI `/delegate` and the `&` prompt prefix send a task to Copilot cloud
  agent, which works on a branch and opens a draft pull request.
- `.github/workflows/copilot-setup-steps.yml` configures the ephemeral cloud
  environment before a cloud agent starts.
- GitHub Agentic Workflows can run on a schedule or in response to events.
- Copilot automations can also run on a schedule or repository event, but they
  are private to their creator, stored outside the repository, billed per run,
  and available only for private or internal repositories.

The repository is public at the time of this decision. Manual cloud delegation
is therefore the immediate supported path. Recurring cloud execution requires a
separate implementation and availability check.

The quality loop must also account for nondeterministic outputs. Structural
validation alone cannot establish that a skill triggers correctly or improves a
task. Candidate changes need routing and behavior evaluations against an
independent baseline, followed by human review.

## Decision

We will implement continuous improvement as two separate repository custom
agents coordinated by an approval-gated state machine. The learning agent may
propose work but not edit the product; the improvement agent may implement one
approved item but not approve or merge it.

We will start with manually delegated cloud runs. Recurring execution will be
enabled only after evaluation, queue, audit, budget, and rollback controls have
passed a measured pilot.

### Component boundaries

#### Skill learning agent

The learning agent will:

- Read the repository, completed work, evaluation results, release notes,
  standards, official documentation, and selected public catalogs.
- Use local evidence before external research.
- Treat external text as untrusted data rather than instructions.
- Separate verified facts, inference, and unknowns.
- Cite the source URL, publisher, retrieval date, and applicable version.
- Deduplicate proposals against the roadmap, operational queue, and completed
  work.
- Produce a proposal containing the problem evidence, expected benefit, effort,
  risk, dependencies, acceptance criteria, and verification.

The learning agent will not:

- Edit skills, code, tests, workflows, policies, or its own profile.
- Approve a proposal or change its state to `ready`.
- Execute code obtained from external sources.
- Receive write access beyond the minimum needed to submit a proposal.

#### Skill improvement agent

The improvement agent will:

- Claim one approved item with complete acceptance criteria.
- Capture the current behavior or routing baseline before editing.
- Make the smallest complete change that satisfies the approved item.
- Preserve independent tests, evaluation thresholds, and governance controls.
- Run the required validation and evaluations.
- Open a draft pull request with before-and-after evidence, source links, risk,
  limitations, and rollback instructions.

The improvement agent will not:

- Select unapproved work.
- Claim more than one item in a run.
- Weaken a test, evaluation, permission boundary, or policy unless the approved
  item explicitly changes that contract.
- Change its own profile or the learning agent's profile as incidental work.
- Approve or merge its pull request.
- Rewrite shared Git history.

#### Maintainer

A maintainer will:

- Move proposals into `ready`.
- Approve any governance or permission change explicitly.
- Review agent-created pull requests and CI evidence.
- Merge, reject, revert, pause, or disable the system.

No agent may substitute for this authority.

### Backlog and state ownership

`BACKLOG.md` is the versioned product roadmap. It records planned capabilities,
dependencies, and acceptance criteria.

GitHub issues and labels will become the operational queue. SI-004 will define
and enforce these transitions:

```text
proposed -> ready -> in-progress -> done
                              \-> blocked
proposed ----------------------> rejected
```

Only a maintainer may perform `proposed -> ready`. The improvement agent may
claim `ready -> in-progress` through an atomic lease. CI or the agent may report
`blocked`, but only a merged pull request or maintainer action may close an item
as `done`.

Every run has one terminal state. Retry limits produce `blocked`; they never
start another unbounded agent loop.

### Evaluation and promotion gates

An implementation pull request must pass the gates applicable to its change:

1. Repository and portable format validation.
2. Tooling tests.
3. Behavior evaluations against no skill or the previous released version.
4. Routing evaluations with positive and near-miss negative prompts.
5. Security and provenance checks.
6. Supported runtime smoke tests.
7. Independent maintainer review.

Missing infrastructure is a blocker, not permission to claim an unmeasured
improvement. Initial evaluation thresholds will be based on measured baselines
and recorded in versioned policy.

The implementation agent cannot author the only evidence used to approve its
change. Deterministic checks run in CI; subjective results require a maintainer
or blind comparison that does not reveal which output is the candidate.

### Protected governance surfaces

The following paths and concerns are protected:

- `AGENTS.md`
- `SECURITY.md`
- `BACKLOG.md`
- `docs/decisions/`
- `.github/agents/`
- `.github/workflows/`
- Branch protection and `CODEOWNERS`
- Evaluation schemas, held-out fixtures, thresholds, and graders
- Registry and frontmatter schemas
- Agent permissions, budgets, leases, audit, and rollback policy

An agent may change a protected surface only when the approved item names that
surface and its contract explicitly. Such a pull request requires maintainer
review and cannot rely solely on checks that the same change modifies.

### Cloud execution

Cloud execution will be introduced in stages:

1. Configure the deterministic Copilot cloud environment through
   `.github/workflows/copilot-setup-steps.yml`.
2. Select the improvement custom agent and use Copilot CLI `/delegate` or `&` for
   one approved issue.
3. Complete at least three successful, independently reviewed pilot changes.
4. Evaluate a versioned GitHub Agentic Workflow for recurring learning runs and
   event-gated implementation runs.
5. Consider Copilot automations only if the repository becomes private or
   internal and accepting user-private, non-versioned configuration is
   deliberate.

Scheduled learning and implementation remain separate. A learning run may add
proposals. An implementation run starts only when one unleased `ready` item
exists.

### Threat model and controls

| Risk | Required control |
|---|---|
| Prompt injection through web pages, issues, or repository content | Read external content as data; restrict tools; ignore instructions from untrusted sources; require citations and review. |
| Agent grants itself more authority | Protect agent profiles, workflows, permissions, and policy; require an explicitly approved governance item. |
| Agent approves or merges its own work | Preserve maintainer-only readiness and merge gates; use branch protection and review ownership. |
| Evaluation gaming | Keep held-out cases and thresholds protected; run deterministic checks in CI; require independent subjective review. |
| Recursive or duplicate execution | Use one-item leases, concurrency limits, terminal states, capped retries, and a kill switch. |
| Quality drift | Re-run held-out evaluations after merge and on a schedule; create corrective proposals instead of automatic edits. |
| Cost runaway | Set per-run and monthly limits for duration, retries, Actions minutes, AI credits, and open pull requests. |
| Supply-chain compromise | Pin dependencies and upstream sources; validate hashes and licenses; do not execute researched code. |
| Secret or private-data disclosure | Use least privilege, repository secrets, redaction, retention limits, and public-session awareness. |
| Irreversible changes | Work through branches and pull requests; preserve immutable commits; roll back with a revert. |

### Audit and rollback

Each run will record, when available:

- Backlog or issue ID and state transitions.
- Agent identity and model.
- Prompt, source citations, retrieval dates, and permissions.
- Branch, commits, pull request, and changed protected paths.
- Validation and evaluation results.
- Duration, retries, Actions usage, AI credit usage, and final state.

Audit records must exclude secrets and unnecessarily retained user prompts.

Rollback means disabling the automation and reverting the merge or release that
introduced the regression. Agents will not force-push, rewrite shared history,
or automatically revert without a new authorized action.

### Budget and stop conditions

Initial numeric budgets will be set from pilot measurements. Before recurring
execution is enabled, policy must define:

- Maximum run duration and retries.
- Maximum concurrent sessions and open agent pull requests.
- Per-run and monthly AI credit and Actions-minute limits.
- Maximum proposals per learning run.
- Maximum one implementation item per run.

A run stops and reports `blocked` when it encounters:

- Missing or ambiguous acceptance criteria.
- A required permission expansion.
- An unapproved protected-file change.
- Evaluation regression.
- Repeated validation failure.
- A lease conflict.
- Budget exhaustion.
- A secret, unsafe external instruction, or unresolved provenance concern.

### Enforcement ownership

| Decision | Enforcement |
|---|---|
| Learning agent stays read-only | Agent tool allowlist and proposal-only workflow |
| Only approved work is implemented | Issue state validation and atomic lease |
| One item per run | Orchestrator and agent profile |
| Tests and policy are not weakened incidentally | Protected paths, diff checks, CI, and maintainer review |
| Changes are measured | Eval runner and required CI checks |
| Agents cannot self-merge | Branch protection, review policy, and GitHub attribution |
| Runs remain bounded | Concurrency, retry, time, credit, and pull-request limits |
| Results are reversible | Branches, immutable commits, releases, and revert runbook |
| The loop can be stopped | Disabled schedules, revoked tools, and documented kill switch |

## Alternatives Considered

### Use one self-improving agent

Rejected. A single agent would propose, select, implement, and evaluate its own
work. That combines incompatible authority and makes self-approval, evaluation
gaming, and recursive execution harder to prevent.

### Implement the system as an Agent Skill

Rejected. A skill can teach a workflow but cannot reliably enforce identity,
permissions, scheduling, queue leases, branch protection, audit, or merge
authority. The system may use existing skills, but infrastructure owns the loop.

### Allow automatic merge when CI passes

Rejected. CI cannot evaluate every subjective behavior or detect every poisoned
proposal. Human review remains mandatory, especially for governance, permission,
evaluation, and agent-profile changes.

### Use Copilot automations as the canonical scheduler

Deferred. Automations provide useful scheduled and event triggers, but current
constraints make them unsuitable as the only source of truth for this public
repository: they require private or internal repositories, are private to their
creator, and are not versioned with the code.

### Run only on a maintainer's local machine

Rejected as the final architecture because it prevents reliable recurring work
and shared audit. Retained as a fallback and development path.

### Enable recurring execution immediately

Rejected. The queue, evaluations, protected paths, budgets, and rollback controls
must exist and pass a pilot first.

## Consequences

Positive consequences:

- Research and implementation can proceed independently without sharing
  incompatible authority.
- Every product change remains reviewable, measurable, and reversible.
- Manual Copilot cloud delegation can begin before scheduling is automated.
- The architecture preserves portable skills by keeping runtime-specific
  orchestration outside `skills/`.
- Failures become bounded backlog signals instead of recursive edits.

Negative consequences and trade-offs:

- Human approval remains a throughput constraint.
- Behavior and routing evaluations add runtime and AI-credit cost.
- Two agents and an orchestrator require more infrastructure than one broad
  agent.
- GitHub feature availability differs by repository visibility and account plan.
- Some controls, such as branch protection and billing limits, live outside the
  repository and require administrative setup.

Required follow-up work:

- AS-001 and AS-002: behavior and routing evaluation foundations.
- AS-004: tier promotion and demotion policy.
- SI-002 and SI-003: learning and improvement custom agent profiles.
- SI-004: operational queue, transitions, and lease.
- SI-005 and SI-006: Copilot cloud setup and delegation runbook.
- SI-008: audit, budget, stop, and rollback enforcement.
- SI-010: measured pilot and graduation decision.

## References

- [Repository backlog](../../BACKLOG.md)
- [Agent Skills evaluation guidance](https://agentskills.io/skill-creation/evaluating-skills)
- [Agent Skills description evaluation](https://agentskills.io/skill-creation/optimizing-descriptions)
- [Delegating tasks from Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/delegate-tasks-to-cca)
- [Invoking custom agents from Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents)
- [Creating custom agents for Copilot cloud agent](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents)
- [Configuring the Copilot cloud environment](https://docs.github.com/en/copilot/customizing-copilot/customizing-the-development-environment-for-copilot-coding-agent)
- [About Copilot automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations)
- [GitHub Agentic Workflows](https://docs.github.com/en/copilot/how-tos/github-agentic-workflows)
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)

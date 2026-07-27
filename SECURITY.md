# Security Policy

Agent Skills are privileged instructions and executable code. When a skill
activates, its `SKILL.md` body is injected into the agent's context, its
bundled scripts can run with the agent's permissions, and its references can be
read into context on demand. Treat every skill, especially a third-party one, as
code you are about to run.

## Threat model

- **Prompt injection through skill content.** A skill body or reference can
  contain instructions that redirect the agent, exfiltrate data, or escalate
  scope. Hidden or bidirectional Unicode can conceal such instructions from a
  human reviewer.
- **Malicious scripts.** Files under `scripts/` can execute arbitrary commands,
  reach the network, read credentials, or make destructive changes. A skill that
  instructs the agent to run a script is asking to run that code.
- **Supply-chain risk in installed skills.** A skill installed from another
  repository can change upstream. Without an immutable pin, an update can
  silently introduce malicious content.
- **Credential and secret access.** Skills run in an environment that may hold
  tokens, keys, and cloud credentials. A skill that reads environment variables,
  config files, or credential stores can leak them.
- **Unsafe `allowed-tools` pre-approval.** `allowed-tools` can pre-approve tools
  such as shell or bash, removing a confirmation step. GitHub warns that
  pre-approving shell lets a malicious skill or prompt injection execute
  arbitrary commands. Pre-approval is not a portable or reliable security
  boundary. Source: `docs/research/anthropic-spec.md` (section 1),
  `docs/research/copilot-skills.md` (section 7).
- **Improvement-agent authority escalation.** A delegated agent could select
  unapproved work, alter governance controls, claim multiple items, or attempt
  to approve and merge its own output.
- **Untrusted queue and research content.** Issues, comments, pull requests, and
  external sources can contain prompt injection, malicious commands, secrets,
  or false provenance.
- **Duplicate and unbounded execution.** Concurrent claims, recursive retries,
  stale leases, or missing cost limits can create conflicting changes and
  uncontrolled consumption.

## Repository policies

This repository reduces the surface above with the following rules, enforced by
review and by the validator:

- **No `allowed-tools`.** Canonical skills do not pre-approve tools. The agent's
  runtime prompts for permission as usual.
- **No network calls in tooling.** The scripts under `scripts/` operate on the
  local filesystem only.
- **No secrets.** No credentials, tokens, or private keys in any skill, script,
  reference, asset, or test. Secret scanning and push protection should be
  enabled on the repository.
- **No unsafe Unicode.** Bidirectional and zero-width control characters, and
  other unexpected control codes, are rejected by the validator.
- **Review before install.** Third-party skills must pass the
  `external-skill-review` workflow before inclusion.
- **Immutable pinning.** Installed third-party skills are pinned to an immutable
  commit or tag with recorded provenance, never a moving branch.
- **Lifecycle validation.** Every catalog skill has a maintainer-authored
  lifecycle record. External origins use an HTTPS GitHub repository and a full
  commit SHA, expired reviews fail, and upstream identity changes require both a
  version increase and a new review.
- **Strict install receipts.** Receipt v2 binds an install to its repository,
  commit, registry digest, skill versions, destinations, and file hashes.
  Escaping or duplicate paths are rejected before mutation; updates and
  rollbacks replace only unchanged receipt-owned files.
- **Honest checkout identity.** Default-source install and check operations
  reject tracked, untracked, or ignored catalog changes and verify registry entries
  against copied resources before attributing bytes to `HEAD`. Custom source
  trees are labeled `local-unverified`, and foreign v1 receipts cannot establish
  file ownership.
- **Separated agent authority.** The learning agent has read, search, and web
  tools only. The improvement agent cannot approve, merge, or select work.
- **Approval-bound leases.** Queue transitions serialize through a workflow.
  Claims bind one run and one lease to the SHA-256 digest of the approved issue
  body.
- **Protected governance paths.** CI compares changed files with approved paths
  and requires explicit approval for agents, workflows, schemas, policy,
  evaluation, and decision surfaces.
- **Bounded runs.** Versioned limits cover duration, retries, Actions usage, AI
  credits, open pull requests, concurrency, and lease lifetime.
- **Pinned workflow dependencies.** GitHub Actions use full commit SHAs. Version
  comments remain for reviewed dependency updates.
- **Isolated evaluation adapters.** Model adapters run without a shell, inherit
  only an explicit environment allowlist, suppress stdout and stderr on failure,
  and execute suite regular expressions in terminable workers. Adapters remain
  trusted code with filesystem and network access.
- **Bound evaluation evidence.** Contribution artifacts are checked against the
  exact committed suite and candidate skill hashes, recomputed metrics, local
  expertise sources, and completed human review. Branch protection and Code
  Owner review remain responsible for run and reviewer authenticity.
- **Independent completion.** Agent pull requests open as drafts. Only a merged,
  policy-checked pull request records an item as done.

Source: `docs/research/repo-tooling.md` (sections 3–4),
`docs/research/community-skills.md`.

## Reporting a vulnerability

Report suspected vulnerabilities, malicious skills, or leaked secrets privately
through GitHub Security Advisories on this repository
(<https://github.com/Cody-Sims/agent-skills/security/advisories>). Do not open a
public issue for a security report. Include the affected skill or file, the
observed behavior, and steps to reproduce. Do not include working exploit
payloads or real credentials.

## What a consumer should verify before installing

Before installing any skill from this or any repository:

1. Read the full `SKILL.md`, including every referenced file, not just the
   description.
2. Read every file under `scripts/` and understand what each command does.
3. Confirm there are no `allowed-tools` pre-approvals, especially for shell or
   bash.
4. Check for network calls, credential or environment-variable access, and
   destructive commands.
5. Confirm no hidden or bidirectional Unicode and no embedded secrets.
6. Pin the install to an immutable tag or commit and record its provenance:

   ```bash
   gh skill install Cody-Sims/agent-skills <name> --pin <tag-or-commit>
   ```

7. When installing an external skill, run the `external-skill-review` workflow
   first and do not let the review step execute the skill's scripts.
8. Run `npm run check:agents` after installation and treat identity, catalog,
   receipt, missing-file, or modified-file drift as a failed verification.

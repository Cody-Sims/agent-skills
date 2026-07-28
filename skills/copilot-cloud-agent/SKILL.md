---
name: copilot-cloud-agent
description: "Launches and monitors GitHub Copilot cloud-agent tasks through supported GitHub APIs, selecting explicit models, recording task and pull-request IDs, and distinguishing hosted controls from local CLI flags. Use when starting cloud agents, running hosted loops, assigning issues to Copilot, choosing GPT-5.6 Sol, or checking cloud-agent status; do not use for local subagents or git worktree fleets."
license: MIT
metadata:
  version: "1.0.0"
  author: "Cody-Sims"
  tier: experimental
---

# Copilot Cloud Agent

## Goal

Start or inspect a genuine GitHub-hosted Copilot cloud-agent task, preserve the
requested model choice, and return durable task and pull-request identifiers.
Never describe a local CLI subagent, background process, or worktree worker as a
cloud agent.

## Inputs

1. Identify the target `owner/repository`, base ref, and bounded task prompt.
2. Record whether the task should create a pull request or continue an existing
   head ref.
3. Record any requested model. If no model is requested, state that omission uses
   GitHub's Auto selection.
4. Identify organization policy, subscription, or repository restrictions that
   could prevent cloud-agent or model access.

## Workflow

1. Confirm the user requested GitHub-hosted execution. For local subagents or
   worktree fleets, do not use this workflow.
2. Inspect active tasks and open pull requests before launching. Reuse or wait for
   matching work instead of creating a duplicate session.
3. Check the current GitHub cloud-agent model documentation before relying on a
   model identifier. Model availability depends on plan and organization policy
   and can change.
4. When GPT-5.6 Sol is requested and currently available, send
   `model: "gpt-5.6-sol"` explicitly. Do not omit the model and claim that Auto
   selected Sol.
5. Start the task with the supported GitHub agent-task API:
   `POST /agents/repos/{owner}/{repo}/tasks`. Supply `prompt`, and only the
   applicable `base_ref`, `head_ref`, `model`, `custom_agent`, and
   `create_pull_request` fields.
6. Use issue assignment APIs only when the requested workflow is issue-based.
   Include the documented agent-assignment `model` field rather than relying on
   an assignment helper that cannot express model selection.
7. Treat validation errors as failures. If a requested model is unavailable,
   report the API response; never silently retry with Auto or another model.
8. Read the created task back from the API. Verify its state, task ID, session
   model, base ref, head ref, and any branch or pull-request artifact.
9. Monitor with bounded status checks. Distinguish `queued`, `in_progress`,
   `idle`, `waiting_for_user`, `completed`, `failed`, `timed_out`, and
   `cancelled`; do not call an active task complete.
10. Review and validate the resulting pull request separately before merge. A
    completed cloud session is not proof that its code or checks are correct.

## Model and Context Controls

- The cloud API's documented control is `model`. GPT-5.6 Sol is intended for
  complex reasoning over large codebases and long-running agentic work.
- The cloud API does not currently document `effort`, `reasoning_effort`,
  `context`, `context_window`, or a token-window field. Do not promise "high
  reasoning" or a forced 1M context allocation for a hosted task.
- Local Copilot CLI flags such as `--effort` and `--context` are local runtime
  controls. Never imply that they are forwarded to GitHub cloud-agent tasks.
- A model's capability description is not a configuration guarantee. Selecting
  Sol does not establish a particular reasoning-effort level or context size.

## Validation

1. Confirm the launch response contains a task ID and repository-scoped URL.
2. Fetch the task and verify the recorded session model matches the explicit
   request. Cloud responses may prefix the model with an internal provider name;
   preserve the exact returned value in the report.
3. If pull-request creation was requested, verify the task artifact or resulting
   pull request exists before reporting it.
4. Confirm no duplicate task was launched and no unsupported control was presented
   as active.

## Output

Report the host, repository, task ID and URL, state, requested and observed model,
base/head refs, pull-request URL when present, and any unavailable control or
policy restriction. Clearly label whether work is queued, active, blocked, failed,
or completed.

## References

1. Read [GitHub cloud-agent API and model controls](references/github-cloud-agent-controls.md)
   before launching a task or making a claim about model, reasoning, or context
   configuration.

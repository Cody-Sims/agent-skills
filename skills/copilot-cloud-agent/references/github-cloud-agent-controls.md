# GitHub Cloud-Agent API and Model Controls

Verified against GitHub documentation on 2026-07-27. These APIs are in public
preview and their model allowlists can change, so re-check the linked sources
before each launch.

## Hosted task endpoint

GitHub documents:

```text
POST /agents/repos/{owner}/{repo}/tasks
```

The request accepts `prompt`, `model`, `custom_agent`,
`create_pull_request`, `base_ref`, and `head_ref`. Omitting `model` uses Auto
selection. The task response and subsequent task read expose the task state and
session model.

Use a current user-to-server token through the authenticated GitHub client. Do not
print, persist, or place tokens in prompts, task bodies, branches, or logs.

Sources:

- [REST API endpoints for agent tasks](https://docs.github.com/en/rest/agent-tasks/agent-tasks)
- [Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)

## GPT-5.6 Sol

GitHub's cloud-agent model picker lists GPT-5.6 Sol. GitHub's model comparison
describes it as suited to "complex reasoning over large codebases and long-running
agentic work." The API identifier used for explicit selection is:

```json
{ "model": "gpt-5.6-sol" }
```

Availability still depends on the user's plan and organization model policy.
Treat an API `422` or policy denial as a failed explicit selection; do not
silently fall back.

Sources:

- [Changing the AI model for Copilot cloud agent](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/changing-the-ai-model)
- [Supported AI models in GitHub Copilot](https://docs.github.com/en/copilot/reference/ai-models/supported-models)
- [AI model comparison](https://docs.github.com/en/copilot/reference/ai-models/model-comparison)

## Unsupported launch controls

The documented hosted task and issue-assignment request shapes have a `model`
field but no reasoning-effort or context-window field. As of the verification
date, the cloud API does not provide a supported way to request:

- `high` reasoning effort;
- `long_context`;
- a 1M-token context window; or
- any exact context allocation.

Copilot CLI may expose local flags with similar names. Those flags apply to the
local CLI runtime and are not evidence of cloud API support.

State this as an API limitation, not as a claim about the model's undisclosed
internal limits.

## Operational limits

GitHub documents a maximum cloud-agent session length of 59 minutes. A timed-out
session requires triage; it is not a successful completion.

Source:

- [About GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)

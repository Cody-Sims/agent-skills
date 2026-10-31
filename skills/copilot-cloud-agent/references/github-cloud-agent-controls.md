# GitHub Cloud-Agent API and Model Controls

Snapshot verified against GitHub documentation on 2026-07-27, not a live guarantee.
The APIs were in public preview; request shapes, limits, and model allowlists can
change. Before launch, recheck the applicable API and requested-model sources;
for known-task status alone, do not fetch unrelated model-comparison pages.

## Hosted task endpoint

GitHub documents:

```text
POST /agents/repos/{owner}/{repo}/tasks
```

The documented snapshot accepts `prompt`, `model`, `custom_agent`,
`create_pull_request`, `base_ref`, and `head_ref`. Omitted `model` means Auto.
Record the task ID/URL and read the task back for state, model, refs, and artifacts.

Use a current user-to-server token through an authenticated client such as `gh api`.
Never print/persist credentials in prompts, bodies, branches, or logs. After an
uncertain POST response, inspect matching tasks before retrying.

Sources:

- [REST API endpoints for agent tasks](https://docs.github.com/en/rest/agent-tasks/agent-tasks)
- [Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)

## GPT-5.6 Sol

The verified model-picker snapshot lists GPT-5.6 Sol, described as suited to
"complex reasoning over large codebases and long-running agentic work." Verify
current availability before using the explicit identifier:

```json
{ "model": "gpt-5.6-sol" }
```

Availability depends on plan/organization policy. Surface `422`/policy denial as
failed explicit selection; never silently fall back. Preserve the exact observed
session model, including provider prefixes, rather than claiming Auto selected Sol.

Sources:

- [Changing the AI model for Copilot cloud agent](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/changing-the-ai-model)
- [Supported AI models in GitHub Copilot](https://docs.github.com/en/copilot/reference/ai-models/supported-models)
- [AI model comparison](https://docs.github.com/en/copilot/reference/ai-models/model-comparison)

## Unsupported launch controls

As of the verification date, hosted task/assignment shapes document `model`, not
reasoning-effort or context-window fields. They provide no supported request for:

- `high` reasoning effort;
- `long_context`;
- a 1M-token context window; or
- any exact context allocation.

Installed CLI help establishes local flags only, not cloud API support. State the
dated API limitation, not undisclosed model limits; selecting a model guarantees
neither effort nor exact context allocation. Recheck this section's API sources
only when answering control questions or forming a launch request.

## Operational limits

The snapshot documents a 59-minute maximum session; recheck when planning session
duration. Do not poll for that entire limit by default: use a stated read/time
budget with backoff and rate-limit handling. A timed-out session needs triage,
not a success report. Unknown states/fields remain unknown until verified.

Source:

- [About GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)

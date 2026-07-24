# Description Patterns

The description is the only text the model reads before deciding whether to
activate a skill. It must route reliably on its own. Optimize it for discovery,
not for summarizing the body.

## Rules

1. Write in third person. Start with a verb such as Creates, Reviews, or
   Decomposes. Do not write in first or second person.
2. Name the actual operations and the output the skill produces.
3. State when to use it with an explicit clause, usually starting with Use when.
4. Front-load the primary use case. Some runtimes truncate the catalog listing,
   so the first words matter most.
5. Include concrete trigger vocabulary: likely user phrases, artifact names, file
   types, and workflow terms.
6. Include relevant neighboring intents. Skills tend to under-trigger, so a
   slightly assertive description that names related contexts routes better.
7. Define boundaries when a neighboring skill is similar, so the two do not share
   trigger vocabulary and collide.
8. Keep every activation signal in the description. A when-to-use section in the
   body cannot help, because the body is not loaded until after selection.
9. Stay within 1 to 1024 characters and use no angle-bracket characters.

## Good examples

```yaml
description: "Decomposes an approved specification into small, ordered, dependency-aware tasks, each with acceptance criteria and a verification command, and flags which tasks are safely parallelizable. Use when planning multi-step work, sequencing tasks, or coordinating parallel agents after requirements are agreed."
```

Why it works: third person, names the operation and output, front-loads the
planning use case, includes trigger words such as tasks, sequencing, and parallel
agents, and states when to activate.

```yaml
description: "Reviews failing continuous integration workflows by inspecting runs, summarizing job-log failures, reproducing errors, and verifying fixes. Use when checks fail, a pull request has failing jobs, or the user asks to debug workflow configuration or build logs."
```

Why it works: identifies the target and artifacts, uses realistic phrases the
user would type, and describes the workflow enough to route without listing
implementation detail.

## Bad examples

```yaml
description: Helps with documents.
```

Why it fails: too broad, names no operations, file types, or activation
conditions, and collides with every document-related skill.

```yaml
description: I can help you process spreadsheets.
```

Why it fails: first person, the word process is vague, it names no operations,
and it gives no when-to-use context.

```yaml
description: Uses a runner, a parser, and several helper scripts to perform the workflow.
```

Why it fails: describes implementation instead of user intent, names no task,
trigger, or output, and will not activate when the user asks for the result
without naming the tools.

## Fixing routing problems

- Triggers too often: remove trigger words shared with a neighboring skill and
  add an explicit boundary sentence.
- Triggers too rarely: add the missing user vocabulary and one or two neighboring
  intents, without expanding the skill's real scope.

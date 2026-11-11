# Required Skill Loading Contract

Read when repository guidance names a required skill or a worker needs that
guidance. A source directory is not automatically a native skill registration.

1. List only the skills required for the scoped task. For each, record the
   required name, the host's advertised native name (or unavailable), and the
   authorized repository `SKILL.md` path (or absent).
2. Inspect the current host's exposed skill inventory/loading interface once.
   Do not guess names or invoke a known-unavailable skill. After one unavailable
   result, record it; no repeated calls or broader discovery loop.
3. If native loading is supported, use its exact advertised name. Otherwise,
   verify that governing instructions and host policy permit direct source
   reading, then read the authorized repository `SKILL.md`. Resolve referenced
   resources relative to that skill directory, only as its workflow requires.
   Do not bypass an access denial, a native-only requirement, or missing tools
   by treating source reading as equivalent execution capability.
4. Verify the selected route is available in the worker's actual checkout and
   runtime: repository-relative source path, matching skill identity, readable
   instructions/resources, and needed tools. Coordinator availability alone is
   not worker evidence. Put the exact route and verification status in the
   handoff; the worker confirms it before dependent work, not by guessing another
   native name.
5. If neither route is supported, mark dependent work blocked and report the
   missing capability. Do not install globally, expand permissions, search
   personal directories, copy runtime installations, or silently waive the
   requirement. Continue only independent work already authorized.

Keep the contract in the task handoff, not global configuration. Record the
required name, selected native name or source path, context checked, and outcome;
do not claim a route verified when only its intended location is known.

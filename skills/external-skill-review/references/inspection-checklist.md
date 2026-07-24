# Inspection Checklist

Concrete indicators for Step 3 of the review. This is lookup material; read it
while inspecting a skill's content. Never execute any file to evaluate these.
Presence of an indicator is not automatically a failure, but each one requires an
explanation that matches the skill's stated purpose before it can pass.

## Hidden Unicode and text tricks

* Bidirectional overrides and embeddings that can reorder displayed source.
* Zero-width spaces, joiners, and non-joiners inside identifiers or commands.
* Homoglyph or confusable characters standing in for ASCII in commands or URLs.
* Non-printing control characters, unusual whitespace, and invisible separators.
* Instructions split across comments, alt text, or metadata to evade a skim.

## Network behavior

* `curl`, `wget`, `Invoke-WebRequest`, raw sockets, or language HTTP clients.
* Downloaders that fetch and then run remote code or install remote packages.
* Remote includes, dynamic imports, or code retrieved at runtime.
* Telemetry, analytics beacons, or usage reporting to external endpoints.
* Hardcoded IP addresses, shortened URLs, or non-obvious domains.
* Every external endpoint the skill would contact, and why.

## Secret and local-data access

* Reads of environment variables, especially `*_TOKEN`, `*_KEY`, or `*_SECRET`.
* Access to home directories, dotfiles, keychains, or OS credential stores.
* SSH keys, known-hosts, GPG material, or agent sockets.
* Cloud configuration and credentials such as AWS, GCP, Azure, or kube configs.
* Browser profiles, cookies, saved passwords, or session storage.
* Any path that reads a credential and also has network behavior.

## Destructive or privileged commands

* Recursive deletion, force removal, or wildcard deletes.
* Permission or ownership changes, and privilege escalation.
* Edits to shell startup files, cron, launch agents, or other persistence.
* Process control, signal sending, or attempts to disable protections.
* Arbitrary command construction through `eval`, dynamic strings, or templating.
* Package-manager, build, or test invocations presented as required setup.

## Tool permissions and injection

* Requested tools, tool allowlists, wildcards, and auto-approval guidance that
  exceed the skill's stated task; require least privilege.
* Requests to ignore higher-level policy or system guidance.
* Requests to conceal actions, suppress output, or avoid logging.
* Instructions that treat their own text as commands the agent must obey.
* Directions to exfiltrate local data, install dependencies, or contact a server.

# Foundations and Evidence

Retrieved 2026-08-23. Treat measurements below as source-specific examples, not
universal constants.

## Verified

### MCP is a protocol boundary, not an agent orchestration strategy

The MCP architecture documentation for protocol version `2026-07-28` defines a
client-server protocol with dynamic discovery and three server primitives:
tools, resources, and prompts. It states that MCP focuses on context exchange
and does not dictate how an AI application manages model context.

The same release made the core protocol stateless, retired hidden
protocol-session affinity, and recommends explicit handles when application
state must cross calls. Its Tasks extension supplies durable handles for
long-running requests. A server may still maintain application state, but the
protocol no longer makes hidden session state the model-facing contract.

Sources:

- [MCP architecture](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture)
- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)

### Direct tool exposure can consume context twice

Anthropic identifies two costs in common MCP clients: loading tool definitions
up front and sending intermediate tool results through the model. Its worked
Google Drive-to-Salesforce example reports a reduction from 150,000 to 2,000
tokens when tool definitions are discovered on demand and intermediate data is
processed in code. This is a vendor example, not a general benchmark.

Source:
[Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)

### Code-over-MCP preserves MCP while changing the model-facing interface

Cloudflare's Code Mode converts MCP tools into a TypeScript API and exposes one
sandboxed code-execution tool. The sandbox has no direct Internet access; its
external capability is limited to the supplied RPC bindings. This preserves
MCP's uniform connectivity and authorization while moving composition into
code.

Source: [Code Mode](https://blog.cloudflare.com/code-mode/)

### Small CLI surfaces can exploit existing model knowledge and shell composition

Mario Zechner describes a browser workflow implemented as a small set of local
commands with a short, on-demand README. The claimed 225-token README and
13.7k/18.0k tool-definition comparisons are measurements from that setup and
must not be generalized without reproduction. His earlier terminal benchmark
also reports that either MCP or CLI can work well when their interfaces are
designed carefully.

Sources:

- [What if you do not need MCP at all?](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)
- [MCP vs CLI: Benchmarking Tools for Coding Agents](https://mariozechner.at/posts/2025-08-15-mcp-vs-cli/)

### Hybrid designs address state and unfamiliar-interface weaknesses

Armin Ronacher documents CLI failure modes involving platform variance,
unfamiliar syntax, quoting, and stateful sessions. His `pexpect-mcp` experiment
uses one stateful Python execution tool rather than exposing each library method
as a separate tool.

Source:
[Your MCP Does Not Need 30 Tools: It Needs Code](https://lucumr.pocoo.org/2025/8/18/code-mcps/)

### Both remote protocols and code execution need explicit security boundaries

The MCP security guidance covers per-client consent, token audience validation,
token-passthrough prohibitions, and SSRF defenses. Anthropic separately notes
that agent-generated code requires sandboxing, resource limits, and monitoring.

Sources:

- [MCP security best practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)
- [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)

## Inferred design principles

1. Tool count is a weak proxy. Startup schema bytes, intermediate-result bytes,
   model-visible round trips, and task success are better decision inputs.
2. The strongest pattern is progressive disclosure plus local composition:
   reveal only the relevant interface, perform mechanical transformations
   outside the model, and return only decision-relevant results.
3. CLI and MCP solve different layers. A CLI is often an efficient local
   model-facing interface; MCP can remain the remote trust, discovery, and
   interoperability boundary behind it.
4. The common composability failure is a client pattern, not a protocol
   impossibility. Code-over-MCP can preserve MCP while avoiding model-visible
   intermediate results.
5. A one-tool code runner is not automatically safe or efficient. Its value
   depends on sandboxing, a narrow capability surface, concise output, and
   representative evaluation.
6. Saved agent-authored code becomes reusable infrastructure only after review,
   tests, ownership, versioning, and a stable interface contract.

## Unknown until measured locally

- Which candidate has the highest success rate for the target model and tasks.
- Whether schema tokens materially affect the target host, because clients may
  cache, defer, search, or summarize tool definitions differently.
- Whether a CLI's quoting and session-management costs outweigh direct tool
  calls.
- Whether code execution reduces total latency after sandbox startup and policy
  checks.
- Whether the target organization permits local credentials, remote MCP, or
  generated-code execution.

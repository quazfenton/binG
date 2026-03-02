
## Agentic UI Streaming Extension (Inner Monologue + Tool Lifecycles)

### Objective
Provide continuous, trust-building UX by streaming:
- reasoning traces (`reasoning` events)
- tool lifecycle updates (`tool_invocation` events for `partial-call`, `call`, `result`)
- final assistant content (`token` + `done`)

### Streaming Contract (SSE)
Backend event types now include:
- `init`
- `token`
- `tool_invocation`
- `reasoning`
- `filesystem`
- `done`
- `error`

### Message Metadata Contract (Frontend)
Assistant messages maintain:
- `metadata.reasoning: string`
- `metadata.toolInvocations: Array<{ toolCallId, toolName, state, args, result }>`

This allows real-time rendering of:
- “Writing code…” (`partial-call`)
- “Executing in sandbox…” (`call`)
- success/error output card (`result`)

### Parser Layer Integration
Advanced parser dispatcher added at:
- `lib/tool-integration/parsers/dispatcher.ts`

Parsers:
- Native parser (structured metadata)
- Grammar parser (JSON extraction)
- XML parser (`<call><tool_name>..`)
- Self-healing validator (schema validation + shallow argument coercion)

Control flags:
- `TOOL_CALLING_MODE=auto|native|grammar|xml`
- `TOOL_CALLING_ALLOW_CONTENT_PARSING=false` (secure default)

### Security Posture
- Native metadata parsing remains primary and safest path.
- Content-based parsing is gated by env flag and disabled by default.
- Tool arguments are validated and healed through schema-aware validator before execution.

### Next Enhancement Path
1. Add human-in-the-loop state (`awaiting-approval`) before executing destructive tool calls.
2. Stream per-step timestamps and latency metrics for each tool invocation.
3. Add sandbox stdout/stderr chunk events for long-running code execution.
4. Add optional Vercel AI SDK-compatible message-part adapter endpoint for future migration.

## Provider Adapter Hardening (Arcade / Nango / Composio / MCP / Tambo)

### Composio Alignment Updates
- Prefer session-first flow (`composio.create(userId, config)`) where available.
- Keep low-level fallback for direct execution (`tools.execute`) to avoid regressions.
- Use `arguments` payload key for tool execution (not `toolParams`).
- Surface session MCP metadata (`mcp.url`, `mcp.headers`) in output for optional downstream MCP reuse.
- Added configurable session scope:
  - `COMPOSIO_DEFAULT_TOOLKITS` (comma-separated)
  - `COMPOSIO_MANAGE_CONNECTIONS` (boolean)

### Why This Matters
- Matches current Composio recommendations for session-centric integrations.
- Preserves backward compatibility with existing low-level tool-call paths.
- Improves modularity for future “tool discovery + MCP bridge” expansion.

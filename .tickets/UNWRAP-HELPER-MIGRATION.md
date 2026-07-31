# UNWRAP-HELPER-MIGRATION — TODO Tracking Ticket

**Ticket type:** Forward-looking refactor (code-reviewer SHOULD-CONSIDER a, 2026-07-16)
**Status:** ✅ CLOSED (2026-07-23)

**Closure evidence:**
- [x] **a.1** Added `// TODO: migrate to unwrapStructuredToolError when V2-path surfaces tool errors to LLM` comment near `route.ts` V2-path `onToolExecution` handler (reference: `@/lib/mcp/orchestrator-error-unwrap`, ticket ref in comment)
- [x] **a.2** `chat-helpers.ts` already had the module-level JSDoc referencing this ticket from a prior session — no change needed
- [x] **a.3** No code changes — comments only; future V2-path/chat-helpers.ts extensions should replace inline format blocks with `unwrapStructuredToolError(result.error)`
- [x] `tsc --noEmit` — 0 errors on `route.ts`
- [x] Code review signed off
**Opened:** 2026-07-16
**Helper:** `/opt/bing/web/lib/mcp/orchestrator-error-unwrap.ts` → `unwrapStructuredToolError`

## Summary

The `unwrapStructuredToolError` helper (extracted in a prior turn) is currently used at **one site only**: `route.ts:L1999` (the active `/api/chat` route's `config.executeTool` closure). The helper formats VFS/MCP structured errors (`{ message, code?, retryable?, correctedExample? }`) into the canonical `[ORCHESTRATOR-UNWRAP]: <message>\n[error.code=<code>] [retryable=<bool>]\n→ <correctedExample>` LLM-facing block.

Future tool-result surfacing in V2-path code + chat-helpers.ts should reuse this helper rather than copy-pasting the format block. This ticket tracks those migration sites.

## Migration Sites (Forward-Looking)

### 1. V2-path tool-result handling (`route.ts:L2100-L2400`)

The V2 gateway / `executeV2Task` paths use `config.onToolExecution` handler + `toolCallTracker.recordToolCall` for telemetry (records `result.error` but does NOT surface the structured error to the LLM). When the V2 path is extended to surface tool errors to the LLM (currently it only logs them), it should call `unwrapStructuredToolError(result.error)` and prepend the result to the LLM-facing message.

**Action:** Add `// TODO: migrate to unwrapStructuredToolError when V2-path surfaces tool errors to LLM` comment near the V2-path tool-result handler.

### 2. `chat-helpers.ts` tool-result surfacing

`/opt/bing/web/app/api/chat/chat-helpers.ts` does NOT currently have inline structured-error handling, but future tool-result helpers (e.g., `applySearchReplace`, `pollWithBackoff`) may need to surface structured errors. When they do, they should import + call `unwrapStructuredToolError` rather than building the format block inline.

**Action:** Add a module-level JSDoc comment in `chat-helpers.ts` referencing this ticket + the helper import path.

## Acceptance Criteria

- [ ] **a.1** Add `// TODO: migrate to unwrapStructuredToolError when V2-path surfaces tool errors to LLM` comment near `route.ts:L2100-L2400` tool-result handler.
- [ ] **a.2** Add module-level JSDoc comment in `chat-helpers.ts` referencing this ticket + the helper import path.
- [ ] **a.3** When V2-path or chat-helpers.ts are extended to surface structured errors to the LLM, replace inline format blocks with `unwrapStructuredToolError(result.error)` calls.
- [ ] Verify with tsc + vitest on `orchestrator-unwrap.test.ts` (target: no regressions).

## Files Referenced

- `/opt/bing/web/lib/mcp/orchestrator-error-unwrap.ts` — the helper
- `/opt/bing/web/lib/mcp/architecture-integration.ts` — `isStructuredMcpError` type guard
- `/opt/bing/web/app/api/chat/route.ts` — L1999 (current call site) + L2100-L2400 (future V2-path migration)
- `/opt/bing/web/app/api/chat/chat-helpers.ts` — future migration site
- `/opt/bing/web/__tests__/api/chat/orchestrator-unwrap.test.ts` — helper unit tests

## Closure Narrative

_To be filled when ticket is closed._

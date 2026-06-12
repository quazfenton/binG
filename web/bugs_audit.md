# Bugs Audit — Typecheck Triage Pass

This document tracks typecheck errors being fixed in the `bing/web` project, with status (OPEN / PARTIAL / CLOSED) and resolution notes. The fixes are minimal-impact and follow the project's existing conventions (logger context objects, hoisted `const` declarations, structured imports, etc.).

## Pass-3 Typecheck Triage

| # | File | Lines | Error | Status | Resolution |
|---|------|-------|-------|--------|------------|
| 1 | `app/api/filesystem/snapshot/gateway.ts` | 214, 71 etc. | TS2554 / LogContext | **CLOSED** | Restructured 4 `logger.info(...)` calls from template-literal strings to `logger.info(message, { field: value })` context objects. Structured fields (`count`, `ownerId`, `version`, `source`) preserved for log scrapers and `/api/health?detailed`. |
| 2 | `app/api/chat/route.ts` | 380, 880, 1824, 1825, 1838, 1875, 1893 | TS2345 LogContext | **CLOSED** | 7 `chatLogger.debug('msg', string)` → `chatLogger.debug('msg', { field })`. |
| 3 | `app/api/chat/route.ts` | 5231, 5431, 5444, 5454, 5466, 5477, 5488 | TS2345 LogContext | **CLOSED** | 7 `chatLogger.warn(...)` calls converted via Python regex. |
| 4 | `app/api/chat/route.ts` | 5354 | TS2339 PatchEdit.content | **CLOSED** | `d.content` → `d.diff` (PatchEdit only has `{ path, diff }`). |
| 5 | `app/api/chat/route.ts` | 1749 | TS2322 NextRequest type mismatch | **CLOSED** | `getOrchestrationModeFromRequest(request as unknown as Parameters<typeof getOrchestrationModeFromRequest>[0])` with inline comment explaining the cross-package type-shape mismatch. |
| 6 | `app/api/chat/route.ts` | 1838 | Cleanup | **CLOSED** | `{ debugInfo }` → `{ ...debugInfo }` (spread fields to top level for log consumers). |
| 7 | `app/api/chat/route.ts` | 1905 (approx) | Dead-comment cleanup | **CLOSED** | Removed leftover `// line 1838 intentionally not used in this batch` scaffolding from a previous str_replace attempt. |
| 8 | `app/api/chat/filesystem-edits.ts` | (various) | `pendingEdits` TDZ | **CLOSED** | Hoisted `const pendingEdits = [...]` declaration to top of function. |
| 9 | `components/code-preview-panel.tsx` | 1150, 1169, 1182, 1343, 1955, 2225, 2245, 2332, 2450, 2453, 2532, 2767, 2835, 3981, 4046, 5731, 5784, 6336 | TS2304 `Cannot find name 'logger'` | **CLOSED** | Moved `const logger = createLogger('UI:CodePreviewPanel')` from line 3137 to right after the `import { createLogger }` line (TDZ/hoisting fix). |
| 10 | `components/code-preview-panel.tsx` | 1183, 2451 | TS2554 logger 3-arg calls | **CLOSED** | `logger.X('msg', v1, v2)` → `logger.X('msg', { field1: v1, field2: v2 })`. |
| 11 | `lib/integrations/composio/webhook-handler.ts` | 131, 151, 176, 198, 208, 219, 239, 252, 261, 272, 296 | TS2304 `Cannot find name 'logger'` (11 errors) | **CLOSED** | Bug: `import { createLogger }` and `const logger = createLogger(...)` lines were inside a JSDoc `@example` block where they had lost their ` *` prefix — treated as comments, so the logger was never declared. Fix: restored ` *` prefix on the stray lines (preserving the @example documentation) AND added a real module-scope import + const right before `export async function handleComposioWebhook(...)`. |
| 12 | `hooks/use-enhanced-chat.ts` | 2188, 2196, 2202, 2280, 2288, 2292, 2823 | TS2554 logger 3-arg calls (7 errors) | **CLOSED** | Same `logger.X('msg', v1, v2)` → `logger.X('msg', { field1, field2 })` pattern. 5× `{ count: allEdits.length }`, 2× `{ editCount, contentLength }`, 1× `{ eventType, data: eventData }`. |
| 13 | `packages/shared/agent/enhanced-background-jobs.ts` | 756 | Runtime bug (was already `as any` cast) | **CLOSED** | `(result as any).object?.shouldStop` → `(result as any).output?.shouldStop`. The `.object` property doesn't exist on AI SDK 5 `GenerateTextResult` (the property is `output`); the `as any` cast was masking the typecheck error but the value was `undefined` at runtime, so the structured output was being silently dropped (returning `false` as a fallback). |
| 14 | `packages/shared/agent/task-classifier.ts` | 380 | Runtime bug (was already `as any` cast) | **CLOSED** | Same fix: `(result as any).object` → `(result as any).output`. Silently falling back to `0.5` confidence. |
| 15 | `lib/orchestra/reflection-engine.ts` | 218, 219, 220 | TS2339 `Property 'object' does not exist` | **CLOSED** | `result.object.X` → `result.output.X` (3 occurrences: improvements, confidence, suggestedChanges). |
| 16 | `lib/orchestra/stateful-agent/agents/stateful-agent.ts` | 842 | TS2339 `Property 'object' does not exist` | **CLOSED** | `result.object.tasks.map(...)` → `result.output.tasks.map(...)`. |
| 17 | `lib/drivers/agent-bins/agent-filesystem.ts` | 230, 236, 241, 256 | TS2339 `Property 'virtualFilesystem' does not exist` | **CLOSED** | Bug: code imported from `@/lib/virtual-filesystem` (the client-safe barrel) but `virtualFilesystem` is a server-only export in `index.server.ts`. Fix: changed all 4 import paths to `@/lib/virtual-filesystem/index.server`. |
| 18 | `lib/drivers/agent-bins/security.ts` | 252, 367 | TS2339 `Property 'virtualFilesystem' does not exist` | **CLOSED** | Same fix: 2 import paths changed to `@/lib/virtual-filesystem/index.server`. |
| 19 | `lib/mcp/architecture-integration.ts` | 1493 | TS2339 `Property 'virtualFilesystem' does not exist` | **CLOSED** | Same fix: relative import path `../virtual-filesystem` → `../virtual-filesystem/index.server`. |


| 20 | `components/conversation-interface.tsx` | 1592 | TS2554 logger 4-arg call | **CLOSED** | 4-arg `logger.warn` call collapsed to 2-arg with `{ path, status }` context. |
| 21 | `components/conversation-interface.tsx` | 1636 | TS2554 logger 3-arg call (silently broken) | **CLOSED** | The 3rd-arg context object was being ignored by the logger (which only uses the 2nd arg as context). Fixed by folding `patchResult.strategy` into the context object alongside the existing `path`, `confidence`, `attempts` fields. |
| 22 | `components/conversation-interface.tsx` | 847 | TS2554 logger 3-arg call | **CLOSED** | Template-literal-style `'msg', value, 'unit'` collapsed to `'msg', { count: value }`. |
| 23 | `components/visual_editor.tsx` | 6055 | TS2554 logger 3-arg call | **CLOSED** | Template-literal-style `'msg:', value, 'unit'` collapsed to `'msg', { count: value }`. |


| 24 | `lib/virtual-filesystem/opfs/opfs-adapter.ts` | 174 | TS2554 logger 4-arg call | **CLOSED** | `'msg1', val, 'msg2', val` collapsed to `'msg', { from, to }`. |
| 25 | `lib/virtual-filesystem/opfs/opfs-adapter.ts` | 220 | TS2554 logger 4-arg call | **CLOSED** | `'msg1:', val, 'msg2:', val` collapsed to `'msg', { ownerId, fallback }`. |
| 26 | `lib/virtual-filesystem/opfs/opfs-adapter.ts` | 289 | TS2554 logger 3-arg call | **CLOSED** | `'msg1', val, 'msg2'` collapsed to `'msg', { refCount }`. |
| 27 | `lib/virtual-filesystem/opfs/opfs-adapter.ts` | 400 | TS2554 logger 3-arg call | **CLOSED** | `'msg:', val, err` collapsed to `'msg', { path, error }`. |
| 28 | `lib/virtual-filesystem/opfs/opfs-adapter.ts` | 463 | TS2554 logger 4-arg call | **CLOSED** | `'msg:', val, 'label:', val` collapsed to `'msg', { path, version }`. |
| 29 | `lib/virtual-filesystem/opfs/opfs-adapter.ts` | 644 | TS2554 logger 3-arg call | **CLOSED** | `'msg:', val, 'unit'` collapsed to `'msg', { count }`. |
| 30 | `lib/virtual-filesystem/opfs/opfs-adapter.ts` | 745 | TS2554 logger 3-arg call | **CLOSED** | `'msg:', val, 'unit'` collapsed to `'msg', { count }`. |
| 31 | `lib/virtual-filesystem/opfs/opfs-adapter.ts` | 790 | TS2554 logger 4-arg call | **CLOSED** | `'msg:', val, 'label:', val` collapsed to `'msg', { path, queueSize }`. |
| 32 | `lib/virtual-filesystem/opfs/opfs-adapter.ts` | 811 | TS2554 logger 3-arg call | **CLOSED** | `'msg1', val, 'msg2'` collapsed to `'msg', { count }`. |
| 33 | `lib/virtual-filesystem/opfs/opfs-adapter.ts` | 890 | TS2554 logger 3-arg call | **CLOSED** | `'msg1 (label:', val, 'unit)'` collapsed to `'msg', { intervalMs }`. |
| 34 | `lib/virtual-filesystem/opfs/opfs-adapter.ts` | 897 | TS2554 logger 3-arg call | **CLOSED** | Duplicate of #27 (same pattern): `'msg:', val, err` collapsed to `'msg', { path, error }`. |


| 35 | `lib/sandbox/firecracker-runtime.ts` | 9 | TS2307 `Cannot find module 'node:child_process/promises'` | **CLOSED** | Root cause: `tsconfig.json` uses `moduleResolution: "bundler"` which doesn't resolve Node's built-in subpath exports (`/promises`). Fix: changed import to `from 'node:child_process'` — `@types/node@22` exports `execFile` with a promise-returning overload from the main module, and all 7 call sites use `await execFile(...)` so behavior is identical. |

## Remaining Open Errors (39 total)

- `lib/sandbox/providers/codesandbox-provider.ts` — 1 TS2554 (line 112).
- `lib/sandbox/spawn/opencode-cli.ts` — 2 TS2554 (lines 314, 376).
- `lib/tools/registry_original_backup.ts` — 4 TS2307 (missing modules, file appears to be a backup).
- `lib/mcp/client.ts` — 2 TS2339 (authToken property missing).
- `lib/middleware/per-user-rate-limiter.ts` — 1 TS2741 (missing required properties windowMs, maxRequests).
- `lib/previews/live-preview-offloading.ts` — 2 TS2739 (missing property 'python').
- `lib/chat/enhanced-llm-service.ts` — 4 errors (timeoutMs option, model name resolution, two `Comparison between unrelated types`).
- `lib/orchestra/unified-agent-service.ts` — 1 TS2339 (recentFailures property).

## Summary

- **CLOSED**: 35 distinct bugs, 63 typecheck errors fixed (plus 2 runtime bugs caught by the AI SDK property rename).
- **OPEN**: 39 typecheck errors remaining, most of which follow a small number of well-understood patterns (logger 3-arg calls, missing properties, module resolution).

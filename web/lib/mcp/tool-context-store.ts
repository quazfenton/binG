/**
 * Tool Context Store — Request-scoped AsyncLocalStorage for MCP tool context.
 *
 * **Why this is a leaf module:**
 * `vfs-mcp-tools.ts` (the canonical home of the MCP tool implementations)
 * imports `emitFileEvent` from `lib/virtual-filesystem/file-events.ts`.
 * `file-events.ts` now also wants to read the `uiSource` field from the
 * current context, which means it would import `toolContextStore` from
 * `vfs-mcp-tools.ts` — closing a circular import.
 *
 * To break the cycle, the `AsyncLocalStorage` instance, the `ToolContext`
 * type, and the merge helpers (`setToolContext`, `runWithToolContext`,
 * `getToolContext`) live here. Both `vfs-mcp-tools.ts` and `file-events.ts`
 * import from this leaf — no cycle, no initialization-order risk.
 *
 * **Backward compatibility:** `vfs-mcp-tools.ts` re-exports all of the
 * symbols below, so existing callers (`import { toolContextStore, ... } from
 * '@/lib/mcp/vfs-mcp-tools'`) keep working. New code can import directly
 * from this module when the canonical home matters (e.g. to avoid
 * pulling in the heavy `vfs-mcp-tools.ts` dependency tree).
 *
 * @see bing/web/lib/mcp/vfs-mcp-tools.ts (re-exports + tool implementations)
 * @see bing/web/lib/virtual-filesystem/file-events.ts (reads uiSource from this store)
 * @see bing/web/lib/http/ui-source-header-server.ts (writes uiSource to this store)
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { getVfsScopeBasePath } from '../virtual-filesystem/scope-utils';

/**
 * Tool execution context — user ID and scope path extracted from request.
 *
 * The `uiSource` field is forwarded from the `X-UI-Source` request header
 * (Phase B wiring). Optional — empty string when the client didn't
 * forward a tag. See `bing/web/lib/http/ui-source-header-server.ts` for
 * the server-side reader.
 */
export interface ToolContext {
  userId: string;
  sessionId?: string;
  scopePath: string;  // VFS scope path relative to workspace root (e.g., "workspace/sessions/001")
  /**
   * Originating UI surface for this request, forwarded from the
   * `X-UI-Source` request header (Phase B). Read by `emitFileEvent` callers
   * to tag the `source` field so run.log entries can be filtered by UI
   * surface. See `bing/web/lib/http/ui-source-header-server.ts` for the
   * server-side reader. Optional — empty string when the client didn't
   * forward a tag.
   */
  uiSource?: string;
}

// Request-scoped context storage using AsyncLocalStorage.
// This is SAFE for concurrent requests — each async execution chain gets
// its own isolated context, preventing cross-user data leaks.
export const toolContextStore = new AsyncLocalStorage<ToolContext>();

/**
 * Set the tool execution context for the current async scope.
 * Unlike the old global mutable approach, this is request-scoped and
 * cannot be corrupted by concurrent requests.
 *
 * **Merge semantics (Phase B):** If a `ToolContext` is already active in the
 * current async chain (e.g., set by `setUISource()` at the top of a route
 * handler to stash the `X-UI-Source` header), the existing fields are
 * preserved and the new `context` overrides only the fields it specifies.
 * This lets `uiSource` (and any other request-scoped metadata) survive the
 * downstream `setToolContext()` calls that MCP tool dispatchers make when
 * they establish the full `{userId, sessionId, scopePath}` context.
 */
export function setToolContext(context: ToolContext): void {
  const existing = toolContextStore.getStore();
  toolContextStore.enterWith({
    ...(existing ?? {}),
    ...context,
  });
}

/**
 * Run a callback with a tool context, merging with the current scope.
 *
 * Like `toolContextStore.run`, but preserves any fields from the current
 * scope (e.g. `uiSource` set by `setUISource()`) so request-scoped
 * metadata survives nested `run()` boundaries. This is the canonical
 * helper for MCP/AI-SDK code paths that need to establish a
 * `{userId, sessionId, scopePath}` context without clobbering upstream
 * request metadata.
 */
export function runWithToolContext<T>(
  context: ToolContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  const existing = toolContextStore.getStore();
  return toolContextStore.run(
    {
      ...(existing ?? {}),
      ...context,
    },
    fn,
  );
}

/**
 * Get the current tool execution context.
 * Returns the request-scoped context or a safe fallback.
 * FALLBACK: Uses "workspace" as the default scope if none is set.
 */
export function getToolContext(): ToolContext {
  let ctx = toolContextStore.getStore();
  // Treat an empty userId as "no context" — this is the placeholder
  // stashed by `setUISource()` (Phase B) before a real
  // `setToolContext()` / `runWithToolContext()` establishes the full
  // `{userId, sessionId, scopePath}` context. Falling through to the
  // default below means tools called in the gap between the two calls
  // hit the safe `'default'` fallback instead of crashing on an empty
  // `userId`. Phase B invariant: every route that calls `setUISource()`
  // must establish a full context before dispatching an MCP tool.
  if (ctx && !ctx.userId) ctx = undefined;
  if (ctx) return ctx;
  // Safe fallback — should only happen if tools are called outside
  // of a toolContextStore.run() wrapper (which indicates a caller bug).
  // Use mode-aware default session (desktop: 'workspace', web: 'workspace/sessions/000')
  // BUG: If you see this in production, the tool caller did not wrap in toolContextStore.run()
  // Tag matches the file that owns this function. Was '[VFS-MCP-TOOLS]' when
  // the function lived in vfs-mcp-tools.ts; renamed to '[ToolContextStore]'
  // when the function moved here with the leaf refactor. Update any log
  // scrapers that grep for the old tag.
  console.warn('[ToolContextStore] WARNING: No tool context set — toolContextStore.run() was not called by the caller. Files may be written to wrong workspace (anon:public).');
  return {
    userId: 'default',
    sessionId: undefined,      scopePath: getVfsScopeBasePath(),
  };
}

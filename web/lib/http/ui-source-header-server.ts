/**
 * UI Source Header — Server-side reader.
 *
 * Phase B of the X-UI-Source wiring. The client components (Phase A) forward
 * an `X-UI-Source` header ('workspace-panel' | 'terminal-panel' | 'code-preview-panel')
 * on every file-write fetch. This module reads that header at the top of
 * each route handler and stashes the value in `toolContextStore` (the shared
 * request-scoped `AsyncLocalStorage` in `vfs-mcp-tools.ts`) so it survives
 * for the lifetime of the request — available to any downstream
 * `emitFileEvent()` caller via `getToolContext().uiSource` or the convenience
 * `getUISourceFromContext()` accessor.
 *
 * The value lives on the `ToolContext.uiSource` field. The merge semantics
 * baked into `setToolContext` and `runWithToolContext` (see
 * `vfs-mcp-tools.ts`) preserve `uiSource` across downstream context updates
 * — so a later `setToolContext({userId, sessionId, scopePath})` call from an
 * MCP tool dispatcher will not clobber the UI source stashed here.
 *
 * Usage (per-route):
 * ```ts
 * import { withUISourceScope, getUISourceFromContext, setUISource, readUISourceHeader } from '@/lib/http/ui-source-header-server';
 *
 * // Non-invasive (recommended for large handlers — chat route uses this):
 * export async function POST(request: NextRequest) {
 *   setUISource(readUISourceHeader(request));
 *   // ... handler body, any emitFileEvent() call can read the UI source
 * }
 *
 * // Or wrap the entire handler (filesystem / workspace reconnect routes):
 * export async function POST(request: NextRequest) {
 *   return withUISourceScope(request, async () => {
 *     // ... route body, any emitFileEvent() call in this scope can read the UI source
 *   });
 * }
 * ```
 *
 * Or, for routes that already establish a `ToolContext`:
 * ```ts
 * setToolContext({ userId, sessionId, scopePath, uiSource: readUISourceHeader(request) });
 * ```
 *
 * @see bing/web/lib/http/ui-source-header.ts (client-side counterpart)
 * @see bing/web/lib/mcp/vfs-mcp-tools.ts (ToolContext type + toolContextStore)
 * @see bing/web/lib/virtual-filesystem/file-events.ts (FILE_EVENT_SOURCES)
 * @see bing/BUGS_AUDIT.md Pass-4 #62 (path normalization, cross-references the UI surface tag)
 */

import type { NextRequest } from 'next/server';

import { UI_SOURCE, UI_SOURCE_HEADER } from './ui-source-header';
import { toolContextStore, type ToolContext } from '../mcp/vfs-mcp-tools';

/**
 * Read the raw `X-UI-Source` header from a request. Returns the trimmed
 * value if present and non-empty, or `undefined` if the header is missing
 * or empty. Defensive: the client could send any string, not just our
 * known constants — callers should validate via `isKnownUISource` if
 * they need to whitelist.
 */
export function readUISourceHeader(request: NextRequest | Request): string | undefined {
  const raw = request.headers.get(UI_SOURCE_HEADER);
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Cap length to prevent abuse / log bloat. 64 chars is well above the
  // 3 known constants ('workspace-panel' = 15, 'terminal-panel' = 14,
  // 'code-preview-panel' = 18) but blocks pathological inputs.
  return trimmed.length > 64 ? trimmed.slice(0, 64) : trimmed;
}

/**
 * Validate that a string is one of the known UI source constants.
 * Returns `true` if the value matches `workspace-panel`, `terminal-panel`,
 * or `code-preview-panel`; `false` otherwise. Use this to whitelist
 * downstream `source` field values before they're written to run.log.
 */
export function isKnownUISource(value: string | undefined): value is (typeof UI_SOURCE)[keyof typeof UI_SOURCE] {
  if (!value) return false;
  return value === UI_SOURCE.WORKSPACE_PANEL
      || value === UI_SOURCE.TERMINAL_PANEL
      || value === UI_SOURCE.CODE_PREVIEW_PANEL;
}

/**
 * Read the current UI source from the `toolContextStore` scope. Returns
 * `undefined` when the call is outside any `toolContextStore` scope (or when
 * the client didn't send a tag). Safe to call from anywhere in the
 * request's call stack.
 *
 * Equivalent to `toolContextStore.getStore()?.uiSource` but with a more
 * descriptive name and an explicit return type.
 */
export function getUISourceFromContext(): string | undefined {
  return toolContextStore.getStore()?.uiSource;
}

/**
 * Wrap a request handler so the UI source tag is available via
 * `getUISourceFromContext()` for the duration of the inner `fn` execution.
 *
 * Implementation: calls `setUISource()` (which uses `enterWith`) before
 * invoking `fn()`. This means the `uiSource` is visible to the inner
 * callback AND any downstream code in the same async chain. Because the
 * routes that use this wrapper are top-level entry points (filesystem
 * catch-all, workspace reconnect), there is no outer scope to leak into.
 *
 * The merge semantics in `setToolContext` and `runWithToolContext`
 * (see `vfs-mcp-tools.ts`) preserve the `uiSource` across downstream
 * context updates — so a later `setToolContext({userId, sessionId, scopePath})`
 * call from an MCP tool dispatcher will not clobber the UI source stashed here.
 *
 * **Prefer `setUISource()` for routes that already have a request handler
 * function body** — wrapping a 5000-line handler is fragile (a missed
 * closing `})` breaks the entire route). `setUISource` is a one-liner
 * call at the top of the handler that does the same thing non-invasively.
 */
export function withUISourceScope<T>(
  request: NextRequest | Request,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  setUISource(readUISourceHeader(request));
  return fn();
}

/**
 * Set the UI source tag for the current async context (fire-and-forget).
 *
 * Uses `toolContextStore.enterWith()` to splice just the `uiSource` field
 * into whatever context is currently active (or seed a minimal one if no
 * context is set yet). Once called, the value is visible to any
 * downstream `getUISourceFromContext()` call in the same request, without
 * needing to wrap a callback.
 *
 * **Safe to call at the top of a single-request handler**: enterWith
 * sets the value for the current async context AND all future async
 * operations spawned from it. Concurrent requests get their own context,
 * so there is no cross-request leakage.
 *
 * **Merge semantics:** if a `ToolContext` is already active in this scope
 * (e.g., a parent route handler called `withUISourceScope` first), only
 * the `uiSource` field is overwritten — `userId`, `sessionId`, `scopePath`
 * and any other fields are preserved.
 *
 * **No existing context:** if no context is active, a minimal placeholder
 * context is entered with empty `userId`/`scopePath` strings. These are
 * always overridden by downstream `setToolContext` / `runWithToolContext`
 * calls (which preserve `uiSource` via the merge), so MCP tools called
 * before any full context is set will hit the `'default'` fallback in
 * `getToolContext()` — safe and already handled.
 *
 * Typical usage:
 * ```ts
 * export async function POST(request: NextRequest) {
 *   setUISource(readUISourceHeader(request));
 *   // ... handler body, any emitFileEvent() call can read the UI source
 * }
 * ```
 */
export function setUISource(uiSource: string | undefined): void {
  const existing = toolContextStore.getStore();
  if (existing) {
    // Merge with existing — preserves userId, sessionId, scopePath, etc.
    toolContextStore.enterWith({ ...existing, uiSource });
  } else {
    // No existing context — enter with a minimal valid `ToolContext`.
    // The placeholder userId/scopePath will be filled in (and the empty
    // userId replaced) by downstream setToolContext / runWithToolContext
    // calls via their merge semantics, so tools see a real userId before
    // they read from the VFS.
    const placeholder: ToolContext = {
      userId: '',
      scopePath: '',
      uiSource,
    };
    toolContextStore.enterWith(placeholder);
  }
}

/**
 * Internal — test-only escape hatch to peek at the current store value
 * without going through `withUISourceScope`. Used by the test suite to
 * assert the value is correctly threaded through. NOT for production use.
 */
export function _peekUISourceForTests(): string | undefined {
  return toolContextStore.getStore()?.uiSource;
}

export { UI_SOURCE, UI_SOURCE_HEADER };

export default withUISourceScope;

/**
 * UI Source Header — Server-side reader.
 *
 * Phase B of the X-UI-Source wiring. The client components (Phase A) forward
 * an `X-UI-Source` header ('workspace-panel' | 'terminal-panel' | 'code-preview-panel')
 * on every file-write fetch. This module reads that header at the top of
 * each route handler and stashes the value in an AsyncLocalStorage so it
 * survives for the lifetime of the request — available to any downstream
 * `emitFileEvent()` caller via `getUISourceFromContext()`.
 *
 * The `ToolContext` interface (in `bing/web/lib/mcp/vfs-mcp-tools.ts`) has
 * been extended with an optional `uiSource?: string` field so callers that
 * already use `getToolContext()` can read it directly without importing this
 * module. This module's AsyncLocalStorage is a redundant belt-and-suspenders
 * for code paths that don't go through `toolContextStore.run()`.
 *
 * Usage (per-route):
 * ```ts
 * import { withUISourceScope, getUISourceFromContext } from '@/lib/http/ui-source-header-server';
 *
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
 * @see bing/web/lib/mcp/vfs-mcp-tools.ts (ToolContext type)
 * @see bing/web/lib/virtual-filesystem/file-events.ts (FILE_EVENT_SOURCES)
 * @see bing/BUGS_AUDIT.md Pass-4 #62 (path normalization, cross-references the UI surface tag)
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextRequest } from 'next/server';

import { UI_SOURCE, UI_SOURCE_HEADER } from './ui-source-header';

/**
 * Dedicated AsyncLocalStorage for the UI source tag. Scoped to the
 * request's lifetime via `withUISourceScope`. The value is a plain string
 * (or undefined when the client didn't forward a tag) — the `string | undefined`
 * union makes "no tag" a valid state, distinguishable from "empty string".
 */
const uiSourceStore = new AsyncLocalStorage<string | undefined>();

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
 * Read the current UI source from the AsyncLocalStorage scope. Returns
 * `undefined` when the call is outside a `withUISourceScope` block (or when
 * the client didn't send a tag). Safe to call from anywhere in the
 * request's call stack.
 */
export function getUISourceFromContext(): string | undefined {
  return uiSourceStore.getStore();
}

/**
 * Wrap a request handler so the UI source tag is available via
 * `getUISourceFromContext()` for the duration of the inner `fn` execution.
 *
 * The wrap uses `AsyncLocalStorage.run` (NOT `enterWith`) so the value is
 * strictly scoped to the inner function — nested concurrent requests
 * cannot see each other's tags.
 *
 * If the request didn't forward an `X-UI-Source` header, the scope is
 * still established (with `undefined`) so `getUISourceFromContext()` always
 * has a defined behavior.
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
  const uiSource = readUISourceHeader(request);
  return uiSourceStore.run(uiSource, fn);
}

/**
 * Set the UI source tag for the current async context (fire-and-forget).
 *
 * Uses `AsyncLocalStorage.enterWith()` — once called, the value is visible
 * to any downstream `getUISourceFromContext()` call in the same request,
 * without needing to wrap a callback. Intended for use at the top of
 * request handlers that are too large to wrap with `withUISourceScope`
 * (e.g. the 5,800-line `app/api/chat/route.ts` POST handler).
 *
 * **Safe to call at the top of a single-request handler**: enterWith
 * sets the value for the current async context AND all future async
 * operations spawned from it. Concurrent requests get their own context,
 * so there is no cross-request leakage.
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
  uiSourceStore.enterWith(uiSource);
}

/**
 * Internal — test-only escape hatch to peek at the current store value
 * without going through `withUISourceScope`. Used by the test suite to
 * assert the value is correctly threaded through. NOT for production use.
 */
export function _peekUISourceForTests(): string | undefined {
  return uiSourceStore.getStore();
}

export { UI_SOURCE, UI_SOURCE_HEADER };

export default withUISourceScope;

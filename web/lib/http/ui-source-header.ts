/**
 * UI Source Header — Client-side helper for forwarding the originating UI surface
 * to server-side handlers via the `X-UI-Source` request header.
 *
 * The server-side readers (Phase B) stash this value on `toolContextStore`
 * (request-scoped AsyncLocalStorage) so any downstream `emitFileEvent()` call
 * during the same request can use it as the `source` field — preserving the
 * UI origin all the way to `web/logs/run.log`.
 *
 * Usage:
 * ```ts
 * import { withUISourceHeader, UI_SOURCE } from '@/lib/http/ui-source-header';
 *
 * // Inline options:
 * const [url, options] = withUISourceHeader('/api/filesystem/rename', {
 *   method: 'POST',
 *   body: JSON.stringify({ path, newName }),
 * }, UI_SOURCE.WORKSPACE_PANEL);
 * const res = await fetch(url, options);
 *
 * // Convenience for full RequestInit objects:
 * const res = await fetch(
 *   ...withUISourceHeader(url, { method: 'POST', body }, UI_SOURCE.WORKSPACE_PANEL),
 * );
 * ```
 *
 * Why a tuple return instead of mutating options:
 *   - The signature is explicit about which arg carries the UI source
 *   - The type system enforces that the caller must spread the result
 *   - Future migration to a richer header shape (e.g. `X-UI-Source-Version`) is a one-line change
 *
 * @see bing/web/lib/chat/file-events.ts (server-side FILE_EVENT_SOURCES constants)
 * @see bing/BUGS_AUDIT.md #62 (path-normalization cross-reference)
 */

export const UI_SOURCE = {
  WORKSPACE_PANEL: 'workspace-panel',
  TERMINAL_PANEL: 'terminal-panel',
  CODE_PREVIEW_PANEL: 'code-preview-panel',
} as const;

export type UISource = (typeof UI_SOURCE)[keyof typeof UI_SOURCE] | string;

export const UI_SOURCE_HEADER = 'X-UI-Source';

/**
 * Merge the `X-UI-Source` header into a `RequestInit`-shaped options object.
 *
 * Returns a `[url, options]` tuple so the call site can spread it directly
 * into `fetch(...)`. Idempotent — calling twice with the same `source` is
 * a no-op for the second header value (last write wins on the server).
 *
 * If `options.headers` is already a `Headers` instance, a new Headers object
 * is constructed to keep this helper pure (no mutation of the caller's
 * original Headers).
 */
export function withUISourceHeader<T extends RequestInit | undefined>(
  url: string,
  options: T,
  source: UISource,
): [string, RequestInit] {
  if (!source) {
    // Defensive: skip the header if no source was provided. Don't throw —
    // some shared call sites may not have a meaningful UI source to forward.
    return [url, { ...(options ?? {}) }];
  }

  const merged: RequestInit = { ...(options ?? {}) };
  const existing = merged.headers;

  if (existing instanceof Headers) {
    const next = new Headers(existing);
    next.set(UI_SOURCE_HEADER, source);
    merged.headers = next;
  } else if (Array.isArray(existing)) {
    // [string, string][] form
    const filtered = existing.filter(([k]) => k.toLowerCase() !== UI_SOURCE_HEADER.toLowerCase());
    merged.headers = [...filtered, [UI_SOURCE_HEADER, source]];
  } else if (existing && typeof existing === 'object') {
    // Record<string, string> form
    const obj: Record<string, string> = { ...(existing as Record<string, string>) };
    // Drop any pre-existing case-variant of the header
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === UI_SOURCE_HEADER.toLowerCase()) delete obj[k];
    }
    obj[UI_SOURCE_HEADER] = source;
    merged.headers = obj;
  } else {
    merged.headers = { [UI_SOURCE_HEADER]: source };
  }

  return [url, merged];
}

export default withUISourceHeader;

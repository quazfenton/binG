/**
 * Session-Path Guard
 *
 * Centralized protection for the path-drift bug (#26): a folder rename under
 * `workspace/sessions/` that drops or replaces the session-id segment (e.g.
 * `workspace/sessions/001` → `workspace/sessions/ai_terminal`) orphans every
 * subsequent tool call scoped to that session. The session id is the load-
 * bearing part of the scopePath — losing it means every read/write/list in
 * that session silently resolves to the wrong folder.
 *
 * Three things this module provides:
 *
 * 1. `SESSION_SCOPED_PATH_REGEX` — single source of truth for the regex
 *    that identifies a session-scoped VFS path. Used everywhere a session
 *    path is validated.
 *
 * 2. `assertScopePathMatchesSessionId(ownerId, scopePath)` — pre-tool-call
 *    check. Compares the session id extracted from the scopePath to the
 *    session id encoded in the ownerId. If they disagree, throws
 *    `SessionPathMismatchError` (and logs [CRITICAL]). This catches the
 *    drift case where the session folder was renamed out from under us:
 *    the ownerId still says "session 001" but the scopePath now points
 *    at "session ai_terminal".
 *
 * 3. `invalidateAllScopeCachesForRename(ownerId, oldPath, newPath, scopePath)`
 *    — comprehensive cache invalidation. After a rename, drop every
 *    `toolResultCache` entry that could still be pointing at the old path
 *    (the old path, the new path, every ancestor, and the search: prefix).
 *
 * Closes bug #26.
 */

import { createLogger } from '@/lib/utils/logger';
import { toolResultCache } from '@/lib/utils/cache';
import { extractSessionIdFromPath, normalizeScopePath } from './scope-utils';
import { extractSessionIdFromOwnerId } from './id-normalization';

const logger = createLogger('VFS:SessionGuard');

// ============================================================================
// Constants
// ============================================================================

/**
 * The canonical regex for a session-scoped VFS path.
 *
 * Matches: `workspace/sessions/<id>[/...]` where `<id>` is the session
 * id (a stock 3-digit numeric, a slug like `alpha` or `alpha-1`, or a
 * composite `userId$sessionId`).
 *
 * Examples (matches):
 *   workspace/sessions/001
 *   workspace/sessions/001/src/app.ts
 *   workspace/sessions/alpha-1
 *   workspace/sessions/1$004
 *   workspace/sessions/anon$001
 *
 * Rejects (no match):
 *   workspace
 *   workspace/sessions            (no id segment)
 *   workspace/sessions/           (trailing slash, no id)
 *   sessions/001                  (missing workspace/ prefix)
 *   workspace/sessions/ai_terminal/foo  (allowed: see note below)
 *
 * Note: `ai_terminal` IS a valid session id per the regex; the path-drift
 * bug is detected by comparing the scopePath's id to the ownerId's id
 * (see `assertScopePathMatchesSessionId` below), not by the regex alone.
 */
export const SESSION_SCOPED_PATH_REGEX = /^workspace\/sessions\/([a-zA-Z0-9_$:-]+)(\/.*)?$/;

/**
 * Throws when a VFS operation is requested against a scopePath whose
 * session id disagrees with the session id encoded in the ownerId.
 *
 * This is the canonical "path drift" error: the session folder was
 * renamed (e.g. `workspace/sessions/001` → `workspace/sessions/ai_terminal`)
 * and the in-flight request still references the old scopePath. The VFS
 * call would silently resolve to the wrong folder; we refuse instead.
 */
export class SessionPathMismatchError extends Error {
  readonly ownerId: string;
  readonly scopePath: string;
  readonly ownerIdSession: string;
  readonly scopePathSession: string | null;
  constructor(
    ownerId: string,
    scopePath: string,
    ownerIdSession: string,
    scopePathSession: string | null,
  ) {
    super(
      `Session id mismatch: scopePath "${scopePath}" refers to session ` +
        `"${scopePathSession ?? '<none>'}" but ownerId "${ownerId}" encodes ` +
        `session "${ownerIdSession}". The session folder was likely renamed ` +
        `out from under us. Refusing the operation.`,
    );
    this.name = 'SessionPathMismatchError';
    this.ownerId = ownerId;
    this.scopePath = scopePath;
    this.ownerIdSession = ownerIdSession;
    this.scopePathSession = scopePathSession;
  }
}

// ============================================================================
// Pre-tool-call verification
// ============================================================================

/**
 * Verify that a scopePath's session id matches the session id encoded in
 * the ownerId. Throws `SessionPathMismatchError` on mismatch.
 *
 * Use this at every tool-call entry point that takes both an ownerId and
 * a scopePath, to catch the path-drift bug early instead of letting the
 * VFS silently resolve to the wrong folder.
 *
 * No-op (returns silently) when:
 *   - `scopePath` is undefined/empty (caller is scope-agnostic)
 *   - `scopePath` is just `workspace` (root scope, no session)
 *   - `ownerId` has no extractable session (anon without session info, etc.)
 *
 * @param ownerId    VFS owner id (e.g. `anon:1781140394202_dfe2a8d006d3d4db22` or `user@domain$001`)
 * @param scopePath  VFS scope path (e.g. `workspace/sessions/001`)
 */
export function assertScopePathMatchesSessionId(
  ownerId: string,
  scopePath: string | undefined,
): void {
  if (!scopePath) return;
  const normalized = normalizeScopePath(scopePath);
  if (normalized === 'workspace') return; // root scope, no session to check

  const scopeSession = extractSessionIdFromPath(normalized);
  const ownerSession = extractSessionIdFromOwnerId(ownerId);
  if (!ownerSession) return; // no session in ownerId → can't verify

  if (scopeSession !== ownerSession) {
    logger.error(
      `[CRITICAL] Session id mismatch: scopePath "${normalized}" refers to ` +
        `"${scopeSession ?? '<none>'}" but ownerId encodes "${ownerSession}". ` +
        `This is the path-drift bug — the session folder was likely renamed ` +
        `out from under us. Refusing the operation.`,
      { ownerId, scopePath: normalized, scopeSession, ownerSession },
    );
    throw new SessionPathMismatchError(ownerId, normalized, ownerSession, scopeSession);
  }
}

/**
 * Quick boolean check: does the given path look like a valid session-scoped
 * VFS path? Use this for non-throwing validation (e.g. UI guards, logs).
 */
export function isSessionScopedPath(path: string | undefined): boolean {
  if (!path) return false;
  return SESSION_SCOPED_PATH_REGEX.test(path);
}

// ============================================================================
// Cache invalidation after a rename
// ============================================================================

/**
 * Invalidate every toolResultCache entry that could be stale after a
 * folder rename. Drops:
 *   - The old path + its trailing-slash variants
 *   - The new path + its trailing-slash variants
 *   - Every ancestor of both (parent directory listings are stale too)
 *   - Wildcard root entries
 *   - The entire `search:<ownerId>:` prefix (search results may contain
 *     paths from the renamed subtree)
 *
 * Designed to be safe to call with any combination of paths. Pass the
 * `oldPath`, `newPath`, and the request's `scopePath`; missing arguments
 * are skipped.
 *
 * @param ownerId   VFS owner id
 * @param oldPath   The pre-rename path (the one being renamed FROM)
 * @param newPath   The post-rename path (the one being renamed TO)
 * @param scopePath The request's scopePath (may be undefined)
 */
export function invalidateAllScopeCachesForRename(
  ownerId: string,
  oldPath: string | undefined,
  newPath: string | undefined,
  scopePath: string | undefined,
): void {
  const norm = (p: string | undefined): string | null => {
    if (!p) return null;
    const cleaned = p.replace(/\\/g, '/').replace(/\/+$/, '').replace(/^\/+/, '');
    return cleaned || null;
  };

  // Collect every path that could be stale: the rename endpoints + their
  // ancestors + the request's scopePath (if any).
  const stale = new Set<string>();
  for (const p of [oldPath, newPath, scopePath]) {
    const cleaned = norm(p);
    if (!cleaned) continue;
    let ancestor: string = cleaned;
    while (ancestor && ancestor !== '.' && ancestor !== '/') {
      stale.add(ancestor);
      stale.add(`${ancestor}/`);
      const parent = ancestor.includes('/') ? ancestor.slice(0, ancestor.lastIndexOf('/')) : '';
      if (!parent || parent === ancestor) break;
      ancestor = parent;
    }
    stale.add('.');
    stale.add('/');
  }

  for (const candidate of stale) {
    toolResultCache.delete(`${ownerId}:${candidate}`);
  }
  // Wildcard root entries (in case the cache uses an empty key).
  toolResultCache.delete(`${ownerId}:`);
  toolResultCache.delete(`${ownerId}:.`);
  toolResultCache.delete(`${ownerId}:/`);

  // Search results may contain paths from the renamed subtree.
  const searchPrefix = `search:${ownerId}:`;
  for (const key of toolResultCache.keys()) {
    if (key.startsWith(searchPrefix)) {
      toolResultCache.delete(key);
    }
  }

  logger.info(
    `[VFS:SessionGuard] Invalidated caches after rename for ${ownerId}: ` +
    `${stale.size} path variants + search results cleared`,
    { oldPath, newPath, scopePath, ownerId },
  );
}

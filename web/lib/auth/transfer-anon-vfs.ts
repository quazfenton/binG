import { NextRequest } from 'next/server';

import { createLogger } from '@/lib/utils/logger';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { isDatabaseAvailable } from '@/lib/database/connection-shim;

const logger = createLogger('Auth:TransferAnonVFS');

/**
 * Core transfer routine. Resolves the anonymous session id (from the
 * `options.anonymousSessionId` override when provided, otherwise from
 * the `anon-session-id` cookie), sanitizes it, and moves the anonymous
 * workspace to the given user.
 *
 * Non-fatal — failures are logged but do not block the auth flow.
 * Idempotent: only runs if there's an anon session id AND the derived
 * anonOwnerId differs from the new userId. Safe to call from both
 * register and login flows.
 *
 * Transfer strategy (two-tier):
 *   1. FAST PATH: derive the anon ownerId from the cookie using the
 *      same sanitizer as `resolveFilesystemOwner`, then transfer. This
 *      matches the common case where the cookie and the DB are in sync.
 *   2. FALLBACK: if the fast path transferred 0 files (cookie was
 *      rotated, set in a different format, or the sanitizer is lossy
 *      for a particular input), scan the VFS for anon ownerIds with
 *      recent activity and transfer each one. The scan is bounded to
 *      the last 7 days to limit the blast radius if a stranger's anon
 *      files happen to be in the DB.
 *
 * SECURITY: the fallback is bounded (24 * 7 = 168 hours default) so
 * stale files from previous visitors don't leak. Anon files are not
 * PII and the user has just authenticated, so this is acceptable for
 * the auth flow.
 *
 * Used by:
 *   - /api/auth/register (after successful registration; cookie-only)
 *   - /api/auth/login (after successful login; cookie-only)
 *   - /api/auth/mfa/challenge (after TOTP verification; cookie-only)
 *   - /api/auth/transfer-vfs-on-login (client-triggered, post-login;
 *     passes the body's anonymousSessionId via options when the cookie
 *     is missing or rotated, so the recovery path has an identifier
 *     to migrate even when the cookie never reached the server)
 *
 * NOTE for MFA: For MFA-enabled users, the login flow returns early
 * with `mfaRequired: true` and does NOT call this function. The MFA
 * challenge endpoint (`/api/auth/mfa/challenge`) should call this
 * function after the TOTP is verified, so the transfer happens only
 * after the user is fully authenticated.
 */
async function transferAnonVFS(
  request: NextRequest,
  user: { id: number | string } | undefined,
  options?: { anonymousSessionId?: string },
): Promise<{ transferredFiles: number }> {
  // Prefer the explicit override (used by the client-side recovery path
  // in /api/auth/transfer-vfs-on-login when the anon-session-id cookie
  // is missing, rotated, or was never sent). Falls back to the cookie
  // for the in-line login/register/mfa paths where the cookie is the
  // authoritative source.
  const anonCookie = options?.anonymousSessionId
    ?? request.cookies.get('anon-session-id')?.value;
  if (!anonCookie || !user?.id) {
    return { transferredFiles: 0 };
  }

  const newOwnerId = String(user.id);

  // FAST PATH: derive the anon ownerId from the cookie using the same
  // sanitizer as `resolveFilesystemOwner`. This matches the common case
  // where the cookie and the DB are in sync.
  const rawSessionId = anonCookie.startsWith('anon_') ? anonCookie.slice(5) : anonCookie;
  const sanitizedSessionId = rawSessionId
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
  const cookieDerivedOwnerId = `anon:${sanitizedSessionId}`;

  // Extract a per-cookie prefix to SCOPE the DB fallback so we only
  // pick up anon ownerIds that plausibly belong to this browser
  // (same `anon_<timestamp>_<...>` family). Without this scoping, the
  // fallback would transfer ANY recent anon workspace in the DB to
  // the new user, which is a silent data graft across browsers.
  // The prefix is the first segment of the cookie value (the
  // timestamp portion), e.g. "anon_1234567890_..." -> "1234567890".
  // This is the same per-browser fingerprint the server already uses
  // to assign anon IDs.
  //
  // COUPLING WARNING: this prefix extraction is coupled to the output
  // format of `generateSecureId('anon')` in `@/lib/utils/server-id`,
  // which produces `anon_<Date.now()>_<random>`. If that format
  // changes, the extraction here MUST be updated to match. The
  // `withAnonSessionCookie` call site in
  // `@/lib/virtual-filesystem/resolve-filesystem-owner` is the
  // canonical cookie setter — update both together.
  // Accept only the expected anon session format: "<13-digit-ts>_<random>" or "<13-digit-ts>-<random>".
  // A short crafted prefix can match many recent anon owners and transfer unrelated anon files
  // into the authenticated account when the fast-path misses — see the fast-path note above.
  // We require both a 13-digit millisecond timestamp (the established format) and a 6+ char
  // random tail, so the only prefix we ever key on is a full 13-digit timestamp.
  const prefixMatch = rawSessionId.match(/^(\d{13})[_-][A-Za-z0-9_-]{6,}$/);
  const cookiePrefix = prefixMatch?.[1] ?? '';

  let totalTransferred = 0;
  const triedOwnerIds = new Set<string>();

  // Helper: transfer with its own try/catch so a single bad row in
  // the fallback loop doesn't strand the rest of the candidates.
  const tryTransfer = async (fromOwnerId: string, source: 'cookie' | 'fallback') => {
    if (triedOwnerIds.has(fromOwnerId)) return 0;
    if (fromOwnerId === newOwnerId) return 0;
    triedOwnerIds.add(fromOwnerId);
    try {
      const result = await virtualFilesystem.transferOwnership(
        fromOwnerId,
        newOwnerId
      );
      if (result.transferredFiles > 0) {
        logger.info(
          source === 'cookie'
            ? 'VFS ownership transferred (cookie fast-path)'
            : 'VFS ownership transferred (DB fallback)',
          {
            from: fromOwnerId,
            to: newOwnerId,
            transferredFiles: result.transferredFiles,
          }
        );
      }
      return result.transferredFiles;
    } catch (err) {
      logger.warn('VFS ownership transfer iteration failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
        from: fromOwnerId,
        source,
      });
      return 0;
    }
  };

  // FAST PATH
  totalTransferred += await tryTransfer(cookieDerivedOwnerId, 'cookie');

  // FALLBACK: cookie-derived ownerId missed. Scan the DB for anon
  // ownerIds with recent activity AND whose prefix matches this
  // cookie's timestamp prefix, so we only recover anon files that
  // plausibly belong to this browser. The findAnonOwnerIds call is
  // bounded to the last 7 days (default) to limit blast radius.
  if (totalTransferred === 0 && cookiePrefix) {
    totalTransferred += await tryDbFallback({
      cookiePrefix,
      cookieDerivedOwnerId,
      newOwnerId,
      tryTransfer,
    });
  }

  return { transferredFiles: totalTransferred };
}

/**
 * DB fallback: scan the VFS for anon ownerIds whose timestamp prefix
 * matches the cookie's, then transfer each. Extracted from
 * `transferAnonVFS` to keep the outer function linear.
 *
 * Non-fatal: any failure (DB unavailable, scan throws, individual
 * transfers fail) is logged and the function returns 0. The caller
 * still gets whatever the fast path got.
 *
 * Returns the number of files transferred via the fallback.
 */
async function tryDbFallback(params: {
  cookiePrefix: string;
  cookieDerivedOwnerId: string;
  newOwnerId: string;
  tryTransfer: (fromOwnerId: string, source: 'cookie' | 'fallback') => Promise<number>;
}): Promise<number> {
  const { cookiePrefix, cookieDerivedOwnerId, newOwnerId, tryTransfer } = params;

  // isDatabaseAvailable() can re-throw unexpected errors (OOM, perms).
  // Wrap it so the transfer stays non-fatal — a broken availability
  // check should never block the auth flow, matching the original
  // contract (see "Non-fatal" in transferAnonVFS).
  let dbAvailable = false;
  let dbCheckError: string | null = null;
  try {
    dbAvailable = isDatabaseAvailable();
  } catch (err) {
    dbCheckError = err instanceof Error ? err.message : String(err);
  }
  if (!dbAvailable) {
    logger.warn('VFS transfer: DB fallback skipped', {
      cookieDerivedOwnerId,
      cookiePrefix,
      reason: dbCheckError ?? 'better-sqlite3 unavailable',
    });
    return 0;
  }

  logger.debug('VFS transfer entered DB fallback', {
    cookieDerivedOwnerId,
    cookiePrefix,
  });

  // Scan bounded to last 7 days (default). A scan failure degrades to
  // "no fallback" rather than losing the fast-path result.
  let recentAnonOwnerIds: string[] = [];
  try {
    recentAnonOwnerIds = await virtualFilesystem.findAnonOwnerIds();
  } catch (err) {
    logger.warn('VFS transfer: findAnonOwnerIds scan failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
      cookieDerivedOwnerId,
    });
    return 0;
  }

  // Bug #3 fix (Pass-6 audit): defensive guard MOVED here from tryTransfer where
  // it was dead code (out of scope — recentAnonOwnerIds is only declared inside
  // this tryDbFallback). Normalise any null/undefined entries from a mock or
  // future code path into an empty array BEFORE the candidate filter below runs.
  recentAnonOwnerIds = recentAnonOwnerIds.filter((x): x is string => x != null);

  // Scope to ownerIds whose session-id portion starts with the same
  // timestamp prefix as the cookie. ownerId format is "anon:<sessionId>"
  // where sessionId was originally derived from the cookie's
  // "anon_<timestamp>_<random>".
  const candidates = recentAnonOwnerIds.filter((id) => {
    const sessionPart = id.startsWith('anon:') ? id.slice(5) : id;
    return (
      sessionPart.startsWith(`${cookiePrefix}_`) ||
      sessionPart.startsWith(`${cookiePrefix}-`)
    );
  });

  let movedTotal = 0;
  for (const anonOwnerId of candidates) {
    const moved = await tryTransfer(anonOwnerId, 'fallback');
    movedTotal += moved;
    if (moved > 0) {
      // Warn when the fallback actually moved files — these are
      // orphan anon files recovered via prefix matching, and ops
      // should be able to see this in the logs.
      logger.warn('VFS transfer: orphan anon files recovered via DB fallback', {
        from: anonOwnerId,
        to: newOwnerId,
        transferredFiles: moved,
        cookiePrefix,
      });
    }
  }
  return movedTotal;
}

/**
 * Transfer anonymous VFS workspace to the newly registered user.
 *
 * Non-fatal. See {@link transferAnonVFS} for the full behavior contract.
 */
export async function transferVFSFromAnonymous(
  request: NextRequest,
  user: { id: number | string } | undefined,
  options?: { anonymousSessionId?: string },
): Promise<void> {
  await transferAnonVFS(request, user, options);
}

/**
 * Transfer anonymous VFS workspace to a user who just logged in to an
 * EXISTING account. Existing-account logins are the most common path by
 * which returning users hit the system with anonymous-only data (e.g.
 * they explored the app without signing in, then came back later to log
 * in). Without this call, the anonymous files would be orphaned when the
 * `anon-session-id` cookie is cleared on successful login.
 *
 * Non-fatal: failures are logged but do not block login.
 * Idempotent: safe to call from the login gateway AND the client-side
 * `auth-context.tsx` post-login trigger.
 *
 * Returns the number of files transferred so the client can show a
 * confirmation (e.g. "Restored 12 files from your anonymous session").
 *
 * @param options.anonymousSessionId Explicit override for the anon
 *   session id, used by the client-side recovery path in
 *   /api/auth/transfer-vfs-on-login when the `anon-session-id` cookie
 *   is missing or rotated. When provided, takes precedence over the
 *   cookie. When omitted, falls back to `request.cookies.get('anon-session-id')`.
 *
 * Used by:
 *   - /api/auth/login (after successful login, alongside auth flow; cookie-only)
 *   - /api/auth/transfer-vfs-on-login (client-triggered explicit retry;
 *     passes the body's anonymousSessionId via options when the cookie
 *     is missing or rotated)
 *
 * NOTE for MFA: For MFA-enabled users, the login flow returns early
 * with `mfaRequired: true` and does NOT call this function. The MFA
 * challenge endpoint should call this function after the TOTP is
 * verified, so the transfer happens only after the user is fully
 * authenticated.
 */
export async function transferVFSOnLogin(
  request: NextRequest,
  user: { id: number | string } | undefined,
  options?: { anonymousSessionId?: string },
): Promise<{ transferredFiles: number }> {
  return transferAnonVFS(request, user, options);
}

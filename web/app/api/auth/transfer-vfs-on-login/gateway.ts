import { NextRequest, NextResponse } from 'next/server';

import { transferVFSOnLogin } from '@/lib/auth/transfer-anon-vfs';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { checkUserRateLimit } from '@/lib/middleware/rate-limiter';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Auth:TransferVFSOnLogin');

/**
 * POST /api/auth/transfer-vfs-on-login
 *
 * Client-triggered transfer of the anonymous VFS workspace to the
 * currently authenticated user. Idempotent — safe to call multiple
 * times (a second call sees zero source files and returns 0).
 *
 * Used by `auth-context.tsx` after a successful login as a defensive
 * fallback so that anonymous data still moves to the user even if the
 * login gateway's in-line transfer was skipped (e.g. MFA deferred the
 * transfer to the challenge endpoint, or a redirect/intermediate page
 * reset state).
 *
 * Auth: uses `resolveRequestAuth` so both session-cookie AND JWT
 * (`auth-token`) authenticated users are accepted. The user id is
 * resolved server-side — the client never sends it.
 *
 * Rate-limited per user to prevent a logged-in client from spamming
 * the endpoint and forcing repeated DB scans in `transferOwnership`.
 *
 * Response: { success, transferredFiles } or 401 if not authenticated,
 * 429 if rate-limited.
 */
export async function POST(request: NextRequest) {
  try {
    // SECURITY: Resolve the user via the canonical request-auth helper
    // (handles both session cookie and JWT paths). Never trust a
    // client-sent id — this prevents an attacker from triggering a
    // transfer into someone else's account.
    const auth = await resolveRequestAuth(request, { allowAnonymous: false });
    if (!auth.success || !auth.userId) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Rate limit per user to bound repeated DB scans from `transferOwnership`.
    // The operation is idempotent, so the cost is purely wasted work.
    if (process.env.NODE_ENV !== 'development') {
      // The rate-limiter accepts a fixed set of category names
      // (login, register, etc.). Use 'generic' for this endpoint since
      // it's an auth-adjacent operation that doesn't fit the other
      // categories.
      const rateLimitResult = checkUserRateLimit(auth.userId, 'generic');
      if (!rateLimitResult.allowed) {
        return NextResponse.json(
          { success: false, error: 'Rate limit exceeded' },
          { status: 429, headers: rateLimitResult.headers }
        );
      }
    }

    // Accept anonymousSessionId from the request body as a fallback when
    // the anon-session-id cookie is missing or rotated. The client captures
    // the localStorage value before clearing it and includes it in the POST
    // body so the recovery path has an identifier to migrate even when the
    // cookie never reached the server or was rotated. The helper prefers
    // this explicit override over the cookie, so we pass it through the
    // options parameter instead of cloning the request to inject a fake
    // cookie header.
    // `.json()` throws on non-JSON or empty bodies; the `.catch` collapses
    // the throw path to "no body" so the cookie-only fallback applies. The
    // outer try/catch isn't needed for rejection handling but is kept to
    // guard against synchronous throws from the property access below.
    let bodyAnonymousSessionId: string | undefined;
    const body = await request.json().catch(() => ({}));
    if (body && typeof body === 'object' && typeof (body as any).anonymousSessionId === 'string') {
      // Validate format: must match the expected anon session ID shape
      // (13-digit timestamp + underscore/hyphen + random tail, 6+ chars).
      // Reject crafted/short values that could be used to probe for other
      // users' anonymous workspaces. The cookie on follow-up requests is
      // the authoritative source; this body override is only a best-effort
      // fallback for cookie-rotation edge cases.
      const raw = (body as any).anonymousSessionId;
      if (/^\d{13}[_-][A-Za-z0-9_-]{6,}$/.test(raw)) {
        bodyAnonymousSessionId = raw;
      }
    }

    const result = await transferVFSOnLogin(
      request,
      { id: auth.userId },
      bodyAnonymousSessionId ? { anonymousSessionId: bodyAnonymousSessionId } : undefined,
    );

    logger.info('Client-triggered VFS transfer on login', {
      userId: auth.userId,
      authSource: auth.source,
      transferredFiles: result.transferredFiles,
    });

    const response = NextResponse.json({
      success: true,
      transferredFiles: result.transferredFiles,
    });
    // Clear anonymous session cookie so subsequent requests don't present
    // a stale anonymous workspace identity and re-trigger fallback behavior.
    // Mirrors the same cookie clear in /api/auth/login/gateway.ts and
    // /api/auth/register/gateway.ts for the non-fallback transfer path.
    response.cookies.set('anon-session-id', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });
    return response;
  } catch (error) {
    logger.error('Transfer VFS on login error', error as Error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

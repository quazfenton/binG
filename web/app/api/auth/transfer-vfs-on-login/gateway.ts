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

    // Read the anon cookie from the SAME request so the transfer uses
    // the anon session id that was persisted to the user's browser.
    // The cookie is httpOnly, so the client cannot send it explicitly.
    const result = await transferVFSOnLogin(request, { id: auth.userId });

    logger.info('Client-triggered VFS transfer on login', {
      userId: auth.userId,
      authSource: auth.source,
      transferredFiles: result.transferredFiles,
    });

    return NextResponse.json({
      success: true,
      transferredFiles: result.transferredFiles,
    });
  } catch (error) {
    logger.error('Transfer VFS on login error', error as Error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { terminalManager } from '@/lib/terminal/terminal-manager';
import { sandboxCreationRateLimiter } from '@/lib/utils/rate-limiter';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('TerminalAPI');

export const runtime = 'nodejs';

/**
 * POST — Ensure user has a sandbox session ready for terminal use.
 * The actual PTY is created by the /terminal/stream SSE route.
 *
 * Authentication: Requires valid JWT token (anonymous not allowed for sandbox).
 * Rate Limiting: Max 3 sandbox creations per minute per user.
 */
export async function POST(req: NextRequest) {
  try {
    // ✅ REQUIRE AUTH (no anonymous for sandbox creation)
    const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      logger.warn('Terminal auth failed', { source: authResult.source });
      return NextResponse.json(
        { error: 'Authentication required. Please sign in to use the terminal.' },
        { status: 401 }
      );
    }

    // ✅ SANDBOX REQUIRES AUTHENTICATED USER (not anonymous)
    if (authResult.source === 'anonymous') {
      return NextResponse.json({
        error: 'Sandbox terminal requires authentication. Please sign in.',
        requiresAuth: true,
      }, { status: 401 });
    }

    // ✅ RATE LIMIT SANDBOX CREATION
    const rateLimit = sandboxCreationRateLimiter.check(authResult.userId);
    if (!rateLimit.allowed) {
      logger.warn('Sandbox creation rate limit exceeded', {
        userId: authResult.userId,
        retryAfter: rateLimit.retryAfter,
        blockedUntil: rateLimit.blockedUntil,
      });
      return NextResponse.json(
        {
          error: 'Too many sandbox creation requests',
          retryAfter: rateLimit.retryAfter,
          blockedUntil: rateLimit.blockedUntil,
        },
        { status: 429 }
      );
    }

    // Get existing sandbox session
    const userSession = sandboxBridge.getSessionByUserId(authResult.userId);

    // If session exists, verify the sandbox is still valid
    if (userSession) {
      const provider = sandboxBridge.inferProviderFromSandboxId(userSession.sandboxId)
        || (process.env.SANDBOX_PROVIDER as any) || 'daytona';

      try {
        // Try to get the sandbox - this will fail if it was destroyed
        const sandboxProvider = await sandboxBridge.getProvider(provider);
        await sandboxProvider.getSandbox(userSession.sandboxId);

        // ✅ Sandbox exists, return the session
        logger.debug('Existing sandbox session found', {
          sessionId: userSession.sessionId,
          sandboxId: userSession.sandboxId,
          userId: authResult.userId,
        });
        return NextResponse.json({
          sessionId: userSession.sessionId,
          sandboxId: userSession.sandboxId,
        });
      } catch (error: any) {
        // ✅ BETTER ERROR CLASSIFICATION
        const isNotFound = error?.status === 404 ||
                          error?.code === 'NOT_FOUND' ||
                          error?.message?.includes('not found') ||
                          error?.message?.includes('404');

        const isProviderUnavailable = error?.message?.includes('Invalid API key') ||
                                     error?.message?.includes('authentication') ||
                                     error?.message?.includes('Cannot read properties') ||
                                     error?.message?.includes('not available');

        if (isProviderUnavailable) {
          // Provider is unavailable, but session might still be valid
          // Don't delete the session - just try to create a new one with a different provider
          logger.warn('Provider unavailable, keeping session for fallback', {
            sandboxId: userSession.sandboxId,
            provider,
            error: error.message,
          });
        } else if (isNotFound) {
          // Sandbox truly doesn't exist, clean up the stale session
          logger.info('Stale session detected, cleaning up', {
            sandboxId: userSession.sandboxId,
            sessionId: userSession.sessionId,
          });
          sandboxBridge.deleteSession(userSession.sessionId);
        } else {
          // Other error - log but don't delete session (could be transient)
          logger.warn('Sandbox verification error (transient), keeping session', {
            sandboxId: userSession.sandboxId,
            error: error.message,
          });
          // Don't delete session on transient errors - allow retry
        }
        // Continue to create new session below
      }
    }

    // No valid session, create a new sandbox session
    const session = await sandboxBridge.getOrCreateSession(authResult.userId, {
      language: 'typescript',
    });
    return NextResponse.json({
      sessionId: session.sessionId,
      sandboxId: session.sandboxId,
    }, { status: 201 });
  } catch (error) {
    console.error('[Terminal] Create error:', error);
    return NextResponse.json({ error: 'Failed to create terminal session' }, { status: 500 });
  }
}

/**
 * DELETE — Kill the PTY session and optionally destroy the sandbox.
 * 
 * Authentication: Requires valid JWT token or session.
 * Authorization: User must own the session being deleted.
 */
export async function DELETE(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    if (!authResult.success || !authResult.userId) {
      logger.warn('Delete terminal auth failed', { source: authResult.source });
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token, session, or anonymous session required' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    // ✅ VERIFY SESSION OWNERSHIP
    const userSession = sandboxBridge.getSessionByUserId(authResult.userId);
    if (!userSession || userSession.sessionId !== sessionId) {
      logger.warn('Unauthorized terminal delete attempt', {
        userId: authResult.userId,
        requestedSessionId: sessionId,
        ownedSessionId: userSession?.sessionId,
      });
      return NextResponse.json(
        { error: 'Unauthorized: session does not belong to this user' },
        { status: 403 }
      );
    }

    logger.info('Killing terminal session', {
      sessionId,
      sandboxId: userSession.sandboxId,
      userId: authResult.userId,
    });
    
    await terminalManager.killTerminal(sessionId);
    
    logger.info('Terminal session killed successfully', { sessionId });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to kill terminal session', {
      error: err.message,
      stack: err.stack,
    });
    return NextResponse.json({ error: 'Failed to kill terminal session' }, { status: 500 });
  }
}

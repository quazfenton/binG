import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { terminalManager } from '@/lib/sandbox/terminal-manager';

export const runtime = 'nodejs';

/**
 * POST — Ensure user has a sandbox session ready for terminal use.
 * The actual PTY is created by the /terminal/stream SSE route.
 * 
 * Authentication: Requires valid JWT token or anonymous session.
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    if (!authResult.success || !authResult.userId) {
      console.log('[Terminal] Auth failed:', authResult);
      return NextResponse.json(
        { error: 'Authentication required. Please sign in to use the terminal.' },
        { status: 401 }
      );
    }

    // Sandbox requires authenticated user (not anonymous)
    if (authResult.source === 'anonymous') {
      return NextResponse.json({
        error: 'Sandbox terminal requires authentication. Please sign in.',
        requiresAuth: true,
      }, { status: 401 });
    }

    // Get existing sandbox session
    const userSession = sandboxBridge.getSessionByUserId(authResult.userId);

    // If session exists, verify the sandbox is still valid
    if (userSession) {
      try {
        // Try to get the sandbox - this will fail if it was destroyed
        const provider = sandboxBridge.inferProviderFromSandboxId(userSession.sandboxId)
          || (process.env.SANDBOX_PROVIDER as any) || 'daytona';
        const sandboxProvider = await sandboxBridge.getProvider(provider);
        await sandboxProvider.getSandbox(userSession.sandboxId);

        // Sandbox exists, return the session
        return NextResponse.json({
          sessionId: userSession.sessionId,
          sandboxId: userSession.sandboxId,
        });
      } catch (error) {
        // Sandbox doesn't exist or is invalid, delete the stale session
        console.log('[Terminal] Stale session detected, cleaning up:', userSession.sandboxId);
        sandboxBridge.deleteSession(userSession.sessionId);
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
 */
export async function DELETE(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    if (!authResult.success || !authResult.userId) {
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

    const userSession = sandboxBridge.getSessionByUserId(authResult.userId);
    if (!userSession || userSession.sessionId !== sessionId) {
      return NextResponse.json(
        { error: 'Unauthorized: session does not belong to this user' },
        { status: 403 }
      );
    }

    await terminalManager.killTerminal(sessionId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Terminal] Kill error:', error);
    return NextResponse.json({ error: 'Failed to kill terminal session' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/jwt';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { terminalManager } from '@/lib/sandbox/terminal-manager';

export const runtime = 'nodejs';

/**
 * POST — Ensure user has a sandbox session ready for terminal use.
 * The actual PTY is created by the /terminal/stream SSE route.
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    // Get or create sandbox session
    const userSession = sandboxBridge.getSessionByUserId(authResult.userId);
    if (!userSession) {
      // Create a new sandbox session
      const session = await sandboxBridge.createWorkspace(authResult.userId);
      return NextResponse.json({
        sessionId: session.sessionId,
        sandboxId: session.sandboxId,
      }, { status: 201 });
    }

    return NextResponse.json({
      sessionId: userSession.sessionId,
      sandboxId: userSession.sandboxId,
    });
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
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
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

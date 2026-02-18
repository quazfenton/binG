import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/jwt';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { terminalManager } from '@/lib/sandbox/terminal-manager';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { sessionId, cols, rows } = body;

    if (!sessionId || typeof cols !== 'number' || typeof rows !== 'number') {
      return NextResponse.json(
        { error: 'sessionId, cols, and rows are required' },
        { status: 400 }
      );
    }

    const userSession = sandboxBridge.getSessionByUserId(authResult.userId);
    if (!userSession || userSession.sessionId !== sessionId) {
      return NextResponse.json(
        { error: 'Unauthorized: session does not belong to this user' },
        { status: 403 }
      );
    }

    await terminalManager.resizeTerminal(sessionId, cols, rows);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Terminal Resize] Error:', error);
    return NextResponse.json({ error: 'Failed to resize terminal' }, { status: 500 });
  }
}

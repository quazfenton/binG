/**
 * POST — Send input to local PTY session
 *
 * Security: Verifies session ownership before writing input.
 * Rate limited by session (input is passed directly to PTY).
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

declare global {
  var __localPtySessions: Map<string, any> | undefined;
}

const sessions = globalThis.__localPtySessions ?? new Map();

// Input size limit (16KB per write — prevents buffer flooding)
const MAX_INPUT_SIZE = 16 * 1024;

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { sessionId, data } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      );
    }

    if (!data || typeof data !== 'string') {
      return NextResponse.json(
        { error: 'data is required and must be a string' },
        { status: 400 }
      );
    }

    // Input size check
    if (data.length > MAX_INPUT_SIZE) {
      return NextResponse.json(
        { error: `Input too large (${data.length} bytes). Max: ${MAX_INPUT_SIZE} bytes` },
        { status: 413 }
      );
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found or has exited' },
        { status: 404 }
      );
    }

    // Verify session ownership
    if (session.userId !== authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: session does not belong to this user' },
        { status: 403 }
      );
    }

    // Check if PTY has exited
    if (session.exited) {
      return NextResponse.json(
        { error: 'PTY session has already exited', exitCode: session.exitCode },
        { status: 410 }
      );
    }

    // Write input to PTY
    session.pty.write(data);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to write to PTY', details: error.message },
      { status: 500 }
    );
  }
}

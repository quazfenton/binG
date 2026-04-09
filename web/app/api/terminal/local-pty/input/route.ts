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

const sessions = globalThis.__localPtySessions ??= new Map();

// Input size limit (16KB per write — prevents buffer flooding)
const MAX_INPUT_SIZE = 16 * 1024;

/**
 * Verify that the requesting user owns the session.
 * Handles both authenticated and anonymous users via cookie matching.
 */
async function verifySessionOwnership(req: NextRequest, session: any): Promise<NextResponse | null> {
  const anonCookie = req.cookies.get('anon-session-id')?.value;
  const authResult = await resolveRequestAuth(req, { allowAnonymous: true });

  if (authResult.success && !authResult.userId.startsWith('anon:')) {
    // Authenticated user — session must match their userId
    if (session.userId !== authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized: session does not belong to this user' }, { status: 403 });
    }
  } else if (authResult.success && authResult.userId.startsWith('anon:')) {
    // Anonymous user — cookie must match the session's anonymous identity
    const sessionAnonId = session.userId.replace(/^anon:/, '');
    const cookieAnonId = anonCookie?.replace(/^anon_?/, '') || '';
    if (sessionAnonId !== cookieAnonId) {
      return NextResponse.json({ error: 'Unauthorized: session does not belong to this user' }, { status: 403 });
    }
  } else if (anonCookie) {
    // No resolved auth, but cookie exists — check it matches
    const sessionAnonId = session.userId.replace(/^anon:/, '');
    const cookieAnonId = anonCookie.replace(/^anon_?/, '');
    if (sessionAnonId !== cookieAnonId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null; // Authorized
}

export async function POST(req: NextRequest) {
  try {
    // Validate Content-Type
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return NextResponse.json(
        { error: 'Content-Type must be application/json' },
        { status: 415 }
      );
    }

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

    // Verify session ownership (handles both authenticated and anonymous users)
    const ownershipError = await verifySessionOwnership(req, session);
    if (ownershipError) return ownershipError;

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

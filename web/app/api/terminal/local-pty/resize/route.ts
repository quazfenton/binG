/**
 * POST — Resize local PTY session
 *
 * Security: Verifies session ownership before resizing.
 * Validates dimensions to prevent abuse.
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { resolveRequestAuth } from '@/lib/auth/request-auth';

declare global {
  var __localPtySessions: Map<string, any> | undefined;
}

const sessions = globalThis.__localPtySessions ??= new Map();

// Valid terminal dimension ranges
const MIN_COLS = 10;
const MAX_COLS = 500;
const MIN_ROWS = 5;
const MAX_ROWS = 200;

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
    const { sessionId, cols, rows } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      );
    }

    if (cols == null || rows == null) {
      return NextResponse.json(
        { error: 'cols and rows are required' },
        { status: 400 }
      );
    }

    // Validate dimensions
    const c = Math.floor(cols);
    const r = Math.floor(rows);

    if (isNaN(c) || isNaN(r) || c < MIN_COLS || c > MAX_COLS || r < MIN_ROWS || r > MAX_ROWS) {
      return NextResponse.json(
        { error: `Invalid dimensions. Must be cols:[${MIN_COLS}-${MAX_COLS}], rows:[${MIN_ROWS}-${MAX_ROWS}]` },
        { status: 400 }
      );
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found or has exited' },
        { status: 404 }
      );
    }

    // Verify session ownership (same logic as input route)
    // Note: After auth check above, authResult.success is guaranteed true
    const anonCookie = req.cookies.get('anon-session-id')?.value;
    if (!authResult.userId.startsWith('anon:')) {
      // Non-anonymous user: verify exact userId match
      if (session.userId !== authResult.userId) {
        return NextResponse.json({ error: 'Unauthorized: session does not belong to this user' }, { status: 403 });
      }
    } else {
      // Anonymous user: verify anon ID matches cookie
      const sessionAnonId = session.userId.replace(/^anon:/, '');
      const cookieAnonId = anonCookie?.replace(/^anon_?/, '') || '';
      if (sessionAnonId !== cookieAnonId) {
        return NextResponse.json({ error: 'Unauthorized: session does not belong to this user' }, { status: 403 });
      }
    }

    // Check if PTY has exited
    if (session.exited) {
      return NextResponse.json(
        { error: 'PTY session has already exited', exitCode: session.exitCode },
        { status: 410 }
      );
    }

    // Resize PTY
    session.pty.resize(c, r);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to resize PTY', details: error.message },
      { status: 500 }
    );
  }
}

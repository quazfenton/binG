import { NextRequest, NextResponse } from 'next/server';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { verifyAuth } from '@/lib/auth/jwt';
import { checkUserRateLimit } from '@/lib/middleware/rate-limiter';

export async function GET(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    // Rate limiting: 30 file operations per minute per user
    const rateLimitResult = checkUserRateLimit(authResult.userId, 'generic');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Too many file operations.', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: rateLimitResult.headers }
      );
    }

    const session = sandboxBridge.getSessionByUserId(authResult.userId);
    if (!session) {
      return NextResponse.json({ error: 'No active session' }, { status: 404 });
    }

    // Get dir path from query param, default to '.'
    const url = new URL(req.url);
    let dirPath = url.searchParams.get('path') || '.';

    // SECURITY: Validate path to prevent directory traversal attacks
    // Reject paths containing '..' which could escape the workspace
    if (dirPath.includes('..')) {
      return NextResponse.json(
        { error: 'Invalid path: directory traversal not allowed' },
        { status: 400 }
      );
    }

    // Reject null bytes which could be used for path injection
    if (dirPath.includes('\0')) {
      return NextResponse.json(
        { error: 'Invalid path: contains null bytes' },
        { status: 400 }
      );
    }

    // Normalize path separators and ensure it's not absolute
    dirPath = dirPath.replace(/\\/g, '/');
    if (dirPath.startsWith('/')) {
      return NextResponse.json(
        { error: 'Invalid path: absolute paths not allowed' },
        { status: 400 }
      );
    }

    // Empty or whitespace-only path after trimming
    if (!dirPath.trim()) {
      dirPath = '.';
    }

    const result = await sandboxBridge.listDirectory(session.sandboxId, dirPath);

    // Check if the operation failed
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to list directory', files: [] },
        { status: 500 }
      );
    }

    return NextResponse.json({ files: result.files || result });
  } catch (error: any) {
    console.error('[Sandbox Files] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 });
  }
}

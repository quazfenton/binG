import { NextRequest, NextResponse } from 'next/server';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { verifyAuth } from '@/lib/auth/jwt';

export async function GET(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    const session = sandboxBridge.getSessionByUserId(authResult.userId);
    if (!session) {
      return NextResponse.json({ error: 'No active session' }, { status: 404 });
    }

    // Get dir path from query param, default to '.'
    const url = new URL(req.url);
    const dirPath = url.searchParams.get('path') || '.';

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

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
    
    // listDirectory returns ToolResult { output: string, error?: string }
    // which contains the raw `ls -la` or `find` output.
    // For a cleaner frontend, we should parse it or just return it as is
    return NextResponse.json({ files: result });
  } catch (error: any) {
    console.error('[Sandbox Files] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 });
  }
}

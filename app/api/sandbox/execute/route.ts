import { NextRequest, NextResponse } from 'next/server';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { verifyAuth } from '@/lib/auth/jwt';

export async function POST(req: NextRequest) {
  try {
    // CRITICAL: Authenticate user from JWT token - do NOT trust userId from request body
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    // Use authenticated userId from token, ignore body userId
    const authenticatedUserId = authResult.userId;

    const body = await req.json();
    const { command, sandboxId } = body;

    if (!command || !sandboxId) {
      return NextResponse.json(
        { error: 'command and sandboxId are required' },
        { status: 400 }
      );
    }

    // Verify sandbox ownership — check that the authenticated user has an active session with this sandboxId
    const userSession = sandboxBridge.getSessionByUserId(authenticatedUserId);
    if (!userSession || userSession.sandboxId !== sandboxId) {
      return NextResponse.json(
        { error: 'Unauthorized: sandbox does not belong to this user' },
        { status: 403 }
      );
    }

    // Execute the command in the sandbox
    const result = await sandboxBridge.executeCommand(sandboxId, command);

    return NextResponse.json({
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.exitCode || 0,
      executionTime: result.executionTime || 0,
    });
  } catch (error: any) {
    console.error('[Sandbox Execute] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to execute command' },
      { status: 500 }
    );
  }
}

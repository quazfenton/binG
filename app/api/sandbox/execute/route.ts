import { NextRequest, NextResponse } from 'next/server';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, command, sandboxId } = body;

    if (!userId || !command || !sandboxId) {
      return NextResponse.json(
        { error: 'userId, command, and sandboxId are required' },
        { status: 400 }
      );
    }

    // Verify sandbox ownership — check that this user has an active session with this sandboxId
    const userSession = sandboxBridge.getSessionByUserId(userId);
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

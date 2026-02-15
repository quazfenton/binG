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

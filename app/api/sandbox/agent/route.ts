import { NextRequest, NextResponse } from 'next/server';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { verifyAuth } from '@/lib/auth/jwt';

export const runtime = 'nodejs';
export const maxDuration = 120;

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
    const { message, history } = body;

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    // Get or create sandbox session for the authenticated user
    const session = await sandboxBridge.getOrCreateSession(authenticatedUserId);

    // Dynamic import to avoid build errors when sandbox module not available
    let runAgentLoop: any;
    try {
      const mod = await import('@/lib/sandbox/agent-loop');
      runAgentLoop = mod.runAgentLoop;
    } catch {
      return NextResponse.json(
        { error: 'Sandbox agent module not available. Configure SANDBOX_PROVIDER.' },
        { status: 503 },
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await runAgentLoop({
            userMessage: message,
            sandboxId: session.sandboxId,
            conversationHistory: history,
            onToolExecution(toolName: string, args: any, toolResult: any) {
              const event = JSON.stringify({
                type: 'tool_execution',
                toolName,
                args,
                result: toolResult,
              });
              controller.enqueue(encoder.encode(`data: ${event}\n\n`));
            },
            onStreamChunk(chunk: string) {
              const event = JSON.stringify({ type: 'stream', text: chunk });
              controller.enqueue(encoder.encode(`data: ${event}\n\n`));
            },
          });

          const finalEvent = JSON.stringify({
            type: 'complete',
            response: result.response,
            totalSteps: result.totalSteps,
            steps: result.steps,
          });
          controller.enqueue(encoder.encode(`data: ${finalEvent}\n\n`));
          controller.close();
        } catch (error: any) {
          console.error('[Sandbox Agent] Stream error:', error);
          // Don't expose internal error details to clients
          const errorEvent = JSON.stringify({ type: 'error', message: 'Agent execution failed' });
          controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('[Sandbox Agent] Error:', error);
    // Don't expose internal error details to clients
    return NextResponse.json({ error: 'Agent execution failed' }, { status: 500 });
  }
}

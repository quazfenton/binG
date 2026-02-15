import { NextRequest, NextResponse } from 'next/server';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, message, history } = body;

    if (!userId || !message) {
      return NextResponse.json({ error: 'userId and message are required' }, { status: 400 });
    }

    // Get or create sandbox session
    const session = await sandboxBridge.getOrCreateSession(userId);

    // Dynamic import to avoid build errors when sandbox module not available
    let runAgentLoop: any;
    try {
      const mod = await import('../../../../lib/agent-loop');
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
          const errorEvent = JSON.stringify({ type: 'error', message: error.message });
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

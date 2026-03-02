import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/jwt';
import {
  processUnifiedAgentRequest,
  checkProviderHealth,
  getAvailableModes,
  type UnifiedAgentConfig,
} from '@/lib/api/unified-agent-service';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes for agent tasks

/**
 * POST /api/unified-agent
 * 
 * Unified agent endpoint that supports both:
 * - V1: LLM API (Mistral, Google, OpenRouter, etc.)
 * - V2: OpenCode Containerized (sandboxed CLI)
 * 
 * Automatically routes based on configuration and availability.
 */
export async function POST(req: NextRequest) {
  try {
    // Authenticate user
    const authResult = await resolveRequestAuth(req, {
      allowAnonymous: true,
      anonymousSessionId: req.headers.get('x-anonymous-session-id'),
    });
    
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication required' },
        { status: 401 }
      );
    }

    const authenticatedUserId = authResult.userId;
    const body = await req.json();
    
    const {
      message,
      systemPrompt,
      history,
      tools,
      mode,
      maxSteps,
      temperature,
      maxTokens,
    } = body;

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    // Build unified config
    const config: UnifiedAgentConfig = {
      userMessage: message,
      systemPrompt: systemPrompt,
      conversationHistory: history,
      tools: tools || [],
      maxSteps: maxSteps || 15,
      temperature: temperature || 0.7,
      maxTokens: maxTokens || 4096,
      mode: mode || 'auto',
    };

    // Check if streaming is requested
    const acceptHeader = req.headers.get('accept') || '';
    const wantsStream = acceptHeader.includes('text/event-stream');

    if (wantsStream) {
      return streamResponse(config, authenticatedUserId);
    } else {
      return await jsonResponse(config, authenticatedUserId);
    }
  } catch (error: any) {
    console.error('[Unified Agent] Error:', error);
    return NextResponse.json(
      { 
        error: 'Agent execution failed',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/unified-agent
 * 
 * Returns provider health status and available modes.
 */
export async function GET() {
  const health = checkProviderHealth();
  const modes = getAvailableModes();
  
  return NextResponse.json({
    health,
    modes,
    environment: {
      LLM_PROVIDER: process.env.LLM_PROVIDER || 'not set',
      OPENCODE_CONTAINERIZED: process.env.OPENCODE_CONTAINERIZED || 'false',
      SANDBOX_PROVIDER: process.env.SANDBOX_PROVIDER || 'not set',
    },
  });
}

/**
 * Send response as JSON (non-streaming)
 */
async function jsonResponse(
  config: UnifiedAgentConfig,
  userId: string
): Promise<NextResponse> {
  // Set up tool execution with user isolation
  const { executeToolWithIsolation } = await import('@/lib/sandbox/sandbox-service-bridge');
  
  config.executeTool = async (name: string, args: Record<string, any>) => {
    return executeToolWithIsolation(userId, name, args);
  };
  
  config.onToolExecution = (name: string, args: any, result: any) => {
    console.log(`[Unified Agent] Tool executed: ${name}`, {
      success: result.success,
      userId,
    });
  };

  // Process the request
  const result = await processUnifiedAgentRequest(config);

  return NextResponse.json(result);
}

/**
 * Send response as SSE stream
 */
function streamResponse(config: UnifiedAgentConfig, userId: string) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Set up tool execution with user isolation
        const { executeToolWithIsolation } = await import('@/lib/sandbox/sandbox-service-bridge');
        
        config.executeTool = async (name: string, args: Record<string, any>) => {
          return executeToolWithIsolation(userId, name, args);
        };
        
        config.onToolExecution = (name: string, args: any, result: any) => {
          const event = JSON.stringify({
            type: 'tool_execution',
            toolName: name,
            args,
            result,
          });
          controller.enqueue(encoder.encode(`data: ${event}\n\n`));
        };
        
        config.onStreamChunk = (chunk: string) => {
          const event = JSON.stringify({
            type: 'stream',
            text: chunk,
          });
          controller.enqueue(encoder.encode(`data: ${event}\n\n`));
        };

        // Process the request
        const result = await processUnifiedAgentRequest(config);

        // Send completion event
        const finalEvent = JSON.stringify({
          type: 'complete',
          response: result.response,
          totalSteps: result.totalSteps,
          steps: result.steps,
          mode: result.mode,
          metadata: result.metadata,
        });
        controller.enqueue(encoder.encode(`data: ${finalEvent}\n\n`));
        controller.close();
      } catch (error: any) {
        console.error('[Unified Agent] Stream error:', error);
        
        const errorEvent = JSON.stringify({
          type: 'error',
          message: 'Agent execution failed',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
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
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}

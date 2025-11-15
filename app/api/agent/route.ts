import { NextRequest, NextResponse } from "next/server";
import { fastAgentService } from "@/lib/api/fast-agent-service";
import type { LLMMessage } from "@/lib/api/llm-providers";

/**
 * Dedicated Fast-Agent endpoint
 * Separate from main chat for direct Fast-Agent access
 */

export async function POST(request: NextRequest) {
  try {
    console.log('[Agent API] Fast-Agent direct endpoint called');

    const body = await request.json();
    const {
      messages,
      provider = 'openrouter',
      model = 'deepseek/deepseek-r1',
      temperature = 0.7,
      maxTokens = 4000,
      stream = false,
      apiKeys = {},
      requestId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    } = body;

    // Validate messages
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Messages array is required and cannot be empty' },
        { status: 400 }
      );
    }

    // Check if Fast-Agent is enabled
    if (!fastAgentService.isEnabled()) {
      return NextResponse.json(
        { error: 'Fast-Agent service is not enabled' },
        { status: 503 }
      );
    }

    // Build request for Fast-Agent
    const fastAgentRequest = {
      messages: messages as LLMMessage[],
      provider,
      model,
      temperature,
      maxTokens,
      stream,
      apiKeys,
      requestId
    };

    console.log('[Agent API] Sending request to Fast-Agent');

    // Check if Fast-Agent can handle this request
    if (!fastAgentService.shouldHandle(fastAgentRequest)) {
      return NextResponse.json(
        { error: 'Fast-Agent cannot handle this request type' },
        { status: 400 }
      );
    }

    // Process request through Fast-Agent
    const response = await fastAgentService.processRequest(fastAgentRequest);

    // Handle streaming response
    if (stream) {
      const streamResponse = fastAgentService.createStreamingResponse(
        response,
        requestId
      );

      return new Response(streamResponse, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Handle non-streaming response
    const formattedResponse = fastAgentService.formatResponse(response, requestId);

    return NextResponse.json({
      success: true,
      data: formattedResponse,
      source: 'fast-agent',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Agent API] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        success: false,
        error: 'Fast-Agent request failed',
        details: errorMessage,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const isEnabled = fastAgentService.isEnabled();
    const config = fastAgentService.getConfig();

    return NextResponse.json({
      enabled: isEnabled,
      endpoint: config.endpoint,
      supportedProviders: config.supportedProviders,
      status: isEnabled ? 'available' : 'disabled',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get Fast-Agent status' },
      { status: 500 }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

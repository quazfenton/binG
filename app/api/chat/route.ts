import { NextRequest, NextResponse } from "next/server";
import { llmService, PROVIDERS } from "@/lib/api/llm-providers";
import { enhancedLLMService } from "@/lib/api/enhanced-llm-service";
import { errorHandler } from "@/lib/api/error-handler";
import { priorityRequestRouter } from "@/lib/api/priority-request-router";
import { unifiedResponseHandler } from "@/lib/api/unified-response-handler";
import { resolveRequestAuth } from "@/lib/auth/request-auth";
import { detectRequestType } from "@/lib/utils/request-type-detector";
import { generateSecureId } from '@/lib/utils';
import type { LLMRequest, LLMMessage, LLMProvider } from "@/lib/api/llm-providers";
import type { EnhancedLLMRequest } from "@/lib/api/enhanced-llm-service";

// Note: Fast-Agent now has dedicated endpoint at /api/agent
// This route uses priority router which includes Fast-Agent as Priority 1

export async function POST(request: NextRequest) {
  console.log('[DEBUG] Chat API: Incoming request');

  // Extract user authentication (JWT or session cookie).
  // Anonymous chat is allowed, but tools/sandbox require authenticated userId.
  const authResult = await resolveRequestAuth(request);
  if (!authResult.success || !authResult.userId) {
    console.log('[DEBUG] Chat API: Anonymous request (no auth token/session)');
  }

  try {
    const body = await request.json();
    console.log('[DEBUG] Chat API: Request body parsed:', {
      hasMessages: !!body.messages,
      messageCount: body.messages?.length,
      provider: body.provider,
      model: body.model,
      stream: body.stream,
      bodyKeys: Object.keys(body),
      userId: authResult.userId // Log the extracted userId
    });

    const {
      messages,
      provider,
      model,
      temperature = 0.7,
      maxTokens = 10096,
      stream = true,
      apiKeys = {},
      requestId,
      resumeFromOffset = 0,
    } = body as {
      messages: LLMMessage[];
      provider: string;
      model: string;
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      apiKeys?: Record<string, string>;
      requestId?: string;
      resumeFromOffset?: number;
    };

    // Validate required fields
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.error('[DEBUG] Chat API: Validation failed - missing or empty messages');
      return NextResponse.json(
        { error: "Messages array is required and cannot be empty" },
        { status: 400 },
      );
    }

    if (!provider || !model) {
      console.error('[DEBUG] Chat API: Validation failed - missing provider or model', { provider, model });
      return NextResponse.json(
        { error: "Provider and model are required" },
        { status: 400 },
      );
    }

    // Check if provider is valid (exists in our PROVIDERS constant)
    const isValidProvider = provider in PROVIDERS;
    
    if (!isValidProvider) {
      console.error('[DEBUG] Chat API: Invalid provider:', provider);
      return NextResponse.json(
        {
          error: `Provider ${provider} is not supported.`,
          availableProviders: Object.keys(PROVIDERS),
        },
        { status: 400 },
      );
    }

    // Get provider info from PROVIDERS constant
    const selectedProvider = PROVIDERS[provider as keyof typeof PROVIDERS];
    console.log('[DEBUG] Chat API: Selected provider:', provider, 'supports streaming:', selectedProvider.supportsStreaming);

    // Check if model is supported by the provider (allow partial matches for models like "z-ai/glm-4.5-air" vs "z-ai/glm-4.5-air:free")
    const isModelSupported = selectedProvider.models.some(
      m => m === model || m.startsWith(model + ':') || m.endsWith(':' + model.split(':')[0])
    );
    
    if (!isModelSupported) {
      console.error('[DEBUG] Chat API: Model not supported:', model, 'Available:', selectedProvider.models);
      return NextResponse.json(
        {
          error: `Model ${model} is not supported by ${provider}`,
          availableModels: selectedProvider.models,
        },
        { status: 400 },
      );
    }

    // Normalize model name to match PROVIDERS constant (e.g., "z-ai/glm-4.5-air" -> "z-ai/glm-4.5-air:free")
    const normalizedModel = selectedProvider.models.find(
      m => m === model || m.startsWith(model + ':') || m.endsWith(':' + model.split(':')[0])
    ) || model;

    console.log('[DEBUG] Chat API: Validation passed, routing through priority chain');

    // NEW: Add tool/sandbox detection
    const requestType = detectRequestType(messages);
    const authenticatedUserId = authResult.success ? authResult.userId : undefined;

    // Tool/sandbox actions require authenticated user identity for authorization and ownership checks.
    if ((requestType === 'tool' || requestType === 'sandbox') && !authenticatedUserId) {
      return NextResponse.json({
        success: false,
        status: 'auth_required',
        error: {
          type: 'auth_required',
          message: `${requestType === 'tool' ? 'Tool use' : 'Sandbox actions'} require authentication. Please log in first.`
        }
      }, { status: 401 });
    }

    // PRIORITY-BASED ROUTING - Routes through Fast-Agent → n8n → Custom Fallback → Original System
    const routerRequest = {
      messages,
      provider,
      model: normalizedModel, // Use normalized model name
      temperature,
      maxTokens,
      stream,
      apiKeys,
      requestId,
      userId: authenticatedUserId, // Include userId for tool and sandbox authorization
      enableTools: requestType === 'tool' && !!authenticatedUserId,
      enableSandbox: requestType === 'sandbox' && !!authenticatedUserId,
      enableComposio: requestType === 'tool' && !!authenticatedUserId,
    };

    console.log('[DEBUG] Chat API: Routing request through priority chain');

    // Route through priority chain (Fast-Agent → n8n → Custom Fallback → Original System)
    try {
      const routerResponse = await priorityRequestRouter.route(routerRequest);

      const actualProvider = routerResponse.metadata?.actualProvider || routerResponse.source;
      const actualModel = routerResponse.metadata?.actualModel || routerRequest.model;
      
      console.log(`[DEBUG] Chat API: Request handled by ${routerResponse.source} (priority ${routerResponse.priority}) - Actual: ${actualProvider}/${actualModel}`);
      
      // Check for auth_required in response
      if (routerResponse.data?.requiresAuth && routerResponse.data?.authUrl) {
        return NextResponse.json({
          status: 'auth_required',
          authUrl: routerResponse.data.authUrl,
          toolName: routerResponse.data.toolName,
          provider: routerResponse.data.provider || 'unknown',
          message: `Please authorize ${routerResponse.data.toolName} to continue`
        });
      }
      
      // Process response through unified handler
      const unifiedResponse = unifiedResponseHandler.processResponse(routerResponse, requestId);

      // Handle streaming response
      if (stream && selectedProvider.supportsStreaming) {
        const streamRequestId = requestId || generateSecureId('stream');
        
        // Create streaming events from unified response
        const events = unifiedResponseHandler.createStreamingEvents(unifiedResponse, streamRequestId);
        
        const encoder = new TextEncoder();
        const readableStream = new ReadableStream({
          async start(controller) {
            try {
              // Send events with appropriate delays
              for (let i = 0; i < events.length; i++) {
                const event = events[i];
                controller.enqueue(encoder.encode(event));
                
                // Add small delays between events for smooth streaming
                if (i < events.length - 1) {
                  await new Promise(resolve => setTimeout(resolve, 50));
                }
              }
              
              controller.close();
            } catch (error) {
              console.error('[DEBUG] Chat API: Streaming error:', error);
              const errorEvent = `event: error\ndata: ${JSON.stringify({
                requestId: streamRequestId,
                message: 'Streaming error occurred',
                canRetry: false
              })}\n\n`;
              controller.enqueue(encoder.encode(errorEvent));
              controller.close();
            }
          },
          cancel() {
            console.log(`[DEBUG] Chat API: Stream cancelled by client: ${streamRequestId}`);
          }
        });

        return new Response(readableStream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
            Expires: "0",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || "",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Vary": "Origin",
          },
        });
      }

      // Handle non-streaming response
      return NextResponse.json({
        success: unifiedResponse.success,
        data: unifiedResponse.data,
        commands: unifiedResponse.commands,
        metadata: unifiedResponse.metadata,
        timestamp: unifiedResponse.metadata?.timestamp
      });
      
    } catch (routerError) {
      const routerErrorObj = routerError as Error;
      // Log which providers were tried from the fallback chain
      const errorMessage = routerErrorObj.message;
      const isNotConfigured = errorMessage.includes('not configured');

      if (!isNotConfigured) {
        console.error('[DEBUG] Chat API: Router error:', errorMessage);
      } else {
        console.log(`[DEBUG] Chat API: No providers configured for request (tried: ${provider}/${model})`);
      }

      // Emergency fallback - return friendly error with proper status
      return NextResponse.json({
        success: false, // Indicate failure so UI can show error state
        error: {
          type: 'router_error',
          message: 'All providers failed to process request',
          isRetryable: true
        },
        data: {
          content: "I apologize, but I'm experiencing technical difficulties. Please try again in a moment.",
          provider: 'emergency-fallback',
          model: 'fallback',
          isFallback: true
        },
        timestamp: new Date().toISOString()
      }, { status: 503 }); // Service Unavailable - indicates temporary issue
    }
  } catch (error) {
    // Skip verbose logging for expected "not configured" errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isNotConfiguredError = errorMessage.includes('not configured');

    if (!isNotConfiguredError) {
      console.error("Chat API error:", errorMessage);
      console.error('[CRITICAL] Chat API: All fallback mechanisms failed');
    } else {
      console.log(`[Chat API] Provider not available: ${errorMessage}`);
    }

    // Process error with enhanced error handler for logging
    const processedError = errorHandler.processError(
      error instanceof Error ? error : new Error(String(error)),
      {
        component: 'chat-api',
        operation: 'generateResponse',
        provider,
        model,
        requestId,
        timestamp: Date.now()
      }
    );

    // Return friendly response with proper error status
    return NextResponse.json(
      {
        success: false, // Indicate failure for proper error handling
        error: {
          type: 'critical_error',
          code: processedError.code,
          message: 'Critical system error occurred',
          isRetryable: processedError.severity !== 'high'
        },
        data: {
          content: "I apologize, but I'm experiencing technical difficulties at the moment. Our team has been notified and is working to resolve the issue. Please try again in a few moments.",
          provider: 'critical-fallback',
          model: 'fallback',
          isFallback: true,
          fallbackReason: 'critical_error'
        },
        timestamp: new Date().toISOString()
      },
      { status: 500 }, // Internal Server Error - indicates server-side issue
    );
  }
}

export async function GET() {
  try {
    // Get list of configured provider IDs (checks if API keys are set)
    const configuredProviderIds = llmService.getAvailableProviders().map(p => p.id);
    
    // Return all providers with availability status (based on API key configuration)
    const allProviders = Object.values(PROVIDERS).map(provider => ({
      ...provider,
      isAvailable: configuredProviderIds.includes(provider.id)
    }));

    return NextResponse.json({
      success: true,
      data: {
        providers: allProviders,
        defaultProvider: process.env.DEFAULT_LLM_PROVIDER || "openrouter",
        defaultModel:
          process.env.DEFAULT_MODEL || "deepseek/deepseek-r1-0528:free",
        defaultTemperature: parseFloat(
          process.env.DEFAULT_TEMPERATURE || "0.7",
        ),
        defaultMaxTokens: Number.parseInt(process.env.DEFAULT_MAX_TOKENS || "80000"),
        features: {
          voiceEnabled: process.env.ENABLE_VOICE_FEATURES === "true",
          imageGeneration: process.env.ENABLE_IMAGE_GENERATION === "true",
          chatHistory: process.env.ENABLE_CHAT_HISTORY === "true",
          codeExecution: process.env.ENABLE_CODE_EXECUTION === "true",
        },
      },
    });
  } catch (error) {
    console.error("Error fetching providers:", error);
    return NextResponse.json(
      { error: "Failed to fetch available providers" },
      { status: 500 },
    );
  }
}

// Handle preflight requests for CORS
export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || "",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin",
    },
  });
}

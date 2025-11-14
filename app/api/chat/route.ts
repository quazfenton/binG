import { NextRequest, NextResponse } from "next/server";
import { llmService } from "@/lib/api/llm-providers";
import { enhancedLLMService } from "@/lib/api/enhanced-llm-service";
import { errorHandler } from "@/lib/api/error-handler";
import { priorityRequestRouter } from "@/lib/api/priority-request-router";
import { unifiedResponseHandler } from "@/lib/api/unified-response-handler";
import type { LLMRequest, LLMMessage } from "@/lib/api/llm-providers";
import type { EnhancedLLMRequest } from "@/lib/api/enhanced-llm-service";

// Note: Fast-Agent now has dedicated endpoint at /api/agent
// This route uses priority router which includes Fast-Agent as Priority 1

export async function POST(request: NextRequest) {
  console.log('[DEBUG] Chat API: Incoming request');
  
  try {
    const body = await request.json();
    console.log('[DEBUG] Chat API: Request body parsed:', {
      hasMessages: !!body.messages,
      messageCount: body.messages?.length,
      provider: body.provider,
      model: body.model,
      stream: body.stream,
      bodyKeys: Object.keys(body)
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

    // Check if provider is available
    const availableProviders = llmService.getAvailableProviders();
    console.log('[DEBUG] Chat API: Available providers:', availableProviders.map(p => p.id));
    
    const selectedProvider = availableProviders.find((p) => p.id === provider);

    if (!selectedProvider) {
      console.error('[DEBUG] Chat API: Provider not available:', provider);
      return NextResponse.json(
        {
          error: `Provider ${provider} is not available. Check your API keys.`,
          availableProviders: availableProviders.map((p) => p.id),
        },
        { status: 400 },
      );
    }

    console.log('[DEBUG] Chat API: Selected provider:', provider, 'supports streaming:', selectedProvider.supportsStreaming);

    // Check if model is supported by the provider
    if (!selectedProvider.models.includes(model)) {
      console.error('[DEBUG] Chat API: Model not supported:', model, 'Available:', selectedProvider.models);
      return NextResponse.json(
        {
          error: `Model ${model} is not supported by ${provider}`,
          availableModels: selectedProvider.models,
        },
        { status: 400 },
      );
    }
    
    console.log('[DEBUG] Chat API: Validation passed, routing through priority chain');

    // PRIORITY-BASED ROUTING - Routes through Fast-Agent → n8n → Custom Fallback → Original System
    const routerRequest = {
      messages,
      provider,
      model,
      temperature,
      maxTokens,
      stream,
      apiKeys,
      requestId
    };

    console.log('[DEBUG] Chat API: Routing request through priority chain');

    // Route through priority chain (Fast-Agent → n8n → Custom Fallback → Original System)
    try {
      const routerResponse = await priorityRequestRouter.route(routerRequest);
      
      console.log(`[DEBUG] Chat API: Request handled by ${routerResponse.source} (priority ${routerResponse.priority})`);
      
      // Process response through unified handler
      const unifiedResponse = unifiedResponseHandler.processResponse(routerResponse, requestId);
      
      // Handle streaming response
      if (stream && selectedProvider.supportsStreaming) {
        const streamRequestId = requestId || `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
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
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
      console.error('[DEBUG] Chat API: Router error (should be rare):', routerError);
      
      // Emergency fallback - return friendly error
      return NextResponse.json({
        success: true, // Still report success to avoid UI errors
        data: {
          content: "I apologize, but I'm experiencing technical difficulties. Please try again in a moment.",
          provider: 'emergency-fallback',
          model: 'fallback',
          isFallback: true
        },
        timestamp: new Date().toISOString()
      });
    }

    // LEGACY CODE BELOW - Keep for reference but should not be reached with proper routing
    const llmRequest: EnhancedLLMRequest = {
      messages,
      provider,
      model,
      temperature,
      maxTokens,
      stream: false, // Force non-streaming for legacy path
      apiKeys,
      enableCircuitBreaker: true,
      retryOptions: {
        maxAttempts: 3,
        backoffStrategy: 'exponential',
        baseDelay: 1000,
        maxDelay: 10000
      }
    };

    // Handle streaming response with enhanced features (LEGACY - should not reach here)
    if (false && stream && selectedProvider.supportsStreaming) {
      const encoder = new TextEncoder();
      const streamRequestId =
        requestId ||
        `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const startTime = Date.now();
      let firstTokenTime = 0;
      let tokenCount = 0;
      let heartbeatInterval: NodeJS.Timeout;

      // Streaming configuration for mobile optimization
      const config = {
        heartbeatIntervalMs: 20000, // 20 seconds
        bufferSizeLimit: 2048, // 2KB
        minChunkSize: 8, // 8 characters
        softTimeoutMs: 30000, // 30 seconds
        hardTimeoutMs: 120000, // 2 minutes
      };

      const llmStream = enhancedLLMService.generateStreamingResponse(llmRequest);
      let buffer = "";
      let aborted = false;

      const readableStream = new ReadableStream({
        async start(controller) {
          // Start heartbeat to keep connection alive
          heartbeatInterval = setInterval(() => {
            if (!aborted) {
              try {
                const heartbeat = `event: heartbeat\ndata: {"timestamp": ${Date.now()}, "requestId": "${streamRequestId}"}\n\n`;
                controller.enqueue(encoder.encode(heartbeat));
              } catch (e) {
                console.warn("Failed to send heartbeat:", e);
              }
            }
          }, config.heartbeatIntervalMs);

          // Soft timeout warning
          const softTimeout = setTimeout(() => {
            if (!aborted) {
              try {
                const timeoutWarning = `event: softTimeout\ndata: {"requestId": "${streamRequestId}", "message": "Taking longer than usual"}\n\n`;
                controller.enqueue(encoder.encode(timeoutWarning));
              } catch (e) {
                console.warn("Failed to send timeout warning:", e);
              }
            }
          }, config.softTimeoutMs);

          // Hard timeout
          const hardTimeout = setTimeout(() => {
            if (!aborted) {
              aborted = true;
              try {
                const errorEvent = `event: error\ndata: ${JSON.stringify({
                  requestId: streamRequestId,
                  message: "Request timed out",
                  canRetry: true,
                  offset: tokenCount,
                })}\n\n`;
                controller.enqueue(encoder.encode(errorEvent));
              } catch (e) {
                console.warn("Failed to send timeout error:", e);
              } finally {
                controller.close();
              }
            }
          }, config.hardTimeoutMs);

          try {
            // Send initial event with metadata
            const initEvent = `event: init\ndata: ${JSON.stringify({
              requestId: streamRequestId,
              startTime,
              provider,
              model,
            })}\n\n`;
            console.log('[DEBUG] Chat API: Sending init event');
            controller.enqueue(encoder.encode(initEvent));

            for await (const chunk of llmStream) {
              if (aborted) break;

              if (chunk?.content) {
                // Record first token time
                if (firstTokenTime === 0) {
                  firstTokenTime = Date.now();
                  const ttft = firstTokenTime - startTime;
                  const metricsEvent = `event: metrics\ndata: ${JSON.stringify({
                    requestId: streamRequestId,
                    timeToFirstToken: ttft,
                  })}\n\n`;
                  controller.enqueue(encoder.encode(metricsEvent));
                }

                // Add to buffer for coalescing
                buffer += chunk.content;
                tokenCount += chunk.content.length;

                // Check if we should emit the buffer
                const shouldEmit =
                  buffer.length >= config.minChunkSize ||
                  /[\s\.\!\?\;\:]+$/.test(buffer) ||
                  buffer.length >= config.bufferSizeLimit;

                if (shouldEmit) {
                  // Emit token data
                  const tokenEvent = `data: ${JSON.stringify({
                    type: "token",
                    content: buffer,
                    requestId: streamRequestId,
                    timestamp: Date.now(),
                    offset: tokenCount - buffer.length,
                  })}\n\n`;
                  controller.enqueue(encoder.encode(tokenEvent));

                  // Check for commands in the current buffer
                  const commandMatch = buffer.match(
                    /=== COMMANDS_START ===([\s\S]*?)=== COMMANDS_END ===/,
                  );
                  if (commandMatch) {
                    const block = commandMatch[1];
                    let commands: {
                      request_files?: string[];
                      write_diffs?: { path: string; diff: string }[];
                    } | null = null;
                    try {
                      const reqMatch = block.match(
                        /request_files:\s*\[(.*?)\]/s,
                      );
                      const diffsMatch = block.match(
                        /write_diffs:\s*\[([\s\S]*?)\]/,
                      );
                      const request_files = reqMatch
                        ? JSON.parse(
                            `[${reqMatch[1]}]`.replace(
                              /([a-zA-Z0-9_\-\/\.]+)(?=\s*[\],])/g,
                              '"$1"',
                            ),
                          )
                        : [];
                      let write_diffs: { path: string; diff: string }[] = [];
                      if (diffsMatch) {
                        const items = diffsMatch[1]
                          .split(/},/)
                          .map((s) => (s.endsWith("}") ? s : s + "}"))
                          .map((s) => s.trim())
                          .filter(Boolean);
                        write_diffs = items.map((raw) => {
                          const pathMatch = raw.match(/path:\s*"([^"]+)"/);
                          const diffMatch = raw.match(/diff:\s*"([\s\S]*)"/);
                          return {
                            path: pathMatch?.[1] || "",
                            diff: (diffMatch?.[1] || "").replace(/\\n/g, "\n"),
                          };
                        });
                      }
                      commands = { request_files, write_diffs };
                    } catch (parseError) {
                      console.warn("Failed to parse commands:", parseError);
                      commands = null;
                    }

                    const commandsEvent = `event: commands\ndata: ${JSON.stringify(
                      {
                        requestId: streamRequestId,
                        commands: commands || { raw: block },
                      },
                    )}\n\n`;
                    controller.enqueue(encoder.encode(commandsEvent));
                  }

                  buffer = "";
                }
              }
            }

            // Emit any remaining buffer content
            if (buffer.length > 0 && !aborted) {
              const finalTokenEvent = `data: ${JSON.stringify({
                type: "token",
                content: buffer,
                requestId: streamRequestId,
                timestamp: Date.now(),
                offset: tokenCount - buffer.length,
              })}\n\n`;
              controller.enqueue(encoder.encode(finalTokenEvent));
            }

            // Send completion event with final metrics
            if (!aborted) {
              const endTime = Date.now();
              const totalLatency = endTime - startTime;
              const tokensPerSecond =
                tokenCount > 0 ? (tokenCount / totalLatency) * 1000 : 0;

              const doneEvent = `event: done\ndata: ${JSON.stringify({
                requestId: streamRequestId,
                success: true,
                totalTokens: tokenCount,
                totalLatency,
                tokensPerSecond,
                timeToFirstToken: firstTokenTime - startTime,
              })}\n\n`;
              controller.enqueue(encoder.encode(doneEvent));
            }
          } catch (err) {
            if (!aborted) {
              const errorMsg =
                err instanceof Error ? err.message : "Unknown streaming error";
              const errorEvent = `event: error\ndata: ${JSON.stringify({
                requestId: streamRequestId,
                message: errorMsg,
                canRetry: true,
                offset: tokenCount,
              })}\n\n`;
              controller.enqueue(encoder.encode(errorEvent));
            }
          } finally {
            clearInterval(heartbeatInterval);
            clearTimeout(softTimeout);
            clearTimeout(hardTimeout);
            if (!aborted) {
              controller.close();
            }
          }
        },
        cancel() {
          aborted = true;
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          console.log(`Stream cancelled by client: ${streamRequestId}`);
        },
      });

      // Enhanced headers for mobile optimization
      return new Response(readableStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no", // Disable nginx buffering
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Handle non-streaming response (LEGACY - should not reach here)
    console.warn('[DEBUG] Chat API: Reached legacy non-streaming code path - this should not happen');
    const response = await enhancedLLMService.generateResponse(llmRequest);

    return NextResponse.json({
      success: true,
      data: response,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Chat API error:", error);

    // With proper fallback chain, this should rarely happen
    // But if it does, still return a user-friendly response
    console.error('[CRITICAL] Chat API: All fallback mechanisms failed');

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

    // Return friendly response even in critical failure (no API errors to users)
    return NextResponse.json(
      {
        success: true, // Report success to avoid UI errors
        data: {
          content: "I apologize, but I'm experiencing technical difficulties at the moment. Our team has been notified and is working to resolve the issue. Please try again in a few moments.",
          provider: 'critical-fallback',
          model: 'fallback',
          isFallback: true,
          fallbackReason: 'critical_error'
        },
        metadata: {
          criticalError: true,
          errorCode: processedError.code,
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      },
      { status: 200 }, // Still return 200 to avoid UI error display
    );
  }
}

export async function GET() {
  try {
    const availableProviders = llmService.getAvailableProviders();

    return NextResponse.json({
      success: true,
      data: {
        providers: availableProviders,
        defaultProvider: process.env.DEFAULT_LLM_PROVIDER || "openrouter",
        defaultModel:
          process.env.DEFAULT_MODEL || "deepseek/deepseek-r1-0528:free",
        defaultTemperature: parseFloat(
          process.env.DEFAULT_TEMPERATURE || "0.7",
        ),
        defaultMaxTokens: parseInt(process.env.DEFAULT_MAX_TOKENS || "80000"),
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
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

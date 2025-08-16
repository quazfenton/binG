import { NextRequest, NextResponse } from "next/server";
import { llmService } from "@/lib/api/llm-providers";
import type { LLMRequest, LLMMessage } from "@/lib/api/llm-providers";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
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
      return NextResponse.json(
        { error: "Messages array is required and cannot be empty" },
        { status: 400 },
      );
    }

    if (!provider || !model) {
      return NextResponse.json(
        { error: "Provider and model are required" },
        { status: 400 },
      );
    }

    // Check if provider is available
    const availableProviders = llmService.getAvailableProviders();
    const selectedProvider = availableProviders.find((p) => p.id === provider);

    if (!selectedProvider) {
      return NextResponse.json(
        {
          error: `Provider ${provider} is not available. Check your API keys.`,
          availableProviders: availableProviders.map((p) => p.id),
        },
        { status: 400 },
      );
    }

    // Check if model is supported by the provider
    if (!selectedProvider.models.includes(model)) {
      return NextResponse.json(
        {
          error: `Model ${model} is not supported by ${provider}`,
          availableModels: selectedProvider.models,
        },
        { status: 400 },
      );
    }

    const llmRequest: LLMRequest = {
      messages,
      provider,
      model,
      temperature,
      maxTokens,
      stream,
      apiKeys,
    };

    // Handle streaming response with enhanced features
    if (stream && selectedProvider.supportsStreaming) {
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

      const llmStream = llmService.generateStreamingResponse(llmRequest);
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

    // Handle non-streaming response
    const response = await llmService.generateResponse(llmRequest);

    // Post-process assistant content to extract COMMANDS block for the client
    let commands: {
      request_files?: string[];
      write_diffs?: { path: string; diff: string }[];
    } | null = null;
    try {
      const content = response.content || "";
      const match = content.match(
        /=== COMMANDS_START ===([\s\S]*?)=== COMMANDS_END ===/,
      );
      if (match) {
        const block = match[1];
        // Naive parse: look for JSON-like arrays
        const reqMatch = block.match(/request_files:\s*\[(.*?)\]/s);
        const diffsMatch = block.match(/write_diffs:\s*\[([\s\S]*?)\]/);
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
      }
    } catch {
      // Ignore parse errors
    }

    return NextResponse.json({
      success: true,
      data: response,
      commands,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Chat API error:", error);

    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes("API key")) {
        return NextResponse.json(
          { error: "Invalid or missing API key for the selected provider" },
          { status: 401 },
        );
      }

      if (error.message.includes("rate limit")) {
        return NextResponse.json(
          { error: "Rate limit exceeded. Please try again later." },
          { status: 429 },
        );
      }

      if (error.message.includes("quota")) {
        return NextResponse.json(
          { error: "API quota exceeded for this provider" },
          { status: 429 },
        );
      }
    }

    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
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

import { NextResponse } from "next/server";
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Prewarm');



// Pre-warm endpoint to initialize LLM service and avoid cold starts
// Call this on app mount to speed up first chat request

export async function GET(request?: Request) {
  try {
    // Pre-warm the LLM service by triggering provider initialization
    const { llmService } = await import("@/lib/providers/llm-providers");

    // Force initialization of lazy-loaded SDK clients (OpenAI, Anthropic, Google, etc.)
    // This triggers the dynamic imports that would otherwise happen on first request
    await llmService.warmupProviders();

    // Get list of available providers based on configured API keys
    const availableProviders = llmService.getAvailableProviders();

    return NextResponse.json({
      success: true,
      message: "Chat API pre-warmed",
      availableProviders: availableProviders.length,
      providers: availableProviders.map(p => p.id),
      timestamp: Date.now(),
    });
  } catch (error) {
    // Logger stores the Error in the entry's `error` field (only printed with
    // includeStack=true, default false), so folding the error message into the
    // message string guarantees console shows it. Keep the Error as the 2nd
    // arg so Sentry/structured entry still captures the stack.
    logger.error(
      'Prewarm error: ' + (error instanceof Error ? error.message : String(error)),
      error instanceof Error ? error : undefined,
    );
    return NextResponse.json(
      { error: 'Failed to pre-warm' },
      { status: 500 }
    );
  }
}

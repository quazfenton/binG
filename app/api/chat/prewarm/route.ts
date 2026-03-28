import { NextResponse } from "next/server";

// Pre-warm endpoint to initialize LLM service and avoid cold starts
// Call this on app mount to speed up first chat request

export async function GET() {
  try {
    // Pre-warm the LLM service by triggering provider initialization
    const { llmService } = await import("@/lib/chat/llm-providers");

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
    console.error("Prewarm error:", error);
    return NextResponse.json(
      { error: "Failed to pre-warm" },
      { status: 500 }
    );
  }
}

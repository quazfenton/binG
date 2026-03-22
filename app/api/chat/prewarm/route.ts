import { NextResponse } from "next/server";

// Pre-warm endpoint to initialize LLM service and avoid cold starts
// Call this on app mount to speed up first chat request

export async function GET() {
  try {
    // Pre-warm the LLM service by triggering provider initialization
    const { llmService } = await import("@/lib/chat/llm-providers");
    
    // Force initialization of available providers
    const availableProviders = llmService.getAvailableProviders();
    
    return NextResponse.json({
      success: true,
      message: "Chat API pre-warmed",
      availableProviders: availableProviders.length,
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

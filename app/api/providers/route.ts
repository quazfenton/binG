import { NextRequest, NextResponse } from "next/server";
import { llmService, PROVIDERS } from "@/lib/api/llm-providers";

export async function GET() {
  try {
    // Get providers that have API keys configured
    const availableProviders = llmService.getAvailableProviders();
    const availableProviderIds = availableProviders.map(p => p.id);

    // Return all providers from the PROVIDERS constant, marking which ones are available
    const allProviders = Object.values(PROVIDERS)
      .map(provider => {
        // Check if this provider has API keys configured (is available)
        const isAvailable = availableProviderIds.includes(provider.id);

        return {
          id: provider.id,
          name: provider.name,
          models: provider.models,
          supportsStreaming: provider.supportsStreaming,
          maxTokens: provider.maxTokens,
          description: provider.description,
          isAvailable // Add availability status for UI
        };
      });

    // Sort: available providers first, then unavailable ones
    const sortedProviders = allProviders.sort((a, b) => {
      if (a.isAvailable && !b.isAvailable) return -1;
      if (!a.isAvailable && b.isAvailable) return 1;
      return 0;
    });

    return NextResponse.json({
      success: true,
      data: {
        providers: sortedProviders,
        defaultProvider: process.env.DEFAULT_LLM_PROVIDER || "openrouter",
        defaultModel: process.env.DEFAULT_MODEL || "deepseek/deepseek-r1-0528:free",
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
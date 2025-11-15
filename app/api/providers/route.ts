import { NextRequest, NextResponse } from "next/server";
import { enhancedLLMService } from "@/lib/api/enhanced-llm-service";
import { PROVIDERS } from "@/lib/api/llm-providers";

export async function GET() {
  try {
    const providerHealth = enhancedLLMService.getProviderHealth();
    const availableProviderIds = enhancedLLMService.getAvailableProviders();
    
    // Return all providers from the PROVIDERS constant, but mark which ones are available
    const allProviders = Object.values(PROVIDERS)
      .filter(provider => {
        // Only include providers that are configured in enhancedLLMService
        return provider.id in providerHealth;
      })
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

    return NextResponse.json({
      success: true,
      data: {
        providers: allProviders,
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
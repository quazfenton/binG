import { NextRequest, NextResponse } from "next/server";
import { enhancedLLMService } from "@/lib/api/enhanced-llm-service";

export async function GET() {
  try {
    const providerHealth = enhancedLLMService.getProviderHealth();
    const availableProviders = enhancedLLMService.getAvailableProviders();
    
    // Format providers with their models for the UI
    const providersWithModels = availableProviders
      .map(providerId => {
        const providerConfig = providerHealth[providerId];
        if (providerConfig) {
          return {
            id: providerConfig.provider,
            name: providerConfig.name || providerConfig.provider,
            models: providerConfig.models || [],
            supportsStreaming: providerConfig.supportsStreaming || true,
            description: providerConfig.description || '',
            maxTokens: providerConfig.maxTokens || 128000,
          };
        }
        return null;
      })
      .filter(Boolean) as any;

    return NextResponse.json({
      success: true,
      data: {
        providers: providersWithModels,
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
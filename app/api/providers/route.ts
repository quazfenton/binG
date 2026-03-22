import { NextRequest, NextResponse } from "next/server";
import { PROVIDERS, llmService, type LLMProvider } from "@/lib/chat/llm-providers";

// Cache provider list to avoid repeated computation on every request
// Since provider availability is based on env vars which don't change during runtime
let cachedProviders: any = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 300000; // Cache for 5 minutes

export async function GET(request: NextRequest) {
  try {
    const now = Date.now();

    // Return cached result if available and not expired
    const isStale = cachedProviders && (now - cacheTimestamp) >= CACHE_TTL_MS;
    if (cachedProviders) {
      return NextResponse.json(cachedProviders, {
        headers: {
          'Cache-Control': isStale ? 'public, max-age=60, stale-while-revalidate=300' : 'public, max-age=300, stale-while-revalidate=600',
        },
      });
    }

    // Use canonical llmService.getAvailableProviders() for availability checks
    const availableProviderIds = new Set(llmService.getAvailableProviders().map(p => p.id));

    // Build provider list from static PROVIDERS constant
    const allProviders = (Object.values(PROVIDERS) as LLMProvider[])
      .map((provider: LLMProvider) => ({
        id: provider.id,
        name: provider.name,
        models: provider.models,
        supportsStreaming: provider.supportsStreaming,
        maxTokens: provider.maxTokens,
        description: provider.description,
        isAvailable: availableProviderIds.has(provider.id)
      }));

    // Sort: available providers first
    const sortedProviders = allProviders.sort((a, b) => {
      if (a.isAvailable && !b.isAvailable) return -1;
      if (!a.isAvailable && b.isAvailable) return 1;
      return 0;
    });

    // Cache the result
    cachedProviders = {
      success: true,
      data: {
        providers: sortedProviders,
        defaultProvider: process.env.DEFAULT_LLM_PROVIDER || "openrouter",
        defaultModel: process.env.DEFAULT_MODEL || "google/gemma-3-1b-it:free",
      },
    };
    cacheTimestamp = now;

    return NextResponse.json(cachedProviders);
  } catch (error) {
    console.error("Error fetching providers:", error);
    return NextResponse.json(
      { error: "Failed to fetch available providers" },
      { status: 500 },
    );
  }
}
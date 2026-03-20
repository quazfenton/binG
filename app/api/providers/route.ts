import { NextRequest, NextResponse } from "next/server";
import { PROVIDERS, type LLMProvider } from "@/lib/chat/llm-providers";

// Cache provider list to avoid repeated computation on every request
// Since provider availability is based on env vars which don't change during runtime
let cachedProviders: any = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60000; // Cache for 1 minute

// Define which providers are available based on environment variables
// This is a simple synchronous check - no async calls needed
const AVAILABLE_PROVIDER_IDS = new Set<string>();
if (process.env.OPENAI_API_KEY) AVAILABLE_PROVIDER_IDS.add('openai');
if (process.env.ANTHROPIC_API_KEY) AVAILABLE_PROVIDER_IDS.add('anthropic');
if (process.env.GOOGLE_API_KEY) AVAILABLE_PROVIDER_IDS.add('google');
if (process.env.COHERE_API_KEY) AVAILABLE_PROVIDER_IDS.add('cohere');
if (process.env.TOGETHER_API_KEY) AVAILABLE_PROVIDER_IDS.add('together');
if (process.env.REPLICATE_API_TOKEN) AVAILABLE_PROVIDER_IDS.add('replicate');
if (process.env.PORTKEY_API_KEY) AVAILABLE_PROVIDER_IDS.add('portkey');
if (process.env.MISTRAL_API_KEY) AVAILABLE_PROVIDER_IDS.add('mistral');
if (process.env.zen_API_KEY) AVAILABLE_PROVIDER_IDS.add('zen');
if (process.env.OPENROUTER_API_KEY) AVAILABLE_PROVIDER_IDS.add('openrouter');
if (process.env.CHUTES_API_KEY) AVAILABLE_PROVIDER_IDS.add('chutes');
if (process.env.GITHUB_MODELS_API_KEY || process.env.AZURE_OPENAI_API_KEY) AVAILABLE_PROVIDER_IDS.add('github');
if (process.env.COMPOSIO_API_KEY) AVAILABLE_PROVIDER_IDS.add('composio');
// OpenCode is always available (local)
AVAILABLE_PROVIDER_IDS.add('opencode');

export async function GET(request: NextRequest) {
  try {
    const now = Date.now();
    
    // Return cached result if available and not expired
    if (cachedProviders && (now - cacheTimestamp) < CACHE_TTL_MS) {
      return NextResponse.json(cachedProviders);
    }
    
    // Build provider list from static PROVIDERS constant
    const allProviders = (Object.values(PROVIDERS) as LLMProvider[])
      .map((provider: LLMProvider) => {
        const isAvailable = AVAILABLE_PROVIDER_IDS.has(provider.id);
        return {
          id: provider.id,
          name: provider.name,
          models: provider.models,
          supportsStreaming: provider.supportsStreaming,
          maxTokens: provider.maxTokens,
          description: provider.description,
          isAvailable
        };
      });

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
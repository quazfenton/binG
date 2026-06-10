import { NextRequest, NextResponse } from "next/server";
import { PROVIDER_DEFAULT_MODELS } from "@/lib/providers/provider-default-models";



// Use dynamic import to avoid pulling AWS SDK into client bundle
// The PROVIDERS constant and llmService are server-only
let _providersCache: any = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 300000;

export async function GET(request: NextRequest) {
  try {
    const now = Date.now();

    // Return cached result if available and not expired
    if (_providersCache && (now - _cacheTime) < CACHE_TTL_MS) {
      return NextResponse.json(_providersCache, {
        headers: {
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        },
      });
    }

    // Dynamic import — server-side only, avoids client bundle contamination
    const { PROVIDERS, llmService } = await import('@/lib/providers/llm-providers');
    const availableProviderIds = new Set(
      llmService.getAvailableProviders().map((p: any) => p.id)
    );

    const allProviders = (Object.values(PROVIDERS) as any[])
      .map((provider: any) => ({
        id: provider.id,
        name: provider.name,
        models: provider.models,
        supportsStreaming: provider.supportsStreaming,
        maxTokens: provider.maxTokens,
        description: provider.description,
        isAvailable: availableProviderIds.has(provider.id)
      }));

    const sortedProviders = allProviders.sort((a: any, b: any) => {
      if (a.isAvailable && !b.isAvailable) return -1;
      if (!a.isAvailable && b.isAvailable) return 1;
      return 0;
    });

    _providersCache = {
      success: true,
      data: {
        providers: sortedProviders,
        defaultProvider: process.env.DEFAULT_LLM_PROVIDER || "mistral",
        defaultModel: process.env.DEFAULT_MODEL || "mistral-large-latest",
      },
    };
    _cacheTime = now;

    return NextResponse.json(_providersCache, {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    // Surface the actual error details — dynamic import failures, module init errors,
    // or SDK loading failures are all silently swallowed by the generic message.
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    console.error("Error fetching providers:", errMsg, errStack?.split('\n').slice(0, 3).join('\n'));
    // Only expose error details in development — in production, return generic message
    const isDev = process.env.NODE_ENV === 'development';
    // Fallback: return static providers when dynamic import fails
    try {
      const staticProviders = Object.entries(PROVIDER_DEFAULT_MODELS).map(([id, defaultModel]) => ({
        id,
        name: id,
        models: [defaultModel],
        supportsStreaming: true,
        maxTokens: 4096,
        description: id + ' (static fallback)',
        isAvailable: !!process.env[(id.toUpperCase() + '_API_KEY')],
      }));
      return NextResponse.json({
        success: true,
        data: {
          providers: staticProviders,
          defaultProvider: process.env.DEFAULT_LLM_PROVIDER || 'mistral',
          defaultModel: process.env.DEFAULT_MODEL || 'mistral-large-latest',
        },
        _fallback: true,
      }, {
        headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
      });
    } catch {
      return NextResponse.json(
        { error: "Failed to fetch available providers", ...(isDev ? { detail: errMsg } : {}) },
        { status: 500 },
      );
    }
  }
}

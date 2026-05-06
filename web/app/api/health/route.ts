import { NextRequest, NextResponse } from 'next/server';

import { enhancedLLMService } from '@/lib/chat/enhanced-llm-service';
import { enhancedAPIClient } from '@/lib/chat/enhanced-api-client';
import { errorHandler } from '@/lib/chat/error-handler';

// GET /api/health — basic or detailed health check
export async function GET(request: NextRequest) {
  try {
    const detailed = request.nextUrl.searchParams.get('detailed') === 'true';

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
    };

    if (detailed) {
      const providerHealth = enhancedLLMService.getProviderHealth();
      const circuitBreakerStats = enhancedAPIClient.getCircuitBreakerStats();
      const errorStats = errorHandler.getErrorStats();
      const availableProviders = enhancedLLMService.getAvailableProviders();

      return NextResponse.json({
        ...health,
        providers: {
          available: availableProviders,
          health: providerHealth,
          total: Object.keys(providerHealth).length,
        },
        circuitBreakers: circuitBreakerStats,
        errors: {
          stats: errorStats,
          frequent: errorHandler.getFrequentErrors(3),
        },
        system: {
          memory: process.memoryUsage(),
          nodeVersion: process.version,
          platform: process.platform,
        },
      });
    }

    return NextResponse.json(health);
  } catch (error) {
    console.error('Health check error:', error);
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    );
  }
}

// POST /api/health/reset-circuit-breaker | /api/health/clear-error-stats | /api/health/test-provider
export async function POST(request: NextRequest) {
  try {
    const path = request.nextUrl.pathname;
    const segments = path.split('/').filter(Boolean);

    if (segments.length !== 3) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (segments[2] === 'reset-circuit-breaker' || segments[2] === 'clear-error-stats') {
      const body = await request.json();
      const provider = body?.provider;

      if (segments[2] === 'reset-circuit-breaker') {
        enhancedLLMService.resetProviderHealth(provider);
        return NextResponse.json({
          success: true,
          message: provider ? `Circuit breaker reset for ${provider}` : 'All circuit breakers reset',
        });
      }

      errorHandler.clearErrorStats();
      return NextResponse.json({ success: true, message: 'Error statistics cleared' });
    }

    if (segments[2] === 'test-provider') {
      const body = await request.json();
      const provider = body?.provider;

      if (!provider) {
        return NextResponse.json({ error: 'Provider parameter required for test' }, { status: 400 });
      }

      try {
        await enhancedLLMService.generateResponse({
          messages: [{ role: 'user' as const, content: 'Hello' }],
          provider,
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 10,
          stream: false,
          apiKeys: {},
        });
        return NextResponse.json({ success: true, message: `Provider ${provider} is healthy` });
      } catch (testError) {
        return NextResponse.json({
          success: false,
          message: `Provider ${provider} test failed`,
          error: testError instanceof Error ? testError.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    console.error('Health action error:', error);
    return NextResponse.json(
      { error: 'Failed to execute health action', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// OPTIONS preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
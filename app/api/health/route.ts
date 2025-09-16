import { NextRequest, NextResponse } from "next/server";
import { enhancedLLMService } from "@/lib/api/enhanced-llm-service";
import { enhancedAPIClient } from "@/lib/api/enhanced-api-client";
import { errorHandler } from "@/lib/api/error-handler";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const detailed = url.searchParams.get('detailed') === 'true';

    // Basic health check
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0'
    };

    if (detailed) {
      // Get detailed health information
      const providerHealth = enhancedLLMService.getProviderHealth();
      const circuitBreakerStats = enhancedAPIClient.getCircuitBreakerStats();
      const errorStats = errorHandler.getErrorStats();
      const availableProviders = enhancedLLMService.getAvailableProviders();

      return NextResponse.json({
        ...health,
        providers: {
          available: availableProviders,
          health: providerHealth,
          total: Object.keys(providerHealth).length
        },
        circuitBreakers: circuitBreakerStats,
        errors: {
          stats: errorStats,
          frequent: errorHandler.getFrequentErrors(3)
        },
        system: {
          memory: process.memoryUsage(),
          nodeVersion: process.version,
          platform: process.platform
        }
      });
    }

    return NextResponse.json(health);
  } catch (error) {
    console.error("Health check error:", error);
    
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 503 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, provider } = body;

    switch (action) {
      case 'reset-circuit-breaker':
        enhancedLLMService.resetProviderHealth(provider);
        return NextResponse.json({
          success: true,
          message: provider 
            ? `Circuit breaker reset for ${provider}` 
            : 'All circuit breakers reset'
        });

      case 'clear-error-stats':
        errorHandler.clearErrorStats();
        return NextResponse.json({
          success: true,
          message: 'Error statistics cleared'
        });

      case 'test-provider':
        if (!provider) {
          return NextResponse.json(
            { error: 'Provider parameter required for test' },
            { status: 400 }
          );
        }

        // Test provider with a simple request
        const testRequest = {
          messages: [{ role: 'user' as const, content: 'Hello' }],
          provider,
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 10,
          stream: false,
          apiKeys: {}
        };

        try {
          await enhancedLLMService.generateResponse(testRequest);
          return NextResponse.json({
            success: true,
            message: `Provider ${provider} is healthy`
          });
        } catch (testError) {
          return NextResponse.json({
            success: false,
            message: `Provider ${provider} test failed`,
            error: testError instanceof Error ? testError.message : 'Unknown error'
          });
        }

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Health action error:", error);
    
    return NextResponse.json(
      {
        error: "Failed to execute health action",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

// Handle preflight requests for CORS
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
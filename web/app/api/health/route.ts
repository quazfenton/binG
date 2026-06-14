import { NextRequest, NextResponse } from "next/server";
import { enhancedLLMService } from "@/lib/chat/enhanced-llm-service";
import { enhancedAPIClient } from "@/lib/chat/enhanced-api-client";
import { errorHandler } from '@/lib/errors/error-handler';

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

      // Bug #8: surface the processMemoryMonitor status so operators can see
      // soft-throttle/critical crossings and the most recent heap snapshot
      // path. Importing here (not at module top) keeps the cold-start path
      // free of the monitor's import graph and lets the monitor auto-start
      // lazily on first status read.
      const { processMemoryMonitor } = await import('@/lib/management/process-memory-monitor');
      const memoryStatus = processMemoryMonitor.getStatus();

      // Bug #11: surface the VFS snapshot cache hit/miss/stale/invalidation
      // counters so operators can verify the cache is doing its job.
      const { vfsSnapshotCacheMetrics: vfsCacheMetrics } = await import('@/app/api/filesystem/snapshot/cache-metrics');
      const snapshotCache = vfsCacheMetrics.snapshot();

      // Bug #38/#64: surface the cross-process snapshot broadcaster health so
      // operators can see whether Redis pub/sub is connected, how many EPIPE
      // reconnects have happened, publisher vs subscriber health, and the last
      // error timestamp. The broadcaster is best-effort: if it's degraded, the
      // single-process path still works — but cross-process invalidation is
      // broken, so the warning is loud.
      const { getSnapshotBroadcaster } = await import('@/lib/virtual-filesystem/snapshot-broadcaster');
      let snapshotBroadcasterHealth: Record<string, unknown> = { isRedisBacked: false };
      try {
        const broadcaster = getSnapshotBroadcaster();
        snapshotBroadcasterHealth = {
          ...broadcaster.getHealth(),
        };
      } catch (err) {
        snapshotBroadcasterHealth = {
          isRedisBacked: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Bug #40: surface the per-session orchestration-fallback counters
      // (incremented by tagResultDegraded in unified-agent-service.ts).
      // Operators use these to detect chronic orchestrator degradation —
      // a steady stream of fallbacks means the orchestrator is hitting
      // its budget cap or crashing, and the v1-api text-mode path is
      // shouldering the load. Importing here (not at module top) keeps
      // the cold-start path free of the degradation-tracker import graph.
      const { getTotalOrchestrationFallbackCount, getOrchestrationFallbackSnapshot } =
        await import('@/lib/observability/degradation-tracker');
      const orchestrationFallback = {
        total: getTotalOrchestrationFallbackCount(),
        // Top 5 sessions by count — sessionId can be PII so we cap the
        // list to a small number and don't echo it verbatim in operator
        // dashboards without redaction.
        topSessions: getOrchestrationFallbackSnapshot().slice(0, 5),
      };

      // Bug #66: surface the classifier-fallback counter so operators can
      // detect chronic classifier degradation without grepping run.log.
      const { getChatMetrics } = await import('@/lib/chat/chat-metrics');
      const chatMetrics = getChatMetrics();

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
        // Bug #40: orchestration-fallback counts (per-session + aggregate).
        // Surfaced here so /api/health?detailed can detect chronic
        // orchestrator degradation without needing to grep run.log.
        orchestrationFallback,
        // Bug #66: classifier-fallback count — when this is non-zero,
        // the multi-factor task classifier is degraded and the system
        // is using regex-based detection exclusively.
        classifier: {
          fallbackCount: chatMetrics.classifierFallbacks.count,
          enabled: process.env.ENABLE_TASK_CLASSIFIER === 'true',
        },
        system: {
          memory: process.memoryUsage(),
          memoryMonitor: memoryStatus,
          snapshotCache: {
            ...snapshotCache,
            // Reuse the metrics object's derived methods instead of inlining
            // the calculation. The metrics object owns the formula; the
            // health endpoint just surfaces it.
            averageExportMs: vfsCacheMetrics.getAverageExportMs(),
            hitRatio: vfsCacheMetrics.getHitRatio(),
          },
          snapshotBroadcaster: snapshotBroadcasterHealth,
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
export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || '*',
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { fastAgentService } from "@/lib/api/fast-agent-service";

/**
 * Fast-Agent health check endpoint
 */

export async function GET(request: NextRequest) {
  try {
    const isHealthy = await fastAgentService.healthCheck();
    const config = fastAgentService.getConfig();

    return NextResponse.json({
      healthy: isHealthy,
      enabled: fastAgentService.isEnabled(),
      endpoint: config.endpoint,
      timestamp: new Date().toISOString(),
      status: isHealthy ? 'ok' : 'unhealthy'
    });
  } catch (error) {
    return NextResponse.json(
      {
        healthy: false,
        enabled: false,
        error: 'Health check failed',
        timestamp: new Date().toISOString()
      },
      { status: 503 }
    );
  }
}

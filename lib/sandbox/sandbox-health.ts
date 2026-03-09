/**
 * Sandbox Health Check Module
 * 
 * Provides health monitoring for sandbox sessions.
 * Detects dead sessions and provides latency metrics.
 */

import { getAllActiveSessions } from './session-store';
import { sandboxBridge } from './sandbox-service-bridge';

// Health check cache
const healthCheckCache = new Map<string, {
  healthy: boolean;
  latency?: number;
  lastCheck: number;
  error?: string;
}>();

/**
 * Health check result
 */
export interface HealthCheckResult {
  sandboxId: string;
  healthy: boolean;
  latency?: number;
  error?: string;
  lastCheck: number;
}

/**
 * Check health of a single sandbox
 * 
 * @param sandboxId - Sandbox ID to check
 * @param useCache - Use cached result if available (10 second cache)
 * @returns Health status with latency
 */
export async function checkSandboxHealth(
  sandboxId: string,
  useCache: boolean = true
): Promise<HealthCheckResult> {
  // Check cache first (10 second cache)
  const cached = healthCheckCache.get(sandboxId);
  if (useCache && cached && Date.now() - cached.lastCheck < 10000) {
    return {
      sandboxId,
      healthy: cached.healthy,
      latency: cached.latency,
      error: cached.error,
      lastCheck: cached.lastCheck,
    };
  }

  const startTime = Date.now();

  try {
    // Try to execute a simple health check command
    const result = await sandboxBridge.executeCommand(sandboxId, 'echo health', undefined, 5000);
    
    const latency = Date.now() - startTime;
    
    const healthResult = {
      sandboxId,
      healthy: result.success,
      latency,
      lastCheck: Date.now(),
    };

    // Cache the result
    healthCheckCache.set(sandboxId, healthResult);

    return healthResult;
  } catch (error: any) {
    const healthResult = {
      sandboxId,
      healthy: false,
      error: error.message || 'Health check failed',
      lastCheck: Date.now(),
    };

    // Cache the failure
    healthCheckCache.set(sandboxId, healthResult);

    return healthResult;
  }
}

/**
 * Check health of all active sandboxes
 * 
 * @returns Health status for all sandboxes
 */
export async function checkAllSandboxHealth(): Promise<Record<string, HealthCheckResult>> {
  const sessions = getAllActiveSessions();
  const healthStatus: Record<string, HealthCheckResult> = {};

  for (const session of sessions) {
    healthStatus[session.sandboxId] = await checkSandboxHealth(session.sandboxId);
  }

  return healthStatus;
}

/**
 * Get summary of sandbox health
 * 
 * @returns Summary statistics
 */
export async function getSandboxHealthSummary(): Promise<{
  total: number;
  healthy: number;
  unhealthy: number;
  averageLatency: number;
  unhealthyIds: string[];
}> {
  const healthStatus = await checkAllSandboxHealth();
  const values = Object.values(healthStatus);

  const healthy = values.filter(h => h.healthy).length;
  const unhealthy = values.filter(h => !h.healthy).length;
  const unhealthyIds = values.filter(h => !h.healthy).map(h => h.sandboxId);
  
  const latencies = values.filter(h => h.latency).map(h => h.latency!);
  const averageLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0;

  return {
    total: values.length,
    healthy,
    unhealthy,
    averageLatency: Math.round(averageLatency),
    unhealthyIds,
  };
}

/**
 * Clear health check cache
 * 
 * @param sandboxId - Specific sandbox to clear (or all if not provided)
 */
export function clearHealthCache(sandboxId?: string): void {
  if (sandboxId) {
    healthCheckCache.delete(sandboxId);
  } else {
    healthCheckCache.clear();
  }
}

/**
 * Get cached health status without running new check
 * 
 * @param sandboxId - Sandbox ID
 * @returns Cached health status or undefined
 */
export function getCachedHealth(sandboxId: string): HealthCheckResult | undefined {
  const cached = healthCheckCache.get(sandboxId);
  if (!cached) return undefined;

  return {
    sandboxId,
    ...cached,
  };
}

/**
 * Unified Model Health Tracking
 * 
 * Wraps circuit-breaker for V1 (API-based modes) and adds health tracking
 * for V2 (CLI/spawn-based modes).
 * 
 * Provides a unified interface for:
 * - V1 modes: circuit-breaker + model-ranker tracking
 * - V2 modes: CLI binary availability, exit codes
 * - Remote SDKs: HTTP endpoint health
 */

import { createLogger } from '@/lib/utils/logger';
import { 
  circuitBreakerManager, 
  type CircuitState,
  getCircuitStateName 
} from '@/lib/middleware/circuit-breaker';

const log = createLogger('Model:Health');

// Health states for different architectures
export type HealthState = 'healthy' | 'degraded' | 'unhealthy';
export type Architecture = 'v1-api' | 'v2-cli' | 'v2-http-sdk' | 'v2-container';

// Track V2 health separately from circuit-breaker
interface V2HealthState {
  state: HealthState;
  consecutiveFailures: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  totalAttempts: number;
  totalSuccesses: number;
}

// V2 health tracking: binary/server availability
const v2Health = new Map<string, V2HealthState>();

const V2_FAILURE_THRESHOLD = 3;
const V2_RECOVERY_WINDOW_MS = 60_000;
const V2_DECAY_WINDOW_MS = 30_000;

/**
 * Get health state for any mode
 */
export function getHealthState(architecture: Architecture, provider?: string): HealthState {
  if (architecture === 'v1-api') {
    if (!provider) return 'healthy';
    const breaker = circuitBreakerManager?.getBreaker(provider);
    if (!breaker) return 'healthy';
    const state = breaker.getState();
    if (state === 'OPEN') return 'unhealthy';
    if (state === 'HALF-OPEN') return 'degraded';
    return 'healthy';
  }

  // V2 health from our tracking
  const key = provider || 'default';
  const health = v2Health.get(key);
  if (!health) return 'healthy';
  if (health.consecutiveFailures >= V2_FAILURE_THRESHOLD) return 'unhealthy';
  if (health.consecutiveFailures > 0) return 'degraded';
  return 'healthy';
}

/**
 * Record success for a mode
 */
export function recordSuccess(architecture: Architecture, provider?: string): void {
  const key = provider || 'default';

  if (architecture === 'v1-api' && provider) {
    try {
      circuitBreakerManager?.recordAttempt(provider, true);
    } catch { /* ignore */ }
    return;
  }

  // V2: track success
  const health = v2Health.get(key) || {
    state: 'healthy',
    consecutiveFailures: 0,
    lastFailureTime: 0,
    lastSuccessTime: Date.now(),
    totalAttempts: 0,
    totalSuccesses: 0,
  };
  health.consecutiveFailures = 0;
  health.lastSuccessTime = Date.now();
  health.totalAttempts++;
  health.totalSuccesses++;
  health.state = 'healthy';
  v2Health.set(key, health);

  log.debug('[V2] Success recorded', { provider: key, state: health.state });
}

/**
 * Record failure for a mode
 */
export function recordFailure(
  architecture: Architecture, 
  provider?: string, 
  error?: string
): void {
  const key = provider || 'default';
  const now = Date.now();

  if (architecture === 'v1-api' && provider) {
    try {
      circuitBreakerManager?.recordAttempt(provider, false);
      // Record rate limit errors specially
      if (error?.includes('429') || error?.includes('rate limit')) {
        circuitBreakerManager?.recordRateLimit(provider);
      }
    } catch { /* ignore */ }
    return;
  }

  // V2: track failure
  const health = v2Health.get(key) || {
    state: 'healthy',
    consecutiveFailures: 0,
    lastFailureTime: now,
    lastSuccessTime: 0,
    totalAttempts: 0,
    totalSuccesses: 0,
  };
  
  // Decay failure count if stale
  if (now - health.lastFailureTime > V2_DECAY_WINDOW_MS) {
    health.consecutiveFailures = 0;
  }
  
  health.consecutiveFailures++;
  health.lastFailureTime = now;
  health.totalAttempts++;
  health.state = health.consecutiveFailures >= V2_FAILURE_THRESHOLD 
    ? 'unhealthy' 
    : 'degraded';
  
  v2Health.set(key, health);

  log.warn('[V2] Failure recorded', { 
    provider: key, 
    consecutiveFailures: health.consecutiveFailures,
    state: health.state,
    error,
  });
}

/**
 * Is a mode available for use?
 */
export function isModeHealthy(architecture: Architecture, provider?: string): boolean {
  return getHealthState(architecture, provider) !== 'unhealthy';
}

/**
 * Get health summary for observability
 */
export function getHealthSummary(): Record<string, {
  state: HealthState;
  architecture: Architecture;
  consecutiveFailures?: number;
  totalAttempts: number;
  successRate: number;
}> {
  const summary: Record<string, any> = {};

  // V1: from circuit-breaker
  try {
    const providers = circuitBreakerManager?.getProviders?.() || [];
    for (const provider of providers) {
      const breaker = circuitBreakerManager?.getBreaker(provider);
      if (!breaker) continue;
      const state = breaker.getState();
      summary[provider] = {
        architecture: 'v1-api' as Architecture,
        state: state === 'OPEN' ? 'unhealthy' : state === 'HALF-OPEN' ? 'degraded' : 'healthy',
        totalAttempts: breaker['failureCount'] || 0,
        successRate: 1 - ((breaker['failureCount'] || 0) / Math.max(breaker['successCount'] || 1, 1)),
      };
    }
  } catch { /* circuit-breaker unavailable */ }

  // V2: from our tracking
  for (const [key, health] of v2Health) {
    summary[`v2:${key}`] = {
      architecture: 'v2-cli' as Architecture,
      state: health.state,
      consecutiveFailures: health.consecutiveFailures,
      totalAttempts: health.totalAttempts,
      successRate: health.totalAttempts > 0 
        ? health.totalSuccesses / health.totalAttempts 
        : 1,
    };
  }

  return summary;
}

/**
 * Reset health state (for testing or manual reset)
 */
export function resetHealth(architecture: Architecture, provider?: string): void {
  const key = provider || 'default';
  
  if (architecture === 'v1-api' && provider) {
    try {
      circuitBreakerManager?.reset?.(provider);
    } catch { /* ignore */ }
    return;
  }

  v2Health.delete(key);
  log.info('[Health] Reset', { architecture, provider: key });
}
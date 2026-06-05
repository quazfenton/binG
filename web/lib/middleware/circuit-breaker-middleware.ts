/**
 * API Route Circuit Breaker Middleware
 *
 * Wraps Next.js API route handlers with circuit breaker protection to prevent
 * cascading failures when downstream services (LLM providers, sandbox providers)
 * are unhealthy.
 *
 * Each route gets its own circuit breaker instance keyed by the route path.
 * When a route's downstream dependencies are failing repeatedly, the circuit
 * opens and subsequent requests fail fast with a 503 Service Unavailable,
 * giving the downstream services time to recover.
 *
 * @example
 * ```typescript
 * // In an API route handler:
 * export async function POST(request: NextRequest) {
 *   const result = await withRouteCircuitBreaker(
 *     '/api/chat',
 *     async () => {
 *       // Your route logic here
 *       return NextResponse.json({ success: true });
 *     },
 *     request,
 *   );
 *   return result;
 * }
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  CircuitBreaker,
  CircuitBreakerError,
} from '@/lib/utils/circuit-breaker';

interface RouteCircuitBreakerEntry {
  breaker: CircuitBreaker;
  createdAt: number;
  lastStateChange: number;
}

const routeBreakers = new Map<string, RouteCircuitBreakerEntry>();

const DEFAULT_ROUTE_BREAKER_OPTIONS = {
  failureThreshold: 5,     // Open after 5 consecutive failures
  recoveryTimeout: 30000,  // Try recovery after 30 seconds
  successThreshold: 2,     // Close after 2 consecutive successes
};

/**
 * Wrap a route handler with circuit breaker protection.
 *
 * When the circuit is OPEN, returns 503 immediately without executing the handler.
 * When the circuit is HEALTHY or HALF_OPEN, executes the handler normally and
 * records success/failure to update the circuit state.
 *
 * @param routeKey - Unique identifier for this route (e.g., '/api/chat')
 * @param handler - The route handler function
 * @param request - The incoming NextRequest (for logging)
 * @returns NextResponse from handler, or 503 if circuit is open
 */
export async function withRouteCircuitBreaker(
  routeKey: string,
  handler: () => Promise<NextResponse>,
  _request?: NextRequest,
): Promise<NextResponse> {
  let entry = routeBreakers.get(routeKey);

  if (!entry) {
    const breaker = new CircuitBreaker({
      ...DEFAULT_ROUTE_BREAKER_OPTIONS,
      name: `route:${routeKey}`,
    });

    entry = {
      breaker,
      createdAt: Date.now(),
      lastStateChange: Date.now(),
    };

    // Track state changes
    breaker.on('stateChange', ({ oldState, newState }) => {
      entry!.lastStateChange = Date.now();
      console.warn(
        `[RouteCircuitBreaker:${routeKey}] State change: ${oldState} → ${newState}`,
      );
    });

    routeBreakers.set(routeKey, entry);
  }

  try {
    const result = await entry.breaker.execute(handler);
    return result;
  } catch (error: any) {
    if (error instanceof CircuitBreakerError) {
      console.warn(
        `[RouteCircuitBreaker:${routeKey}] Circuit OPEN — failing fast`,
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Service temporarily unavailable',
          retryAfter: 30,
          circuitState: error.state,
        },
        {
          status: 503,
          headers: {
            'Retry-After': '30',
            'X-Circuit-State': error.state,
          },
        },
      );
    }

    // Non-circuit-breaker errors — pass through
    throw error;
  }
}

/**
 * Check whether a route's circuit breaker is currently OPEN.
 * Does NOT record success/failure and does NOT reset counters.
 * Note: internally, canExecute() may auto-transition OPEN→HALF_OPEN
 * when the recovery timeout has elapsed (this is standard circuit breaker
 * behavior — the first probe after the timeout is allowed through).
 * Use this for pre-flight checks before processing a request.
 *
 * @example
 * ```typescript
 * // At the top of your API route, before expensive work:
 * if (checkRouteCircuitBreaker('/api/chat')) {
 *   return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
 * }
 * ```
 */
export function checkRouteCircuitBreaker(routeKey: string): boolean {
  const entry = routeBreakers.get(routeKey);
  if (!entry) return false; // No breaker = assume healthy

  return !entry.breaker.canExecute();
}

/**
 * Record a success or failure for a route's circuit breaker.
 * Call this after the actual downstream call completes to track the outcome.
 *
 * IMPORTANT: This cannot close an OPEN circuit on its own — it relies on the
 * recovery timeout to transition OPEN→HALF_OPEN first. Once in HALF_OPEN,
 * recording a success will close the circuit and recording a failure will
 * reopen it. See the CircuitBreaker class for details.
 *
 * @example
 * ```typescript
 * try {
 *   const result = await llmProvider.call(messages);
 *   recordRouteCircuitBreakerResult('/api/chat', true);
 * } catch (error) {
 *   recordRouteCircuitBreakerResult('/api/chat', false, error);
 * }
 * ```
 */
export async function recordRouteCircuitBreakerResult(
  routeKey: string,
  success: boolean,
  error?: Error,
): Promise<void> {
  const entry = routeBreakers.get(routeKey);
  if (!entry) return;

  if (success) {
    // Manually trigger onSuccess behavior without executing a handler
    // This calls the private method via a no-op execute
    try {
      await entry.breaker.execute(async () => undefined as any);
    } catch {
      // Ignore — the no-op handler should never throw
    }
  } else {
    // Trigger onFailure by executing a handler that throws
    try {
      await entry.breaker.execute(async () => {
        throw error ?? new Error('Unknown failure');
      });
    } catch {
      // Expected — the breaker caught the failure
    }
  }
}

/**
 * Get circuit breaker stats for all routes (useful for health check endpoints).
 */
export function getRouteCircuitBreakerStats(): Record<
  string,
  {
    state: string;
    failureCount: number;
    successCount: number;
    lastFailureTime: string | null;
  }
> {
  const stats: Record<string, any> = {};

  for (const [routeKey, entry] of routeBreakers.entries()) {
    const breakerStats = entry.breaker.getStats();
    stats[routeKey] = {
      state: breakerStats.state,
      failureCount: breakerStats.failureCount,
      successCount: breakerStats.successCount,
      lastFailureTime: breakerStats.lastFailureTime?.toISOString() ?? null,
    };
  }

  return stats;
}

/**
 * Reset circuit breaker for a specific route (useful for admin/admin recovery).
 */
export function resetRouteCircuitBreaker(routeKey: string): void {
  const entry = routeBreakers.get(routeKey);
  if (entry) {
    entry.breaker.reset();
  }
}

/**
 * Reset all route circuit breakers.
 */
export function resetAllRouteCircuitBreakers(): void {
  for (const entry of routeBreakers.values()) {
    entry.breaker.reset();
  }
  routeBreakers.clear();
}

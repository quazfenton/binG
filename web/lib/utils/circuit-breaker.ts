/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures by failing fast when a service is unhealthy.
 * Based on Martin Fowler's circuit breaker pattern.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests fail immediately
 * - HALF_OPEN: Testing if service has recovered
 *
 * @see https://martinfowler.com/bliki/CircuitBreaker.html
 */

export type CircuitState = 'HEALTHY' | 'OPEN' | 'HALF_OPEN' | 'TESTING';

/** Human-readable state names */
export function getCircuitStateName(state: CircuitState): string {
  switch (state) {
    case 'HEALTHY': return 'HEALTHY';
    case 'HALF_OPEN':
    case 'TESTING': return 'TESTING';
    case 'OPEN': return 'BLOCKED';
  }
}

export interface CircuitBreakerOptions {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in ms before attempting recovery (OPEN → HALF_OPEN) */
  recoveryTimeout: number;
  /** Number of successful calls in HALF_OPEN to close circuit */
  successThreshold: number;
  /** Optional name for logging */
  name?: string;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 8,
  recoveryTimeout: 20000, // 20 seconds
  successThreshold: 2,
  name: 'default',
};

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly state: CircuitState,
    public readonly lastError?: Error
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = 'HEALTHY';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private lastFailureError: Error | null = null;
  private nextAttemptTime: number | null = null;

  private readonly options: Required<CircuitBreakerOptions>;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options } as Required<CircuitBreakerOptions>;
  }

  /**
   * Execute a function with circuit breaker protection
   *
   * @example
   * ```typescript
   * const result = await circuitBreaker.execute(async () => {
   *   return await provider.createSandbox(config);
   * });
   * ```
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      const error = new CircuitBreakerError(
        `Circuit breaker is ${this.state} - service unavailable`,
        this.state,
        this.lastFailureError || undefined
      );
      this.emit('rejected', { state: this.state, error });
      throw error;
    }

    const startTime = Date.now();

    try {
      const result = await fn();
      this.onSuccess();
      this.emit('success', { duration: Date.now() - startTime });
      return result;
    } catch (error: any) {
      this.onFailure(error);
      this.emit('failure', { error, duration: Date.now() - startTime });
      throw error;
    }
  }

  /**
   * Check if circuit breaker allows execution
   */
  canExecute(): boolean {
    switch (this.state) {
      case 'HEALTHY':
        return true;

      case 'OPEN':
        // Check if recovery timeout has elapsed
        if (this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
          this.transitionTo('HALF_OPEN');
          return true;
        }
        return false;

      case 'HALF_OPEN':
        return true;

      default:
        return false;
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    // Auto-transition from OPEN to HALF_OPEN if timeout elapsed
    if (this.state === 'OPEN' && this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
      this.transitionTo('HALF_OPEN');
    }
    return this.state;
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: Date | null;
    nextAttemptTime: Date | null;
  } {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime) : null,
      nextAttemptTime: this.nextAttemptTime ? new Date(this.nextAttemptTime) : null,
    };
  }

  /**
   * Reset circuit breaker to initial state
   */
  reset(): void {
    this.state = 'HEALTHY';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastFailureError = null;
    this.nextAttemptTime = null;
    this.emit('reset');
  }

  private onSuccess(): void {
    this.successCount++;

    if (this.state === 'HALF_OPEN') {
      if (this.successCount >= this.options.successThreshold) {
        this.transitionTo('HEALTHY');
      }
    } else if (this.state === 'HEALTHY') {
      // Reset failure count on success in CLOSED state
      this.failureCount = 0;
    }
  }

  private onFailure(error: Error): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.lastFailureError = error;

    if (this.state === 'HALF_OPEN') {
      // Any failure in HALF_OPEN immediately opens circuit
      this.transitionTo('OPEN');
    } else if (this.state === 'HEALTHY') {
      if (this.failureCount >= this.options.failureThreshold) {
        this.transitionTo('OPEN');
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    console.log(
      `[CircuitBreaker:${this.options.name}] State transition: ${oldState} → ${newState}`,
      {
        failureCount: this.failureCount,
        successCount: this.successCount,
      }
    );

    this.emit('stateChange', { oldState, newState });

    switch (newState) {
      case 'OPEN':
        this.nextAttemptTime = Date.now() + this.options.recoveryTimeout;
        this.successCount = 0;
        break;

      case 'HALF_OPEN':
        this.successCount = 0;
        break;

      case 'HEALTHY':
        this.failureCount = 0;
        this.successCount = 0;
        this.nextAttemptTime = null;
        break;
    }
  }
}

// ==================== Provider Circuit Breaker Registry ====================

import { EventEmitter } from 'events';
import type { SandboxProviderType } from '@/lib/sandbox/providers/index';

interface ProviderCircuitBreaker {
  breaker: CircuitBreaker;
  provider: SandboxProviderType;
  createdAt: number;
  lastStateChange: number;
}

class ProviderCircuitBreakerRegistry extends EventEmitter {
  private registry = new Map<SandboxProviderType, ProviderCircuitBreaker>();

  /**
   * Get or create circuit breaker for a provider
   */
  get(provider: SandboxProviderType): CircuitBreaker {
    let entry = this.registry.get(provider);

    if (!entry) {
      // Use higher thresholds — the old value of 3 was far too aggressive
      // and would block providers after just a few transient failures
      const breaker = new CircuitBreaker({
        name: `provider:${provider}`,
        failureThreshold: 10,
        recoveryTimeout: 20000, // 20 seconds — recover faster
        successThreshold: 2,
      });

      entry = {
        breaker,
        provider,
        createdAt: Date.now(),
        lastStateChange: Date.now(),
      };

      this.registry.set(provider, entry);

      // Listen for state changes
      breaker.on('stateChange', ({ oldState, newState }) => {
        entry!.lastStateChange = Date.now();
        this.emit('providerStateChange', {
          provider,
          oldState,
          newState,
          timestamp: Date.now(),
        });

        // SAFETY: if this transition leaves zero available providers,
        // force the least-failed one back to CLOSED
        if (newState === 'OPEN') {
          this.enforceLastProviderSafety();
        }
      });
    }

    return entry.breaker;
  }

  /**
   * Check if provider is available (circuit not OPEN)
   */
  isAvailable(provider: SandboxProviderType): boolean {
    const entry = this.registry.get(provider);
    if (!entry) return true; // No breaker = assume available

    return entry.breaker.canExecute();
  }

  /**
   * Get all providers that are available
   */
  getAvailableProviders(providers: SandboxProviderType[]): SandboxProviderType[] {
    return providers.filter(provider => this.isAvailable(provider));
  }

  /**
   * Get circuit breaker stats for all providers
   */
  getAllStats(): Record<SandboxProviderType, any> {
    const stats: Record<string, any> = {};

    for (const [provider, entry] of this.registry.entries()) {
      stats[provider] = entry.breaker.getStats();
    }

    return stats as any;
  }

  /**
   * Reset circuit breaker for a provider
   */
  reset(provider: SandboxProviderType): void {
    const entry = this.registry.get(provider);
    if (entry) {
      entry.breaker.reset();
    }
  }

  /**
   * Remove circuit breaker for a provider
   */
  remove(provider: SandboxProviderType): void {
    this.registry.delete(provider);
  }

  /**
   * SAFETY: If every registered provider has its circuit OPEN, force
   * the one with the lowest failure count back to CLOSED so that at
   * least one route is always available. Never fully block all providers.
   */
  private enforceLastProviderSafety(): void {
    if (this.registry.size === 0) return;

    const available = Array.from(this.registry.values()).filter(
      (e) => e.breaker.canExecute(),
    );

    if (available.length > 0) return; // at least one is still open

    // All are OPEN — find the one with the fewest failures and reset it
    let bestEntry: ProviderCircuitBreaker | null = null;
    let bestFailures = Infinity;

    for (const entry of this.registry.values()) {
      const stats = entry.breaker.getStats();
      if (stats.failureCount < bestFailures) {
        bestFailures = stats.failureCount;
        bestEntry = entry;
      }
    }

    if (bestEntry) {
      bestEntry.breaker.reset();
      console.warn(
        `[ProviderCircuitBreakers] SAFETY: All providers OPEN — forced ` +
          `${bestEntry.provider} back to CLOSED to maintain availability`,
      );
    }
  }
}

// Singleton instance
export const providerCircuitBreakers = new ProviderCircuitBreakerRegistry();

// ==================== Metrics Integration ====================

import { sandboxMetrics } from '@/lib/backend/metrics';

/**
 * Create a circuit breaker with metrics integration
 */
export function createCircuitBreakerWithMetrics(
  provider: SandboxProviderType,
  options?: Partial<CircuitBreakerOptions>
): CircuitBreaker {
  const breaker = new CircuitBreaker({
    ...options,
    name: `provider:${provider}`,
  });

  // Wire to metrics
  breaker.on('success', ({ duration }) => {
    sandboxMetrics.circuitBreakerOperations.inc({
      provider,
      operation: 'call',
      result: 'success',
    } as any);
    sandboxMetrics.circuitBreakerDuration.observe(
      duration / 1000, // Convert milliseconds to seconds
      {
        provider,
        operation: 'call',
      } as any
    );
  });

  breaker.on('failure', ({ error, duration }) => {
    sandboxMetrics.circuitBreakerOperations.inc({
      provider,
      operation: 'call',
      result: 'failure',
    } as any);
    sandboxMetrics.circuitBreakerDuration.observe(
      duration / 1000, // Convert milliseconds to seconds
      {
        provider,
        operation: 'call',
      } as any
    );
  });

  breaker.on('stateChange', ({ oldState, newState }) => {
    sandboxMetrics.circuitBreakerStateChanges.inc({
      provider,
      from: oldState,
      to: newState,
    } as any);
  });

  return breaker;
}


/**
 * Bug #90 (Pass-6, reviewer nit) — schedule a self-reset for the given
 * breaker `cooldownMs` after the failure is recorded. This makes the
 * `resetBreaker()` no longer dead code: any caller of `recordFailureBreaker`
 * automatically gets the breaker half-open at the cooldown boundary.
 * Returns a `setTimeout` handle so callers can `clearTimeout` on success.
 */
export function recordFailureBreaker(
  key: string,
  cooldownMs: number,
): NodeJS.Timeout {
  // Bug #90 (Pass-6, reviewer nit) — validate cooldownMs so a bad config
  // doesn't fire `setTimeout(..., -1)` (Node coerces negative values to ~0,
  // which would reset the breaker immediately — undoing the failure record).
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    cooldownMs = 0;
  }
  const breaker = breakers.get(key);
  breaker?.recordFailure();
  // Bug #90 (Pass-6, reviewer nit) — record an in-process deadline for
  // observability. NOTE: this is module-private memory only — the deadline
  // map is wiped on process restart, so a restarted Node process will start
  // with a tripped breaker and no visible cooldown. For cross-process
  // persistence, the caller would need to write to disk / shared cache.
  const deadline = Date.now() + cooldownMs;
  breakerCooldowns.set(key, deadline);
  return setTimeout(() => {
    breaker?.reset();
    breakerCooldowns.delete(key);
  }, cooldownMs);
}

// Module-private cooldown deadline map (process-local, not persisted to disk).
const breakerCooldowns = new Map<string, number>();

/**
 * Bug #90 (Pass-6) — module-level Map of breaker instances keyed by name.
 * Populated by `recordFailureBreaker()` callers and consulted by the
 * `setTimeout` callback that auto-resets the breaker after the cooldown
 * window expires. Process-local; not persisted across restarts.
 */
const breakers = new Map<string, { recordFailure(): void; reset(): void }>();

/**
 * Bug #90 (Pass-6) — returns the deadline (ms epoch) at which the breaker
 * for `key` will be auto-reset, or `null` if no cooldown is currently
 * scheduled. Useful for callers that want to know how long until retry.
 */
export function getBreakerCooldownUntil(key: string): number | null {
  return breakerCooldowns.get(key) ?? null;
}


/**
 * Bug #90 (Pass-6, reviewer nit) — periodic sweep to evict expired cooldown
 * entries. Without this, the in-memory `breakerCooldowns` map grows
 * unbounded under heavy churn (many different `key` failures). Returns
 * the number of entries evicted (useful for tests + observability).
 */
export function sweepStaleBreakerCooldowns(staleMs: number = 60_000): number {
  const cutoff = Date.now() - staleMs;
  let evicted = 0;
  for (const [key, deadline] of breakerCooldowns) {
    if (deadline < cutoff) {
      breakerCooldowns.delete(key);
      evicted += 1;
    }
  }
  return evicted;
}

// Bug #90 (Pass-6, reviewer nit) — wire the sweeper into a periodic interval
// so the in-memory `breakerCooldowns` map doesn't grow unbounded under heavy
// churn. Default 5 minutes. Returns the interval handle for tests / graceful
// shutdown (`clearInterval(...)`).
const BREAKER_COOLDOWN_SWEEP_INTERVAL = 5 * 60 * 1000;
// Bug #90 (Pass-6, reviewer nit) — gate the setInterval against the
// SANDBOX_TEST env flag so vitest runs don't accumulate zombie timers
// (and the OpenTelemetry / process-wide state stays clean).
const isTestRun = process.env.SANDBOX_TEST === 'true'
  || process.env.NODE_ENV === 'test'
  || (typeof process !== 'undefined' && process.env?.VITEST === 'true');

export const breakerCooldownSweepHandle: NodeJS.Timeout | null = isTestRun
  ? null
  : (() => {
      const handle = setInterval(
        () => { sweepStaleBreakerCooldowns(); },
        BREAKER_COOLDOWN_SWEEP_INTERVAL,
      );
      // `unref()` so the sweep interval never prevents Node exit.
      if (typeof handle.unref === 'function') handle.unref();
      return handle;
    })();

/**
 * Bug #90 (Pass-6) — explicit shutdown hook for graceful cleanup of the
 * cooldown-sweep interval. Call from `beforeAll` / `afterAll` in test
 * shutdown hooks, or from a SIGTERM handler in production.
 */
export function stopBreakerCooldownSweep(): void {
  if (breakerCooldownSweepHandle) {
    clearInterval(breakerCooldownSweepHandle);
  }
}

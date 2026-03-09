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

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

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
  failureThreshold: 5,
  recoveryTimeout: 30000, // 30 seconds
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
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private lastFailureError: Error | null = null;
  private nextAttemptTime: number | null = null;

  private readonly options: Required<CircuitBreakerOptions>;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
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
      case 'CLOSED':
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
    this.state = 'CLOSED';
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
        this.transitionTo('CLOSED');
      }
    } else if (this.state === 'CLOSED') {
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
    } else if (this.state === 'CLOSED') {
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

      case 'CLOSED':
        this.failureCount = 0;
        this.successCount = 0;
        this.nextAttemptTime = null;
        break;
    }
  }
}

// ==================== Provider Circuit Breaker Registry ====================

import { EventEmitter } from 'events';
import type { SandboxProviderType } from '@/lib/sandbox/providers';

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
      const breaker = new CircuitBreaker({
        name: `provider:${provider}`,
        failureThreshold: 3,
        recoveryTimeout: 30000, // 30 seconds
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
    });
    sandboxMetrics.circuitBreakerDuration.observe(
      {
        provider,
        operation: 'call',
      },
      duration / 1000
    );
  });

  breaker.on('failure', ({ error, duration }) => {
    sandboxMetrics.circuitBreakerOperations.inc({
      provider,
      operation: 'call',
      result: 'failure',
    });
    sandboxMetrics.circuitBreakerDuration.observe(
      {
        provider,
        operation: 'call',
      },
      duration / 1000
    );
  });

  breaker.on('stateChange', ({ oldState, newState }) => {
    sandboxMetrics.circuitBreakerStateChanges.inc({
      provider,
      from: oldState,
      to: newState,
    });
  });

  return breaker;
}

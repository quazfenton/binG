/**
 * Circuit Breaker Pattern Implementation
 * 
 * Prevents cascading failures by failing fast when a provider is unhealthy.
 * Implements the circuit breaker pattern with three states:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Provider failing, requests fail immediately
 * - HALF-OPEN: Testing if provider recovered
 * 
 * Features:
 * - Automatic state transitions
 * - Configurable failure thresholds
 * - Recovery timeout
 * - Per-provider isolation
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF-OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;    // Failures before opening circuit
  successThreshold: number;    // Successes before closing circuit (in half-open)
  timeout: number;             // Time in ms before attempting recovery (open -> half-open)
  halfOpenMaxRequests: number; // Max requests allowed in half-open state
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 30000, // 30 seconds
  halfOpenMaxRequests: 3,
};

export interface CircuitBreakerStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rejectedRequests: number; // Rejected due to open circuit
  lastFailureTime?: number;
  lastSuccessTime?: number;
  stateChanges: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime?: number;
  private nextAttemptTime?: number;
  private halfOpenRequests = 0;
  
  private readonly config: CircuitBreakerConfig;
  private readonly providerId: string;
  private readonly stats: CircuitBreakerStats;
  private stateChangeCallbacks: Array<(state: CircuitState) => void> = [];

  constructor(
    providerId: string,
    config: Partial<CircuitBreakerConfig> = {}
  ) {
    this.providerId = providerId;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rejectedRequests: 0,
      stateChanges: 0,
    };
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.stats.totalRequests++;

    // Check if we should allow request
    if (!this.canExecute()) {
      this.stats.rejectedRequests++;
      throw new CircuitBreakerOpenError(
        `Circuit breaker OPEN for ${this.providerId}. Retry after ${this.getRetryAfter()}ms`
      );
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error: any) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Check if request can be executed
   */
  private canExecute(): boolean {
    switch (this.state) {
      case 'CLOSED':
        return true;

      case 'OPEN':
        // Check if timeout has elapsed
        if (this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
          this.transitionTo('HALF-OPEN');
          return true;
        }
        return false;

      case 'HALF-OPEN':
        // Allow limited requests in half-open state
        return this.halfOpenRequests < this.config.halfOpenMaxRequests;

      default:
        return false;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.stats.successfulRequests++;
    this.stats.lastSuccessTime = Date.now();

    switch (this.state) {
      case 'HALF-OPEN':
        this.successCount++;
        if (this.successCount >= this.config.successThreshold) {
          this.transitionTo('CLOSED');
        }
        break;

      case 'CLOSED':
        // Reset failure count on success
        this.failureCount = 0;
        break;
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(error: any): void {
    this.stats.failedRequests++;
    this.stats.lastFailureTime = Date.now();

    switch (this.state) {
      case 'HALF-OPEN':
        // Any failure in half-open state opens circuit again
        this.transitionTo('OPEN');
        break;

      case 'CLOSED':
        this.failureCount++;
        if (this.failureCount >= this.config.failureThreshold) {
          this.transitionTo('OPEN');
        }
        break;
    }
  }

  /**
   * Transition to new state
   */
  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;
    this.stats.stateChanges++;

    // Reset counters based on new state
    switch (newState) {
      case 'CLOSED':
        this.failureCount = 0;
        this.successCount = 0;
        this.halfOpenRequests = 0;
        break;

      case 'OPEN':
        this.nextAttemptTime = Date.now() + this.config.timeout;
        this.successCount = 0;
        break;

      case 'HALF-OPEN':
        this.halfOpenRequests = 0;
        break;
    }

    console.log(
      `[CircuitBreaker:${this.providerId}] State changed: ${oldState} → ${newState}`
    );

    // Notify callbacks
    this.stateChangeCallbacks.forEach(cb => cb(newState));
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    // Check for automatic transition from OPEN to HALF-OPEN
    if (this.state === 'OPEN' && this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
      this.transitionTo('HALF-OPEN');
    }
    return this.state;
  }

  /**
   * Get retry-after time in milliseconds
   */
  getRetryAfter(): number {
    if (this.state !== 'OPEN' || !this.nextAttemptTime) {
      return 0;
    }
    return Math.max(0, this.nextAttemptTime - Date.now());
  }

  /**
   * Get statistics
   */
  getStats(): CircuitBreakerStats & { state: CircuitState } {
    return {
      ...this.stats,
      state: this.getState(),
    };
  }

  /**
   * Reset circuit breaker to initial state
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenRequests = 0;
    this.nextAttemptTime = undefined;
    this.stats.stateChanges++;
  }

  /**
   * Register state change callback
   */
  onStateChange(callback: (state: CircuitState) => void): () => void {
    this.stateChangeCallbacks.push(callback);
    return () => {
      const index = this.stateChangeCallbacks.indexOf(callback);
      if (index > -1) {
        this.stateChangeCallbacks.splice(index, 1);
      }
    };
  }
}

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

/**
 * Circuit Breaker Manager
 * Manages circuit breakers for multiple providers
 */
export class CircuitBreakerManager {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private defaultConfig: Partial<CircuitBreakerConfig> = {};

  constructor(defaultConfig?: Partial<CircuitBreakerConfig>) {
    if (defaultConfig) {
      this.defaultConfig = defaultConfig;
    }
  }

  /**
   * Get or create circuit breaker for provider
   */
  getBreaker(providerId: string): CircuitBreaker {
    let breaker = this.breakers.get(providerId);
    if (!breaker) {
      breaker = new CircuitBreaker(providerId, this.defaultConfig);
      this.breakers.set(providerId, breaker);
    }
    return breaker;
  }

  /**
   * Execute operation with provider's circuit breaker
   */
  async execute<T>(
    providerId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const breaker = this.getBreaker(providerId);
    return breaker.execute(operation);
  }

  /**
   * Get all circuit breaker stats
   */
  getAllStats(): Map<string, CircuitBreakerStats & { state: CircuitState }> {
    const stats = new Map();
    for (const [providerId, breaker] of this.breakers.entries()) {
      stats.set(providerId, breaker.getStats());
    }
    return stats;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Remove circuit breaker for provider
   */
  remove(providerId: string): void {
    this.breakers.delete(providerId);
  }
}

// Export singleton instance
export const circuitBreakerManager = new CircuitBreakerManager();

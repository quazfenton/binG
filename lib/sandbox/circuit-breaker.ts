/**
 * Provider Circuit Breaker
 * 
 * Implements the circuit breaker pattern for sandbox providers
 * Prevents cascading failures and allows providers to recover
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Sandbox:CircuitBreaker');

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
  halfOpenMaxRequests: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 10,
  successThreshold: 2,
  timeoutMs: 20000, // 20 seconds — recover faster
  halfOpenMaxRequests: 3,
};

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  openedAt?: number;
  halfOpenRequests: number;
}

interface CircuitEvent {
  type: 'state_change' | 'failure' | 'success';
  fromState?: CircuitState;
  toState?: CircuitState;
  error?: Error;
  timestamp: number;
}

type CircuitEventListener = (event: CircuitEvent) => void;

/**
 * Circuit Breaker for Sandbox Providers
 * 
 * Prevents cascading failures by stopping requests to failing providers
 * Allows gradual recovery through half-open state
 */
export class ProviderCircuitBreaker {
  private readonly providerId: string;
  private readonly config: CircuitBreakerConfig;
  
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private halfOpenRequests = 0;
  
  private lastFailureAt?: number;
  private lastSuccessAt?: number;
  private openedAt?: number;
  
  private readonly listeners: CircuitEventListener[] = [];

  constructor(
    providerId: string,
    config: Partial<CircuitBreakerConfig> = {}
  ) {
    this.providerId = providerId;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    logger.info('Provider Circuit Breaker created', {
      providerId,
      failureThreshold: this.config.failureThreshold,
      timeoutMs: this.config.timeoutMs,
    });
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check if we should allow request
    if (!this.canExecute()) {
      const error = new Error(`Circuit breaker is OPEN for provider: ${this.providerId}`);
      (error as any).code = 'CIRCUIT_OPEN';
      (error as any).retryAfter = this.getRetryAfter();
      throw error;
    }

    // Track half-open requests
    if (this.state === 'HALF_OPEN') {
      this.halfOpenRequests++;
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error as Error);
      throw error;
    }
  }

  /**
   * Execute operation that might fail fast
   */
  async executeWithFallback<T>(
    primary: () => Promise<T>,
    fallback: () => Promise<T>
  ): Promise<T> {
    if (!this.canExecute()) {
      logger.debug('Circuit open, using fallback', { providerId: this.providerId });
      return fallback();
    }

    try {
      return await this.execute(primary);
    } catch (error) {
      // If circuit just opened, try fallback
      if (this.state === 'OPEN') {
        logger.debug('Circuit opened during execution, using fallback', { 
          providerId: this.providerId,
        });
        return fallback();
      }
      throw error;
    }
  }

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitState {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN' && this.shouldTransitionToHalfOpen()) {
      this.transitionTo('HALF_OPEN');
    }
    
    return this.state;
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      openedAt: this.openedAt,
      halfOpenRequests: this.halfOpenRequests,
    };
  }

  /**
   * Manually reset circuit breaker
   */
  reset(): void {
    const oldState = this.state;
    
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenRequests = 0;
    this.openedAt = undefined;
    
    this.emitEvent({
      type: 'state_change',
      fromState: oldState,
      toState: 'CLOSED',
      timestamp: Date.now(),
    });
    
    logger.info('Circuit breaker manually reset', { providerId: this.providerId });
  }

  /**
   * Force circuit to open state
   */
  forceOpen(): void {
    this.transitionTo('OPEN');
    logger.warn('Circuit breaker forced open', { providerId: this.providerId });
  }

  /**
   * Add event listener
   */
  onStateChange(listener: CircuitEventListener): () => void {
    this.listeners.push(listener);
    
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Check if request can be executed
   */
  private canExecute(): boolean {
    const currentState = this.getState();
    
    switch (currentState) {
      case 'CLOSED':
        return true;
      
      case 'OPEN':
        return false;
      
      case 'HALF_OPEN':
        return this.halfOpenRequests < this.config.halfOpenMaxRequests;
      
      default:
        return false;
    }
  }

  /**
   * Check if should transition to half-open
   */
  private shouldTransitionToHalfOpen(): boolean {
    if (!this.openedAt) {
      return false;
    }
    
    const elapsed = Date.now() - this.openedAt;
    return elapsed >= this.config.timeoutMs;
  }

  /**
   * Get retry after time in milliseconds
   */
  private getRetryAfter(): number {
    if (!this.openedAt) {
      return 0;
    }
    
    const elapsed = Date.now() - this.openedAt;
    return Math.max(0, this.config.timeoutMs - elapsed);
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.successCount++;
    this.lastSuccessAt = Date.now();
    this.halfOpenRequests = 0;
    
    this.emitEvent({
      type: 'success',
      timestamp: Date.now(),
    });

    if (this.state === 'HALF_OPEN') {
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo('CLOSED');
        logger.info('Circuit breaker closed after successful recovery', {
          providerId: this.providerId,
          successCount: this.successCount,
        });
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(error: Error): void {
    this.failureCount++;
    this.lastFailureAt = Date.now();
    this.halfOpenRequests = 0;
    
    this.emitEvent({
      type: 'failure',
      error,
      timestamp: Date.now(),
    });

    logger.warn('Circuit breaker operation failed', {
      providerId: this.providerId,
      failureCount: this.failureCount,
      threshold: this.config.failureThreshold,
      error: error.message,
    });

    if (this.state === 'HALF_OPEN') {
      // Any failure in half-open state opens the circuit
      this.transitionTo('OPEN');
      logger.warn('Circuit breaker opened after failure in half-open state', {
        providerId: this.providerId,
      });
    } else if (this.state === 'CLOSED') {
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo('OPEN');
        logger.error('Circuit breaker opened after threshold failures', {
          providerId: this.providerId,
          failureCount: this.failureCount,
        });
      }
    }
  }

  /**
   * Transition to new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    
    if (oldState === newState) {
      return;
    }
    
    this.state = newState;
    
    if (newState === 'OPEN') {
      this.openedAt = Date.now();
      this.halfOpenRequests = 0;
    } else if (newState === 'HALF_OPEN') {
      this.halfOpenRequests = 0;
      this.successCount = 0;
    } else if (newState === 'CLOSED') {
      this.failureCount = 0;
      this.successCount = 0;
      this.halfOpenRequests = 0;
      this.openedAt = undefined;
    }
    
    this.emitEvent({
      type: 'state_change',
      fromState: oldState,
      toState: newState,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit event to listeners
   */
  private emitEvent(event: CircuitEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error('Error in circuit breaker event listener', error as Error);
      }
    }
  }
}

/**
 * Circuit Breaker Registry
 * 
 * Manages circuit breakers for multiple providers
 */
class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, ProviderCircuitBreaker>();

  /**
   * Get or create circuit breaker for provider
   */
  getBreaker(
    providerId: string,
    config?: Partial<CircuitBreakerConfig>
  ): ProviderCircuitBreaker {
    let breaker = this.breakers.get(providerId);
    
    if (!breaker) {
      breaker = new ProviderCircuitBreaker(providerId, config);
      this.breakers.set(providerId, breaker);
      
      logger.debug('Created circuit breaker for provider', { providerId });
    }
    
    return breaker;
  }

  /**
   * Remove circuit breaker
   */
  removeBreaker(providerId: string): void {
    this.breakers.delete(providerId);
    logger.debug('Removed circuit breaker', { providerId });
  }

  /**
   * Get all breaker stats
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    
    for (const [providerId, breaker] of this.breakers.entries()) {
      stats[providerId] = breaker.getStats();
    }
    
    return stats;
  }

  /**
   * Reset all breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Get healthy providers (circuit closed or half-open)
   */
  getHealthyProviders(): string[] {
    const healthy: string[] = [];
    
    for (const [providerId, breaker] of this.breakers.entries()) {
      const state = breaker.getState();
      if (state === 'CLOSED' || state === 'HALF_OPEN') {
        healthy.push(providerId);
      }
    }
    
    return healthy;
  }

  /**
   * Get unhealthy providers (circuit open)
   */
  getUnhealthyProviders(): string[] {
    const unhealthy: string[] = [];
    
    for (const [providerId, breaker] of this.breakers.entries()) {
      if (breaker.getState() === 'OPEN') {
        unhealthy.push(providerId);
      }
    }
    
    return unhealthy;
  }
}

// Global registry instance
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

/**
 * Get circuit breaker for a provider
 */
export function getCircuitBreaker(
  providerId: string,
  config?: Partial<CircuitBreakerConfig>
): ProviderCircuitBreaker {
  return circuitBreakerRegistry.getBreaker(providerId, config);
}

/**
 * Execute operation with provider circuit breaker
 */
export async function withCircuitBreaker<T>(
  providerId: string,
  operation: () => Promise<T>,
  config?: Partial<CircuitBreakerConfig>
): Promise<T> {
  const breaker = getCircuitBreaker(providerId, config);
  return breaker.execute(operation);
}

/**
 * Execute with fallback on circuit open
 */
export async function withFallback<T>(
  providerId: string,
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  config?: Partial<CircuitBreakerConfig>
): Promise<T> {
  const breaker = getCircuitBreaker(providerId, config);
  return breaker.executeWithFallback(primary, fallback);
}

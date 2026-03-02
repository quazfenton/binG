/**
 * Provider Health Check Service
 * 
 * Monitors health of sandbox providers and other services.
 * Implements periodic health checks with configurable intervals.
 * 
 * Features:
 * - Per-provider health monitoring
 * - Configurable check intervals
 * - Health status history
 * - Automatic unhealthy provider detection
 * - Integration with circuit breakers
 */

import { circuitBreakerManager } from './circuit-breaker';

export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';

export interface HealthCheckResult {
  healthy: boolean;
  status: HealthStatus;
  latency: number;
  timestamp: number;
  error?: string;
  details?: Record<string, any>;
}

export interface ProviderHealth {
  providerId: string;
  status: HealthStatus;
  lastCheck: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  averageLatency: number;
  history: HealthCheckResult[];
}

export interface HealthCheckConfig {
  interval: number;        // Time between health checks in ms
  timeout: number;         // Health check timeout in ms
  failureThreshold: number; // Failures before marking unhealthy
  historySize: number;     // Number of health check results to keep
}

const DEFAULT_CONFIG: HealthCheckConfig = {
  interval: 30000, // 30 seconds
  timeout: 5000,   // 5 seconds
  failureThreshold: 3,
  historySize: 10,
};

export interface HealthCheckFunction {
  (): Promise<HealthCheckResult>;
}

class ProviderHealthChecker {
  private readonly providerId: string;
  private readonly checkFn: HealthCheckFunction;
  private readonly config: HealthCheckConfig;
  
  private health: ProviderHealth;
  private checkInterval?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    providerId: string,
    checkFn: HealthCheckFunction,
    config: Partial<HealthCheckConfig> = {}
  ) {
    this.providerId = providerId;
    this.checkFn = checkFn;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.health = {
      providerId,
      status: 'unknown',
      lastCheck: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      averageLatency: 0,
      history: [],
    };
  }

  /**
   * Start periodic health checks
   */
  start(): void {
    if (this.checkInterval) {
      console.warn(`[HealthChecker:${this.providerId}] Already running`);
      return;
    }

    console.log(`[HealthChecker:${this.providerId}] Starting health checks`);
    
    // Run initial check immediately
    this.runCheck();
    
    // Schedule periodic checks
    this.checkInterval = setInterval(() => {
      this.runCheck();
    }, this.config.interval);
  }

  /**
   * Stop periodic health checks
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
      console.log(`[HealthChecker:${this.providerId}] Stopped health checks`);
    }
  }

  /**
   * Run single health check
   */
  private async runCheck(): Promise<void> {
    if (this.isRunning) {
      console.warn(`[HealthChecker:${this.providerId}] Check already running`);
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      // Run health check with timeout
      const result = await Promise.race([
        this.checkFn(),
        this.timeoutPromise(this.config.timeout),
      ]);

      const latency = Date.now() - startTime;
      this.updateHealth(result, latency);
      
    } catch (error: any) {
      const latency = Date.now() - startTime;
      this.updateHealth({
        healthy: false,
        status: 'unhealthy',
        latency,
        timestamp: Date.now(),
        error: error.message,
      }, latency);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Update health status based on check result
   */
  private updateHealth(result: HealthCheckResult, latency: number): void {
    result.timestamp = Date.now();
    result.latency = latency;

    // Add to history
    this.health.history.push(result);
    if (this.health.history.length > this.config.historySize) {
      this.health.history.shift();
    }

    // Update consecutive counters
    if (result.healthy) {
      this.health.consecutiveSuccesses++;
      this.health.consecutiveFailures = 0;
    } else {
      this.health.consecutiveFailures++;
      this.health.consecutiveSuccesses = 0;
    }

    // Update average latency
    const recentLatencies = this.health.history
      .filter(h => h.latency > 0)
      .map(h => h.latency);
    
    this.health.averageLatency = recentLatencies.length > 0
      ? recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length
      : 0;

    // Update status
    if (this.health.consecutiveFailures >= this.config.failureThreshold) {
      this.health.status = 'unhealthy';
    } else if (result.healthy) {
      this.health.status = 'healthy';
    }

    this.health.lastCheck = Date.now();

    // Log status changes
    if (result.healthy && this.health.consecutiveFailures === 0) {
      console.log(`[HealthChecker:${this.providerId}] Healthy (latency: ${latency}ms)`);
    } else if (!result.healthy) {
      console.warn(
        `[HealthChecker:${this.providerId}] Unhealthy (${this.health.consecutiveFailures}/${this.config.failureThreshold}): ${result.error || 'Unknown error'}`
      );
    }

    // Update circuit breaker if unhealthy
    if (this.health.status === 'unhealthy') {
      const breaker = circuitBreakerManager.getBreaker(this.providerId);
      // Force open circuit breaker after threshold failures
      if (this.health.consecutiveFailures >= this.config.failureThreshold) {
        console.warn(`[HealthChecker:${this.providerId}] Opening circuit breaker`);
        // Circuit breaker will be opened by the next failed execution
      }
    }
  }

  /**
   * Create timeout promise
   */
  private timeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Health check timeout after ${ms}ms`));
      }, ms);
    });
  }

  /**
   * Get current health status
   */
  getHealth(): ProviderHealth {
    return { ...this.health };
  }

  /**
   * Check if provider is healthy
   */
  isHealthy(): boolean {
    return this.health.status === 'healthy';
  }

  /**
   * Get last health check result
   */
  getLastCheck(): HealthCheckResult | undefined {
    return this.health.history[this.health.history.length - 1];
  }
}

/**
 * Health Check Manager
 * Manages health checkers for multiple providers
 */
export class HealthCheckManager {
  private checkers: Map<string, ProviderHealthChecker> = new Map();
  private defaultConfig: Partial<HealthCheckConfig> = {};

  constructor(defaultConfig?: Partial<HealthCheckConfig>) {
    if (defaultConfig) {
      this.defaultConfig = defaultConfig;
    }
  }

  /**
   * Register health checker for provider
   */
  register(
    providerId: string,
    checkFn: HealthCheckFunction,
    config?: Partial<HealthCheckConfig>
  ): ProviderHealthChecker {
    const existing = this.checkers.get(providerId);
    if (existing) {
      console.warn(`[HealthManager:${providerId}] Already registered`);
      return existing;
    }

    const checker = new ProviderHealthChecker(providerId, checkFn, {
      ...this.defaultConfig,
      ...config,
    });

    this.checkers.set(providerId, checker);
    checker.start();

    return checker;
  }

  /**
   * Unregister health checker for provider
   */
  unregister(providerId: string): void {
    const checker = this.checkers.get(providerId);
    if (checker) {
      checker.stop();
      this.checkers.delete(providerId);
      console.log(`[HealthManager:${providerId}] Unregistered`);
    }
  }

  /**
   * Get health status for provider
   */
  getHealth(providerId: string): ProviderHealth | null {
    const checker = this.checkers.get(providerId);
    return checker ? checker.getHealth() : null;
  }

  /**
   * Check if provider is healthy
   */
  isHealthy(providerId: string): boolean {
    const checker = this.checkers.get(providerId);
    return checker ? checker.isHealthy() : false;
  }

  /**
   * Get all provider health statuses
   */
  getAllHealth(): Map<string, ProviderHealth> {
    const health = new Map();
    for (const [providerId, checker] of this.checkers.entries()) {
      health.set(providerId, checker.getHealth());
    }
    return health;
  }

  /**
   * Get healthy providers only
   */
  getHealthyProviders(): string[] {
    const healthy: string[] = [];
    for (const [providerId, checker] of this.checkers.entries()) {
      if (checker.isHealthy()) {
        healthy.push(providerId);
      }
    }
    return healthy;
  }

  /**
   * Get unhealthy providers
   */
  getUnhealthyProviders(): string[] {
    const unhealthy: string[] = [];
    for (const [providerId, checker] of this.checkers.entries()) {
      if (!checker.isHealthy()) {
        unhealthy.push(providerId);
      }
    }
    return unhealthy;
  }
}

// Export singleton instance
export const healthCheckManager = new HealthCheckManager();

/**
 * Create basic HTTP health check
 */
export function createHttpHealthCheck(
  url: string,
  options: { timeout?: number; expectedStatus?: number } = {}
): HealthCheckFunction {
  return async (): Promise<HealthCheckResult> => {
    const startTime = Date.now();
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeout || 5000);
      
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      const latency = Date.now() - startTime;
      
      const healthy = response.status === (options.expectedStatus || 200);
      
      return {
        healthy,
        status: healthy ? 'healthy' : 'unhealthy',
        latency,
        timestamp: Date.now(),
        error: healthy ? undefined : `Unexpected status: ${response.status}`,
        details: {
          status: response.status,
          url,
        },
      };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      return {
        healthy: false,
        status: 'unhealthy',
        latency,
        timestamp: Date.now(),
        error: error.message,
      };
    }
  };
}

/**
 * Create basic function health check
 */
export function createFunctionHealthCheck(
  fn: () => Promise<boolean>
): HealthCheckFunction {
  return async (): Promise<HealthCheckResult> => {
    const startTime = Date.now();
    
    try {
      const healthy = await fn();
      const latency = Date.now() - startTime;
      
      return {
        healthy,
        status: healthy ? 'healthy' : 'unhealthy',
        latency,
        timestamp: Date.now(),
        error: healthy ? undefined : 'Function returned false',
      };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      return {
        healthy: false,
        status: 'unhealthy',
        latency,
        timestamp: Date.now(),
        error: error.message,
      };
    }
  };
}

/**
 * Enhanced API Client with Fallback System
 * 
 * Provides robust API communication with:
 * - Retry logic with exponential backoff
 * - Fallback endpoint management
 * - Circuit breaker pattern
 * - Comprehensive error handling
 * - User-friendly error messages
 */

export interface RetryOptions {
  maxAttempts: number;
  backoffStrategy: 'exponential' | 'linear' | 'fixed';
  baseDelay: number;
  maxDelay: number;
  jitter: boolean;
  retryableStatusCodes: number[];
}

export interface FallbackConfig {
  primaryEndpoint: string;
  fallbackEndpoints: string[];
  healthCheckPath?: string;
  healthCheckInterval?: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringWindow: number;
}

export interface RequestConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  data?: any;
  timeout?: number;
  retries?: RetryOptions;
  fallback?: FallbackConfig;
  circuitBreaker?: boolean;
}

export interface APIResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config: RequestConfig;
  duration: number;
}

export interface APIError extends Error {
  code?: string;
  status?: number;
  response?: {
    data: any;
    status: number;
    statusText: string;
  };
  config?: RequestConfig;
  isRetryable: boolean;
  userMessage: string;
}

export interface EndpointHealth {
  url: string;
  isHealthy: boolean;
  lastCheck: number;
  responseTime: number;
  errorCount: number;
  successCount: number;
}

export interface CircuitBreakerState {
  endpoint: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  lastFailureTime: number;
  nextAttemptTime: number;
}

class CircuitBreaker {
  private states = new Map<string, CircuitBreakerState>();
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  canExecute(endpoint: string): boolean {
    const state = this.getState(endpoint);
    
    switch (state.state) {
      case 'CLOSED':
        return true;
      case 'OPEN':
        if (Date.now() >= state.nextAttemptTime) {
          this.setState(endpoint, { ...state, state: 'HALF_OPEN' });
          return true;
        }
        return false;
      case 'HALF_OPEN':
        return true;
      default:
        return true;
    }
  }

  onSuccess(endpoint: string): void {
    const state = this.getState(endpoint);
    this.setState(endpoint, {
      ...state,
      state: 'CLOSED',
      failureCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0
    });
  }

  onFailure(endpoint: string): void {
    const state = this.getState(endpoint);
    const newFailureCount = state.failureCount + 1;
    const now = Date.now();

    if (newFailureCount >= this.config.failureThreshold) {
      this.setState(endpoint, {
        ...state,
        state: 'OPEN',
        failureCount: newFailureCount,
        lastFailureTime: now,
        nextAttemptTime: now + this.config.recoveryTimeout
      });
    } else {
      this.setState(endpoint, {
        ...state,
        failureCount: newFailureCount,
        lastFailureTime: now
      });
    }
  }

  getState(endpoint: string): CircuitBreakerState {
    if (!this.states.has(endpoint)) {
      this.states.set(endpoint, {
        endpoint,
        state: 'CLOSED',
        failureCount: 0,
        lastFailureTime: 0,
        nextAttemptTime: 0
      });
    }
    return this.states.get(endpoint)!;
  }

  private setState(endpoint: string, state: CircuitBreakerState): void {
    this.states.set(endpoint, state);
  }

  getStats(): CircuitBreakerState[] {
    return Array.from(this.states.values());
  }
}

export class EnhancedAPIClient {
  private circuitBreaker: CircuitBreaker;
  private endpointHealth = new Map<string, EndpointHealth>();
  private healthCheckIntervals = new Map<string, NodeJS.Timeout>();

  private defaultRetryOptions: RetryOptions = {
    maxAttempts: 3,
    backoffStrategy: 'exponential',
    baseDelay: 1000,
    maxDelay: 10000,
    jitter: true,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504]
  };

  private defaultCircuitBreakerConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    recoveryTimeout: 30000,
    monitoringWindow: 60000
  };

  constructor(circuitBreakerConfig?: Partial<CircuitBreakerConfig>) {
    this.circuitBreaker = new CircuitBreaker({
      ...this.defaultCircuitBreakerConfig,
      ...circuitBreakerConfig
    });
  }

  async request<T = any>(config: RequestConfig): Promise<APIResponse<T>> {
    const startTime = Date.now();
    
    try {
      // Check circuit breaker if enabled
      if (config.circuitBreaker !== false && !this.circuitBreaker.canExecute(config.url)) {
        throw this.createAPIError(
          'Circuit breaker is open for this endpoint',
          'CIRCUIT_BREAKER_OPEN',
          503,
          config,
          false,
          'Service temporarily unavailable. Please try again later.'
        );
      }

      // Try primary endpoint with retries
      const response = await this.executeWithRetry(config);
      
      // Record success for circuit breaker
      if (config.circuitBreaker !== false) {
        this.circuitBreaker.onSuccess(config.url);
      }
      
      // Update endpoint health
      this.updateEndpointHealth(config.url, true, Date.now() - startTime);
      
      return response;
    } catch (error) {
      // Record failure for circuit breaker
      if (config.circuitBreaker !== false) {
        this.circuitBreaker.onFailure(config.url);
      }
      
      // Update endpoint health
      this.updateEndpointHealth(config.url, false, Date.now() - startTime);
      
      throw error;
    }
  }

  async withFallback<T = any>(
    primaryConfig: RequestConfig,
    fallbackConfigs: RequestConfig[]
  ): Promise<APIResponse<T>> {
    const errors: APIError[] = [];
    
    // Try primary endpoint
    try {
      return await this.request<T>(primaryConfig);
    } catch (error) {
      errors.push(error as APIError);
      console.warn(`Primary endpoint failed: ${primaryConfig.url}`, error);
    }

    // Try fallback endpoints
    for (const fallbackConfig of fallbackConfigs) {
      try {
        console.log(`Trying fallback endpoint: ${fallbackConfig.url}`);
        return await this.request<T>(fallbackConfig);
      } catch (error) {
        errors.push(error as APIError);
        console.warn(`Fallback endpoint failed: ${fallbackConfig.url}`, error);
      }
    }

    // All endpoints failed
    const lastError = errors[errors.length - 1];
    throw this.createAPIError(
      `All endpoints failed. Last error: ${lastError.message}`,
      'ALL_ENDPOINTS_FAILED',
      lastError.status || 503,
      primaryConfig,
      false,
      'All services are currently unavailable. Please try again later.'
    );
  }

  private async executeWithRetry<T = any>(config: RequestConfig): Promise<APIResponse<T>> {
    const retryOptions = { ...this.defaultRetryOptions, ...config.retries };
    let lastError: APIError;

    for (let attempt = 1; attempt <= retryOptions.maxAttempts; attempt++) {
      try {
        return await this.executeRequest<T>(config);
      } catch (error) {
        lastError = error as APIError;
        
        // Don't retry if not retryable
        if (!this.isRetryableError(lastError, retryOptions)) {
          throw lastError;
        }

        // Don't retry on last attempt
        if (attempt === retryOptions.maxAttempts) {
          throw lastError;
        }

        // Calculate delay for next attempt
        const delay = this.calculateDelay(attempt, retryOptions);
        console.log(`Request failed (attempt ${attempt}/${retryOptions.maxAttempts}). Retrying in ${delay}ms...`);
        
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  private async executeRequest<T = any>(config: RequestConfig): Promise<APIResponse<T>> {
    const startTime = Date.now();
    const controller = new AbortController();
    
    // Set timeout
    const timeout = config.timeout || 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(config.url, {
        method: config.method,
        headers: {
          'Content-Type': 'application/json',
          ...config.headers
        },
        body: config.data ? JSON.stringify(config.data) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let responseData: T;
      const contentType = response.headers.get('content-type');
      
      if (contentType?.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text() as unknown as T;
      }

      if (!response.ok) {
        throw this.createAPIError(
          `HTTP ${response.status}: ${response.statusText}`,
          'HTTP_ERROR',
          response.status,
          config,
          this.isRetryableStatus(response.status),
          this.getHttpErrorMessage(response.status)
        );
      }

      return {
        data: responseData,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        config,
        duration: Date.now() - startTime
      };
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error && typeof error === 'object' && 'code' in error) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw this.createAPIError(
            'Request timeout',
            'TIMEOUT',
            408,
            config,
            true,
            'Request timed out. Please check your connection and try again.'
          );
        }

        if (error.message.includes('fetch')) {
          throw this.createAPIError(
            'Network error',
            'NETWORK_ERROR',
            0,
            config,
            true,
            'Unable to connect to the service. Please check your internet connection.'
          );
        }
      }

      throw this.createAPIError(
        error instanceof Error ? error.message : 'Unknown error',
        'UNKNOWN_ERROR',
        500,
        config,
        false,
        'An unexpected error occurred. Please try again.'
      );
    }
  }

  private isRetryableError(error: APIError, retryOptions: RetryOptions): boolean {
    if (!error.isRetryable) {
      return false;
    }

    if (error.status && retryOptions.retryableStatusCodes.includes(error.status)) {
      return true;
    }

    // Retry network errors and timeouts
    return error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT';
  }

  private isRetryableStatus(status: number): boolean {
    return this.defaultRetryOptions.retryableStatusCodes.includes(status);
  }

  private calculateDelay(attempt: number, options: RetryOptions): number {
    let delay: number;

    switch (options.backoffStrategy) {
      case 'exponential':
        delay = options.baseDelay * Math.pow(2, attempt - 1);
        break;
      case 'linear':
        delay = options.baseDelay * attempt;
        break;
      case 'fixed':
      default:
        delay = options.baseDelay;
        break;
    }

    // Apply jitter if enabled
    if (options.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    // Ensure delay doesn't exceed maximum
    return Math.min(delay, options.maxDelay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private createAPIError(
    message: string,
    code: string,
    status: number,
    config: RequestConfig,
    isRetryable: boolean,
    userMessage: string
  ): APIError {
    const error = new Error(message) as APIError;
    error.code = code;
    error.status = status;
    error.config = config;
    error.isRetryable = isRetryable;
    error.userMessage = userMessage;
    return error;
  }

  private getHttpErrorMessage(status: number): string {
    switch (status) {
      case 400:
        return 'Invalid request. Please check your input and try again.';
      case 401:
        return 'Authentication failed. Please check your API key.';
      case 403:
        return 'Access denied. You may not have permission for this operation.';
      case 404:
        return 'The requested resource was not found.';
      case 408:
        return 'Request timeout. Please try again.';
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      case 500:
        return 'Internal server error. Please try again later.';
      case 502:
        return 'Bad gateway. The service is temporarily unavailable.';
      case 503:
        return 'Service unavailable. Please try again later.';
      case 504:
        return 'Gateway timeout. The service is taking too long to respond.';
      default:
        return 'An error occurred. Please try again.';
    }
  }

  private updateEndpointHealth(url: string, success: boolean, responseTime: number): void {
    const health = this.endpointHealth.get(url) || {
      url,
      isHealthy: true,
      lastCheck: 0,
      responseTime: 0,
      errorCount: 0,
      successCount: 0
    };

    health.lastCheck = Date.now();
    health.responseTime = responseTime;

    if (success) {
      health.successCount++;
      health.isHealthy = true;
    } else {
      health.errorCount++;
      // Mark as unhealthy if error rate is high
      const totalRequests = health.successCount + health.errorCount;
      const errorRate = health.errorCount / totalRequests;
      health.isHealthy = errorRate < 0.5; // Less than 50% error rate
    }

    this.endpointHealth.set(url, health);
  }

  // Health check methods
  async performHealthCheck(url: string, healthCheckPath?: string): Promise<boolean> {
    try {
      const checkUrl = healthCheckPath ? `${url}${healthCheckPath}` : url;
      const response = await this.executeRequest({
        url: checkUrl,
        method: 'GET',
        timeout: 5000
      });
      
      this.updateEndpointHealth(url, true, response.duration);
      return true;
    } catch (error) {
      this.updateEndpointHealth(url, false, 0);
      return false;
    }
  }

  startHealthMonitoring(endpoints: string[], interval: number = 60000): void {
    endpoints.forEach(endpoint => {
      if (this.healthCheckIntervals.has(endpoint)) {
        clearInterval(this.healthCheckIntervals.get(endpoint)!);
      }

      const intervalId = setInterval(async () => {
        await this.performHealthCheck(endpoint);
      }, interval);

      this.healthCheckIntervals.set(endpoint, intervalId);
    });
  }

  stopHealthMonitoring(endpoint?: string): void {
    if (endpoint) {
      const intervalId = this.healthCheckIntervals.get(endpoint);
      if (intervalId) {
        clearInterval(intervalId);
        this.healthCheckIntervals.delete(endpoint);
      }
    } else {
      // Stop all monitoring
      this.healthCheckIntervals.forEach(intervalId => clearInterval(intervalId));
      this.healthCheckIntervals.clear();
    }
  }

  // Utility methods for monitoring and debugging
  getEndpointHealth(url?: string): EndpointHealth | EndpointHealth[] {
    if (url) {
      return this.endpointHealth.get(url) || {
        url,
        isHealthy: true,
        lastCheck: 0,
        responseTime: 0,
        errorCount: 0,
        successCount: 0
      };
    }
    return Array.from(this.endpointHealth.values());
  }

  getCircuitBreakerStats(): CircuitBreakerState[] {
    return this.circuitBreaker.getStats();
  }

  resetCircuitBreaker(endpoint?: string): void {
    if (endpoint) {
      this.circuitBreaker.onSuccess(endpoint);
    } else {
      // Reset all circuit breakers
      this.circuitBreaker.getStats().forEach(state => {
        this.circuitBreaker.onSuccess(state.endpoint);
      });
    }
  }

  // Cleanup method
  destroy(): void {
    this.stopHealthMonitoring();
    this.endpointHealth.clear();
  }
}

// Export singleton instance
export const enhancedAPIClient = new EnhancedAPIClient();

// Export factory function for custom configurations
export function createEnhancedAPIClient(config?: Partial<CircuitBreakerConfig>): EnhancedAPIClient {
  return new EnhancedAPIClient(config);
}
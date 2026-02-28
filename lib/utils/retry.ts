/**
 * Retry Utility with Exponential Backoff
 * 
 * Provides retry logic for API calls and other async operations
 * with configurable backoff, jitter, and error handling.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2 for exponential) */
  backoffMultiplier?: number;
  /** Only retry on these error codes/status codes */
  retryableStatusCodes?: number[];
  /** Only retry on these error types */
  retryableErrors?: string[];
  /** Callback on each retry attempt */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
  /** Add jitter to prevent thundering herd (default: true) */
  useJitter?: boolean;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if error is retryable
 */
function isRetryableError(
  error: any,
  options: RetryOptions
): boolean {
  // Check status codes for HTTP errors
  if (error.status || error.statusCode) {
    const status = error.status || error.statusCode;
    const defaultRetryableCodes = [408, 429, 500, 502, 503, 504];
    const retryableCodes = options.retryableStatusCodes || defaultRetryableCodes;
    return retryableCodes.includes(status);
  }

  // Check error message for specific error types
  if (error.message) {
    const defaultRetryableErrors = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'ENOTFOUND',
      'TimeoutError',
      'NetworkError',
      'AbortError',
      'rate limit',
      'too many requests',
    ];
    const retryableErrors = options.retryableErrors || defaultRetryableErrors;
    
    return retryableErrors.some(err => 
      error.message.toLowerCase().includes(err.toLowerCase())
    );
  }

  // Default: don't retry unknown errors
  return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateBackoffDelay(
  attempt: number,
  options: Required<RetryOptions>
): number {
  const { baseDelayMs, maxDelayMs, backoffMultiplier, useJitter } = options;
  
  // Exponential backoff
  const delay = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1);
  
  // Add jitter (±10%) to prevent thundering herd
  const jitter = useJitter ? delay * 0.1 * (Math.random() * 2 - 1) : 0;
  
  // Cap at max delay
  return Math.min(delay + jitter, maxDelayMs);
}

/**
 * Execute async operation with retry logic and exponential backoff
 * 
 * @example
 * ```typescript
 * // Basic usage
 * const result = await withRetry(
 *   () => fetchFromAPI(),
 *   { maxRetries: 3, baseDelayMs: 1000 }
 * );
 * 
 * // With retry callback
 * const result = await withRetry(
 *   () => apiCall(),
 *   {
 *     maxRetries: 5,
 *     onRetry: (attempt, error, delay) => {
 *       console.log(`Retry ${attempt}: ${error.message}. Waiting ${delay}ms`);
 *     }
 *   }
 * );
 * 
 * // Custom retryable errors
 * const result = await withRetry(
 *   () => databaseQuery(),
 *   {
 *     retryableErrors: ['deadlock', 'lock_timeout'],
 *     retryableStatusCodes: [503, 504]
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    retryableStatusCodes,
    retryableErrors,
    onRetry,
    useJitter = true,
  } = options;

  const resolvedOptions: Required<RetryOptions> = {
    maxRetries,
    baseDelayMs,
    maxDelayMs,
    backoffMultiplier,
    retryableStatusCodes,
    retryableErrors,
    onRetry,
    useJitter,
  };

  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      attempt++;
      return await operation();
    } catch (error: any) {
      lastError = error;

      // Don't retry if max retries reached
      if (attempt > maxRetries) {
        break;
      }

      // Don't retry if error is not retryable
      if (!isRetryableError(error, resolvedOptions)) {
        throw error;
      }

      // Calculate delay for this attempt
      const delayMs = calculateBackoffDelay(attempt, resolvedOptions);

      // Log retry attempt
      console.warn(
        `[Retry] Operation failed (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying in ${Math.round(delayMs)}ms`
      );

      // Call retry callback if provided
      onRetry?.(attempt, error, delayMs);

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // All retries failed
  throw new Error(
    `Operation failed after ${maxRetries} retries. Last error: ${lastError?.message}`
  );
}

/**
 * Retry with exponential backoff for fetch operations
 * 
 * @example
 * ```typescript
 * const response = await fetchWithRetry(
 *   'https://api.example.com/data',
 *   { maxRetries: 5, baseDelayMs: 500 }
 * );
 * ```
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit & RetryOptions
): Promise<Response> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    onRetry,
    ...fetchOptions
  } = options || {};

  return withRetry(
    async () => {
      const response = await fetch(url, fetchOptions);
      
      // Check for HTTP errors
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        (error as any).status = response.status;
        throw error;
      }
      
      return response;
    },
    {
      maxRetries,
      baseDelayMs,
      maxDelayMs,
      onRetry,
      retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    }
  );
}

/**
 * Retry with circuit breaker pattern
 * Tracks failures and opens circuit after threshold
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(options: { failureThreshold?: number; resetTimeoutMs?: number } = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeoutMs = options.resetTimeoutMs || 60000;
  }

  /**
   * Check if circuit is open (should not execute)
   */
  isOpen(): boolean {
    if (this.state === 'open') {
      // Check if reset timeout has passed
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = 'half-open';
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Record successful execution
   */
  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  /**
   * Record failed execution
   */
  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      console.warn('[CircuitBreaker] Circuit opened after', this.failures, 'failures');
    }
  }

  /**
   * Execute operation with circuit breaker
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new Error('Circuit breaker is open');
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Get current state
   */
  getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }

  /**
   * Get failure count
   */
  getFailureCount(): number {
    return this.failures;
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.failures = 0;
    this.lastFailureTime = 0;
    this.state = 'closed';
  }
}

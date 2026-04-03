/**
 * Timeout and Retry Utilities
 * 
 * Provides robust timeout handling and retry logic with exponential backoff
 * for all async operations in the sandbox environment.
 */

/**
 * Error thrown when an operation times out
 */
export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly timeoutMs: number
  ) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when all retry attempts fail
 */
export class MaxRetriesError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly attempts: number,
    public readonly lastError?: Error
  ) {
    super(message);
    this.name = 'MaxRetriesError';
  }
}

/**
 * Configuration for timeout wrapper
 */
export interface TimeoutOptions {
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Operation name for error messages */
  operationName?: string;
  /** Custom error message */
  errorMessage?: string;
}

/**
 * Configuration for retry logic
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Base delay in milliseconds */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2 for exponential) */
  backoffMultiplier?: number;
  /** Only retry on these error types */
  retryableErrors?: Array<typeof Error | string>;
  /** Operation name for logging */
  operationName?: string;
  /** Callback on each retry attempt */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

/**
 * Wrap a promise with a timeout
 * 
 * @param promise - Promise to wrap
 * @param options - Timeout configuration
 * @returns Promise that rejects with TimeoutError if timeout exceeded
 * 
 * @example
 * ```typescript
 * const result = await withTimeout(
 *   someAsyncOperation(),
 *   { timeoutMs: 5000, operationName: 'database query' }
 * );
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  const { timeoutMs, operationName = 'operation', errorMessage } = options;

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError(
          errorMessage || `${operationName} timed out after ${timeoutMs}ms`,
          operationName,
          timeoutMs
        ));
      }, timeoutMs);
    }),
  ]);
}

/**
 * Check if an error is retryable
 */
function isRetryableError(
  error: Error,
  retryableErrors?: Array<typeof Error | string>
): boolean {
  // Default retryable errors
  const defaultRetryable = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'TimeoutError',
    'NetworkError',
    'AbortError',
  ];

  if (!retryableErrors) {
    // Check for default retryable errors
    return defaultRetryable.some(
      code => error.message.includes(code) || error.name.includes(code)
    );
  }

  // Check against custom retryable errors
  return retryableErrors.some(errorType => {
    if (typeof errorType === 'string') {
      return error.message.includes(errorType) || error.name.includes(errorType);
    }
    return error instanceof errorType;
  });
}

/**
 * Calculate delay with exponential backoff
 */
function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  multiplier: number
): number {
  const delay = baseDelayMs * Math.pow(multiplier, attempt - 1);
  // Add jitter (±10%) to prevent thundering herd
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, maxDelayMs);
}

/**
 * Execute an async operation with retry logic and exponential backoff
 * 
 * @param operation - Async operation to execute
 * @param options - Retry configuration
 * @returns Promise that resolves with operation result
 * 
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetchFromAPI(),
 *   {
 *     maxRetries: 3,
 *     baseDelayMs: 1000,
 *     maxDelayMs: 30000,
 *     operationName: 'API call',
 *     onRetry: (attempt, error, delay) => {
 *       console.log(`Retry ${attempt}: ${error.message}. Waiting ${delay}ms`);
 *     }
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
    retryableErrors,
    operationName = 'operation',
    onRetry,
  } = options;

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
      if (!isRetryableError(error, retryableErrors)) {
        throw error;
      }

      // Calculate delay for this attempt
      const delayMs = calculateBackoffDelay(
        attempt,
        baseDelayMs,
        maxDelayMs,
        backoffMultiplier
      );

      // Log retry attempt
      console.warn(`[Retry] ${operationName} failed (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying in ${Math.round(delayMs)}ms`);

      // Call retry callback if provided
      onRetry?.(attempt, error, delayMs);

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // All retries failed
  throw new MaxRetriesError(
    `${operationName} failed after ${maxRetries} retries`,
    operationName,
    maxRetries,
    lastError
  );
}

/**
 * Combine timeout and retry logic
 * 
 * @param operation - Async operation to execute
 * @param timeoutOptions - Timeout configuration
 * @param retryOptions - Retry configuration
 * @returns Promise with combined timeout and retry handling
 * 
 * @example
 * ```typescript
 * const result = await withTimeoutAndRetry(
 *   () => callExternalAPI(),
 *   { timeoutMs: 10000, operationName: 'API call' },
 *   { maxRetries: 3, baseDelayMs: 1000 }
 * );
 * ```
 */
export async function withTimeoutAndRetry<T>(
  operation: () => Promise<T>,
  timeoutOptions: TimeoutOptions,
  retryOptions: RetryOptions = {}
): Promise<T> {
  return withRetry(
    () => withTimeout(operation(), timeoutOptions),
    retryOptions
  );
}

/**
 * Create a timeout promise that can be used with Promise.race
 * 
 * @param ms - Timeout in milliseconds
 * @param message - Error message
 * @returns Promise that rejects after timeout
 */
export function timeout(ms: number, message?: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(message || `Operation timed out after ${ms}ms`));
    }, ms);
  });
}

/**
 * Sleep utility for delays
 * 
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if error is a timeout error
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

/**
 * Check if error is a max retries error
 */
export function isMaxRetriesError(error: unknown): error is MaxRetriesError {
  return error instanceof MaxRetriesError;
}

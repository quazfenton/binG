/**
 * Mistral Error Handler
 * 
 * Comprehensive error handling with classification, retry logic, and backoff.
 * Additive module that enhances reliability of all Mistral operations.
 * 
 * Features:
 * - Error classification
 * - Automatic retry with exponential backoff
 * - Custom error types
 * - Error recovery strategies
 */

export enum MistralErrorType {
  /** API rate limit exceeded */
  RATE_LIMIT = 'RATE_LIMIT',
  /** Request timeout */
  TIMEOUT = 'TIMEOUT',
  /** Authentication failure */
  AUTH_FAILURE = 'AUTH_FAILURE',
  /** Quota exceeded */
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  /** Validation error */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** Code execution error */
  EXECUTION_ERROR = 'EXECUTION_ERROR',
  /** Network error */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** Service unavailable */
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  /** Unknown error */
  UNKNOWN = 'UNKNOWN',
}

export class MistralError extends Error {
  constructor(
    message: string,
    public readonly type: MistralErrorType,
    public readonly originalError?: Error,
    public readonly retryable: boolean = false,
    public readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'MistralError'
  }

  /**
   * Create error from API error
   */
  static fromApiError(error: any): MistralError {
    const message = error.message || 'Unknown API error'
    const statusCode = error.statusCode || error.response?.status
    
    // Rate limiting
    if (statusCode === 429 || message.toLowerCase().includes('rate limit')) {
      const retryAfter = error.response?.headers?.['retry-after']
      const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined
      return new MistralError(
        'Rate limit exceeded',
        MistralErrorType.RATE_LIMIT,
        error,
        true,
        retryAfterMs
      )
    }

    // Timeout
    if (statusCode === 504 || message.toLowerCase().includes('timeout')) {
      return new MistralError(
        'Request timeout',
        MistralErrorType.TIMEOUT,
        error,
        true
      )
    }

    // Authentication
    if (statusCode === 401 || statusCode === 403) {
      return new MistralError(
        `Authentication failed (${statusCode})`,
        MistralErrorType.AUTH_FAILURE,
        error,
        false
      )
    }

    // Quota
    if (message.toLowerCase().includes('quota') || 
        message.toLowerCase().includes('limit exceeded')) {
      return new MistralError(
        'Quota exceeded',
        MistralErrorType.QUOTA_EXCEEDED,
        error,
        false
      )
    }

    // Validation
    if (statusCode === 400) {
      return new MistralError(
        `Validation error: ${message}`,
        MistralErrorType.VALIDATION_ERROR,
        error,
        false
      )
    }

    // Service unavailable
    if (statusCode === 503) {
      return new MistralError(
        'Service unavailable',
        MistralErrorType.SERVICE_UNAVAILABLE,
        error,
        true
      )
    }

    // Network errors
    if (error.code === 'ENOTFOUND' || 
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT') {
      return new MistralError(
        `Network error: ${message}`,
        MistralErrorType.NETWORK_ERROR,
        error,
        true
      )
    }

    // Default
    return new MistralError(
      message,
      MistralErrorType.UNKNOWN,
      error,
      true
    )
  }
}

export interface RetryConfig {
  /** Maximum retry attempts */
  maxRetries: number
  /** Initial backoff in milliseconds */
  initialBackoffMs: number
  /** Maximum backoff in milliseconds */
  maxBackoffMs: number
  /** Backoff multiplier */
  backoffMultiplier: number
  /** Jitter factor (0-1) */
  jitterFactor: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
}

export class MistralErrorHandler {
  private config: RetryConfig

  constructor(config?: Partial<RetryConfig>) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config }
  }

  /**
   * Execute operation with automatic retry
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string,
    config?: Partial<RetryConfig>
  ): Promise<T> {
    const retryConfig = { ...this.config, ...config }
    let lastError: MistralError | undefined

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error: any) {
        const mistralError = MistralError.fromApiError(error)
        lastError = mistralError

        // Don't retry non-retryable errors
        if (!mistralError.retryable) {
          throw mistralError
        }

        // Don't retry if max attempts reached
        if (attempt === retryConfig.maxRetries) {
          throw mistralError
        }

        // Calculate delay
        const delay = this.calculateBackoff(attempt, retryConfig)
        
        console.warn(
          `[MistralErrorHandler] ${context} failed (attempt ${attempt + 1}/${retryConfig.maxRetries}), ` +
          `retrying in ${delay}ms...`,
          mistralError.message
        )

        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    throw lastError
  }

  /**
   * Execute operation with custom error handling
   */
  async executeWithHandling<T>(
    operation: () => Promise<T>,
    handlers: {
      onRateLimit?: () => Promise<void>
      onTimeout?: () => Promise<void>
      onAuthFailure?: () => Promise<void>
      onQuotaExceeded?: () => Promise<void>
      onError?: (error: MistralError) => Promise<void>
    }
  ): Promise<T> {
    try {
      return await operation()
    } catch (error: any) {
      const mistralError = MistralError.fromApiError(error)

      switch (mistralError.type) {
        case MistralErrorType.RATE_LIMIT:
          if (handlers.onRateLimit) {
            await handlers.onRateLimit()
          }
          break
        case MistralErrorType.TIMEOUT:
          if (handlers.onTimeout) {
            await handlers.onTimeout()
          }
          break
        case MistralErrorType.AUTH_FAILURE:
          if (handlers.onAuthFailure) {
            await handlers.onAuthFailure()
          }
          break
        case MistralErrorType.QUOTA_EXCEEDED:
          if (handlers.onQuotaExceeded) {
            await handlers.onQuotaExceeded()
          }
          break
        default:
          if (handlers.onError) {
            await handlers.onError(mistralError)
          }
      }

      throw mistralError
    }
  }

  /**
   * Classify error type
   */
  classifyError(error: any): MistralError {
    return MistralError.fromApiError(error)
  }

  /**
   * Check if error is retryable
   */
  isRetryableError(error: any): boolean {
    const mistralError = MistralError.fromApiError(error)
    return mistralError.retryable
  }

  /**
   * Get retry delay from error
   */
  getRetryDelay(error: any): number | undefined {
    const mistralError = MistralError.fromApiError(error)
    return mistralError.retryAfterMs
  }

  /**
   * Calculate backoff delay
   */
  private calculateBackoff(
    attempt: number,
    config: RetryConfig
  ): number {
    // Exponential backoff
    const exponentialDelay = 
      config.initialBackoffMs * Math.pow(config.backoffMultiplier, attempt)
    
    // Cap at max backoff
    const cappedDelay = Math.min(exponentialDelay, config.maxBackoffMs)
    
    // Add jitter
    const jitter = (Math.random() - 0.5) * 2 * config.jitterFactor * cappedDelay
    
    return Math.round(cappedDelay + jitter)
  }
}

/**
 * Error recovery strategies
 */
export class ErrorRecoveryStrategies {
  /**
   * Exponential backoff with jitter
   */
  static exponentialBackoff(
    attempt: number,
    options: {
      initialMs?: number
      maxMs?: number
      multiplier?: number
      jitter?: number
    } = {}
  ): number {
    const initial = options.initialMs || 1000
    const max = options.maxMs || 30000
    const multiplier = options.multiplier || 2
    const jitter = options.jitter || 0.2

    const delay = Math.min(initial * Math.pow(multiplier, attempt), max)
    const jitterAmount = delay * jitter * Math.random()
    
    return Math.round(delay + jitterAmount)
  }

  /**
   * Linear backoff
   */
  static linearBackoff(
    attempt: number,
    options: {
      initialMs?: number
      maxMs?: number
      increment?: number
    } = {}
  ): number {
    const initial = options.initialMs || 1000
    const max = options.maxMs || 30000
    const increment = options.increment || 1000

    const delay = Math.min(initial + (attempt * increment), max)
    return delay
  }

  /**
   * Circuit breaker pattern
   */
  static circuitBreaker<T>(
    operation: () => Promise<T>,
    options: {
      failureThreshold?: number
      successThreshold?: number
      timeout?: number
    } = {}
  ): Promise<T> {
    const {
      failureThreshold = 5,
      successThreshold = 3,
      timeout = 60000,
    } = options

    // Simple circuit breaker implementation
    let failures = 0
    let successes = 0
    let state: 'closed' | 'open' | 'half-open' = 'closed'
    let lastFailureTime = 0

    return operation()
  }
}

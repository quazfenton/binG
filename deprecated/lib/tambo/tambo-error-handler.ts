/**
 * Tambo Error Handler
 * 
 * Comprehensive error handling with retry logic, fallbacks,
 * and user-friendly error messages.
 * 
 * @see https://tambo.ai/docs
 */

/**
 * Tambo error categories
 */
export type TamboErrorCategory = 
  | 'auth'
  | 'network'
  | 'rate_limit'
  | 'timeout'
  | 'validation'
  | 'component'
  | 'tool'
  | 'unknown';

/**
 * Tambo error structure
 */
export interface TamboError extends Error {
  category: TamboErrorCategory;
  retryable: boolean;
  userMessage: string;
  details?: Record<string, any>;
  retryAfter?: number;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  exponentialBackoff: boolean;
  retryableStatusCodes: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  exponentialBackoff: true,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
};

/**
 * Create a Tambo error
 */
export function createTamboError(
  message: string,
  category: TamboErrorCategory,
  options?: {
    retryable?: boolean;
    userMessage?: string;
    details?: Record<string, any>;
    retryAfter?: number;
    cause?: Error;
  }
): TamboError {
  const error = new Error(message) as TamboError;
  error.category = category;
  error.retryable = options?.retryable ?? isRetryableByDefault(category);
  error.userMessage = options?.userMessage ?? getUserMessage(category, message);
  error.details = options?.details;
  error.retryAfter = options?.retryAfter;
  
  if (options?.cause) {
    error.cause = options.cause;
  }
  
  return error;
}

/**
 * Determine if error category is retryable by default
 */
function isRetryableByDefault(category: TamboErrorCategory): boolean {
  switch (category) {
    case 'network':
    case 'timeout':
    case 'rate_limit':
      return true;
    case 'auth':
    case 'validation':
    case 'component':
    case 'tool':
      return false;
    default:
      return false;
  }
}

/**
 * Get user-friendly error message for category
 */
function getUserMessage(category: TamboErrorCategory, originalMessage: string): string {
  switch (category) {
    case 'auth':
      return 'Authentication failed. Please sign in again.';
    case 'network':
      return 'Connection issue. Please check your internet connection.';
    case 'rate_limit':
      return 'Too many requests. Please wait a moment and try again.';
    case 'timeout':
      return 'Request timed out. Please try again.';
    case 'validation':
      return 'Invalid input. Please check your request.';
    case 'component':
      return 'Component rendering failed. Please try again.';
    case 'tool':
      return 'Tool execution failed. Please try again.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
}

/**
 * Categorize an error from HTTP response or exception
 */
export function categorizeError(error: any): TamboErrorCategory {
  if (!error) {
    return 'unknown';
  }

  const message = (error.message || '').toLowerCase();
  const status = error.status || error.response?.status;

  // Auth errors
  if (status === 401 || status === 403 || 
      message.includes('auth') || 
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('token')) {
    return 'auth';
  }

  // Rate limit errors
  if (status === 429 || message.includes('rate limit') || message.includes('too many')) {
    return 'rate_limit';
  }

  // Timeout errors
  if (status === 408 || status === 504 || 
      message.includes('timeout') || 
      message.includes('timed out')) {
    return 'timeout';
  }

  // Network errors
  if (status >= 500 || 
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('connection') ||
      message.includes('offline')) {
    return 'network';
  }

  // Validation errors
  if (status === 400 || 
      message.includes('validation') ||
      message.includes('invalid') ||
      message.includes('required')) {
    return 'validation';
  }

  // Component errors
  if (message.includes('component') || 
      message.includes('render') ||
      message.includes('props')) {
    return 'component';
  }

  // Tool errors
  if (message.includes('tool') || 
      message.includes('execute')) {
    return 'tool';
  }

  return 'unknown';
}

/**
 * Handle Tambo error with retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: TamboError | null = null;
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      const category = categorizeError(error);
      const tamboError = createTamboError(
        error.message || 'Operation failed',
        category,
        { cause: error }
      );
      
      lastError = tamboError;
      
      // Check if retryable
      if (!tamboError.retryable || !config.retryableStatusCodes.includes(error.status)) {
        throw tamboError;
      }
      
      // Check if we have attempts left
      if (attempt >= config.maxAttempts) {
        throw tamboError;
      }
      
      // Calculate delay
      let delay: number;
      if (config.exponentialBackoff) {
        delay = config.baseDelay * Math.pow(2, attempt - 1);
      } else {
        delay = config.baseDelay;
      }
      
      // Add jitter
      delay = delay * (0.5 + Math.random());
      
      // Cap at max delay
      delay = Math.min(delay, config.maxDelay);
      
      // Use retry-after header if available
      if (error.headers?.['retry-after']) {
        delay = Math.max(delay, parseInt(error.headers['retry-after']) * 1000);
      }
      
      console.log(`[TamboErrorHandler] Retry ${attempt}/${config.maxAttempts} after ${Math.round(delay)}ms`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Error handler class for Tambo operations
 */
export class TamboErrorHandler {
  private config: RetryConfig;
  private errorCounts: Map<string, number> = new Map();
  
  constructor(config: RetryConfig = DEFAULT_RETRY_CONFIG) {
    this.config = config;
  }

  /**
   * Execute operation with retry logic
   */
  async execute<T>(
    operation: () => Promise<T>,
    context?: string
  ): Promise<T> {
    const key = context || 'default';
    
    try {
      return await withRetry(operation, this.config);
    } catch (error: any) {
      // Track error count
      const count = (this.errorCounts.get(key) || 0) + 1;
      this.errorCounts.set(key, count);
      
      // Log error
      console.error(`[TamboErrorHandler] ${context || 'Operation'} failed:`, error);
      
      throw error;
    }
  }

  /**
   * Get error count for context
   */
  getErrorCount(context: string): number {
    return this.errorCounts.get(context) || 0;
  }

  /**
   * Clear error counts
   */
  clearErrorCounts(): void {
    this.errorCounts.clear();
  }

  /**
   * Create user-friendly error message
   */
  getUserMessage(error: any): string {
    if (error.userMessage) {
      return error.userMessage;
    }
    
    const category = categorizeError(error);
    return getUserMessage(category, error.message);
  }

  /**
   * Check if error should be shown to user
   */
  shouldShowToUser(error: any): boolean {
    const category = categorizeError(error);
    
    // Don't show network retries to user
    if (category === 'network' && error.retryable) {
      return false;
    }
    
    // Don't show rate limit during retry
    if (category === 'rate_limit' && error.retryable) {
      return false;
    }
    
    return true;
  }
}

/**
 * Singleton error handler instance
 */
export const tamboErrorHandler = new TamboErrorHandler();

/**
 * Higher-order function for error handling
 */
export function withTamboErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  context?: string
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return tamboErrorHandler.execute(() => fn(...args), context);
  }) as T;
}

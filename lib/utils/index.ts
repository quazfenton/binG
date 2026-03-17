/**
 * Utils Module Re-exports
 *
 * Central export for all utility functions
 */

// Logger (unified with secure logging)
export {
  Logger,
  SecureLogger,
  LogLevel,
  LogEntry,
  LoggerConfig,
  createLogger,
  createSecureLogger,
  configureLogger,
  flushLogs,
  loggers,
  sanitizeForLogging,
} from './logger';

// Error Handler (unified)
export {
  UnifiedErrorHandler,
  BaseError,
  ToolErrorClass as ToolError,
  APIError,
  ErrorCategory,
  ErrorSeverity,
  StandardError,
  ToolExecutionResult,
  ProcessedError,
  UserNotification,
  ErrorHandlerConfig,
  getErrorHandler,
  handleError,
  createValidationError,
  createAuthError,
  createNotFoundError,
} from './error-handler';

// Other utilities
export {
  retry,
  RetryConfig,
  RetryError,
} from './retry';

export {
  RateLimiter,
  RateLimitConfig,
  RateLimitResult,
  rateLimiter,
} from './rate-limiter';

export {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitBreakerState,
  circuitBreaker,
} from './circuit-breaker';

export {
  RequestDeduplicator,
  RequestDedupConfig,
  requestDeduplicator,
} from './request-deduplicator';

export {
  createLogger as createSecureLogger,  // Backwards compatibility
} from './logger';

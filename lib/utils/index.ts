/**
 * Utils Module Re-exports
 *
 * Central export for all utility functions
 */

// Logger (unified with secure logging)
export {
  Logger,
  SecureLogger,
  createLogger,
  createSecureLogger,
  configureLogger,
  flushLogs,
  loggers,
  sanitizeForLogging,
} from './logger';
export type {
  LogLevel,
  LogEntry,
  LoggerConfig,
} from './logger';

// Error Handler (unified)
export {
  UnifiedErrorHandler,
  BaseError,
  ToolErrorClass as ToolError,
  APIError,
  getErrorHandler,
  handleError,
  createValidationError,
  createAuthError,
  createNotFoundError,
} from './error-handler';
export type {
  ErrorCategory,
  ErrorSeverity,
  StandardError,
  ToolExecutionResult,
  ProcessedError,
  UserNotification,
  ErrorHandlerConfig,
} from './error-handler';

// Other utilities
export {
  sleep,
} from './retry';
export type {
  RetryOptions,
} from './retry';

export {
  RateLimiter,
  terminalCommandRateLimiter,
  sandboxCreationRateLimiter,
  websocketConnectionRateLimiter,
} from './rate-limiter';
export type {
  RateLimitResult,
} from './rate-limiter';

export {
  CircuitBreaker,
  CircuitBreakerError,
  providerCircuitBreakers,
} from './circuit-breaker';
export type {
  CircuitBreakerOptions,
  CircuitState,
} from './circuit-breaker';

export {
  RequestDeduplicator,
  codeRequestDeduplicator,
} from './request-deduplicator';
export type {
  RequestFingerprint,
  InFlightRequest,
  DeduplicationConfig,
} from './request-deduplicator';

// Image loader with SSRF protection
export {
  validateImageUrl,
  isHostnameSafe,
  getHostname,
} from './image-loader';

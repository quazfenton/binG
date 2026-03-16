/**
 * Secure Logger
 *
 * @deprecated Use createLogger(source, { secure: true }) from lib/utils/logger.ts instead
 *
 * This module is kept for backwards compatibility.
 * All new code should use:
 * ```typescript
 * import { createLogger } from '@/lib/utils/logger';
 * const logger = createLogger('MyService', { secure: true });
 * ```
 */

// Import from unified logger
import {
  Logger,
  LogLevel,
  LogEntry,
  LoggerConfig as UnifiedLoggerConfig,
  createLogger,
  configureLogger,
  flushLogs,
  loggers,
} from './logger';

/**
 * Secure Logger configuration
 * @deprecated Use LoggerConfig from unified logger instead
 */
export interface SecureLoggerConfig {
  level?: LogLevel;
  enableRedaction?: boolean;
  enableTimestamps?: boolean;
  prefix?: string;
  secure?: boolean;
}

/**
 * Backwards-compatible SecureLogger class
 * Wraps the unified Logger to maintain old API
 * 
 * @deprecated Use createLogger(source, { secure: true }) instead
 */
export class SecureLogger extends Logger {
  constructor(config?: SecureLoggerConfig) {
    super('SecureLogger', {
      level: config?.level || 'info',
      enableRedaction: config?.enableRedaction ?? true,
      enableTimestamps: config?.enableTimestamps ?? true,
      prefix: config?.prefix || '[SecureLogger]',
      secure: true,
    });
  }

  /**
   * Enable redaction
   * @deprecated Use createLogger with secure: true instead
   */
  enableRedaction(): void {
    this.config.secure = true;
  }

  /**
   * Disable redaction (for debugging only!)
   * @warning Never use in production
   * @deprecated This should never be used
   */
  disableRedaction(): void {
    console.warn('⚠️  Redaction disabled - DO NOT USE IN PRODUCTION');
    this.config.secure = false;
  }

  /**
   * Redact sensitive data from a string
   * @deprecated Use createLogger(source, { secure: true }).info() instead
   */
  redact(text: string): string {
    // Access protected method via super call
    return (this as any).redact(text);
  }

  /**
   * Redact sensitive data from an object
   * @deprecated Use createLogger(source, { secure: true }).info() instead
   */
  redactObject(obj: any, maxDepth?: number): any {
    // Access protected method via super call
    return (this as any).redactObject(obj, maxDepth);
  }

  /**
   * Create a child logger
   * @deprecated Use createLogger(source, { secure: true }) instead
   */
  child(prefix: string): SecureLogger {
    const child = new SecureLogger({
      level: this.config.level,
      enableRedaction: this.config.secure,
      enableTimestamps: this.config.enableTimestamps,
      prefix: `${this.config.prefix || ''}${prefix}`,
    });
    return child;
  }
}

// Re-export types and functions for backwards compatibility
export {
  LogLevel,
  LogEntry,
  createLogger,
  configureLogger,
  flushLogs,
  loggers,
};

/**
 * @deprecated Use LoggerConfig from unified logger instead
 */
export type LoggerConfig = SecureLoggerConfig;

// Create default secure logger instance for backwards compatibility
/**
 * @deprecated Use createLogger('SecureLogger', { secure: true }) instead
 */
export const logger = new SecureLogger();

/**
 * Create a logger for a specific module
 * @deprecated Use createLogger(source, { secure: true }) instead
 */
export function createModuleLogger(moduleName: string): SecureLogger {
  return new SecureLogger({ prefix: `[${moduleName}]` });
}

/**
 * Create a secure logger
 * @deprecated Use createLogger(source, { secure: true }) instead
 */
export function createSecureLogger(source: string, config?: SecureLoggerConfig): SecureLogger {
  return new SecureLogger({ ...config, prefix: `[${source}]` });
}

/**
 * Redact sensitive data from a string
 * @deprecated Use createLogger(source, { secure: true }) instead
 */
export function redactSensitiveData(text: string): string {
  return logger.redact(text);
}

/**
 * Sanitize object for logging
 * @deprecated Use createLogger(source, { secure: true }).info() instead
 */
export function sanitizeForLogging(obj: any): any {
  return logger.redactObject(obj);
}

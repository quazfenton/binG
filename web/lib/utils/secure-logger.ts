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
import { Logger, createLogger, configureLogger, flushLogs, loggers, type LogLevel, type LogEntry, type LoggerConfig as UnifiedLoggerConfig } from './logger';

// Re-export for backwards compatibility
export { Logger, createLogger, configureLogger, flushLogs, loggers };
export type { LogLevel, LogEntry };

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
  private secureEnabled: boolean = true;

  constructor(config?: SecureLoggerConfig) {
    const source = config?.prefix ? config.prefix : 'SecureLogger';
    const level = config?.level || 'info';
    super(source, {
      minLevel: level,
      secure: true,
      showTimestamp: config?.enableTimestamps ?? true,
      showSource: !!config?.prefix,
      includeStack: false,
    });
    this.secureEnabled = config?.enableRedaction ?? true;
  }

  /**
   * Enable redaction
   * @deprecated Use createLogger with secure: true instead
   */
  enableRedaction(): void {
    this.secureEnabled = true;
  }

  /**
   * Disable redaction (for debugging only!)
   * @warning Never use in production
   * @deprecated This should never be used
   */
  disableRedaction(): void {
    console.warn('⚠️  Redaction disabled - DO NOT USE IN PRODUCTION');
    this.secureEnabled = false;
  }

  /**
   * Redact sensitive data from a string
   * @deprecated Use createLogger(source, { secure: true }).info() instead
   */
  redact(text: string): string {
    // SecureLogger has its own redaction patterns that differ from unified logger
    // This maintains backwards compatibility for existing tests
    if (!this.secureEnabled) {
      return text; // Redaction disabled
    }
    return text
      .replace(/sk-[a-zA-Z0-9]{3,}/g, '[REDACTED]')  // Allow shorter keys for backwards compatibility
      .replace(/bearer\s+[a-zA-Z0-9\-_.]{20,}/gi, 'Bearer [REDACTED]')
      .replace(/api_key=([a-zA-Z0-9]{16,})/gi, 'api_key=[REDACTED]')
      .replace(/token=([a-zA-Z0-9\-_.]{20,})/gi, 'token=[REDACTED]')
      .replace(/secret=([a-zA-Z0-9\-_]{16,})/gi, 'secret=[REDACTED]')
      .replace(/password=([^\s'"]{4,})/gi, 'password=[REDACTED]')
      .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED]')
      .replace(/ghp_[a-zA-Z0-9]{36}/g, '[REDACTED]')
      .replace(/ya29\.[a-zA-Z0-9\-_]{20,}/g, '[REDACTED]');
  }

  /**
   * Redact sensitive data from an object
   * @deprecated Use createLogger(source, { secure: true }).info() instead
   */
  redactObject(obj: any, maxDepth = 10): any {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(item => this.redactObject(item, maxDepth - 1));
    if (maxDepth <= 0) return '[Maximum depth exceeded]';

    const redacted: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        redacted[key] = this.redact(value);
      } else if (typeof value === 'object' && value !== null) {
        redacted[key] = this.redactObject(value, maxDepth - 1);
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  /**
   * Create a child logger
   * @deprecated Use createLogger(source, { secure: true }) instead
   */
  child(prefix: string): SecureLogger {
    const currentSource = (this as any).source;
    const child = new SecureLogger({
      level: (this as any).config.minLevel,
      enableRedaction: this.secureEnabled,
      enableTimestamps: (this as any).config.showTimestamp,
      prefix: currentSource ? `${currentSource} ${prefix}` : prefix,
    });
    return child;
  }

  /**
   * Configure logger (legacy API compatibility)
   * @deprecated Use createLogger(source, { secure: true }) instead
   */
  configure(config: { level?: LogLevel; [key: string]: any }) {
    if (config.level) {
      (this as any).config.minLevel = config.level;
    }
    // Pass through other config
    super.configure(config as any);
  }
}

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
  return logger.redactObject(obj, 10);
}

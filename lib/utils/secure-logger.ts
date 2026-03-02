/**
 * Secure Logger with API Key Redaction
 *
 * Provides secure logging that automatically redacts sensitive information.
 * Prevents API keys, tokens, and secrets from appearing in logs.
 *
 * Features:
 * - Automatic API key redaction
 * - Token/secret pattern detection
 * - Configurable redaction levels
 * - Safe object logging
 *
 * @see docs/COMPREHENSIVE_REVIEW_FINDINGS.md Security section
 */

/**
 * Sensitive data patterns to redact
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // API Keys (various formats)
  /sk-[a-zA-Z0-9]{20,}/g,                    // OpenAI-style keys
  /api[_-]?key[=:]\s*['"]?[a-zA-Z0-9]{16,}/gi,
  /apikey[=:]\s*['"]?[a-zA-Z0-9]{16,}/gi,
  
  // Tokens
  /token[=:]\s*['"]?[a-zA-Z0-9\-_.]{20,}/gi,
  /bearer\s+[a-zA-Z0-9\-_.]{20,}/gi,
  /access[_-]?token[=:]\s*['"]?[a-zA-Z0-9\-_.]{20,}/gi,
  
  // Secrets
  /secret[=:]\s*['"]?[a-zA-Z0-9\-_]{16,}/gi,
  /password[=:]\s*['"]?[^\s'"]{4,}/gi,
  
  // AWS
  /AKIA[0-9A-Z]{16}/g,                       // AWS Access Key ID
  /aws[_-]?secret[=:]\s*['"]?[a-zA-Z0-9\/+=]{40}/gi,
  
  // GitHub
  /ghp_[a-zA-Z0-9]{36}/g,                    // GitHub Personal Access Token
  /gho_[a-zA-Z0-9]{36}/g,                    // GitHub OAuth Token
  /ghu_[a-zA-Z0-9]{36}/g,                    // GitHub User Token
  /ghs_[a-zA-Z0-9]{36}/g,                    // GitHub Server Token
  /ghr_[a-zA-Z0-9]{36}/g,                    // GitHub Refresh Token
  
  // Google
  /ya29\.[a-zA-Z0-9\-_]{20,}/g,              // Google OAuth Token
  
  // Generic
  /[a-zA-Z0-9]{32,}/g,                       // Long alphanumeric strings (potential keys)
];

/**
 * Redaction replacement string
 */
const REDACTED = '[REDACTED]';

/**
 * Logger level
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Minimum log level to display */
  level: LogLevel;
  /** Enable/disable redaction */
  enableRedaction: boolean;
  /** Additional patterns to redact */
  additionalPatterns?: RegExp[];
  /** Prefix for all log messages */
  prefix?: string;
  /** Enable/disable timestamps */
  enableTimestamps: boolean;
}

/**
 * Default logger configuration
 */
const DEFAULT_CONFIG: LoggerConfig = {
  level: 'info',
  enableRedaction: true,
  enableTimestamps: true,
};

/**
 * Log level priorities
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

/**
 * Secure Logger Class
 *
 * @example
 * ```typescript
 * const logger = new SecureLogger({ 
 *   level: 'debug',
 *   prefix: '[MyApp]'
 * });
 * 
 * // Logs are automatically redacted
 * logger.info('API Key:', process.env.API_KEY);
 * // Output: [MyApp] API Key: [REDACTED]
 * 
 * logger.error('Error:', error);
 * // Error object is sanitized
 * ```
 */
export class SecureLogger {
  private config: LoggerConfig;
  private patterns: RegExp[];

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    this.patterns = [
      ...SENSITIVE_PATTERNS,
      ...(config.additionalPatterns || []),
    ];
  }

  /**
   * Redact sensitive information from a string
   *
   * @param text - Text to redact
   * @returns Redacted text
   *
   * @example
   * ```typescript
   * const redacted = logger.redact('API Key: sk-abc123...');
   * // Returns: 'API Key: [REDACTED]'
   * ```
   */
  redact(text: string): string {
    if (!this.config.enableRedaction) {
      return text;
    }

    let redacted = text;

    for (const pattern of this.patterns) {
      redacted = redacted.replace(pattern, REDACTED);
    }

    return redacted;
  }

  /**
   * Redact sensitive information from an object
   *
   * @param obj - Object to sanitize
   * @param depth - Maximum depth to traverse (default: 5)
   * @returns Sanitized object
   *
   * @example
   * ```typescript
   * const safe = logger.redactObject({ apiKey: 'sk-123', data: 'test' });
   * // Returns: { apiKey: '[REDACTED]', data: 'test' }
   * ```
   */
  redactObject(obj: any, depth: number = 5): any {
    if (!this.config.enableRedaction) {
      return obj;
    }

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.redact(obj);
    }

    if (typeof obj !== 'object') {
      return obj;
    }

    if (depth <= 0) {
      return '[Maximum depth exceeded]';
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item, depth - 1));
    }

    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Redact values for sensitive keys
      if (this.isSensitiveKey(key)) {
        result[key] = REDACTED;
      } else {
        result[key] = this.redactObject(value, depth - 1);
      }
    }

    return result;
  }

  /**
   * Check if a key name suggests sensitive data
   */
  private isSensitiveKey(key: string): boolean {
    const sensitiveKeys = [
      'apiKey',
      'api_key',
      'apikey',
      'token',
      'secret',
      'password',
      'passwd',
      'credential',
      'auth',
      'authorization',
      'bearer',
      'access_token',
      'refresh_token',
      'private_key',
      'secret_key',
    ];

    const keyLower = key.toLowerCase();
    return sensitiveKeys.some((sensitive) => keyLower.includes(sensitive));
  }

  /**
   * Format log message with timestamp and prefix
   */
  private formatMessage(level: LogLevel, message: any, ...args: any[]): string {
    const parts: string[] = [];

    // Add timestamp
    if (this.config.enableTimestamps) {
      parts.push(`[${new Date().toISOString()}]`);
    }

    // Add prefix
    if (this.config.prefix) {
      parts.push(this.config.prefix);
    }

    // Add level
    parts.push(`[${level.toUpperCase()}]`);

    // Add message
    if (typeof message === 'string') {
      parts.push(this.redact(message));
    } else if (typeof message === 'object') {
      parts.push(JSON.stringify(this.redactObject(message), null, 2));
    } else {
      parts.push(String(message));
    }

    // Add additional arguments
    for (const arg of args) {
      if (typeof arg === 'string') {
        parts.push(this.redact(arg));
      } else if (typeof arg === 'object') {
        parts.push(JSON.stringify(this.redactObject(arg), null, 2));
      } else {
        parts.push(String(arg));
      }
    }

    return parts.join(' ');
  }

  /**
   * Check if log level should be displayed
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  /**
   * Log debug message
   */
  debug(message: any, ...args: any[]): void {
    if (!this.shouldLog('debug')) return;
    console.debug(this.formatMessage('debug', message, ...args));
  }

  /**
   * Log info message
   */
  info(message: any, ...args: any[]): void {
    if (!this.shouldLog('info')) return;
    console.info(this.formatMessage('info', message, ...args));
  }

  /**
   * Log warning message
   */
  warn(message: any, ...args: any[]): void {
    if (!this.shouldLog('warn')) return;
    console.warn(this.formatMessage('warn', message, ...args));
  }

  /**
   * Log error message
   */
  error(message: any, ...args: any[]): void {
    if (!this.shouldLog('error')) return;
    console.error(this.formatMessage('error', message, ...args));
  }

  /**
   * Log success message (info level with checkmark)
   */
  success(message: any, ...args: any[]): void {
    if (!this.shouldLog('info')) return;
    const formatted = typeof message === 'string' ? `✅ ${message}` : message;
    console.info(this.formatMessage('info', formatted, ...args));
  }

  /**
   * Create a child logger with additional prefix
   */
  child(prefix: string): SecureLogger {
    return new SecureLogger({
      ...this.config,
      prefix: this.config.prefix ? `${this.config.prefix} ${prefix}` : prefix,
    });
  }

  /**
   * Update logger configuration
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };

    if (config.additionalPatterns) {
      this.patterns = [...this.patterns, ...config.additionalPatterns];
    }
  }

  /**
   * Enable redaction
   */
  enableRedaction(): void {
    this.config.enableRedaction = true;
  }

  /**
   * Disable redaction (for debugging only!)
   *
   * @warning Never use in production
   */
  disableRedaction(): void {
    console.warn('⚠️  Redaction disabled - DO NOT USE IN PRODUCTION');
    this.config.enableRedaction = false;
  }

  /**
   * Get current configuration
   */
  getConfig(): LoggerConfig {
    return { ...this.config };
  }
}

/**
 * Default secure logger instance
 *
 * @example
 * ```typescript
 * import { logger } from '@/lib/utils/secure-logger';
 *
 * logger.info('User logged in', { userId: 123 });
 * logger.error('API call failed', { url, error });
 * ```
 */
export const logger = new SecureLogger({
  level: (process.env.LOG_LEVEL as LogLevel) || 'info',
  enableRedaction: true,
  enableTimestamps: true,
  prefix: '[App]',
});

/**
 * Create a logger for a specific module
 *
 * @param moduleName - Module name for prefix
 * @returns Configured logger instance
 *
 * @example
 * ```typescript
 * const logger = createModuleLogger('ComposioService');
 * logger.info('Initialized');
 * // Output: [App] [ComposioService] [INFO] Initialized
 * ```
 */
export function createModuleLogger(moduleName: string): SecureLogger {
  return logger.child(`[${moduleName}]`);
}

/**
 * Redact sensitive data from a string
 *
 * @param text - Text to redact
 * @returns Redacted text
 *
 * @example
 * ```typescript
 * const safe = redactSensitiveData('API Key: sk-123...');
 * // Returns: 'API Key: [REDACTED]'
 * ```
 */
export function redactSensitiveData(text: string): string {
  const tempLogger = new SecureLogger();
  return tempLogger.redact(text);
}

/**
 * Sanitize object for logging
 *
 * @param obj - Object to sanitize
 * @returns Sanitized object
 *
 * @example
 * ```typescript
 * const safe = sanitizeForLogging({ apiKey: 'sk-123', data: 'test' });
 * // Returns: { apiKey: '[REDACTED]', data: 'test' }
 * ```
 */
export function sanitizeForLogging(obj: any): any {
  const tempLogger = new SecureLogger();
  return tempLogger.redactObject(obj);
}

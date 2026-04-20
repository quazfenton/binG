/**
 * Unified Logger with Secure Redaction
 *
 * Provides consistent logging across the application with:
 * - Log levels (debug, info, warn, error)
 * - Environment-aware filtering
 * - Structured output for log aggregation
 * - Source identification
 * - Optional file export (server-side only)
 * - Automatic sensitive data redaction
 *
 * Merges functionality from:
 * - lib/utils/logger.ts (base logging)
 * - lib/utils/secure-logger.ts (API key redaction)
 *
 * @example
 * ```typescript
 * // Basic logging
 * const logger = createLogger('MyService');
 * logger.info('User logged in', { userId: 123 });
 *
 * // Secure logging (auto-redacts API keys, tokens, etc.)
 * const secureLogger = createLogger('AuthService', { secure: true });
 * secureLogger.info('API call with key:', process.env.API_KEY);
 * // Output: API call with key: [REDACTED]
 * ```
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  data?: any;
  error?: { name: string; message: string; stack?: string };
}

export interface LoggerConfig {
  minLevel: LogLevel;
  showTimestamp: boolean;
  showSource: boolean;
  includeStack: boolean;
  secure?: boolean;  // Enable automatic redaction
  redactPatterns?: RegExp[];  // Additional redaction patterns
  logToFile?: boolean;
  logFilePath?: string;
  maxFileSize?: number;
  maxFiles?: number;
}

// ============================================================================
// SENSITIVE DATA PATTERNS (from secure-logger.ts)
// ============================================================================

const SENSITIVE_PATTERNS: RegExp[] = [
  // API Keys (various formats)
  /sk-[a-zA-Z0-9]{20,}/g,
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
  /AKIA[0-9A-Z]{16}/g,
  /aws[_-]?secret[=:]\s*['"]?[a-zA-Z0-9\/+=]{40}/gi,

  // GitHub
  /ghp_[a-zA-Z0-9]{36}/g,
  /gho_[a-zA-Z0-9]{36}/g,
  /ghu_[a-zA-Z0-9]{36}/g,
  /ghs_[a-zA-Z0-9]{36}/g,
  /ghr_[a-zA-Z0-9]{36}/g,

  // Google
  /ya29\.[a-zA-Z0-9\-_]{20,}/g,

  // Generic
  /[a-zA-Z0-9]{32,}/g,
];

const REDACTED = '[REDACTED]';

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const DEFAULT_CONFIG: LoggerConfig = {
  minLevel: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  showTimestamp: true,
  showSource: true,
  includeStack: false,
  secure: false,
  redactPatterns: [],
  logToFile: typeof window === 'undefined' && process.env.LOG_TO_FILE === 'true',
  logFilePath: '',
  maxFileSize: 10,
  maxFiles: 5,
};

// Override with env vars on server-side only
if (typeof window === 'undefined' && typeof process !== 'undefined') {
  try {
    const pathModule = require('path');
    DEFAULT_CONFIG.logFilePath = process.env.LOG_FILE_PATH || pathModule.join(process.cwd(), 'logs', 'run.log');
    DEFAULT_CONFIG.maxFileSize = parseInt(process.env.LOG_MAX_FILE_SIZE || '10', 10);
    DEFAULT_CONFIG.maxFiles = parseInt(process.env.LOG_MAX_FILES || '5', 10);
  } catch (error) {
    // Silently fail - file logging won't work but console logging will
  }
}

// ============================================================================
// FILE LOGGING SETUP
// ============================================================================

let writeStream: any = null;

function initializeFileLogging(config: LoggerConfig) {
  if (typeof window !== 'undefined' || !config.logToFile) return;

  try {
    const fs = require('fs');
    const path = require('path');

    const logDir = path.dirname(config.logFilePath!);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
      console.log('[Logger] Created logs directory:', logDir);
    }

    writeStream = fs.createWriteStream(config.logFilePath, {
      flags: 'w',
      encoding: 'utf8',
      autoClose: true,
    });

    writeStream.on('error', (err: Error) => {
      console.error('[Logger] File write error:', err.message);
    });

    writeStream.on('open', () => {
      console.log('[Logger] File logging enabled:', config.logFilePath);
    });
  } catch (error: any) {
    console.error('[Logger] Failed to initialize file logging:', error.message);
  }
}

// Initialize on module load (server-side only)
if (typeof window === 'undefined') {
  try {
    initializeFileLogging(DEFAULT_CONFIG);
  } catch (error) {
    // Silent fail - console logging still works
  }
}

// ============================================================================
// LOGGER CLASS
// ============================================================================

export class Logger {
  protected config: LoggerConfig;
  protected source: string;
  protected patterns: RegExp[];

  constructor(source: string, config: Partial<LoggerConfig> = {}) {
    this.source = source;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.patterns = [
      ...SENSITIVE_PATTERNS,
      ...(config.redactPatterns || []),
    ];

    if (this.config.logToFile && !writeStream) {
      initializeFileLogging(this.config);
    }
  }

  // ============================================================================
  // REDACTION (from secure-logger.ts)
  // ============================================================================

  /**
   * Redact sensitive information from a string
   */
  protected redact(text: string): string {
    if (!this.config.secure) {
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
   */
  protected sanitizeObject(obj: any): any {
    if (!this.config.secure || !obj || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Redact sensitive keys
      if (['password', 'secret', 'apiKey', 'api_key', 'token', 'authorization', 'auth'].includes(key.toLowerCase())) {
        sanitized[key] = REDACTED;
      } else if (typeof value === 'string') {
        sanitized[key] = this.redact(value);
      } else if (typeof value === 'object') {
        sanitized[key] = this.sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  // ============================================================================
  // LOGGING CORE
  // ============================================================================

  private shouldLog(level: LogLevel): boolean {
    if (level === 'silent') return false;
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.minLevel];
  }

  private formatEntry(level: LogLevel, message: string, data?: any, error?: Error): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      source: this.source,
      message: this.config.secure ? this.redact(message) : message,
      ...(data !== undefined && { data: this.config.secure ? this.sanitizeObject(data) : data }),
      ...(error && { error: { 
        name: error.name, 
        message: this.config.secure ? this.redact(error.message) : error.message, 
        stack: this.config.includeStack ? error.stack : undefined 
      }}),
    };
  }

  private output(level: LogLevel, entry: LogEntry) {
    if (!this.shouldLog(level)) return;

    const parts: string[] = [];

    if (this.config.showTimestamp) {
      parts.push(`[${entry.timestamp}]`);
    }

    parts.push(`[${level.toUpperCase()}]`);

    if (this.config.showSource) {
      parts.push(`[${entry.source}]`);
    }

    parts.push(entry.message);

    const logLine = parts.join(' ');

    // Write to file if enabled (server-side only)
    if (writeStream) {
      writeStream.write(JSON.stringify(entry) + '\n');
    }

    // Also output to console
    const logFn = level === 'error' ? console.error :
                  level === 'warn' ? console.warn :
                  console.log;

    if (entry.data !== undefined) {
      logFn(logLine, entry.data);
    } else {
      logFn(logLine);
    }

    if (entry.error && this.config.includeStack) {
      console.error(entry.error);
    }

    // In production, also send to error tracking service
    if (level === 'error' && process.env.NODE_ENV === 'production') {
      this.sendToErrorService(entry);
    }
  }

  private sendToErrorService(entry: LogEntry) {
    // Hook for error tracking services (Sentry, LogRocket, etc.)
    if (typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.captureException({
        message: entry.message,
        level: entry.level,
        extra: entry.data,
      });
    }
  }

  // ============================================================================
  // PUBLIC LOGGING METHODS
  // ============================================================================

  debug(message: string, data?: any) {
    this.output('debug', this.formatEntry('debug', message, data));
  }

  info(message: string, data?: any) {
    this.output('info', this.formatEntry('info', message, data));
  }

  warn(message: string, data?: any) {
    this.output('warn', this.formatEntry('warn', message, data));
  }

  error(message: string, error?: Error | any, data?: any) {
    const err = error instanceof Error ? error : new Error(String(error));
    this.output('error', this.formatEntry('error', message, data, err));
  }

  /**
   * Create a child logger with a modified source
   */
  child(childSource: string): Logger {
    return new Logger(`${this.source}:${childSource}`, this.config);
  }

  /**
   * Update logger configuration
   */
  configure(config: Partial<LoggerConfig>) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): LoggerConfig {
    return { ...this.config };
  }

  /**
   * Flush and close file streams (call before process exit)
   */
  destroy() {
    if (writeStream) {
      writeStream.end();
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a logger instance for a specific source
 * 
 * @param source - Logger source name
 * @param options - Logger options
 * @param options.secure - Enable automatic redaction of sensitive data
 * @param options.redactPatterns - Additional redaction patterns
 * 
 * @example
 * ```typescript
 * // Basic logger
 * const logger = createLogger('API');
 * 
 * // Secure logger (auto-redacts API keys, tokens, etc.)
 * const logger = createLogger('Auth', { secure: true });
 * ```
 */
export function createLogger(source: string, options: { secure?: boolean; redactPatterns?: RegExp[] } = {}): Logger {
  return new Logger(source, options);
}

/**
 * Global logger configuration
 */
export function configureLogger(config: Partial<LoggerConfig>) {
  Object.assign(DEFAULT_CONFIG, config);
}

/**
 * Flush all log streams and cleanup (call before process exit)
 */
export function flushLogs(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (writeStream) {
        writeStream.end();
      }
      resolve();
    }, 100);
  });
}

// ============================================================================
// PRE-CONFIGURED LOGGERS
// ============================================================================

export const loggers = {
  app: createLogger('App'),
  api: createLogger('API'),
  terminal: createLogger('Terminal'),
  sandbox: createLogger('Sandbox'),
  auth: createLogger('Auth', { secure: true }),  // Secure by default
  mcp: createLogger('MCP', { secure: true }),    // Secure by default
  tool: createLogger('Tool', { secure: true }),  // Secure by default
  oauth: createLogger('OAuth', { secure: true }), // Secure by default
};

// ============================================================================
// REGISTER CLEANUP HANDLERS (server-side Node.js runtime only)
// ============================================================================

// Only register process handlers in Node.js runtime (not Edge Runtime)
if (typeof process !== 'undefined' && typeof window === 'undefined' && process.env.NEXT_RUNTIME !== 'edge') {
  process.on('exit', () => {
    if (writeStream) {
      writeStream.end();
    }
  });

  process.on('SIGINT', async () => {
    await flushLogs();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await flushLogs();
    process.exit(0);
  });

  // Only add process event listeners once to prevent memory leaks
  // Check if listeners already exist before adding
  if (process.listenerCount('uncaughtException') === 0) {
    process.on('uncaughtException', async (err) => {
      console.error('Uncaught Exception:', err);
      await flushLogs();
      process.exit(1);
    });
  }

  if (process.listenerCount('unhandledRejection') === 0) {
    process.on('unhandledRejection', async (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      await flushLogs();
      process.exit(1);
    });
  }
}

// ============================================================================
// BACKWARDS COMPATIBILITY
// ============================================================================

// Re-export for backwards compatibility with secure-logger.ts
export { Logger as SecureLogger };
export function createSecureLogger(source: string, config?: Partial<LoggerConfig>): Logger {
  return createLogger(source, { ...config, secure: true });
}

// Export sanitize function for standalone use
export function sanitizeForLogging(data: any): any {
  const logger = createLogger('sanitize', { secure: true });
  return (logger as any).sanitizeObject(data);
}

export default Logger;

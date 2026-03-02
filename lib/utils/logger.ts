/**
 * Structured Logging Utility
 * 
 * Provides consistent logging across the application with:
 * - Log levels (debug, info, warn, error)
 * - Environment-aware filtering
 * - Structured output for log aggregation
 * - Source identification
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  data?: any;
  error?: Error;
}

export interface LoggerConfig {
  minLevel: LogLevel;
  showTimestamp: boolean;
  showSource: boolean;
  includeStack: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_CONFIG: LoggerConfig = {
  minLevel: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  showTimestamp: true,
  showSource: true,
  includeStack: false,
};

class Logger {
  private config: LoggerConfig;
  private source: string;

  constructor(source: string, config: Partial<LoggerConfig> = {}) {
    this.source = source;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.minLevel];
  }

  private formatEntry(level: LogLevel, message: string, data?: any, error?: Error): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      source: this.source,
      message,
      ...(data !== undefined && { data }),
      ...(error && { error: { message: error.message, stack: error.stack } }),
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

    const logFn = level === 'error' ? console.error : 
                  level === 'warn' ? console.warn : 
                  console.log;

    if (entry.data !== undefined) {
      logFn(parts.join(' '), entry.data);
    } else {
      logFn(parts.join(' '));
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
}

/**
 * Create a logger instance for a specific source
 */
export function createLogger(source: string, config?: Partial<LoggerConfig>): Logger {
  return new Logger(source, config);
}

/**
 * Global logger configuration
 */
export function configureLogger(config: Partial<LoggerConfig>) {
  Object.assign(DEFAULT_CONFIG, config);
}

// Pre-configured loggers for common modules
export const loggers = {
  app: createLogger('App'),
  api: createLogger('API'),
  terminal: createLogger('Terminal'),
  sandbox: createLogger('Sandbox'),
  auth: createLogger('Auth'),
  mcp: createLogger('MCP'),
};

export default Logger;

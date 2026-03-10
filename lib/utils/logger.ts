/**
 * Structured Logging Utility
 *
 * Provides consistent logging across the application with:
 * - Log levels (debug, info, warn, error)
 * - Environment-aware filtering
 * - Structured output for log aggregation
 * - Source identification
 * - Optional file export (server-side only)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

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
  logToFile?: boolean;
  logFilePath?: string;
  maxFileSize?: number; // in MB
  maxFiles?: number;
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
  logToFile: typeof window === 'undefined' && process.env.LOG_TO_FILE === 'true',
  logFilePath: '/tmp/app.log', // Will be set in initializeFileLogging
  maxFileSize: 10, // 10 MB - will be set properly in initializeFileLogging
  maxFiles: 5, // 5 files - will be set properly in initializeFileLogging
};

// Override with env vars on server-side only
if (typeof window === 'undefined' && typeof process !== 'undefined') {
  // Only use require on server-side
  const path = require('path');
  DEFAULT_CONFIG.logFilePath = process.env.LOG_FILE_PATH || path.join(process.cwd(), 'logs', 'app.log');
  DEFAULT_CONFIG.maxFileSize = parseInt(process.env.LOG_MAX_FILE_SIZE || '10', 10);
  DEFAULT_CONFIG.maxFiles = parseInt(process.env.LOG_MAX_FILES || '5', 10);
}

// Server-side file stream (only initialized on server)
let writeStream: any = null;
let fsModule: any = null;
let pathModule: any = null;

// Initialize file logging on server-side only
function initializeFileLogging() {
  if (typeof window !== 'undefined' || !DEFAULT_CONFIG.logToFile) return;

  try {
    // Dynamic require only on server-side
    fsModule = require('fs');
    pathModule = require('path');

    const logDir = pathModule.dirname(DEFAULT_CONFIG.logFilePath);
    if (!fsModule.existsSync(logDir)) {
      fsModule.mkdirSync(logDir, { recursive: true });
      console.log('[Logger] Created logs directory:', logDir);
    }

    writeStream = fsModule.createWriteStream(DEFAULT_CONFIG.logFilePath, {
      flags: 'a',
      encoding: 'utf8',
      autoClose: true,
    });

    writeStream.on('error', (err: Error) => {
      console.error('[Logger] File write error:', err.message);
    });

    writeStream.on('open', () => {
      console.log('[Logger] File logging enabled:', DEFAULT_CONFIG.logFilePath);
    });

    // Log file is auto-flushed on write, no manual flush needed
  } catch (error: any) {
    console.error('[Logger] Failed to initialize file logging:', error.message);
  }
}

// Initialize on module load (server-side only)
if (typeof window === 'undefined') {
  initializeFileLogging();
}

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
      ...(error && { error: { name: error.name, message: error.message, stack: error.stack } }),
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
      const jsonLine = JSON.stringify(entry);
      writeStream.write(jsonLine + '\n');
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
   * Flush and close file streams (call before process exit)
   */
  destroy() {
    if (writeStream) {
      writeStream.end();
    }
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

/**
 * Flush all log streams and cleanup (call before process exit)
 */
export function flushLogs(): Promise<void> {
  return new Promise((resolve) => {
    // Give streams time to flush
    setTimeout(() => {
      if (writeStream) {
        writeStream.end();
      }
      resolve();
    }, 100);
  });
}

// Register cleanup handlers (server-side only)
if (typeof process !== 'undefined' && typeof window === 'undefined') {
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

  process.on('uncaughtException', async (err) => {
    console.error('Uncaught Exception:', err);
    await flushLogs();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    await flushLogs();
    process.exit(1);
  });
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

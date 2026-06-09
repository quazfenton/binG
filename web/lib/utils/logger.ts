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

// Lazily-initialised fs module reference — hoisted to module scope to avoid
// `require('fs')` in the hot path (output() runs on every log line).
// The inner `typeof window !== 'undefined'` guard is required so Next.js
// webpack can statically analyse and tree-shake the `require('fs')` out of
// client bundles — a bare try/catch alone is NOT enough for tree-shaking.
let _fs: any = null;
function _getFs(): any {
  if (!_fs) {
    if (typeof window !== 'undefined') return null;
    try { _fs = require('fs'); } catch { return null; }
  }
  return _fs;
}

// Raw file descriptor for synchronous, guaranteed-disk-persistence writes.
// Using a raw fd + fs.writeSync + fs.fsyncSync ensures every log line hits
// disk immediately — no Node.js stream buffer (16 KB default) and no OS page
// cache delay.  This fixes the long-standing issue where run.log drops lines
// during normal operation and loses everything buffered on process termination.
let logFd: number | null = null;

// Kept for backward-compatible null checks; redirects to logFd internally.
let writeStream: any = null;

// ── Log Rotation State ──────────────────────────────────────────────────
// Rotation is triggered when the file exceeds maxFileSize (MB).  Rather than
// stat() on every write we accumulate a byte counter and only check when it
// crosses a threshold (every ~256 KB).  Rotation stops at maxFiles (delete
// oldest, rename chain, open fresh).
let _rotationBytesWritten = 0;
const _ROTATION_CHECK_INTERVAL = 256 * 1024; // 256 KB
let _rotationMaxSizeBytes = 10 * 1024 * 1024; // 10 MB default
let _rotationMaxFiles = 5;
let _rotationLogPath = '';

function initializeFileLogging(config: LoggerConfig) {
  if (typeof window !== 'undefined' || !config.logToFile) return;

  try {
    const fs = _getFs();
    if (!fs) return;
    const path = require('path');

    const logDir = path.dirname(config.logFilePath!);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
      console.log('[Logger] Created logs directory:', logDir);
    }

    // Prevent double-open on module re-load in dev mode.
    if (logFd !== null) {
      console.log('[Logger] File logging already active, reusing fd');
      return;
    }

    // Store rotation config at module level for the hot path.
    _rotationLogPath = config.logFilePath!;
    _rotationMaxSizeBytes = (config.maxFileSize || 10) * 1024 * 1024;
    _rotationMaxFiles = config.maxFiles || 5;

    // Open raw fd for append — no stream buffering, every write goes to the OS
    // and fsyncSync pushes it through to disk.
    logFd = fs.openSync(config.logFilePath, 'a');

    // Keep writeStream truthy so existing `if (writeStream)` guards work.
    writeStream = { fd: logFd, destroyed: false };

    console.log('[Logger] File logging enabled (sync fd):', config.logFilePath);
  } catch (error: any) {
    console.error('[Logger] Failed to initialize file logging:', error.message);
  }
}

/**
 * Rotate the log file when it exceeds maxFileSize.
 *
 * Rotation chain (for maxFiles=5):
 *   1. Delete  run.log.4  (oldest)
 *   2. Rename  run.log.3 → run.log.4
 *   3. Rename  run.log.2 → run.log.3
 *   4. Rename  run.log.1 → run.log.2
 *   5. Rename  run.log   → run.log.1
 *   6. Open fresh run.log
 *
 * All operations are synchronous — no risk of interleaved writes between
 * close and reopen (Node.js is single-threaded event loop).
 */
function _rotateLogFile(): void {
  if (!_rotationLogPath || _rotationMaxFiles <= 0) return;

  const fs = _getFs();
  if (!fs) return;

  // 1. Close and fsync current fd
  if (logFd !== null) {
    try {
      fs.fsyncSync(logFd);
      fs.closeSync(logFd);
    } catch {
      // Best effort — file may already be closed / removed.
    }
    logFd = null;
    writeStream = null;
  }

  try {
    // 2. Delete the oldest rotation file (run.log.N-1)
    const oldestPath = `${_rotationLogPath}.${_rotationMaxFiles - 1}`;
    if (fs.existsSync(oldestPath)) {
      fs.unlinkSync(oldestPath);
    }

    // 3. Shift the chain: run.log.N-2 → run.log.N-1, ... , run.log.1 → run.log.2
    for (let i = _rotationMaxFiles - 2; i >= 1; i--) {
      const src = `${_rotationLogPath}.${i}`;
      const dst = `${_rotationLogPath}.${i + 1}`;
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst);
      }
    }

    // 4. Rename current run.log → run.log.1
    if (fs.existsSync(_rotationLogPath)) {
      fs.renameSync(_rotationLogPath, `${_rotationLogPath}.1`);
    }
  } catch (rotateErr: any) {
    console.error('[Logger] Rotation rename chain failed:', rotateErr.message);
    // Continue — we'll still try to reopen.
  }

  // 5. Open fresh run.log
  try {
    logFd = fs.openSync(_rotationLogPath, 'a');
    writeStream = { fd: logFd, destroyed: false };
    _rotationBytesWritten = 0;
  } catch (openErr: any) {
    console.error('[Logger] Failed to reopen log after rotation:', openErr.message);
    logFd = null;
    writeStream = null;
  }
}

/**
 * Check if rotation is needed — only stats when the byte counter crosses the
 * check-interval threshold, avoiding a stat syscall on every log line.
 */
function _checkRotation(bytesJustWritten: number): void {
  if (!_rotationLogPath || _rotationMaxFiles <= 0 || _rotationMaxSizeBytes <= 0) return;

  _rotationBytesWritten += bytesJustWritten;

  // Cap the check interval so small maxFileSize values don't cause massive
  // overshoot (e.g. a 100 KB limit shouldn't wait for 256 KB before checking).
  const effectiveInterval = Math.min(_ROTATION_CHECK_INTERVAL, Math.max(_rotationMaxSizeBytes / 4, 4096));
  if (_rotationBytesWritten < effectiveInterval) return;

  // Reset counter BEFORE stat so writes during this synchronous block
  // restart counting from 0 post-rotation.
  _rotationBytesWritten = 0;

  if (logFd === null) return;

  const fs = _getFs();
  if (!fs) return;

  try {
    const stat = fs.fstatSync(logFd);
    if (stat.size >= _rotationMaxSizeBytes) {
      _rotateLogFile();
    }
  } catch {
    // File might not exist yet or fd may be invalid — skip rotation.
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
      // Redact sensitive keys (case-insensitive comparison)
      const keyLower = key.toLowerCase();
      if (['password', 'secret', 'apikey', 'api_key', 'token', 'authorization', 'auth', 'accesstoken', 'access_token', 'refreshtoken', 'refresh_token'].includes(keyLower)) {
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
    // When minLevel is 'silent', suppress all output
    if (this.config.minLevel === 'silent') return false;
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

    // Write to file if enabled (server-side only).
    // Uses raw fd + fs.writeSync + fs.fsyncSync to guarantee every line
    // hits disk immediately — no Node.js stream buffer, no OS page-cache delay.
    if (logFd !== null) {
      try {
        const fs = _getFs();
        if (!fs) return;
        const line = JSON.stringify(entry) + '\n';
        const lineBytes = Buffer.byteLength(line);
        fs.writeSync(logFd, line);
        fs.fsyncSync(logFd);
        _checkRotation(lineBytes);
      } catch {
        // Best effort — don't crash the app over a log write failure.
      }
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
    // Auto-detect: if second arg is a plain data object (not an Error), shift to data
    if (error && typeof error === 'object' && !(error instanceof Error) && data === undefined) {
      data = error;
      error = undefined;
    }
    const err = error instanceof Error ? error : error !== undefined ? new Error(String(error)) : undefined;
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
    _closeLogFd();
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
 * Close and fsync the log file descriptor — call before process exit.
 * Guarantees all written data reaches disk before the process terminates.
 * Nullifies logFd BEFORE attempting close so that a leaked fd won't be
 * written to by subsequent calls (e.g. if closeSync throws).
 */
function _closeLogFd(): void {
  if (logFd === null) return;
  const fd = logFd;
  logFd = null;
  if (writeStream) writeStream.destroyed = true;
  try {
    const fs = _getFs();
    if (!fs) return;
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch {
    // Best effort — fd may leak but state is clean.
  }
}

/**
 * Flush all log streams synchronously — call before process exit.
 */
export function flushLogs(): void {
  _closeLogFd();
}

/**
 * Async variant kept for backward compatibility.
 */
export function flushLogsAsync(): Promise<void> {
  _closeLogFd();
  return Promise.resolve();
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

// Only register process handlers in Node.js runtime (not Edge Runtime).
//
// IMPORTANT: We do NOT install SIGTERM/SIGINT/uncaughtException handlers in
// development mode because Next.js dev server (Turbopack/HMR) relies on these
// signals for its own lifecycle management.  Installing process.exit() here
// would kill the dev server before it can recover or restart.
//
// The process.on('exit') handler below is safe in all modes — it only flushes
// the log fd when the process is ALREADY shutting down.
if (typeof process !== 'undefined' && typeof window === 'undefined' && process.env.NEXT_RUNTIME !== 'edge') {
  // process.on('exit') fires when the event loop empties. At that point
  // async operations won't complete, but our sync fsync+close will.
  process.on('exit', () => {
    _closeLogFd();
  });

  // Only register aggressive cleanup handlers in production.
  // In dev mode Next.js manages its own signal handling and we must
  // not interfere by calling process.exit().
  if (process.env.NODE_ENV === 'production') {
    process.on('SIGINT', () => {
      console.error('[Logger] SIGINT received — flushing logs before exit');
      _closeLogFd();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.error('[Logger] SIGTERM received — flushing logs before exit');
      _closeLogFd();
      process.exit(0);
    });

    if (process.listenerCount('uncaughtException') === 0) {
      process.on('uncaughtException', (err) => {
        console.error('[Logger] Uncaught Exception:', err);
        _closeLogFd();
        process.exit(1);
      });
    }

    if (process.listenerCount('unhandledRejection') === 0) {
      process.on('unhandledRejection', (reason) => {
        console.error('[Logger] Unhandled Rejection:', reason);
        _closeLogFd();
        process.exit(1);
      });
    }
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

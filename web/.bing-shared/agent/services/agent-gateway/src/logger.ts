/**
 * Simple logger for agent services
 *
 * NOTE (MED-10): This file is duplicated in agent-worker/src/logger.ts.
 * Both services are standalone microservices that cannot import from @/lib/utils/logger.
 * TODO: Extract to a shared @bing/shared/logger package for DRY.
 */

export interface LogLevel {
  debug(...args: any[]): void;
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
}

function createLogger(prefix: string): LogLevel {
  const format = (level: string, consoleMethod: 'log' | 'warn' | 'error', ...args: any[]) => {
    const timestamp = new Date().toISOString();
    console[consoleMethod](`[${timestamp}] [${level}] [${prefix}]`, ...args);
  };

  return {
    debug: (...args: any[]) => format('DEBUG', 'log', ...args),
    info: (...args: any[]) => format('INFO', 'log', ...args),
    warn: (...args: any[]) => format('WARN', 'warn', ...args),
    error: (...args: any[]) => format('ERROR', 'error', ...args),
  };
}

export { createLogger };

/**
 * Simple logger for agent services
 */

export interface LogLevel {
  debug(...args: any[]): void;
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
}

function createLogger(prefix: string): LogLevel {
  const format = (level: string, ...args: any[]) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] [${prefix}]`, ...args);
  };

  return {
    debug: (...args: any[]) => format('DEBUG', ...args),
    info: (...args: any[]) => format('INFO', ...args),
    warn: (...args: any[]) => format('WARN', ...args),
    error: (...args: any[]) => format('ERROR', ...args),
  };
}

export { createLogger };

/**
 * Logging Utility
 * 
 * Respects LOG_LEVEL environment variable:
 * - 'silent': Disable all logs
 * - 'error': Show only errors
 * - 'warn': Show warnings and errors
 * - 'info': Show info, warnings, and errors (default)
 * - 'debug': Show all logs including debug
 */

type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
const currentLevelNum = LOG_LEVELS[currentLevel] || 3;

export const logger = {
  debug: (...args: any[]) => {
    if (currentLevelNum >= LOG_LEVELS.debug) {
      console.log('[DEBUG]', ...args);
    }
  },

  info: (...args: any[]) => {
    if (currentLevelNum >= LOG_LEVELS.info) {
      console.log('[INFO]', ...args);
    }
  },

  warn: (...args: any[]) => {
    if (currentLevelNum >= LOG_LEVELS.warn) {
      console.warn('[WARN]', ...args);
    }
  },

  error: (...args: any[]) => {
    if (currentLevelNum >= LOG_LEVELS.error) {
      console.error('[ERROR]', ...args);
    }
  },

  success: (...args: any[]) => {
    if (currentLevelNum >= LOG_LEVELS.info) {
      console.log('[SUCCESS]', ...args);
    }
  },
};

// Export convenience functions
export const { debug, info, warn, error, success } = logger;

// Export for use in place of console
export default logger;

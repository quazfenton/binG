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

// Re-export from unified logger for backwards compatibility (excluding createSecureLogger to avoid duplicate)
export {
  Logger as SecureLogger,
  LogLevel,
  LogEntry,
  LoggerConfig,
  createLogger,
  configureLogger,
  flushLogs,
  loggers,
  sanitizeForLogging,
} from './logger';

// Create default secure logger instance for backwards compatibility
import { createLogger } from './logger';

/**
 * @deprecated Use createLogger('SecureLogger', { secure: true }) instead
 */
export const logger = createLogger('SecureLogger', { secure: true });

/**
 * @deprecated Use createLogger(source, { secure: true }) instead
 */
export function createSecureLogger(source: string) {
  return createLogger(source, { secure: true });
}

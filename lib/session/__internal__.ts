/**
 * Session Management - Internal Test Utilities
 *
 * ⚠️ INTERNAL USE ONLY - DO NOT IMPORT IN PRODUCTION CODE
 *
 * These utilities are for testing and internal use only.
 * They expose destructive state reset helpers that should not be
 * part of the public API.
 *
 * @internal
 * @private
 */

// Memory Lock Test Helpers
export {
  __clearAllLocks__,
} from './memory-lock';

// Queue Lock Test Helpers
export {
  __clearAllQueues__,
} from './queue-lock';

// Metrics Test Helpers
export {
  __clearAllMetrics__,
} from './lock-metrics';

/**
 * Clear all session lock state (for testing)
 *
 * ⚠️ WARNING: This clears ALL locks, queues, and metrics.
 * Should only be used in test setup/teardown.
 *
 * @internal
 */
export async function __clearAllSessionState__(): Promise<void> {
  const { __clearAllLocks__ } = await import('./memory-lock');
  const { __clearAllQueues__ } = await import('./queue-lock');
  const { __clearAllMetrics__ } = await import('./lock-metrics');

  __clearAllLocks__();
  __clearAllQueues__();
  __clearAllMetrics__();
}

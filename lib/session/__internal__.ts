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

import { __clearAllLocks__ } from './memory-lock';
import { __clearAllQueues__ } from './queue-lock';
import { __clearAllMetrics__ } from './lock-metrics';

export { __clearAllLocks__ };
export { __clearAllQueues__ };
export { __clearAllMetrics__ };

/**
 * Clear all session lock state (for testing)
 *
 * ⚠️ WARNING: This clears ALL locks, queues, and metrics.
 * Should only be used in test setup/teardown.
 *
 * @internal
 */
export function __clearAllSessionState__(): void {
  __clearAllLocks__();
  __clearAllQueues__();
  __clearAllMetrics__();
}

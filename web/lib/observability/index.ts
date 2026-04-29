/**
 * Observability Module
 *
 * Unified observability with tracing and metrics.
 *
 * @module observability
 */

// Tracing exports
export * from './tracing';

// Metrics exports
export * from './metrics';
import { registerAllMetrics } from './metrics';

// Constraint violation monitor exports
export * from './constraint-violation-monitor';

/**
 * Initialize observability
 */
export function initializeObservability(): void {
  registerAllMetrics();
  console.log('[Observability] Initialized with tracing and metrics');
}

/**
 * Get observability status
 */
export function getObservabilityStatus(): {
  tracingEnabled: boolean;
  metricsCount: number;
} {
  return {
    tracingEnabled: true,
    metricsCount: Object.keys(require('./metrics').METRICS).length,
  };
}

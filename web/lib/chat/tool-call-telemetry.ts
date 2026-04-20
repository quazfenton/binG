/**
 * Tool Call Telemetry
 *
 * In-memory per-model/per-tool success/failure tracking.
 * Used to detect models that consistently fail at tool calling
 * and auto-switch them to text mode.
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('tool-call-telemetry');

interface ToolCallRecord {
  model: string;
  toolName: string;
  success: boolean;
  timestamp: number;
  errorCode?: string;
}

interface ModelStats {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  byTool: Record<string, { success: number; failure: number }>;
  lastUpdated: number;
}

// In-memory store, keyed by model name
const modelStats: Record<string, ModelStats> = {};

// Rolling window: only consider calls from the last 30 minutes
const WINDOW_MS = 30 * 60 * 1000;

// Auto-log every N total calls
const AUTO_LOG_INTERVAL = 50;
let totalCallsSinceLastLog = 0;

/**
 * Record a tool call result for telemetry
 */
export function recordToolCall(
  model: string,
  toolName: string,
  success: boolean,
  errorCode?: string,
): void {
  if (!model || !toolName) return;

  if (!modelStats[model]) {
    modelStats[model] = {
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      byTool: {},
      lastUpdated: Date.now(),
    };
  }

  const stats = modelStats[model];
  stats.totalCalls++;
  if (success) {
    stats.successCount++;
  } else {
    stats.failureCount++;
  }
  stats.lastUpdated = Date.now();

  if (!stats.byTool[toolName]) {
    stats.byTool[toolName] = { success: 0, failure: 0 };
  }
  if (success) {
    stats.byTool[toolName].success++;
  } else {
    stats.byTool[toolName].failure++;
  }

  // Periodic auto-logging
  totalCallsSinceLastLog++;
  if (totalCallsSinceLastLog >= AUTO_LOG_INTERVAL) {
    logTelemetrySummary();
    totalCallsSinceLastLog = 0;
  }
}

/**
 * Check if a model should be forced to text mode
 * Returns true if the model has failed >70% of tool calls (min 5 calls)
 */
export function shouldForceTextMode(model: string): boolean {
  const stats = modelStats[model];
  if (!stats || stats.totalCalls < 5) return false;

  // Only consider recent calls (within window)
  const cutoff = Date.now() - WINDOW_MS;
  if (stats.lastUpdated < cutoff) return false;

  const failureRate = stats.failureCount / stats.totalCalls;
  return failureRate > 0.7;
}

/**
 * Get the success rate for a specific model
 */
export function getModelToolSuccessRate(model: string): number | null {
  const stats = modelStats[model];
  if (!stats || stats.totalCalls === 0) return null;
  return stats.successCount / stats.totalCalls;
}

/**
 * Get full telemetry summary for all models
 */
export function getToolCallTelemetrySummary(): Record<string, ModelStats> {
  return { ...modelStats };
}

/**
 * Log a summary of tool call telemetry
 */
export function logTelemetrySummary(): void {
  const models = Object.keys(modelStats);
  if (models.length === 0) return;

  const summary = models.map(model => {
    const s = modelStats[model];
    const rate = s.totalCalls > 0 ? ((s.successCount / s.totalCalls) * 100).toFixed(1) : 'N/A';
    return `${model}: ${s.totalCalls} calls (${rate}% success)`;
  });

  logger.info('[Telemetry Summary]', {
    models: summary,
    totalModels: models.length,
  });
}

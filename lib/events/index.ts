/**
 * Events Module - Durable execution event system
 *
 * @module events
 *
 * @description
 * Complete event system for durable agent execution tracking.
 * Supports retry/replay, dynamic scheduling, self-healing,
 * human-in-the-loop approvals, and DAG workflows.
 *
 * @example
 * ```typescript
 * // Initialize on server startup
 * import { initializeEventSystem, startEventProcessing } from '@/lib/events';
 *
 * await initializeEventSystem();
 * const timer = startEventProcessing();
 * ```
 *
 * @example
 * ```typescript
 * // Emit an event
 * import { emitEvent } from '@/lib/events';
 *
 * const result = await emitEvent({
 *   type: 'SCHEDULED_TASK',
 *   taskType: 'HACKER_NEWS_DAILY',
 *   userId: 'user-123',
 *   payload: { destination: 'user@example.com' },
 * }, 'user-123');
 * ```
 */

// Schema exports
export * from './schema';

// Store exports
export * from './store';

// Bus exports
export { emitEvent, emitEventAndWait, emitEventsBatch } from './bus';

// Router exports
export {
  routeEvent,
  processPendingEvents,
  startEventProcessor,
  stopEventProcessor,
  registerHandler,
  unregisterHandler,
  getHandler,
  getRegisteredHandlers,
  cancelEvent,
  retryEvent,
  getProcessingStats,
} from './router';

// Scheduler exports
export {
  runScheduler,
  startScheduler,
  stopScheduler,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  getScheduledTasks,
  initializeScheduledTasks,
  calculateNextRun,
} from './scheduler';

// Self-healing exports
export {
  attemptSelfHealing,
  applyFix,
  getHealingHistory,
  logHealingAttempt,
  initializeHealingLog,
} from './self-healing';

// Human-in-the-loop exports
export {
  createApprovalRequest,
  waitForApproval,
  respondToApproval,
  getApprovalRequest,
  getPendingApprovals,
  expireOldApprovals,
  getApprovalStats,
  initializeApprovalRequests,
  handleApprovalResponse,
  createApprovalUrl,
} from './human-in-loop';

// DAG execution exports
export {
  executeDAG,
  executeNode,
  handleDAGExecution,
  createDAGFromPipeline,
  validateDAG,
} from './handlers/dag-execution';

// Sample handlers exports
export {
  handleHackerNewsDaily,
  handleResearchTask,
  handleSendEmail,
  handleBashExecution,
  handleHumanApproval,
  handleNotification,
  registerSampleHandlers,
} from './handlers/sample-handlers';

// Re-export commonly used types
export type {
  EventRecord,
  EventStatus,
} from './store';

export type {
  EmitEventResult,
} from './bus';

export type {
  DAGNode,
  DAGResult,
} from './handlers/dag-execution';

export type {
  ApprovalRequest,
} from './human-in-loop';

export type {
  HealingResult,
  ErrorClassification,
} from './self-healing';

// binG handlers exports
export {
  handleAgentLoop,
  handleResearchTask,
  handleDAGWorkflow,
  handleSkillBootstrap,
  handleMultiAgentConsensus,
  registerbinGHandlers,
} from './handlers/bing-handlers';

/**
 * Initialize complete event system
 * Call this once on server startup
 */
export async function initializeEventSystem(): Promise<void> {
  const { initializeEventStore } = await import('./store');
  const { initializeScheduledTasks } = await import('./scheduler');
  const { initializeHealingLog } = await import('./self-healing');
  const { initializeApprovalRequests } = await import('./human-in-loop');
  const { registerSampleHandlers } = await import('./handlers/sample-handlers');
  const { registerbinGHandlers } = await import('./handlers/bing-handlers');

  // Initialize database tables
  await initializeEventStore();
  await initializeScheduledTasks();
  await initializeHealingLog();
  await initializeApprovalRequests();

  // Register handlers
  registerSampleHandlers();
  registerbinGHandlers();

  console.log('[Events] Event system initialized');
}

/**
 * Start event processing (scheduler + router)
 * Returns timer that should be cleared on shutdown
 */
export function startEventProcessing(options?: {
  schedulerIntervalMs?: number;
  processorIntervalMs?: number;
}): { schedulerTimer: NodeJS.Timeout; processorTimer: NodeJS.Timeout } {
  const { startScheduler } = require('./scheduler');
  const { startEventProcessor } = require('./router');

  const schedulerIntervalMs = options?.schedulerIntervalMs ?? 5 * 60 * 1000; // 5 minutes
  const processorIntervalMs = options?.processorIntervalMs ?? 5000; // 5 seconds

  const schedulerTimer = startScheduler(schedulerIntervalMs);
  const processorTimer = startEventProcessor(processorIntervalMs);

  console.log('[Events] Event processing started', {
    schedulerIntervalMs,
    processorIntervalMs,
  });

  return { schedulerTimer, processorTimer };
}

/**
 * Stop event processing
 * Call this on server shutdown
 */
export function stopEventProcessing(timers: {
  schedulerTimer: NodeJS.Timeout;
  processorTimer: NodeJS.Timeout;
}): void {
  const { stopScheduler } = require('./scheduler');
  const { stopEventProcessor } = require('./router');

  stopScheduler(timers.schedulerTimer);
  stopEventProcessor(timers.processorTimer);

  console.log('[Events] Event processing stopped');
}

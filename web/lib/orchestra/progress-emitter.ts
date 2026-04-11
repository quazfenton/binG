/**
 * Orchestration Progress Emitter
 *
 * Emits progress events during orchestration mode execution.
 * Supports both durable event storage (SQLite) and SSE streaming.
 * All fields except type/userId/sessionId are optional.
 *
 * Features:
 * - Lazy-loaded event bus import (cached after first call)
 * - Graceful degradation: SSE emission failures don't block DB persistence
 * - Event validation via Zod schema in emitEvent
 *
 * @module orchestration/progress-emitter
 */

import { createLogger } from '@/lib/utils/logger';
import type { OrchestrationProgressEvent } from '@/lib/events/schema';

const logger = createLogger('OrchestrationProgress');

// Cache the emitEvent import after first resolution to avoid repeated dynamic imports
let _emitEventPromise: Promise<typeof import('@/lib/events/bus').emitEvent> | null = null;

function getEmitEvent(): Promise<typeof import('@/lib/events/bus').emitEvent> {
  if (!_emitEventPromise) {
    _emitEventPromise = import('@/lib/events/bus').then(mod => mod.emitEvent);
  }
  return _emitEventPromise;
}

export interface OrchestrationProgressUpdate {
  /** Optional correlation ID for tracing related events across systems */
  correlationId?: string;
  mode?: string;
  nodeId?: string;
  nodeRole?: string;
  nodeModel?: string;
  nodeProvider?: string;
  steps?: Array<{
    id?: string;
    title?: string;
    description?: string;
    status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  }>;
  currentStepIndex?: number;
  totalSteps?: number;
  currentAction?: string;
  phase?: 'planning' | 'acting' | 'verifying' | 'responding' | 'idle';
  nodes?: Array<{
    id?: string;
    role?: string;
    model?: string;
    provider?: string;
    status?: 'idle' | 'working' | 'waiting' | 'failed';
  }>;
  nodeCommunication?: {
    from?: string;
    to?: string;
    content?: string;
    type?: 'delegation' | 'response' | 'review' | 'consensus' | 'relay';
  };
  errors?: Array<{
    nodeId?: string;
    message: string;
    retryCount?: number;
    recovered?: boolean;
  }>;
  hitlRequests?: Array<{
    id?: string;
    action?: string;
    reason?: string;
    status?: 'pending' | 'approved' | 'rejected' | 'expired';
    timeoutAt?: number;
  }>;
  metadata?: Record<string, unknown>;
}

/**
 * Emit an orchestration progress event to both the durable event store
 * and any active SSE stream (via the provided emitter callback).
 *
 * SSE emission is fire-and-forget (UI updates shouldn't block execution).
 * DB persistence errors are logged but don't throw (graceful degradation).
 *
 * @param userId - User ID for event ownership
 * @param sessionId - Optional session ID for grouping
 * @param update - Progress update data (all fields optional except type context)
 * @param sseEmit - Optional callback to push to an SSE stream. If not provided, only stores to DB.
 */
export async function emitOrchestrationProgress(
  userId: string,
  sessionId: string | undefined,
  update: OrchestrationProgressUpdate,
  sseEmit?: (eventType: string, payload: Record<string, unknown>) => void
): Promise<void> {
  const timestamp = Date.now();
  const payload: OrchestrationProgressEvent = {
    type: 'ORCHESTRATION_PROGRESS',
    userId,
    sessionId,
    ...update,
    timestamp,
  };

  // Emit to SSE stream first (real-time UI updates — fire-and-forget)
  if (sseEmit) {
    try {
      sseEmit('orchestration_progress', payload);
    } catch (sseError: any) {
      // SSE stream may be closed — log but don't fail
      logger.debug('SSE emit skipped (stream likely closed)', { error: sseError.message });
    }
  }

  // Persist to durable event store (graceful degradation on failure)
  try {
    const emitEvent = await getEmitEvent();
    await emitEvent(payload, userId, sessionId);
  } catch (storeError: any) {
    // Non-fatal — don't break orchestration execution if event storage fails
    logger.warn('Failed to persist ORCHESTRATION_PROGRESS event (non-fatal)', {
      error: storeError.message,
      mode: update.mode,
      phase: update.phase,
    });
  }

  // Debug logging for observability
  logger.debug('Orchestration progress emitted', {
    userId,
    sessionId,
    mode: update.mode,
    phase: update.phase,
    nodeId: update.nodeId,
    currentAction: update.currentAction?.substring(0, 80),
    correlationId: update.correlationId,
  });
}

/**
 * Convenience: emit a step progress update
 */
export async function emitStepProgress(
  userId: string,
  sessionId: string | undefined,
  options: {
    mode?: string;
    correlationId?: string;
    steps: OrchestrationProgressUpdate['steps'];
    currentStepIndex: number;
    currentAction?: string;
    phase?: OrchestrationProgressUpdate['phase'];
    sseEmit?: (eventType: string, payload: Record<string, unknown>) => void;
  }
): Promise<void> {
  await emitOrchestrationProgress(userId, sessionId, {
    correlationId: options.correlationId,
    mode: options.mode,
    steps: options.steps,
    currentStepIndex: options.currentStepIndex,
    totalSteps: options.steps?.length,
    currentAction: options.currentAction,
    phase: options.phase,
  }, options.sseEmit);
}

/**
 * Convenience: emit a node status update
 */
export async function emitNodeStatus(
  userId: string,
  sessionId: string | undefined,
  options: {
    mode?: string;
    correlationId?: string;
    nodeId: string;
    nodeRole?: string;
    nodeModel?: string;
    nodeProvider?: string;
    status: 'idle' | 'working' | 'waiting' | 'failed';
    currentAction?: string;
    sseEmit?: (eventType: string, payload: Record<string, unknown>) => void;
  }
): Promise<void> {
  await emitOrchestrationProgress(userId, sessionId, {
    correlationId: options.correlationId,
    mode: options.mode,
    nodeId: options.nodeId,
    nodeRole: options.nodeRole,
    nodeModel: options.nodeModel,
    nodeProvider: options.nodeProvider,
    nodes: [{
      id: options.nodeId,
      role: options.nodeRole,
      model: options.nodeModel,
      provider: options.nodeProvider,
      status: options.status,
    }],
    currentAction: options.currentAction,
  }, options.sseEmit);
}

/**
 * Convenience: emit an error/retry update
 */
export async function emitRetryError(
  userId: string,
  sessionId: string | undefined,
  options: {
    mode?: string;
    correlationId?: string;
    nodeId?: string;
    message: string;
    retryCount?: number;
    recovered?: boolean;
    sseEmit?: (eventType: string, payload: Record<string, unknown>) => void;
  }
): Promise<void> {
  await emitOrchestrationProgress(userId, sessionId, {
    correlationId: options.correlationId,
    mode: options.mode,
    nodeId: options.nodeId,
    errors: [{
      nodeId: options.nodeId,
      message: options.message,
      retryCount: options.retryCount,
      recovered: options.recovered,
    }],
  }, options.sseEmit);
}

/**
 * Convenience: emit a HITL request
 */
export async function emitHITLRequest(
  userId: string,
  sessionId: string | undefined,
  options: {
    mode?: string;
    correlationId?: string;
    id?: string;
    action: string;
    reason?: string;
    timeoutAt?: number;
    sseEmit?: (eventType: string, payload: Record<string, unknown>) => void;
  }
): Promise<void> {
  await emitOrchestrationProgress(userId, sessionId, {
    correlationId: options.correlationId,
    mode: options.mode,
    hitlRequests: [{
      id: options.id,
      action: options.action,
      reason: options.reason,
      status: 'pending',
      timeoutAt: options.timeoutAt,
    }],
  }, options.sseEmit);
}

/**
 * Convenience: emit inter-node communication event
 */
export async function emitNodeCommunication(
  userId: string,
  sessionId: string | undefined,
  options: {
    mode?: string;
    correlationId?: string;
    from: string;
    to: string;
    content: string;
    type: 'delegation' | 'response' | 'review' | 'consensus' | 'relay';
    sseEmit?: (eventType: string, payload: Record<string, unknown>) => void;
  }
): Promise<void> {
  await emitOrchestrationProgress(userId, sessionId, {
    correlationId: options.correlationId,
    mode: options.mode,
    nodeCommunication: {
      from: options.from,
      to: options.to,
      content: options.content,
      type: options.type,
    },
  }, options.sseEmit);
}

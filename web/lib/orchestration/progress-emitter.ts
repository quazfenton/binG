/**
 * Orchestration Progress Emitter
 *
 * Emits progress events during orchestration mode execution.
 * Supports both durable event storage (SQLite) and SSE streaming.
 * All fields except type/userId/sessionId are optional.
 *
 * @module orchestration/progress-emitter
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('OrchestrationProgress');

export interface OrchestrationProgressUpdate {
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
  const payload = {
    ...update,
    timestamp: Date.now(),
  };

  // Emit to SSE stream if available (real-time UI updates)
  if (sseEmit) {
    try {
      sseEmit('orchestration_progress', payload);
    } catch (sseError: any) {
      logger.warn('Failed to emit SSE orchestration_progress event', { error: sseError.message });
    }
  }

  // Persist to durable event store
  try {
    const { emitEvent } = await import('@/lib/events/bus');
    await emitEvent(
      {
        type: 'ORCHESTRATION_PROGRESS',
        userId,
        sessionId,
        ...payload,
      },
      userId,
      sessionId
    );
  } catch (storeError: any) {
    // Non-fatal — don't break execution if event storage fails
    logger.warn('Failed to persist ORCHESTRATION_PROGRESS event', { error: storeError.message });
  }

  logger.debug('Orchestration progress emitted', {
    userId,
    sessionId,
    mode: update.mode,
    phase: update.phase,
    nodeId: update.nodeId,
    currentAction: update.currentAction?.substring(0, 80),
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
    steps: OrchestrationProgressUpdate['steps'];
    currentStepIndex: number;
    currentAction?: string;
    phase?: OrchestrationProgressUpdate['phase'];
    sseEmit?: (eventType: string, payload: Record<string, unknown>) => void;
  }
): Promise<void> {
  await emitOrchestrationProgress(userId, sessionId, {
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
    nodeId?: string;
    message: string;
    retryCount?: number;
    recovered?: boolean;
    sseEmit?: (eventType: string, payload: Record<string, unknown>) => void;
  }
): Promise<void> {
  await emitOrchestrationProgress(userId, sessionId, {
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
    id?: string;
    action: string;
    reason?: string;
    timeoutAt?: number;
    sseEmit?: (eventType: string, payload: Record<string, unknown>) => void;
  }
): Promise<void> {
  await emitOrchestrationProgress(userId, sessionId, {
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

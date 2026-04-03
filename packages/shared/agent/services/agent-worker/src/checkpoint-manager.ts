/**
 * Checkpoint Manager - Save and resume agent state
 * 
 * Enables:
 * - Crash recovery (resume from last checkpoint)
 * - Pause/resume agents
 * - Long-running task persistence
 */

import Redis from 'ioredis';
import { createLogger } from './logger';

const logger = createLogger('Agent:Checkpoint');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CHECKPOINT_TTL = 86400 * 7; // 7 days

const redis = new Redis(REDIS_URL);

export interface AgentCheckpoint {
  id: string;
  jobId: string;
  sessionId: string;
  step: number;
  prompt: string;
  context?: string;
  messages: Array<{ role: string; content: string }>;
  toolCalls: Array<{ tool: string; args: any; result: any }>;
  workspaceSnapshot?: string;
  createdAt: number;
  metadata?: Record<string, any>;
}

export interface CheckpointOptions {
  jobId: string;
  sessionId: string;
  step: number;
  prompt: string;
  context?: string;
  messages?: Array<{ role: string; content: string }>;
  toolCalls?: Array<{ tool: string; args: any; result: any }>;
  workspaceSnapshot?: string;
  metadata?: Record<string, any>;
}

class CheckpointManager {
  private readonly keyPrefix = 'agent:checkpoint';

  /**
   * Save a checkpoint
   */
  async save(options: CheckpointOptions): Promise<string> {
    const checkpointId = `cp-${options.jobId}-${options.step}`;
    const key = `${this.keyPrefix}:${options.sessionId}`;

    const checkpoint: AgentCheckpoint = {
      id: checkpointId,
      jobId: options.jobId,
      sessionId: options.sessionId,
      step: options.step,
      prompt: options.prompt,
      context: options.context,
      messages: options.messages || [],
      toolCalls: options.toolCalls || [],
      workspaceSnapshot: options.workspaceSnapshot,
      createdAt: Date.now(),
      metadata: options.metadata,
    };

    // Save checkpoint
    await redis.hset(key, {
      current: JSON.stringify(checkpoint),
      [`step_${options.step}`]: JSON.stringify(checkpoint),
    });

    // Set TTL
    await redis.expire(key, CHECKPOINT_TTL);

    logger.info('Checkpoint saved', { 
      checkpointId, 
      sessionId: options.sessionId, 
      step: options.step 
    });

    return checkpointId;
  }

  /**
   * Get the current checkpoint for a session
   */
  async get(sessionId: string): Promise<AgentCheckpoint | null> {
    const key = `${this.keyPrefix}:${sessionId}`;
    const data = await redis.hget(key, 'current');

    if (!data) return null;

    try {
      return JSON.parse(data) as AgentCheckpoint;
    } catch {
      return null;
    }
  }

  /**
   * Get a specific step checkpoint
   */
  async getStep(sessionId: string, step: number): Promise<AgentCheckpoint | null> {
    const key = `${this.keyPrefix}:${sessionId}`;
    const data = await redis.hget(key, `step_${step}`);

    if (!data) return null;

    try {
      return JSON.parse(data) as AgentCheckpoint;
    } catch {
      return null;
    }
  }

  /**
   * List all checkpoints for a session
   */
  async list(sessionId: string): Promise<AgentCheckpoint[]> {
    const key = `${this.keyPrefix}:${sessionId}`;
    const data = await redis.hgetall(key);

    const checkpoints: AgentCheckpoint[] = [];

    for (const [field, value] of Object.entries(data)) {
      if (field === 'current') continue;
      try {
        checkpoints.push(JSON.parse(value));
      } catch {}
    }

    // Sort by step
    return checkpoints.sort((a, b) => a.step - b.step);
  }

  /**
   * Resume from checkpoint
   */
  async resume(sessionId: string): Promise<{
    checkpoint: AgentCheckpoint;
    canResume: boolean;
  } | null> {
    const checkpoint = await this.get(sessionId);

    if (!checkpoint) {
      return null;
    }

    // Check if checkpoint is too old
    const age = Date.now() - checkpoint.createdAt;
    const maxAge = CHECKPOINT_TTL * 1000;

    return {
      checkpoint,
      canResume: age < maxAge,
    };
  }

  /**
   * Delete checkpoint
   */
  async delete(sessionId: string): Promise<void> {
    const key = `${this.keyPrefix}:${sessionId}`;
    await redis.del(key);
    logger.info('Checkpoint deleted', { sessionId });
  }

  /**
   * Create workspace snapshot (stores workspace path reference)
   * Actual file sync should happen separately
   */
  async snapshotWorkspace(sessionId: string, workspacePath: string): Promise<string> {
    const key = `${this.keyPrefix}:workspace:${sessionId}`;
    await redis.set(key, workspacePath, 'EX', CHECKPOINT_TTL);
    return workspacePath;
  }

  /**
   * Get workspace snapshot path
   */
  async getWorkspaceSnapshot(sessionId: string): Promise<string | null> {
    const key = `${this.keyPrefix}:workspace:${sessionId}`;
    return redis.get(key);
  }
}

export const checkpointManager = new CheckpointManager();

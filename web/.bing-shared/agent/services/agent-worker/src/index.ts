/**
 * Agent Worker - Runs OpenCode engine loop with Git-Backed VFS
 *
 * Features:
 * - BullMQ-based reliable job queue (replacing raw BRPOP)
 * - Persistent OpenCode engine (no CLI spawn)
 * - Redis PubSub + Streams for events
 * - Checkpoint/resume for crash recovery
 * - Integration with task-router and provider-router for optimal execution
 * - Automatic retries and error recovery
 * - Race condition protection and graceful shutdown
 */

import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import * as fs from 'fs/promises';
import * as http from 'http';
import * as path from 'path';
import { createLogger } from './logger.js';
import { getOpenCodeEngine, OpenCodeEngine } from './opencode-engine.js';
import { executeV2Task } from '@bing/shared/agent/v2-executor';
import { taskRouter } from '@bing/shared/agent/task-router';
import { providerRouter, latencyTracker } from '@/lib/sandbox/provider-router';
import { determineExecutionPolicy } from '@/lib/sandbox/types';
import { normalizeSessionId } from '@/lib/virtual-filesystem/scope-utils';

const logger = createLogger('Agent:Worker');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_STREAM_KEY = process.env.REDIS_STREAM_KEY || 'agent:events';
const OPENCODE_MODEL = process.env.OPENCODE_MODEL || 'opencode/minimax-m2.5-free';
const OPENCODE_MAX_STEPS = parseInt(process.env.OPENCODE_MAX_STEPS || '15');
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '4');
const GIT_VFS_AUTO_COMMIT = process.env.GIT_VFS_AUTO_COMMIT !== 'false';
const JOB_TIMEOUT_MS = parseInt(process.env.JOB_TIMEOUT_MS || '3600000'); // 1 hour default
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '2');

const redis = new Redis(REDIS_URL);
const redisPub = new Redis(REDIS_URL);

const PUBSUB_CHANNEL = 'agent:events';
const JOB_QUEUE_NAME = 'agent:jobs';
const SAFE_PATH_SEGMENT_REGEX = /^[a-zA-Z0-9._-]+$/;

function sanitizePathSegment(segment: string, field: string): string {
  const candidate = segment.trim();
  if (!candidate || candidate === '.' || candidate === '..' || !SAFE_PATH_SEGMENT_REGEX.test(candidate)) {
    throw new Error(`Invalid ${field} for workspace path`);
  }
  return candidate;
}

// Shared job schema - matches infra/queue types
interface AgentJob {
  id?: string;
  type: 'agent-task';
  sessionId: string;
  userId: string;
  conversationId: string;
  prompt: string;
  context?: string;
  tools?: string[];
  model?: string;
  createdAt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface AgentEvent {
  type: string;
  sessionId: string;
  data: any;
  timestamp: number;
}

let opencodeEngine: OpenCodeEngine;
let bullWorker: Worker<AgentJob> | null = null;

/**
 * Acquire job lock to prevent concurrent execution of same job.
 * Uses Redis-based distributed locking for atomicity across worker instances.
 * 
 * FIX: Lock TTL now derived from JOB_TIMEOUT_MS to stay in sync with BullMQ lockDuration.
 * This prevents premature lock expiry (duplicate execution) or stale locks (jobs skipped).
 */
async function acquireJobLock(jobId: string): Promise<(() => Promise<void>) | null> {
  const lockKey = `lock:job:${jobId}`;
  // FIX: Use same timeout as BullMQ lockDuration to keep worker/job lock behavior synchronized
  const lockTimeout = JOB_TIMEOUT_MS;

  // Try to acquire lock via Redis SET NX
  const result = await redis.set(lockKey, 'locked', 'PX', lockTimeout, 'NX');
  
  if (result !== 'OK') {
    return null; // Lock already held
  }

  // Return release function
  return async () => {
    await redis.del(lockKey);
  };
}

async function publishEvent(event: AgentEvent): Promise<void> {
  const message = JSON.stringify(event);
  try {
    await redisPub.publish(PUBSUB_CHANNEL, message);
    if (event.sessionId) {
      await redisPub.publish(`${PUBSUB_CHANNEL}:${event.sessionId}`, message);
    }

    try {
      await redis.xadd(REDIS_STREAM_KEY, '*', 'event', message);
    } catch (e) {
      logger.warn('Failed to add event to stream', { error: e });
    }
  } catch (error: any) {
    logger.error('Failed to publish event', { error: error.message, eventType: event.type });
  }
}

async function runOpenCode(job: Job<AgentJob>): Promise<void> {
  const jobId = job.id!;
  const releaseLock = await acquireJobLock(jobId);

  if (!releaseLock) {
    logger.warn('Job already being processed (lock held), skipping', { jobId });
    return;
  }

  try {
    const { sessionId, userId, conversationId, prompt, context } = job.data;
    const startTime = Date.now();

    // Update job progress
    await job.updateProgress(5);

    const routing = await taskRouter.analyzeTask(prompt);

    logger.info('Starting job with task routing', {
      jobId,
      sessionId,
      userId,
      routingTarget: routing.target,
    });

    // CRITICAL FIX: Normalize conversationId to prevent composite IDs in workspace paths
    const simpleSessionId = normalizeSessionId(conversationId) || conversationId;
    const safeUserId = sanitizePathSegment(userId, 'userId');
    const safeSessionId = sanitizePathSegment(simpleSessionId, 'conversationId');
    const workspaceDir = path.posix.join('/workspace/users', safeUserId, 'sessions', safeSessionId);
    await fs.mkdir(workspaceDir, { recursive: true }).catch(() => {});

    let selectedProvider: string | undefined;
    let executionPolicy: string | undefined;

    try {
      await job.updateProgress(15);

      executionPolicy = determineExecutionPolicy({
        task: prompt,
        requiresBash: /bash|shell|command|execute|run\s+\w+/i.test(prompt),
        requiresFileWrite: /write|create|save|edit|modify|delete\s+(file|\w+\.\w+)/i.test(prompt),
        requiresBackend: /server|api|database|backend|express|fastapi|flask|django/i.test(prompt),
        requiresGUI: /gui|desktop|browser|electron|tauri/i.test(prompt),
        isLongRunning: /server|daemon|service|long-running|persistent/i.test(prompt),
      });

      const providerSelection = await providerRouter.selectWithServices({
        type: executionPolicy === 'desktop-required' ? 'computer-use' : 'agent',
        duration: executionPolicy === 'local-safe' ? 'short' : 'medium',
        requiresPersistence: executionPolicy === 'persistent-sandbox',
        needsServices: executionPolicy === 'desktop-required' ? ['desktop'] : ['pty'],
        performancePriority: 'latency',
      });
      selectedProvider = providerSelection.provider;

      await job.updateProgress(30);

      await publishEvent({
        type: 'job:started',
        sessionId,
        data: {
          jobId,
          prompt: prompt.substring(0, 100),
          executionPolicy,
          selectedProvider,
          routing,
        },
        timestamp: Date.now(),
      });

      await publishEvent({
        type: 'init',
        sessionId,
        data: {
          agent: 'opencode',
          sessionId,
          timestamp: Date.now(),
          gitVfsEnabled: GIT_VFS_AUTO_COMMIT,
          executionPolicy,
          provider: selectedProvider,
          routing,
        },
        timestamp: Date.now(),
      });

      await job.updateProgress(50);

      const result = await executeV2Task({
        userId,
        conversationId,
        task: prompt,
        context,
        preferredAgent: routing.target === 'chat' ? undefined : routing.target,
        executionPolicy: executionPolicy as any,
      });

      await job.updateProgress(85);

      const resultData = (result?.data ?? result) as Record<string, unknown> | undefined;
      const responseContent = result?.content || resultData?.response || resultData?.content || '';
      const latency = Date.now() - startTime;

      if (selectedProvider && (resultData?.agent === 'opencode' || routing.target === 'opencode')) {
        latencyTracker.record(selectedProvider as any, latency);
      }

      // CRITICAL FIX: Publish done event in separate try-catch to avoid marking successful jobs as failed
      try {
        await publishEvent({
          type: 'done',
          sessionId,
          data: {
            response: responseContent,
            timestamp: Date.now(),
            latency,
            provider: selectedProvider,
            executionPolicy,
            routing,
            result: resultData,
          },
          timestamp: Date.now(),
        });
      } catch (publishError: any) {
        logger.error('Failed to publish done event (job still completed successfully)', {
          jobId,
          sessionId,
          error: publishError.message,
        });
      }

      await job.updateProgress(100);

      logger.info('Job completed', {
        jobId,
        latency,
        success: result?.success,
        provider: selectedProvider,
        routingTarget: routing.target,
      });
    } catch (error: any) {
      const latency = Date.now() - startTime;

      logger.error('Job failed', {
        jobId,
        error: error.message,
        executionPolicy,
        selectedProvider,
        stack: error.stack,
      });

      try {
        await publishEvent({
          type: 'error',
          sessionId,
          data: {
            error: error.message,
            timestamp: Date.now(),
            latency,
            provider: selectedProvider,
            executionPolicy,
            routing,
          },
          timestamp: Date.now(),
        });
      } catch (publishError: any) {
        logger.error('Failed to publish error event', { jobId, error: publishError.message });
      }

      throw error;
    }
  } finally {
    await releaseLock();
  }
}

async function startWorker(): Promise<void> {
  logger.info('Agent Worker starting', { concurrency: WORKER_CONCURRENCY });

  opencodeEngine = getOpenCodeEngine({
    model: OPENCODE_MODEL,
    maxSteps: OPENCODE_MAX_STEPS,
  });

  await opencodeEngine.ready();
  logger.info('OpenCode engine ready');

  // Create BullMQ worker for reliable job processing
  bullWorker = new Worker<AgentJob>(
    JOB_QUEUE_NAME,
    async (job: Job<AgentJob>) => {
      logger.info(`Processing job ${job.id}`, { sessionId: job.data.sessionId });
      await runOpenCode(job);
    },
    {
      connection: redis,
      concurrency: WORKER_CONCURRENCY,
      settings: {
        lockDuration: JOB_TIMEOUT_MS,
        lockRenewTime: Math.min(30000, JOB_TIMEOUT_MS / 10),
        maxStalledCount: 2,
      },
    }
  );

  // Event handlers
  bullWorker.on('completed', (job: Job) => {
    logger.info(`Job ${job.id} completed successfully`, { sessionId: job.data?.sessionId });
  });

  bullWorker.on('failed', (job: Job | undefined, error: Error) => {
    logger.error(`Job ${job?.id} failed`, {
      error: error.message,
      sessionId: job?.data?.sessionId,
    });
  });

  bullWorker.on('error', (error: Error) => {
    logger.error('Worker error', { error: error.message });
  });

  logger.info('BullMQ worker initialized successfully');

  // Keep process running
  await new Promise(() => {});
}

const server = http.createServer(async (req: any, res: any) => {
  if (req.url === '/health') {
    const engineHealthy = opencodeEngine?.isHealthy() ?? false;
    let redisHealthy = false;
    let workerHealthy = false;

    try {
      await redis.ping();
      redisHealthy = true;
    } catch {}

    try {
      if (bullWorker !== null) {
        workerHealthy = !(await bullWorker.isPaused());
      }
    } catch {}

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: (engineHealthy && redisHealthy && workerHealthy) ? 'ok' : 'degraded',
      worker: 'agent-worker',
      engine: engineHealthy ? 'ready' : 'starting',
      redis: redisHealthy ? 'connected' : 'disconnected',
      bullWorker: workerHealthy ? 'running' : 'stopped',
      activeJobs: 0, // In-memory tracking replaced by Redis locks
    }));
  } else if (req.url === '/ready') {
    const ready = (opencodeEngine?.isHealthy() ?? false) && bullWorker !== null;
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = parseInt(process.env.PORT || '3003');
server.listen(PORT, () => {
  logger.info(`Agent Worker health server listening on port ${PORT}`);
});

startWorker().catch(err => {
  logger.error('Worker failed to start', { error: err.message });
  process.exit(1);
});

// Graceful shutdown with timeout
async function shutdown() {
  logger.info('Worker shutting down gracefully...');
  const SHUTDOWN_STEP_TIMEOUT = 5000;

  const withTimeout = (promise: Promise<any>, name: string) => 
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} shutdown timed out`)), SHUTDOWN_STEP_TIMEOUT))
    ]);

  try {
    server.close();

    if (bullWorker) {
      await withTimeout(bullWorker.close(), 'BullMQ worker').catch(err => logger.warn(err.message));
    }

    if (opencodeEngine) {
      await withTimeout(opencodeEngine.shutdown(), 'OpenCode engine').catch(err => logger.warn(err.message));
    }

    await withTimeout(redis.quit(), 'Redis client').catch(() => redis.disconnect());
    await withTimeout(redisPub.quit(), 'Redis publisher').catch(() => redisPub.disconnect());
    logger.info('Redis connections closed');

    logger.info('Worker shutdown complete');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
}

const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '30000');
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM signal');
  const shutdownTimer = setTimeout(() => {
    logger.error('Shutdown timeout, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  shutdown().finally(() => clearTimeout(shutdownTimer));
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT signal');
  const shutdownTimer = setTimeout(() => {
    logger.error('Shutdown timeout, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  shutdown().finally(() => clearTimeout(shutdownTimer));
});

/**
 * Agent Worker - Runs OpenCode engine loop with Git-Backed VFS
 *
 * Features:
 * - Pull jobs from Redis queue
 * - Persistent OpenCode engine (no CLI spawn)
 * - Redis PubSub + Streams for events
 * - Checkpoint/resume for crash recovery
 * - Integration with task-router and provider-router for optimal execution
 */

import Redis from 'ioredis';
import * as fs from 'fs/promises';
import { createLogger } from './logger';
import { getOpenCodeEngine, OpenCodeEngine } from './opencode-engine';
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

const redis = new Redis(REDIS_URL);
const redisPub = new Redis(REDIS_URL);

const PUBSUB_CHANNEL = 'agent:events';
const JOB_QUEUE = 'agent:jobs';

interface AgentJob {
  id: string;
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

async function publishEvent(event: AgentEvent): Promise<void> {
  const message = JSON.stringify(event);
  await redisPub.publish(PUBSUB_CHANNEL, message);
  if (event.sessionId) {
    await redisPub.publish(`${PUBSUB_CHANNEL}:${event.sessionId}`, message);
  }

  try {
    await redis.xadd(REDIS_STREAM_KEY, '*', 'event', message);
  } catch (e) {
    logger.warn('Failed to add event to stream', { error: e });
  }
}

async function runOpenCode(job: AgentJob): Promise<void> {
  const { id: jobId, sessionId, userId, conversationId, prompt, context } = job;
  const startTime = Date.now();
  const routing = taskRouter.analyzeTask(prompt);

  logger.info('Starting job with task routing', { jobId, sessionId, userId, routingTarget: routing.target });

  job.status = 'processing';
  await redis.set(`agent:job:${jobId}`, JSON.stringify(job), 'EX', 3600);

  // CRITICAL FIX: Normalize conversationId to prevent composite IDs in workspace paths
  const simpleSessionId = normalizeSessionId(conversationId) || conversationId; // Use original if normalize returns empty
  const workspaceDir = `/workspace/users/${userId}/sessions/${simpleSessionId}`;
  await fs.mkdir(workspaceDir, { recursive: true }).catch(() => {});

  let selectedProvider: string | undefined;
  let executionPolicy: string | undefined;

  try {
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

    const result = await executeV2Task({
      userId,
      conversationId,
      task: prompt,
      context,
      preferredAgent: routing.target === 'cli' ? undefined : routing.target,
      executionPolicy: executionPolicy as any,
    });

    const resultData = result?.data ?? result;
    const responseContent = result?.content || resultData?.response || resultData?.content || '';
    const latency = Date.now() - startTime;

    if (selectedProvider && (resultData?.agent === 'opencode' || routing.target === 'opencode')) {
      latencyTracker.record(selectedProvider as any, latency);
    }

    // CRITICAL FIX: Publish done event in separate try-catch to avoid marking successful jobs as failed
    // If notification fails, log error but don't overwrite successful job status
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
      // Don't rethrow - job was successful, only notification failed
    }

    job.status = 'completed';
    await redis.set(`agent:job:${jobId}`, JSON.stringify(job), 'EX', 3600);

    logger.info('Job completed', {
      jobId,
      latency,
      success: result?.success,
      provider: selectedProvider,
      routingTarget: routing.target,
    });
  } catch (error: any) {
    const latency = Date.now() - startTime;
    job.status = 'failed';
    await redis.set(`agent:job:${jobId}`, JSON.stringify(job), 'EX', 3600);

    logger.error('Job failed', { jobId, error: error.message, executionPolicy, selectedProvider });

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

  const workers: Promise<void>[] = [];

  for (let i = 0; i < WORKER_CONCURRENCY; i++) {
    const workerId = i;
    const worker = (async () => {
      while (true) {
        try {
          const result = await redis.brpop(JOB_QUEUE, 5);
          if (result) {
            const [, jobData] = result;
            const job: AgentJob = JSON.parse(jobData);
            logger.info(`Worker ${workerId} processing job`, { jobId: job.id });
            await runOpenCode(job);
          }
        } catch (error: any) {
          logger.error(`Worker ${workerId} error`, { error: error.message });
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    })();

    workers.push(worker);
  }

  await Promise.all(workers);
}

const http = require('http');
const server = http.createServer(async (req: any, res: any) => {
  if (req.url === '/health') {
    const engineHealthy = opencodeEngine?.isHealthy() ?? false;
    let redisHealthy = false;
    try {
      await redis.ping();
      redisHealthy = true;
    } catch {}

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: engineHealthy && redisHealthy ? 'ok' : 'degraded',
      worker: 'agent-worker',
      engine: engineHealthy ? 'ready' : 'starting',
      redis: redisHealthy ? 'connected' : 'disconnected',
    }));
  } else if (req.url === '/ready') {
    const ready = (opencodeEngine?.isHealthy() ?? false);
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

process.on('SIGTERM', async () => {
  logger.info('Worker shutting down');
  await opencodeEngine?.shutdown();
  await redis.quit();
  await redisPub.quit();
  process.exit(0);
});

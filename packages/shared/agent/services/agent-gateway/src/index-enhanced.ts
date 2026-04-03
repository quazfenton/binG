/**
 * Agent Gateway - Enhanced Integration
 *
 * Integrates existing Fastify gateway with Redis Agent Service for:
 * - Job queue management with priority
 * - SSE streaming to NextJS chat API
 * - Sandbox migration
 * - Runaway job termination
 * - Worker coordination
 *
 * Architecture:
 * POST /api/chat (NextJS)
 *   ↓
 * create agent job
 *   ↓
 * POST → agent-gateway/jobs
 *   ↓
 * Redis Queue (agent:jobs)
 *   ↓
 * Worker pulls job
 *   ↓
 * Stream events back via Redis PubSub
 *   ↓
 * GET /stream/:sessionId (SSE)
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getRedisAgentService, type AgentJob, type AgentEvent } from '@/lib/redis/agent-service';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from './logger';

const logger = createLogger('Agent:Gateway:Enhanced');

const fastify = Fastify({ logger: true });

// Configuration
const PORT = parseInt(process.env.PORT || '3002');
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const JOB_TIMEOUT_MS = parseInt(process.env.JOB_TIMEOUT_MS || '300000'); // 5 minutes
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MS || '3600000'); // 1 hour
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '10');

// Get Redis service instance
const redisService = getRedisAgentService({ redisUrl: REDIS_URL });

// Job status tracking for runaway detection
const runningJobs = new Map<string, {
  jobId: string;
  sessionId: string;
  startedAt: number;
  lastHeartbeat: number;
  workerId?: string;
}>();

// Sandbox migration tracking
const sandboxMigrations = new Map<string, {
  jobId: string;
  fromSandbox: string;
  toSandbox: string;
  status: 'pending' | 'migrating' | 'completed' | 'failed';
}>();

/**
 * Start gateway server
 */
async function start(): Promise<void> {
  // Wait for Redis connection
  await redisService.waitForConnection(5000);
  logger.info('Connected to Redis', { url: REDIS_URL });

  // Register CORS
  await fastify.register(cors, { origin: true, methods: ['GET', 'POST', 'OPTIONS'] });

  // Health check
  fastify.get('/health', async () => {
    const health = await redisService.healthCheck();
    return {
      status: 'ok',
      redis: health.connected ? 'connected' : 'disconnected',
      queueLength: health.queueLength,
      activeWorkers: health.activeWorkers,
      latency: health.latency,
      timestamp: Date.now(),
    };
  });

  // Ready check
  fastify.get('/ready', async () => {
    const health = await redisService.healthCheck();
    return { ready: health.connected && health.latency < 100 };
  });

  // Create new job (called from NextJS /api/chat)
  fastify.post('/jobs', async (request: any, reply: any) => {
    const { userId, conversationId, prompt, context, tools, model, executionPolicy, priority } = request.body || {};

    if (!userId || !prompt) {
      return reply.status(400).send({ error: 'userId and prompt are required' });
    }

    const jobId = `job_${uuidv4()}`;
    const sessionId = `session_${conversationId}_${Date.now()}`;

    // Create job
    const job: AgentJob = {
      id: jobId,
      sessionId,
      userId,
      conversationId,
      prompt,
      context,
      tools,
      model,
      executionPolicy,
      createdAt: Date.now(),
      status: 'pending',
    };

    // Push to Redis queue
    await redisService.pushJob(job);

    // Create session
    await redisService.upsertSession({
      id: sessionId,
      userId,
      conversationId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      status: 'active',
      currentJobId: jobId,
    });

    // Publish event
    await redisService.publishEvent({
      type: 'job:created',
      sessionId,
      jobId,
      data: { jobId, sessionId, priority: priority || 'normal' },
      timestamp: Date.now(),
    });

    logger.info('Job created', { jobId, sessionId, userId, priority });

    return {
      jobId,
      sessionId,
      status: 'pending',
      message: 'Job queued successfully',
    };
  });

  // SSE streaming endpoint
  fastify.get('/stream/:sessionId', async (request: any, reply: any) => {
    const { sessionId } = request.params;

    // Set up SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Transfer-Encoding': 'chunked',
    });

    // Send initial connection event
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ sessionId, timestamp: Date.now() })}\n\n`);

    let isActive = true;
    let subscriber: any = null;

    try {
      // Subscribe to Redis PubSub for this session
      subscriber = await redisService.subscribeEvents((event: AgentEvent) => {
        if (!isActive) return;
        if (event.sessionId !== sessionId && event.sessionId !== '*') return;

        // Forward event to SSE client
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);

        // Track job start
        if (event.type === 'job:started' && event.jobId) {
          runningJobs.set(event.jobId, {
            jobId: event.jobId,
            sessionId,
            startedAt: Date.now(),
            lastHeartbeat: Date.now(),
            workerId: event.data?.workerId,
          });
        }

        // Track heartbeat
        if (event.type === 'job:heartbeat' && event.jobId) {
          const runningJob = runningJobs.get(event.jobId);
          if (runningJob) {
            runningJob.lastHeartbeat = Date.now();
          }
        }

        // Track job completion
        if (['job:completed', 'job:failed', 'job:cancelled'].includes(event.type) && event.jobId) {
          runningJobs.delete(event.jobId);
        }

        // Track sandbox migration
        if (event.type === 'sandbox:migrate') {
          sandboxMigrations.set(sessionId, {
            jobId: event.jobId || sessionId,
            fromSandbox: event.data?.fromSandbox,
            toSandbox: event.data?.toSandbox,
            status: 'pending',
          });
        }
      }, sessionId);

      // Send heartbeat to client
      const heartbeat = setInterval(() => {
        if (isActive) {
          reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
        }
      }, 30000);

      // Handle client disconnect
      request.raw.on('close', () => {
        isActive = false;
        clearInterval(heartbeat);
        if (subscriber) {
          subscriber.punsubscribe();
          subscriber.disconnect();
        }
        logger.info('SSE client disconnected', { sessionId });
      });

    } catch (error: any) {
      logger.error('SSE stream error', { sessionId, error: error.message });
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
    }

    return reply;
  });

  // Get job status
  fastify.get('/jobs/:jobId', async (request: any, reply: any) => {
    const { jobId } = request.params;
    const job = await redisService.getJob(jobId);

    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    return job;
  });

  // Cancel job
  fastify.delete('/jobs/:jobId', async (request: any, reply: any) => {
    const { jobId } = request.params;
    const job = await redisService.getJob(jobId);

    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    // Update job status
    await redisService.updateJobStatus(jobId, 'failed', {
      error: 'Job cancelled by user',
    });

    // Publish cancel event
    await redisService.publishEvent({
      type: 'job:cancelled',
      sessionId: job.sessionId,
      jobId,
      data: { jobId, reason: 'user_request' },
      timestamp: Date.now(),
    });

    // Remove from running jobs
    runningJobs.delete(jobId);

    logger.info('Job cancelled', { jobId });

    return { jobId, status: 'cancelled' };
  });

  // List jobs
  fastify.get('/jobs', async () => {
    const queueLength = await redisService.getQueueLength();
    const activeWorkers = await redisService.getActiveWorkers();

    return {
      queueLength,
      activeWorkers: activeWorkers.length,
      runningJobs: Array.from(runningJobs.values()),
    };
  });

  // Get session
  fastify.get('/sessions/:sessionId', async (request: any, reply: any) => {
    const { sessionId } = request.params;
    const session = await redisService.getSession(sessionId);

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    return session;
  });

  // Get user sessions
  fastify.get('/users/:userId/sessions', async (request: any) => {
    const { userId } = request.params;
    const sessions = await redisService.getUserSessions(userId);
    return { sessions };
  });

  // Terminate runaway job
  fastify.post('/admin/jobs/:jobId/terminate', async (request: any, reply: any) => {
    const { jobId } = request.params;
    const { reason } = request.body || {};

    const job = await redisService.getJob(jobId);
    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    // Check if job is running too long
    const runningJob = runningJobs.get(jobId);
    if (runningJob) {
      const elapsed = Date.now() - runningJob.startedAt;
      if (elapsed < JOB_TIMEOUT_MS) {
        logger.warn('Attempting to terminate job before timeout', { jobId, elapsed });
      }
    }

    // Publish terminate event
    await redisService.publishEvent({
      type: 'job:terminate',
      sessionId: job.sessionId,
      jobId,
      data: { jobId, reason: reason || 'runaway_detection' },
      timestamp: Date.now(),
    });

    // Update job status
    await redisService.updateJobStatus(jobId, 'failed', {
      error: `Job terminated: ${reason || 'runaway detection'}`,
    });

    runningJobs.delete(jobId);

    logger.info('Job terminated', { jobId, reason });

    return { jobId, status: 'terminated', reason };
  });

  // Migrate sandbox
  fastify.post('/sandboxes/migrate', async (request: any, reply: any) => {
    const { jobId, sessionId, fromSandbox, toSandbox } = request.body || {};

    if (!sessionId || !fromSandbox || !toSandbox) {
      return reply.status(400).send({ error: 'sessionId, fromSandbox, and toSandbox are required' });
    }

    // Track migration
    sandboxMigrations.set(sessionId, {
      jobId: jobId || sessionId,
      fromSandbox,
      toSandbox,
      status: 'migrating',
    });

    // Publish migration event
    await redisService.publishEvent({
      type: 'sandbox:migrate',
      sessionId,
      jobId: jobId || sessionId,
      data: { fromSandbox, toSandbox, status: 'migrating' },
      timestamp: Date.now(),
    });

    logger.info('Sandbox migration initiated', { sessionId, fromSandbox, toSandbox });

    return {
      success: true,
      sessionId,
      fromSandbox,
      toSandbox,
      status: 'migrating',
    };
  });

  // Get sandbox migration status
  fastify.get('/sandboxes/migrate/:sessionId', async (request: any) => {
    const { sessionId } = request.params;
    const migration = sandboxMigrations.get(sessionId);

    if (!migration) {
      return { status: 'not_found' };
    }

    return migration;
  });

  // Worker registration
  fastify.post('/workers/register', async (request: any) => {
    const { workerId, metadata } = request.body || {};
    if (!workerId) {
      return { error: 'workerId required' };
    }

    await redisService.registerWorker(workerId, metadata);
    logger.info('Worker registered', { workerId, metadata });

    return { success: true, workerId };
  });

  // Worker heartbeat
  fastify.post('/workers/:workerId/heartbeat', async (request: any) => {
    const { workerId } = request.params;
    const { stats } = request.body || {};

    await redisService.workerHeartbeat(workerId, stats);

    return { success: true, workerId, timestamp: Date.now() };
  });

  // Get active workers
  fastify.get('/workers', async () => {
    const workers = await redisService.getActiveWorkers();
    return { workers };
  });

  // Check for runaway jobs (called periodically)
  setInterval(async () => {
    const now = Date.now();
    for (const [jobId, info] of runningJobs.entries()) {
      const elapsed = now - info.lastHeartbeat;
      const maxElapsed = now - info.startedAt;

      // No heartbeat for 2 minutes or exceeded timeout
      if (elapsed > 120000 || maxElapsed > JOB_TIMEOUT_MS) {
        logger.warn('Runaway job detected', { jobId, elapsed, maxElapsed });

        // Publish terminate event
        await redisService.publishEvent({
          type: 'job:terminate',
          sessionId: info.sessionId,
          jobId,
          data: { jobId, reason: 'runaway_detection', elapsed },
          timestamp: now,
        });

        // Update job status
        await redisService.updateJobStatus(jobId, 'failed', {
          error: `Job terminated: runaway detection (no heartbeat for ${Math.round(elapsed / 1000)}s)`,
        });

        runningJobs.delete(jobId);
      }
    }
  }, 30000); // Check every 30 seconds

  // Start server
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Agent Gateway listening on port ${PORT}`);

    // Log startup event
    await redisService.publishEvent({
      type: 'gateway:started',
      sessionId: '*',
      data: { port: PORT, timestamp: Date.now() },
      timestamp: Date.now(),
    });

  } catch (error: any) {
    logger.error('Failed to start gateway', { error: error.message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Gateway shutting down');

  // Notify all running jobs
  for (const [jobId, info] of runningJobs.entries()) {
    await redisService.publishEvent({
      type: 'gateway:shutdown',
      sessionId: info.sessionId,
      jobId,
      data: { jobId, reason: 'gateway_shutdown' },
      timestamp: Date.now(),
    });
  }

  await redisService.disconnect();
  await fastify.close();
  process.exit(0);
});

// Start gateway
start();

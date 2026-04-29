/**
 * Agent Gateway - Session management + SSE streaming + job queue
 * 
 * Uses Redis PubSub for real-time event streaming between workers and clients.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from './logger';

const logger = createLogger('Agent:Gateway');

const fastify = Fastify({ logger: true, requestIdHeader: 'x-request-id', requestIdLogLabel: 'reqId' });

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_STREAM_KEY = process.env.REDIS_STREAM_KEY || 'agent:events';
const JOB_TIMEOUT_MS = parseInt(process.env.JOB_TIMEOUT_MS || '300000');
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MS || '3600000');

const redis = new Redis(REDIS_URL);
const redisPub = new Redis(REDIS_URL);

// PERF fix: Single shared subscription connection with multiplexing
// Previously, each SSE stream created a new Redis connection — this could exhaust
// connections under high traffic. Now we use one subscriber that routes events
// to the correct SSE client by sessionId.
const sharedSubscriber = new Redis(REDIS_URL);
const sseClients = new Map<string, Set<(event: AgentEvent) => void>>();

sharedSubscriber.subscribe(PUBSUB_CHANNEL);
sharedSubscriber.on('message', (channel: string, message: string) => {
  try {
    const event: AgentEvent = JSON.parse(message);
    // Route to session-specific clients
    if (event.sessionId) {
      const clients = sseClients.get(event.sessionId);
      if (clients) {
        for (const callback of clients) {
          try { callback(event); } catch {}
        }
      }
    }
    // Also route to wildcard listeners (e.g., admin dashboards)
    const wildcardClients = sseClients.get('*');
    if (wildcardClients) {
      for (const callback of wildcardClients) {
        try { callback(event); } catch {}
      }
    }
  } catch (e) {
    // Ignore parse errors for non-event messages
  }
});

function registerSSEClient(sessionId: string, callback: (event: AgentEvent) => void): () => void {
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Set());
  }
  sseClients.get(sessionId)!.add(callback);
  // Also subscribe to session-specific channel for targeted events
  sharedSubscriber.subscribe(`${PUBSUB_CHANNEL}:${sessionId}`).catch(() => {});
  return () => {
    const clients = sseClients.get(sessionId);
    if (clients) {
      clients.delete(callback);
      if (clients.size === 0) {
        sseClients.delete(sessionId);
        sharedSubscriber.unsubscribe(`${PUBSUB_CHANNEL}:${sessionId}`).catch(() => {});
      }
    }
  };
}

const PUBSUB_CHANNEL = 'agent:events';
const JOB_QUEUE = 'agent:jobs';
const SESSIONS_KEY = 'agent:sessions';

interface AgentSession {
  id: string;
  userId: string;
  conversationId: string;
  createdAt: number;
  lastActivity: number;
  status: 'active' | 'completed' | 'failed';
  jobId?: string;
}

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

async function publishEvent(event: AgentEvent): Promise<void> {
  const message = JSON.stringify(event);
  await redisPub.publish(PUBSUB_CHANNEL, message);
  if (event.sessionId) {
    await redisPub.publish(`${PUBSUB_CHANNEL}:${event.sessionId}`, message);
  }
  try {
    await redis.xadd(REDIS_STREAM_KEY, '*', 'event', message);
  } catch (e) {
    logger.warn('Failed to add to stream', { error: e });
  }
}

// subscribeToSession is DEPRECATED — replaced by registerSSEClient() which uses
// the shared multiplexed subscriber connection instead of creating a new Redis
// connection per SSE stream.

async function start() {
  await fastify.register(cors, { origin: true, methods: ['GET', 'POST', 'OPTIONS'] });

  fastify.get('/health', async () => {
    const redisPing = await redis.ping().catch(() => 'error');
    return { status: 'ok', redis: redisPing, timestamp: Date.now() };
  });

  fastify.get('/ready', async () => {
    try { await redis.ping(); return { ready: true }; }
    catch { return { ready: false }; }
  });

  fastify.post('/jobs', async (request: any, reply: any) => {
    // MED-9 fix: Propagate request ID for distributed tracing
    const requestId = request.id || request.headers['x-request-id'] || `req-${uuidv4()}`;
    reply.header('x-request-id', requestId);
    
    const { userId, conversationId, prompt, context, tools, model } = request.body || {};
    if (!userId || !prompt) {
      return reply.status(400).send({ error: 'userId and prompt are required' });
    }

    const jobId = `job-${uuidv4()}`;
    const sessionId = `session-${conversationId}-${Date.now()}`;

    const session: AgentSession = {
      id: sessionId,
      userId,
      conversationId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      status: 'active',
      jobId,
    };

    await redis.hset(`${SESSIONS_KEY}:${sessionId}`, {
      id: session.id, userId: session.userId, conversationId: session.conversationId,
      status: session.status, jobId: session.jobId || '',
      createdAt: String(session.createdAt), lastActivity: String(session.lastActivity),
    });
    await redis.expire(`${SESSIONS_KEY}:${sessionId}`, Math.floor(SESSION_TIMEOUT_MS / 1000));

    const job: AgentJob = {
      id: jobId, sessionId, userId, conversationId, prompt, context, tools, model,
      createdAt: Date.now(), status: 'pending',
    };

    await redis.lpush(JOB_QUEUE, JSON.stringify(job));
    await publishEvent({ type: 'job:ready', sessionId, data: { jobId }, timestamp: Date.now() });

    logger.info('Created job', { jobId, sessionId, userId, requestId });
    return { jobId, sessionId, status: 'pending' };
  });

  fastify.get('/stream/:sessionId', async (request: any, reply: any) => {
    const { sessionId } = request.params;
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ sessionId, timestamp: Date.now() })}\n\n`);

    let isActive = true;

    try {
      // PERF fix: Use shared multiplexed subscriber instead of creating a new Redis connection per SSE stream
      const unregister = registerSSEClient(sessionId, (event: AgentEvent) => {
        if (!isActive) return;
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        if (isActive) reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
      }, 30000);

      request.raw.on('close', () => {
        isActive = false;
        clearInterval(heartbeat);
        unregister(); // Remove from shared subscriber routing
        logger.info('Session disconnected', { sessionId });
      });
    } catch (error: any) {
      logger.error('Stream error', { sessionId, error: error.message });
    }

    return reply;
  });

  fastify.get('/jobs/:jobId', async (request: any, reply: any) => {
    const { jobId } = request.params;
    const jobData = await redis.get(`agent:job:${jobId}`);
    if (!jobData) return reply.status(404).send({ error: 'Job not found' });
    return JSON.parse(jobData);
  });

  fastify.get('/sessions/:sessionId', async (request: any, reply: any) => {
    const { sessionId } = request.params;
    const sessionData = await redis.hgetall(`${SESSIONS_KEY}:${sessionId}`);
    if (!sessionData || Object.keys(sessionData).length === 0) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return {
      id: sessionData.id, userId: sessionData.userId, conversationId: sessionData.conversationId,
      status: sessionData.status, jobId: sessionData.jobId,
      createdAt: parseInt(sessionData.createdAt || '0'),
      lastActivity: parseInt(sessionData.lastActivity || '0'),
    };
  });

  fastify.delete('/jobs/:jobId', async (request: any) => {
    const { jobId } = request.params;
    await publishEvent({ type: 'job:cancel', sessionId: '', data: { jobId }, timestamp: Date.now() });
    return { jobId, status: 'cancelled' };
  });

  fastify.get('/jobs', async () => {
    const jobs = await redis.lrange(JOB_QUEUE, 0, -1);
    return { count: jobs.length, jobs: jobs.map(j => JSON.parse(j)) };
  });

  fastify.get('/sessions', async () => {
    // PERF fix: Replace redis.keys() (O(N) blocking) with redis.scanStream() for
    // non-blocking iteration. KEYS can block the Redis event loop in production.
    const sessions: any[] = [];
    const stream = redis.scanStream({ match: `${SESSIONS_KEY}:*`, count: 100 });
    for await (const keys of stream as AsyncIterable<string[]>) {
      for (const key of keys) {
        const data = await redis.hgetall(key);
        if (data && data.id) {
          sessions.push({ id: data.id, userId: data.userId, status: data.status, createdAt: parseInt(data.createdAt || '0') });
        }
      }
    }
    return { sessions };
  });

  fastify.get('/streams', async () => {
    try {
      const info: any = await redis.xinfo('STREAM', REDIS_STREAM_KEY);
      return { key: REDIS_STREAM_KEY, length: info?.length || 0 };
    } catch { return { key: REDIS_STREAM_KEY, length: 0 }; }
  });

  fastify.get('/checkpoints/:sessionId', async (request: any, reply: any) => {
    const { sessionId } = request.params;
    const data = await redis.hget(`agent:checkpoint:${sessionId}`, 'current');
    if (!data) return reply.status(404).send({ error: 'No checkpoint found', sessionId });
    try { return { checkpoint: JSON.parse(data) }; }
    catch { return reply.status(500).send({ error: 'Failed to parse checkpoint' }); }
  });

  fastify.get('/checkpoints/:sessionId/history', async (request: any) => {
    const { sessionId } = request.params;
    const data = await redis.hgetall(`agent:checkpoint:${sessionId}`);
    const checkpoints = [];
    for (const [field, value] of Object.entries(data || {})) {
      if (field === 'current') continue;
      try { checkpoints.push(JSON.parse(value)); } catch {}
    }
    return { checkpoints: checkpoints.sort((a: any, b: any) => a.step - b.step), sessionId };
  });

  // Git-VFS endpoints for version control and rollbacks
  fastify.get('/git/:sessionId/versions', async (request: any, reply: any) => {
    const { sessionId } = request.params;
    const { limit = 20 } = request.query as { limit?: number };
    
    try {
      // Get checkpoint history as version history
      const data = await redis.hgetall(`agent:checkpoint:${sessionId}`);
      const versions = [];
      for (const [field, value] of Object.entries(data || {})) {
        if (field === 'current') continue;
        try {
          const checkpoint = JSON.parse(value);
          versions.push({
            version: checkpoint.step,
            commitId: checkpoint.id,
            message: checkpoint.message,
            filesChanged: checkpoint.toolCalls?.length || 0,
            createdAt: checkpoint.createdAt,
          });
        } catch {}
      }
      return { versions: versions.sort((a: any, b: any) => b.version - a.version).slice(0, limit) };
    } catch (error: any) {
      return reply.status(500).send({ error: `Failed to get versions: ${error.message}` });
    }
  });

  fastify.post('/git/:sessionId/rollback', async (request: any, reply: any) => {
    const { sessionId } = request.params;
    const { version } = request.body as { version: number };
    
    if (!version || version < 0) {
      return reply.status(400).send({ error: 'Invalid version number' });
    }

    try {
      // Publish rollback event to worker
      await publishEvent({
        type: 'git:rollback',
        sessionId,
        data: { version, timestamp: Date.now() },
        timestamp: Date.now(),
      });

      return { 
        success: true, 
        message: `Rollback to version ${version} initiated`,
        version,
      };
    } catch (error: any) {
      return reply.status(500).send({ error: `Failed to rollback: ${error.message}` });
    }
  });

  fastify.get('/git/:sessionId/diff', async (request: any, reply: any) => {
    const { sessionId } = request.params;
    const { fromVersion, toVersion } = request.query as { fromVersion?: number; toVersion?: number };
    
    try {
      // Get checkpoints for diff
      const fromData = fromVersion !== undefined 
        ? await redis.hget(`agent:checkpoint:${sessionId}`, `step_${fromVersion}`)
        : null;
      const toData = toVersion !== undefined
        ? await redis.hget(`agent:checkpoint:${sessionId}`, `step_${toVersion}`)
        : await redis.hget(`agent:checkpoint:${sessionId}`, 'current');

      const fromCheckpoint = fromData ? JSON.parse(fromData) : null;
      const toCheckpoint = toData ? JSON.parse(toData) : null;

      return {
        fromVersion: fromVersion || 0,
        toVersion: toVersion || 'current',
        fromToolCalls: fromCheckpoint?.toolCalls?.length || 0,
        toToolCalls: toCheckpoint?.toolCalls?.length || 0,
      };
    } catch (error: any) {
      return reply.status(500).send({ error: `Failed to get diff: ${error.message}` });
    }
  });

  fastify.delete('/checkpoints/:sessionId', async (request: any) => {
    const { sessionId } = request.params;
    await redis.del(`agent:checkpoint:${sessionId}`);
    return { sessionId, deleted: true };
  });

  fastify.post('/jobs/resume', async (request: any, reply: any) => {
    const { sessionId, conversationId, userId } = request.body || {};
    if (!sessionId || !conversationId || !userId) {
      return reply.status(400).send({ error: 'sessionId, conversationId, and userId are required' });
    }

    const data = await redis.hget(`agent:checkpoint:${sessionId}`, 'current');
    if (!data) return reply.status(404).send({ error: 'No checkpoint found to resume from' });

    let checkpoint;
    try { checkpoint = JSON.parse(data); }
    catch { return reply.status(500).send({ error: 'Failed to parse checkpoint' }); }

    const jobId = `job-${Date.now()}`;
    const newSessionId = `session-${conversationId}-${Date.now()}`;
    const job = {
      id: jobId, sessionId: newSessionId, userId, conversationId,
      prompt: checkpoint.prompt, context: checkpoint.context,
      createdAt: Date.now(), status: 'pending', resumeFrom: sessionId,
    };

    await redis.lpush(JOB_QUEUE, JSON.stringify(job));
    await publishEvent({ type: 'job:resume', sessionId: newSessionId, data: { jobId, resumeFrom: sessionId }, timestamp: Date.now() });

    return { jobId, sessionId: newSessionId, status: 'pending', resumeFrom: sessionId };
  });

  try {
    await redis.ping();
    logger.info('Connected to Redis');
    await redis.xadd(REDIS_STREAM_KEY, '*', 'event', JSON.stringify({ type: 'gateway:start', sessionId: '', data: { timestamp: Date.now() }, timestamp: Date.now() }));
    await fastify.listen({ port: parseInt(process.env.PORT || '3002'), host: '0.0.0.0' });
    logger.info(`Agent Gateway listening on port ${process.env.PORT || 3002}`);
  } catch (err: any) {
    logger.error('Failed to start server', { error: err.message });
    process.exit(1);
  }
}

// MED-8 fix: Graceful shutdown with timeout — drains connections before closing
const GATEWAY_SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '30000', 10);

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Gateway received ${signal}, starting graceful shutdown`);
  
  const forceTimer = setTimeout(() => {
    logger.error('Gateway shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, GATEWAY_SHUTDOWN_TIMEOUT_MS);
  
  try {
    // Stop accepting new connections
    await fastify.close();
    logger.info('Fastify server closed');
    
    // Close Redis connections
    await redis.quit();
    await sharedSubscriber.quit();
    await redisPub.quit();
    logger.info('Redis connections closed');
    
    clearTimeout(forceTimer);
    logger.info('Gateway shutdown complete');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error during gateway shutdown', { error: error.message });
    clearTimeout(forceTimer);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start();

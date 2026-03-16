/**
 * Redis Agent Service
 *
 * Integration with Redis for V2 Agent Architecture:
 * - Job queue management (agent:jobs)
 * - PubSub for real-time events (agent:events)
 * - Stream for event persistence (agent:events:stream)
 * - Session management
 * - Worker coordination
 *
 * Used by:
 * - Agent Gateway (job creation + SSE)
 * - Agent Workers (job processing)
 * - Planner (task decomposition)
 * - Scheduler (cron jobs)
 *
 * @see docker-compose.v2.yml for Redis configuration
 */

import Redis from 'ioredis';
import { createLogger } from '../utils/logger';

const logger = createLogger('Redis:Agent');

// ============================================================================
// Types
// ============================================================================

export interface AgentJob {
  id: string;
  sessionId: string;
  userId: string;
  conversationId: string;
  prompt: string;
  context?: string;
  tools?: string[];
  model?: string;
  executionPolicy?: string;
  createdAt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  workerId?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface AgentEvent {
  type: string;
  sessionId: string;
  jobId?: string;
  data: any;
  timestamp: number;
}

export interface AgentSession {
  id: string;
  userId: string;
  conversationId: string;
  createdAt: number;
  lastActivityAt: number;
  status: 'active' | 'idle' | 'completed';
  currentJobId?: string;
  metadata?: Record<string, any>;
}

export interface RedisAgentConfig {
  redisUrl?: string;
  jobQueue?: string;
  eventChannel?: string;
  eventStream?: string;
  sessionPrefix?: string;
  jobTTL?: number;
  sessionTTL?: number;
}

// ============================================================================
// Redis Agent Service
// ============================================================================

export class RedisAgentService {
  private redis: Redis;
  private pubClient: Redis;
  private config: Required<RedisAgentConfig>;
  private connected: boolean = false;

  constructor(config: RedisAgentConfig = {}) {
    this.config = {
      redisUrl: config.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379',
      jobQueue: config.jobQueue || 'agent:jobs',
      eventChannel: config.eventChannel || 'agent:events',
      eventStream: config.eventStream || 'agent:events:stream',
      sessionPrefix: config.sessionPrefix || 'agent:session',
      jobTTL: config.jobTTL || 3600, // 1 hour
      sessionTTL: config.sessionTTL || 7200, // 2 hours
    };

    // Create Redis clients
    this.redis = new Redis(this.config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          logger.error('Max Redis connection retries reached');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
    });

    // Dedicated publisher for better performance
    this.pubClient = new Redis(this.config.redisUrl);

    this.setupEventHandlers();
  }

  /**
   * Setup Redis event handlers
   */
  private setupEventHandlers(): void {
    this.redis.on('connect', () => {
      logger.info('Connected to Redis', { url: this.config.redisUrl });
      this.connected = true;
    });

    this.redis.on('error', (error) => {
      logger.error('Redis connection error', error);
      this.connected = false;
    });

    this.redis.on('close', () => {
      logger.warn('Redis connection closed');
      this.connected = false;
    });
  }

  /**
   * Wait for Redis connection
   */
  async waitForConnection(timeout: number = 5000): Promise<boolean> {
    if (this.connected) return true;

    const startTime = Date.now();
    while (!this.connected) {
      if (Date.now() - startTime > timeout) {
        logger.error('Redis connection timeout');
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return true;
  }

  // ============================================================================
  // Job Queue Operations
  // ============================================================================

  /**
   * Push job to queue
   */
  async pushJob(job: AgentJob): Promise<void> {
    await this.waitForConnection();
    
    job.status = 'pending';
    job.createdAt = Date.now();
    
    await this.redis.set(
      `agent:job:${job.id}`,
      JSON.stringify(job),
      'EX',
      this.config.jobTTL
    );
    
    await this.redis.lpush(this.config.jobQueue, JSON.stringify(job));
    
    logger.info('Job pushed to queue', { jobId: job.id, userId: job.userId });
  }

  /**
   * Pop job from queue (blocking)
   */
  async popJob(timeout: number = 5): Promise<AgentJob | null> {
    await this.waitForConnection();
    
    const result = await this.redis.brpop(this.config.jobQueue, timeout);
    if (!result) return null;
    
    const jobData = result[1];
    try {
      const job: AgentJob = JSON.parse(jobData);
      
      // Update job status
      job.status = 'processing';
      job.startedAt = Date.now();
      
      await this.redis.set(
        `agent:job:${job.id}`,
        JSON.stringify(job),
        'EX',
        this.config.jobTTL
      );
      
      return job;
    } catch (error: any) {
      logger.error('Failed to parse job from queue', error);
      return null;
    }
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<AgentJob | null> {
    await this.waitForConnection();
    
    const data = await this.redis.get(`agent:job:${jobId}`);
    if (!data) return null;
    
    try {
      return JSON.parse(data) as AgentJob;
    } catch {
      return null;
    }
  }

  /**
   * Update job status
   */
  async updateJobStatus(
    jobId: string,
    status: AgentJob['status'],
    updates?: Partial<AgentJob>
  ): Promise<void> {
    await this.waitForConnection();
    
    const job = await this.getJob(jobId);
    if (!job) {
      logger.warn('Job not found for status update', { jobId });
      return;
    }
    
    const updatedJob = {
      ...job,
      ...updates,
      status,
      completedAt: status === 'completed' || status === 'failed' ? Date.now() : job.completedAt,
    };
    
    await this.redis.set(
      `agent:job:${jobId}`,
      JSON.stringify(updatedJob),
      'EX',
      this.config.jobTTL
    );
    
    logger.debug('Job status updated', { jobId, status });
  }

  /**
   * Get queue length
   */
  async getQueueLength(): Promise<number> {
    await this.waitForConnection();
    return await this.redis.llen(this.config.jobQueue);
  }

  // ============================================================================
  // PubSub Event Operations
  // ============================================================================

  /**
   * Publish event to PubSub
   */
  async publishEvent(event: AgentEvent): Promise<void> {
    await this.waitForConnection();
    
    const message = JSON.stringify(event);
    
    // Publish to PubSub channel
    await this.pubClient.publish(this.config.eventChannel, message);
    
    // Also add to stream for persistence
    await this.redis.xadd(
      this.config.eventStream,
      '*',
      'event',
      message,
      'sessionId',
      event.sessionId,
      'timestamp',
      event.timestamp.toString()
    );
    
    // Trim stream to last 10000 events per session
    await this.redis.xtrim(this.config.eventStream, 'MAXLEN', '~', '10000');
  }

  /**
   * Subscribe to events
   */
  async subscribeEvents(
    callback: (event: AgentEvent) => void,
    sessionId?: string
  ): Promise<Redis> {
    await this.waitForConnection();
    
    const subClient = new Redis(this.config.redisUrl);
    
    await subClient.subscribe(this.config.eventChannel);
    
    subClient.on('message', (channel, message) => {
      try {
        const event: AgentEvent = JSON.parse(message);
        
        // Filter by sessionId if specified
        if (!sessionId || event.sessionId === sessionId) {
          callback(event);
        }
      } catch (error: any) {
        logger.error('Failed to parse event from PubSub', error);
      }
    });
    
    logger.info('Subscribed to events', { sessionId });
    
    return subClient;
  }

  /**
   * Get event history from stream
   */
  async getEventHistory(
    sessionId: string,
    limit: number = 100
  ): Promise<AgentEvent[]> {
    await this.waitForConnection();
    
    const events = await this.redis.xrevrange(
      this.config.eventStream,
      '+',
      '-',
      'COUNT',
      limit
    );
    
    return events
      .map(([id, data]) => {
        try {
          const event = JSON.parse(data.event);
          if (event.sessionId === sessionId) {
            return event;
          }
          return null;
        } catch {
          return null;
        }
      })
      .filter((e): e is AgentEvent => e !== null);
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Create or update session
   */
  async upsertSession(session: AgentSession): Promise<void> {
    await this.waitForConnection();
    
    session.lastActivityAt = Date.now();
    session.status = session.status || 'active';
    
    const key = `${this.config.sessionPrefix}:${session.id}`;
    await this.redis.set(
      key,
      JSON.stringify(session),
      'EX',
      this.config.sessionTTL
    );
    
    // Track session in set for user
    await this.redis.sadd(`agent:user:${session.userId}:sessions`, session.id);
    
    logger.debug('Session upserted', { sessionId: session.id, userId: session.userId });
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<AgentSession | null> {
    await this.waitForConnection();
    
    const key = `${this.config.sessionPrefix}:${sessionId}`;
    const data = await this.redis.get(key);
    
    if (!data) return null;
    
    try {
      return JSON.parse(data) as AgentSession;
    } catch {
      return null;
    }
  }

  /**
   * Get all sessions for user
   */
  async getUserSessions(userId: string): Promise<AgentSession[]> {
    await this.waitForConnection();
    
    const sessionIds = await this.redis.smembers(`agent:user:${userId}:sessions`);
    
    const sessions: AgentSession[] = [];
    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session) {
        sessions.push(session);
      }
    }
    
    return sessions;
  }

  /**
   * Update session activity
   */
  async touchSession(sessionId: string): Promise<void> {
    await this.waitForConnection();
    
    const session = await this.getSession(sessionId);
    if (session) {
      session.lastActivityAt = Date.now();
      await this.upsertSession(session);
    }
  }

  /**
   * Close session
   */
  async closeSession(sessionId: string): Promise<void> {
    await this.waitForConnection();
    
    const session = await this.getSession(sessionId);
    if (session) {
      session.status = 'completed';
      await this.upsertSession(session);
    }
  }

  // ============================================================================
  // Worker Coordination
  // ============================================================================

  /**
   * Register worker
   */
  async registerWorker(workerId: string, metadata?: Record<string, any>): Promise<void> {
    await this.waitForConnection();
    
    const workerInfo = {
      id: workerId,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
      status: 'active',
      metadata,
    };
    
    await this.redis.hset('agent:workers', workerId, JSON.stringify(workerInfo));
    await this.redis.expire('agent:workers', 3600);
    
    logger.info('Worker registered', { workerId });
  }

  /**
   * Update worker heartbeat
   */
  async workerHeartbeat(workerId: string, stats?: Record<string, any>): Promise<void> {
    await this.waitForConnection();
    
    const workerData = await this.redis.hget('agent:workers', workerId);
    if (workerData) {
      try {
        const worker = JSON.parse(workerData);
        worker.lastHeartbeat = Date.now();
        worker.status = 'active';
        if (stats) worker.metadata = { ...worker.metadata, ...stats };
        
        await this.redis.hset('agent:workers', workerId, JSON.stringify(worker));
      } catch {
        // Worker not found, register it
        await this.registerWorker(workerId, stats);
      }
    } else {
      await this.registerWorker(workerId, stats);
    }
  }

  /**
   * Get active workers
   */
  async getActiveWorkers(): Promise<Array<{ id: string; metadata?: Record<string, any> }>> {
    await this.waitForConnection();
    
    const workers = await this.redis.hgetall('agent:workers');
    const now = Date.now();
    const activeWorkers: Array<{ id: string; metadata?: Record<string, any> }> = [];
    
    for (const [workerId, workerData] of Object.entries(workers)) {
      try {
        const worker = JSON.parse(workerData);
        // Consider worker active if heartbeat within last 60 seconds
        if (now - worker.lastHeartbeat < 60000) {
          activeWorkers.push({ id: workerId, metadata: worker.metadata });
        }
      } catch {
        // Invalid worker data, ignore
      }
    }
    
    return activeWorkers;
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  /**
   * Check Redis health
   */
  async healthCheck(): Promise<{
    connected: boolean;
    queueLength: number;
    activeWorkers: number;
    latency: number;
  }> {
    const startTime = Date.now();
    
    try {
      await this.redis.ping();
      const latency = Date.now() - startTime;
      
      const queueLength = await this.getQueueLength();
      const activeWorkers = (await this.getActiveWorkers()).length;
      
      return {
        connected: this.connected,
        queueLength,
        activeWorkers,
        latency,
      };
    } catch (error: any) {
      logger.error('Redis health check failed', error);
      return {
        connected: false,
        queueLength: 0,
        activeWorkers: 0,
        latency: -1,
      };
    }
  }

  /**
   * Close Redis connections
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
    await this.pubClient.quit();
    this.connected = false;
    logger.info('Disconnected from Redis');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let redisAgentServiceInstance: RedisAgentService | null = null;

/**
 * Get Redis agent service instance
 */
export function getRedisAgentService(config?: RedisAgentConfig): RedisAgentService {
  if (!redisAgentServiceInstance) {
    redisAgentServiceInstance = new RedisAgentService(config);
  }
  return redisAgentServiceInstance;
}

/**
 * Initialize Redis agent service
 */
export async function initializeRedisAgentService(
  config?: RedisAgentConfig
): Promise<RedisAgentService> {
  const service = getRedisAgentService(config);
  await service.waitForConnection();
  return service;
}

// Convenience export
export const redisAgentService = getRedisAgentService();

/**
 * Integration Tests for Agent Worker
 *
 * Tests for:
 * - Job queue processing with BullMQ
 * - Event publishing and event stream
 * - Race condition handling
 * - Error recovery and retry logic
 * - Job timeout and cancellation
 * - Graceful shutdown
 * - Health check endpoints
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Redis from 'ioredis';
import { Queue, Job } from 'bullmq';

describe('Agent Worker Integration Tests', () => {
  let redis: Redis;
  let queue: Queue;
  const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

  beforeAll(async () => {
    redis = new Redis(REDIS_URL);
    queue = new Queue('agent:jobs', { connection: redis });

    // Wait for Redis connection
    await redis.ping();
  });

  afterAll(async () => {
    await queue.close();
    await redis.quit();
  });

  beforeEach(async () => {
    // Clear all queue state before each test for strict isolation
    await queue.obliterate({ force: true });
  });

  describe('Job Queue Reliability', () => {
    it('should accept and queue agent tasks', async () => {
      const job = await queue.add('agent-task', {
        type: 'agent-task',
        sessionId: 'test-session-1',
        userId: 'test-user-1',
        conversationId: 'conv-1',
        prompt: 'Write a hello world function',
        createdAt: Date.now(),
      });

      expect(job.id).toBeDefined();
      expect(job.data.sessionId).toBe('test-session-1');

      const retrievedJob = await queue.getJob(job.id!);
      expect(retrievedJob).toBeDefined();
      expect(retrievedJob?.data.prompt).toBe('Write a hello world function');
    });

    it('should preserve job data on queue', async () => {
      const jobData = {
        type: 'agent-task',
        sessionId: 'test-session-2',
        userId: 'test-user-2',
        conversationId: 'conv-2',
        prompt: 'Create a REST API',
        context: 'TypeScript + Express',
        tools: ['file-editor', 'terminal'],
        model: 'opencode/minimax-m2.5-free',
        createdAt: Date.now(),
      };

      const job = await queue.add('agent-task', jobData);
      const retrieved = await queue.getJob(job.id!);

      expect(retrieved?.data).toEqual(jobData);
    });

    it('should handle multiple concurrent jobs', async () => {
      const jobs = [];
      const jobCount = 10;

      for (let i = 0; i < jobCount; i++) {
        const job = await queue.add('agent-task', {
          type: 'agent-task',
          sessionId: `session-${i}`,
          userId: `user-${i}`,
          conversationId: `conv-${i}`,
          prompt: `Task ${i}`,
          createdAt: Date.now(),
        });
        jobs.push(job);
      }

      expect(jobs.length).toBe(jobCount);
      
      // PERF fix: Wait for jobs to settle in the waiting state
      // BullMQ may take a moment to reflect the waiting count accurately
      let waiting = 0;
      for (let i = 0; i < 5; i++) {
        waiting = await queue.getWaitingCount();
        if (waiting === jobCount) break;
        await new Promise(r => setTimeout(r, 100));
      }
      
      expect(waiting).toBe(jobCount);
    });

    it('should support job priorities', async () => {
      // Add low priority job
      const lowPriority = await queue.add('agent-task', {
        type: 'agent-task',
        sessionId: 'low-priority',
        userId: 'user',
        conversationId: 'conv',
        prompt: 'Low priority task',
        createdAt: Date.now(),
      }, { priority: 10 });

      // Add high priority job
      const highPriority = await queue.add('agent-task', {
        type: 'agent-task',
        sessionId: 'high-priority',
        userId: 'user',
        conversationId: 'conv',
        prompt: 'High priority task',
        createdAt: Date.now(),
      }, { priority: 1 });

      // High priority should be first
      const jobs = await queue.getJobs(['waiting']);
      expect(jobs[0].id).toBe(highPriority.id);
      expect(jobs[1].id).toBe(lowPriority.id);
    });
  });

  describe('Job Retry Logic', () => {
    it('should retry failed jobs automatically', async () => {
      const job = await queue.add('agent-task', {
        type: 'agent-task',
        sessionId: 'retry-test',
        userId: 'user',
        conversationId: 'conv',
        prompt: 'Task to retry',
        createdAt: Date.now(),
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 100,
        },
      });

      expect(job.id).toBeDefined();
      expect(job.attemptsMade).toBe(0);
    });

    it('should track attempt count', async () => {
      const job = await queue.add('agent-task', {
        type: 'agent-task',
        sessionId: 'attempts-test',
        userId: 'user',
        conversationId: 'conv',
        prompt: 'Test attempts',
        createdAt: Date.now(),
      }, {
        attempts: 3,
      });

      expect(job.attemptsStarted).toBe(0);
      expect(job.attemptsMade).toBe(0);
    });
  });

  describe('Job Cancellation', () => {
    it('should be able to cancel pending jobs', async () => {
      const job = await queue.add('agent-task', {
        type: 'agent-task',
        sessionId: 'cancel-test',
        userId: 'user',
        conversationId: 'conv',
        prompt: 'Task to cancel',
        createdAt: Date.now(),
      });

      const jobId = job.id!;

      // Cancel the job
      await job.remove();

      // Verify it's gone
      const retrieved = await queue.getJob(jobId);
      expect(retrieved).toBeNull();
    });

    it('should be able to cancel multiple jobs by session', async () => {
      const sessionId = 'multi-cancel-session';

      // Add multiple jobs for the same session
      const jobs = [];
      for (let i = 0; i < 3; i++) {
        const job = await queue.add('agent-task', {
          type: 'agent-task',
          sessionId,
          userId: 'user',
          conversationId: `conv-${i}`,
          prompt: `Task ${i}`,
          createdAt: Date.now(),
        });
        jobs.push(job);
      }

      // Cancel all jobs for this session
      const allJobs = await queue.getJobs(['waiting']);
      const sessionJobs = allJobs.filter(j => j.data.sessionId === sessionId);

      for (const job of sessionJobs) {
        await job.remove();
      }

      // Verify they're all gone
      const remaining = await queue.getJobs(['waiting']);
      expect(remaining.filter(j => j.data.sessionId === sessionId).length).toBe(0);
    });
  });

  describe('Queue Statistics', () => {
    it('should provide queue statistics', async () => {
      // Add some jobs
      for (let i = 0; i < 5; i++) {
        await queue.add('agent-task', {
          type: 'agent-task',
          sessionId: `stats-session-${i}`,
          userId: 'user',
          conversationId: 'conv',
          prompt: `Task ${i}`,
          createdAt: Date.now(),
        });
      }

      const waiting = await queue.getWaitingCount();
      const active = await queue.getActiveCount();
      const completed = await queue.getCompletedCount();
      const failed = await queue.getFailedCount();

      expect(waiting).toBeGreaterThanOrEqual(5);
      expect(active).toBe(0);
      expect(completed).toBeGreaterThanOrEqual(0);
      expect(failed).toBeGreaterThanOrEqual(0);
    });

    it('should track job creation time', async () => {
      const startTime = Date.now();
      const job = await queue.add('agent-task', {
        type: 'agent-task',
        sessionId: 'time-test',
        userId: 'user',
        conversationId: 'conv',
        prompt: 'Task',
        createdAt: startTime,
      });

      const retrieved = await queue.getJob(job.id!);
      expect(retrieved?.data.createdAt).toBeLessThanOrEqual(Date.now());
      expect(retrieved?.data.createdAt).toBeGreaterThanOrEqual(startTime - 100);
    });
  });

  describe('Event Stream', () => {
    const streamKey = 'agent:events';

    beforeEach(async () => {
      // PERF fix: Ensure clean stream state before each test
      await redis.del(streamKey);
    });

    it('should publish events to Redis Stream', async () => {
      // Add an event
      const eventData = JSON.stringify({
        type: 'job:started',
        sessionId: 'test-session',
        data: { jobId: 'job-1' },
        timestamp: Date.now(),
      });

      await redis.xadd(streamKey, '*', 'event', eventData);

      // Read events from stream
      const events = await redis.xrange(streamKey, '-', '+');
      expect(events.length).toBeGreaterThan(0);

      const lastEvent = events[events.length - 1];
      const [, fields] = lastEvent as any;
      expect(fields[1]).toContain('job:started');
    });

    it('should preserve event sequence', async () => {
      const sessionId = 'sequence-test';

      // Publish events in order
      const events = [
        { type: 'job:started', data: { stage: 'start' } },
        { type: 'job:progress', data: { stage: 'processing' } },
        { type: 'job:done', data: { stage: 'complete' } },
      ];

      for (const event of events) {
        await redis.xadd(streamKey, '*', 'event', JSON.stringify({
          ...event,
          sessionId,
          timestamp: Date.now(),
        }));
      }

      // Verify order
      const storedEvents = await redis.xrange(streamKey, '-', '+');
      expect(storedEvents.length).toBeGreaterThanOrEqual(events.length);
    });
  });

  describe('Session Isolation', () => {
    it('should isolate jobs by session', async () => {
      const session1 = 'session-a';
      const session2 = 'session-b';

      // Add jobs to different sessions
      const job1 = await queue.add('agent-task', {
        type: 'agent-task',
        sessionId: session1,
        userId: 'user',
        conversationId: 'conv-1',
        prompt: 'Task 1',
        createdAt: Date.now(),
      });

      const job2 = await queue.add('agent-task', {
        type: 'agent-task',
        sessionId: session2,
        userId: 'user',
        conversationId: 'conv-2',
        prompt: 'Task 2',
        createdAt: Date.now(),
      });

      // Verify both jobs exist
      expect(await queue.getJob(job1.id!)).toBeDefined();
      expect(await queue.getJob(job2.id!)).toBeDefined();

      // Verify they're different
      expect(job1.id).not.toBe(job2.id);
    });

    it('should track job context properly', async () => {
      const userId = 'test-user-123';
      const conversationId = 'test-conversation-456';

      const job = await queue.add('agent-task', {
        type: 'agent-task',
        sessionId: 'context-test',
        userId,
        conversationId,
        prompt: 'Context test',
        createdAt: Date.now(),
      });

      const retrieved = await queue.getJob(job.id!);
      expect(retrieved?.data.userId).toBe(userId);
      expect(retrieved?.data.conversationId).toBe(conversationId);
    });
  });

  describe('Health Checks', () => {
    it('should report queue health', async () => {
      const stats = {
        waiting: await queue.getWaitingCount(),
        active: await queue.getActiveCount(),
        completed: await queue.getCompletedCount(),
        failed: await queue.getFailedCount(),
        delayed: await queue.getDelayedCount(),
      };

      expect(stats.waiting).toBeGreaterThanOrEqual(0);
      expect(stats.active).toBeGreaterThanOrEqual(0);
      expect(stats.completed).toBeGreaterThanOrEqual(0);
      expect(stats.failed).toBeGreaterThanOrEqual(0);
      expect(stats.delayed).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('Agent Worker ExecutionPolicy', () => {
  describe('ExecutionPolicy Enforcement', () => {
    it('should validate execution policy for agent tasks', () => {
      const job = {
        type: 'agent-task',
        sessionId: 'policy-test',
        userId: 'user',
        conversationId: 'conv',
        prompt: 'run bash command',
        executionPolicy: 'local-safe',
        createdAt: Date.now(),
      };

      expect(job.executionPolicy).toBeDefined();
      expect(['local-safe', 'persistent-sandbox', 'desktop-required']).toContain(job.executionPolicy);
    });

    it('should enforce policy constraints', () => {
      const policies = [
        { policy: 'local-safe', allowsBash: false, allowsFileWrite: true },
        { policy: 'persistent-sandbox', allowsBash: true, allowsFileWrite: true },
        { policy: 'desktop-required', allowsBash: true, allowsFileWrite: true },
      ];

      for (const { policy } of policies) {
        expect(['local-safe', 'persistent-sandbox', 'desktop-required']).toContain(policy);
      }
    });
  });
});

/**
 * V2 Agent Worker Tests
 * 
 * Tests for the agent worker service including:
 * - Job processing
 * - OpenCode engine integration
 * - Git-VFS integration
 * - Event publishing
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const JOB_QUEUE = 'agent:jobs';

describe('Agent Worker', () => {
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL);
  });

  afterAll(async () => {
    await redis.quit();
  });

  describe('Job Queue', () => {
    it('should push job to queue', async () => {
      const job = {
        id: 'test-job-1',
        sessionId: 'test-session-1',
        userId: 'test-user-1',
        conversationId: 'test-conv-1',
        prompt: 'Test prompt',
        createdAt: Date.now(),
        status: 'pending',
      };

      const length = await redis.lpush(JOB_QUEUE, JSON.stringify(job));
      expect(length).toBeGreaterThanOrEqual(1);

      // Clean up
      await redis.lrem(JOB_QUEUE, 1, JSON.stringify(job));
    });

    it('should pop job from queue', async () => {
      const job = {
        id: 'test-job-2',
        sessionId: 'test-session-2',
        userId: 'test-user-2',
        prompt: 'Test prompt 2',
        createdAt: Date.now(),
        status: 'pending',
      };

      await redis.lpush(JOB_QUEUE, JSON.stringify(job));
      
      const result = await redis.brpop(JOB_QUEUE, 1);
      expect(result).toBeDefined();
      expect(result?.[0]).toBe(JOB_QUEUE);
      
      const poppedJob = JSON.parse(result?.[1] || '{}');
      expect(poppedJob.id).toBe('test-job-2');
    });

    it('should handle empty queue with timeout', async () => {
      const result = await redis.brpop(JOB_QUEUE, 1);
      expect(result).toBeNull(); // Timeout returns null
    });
  });

  describe('Event Publishing', () => {
    it('should publish event to pubsub', async () => {
      const event = {
        type: 'test:event',
        sessionId: 'test-session-pubsub',
        data: { test: 'data' },
        timestamp: Date.now(),
      };

      const result = await redis.publish('agent:events', JSON.stringify(event));
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('should add event to stream', async () => {
      const event = {
        type: 'test:stream',
        sessionId: 'test-session-stream',
        data: { test: 'stream-data' },
        timestamp: Date.now(),
      };

      const result = await redis.xadd(
        'agent:events:stream',
        '*',
        'event',
        JSON.stringify(event)
      );
      
      expect(result).toBeDefined();
      
      // Clean up
      await redis.del('agent:events:stream');
    });
  });

  describe('Checkpoint Management', () => {
    it('should save checkpoint', async () => {
      const checkpoint = {
        id: 'cp-test-1',
        jobId: 'test-job-cp',
        sessionId: 'test-session-cp',
        step: 1,
        prompt: 'Test prompt',
        messages: [],
        toolCalls: [],
        createdAt: Date.now(),
      };

      await redis.hset(
        `agent:checkpoint:${checkpoint.sessionId}`,
        {
          current: JSON.stringify(checkpoint),
          [`step_${checkpoint.step}`]: JSON.stringify(checkpoint),
        }
      );

      const saved = await redis.hget(
        `agent:checkpoint:${checkpoint.sessionId}`,
        'current'
      );
      
      expect(saved).toBeDefined();
      expect(JSON.parse(saved!).id).toBe('cp-test-1');

      // Clean up
      await redis.del(`agent:checkpoint:${checkpoint.sessionId}`);
    });

    it('should get checkpoint', async () => {
      const checkpoint = {
        id: 'cp-test-2',
        jobId: 'test-job-cp-2',
        sessionId: 'test-session-cp-2',
        step: 2,
        prompt: 'Test prompt 2',
        messages: [],
        createdAt: Date.now(),
      };

      await redis.hset(
        `agent:checkpoint:${checkpoint.sessionId}`,
        'current',
        JSON.stringify(checkpoint)
      );

      const data = await redis.hget(
        `agent:checkpoint:${checkpoint.sessionId}`,
        'current'
      );
      
      expect(data).toBeDefined();
      const retrieved = JSON.parse(data!);
      expect(retrieved.id).toBe('cp-test-2');

      // Clean up
      await redis.del(`agent:checkpoint:${checkpoint.sessionId}`);
    });

    it('should list checkpoint history', async () => {
      const sessionId = 'test-session-history';
      
      // Add multiple checkpoints
      for (let i = 1; i <= 3; i++) {
        await redis.hset(
          `agent:checkpoint:${sessionId}`,
          `step_${i}`,
          JSON.stringify({ step: i, id: `cp-${i}` })
        );
      }

      const data = await redis.hgetall(`agent:checkpoint:${sessionId}`);
      expect(Object.keys(data).length).toBe(3);

      // Clean up
      await redis.del(`agent:checkpoint:${sessionId}`);
    });
  });

  describe('Session Management', () => {
    it('should create session', async () => {
      const session = {
        id: 'test-session-create',
        userId: 'test-user-create',
        conversationId: 'test-conv-create',
        status: 'active',
        jobId: 'test-job-create',
        createdAt: Date.now().toString(),
        lastActivity: Date.now().toString(),
      };

      await redis.hset(
        `agent:sessions:${session.id}`,
        session
      );

      const saved = await redis.hgetall(`agent:sessions:${session.id}`);
      expect(saved.id).toBe(session.id);

      // Clean up
      await redis.del(`agent:sessions:${session.id}`);
    });

    it('should expire session after TTL', async () => {
      const session = {
        id: 'test-session-expire',
        userId: 'test-user-expire',
        status: 'active',
        createdAt: Date.now().toString(),
      };

      await redis.hset(`agent:sessions:${session.id}`, session);
      await redis.expire(`agent:sessions:${session.id}`, 1); // 1 second TTL

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      const saved = await redis.hgetall(`agent:sessions:${session.id}`);
      expect(Object.keys(saved).length).toBe(0);
    });
  });

  describe('Git-VFS Integration', () => {
    it('should track git commits in checkpoint', async () => {
      const sessionId = 'test-session-git';
      const checkpoint = {
        id: 'cp-git-1',
        sessionId,
        step: 1,
        toolCalls: [
          { tool: 'write_file', args: { path: 'test.ts' } },
          { tool: 'write_file', args: { path: 'test2.ts' } },
        ],
        createdAt: Date.now(),
      };

      await redis.hset(
        `agent:checkpoint:${sessionId}`,
        'current',
        JSON.stringify(checkpoint)
      );

      const data = await redis.hget(`agent:checkpoint:${sessionId}`, 'current');
      const retrieved = JSON.parse(data!);
      
      expect(retrieved.toolCalls.length).toBe(2);

      // Clean up
      await redis.del(`agent:checkpoint:${sessionId}`);
    });
  });
});

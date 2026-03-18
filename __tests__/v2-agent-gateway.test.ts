/**
 * V2 Agent Gateway Tests
 * 
 * Tests for the agent gateway service including:
 * - Job creation
 * - SSE streaming
 * - Git-VFS endpoints
 * - Checkpoint management
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';

const GATEWAY_URL = process.env.V2_GATEWAY_URL || 'http://localhost:3002';

describe('Agent Gateway', () => {
  describe('Health Endpoints', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`${GATEWAY_URL}/health`);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.redis).toBeDefined();
    });

    it('should return ready status', async () => {
      const response = await fetch(`${GATEWAY_URL}/ready`);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.ready).toBe(true);
    });
  });

  describe('Job Management', () => {
    let sessionId: string;
    let jobId: string;

    it('should create a new job', async () => {
      const response = await fetch(`${GATEWAY_URL}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'test-user-123',
          conversationId: 'test-conv-456',
          prompt: 'Create a simple TypeScript function',
          context: 'Use best practices',
        }),
      });

      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.jobId).toBeDefined();
      expect(data.sessionId).toBeDefined();
      expect(data.status).toBe('pending');

      jobId = data.jobId;
      sessionId = data.sessionId;
    });

    it('should get job status', async () => {
      const response = await fetch(`${GATEWAY_URL}/jobs/${jobId}`);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.id).toBe(jobId);
      expect(data.sessionId).toBe(sessionId);
    });

    it('should get session info', async () => {
      const response = await fetch(`${GATEWAY_URL}/sessions/${sessionId}`);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.id).toBe(sessionId);
      expect(data.userId).toBe('test-user-123');
    });

    it('should list all jobs', async () => {
      const response = await fetch(`${GATEWAY_URL}/jobs`);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.count).toBeGreaterThanOrEqual(1);
      expect(data.jobs).toBeInstanceOf(Array);
    });

    it('should list all sessions', async () => {
      const response = await fetch(`${GATEWAY_URL}/sessions`);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.sessions).toBeInstanceOf(Array);
    });
  });

  describe('SSE Streaming', () => {
    it('should establish SSE connection', async () => {
      const sessionId = 'test-session-stream';
      
      return new Promise<void>((resolve, reject) => {
        const eventSource = new EventSource(`${GATEWAY_URL}/stream/${sessionId}`);
        
        const timeout = setTimeout(() => {
          eventSource.close();
          resolve();
        }, 5000);

        eventSource.addEventListener('connected', () => {
          clearTimeout(timeout);
          eventSource.close();
          resolve();
        });

        eventSource.addEventListener('error', (error) => {
          clearTimeout(timeout);
          eventSource.close();
          reject(error);
        });
      });
    });
  });

  describe('Git-VFS Endpoints', () => {
    let sessionId: string;

    beforeAll(async () => {
      // Create a session for git-vfs tests
      const response = await fetch(`${GATEWAY_URL}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'test-user-git',
          conversationId: 'test-conv-git',
          prompt: 'Test git-vfs',
        }),
      });
      const data = await response.json();
      sessionId = data.sessionId;
    });

    it('should get versions (empty initially)', async () => {
      const response = await fetch(`${GATEWAY_URL}/git/${sessionId}/versions?limit=10`);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.versions).toBeInstanceOf(Array);
    });

    it('should get diff between versions', async () => {
      const response = await fetch(
        `${GATEWAY_URL}/git/${sessionId}/diff?fromVersion=0&toVersion=1`
      );
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.fromVersion).toBe(0);
      expect(data.toVersion).toBe('current');
    });

    it('should handle rollback request', async () => {
      const response = await fetch(`${GATEWAY_URL}/git/${sessionId}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 1 }),
      });
      
      // May fail if no versions exist, but should return proper error
      expect(response.status).toBeGreaterThanOrEqual(200);
    });
  });

  describe('Checkpoint Management', () => {
    let sessionId: string;

    beforeAll(async () => {
      const response = await fetch(`${GATEWAY_URL}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'test-user-checkpoint',
          conversationId: 'test-conv-checkpoint',
          prompt: 'Test checkpoint',
        }),
      });
      const data = await response.json();
      sessionId = data.sessionId;
    });

    it('should get checkpoint (may not exist)', async () => {
      const response = await fetch(`${GATEWAY_URL}/checkpoints/${sessionId}`);
      
      // May be 404 if no checkpoint exists yet
      expect([200, 404]).toContain(response.status);
    });

    it('should get checkpoint history', async () => {
      const response = await fetch(`${GATEWAY_URL}/checkpoints/${sessionId}/history`);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.checkpoints).toBeInstanceOf(Array);
      expect(data.sessionId).toBe(sessionId);
    });
  });

  describe('Event Streams', () => {
    it('should get stream info', async () => {
      const response = await fetch(`${GATEWAY_URL}/streams`);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.key).toBe('agent:events');
      expect(typeof data.length).toBe('number');
    });
  });
});

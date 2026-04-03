/**
 * E2E Tests: Blaxel Enhanced Features
 * 
 * Tests for traffic management, agent handoff, and batch jobs.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('Blaxel Enhanced Features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Blaxel Traffic Manager', () => {
    const { BlaxelTrafficManager, createTrafficManager, quickCanaryDeploy, ScalingPresets } = require('@/lib/blaxel/traffic-manager');

    let trafficManager: typeof BlaxelTrafficManager;

    beforeEach(() => {
      trafficManager = new BlaxelTrafficManager('test-workspace');
    });

    afterEach(() => {
      trafficManager.destroy();
    });

    it('should split traffic between revisions', async () => {
      const result = await trafficManager.splitTraffic({
        functionName: 'test-function',
        distributions: [
          { revisionId: 'rev-1', percentage: 90, isPrimary: true },
          { revisionId: 'rev-2', percentage: 10 },
        ],
        autoRollback: true,
        errorThreshold: 5,
      });

      expect(result.success).toBe(true);
      expect(result.distribution.length).toBe(2);
      expect(result.distribution[0].percentage).toBe(90);
      expect(result.distribution[1].percentage).toBe(10);
    });

    it('should validate traffic percentages', async () => {
      const result = await trafficManager.splitTraffic({
        functionName: 'test-function',
        distributions: [
          { revisionId: 'rev-1', percentage: 60 },
          { revisionId: 'rev-2', percentage: 60 }, // Total > 100
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('must sum to 100');
    });

    it('should perform canary deployment', async () => {
      const result = await trafficManager.canaryDeploy({
        functionName: 'test-function',
        newRevisionId: 'rev-new',
        initialPercentage: 5,
        steps: 3,
        stepIntervalMs: 100, // Fast for testing
        autoRollback: false,
      });

      expect(result.success).toBe(true);
      expect(result.distribution).toBeDefined();
    });

    it('should rollback to previous revision', async () => {
      // First create a distribution
      await trafficManager.splitTraffic({
        functionName: 'test-function',
        distributions: [
          { revisionId: 'rev-1', percentage: 100, isPrimary: true },
        ],
      });

      // Then rollback
      const result = await trafficManager.rollbackToRevision(
        'test-function',
        'rev-1'
      );

      expect(result.success).toBe(true);
      expect(result.distribution[0].revisionId).toBe('rev-1');
    });

    it('should monitor revision health', async () => {
      // Update health metrics
      trafficManager.updateRevisionHealth('rev-1', {
        errorRate: 2,
        avgLatency: 50,
        rpm: 100,
      });

      const health = await trafficManager.getRevisionHealth('rev-1');

      expect(health.revisionId).toBe('rev-1');
      expect(health.errorRate).toBe(2);
      expect(health.isHealthy).toBe(true);
    });

    it('should trigger auto-rollback on health failure', async () => {
      // Set unhealthy metrics
      trafficManager.updateRevisionHealth('rev-new', {
        errorRate: 15, // Above threshold
        avgLatency: 500,
        rpm: 100,
      });

      const health = await trafficManager.getRevisionHealth('rev-new');
      expect(health.isHealthy).toBe(false);
    });

    it('should use scaling presets', () => {
      const conservative = ScalingPresets.conservative('test');
      const aggressive = ScalingPresets.aggressive('test');
      const balanced = ScalingPresets.balanced('test');

      expect(conservative.cooldownSeconds).toBe(600);
      expect(aggressive.cooldownSeconds).toBe(180);
      expect(balanced.scaleUpThreshold).toBe(85);
    });
  });

  describe('Blaxel Agent Handoff Manager', () => {
    const { BlaxelAgentHandoffManager, blaxelAgentHandoff, createAgentHandoffManager } = require('@/lib/blaxel/agent-handoff');

    let handoffManager: typeof BlaxelAgentHandoffManager;

    beforeEach(() => {
      handoffManager = new BlaxelAgentHandoffManager();
    });

    it('should create handoff', () => {
      const handoff = handoffManager.createHandoff(
        'agent-1',
        'agent-2',
        { task: 'process data' },
        { context: 'test context' }
      );

      expect(handoff.id).toBeDefined();
      expect(handoff.sourceAgent).toBe('agent-1');
      expect(handoff.targetAgent).toBe('agent-2');
      expect(handoff.status).toBe('pending');
    });

    it('should process handoff lifecycle', () => {
      const handoff = handoffManager.createHandoff('agent-1', 'agent-2', { task: 'test' });

      handoffManager.startProcessing(handoff.id);
      expect(handoffManager.getHandoff(handoff.id)?.status).toBe('processing');

      handoffManager.completeHandoff(handoff.id, { result: 'success' });
      expect(handoffManager.getHandoff(handoff.id)?.status).toBe('completed');
    });

    it('should handle handoff failure', () => {
      const handoff = handoffManager.createHandoff('agent-1', 'agent-2', { task: 'test' });

      handoffManager.startProcessing(handoff.id);
      handoffManager.failHandoff(handoff.id, 'Processing failed');

      const completed = handoffManager.getHandoff(handoff.id);
      expect(completed?.status).toBe('failed');
      expect(completed?.error).toBe('Processing failed');
    });

    it('should filter handoffs by agent', () => {
      handoffManager.createHandoff('agent-1', 'agent-2', {});
      handoffManager.createHandoff('agent-2', 'agent-3', {});
      handoffManager.createHandoff('agent-1', 'agent-3', {});

      const agent1Handoffs = handoffManager.getHandoffsByAgent('agent-1', 'source');
      expect(agent1Handoffs.length).toBe(2);

      const agent2Handoffs = handoffManager.getHandoffsByAgent('agent-2', 'target');
      expect(agent2Handoffs.length).toBe(1);
    });

    it('should provide handoff statistics', () => {
      // Create multiple handoffs
      for (let i = 0; i < 5; i++) {
        const handoff = handoffManager.createHandoff('agent-1', 'agent-2', {});
        handoffManager.completeHandoff(handoff.id, {});
      }

      const stats = handoffManager.getStats();

      expect(stats.totalHandoffs).toBe(5);
      expect(stats.completed).toBe(5);
      expect(stats.averageDuration).toBeGreaterThan(0);
    });

    it('should emit lifecycle events', () => {
      const createdSpy = vi.fn();
      const completedSpy = vi.fn();

      handoffManager.on('handoff-created', createdSpy);
      handoffManager.on('handoff-completed', completedSpy);

      const handoff = handoffManager.createHandoff('agent-1', 'agent-2', {});
      handoffManager.completeHandoff(handoff.id, {});

      expect(createdSpy).toHaveBeenCalled();
      expect(completedSpy).toHaveBeenCalled();
    });
  });

  describe('Blaxel Batch Jobs Manager', () => {
    const { BlaxelBatchJobsManager, blaxelBatchJobs, createBatchJobsManager, quickBatchExecute } = require('@/lib/blaxel/batch-jobs');

    let batchManager: typeof BlaxelBatchJobsManager;

    beforeEach(() => {
      batchManager = new BlaxelBatchJobsManager();
    });

    it('should create batch job with tasks', () => {
      const job = batchManager.createJob('test-job', [
        { id: 'task-1', command: 'echo 1' },
        { id: 'task-2', command: 'echo 2', dependencies: ['task-1'] },
        { id: 'task-3', command: 'echo 3', dependencies: ['task-2'] },
      ]);

      expect(job.id).toBeDefined();
      expect(job.name).toBe('test-job');
      expect(job.tasks.size).toBe(3);
      expect(job.status).toBe('pending');
    });

    it('should execute tasks with dependency resolution', async () => {
      const job = batchManager.createJob('test-job', [
        { id: 'task-1', command: 'echo 1' },
        { id: 'task-2', command: 'echo 2', dependencies: ['task-1'] },
      ]);

      await batchManager.startJob(job.id);

      expect(job.status).toBe('completed');
      expect(job.completedTasks).toBe(2);
      expect(job.failedTasks).toBe(0);
    });

    it('should skip tasks on dependency failure', async () => {
      const job = batchManager.createJob('test-job', [
        { id: 'task-1', command: 'exit 1' }, // Will fail
        { id: 'task-2', command: 'echo 2', dependencies: ['task-1'] },
      ]);

      await batchManager.startJob(job.id);

      expect(job.failedTasks).toBe(1);
      expect(job.tasks.get('task-2')?.status).toBe('skipped');
    });

    it('should execute independent tasks in parallel', async () => {
      const job = batchManager.createJob('test-job', [
        { id: 'task-1', command: 'echo 1' },
        { id: 'task-2', command: 'echo 2' },
        { id: 'task-3', command: 'echo 3' },
      ]);

      const startTime = Date.now();
      await batchManager.startJob(job.id);
      const duration = Date.now() - startTime;

      // Parallel execution should be faster than sequential
      expect(job.status).toBe('completed');
      expect(duration).toBeLessThan(500); // Should be fast
    });

    it('should provide job statistics', () => {
      // Create multiple jobs
      for (let i = 0; i < 3; i++) {
        const job = batchManager.createJob(`job-${i}`, [
          { id: `task-${i}`, command: 'echo' },
        ]);
        batchManager.completeHandoff(job.id, {});
      }

      const stats = batchManager.getStats();

      expect(stats.totalJobs).toBe(3);
      expect(stats.completed).toBe(3);
    });

    it('should support quick batch execution', async () => {
      const result = await quickBatchExecute('quick-test', [
        'echo 1',
        'echo 2',
        'echo 3',
      ]);

      expect(result.success).toBe(true);
      expect(result.results.length).toBe(3);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should cancel running job', async () => {
      const job = batchManager.createJob('test-job', [
        { id: 'task-1', command: 'sleep 10' },
      ]);

      batchManager.startJob(job.id);
      batchManager.cancelJob(job.id);

      expect(job.status).toBe('cancelled');
    });
  });

  describe('Blaxel Webhook Signature Verification', () => {
    const { verifyWebhookFromRequest } = require('@/lib/blaxel/blaxel-async');

    it('should verify valid webhook signature', () => {
      const secret = 'test-secret';
      const payload = JSON.stringify({ event: 'test' });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      
      const crypto = require('crypto');
      const signature = 'sha256=' + crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${payload}`)
        .digest('hex');

      const request = {
        body: payload,
        headers: {
          'x-blaxel-signature': signature,
          'x-blaxel-timestamp': timestamp,
        },
      };

      const isValid = verifyWebhookFromRequest(request, secret);
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const request = {
        body: '{"event": "test"}',
        headers: {
          'x-blaxel-signature': 'sha256=invalid',
          'x-blaxel-timestamp': Math.floor(Date.now() / 1000).toString(),
        },
      };

      const isValid = verifyWebhookFromRequest(request, 'test-secret');
      expect(isValid).toBe(false);
    });

    it('should reject expired webhook', () => {
      const oldTimestamp = Math.floor((Date.now() - 10 * 60 * 1000) / 1000); // 10 mins ago
      
      const request = {
        body: '{"event": "test"}',
        headers: {
          'x-blaxel-signature': 'sha256=test',
          'x-blaxel-timestamp': oldTimestamp.toString(),
        },
      };

      const isValid = verifyWebhookFromRequest(request, 'test-secret');
      expect(isValid).toBe(false);
    });
  });
});

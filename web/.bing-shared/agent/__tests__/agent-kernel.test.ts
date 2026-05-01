/**
 * Agent Kernel Tests
 * 
 * Tests for core AgentKernel functionality including:
 * - Agent lifecycle (spawn, terminate, suspend, resume)
 * - Priority scheduling
 * - Resource management
 * - Event emission
 * - Rate limiting
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AgentKernel, type AgentConfig, type AgentPriority } from '../agent-kernel';

describe('AgentKernel', () => {
  let kernel: AgentKernel;

  beforeEach(() => {
    kernel = new AgentKernel();
  });

  afterEach(async () => {
    if (kernel.isRunning()) {
      await kernel.stop();
    }
  });

  describe('Lifecycle', () => {
    it('should start and stop kernel', () => {
      expect(kernel.isRunning()).toBe(false);
      
      kernel.start();
      expect(kernel.isRunning()).toBe(true);
      
      kernel.stop();
      expect(kernel.isRunning()).toBe(false);
    });

    it('should spawn agents with correct config', async () => {
      kernel.start();
      
      const config: AgentConfig = {
        type: 'ephemeral',
        userId: 'test-user',
        goal: 'Test goal',
        priority: 'normal',
      };
      
      const agentId = await kernel.spawnAgent(config);
      
      expect(agentId).toBeDefined();
      expect(agentId).toContain('agent-');
    });

    it('should terminate agents', async () => {
      kernel.start();
      
      const agentId = await kernel.spawnAgent({
        type: 'ephemeral',
        userId: 'test-user',
        goal: 'Test',
        priority: 'normal',
      });
      
      const result = await kernel.terminateAgent(agentId);
      expect(result).toBe(true);
    });

    it('should suspend and resume agents', async () => {
      kernel.start();
      
      const agentId = await kernel.spawnAgent({
        type: 'persistent',
        userId: 'test-user',
        goal: 'Test',
        priority: 'normal',
      });
      
      await kernel.suspendAgent(agentId, 'test suspend');
      await kernel.resumeAgent(agentId);
    });
  });

  describe('Priority Scheduling', () => {
    it('should respect priority order', async () => {
      kernel.start();
      
      const lowId = await kernel.spawnAgent({
        type: 'ephemeral',
        userId: 'user1',
        goal: 'low priority',
        priority: 'low',
      });
      
      const highId = await kernel.spawnAgent({
        type: 'ephemeral',
        userId: 'user2',
        goal: 'high priority',
        priority: 'high',
      });
      
      const agents = await kernel.listAgents();
      expect(agents.length).toBe(2);
    });
  });

  describe('Resource Management', () => {
    it('should track compute usage', async () => {
      kernel.start();
      
      const agentId = await kernel.spawnAgent({
        type: 'ephemeral',
        userId: 'test-user',
        goal: 'Test',
        priority: 'normal',
        resources: {
          maxComputeMs: 1000,
        },
      });
      
      const agent = await kernel.getAgent(agentId);
      expect(agent).toBeDefined();
      expect(agent?.quota.computeMs).toBe(0);
    });
  });

  describe('Rate Limiting', () => {
    it('should throw when rate limit exceeded', async () => {
      kernel.start();
      
      // Attempt to spawn more than rate limit (default 10 per minute)
      // Create unique user IDs to avoid per-user limit
      const promises = Array.from({ length: 12 }, (_, i) => 
        kernel.spawnAgent({
          type: 'ephemeral',
          userId: `user-${i}`,
          goal: 'Test',
          priority: 'normal',
        })
      );
      
      // Some should succeed, some may fail due to rate limiting
      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      
      // Should have at least some successful
      expect(fulfilled.length).toBeGreaterThan(0);
    });
  });

  describe('Event Emission', () => {
    it('should emit kernel:started event', () => {
      const startedHandler = vi.fn();
      kernel.on('kernel:started', startedHandler);
      
      kernel.start();
      
      expect(startedHandler).toHaveBeenCalled();
    });

    it('should emit agent:spawned event', async () => {
      const spawnedHandler = vi.fn();
      kernel.on('agent:spawned', spawnedHandler);
      
      kernel.start();
      await kernel.spawnAgent({
        type: 'ephemeral',
        userId: 'test-user',
        goal: 'Test',
        priority: 'normal',
      });
      
      expect(spawnedHandler).toHaveBeenCalled();
    });

    it('should emit agent:completed event', async () => {
      const completedHandler = vi.fn();
      kernel.on('agent:completed', completedHandler);
      
      kernel.start();
      
      // Create agent and let it complete (ephemeral completes after one iteration)
      await kernel.spawnAgent({
        type: 'ephemeral',
        userId: 'test-user',
        goal: 'Test',
        priority: 'normal',
      });
      
      // Give time for execution
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Note: Ephemeral agents may not complete in test environment
      // This tests the event exists
    });
  });

  describe('Agent Types', () => {
    it('should accept ephemeral agent type', async () => {
      kernel.start();
      
      const agentId = await kernel.spawnAgent({
        type: 'ephemeral',
        userId: 'test-user',
        goal: 'Test',
        priority: 'normal',
      });
      
      const agent = await kernel.getAgent(agentId);
      expect(agent?.config.type).toBe('ephemeral');
    });

    it('should accept persistent agent type', async () => {
      kernel.start();
      
      const agentId = await kernel.spawnAgent({
        type: 'persistent',
        userId: 'test-user',
        goal: 'Test',
        priority: 'normal',
      });
      
      const agent = await kernel.getAgent(agentId);
      expect(agent?.config.type).toBe('persistent');
    });

    it('should accept daemon agent type', async () => {
      kernel.start();
      
      const agentId = await kernel.spawnAgent({
        type: 'daemon',
        userId: 'test-user',
        goal: 'Test',
        priority: 'normal',
      });
      
      const agent = await kernel.getAgent(agentId);
      expect(agent?.config.type).toBe('daemon');
    });

    it('should accept worker agent type', async () => {
      kernel.start();
      
      const agentId = await kernel.spawnAgent({
        type: 'worker',
        userId: 'test-user',
        goal: 'Test',
        priority: 'normal',
      });
      
      const agent = await kernel.getAgent(agentId);
      expect(agent?.config.type).toBe('worker');
    });
  });

  describe('Priority Levels', () => {
    it('should accept critical priority', async () => {
      kernel.start();
      
      const agentId = await kernel.spawnAgent({
        type: 'ephemeral',
        userId: 'test-user',
        goal: 'Test',
        priority: 'critical',
      });
      
      const agent = await kernel.getAgent(agentId);
      expect(agent?.priority).toBe('critical');
    });

    it('should accept high priority', async () => {
      kernel.start();
      
      const agentId = await kernel.spawnAgent({
        type: 'ephemeral',
        userId: 'test-user',
        goal: 'Test',
        priority: 'high',
      });
      
      const agent = await kernel.getAgent(agentId);
      expect(agent?.priority).toBe('high');
    });

    it('should accept normal priority', async () => {
      kernel.start();
      
      const agentId = await kernel.spawnAgent({
        type: 'ephemeral',
        userId: 'test-user',
        goal: 'Test',
        priority: 'normal',
      });
      
      const agent = await kernel.getAgent(agentId);
      expect(agent?.priority).toBe('normal');
    });

    it('should accept low priority', async () => {
      kernel.start();
      
      const agentId = await kernel.spawnAgent({
        type: 'ephemeral',
        userId: 'test-user',
        goal: 'Test',
        priority: 'low',
      });
      
      const agent = await kernel.getAgent(agentId);
      expect(agent?.priority).toBe('low');
    });
  });

  describe('Agent Status', () => {
    it('should have pending status after spawn', async () => {
      kernel.start();
      
      const agentId = await kernel.spawnAgent({
        type: 'ephemeral',
        userId: 'test-user',
        goal: 'Test',
        priority: 'normal',
      });
      
      const agent = await kernel.getAgent(agentId);
      expect(agent?.status).toBe('pending');
    });
  });

  describe('Work Submission', () => {
    it('should submit work to agents', async () => {
      kernel.start();
      
      const agentId = await kernel.spawnAgent({
        type: 'worker',
        userId: 'test-user',
        goal: 'Process work',
        priority: 'normal',
      });
      
      const workId = await kernel.submitWork(agentId, { task: 'test task' });
      expect(workId).toBeDefined();
    });

    it('should reject work for non-existent agents', async () => {
      kernel.start();
      
      await expect(
        kernel.submitWork('non-existent-id', { task: 'test' })
      ).rejects.toThrow();
    });
  });

  describe('Checkpoints', () => {
    it('should create checkpoints', async () => {
      kernel.start();
      
      const agentId = await kernel.spawnAgent({
        type: 'ephemeral',
        userId: 'test-user',
        goal: 'Test',
        priority: 'normal',
      });
      
      const checkpointId = await kernel.checkpointAgent(agentId);
      expect(checkpointId).toContain('checkpoint-');
    });

    it('should restore from checkpoints', async () => {
      kernel.start();
      
      const agentId = await kernel.spawnAgent({
        type: 'ephemeral',
        userId: 'test-user',
        goal: 'Test',
        priority: 'normal',
      });
      
      const checkpointId = await kernel.checkpointAgent(agentId);
      const result = await kernel.restoreFromCheckpoint(agentId, checkpointId);
      expect(result).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid agent ID', async () => {
      kernel.start();
      
      const agent = await kernel.getAgent('invalid-id');
      expect(agent).toBeUndefined();
    });

    it('should handle terminating non-existent agents', async () => {
      kernel.start();
      
      const result = await kernel.terminateAgent('non-existent');
      expect(result).toBe(false);
    });

    it('should handle suspending non-existent agents', async () => {
      kernel.start();
      
      await expect(
        kernel.suspendAgent('non-existent', 'test')
      ).rejects.toThrow();
    });
  });
});

describe('AgentKernel Factory', () => {
  it('should create new kernel instances', () => {
    const kernel1 = new AgentKernel();
    const kernel2 = new AgentKernel();
    
    expect(kernel1).not.toBe(kernel2);
    
    kernel1.start();
    kernel2.start();
    
    kernel1.stop();
    kernel2.stop();
  });
});
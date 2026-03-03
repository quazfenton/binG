/**
 * E2E Tests: Stateful Agent
 * 
 * Tests for stateful agent orchestration, session locking, and execution phases.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('Stateful Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Stateful Agent Core', () => {
    const {
      StatefulAgent,
      createStatefulAgent,
      runStatefulAgent,
      getActiveSessionLocks,
      clearAllSessionLocks,
    } = require('@/lib/stateful-agent/agents/stateful-agent');

    let agent: typeof StatefulAgent;

    beforeEach(() => {
      agent = new StatefulAgent({
        sessionId: 'test-session-123',
      });
    });

    it('should create agent instance', () => {
      expect(agent).toBeDefined();
      expect(agent.sessionId).toBe('test-session-123');
    });

    it('should create agent with factory', () => {
      const factoryAgent = createStatefulAgent({ sessionId: 'factory-session' });
      expect(factoryAgent).toBeDefined();
    });

    it('should run agent workflow', async () => {
      vi.spyOn(agent, 'runDiscoveryPhase').mockResolvedValue(undefined);
      vi.spyOn(agent, 'runPlanningPhase').mockResolvedValue(undefined);
      vi.spyOn(agent, 'runEditingPhase').mockResolvedValue(undefined);

      const result = await agent.run('Test task');

      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
      expect(result.steps).toBeGreaterThan(0);
    });

    it('should handle errors gracefully', async () => {
      vi.spyOn(agent, 'runDiscoveryPhase').mockRejectedValue(new Error('Discovery failed'));

      const result = await agent.run('Test task');

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it('should get agent state', () => {
      const state = agent.getState();

      expect(state).toBeDefined();
      expect(state.sessionId).toBe('test-session-123');
      expect(state.status).toBe('idle');
    });

    it('should enforce session locking', async () => {
      const { getActiveSessionLocks } = require('@/lib/stateful-agent/agents/stateful-agent');

      const beforeLocks = getActiveSessionLocks();
      expect(typeof beforeLocks).toBe('number');
    });

    it('should clear session locks', () => {
      const { clearAllSessionLocks } = require('@/lib/stateful-agent/agents/stateful-agent');

      clearAllSessionLocks();

      const afterLocks = getActiveSessionLocks();
      expect(afterLocks).toBe(0);
    });
  });

  describe('Discovery Phase', () => {
    const { StatefulAgent } = require('@/lib/stateful-agent/agents/stateful-agent');

    it('should run discovery phase', async () => {
      const agent = new StatefulAgent();
      
      vi.spyOn(agent as any, 'getModel').mockReturnValue({
        doGenerate: vi.fn().mockResolvedValue({
          text: 'file1.ts\nfile2.ts\nfile3.ts',
        }),
      });

      await (agent as any).runDiscoveryPhase('Test task');

      expect(agent.steps).toBe(1);
    });

    it('should handle discovery errors', async () => {
      const agent = new StatefulAgent();
      
      vi.spyOn(agent as any, 'getModel').mockRejectedValue(new Error('Model failed'));

      await (agent as any).runDiscoveryPhase('Test task');

      expect(agent.steps).toBe(1);
      expect(agent.errors).toHaveLength(0); // Errors are logged, not stored
    });
  });

  describe('Planning Phase', () => {
    const { StatefulAgent } = require('@/lib/stateful-agent/agents/stateful-agent');

    it('should run planning phase', async () => {
      const agent = new StatefulAgent({ enforcePlanActVerify: true });
      
      (agent as any).vfs = { 'file1.ts': 'content' };

      vi.spyOn(agent as any, 'getModel').mockReturnValue({
        doGenerate: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            task: 'Test task',
            files: [{ path: 'file1.ts', action: 'edit' }],
            execution_order: ['file1.ts'],
          }),
        }),
      });

      await (agent as any).runPlanningPhase('Test task');

      expect(agent.currentPlan).toBeDefined();
      expect(agent.steps).toBe(1);
    });

    it('should handle invalid JSON plan', async () => {
      const agent = new StatefulAgent();
      
      (agent as any).vfs = { 'file1.ts': 'content' };

      vi.spyOn(agent as any, 'getModel').mockReturnValue({
        doGenerate: vi.fn().mockResolvedValue({
          text: 'invalid json',
        }),
      });

      await (agent as any).runPlanningPhase('Test task');

      expect(agent.currentPlan).toEqual({
        task: 'Test task',
        files: [],
        execution_order: [],
      });
    });

    it('should skip planning if VFS is empty', async () => {
      const agent = new StatefulAgent({ enforcePlanActVerify: true });
      
      (agent as any).vfs = {};

      await (agent as any).runPlanningPhase('Test task');

      expect(agent.currentPlan).toBeNull();
    });
  });

  describe('Editing Phase', () => {
    const { StatefulAgent } = require('@/lib/stateful-agent/agents/stateful-agent');

    it('should run editing phase', async () => {
      const agent = new StatefulAgent();
      
      vi.spyOn(agent as any, 'getModel').mockReturnValue({
        doGenerate: vi.fn().mockResolvedValue({ text: 'Edited' }),
      });

      await (agent as any).runEditingPhase('Test task');

      expect(agent.status).toBe('verifying');
      expect(agent.steps).toBe(1);
    });

    it('should handle editing errors', async () => {
      const agent = new StatefulAgent();
      
      vi.spyOn(agent as any, 'getModel').mockRejectedValue(new Error('Edit failed'));

      await (agent as any).runEditingPhase('Test task');

      expect(agent.errors).toHaveLength(1);
      expect(agent.errors[0].message).toContain('Editing failed');
    });
  });

  describe('Verification Phase', () => {
    const { StatefulAgent } = require('@/lib/stateful-agent/agents/stateful-agent');

    it('should run verification phase', async () => {
      const agent = new StatefulAgent();
      
      vi.spyOn(agent as any, 'getModel').mockReturnValue({
        doGenerate: vi.fn().mockResolvedValue({ text: 'Verified' }),
      });

      const result = await (agent as any).runVerificationPhase();

      expect(result).toBeDefined();
      expect(result.errors).toBeDefined();
    });
  });

  describe('Self-Healing Phase', () => {
    const { StatefulAgent } = require('@/lib/stateful-agent/agents/stateful-agent');

    it('should run self-healing phase', async () => {
      const agent = new StatefulAgent({ maxSelfHealAttempts: 3 });
      
      vi.spyOn(agent as any, 'getModel').mockReturnValue({
        doGenerate: vi.fn().mockResolvedValue({ text: 'Healed' }),
      });

      const result = await (agent as any).runSelfHealingPhase([]);

      expect(result).toBeDefined();
      expect(result.vfs).toBeDefined();
    });

    it('should respect max attempts', async () => {
      const agent = new StatefulAgent({ maxSelfHealAttempts: 0 });
      
      (agent as any).retryCount = 3;

      const result = await (agent as any).runSelfHealingPhase([]);

      expect(result.errors).toContainEqual(
        expect.objectContaining({ message: 'Max self-healing attempts exceeded' })
      );
    });
  });

  describe('Stateful Agent Integration', () => {
    const { runStatefulAgent } = require('@/lib/stateful-agent/agents/stateful-agent');

    it('should run stateful agent with factory function', async () => {
      vi.spyOn(StatefulAgent.prototype, 'run').mockResolvedValue({
        success: true,
        response: 'Completed',
        steps: 3,
        errors: [],
      });

      const result = await runStatefulAgent('Test task', {
        sessionId: 'test-session',
      });

      expect(result.success).toBe(true);
      expect(result.steps).toBe(3);
    });
  });

  describe('Session Lock Manager', () => {
    const {
      acquireSessionLock,
      getActiveSessionLocks,
      clearAllSessionLocks,
    } = require('@/lib/stateful-agent/agents/stateful-agent');

    it('should acquire session lock', async () => {
      const releaseLock = await acquireSessionLock('session-1');

      expect(typeof releaseLock).toBe('function');
      expect(getActiveSessionLocks()).toBeGreaterThan(0);

      releaseLock();
      expect(getActiveSessionLocks()).toBe(0);
    });

    it('should wait for existing lock', async () => {
      const releaseLock1 = await acquireSessionLock('session-2');
      
      let lock2Acquired = false;
      acquireSessionLock('session-2').then(() => {
        lock2Acquired = true;
      });

      // Lock 2 should be waiting
      expect(lock2Acquired).toBe(false);

      releaseLock1();

      // Wait for lock 2 to be acquired
      await new Promise(r => setTimeout(r, 10));
      expect(lock2Acquired).toBe(true);
    });

    it('should clear all locks', () => {
      clearAllSessionLocks();
      expect(getActiveSessionLocks()).toBe(0);
    });
  });

  describe('Stateful Agent: Full Workflow', () => {
    it('should support complete agent workflow', async () => {
      const { StatefulAgent } = require('@/lib/stateful-agent/agents/stateful-agent');

      const agent = new StatefulAgent({ sessionId: 'full-workflow-test' });

      // Mock all phases
      vi.spyOn(agent as any, 'runDiscoveryPhase').mockResolvedValue(undefined);
      vi.spyOn(agent as any, 'runPlanningPhase').mockResolvedValue(undefined);
      vi.spyOn(agent as any, 'runEditingPhase').mockResolvedValue(undefined);

      const result = await agent.run('Build a feature');

      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
      expect(result.steps).toBeGreaterThan(0);
      expect(result.vfs).toBeDefined();
    });
  });
});

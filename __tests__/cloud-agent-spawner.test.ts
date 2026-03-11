/**
 * Tests for Cloud Agent Spawner
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock uuid
vi.mock('uuid', () => ({
  v4: () => `test-agent-${Math.random().toString(36).substr(2, 9)}`
}))

// Mock logger
vi.mock('../lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })
}))

// Mock sandbox providers
vi.mock('../lib/sandbox/providers', () => ({
  getSandboxProvider: vi.fn(() => ({
    createSandbox: vi.fn(() => Promise.resolve({
      id: 'test-sandbox-123',
      workspaceDir: '/workspace',
      executeCommand: vi.fn(() => Promise.resolve({ success: true })),
      getPreviewLink: vi.fn(() => Promise.resolve({ url: 'http://sandbox.local' })),
      destroySandbox: vi.fn(() => Promise.resolve()),
    })),
    getSandbox: vi.fn(() => Promise.resolve({
      id: 'test-sandbox-123',
      writeFile: vi.fn(() => Promise.resolve({ success: true })),
      executeCommand: vi.fn(() => Promise.resolve({ success: true, output: '{}' })),
    })),
    destroySandbox: vi.fn(() => Promise.resolve()),
  })),
}))

describe('CloudAgentSpawner', () => {
  let spawner: any;

  beforeEach(async () => {
    vi.resetModules();
    const { cloudAgentSpawner } = await import('../lib/sandbox/cloud-agent-spawner');
    spawner = cloudAgentSpawner;
  });

  describe('spawnAgent', () => {
    it('should spawn agent with e2b provider', async () => {
      const result = await spawner.spawnAgent({
        provider: 'e2b',
        model: 'claude-3-5-sonnet',
      });

      expect(result.success).toBe(true);
      expect(result.agent).toBeDefined();
      expect(result.agent?.provider).toBe('e2b');
      expect(result.agent?.sandboxId).toBeDefined();
      expect(result.agent?.workspaceUrl).toBeDefined();
      expect(result.agent?.status).toBe('ready');
    });

    it('should spawn agent with daytona provider', async () => {
      const result = await spawner.spawnAgent({
        provider: 'daytona',
      });

      expect(result.success).toBe(true);
      expect(result.agent?.provider).toBe('daytona');
    });

    it('should set custom system prompt', async () => {
      const result = await spawner.spawnAgent({
        provider: 'e2b',
        systemPrompt: 'You are a helpful assistant.',
      });

      expect(result.success).toBe(true);
    });

    it('should include spawn time in metadata', async () => {
      const result = await spawner.spawnAgent({
        provider: 'e2b',
      });

      expect(result.metadata).toBeDefined();
      expect(result.metadata?.spawnTime).toBeDefined();
      expect(typeof result.metadata?.spawnTime).toBe('number');
    });
  });

  describe('getAgent', () => {
    it('should return agent by ID', async () => {
      const spawned = await spawner.spawnAgent({ provider: 'e2b' });
      
      const agent = spawner.getAgent(spawned.agent!.id);

      expect(agent).toBeDefined();
      expect(agent?.id).toBe(spawned.agent?.id);
    });

    it('should return undefined for non-existent agent', () => {
      const agent = spawner.getAgent('non-existent');
      expect(agent).toBeUndefined();
    });
  });

  describe('getActiveAgents', () => {
    it('should return all active agents', async () => {
      await spawner.spawnAgent({ provider: 'e2b' });
      await spawner.spawnAgent({ provider: 'daytona' });

      const activeAgents = spawner.getActiveAgents();

      expect(activeAgents.length).toBeGreaterThanOrEqual(2);
      expect(activeAgents.every((a: any) => 
        a.status === 'ready' || a.status === 'running'
      )).toBe(true);
    });
  });

  describe('executeOnAgent', () => {
    it('should return error for non-existent agent', async () => {
      const result = await spawner.executeOnAgent(
        'non-existent',
        'test task'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should execute task on active agent', async () => {
      const spawned = await spawner.spawnAgent({ provider: 'e2b' });

      const result = await spawner.executeOnAgent(
        spawned.agent!.id,
        'List files in current directory'
      );

      // Result depends on mock, but should not be "not found"
      expect(result.success).toBeDefined();
    });
  });

  describe('stopAgent', () => {
    it('should stop running agent', async () => {
      const spawned = await spawner.spawnAgent({ provider: 'e2b' });

      const result = await spawner.stopAgent(spawned.agent!.id);

      expect(result.success).toBe(true);
    });

    it('should return error for non-existent agent', async () => {
      const result = await spawner.stopAgent('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('cleanupIdleAgents', () => {
    it('should return count of cleaned up agents', async () => {
      // Create some agents
      await spawner.spawnAgent({ provider: 'e2b' });
      
      // Manually set lastActivity to past
      const agents = spawner.getActiveAgents();
      if (agents.length > 0) {
        const agent = agents[0];
        agent.lastActivity = Date.now() - 3600000; // 1 hour ago
      }

      const cleaned = await spawner.cleanupIdleAgents();

      expect(typeof cleaned).toBe('number');
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      await spawner.spawnAgent({ provider: 'e2b' });
      await spawner.spawnAgent({ provider: 'daytona' });

      const stats = spawner.getStats();

      expect(stats.totalAgents).toBeDefined();
      expect(stats.activeAgents).toBeDefined();
      expect(stats.byProvider).toBeDefined();
      expect(stats.byProvider.e2b).toBeDefined();
      expect(stats.byProvider.daytona).toBeDefined();
    });
  });
});

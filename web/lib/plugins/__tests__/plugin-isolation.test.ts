/**
 * Tests for Plugin Isolation System
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginIsolationManager, PluginError } from '../plugin-isolation';

describe('PluginIsolationManager', () => {
  let manager: PluginIsolationManager;

  beforeEach(() => {
    manager = new PluginIsolationManager();
  });

  afterEach(() => {
    manager.cleanup();
  });

  describe('Sandbox Creation', () => {
    it('should create a sandbox with default configuration', () => {
      const sandboxId = manager.createSandbox('test-plugin');

      expect(sandboxId).toMatch(/^sandbox_test-plugin_\d+_\d+$/);

      const sandbox = manager.getSandboxInfo(sandboxId);
      expect(sandbox).toBeDefined();
      expect(sandbox?.pluginId).toBe('test-plugin');
      expect(sandbox?.status).toBe('initializing');
    });

    it('should create a sandbox with custom configuration', () => {
      const config = {
        resourceLimits: {
          maxMemoryMB: 200,
          maxCpuPercent: 50,
          maxNetworkRequests: 100,
          maxStorageKB: 2048,
          timeoutMs: 60000
        }
      };

      const sandboxId = manager.createSandbox('test-plugin', config);
      const sandbox = manager.getSandboxInfo(sandboxId);

      expect(sandbox).toBeDefined();
      expect(sandbox?.pluginId).toBe('test-plugin');
    });
  });

  describe('Sandbox Execution', () => {
    it('should execute operations successfully in sandbox', async () => {
      const sandboxId = manager.createSandbox('test-plugin');

      const result = await manager.executeInSandbox(sandboxId, async () => {
        return 'test-result';
      });

      expect(result).toBe('test-result');

      const sandbox = manager.getSandboxInfo(sandboxId);
      expect(sandbox).toBeDefined();
      expect(sandbox?.status).toBe('running');
    });

    it('should handle execution errors', async () => {
      const sandboxId = manager.createSandbox('test-plugin');

      await expect(
        manager.executeInSandbox(sandboxId, async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });

    it('should handle execution timeout', async () => {
      vi.useRealTimers(); // Need real timers for timeout test
      const sandboxId = manager.createSandbox('test-plugin');

      await expect(
        manager.executeInSandbox(sandboxId, async () => {
          return new Promise(resolve => setTimeout(resolve, 2000));
        }, 100)
      ).rejects.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should register and trigger error handlers', async () => {
      const errorHandler = vi.fn();
      manager.registerErrorHandler('test-plugin', errorHandler);

      const sandboxId = manager.createSandbox('test-plugin');

      try {
        await manager.executeInSandbox(sandboxId, async () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: 'test-plugin',
          message: expect.any(String)
        })
      );
    });
  });

  describe('Sandbox Management', () => {
    it('should pause and resume sandbox', async () => {
      const sandboxId = manager.createSandbox('test-plugin');

      manager.pauseSandbox(sandboxId);
      const paused = manager.getSandboxInfo(sandboxId);
      expect(paused?.status).toBe('paused');

      manager.resumeSandbox(sandboxId);
      const resumed = manager.getSandboxInfo(sandboxId);
      expect(resumed?.status).toBe('running');
    });

    it('should terminate sandbox', async () => {
      const sandboxId = manager.createSandbox('test-plugin');

      manager.terminateSandbox(sandboxId);
      const terminated = manager.getSandboxInfo(sandboxId);
      expect(terminated).toBeUndefined();
    });

    it('should get plugin sandboxes', () => {
      const sandboxId1 = manager.createSandbox('plugin-1');
      const sandboxId2 = manager.createSandbox('plugin-1');
      manager.createSandbox('plugin-2');

      const plugin1Sandboxes = manager.getPluginSandboxes('plugin-1');
      expect(plugin1Sandboxes).toHaveLength(2);
      expect(plugin1Sandboxes.map(s => s.id)).toContain(sandboxId1);
      expect(plugin1Sandboxes.map(s => s.id)).toContain(sandboxId2);
    });
  });

  describe('Resource Monitoring', () => {
    it('should track resource usage over time', async () => {
      vi.useRealTimers(); // Need real timers for setTimeout
      const sandboxId = manager.createSandbox('test-plugin');

      await manager.executeInSandbox(sandboxId, async () => {
        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      const sandbox = manager.getSandboxInfo(sandboxId);
      expect(sandbox?.resourceUsage).toBeDefined();
      expect(sandbox?.resourceUsage.executionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Cleanup', () => {
    it('should clean up all resources', () => {
      const sandboxId1 = manager.createSandbox('test-plugin-1');
      const sandboxId2 = manager.createSandbox('test-plugin-2');

      manager.cleanup();

      expect(manager.getSandboxInfo(sandboxId1)).toBeUndefined();
      expect(manager.getSandboxInfo(sandboxId2)).toBeUndefined();
    });
  });
});
